// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off
import * as NodePath from "node:path";
import * as NodeFSP from "node:fs/promises";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  ApprovalRequestId,
  DEVIN_DEFAULT_MODEL,
  DevinSettings,
  ProviderInstanceId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ServerConfig } from "../../config.ts";
import { execScriptSource, writeFakeCli } from "../../testUtils/fakeCli.ts";
import { makeDevinTextGeneration } from "../../textGeneration/DevinTextGeneration.ts";
import { makeDevinAdapter } from "./DevinAdapter.ts";
import { checkDevinProviderStatus, parseDevinModels } from "./DevinProvider.ts";

const decodeSettings = Schema.decodeSync(DevinSettings);
const instanceId = ProviderInstanceId.make("devin-work");
const threadId = ThreadId.make("devin-thread");
const modelSelection = { instanceId, model: DEVIN_DEFAULT_MODEL };
const environment = { ...process.env, WINDSURF_API_KEY: "test-only-key" };
const mockAgentPath = NodePath.resolve(import.meta.dirname, "../../../scripts/acp-mock-agent.ts");

const makeMock = Effect.fn("makeDevinMock")(function* (extraEnv: Record<string, string> = {}) {
  const fs = yield* FileSystem.FileSystem;
  const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-devin-test-" });
  const requestLogPath = NodePath.join(cwd, "requests.ndjson");
  const binaryPath = writeFakeCli({
    directory: cwd,
    name: "devin",
    env: { T3_ACP_REQUEST_LOG_PATH: requestLogPath, ...extraEnv },
    source: execScriptSource({ scriptPath: mockAgentPath, expectedArgs: ["acp"] }),
  });
  const settings = decodeSettings({ enabled: true, binaryPath });
  const adapter = yield* makeDevinAdapter(settings, { environment, instanceId });
  return { adapter, settings, cwd, requestLogPath };
});

it.layer(
  ServerConfig.layerTest(process.cwd(), { prefix: "t3-devin-config-test-" }).pipe(
    Layer.provideMerge(NodeServices.layer),
  ),
)("Devin local provider", (it) => {
  it.effect(
    "streams a turn, approves using native option IDs, switches models, and resumes the same session",
    () =>
      Effect.gen(function* () {
        const { adapter, cwd, requestLogPath } = yield* makeMock({
          T3_ACP_EMIT_TOOL_CALLS: "1",
          T3_ACP_ALLOW_ALWAYS_OPTION_ID: "devin-allow-session",
        });
        const events: ProviderRuntimeEvent[] = [];
        const subscription = yield* adapter.streamEvents.pipe(
          Stream.runForEach((event) =>
            Effect.sync(() => {
              events.push(event);
            }),
          ),
          Effect.forkScoped,
        );
        const session = yield* adapter.startSession({
          threadId,
          cwd,
          runtimeMode: "full-access",
          modelSelection,
        });
        assert.deepStrictEqual(session.resumeCursor, {
          schemaVersion: 1,
          sessionId: "mock-session-1",
        });
        yield* adapter.sendTurn({ threadId, input: "hello" });
        assert.isTrue(events.some((event) => event.type === "content.delta"));
        assert.isTrue(events.some((event) => event.type === "turn.completed"));
        assert.isFalse(events.some((event) => event.type === "request.opened"));
        yield* adapter.stopSession(threadId);
        yield* adapter.startSession({
          threadId,
          cwd,
          runtimeMode: "full-access",
          resumeCursor: session.resumeCursor,
          modelSelection: { instanceId, model: "composer-2" },
        });
        yield* adapter.sendTurn({ threadId, input: "continue" });
        const requests = yield* Effect.promise(() => NodeFSP.readFile(requestLogPath, "utf8"));
        assert.include(requests, '"method":"session/load"');
        assert.include(requests, '"value":"composer-2"');
        assert.notInclude(requests, '"value":"devin-default"');
        assert.notInclude(requests, '"method":"authenticate"');
        yield* adapter.stopSession(threadId);
        assert.deepStrictEqual(yield* adapter.listSessions(), []);
        yield* Fiber.interrupt(subscription);
      }).pipe(Effect.scoped),
  );

  it.effect("returns the advertised permission option rather than assuming ACP option IDs", () =>
    Effect.gen(function* () {
      const { adapter, cwd } = yield* makeMock({
        T3_ACP_EMIT_TOOL_CALLS: "1",
        T3_ACP_ALLOW_ONCE_OPTION_ID: "devin-yes-once",
        T3_ACP_OMIT_ALLOW_ALWAYS: "1",
      });
      const requested = yield* Deferred.make<ApprovalRequestId>();
      yield* adapter.streamEvents.pipe(
        Stream.runForEach((event) =>
          event.type === "request.opened" && event.requestId
            ? Deferred.succeed(requested, ApprovalRequestId.make(event.requestId)).pipe(
                Effect.asVoid,
              )
            : Effect.void,
        ),
        Effect.forkScoped,
      );
      yield* adapter.startSession({
        threadId,
        cwd,
        runtimeMode: "auto-accept-edits",
        modelSelection,
      });
      const turn = yield* adapter
        .sendTurn({ threadId, input: "read package metadata" })
        .pipe(Effect.forkScoped);
      yield* adapter.respondToRequest(threadId, yield* Deferred.await(requested), "accept");
      yield* Fiber.join(turn);
      assert.equal((yield* adapter.readThread(threadId)).turns.length, 1);
    }).pipe(Effect.scoped),
  );

  it.effect("rejects unsupported supervised mode before spawning a session", () =>
    Effect.gen(function* () {
      const { adapter, cwd } = yield* makeMock();
      const error = yield* adapter
        .startSession({ threadId, cwd, runtimeMode: "approval-required" })
        .pipe(Effect.flip);
      assert.equal(error._tag, "ProviderAdapterValidationError");
      assert.isFalse(yield* adapter.hasSession(threadId));
    }).pipe(Effect.scoped),
  );

  it.effect("waits for native cancellation and keeps the session usable for the next turn", () =>
    Effect.gen(function* () {
      const { adapter, cwd } = yield* makeMock({
        T3_ACP_COMPLETE_FIRST_PROMPT_ON_CANCEL: "1",
        T3_ACP_AUTO_RELEASE_NATIVE_CANCEL: "1",
      });
      const toolStarted = yield* Deferred.make<void>();
      const completed: ProviderRuntimeEvent[] = [];
      yield* adapter.streamEvents.pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            if (
              (event.type === "item.started" || event.type === "item.updated") &&
              event.payload.itemType === "command_execution"
            )
              yield* Deferred.succeed(toolStarted, undefined);
            if (event.type === "turn.completed") completed.push(event);
          }),
        ),
        Effect.forkScoped,
      );
      yield* adapter.startSession({ threadId, cwd, runtimeMode: "full-access", modelSelection });
      const turn = yield* adapter
        .sendTurn({ threadId, input: "long command" })
        .pipe(Effect.forkScoped);
      yield* Deferred.await(toolStarted);
      yield* adapter.interruptTurn(threadId);
      yield* Fiber.join(turn);
      assert.isTrue(
        completed.some(
          (event) => event.type === "turn.completed" && event.payload.state === "cancelled",
        ),
      );
      yield* adapter.sendTurn({ threadId, input: "next turn" });
      assert.equal((yield* adapter.readThread(threadId)).turns.length, 2);
    }).pipe(Effect.scoped),
  );

  it.effect("rejects a signed-out account without starting interactive authentication", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-devin-auth-test-" });
      const binaryPath = writeFakeCli({
        directory: cwd,
        name: "devin",
        source: 'console.log("Not logged in"); process.exitCode = 1;',
      });
      const adapter = yield* makeDevinAdapter(decodeSettings({ binaryPath }), {
        environment: { ...process.env, WINDSURF_API_KEY: "" },
      });
      const error = yield* adapter
        .startSession({ threadId, cwd, runtimeMode: "full-access" })
        .pipe(Effect.flip);
      assert.equal(error._tag, "ProviderAdapterRequestError");
      assert.isFalse(yield* adapter.hasSession(threadId));
    }).pipe(Effect.scoped),
  );

  it.effect(
    "checks installation and auth and discovers models without starting an ACP session",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-devin-probe-test-" });
        const binaryPath = writeFakeCli({
          directory: cwd,
          name: "devin",
          source: `
      const args = process.argv.slice(2);
      if (args[0] === '--version') console.log('devin 3000.11.3');
      else if (args[0] === 'auth') console.log('Logged in (via Devin).');
      else if (args[0] === 'models') console.log(JSON.stringify({families:[{family_label:'SWE',variants:[{model_uid:'swe-2-high',label:'SWE-2 High'}]}]}));
      else process.exitCode = 1;
    `,
        });
        const snapshot = yield* checkDevinProviderStatus(
          decodeSettings({ enabled: true, binaryPath }),
          { ...process.env, WINDSURF_API_KEY: "" },
        );
        assert.equal(snapshot.status, "ready");
        assert.equal(snapshot.auth.status, "authenticated");
        assert.deepStrictEqual(
          snapshot.models.map((model) => model.slug),
          [DEVIN_DEFAULT_MODEL, "swe-2-high"],
        );
        assert.deepStrictEqual(snapshot.unsupportedRuntimeModes, ["approval-required"]);
      }).pipe(Effect.scoped),
  );

  it.effect("generates structured helper text through ACP using the configured default model", () =>
    Effect.gen(function* () {
      const { settings, cwd } = yield* makeMock({
        T3_ACP_PROMPT_RESPONSE_TEXT: '{"title":"Fix authentication"}',
      });
      const generation = yield* makeDevinTextGeneration(settings, environment);
      const title = yield* generation.generateThreadTitle({
        cwd,
        message: "Fix authentication",
        modelSelection,
      });
      assert.equal(title.title, "Fix authentication");
    }).pipe(Effect.scoped),
  );

  it.effect(
    "steers an active prompt without completing the turn until the replacement finishes",
    () =>
      Effect.gen(function* () {
        const { adapter, cwd } = yield* makeMock({
          T3_ACP_COMPLETE_FIRST_PROMPT_ON_CANCEL: "1",
          T3_ACP_AUTO_RELEASE_NATIVE_CANCEL: "1",
        });
        const toolStarted = yield* Deferred.make<void>();
        const completions: ProviderRuntimeEvent[] = [];
        yield* adapter.streamEvents.pipe(
          Stream.runForEach((event) =>
            Effect.gen(function* () {
              if (event.type === "item.updated" && event.payload.itemType === "command_execution")
                yield* Deferred.succeed(toolStarted, undefined);
              if (event.type === "turn.completed") completions.push(event);
            }),
          ),
          Effect.forkScoped,
        );
        yield* adapter.startSession({ threadId, cwd, runtimeMode: "full-access", modelSelection });
        const original = yield* adapter
          .sendTurn({ threadId, input: "long command" })
          .pipe(Effect.forkScoped);
        yield* Deferred.await(toolStarted);
        const replacement = yield* adapter.sendTurn({ threadId, input: "change direction" });
        const first = yield* Fiber.join(original);
        assert.equal(first.turnId, replacement.turnId);
        assert.equal(completions.length, 1);
        assert.isTrue(
          completions[0]?.type === "turn.completed" && completions[0].payload.state === "completed",
        );
      }).pipe(Effect.scoped),
  );

  it.effect("marks a crashed session unavailable and still releases it on stop", () =>
    Effect.gen(function* () {
      const { adapter, cwd } = yield* makeMock({ T3_ACP_CRASH_PROMPT: "1" });
      const failed = yield* Deferred.make<void>();
      yield* adapter.streamEvents.pipe(
        Stream.runForEach((event) =>
          event.type === "session.state.changed" && event.payload.state === "error"
            ? Deferred.succeed(failed, undefined).pipe(Effect.asVoid)
            : Effect.void,
        ),
        Effect.forkScoped,
      );
      yield* adapter.startSession({ threadId, cwd, runtimeMode: "full-access", modelSelection });
      yield* adapter.sendTurn({ threadId, input: "crash now" }).pipe(Effect.flip);
      yield* Deferred.await(failed);
      assert.isFalse(yield* adapter.hasSession(threadId));
      yield* adapter.stopSession(threadId);
      assert.deepStrictEqual(yield* adapter.listSessions(), []);
    }).pipe(Effect.scoped),
  );

  it.effect("ignores malformed catalogs and deduplicates native model IDs", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(parseDevinModels("not JSON"), []);
      const models = parseDevinModels(
        JSON.stringify({
          families: [
            {
              family_label: "SWE",
              variants: [
                { model_uid: "swe", label: "SWE" },
                { model_uid: "swe", label: "duplicate" },
              ],
            },
          ],
        }),
      );
      assert.deepStrictEqual(
        models.map((model) => model.slug),
        ["swe"],
      );
    }),
  );
});
