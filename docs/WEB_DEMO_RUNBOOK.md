# Web Demo Runbook — QR + laptop hotspot

Live demo where an audience scans a QR code, turns their internet off, and posts
to each other in real time. No app install, no Xcode, no Bluetooth.

## What this demo is, and is not

**Is:** a real multi-device mesh over a local network with **no internet uplink**.
Every device runs the full domain stack — append-only IndexedDB store,
`EventAuthoriser`, `ContentSafetyPolicy`, `ThreadReducer` — and exchanges CT1
payloads through a relay running on your laptop.

**Is not:** Bluetooth. A browser cannot advertise as a BLE peripheral, so two
browsers can never discover each other over BLE. That is a platform limit, not a
gap in this repo. The BLE path is `companion/ios-bridge/` +
`PhoneBridgeMeshTransport`, and it still requires Xcode and physical iPhones
(see `PHYSICAL_MESH_DEMO_RUNBOOK.md`).

Say this before someone asks. The "no internet" claim is true; the "Bluetooth"
claim is not.

## Setup

### 1. A network without client isolation

**Venue, campus and office Wi-Fi will not work.** They enable AP client
isolation, which blocks phone → laptop traffic at the router. The symptom is a
scanned QR that hangs and then says *"couldn't connect to server"*, while the
laptop can reach its own LAN address fine. No code can work around it.

The server detects this and warns on start:

```
  Heads up: en0 is on a /23 managed network.
  Managed Wi-Fi usually blocks device-to-device traffic (client isolation)
```

A hotspot hands out a /24 or tighter and does not isolate clients. Two ways:

**Phone hotspot (easiest, no hardware).** On an iPhone: Settings → Personal
Hotspot → on. Join it from the **laptop**. Everyone else joins the same hotspot
(iOS allows 5 devices). Restart the server so it picks up the new address, then
re-show the QR. For the "no internet" line, turn cellular data off on the
hosting phone after everyone has joined — the mesh keeps working.

**macOS Internet Sharing.** System Settings → General → Sharing → Internet
Sharing, share **from** Ethernet/USB **to** Wi-Fi. Set a password. macOS will
not share Wi-Fi → Wi-Fi, so this needs a second interface (a USB-C dongle).

### Test reachability before trusting the QR

From the phone browser, type the join URL by hand. If that fails, it is the
network, not the app. If it loads, the QR will work.

### 2. Start the app

```bash
pnpm install
pnpm demo          # builds core + web, then serves the built app with the relay
```

Output includes the address to put on screen:

```
  Common Thread mesh relay ready — join on http://10.0.100.118:4173
```

The relay is a Vite plugin (`apps/web/relay/plugin.ts`), so one process serves
both the page and the mesh on one port. One URL, one QR, one thing to fail.

For iteration instead of demoing, `pnpm dev` runs the same setup with HMR.

### 3. Show the QR

Open the join URL on the laptop. The desktop layout puts the QR, the join URL,
and a live list of connected devices beside the phone frame. Phones that scan it
get the app full-bleed with no bezel.

## Demo script

1. **Audience joins.** They connect to your hotspot and scan the QR. First run
   asks for a nickname — stored locally, never inside an event.
2. **Say the line.** "Turn mobile data off. You are now on a network with no
   internet." (Wi-Fi stays on — that is the radio carrying the mesh.)
3. **A posts a request.** Ask → title, text, rough place, category.
4. **It appears on every other device**, and on the laptop's "On the mesh" list.
5. **B offers help.** Open the thread → Offer help → fill in.
6. **A accepts.** Only the request creator sees Accept; the authoriser rejects
   anyone else. Status flips to **Matched** on every device.
7. **Show a late joiner.** Someone scanning now still gets the full history —
   the relay replays its store-and-forward backlog on connect.
8. **Show honesty.** Post something with a phone number in it: the composer
   warns before it goes public. Point at the pill — it says `Local mesh · N
   nearby`, never "delivered".

### Optional: the offline beat

Kill the relay process mid-demo. Devices flip to `Mesh offline — 1 queued`,
posts keep working and queue locally. Restart it: they reconnect on their own
backoff and flush, with no duplicates and no refresh.

## If something breaks

| Symptom | Cause | Fix |
|---|---|---|
| Phone says "couldn't connect to server" | AP client isolation on managed Wi-Fi | Switch to a phone hotspot; watch for the `/23 managed network` warning on start |
| QR encodes an address the phone cannot reach | Laptop has several interfaces (VPN, Docker, dongle) | The banner lists every candidate; join the one matching the phone's network and restart |
| `Mesh offline` on every device | Relay not attached | Restart `pnpm demo`; check the "mesh relay ready" line printed |
| Someone sees no history | They joined before any event existed | Post one; backlog only replays what already happened |
| A device shows stale threads | Old IndexedDB from a previous run | Me → Clear local data |
| Laptop IP changed | Hotspot restarted | Restart `pnpm demo`, re-show the QR |

## What to say if asked "is this the real thing?"

The domain, ordering, authorisation, safety, dedup and store-and-forward are the
production paths — the same code the phone companion would drive, verified by
`pnpm test`. The radio is the substitution: Wi-Fi LAN today, BLE once the
companion is built. `CommonThreadMeshTransport` is the seam, and both adapters
speak the same PLD-05 frames.
