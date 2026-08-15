/**
 * Browser-safe entry point.
 *
 * The default barrel (`./index.ts`) re-exports `SqliteEventStore`
 * (better-sqlite3) and `PhoneBridgeMeshTransport` (the `ws` package), neither
 * of which can be bundled for a browser. This entry exposes the same domain
 * and service layer with the browser implementations instead.
 */
export * from "./Domain/CommonThreadEvent.js";
export * from "./Domain/ThreadState.js";
export * from "./Domain/ThreadReducer.js";
export * from "./Domain/EventAuthoriser.js";
export * from "./Domain/ContentSafetyPolicy.js";
export * from "./Persistence/CommonThreadEventStore.js";
export * from "./Persistence/IndexedDbEventStore.js";
export * from "./Transport/CommonThreadMeshTransport.js";
export * from "./Transport/BridgeProtocol.js";
export * from "./Transport/AsyncEventQueue.js";
export * from "./Transport/LanRelayMeshTransport.js";
export * from "./Services/CommonThreadService.js";
export * from "./Services/PrivateContactGate.js";
