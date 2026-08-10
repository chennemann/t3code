# Portable client protocol

T3 Code exposes protocol version `1` for native clients that cannot or should not implement Effect RPC.
The protocol is provider-neutral: provider instance identifiers and model metadata are data, never
transport routing rules.

Support is advertised by
`ExecutionEnvironmentDescriptor.capabilities.portableClientProtocol === 1`. Clients must reject an
environment that does not advertise the exact version they implement.

## Authentication and endpoints

Portable endpoints use the same bearer access tokens and authorization scopes as the environment
HTTP API. Pairing credentials are exchanged at `POST /oauth/token`; portable reads require
`orchestration:read`, and commands sent to `POST /api/orchestration/dispatch` require
`orchestration:operate`.

- `GET /api/environment/client-config` returns the environment descriptor, auth descriptor,
  provider-instance/model catalog, completion-marker support, and protocol version.
- `GET /api/orchestration/shell` returns the authoritative project/thread shell snapshot.
- `GET /api/orchestration/threads/:threadId` returns an authoritative focused-thread snapshot.
- `GET /api/orchestration/shell/stream` streams shell projection items.
- `GET /api/orchestration/threads/:threadId/stream` streams focused-thread projection items.
- `POST /api/orchestration/dispatch` accepts the existing client orchestration command union.

## SSE and resume

Both streams require `afterSequence` and accept an optional `requestCompletionMarker` query
parameter. A client fetches a snapshot, then opens the matching stream with the snapshot sequence
as `afterSequence`.

Each item is one compact JSON object:

```text
id: 42
event: message
data: {"kind":"thread-removed","sequence":42,"threadId":"..."}

```

Snapshots and sequenced events have an `id`; synchronization markers do not. Comment keepalives
are emitted every ten seconds. Responses disable caching and common reverse-proxy buffering.

The HTTP and WebSocket transports call the same subscription implementation. It attaches live
delivery before reading replay/snapshot state, so events published during handoff are buffered.
The server suppresses any sequence at or below the applied sequence, making replay/live overlap
duplicate-safe; clients should enforce the same invariant defensively. A cursor ahead of the
authoritative head or more than 1,000 global events behind receives a fresh snapshot. Per-client
live queues are bounded; overflow terminates that client. Closing the HTTP response scope
interrupts the subscription producer.

## Contract artifacts

Versioned artifacts live in `packages/contracts/portable/v1`:

- `openapi.json`
- `protocol-version.json`
- JSON schemas for config, commands, snapshots, and both stream unions
- canonical JSON fixtures and `fixture-manifest.json`
- `artifact-manifest.json`, which covers every other generated artifact

Regenerate them or verify a checkout without writing:

```text
node packages/contracts/scripts/generatePortableClientArtifacts.ts
node packages/contracts/scripts/generatePortableClientArtifacts.ts --check
```

The fixture manifest checksum is the provenance value downstream clients should pin alongside the
T3 commit.
