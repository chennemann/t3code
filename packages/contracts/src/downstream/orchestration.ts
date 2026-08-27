import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  CommandId,
  IsoDateTime,
  makeEntityId,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "../baseSchemas.ts";

export const TodoId = makeEntityId("TodoId");
export type TodoId = typeof TodoId.Type;

export const OrchestrationTodo = Schema.Struct({
  id: TodoId,
  title: TrimmedNonEmptyString,
  summary: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  specificationSummary: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  contextSummary: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  glossarySummary: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  planSummary: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  specification: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  context: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  glossary: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  plan: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  notes: TrimmedString,
  projectId: Schema.NullOr(ProjectId),
  parentTodoId: Schema.NullOr(TodoId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  planningThreadId: Schema.NullOr(ThreadId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  plannedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  completedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationTodo = typeof OrchestrationTodo.Type;

export const readModelFields = {
  todos: Schema.optional(Schema.Array(OrchestrationTodo)),
} as const;

export const shellStreamEventSchemas = [
  Schema.Struct({
    kind: Schema.Literal("todo-upserted"),
    sequence: NonNegativeInt,
    todo: OrchestrationTodo,
  }),
  Schema.Struct({
    kind: Schema.Literal("todo-removed"),
    sequence: NonNegativeInt,
    todoId: TodoId,
  }),
] as const;

const TodoCreateCommand = Schema.Struct({
  type: Schema.Literal("todo.create"),
  commandId: CommandId,
  todoId: TodoId,
  title: TrimmedNonEmptyString,
  summary: Schema.optional(TrimmedString),
  specificationSummary: Schema.optional(TrimmedString),
  contextSummary: Schema.optional(TrimmedString),
  glossarySummary: Schema.optional(TrimmedString),
  planSummary: Schema.optional(TrimmedString),
  specification: Schema.optional(TrimmedString),
  context: Schema.optional(TrimmedString),
  glossary: Schema.optional(TrimmedString),
  plan: Schema.optional(TrimmedString),
  notes: Schema.optional(TrimmedString),
  projectId: Schema.optional(Schema.NullOr(ProjectId)),
  parentTodoId: Schema.optional(Schema.NullOr(TodoId)),
  planningThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  createdAt: IsoDateTime,
});

const TodoUpdateCommand = Schema.Struct({
  type: Schema.Literal("todo.update"),
  commandId: CommandId,
  todoId: TodoId,
  title: Schema.optional(TrimmedNonEmptyString),
  summary: Schema.optional(TrimmedString),
  specificationSummary: Schema.optional(TrimmedString),
  contextSummary: Schema.optional(TrimmedString),
  glossarySummary: Schema.optional(TrimmedString),
  planSummary: Schema.optional(TrimmedString),
  specification: Schema.optional(TrimmedString),
  context: Schema.optional(TrimmedString),
  glossary: Schema.optional(TrimmedString),
  plan: Schema.optional(TrimmedString),
  notes: Schema.optional(TrimmedString),
  projectId: Schema.optional(Schema.NullOr(ProjectId)),
  parentTodoId: Schema.optional(Schema.NullOr(TodoId)),
  planningThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  plannedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  completed: Schema.optional(Schema.Boolean),
});

const TodoDeleteCommand = Schema.Struct({
  type: Schema.Literal("todo.delete"),
  commandId: CommandId,
  todoId: TodoId,
});

export const TodoPlanningSubtask = Schema.Struct({
  title: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  specificationSummary: TrimmedNonEmptyString,
  contextSummary: TrimmedString,
  specification: TrimmedString,
  context: TrimmedString,
});
export type TodoPlanningSubtask = typeof TodoPlanningSubtask.Type;

export const TodoPlanningProposal = Schema.Struct({
  summary: TrimmedNonEmptyString,
  specificationSummary: TrimmedNonEmptyString,
  contextSummary: TrimmedNonEmptyString,
  glossarySummary: TrimmedNonEmptyString,
  planSummary: TrimmedNonEmptyString,
  specification: TrimmedNonEmptyString,
  context: TrimmedString,
  glossary: TrimmedString,
  plan: TrimmedNonEmptyString,
  subtasks: Schema.Array(TodoPlanningSubtask),
});
export type TodoPlanningProposal = typeof TodoPlanningProposal.Type;

const TodoPlanApplyCommand = Schema.Struct({
  type: Schema.Literal("todo.plan.apply"),
  commandId: CommandId,
  todoId: TodoId,
  planningThreadId: ThreadId,
  proposal: TodoPlanningProposal,
  subtasks: Schema.Array(Schema.Struct({ todoId: TodoId, ...TodoPlanningSubtask.fields })),
  createdAt: IsoDateTime,
});

export const clientCommandSchemas = [TodoCreateCommand, TodoUpdateCommand, TodoDeleteCommand] as const;
export const internalCommandSchemas = [TodoPlanApplyCommand] as const;
export const commandFields = {
  agentInstructions: Schema.optional(TrimmedNonEmptyString),
} as const;

export const eventTypes = ["todo.created", "todo.updated", "todo.deleted"] as const;
export const aggregateKinds = ["todo"] as const;
export const aggregateIdSchemas = [TodoId] as const;

export const TodoCreatedPayload = Schema.Struct({
  todoId: TodoId,
  title: TrimmedNonEmptyString,
  summary: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  specificationSummary: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  contextSummary: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  glossarySummary: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  planSummary: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  specification: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  context: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  glossary: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  plan: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  notes: TrimmedString,
  projectId: Schema.NullOr(ProjectId),
  parentTodoId: Schema.NullOr(TodoId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  planningThreadId: Schema.NullOr(ThreadId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  plannedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const TodoUpdatedPayload = Schema.Struct({
  todoId: TodoId,
  title: Schema.optional(TrimmedNonEmptyString),
  summary: Schema.optional(TrimmedString),
  specificationSummary: Schema.optional(TrimmedString),
  contextSummary: Schema.optional(TrimmedString),
  glossarySummary: Schema.optional(TrimmedString),
  planSummary: Schema.optional(TrimmedString),
  specification: Schema.optional(TrimmedString),
  context: Schema.optional(TrimmedString),
  glossary: Schema.optional(TrimmedString),
  plan: Schema.optional(TrimmedString),
  notes: Schema.optional(TrimmedString),
  projectId: Schema.optional(Schema.NullOr(ProjectId)),
  parentTodoId: Schema.optional(Schema.NullOr(TodoId)),
  planningThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  plannedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  completedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  updatedAt: IsoDateTime,
});

export const TodoDeletedPayload = Schema.Struct({ todoId: TodoId });

export function eventSchemas<const Fields extends Schema.Struct.Fields>(baseFields: Fields) {
  return [
    Schema.Struct({
      ...baseFields,
      type: Schema.Literal("todo.created"),
      payload: TodoCreatedPayload,
    }),
    Schema.Struct({
      ...baseFields,
      type: Schema.Literal("todo.updated"),
      payload: TodoUpdatedPayload,
    }),
    Schema.Struct({
      ...baseFields,
      type: Schema.Literal("todo.deleted"),
      payload: TodoDeletedPayload,
    }),
  ] as const;
}
