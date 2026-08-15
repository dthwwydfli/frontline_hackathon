# Native Nearby Runbook (M0 + M1)

Physical-device procedure for `apps/native`. Nothing in this document is
satisfied by unit tests or by a simulator.

**iOS Simulator and Android emulator have no BLE radio.** A green test run
proves the protocol layer is self-consistent. It proves nothing about whether
two phones can talk.

---

## What has been built

| Layer | State |
|---|---|
| `NearbyMeshTransport` interface | Written, `apps/native/src/mesh/NearbyMeshTransport.ts` |
| Envelope + HMAC + canonical serialisation | Written and unit-tested (38 tests) |
| BLE fragmentation and reassembly | Written and unit-tested (65 tests) |
| SQLite event log, seen ids, durable outbox | Written and unit-tested (16 tests) |
| Thread reducer, order-independent | Written and unit-tested (19 tests) |
| Content warnings, join payload | Written and unit-tested (29 tests) |
| iOS CoreBluetooth central + peripheral | Written, **never compiled** |
| Android BLE scan/advertise + GATT client/server | Written, **never compiled** |
| One-hop delivery between two phones | **Not verified** |

202 unit tests pass via `pnpm --filter @common-thread/native test`.

---

## Prerequisites (M0)

These are hard gates. If any is missing, M1 cannot be attempted and should be
reported as blocked rather than worked around.

1. A Mac with Xcode installed, for the iOS build.
2. A paid Apple Developer Program membership, for provisioning a device build.
3. At least one physical iPhone and one physical Android phone.
4. Android Studio or the Android SDK platform tools, for `adb install`.
5. Node 20+, pnpm 9+.

Expo Go cannot be used. It does not contain the `nearby-ble` native module, so
it will fail at `requireNativeModule('NearbyBle')`.

---

## Build

```bash
pnpm install

# Generates ios/ and android/ from app.json and the local module.
pnpm --filter @common-thread/native exec expo prebuild --clean

# Device builds. Both require the device to be connected and trusted.
pnpm --filter @common-thread/native exec expo run:ios --device
pnpm --filter @common-thread/native exec expo run:android --device
```

For distribution to a small tested set of devices:

```bash
cd apps/native
npx eas-cli@latest build --profile preview --platform android   # signed APK
npx eas-cli@latest build --profile preview --platform ios       # ad hoc IPA
```

The EAS project id in `app.json` is `79cb9fa9-f977-40dc-a5cc-6b406d2888a0`.
**Verify this project exists under an account you control before relying on
it.** It came from a written brief, not from this repository.

TestFlight is deliberately off the critical path: Beta App Review can take days
and cannot be scheduled around. Use internal distribution to known devices.

---

## Create a room (do this while internet still works)

The room secret must reach every participant before the radio-only session
begins. It is never transmitted over the mesh.

In a Node REPL or a scratch script:

```js
// 32 random bytes, hex encoded.
require('crypto').randomBytes(32).toString('hex')
```

Then build the join link:

```
commonthread://join?r=<roomId>&k=<secretHex>&n=<optional room name>
```

`roomId` must match `[A-Za-z0-9._:-]{1,64}`. Render the link as a QR code, or
paste it directly into the join field on each device.

---

## Test 1: permission refusal recovers (M0)

1. Fresh install on one phone.
2. Tap **Enable nearby communication**.
3. Deny the permission.

**Pass:** the app explains that it cannot reach anyone nearby, offers a retry,
and does not show any peer count or claim an active mesh.
**Fail:** any screen implies the mesh is running.

4. Retry, and grant the permission.

**Pass:** the app moves on and reports permission granted.

---

## Test 2: one-hop delivery (M1 exit criterion)

Two phones, A and B.

1. On both: **turn Wi-Fi off and mobile data off. Leave Bluetooth on.**
   Verify no network: open a browser and confirm a page fails to load.
2. Both join the same room using the same join link.
3. Both tap **Start nearby communication**.
4. Wait for each to report at least 1 nearby participant.
5. On A, post a request: title `blankets`, place `north stairwell`.
6. Observe B.

**Pass conditions, all required:**
- The request appears on B, exactly once.
- On A the post reads **Shared with a nearby peer** (not "delivered").
- Killing and reopening B still shows the request (it was persisted, not held
  in memory).

**Record honestly:** time from post to appearance, and whether the phones were
in line of sight and at what distance.

Repeat with the roles reversed. Both directions must work; a phone that can
only receive is advertising-broken.

---

## Test 3: durable outbox across a restart

One phone, A, with no other phone nearby.

1. A joins the room and starts nearby communication. No peers present.
2. Post a request.

**Pass:** it shows **Waiting for nearby peer**. It must never read as sent.

3. Force-quit A entirely (swipe away, do not just background it).
4. Reopen A, start nearby communication.
5. Bring B into range with the app running.

**Pass:** B receives the request exactly once, and A flips to **Shared with a
nearby peer**.
**Fail:** B receives it twice, or A never leaves the waiting state.

---

## Test 4: duplicate rejection

1. A and B in range, both running.
2. A posts a request.
3. While B is still in range, stop and restart the transport on B.

**Pass:** B shows one copy of the request, not two. The seen-id index
suppresses the repeat.

---

## Test 5: mixed platform (blocks the cross-platform claim)

Repeat Test 2 with A as an iPhone and B as an Android device, then swap.

**Record the result honestly.** If it fails, the project may not claim
cross-platform support. Note specifically:
- whether the iPhone appears in the Android scan results,
- whether the Android device appears in the iPhone scan results,
- the negotiated MTU on the Android side (visible in the peer count path).

Known asymmetries to expect: iOS truncates the advertised local name
aggressively, and some Android devices report
`isMultipleAdvertisementSupported == false`, in which case the app reports
`advertising_unsupported` and that device can receive but cannot be discovered.

---

## Not yet built, do not claim

- **Two-hop relay (A -> B -> C).** `forwardedCopy` and the hop accounting exist
  and are tested, but nothing calls them yet. The relay path is M3.
- **Background operation.** The demo is foreground-first. iOS suspends
  CoreBluetooth advertising in the background in ways this build has not been
  tested against.
- **Any room-size claim.** The largest cohort physically tested is the only
  number that may be stated.
- **Sender identity.** Every room member holds the same secret, so any member
  can mint an envelope bearing any `senderId`. Messages are
  room-authenticated, not sender-authenticated. Say exactly that.

---

## Reporting a failure

State what was observed, not what was intended. If a message does not arrive,
report the peer count, the Bluetooth state, and whether `advertising` was true
on both devices. Do not report a delivery state the system cannot observe.
