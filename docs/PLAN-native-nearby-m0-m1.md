<!-- /autoplan restore point: ~/.gstack/projects/dthwwydfli-frontline_hackathon/main-autoplan-restore-20260815-161735.md -->

# PLAN — Common Thread Native Nearby (M0 + M1)

Source: "Common Thread — Product Requirements Document: Expo Native Nearby
Peer-to-Peer Direction" (Manus AI, v1.0) plus "Strict No-Wi-Fi Browser Messaging:
Transport Evidence".

Status: **DRAFT — under /autoplan review**

---

## 1. Product decision

Common Thread moves from a browser-based local support feed to an installed,
native mobile resilience network. Once participants install the app and approve
Bluetooth access, they must exchange nearby text messages with Wi-Fi and mobile
data turned off.

Core product statement: Common Thread helps people nearby communicate and
coordinate when the internet, mobile data and shared Wi-Fi are unavailable.

Implementation scope: **native mobile app only**. Do not extend or redesign the
existing web application (`apps/web`).

## 2. Milestone scope for this plan

Only **M0 (native shell)** and **M1 (one-hop)**.

| Milestone | Scope | Exit criterion |
|---|---|---|
| M0 | Expo project, EAS distribution, local identity, permissions | App installs on one iPhone and one Android device |
| M1 | Native central/peripheral transport, plain text envelope | Two real phones exchange a message with Wi-Fi and mobile data off |

M2 (durable event layer), M3 (relay), M4 (support workflow) and M5
(demonstration rehearsal) are out of scope for this plan but their contracts are
designed for here so M1 does not have to be rewritten.

## 3. Non-goals

Anonymous global discovery, cloud accounts, maps, live location tracking,
images or files, voice calls, payment, medical triage, emergency-service
dispatch, background reliability guarantees, Wi-Fi Direct, cloud
synchronisation, and any claim of 40-50 concurrent phones before a physical load
test.

## 4. Distribution and onboarding

- Expo application shell, distributed as a **real native build**. Expo Go is
  prohibited — it cannot contain the custom native Bluetooth modules.
- iOS: TestFlight. Android: signed APK via EAS internal distribution.
- Expo project id: `79cb9fa9-f977-40dc-a5cc-6b406d2888a0`.

First-run flow:

1. Open app.
2. Plain-language explanation of why Bluetooth is needed.
3. User taps "Enable nearby communication".
4. Request Bluetooth permissions. On Android 12+ request `BLUETOOTH_SCAN`,
   `BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT` (runtime, Nearby Devices).
5. Check hardware support and adapter state.
6. Create or restore a local pseudonymous device identity.
7. Enter a short display name and join the event room via event code or QR.

Refusal must be recoverable: explain what is unavailable and offer retry after
the user changes system settings. Never claim active mesh status when permission
is denied.

## 5. Architecture

```
Common Thread app
├── Expo / React Native application layer
│   ├── Threads, requests, offers, replies and resolution state
│   ├── Local persistence and outbox
│   ├── Event validation and thread reducer
│   └── Nearby transport interface
│
├── iOS native Bluetooth module
│   ├── CoreBluetooth central scan and connection
│   ├── CoreBluetooth peripheral advertising and GATT service
│   └── Characteristic write and notify path
│
└── Android native Bluetooth module
    ├── BLE scan and advertising
    ├── GATT client and GATT server
    └── Characteristic write and notify path
```

Do not rely on browser APIs, Web Bluetooth, WebRTC, a local Wi-Fi access point,
a Python WebSocket server or cloud infrastructure for the peer-to-peer
demonstration.

### 5.1 Transport interface

One platform-neutral TypeScript interface. All product code uses it; no product
code calls native Bluetooth APIs directly.

```ts
export interface NearbyMeshTransport {
  start(roomId: string): Promise<void>;
  stop(): Promise<void>;
  broadcast(envelope: MeshEnvelope): Promise<void>;
  onEnvelope(listener: (envelope: MeshEnvelope, fromPeerId: string) => void): () => void;
  onPeerChange(listener: (peers: PeerPresence[]) => void): () => void;
  getStatus(): Promise<MeshStatus>;
}
```

Each platform module must make the phone both discoverable and able to discover
others. A central-only library such as `react-native-ble-plx` is insufficient
alone because it does not establish every phone as an advertising peer.

### 5.2 Room joining and event security

One event-bounded room. Organiser creates a room ID and a high-entropy room
secret before the demonstration, distributed via pre-event join QR, deep link or
organiser-assisted setup while internet is still available.

- Store the room secret in platform secure storage.
- Envelopes carry the room ID, never the room secret.
- `signature` is an HMAC over canonical serialised envelope fields using the
  room secret. It proves the sender joined the room. It is **not** identity
  verification and must never be described as such.
- Reject any envelope with an invalid room ID, MAC, protocol version, expiry or
  length. A malformed BLE packet must never reach the thread reducer or the UI.

### 5.3 Message envelope

```ts
type MeshEnvelope = {
  version: 1;
  messageId: string;
  roomId: string;
  senderId: string;
  createdAtMs: number;
  expiresAtMs: number;
  hopCount: number;
  maxHops: number;
  type: 'thread.created' | 'thread.reply' | 'offer.accepted' | 'thread.resolved' | 'presence';
  payload: Record<string, unknown>;
  signature: string;
};
```

`maxHops` default 2. Increase only after a physical test shows acceptable
traffic and battery behaviour. Every envelope needs a unique message ID, strict
expiry, deduplication and a maximum payload size.

### 5.4 BLE framing and peer acknowledgement

Do not assume an envelope fits in one characteristic operation. Define a binary
or compact JSON framing layer carrying protocol version, message ID, fragment
index, total fragment count, declared message size and an integrity check.
Reassemble only complete messages under a strict maximum size and a short
assembly timeout. Drop incomplete, oversized or conflicting fragment sets.

Direct-peer acknowledgement fires after a complete valid envelope is **persisted**
by the receiving peer. It means only that the directly connected peer accepted
the message. It is not evidence that every nearby participant received it.

### 5.5 Relay behaviour (designed now, shipped in M3)

On receiving an unseen valid envelope for the same room:

1. Verify protocol version, room ID, expiry, signature and payload bounds.
2. Reject if the message ID is already in the local seen-event store.
3. Persist locally before presentation or forwarding.
4. Deliver to the thread reducer.
5. If `hopCount < maxHops`, rebroadcast to eligible nearby peers except the
   immediate sender.
6. Increment `hopCount` only in the forwarded copy.

Bounded flooding, not optimised routing. Label as experimental until physical
tests pass.

### 5.6 Local storage and durable outbox

`expo-sqlite` (or another native durable store) for the event log, seen IDs,
local identity, room metadata and outbound queue. The outbox must never live
only in JavaScript memory.

When a participant creates an event with no peer connected:

1. Write the event and `pending` delivery state in one database transaction.
2. Add it to the persisted outbound queue.
3. Display it locally as **Waiting for nearby peer**, not as sent.
4. Retry only when the transport reports an eligible peer.
5. Remove from the transport outbox only after a directly connected peer sends a
   valid persistence acknowledgement.
6. Mark application-visible state **Shared with a nearby peer**, never
   "delivered to everyone".
7. Retain the event record after first-hop acknowledgement, deduplicating any
   relayed copy that returns to the sender.

## 6. Product behaviour

| Event type | Required data | Public visibility |
|---|---|---|
| Support request | Short title, category, approximate place, optional expiry | Room participants |
| Reply | Thread ID and short text | Room participants |
| Offer | Thread ID and short description | Room participants |
| Offer accepted | Offer ID | Room participants, no contact details |
| Resolved | Thread ID and optional short outcome | Room participants |

### Privacy and safety constraints

Public posts must not include exact addresses, personal phone numbers, email
addresses, location coordinates, medical records or identity documents. Local
pattern warnings run before a public send. Contact details are exchanged only
after a request owner accepts an offer, and only through an explicitly initiated
private nearby conversation.

Fixed notice, always visible:

> Common Thread is not an emergency service. If there is immediate danger, use
> any available official emergency channel.

No promised or simulated emergency-service connection. No recommendation about a
user's safety, medical needs or legal obligations.

## 7. Required physical validation

No mesh claim is accepted from unit tests alone. Real phones, Wi-Fi and mobile
data disabled.

| Test | Setup | Pass condition |
|---|---|---|
| One-hop delivery | A and B nearby | A's request appears once on B within the demo target |
| Two-hop relay | A and C out of range, B between | A's request appears once on C through B |
| Duplicate rejection | A's message reaches C by two paths | C presents one event only |
| Rejoin | B stops and restarts transport | B reconnects, does not duplicate stored events |
| Durable outbox | A posts with no peer, restarts app, then finds B | B receives the queued request once |
| Permission refusal | Bluetooth denied | App explains recovery, claims no active mesh |
| Mixed-platform | At least one iPhone and one Android | Result recorded honestly; failure blocks the cross-platform claim |
| Scale | 3, 5, 10, then more physical devices | Document delivered messages, duplicates, latency, battery |

First public demonstration is ready only after one-hop, two-hop, duplicate
rejection and durable-outbox tests pass. This plan (M0+M1) targets one-hop only.

## 8. Automated test scope for M0 + M1

- Envelope validation (version, room, expiry, bounds)
- HMAC signature validation, including rejection of a wrong-room secret
- Fragmentation and reassembly, including oversized, incomplete and conflicting
  fragment sets
- Deduplication by message ID
- Expiry handling
- Thread reduction

## 9. Risks and explicit decisions

| Risk | Required response |
|---|---|
| iOS and Android BLE behaviour differs | Test each platform separately before a mixed-device claim |
| BLE advertising or GATT server missing from a candidate library | Implement or bridge the missing native module. Do not fake peer presence |
| Background restrictions interrupt relay | Foreground-first demo. Background relay is later work |
| Participant install friction | Send install link before the event, reserve time for permission onboarding |
| TestFlight preparation late | Upload build and complete review before the event; keep tested backup devices |
| New mesh library claims unverified | Audit its actual native adapter; require physical three-device proof |
| Audience-scale claim unproven | State only the largest physically tested cohort |

## 10. Explicit build instruction

Implement as a new Expo native mobile project. Do not modify the existing web
app or reuse its UI. Expo with custom native modules and a real development or
preview build, never Expo Go. Start with M0 and M1 only. Report every
unavailable native capability as a blocker, not a mocked success.
