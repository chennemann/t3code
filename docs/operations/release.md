# Downstream fork releases

This repository maintains fork-specific commits on a stable downstream `main` while importing exact
stable releases from [`pingdotgg/t3code`](https://github.com/pingdotgg/t3code). Upstream releases are
merged through pull requests; downstream `main` and published tags are never rewritten.

Fork releases are owned by:

- `.github/workflows/downstream-sync.yml`
- `.github/workflows/downstream-release.yml`
- `.github/upstream-release.json`

`.github/workflows/ci.yml` supplies the required protected-branch checks for synchronization PRs.
No canonical upstream, relay, mobile, labeling, or PR utility workflows are retained in this fork.

## Repository setup

Use the conventional two-remote layout before enabling either workflow:

```text
origin    https://github.com/<fork-owner>/<fork-repository>.git
upstream  https://github.com/pingdotgg/t3code.git
```

Verify rather than assume the configured URLs:

```sh
git remote -v
git remote set-url origin https://github.com/<fork-owner>/<fork-repository>.git
git remote add upstream https://github.com/pingdotgg/t3code.git
```

If `upstream` already exists, use `git remote set-url upstream` instead. Protect downstream `main`,
require synchronization changes to merge through pull requests, and do not permit force pushes.

Configure the `DOWNSTREAM_AUTOMATION_TOKEN` Actions secret with a fine-grained personal access token
scoped only to this repository. It needs `Contents: read and write`, `Pull requests: read and write`,
and `Workflows: read and write` permissions. The workflow permission is needed because an imported
upstream release may update files below `.github/workflows`.

The synchronization workflow deliberately does not create or update pull requests with
`GITHUB_TOKEN`. GitHub places workflows triggered by those bot-authored pull requests into an
approval-required state, which prevents unattended auto-merge. The separate identity starts normal
pull-request CI without a per-release approval. Do not grant the automation a branch-protection
bypass or a path to force-push `main`.

Optional repository variable:

- `UPSTREAM_REPOSITORY`: defaults to `pingdotgg/t3code`.

The workflows refuse to run when the current repository is the configured upstream repository and
verify the checkout's `origin` URL before any push.

## Recorded upstream state

`.github/upstream-release.json` records the upstream source and the minimum fork version for that
upstream base:

```json
{
  "repository": "pingdotgg/t3code",
  "tag": "v0.0.29",
  "commit": "1153afb4fb694944b5c25e2153b904a85cf47d70",
  "downstreamVersion": "0.0.29-fork.1"
}
```

`scripts/downstream-release-state.ts` validates the file, requires a plain stable upstream tag,
requires a full peeled commit SHA, and requires the downstream version to use the same upstream base.
The synchronization workflow changes this file only on its pull-request branch.

Downstream versions and immutable tags use:

```text
0.0.29-fork.1
v0.0.29-fork.1
```

The numeric fork revision is the commit's first-parent position from the most recent merge that
changed `.github/upstream-release.json` or the downstream release versioning policy. The baseline
merge is `fork.1`; later downstream `main` commits on that baseline are `fork.2`, `fork.3`, and so on.
Tags from an older baseline are excluded, so a corrected policy can restart a sequence without
moving an immutable tag. This makes revisions deterministic and collision-free even when releases
build in parallel, while resetting each new upstream base to `fork.1`.

## Importing an upstream release

`.github/workflows/downstream-sync.yml` runs every three hours and can be dispatched manually. It:

1. Reads the upstream repository's latest non-prerelease GitHub Release.
2. Accepts only a tag matching `vX.Y.Z`.
3. Fetches and peels that exact tag, then verifies its commit is on upstream `main`.
4. Compares the tag and SHA with the recorded state, failing if a recorded tag moved.
5. Reuses an existing `sync/upstream-vX.Y.Z` pull request when one is open.
6. Otherwise creates or resumes the sync branch without changing downstream `main`.
7. Merges the exact upstream release with `--no-ff`.
8. Sets package manifests and the recorded version floor to `X.Y.Z-fork.1`, then refreshes
   `pnpm-lock.yaml`.
9. Pushes only the short-lived branch and opens a PR into downstream `main`.
10. Lets normal pull-request CI run and enables merge-commit auto-merge.

If either the upstream merge or updating an existing sync branch conflicts, the workflow aborts the
merge and exits before pushing. A maintainer must resolve the conflict on a normal branch or PR.
Otherwise, GitHub merges the PR automatically only after the required `Check`, `Test`, and
`Release Smoke` checks pass. A failed check leaves the PR open.

A rerun is a successful no-op when the recorded tag and SHA match. It never moves an upstream tag,
creates an upstream-named release tag, rebases downstream `main`, or force-pushes `main`.

## Publishing the Windows release

`.github/workflows/downstream-release.yml` runs on every push to downstream `main`, so every merged
PR produces a fork release for its resulting commit. It can also be dispatched manually; the
optional exact `X.Y.Z-fork.N` input is an assertion for a retry, not a way to skip or choose a new
revision.

For a new commit, the workflow combines the recorded upstream base with that baseline-relative
first-parent position. For example, the `v0.0.29` baseline merge publishes `0.0.29-fork.1`, and the
next downstream merge publishes `0.0.29-fork.2`. A rerun discovers the immutable tag already attached
to the target commit and reuses that version. Releasable package manifests and the lockfile are
updated only in the isolated build checkout, so the release workflow does not create a follow-up
commit or trigger itself recursively.

Preflight requires:

- `.github/upstream-release.json` to be valid.
- The resolved release version to use the upstream base recorded in
  `.github/upstream-release.json`.
- `apps/server/package.json`, `apps/desktop/package.json`, `apps/web/package.json`, and
  `packages/contracts/package.json` to contain the resolved version after build-checkout preparation.
- The prepared `pnpm-lock.yaml` to pass a frozen install.
- A push checkout to still be on current `origin/main`, or a manual checkout to equal it.
- `v<version>` to be absent, or already point to that exact commit.

If both the immutable tag and GitHub Release already exist, the workflow exits successfully. If a
correct tag exists without a release, the workflow rebuilds and completes the release. A tag that
points anywhere else is never moved.

The release pipeline uses GitHub-hosted runners:

- `windows-2025` builds the Windows x64 NSIS installer.
- `ubuntu-24.04` creates the immutable tag and GitHub Release.

Only the installer (`*.exe`), installer blockmap (`*.blockmap`), and updater manifests (`*.yml`) are
uploaded. The workflow requires `latest.yml` and verifies that its version matches the release
version. Fork versions are published as normal, non-prerelease GitHub Releases, even though
`-fork.N` is a SemVer prerelease component. After parallel builds, the workflow explicitly marks the
highest fork version as latest so a slower older build cannot replace a newer update.

macOS, Linux desktop, Windows arm64, mobile, npm, relay, Vercel, and Discord release work are not part
of this downstream workflow. The personal fork also omits the Linux `node-pty` prebuild used by the
optional WSL backend; the Windows package is intended to use the local Git Bash shell instead.

## Windows signing

Azure Trusted Signing is enabled only when all of these secrets are configured:

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_TRUSTED_SIGNING_ENDPOINT`
- `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`
- `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME`
- `AZURE_TRUSTED_SIGNING_PUBLISHER_NAME`

When any value is missing, the workflow publishes an unsigned installer. The optional
`CLERK_PASSKEY_RP_DOMAINS` repository variable is still passed to the Windows build.

## Downstream-only releases

No release-specific version-bump PR is needed. Merge the downstream change through a normal PR.
The resulting push to `main` automatically receives the run-number-based fork version and publishes
the Windows release; no new upstream release is required.

## Desktop updates

The Electron updater implementation is unchanged. The Windows build sets:

```text
T3CODE_DESKTOP_UPDATE_REPOSITORY=${{ github.repository }}
```

The packaged `resources/app-update.yml` therefore points fork builds at this fork's public GitHub
Releases. Existing official builds still check the upstream repository, so users must manually
install the first fork build. Later monotonically increasing fork releases are detected through the
normal `latest` updater channel. Rebuilding the same version does not create an update.

Private-repository updater authentication is not configured by this workflow.

## GitHub-side dry run

Before relying on the schedule:

1. Confirm `origin`, `upstream`, branch protection, Actions PR permissions, and hosted runner access.
2. Dispatch the sync workflow with the recorded upstream release current; it should no-op.
3. In an isolated test fork, record an older upstream state and dispatch sync.
4. Confirm one branch and one PR are created without changing `main`.
5. Confirm pull-request CI starts without an approval prompt and auto-merge waits for all three
   required checks.
6. Dispatch again if needed and confirm the existing PR is reused rather than duplicated.
7. Confirm the PR merges with a merge commit and the immutable downstream tag is created.
8. Confirm the GitHub Release is non-prerelease, marked latest, and contains `.exe`, `.blockmap`, and
   `latest.yml`.
9. Manually install that first fork build, merge another test PR, and confirm its higher fork
   revision is detected from the fork.
