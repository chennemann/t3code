# Downstream modules

Fork-owned server behavior lives under `apps/server/src/downstream`. Upstream modules install a
small set of hook points and must not import an individual downstream feature. The downstream
aggregators are the only place where feature implementations are assembled.

The installed hooks cover:

- orchestration command decisions, event projection, aggregate identity, project-deletion cleanup,
  and shell stream events;
- durable projection registrations and read-model fragments;
- typed HTTP groups, raw HTTP routes, and MCP toolkits;
- startup behavior, provider-session preparation, terminal policy, and advertised capabilities;
- preparation of the core migration ledger when upgrading an older fork database.

Wire schemas follow the same rule. `packages/contracts/src/downstream` owns downstream schema
fragments; the core contract modules only spread those fragments into the public unions and
structs. Shared defaults use `packages/shared/src/downstream`.

## Persistence boundary

Core state remains in `state.sqlite` and uses only the upstream migration registry. Downstream
state lives in the sibling `downstream.sqlite` database with its own migration ledger and numbering
starting at 1. A downstream migration must never be added to the core migration registry.

On first startup after this split, the downstream work-planning store copies legacy
`projection_todos` rows from `state.sqlite`, then records a marker in `downstream_metadata`. The
legacy core table is intentionally left intact so the import is recoverable and idempotent. Before
core migrations run, the compatibility hook removes the historical downstream migration names
from the core ledger and preserves only upstream migrations whose schema changes are already
present.

## Adding a downstream feature

Put the implementation and persistence under `downstream/features/<feature>`. Register it in the
nearest downstream aggregator (`Orchestration.ts`, `Projection.ts`, `Routes.ts`, `Runtime.ts`, or
`index.ts`). If the public protocol changes, add its schemas to the corresponding contracts
downstream fragment. Adding a feature should not require another feature-specific import in an
upstream module.

Only add a new upstream hook when the feature cannot be expressed by an existing contribution. A
hook should accept or return upstream domain types, keep feature vocabulary on the downstream side,
and be covered by a focused compatibility test.
