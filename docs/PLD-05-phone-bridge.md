# PLD-05 — Phone Bridge Wire Protocol

## Endpoint

- Default URL: `ws://127.0.0.1:17832`
- Bind: loopback only
- Purpose: local IPC between web/runtime and iOS companion

## Message envelope

All frames are JSON text messages:

```json
{
  "v": 1,
  "id": "client-msg-uuid",
  "type": "publish_public | public_event | can_open_private | can_open_private_result | delivery_state | error | hello | hello_ack",
  "payload": { }
}
```

## Client → companion

### `hello`

```json
{ "type": "hello", "payload": { "client": "common-thread-core", "protocol": 1 } }
```

### `publish_public`

```json
{
  "type": "publish_public",
  "id": "...",
  "payload": {
    "event": { /* CommonThreadEvent */ },
    "wire": "CT1:{...compact json...}"
  }
}
```

Companion publishes `wire` (or re-encodes `event`) on bitchat **public** mesh. Responds with `delivery_state`.

### `can_open_private`

```json
{
  "type": "can_open_private",
  "id": "...",
  "payload": { "peerID": "..." }
}
```

## Companion → client

### `hello_ack`

```json
{ "type": "hello_ack", "payload": { "peerID": "local-peer-id", "meshReady": true } }
```

### `public_event`

```json
{
  "type": "public_event",
  "payload": {
    "event": { /* CommonThreadEvent */ },
    "upstreamMessageID": "bitchat-message-id",
    "receivedAt": "2026-08-15T12:00:01.000Z"
  }
}
```

Decode only valid CT envelopes (`CT1:` + JSON). Ignore other public chat.

### `can_open_private_result`

```json
{
  "type": "can_open_private_result",
  "id": "...",
  "payload": { "peerID": "...", "available": true }
}
```

### `delivery_state`

```json
{
  "type": "delivery_state",
  "id": "...",
  "payload": {
    "upstreamMessageID": "...",
    "state": "queued | sent | failed | unknown"
  }
}
```

Report only these states. Do not invent “delivered to peer” unless upstream exposes that fact.

### `error`

```json
{ "type": "error", "id": "...", "payload": { "code": "bridge_error", "message": "..." } }
```

## Reconnect

Client should reconnect with backoff on close. On reconnect, send `hello` again. Domain store remains source of truth; bridge is not a second database.

## Security notes

- No TLS required on loopback for MVP; do not expose the port off-device.
- Private message bodies never travel as `publish_public` payloads.
- Companion must use existing Noise private paths for DMs.
