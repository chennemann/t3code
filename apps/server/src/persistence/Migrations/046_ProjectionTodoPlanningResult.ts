import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_todos)`;
    const columnNames = new Set(columns.map((column) => column.name));
    if (!columnNames.has("context")) {
        yield* sql`ALTER TABLE projection_todos ADD COLUMN context TEXT NOT NULL DEFAULT ''`;
    }
    if (!columnNames.has("glossary")) {
        yield* sql`ALTER TABLE projection_todos ADD COLUMN glossary TEXT NOT NULL DEFAULT ''`;
    }
    if (!columnNames.has("plan")) {
        yield* sql`ALTER TABLE projection_todos ADD COLUMN plan TEXT NOT NULL DEFAULT ''`;
    }
    if (!columnNames.has("planned_at")) {
        yield* sql`ALTER TABLE projection_todos ADD COLUMN planned_at TEXT`;
    }
});
