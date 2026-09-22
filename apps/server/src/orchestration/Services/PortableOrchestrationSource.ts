import type {
  OrchestrationGetSnapshotError,
  OrchestrationShellStreamItem,
  OrchestrationSubscribeShellInput,
  OrchestrationSubscribeThreadInput,
  OrchestrationThreadStreamItem,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";

export interface PortableOrchestrationSourceShape {
  readonly subscribeShell: (
    input: OrchestrationSubscribeShellInput,
  ) => Effect.Effect<
    Stream.Stream<OrchestrationShellStreamItem, OrchestrationGetSnapshotError>,
    OrchestrationGetSnapshotError,
    Scope.Scope
  >;
  readonly subscribeThread: (
    input: OrchestrationSubscribeThreadInput,
  ) => Effect.Effect<
    Stream.Stream<OrchestrationThreadStreamItem, OrchestrationGetSnapshotError>,
    OrchestrationGetSnapshotError,
    Scope.Scope
  >;
}

export class PortableOrchestrationSource extends Context.Service<
  PortableOrchestrationSource,
  PortableOrchestrationSourceShape
>()("t3/orchestration/Services/PortableOrchestrationSource") {}
