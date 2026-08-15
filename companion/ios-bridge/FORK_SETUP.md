# Private bitchat fork setup

Common Thread does not vendor upstream mesh sources. Create a **private** fork, then wire `CommonThreadBridgeServer.swift`.

## Steps

1. On GitHub: Fork https://github.com/permissionlesstech/bitchat to a **private** repository you own.
2. Clone beside or into the ignored path:

```bash
git clone git@github.com:<you>/bitchat.git companion/ios-bridge/bitchat-fork
```

3. Add `CommonThreadBridgeServer.swift` (or copy from this folder) into the fork’s app target.
4. In the fork, implement the `Hooks` using existing APIs — do not rewrite BLE:

| Hook | Upstream seam (typical) |
|------|-------------------------|
| `publishPublicWire` | Public send path via `BLEPublicMessageHandler` / `PublicChatModel` |
| inbound `CT1:` | Public receive pipeline → emit bridge `public_event` |
| `canOpenPrivate` | `NoiseSessionManager` established session check |

5. Bind WebSocket to `127.0.0.1:17832` only (see `docs/PLD-05-phone-bridge.md`).
6. For offline demos, avoid Nostr internet fallback.
7. Retain upstream Bluetooth usage descriptions and tests; run physical demo per `docs/PHYSICAL_MESH_DEMO_RUNBOOK.md`.

`companion/ios-bridge/bitchat-fork/` is gitignored so the private fork is not pushed to this repo by accident.
