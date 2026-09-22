import {
  CommandId,
  DEFAULT_MODEL,
  ProjectId,
  ProviderInstanceId,
  WORKSPACE_PROJECT_ID,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { ServerConfig } from "../config.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";

export const ensureManagedWorkspace = Effect.fn("DownstreamRuntime.ensureManagedWorkspace")(
  function* () {
    const serverConfig = yield* ServerConfig;
    const snapshots = yield* ProjectionSnapshotQuery;
    const orchestration = yield* OrchestrationEngineService;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const crypto = yield* Crypto.Crypto;
    const existing = yield* snapshots.getProjectShellById(WORKSPACE_PROJECT_ID);

    if (Option.isSome(existing)) {
      if (existing.value.title !== "Workspace") {
        yield* orchestration.dispatch({
          type: "project.meta.update",
          commandId: CommandId.make(yield* crypto.randomUUIDv4),
          projectId: WORKSPACE_PROJECT_ID,
          title: "Workspace",
        });
      }
      return;
    }

    const workspaceRoot = path.join(serverConfig.baseDir, "workspace");
    yield* fs.makeDirectory(workspaceRoot, { recursive: true });
    yield* orchestration.dispatch({
      type: "project.create",
      commandId: CommandId.make(yield* crypto.randomUUIDv4),
      projectId: ProjectId.make(WORKSPACE_PROJECT_ID),
      title: "Workspace",
      workspaceRoot,
      defaultModelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: DEFAULT_MODEL,
      },
      createdAt: DateTime.formatIso(yield* DateTime.now),
    });
  },
);

export const startup = ensureManagedWorkspace();
