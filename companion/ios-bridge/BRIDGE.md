# Common Thread ↔ bitchat bridge

## What ships

| File | Role |
|------|------|
| `CommonThreadBridgeServer.swift` | Loopback WebSocket on `127.0.0.1:17832` (PLD-05) |
| `CommonThreadBitchatAdapter.swift` | Hooks: `meshService.sendMessage` + Noise session check |
| `CommonThreadBridgeController.swift` | App lifecycle singleton |
| `bitchat-fork/` | Local clone of [permissionlesstech/bitchat](https://github.com/permissionlesstech/bitchat) (**gitignored**) |

Live BLE still runs **only** inside the bitchat fork. Common Thread never opens Core Bluetooth.

## Upstream seams used (do not rewrite)

| Concern | File / API |
|---------|------------|
| Public send | `Transport.sendMessage(_:mentions:messageID:timestamp:)` via `BLEService` |
| Public receive | `ChatViewModel.handlePublicMessage` → filter `CT1:` |
| Noise private ready | `getNoiseSessionState(for:)` / `canDeliverSecurely(to:)` |
| Local identity | `meshService.myPeerID` |
| Radio lifecycle | Existing `BLEService` / `AppRuntime` (unchanged controls) |

## Fork patches already applied in `bitchat-fork/`

1. Files under `bitchat/CommonThread/` (auto-picked by Xcode synchronized root group).
2. `AppRuntime.start()` → `CommonThreadBridgeController.shared.start(with: chatViewModel)`.
3. `ChatViewModel.handlePublicMessage` → forwards `CT1:` payloads to the bridge.

See `PATCHES.md` to re-apply if you re-clone.

## Build & run (physical iPhones)

```bash
cd companion/ios-bridge/bitchat-fork
open bitchat.xcodeproj
```

1. Set your Apple Team ID in `Configs/Local.xcconfig` (see upstream README).
2. Build **bitchat (iOS)** to three devices.
3. Keep the app **foreground**; disable cellular data and Wi‑Fi internet for the demo.
4. From a same-device web runtime (or Mac simulator talking to a Mac companion build), connect `PhoneBridgeMeshTransport` to `ws://127.0.0.1:17832`.

On a physical iPhone, the web UI must run **on that phone** (WKWebView / local page) to reach loopback — a laptop browser cannot open the phone’s `127.0.0.1`.

## Offline honesty

CT publishes use **mesh `sendMessage` only** (no Nostr/geohash path in the adapter).

## Verify without radio

Backend still uses `InMemoryMeshTransport` (`pnpm test`). Bridge fixture: `PhoneBridgeTests.ts`.
