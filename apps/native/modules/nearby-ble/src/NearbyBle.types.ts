/**
 * Types crossing the JS <-> native boundary.
 *
 * This layer moves opaque frames only. It knows nothing about envelopes,
 * signatures or threads: all Common Thread semantics live in JS so both
 * platforms cannot drift apart on protocol rules.
 */

export type BluetoothState = 'unknown' | 'unsupported' | 'unauthorized' | 'off' | 'on';

export type NativePeer = {
  peerId: string;
  displayName: string | null;
  rssi: number | null;
  /** Device-local epoch milliseconds. */
  lastSeenAtMs: number;
};

export type NativeStatus = {
  running: boolean;
  bluetoothState: BluetoothState;
  advertising: boolean;
  scanning: boolean;
  roomId: string | null;
  localPeerId: string | null;
  connectedPeerCount: number;
  /** Usable ATT payload for the tightest current link, header included. */
  maxFrameBytes: number;
};

export type PermissionResult = {
  granted: boolean;
  /** True when the OS will no longer prompt and the user must use Settings. */
  blockedPermanently: boolean;
};

/** A frame arriving from one peer. `data` is base64 — the bridge is text-safe. */
export type FrameReceivedEvent = {
  peerId: string;
  data: string;
};

export type PeersChangedEvent = {
  peers: NativePeer[];
};

export type StateChangedEvent = {
  state: BluetoothState;
};

export type NearbyBleEvents = {
  onFrameReceived: (event: FrameReceivedEvent) => void;
  onPeersChanged: (event: PeersChangedEvent) => void;
  onStateChanged: (event: StateChangedEvent) => void;
};
