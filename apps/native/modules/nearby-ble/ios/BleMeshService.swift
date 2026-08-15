import CoreBluetooth
import Foundation

/// Common Thread BLE identifiers. These must match the Android module and
/// `modules/nearby-ble/index.ts` exactly, or the two platforms never meet.
enum NearbyBleIds {
  static let service = CBUUID(string: "7F3E9A10-2C4B-4D5E-9F80-11A2B3C4D5E6")
  /// Peers write frames here (central -> peripheral).
  static let inbox = CBUUID(string: "7F3E9A11-2C4B-4D5E-9F80-11A2B3C4D5E6")
  /// Peers subscribe here for frames (peripheral -> central).
  static let outbox = CBUUID(string: "7F3E9A12-2C4B-4D5E-9F80-11A2B3C4D5E6")
}

enum NearbyBleError: Error {
  case unsupported
  case poweredOff
  case unauthorized
  case notRunning

  var code: String {
    switch self {
    case .unsupported: return "bluetooth_unsupported"
    case .poweredOff: return "bluetooth_off"
    case .unauthorized: return "permission_denied"
    case .notRunning: return "not_running"
    }
  }

  var message: String {
    switch self {
    case .unsupported:
      return "This device does not support Bluetooth Low Energy."
    case .poweredOff:
      return "Bluetooth is switched off. Turn it on to reach nearby participants."
    case .unauthorized:
      return "Common Thread does not have Bluetooth permission."
    case .notRunning:
      return "Nearby communication is not running."
    }
  }
}

struct NearbyPeer {
  let peerId: String
  var displayName: String?
  var rssi: Int?
  var lastSeenAtMs: Double
}

protocol BleMeshServiceDelegate: AnyObject {
  func bleMesh(didReceiveFrame data: Data, fromPeerId peerId: String)
  func bleMesh(didChangePeers peers: [NearbyPeer])
  func bleMesh(didChangeState state: String)
}

/// Runs this phone as a BLE central AND a BLE peripheral at the same time.
///
/// Both roles are required. A central-only device can discover others but is
/// invisible to them, which would make the mesh one-directional and would fail
/// the A <-> B test in the runbook.
///
/// Threading: every CoreBluetooth callback and every public entry point runs on
/// `queue`. Delegate callbacks are emitted on that same queue; the Expo module
/// hops to JS from there.
final class BleMeshService: NSObject {
  weak var delegate: BleMeshServiceDelegate?

  private let queue = DispatchQueue(label: "org.commonthread.nearby.ble")

  private var centralManager: CBCentralManager?
  private var peripheralManager: CBPeripheralManager?

  private var roomId: String?
  private var displayName: String = ""

  /// Stable per-install identity, surfaced to peers in the advertisement.
  private(set) var localPeerId: String

  // Central role: peripherals we connected to, keyed by peer id.
  private var connectedPeripherals: [String: CBPeripheral] = [:]
  private var outboxCharacteristics: [String: CBCharacteristic] = [:]
  private var discovered: [UUID: CBPeripheral] = [:]

  // Peripheral role: centrals subscribed to our outbox.
  private var subscribedCentrals: [CBCentral] = []
  private var outboxCharacteristic: CBMutableCharacteristic?

  private var peers: [String: NearbyPeer] = [:]

  private(set) var isRunning = false
  private(set) var isScanning = false
  private(set) var isAdvertising = false

  /// Frames queued while `peripheralManager` reported back-pressure.
  private var pendingNotifications: [Data] = []

  init(localPeerId: String) {
    self.localPeerId = localPeerId
    super.init()
  }

  // MARK: - Lifecycle

  func start(roomId: String, displayName: String, completion: @escaping (Error?) -> Void) {
    queue.async {
      self.roomId = roomId
      self.displayName = displayName
      self.isRunning = true

      if self.centralManager == nil {
        self.centralManager = CBCentralManager(
          delegate: self,
          queue: self.queue,
          options: [CBCentralManagerOptionShowPowerAlertKey: false]
        )
      }
      if self.peripheralManager == nil {
        self.peripheralManager = CBPeripheralManager(
          delegate: self,
          queue: self.queue,
          options: [CBPeripheralManagerOptionShowPowerAlertKey: false]
        )
      }

      // Both managers report state asynchronously. Whichever becomes ready
      // first kicks off its own role; `completion` fires now because a BLE
      // start is not a point-in-time success or failure. Callers observe the
      // real state through getStatus() and onStateChanged.
      self.startScanningIfReady()
      self.startAdvertisingIfReady()
      completion(nil)
    }
  }

  func stop(completion: @escaping () -> Void) {
    queue.async {
      self.isRunning = false

      if self.isScanning {
        self.centralManager?.stopScan()
        self.isScanning = false
      }
      if self.isAdvertising {
        self.peripheralManager?.stopAdvertising()
        self.isAdvertising = false
      }

      for peripheral in self.connectedPeripherals.values {
        self.centralManager?.cancelPeripheralConnection(peripheral)
      }
      self.connectedPeripherals.removeAll()
      self.outboxCharacteristics.removeAll()
      self.discovered.removeAll()
      self.subscribedCentrals.removeAll()
      self.pendingNotifications.removeAll()
      self.peers.removeAll()

      self.peripheralManager?.removeAllServices()
      self.emitPeers()
      completion()
    }
  }

  // MARK: - Sending

  /// Fan a frame out on both roles: written to peripherals we are central to,
  /// and notified to centrals subscribed to us. A peer reached by both paths
  /// receives it twice; JS deduplicates on message id.
  func broadcast(frame: Data) {
    queue.async {
      guard self.isRunning else { return }

      for (peerId, peripheral) in self.connectedPeripherals {
        guard let characteristic = self.outboxCharacteristics[peerId] else { continue }
        peripheral.writeValue(frame, for: characteristic, type: .withoutResponse)
      }

      self.notifySubscribers(frame)
    }
  }

  func send(frame: Data, toPeerId peerId: String) {
    queue.async {
      guard self.isRunning else { return }

      if let peripheral = self.connectedPeripherals[peerId],
         let characteristic = self.outboxCharacteristics[peerId] {
        peripheral.writeValue(frame, for: characteristic, type: .withoutResponse)
        return
      }

      // The peer reached us as a central, so the only route back is a notify
      // on our outbox. CoreBluetooth does not let us address one subscriber,
      // so this notifies all of them and JS filters by peer id.
      self.notifySubscribers(frame)
    }
  }

  private func notifySubscribers(_ frame: Data) {
    guard let characteristic = self.outboxCharacteristic,
          !self.subscribedCentrals.isEmpty else { return }

    let sent = self.peripheralManager?.updateValue(
      frame,
      for: characteristic,
      onSubscribedCentrals: nil
    ) ?? false

    if !sent {
      // Transmit queue is full. Hold the frame; peripheralManagerIsReady
      // drains it. Bounded so a stalled link cannot grow without limit.
      if self.pendingNotifications.count < 256 {
        self.pendingNotifications.append(frame)
      }
    }
  }

  // MARK: - Status

  func status() -> [String: Any] {
    var result: [String: Any] = [:]
    queue.sync {
      result = [
        "running": self.isRunning,
        "bluetoothState": self.stateString(),
        "advertising": self.isAdvertising,
        "scanning": self.isScanning,
        "roomId": self.roomId as Any,
        "localPeerId": self.localPeerId,
        "connectedPeerCount": self.peers.count,
        "maxFrameBytes": self.maxFrameBytes(),
      ]
    }
    return result
  }

  /// Smallest usable payload across current links, so one fragmentation size
  /// works for every peer. 20 is the pre-negotiation ATT default.
  private func maxFrameBytes() -> Int {
    var smallest = 512

    for peripheral in connectedPeripherals.values {
      smallest = min(smallest, peripheral.maximumWriteValueLength(for: .withoutResponse))
    }
    for central in subscribedCentrals {
      smallest = min(smallest, central.maximumUpdateValueLength)
    }

    if connectedPeripherals.isEmpty && subscribedCentrals.isEmpty {
      return 20
    }
    return max(20, smallest)
  }

  private func stateString() -> String {
    guard let central = centralManager else { return "unknown" }
    switch central.state {
    case .poweredOn: return "on"
    case .poweredOff: return "off"
    case .unauthorized: return "unauthorized"
    case .unsupported: return "unsupported"
    default: return "unknown"
    }
  }

  private func nowMs() -> Double {
    Date().timeIntervalSince1970 * 1000
  }

  private func emitPeers() {
    let snapshot = Array(peers.values)
    delegate?.bleMesh(didChangePeers: snapshot)
  }

  private func touchPeer(_ peerId: String, displayName: String?, rssi: Int?) {
    if var existing = peers[peerId] {
      existing.lastSeenAtMs = nowMs()
      if let displayName { existing.displayName = displayName }
      if let rssi { existing.rssi = rssi }
      peers[peerId] = existing
    } else {
      peers[peerId] = NearbyPeer(
        peerId: peerId,
        displayName: displayName,
        rssi: rssi,
        lastSeenAtMs: nowMs()
      )
    }
    emitPeers()
  }

  // MARK: - Central role

  private func startScanningIfReady() {
    guard isRunning,
          let central = centralManager,
          central.state == .poweredOn,
          !isScanning else { return }

    // Duplicate keys off: we only need one discovery per device to connect.
    central.scanForPeripherals(
      withServices: [NearbyBleIds.service],
      options: [CBCentralManagerScanOptionAllowDuplicatesKey: false]
    )
    isScanning = true
  }

  // MARK: - Peripheral role

  private func startAdvertisingIfReady() {
    guard isRunning,
          let peripheral = peripheralManager,
          peripheral.state == .poweredOn,
          !isAdvertising else { return }

    peripheral.removeAllServices()

    let outbox = CBMutableCharacteristic(
      type: NearbyBleIds.outbox,
      properties: [.notify],
      value: nil,
      permissions: [.readable]
    )
    let inbox = CBMutableCharacteristic(
      type: NearbyBleIds.inbox,
      properties: [.write, .writeWithoutResponse],
      value: nil,
      permissions: [.writeable]
    )

    let service = CBMutableService(type: NearbyBleIds.service, primary: true)
    service.characteristics = [outbox, inbox]

    outboxCharacteristic = outbox
    peripheral.add(service)

    // The iOS advertisement packet is small and the local name is truncated
    // aggressively. Peer identity is exchanged over GATT after connect; the
    // advertisement only has to carry the service UUID so scanners filter.
    peripheral.startAdvertising([
      CBAdvertisementDataServiceUUIDsKey: [NearbyBleIds.service],
      CBAdvertisementDataLocalNameKey: String(displayName.prefix(8)),
    ])
    isAdvertising = true
  }
}

// MARK: - CBCentralManagerDelegate

extension BleMeshService: CBCentralManagerDelegate {
  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    delegate?.bleMesh(didChangeState: stateString())

    if central.state == .poweredOn {
      startScanningIfReady()
    } else {
      isScanning = false
      connectedPeripherals.removeAll()
      outboxCharacteristics.removeAll()
      peers.removeAll()
      emitPeers()
    }
  }

  func centralManager(
    _ central: CBCentralManager,
    didDiscover peripheral: CBPeripheral,
    advertisementData: [String: Any],
    rssi RSSI: NSNumber
  ) {
    guard isRunning else { return }

    // Hold a strong reference: CoreBluetooth drops peripherals we do not
    // retain, and the connection silently never completes.
    discovered[peripheral.identifier] = peripheral
    peripheral.delegate = self
    central.connect(peripheral, options: nil)
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    peripheral.discoverServices([NearbyBleIds.service])
  }

  func centralManager(
    _ central: CBCentralManager,
    didFailToConnect peripheral: CBPeripheral,
    error: Error?
  ) {
    discovered.removeValue(forKey: peripheral.identifier)
  }

  func centralManager(
    _ central: CBCentralManager,
    didDisconnectPeripheral peripheral: CBPeripheral,
    error: Error?
  ) {
    let peerId = peripheral.identifier.uuidString
    discovered.removeValue(forKey: peripheral.identifier)
    connectedPeripherals.removeValue(forKey: peerId)
    outboxCharacteristics.removeValue(forKey: peerId)
    peers.removeValue(forKey: peerId)
    emitPeers()

    // Peers walk in and out of range constantly. Keep scanning so the link
    // re-forms without the user doing anything.
    startScanningIfReady()
  }
}

// MARK: - CBPeripheralDelegate (central role)

extension BleMeshService: CBPeripheralDelegate {
  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard error == nil, let services = peripheral.services else { return }
    for service in services where service.uuid == NearbyBleIds.service {
      peripheral.discoverCharacteristics(
        [NearbyBleIds.inbox, NearbyBleIds.outbox],
        for: service
      )
    }
  }

  func peripheral(
    _ peripheral: CBPeripheral,
    didDiscoverCharacteristicsFor service: CBService,
    error: Error?
  ) {
    guard error == nil, let characteristics = service.characteristics else { return }

    let peerId = peripheral.identifier.uuidString

    for characteristic in characteristics {
      if characteristic.uuid == NearbyBleIds.inbox {
        // Their inbox is where we write.
        outboxCharacteristics[peerId] = characteristic
        connectedPeripherals[peerId] = peripheral
      }
      if characteristic.uuid == NearbyBleIds.outbox {
        // Their outbox is where they notify us.
        peripheral.setNotifyValue(true, for: characteristic)
      }
    }

    touchPeer(peerId, displayName: peripheral.name, rssi: nil)
  }

  func peripheral(
    _ peripheral: CBPeripheral,
    didUpdateValueFor characteristic: CBCharacteristic,
    error: Error?
  ) {
    guard error == nil,
          characteristic.uuid == NearbyBleIds.outbox,
          let data = characteristic.value,
          !data.isEmpty else { return }

    let peerId = peripheral.identifier.uuidString
    touchPeer(peerId, displayName: peripheral.name, rssi: nil)
    delegate?.bleMesh(didReceiveFrame: data, fromPeerId: peerId)
  }
}

// MARK: - CBPeripheralManagerDelegate (peripheral role)

extension BleMeshService: CBPeripheralManagerDelegate {
  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    if peripheral.state == .poweredOn {
      startAdvertisingIfReady()
    } else {
      isAdvertising = false
      subscribedCentrals.removeAll()
    }
  }

  func peripheralManager(
    _ peripheral: CBPeripheralManager,
    central: CBCentral,
    didSubscribeTo characteristic: CBCharacteristic
  ) {
    guard characteristic.uuid == NearbyBleIds.outbox else { return }
    if !subscribedCentrals.contains(where: { $0.identifier == central.identifier }) {
      subscribedCentrals.append(central)
    }
    touchPeer(central.identifier.uuidString, displayName: nil, rssi: nil)
  }

  func peripheralManager(
    _ peripheral: CBPeripheralManager,
    central: CBCentral,
    didUnsubscribeFrom characteristic: CBCharacteristic
  ) {
    subscribedCentrals.removeAll { $0.identifier == central.identifier }
    peers.removeValue(forKey: central.identifier.uuidString)
    emitPeers()
  }

  func peripheralManager(
    _ peripheral: CBPeripheralManager,
    didReceiveWrite requests: [CBATTRequest]
  ) {
    for request in requests {
      guard request.characteristic.uuid == NearbyBleIds.inbox,
            let data = request.value,
            !data.isEmpty else { continue }

      let peerId = request.central.identifier.uuidString
      touchPeer(peerId, displayName: nil, rssi: nil)
      delegate?.bleMesh(didReceiveFrame: data, fromPeerId: peerId)
    }

    if let first = requests.first {
      peripheral.respond(to: first, withResult: .success)
    }
  }

  func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
    guard let characteristic = outboxCharacteristic else { return }

    while !pendingNotifications.isEmpty {
      let frame = pendingNotifications[0]
      let sent = peripheral.updateValue(
        frame,
        for: characteristic,
        onSubscribedCentrals: nil
      )
      if !sent { return }
      pendingNotifications.removeFirst()
    }
  }
}
