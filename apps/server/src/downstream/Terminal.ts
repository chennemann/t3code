import * as Effect from "effect/Effect";

import * as ServerSettings from "../serverSettings.ts";

/** Captures the settings service while resolving its latest value per terminal. */
export const makeShellResolver = Effect.gen(function* () {
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  return {
    resolve: serverSettings.getSettings.pipe(
      Effect.map((settings) => settings.terminalShellPath),
      Effect.catch((error) =>
        Effect.logWarning("failed to read terminal shell setting; using platform default", {
          operation: error.operation,
          cause: error.cause,
        }).pipe(Effect.as("")),
      ),
    ),
  };
});
