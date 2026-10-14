import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Option from "effect/Option";

import type { VcsDriverKind, VcsError, VcsRepositoryIdentity } from "@t3tools/contracts";
import { VcsUnsupportedOperationError } from "@t3tools/contracts";
import * as GitVcsDriver from "./GitVcsDriver.ts";
import * as JjVcsDriver from "./JjVcsDriver.ts";
import { findVcsMarkerRoot } from "./JjRepo.ts";
import * as VcsProjectConfig from "./VcsProjectConfig.ts";
import * as VcsDriver from "./VcsDriver.ts";

const DETECTION_CACHE_CAPACITY = 2_048;
const DETECTION_CACHE_TTL = Duration.seconds(2);

export interface VcsDriverResolveInput {
  readonly cwd: string;
  readonly requestedKind?: VcsDriverKind | "auto";
}

export interface VcsDriverHandle {
  readonly kind: VcsDriverKind;
  readonly repository: VcsRepositoryIdentity;
  readonly driver: VcsDriver.VcsDriver["Service"];
}

export class VcsDriverRegistry extends Context.Service<
  VcsDriverRegistry,
  {
    readonly get: (kind: VcsDriverKind) => Effect.Effect<VcsDriver.VcsDriver["Service"], VcsError>;
    readonly detect: (
      input: VcsDriverResolveInput,
    ) => Effect.Effect<VcsDriverHandle | null, VcsError>;
    readonly resolve: (input: VcsDriverResolveInput) => Effect.Effect<VcsDriverHandle, VcsError>;
    readonly invalidate: (cwd: string) => Effect.Effect<void>;
  }
>()("t3/vcs/VcsDriverRegistry") {}

function detectionCacheKey(input: {
  readonly cwd: string;
  readonly requestedKind: VcsDriverKind | "auto";
}): string {
  return `${input.requestedKind}\0${input.cwd}`;
}

function parseDetectionCacheKey(key: string): {
  readonly cwd: string;
  readonly requestedKind: VcsDriverKind | "auto";
} {
  const separatorIndex = key.indexOf("\0");
  if (separatorIndex === -1) {
    return {
      cwd: key,
      requestedKind: "auto",
    };
  }
  return {
    requestedKind: key.slice(0, separatorIndex) as VcsDriverKind | "auto",
    cwd: key.slice(separatorIndex + 1),
  };
}

export const make = Effect.gen(function* () {
  const projectConfig = yield* VcsProjectConfig.VcsProjectConfig;
  const git = yield* GitVcsDriver.makeVcsDriver;
  const jj = yield* JjVcsDriver.JjVcsDriver;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const drivers: Partial<Record<VcsDriverKind, VcsDriver.VcsDriver["Service"]>> = {
    git,
    jj,
  };

  const get: VcsDriverRegistry["Service"]["get"] = (kind) => {
    const driver = drivers[kind];
    if (!driver) {
      return Effect.fail(
        new VcsUnsupportedOperationError({
          operation: "VcsDriverRegistry.get",
          kind,
          detail: `No ${kind} VCS driver is registered.`,
        }),
      );
    }
    return Effect.succeed(driver);
  };

  const detectWithDriver = Effect.fn("VcsDriverRegistry.detectWithDriver")(function* (
    kind: VcsDriverKind,
    driver: VcsDriver.VcsDriver["Service"],
    cwd: string,
  ) {
    const repository = yield* driver.detectRepository(cwd);
    if (!repository) {
      return null;
    }
    return {
      kind,
      repository,
      driver,
    } satisfies VcsDriverHandle;
  });

  const detectResolvedKind = Effect.fn("VcsDriverRegistry.detectResolvedKind")(function* (input: {
    readonly cwd: string;
    readonly requestedKind: VcsDriverKind | "auto";
  }) {
    const requestedKind = input.requestedKind;

    if (requestedKind !== "auto" && requestedKind !== "unknown") {
      const driver = yield* get(requestedKind);
      return yield* detectWithDriver(requestedKind, driver, input.cwd);
    }

    // jj is probed first because a colocated repo answers yes to both probes, and probing git first would write git worktrees into a jj repo.
    const jjDetected = yield* detectWithDriver("jj", jj, input.cwd);
    if (jjDetected) {
      return jjDetected;
    }
    return yield* detectWithDriver("git", git, input.cwd);
  });

  const detectionCache = yield* Cache.makeWith<string, VcsDriverHandle | null, VcsError>(
    (key) => detectResolvedKind(parseDetectionCacheKey(key)),
    {
      capacity: DETECTION_CACHE_CAPACITY,
      timeToLive: Exit.match({
        onSuccess: (detected) => (detected === null ? Duration.zero : DETECTION_CACHE_TTL),
        onFailure: () => Duration.zero,
      }),
    },
  );

  const detect: VcsDriverRegistry["Service"]["detect"] = Effect.fn("VcsDriverRegistry.detect")(
    function* (input) {
      const requestedKind = yield* projectConfig.resolveKind(input);
      const key = detectionCacheKey({ cwd: input.cwd, requestedKind });
      const cached = yield* Cache.getOption(detectionCache, key);
      if (Option.isSome(cached) && cached.value !== null) {
        const marker = yield* findVcsMarkerRoot(fileSystem, path, input.cwd);
        if (
          marker === null ||
          path.resolve(marker.root) !== path.resolve(cached.value.repository.rootPath) ||
          ((requestedKind === "auto" || requestedKind === "unknown") &&
            marker.marker !== cached.value.kind)
        ) {
          yield* Cache.invalidate(detectionCache, key);
        }
      }
      return yield* Cache.get(detectionCache, key);
    },
  );

  const resolve: VcsDriverRegistry["Service"]["resolve"] = Effect.fn("VcsDriverRegistry.resolve")(
    function* (input) {
      const detected = yield* detect(input);
      if (detected) {
        return detected;
      }

      const requestedKind = input.requestedKind ?? "auto";
      return yield* new VcsUnsupportedOperationError({
        operation: "VcsDriverRegistry.resolve",
        kind: requestedKind === "auto" ? "unknown" : requestedKind,
        detail:
          requestedKind === "auto"
            ? `No supported VCS repository was detected at ${input.cwd}.`
            : `No ${requestedKind} repository was detected at ${input.cwd}.`,
      });
    },
  );

  return VcsDriverRegistry.of({
    get,
    detect,
    resolve,
    invalidate: (cwd) =>
      Effect.all([
        Cache.invalidate(detectionCache, detectionCacheKey({ cwd, requestedKind: "auto" })),
        Cache.invalidate(detectionCache, detectionCacheKey({ cwd, requestedKind: "git" })),
        Cache.invalidate(detectionCache, detectionCacheKey({ cwd, requestedKind: "jj" })),
      ]).pipe(Effect.asVoid),
  });
});

export const layer = Layer.effect(VcsDriverRegistry, make).pipe(
  Layer.provide(JjVcsDriver.layer),
  Layer.provide(VcsProjectConfig.layer),
);
