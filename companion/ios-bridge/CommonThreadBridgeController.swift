//
// CommonThreadBridgeController.swift
// Lifecycle singleton — start from AppRuntime after mesh is allowed.
//

import Foundation

@MainActor
final class CommonThreadBridgeController {
    static let shared = CommonThreadBridgeController()

    let adapter = CommonThreadBitchatAdapter()
    private var started = false

    private init() {}

    func start(with chatViewModel: ChatViewModel) {
        guard !started else { return }
        adapter.attach(to: chatViewModel)
        do {
            try adapter.startBridge()
            started = true
        } catch {
            SecureLoggerOptional.log("Failed to start CommonThread bridge: \(error)")
        }
    }

    func handleInboundPublicMessage(content: String, messageID: String, receivedAt: Date) {
        adapter.handleInboundPublicMessage(
            content: content,
            messageID: messageID,
            receivedAt: receivedAt
        )
    }

    func stop() {
        adapter.stopBridge()
        started = false
    }
}
