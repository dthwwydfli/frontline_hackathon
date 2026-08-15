import { NativeModule, requireOptionalNativeModule } from 'expo';

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

const unavailableMessage =
  'bluetooth_unsupported: Expo Go does not include the NearbyBle native module. Use an iOS or Android development build for Bluetooth mesh.';

const unavailableModule = {
  addListener: () => ({ remove: () => {} }),
  async requestPermissions(): Promise<PermissionResult> {
    throw new Error(unavailableMessage);
  },
  async getPermissions(): Promise<PermissionResult> {
    return { granted: false, blockedPermanently: true };
  },
  async start(): Promise<void> {
    throw new Error(unavailableMessage);
  },
  async stop(): Promise<void> {},
  async broadcastFrame(): Promise<void> {
    throw new Error(unavailableMessage);
  },
  async sendFrameTo(): Promise<void> {
    throw new Error(unavailableMessage);
  },
  async getStatus(): Promise<NativeStatus> {
    return {
      running: false,
      bluetoothState: 'unsupported',
      advertising: false,
      scanning: false,
      roomId: null,
      localPeerId: null,
      connectedPeerCount: 0,
      maxFrameBytes: 0,
    };
  },
} as unknown as NearbyBleModule;

const nativeModule = requireOptionalNativeModule<NearbyBleModule>('NearbyBle');

/**
 * True only in a build that actually contains the module — a development
 * build or a store build, never Expo Go. Callers use this to choose a
 * transport rather than discovering the absence through a thrown error.
 */
export function isNearbyBleAvailable(): boolean {
  return nativeModule !== null;
}

export default nativeModule ?? unavailableModule;
