# Private bitchat fork setup

## Current workspace state

A shallow clone of upstream already lives at:

```text
companion/ios-bridge/bitchat-fork/   # gitignored
```

Common Thread bridge sources are copied into:

```text
bitchat-fork/bitchat/CommonThread/
```

and mirrored (tracked) in this folder.

## Make it your private fork (recommended)

1. On GitHub: Fork https://github.com/permissionlesstech/bitchat → **private**.
2. Point the local clone at your fork:

```bash
cd companion/ios-bridge/bitchat-fork
git remote rename origin upstream
git remote add origin git@github.com:<you>/bitchat.git
git push -u origin HEAD
```

3. Open `bitchat.xcodeproj`, set Team / `Local.xcconfig`, build to device.
4. Confirm patches from `PATCHES.md` are present after any upstream pull; re-apply if needed.
5. Run physical demo: `docs/PHYSICAL_MESH_DEMO_RUNBOOK.md`.

## Do not

- Rewrite BLE scan/advertise, TTL, fragmentation, Noise, or relay policy.
- Bind the bridge WebSocket off loopback.
- Embed private contact details in public `CT1:` events.
