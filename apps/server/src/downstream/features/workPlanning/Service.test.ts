import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { CommandId, ThreadId, TodoId, type TodoPlanningProposal } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Sqlite from "../../../persistence/Sqlite.ts";
import * as Events from "../../../persistence/OrchestrationEventStore.ts";
import * as Receipts from "../../../persistence/OrchestrationCommandReceipts.ts";
import * as Projects from "../../../orchestration-v2/ProjectStore.ts";
import * as Database from "../../persistence/Database.ts";
import * as Store from "./Store.ts";
import * as Service from "./Service.ts";

const layer = Service.layer.pipe(
  Layer.provideMerge(Store.layer.pipe(Layer.provide(Database.memoryLayer))),
  Layer.provideMerge(Events.layer),
  Layer.provide(Receipts.layer),
  Layer.provide(Projects.layer),
  Layer.provide(Sqlite.layerMemory),
  Layer.provide(NodeServices.layer),
);
const now = "2026-10-18T12:00:00.000Z";
const proposal: TodoPlanningProposal = {
  summary: "Build it",
  specificationSummary: "Spec",
  contextSummary: "Context",
  glossarySummary: "Terms",
  planSummary: "Steps",
  specification: "Specification",
  context: "Context details",
  glossary: "Glossary",
  plan: "Implementation plan",
  subtasks: [
    {
      title: "Child",
      summary: "Child outcome",
      specificationSummary: "Child spec",
      contextSummary: "",
      specification: "Details",
      context: "",
    },
  ],
};
it.layer(layer)("WorkPlanningService V2", (it) => {
  it.effect(
    "commits plans and child todos together, replays events, and deduplicates commands",
    () =>
      Effect.gen(function* () {
        const service = yield* Service.WorkPlanningService;
        const store = yield* Store.WorkPlanningStore;
        const events = yield* Events.OrchestrationEventStore;
        const todoId = TodoId.make("planning-parent");
        const planningThreadId = ThreadId.make("planner");
        yield* service.dispatch({
          type: "todo.create",
          commandId: CommandId.make("create-parent"),
          todoId,
          title: "Parent",
          planningThreadId,
          createdAt: now,
        });
        const command = {
          type: "todo.plan.apply" as const,
          commandId: CommandId.make("apply-plan"),
          todoId,
          planningThreadId,
          proposal,
          subtasks: [{ ...proposal.subtasks[0]!, todoId: TodoId.make("child") }],
          createdAt: now,
        };
        const first = yield* service.dispatch(command);
        const retry = yield* service.dispatch(command);
        assert.deepEqual(first, retry);
        const todos = yield* store.list;
        assert.equal(todos.length, 2);
        assert.equal(todos.find((todo) => todo.id === todoId)?.plannedAt, now);
        assert.equal(todos.find((todo) => todo.id === "child")?.parentTodoId, todoId);
        const replay = yield* events
          .readApplicationEvents({ afterSequence: 0, throughSequence: first.sequence })
          .pipe(Stream.runCollect);
        assert.deepEqual(
          replay.map((event) => ("type" in event ? event.type : event.event.type)),
          ["todo.created", "todo.updated", "todo.created"],
        );
        const secondPlan = yield* service
          .dispatch({ ...command, commandId: CommandId.make("second-plan") })
          .pipe(Effect.result);
        assert.equal(secondPlan._tag, "Failure");
        assert.equal((yield* store.list).length, 2);
      }),
  );
  it.effect("rolls back parent edits when a subtask cannot be created", () =>
    Effect.gen(function* () {
      const service = yield* Service.WorkPlanningService;
      const store = yield* Store.WorkPlanningStore;
      const todoId = TodoId.make("rollback-parent");
      const planningThreadId = ThreadId.make("rollback-planner");
      yield* service.dispatch({
        type: "todo.create",
        commandId: CommandId.make("rollback-create"),
        todoId,
        title: "Parent",
        planningThreadId,
        createdAt: now,
      });
      const result = yield* service
        .dispatch({
          type: "todo.plan.apply",
          commandId: CommandId.make("rollback-plan"),
          todoId,
          planningThreadId,
          proposal,
          subtasks: [{ ...proposal.subtasks[0]!, todoId }],
          createdAt: now,
        })
        .pipe(Effect.result);
      assert.equal(result._tag, "Failure");
      assert.equal((yield* store.list).find((todo) => todo.id === todoId)?.plannedAt, null);
    }),
  );
});
