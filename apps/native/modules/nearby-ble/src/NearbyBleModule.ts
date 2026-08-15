import { NativeModule, requireNativeModule } from 'expo';

import type {
  NativeStatus,
  NearbyBleEvents,
  PermissionResult,
} from './NearbyBle.types';

declare class NearbyBleModule extends NativeModule<NearbyBleEvents> {
  /**
   * Ask for the permissions this platform needs to scan AND advertise.
   * On Android 12+ that is BLUETOOTH_SCAN / BLUETOOTH_ADVERTISE /
   * BLUETOOTH_CONNECT. On iOS the CoreBluetooth prompt fires on first use.
   */
  requestPermissions(): Promise<PermissionResult>;

  getPermissions(): Promise<PermissionResult>;

  /**
   * Begin scanning and advertising for `roomId`. Rejects with a code from
   * TransportBlocker if the radio cannot do both roles.
   */
  start(roomId: string, displayName: string): Promise<void>;

  stop(): Promise<void>;

  /** Send one frame to every connected peer. `data` is base64. */
  broadcastFrame(data: string): Promise<void>;

  /** Send one frame to a single peer, used for acknowledgements. */
  sendFrameTo(peerId: string, data: string): Promise<void>;

  getStatus(): Promise<NativeStatus>;
}

export default requireNativeModule<NearbyBleModule>('NearbyBle');
