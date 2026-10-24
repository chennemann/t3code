import {
  DEVIN_DEFAULT_MODEL,
  type DevinSettings,
  ProviderDriverKind,
  type ProviderInstanceId,
  type ServerProviderSlashCommand,
} from "@t3tools/contracts";
import {
  normalizeDevinSessionUpdate,
  normalizeDevinToolCall,
  extractDevinSubagentUpdate,
} from "@t3tools/provider-acp-registry/server";
import { makeAcpAdapterV2, AcpProviderCapabilitiesV2 } from "@t3tools/provider-acp/server/adapter";
import { makeAcpNativeLoggerFactory } from "@t3tools/provider-acp/server/nativeLogging";
import * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import { resolveSelfInvocation } from "@t3tools/shared/nodeRuntime";
import * as Effect from "effect/Effect";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as AcpErrors from "effect-acp/errors";
import { makeDevinAcpRuntime } from "../acp/DevinAcpSupport.ts";
import { readDevinAuth } from "./DevinProvider.ts";

/** Keep the fork's persisted Devin identity while using the shared V2 ACP adapter. */
export const makeDevinAdapter = Effect.fn("makeDevinAdapter")(function* (
  settings: DevinSettings,
  options: {
    readonly instanceId: ProviderInstanceId;
    readonly environment: NodeJS.ProcessEnv;
    readonly onAvailableCommands: (
      commands: ReadonlyArray<ServerProviderSlashCommand>,
    ) => Effect.Effect<void>;
  },
) {
  const selfInvocation = yield* resolveSelfInvocation();
  const loggers = yield* ProviderEventLoggers.ProviderEventLoggers;
  const makeNativeLogger = yield* makeAcpNativeLoggerFactory();
  return yield* makeAcpAdapterV2({
    instanceId: options.instanceId,
    selfInvocation,
    clientTerminals: { environment: options.environment, shellCommands: true },
    nativeLogging: (threadId) =>
      makeNativeLogger({
        nativeEventLogger: loggers.native,
        provider: ProviderDriverKind.make("devin"),
        threadId,
      }),
    flavor: {
      driver: ProviderDriverKind.make("devin"),
      capabilities: AcpProviderCapabilitiesV2,
      runtimeHarness: "Devin",
      supportsCompaction: true,
      sessionModeForPolicy: (policy) =>
        policy.runtimeMode === "full-access"
          ? "bypass"
          : policy.runtimeMode === "auto"
            ? "smart"
            : "accept-edits",
      clientCapabilitiesMeta: {
        "cognition.ai/subagentSupport": true,
        "cognition.ai/messageGrouping": true,
      },
      normalizeSessionUpdate: normalizeDevinSessionUpdate,
      normalizeToolCall: normalizeDevinToolCall,
      extractSubagentUpdate: extractDevinSubagentUpdate,
      resolveModelId: (selection) =>
        selection.model === DEVIN_DEFAULT_MODEL ? "default" : selection.model,
      onAvailableCommandsUpdate: (commands) =>
        options.onAvailableCommands(
          commands.map((command) => ({
            name: command.name,
            description: command.description,
            ...(command.input?.hint ? { argumentHint: command.input.hint } : {}),
          })),
        ),
      makeRuntime: Effect.fn("DevinAdapter.makeRuntime")(function* (input) {
        if (input.runtimePolicy.runtimeMode === "approval-required") {
          return yield* new AcpErrors.AcpTransportError({
            cause: undefined,
            detail:
              "Devin ACP does not support Supervised mode. Choose Auto-accept edits, Auto, or Full access.",
          });
        }
        const auth = yield* readDevinAuth(settings, options.environment);
        if (auth.status !== "authenticated") {
          return yield* new AcpErrors.AcpTransportError({
            cause: undefined,
            detail: "Sign in with devin auth login on this environment before starting a thread.",
          });
        }
        return yield* makeDevinAcpRuntime({
          ...input,
          devinSettings: settings,
          environment: { ...options.environment, ...input.processEnvironment },
          childProcessSpawner: yield* ChildProcessSpawner.ChildProcessSpawner,
        });
      }),
    },
  });
});
