package expo.modules.nearbyble

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.util.Base64
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID

/**
 * Expo bridge for the Android nearby BLE transport.
 *
 * This layer only marshals: frames cross as base64 strings and all Common
 * Thread protocol rules stay in JavaScript, so Android and iOS cannot drift
 * apart on validation, dedup or hop limits.
 */
class NearbyBleModule : Module(), BleMeshServiceDelegate {
  private var service: BleMeshService? = null
  private val localPeerId: String by lazy { UUID.randomUUID().toString() }

  /**
   * Android 12 (API 31) replaced the location-based Bluetooth permissions with
   * the Nearby Devices set. Below 31, scanning still requires fine location.
   */
  private val requiredPermissions: Array<String>
    get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      arrayOf(
        Manifest.permission.BLUETOOTH_SCAN,
        Manifest.permission.BLUETOOTH_ADVERTISE,
        Manifest.permission.BLUETOOTH_CONNECT,
      )
    } else {
      arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
    }

  private fun hasAllPermissions(): Boolean {
    val context = appContext.reactContext ?: return false
    return requiredPermissions.all { permission ->
      ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
    }
  }

  override fun definition() = ModuleDefinition {
    Name("NearbyBle")

    Events("onFrameReceived", "onPeersChanged", "onStateChanged")

    AsyncFunction("getPermissions") {
      mapOf(
        "granted" to hasAllPermissions(),
        // Android exposes "don't ask again" only through the Activity, which
        // is not available here. The UI treats a second denial as blocked.
        "blockedPermanently" to false,
      )
    }

    AsyncFunction("requestPermissions") { promise: Promise ->
      val permissions = appContext.permissions
      if (permissions == null) {
        promise.reject(
          CodedException("permission_denied", "Permissions are unavailable in this context.", null)
        )
        return@AsyncFunction
      }

      permissions.askForPermissions({ result ->
        val granted = requiredPermissions.all { permission ->
          result[permission]?.status == expo.modules.interfaces.permissions.PermissionsStatus.GRANTED
        }
        val blocked = requiredPermissions.any { permission ->
          result[permission]?.canAskAgain == false
        }
        promise.resolve(mapOf("granted" to granted, "blockedPermanently" to blocked))
      }, *requiredPermissions)
    }

    AsyncFunction("start") { roomId: String, displayName: String ->
      if (!hasAllPermissions()) {
        throw CodedException(
          "permission_denied",
          "Common Thread needs Nearby Devices permission to find and reach other participants.",
          null,
        )
      }

      val context = appContext.reactContext
        ?: throw CodedException("bluetooth_unsupported", "No Android context available.", null)

      val created = service ?: BleMeshService(context, localPeerId, this@NearbyBleModule).also {
        service = it
      }

      try {
        created.start(roomId, displayName)
      } catch (e: NearbyBleException) {
        throw CodedException(e.code, e.message, null)
      }
    }

    AsyncFunction("stop") {
      service?.stop()
    }

    AsyncFunction("broadcastFrame") { data: String ->
      val active = service
        ?: throw CodedException("not_running", "Nearby communication is not running.", null)
      active.broadcast(decodeFrame(data))
    }

    AsyncFunction("sendFrameTo") { peerId: String, data: String ->
      val active = service
        ?: throw CodedException("not_running", "Nearby communication is not running.", null)
      active.sendTo(peerId, decodeFrame(data))
    }

    AsyncFunction("getStatus") {
      service?.status() ?: mapOf(
        "running" to false,
        "bluetoothState" to "unknown",
        "advertising" to false,
        "scanning" to false,
        "roomId" to null,
        "localPeerId" to null,
        "connectedPeerCount" to 0,
        "maxFrameBytes" to 20,
      )
    }

    OnDestroy {
      service?.stop()
      service = null
    }
  }

  private fun decodeFrame(data: String): ByteArray =
    try {
      Base64.decode(data, Base64.NO_WRAP)
    } catch (e: IllegalArgumentException) {
      throw CodedException("bad_frame", "frame was not valid base64", e)
    }

  // ---------------------------------------------------------------------
  // BleMeshServiceDelegate
  // ---------------------------------------------------------------------

  override fun onFrameReceived(frame: ByteArray, peerId: String) {
    sendEvent(
      "onFrameReceived",
      mapOf(
        "peerId" to peerId,
        "data" to Base64.encodeToString(frame, Base64.NO_WRAP),
      ),
    )
  }

  override fun onPeersChanged(peers: List<NearbyPeer>) {
    sendEvent(
      "onPeersChanged",
      mapOf(
        "peers" to peers.map { peer ->
          mapOf(
            "peerId" to peer.peerId,
            "displayName" to peer.displayName,
            "rssi" to peer.rssi,
            "lastSeenAtMs" to peer.lastSeenAtMs,
          )
        },
      ),
    )
  }

  override fun onStateChanged(state: String) {
    sendEvent("onStateChanged", mapOf("state" to state))
  }
}
