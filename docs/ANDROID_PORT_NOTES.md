# Android Port Notes

Do **not** implement Android in the current backend phase. This document records what a future native Android port requires.

## Requirements

1. **Native Kotlin BLE** central and peripheral roles (not Web Bluetooth).
2. **GATT client and server** matching the inherited bitchat wire protocol.
3. Runtime **permissions** (Bluetooth, location as required by OS version) and **advertiser capability** checks.
4. The **same wire protocol and test vectors** as iOS bitchat / Common Thread `CT1:` envelopes.
5. **Physical device testing** on Android and mixed iOS–Android meshes.

## What not to use as multi-hop mesh

**Google Nearby Connections** provides offline direct peer-to-peer connectivity, but it is **not** this project’s multi-hop mesh transport. Multi-hop routing remains the inherited native BLE mesh layer (bitchat protocol), not Nearby.

## Suggested starting points

- Upstream: [permissionlesstech/bitchat-android](https://github.com/permissionlesstech/bitchat-android) (protocol-compatible with iOS).
- Port `common-thread-core` semantics (events, reducer, authoriser) to Kotlin **or** share the TypeScript package via a local bridge similar to the iOS companion — prefer one event schema (`PLD-03`).

## Validation

- Same physical demo steps as `PHYSICAL_MESH_DEMO_RUNBOOK.md`, with at least one Android node.
- Confirm public-history sync / store-and-forward across mixed devices.
