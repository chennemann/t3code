import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { TrimmedString } from "../baseSchemas.ts";

export const DEFAULT_TODO_PLANNING_INSTRUCTIONS =
  "Start by asking a small, focused set of questions about the desired outcome, users, scope, constraints, and acceptance criteria. Do not guess material requirements. Reflect what you heard and resolve ambiguities before proposing a final plan. Only after the user confirms the proposal is ready, finish with exactly one call to finalize_todo_plan. The planning session is not complete unless that tool succeeds.";

export const clientSettingsFields = {
  todoPlanningInstructions: TrimmedString.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_TODO_PLANNING_INSTRUCTIONS)),
  ),
} as const;

export const serverSettingsFields = {
  terminalShellPath: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
} as const;

export const clientSettingsPatchFields = {
  todoPlanningInstructions: Schema.optionalKey(TrimmedString),
} as const;

export const serverSettingsPatchFields = {
  terminalShellPath: Schema.optionalKey(TrimmedString),
} as const;
