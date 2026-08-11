import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("041_ProjectionTodos", (it) => {
  it.effect("creates the environment-wide todo projection", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 41 });
      const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_todos)`;
      assert.deepEqual(
        columns.map((column) => column.name),
        ["todo_id", "title", "notes", "project_id", "completed_at", "created_at", "updated_at"],
      );
    }),
  );
});
