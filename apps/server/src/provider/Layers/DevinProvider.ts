import {
  DEVIN_DEFAULT_MODEL,
  type DevinSettings,
  type ServerProviderAuth,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ChildProcess } from "effect/unstable/process";
import {
  AUTH_PROBE_TIMEOUT_MS,
  buildServerProvider,
  COMPACT_SLASH_COMMAND,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
} from "../providerSnapshot.ts";

const PRESENTATION = {
  displayName: "Devin",
  supportsConversationRollback: false,
  showInteractionModeToggle: true,
} as const;
const CAPABILITIES = createModelCapabilities({ optionDescriptors: [] });
const DEFAULT_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: DEVIN_DEFAULT_MODEL,
    name: "Devin default",
    isCustom: false,
    isDefault: true,
    capabilities: CAPABILITIES,
  },
];
const ModelsOutput = Schema.Struct({
  families: Schema.Array(
    Schema.Struct({
      family_label: Schema.String,
      variants: Schema.Array(
        Schema.Struct({
          model_uid: Schema.String,
          label: Schema.String,
        }),
      ),
    }),
  ),
});
const decodeModels = Schema.decodeOption(Schema.fromJsonString(ModelsOutput));

/** Discover account-specific model IDs rather than keeping a static model catalog. */
export function parseDevinModels(output: string): ReadonlyArray<ServerProviderModel> {
  const parsed = decodeModels(output);
  if (parsed._tag === "None") return [];
  const seen = new Set<string>();
  return parsed.value.families.flatMap((family) =>
    family.variants.flatMap((variant) => {
      const slug = variant.model_uid.trim();
      if (!slug || seen.has(slug)) return [];
      seen.add(slug);
      return [
        { slug, name: variant.label.trim() || slug, isCustom: false, capabilities: CAPABILITIES },
      ];
    }),
  );
}

const runDevinCommand = Effect.fn("runDevinCommand")(function* (
  settings: Pick<DevinSettings, "binaryPath">,
  args: ReadonlyArray<string>,
  environment?: NodeJS.ProcessEnv,
) {
  const binaryPath = settings.binaryPath || "devin";
  const spawn = yield* resolveSpawnCommand(binaryPath, args, { env: environment ?? process.env });
  return yield* spawnAndCollect(
    binaryPath,
    ChildProcess.make(spawn.command, spawn.args, {
      env: environment ?? process.env,
      shell: spawn.shell,
    }),
  ).pipe(Effect.timeout(AUTH_PROBE_TIMEOUT_MS));
});

export const readDevinAuth = Effect.fn("readDevinAuth")(function* (
  settings: Pick<DevinSettings, "binaryPath">,
  environment?: NodeJS.ProcessEnv,
): Effect.fn.Return<
  ServerProviderAuth,
  never,
  import("effect/unstable/process/ChildProcessSpawner").ChildProcessSpawner
> {
  if ((environment ?? process.env).WINDSURF_API_KEY?.trim()) return { status: "authenticated" };
  return yield* runDevinCommand(settings, ["auth", "status"], environment).pipe(
    Effect.map((result): ServerProviderAuth => {
      if (result.code === 0 && /^Logged in\b/im.test(result.stdout))
        return { status: "authenticated" };
      if (
        /not logged in|not authenticated|logged out|no credentials/i.test(
          result.stdout + result.stderr,
        )
      )
        return { status: "unauthenticated" };
      return { status: "unknown" };
    }),
    Effect.orElseSucceed((): ServerProviderAuth => ({ status: "unknown" })),
  );
});

export const buildInitialDevinProviderSnapshot = Effect.fn("buildInitialDevinProviderSnapshot")(
  function* (settings: DevinSettings) {
    return {
      ...buildServerProvider({
        presentation: PRESENTATION,
        enabled: settings.enabled,
        checkedAt: yield* Effect.map(DateTime.now, DateTime.formatIso),
        models: providerModelsFromSettings(DEFAULT_MODELS, settings.customModels, CAPABILITIES),
        slashCommands: [COMPACT_SLASH_COMMAND],
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: settings.enabled
            ? "Checking local Devin CLI availability..."
            : "Devin is disabled in T3 Code settings.",
        },
      }),
      unsupportedRuntimeModes: ["approval-required" as const],
    };
  },
);

export const checkDevinProviderStatus = Effect.fn("checkDevinProviderStatus")(function* (
  settings: DevinSettings,
  environment?: NodeJS.ProcessEnv,
) {
  const initial = yield* buildInitialDevinProviderSnapshot(settings);
  if (!settings.enabled) return initial;
  return yield* Effect.gen(function* () {
    const versionResult = yield* runDevinCommand(settings, ["--version"], environment);
    const version = parseGenericCliVersion(versionResult.stdout);
    if (versionResult.code !== 0 || !version)
      return {
        ...initial,
        status: "error" as const,
        message: "Could not read the Devin CLI version.",
      };
    const auth = yield* readDevinAuth(settings, environment);
    if (auth.status !== "authenticated")
      return {
        ...initial,
        installed: true,
        version,
        auth,
        message:
          auth.status === "unauthenticated"
            ? "Run devin auth login on this environment, then refresh."
            : "Could not verify Devin sign-in. Run devin auth status on this environment.",
      };
    const discovered = yield* runDevinCommand(
      settings,
      ["models", "list", "--format", "json"],
      environment,
    ).pipe(
      Effect.map((result) => (result.code === 0 ? parseDevinModels(result.stdout) : [])),
      Effect.orElseSucceed(() => []),
    );
    const { message: _pending, ...snapshot } = initial;
    return {
      ...snapshot,
      installed: true,
      version,
      auth,
      status: "ready" as const,
      models: providerModelsFromSettings(
        [...DEFAULT_MODELS, ...discovered],
        settings.customModels,
        CAPABILITIES,
      ),
    };
  }).pipe(
    Effect.catch((cause) =>
      Effect.succeed({
        ...initial,
        status: "error" as const,
        message: isCommandMissingCause(cause)
          ? "Devin CLI was not found. Install it on this environment or set its binary path."
          : "Could not check the local Devin CLI.",
      }),
    ),
  );
});
