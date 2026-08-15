package expo.modules.nearbyble

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Build
import android.os.ParcelUuid
import java.util.Collections
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Common Thread BLE identifiers. Must match the iOS module and
 * `modules/nearby-ble/index.ts` byte for byte, or the platforms never meet.
 */
object NearbyBleIds {
  val SERVICE: UUID = UUID.fromString("7f3e9a10-2c4b-4d5e-9f80-11a2b3c4d5e6")

  /** Peers write frames here (client -> server). */
  val INBOX: UUID = UUID.fromString("7f3e9a11-2c4b-4d5e-9f80-11a2b3c4d5e6")

  /** Peers subscribe here for frames (server -> client). */
  val OUTBOX: UUID = UUID.fromString("7f3e9a12-2c4b-4d5e-9f80-11a2b3c4d5e6")

  /** Standard Client Characteristic Configuration descriptor. */
  val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
}

class NearbyBleException(val code: String, override val message: String) : Exception(message)

data class NearbyPeer(
  val peerId: String,
  var displayName: String?,
  var rssi: Int?,
  var lastSeenAtMs: Double,
)

interface BleMeshServiceDelegate {
  fun onFrameReceived(frame: ByteArray, peerId: String)
  fun onPeersChanged(peers: List<NearbyPeer>)
  fun onStateChanged(state: String)
}

/**
 * Runs this phone as a BLE central AND a BLE peripheral at the same time.
 *
 * Android splits the two roles across four APIs: BluetoothLeScanner and
 * BluetoothGatt for the central side, BluetoothLeAdvertiser and
 * BluetoothGattServer for the peripheral side. All four are required. Scanning
 * alone would let this device see others while staying invisible, which fails
 * the A <-> B test in the runbook.
 *
 * Not every Android device supports peripheral mode. `isMultipleAdvertisementSupported`
 * is checked at start and reported as a blocker rather than being papered over.
 */
@SuppressLint("MissingPermission")
class BleMeshService(
  private val context: Context,
  val localPeerId: String,
  private val delegate: BleMeshServiceDelegate,
) {
  private val bluetoothManager: BluetoothManager? =
    context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager

  private val adapter: BluetoothAdapter? get() = bluetoothManager?.adapter

  private var scanner: BluetoothLeScanner? = null
  private var advertiser: BluetoothLeAdvertiser? = null
  private var gattServer: BluetoothGattServer? = null
  private var outboxCharacteristic: BluetoothGattCharacteristic? = null

  /** Central role: GATT connections we opened, keyed by peer id. */
  private val clientConnections = ConcurrentHashMap<String, BluetoothGatt>()
  private val clientInboxes = ConcurrentHashMap<String, BluetoothGattCharacteristic>()

  /** Peripheral role: devices subscribed to our outbox. */
  private val subscribedDevices = Collections.synchronizedSet(mutableSetOf<BluetoothDevice>())

  private val peers = ConcurrentHashMap<String, NearbyPeer>()

  /** Negotiated ATT MTU per peer. 23 is the spec default before negotiation. */
  private val peerMtu = ConcurrentHashMap<String, Int>()

  @Volatile var isRunning = false; private set
  @Volatile var isScanning = false; private set
  @Volatile var isAdvertising = false; private set

  @Volatile private var roomId: String? = null
  @Volatile private var displayName: String = ""

  // ---------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------

  fun start(roomId: String, displayName: String) {
    val adapter = this.adapter
      ?: throw NearbyBleException(
        "bluetooth_unsupported",
        "This device does not support Bluetooth Low Energy.",
      )

    if (!adapter.isEnabled) {
      throw NearbyBleException(
        "bluetooth_off",
        "Bluetooth is switched off. Turn it on to reach nearby participants.",
      )
    }

    if (!adapter.isMultipleAdvertisementSupported) {
      throw NearbyBleException(
        "advertising_unsupported",
        "This device cannot advertise over Bluetooth, so other participants " +
          "cannot discover it. It can still receive from devices that can.",
      )
    }

    this.roomId = roomId
    this.displayName = displayName
    isRunning = true

    startGattServer()
    startAdvertising()
    startScanning()

    delegate.onStateChanged(stateString())
  }

  fun stop() {
    isRunning = false

    if (isScanning) {
      runCatching { scanner?.stopScan(scanCallback) }
      isScanning = false
    }
    if (isAdvertising) {
      runCatching { advertiser?.stopAdvertising(advertiseCallback) }
      isAdvertising = false
    }

    clientConnections.values.forEach { gatt ->
      runCatching {
        gatt.disconnect()
        gatt.close()
      }
    }
    clientConnections.clear()
    clientInboxes.clear()
    subscribedDevices.clear()
    peerMtu.clear()
    peers.clear()

    runCatching {
      gattServer?.clearServices()
      gattServer?.close()
    }
    gattServer = null
    outboxCharacteristic = null

    emitPeers()
  }

  // ---------------------------------------------------------------------
  // Peripheral role: GATT server + advertiser
  // ---------------------------------------------------------------------

  private fun startGattServer() {
    val manager = bluetoothManager ?: return

    val server = manager.openGattServer(context, gattServerCallback) ?: throw
      NearbyBleException("bluetooth_unsupported", "Could not open a GATT server on this device.")

    val outbox = BluetoothGattCharacteristic(
      NearbyBleIds.OUTBOX,
      BluetoothGattCharacteristic.PROPERTY_NOTIFY,
      BluetoothGattCharacteristic.PERMISSION_READ,
    )
    outbox.addDescriptor(
      BluetoothGattDescriptor(
        NearbyBleIds.CCCD,
        BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE,
      )
    )

    val inbox = BluetoothGattCharacteristic(
      NearbyBleIds.INBOX,
      BluetoothGattCharacteristic.PROPERTY_WRITE or
        BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
      BluetoothGattCharacteristic.PERMISSION_WRITE,
    )

    val service = BluetoothGattService(
      NearbyBleIds.SERVICE,
      BluetoothGattService.SERVICE_TYPE_PRIMARY,
    )
    service.addCharacteristic(outbox)
    service.addCharacteristic(inbox)
    server.addService(service)

    gattServer = server
    outboxCharacteristic = outbox
  }

  private fun startAdvertising() {
    val adv = adapter?.bluetoothLeAdvertiser ?: throw NearbyBleException(
      "advertising_unsupported",
      "This device cannot advertise over Bluetooth.",
    )
    advertiser = adv

    val settings = AdvertiseSettings.Builder()
      .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
      .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
      .setConnectable(true)
      .setTimeout(0)
      .build()

    // The legacy advertisement is 31 bytes. A 128-bit service UUID takes 16 of
    // them, so the device name is pushed to the scan response to avoid an
    // ADVERTISE_FAILED_DATA_TOO_LARGE.
    val data = AdvertiseData.Builder()
      .setIncludeDeviceName(false)
      .addServiceUuid(ParcelUuid(NearbyBleIds.SERVICE))
      .build()

    val scanResponse = AdvertiseData.Builder()
      .setIncludeDeviceName(true)
      .build()

    adv.startAdvertising(settings, data, scanResponse, advertiseCallback)
  }

  private val advertiseCallback = object : AdvertiseCallback() {
    override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
      isAdvertising = true
      delegate.onStateChanged(stateString())
    }

    override fun onStartFailure(errorCode: Int) {
      isAdvertising = false
      delegate.onStateChanged(stateString())
    }
  }

  private val gattServerCallback = object : BluetoothGattServerCallback() {
    override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
      val peerId = device.address
      if (newState == BluetoothProfile.STATE_DISCONNECTED) {
        subscribedDevices.removeAll { it.address == peerId }
        peers.remove(peerId)
        peerMtu.remove(peerId)
        emitPeers()
      } else if (newState == BluetoothProfile.STATE_CONNECTED) {
        touchPeer(peerId, null, null)
      }
    }

    override fun onMtuChanged(device: BluetoothDevice, mtu: Int) {
      peerMtu[device.address] = mtu
    }

    override fun onCharacteristicWriteRequest(
      device: BluetoothDevice,
      requestId: Int,
      characteristic: BluetoothGattCharacteristic,
      preparedWrite: Boolean,
      responseNeeded: Boolean,
      offset: Int,
      value: ByteArray,
    ) {
      if (characteristic.uuid == NearbyBleIds.INBOX && value.isNotEmpty()) {
        touchPeer(device.address, null, null)
        delegate.onFrameReceived(value, device.address)
      }
      if (responseNeeded) {
        gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, null)
      }
    }

    override fun onDescriptorWriteRequest(
      device: BluetoothDevice,
      requestId: Int,
      descriptor: BluetoothGattDescriptor,
      preparedWrite: Boolean,
      responseNeeded: Boolean,
      offset: Int,
      value: ByteArray,
    ) {
      if (descriptor.uuid == NearbyBleIds.CCCD) {
        val enabling = value.contentEquals(
          BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
        )
        if (enabling) {
          subscribedDevices.add(device)
          touchPeer(device.address, null, null)
        } else {
          subscribedDevices.removeAll { it.address == device.address }
        }
      }
      if (responseNeeded) {
        gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, null)
      }
    }
  }

  // ---------------------------------------------------------------------
  // Central role: scanner + GATT client
  // ---------------------------------------------------------------------

  private fun startScanning() {
    val s = adapter?.bluetoothLeScanner ?: return
    scanner = s

    val filters = listOf(
      ScanFilter.Builder()
        .setServiceUuid(ParcelUuid(NearbyBleIds.SERVICE))
        .build()
    )
    val settings = ScanSettings.Builder()
      .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
      .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
      .build()

    s.startScan(filters, settings, scanCallback)
    isScanning = true
  }

  private val scanCallback = object : ScanCallback() {
    override fun onScanResult(callbackType: Int, result: ScanResult) {
      if (!isRunning) return

      val device = result.device
      val peerId = device.address

      touchPeer(peerId, result.scanRecord?.deviceName, result.rssi)

      // Connect once per device. A second connectGatt to a device we already
      // hold leaks a BluetoothGatt and eventually exhausts the 7-connection
      // budget on most chipsets.
      if (clientConnections.containsKey(peerId)) return

      val gatt = device.connectGatt(
        context,
        false,
        gattClientCallback,
        BluetoothDevice.TRANSPORT_LE,
      ) ?: return

      clientConnections[peerId] = gatt
    }

    override fun onScanFailed(errorCode: Int) {
      isScanning = false
      delegate.onStateChanged(stateString())
    }
  }

  private val gattClientCallback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
      val peerId = gatt.device.address

      if (newState == BluetoothProfile.STATE_CONNECTED) {
        // Ask for the largest MTU first so fragments carry ~500 bytes rather
        // than 20. Service discovery starts once the MTU settles.
        if (!gatt.requestMtu(512)) {
          gatt.discoverServices()
        }
      } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
        clientConnections.remove(peerId)
        clientInboxes.remove(peerId)
        peerMtu.remove(peerId)
        peers.remove(peerId)
        runCatching { gatt.close() }
        emitPeers()
      }
    }

    override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
      peerMtu[gatt.device.address] = mtu
      gatt.discoverServices()
    }

    override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
      if (status != BluetoothGatt.GATT_SUCCESS) return

      val service = gatt.getService(NearbyBleIds.SERVICE) ?: return
      val peerId = gatt.device.address

      service.getCharacteristic(NearbyBleIds.INBOX)?.let { inbox ->
        clientInboxes[peerId] = inbox
      }

      service.getCharacteristic(NearbyBleIds.OUTBOX)?.let { outbox ->
        gatt.setCharacteristicNotification(outbox, true)
        outbox.getDescriptor(NearbyBleIds.CCCD)?.let { cccd ->
          writeDescriptorCompat(gatt, cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
        }
      }

      touchPeer(peerId, gatt.device.name, null)
    }

    override fun onCharacteristicChanged(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
      value: ByteArray,
    ) {
      if (characteristic.uuid != NearbyBleIds.OUTBOX || value.isEmpty()) return
      val peerId = gatt.device.address
      touchPeer(peerId, null, null)
      delegate.onFrameReceived(value, peerId)
    }

    @Deprecated("Required for API < 33; the ByteArray overload above covers 33+.")
    @Suppress("DEPRECATION")
    override fun onCharacteristicChanged(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
    ) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) return
      if (characteristic.uuid != NearbyBleIds.OUTBOX) return
      val value = characteristic.value ?: return
      if (value.isEmpty()) return
      val peerId = gatt.device.address
      touchPeer(peerId, null, null)
      delegate.onFrameReceived(value, peerId)
    }
  }

  // ---------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------

  /**
   * Fan a frame out on both roles. A peer reached by both paths receives it
   * twice; JS deduplicates on message id.
   */
  fun broadcast(frame: ByteArray) {
    if (!isRunning) return

    clientInboxes.forEach { (peerId, characteristic) ->
      val gatt = clientConnections[peerId] ?: return@forEach
      writeCharacteristicCompat(gatt, characteristic, frame)
    }

    notifySubscribers(frame, null)
  }

  fun sendTo(peerId: String, frame: ByteArray) {
    if (!isRunning) return

    val gatt = clientConnections[peerId]
    val inbox = clientInboxes[peerId]
    if (gatt != null && inbox != null) {
      writeCharacteristicCompat(gatt, inbox, frame)
      return
    }

    notifySubscribers(frame, peerId)
  }

  private fun notifySubscribers(frame: ByteArray, onlyPeerId: String?) {
    val characteristic = outboxCharacteristic ?: return
    val server = gattServer ?: return

    val targets = synchronized(subscribedDevices) {
      subscribedDevices.filter { onlyPeerId == null || it.address == onlyPeerId }
    }

    targets.forEach { device ->
      runCatching { notifyCompat(server, device, characteristic, frame) }
    }
  }

  @Suppress("DEPRECATION")
  private fun notifyCompat(
    server: BluetoothGattServer,
    device: BluetoothDevice,
    characteristic: BluetoothGattCharacteristic,
    frame: ByteArray,
  ) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      server.notifyCharacteristicChanged(device, characteristic, false, frame)
    } else {
      characteristic.value = frame
      server.notifyCharacteristicChanged(device, characteristic, false)
    }
  }

  @Suppress("DEPRECATION")
  private fun writeCharacteristicCompat(
    gatt: BluetoothGatt,
    characteristic: BluetoothGattCharacteristic,
    frame: ByteArray,
  ) {
    runCatching {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        gatt.writeCharacteristic(
          characteristic,
          frame,
          BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE,
        )
      } else {
        characteristic.writeType = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
        characteristic.value = frame
        gatt.writeCharacteristic(characteristic)
      }
    }
  }

  @Suppress("DEPRECATION")
  private fun writeDescriptorCompat(
    gatt: BluetoothGatt,
    descriptor: BluetoothGattDescriptor,
    value: ByteArray,
  ) {
    runCatching {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        gatt.writeDescriptor(descriptor, value)
      } else {
        descriptor.value = value
        gatt.writeDescriptor(descriptor)
      }
    }
  }

  // ---------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------

  fun status(): Map<String, Any?> = mapOf(
    "running" to isRunning,
    "bluetoothState" to stateString(),
    "advertising" to isAdvertising,
    "scanning" to isScanning,
    "roomId" to roomId,
    "localPeerId" to localPeerId,
    "connectedPeerCount" to peers.size,
    "maxFrameBytes" to maxFrameBytes(),
  )

  /**
   * Smallest usable ATT payload across current links, so one fragment size
   * works for every peer. Three bytes of the MTU are ATT header overhead.
   */
  private fun maxFrameBytes(): Int {
    val mtus = peerMtu.values
    if (mtus.isEmpty()) return 20
    return (mtus.min() - 3).coerceIn(20, 512)
  }

  fun stateString(): String {
    val adapter = this.adapter ?: return "unsupported"
    return if (adapter.isEnabled) "on" else "off"
  }

  private fun touchPeer(peerId: String, displayName: String?, rssi: Int?) {
    val now = System.currentTimeMillis().toDouble()
    val existing = peers[peerId]
    if (existing != null) {
      existing.lastSeenAtMs = now
      if (displayName != null) existing.displayName = displayName
      if (rssi != null) existing.rssi = rssi
    } else {
      peers[peerId] = NearbyPeer(peerId, displayName, rssi, now)
    }
    emitPeers()
  }

  private fun emitPeers() {
    delegate.onPeersChanged(peers.values.toList())
  }
}
