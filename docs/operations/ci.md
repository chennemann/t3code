# CI quality gates

Fork pull requests and pushes to `main` run `.github/workflows/ci.yml` on GitHub-hosted
`ubuntu-24.04` runners:

- `vp check`, `vpr typecheck`, and the desktop build pipeline.
- The workspace test script.
- The focused release smoke script.

The workflow also supports explicit dispatches for diagnostics. Upstream synchronization creates and
updates its pull requests with the separate `DOWNSTREAM_AUTOMATION_TOKEN` identity, so normal
`pull_request` CI starts without a maintainer approval gate. The fork protects `main` with `Check`,
`Test`, and `Release Smoke` as required checks, so sync PR auto-merge waits for those pull-request
checks to succeed.

The fork keeps only the workflows required for its release process:

- `.github/workflows/ci.yml` supplies the protected-branch checks required before an upstream sync
  PR can merge.
- `.github/workflows/downstream-sync.yml` imports exact stable upstream tags through PRs.
- `.github/workflows/downstream-release.yml` builds and publishes only Windows x64 fork releases.

They use GitHub-hosted `ubuntu-24.04` and `windows-2025` runners. Relay deployment, canonical
upstream releases, issue labeling, PR utilities, mobile EAS builds, and showcase capture are
intentionally not automated in this fork. See
[Downstream fork releases](./release.md) for setup, safety checks, signing, and dry-run validation.
