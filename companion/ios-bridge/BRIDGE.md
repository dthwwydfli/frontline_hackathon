# Common Thread iOS Bridge

Thin transport companion for the hybrid architecture. **No Common Thread UI.**

## Purpose

Expose bitchat’s existing public mesh and encrypted private-message APIs over a **loopback WebSocket** so `PhoneBridgeMeshTransport` in `@common-thread/core` can publish/receive `CT1:` envelopes without owning BLE.

## Protocol

See [`docs/PLD-05-phone-bridge.md`](../../docs/PLD-05-phone-bridge.md).

Default: `ws://127.0.0.1:17832`.

## Fork setup

```bash
# Create a private fork of permissionlesstech/bitchat, then:
git clone <your-private-bitchat-fork-url> companion/ios-bridge/bitchat-fork
```

Do **not** commit upstream sources into this repo unless the fork is explicitly vendored by the team. Prefer submodule or sibling private repo.

## Integration points (wrap, do not rewrite)

- `BLEService.swift` — radio lifecycle
- `BLEPublicMessageHandler.swift` — public send/receive
- `NoiseSessionManager.swift` — `can_open_private`
- Packet TTL, fragmentation, duplicate suppression, outbox — leave upstream

## Swift stub

`CommonThreadBridgeServer.swift` sketches the server surface. Replace `TODO` hooks with calls into the forked public/private message APIs after the fork is available.

## Demo constraints

- Foreground-first
- Keep Bluetooth usage descriptions from upstream Info.plist
- Prefer mesh-only path (avoid Nostr internet fallback during offline demos)
