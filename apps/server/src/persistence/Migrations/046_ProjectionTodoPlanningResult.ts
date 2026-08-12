import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE projection_todos ADD COLUMN context TEXT NOT NULL DEFAULT ''`;
  yield* sql`ALTER TABLE projection_todos ADD COLUMN glossary TEXT NOT NULL DEFAULT ''`;
  yield* sql`ALTER TABLE projection_todos ADD COLUMN plan TEXT NOT NULL DEFAULT ''`;
  yield* sql`ALTER TABLE projection_todos ADD COLUMN planned_at TEXT`;
});
