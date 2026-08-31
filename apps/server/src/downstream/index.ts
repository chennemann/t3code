import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  environmentClientHttpApiLayer,
  makeOrchestrationSseRouteLayer,
} from "./Routes.ts";
import { make as makePortableOrchestrationSource } from "./orchestration/Subscriptions.ts";

export { layer as terminalShellPolicyLayer } from "./features/terminalShell/ShellPolicy.ts";

export const portableClientHttpApiLayer = environmentClientHttpApiLayer;
export const portableClientRouteLayer = Layer.unwrap(
  Effect.map(makePortableOrchestrationSource, makeOrchestrationSseRouteLayer),
);
