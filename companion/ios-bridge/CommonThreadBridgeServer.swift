//
// CommonThreadBridgeServer.swift
// Common Thread — loopback WebSocket bridge (PLD-05)
//
// Binds to 127.0.0.1 only. Does not touch Core Bluetooth.
//

import Foundation
import Network

public final class CommonThreadBridgeServer: @unchecked Sendable {
    public static let defaultPort: UInt16 = 17832
    public static let wirePrefix = "CT1:"

    public struct DeliveryState: Sendable {
        public enum Kind: String, Sendable {
            case queued, sent, failed, unknown
        }
        public let upstreamMessageID: String
        public let state: Kind
        public init(upstreamMessageID: String, state: Kind) {
            self.upstreamMessageID = upstreamMessageID
            self.state = state
        }
    }

    public struct Hooks: Sendable {
        public var publishPublicWire: @Sendable (String) async throws -> DeliveryState
        public var canOpenPrivate: @Sendable (String) async -> Bool
        public var localPeerID: @Sendable () async -> String
        public var meshReady: @Sendable () async -> Bool

        public init(
            publishPublicWire: @escaping @Sendable (String) async throws -> DeliveryState,
            canOpenPrivate: @escaping @Sendable (String) async -> Bool,
            localPeerID: @escaping @Sendable () async -> String,
            meshReady: @escaping @Sendable () async -> Bool = { true }
        ) {
            self.publishPublicWire = publishPublicWire
            self.canOpenPrivate = canOpenPrivate
            self.localPeerID = localPeerID
            self.meshReady = meshReady
        }
    }

    private let hooks: Hooks
    private let port: UInt16
    private let queue = DispatchQueue(label: "commonthread.bridge")
    private var listener: NWListener?
    private var connections: [ObjectIdentifier: NWConnection] = [:]

    public init(port: UInt16 = CommonThreadBridgeServer.defaultPort, hooks: Hooks) {
        self.port = port
        self.hooks = hooks
    }

    public func start() throws {
        guard listener == nil else { return }

        let parameters = NWParameters.tcp
        parameters.allowLocalEndpointReuse = true
        if #available(iOS 16.0, macOS 13.0, *) {
            parameters.acceptLocalOnly = true
        }

        let wsOptions = NWProtocolWebSocket.Options()
        wsOptions.autoReplyPing = true
        parameters.defaultProtocolStack.applicationProtocols.insert(wsOptions, at: 0)

        guard let nwPort = NWEndpoint.Port(rawValue: port) else {
            throw NSError(domain: "CommonThreadBridge", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "Invalid port \(port)"
            ])
        }

        let listener = try NWListener(using: parameters, on: nwPort)
        self.listener = listener

        listener.stateUpdateHandler = { state in
            switch state {
            case .failed(let error):
                SecureLoggerOptional.log("CommonThread bridge listener failed: \(error)")
            case .ready:
                SecureLoggerOptional.log("CommonThread bridge listening on 127.0.0.1:\(self.port)")
            default:
                break
            }
        }

        listener.newConnectionHandler = { [weak self] connection in
            self?.accept(connection)
        }

        listener.start(queue: queue)
    }

    public func stop() {
        queue.async {
            for (_, connection) in self.connections {
                connection.cancel()
            }
            self.connections.removeAll()
            self.listener?.cancel()
            self.listener = nil
        }
    }

    /// Fan-out a decoded public CT event to all connected web clients.
    public func broadcastPublicEvent(
        eventJSON: [String: Any],
        upstreamMessageID: String,
        receivedAt: Date
    ) {
        let payload: [String: Any] = [
            "event": eventJSON,
            "upstreamMessageID": upstreamMessageID,
            "receivedAt": ISO8601DateFormatter().string(from: receivedAt)
        ]
        let frame: [String: Any] = [
            "v": 1,
            "type": "public_event",
            "payload": payload
        ]
        broadcast(frame)
    }

    private func accept(_ connection: NWConnection) {
        let id = ObjectIdentifier(connection)
        connections[id] = connection
        connection.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .failed, .cancelled:
                self.queue.async {
                    self.connections.removeValue(forKey: id)
                }
            default:
                break
            }
        }
        connection.start(queue: queue)
        receive(on: connection)
    }

    private func receive(on connection: NWConnection) {
        connection.receiveMessage { [weak self] content, _, _, error in
            guard let self else { return }
            if let error {
                SecureLoggerOptional.log("CommonThread bridge receive error: \(error)")
                connection.cancel()
                return
            }
            if let content,
               let text = String(data: content, encoding: .utf8) {
                Task {
                    await self.handleFrame(text, connection: connection)
                }
            }
            self.receive(on: connection)
        }
    }

    private func handleFrame(_ text: String, connection: NWConnection) async {
        guard
            let data = text.data(using: .utf8),
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let type = obj["type"] as? String
        else {
            send(error: "invalid_json", message: "Frame must be JSON", id: nil, to: connection)
            return
        }

        let id = obj["id"] as? String
        let payload = obj["payload"] as? [String: Any] ?? [:]

        switch type {
        case "hello":
            let peerID = await hooks.localPeerID()
            let ready = await hooks.meshReady()
            send([
                "v": 1,
                "type": "hello_ack",
                "payload": [
                    "peerID": peerID,
                    "meshReady": ready
                ]
            ], to: connection)

        case "publish_public":
            let wire = (payload["wire"] as? String)
                ?? Self.encodeWire(from: payload["event"])
            guard let wire, wire.hasPrefix(Self.wirePrefix) else {
                send(error: "invalid_wire", message: "Expected CT1: wire payload", id: id, to: connection)
                return
            }
            do {
                let delivery = try await hooks.publishPublicWire(wire)
                var body: [String: Any] = [
                    "v": 1,
                    "type": "delivery_state",
                    "payload": [
                        "upstreamMessageID": delivery.upstreamMessageID,
                        "state": delivery.state.rawValue
                    ]
                ]
                if let id { body["id"] = id }
                send(body, to: connection)
            } catch {
                send(error: "publish_failed", message: error.localizedDescription, id: id, to: connection)
            }

        case "can_open_private":
            guard let peerID = payload["peerID"] as? String else {
                send(error: "missing_peer", message: "peerID required", id: id, to: connection)
                return
            }
            let available = await hooks.canOpenPrivate(peerID)
            var body: [String: Any] = [
                "v": 1,
                "type": "can_open_private_result",
                "payload": [
                    "peerID": peerID,
                    "available": available
                ]
            ]
            if let id { body["id"] = id }
            send(body, to: connection)

        default:
            send(error: "unknown_type", message: "Unsupported type \(type)", id: id, to: connection)
        }
    }

    private static func encodeWire(from event: Any?) -> String? {
        guard let event,
              let data = try? JSONSerialization.data(withJSONObject: event, options: [.sortedKeys]),
              let json = String(data: data, encoding: .utf8)
        else { return nil }
        return wirePrefix + json
    }

    public static func parseCT1Wire(_ content: String) -> [String: Any]? {
        guard content.hasPrefix(wirePrefix) else { return nil }
        let json = String(content.dropFirst(wirePrefix.count))
        guard let data = json.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return obj
    }

    private func send(error code: String, message: String, id: String?, to connection: NWConnection) {
        var body: [String: Any] = [
            "v": 1,
            "type": "error",
            "payload": ["code": code, "message": message]
        ]
        if let id { body["id"] = id }
        send(body, to: connection)
    }

    private func broadcast(_ frame: [String: Any]) {
        queue.async {
            for (_, connection) in self.connections {
                self.send(frame, to: connection)
            }
        }
    }

    private func send(_ frame: [String: Any], to connection: NWConnection) {
        guard let data = try? JSONSerialization.data(withJSONObject: frame),
              let text = String(data: data, encoding: .utf8),
              let payload = text.data(using: .utf8)
        else { return }

        let metadata = NWProtocolWebSocket.Metadata(opcode: .text)
        let context = NWConnection.ContentContext(identifier: "ct-bridge", metadata: [metadata])
        connection.send(
            content: payload,
            contentContext: context,
            isComplete: true,
            completion: .contentProcessed { _ in }
        )
    }
}

/// Soft logging so Common Thread files compile even if SecureLogger import paths differ.
enum SecureLoggerOptional {
    static func log(_ message: String) {
        #if DEBUG
        print("[CommonThread] \(message)")
        #endif
    }
}
