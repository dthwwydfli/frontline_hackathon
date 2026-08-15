# Common Thread

Offline mutual-aid backend for local communities during power cuts and distress events.

## Architecture

TypeScript domain core + iPhone BLE mesh companion 
See `docs/PLD-02-architecture.md`.

Two radios, one domain. The web app runs the same core over a local-network
relay; the phone companion runs it over BLE. `CommonThreadMeshTransport` is the
seam, and both adapters speak the same PLD-05 frames.

## Run it

```bash
pnpm install
pnpm test          # 42 tests: domain, store, mesh simulation, LAN mesh end-to-end
pnpm demo          # build + serve the web app with the LAN mesh relay
pnpm dev           # same, with HMR
```

`pnpm demo` prints a LAN join URL. Open it on the laptop for the QR panel; scan
it from a phone on the same network to join the mesh.

## Docs

- [`docs/ARCHITECTURE_TRUTH.md`](docs/ARCHITECTURE_TRUTH.md) — what is true, what is measured, what is not claimed
- [`docs/WEB_DEMO_RUNBOOK.md`](docs/WEB_DEMO_RUNBOOK.md) — QR + hotspot demo, no install, no internet
- [`docs/PLD-04-frontend-contract.md`](docs/PLD-04-frontend-contract.md) — frontend contract
- [`docs/PLD-02-architecture.md`](docs/PLD-02-architecture.md) — both topologies
- [`docs/PHYSICAL_MESH_DEMO_RUNBOOK.md`](docs/PHYSICAL_MESH_DEMO_RUNBOOK.md) — three-iPhone BLE demo

**The web demo is not Bluetooth.** A browser cannot advertise as a BLE
peripheral, so browsers can never discover each other over BLE. The web app
carries CT1 payloads over a local network with no internet uplink; BLE lives in
the companion and still needs Xcode.
