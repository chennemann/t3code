import { CommandId, WORKSPACE_PROJECT_ID } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { ServerConfig } from "../config.ts";
import * as ProjectService from "../project/ProjectService.ts";

export const ensureManagedWorkspace = Effect.fn("DownstreamRuntime.ensureManagedWorkspace")(
  function* () {
    const config = yield* ServerConfig;
    const projects = yield* ProjectService.ProjectService;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const crypto = yield* Crypto.Crypto;
    const workspaceRoot = path.join(config.baseDir, "workspace");
    yield* fs.makeDirectory(workspaceRoot, { recursive: true });
    const existing = yield* projects.getById(WORKSPACE_PROJECT_ID);
    const commandId = CommandId.make(yield* crypto.randomUUIDv4());
    if (Option.isNone(existing)) {
      yield* projects.create({
        commandId,
        projectId: WORKSPACE_PROJECT_ID,
        title: "Workspace",
        workspaceRoot,
      });
    } else if (existing.value.title !== "Workspace") {
      yield* projects.update({ commandId, projectId: WORKSPACE_PROJECT_ID, title: "Workspace" });
    }
  },
);
export const startup = ensureManagedWorkspace();
