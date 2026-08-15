# Hotspot demo runbook

Getting judges onto the mesh from their own phones, in about two minutes.

## Why a hotspot

Venue and guest Wi-Fi almost always enable **AP client isolation** — devices can
reach the internet but not each other. The mesh is device-to-device, so it dies
on that kind of network. A phone hotspot is a small network you control, with
isolation off.

## Capacity: 4 judges

**iPhone Personal Hotspot allows 5 connected devices.** The laptop takes one
slot, which leaves **4 phones**. Android hotspots vary between 8 and 10, so if a
judge has an Android phone, use theirs and you get more headroom.

Plan for 4. A 5th phone will silently fail to join the hotspot, and it looks
like your app broke when it did not.

## Before the judges arrive

1. **iPhone → Settings → Personal Hotspot → Allow Others to Join: on.**
   Set a simple password you can read aloud. Write the network name and password
   somewhere visible.
2. **Join the laptop to that hotspot.** This matters — the laptop must be *on*
   the hotspot, not on venue Wi-Fi. Turn venue Wi-Fi off entirely so macOS does
   not silently switch back.
3. **Keep the hotspot phone plugged in.** Hotspot plus screen-on drains fast, and
   if that phone sleeps the whole demo drops.
4. **Ask judges to install Expo Go beforehand** — App Store or Play Store. It is
   a ~100 MB download and the hotspot is your only bandwidth.

## Running it

```bash
cd apps/native
pnpm demo
```

That script does three things you would otherwise get wrong:

- finds the hotspot address (`172.20.10.x` on iOS, `192.168.4x.x` on Android)
  rather than whatever interface macOS lists first
- starts the relay on that address
- starts Metro with `REACT_NATIVE_PACKAGER_HOSTNAME` pinned to it, so the QR
  encodes the hotspot address

It prints the address it chose. Confirm it looks like a hotspot address before
you hand out the QR:

```
 Network : iPhone hotspot
 Host    : 172.20.10.2
 Relay   : ws://172.20.10.2:17833
```

If it says **"Wi-Fi (may block device-to-device traffic)"**, the laptop is on
the wrong network. Fix that before continuing.

## What each judge does

1. Join the hotspot.
2. Open Expo Go and scan the QR in the terminal. iPhone: the Camera app also
   works.
3. Tap **Enable nearby communication** → **Continue** (Expo Go cannot do
   Bluetooth; see below).
4. Type a name → **Join**.

They land on Nearby and appear in everyone else's peer strip within a second or
two. Anything one person posts shows up on every other phone.

## Do not use `--tunnel` for this

A tunnel carries the app bundle but not the relay port. Phones will load the UI
and then never mesh. Tunnel is only for getting the app onto a phone that cannot
share a network with the laptop.

## What to say about Bluetooth

Be straight about it — a judge who pokes at this will find out anyway, and the
honest version is a better answer:

> The mesh runs over Bluetooth LE on a native build. This demo runs the
> identical stack over the local network, because Expo Go cannot load custom
> native code — its native half is fixed when Expo builds it.

That is true and checkable. The transport is chosen at runtime in
`apps/native/src/hooks/useNearbyMesh.ts` by `isNearbyBleAvailable()`; everything
above it — envelopes, HMAC signatures, fragmentation, the reducer, the SQLite
store — is the same code either way. The BLE module is real: ~1500 lines of
CoreBluetooth and Android BLE in `apps/native/modules/nearby-ble/`.

Claiming live Bluetooth here would fall apart the moment someone turned
Bluetooth off and the demo kept working.

## Demo script (about 90 seconds)

1. Two judges join. Point at the peer strip filling in.
2. Judge A posts a request — "Need drinking water, Block B".
3. It appears on every phone. Note the label: **"Waiting for nearby peer"**, then
   **"Shared with a nearby peer"** once another device has written it to disk.
   There is deliberately no "Delivered" — nothing in the system can observe one.
4. Judge B opens it and taps **Send as an offer instead**.
5. Judge A accepts. Status flips to **Offer accepted** on every phone. Only the
   author sees the Accept button — the reducer enforces that, not the UI.
6. Type a phone number into a post. The safety warning appears and requires a
   second tap. It warns, it never blocks.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| "There was a problem running the requested app" | Phone not on the hotspot | Join the hotspot, rescan |
| App loads, mesh says not connected | Laptop on venue Wi-Fi, not hotspot | Turn Wi-Fi off, rejoin hotspot, rerun `pnpm demo` |
| 5th phone cannot join | iPhone hotspot caps at 5 devices | Use an Android hotspot, or rotate phones |
| Peers appear then vanish | Hotspot phone slept | Plug it in, keep the screen awake |
| `Unable to resolve module` | Metro cache | `npx expo start --go --clear` |
| Everything stalls after a while | Metro lost the phone | Shake phone → Reload |

## Reset between groups

Me → **Clear local data** wipes this phone's history. Restarting `pnpm demo`
clears the relay backlog, so a fresh group starts on an empty board.
