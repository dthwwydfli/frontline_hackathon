# PLD-01 — Product Overview

## Product

**Common Thread** is an offline-first mutual-aid layer for local communities during power cuts and distress events. Neighbours post requests, offers, and updates over a Bluetooth Low Energy (BLE) mesh. No accounts, no cloud, no internet required for the core loop.

## Problem

When power or mobile data fails, people still need local help: a spare torch, a check on an elderly neighbour, a shared update about a blocked road. Centralised apps go dark with the network. Common Thread keeps coordination local and radio-reachable.

## Solution shape (this repo)

| Layer | Role |
|-------|------|
| `packages/common-thread-core` | TypeScript domain, persistence, authorisation, content safety, tests |
| Phone companion (bitchat fork) | BLE mesh transport in the middle |
| Web frontend (later) | UI only — consumes PLD-04 contracts |

Browsers never own Core Bluetooth. The phone is the radio.

## In scope (backend phase)

- Append-only versioned public events
- Deterministic thread materialisation
- Local SQLite persistence with dual-key deduplication
- Offline content-safety warnings (flag, do not silently strip)
- Private-contact gate into upstream encrypted DMs (peer ID only)
- Docs and runbooks for frontend and physical mesh demo

## Out of scope / non-goals

- Any claim that emergency services were contacted
- Guarantees that a message was delivered or that another user is “safe”
- Cloud sync, REST APIs, or public WebSocket servers
- Rewriting bitchat BLE, Noise, TTL, fragmentation, or relay policy
- Android implementation (see `ANDROID_PORT_NOTES.md`)
- Frontend UI (handoff: `PLD-04-frontend-contract.md`)
- CRDTs or a global ordering service for this MVP

## Success for a distress demo

Three phones, data and Wi‑Fi internet off: A creates a request, B relays, C offers, A accepts → all reachable phones materialise one request, one offer, one **Matched** state. Private chat opens only after a valid accept and Noise availability.
