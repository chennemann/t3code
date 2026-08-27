import {
  TodoId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationShellSnapshot,
  type OrchestrationShellStreamEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { ProjectionRepositoryError } from "../persistence/Errors.ts";
import { decideWorkPlanningCommand } from "./features/workPlanning/decider.ts";
import { projectWorkPlanningEvent } from "./features/workPlanning/projector.ts";

export const aggregateIdSchema = TodoId;

export type DownstreamCommand = Extract<OrchestrationCommand, { readonly type: `todo.${string}` }>;

export function isDownstreamCommand(command: OrchestrationCommand): command is DownstreamCommand {
  return command.type.startsWith("todo.");
}

export function commandAggregateRef(command: OrchestrationCommand): {
  readonly aggregateKind: OrchestrationEvent["aggregateKind"];
  readonly aggregateId: OrchestrationEvent["aggregateId"];
} | null {
  return isDownstreamCommand(command)
    ? { aggregateKind: "todo", aggregateId: command.todoId }
    : null;
}

export function beforeProjectDelete(
  command: Extract<OrchestrationCommand, { readonly type: "project.delete" }>,
  readModel: OrchestrationReadModel,
): ReadonlyArray<OrchestrationCommand> {
  return (readModel.todos ?? [])
    .filter((todo) => todo.projectId === command.projectId)
    .map((todo) => ({
      type: "todo.update" as const,
      commandId: command.commandId,
      todoId: todo.id,
      projectId: null,
    }));
}

export function turnStartPayload(
  command: Extract<OrchestrationCommand, { readonly type: "thread.turn.start" }>,
) {
  return command.agentInstructions === undefined
    ? {}
    : { agentInstructions: command.agentInstructions };
}

export function decideDownstreamCommand(input: {
  readonly command: DownstreamCommand;
  readonly readModel: OrchestrationReadModel;
}) {
  return decideWorkPlanningCommand(input);
}

export function projectDownstreamEvent(model: OrchestrationReadModel, event: OrchestrationEvent) {
  return projectWorkPlanningEvent(model, event);
}

export function projectShellStreamEvent(
  event: OrchestrationEvent,
  getSnapshot: Effect.Effect<OrchestrationShellSnapshot, ProjectionRepositoryError>,
): Effect.Effect<Option.Option<OrchestrationShellStreamEvent>, never> | null {
  switch (event.type) {
    case "todo.deleted":
      return Effect.succeed(
        Option.some({
          kind: "todo-removed" as const,
          sequence: event.sequence,
          todoId: event.payload.todoId,
        }),
      );
    case "todo.created":
    case "todo.updated":
      return getSnapshot.pipe(
        Effect.retry({ times: 1 }),
        Effect.map((snapshot) => {
          const todo = snapshot.todos?.find(
            (candidate) => candidate.id === event.payload.todoId,
          );
          return todo === undefined
            ? Option.none<OrchestrationShellStreamEvent>()
            : Option.some<OrchestrationShellStreamEvent>({
                kind: "todo-upserted",
                sequence: event.sequence,
                todo,
              });
        }),
        Effect.orElseSucceed(() => Option.none()),
      );
    default:
      return null;
  }
}
