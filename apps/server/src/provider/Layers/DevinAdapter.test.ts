import * as Path from "effect/Path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  DEVIN_DEFAULT_MODEL,
  DevinSettings,
  ProviderInstanceId,
  ThreadId,
  ProviderSessionId,
  ProjectId,
  RunId,
  RunAttemptId,
  NodeId,
  MessageId,
  type OrchestrationV2ProviderThread,
  type ModelSelection,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as AcpErrors from "effect-acp/errors";
import * as Stream from "effect/Stream";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import * as TestProviderHost from "@t3tools/provider-testing/TestProviderHost";
import { execScriptSource, writeFakeCli } from "@t3tools/provider-testing/fakeCli";
import { makeDevinTextGeneration } from "../../textGeneration/DevinTextGeneration.ts";
import { makeDevinAdapter } from "./DevinAdapter.ts";
import { checkDevinProviderStatus, parseDevinModels } from "./DevinProvider.ts";

const decodeSettings = Schema.decodeSync(DevinSettings);
const isAcpTransportError = Schema.is(AcpErrors.AcpTransportError);
const instanceId = ProviderInstanceId.make("devin-work");
const threadId = ThreadId.make("devin-thread");
const modelSelection = { instanceId, model: DEVIN_DEFAULT_MODEL };
const environment = { ...process.env, WINDSURF_API_KEY: "test-only-key" };
const makeMock = Effect.fn("makeDevinMock")(function* (extraEnv: Record<string, string> = {}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const mockAgentPath = path.resolve(import.meta.dirname, "../../../scripts/acp-mock-agent.ts");
  const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-devin-test-" });
  const requestLogPath = path.join(cwd, "requests.ndjson");
  const binaryPath = writeFakeCli({
    directory: cwd,
    name: "devin",
    env: { T3_ACP_DEVIN: "1", T3_ACP_REQUEST_LOG_PATH: requestLogPath, ...extraEnv },
    source: execScriptSource({ scriptPath: mockAgentPath, expectedArgs: ["acp"] }),
  });
  const settings = decodeSettings({ enabled: true, binaryPath });
  const adapter = yield* makeDevinAdapter(settings, {
    environment,
    instanceId,
    onAvailableCommands: () => Effect.void,
  });
  return { adapter, settings, cwd, requestLogPath };
});
const layerTest = Layer.mergeAll(
  NodeServices.layer,
  IdAllocator.layer,
  McpProviderSessions.layer,
  TestProviderHost.layer().pipe(Layer.provide(NodeServices.layer)),
  Layer.succeed(
    ProviderEventLoggers.ProviderEventLoggers,
    ProviderEventLoggers.NoOpProviderEventLoggers,
  ),
);

function makeTurnInput(input: {
  readonly threadId: ThreadId;
  readonly providerThread: OrchestrationV2ProviderThread;
  readonly instanceId: ProviderInstanceId;
  readonly runtimePolicy: ProviderAdapter.ProviderAdapterV2RuntimePolicy;
  readonly now: DateTime.Utc;
  readonly ordinal?: number;
  readonly modelSelection?: ModelSelection;
  /** agent+provider marks a post-settle continuation attach (drains wakeBuffer). */
  readonly messageCreatedBy?: "user" | "agent";
  readonly messageCreationSource?: "web" | "mobile" | "mcp" | "provider" | "server";
  readonly messageText?: string;
}): ProviderAdapter.ProviderAdapterV2TurnInput {
  const ordinal = input.ordinal ?? 1;
  const suffix = `${input.threadId}:${ordinal}`;
  const modelSelection =
    input.modelSelection ?? ({ instanceId: input.instanceId, model: "default" } as const);
  return {
    appThread: {
      createdBy: "user",
      creationSource: "web",
      id: input.threadId,
      projectId: ProjectId.make(`project:${input.threadId}`),
      title: "ACP adapter test",
      providerInstanceId: input.instanceId,
      modelSelection,
      runtimeMode: "approval-required",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: input.providerThread.id,
      lineage: {
        parentThreadId: null,
        relationshipToParent: null,
        rootThreadId: input.threadId,
      },
      forkedFrom: null,
      createdAt: input.now,
      updatedAt: input.now,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
    },
    threadId: input.threadId,
    runId: RunId.make(`run:${suffix}`),
    runOrdinal: ordinal,
    providerTurnOrdinal: ordinal,
    attemptId: RunAttemptId.make(`attempt:${suffix}`),
    rootNodeId: NodeId.make(`node:${suffix}`),
    providerThread: input.providerThread,
    message: {
      createdBy: input.messageCreatedBy ?? "user",
      creationSource: input.messageCreationSource ?? "web",
      messageId: MessageId.make(`message:${suffix}`),
      text: input.messageText ?? "test prompt",
      attachments: [],
    },
    modelSelection,
    runtimePolicy: input.runtimePolicy,
  };
}

it.layer(layerTest)("Devin local provider V2", (it) => {
  it.effect(
    "streams a V2 turn and resumes its native session without sending the default model alias",
    () =>
      Effect.gen(function* () {
        const { adapter, cwd, requestLogPath } = yield* makeMock({
          T3_ACP_EMIT_TOOL_CALLS: "1",
          T3_ACP_ALLOW_ALWAYS_OPTION_ID: "devin-allow-session",
        });
        const runtimePolicy = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
          runtimeMode: "full-access",
          interactionMode: "default",
          cwd,
        });
        yield* Effect.gen(function* () {
          const runtime = yield* adapter.openSession({
            threadId,
            providerSessionId: ProviderSessionId.make("devin-session"),
            modelSelection,
            runtimePolicy,
          });
          const providerThread = yield* runtime.ensureThread({
            threadId,
            modelSelection,
            runtimePolicy,
          });
          yield* runtime.startTurn(
            makeTurnInput({
              threadId,
              providerThread,
              instanceId,
              modelSelection,
              runtimePolicy,
              now: yield* DateTime.now,
            }),
          );
          const events = yield* runtime.events.pipe(
            Stream.takeUntil((event) => event.type === "turn.terminal"),
            Stream.runCollect,
          );
          assert.isTrue(
            events.some((event) => event.type === "turn.terminal" && event.status === "completed"),
          );
          assert.equal(runtime.providerSession.driver, "devin");
          assert.equal(providerThread.nativeThreadRef?.nativeId, "mock-session-1");
        }).pipe(Effect.scoped);
        yield* adapter.openSession({
          threadId,
          providerSessionId: ProviderSessionId.make("devin-resumed"),
          modelSelection: { instanceId, model: "composer-2" },
          runtimePolicy,
          initialNativeThreadId: "mock-session-1",
        });
        const fs = yield* FileSystem.FileSystem;
        const requests = yield* fs.readFileString(requestLogPath);
        assert.match(requests, /"method":"session\/(load|resume)"/);
        assert.include(requests, '"value":"bypass"');
        assert.include(requests, '"value":"composer-2"');
        assert.notInclude(requests, '"value":"devin-default"');
        assert.notInclude(requests, '"method":"authenticate"');
      }).pipe(Effect.scoped),
  );
  it.effect("applies native runtime modes and returns from Plan mode to Smart mode", () =>
    Effect.gen(function* () {
      const { adapter, cwd, requestLogPath } = yield* makeMock();
      const runtimePolicy = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: "auto",
        interactionMode: "plan",
        cwd,
      });
      const runtime = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("devin-plan"),
        modelSelection,
        runtimePolicy,
      });
      const providerThread = yield* runtime.ensureThread({
        threadId,
        modelSelection,
        runtimePolicy,
      });
      yield* runtime.startTurn(
        makeTurnInput({
          threadId,
          providerThread,
          instanceId,
          modelSelection,
          runtimePolicy: { ...runtimePolicy, interactionMode: "default" },
          now: yield* DateTime.now,
        }),
      );
      yield* runtime.events.pipe(
        Stream.takeUntil((event) => event.type === "turn.terminal"),
        Stream.runDrain,
      );
      const fs = yield* FileSystem.FileSystem;
      const requests = yield* fs.readFileString(requestLogPath);
      const modes = requests.split("\n").filter((line) => line.includes('"configId":"mode"'));
      assert.include(modes[0] ?? "", '"value":"smart"');
      assert.include(modes[1] ?? "", '"value":"plan"');
      assert.include(modes.at(-1) ?? "", '"value":"smart"');
    }).pipe(Effect.scoped),
  );
  it.effect("rejects supervised sessions before launching Devin", () =>
    Effect.gen(function* () {
      const { adapter, cwd, requestLogPath } = yield* makeMock();
      const error = yield* adapter
        .openSession({
          threadId,
          providerSessionId: ProviderSessionId.make("supervised"),
          modelSelection,
          runtimePolicy: ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
            runtimeMode: "approval-required",
            interactionMode: "default",
            cwd,
          }),
        })
        .pipe(Effect.flip);
      assert.isTrue(isAcpTransportError(error.cause));
      if (isAcpTransportError(error.cause))
        assert.include(error.cause.detail ?? "", "Devin ACP does not support Supervised mode");
      const fs = yield* FileSystem.FileSystem;
      assert.isFalse(yield* fs.exists(requestLogPath));
    }).pipe(Effect.scoped),
  );
  it.effect("rejects signed-out accounts without interactive authentication", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-devin-auth-" });
      const binaryPath = writeFakeCli({
        directory: cwd,
        name: "devin",
        source: 'console.log("Not logged in"); process.exitCode = 1;',
      });
      const adapter = yield* makeDevinAdapter(decodeSettings({ binaryPath }), {
        environment: { ...process.env, WINDSURF_API_KEY: "" },
        instanceId,
        onAvailableCommands: () => Effect.void,
      });
      const error = yield* adapter
        .openSession({
          threadId,
          providerSessionId: ProviderSessionId.make("signed-out"),
          modelSelection,
          runtimePolicy: ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
            runtimeMode: "full-access",
            interactionMode: "default",
            cwd,
          }),
        })
        .pipe(Effect.flip);
      assert.isTrue(isAcpTransportError(error.cause));
      if (isAcpTransportError(error.cause))
        assert.include(error.cause.detail ?? "", "Sign in with devin auth login");
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
        assert.deepStrictEqual(snapshot.supportedRuntimeModes, [
          "auto-accept-edits",
          "auto",
          "full-access",
        ]);
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
