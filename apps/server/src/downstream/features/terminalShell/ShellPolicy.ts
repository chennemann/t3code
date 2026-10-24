import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerSettings from "../../../serverSettings.ts";
import * as TerminalShell from "../../../terminal/ShellPolicy.ts";

const make = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;

  return TerminalShell.TerminalShellPolicy.of({
    resolve: settings.getSettings.pipe(
      Effect.map((value) => value.terminalShellPath),
      Effect.catch((error) =>
        Effect.logWarning("failed to read terminal shell setting; using platform default", {
          operation: error.operation,
          cause: error.cause,
        }).pipe(Effect.as("")),
      ),
    ),
  });
});

export const layer = Layer.effect(TerminalShell.TerminalShellPolicy, make);
