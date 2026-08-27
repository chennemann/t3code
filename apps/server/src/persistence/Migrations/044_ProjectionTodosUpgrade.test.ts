import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("todo migration renumbering", (it) => {
    it.effect("upgrades databases created before the upstream migration renumbering", () =>
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
          updated_at TEXT NOT NULL,
          specification TEXT NOT NULL DEFAULT '',
          parent_todo_id TEXT,
          planning_thread_id TEXT,
          context TEXT NOT NULL DEFAULT '',
          glossary TEXT NOT NULL DEFAULT '',
          plan TEXT NOT NULL DEFAULT '',
          planned_at TEXT,
          summary TEXT NOT NULL DEFAULT '',
          specification_summary TEXT NOT NULL DEFAULT '',
          context_summary TEXT NOT NULL DEFAULT '',
          glossary_summary TEXT NOT NULL DEFAULT '',
          plan_summary TEXT NOT NULL DEFAULT ''
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

            yield* runMigrations();

            const authSessionColumns = yield* sql<{ readonly name: string }>`PRAGMA table_info(auth_sessions)`;
            const threadColumns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_threads)`;
            assert.includeMembers(
                authSessionColumns.map((column) => column.name),
                ["client_surface", "client_app_version"],
            );
            assert.includeMembers(
                threadColumns.map((column) => column.name),
                ["linked_pull_request_json", "unsettled_at"],
            );

            const migrations = yield* sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name
        FROM effect_sql_migrations
        WHERE migration_id >= 41
        ORDER BY migration_id
      `;
            assert.deepEqual(migrations, [
                { migration_id: 41, name: "ProjectionTodos" },
                { migration_id: 42, name: "ProjectionTodoPlanning" },
                { migration_id: 43, name: "ProjectionTodoPlanningResult" },
                { migration_id: 44, name: "ProjectionTodoSummary" },
                { migration_id: 45, name: "ProjectionTodoSectionSummaries" },
                { migration_id: 46, name: "ProjectionTodoPlanningResult" },
                { migration_id: 47, name: "ProjectionTodoSummary" },
                { migration_id: 48, name: "ProjectionTodoSectionSummaries" },
                { migration_id: 49, name: "BackfillRenumberedUpstreamMigrations" },
            ]);
        }),
    );
});
