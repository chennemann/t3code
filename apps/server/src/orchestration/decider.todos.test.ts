import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { CommandId, ProjectId, TodoId, type OrchestrationEvent, type OrchestrationReadModel } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const NOW = "2026-08-11T12:00:00.000Z";
const sequenced = (result: unknown, sequence: number) => ({
  ...((Array.isArray(result) ? result[0] : result) as object), sequence,
}) as OrchestrationEvent;

it.layer(NodeServices.layer)("todo decider", (it) => {
  it.effect("creates, completes, reopens, and deletes an unassigned todo", () =>
    Effect.gen(function* () {
      const empty = createEmptyReadModel(NOW);
      const created = yield* decideOrchestrationCommand({
        readModel: empty,
        command: {
          type: "todo.create",
          commandId: CommandId.make("create-todo"),
          todoId: TodoId.make("todo-1"),
          title: "Add feature XY",
          notes: "Keep it small",
          projectId: null,
          createdAt: NOW,
        },
      });
      const createdEvent = sequenced(created, 1);
      expect(createdEvent.type).toBe("todo.created");

      const withTodo = yield* projectEvent(empty, createdEvent);
      expect(withTodo.todos?.[0]?.projectId).toBeNull();

      const completed = yield* decideOrchestrationCommand({
        readModel: withTodo,
        command: {
          type: "todo.update",
          commandId: CommandId.make("complete-todo"),
          todoId: TodoId.make("todo-1"),
          completed: true,
        },
      });
      const completedEvent = sequenced(completed, 2);
      if (completedEvent.type !== "todo.updated") return;
      expect(completedEvent.payload.completedAt).not.toBeNull();

      const completedModel = yield* projectEvent(withTodo, completedEvent);
      const reopened = yield* decideOrchestrationCommand({
        readModel: completedModel,
        command: {
          type: "todo.update",
          commandId: CommandId.make("reopen-todo"),
          todoId: TodoId.make("todo-1"),
          completed: false,
        },
      });
      const reopenedEvent = sequenced(reopened, 3);
      if (reopenedEvent.type !== "todo.updated") return;
      expect(reopenedEvent.payload.completedAt).toBeNull();

      const deleted = yield* decideOrchestrationCommand({
        readModel: completedModel,
        command: {
          type: "todo.delete",
          commandId: CommandId.make("delete-todo"),
          todoId: TodoId.make("todo-1"),
        },
      });
      const afterDelete = yield* projectEvent(completedModel, sequenced(deleted, 4));
      expect(afterDelete.todos).toEqual([]);
    }),
  );

  it.effect("rejects assigning a todo to an unknown project", () =>
    Effect.gen(function* () {
      const readModel: OrchestrationReadModel = {
        ...createEmptyReadModel(NOW),
        todos: [{
          id: TodoId.make("todo-1"), title: "Idea", notes: "", projectId: null,
          completedAt: null, createdAt: NOW, updatedAt: NOW,
        }],
      };
      const result = yield* Effect.result(decideOrchestrationCommand({
        readModel,
        command: {
          type: "todo.update",
          commandId: CommandId.make("assign-todo"),
          todoId: TodoId.make("todo-1"),
          projectId: ProjectId.make("missing"),
        },
      }));
      expect(result._tag).toBe("Failure");
    }),
  );
});
