import * as Effect from "effect/Effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_todos)`;
    const columnNames = new Set(columns.map((column) => column.name));
    if (!columnNames.has("specification_summary")) {
        yield* sql`ALTER TABLE projection_todos ADD COLUMN specification_summary TEXT NOT NULL DEFAULT ''`;
    }
    if (!columnNames.has("context_summary")) {
        yield* sql`ALTER TABLE projection_todos ADD COLUMN context_summary TEXT NOT NULL DEFAULT ''`;
    }
    if (!columnNames.has("glossary_summary")) {
        yield* sql`ALTER TABLE projection_todos ADD COLUMN glossary_summary TEXT NOT NULL DEFAULT ''`;
    }
    if (!columnNames.has("plan_summary")) {
        yield* sql`ALTER TABLE projection_todos ADD COLUMN plan_summary TEXT NOT NULL DEFAULT ''`;
    }
});
