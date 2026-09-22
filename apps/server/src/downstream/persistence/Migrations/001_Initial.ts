import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE downstream_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE work_planning_todos (
      todo_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      specification_summary TEXT NOT NULL DEFAULT '',
      context_summary TEXT NOT NULL DEFAULT '',
      glossary_summary TEXT NOT NULL DEFAULT '',
      plan_summary TEXT NOT NULL DEFAULT '',
      specification TEXT NOT NULL DEFAULT '',
      context TEXT NOT NULL DEFAULT '',
      glossary TEXT NOT NULL DEFAULT '',
      plan TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      project_id TEXT,
      parent_todo_id TEXT,
      planning_thread_id TEXT,
      planned_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX idx_work_planning_todos_project_completed
    ON work_planning_todos(project_id, completed_at, updated_at)
  `;

  yield* sql`
    CREATE INDEX idx_work_planning_todos_parent
    ON work_planning_todos(parent_todo_id, completed_at, updated_at)
  `;
});
