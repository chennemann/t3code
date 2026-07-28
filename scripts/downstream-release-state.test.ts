import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  DownstreamReleaseStateBaseMismatchError,
  InvalidDownstreamReleaseVersionError,
  InvalidUpstreamReleaseTagError,
  UpstreamRepositoryMismatchError,
  UpstreamReleaseTagMovedError,
  decodeDownstreamReleaseVersion,
  firstDownstreamVersion,
  incrementDownstreamVersion,
  resolveUpstreamSync,
  validateUpstreamReleaseState,
} from "./downstream-release-state.ts";

const recordedState = {
  repository: "pingdotgg/t3code",
  tag: "v0.0.29",
  commit: "1153afb4fb694944b5c25e2153b904a85cf47d70",
  downstreamVersion: "0.0.29-fork.2",
} as const;

it.effect("creates the first fork version for a new upstream stable tag", () =>
  Effect.gen(function* () {
    assert.equal(yield* firstDownstreamVersion("v0.0.30"), "0.0.30-fork.1");
  }),
);

it.effect("increments a downstream-only revision on the same upstream base", () =>
  Effect.gen(function* () {
    assert.equal(yield* incrementDownstreamVersion("0.0.30-fork.9"), "0.0.30-fork.10");
  }),
);

it.effect("rejects malformed and prerelease upstream tags", () =>
  Effect.gen(function* () {
    const malformed = yield* firstDownstreamVersion("0.0.30").pipe(Effect.flip);
    const prerelease = yield* firstDownstreamVersion("v0.0.30-rc.1").pipe(Effect.flip);

    assert.instanceOf(malformed, InvalidUpstreamReleaseTagError);
    assert.instanceOf(prerelease, InvalidUpstreamReleaseTagError);
  }),
);

it.effect("rejects malformed downstream versions", () =>
  Effect.gen(function* () {
    const missingRevision = yield* decodeDownstreamReleaseVersion("0.0.30-fork").pipe(Effect.flip);
    const zeroRevision = yield* decodeDownstreamReleaseVersion("0.0.30-fork.0").pipe(Effect.flip);

    assert.instanceOf(missingRevision, InvalidDownstreamReleaseVersionError);
    assert.instanceOf(zeroRevision, InvalidDownstreamReleaseVersionError);
  }),
);

it.effect("returns an idempotent result when upstream tag and commit already match", () =>
  Effect.gen(function* () {
    const resolution = yield* resolveUpstreamSync(recordedState, {
      repository: recordedState.repository,
      tag: recordedState.tag,
      commit: recordedState.commit,
    });

    assert.deepStrictEqual(resolution, {
      status: "already-synced",
      downstreamVersion: "0.0.29-fork.2",
    });
  }),
);

it.effect("detects an upstream tag and peeled commit mismatch", () =>
  Effect.gen(function* () {
    const error = yield* resolveUpstreamSync(recordedState, {
      repository: recordedState.repository,
      tag: recordedState.tag,
      commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }).pipe(Effect.flip);

    assert.instanceOf(error, UpstreamReleaseTagMovedError);
    assert.equal(error.recordedCommit, recordedState.commit);
    assert.equal(error.resolvedCommit, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  }),
);

it.effect("rejects a configured upstream repository that differs from recorded state", () =>
  Effect.gen(function* () {
    const error = yield* resolveUpstreamSync(recordedState, {
      repository: "example/t3code",
      tag: recordedState.tag,
      commit: recordedState.commit,
    }).pipe(Effect.flip);

    assert.instanceOf(error, UpstreamRepositoryMismatchError);
  }),
);

it.effect("resets the fork revision for a newer upstream base", () =>
  Effect.gen(function* () {
    const resolution = yield* resolveUpstreamSync(recordedState, {
      repository: recordedState.repository,
      tag: "v0.0.30",
      commit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });

    assert.deepStrictEqual(resolution, {
      status: "needs-sync",
      downstreamVersion: "0.0.30-fork.1",
    });
  }),
);

it.effect("rejects state whose downstream version does not match its upstream tag", () =>
  Effect.gen(function* () {
    const error = yield* validateUpstreamReleaseState({
      ...recordedState,
      downstreamVersion: "0.0.30-fork.1",
    }).pipe(Effect.flip);

    assert.instanceOf(error, DownstreamReleaseStateBaseMismatchError);
  }),
);
