import {
  IsoDateTime,
  type OrchestrationEvent,
  type OrchestrationTodo,
  ProjectId,
  ThreadId,
  TodoId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  toPersistenceDecodeError,
  toPersistenceSqlError,
  type ProjectionRepositoryError,
} from "../../../persistence/Errors.ts";
import { DownstreamDatabase } from "../../persistence/Database.ts";

const TodoRow = Schema.Struct({
  id: TodoId,
  title: Schema.String,
  summary: Schema.String,
  specificationSummary: Schema.String,
  contextSummary: Schema.String,
  glossarySummary: Schema.String,
  planSummary: Schema.String,
  specification: Schema.String,
  context: Schema.String,
  glossary: Schema.String,
  plan: Schema.String,
  notes: Schema.String,
  projectId: Schema.NullOr(ProjectId),
  parentTodoId: Schema.NullOr(TodoId),
  planningThreadId: Schema.NullOr(ThreadId),
  plannedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

const LegacyTodoRow = Schema.Struct({
  todo_id: TodoId,
  title: Schema.String,
  summary: Schema.optional(Schema.String),
  specification_summary: Schema.optional(Schema.String),
  context_summary: Schema.optional(Schema.String),
  glossary_summary: Schema.optional(Schema.String),
  plan_summary: Schema.optional(Schema.String),
  specification: Schema.optional(Schema.String),
  context: Schema.optional(Schema.String),
  glossary: Schema.optional(Schema.String),
  plan: Schema.optional(Schema.String),
  notes: Schema.optional(Schema.String),
  project_id: Schema.optional(Schema.NullOr(ProjectId)),
  parent_todo_id: Schema.optional(Schema.NullOr(TodoId)),
  planning_thread_id: Schema.optional(Schema.NullOr(ThreadId)),
  planned_at: Schema.optional(Schema.NullOr(IsoDateTime)),
  completed_at: Schema.optional(Schema.NullOr(IsoDateTime)),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});
const decodeLegacyTodoRow = Schema.decodeUnknownEffect(LegacyTodoRow);

export interface WorkPlanningStoreShape {
  readonly list: Effect.Effect<ReadonlyArray<OrchestrationTodo>, ProjectionRepositoryError>;
  readonly applyEvent: (
    event: OrchestrationEvent,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class WorkPlanningStore extends Context.Service<WorkPlanningStore, WorkPlanningStoreShape>()(
  "t3/downstream/features/workPlanning/Store/WorkPlanningStore",
) {}

const make = Effect.gen(function* () {
  const coreSql = yield* SqlClient.SqlClient;
  const { sql } = yield* DownstreamDatabase;

  const listRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: TodoRow,
    execute: () => sql`
      SELECT
        todo_id AS id,
        title,
        summary,
        specification_summary AS "specificationSummary",
        context_summary AS "contextSummary",
        glossary_summary AS "glossarySummary",
        plan_summary AS "planSummary",
        specification,
        context,
        glossary,
        plan,
        notes,
        project_id AS "projectId",
        parent_todo_id AS "parentTodoId",
        planning_thread_id AS "planningThreadId",
        planned_at AS "plannedAt",
        completed_at AS "completedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM work_planning_todos
      ORDER BY created_at ASC, todo_id ASC
    `,
  });

  const insert = Effect.fn("WorkPlanningStore.insert")(function* (todo: OrchestrationTodo) {
    yield* sql`
      INSERT INTO work_planning_todos (
        todo_id, title, summary, specification_summary, context_summary,
        glossary_summary, plan_summary, specification, context, glossary,
        plan, notes, project_id, parent_todo_id, planning_thread_id,
        planned_at, completed_at, created_at, updated_at
      ) VALUES (
        ${todo.id}, ${todo.title}, ${todo.summary}, ${todo.specificationSummary},
        ${todo.contextSummary}, ${todo.glossarySummary}, ${todo.planSummary},
        ${todo.specification}, ${todo.context}, ${todo.glossary}, ${todo.plan},
        ${todo.notes}, ${todo.projectId}, ${todo.parentTodoId},
        ${todo.planningThreadId}, ${todo.plannedAt}, ${todo.completedAt},
        ${todo.createdAt}, ${todo.updatedAt}
      )
      ON CONFLICT (todo_id) DO UPDATE SET
        title = excluded.title,
        summary = excluded.summary,
        specification_summary = excluded.specification_summary,
        context_summary = excluded.context_summary,
        glossary_summary = excluded.glossary_summary,
        plan_summary = excluded.plan_summary,
        specification = excluded.specification,
        context = excluded.context,
        glossary = excluded.glossary,
        plan = excluded.plan,
        notes = excluded.notes,
        project_id = excluded.project_id,
        parent_todo_id = excluded.parent_todo_id,
        planning_thread_id = excluded.planning_thread_id,
        planned_at = excluded.planned_at,
        completed_at = excluded.completed_at,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `;
  });

  const importLegacyTodos = Effect.fn("WorkPlanningStore.importLegacyTodos")(function* () {
    const imported = yield* sql<{ readonly value: string }>`
      SELECT value FROM downstream_metadata WHERE key = 'legacy-work-planning-imported'
    `;
    if (imported.length > 0) return;

    const legacyTable = yield* coreSql<{ readonly name: string }>`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projection_todos'
    `;
    if (legacyTable.length === 0) {
      yield* sql`
        INSERT INTO downstream_metadata (key, value)
        VALUES ('legacy-work-planning-imported', 'no-legacy-table')
      `;
      return;
    }

    const legacyRows = yield* coreSql<Record<string, unknown>>`SELECT * FROM projection_todos`;
    const decodedRows = yield* Effect.forEach(legacyRows, (row) => decodeLegacyTodoRow(row));

    yield* sql.withTransaction(
      Effect.gen(function* () {
        for (const row of decodedRows) {
          yield* insert({
            id: row.todo_id,
            title: row.title,
            summary: row.summary ?? "",
            specificationSummary: row.specification_summary ?? "",
            contextSummary: row.context_summary ?? "",
            glossarySummary: row.glossary_summary ?? "",
            planSummary: row.plan_summary ?? "",
            specification: row.specification ?? "",
            context: row.context ?? "",
            glossary: row.glossary ?? "",
            plan: row.plan ?? "",
            notes: row.notes ?? "",
            projectId: row.project_id ?? null,
            parentTodoId: row.parent_todo_id ?? null,
            planningThreadId: row.planning_thread_id ?? null,
            plannedAt: row.planned_at ?? null,
            completedAt: row.completed_at ?? null,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          });
        }
        yield* sql`
          INSERT INTO downstream_metadata (key, value)
          VALUES ('legacy-work-planning-imported', ${String(decodedRows.length)})
        `;
      }),
    );
  });

  yield* importLegacyTodos().pipe(
    Effect.mapError((cause) =>
      Schema.isSchemaError(cause)
        ? toPersistenceDecodeError("WorkPlanningStore.importLegacyTodos:decode")(cause)
        : toPersistenceSqlError("WorkPlanningStore.importLegacyTodos:query")(cause),
    ),
  );

  const list = listRows(undefined).pipe(
    Effect.mapError((cause) =>
      Schema.isSchemaError(cause)
        ? toPersistenceDecodeError("WorkPlanningStore.list:decode")(cause)
        : toPersistenceSqlError("WorkPlanningStore.list:query")(cause),
    ),
  );

  const applyEvent: WorkPlanningStoreShape["applyEvent"] = Effect.fn(
    "WorkPlanningStore.applyEvent",
  )(
    function* (event) {
      switch (event.type) {
        case "todo.created":
          yield* insert({
            id: event.payload.todoId,
            title: event.payload.title,
            summary: event.payload.summary,
            specificationSummary: event.payload.specificationSummary,
            contextSummary: event.payload.contextSummary,
            glossarySummary: event.payload.glossarySummary,
            planSummary: event.payload.planSummary,
            specification: event.payload.specification,
            context: event.payload.context,
            glossary: event.payload.glossary,
            plan: event.payload.plan,
            notes: event.payload.notes,
            projectId: event.payload.projectId,
            parentTodoId: event.payload.parentTodoId,
            planningThreadId: event.payload.planningThreadId,
            plannedAt: event.payload.plannedAt,
            completedAt: null,
            createdAt: event.payload.createdAt,
            updatedAt: event.payload.updatedAt,
          });
          return;
        case "todo.updated":
          yield* sql`
          UPDATE work_planning_todos SET
            title = COALESCE(${event.payload.title ?? null}, title),
            summary = COALESCE(${event.payload.summary ?? null}, summary),
            specification_summary = COALESCE(${event.payload.specificationSummary ?? null}, specification_summary),
            context_summary = COALESCE(${event.payload.contextSummary ?? null}, context_summary),
            glossary_summary = COALESCE(${event.payload.glossarySummary ?? null}, glossary_summary),
            plan_summary = COALESCE(${event.payload.planSummary ?? null}, plan_summary),
            specification = COALESCE(${event.payload.specification ?? null}, specification),
            context = COALESCE(${event.payload.context ?? null}, context),
            glossary = COALESCE(${event.payload.glossary ?? null}, glossary),
            plan = COALESCE(${event.payload.plan ?? null}, plan),
            notes = COALESCE(${event.payload.notes ?? null}, notes),
            project_id = CASE WHEN ${event.payload.projectId !== undefined ? 1 : 0} = 1
              THEN ${event.payload.projectId ?? null} ELSE project_id END,
            parent_todo_id = CASE WHEN ${event.payload.parentTodoId !== undefined ? 1 : 0} = 1
              THEN ${event.payload.parentTodoId ?? null} ELSE parent_todo_id END,
            planning_thread_id = CASE WHEN ${event.payload.planningThreadId !== undefined ? 1 : 0} = 1
              THEN ${event.payload.planningThreadId ?? null} ELSE planning_thread_id END,
            planned_at = CASE WHEN ${event.payload.plannedAt !== undefined ? 1 : 0} = 1
              THEN ${event.payload.plannedAt ?? null} ELSE planned_at END,
            completed_at = CASE WHEN ${event.payload.completedAt !== undefined ? 1 : 0} = 1
              THEN ${event.payload.completedAt ?? null} ELSE completed_at END,
            updated_at = ${event.payload.updatedAt}
          WHERE todo_id = ${event.payload.todoId}
        `;
          return;
        case "todo.deleted":
          yield* sql`DELETE FROM work_planning_todos WHERE todo_id = ${event.payload.todoId}`;
          return;
        default:
          return;
      }
    },
    Effect.mapError(toPersistenceSqlError("WorkPlanningStore.applyEvent:query")),
  );

  return WorkPlanningStore.of({ list, applyEvent });
});

export const layer = Layer.effect(WorkPlanningStore, make);
