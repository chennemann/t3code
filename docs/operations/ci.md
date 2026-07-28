# CI quality gates

Fork pull requests and pushes to `main` run `.github/workflows/ci.yml` on GitHub-hosted
`ubuntu-24.04` runners:

- `vp check`, `vpr typecheck`, and the desktop build pipeline.
- The workspace test script.
- The focused release smoke script.

The workflow also supports explicit dispatches. Upstream synchronization uses that entry point
because GitHub does not start a second workflow from a pull request created with the same
`GITHUB_TOKEN`. The fork protects `main` with `Check`, `Test`, and `Release Smoke` as required
checks, so sync PR auto-merge waits for the dispatched run to succeed.

Mobile native static analysis is explicitly restricted to `pingdotgg/t3code`; it does not consume a
macOS runner in downstream forks. The inherited mobile EAS and showcase workflows are also
canonical-repository-only.

Production relay deployment in `.github/workflows/deploy-relay.yml` is guarded with
`github.repository == 'pingdotgg/t3code'`, so an ordinary downstream `main` push cannot deploy shared
infrastructure. The inherited `.github/workflows/release.yml` has the same canonical-only entry
guard.

Downstream automation is separate:

- `.github/workflows/downstream-sync.yml` imports exact stable upstream tags through PRs.
- `.github/workflows/downstream-release.yml` builds and publishes only Windows x64 fork releases.

Both workflows use GitHub-hosted `ubuntu-24.04` and `windows-2025` runners. See
[Downstream fork releases](./release.md) for setup, safety checks, signing, and dry-run validation.
