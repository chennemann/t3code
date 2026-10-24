import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "../../persistence/Migrations.ts";
import { repairForkDatabase } from "./repairForkDatabase.ts";

const indexSql = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly sql: string }>`
    SELECT sql FROM sqlite_master
    WHERE type = 'index' AND name = 'idx_orchestration_events_application_high_water'
  `;
  return rows[0]?.sql ?? "";
});

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))("repairForkDatabase", (it) => {
  it.effect("hands migration 63 back to upstream and restores its event index", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 62 });
      // What the v0.1.0 fork's WorkPlanningV2 migration left behind.
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (63, 'WorkPlanningV2')`;
      yield* sql`DROP INDEX idx_orchestration_events_application_high_water`;
      yield* sql`
        CREATE INDEX idx_orchestration_events_application_high_water ON orchestration_events(sequence)
        WHERE aggregate_kind IN ('project', 'todo') OR (application_event_version = 2 AND aggregate_kind = 'thread')
      `;

      yield* repairForkDatabase();
      yield* runMigrations();
      // A second start finds nothing left to repair.
      yield* repairForkDatabase();

      const migrations = yield* sql<{ readonly name: string }>`
        SELECT name FROM effect_sql_migrations WHERE migration_id = 63
      `;
      assert.deepEqual(migrations, [{ name: "DropUnusedV1Projections" }]);
      const index = yield* indexSql;
      assert.notInclude(index, "todo");
      assert.include(index, "aggregate_kind = 'project'");
    }),
  );
});
