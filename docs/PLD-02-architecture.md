# PLD-02 — Architecture

## Hybrid topology

```
┌─────────────────────────────┐
│  Web runtime (later)        │
│  Frontend → common-thread-  │
│  core → SQLite store        │
└──────────────┬──────────────┘
               │ CommonThreadMeshTransport
               │ ws://127.0.0.1:17832 (loopback only)
┌──────────────▼──────────────┐
│  iPhone companion           │
│  LocalBridge → bitchat BLE  │
└──────────────┬──────────────┘
               │ multi-hop BLE mesh
               ▼
         Other iPhones
```

## Trust boundaries

1. **Domain trust:** `EventAuthoriser` + `ContentSafetyPolicy` decide what enters materialised state. Rejected events are stored for diagnostics only.
2. **Transport trust:** Upstream bitchat identity, Noise sessions, TTL, duplicate suppression, and payload limits are authoritative. Common Thread does not re-implement crypto or radio.
3. **Bridge trust:** Loopback WebSocket is a local IPC channel. It must not bind to non-loopback interfaces for the hackathon demo.
4. **UI trust:** Frontend never calls Core Bluetooth or invents mesh behaviour. It issues domain commands and renders materialised DTOs.

## Module boundaries

| Package path | Responsibility |
|--------------|----------------|
| `Domain/` | Events, reducer, authoriser, content safety — pure, no BLE |
| `Persistence/` | Append-only store, idempotent ingest |
| `Transport/` | Adapter interface + phone bridge + in-memory test mesh |
| `Services/` | Orchestration: publish, ingest, materialise, private gate |

## Ordering model

Deterministic local order: `createdAt` ascending, then `eventID` as tie-breaker.

**Known limitation:** Real-world clock skew can reorder near-simultaneous events across devices. This MVP does not rewrite history or introduce a central clock. Document skew; do not hide it.

## Delivery semantics

When a message has not yet arrived, report only upstream delivery / outbox state from the companion. Never claim “delivered”, “user is safe”, or “emergency services contacted”.

## Persistence rules

- Valid events are immutable.
- Ingest is idempotent on both `eventID` and `upstreamMessageID`.
- Expiry may lower prominence in a future UI; it never mutates historical event rows.
- Rejected events: separate retention, bounded, never materialised.
