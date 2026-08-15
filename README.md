# Common Thread

Offline mutual-aid backend for local communities during power cuts and distress events.

## Architecture

TypeScript domain core + iPhone BLE mesh companion (fork of [bitchat](https://github.com/permissionlesstech/bitchat)). Browsers do not own Bluetooth.

See `docs/PLD-02-architecture.md`.

## Backend package

```bash
pnpm install
pnpm test
```

## Docs for frontend

Start with [`docs/PLD-04-frontend-contract.md`](docs/PLD-04-frontend-contract.md).

## Physical demo

[`docs/PHYSICAL_MESH_DEMO_RUNBOOK.md`](docs/PHYSICAL_MESH_DEMO_RUNBOOK.md)
