import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { MigrationError } from "effect/unstable/sql/Migrator";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { ServerConfig } from "../../config.ts";
import { runMigrations } from "./Migrations.ts";

export class DownstreamDatabase extends Context.Service<
  DownstreamDatabase,
  { readonly sql: SqlClient.SqlClient }
>()("t3/downstream/persistence/Database/DownstreamDatabase") {}

type RuntimeSqliteLayerConfig = {
  readonly filename: string;
  readonly spanAttributes?: Record<string, unknown>;
};

type Loader = {
  readonly layer: (config: RuntimeSqliteLayerConfig) => Layer.Layer<SqlClient.SqlClient, SqlError>;
};

const loaders = {
  bun: () => import("@effect/sql-sqlite-bun/SqliteClient"),
  node: () => import("../../persistence/NodeSqliteClient.ts"),
} satisfies Record<string, () => Promise<Loader>>;

const makeClientLayer = Effect.fn("DownstreamDatabase.makeClientLayer")(function* (
  config: RuntimeSqliteLayerConfig,
) {
  const runtime = process.versions.bun === undefined ? "node" : "bun";
  const clientModule = yield* Effect.promise<Loader>(loaders[runtime]);
  return clientModule.layer(config);
}, Layer.unwrap);

const databaseLayer = Layer.effect(
  DownstreamDatabase,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA busy_timeout = 5000;`;
    yield* sql`PRAGMA foreign_keys = ON;`;
    yield* sql`PRAGMA journal_mode = WAL;`;
    yield* runMigrations;
    return DownstreamDatabase.of({ sql });
  }),
);

export function makeLayer(
  dbPath: string,
): Layer.Layer<DownstreamDatabase, SqlError | MigrationError> {
  const normalized = dbPath.replaceAll("\\", "/");
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1);

  return databaseLayer.pipe(
    Layer.provide(
      makeClientLayer({
        filename: dbPath,
        spanAttributes: {
          "db.name": basename,
          "service.name": "t3-downstream",
        },
      }),
    ),
  );
}

export const layer: Layer.Layer<
  DownstreamDatabase,
  SqlError | MigrationError,
  ServerConfig
> = Layer.unwrap(
  Effect.gen(function* () {
    const { dbPath } = yield* ServerConfig;
    if (dbPath === ":memory:") return memoryLayer;
    const normalized = dbPath.replaceAll("\\", "/");
    const separator = normalized.lastIndexOf("/");
    const directory = separator === -1 ? "." : normalized.slice(0, separator);
    return makeLayer(`${directory}/downstream.sqlite`);
  }),
);

export const memoryLayer: Layer.Layer<DownstreamDatabase, SqlError | MigrationError> =
  databaseLayer.pipe(Layer.provide(makeClientLayer({ filename: ":memory:" })));
