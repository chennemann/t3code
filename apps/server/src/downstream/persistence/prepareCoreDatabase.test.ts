import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../../persistence/Migrations.ts";
import * as NodeSqliteClient from "../../persistence/NodeSqliteClient.ts";
import { prepareCoreDatabase } from "./prepareCoreDatabase.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("prepareCoreDatabase", (it) => {
  it.effect("releases historical downstream IDs back to upstream", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 40 });
      yield* sql`
        CREATE TABLE projection_todos (
          todo_id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          notes TEXT NOT NULL,
          project_id TEXT,
          completed_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES
          (41, 'ProjectionTodos'),
          (42, 'ProjectionTodoPlanning'),
          (43, 'ProjectionTodoPlanningResult'),
          (44, 'ProjectionTodoSummary'),
          (45, 'ProjectionTodoSectionSummaries')
      `;

      yield* prepareCoreDatabase();
      yield* runMigrations();

      const migrations = yield* sql<{
        readonly migration_id: number;
        readonly name: string;
      }>`
        SELECT migration_id, name FROM effect_sql_migrations
        WHERE migration_id >= 41 ORDER BY migration_id
      `;
      const authColumns = yield* sql<{ readonly name: string }>`PRAGMA table_info(auth_sessions)`;
      const threadColumns = yield* sql<{
        readonly name: string;
      }>`PRAGMA table_info(projection_threads)`;

      assert.deepEqual(migrations, [
        { migration_id: 41, name: "AuthSessionClientConnection" },
        { migration_id: 42, name: "ProjectionThreadLinkedPullRequest" },
        { migration_id: 43, name: "ProjectionThreadsUnsettledAt" },
        { migration_id: 44, name: "ProjectionThreadsRecencyAnchor" },
      ]);
      assert.includeMembers(
        authColumns.map((column) => column.name),
        ["client_surface", "client_app_version"],
      );
      assert.includeMembers(
        threadColumns.map((column) => column.name),
        ["linked_pull_request_json", "unsettled_at", "recency_anchor_at"],
      );
    }),
  );

  it.effect("preserves already-applied upstream migrations while removing the repair marker", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (49, 'BackfillRenumberedUpstreamMigrations')
      `;

      yield* prepareCoreDatabase();

      const migrations = yield* sql<{
        readonly migration_id: number;
        readonly name: string;
      }>`
        SELECT migration_id, name FROM effect_sql_migrations
        WHERE migration_id >= 41 ORDER BY migration_id
      `;
      assert.deepEqual(migrations, [
        { migration_id: 41, name: "AuthSessionClientConnection" },
        { migration_id: 42, name: "ProjectionThreadLinkedPullRequest" },
        { migration_id: 43, name: "ProjectionThreadsUnsettledAt" },
        { migration_id: 44, name: "ProjectionThreadsRecencyAnchor" },
      ]);
    }),
  );
});
