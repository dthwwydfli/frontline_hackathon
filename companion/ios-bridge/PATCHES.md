# Fork patches (re-apply after re-clone)

## 1. Copy CommonThread sources

```bash
mkdir -p companion/ios-bridge/bitchat-fork/bitchat/CommonThread
cp companion/ios-bridge/CommonThread*.swift \
  companion/ios-bridge/bitchat-fork/bitchat/CommonThread/
```

## 2. AppRuntime.start() — start bridge after launch

In `bitchat/App/AppRuntime.swift`, at the end of successful `start()`:

```swift
CommonThreadBridgeController.shared.start(with: chatViewModel)
```

## 3. ChatViewModel.handlePublicMessage — CT1: ingress

Near the top of `handlePublicMessage`, after bridge-auth handling:

```swift
if message.content.hasPrefix(CommonThreadBridgeServer.wirePrefix) {
    CommonThreadBridgeController.shared.handleInboundPublicMessage(
        content: message.content,
        messageID: message.id,
        receivedAt: message.timestamp
    )
}
```
