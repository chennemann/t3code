import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { TrimmedString } from "../baseSchemas.ts";

export const serverSettingsFields = {
  terminalShellPath: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
} as const;

export const serverSettingsPatchFields = {
  terminalShellPath: Schema.optionalKey(TrimmedString),
} as const;
