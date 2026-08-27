import { CommandId, TodoId } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../../../../mcp/McpInvocationContext.ts";
import { OrchestrationEngineService } from "../../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { TodoPlanningToolkit } from "./tools.ts";

const handlers = {
  finalize_todo_plan: Effect.fn("TodoPlanningToolkit.finalizeTodoPlan")(function* (proposal) {
    const invocation = yield* McpInvocationContext.McpInvocationContext;
    const snapshots = yield* ProjectionSnapshotQuery;
    const engine = yield* OrchestrationEngineService;
    const crypto = yield* Crypto.Crypto;
    const readModel = yield* snapshots.getCommandReadModel();
    const todo = (readModel.todos ?? []).find(
      (candidate) => candidate.planningThreadId === invocation.threadId,
    );
    if (todo === undefined) {
      return yield* Effect.fail("This thread is not linked to an active to-do planning session.");
    }
    if (todo.plannedAt !== null) {
      return yield* Effect.fail("This to-do planning session has already been finalized.");
    }
    if (proposal.subtasks.length === 0) {
      return yield* Effect.fail("A finalized plan must contain at least one sub-task.");
    }
    const commandId = CommandId.make(yield* crypto.randomUUIDv4.pipe(Effect.orDie));
    const createdAt = DateTime.formatIso(yield* DateTime.now);
    const subtasks = yield* Effect.forEach(proposal.subtasks, (subtask) =>
      crypto.randomUUIDv4.pipe(
        Effect.orDie,
        Effect.map((id) => ({ ...subtask, todoId: TodoId.make(id) })),
      ),
    );
    yield* engine.dispatch({
      type: "todo.plan.apply",
      commandId,
      todoId: todo.id,
      planningThreadId: invocation.threadId,
      proposal,
      subtasks,
      createdAt,
    });
    return { todoId: todo.id, subtaskCount: subtasks.length };
  }, Effect.mapError((error) => error instanceof Error ? error.message : String(error))),
} satisfies Parameters<typeof TodoPlanningToolkit.toLayer>[0];

export const TodoPlanningToolkitHandlersLive = TodoPlanningToolkit.toLayer(handlers);
