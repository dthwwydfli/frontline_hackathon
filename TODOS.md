# TODOS

Deferred outside the backend MVP:

- [x] Wire bitchat clone + loopback BridgeService (mesh send / CT1 receive / Noise gate)
- [ ] Build companion on three physical iPhones and run `docs/PHYSICAL_MESH_DEMO_RUNBOOK.md`
- [ ] Push companion changes to a **private** GitHub fork of bitchat
- [x] Web frontend (consume `docs/PLD-04-frontend-contract.md`) — phone-frame UI on a LAN relay
- [x] IndexedDB `CommonThreadEventStore` for pure-browser persistence
- [ ] Same-device WKWebView so the web UI can reach the companion's loopback bridge
- [ ] Verify background BLE on physical iPhones
- [ ] Android native port (`docs/ANDROID_PORT_NOTES.md`)
- [ ] Service worker + web manifest so a device that drops the hotspot keeps the app cached
- [ ] CRDT / global ordering (explicitly out of MVP)
