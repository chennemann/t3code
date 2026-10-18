import { TodoId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import {
  DownstreamDatabase,
  memoryLayer as downstreamDatabaseMemory,
} from "../../persistence/Database.ts";
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
).pipe(Layer.provide(NodeSqliteClient.layer({ filename: ":memory:" })));
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

it.effect.each([false, true])(
  "preserves edits and deletions from an already migrated sidecar (deleted=%s)",
  (deleted) => {
    const sidecar = Layer.effect(
      DownstreamDatabase,
      Effect.gen(function* () {
        const database = yield* DownstreamDatabase;
        yield* database.sql`INSERT INTO downstream_metadata (key, value) VALUES ('legacy-work-planning-imported', '1')`;
        if (!deleted)
          yield* database.sql`INSERT INTO work_planning_todos (todo_id, title, created_at, updated_at)
        VALUES ('todo-legacy', 'Revised after import', '2026-01-01T00:00:00.000Z', '2026-10-18T00:00:00.000Z')`;
        return database;
      }),
    ).pipe(Layer.provide(Layer.fresh(downstreamDatabaseMemory)));
    return Effect.gen(function* () {
      const store = yield* WorkPlanningStore;
      const todos = yield* store.list;
      assert.equal(todos.length, deleted ? 0 : 1);
      if (!deleted) assert.equal(todos[0]?.title, "Revised after import");
    }).pipe(
      Effect.provide(
        storeLayer.pipe(Layer.provide(sidecar), Layer.provide(Layer.fresh(coreLayer))),
      ),
    );
  },
);
