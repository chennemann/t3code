import {
  EventId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";

import { OrchestrationCommandInvariantError } from "../../../orchestration/Errors.ts";
import { requireProject } from "../../../orchestration/commandInvariants.ts";
import { projectWorkPlanningEvent } from "./projector.ts";

type PlannedEvent = Omit<OrchestrationEvent, "sequence">;
type Decision = PlannedEvent | ReadonlyArray<PlannedEvent>;

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const withEventBase = Effect.fn("WorkPlanningDecider.withEventBase")(function* (input: {
  readonly aggregateId: OrchestrationEvent["aggregateId"];
  readonly occurredAt: string;
  readonly commandId: OrchestrationCommand["commandId"];
}) {
  const crypto = yield* Crypto.Crypto;
  const eventId = yield* crypto.randomUUIDv4;
  return {
    eventId: EventId.make(eventId),
    aggregateKind: "todo" as const,
    aggregateId: input.aggregateId,
    occurredAt: input.occurredAt,
    commandId: input.commandId,
    causationEventId: null,
    correlationId: input.commandId,
    metadata: {},
  };
});

type WorkPlanningCommand = Extract<OrchestrationCommand, { readonly type: `todo.${string}` }>;

const decideSequence = Effect.fn("WorkPlanningDecider.decideSequence")(function* (input: {
  readonly commands: ReadonlyArray<WorkPlanningCommand>;
  readonly readModel: OrchestrationReadModel;
}) {
  let readModel = input.readModel;
  let sequence = readModel.snapshotSequence;
  const events: PlannedEvent[] = [];

  for (const command of input.commands) {
    const decision = decideWorkPlanningCommand({ command, readModel });
    if (decision === null) {
      return yield* new OrchestrationCommandInvariantError({
        commandType: command.type,
        detail: `Unsupported work-planning command '${command.type}'.`,
      });
    }
    const decided = yield* decision;
    const nextEvents = Array.isArray(decided) ? decided : [decided];
    for (const event of nextEvents) {
      events.push(event);
      sequence += 1;
      const projection = projectWorkPlanningEvent(readModel, { ...event, sequence });
      if (projection !== null) readModel = yield* projection.pipe(Effect.orDie);
    }
  }
  return events;
});

export function decideWorkPlanningCommand(input: {
  readonly command: OrchestrationCommand;
  readonly readModel: OrchestrationReadModel;
}): Effect.Effect<
  Decision,
  OrchestrationCommandInvariantError | PlatformError.PlatformError,
  Crypto.Crypto
> | null {
  const { command, readModel } = input;
  switch (command.type) {
    case "todo.create":
      return Effect.gen(function* () {
        if ((readModel.todos ?? []).some((todo) => todo.id === command.todoId)) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Todo '${command.todoId}' already exists.`,
          });
        }
        if (command.projectId != null) {
          yield* requireProject({ readModel, command, projectId: command.projectId });
        }
        return {
          ...(yield* withEventBase({
            aggregateId: command.todoId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          })),
          type: "todo.created" as const,
          payload: {
            todoId: command.todoId,
            title: command.title,
            summary: command.summary ?? "",
            specificationSummary: command.specificationSummary ?? "",
            contextSummary: command.contextSummary ?? "",
            glossarySummary: command.glossarySummary ?? "",
            planSummary: command.planSummary ?? "",
            specification: command.specification ?? "",
            context: command.context ?? "",
            glossary: command.glossary ?? "",
            plan: command.plan ?? "",
            notes: command.notes ?? "",
            projectId: command.projectId ?? null,
            parentTodoId: command.parentTodoId ?? null,
            planningThreadId: command.planningThreadId ?? null,
            plannedAt: null,
            createdAt: command.createdAt,
            updatedAt: command.createdAt,
          },
        };
      });
    case "todo.update":
      return Effect.gen(function* () {
        const todo = (readModel.todos ?? []).find((candidate) => candidate.id === command.todoId);
        if (todo === undefined) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Todo '${command.todoId}' does not exist.`,
          });
        }
        if (command.projectId != null) {
          yield* requireProject({ readModel, command, projectId: command.projectId });
        }
        const occurredAt = yield* nowIso;
        return {
          ...(yield* withEventBase({
            aggregateId: command.todoId,
            occurredAt,
            commandId: command.commandId,
          })),
          type: "todo.updated" as const,
          payload: {
            todoId: command.todoId,
            ...(command.title !== undefined ? { title: command.title } : {}),
            ...(command.summary !== undefined ? { summary: command.summary } : {}),
            ...(command.specificationSummary !== undefined
              ? { specificationSummary: command.specificationSummary }
              : {}),
            ...(command.contextSummary !== undefined
              ? { contextSummary: command.contextSummary }
              : {}),
            ...(command.glossarySummary !== undefined
              ? { glossarySummary: command.glossarySummary }
              : {}),
            ...(command.planSummary !== undefined ? { planSummary: command.planSummary } : {}),
            ...(command.specification !== undefined
              ? { specification: command.specification }
              : {}),
            ...(command.context !== undefined ? { context: command.context } : {}),
            ...(command.glossary !== undefined ? { glossary: command.glossary } : {}),
            ...(command.plan !== undefined ? { plan: command.plan } : {}),
            ...(command.notes !== undefined ? { notes: command.notes } : {}),
            ...(command.projectId !== undefined ? { projectId: command.projectId } : {}),
            ...(command.parentTodoId !== undefined ? { parentTodoId: command.parentTodoId } : {}),
            ...(command.planningThreadId !== undefined
              ? { planningThreadId: command.planningThreadId }
              : {}),
            ...(command.plannedAt !== undefined ? { plannedAt: command.plannedAt } : {}),
            ...(command.completed !== undefined
              ? { completedAt: command.completed ? occurredAt : null }
              : {}),
            updatedAt: occurredAt,
          },
        };
      });
    case "todo.plan.apply":
      return Effect.gen(function* () {
        const todo = (readModel.todos ?? []).find((candidate) => candidate.id === command.todoId);
        if (todo === undefined || todo.planningThreadId !== command.planningThreadId) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Thread '${command.planningThreadId}' is not the active planner for todo '${command.todoId}'.`,
          });
        }
        if (command.subtasks.length !== command.proposal.subtasks.length) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "Planning proposal and persisted subtask counts must match.",
          });
        }
        return yield* decideSequence({
          readModel,
          commands: [
            {
              type: "todo.update",
              commandId: command.commandId,
              todoId: command.todoId,
              summary: command.proposal.summary,
              specificationSummary: command.proposal.specificationSummary,
              contextSummary: command.proposal.contextSummary,
              glossarySummary: command.proposal.glossarySummary,
              planSummary: command.proposal.planSummary,
              specification: command.proposal.specification,
              context: command.proposal.context,
              glossary: command.proposal.glossary,
              plan: command.proposal.plan,
              plannedAt: command.createdAt,
            },
            ...command.subtasks.map((subtask) => ({
              type: "todo.create" as const,
              commandId: command.commandId,
              todoId: subtask.todoId,
              title: subtask.title,
              summary: subtask.summary,
              specificationSummary: subtask.specificationSummary,
              contextSummary: subtask.contextSummary,
              specification: subtask.specification,
              context: subtask.context,
              projectId: todo.projectId,
              parentTodoId: todo.id,
              createdAt: command.createdAt,
            })),
          ],
        });
      });
    case "todo.delete":
      return Effect.gen(function* () {
        if (!(readModel.todos ?? []).some((todo) => todo.id === command.todoId)) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `Todo '${command.todoId}' does not exist.`,
          });
        }
        const occurredAt = yield* nowIso;
        return {
          ...(yield* withEventBase({
            aggregateId: command.todoId,
            occurredAt,
            commandId: command.commandId,
          })),
          type: "todo.deleted" as const,
          payload: { todoId: command.todoId },
        };
      });
    default:
      return null;
  }
}
