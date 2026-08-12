import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { CommandId, ProjectId, ThreadId, TodoId, type OrchestrationEvent, type OrchestrationReadModel } from "@t3tools/contracts";
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
          id: TodoId.make("todo-1"), title: "Idea", summary: "", specificationSummary: "", contextSummary: "", glossarySummary: "", planSummary: "", specification: "", context: "", glossary: "", plan: "", notes: "", projectId: null, parentTodoId: null, planningThreadId: null, plannedAt: null,
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

  it.effect("atomically applies a structured plan and creates child todos", () =>
    Effect.gen(function* () {
      const planningThreadId = ThreadId.make("planning-thread");
      const readModel: OrchestrationReadModel = {
        ...createEmptyReadModel(NOW),
        todos: [{
          id: TodoId.make("parent"), title: "Plan me", summary: "", specificationSummary: "", contextSummary: "", glossarySummary: "", planSummary: "", specification: "", context: "",
          glossary: "", plan: "", notes: "", projectId: null, parentTodoId: null,
          planningThreadId, plannedAt: null, completedAt: null, createdAt: NOW, updatedAt: NOW,
        }],
      };
      const result = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "todo.plan.apply",
          commandId: CommandId.make("apply-plan"),
          todoId: TodoId.make("parent"),
          planningThreadId,
          proposal: {
            summary: "A shippable feature", specificationSummary: "Feature behavior", contextSummary: "Architecture context", glossarySummary: "Planner terminology", planSummary: "Build then verify", specification: "Ship the feature", context: "Existing architecture",
            glossary: "Planner: planning agent", plan: "Build and verify",
            subtasks: [{ title: "Build", summary: "The feature exists", specificationSummary: "Implementation details", contextSummary: "Contract context", specification: "Implement it", context: "Use the contract" }],
          },
          subtasks: [{ todoId: TodoId.make("child"), title: "Build", summary: "The feature exists", specificationSummary: "Implementation details", contextSummary: "Contract context", specification: "Implement it", context: "Use the contract" }],
          createdAt: NOW,
        },
      });
      const events = Array.isArray(result) ? result : [result];
      expect(events.map((event) => event.type)).toEqual(["todo.updated", "todo.created"]);
      let projected = readModel;
      for (let index = 0; index < events.length; index += 1) {
        projected = yield* projectEvent(projected, { ...events[index]!, sequence: index + 1 });
      }
      expect(projected.todos?.find((todo) => todo.id === TodoId.make("parent"))?.plannedAt).toBe(NOW);
      expect(projected.todos?.find((todo) => todo.id === TodoId.make("child"))?.parentTodoId).toBe(TodoId.make("parent"));
    }),
  );
});
