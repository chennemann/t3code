# Downstream modules

Fork-owned feature implementations live under `apps/server/src/downstream`, with wire schemas in
`packages/contracts/src/downstream`. Integration follows the current upstream services and V2
application event stream. Do not restore the removed V1 orchestration runtime or a second subscription
engine to preserve an older fork hook.

## Persistence and upgrades

To-do events, command receipts, and projections share the V2 core database, `statev2.sqlite`. A mutation
must commit all three in one transaction before publishing its application event. HTTP snapshots and
WebSocket hydration read to-dos in the same transaction as their application high-water mark;
otherwise a reconnect can permanently skip a change. The application replay query and its partial
index must both include the to-do aggregate.

The old fork stored to-dos in `downstream.sqlite`, and earlier versions stored `projection_todos` in
the V1 core database. Upgrade copies the sidecar rows and its legacy-import marker transactionally
into V2 core state. Copy the marker even when the sidecar is empty: falling back to the older projection
would overwrite newer edits or resurrect deleted items. The sidecar is retained as an upgrade source,
not a second live projection store.

Before upstream migrations run, the compatibility preparation removes obsolete fork migration names
from the copied core ledger. The V2 migration preserves the old recency-anchor cache so lazy thread
import can carry it into V2 thread state. New writes use V2 metadata events and the upstream thread
projection, including its JSON date codecs.

## Service boundaries

Transport handlers call the work-planning service; they do not decide commands or write projections.
The MCP planning tool uses that same service. Planning instructions travel as structured message
context and are expanded only at the provider boundary, so visible user messages and replay retain
the user's text.

Managed Workspace launches use upstream managed-folder preparation. Keep existing per-thread paths
stable during upgrades and retries. The terminal manager consumes `TerminalShellPolicy`; server
composition selects the settings-backed policy through `layerWithShellPolicy`.

`.github/downstream-integration.json` records approved upstream integration points and fork-owned
paths. Run `node scripts/check-downstream.ts` after changing those boundaries. The guard limits patch
surface growth; behavioral tests still need to cover changed upstream interfaces.
