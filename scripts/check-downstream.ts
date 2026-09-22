import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

const IntegrationPolicy = Schema.Struct({
  baseCommit: Schema.optionalKey(Schema.String),
  ownedDirectories: Schema.Array(Schema.String),
  ownedFiles: Schema.Array(Schema.String),
  upstreamFiles: Schema.Array(Schema.String),
});

/** New edits outside these integration points require an explicit policy review. */
export function unexpectedIntegrationFiles(
  paths: ReadonlyArray<string>,
  policy: typeof IntegrationPolicy.Type,
) {
  const files = new Set([...policy.ownedFiles, ...policy.upstreamFiles]);
  return paths
    .map((path) => path.replaceAll("\\", "/"))
    .filter(
      (path) =>
        !files.has(path) && !policy.ownedDirectories.some((dir) => path.startsWith(`${dir}/`)),
    );
}

class UnreviewedIntegrationError extends Schema.TaggedError<UnreviewedIntegrationError>()(
  "UnreviewedIntegrationError",
  { paths: Schema.Array(Schema.String) },
) {
  override get message() {
    return `Unreviewed upstream integration points:\n${this.paths.join("\n")}`;
  }
}

class IntegrationCommandError extends Schema.TaggedError<IntegrationCommandError>()(
  "IntegrationCommandError",
  { exitCode: Schema.Number },
) {}

if (import.meta.main) {
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const policy = yield* fs
      .readFileString(".github/downstream-integration.json")
      .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(IntegrationPolicy))));
    const state = yield* fs
      .readFileString(".github/upstream-release.json")
      .pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(
            Schema.fromJsonString(Schema.Struct({ commit: Schema.String })),
          ),
        ),
      );
    const base = process.argv[2] ?? policy.baseCommit ?? state.commit;
    const jj = yield* fs.exists(".jj");
    const command = ChildProcess.make(
      jj ? "jj" : "git",
      jj
        ? ["diff", "--from", base, "--to", "@", "--name-only"]
        : ["diff", "--name-only", "--no-renames", base, "--"],
      { stderr: "inherit" },
    );
    const processHandle = yield* spawner.spawn(command);
    const { output, exitCode } = yield* Effect.all(
      {
        output: processHandle.stdout.pipe(Stream.decodeText(), Stream.mkString),
        exitCode: processHandle.exitCode,
      },
      { concurrency: "unbounded" },
    );
    if (exitCode !== 0) return yield* new IntegrationCommandError({ exitCode });
    const paths = output.trim().split(/\r?\n/).filter(Boolean);
    const unexpected = unexpectedIntegrationFiles(paths, policy);
    if (unexpected.length > 0) return yield* new UnreviewedIntegrationError({ paths: unexpected });
    yield* Console.log(`Downstream integration policy passed (${paths.length} changed files).`);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
