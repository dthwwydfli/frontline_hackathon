import CoreBluetooth
import ExpoModulesCore
import Foundation

/// Expo bridge for the iOS nearby BLE transport.
///
/// This layer only marshals: frames cross as base64 strings and all Common
/// Thread protocol rules stay in JavaScript, so iOS and Android cannot drift
/// apart on validation, dedup or hop limits.
public class NearbyBleModule: Module, BleMeshServiceDelegate {
  private var service: BleMeshService?

  /// Stable for the lifetime of the install. Persisted identity lives in JS
  /// (SecureStore); this is the radio-level handle only.
  private lazy var localPeerId: String = UUID().uuidString

  public func definition() -> ModuleDefinition {
    Name("NearbyBle")

    Events("onFrameReceived", "onPeersChanged", "onStateChanged")

    AsyncFunction("getPermissions") { () -> [String: Any] in
      let status = CBManager.authorization
      return [
        "granted": status == .allowedAlways,
        "blockedPermanently": status == .denied || status == .restricted,
      ]
    }

    AsyncFunction("requestPermissions") { () -> [String: Any] in
      // iOS has no explicit request call. The prompt fires the first time a
      // CBCentralManager or CBPeripheralManager is instantiated, which start()
      // does. Report current state so the UI can explain the next step
      // honestly instead of implying a prompt it cannot trigger.
      let status = CBManager.authorization
      return [
        "granted": status == .allowedAlways,
        "blockedPermanently": status == .denied || status == .restricted,
      ]
    }

    AsyncFunction("start") { (roomId: String, displayName: String, promise: Promise) in
      if CBManager.authorization == .denied || CBManager.authorization == .restricted {
        promise.reject(
          NearbyBleError.unauthorized.code,
          NearbyBleError.unauthorized.message
        )
        return
      }

      if self.service == nil {
        let created = BleMeshService(localPeerId: self.localPeerId)
        created.delegate = self
        self.service = created
      }

      self.service?.start(roomId: roomId, displayName: displayName) { error in
        if let error {
          promise.reject("start_failed", error.localizedDescription)
        } else {
          promise.resolve(nil)
        }
      }
    }

    AsyncFunction("stop") { (promise: Promise) in
      guard let service = self.service else {
        promise.resolve(nil)
        return
      }
      service.stop { promise.resolve(nil) }
    }

    AsyncFunction("broadcastFrame") { (data: String) in
      guard let service = self.service else {
        throw Exception(
          name: NearbyBleError.notRunning.code,
          description: NearbyBleError.notRunning.message
        )
      }
      guard let frame = Data(base64Encoded: data) else {
        throw Exception(name: "bad_frame", description: "frame was not valid base64")
      }
      service.broadcast(frame: frame)
    }

    AsyncFunction("sendFrameTo") { (peerId: String, data: String) in
      guard let service = self.service else {
        throw Exception(
          name: NearbyBleError.notRunning.code,
          description: NearbyBleError.notRunning.message
        )
      }
      guard let frame = Data(base64Encoded: data) else {
        throw Exception(name: "bad_frame", description: "frame was not valid base64")
      }
      service.send(frame: frame, toPeerId: peerId)
    }

    AsyncFunction("getStatus") { () -> [String: Any] in
      guard let service = self.service else {
        return [
          "running": false,
          "bluetoothState": "unknown",
          "advertising": false,
          "scanning": false,
          "roomId": NSNull(),
          "localPeerId": NSNull(),
          "connectedPeerCount": 0,
          "maxFrameBytes": 20,
        ]
      }
      return service.status()
    }

    OnDestroy {
      self.service?.stop {}
      self.service = nil
    }
  }

  // MARK: - BleMeshServiceDelegate

  func bleMesh(didReceiveFrame data: Data, fromPeerId peerId: String) {
    sendEvent("onFrameReceived", [
      "peerId": peerId,
      "data": data.base64EncodedString(),
    ])
  }

  func bleMesh(didChangePeers peers: [NearbyPeer]) {
    sendEvent("onPeersChanged", [
      "peers": peers.map { peer in
        [
          "peerId": peer.peerId,
          "displayName": peer.displayName as Any,
          "rssi": peer.rssi as Any,
          "lastSeenAtMs": peer.lastSeenAtMs,
        ]
      },
    ])
  }

  func bleMesh(didChangeState state: String) {
    sendEvent("onStateChanged", ["state": state])
  }
}
