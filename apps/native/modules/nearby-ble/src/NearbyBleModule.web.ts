import { registerWebModule, NativeModule } from 'expo';

import type {
  NativeStatus,
  NearbyBleEvents,
  PermissionResult,
} from './NearbyBle.types';

/**
 * Web stub.
 *
 * No browser can act as a BLE peripheral, so two browsers can never discover
 * each other over BLE. This module reports `unsupported` and refuses to start
 * rather than pretending. Anything that claims a working mesh here would be a
 * lie in the exact place the product must be honest.
 */
class NearbyBleWebModule extends NativeModule<NearbyBleEvents> {
  async requestPermissions(): Promise<PermissionResult> {
    return { granted: false, blockedPermanently: true };
  }

  async getPermissions(): Promise<PermissionResult> {
    return { granted: false, blockedPermanently: true };
  }

  async start(): Promise<void> {
    throw new Error(
      'bluetooth_unsupported: browsers cannot advertise as a BLE peripheral, so nearby mesh is unavailable on web',
    );
  }

  async stop(): Promise<void> {}

  async broadcastFrame(): Promise<void> {
    throw new Error('bluetooth_unsupported: nearby mesh is unavailable on web');
  }

  async sendFrameTo(): Promise<void> {
    throw new Error('bluetooth_unsupported: nearby mesh is unavailable on web');
  }

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
  }
}

export default registerWebModule(NearbyBleWebModule, 'NearbyBle');
