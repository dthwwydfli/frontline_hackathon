# Physical Mesh Demo Runbook

All steps use **real iPhones**. Do not treat iOS Simulator BLE as proof.

## Preconditions

1. Three iPhones (A, B, C) with the companion build (bitchat fork + Common Thread bridge).
2. Bluetooth on; Location permission granted if required by OS for BLE.
3. **Disable mobile data** and **disable Wi‑Fi internet** (Wi‑Fi off, or no route to internet). Mesh must be radio-only.
4. Keep the companion **foreground-first** unless background BLE has been verified on device.
5. Info.plist retains upstream Bluetooth usage descriptions from bitchat.

## Script

1. Place phones so A ↔ B ↔ C (B is between A and C; A and C may be out of direct range if testing relay).
2. **Phone A** creates a Common Thread **request** (via web core → bridge, or companion test hook).
3. **Phone B** remains powered and in range to **relay** mesh traffic (no special UI action if upstream relay is automatic).
4. **Phone C** receives the request, posts an **offer** (public `thread.created` with `type: offer`, or reply flow as implemented).
5. **Phone A** sends `thread.offer.accepted` for that offer.
6. **Confirm** on every reachable phone: exactly **one** request root, **one** accepted offer path, status **Matched**. No duplicate materialised threads from relays.
7. Move **Phone C** out of range. On A (or B), create an **update** event. Restore C’s proximity. Verify upstream **public-history synchronisation** or store-and-forward brings C up to date without duplicating `eventID`s.

## Pass / fail

| Check | Pass criteria |
|-------|----------------|
| Offline | No reliance on internet for the loop |
| Dedup | Relays do not double-apply state |
| Auth | Non-creator cannot accept/resolve |
| Private gate | Encrypted DM path blocked until accept + Noise ready |
| Sync | Out-of-range node catches up without history rewrite |

## Failure reporting

If a message is missing, show only companion/upstream delivery state (`queued` / `sent` / `failed` / `unknown`). Do not claim delivery or safety.
