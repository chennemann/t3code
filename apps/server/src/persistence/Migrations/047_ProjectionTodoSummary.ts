import * as Effect from "effect/Effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE projection_todos ADD COLUMN summary TEXT NOT NULL DEFAULT ''`;
});
