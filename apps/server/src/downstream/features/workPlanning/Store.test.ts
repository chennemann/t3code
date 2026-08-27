import { TodoId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "../../../persistence/NodeSqliteClient.ts";
import { memoryLayer as downstreamDatabaseMemory } from "../../persistence/Database.ts";
import { WorkPlanningStore, layer as storeLayer } from "./Store.ts";

const coreLayer = Layer.effect(
  SqlClient.SqlClient,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
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
      INSERT INTO projection_todos (
        todo_id, title, notes, project_id, completed_at, created_at, updated_at
      ) VALUES (
        'todo-legacy', 'Legacy', 'Keep me', NULL, NULL,
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      )
    `;
    return sql;
  }),
).pipe(Layer.provide(NodeSqliteClient.layerMemory()));
const testLayer = storeLayer.pipe(
  Layer.provide(downstreamDatabaseMemory),
  Layer.provideMerge(coreLayer),
);

const layer = it.layer(testLayer);

layer("WorkPlanningStore", (it) => {
  it.effect("imports the legacy projection once", () =>
    Effect.gen(function* () {
      const todos = yield* WorkPlanningStore.pipe(Effect.flatMap((store) => store.list));
      assert.strictEqual(todos[0]?.id, TodoId.make("todo-legacy"));
      assert.strictEqual(todos[0]?.notes, "Keep me");
    }),
  );
});
