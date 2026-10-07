import {
  DEVIN_DEFAULT_MODEL,
  type DevinSettings,
  type ProviderOptionSelection,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import type * as EffectAcpErrors from "effect-acp/errors";
import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";

export interface DevinAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly devinSettings: Pick<DevinSettings, "binaryPath">;
  readonly environment?: NodeJS.ProcessEnv;
}

export const makeDevinAcpRuntime = Effect.fn("makeDevinAcpRuntime")(function* (
  input: DevinAcpRuntimeInput,
): Effect.fn.Return<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope
> {
  const context = yield* Layer.build(
    AcpSessionRuntime.layer({
      ...input,
      spawn: {
        command: input.devinSettings.binaryPath || "devin",
        args: ["acp"],
        cwd: input.cwd,
        ...(input.environment ? { env: input.environment } : {}),
      },
      // Devin's browser authenticate method starts a login flow. The adapter
      // verifies the existing CLI login before opening this runtime instead.
      cancelBehavior: "wait-for-prompt",
    }).pipe(
      Layer.provide(
        Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
      ),
    ),
  );
  return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(Effect.provide(context));
});

export function resolveDevinAcpBaseModelId(model: string | null | undefined): string {
  return model?.trim() || DEVIN_DEFAULT_MODEL;
}

export function applyDevinAcpModelSelection<E>(input: {
  readonly runtime: Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "setModel">;
  readonly model: string | null | undefined;
  readonly selections?: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  readonly mapError: (context: { readonly cause: EffectAcpErrors.AcpError }) => E;
}): Effect.Effect<void, E> {
  const model = resolveDevinAcpBaseModelId(input.model);
  return model === DEVIN_DEFAULT_MODEL
    ? Effect.void
    : input.runtime.setModel(model).pipe(Effect.mapError((cause) => input.mapError({ cause })));
}
