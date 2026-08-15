import Foundation

#if canImport(Network)
import Network
#endif

/// Thin loopback bridge surface for Common Thread.
/// Wire this into a private bitchat fork — do not reimplement BLE here.
///
/// Protocol: docs/PLD-05-phone-bridge.md
/// Integration points: companion/ios-bridge/BRIDGE.md
public final class CommonThreadBridgeServer: @unchecked Sendable {
    public static let defaultPort: UInt16 = 17832

    public struct DeliveryState: Sendable {
        public enum Kind: String, Sendable {
            case queued, sent, failed, unknown
        }
        public let upstreamMessageID: String
        public let state: Kind
    }

    /// Hooks supplied by the bitchat fork adapter.
    public struct Hooks: Sendable {
        public var publishPublicWire: @Sendable (String) async throws -> DeliveryState
        public var canOpenPrivate: @Sendable (String) async -> Bool
        public var onClientHello: (@Sendable () async -> String)?

        public init(
            publishPublicWire: @escaping @Sendable (String) async throws -> DeliveryState,
            canOpenPrivate: @escaping @Sendable (String) async -> Bool,
            onClientHello: (@Sendable () async -> String)? = nil
        ) {
            self.publishPublicWire = publishPublicWire
            self.canOpenPrivate = canOpenPrivate
            self.onClientHello = onClientHello
        }
    }

    private let hooks: Hooks
    private let port: UInt16

    public init(port: UInt16 = CommonThreadBridgeServer.defaultPort, hooks: Hooks) {
        self.port = port
        self.hooks = hooks
    }

    /// Start listening on 127.0.0.1 only. Replace body with NWListener WebSocket
    /// (or equivalent) once the private fork is linked.
    public func start() async throws {
        // TODO(fork): Bind NWListener to 127.0.0.1:`port`.
        // TODO(fork): On `publish_public`, call hooks.publishPublicWire(wire)
        //            using BLEPublicMessageHandler / public send API.
        // TODO(fork): On inbound public mesh frames starting with "CT1:",
        //            emit `public_event` to connected clients with upstreamMessageID.
        // TODO(fork): On `can_open_private`, query NoiseSessionManager.
        _ = port
        _ = hooks
    }

    public func stop() async {
        // TODO(fork): Cancel listener and close clients.
    }
}

/*
 MARK: - Suggested fork wiring (pseudo)

 // After cloning private bitchat fork into companion/ios-bridge/bitchat-fork:

 let hooks = CommonThreadBridgeServer.Hooks(
   publishPublicWire: { wire in
     // bleService.sendPublic(wire) → returns message id + outbox state
     return .init(upstreamMessageID: id, state: .sent)
   },
   canOpenPrivate: { peerID in
     // noiseSessions.hasEstablishedSession(with: peerID)
     return false
   }
 )
 let server = CommonThreadBridgeServer(hooks: hooks)
 try await server.start()
*/
