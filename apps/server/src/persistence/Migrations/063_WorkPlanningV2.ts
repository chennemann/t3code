import { prepareThreadRecency } from "../../downstream/persistence/prepareThreadRecency.ts";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import initializeTables from "../../downstream/persistence/Migrations/001_Initial.ts";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* initializeTables;
  yield* prepareThreadRecency;
  yield* sql`DROP INDEX idx_orchestration_events_application_high_water`;
  yield* sql`CREATE INDEX idx_orchestration_events_application_high_water ON orchestration_events(sequence)
    WHERE aggregate_kind IN ('project', 'todo') OR (application_event_version = 2 AND aggregate_kind = 'thread')`;
});
