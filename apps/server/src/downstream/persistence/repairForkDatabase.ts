import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// The v0.1.0 fork occupied core migration 63 and widened upstream's event index.
// Release that ID and restore the index before upstream reads the migration ledger.
// Legacy tables, columns and todo events remain intact; upstream ignores them.
export const repairForkDatabase = Effect.fn("DownstreamLegacy.repairForkDatabase")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const ledger = yield* sql<{ readonly name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
  `;
  if (ledger.length === 0) return;
  const forkMigration = yield* sql<{ readonly migration_id: number }>`
    SELECT migration_id FROM effect_sql_migrations
    WHERE migration_id = 63 AND name = 'WorkPlanningV2'
  `;
  if (forkMigration.length === 0) return;

  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`
        DELETE FROM effect_sql_migrations WHERE migration_id = 63 AND name = 'WorkPlanningV2'
      `;
      yield* sql`DROP INDEX IF EXISTS idx_orchestration_events_application_high_water`;
      yield* sql`
        CREATE INDEX idx_orchestration_events_application_high_water
        ON orchestration_events(sequence)
        WHERE aggregate_kind = 'project'
          OR (application_event_version = 2 AND aggregate_kind = 'thread')
      `;
    }),
  );
  yield* Effect.logInfo("released the v0.1.0 fork's migration 63 to upstream");
});
