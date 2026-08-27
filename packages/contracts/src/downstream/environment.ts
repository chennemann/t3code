import * as Schema from "effect/Schema";

import { ProjectId } from "../baseSchemas.ts";

/** Reserved environment-local project backing downstream workspace features. */
export const WORKSPACE_PROJECT_ID = ProjectId.make("t3-inbox");

export const capabilityFields = {
  threadWorktrees: Schema.optionalKey(Schema.Boolean),
  workspaceFiles: Schema.optionalKey(Schema.Boolean),
  backgroundActivity: Schema.optionalKey(Schema.Boolean),
  executionSessions: Schema.optionalKey(Schema.Boolean),
  todos: Schema.optionalKey(Schema.Boolean),
  portableClientProtocol: Schema.optionalKey(Schema.Literal(1)),
} as const;
