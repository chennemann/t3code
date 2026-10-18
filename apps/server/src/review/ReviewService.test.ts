// @effect-diagnostics-next-line nodeBuiltinImport:off -- Windows directory junctions do not require symlink privileges.
import * as NodeFSP from "node:fs/promises";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Path from "effect/Path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { ReviewDiffFileContentsResult, VcsDriverKind } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import { ProjectId } from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import type * as VcsDriver from "../vcs/VcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as ReviewService from "./ReviewService.ts";

const TEST_EPOCH = DateTime.makeUnsafe("1970-01-01T00:00:00.000Z");

function makeDriver(
  kind: VcsDriverKind,
  overrides: Partial<VcsDriver.VcsDriver["Service"]>,
): VcsDriver.VcsDriver["Service"] {
  return {
    capabilities: {
      kind,
      supportsWorktrees: kind === "git",
      supportsBookmarks: kind === "jj",
      supportsAtomicSnapshot: kind === "jj",
      supportsPushDefaultRemote: kind === "git",
      ignoreClassifier: "git-compatible-fallback",
    },
    execute: () => Effect.die("unexpected driver execute"),
    detectRepository: () => Effect.die("unexpected driver detectRepository"),
    isInsideWorkTree: () => Effect.die("unexpected driver isInsideWorkTree"),
    listWorkspaceFiles: () => Effect.die("unexpected driver listWorkspaceFiles"),
    listRemotes: () => Effect.die("unexpected driver listRemotes"),
    filterIgnoredPaths: (_cwd, relativePaths) => Effect.succeed(relativePaths),
    initRepository: () => Effect.die("unexpected driver initRepository"),
    ...overrides,
  };
}

function layer(input: {
  readonly workspaceRoot: string;
  readonly baseDir: string;
  readonly detectCalls?: Array<{ readonly cwd: string }>;
  readonly worktreesDirectory?: string;
  readonly previousWorktreesDirectories?: ReadonlyArray<string>;
  readonly projectRoots?: ReadonlyArray<string> | "unavailable";
  readonly handle?: {
    readonly kind: VcsDriverKind;
    readonly driver: VcsDriver.VcsDriver["Service"];
  };
  readonly gitFileContents?: Effect.Effect<ReviewDiffFileContentsResult>;
}) {
  const projectRoots = input.projectRoots ?? [];
  const handle = input.handle;
  const gitFileContents = input.gitFileContents;
  return ReviewService.layer.pipe(
    Layer.provide(
      Layer.mock(ProjectStore.ProjectStoreV2)({
        listShells: () =>
          projectRoots === "unavailable"
            ? Effect.fail(
                new ProjectStore.ProjectStoreV2Error({ operation: "list", cause: "offline" }),
              )
            : Effect.succeed(
                projectRoots.map((workspaceRoot, index) => ({
                  id: ProjectId.make(`project-${index}`),
                  title: `Project ${index}`,
                  workspaceRoot,
                  defaultModelSelection: null,
                  scripts: [],
                  createdAt: "2026-01-01T00:00:00.000Z",
                  updatedAt: "2026-01-01T00:00:00.000Z",
                })),
              ),
      }),
    ),
    Layer.provide(
      Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
        get: () => Effect.die("unexpected VCS registry get"),
        resolve: () => Effect.die("unexpected VCS registry resolve"),
        detect: (request) =>
          Effect.sync(() => {
            input.detectCalls?.push({ cwd: request.cwd });
            return handle
              ? ({
                  kind: handle.kind,
                  repository: {
                    kind: handle.kind,
                    rootPath: request.cwd,
                    metadataPath: null,
                    freshness: {
                      source: "live-local",
                      observedAt: TEST_EPOCH,
                      expiresAt: Option.none(),
                    },
                  },
                  driver: handle.driver,
                } satisfies VcsDriverRegistry.VcsDriverHandle)
              : null;
          }),
      }),
    ),
    Layer.provide(
      Layer.mock(GitVcsDriver.GitVcsDriver)(
        gitFileContents ? { getReviewDiffFileContents: () => gitFileContents } : {},
      ),
    ),
    Layer.provide(
      ServerSettings.ServerSettingsService.layerTest({
        worktreesDirectory: input.worktreesDirectory ?? "",
        previousWorktreesDirectories: [...(input.previousWorktreesDirectories ?? [])],
      }),
    ),
    Layer.provide(ServerConfig.layerTest(input.workspaceRoot, input.baseDir)),
    Layer.provideMerge(NodeServices.layer),
  );
}

describe("ReviewService", () => {
  it.effect("rejects diff preview cwd outside the configured workspace roots", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-workspace-" });
      const outsideRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-outside-" });
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-base-" });
      const detectCalls: Array<{ readonly cwd: string }> = [];

      const error = yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;
        return yield* review.getDiffPreview({ cwd: outsideRoot }).pipe(Effect.flip);
      }).pipe(Effect.provide(layer({ workspaceRoot, baseDir, detectCalls })));

      assert.strictEqual(error._tag, "VcsRepositoryDetectionError");
      assert.strictEqual(error.operation, "ReviewService.getDiffPreview");
      assert.match(
        "detail" in error ? error.detail : "",
        /must stay within the configured workspace root/,
      );
      assert.deepStrictEqual(detectCalls, []);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("attributes file-content workspace violations to the file-content operation", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-workspace-" });
      const outsideRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-outside-" });
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-base-" });
      const detectCalls: Array<{ readonly cwd: string }> = [];

      const error = yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;
        return yield* review
          .getDiffFileContents({
            cwd: outsideRoot,
            sourceKind: "working-tree",
            changeType: "change",
            baseRef: "HEAD",
            headRef: null,
            oldPath: "file.ts",
            newPath: "file.ts",
          })
          .pipe(Effect.flip);
      }).pipe(Effect.provide(layer({ workspaceRoot, baseDir, detectCalls })));

      assert.strictEqual(error._tag, "VcsRepositoryDetectionError");
      assert.strictEqual(error.operation, "ReviewService.getDiffFileContents");
      assert.match(
        "detail" in error ? error.detail : "",
        /must stay within the configured workspace root/,
      );
      assert.deepStrictEqual(detectCalls, []);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("allows previous custom worktree locations but never a filesystem root", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-workspace-" });
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-base-" });
      const previous = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-old-worktrees-" });
      const outsideRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-outside-" });

      const result = yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;
        return yield* review.getDiffPreview({ cwd: previous });
      }).pipe(
        Effect.provide(
          layer({
            workspaceRoot,
            baseDir,
            worktreesDirectory: "/",
            previousWorktreesDirectories: [previous],
          }),
        ),
      );
      assert.strictEqual(result.cwd, previous);

      const rootLink = `${baseDir}/root-link`;
      const platform = yield* HostProcess.Platform;
      const path = yield* Path.Path;
      yield* Effect.promise(() =>
        NodeFSP.symlink(
          path.parse(baseDir).root,
          rootLink,
          platform === "win32" ? "junction" : "dir",
        ),
      );
      for (const worktreesDirectory of ["/", rootLink]) {
        const error = yield* Effect.gen(function* () {
          const review = yield* ReviewService.ReviewService;
          return yield* review.getDiffPreview({ cwd: outsideRoot }).pipe(Effect.flip);
        }).pipe(Effect.provide(layer({ workspaceRoot, baseDir, worktreesDirectory })));
        assert.strictEqual(error._tag, "VcsRepositoryDetectionError");
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("allows registered project roots outside the server cwd", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-workspace-" });
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-base-" });
      // Stands in for a project on another drive than the server's home cwd.
      const projectRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-project-" });
      const projectChild = `${projectRoot}/packages/app`;
      yield* fs.makeDirectory(projectChild, { recursive: true });
      const sibling = `${projectRoot}-sibling`;
      yield* fs.makeDirectory(sibling);
      yield* Effect.addFinalizer(() => fs.remove(sibling, { recursive: true }).pipe(Effect.ignore));

      const review = (cwd: string, projectRoots: ReadonlyArray<string> | "unavailable") =>
        Effect.gen(function* () {
          const service = yield* ReviewService.ReviewService;
          return yield* service.getDiffPreview({ cwd });
        }).pipe(Effect.provide(layer({ workspaceRoot, baseDir, projectRoots })));

      assert.strictEqual((yield* review(projectRoot, [projectRoot])).cwd, projectRoot);
      assert.strictEqual((yield* review(projectChild, [projectRoot])).cwd, projectChild);
      for (const [cwd, projectRoots] of [
        [sibling, [projectRoot]],
        [projectRoot, []],
        [projectRoot, "unavailable"],
      ] as const) {
        const error = yield* review(cwd, projectRoots).pipe(Effect.flip);
        assert.strictEqual(error._tag, "VcsRepositoryDetectionError");
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("allows diff preview cwd inside the configured workspace root", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-workspace-" });
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-base-" });
      const detectCalls: Array<{ readonly cwd: string }> = [];

      const result = yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;
        return yield* review.getDiffPreview({ cwd: workspaceRoot });
      }).pipe(Effect.provide(layer({ workspaceRoot, baseDir, detectCalls })));

      assert.strictEqual(result.cwd, workspaceRoot);
      assert.deepStrictEqual(result.sources, []);
      assert.deepStrictEqual(detectCalls, [{ cwd: workspaceRoot }]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("preserves unexpected path-resolution failures", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-workspace-" });
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-base-" });
      const invalidCwd = `${workspaceRoot}\0invalid`;
      const detectCalls: Array<{ readonly cwd: string }> = [];

      const error = yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;
        return yield* review.getDiffPreview({ cwd: invalidCwd }).pipe(Effect.flip);
      }).pipe(Effect.provide(layer({ workspaceRoot, baseDir, detectCalls })));

      assert.strictEqual(error._tag, "VcsRepositoryDetectionError");
      if (error._tag !== "VcsRepositoryDetectionError") return;
      assert.strictEqual(error.operation, "ReviewService.assertWorkspaceBoundCwd.canonicalizePath");
      assert.strictEqual(error.cwd, invalidCwd);
      assert.match(error.detail, /Failed to resolve a path/);
      assert.instanceOf(error.cause, PlatformError.PlatformError);
      assert.deepStrictEqual(detectCalls, []);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect.each([
    {
      name: "expands unchanged lines through a driver that implements it",
      kind: "jj" as const,
      driverContents: { oldContents: "from the driver\n", newContents: "driver\n" },
      gitContents: null,
      expected: { oldContents: "from the driver\n", newContents: "driver\n" },
    },
    {
      name: "still reaches the Git implementation when the driver has no expansion",
      kind: "git" as const,
      driverContents: null,
      gitContents: { oldContents: "from git\n", newContents: "git\n" },
      expected: { oldContents: "from git\n", newContents: "git\n" },
    },
    {
      name: "refuses expansion when neither the driver nor Git can serve it",
      kind: "jj" as const,
      driverContents: null,
      gitContents: null,
      expected: null,
    },
  ])("$name", (scenario) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-workspace-" });
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-base-" });
      const driver = makeDriver(
        scenario.kind,
        scenario.driverContents === null
          ? {}
          : { getDiffFileContents: () => Effect.succeed(scenario.driverContents) },
      );

      const run = Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;
        return yield* review.getDiffFileContents({
          cwd: workspaceRoot,
          sourceKind: "working-tree",
          changeType: "change",
          baseRef: "@-",
          headRef: "@",
          oldPath: "file.ts",
          newPath: "file.ts",
        });
      }).pipe(
        Effect.provide(
          layer({
            workspaceRoot,
            baseDir,
            handle: { kind: scenario.kind, driver },
            gitFileContents:
              scenario.gitContents === null
                ? Effect.die("unexpected Git review diff file contents")
                : Effect.succeed(scenario.gitContents),
          }),
        ),
      );

      if (scenario.expected === null) {
        const error = yield* Effect.flip(run);
        assert.strictEqual(error._tag, "VcsUnsupportedOperationError");
        assert.strictEqual(
          "detail" in error ? error.detail : "",
          "Unchanged diff expansion is not available for this version control system.",
        );
        return;
      }
      assert.deepStrictEqual(yield* run, scenario.expected);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
