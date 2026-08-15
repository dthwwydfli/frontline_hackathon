# Architecture Truth

What Common Thread actually does, what it does not, and what has been measured.
Written so nobody on the team overclaims on stage, and so a judge asking a sharp
question gets a straight answer.

## One sentence

Common Thread is an offline-first mutual-aid layer whose domain logic is real
and tested, running today over a **local-network WebSocket relay** — not over
Bluetooth.

## The transports

`CommonThreadMeshTransport` has three implementations. Only one has ever moved
data between two real devices.

| Implementation | Radio | Status |
|---|---|---|
| `LanRelayMeshTransport` + `RelayHub` | Wi-Fi (local network) | **Working.** Used by the web app; verified browser-to-browser |
| `InMemoryMeshTransport` | none — in-process | Working. Test fixture only |
| `PhoneBridgeMeshTransport` + iOS companion | BLE mesh via bitchat fork | **Never compiled.** Swift written and patched into the fork; needs Xcode and physical iPhones |

## Claims, situation by situation

| Situation | What the user sees | Accurate claim |
|---|---|---|
| Internet available, app served publicly | Messages arrive live | "Connected mode" |
| No internet, but a shared local Wi-Fi with the relay running | Messages arrive live | "Live without internet" |
| One device loses the network | Cached threads still readable; new posts marked queued | "Queued on this device" |
| No network path at all | Reading and drafting only; nothing is delivered | "Offline reading and queued drafts" |

The fourth row is the honest floor. A browser with no network cannot deliver a
message to another phone by any means. There is no hidden radio.

## What is not true

- **It is not a Bluetooth mesh.** No browser implements the BLE peripheral role,
  so two browsers can never discover each other over BLE. iOS Safari has no Web
  Bluetooth at all. bitchat does BLE mesh because it is a natively installed app.
- **It does not work with no infrastructure.** Live messaging needs either a
  powered access point plus this relay, or the internet. Both need power.
- **It does not guarantee delivery.** Delivery state stops at `sent`, meaning the
  event left this device and reached the relay. Nothing claims a peer received
  it, that anyone is safe, or that emergency services were contacted (PLD-01,
  PLD-02).
- **Local HTTP is not end-to-end encryption.** Private 1:1 messaging depends on
  the companion's Noise sessions and is unavailable on the LAN transport. The UI
  says so rather than implying encryption it does not have.

## What is verified, and how

46 tests via `pnpm test`. The load figures below come from
`tests/RelayLoadTests.ts` and a direct measurement against `RelayHub`.

| Property | Evidence |
|---|---|
| Request → offer → accept reaches `Matched` on two independent devices, each with its own store | `LanMeshIntegrationTests` |
| Late joiner receives existing history | `LanMeshIntegrationTests`, `RelayHubTests` |
| Offline post queues, then flushes exactly once on reconnect | `LanMeshIntegrationTests` |
| A queued post survives a page reload and still sends | `LanMeshIntegrationTests` |
| Duplicate `upstreamMessageID` never fans out twice | `RelayHubTests` |
| Dual-key dedup on `eventID` and `upstreamMessageID` | `IndexedDbEventStoreTests`, `EventStoreTests` |
| Local events keep strictly increasing `createdAt` within a thread | `CommonThreadServiceTests` |
| Root resolution is order-independent | `CommonThreadServiceTests` |

Measured relay fan-out, one publish to every other connected client:

| Connected clients | Time for all to receive |
|---|---|
| 10 | 1.7 ms |
| 25 | 2.9 ms |
| 50 | 3.1 ms |

50 concurrent clients connect, exchange, replay a 30-event backlog to a late
joiner, and survive a third of the room disconnecting at once. **The relay is
not the capacity limit — the access point is.** An iPhone hotspot caps at 5
devices total; that is the real ceiling in a hotspot demo, not this code.

## Ordering: a deliberate limitation

Events order by `createdAt`, then `eventID` as tie-break. Clock skew across
devices can therefore reorder near-simultaneous events.

This is known and deliberate. A server-assigned global sequence would fix it on
the LAN relay, but PLD-01 lists "CRDTs or a global ordering service" as an
explicit non-goal, and a central sequencer cannot exist on a BLE mesh, which has
no central node. Adopting one would buy better ordering on one transport at the
cost of the abstraction that lets the same domain run on all three. We document
the skew rather than hide it (PLD-02).

Within a single device's own thread activity, `nextLocalCreatedAt()` forces
monotonic timestamps, so a burst of local posts never ties.

## What each demo mode requires

| Mode | Needs | Participants |
|---|---|---|
| Phone hotspot | A phone sharing its hotspot, plus this laptop | 4 guests (iPhone), ~9 (Android) |
| Access point / travel router | Any AP with client isolation off; no WAN needed | Whole room, genuinely no internet |
| Public tunnel or deploy | Internet on every device | Whole room, but it is not offline |

Managed Wi-Fi (venue, campus, office) will not work: client isolation blocks
device-to-device traffic. The server warns when it detects a wide subnet.
