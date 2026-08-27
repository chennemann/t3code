import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { MigrationError } from "effect/unstable/sql/Migrator";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { ServerConfig } from "../config.ts";
import type { ProjectionRepositoryError } from "../persistence/Errors.ts";
import { DownstreamProjection, layer as projectionLayer } from "./Projection.ts";
import { layer as workPlanningStoreLayer } from "./features/workPlanning/Store.ts";
import { layer as databaseLayer } from "./persistence/Database.ts";

export const layer: Layer.Layer<
  DownstreamProjection,
  SqlError | MigrationError | ProjectionRepositoryError,
  SqlClient.SqlClient | ServerConfig
> = projectionLayer.pipe(
  Layer.provide(workPlanningStoreLayer),
  Layer.provide(databaseLayer),
);
