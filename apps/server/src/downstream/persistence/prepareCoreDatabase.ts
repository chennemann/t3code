import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const legacyMigrationNames = [
  "ProjectionTodos",
  "ProjectionTodoPlanning",
  "ProjectionTodoPlanningResult",
  "ProjectionTodoSummary",
  "ProjectionTodoSectionSummaries",
  "BackfillRenumberedUpstreamMigrations",
] as const;

const tableColumns = Effect.fn("DownstreamLegacy.tableColumns")(function* (table: string) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql.unsafe<{ readonly name: string }>(`PRAGMA table_info(${table})`);
  return new Set(rows.map((row) => row.name));
});

/**
 * Removes the historical downstream migration records before the upstream
 * migrator reads its ledger. Exact names, rather than numeric ranges, keep the
 * repair safe once upstream owns the same migration IDs.
 */
export const prepareCoreDatabase = Effect.fn("DownstreamLegacy.prepareCoreDatabase")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const migrationTable = yield* sql<{ readonly name: string }>`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'effect_sql_migrations'
    `;
  if (migrationTable.length === 0) return;

  const migrations = yield* sql<{
    readonly migration_id: number;
    readonly name: string;
  }>`SELECT migration_id, name FROM effect_sql_migrations`;
  if (!migrations.some((migration) => legacyMigrationNames.includes(migration.name as never))) {
    return;
  }

  const authColumns = yield* tableColumns("auth_sessions");
  const threadColumns = yield* tableColumns("projection_threads");

  yield* sql.withTransaction(
    Effect.gen(function* () {
      for (const name of legacyMigrationNames) {
        yield* sql`DELETE FROM effect_sql_migrations WHERE name = ${name}`;
      }

      if (authColumns.has("client_surface") && authColumns.has("client_app_version")) {
        yield* sql`
            INSERT OR IGNORE INTO effect_sql_migrations (migration_id, name)
            VALUES (41, 'AuthSessionClientConnection')
          `;
      }
      if (threadColumns.has("linked_pull_request_json")) {
        yield* sql`
            INSERT OR IGNORE INTO effect_sql_migrations (migration_id, name)
            VALUES (42, 'ProjectionThreadLinkedPullRequest')
          `;
      }
      if (threadColumns.has("unsettled_at")) {
        yield* sql`
            INSERT OR IGNORE INTO effect_sql_migrations (migration_id, name)
            VALUES (43, 'ProjectionThreadsUnsettledAt')
          `;
      }
    }),
  );

  yield* Effect.logInfo("detached legacy downstream migrations from the upstream ledger");
});
