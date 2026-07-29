#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";

import { releasePackageFiles } from "./update-release-package-versions.ts";

const numericIdentifier = String.raw`(?:0|[1-9]\d*)`;
const upstreamTagPattern = new RegExp(
  String.raw`^v${numericIdentifier}\.${numericIdentifier}\.${numericIdentifier}$`,
);
const downstreamVersionPattern = new RegExp(
  String.raw`^${numericIdentifier}\.${numericIdentifier}\.${numericIdentifier}-fork\.[1-9]\d*$`,
);

export const UpstreamRepository = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
);
export const UpstreamReleaseTag = Schema.String.check(Schema.isPattern(upstreamTagPattern));
export const UpstreamReleaseCommit = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/));
export const DownstreamReleaseVersion = Schema.String.check(
  Schema.isPattern(downstreamVersionPattern),
);

export const UpstreamReleaseState = Schema.Struct({
  repository: UpstreamRepository,
  tag: UpstreamReleaseTag,
  commit: UpstreamReleaseCommit,
  downstreamVersion: DownstreamReleaseVersion,
});
export type UpstreamReleaseState = typeof UpstreamReleaseState.Type;

const UpstreamReleaseStateJson = fromJsonStringPretty(UpstreamReleaseState);
const PackageManifest = Schema.Struct({
  version: Schema.String,
});
const PackageManifestJson = Schema.fromJsonString(PackageManifest);

export class InvalidUpstreamReleaseTagError extends Schema.TaggedErrorClass<InvalidUpstreamReleaseTagError>()(
  "InvalidUpstreamReleaseTagError",
  {
    tag: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Invalid stable upstream release tag '${this.tag}'. Expected vX.Y.Z.`;
  }
}

export class InvalidDownstreamReleaseVersionError extends Schema.TaggedErrorClass<InvalidDownstreamReleaseVersionError>()(
  "InvalidDownstreamReleaseVersionError",
  {
    version: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Invalid downstream release version '${this.version}'. Expected X.Y.Z-fork.N.`;
  }
}

export class DownstreamReleaseStateValidationError extends Schema.TaggedErrorClass<DownstreamReleaseStateValidationError>()(
  "DownstreamReleaseStateValidationError",
  {
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Invalid downstream upstream-release state.";
  }
}

export class DownstreamReleaseStateBaseMismatchError extends Schema.TaggedErrorClass<DownstreamReleaseStateBaseMismatchError>()(
  "DownstreamReleaseStateBaseMismatchError",
  {
    tag: Schema.String,
    downstreamVersion: Schema.String,
  },
) {
  override get message(): string {
    return `Downstream version '${this.downstreamVersion}' is not based on upstream tag '${this.tag}'.`;
  }
}

export class DownstreamReleaseStateFileError extends Schema.TaggedErrorClass<DownstreamReleaseStateFileError>()(
  "DownstreamReleaseStateFileError",
  {
    operation: Schema.Literals(["read", "write"]),
    filePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} downstream release state at '${this.filePath}'.`;
  }
}

export class UpstreamReleaseTagMovedError extends Schema.TaggedErrorClass<UpstreamReleaseTagMovedError>()(
  "UpstreamReleaseTagMovedError",
  {
    tag: Schema.String,
    recordedCommit: Schema.String,
    resolvedCommit: Schema.String,
  },
) {
  override get message(): string {
    return `Upstream tag '${this.tag}' moved from ${this.recordedCommit} to ${this.resolvedCommit}.`;
  }
}

export class UpstreamRepositoryMismatchError extends Schema.TaggedErrorClass<UpstreamRepositoryMismatchError>()(
  "UpstreamRepositoryMismatchError",
  {
    recordedRepository: Schema.String,
    resolvedRepository: Schema.String,
  },
) {
  override get message(): string {
    return `Configured upstream repository '${this.resolvedRepository}' does not match recorded repository '${this.recordedRepository}'.`;
  }
}

export class UpstreamReleaseNotNewerError extends Schema.TaggedErrorClass<UpstreamReleaseNotNewerError>()(
  "UpstreamReleaseNotNewerError",
  {
    recordedTag: Schema.String,
    resolvedTag: Schema.String,
  },
) {
  override get message(): string {
    return `Resolved upstream tag '${this.resolvedTag}' is not newer than recorded tag '${this.recordedTag}'.`;
  }
}

export class DownstreamReleaseVersionMismatchError extends Schema.TaggedErrorClass<DownstreamReleaseVersionMismatchError>()(
  "DownstreamReleaseVersionMismatchError",
  {
    expectedVersion: Schema.String,
    actualVersion: Schema.String,
    source: Schema.String,
  },
) {
  override get message(): string {
    return `Expected downstream version '${this.expectedVersion}', but ${this.source} contains '${this.actualVersion}'.`;
  }
}

export class DownstreamReleaseVersionResolutionError extends Schema.TaggedErrorClass<DownstreamReleaseVersionResolutionError>()(
  "DownstreamReleaseVersionResolutionError",
  {
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Could not resolve the fork release version: ${this.detail}`;
  }
}

export class DownstreamReleaseManifestError extends Schema.TaggedErrorClass<DownstreamReleaseManifestError>()(
  "DownstreamReleaseManifestError",
  {
    operation: Schema.Literals(["read", "decode"]),
    filePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} release package manifest '${this.filePath}'.`;
  }
}

export class DownstreamReleaseGitHubOutputError extends Schema.TaggedErrorClass<DownstreamReleaseGitHubOutputError>()(
  "DownstreamReleaseGitHubOutputError",
  {
    operation: Schema.Literals(["resolve", "write"]),
    filePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} downstream release GitHub output${this.filePath ? ` at '${this.filePath}'` : ""}.`;
  }
}

const decodeUpstreamReleaseTagSchema = Schema.decodeUnknownEffect(UpstreamReleaseTag);
const decodeDownstreamReleaseVersionSchema = Schema.decodeUnknownEffect(DownstreamReleaseVersion);
const decodeUpstreamReleaseStateJson = Schema.decodeEffect(UpstreamReleaseStateJson);
const decodeUpstreamReleaseStateSchema = Schema.decodeUnknownEffect(UpstreamReleaseState);
const encodeUpstreamReleaseStateJson = Schema.encodeEffect(UpstreamReleaseStateJson);
const decodePackageManifestJson = Schema.decodeEffect(PackageManifestJson);

export const decodeUpstreamReleaseTag = Effect.fn("decodeUpstreamReleaseTag")(function* (
  tag: string,
) {
  return yield* decodeUpstreamReleaseTagSchema(tag).pipe(
    Effect.mapError(
      (cause) =>
        new InvalidUpstreamReleaseTagError({
          tag,
          cause,
        }),
    ),
  );
});

export const decodeDownstreamReleaseVersion = Effect.fn("decodeDownstreamReleaseVersion")(
  function* (version: string) {
    return yield* decodeDownstreamReleaseVersionSchema(version).pipe(
      Effect.mapError(
        (cause) =>
          new InvalidDownstreamReleaseVersionError({
            version,
            cause,
          }),
      ),
    );
  },
);

const upstreamVersionFromTag = (tag: typeof UpstreamReleaseTag.Type) => tag.slice(1);

const downstreamBaseVersion = (version: typeof DownstreamReleaseVersion.Type) =>
  version.slice(0, version.lastIndexOf("-fork."));

const stableVersionComponents = (version: string) => {
  const components = version.split(".");
  return [Number(components[0]), Number(components[1]), Number(components[2])] as const;
};

const compareStableVersions = (left: string, right: string) => {
  const leftComponents = stableVersionComponents(left);
  const rightComponents = stableVersionComponents(right);
  return (
    leftComponents[0] - rightComponents[0] ||
    leftComponents[1] - rightComponents[1] ||
    leftComponents[2] - rightComponents[2]
  );
};

export const firstDownstreamVersion = Effect.fn("firstDownstreamVersion")(function* (
  upstreamTag: string,
) {
  const tag = yield* decodeUpstreamReleaseTag(upstreamTag);
  return `${upstreamVersionFromTag(tag)}-fork.1`;
});

export const incrementDownstreamVersion = Effect.fn("incrementDownstreamVersion")(function* (
  downstreamVersion: string,
) {
  const version = yield* decodeDownstreamReleaseVersion(downstreamVersion);
  const separatorIndex = version.lastIndexOf("-fork.");
  const revision = Number(version.slice(separatorIndex + "-fork.".length));
  return `${version.slice(0, separatorIndex)}-fork.${revision + 1}`;
});

const downstreamRevision = (version: typeof DownstreamReleaseVersion.Type) =>
  Number(version.slice(version.lastIndexOf("-fork.") + "-fork.".length));

const downstreamVersionFromTag = (
  tag: string,
  upstreamBase: string,
): typeof DownstreamReleaseVersion.Type | undefined => {
  if (!tag.startsWith("v")) {
    return undefined;
  }
  const version = tag.slice(1);
  return downstreamVersionPattern.test(version) && downstreamBaseVersion(version) === upstreamBase
    ? (version as typeof DownstreamReleaseVersion.Type)
    : undefined;
};

interface ResolveDownstreamReleaseVersionOptions {
  readonly existingTags?: ReadonlyArray<string> | undefined;
  readonly targetTags?: ReadonlyArray<string> | undefined;
  readonly requestedVersion?: string | undefined;
  readonly revision?: number | undefined;
}

export const resolveDownstreamReleaseVersion = Effect.fn("resolveDownstreamReleaseVersion")(
  function* (
    currentState: UpstreamReleaseState,
    options: ResolveDownstreamReleaseVersionOptions = {},
  ) {
    const state = yield* validateUpstreamReleaseState(currentState);
    const upstreamBase = upstreamVersionFromTag(state.tag);
    const revision = options.revision;
    if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1)) {
      return yield* new DownstreamReleaseVersionResolutionError({
        detail: `revision '${revision}' must be a positive safe integer.`,
      });
    }
    if (revision !== undefined && revision < downstreamRevision(state.downstreamVersion)) {
      return yield* new DownstreamReleaseVersionResolutionError({
        detail: `revision '${revision}' is below the recorded version floor '${state.downstreamVersion}'.`,
      });
    }
    const existingVersions = (options.existingTags ?? []).flatMap((tag) => {
      const version = downstreamVersionFromTag(tag, upstreamBase);
      return version === undefined ? [] : [version];
    });
    const targetVersions = [
      ...new Set(
        (options.targetTags ?? []).flatMap((tag) => {
          const version = downstreamVersionFromTag(tag, upstreamBase);
          return version === undefined ? [] : [version];
        }),
      ),
    ];

    if (targetVersions.length > 1) {
      return yield* new DownstreamReleaseVersionResolutionError({
        detail: `target commit already has multiple fork release tags (${targetVersions.join(", ")}).`,
      });
    }

    const requestedVersion =
      options.requestedVersion === undefined
        ? undefined
        : yield* decodeDownstreamReleaseVersion(options.requestedVersion);
    if (
      requestedVersion !== undefined &&
      downstreamBaseVersion(requestedVersion) !== upstreamBase
    ) {
      return yield* new DownstreamReleaseVersionResolutionError({
        detail: `requested version '${requestedVersion}' is not based on upstream tag '${state.tag}'.`,
      });
    }

    const targetVersion = targetVersions[0];
    if (targetVersion !== undefined) {
      if (requestedVersion !== undefined && requestedVersion !== targetVersion) {
        return yield* new DownstreamReleaseVersionResolutionError({
          detail: `target commit is already tagged '${targetVersion}', not '${requestedVersion}'.`,
        });
      }
      return {
        status: "retry" as const,
        version: targetVersion,
        releaseTag: `v${targetVersion}`,
      };
    }

    const highestExistingRevision = existingVersions.reduce(
      (highest, version) => Math.max(highest, downstreamRevision(version)),
      0,
    );
    const nextRevision =
      revision ??
      Math.max(downstreamRevision(state.downstreamVersion), highestExistingRevision + 1);
    const nextVersion =
      `${upstreamBase}-fork.${nextRevision}` as typeof DownstreamReleaseVersion.Type;

    if (existingVersions.includes(nextVersion)) {
      return yield* new DownstreamReleaseVersionResolutionError({
        detail: `version '${nextVersion}' is already tagged on a different commit.`,
      });
    }

    if (requestedVersion !== undefined && requestedVersion !== nextVersion) {
      return yield* new DownstreamReleaseVersionResolutionError({
        detail: `next available version is '${nextVersion}', not '${requestedVersion}'.`,
      });
    }

    return {
      status: "new" as const,
      version: nextVersion,
      releaseTag: `v${nextVersion}`,
    };
  },
);

export const validateUpstreamReleaseState = Effect.fn("validateUpstreamReleaseState")(function* (
  input: unknown,
) {
  const state = yield* decodeUpstreamReleaseStateSchema(input).pipe(
    Effect.mapError(
      (cause) =>
        new DownstreamReleaseStateValidationError({
          cause,
        }),
    ),
  );
  if (upstreamVersionFromTag(state.tag) !== downstreamBaseVersion(state.downstreamVersion)) {
    return yield* new DownstreamReleaseStateBaseMismatchError({
      tag: state.tag,
      downstreamVersion: state.downstreamVersion,
    });
  }
  return state;
});

export const readUpstreamReleaseState = Effect.fn("readUpstreamReleaseState")(function* (
  filePath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const raw = yield* fs.readFileString(filePath).pipe(
    Effect.mapError(
      (cause) =>
        new DownstreamReleaseStateFileError({
          operation: "read",
          filePath,
          cause,
        }),
    ),
  );
  const decoded = yield* decodeUpstreamReleaseStateJson(raw).pipe(
    Effect.mapError(
      (cause) =>
        new DownstreamReleaseStateValidationError({
          cause,
        }),
    ),
  );
  return yield* validateUpstreamReleaseState(decoded);
});

export const writeUpstreamReleaseState = Effect.fn("writeUpstreamReleaseState")(function* (
  filePath: string,
  input: unknown,
) {
  const fs = yield* FileSystem.FileSystem;
  const state = yield* validateUpstreamReleaseState(input);
  const encoded = yield* encodeUpstreamReleaseStateJson(state).pipe(
    Effect.mapError(
      (cause) =>
        new DownstreamReleaseStateValidationError({
          cause,
        }),
    ),
  );
  yield* fs.writeFileString(filePath, `${encoded}\n`).pipe(
    Effect.mapError(
      (cause) =>
        new DownstreamReleaseStateFileError({
          operation: "write",
          filePath,
          cause,
        }),
    ),
  );
  return state;
});

interface UpstreamReleaseCandidate {
  readonly repository: string;
  readonly tag: string;
  readonly commit: string;
}

const UpstreamReleaseCandidate = Schema.Struct({
  repository: UpstreamRepository,
  tag: UpstreamReleaseTag,
  commit: UpstreamReleaseCommit,
});
const decodeUpstreamReleaseCandidate = Schema.decodeUnknownEffect(UpstreamReleaseCandidate);

export const resolveUpstreamSync = Effect.fn("resolveUpstreamSync")(function* (
  currentState: UpstreamReleaseState,
  input: UpstreamReleaseCandidate,
) {
  const state = yield* validateUpstreamReleaseState(currentState);
  const candidate = yield* decodeUpstreamReleaseCandidate(input).pipe(
    Effect.mapError(
      (cause) =>
        new DownstreamReleaseStateValidationError({
          cause,
        }),
    ),
  );

  if (candidate.repository !== state.repository) {
    return yield* new UpstreamRepositoryMismatchError({
      recordedRepository: state.repository,
      resolvedRepository: candidate.repository,
    });
  }

  if (candidate.tag === state.tag) {
    if (candidate.commit !== state.commit) {
      return yield* new UpstreamReleaseTagMovedError({
        tag: candidate.tag,
        recordedCommit: state.commit,
        resolvedCommit: candidate.commit,
      });
    }
    return {
      status: "already-synced" as const,
      downstreamVersion: state.downstreamVersion,
    };
  }

  if (
    compareStableVersions(
      upstreamVersionFromTag(candidate.tag),
      upstreamVersionFromTag(state.tag),
    ) <= 0
  ) {
    return yield* new UpstreamReleaseNotNewerError({
      recordedTag: state.tag,
      resolvedTag: candidate.tag,
    });
  }

  return {
    status: "needs-sync" as const,
    downstreamVersion: yield* firstDownstreamVersion(candidate.tag),
  };
});

interface ValidateReleaseOptions {
  readonly rootDir?: string | undefined;
  readonly explicitVersion?: string | undefined;
}

export const validateDownstreamRelease = Effect.fn("validateDownstreamRelease")(function* (
  statePath: string,
  options: ValidateReleaseOptions = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const state = yield* readUpstreamReleaseState(statePath);
  const version =
    options.explicitVersion === undefined
      ? state.downstreamVersion
      : yield* decodeDownstreamReleaseVersion(options.explicitVersion);

  if (downstreamBaseVersion(version) !== upstreamVersionFromTag(state.tag)) {
    return yield* new DownstreamReleaseStateBaseMismatchError({
      tag: state.tag,
      downstreamVersion: version,
    });
  }

  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  for (const relativePath of releasePackageFiles) {
    const filePath = path.join(rootDir, relativePath);
    const raw = yield* fs.readFileString(filePath).pipe(
      Effect.mapError(
        (cause) =>
          new DownstreamReleaseManifestError({
            operation: "read",
            filePath,
            cause,
          }),
      ),
    );
    const manifest = yield* decodePackageManifestJson(raw).pipe(
      Effect.mapError(
        (cause) =>
          new DownstreamReleaseManifestError({
            operation: "decode",
            filePath,
            cause,
          }),
      ),
    );
    if (manifest.version !== version) {
      return yield* new DownstreamReleaseVersionMismatchError({
        expectedVersion: version,
        actualVersion: manifest.version,
        source: relativePath,
      });
    }
  }

  return {
    ...state,
    version,
    releaseTag: `v${version}`,
  };
});

const writeGitHubOutput = Effect.fn("writeGitHubOutput")(function* (
  output: Readonly<Record<string, string>>,
) {
  const fs = yield* FileSystem.FileSystem;
  const filePath = yield* Config.nonEmptyString("GITHUB_OUTPUT").pipe(
    Effect.mapError(
      (cause) =>
        new DownstreamReleaseGitHubOutputError({
          operation: "resolve",
          filePath: "",
          cause,
        }),
    ),
  );
  const lines = Object.entries(output)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  yield* fs.writeFileString(filePath, `${lines}\n`, { flag: "a" }).pipe(
    Effect.mapError(
      (cause) =>
        new DownstreamReleaseGitHubOutputError({
          operation: "write",
          filePath,
          cause,
        }),
    ),
  );
});

const statePathFlag = Flag.string("state").pipe(
  Flag.withDefault(".github/upstream-release.json"),
  Flag.withDescription("Path to the downstream upstream-release state file."),
);
const githubOutputFlag = Flag.boolean("github-output").pipe(Flag.withDefault(false));
const splitTagList = (tags: string) => tags.split(/\r?\n/).filter((tag) => tag.length > 0);

const validateCommand = Command.make(
  "validate",
  {
    statePath: statePathFlag,
    githubOutput: githubOutputFlag,
  },
  ({ statePath, githubOutput }) =>
    readUpstreamReleaseState(statePath).pipe(
      Effect.tap((state) =>
        githubOutput
          ? writeGitHubOutput({
              repository: state.repository,
              upstream_tag: state.tag,
              upstream_commit: state.commit,
              downstream_version: state.downstreamVersion,
            })
          : Console.log(JSON.stringify(state, null, 2)),
      ),
    ),
);

const resolveSyncCommand = Command.make(
  "resolve-sync",
  {
    statePath: statePathFlag,
    repository: Flag.string("repository"),
    tag: Flag.string("tag"),
    commit: Flag.string("commit"),
    githubOutput: githubOutputFlag,
  },
  ({ statePath, repository, tag, commit, githubOutput }) =>
    Effect.gen(function* () {
      const state = yield* readUpstreamReleaseState(statePath);
      const resolution = yield* resolveUpstreamSync(state, {
        repository,
        tag,
        commit,
      });
      if (githubOutput) {
        yield* writeGitHubOutput({
          status: resolution.status,
          downstream_version: resolution.downstreamVersion,
        });
      } else {
        yield* Console.log(
          `status=${resolution.status}\ndownstream_version=${resolution.downstreamVersion}`,
        );
      }
    }),
);

const writeCommand = Command.make(
  "write",
  {
    statePath: statePathFlag,
    repository: Flag.string("repository"),
    tag: Flag.string("tag"),
    commit: Flag.string("commit"),
    downstreamVersion: Flag.string("downstream-version"),
  },
  ({ statePath, repository, tag, commit, downstreamVersion }) =>
    writeUpstreamReleaseState(statePath, {
      repository,
      tag,
      commit,
      downstreamVersion,
    }),
);

const incrementCommand = Command.make(
  "increment",
  {
    version: Argument.string("version"),
    githubOutput: githubOutputFlag,
  },
  ({ version, githubOutput }) =>
    incrementDownstreamVersion(version).pipe(
      Effect.tap((nextVersion) =>
        githubOutput
          ? writeGitHubOutput({ downstream_version: nextVersion })
          : Console.log(nextVersion),
      ),
    ),
);

const resolveReleaseCommand = Command.make(
  "resolve-release",
  {
    statePath: statePathFlag,
    existingTags: Flag.string("existing-tags").pipe(Flag.withDefault("")),
    targetTags: Flag.string("target-tags").pipe(Flag.withDefault("")),
    version: Flag.string("version").pipe(Flag.optional),
    revision: Flag.integer("revision").pipe(Flag.optional),
    githubOutput: githubOutputFlag,
  },
  ({ statePath, existingTags, targetTags, version, revision, githubOutput }) =>
    Effect.gen(function* () {
      const state = yield* readUpstreamReleaseState(statePath);
      const release = yield* resolveDownstreamReleaseVersion(state, {
        existingTags: splitTagList(existingTags),
        targetTags: splitTagList(targetTags),
        requestedVersion: Option.getOrUndefined(version),
        revision: Option.getOrUndefined(revision),
      });
      if (githubOutput) {
        yield* writeGitHubOutput({
          status: release.status,
          version: release.version,
          release_tag: release.releaseTag,
        });
      } else {
        yield* Console.log(JSON.stringify(release, null, 2));
      }
    }),
);

const validateReleaseCommand = Command.make(
  "validate-release",
  {
    statePath: statePathFlag,
    root: Flag.string("root").pipe(Flag.optional),
    version: Flag.string("version").pipe(Flag.optional),
    githubOutput: githubOutputFlag,
  },
  ({ statePath, root, version, githubOutput }) =>
    validateDownstreamRelease(statePath, {
      rootDir: Option.getOrUndefined(root),
      explicitVersion: Option.getOrUndefined(version),
    }).pipe(
      Effect.tap((release) =>
        githubOutput
          ? writeGitHubOutput({
              repository: release.repository,
              upstream_tag: release.tag,
              upstream_commit: release.commit,
              version: release.version,
              release_tag: release.releaseTag,
            })
          : Console.log(JSON.stringify(release, null, 2)),
      ),
    ),
);

export const downstreamReleaseStateCommand = Command.make("downstream-release-state").pipe(
  Command.withDescription("Validate and resolve downstream fork release state."),
  Command.withSubcommands([
    validateCommand,
    resolveSyncCommand,
    writeCommand,
    incrementCommand,
    resolveReleaseCommand,
    validateReleaseCommand,
  ]),
);

if (import.meta.main) {
  Command.run(downstreamReleaseStateCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
