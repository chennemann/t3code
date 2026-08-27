import * as Effect from "effect/Effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_todos)`;
    if (!columns.some((column) => column.name === "summary")) {
        yield* sql`ALTER TABLE projection_todos ADD COLUMN summary TEXT NOT NULL DEFAULT ''`;
    }
});
