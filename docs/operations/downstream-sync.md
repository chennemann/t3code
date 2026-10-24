# Updating the downstream fork

`main` mirrors upstream. `fork` is the release branch, based on an upstream stable tag recorded in
`.github/upstream-release.json`. `fork-next` holds the replacement stack until it is promoted.
The integration policy records a separate `baseCommit` for compatibility checks. This supports a
`fork-next` rebased onto upstream main without mislabeling that commit as a stable release. The
release metadata continues to describe the stable release baseline. When updating to a stable tag,
update both baselines.
Neither baseline is inferred from a moving branch.

Upstream updates are manual. Fetch upstream with `jj git fetch --remote upstream --branch main`,
preserve a backup bookmark, and rebase the fork stack onto the chosen upstream commit. Validate
the integration policy, typecheck affected packages, and run focused
tests before pushing the candidate. There is no scheduled rebase or automatic mirror update.

The root `.editorconfig` isolates this checkout from formatting rules in parent directories and
keeps the upstream two-space indentation. Whole-file formatting changes expand the conflict surface
without adding behavior; keep formatting limited to the files being changed.

Resolve source conflicts manually, preserving upstream and fork behavior. Android clients use
the upstream HTTP and WebSocket RPC contracts; the fork no longer publishes a portable adapter.

Package versions stay at their upstream values on the feature branch. The release workflow stamps
the selected fork version into its build checkout, refreshes the lockfile, and validates all release
manifests and bundles there. Keeping release version edits out of the patch stack avoids conflicts at
every upstream version bump.

## Local validation

In a Jujutsu workspace:

```bash
jj status
jj log -r 'conflicts()'
node scripts/check-downstream.ts
node scripts/downstream-release-state.ts validate
```

Run the affected package typechecks and focused tests from the downstream check action. The action
runs on Linux; Windows hosts without symlink privileges cannot run some upstream packaging fixtures.
Compare failures against the unchanged base before attributing them to a rebase. Never skip a newly
introduced failure to promote a candidate.

Keep one commit per fork feature, with release automation in its own commit at the top of the
stack. Fold follow-up fixes into their feature's commit, so dropping a feature means leaving its
commit out of the next rebase. Resolve behavior in the smallest owning module, regenerate derived
files, and do not merge release tags or the old fork wholesale into the replacement stack.

## Persistence

Fork features add no schema to the core database. A feature that needs storage gets its own
database with its own migrations, so upstream migration IDs never collide with fork ones.
`apps/server/src/downstream/persistence/repairForkDatabase.ts` releases the migration ID the
v0.1.0 fork recorded in the core ledger; keep it until no database written by that fork remains.
