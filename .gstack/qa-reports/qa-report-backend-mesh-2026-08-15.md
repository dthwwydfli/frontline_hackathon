# QA Report — Common Thread Backend Mesh

- **Date:** 2026-08-15
- **Mode:** Backend / unit (diff-aware; no browser URL)
- **Branch:** main
- **Framework:** Vitest + `@common-thread/core`
- **Duration:** ~5 min (suite ×3)

## Summary

| Metric | Value |
|--------|-------|
| Health (backend suite) | **95 → 100** after fix |
| Tests | **19/19 pass** (3 consecutive runs) |
| Issues found | 1 |
| Fixed | 1 verified |
| Deferred | Real BLE / physical mesh |

**PR one-liner:** QA found 1 flaky mesh-sim failure, fixed 1, suite 18/19 → 19/19; live BLE still deferred.

## Verdict

| Layer | Result |
|-------|--------|
| Domain / reducer / store / gates | Pass |
| In-memory three-node mesh | Pass (after ISSUE-001) |
| Loopback phone-bridge fixture | Pass |
| Real Bluetooth multi-hop | **Not verified** — companion stub, no bitchat fork, port 17832 closed |
| Browser UI QA | N/A — no mesh UI runtime |

## Issues

### ISSUE-001 — Three-node mesh sim left status Open (high / functional)

- **Before:** `MeshSimulationTests` expected `Matched`, got `Open` (flake).
- **Cause:** `drainOnce` used `Promise.race` + 50ms timeout; abandoned `AsyncIterator.next()` waiters stole later relays.
- **Fix:** `InMemoryMeshTransport.drainPending()` + rewrite test (no timeouts).
- **Status:** verified
- **Commit:** `a2103b1`
- **Files:** `packages/common-thread-core/src/Transport/InMemoryMeshTransport.ts`, `packages/common-thread-core/tests/MeshSimulationTests.ts`

### Deferred — Live BLE mesh

- Companion `CommonThreadBridgeServer.swift` still TODO-hooked.
- No private bitchat fork in tree.
- Follow `companion/ios-bridge/FORK_SETUP.md` + `docs/PHYSICAL_MESH_DEMO_RUNBOOK.md` on three physical iPhones.

## Top 3 things to fix (remaining)

1. Wire private bitchat fork + loopback bridge (real radio).
2. Run physical three-phone demo runbook offline.
3. Frontend against `docs/PLD-04-frontend-contract.md` (out of backend scope).

## Console / links

N/A (no browser app under test).

## Baseline

See `baseline.json` in this directory.
