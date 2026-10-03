import * as Schema from "effect/Schema";

import { ProjectId } from "../baseSchemas.ts";

/** Reserved environment-local project backing downstream workspace features. */
export const WORKSPACE_PROJECT_ID = ProjectId.make("t3-inbox");

export const capabilityFields = {
  todos: Schema.optionalKey(Schema.Boolean),
} as const;
