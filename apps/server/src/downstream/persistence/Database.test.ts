import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { DownstreamDatabase, memoryLayer } from "./Database.ts";

const layer = it.layer(memoryLayer);

layer("DownstreamDatabase", (it) => {
  it.effect("owns its migration ledger and work-planning schema", () =>
    Effect.gen(function* () {
      const { sql } = yield* DownstreamDatabase;
      const migrations = yield* sql<{
        readonly migration_id: number;
        readonly name: string;
      }>`SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id`;
      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(work_planning_todos)
      `;

      assert.deepEqual(migrations, [{ migration_id: 1, name: "Initial" }]);
      assert.includeMembers(
        columns.map((column) => column.name),
        ["todo_id", "title", "project_id", "parent_todo_id", "planning_thread_id", "completed_at"],
      );
    }),
  );
});
