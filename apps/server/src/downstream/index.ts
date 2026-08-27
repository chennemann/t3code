import * as Layer from "effect/Layer";

import { McpServer } from "effect/unstable/ai";
import { layer as dataLayerLive } from "./Data.ts";
import { startup as downstreamStartup } from "./Runtime.ts";
import { environmentClientHttpApiLayer, orchestrationSseRouteLayer } from "./Routes.ts";
import { TodoPlanningToolkitHandlersLive } from "./features/workPlanning/mcp/handlers.ts";
import { TodoPlanningToolkit } from "./features/workPlanning/mcp/tools.ts";

/** Data owned by downstream features and consumed through upstream hook points. */
export const dataLayer = dataLayerLive;

/** Long-lived startup and background behavior contributed by downstream features. */
export const startup = downstreamStartup;

/** HTTP/SSE/WS routes contributed by downstream features. */
export const routeLayer = orchestrationSseRouteLayer;

/** Typed HTTP API groups contributed by downstream features. */
export const httpApiLayer = environmentClientHttpApiLayer;

/** MCP toolkits contributed without feature imports in the upstream MCP module. */
export const mcpRegistrationLayer = McpServer.toolkit(TodoPlanningToolkit).pipe(
  Layer.provide(TodoPlanningToolkitHandlersLive),
);

export { prepareCoreDatabase } from "./persistence/prepareCoreDatabase.ts";
