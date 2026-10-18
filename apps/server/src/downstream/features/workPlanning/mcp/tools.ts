import * as ThreadManagementService from "../../../../orchestration-v2/ThreadManagementService.ts";
import { NonNegativeInt, TodoPlanningProposal, OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as Crypto from "effect/Crypto";

import * as McpInvocationContext from "../../../../mcp/McpInvocationContext.ts";
import { WorkPlanningService } from "../Service.ts";
import { WorkPlanningStore } from "../Store.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  WorkPlanningService,
  WorkPlanningStore,
  Crypto.Crypto,
  ThreadManagementService.ThreadManagementService,
];

export const FinalizeTodoPlanTool = Tool.make("finalize_todo_plan", {
  description:
    "Finalize the current to-do planning session. First use the chat to ask focused questions about the user's intended outcome, scope, constraints, and acceptance criteria; do not guess material requirements. Call this exactly once only after the user confirms the proposal is ready. The server updates the parent to-do and creates every sub-task as a full child to-do.",
  parameters: TodoPlanningProposal,
  success: Schema.Struct({ todoId: Schema.String, subtaskCount: NonNegativeInt }),
  failure: Schema.Union([Schema.String, OrchestratorMcpFailure]),
  dependencies,
})
  .annotate(Tool.Title, "Finalize to-do plan")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false);

export const TodoPlanningToolkit = Toolkit.make(FinalizeTodoPlanTool);
