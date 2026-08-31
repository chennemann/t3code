import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export interface TerminalShellPolicyShape {
  /** Resolve the preferred shell for a new terminal launch. Empty selects the platform default. */
  readonly resolve: Effect.Effect<string>;
}

export class TerminalShellPolicy extends Context.Service<
  TerminalShellPolicy,
  TerminalShellPolicyShape
>()("t3/terminal/ShellPolicy/TerminalShellPolicy") {}

export const layerDefault = Layer.succeed(
  TerminalShellPolicy,
  TerminalShellPolicy.of({ resolve: Effect.succeed("") }),
);
