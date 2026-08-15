# Code Map

## New modules (this repo)

| Path | Role |
|------|------|
| `docs/PLD-01-product-overview.md` | Product / non-goals |
| `docs/PLD-02-architecture.md` | Hybrid topology |
| `docs/PLD-03-event-protocol.md` | Event schema |
| `docs/PLD-04-frontend-contract.md` | Frontend handoff |
| `docs/PLD-05-phone-bridge.md` | Loopback WebSocket protocol |
| `docs/ANDROID_PORT_NOTES.md` | Android documentation only |
| `docs/PHYSICAL_MESH_DEMO_RUNBOOK.md` | Three-phone demo |
| `docs/CODE_MAP.md` | This file |
| `TODOS.md` | Deferred work |
| `packages/common-thread-core/` | TypeScript domain backend |
| `companion/ios-bridge/` | Bridge integration notes + Swift stub |

### `packages/common-thread-core` source

| File | Responsibility |
|------|----------------|
| `src/Domain/CommonThreadEvent.ts` | Event types, encode/decode, length limits |
| `src/Domain/ThreadState.ts` | Status + materialised thread types |
| `src/Domain/ThreadReducer.ts` | Pure ordered-event → materialised thread |
| `src/Domain/EventAuthoriser.ts` | Schema, area, auth, references |
| `src/Domain/ContentSafetyPolicy.ts` | Offline privacy pattern warnings |
| `src/Persistence/CommonThreadEventStore.ts` | Store interface |
| `src/Persistence/SqliteEventStore.ts` | SQLite append-only store |
| `src/Transport/CommonThreadMeshTransport.ts` | Transport protocol + received type |
| `src/Transport/InMemoryMeshTransport.ts` | Test / three-node simulation |
| `src/Transport/PhoneBridgeMeshTransport.ts` | Loopback WebSocket adapter |
| `src/Services/CommonThreadService.ts` | Orchestration |
| `src/Services/PrivateContactGate.ts` | DM eligibility |
| `src/index.ts` | Public exports |

### Tests

| File | Covers |
|------|--------|
| `tests/CommonThreadEventTests.ts` | Encode/decode, length |
| `tests/ThreadReducerTests.ts` | Request/reply/accept/resolve |
| `tests/EventAuthoriserTests.ts` | Non-creator, out-of-area, malformed |
| `tests/EventStoreTests.ts` | Dual-key dedup, restart |
| `tests/ContentSafetyPolicyTests.ts` | Privacy warnings |
| `tests/PrivateContactGateTests.ts` | Gate before/after accept |
| `tests/MeshSimulationTests.ts` | Three-node in-memory mesh |

## Test commands

```bash
pnpm install
pnpm test
# or:
cd packages/common-thread-core && pnpm test && pnpm build
```

Verified: 19 unit tests passing (Vitest). JSON Schema: `docs/schemas/common-thread-event.schema.json`.

## Upstream bitchat files relied upon (companion fork)

Do not rewrite these; wrap them:

| Upstream path (bitchat) | Use |
|-------------------------|-----|
| `bitchat/Services/BLE/BLEService.swift` | Central/peripheral lifecycle; `sendMessage`; `myPeerID` |
| `bitchat/Services/BLE/BLEPublicMessageHandler.swift` | Public mesh ingress |
| `bitchat/Services/BLE/BLEPublicMessagePolicy.swift` | Public payload policy |
| `bitchat/Services/BLE/BLEFragmentHandler.swift` | Fragmentation |
| `bitchat/Services/BLE/BLERouteForwardingPolicy.swift` | Relay / TTL |
| `bitchat/Services/Transport.swift` | `sendMessage`, Noise session, `canDeliverSecurely` |
| `bitchat/Noise/NoiseSessionManager.swift` | Encrypted private sessions |
| `bitchat/ViewModels/ChatViewModel.swift` | `handlePublicMessage` CT1: fan-in (patched) |
| `bitchat/App/AppRuntime.swift` | Bridge start (patched) |
| `bitchat/CommonThread/*.swift` | Loopback WebSocket bridge + adapter |
| `bitchat/Protocols/Packets.swift` | Packet framing |
| `bitchat/Protocols/MeshMessageIdentity.swift` | Message identity / dedup |

## Companion status (2026-08-15)

- Local clone: `companion/ios-bridge/bitchat-fork/` (gitignored)
- Bridge listens on `ws://127.0.0.1:17832` when the forked app is running
- Physical radio validation still required on three iPhones

## Assumptions

1. Companion binds WebSocket to `127.0.0.1:17832` only.
2. MVP area is `riverside-estate`.
3. Nostr / internet fallback is disabled or unused for the offline demo path.
4. Frontend is out of scope for this phase.

## Unresolved platform limitations

1. Clock skew on `createdAt` ordering across devices.
2. Background BLE behaviour on iOS must be verified on hardware before promising background operation.
3. Android not implemented.
4. Web runtime still needs a way to reach loopback on a physical phone (same-device WKWebView / local companion pairing) — document when frontend lands.
