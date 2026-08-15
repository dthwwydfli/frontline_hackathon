# PLD-04 — Frontend Contract

Handoff for a future frontend agent. Build UI against this document and the exported types from `@common-thread/core/browser`. Do **not** call Core Bluetooth, Web Bluetooth, or invent mesh APIs.

Browser code imports the `./browser` entry, not the package root: the root barrel
re-exports `SqliteEventStore` (better-sqlite3) and `PhoneBridgeMeshTransport`
(the `ws` package), which cannot be bundled for a browser.

## Read models

### `MaterialisedThread`

```ts
{
  threadID: string;           // UUID
  area: string;
  status: "Open" | "Matched" | "Resolved";
  root: {
    eventID: string;
    authorPeerID: string;
    type: "request" | "offer" | "update";
    title: string;
    text: string;
    roughPlace: string;
    category: string;
    expiresAt?: string;       // ISO-8601
    createdAt: string;
  };
  replies: Array<{
    eventID: string;
    authorPeerID: string;
    text: string;
    createdAt: string;
  }>;
  acceptedOfferEventID?: string;
  acceptedOfferAuthorPeerID?: string;
  resolutionNote?: string;
  safetyWarnings: ContentSafetyWarning[];  // aggregated from root + replies
}
```

Expiry reduces prominence (e.g. sort/filter); it does not delete history.

### `ContentSafetyWarning`

```ts
{
  code: "phone" | "email" | "address_like" | "coordinates" | "medical_detail" | "length";
  message: string;
  span?: { start: number; end: number };
}
```

Warnings are advisory for presentation. Hard rejects (schema, length > 300, auth) never reach materialised state.

### `PrivateContactGateResult`

```ts
{
  allowed: boolean;
  peerID?: string;            // eligible peer for encrypted DM — never phone/email
  reason?: string;            // machine-readable denial code
}
```

## Commands (intents)

Frontend calls `CommonThreadService` (or a thin façade). Each command builds a `CommonThreadEvent`, runs safety + authoriser, persists, and publishes via transport.

| Intent | Produces kind | Notes |
|--------|---------------|-------|
| `createRequest` / `createOffer` / `createUpdate` | `thread.created` | New `threadID` + `eventID` |
| `reply` | `thread.reply.created` | Same `threadID` |
| `acceptOffer` | `thread.offer.accepted` | Only root author; references offer `eventID` |
| `resolve` | `thread.resolved` | Only root author |
| `shareGuidance` | `guidance.shared` | Optional area bulletin |

## Delivery UI rules

- Show upstream delivery / outbox state only.
- Never display “delivered to all”, “they are safe”, or “EMS contacted”.
- If bridge disconnected: show “Phone bridge offline” — do not fake mesh progress.
  On the LAN transport the equivalent is `Mesh offline — N queued`, read from
  `LanRelayMeshTransport.status`.
- Never label the LAN transport as Bluetooth. A browser cannot act as a BLE
  peripheral; the radio is Wi-Fi.

## Change notification

`CommonThreadService.subscribe(listener)` fires after every accepted inbound
ingest and every local publish. Re-materialise from `listMaterialisedThreads()`
on that signal — do not poll, and do not keep a parallel copy of events in
component state.

## Private chat

1. Call `PrivateContactGate.evaluate(...)`.
2. If `allowed`, hand `peerID` to the companion’s existing encrypted private-message path (via bridge), not to a public event.

## What frontend must not do

- Scan/advertise BLE
- Store contact details in CT events
- Mutate or delete historical events because status changed
- Bypass authoriser for “just this once” edits
