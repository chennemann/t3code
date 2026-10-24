import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * The v0.1.0 fork recorded its to-do migration as core migration 63 and widened
 * the application event index to include to-do events. Upstream owns migration
 * 63 since v0.1.2 and names that index in its queries, so a database written by
 * that fork would skip upstream migrations 63–67 and plan its event reads on the
 * wrong predicate. This releases the ID and restores upstream's index before the
 * migrator reads the ledger. The fork's to-do tables, the recency column, and the
 * `todo` events stay in place: upstream reads only project and thread events.
 */
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
