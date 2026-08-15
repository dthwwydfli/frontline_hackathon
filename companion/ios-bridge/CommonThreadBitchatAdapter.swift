//
// CommonThreadBitchatAdapter.swift
// Wraps bitchat Transport / ChatViewModel — does not reimplement BLE.
//

import Foundation
import BitFoundation

@MainActor
final class CommonThreadBitchatAdapter {
    private weak var chatViewModel: ChatViewModel?
    private(set) var bridge: CommonThreadBridgeServer?

    func attach(to chatViewModel: ChatViewModel) {
        self.chatViewModel = chatViewModel
    }

    func startBridge() throws {
        guard bridge == nil else { return }
        guard let chatViewModel else {
            throw NSError(domain: "CommonThread", code: 2, userInfo: [
                NSLocalizedDescriptionKey: "ChatViewModel not attached"
            ])
        }

        let hooks = CommonThreadBridgeServer.Hooks(
            publishPublicWire: { [weak chatViewModel] wire in
                try await MainActor.run {
                    guard let chatViewModel else {
                        throw NSError(domain: "CommonThread", code: 3, userInfo: [
                            NSLocalizedDescriptionKey: "ChatViewModel gone"
                        ])
                    }
                    // Mesh-only path — never Nostr/geohash fallback for CT demos.
                    let messageID = UUID().uuidString
                    chatViewModel.meshService.sendMessage(
                        wire,
                        mentions: [],
                        messageID: messageID,
                        timestamp: Date()
                    )
                    return CommonThreadBridgeServer.DeliveryState(
                        upstreamMessageID: messageID,
                        state: .sent
                    )
                }
            },
            canOpenPrivate: { [weak chatViewModel] peerIDString in
                await MainActor.run {
                    guard let chatViewModel else { return false }
                    let peerID = PeerID(str: peerIDString)
                    if case .established = chatViewModel.meshService.getNoiseSessionState(for: peerID) {
                        return true
                    }
                    return chatViewModel.meshService.canDeliverSecurely(to: peerID)
                }
            },
            localPeerID: { [weak chatViewModel] in
                await MainActor.run {
                    chatViewModel?.meshService.myPeerID.id ?? "unknown"
                }
            },
            meshReady: { [weak chatViewModel] in
                await MainActor.run {
                    chatViewModel != nil
                }
            }
        )

        let server = CommonThreadBridgeServer(hooks: hooks)
        try server.start()
        self.bridge = server
        SecureLoggerOptional.log("CommonThread bridge started for peer \(chatViewModel.meshService.myPeerID.id)")
    }

    func stopBridge() {
        bridge?.stop()
        bridge = nil
    }

    /// Called from ChatViewModel when a public mesh message arrives.
    func handleInboundPublicMessage(content: String, messageID: String, receivedAt: Date) {
        guard let event = CommonThreadBridgeServer.parseCT1Wire(content) else { return }
        bridge?.broadcastPublicEvent(
            eventJSON: event,
            upstreamMessageID: messageID,
            receivedAt: receivedAt
        )
    }
}
