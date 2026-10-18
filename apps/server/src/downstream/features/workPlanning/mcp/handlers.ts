import * as McpToolAccess from "../../../../mcp/McpToolAccess.ts";
import { CommandId, TodoId } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../../../../mcp/McpInvocationContext.ts";
import { WorkPlanningService } from "../Service.ts";
import { WorkPlanningStore } from "../Store.ts";
import { TodoPlanningToolkit } from "./tools.ts";

const handlers = {
  finalize_todo_plan: Effect.fn("TodoPlanningToolkit.finalizeTodoPlan")(
    function* (proposal) {
      const invocation = yield* McpInvocationContext.McpInvocationContext;
      if (invocation.thread === undefined)
        return yield* Effect.fail("A planning thread is required.");
      const planningThreadId = invocation.thread.threadId;
      const store = yield* WorkPlanningStore;
      const engine = yield* WorkPlanningService;
      const crypto = yield* Crypto.Crypto;
      const todos = yield* store.list;
      const todo = todos.find((candidate) => candidate.planningThreadId === planningThreadId);
      if (todo === undefined) {
        return yield* Effect.fail("This thread is not linked to an active to-do planning session.");
      }
      if (todo.plannedAt !== null) {
        return yield* Effect.fail("This to-do planning session has already been finalized.");
      }
      if (proposal.subtasks.length === 0) {
        return yield* Effect.fail("A finalized plan must contain at least one sub-task.");
      }
      const commandId = CommandId.make(yield* crypto.randomUUIDv4().pipe(Effect.orDie));
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      const subtasks = yield* Effect.forEach(proposal.subtasks, (subtask) =>
        crypto.randomUUIDv4().pipe(
          Effect.orDie,
          Effect.map((id) => ({ ...subtask, todoId: TodoId.make(id) })),
        ),
      );
      yield* engine.dispatch({
        type: "todo.plan.apply",
        commandId,
        todoId: todo.id,
        planningThreadId: planningThreadId,
        proposal,
        subtasks,
        createdAt,
      });
      return { todoId: todo.id, subtaskCount: subtasks.length };
    },
    Effect.mapError((error) => (error instanceof Error ? error.message : String(error))),
  ),
} satisfies Parameters<typeof TodoPlanningToolkit.toLayer>[0];

export const TodoPlanningToolkitHandlersLive = McpToolAccess.toLayer(TodoPlanningToolkit, {
  finalize_todo_plan: McpToolAccess.actsAsCaller(handlers.finalize_todo_plan),
});
