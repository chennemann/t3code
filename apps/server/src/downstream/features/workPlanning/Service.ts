import {
  type TodoCommand,
  type ApplicationTodoEvent,
  OrchestrationDispatchCommandError,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as OrchestrationEventStore from "../../../persistence/OrchestrationEventStore.ts";
import * as Receipts from "../../../persistence/OrchestrationCommandReceipts.ts";
import * as ProjectStore from "../../../orchestration-v2/ProjectStore.ts";
import * as Store from "./Store.ts";
import { decideWorkPlanningCommand } from "./decider.ts";

export class WorkPlanningService extends Context.Service<
  WorkPlanningService,
  {
    readonly dispatch: (
      command: TodoCommand,
    ) => Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError>;
  }
>()("t3/downstream/features/workPlanning/Service/WorkPlanningService") {}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const sql = yield* SqlClient.SqlClient;
  const store = yield* Store.WorkPlanningStore;
  const events = yield* OrchestrationEventStore.OrchestrationEventStore;
  const receipts = yield* Receipts.OrchestrationCommandReceiptRepository;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const lock = yield* Semaphore.make(1);
  const dispatch = Effect.fn("WorkPlanningService.dispatch")(
    function* (command: TodoCommand) {
      const result = yield* sql.withTransaction(
        Effect.gen(function* () {
          const existing = yield* receipts.getByCommandId({ commandId: command.commandId });
          if (Option.isSome(existing)) {
            if (
              existing.value.aggregateKind !== "todo" ||
              existing.value.aggregateId !== command.todoId ||
              existing.value.commandType !== command.type
            )
              return yield* Effect.fail(
                new OrchestrationDispatchCommandError({
                  message: "Command id belongs to another operation.",
                }),
              );
            return {
              sequence: existing.value.resultSequence,
              committed: [] as ApplicationTodoEvent[],
            };
          }
          const decision = decideWorkPlanningCommand({
            command,
            readModel: {
              snapshotSequence: yield* events.latestApplicationSequence,
              todos: yield* store.list,
              projects: (yield* projects.list()).map((project) => ({ id: project.projectId })),
            },
          });
          if (decision === null)
            return yield* Effect.fail(
              new OrchestrationDispatchCommandError({ message: "Unknown planning command." }),
            );
          const planned = yield* decision;
          const committed: ApplicationTodoEvent[] = [];
          for (const event of Array.isArray(planned) ? planned : [planned]) {
            const stored = yield* events.appendTodoEvent(event);
            yield* store.applyEvent(stored);
            committed.push(stored);
          }
          const sequence = committed.at(-1)!.sequence;
          yield* receipts.upsert({
            commandId: command.commandId,
            aggregateKind: "todo",
            aggregateId: command.todoId,
            commandType: command.type,
            acceptedAt: DateTime.formatIso(yield* DateTime.now),
            resultSequence: sequence,
            status: "accepted",
            error: null,
          });
          return { sequence, committed };
        }),
      );
      yield* events.publishCommitted(result.committed);
      return { sequence: result.sequence };
    },
    Effect.provideService(Crypto.Crypto, crypto),
    lock.withPermit,
    Effect.uninterruptible,
    Effect.mapError(
      (cause) =>
        new OrchestrationDispatchCommandError({
          message: cause instanceof Error ? cause.message : "Planning command failed.",
          cause,
        }),
    ),
  );
  return WorkPlanningService.of({ dispatch });
});
export const layer = Layer.effect(WorkPlanningService, make);
