import {
  TodoCreatedPayload,
  TodoDeletedPayload,
  TodoUpdatedPayload,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  toProjectorDecodeError,
  type OrchestrationProjectorDecodeError,
} from "../../../orchestration/Errors.ts";

const decode = <A>(
  schema: Schema.Decoder<A, never>,
  event: OrchestrationEvent,
): Effect.Effect<A, OrchestrationProjectorDecodeError> =>
  Schema.decodeUnknownEffect(schema)(event.payload).pipe(
    Effect.mapError(toProjectorDecodeError(`${event.type}:payload`)),
  );

export function projectWorkPlanningEvent(
  model: OrchestrationReadModel,
  event: OrchestrationEvent,
): Effect.Effect<OrchestrationReadModel, OrchestrationProjectorDecodeError> | null {
  switch (event.type) {
    case "todo.created":
      return decode(TodoCreatedPayload, event).pipe(
        Effect.map((payload) => ({
          ...model,
          todos: [
            ...(model.todos ?? []).filter((todo) => todo.id !== payload.todoId),
            {
              id: payload.todoId,
              title: payload.title,
              summary: payload.summary,
              specificationSummary: payload.specificationSummary,
              contextSummary: payload.contextSummary,
              glossarySummary: payload.glossarySummary,
              planSummary: payload.planSummary,
              specification: payload.specification,
              context: payload.context,
              glossary: payload.glossary,
              plan: payload.plan,
              notes: payload.notes,
              projectId: payload.projectId,
              parentTodoId: payload.parentTodoId,
              planningThreadId: payload.planningThreadId,
              plannedAt: payload.plannedAt,
              completedAt: null,
              createdAt: payload.createdAt,
              updatedAt: payload.updatedAt,
            },
          ],
        })),
      );
    case "todo.updated":
      return decode(TodoUpdatedPayload, event).pipe(
        Effect.map((payload) => ({
          ...model,
          todos: (model.todos ?? []).map((todo) =>
            todo.id === payload.todoId
              ? {
                  ...todo,
                  ...(payload.title !== undefined ? { title: payload.title } : {}),
                  ...(payload.summary !== undefined ? { summary: payload.summary } : {}),
                  ...(payload.specificationSummary !== undefined
                    ? { specificationSummary: payload.specificationSummary }
                    : {}),
                  ...(payload.contextSummary !== undefined
                    ? { contextSummary: payload.contextSummary }
                    : {}),
                  ...(payload.glossarySummary !== undefined
                    ? { glossarySummary: payload.glossarySummary }
                    : {}),
                  ...(payload.planSummary !== undefined
                    ? { planSummary: payload.planSummary }
                    : {}),
                  ...(payload.specification !== undefined
                    ? { specification: payload.specification }
                    : {}),
                  ...(payload.context !== undefined ? { context: payload.context } : {}),
                  ...(payload.glossary !== undefined ? { glossary: payload.glossary } : {}),
                  ...(payload.plan !== undefined ? { plan: payload.plan } : {}),
                  ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
                  ...(payload.projectId !== undefined ? { projectId: payload.projectId } : {}),
                  ...(payload.parentTodoId !== undefined
                    ? { parentTodoId: payload.parentTodoId }
                    : {}),
                  ...(payload.planningThreadId !== undefined
                    ? { planningThreadId: payload.planningThreadId }
                    : {}),
                  ...(payload.plannedAt !== undefined ? { plannedAt: payload.plannedAt } : {}),
                  ...(payload.completedAt !== undefined
                    ? { completedAt: payload.completedAt }
                    : {}),
                  updatedAt: payload.updatedAt,
                }
              : todo,
          ),
        })),
      );
    case "todo.deleted":
      return decode(TodoDeletedPayload, event).pipe(
        Effect.map((payload) => ({
          ...model,
          todos: (model.todos ?? []).filter((todo) => todo.id !== payload.todoId),
        })),
      );
    default:
      return null;
  }
}
