import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_todos)`;
    const columnNames = new Set(columns.map((column) => column.name));
    if (!columnNames.has("specification")) {
        yield* sql`ALTER TABLE projection_todos ADD COLUMN specification TEXT NOT NULL DEFAULT ''`;
    }
    if (!columnNames.has("parent_todo_id")) {
        yield* sql`ALTER TABLE projection_todos ADD COLUMN parent_todo_id TEXT`;
    }
    if (!columnNames.has("planning_thread_id")) {
        yield* sql`ALTER TABLE projection_todos ADD COLUMN planning_thread_id TEXT`;
    }
    yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_todos_parent
    ON projection_todos(parent_todo_id, completed_at, updated_at)
  `;
});
