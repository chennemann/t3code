# Downstream fork releases

This repository maintains fork-specific commits on a stable downstream `main` while importing exact
stable releases from [`pingdotgg/t3code`](https://github.com/pingdotgg/t3code). Upstream releases are
merged through pull requests; downstream `main` and published tags are never rewritten.

The inherited `.github/workflows/release.yml` is restricted to `pingdotgg/t3code`. Fork releases are
owned by:

- `.github/workflows/downstream-sync.yml`
- `.github/workflows/downstream-release.yml`
- `.github/upstream-release.json`

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

Repository Actions settings must allow GitHub Actions to create pull requests. The synchronization
workflow uses `GITHUB_TOKEN` with only `contents: write` and `pull-requests: write`. If organization
policy prohibits PR creation with `GITHUB_TOKEN`, replace that token with a narrowly scoped GitHub
App token; do not grant automation a path to force-push `main`.

Optional repository variable:

- `UPSTREAM_REPOSITORY`: defaults to `pingdotgg/t3code`.

The workflows refuse to run when the current repository is the configured upstream repository and
verify the checkout's `origin` URL before any push.

## Recorded upstream state

`.github/upstream-release.json` records the source and release version:

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

The numeric fork revision increases for downstream-only releases on the same upstream base and
resets to `1` for a new upstream base.

## Importing an upstream release

`.github/workflows/downstream-sync.yml` runs every six hours and can be dispatched manually. It:

1. Reads the upstream repository's latest non-prerelease GitHub Release.
2. Accepts only a tag matching `vX.Y.Z`.
3. Fetches and peels that exact tag, then verifies its commit is on upstream `main`.
4. Compares the tag and SHA with the recorded state, failing if a recorded tag moved.
5. Reuses an existing `sync/upstream-vX.Y.Z` pull request when one is open.
6. Otherwise creates or resumes the sync branch without changing downstream `main`.
7. Merges the exact upstream release with `--no-ff`.
8. Sets package manifests and state to `X.Y.Z-fork.1`, then refreshes `pnpm-lock.yaml`.
9. Pushes only the short-lived branch and opens a PR into downstream `main`.
10. Dispatches CI for the exact PR head and enables merge-commit auto-merge.

If either the upstream merge or updating an existing sync branch conflicts, the workflow aborts the
merge and exits before pushing. A maintainer must resolve the conflict on a normal branch or PR.
Otherwise, GitHub merges the PR automatically only after the required `Check`, `Test`, and
`Release Smoke` checks pass. A failed check leaves the PR open.

A rerun is a successful no-op when the recorded tag and SHA match. It never moves an upstream tag,
creates an upstream-named release tag, rebases downstream `main`, or force-pushes `main`.

## Publishing the Windows release

`.github/workflows/downstream-release.yml` runs when release state or releasable package versions
change on downstream `main`. It can also be dispatched manually with an optional exact
`X.Y.Z-fork.N` version.

Preflight requires:

- `.github/upstream-release.json` to be valid.
- `apps/server/package.json`, `apps/desktop/package.json`, `apps/web/package.json`, and
  `packages/contracts/package.json` to contain the exact recorded downstream version.
- `pnpm-lock.yaml` to pass a frozen install.
- The checkout to equal current `origin/main`.
- `v<version>` to be absent, or already point to that exact commit.

If both the immutable tag and GitHub Release already exist, the workflow exits successfully. If a
correct tag exists without a release, the workflow rebuilds and completes the release. A tag that
points anywhere else is never moved.

The release pipeline uses GitHub-hosted runners:

- `windows-2025` builds the Windows x64 NSIS installer.
- `ubuntu-24.04` creates the immutable tag and GitHub Release.

Only the installer (`*.exe`), installer blockmap (`*.blockmap`), and updater manifests (`*.yml`) are
uploaded. The workflow requires `latest.yml` and verifies that its version matches the release
version. Fork versions are published as normal, non-prerelease GitHub Releases and marked latest,
even though `-fork.N` is a SemVer prerelease component.

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

## Downstream-only patch release

Prepare a normal PR that changes the recorded version and all releasable package manifests, for
example from `0.0.29-fork.1` to `0.0.29-fork.2`:

```sh
node scripts/downstream-release-state.ts increment 0.0.29-fork.1
node scripts/update-release-package-versions.ts 0.0.29-fork.2
```

Then update only `downstreamVersion` in `.github/upstream-release.json` to the same value and run:

```sh
vp install --lockfile-only --ignore-scripts
node scripts/downstream-release-state.ts validate-release
```

After the PR merges, the normal downstream workflow publishes `v0.0.29-fork.2`; no new upstream
release is required.

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
5. Confirm CI is dispatched for the sync branch and auto-merge waits for all three required checks.
6. Dispatch again if needed and confirm the existing PR is reused rather than duplicated.
7. Confirm the PR merges with a merge commit and the immutable downstream tag is created.
8. Confirm the GitHub Release is non-prerelease, marked latest, and contains `.exe`, `.blockmap`, and
   `latest.yml`.
9. Manually install that first fork build, publish a higher fork revision, and confirm the update is
   detected from the fork.
