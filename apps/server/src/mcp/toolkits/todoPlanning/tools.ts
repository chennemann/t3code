import { NonNegativeInt, TodoPlanningProposal } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";
import * as Crypto from "effect/Crypto";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  OrchestrationEngineService,
  ProjectionSnapshotQuery,
  Crypto.Crypto,
];

export const FinalizeTodoPlanTool = Tool.make("finalize_todo_plan", {
  description:
    "Finalize the current to-do planning session. First use the chat to ask focused questions about the user's intended outcome, scope, constraints, and acceptance criteria; do not guess material requirements. Call this exactly once only after the user confirms the proposal is ready. The server updates the parent to-do and creates every sub-task as a full child to-do.",
  parameters: TodoPlanningProposal,
  success: Schema.Struct({ todoId: Schema.String, subtaskCount: NonNegativeInt }),
  failure: Schema.String,
  dependencies,
})
  .annotate(Tool.Title, "Finalize to-do plan")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false);

export const TodoPlanningToolkit = Toolkit.make(FinalizeTodoPlanTool);
