/**
 * The seam between product code and radio code.
 *
 * All product code talks to this interface. Nothing above it calls
 * CoreBluetooth or the Android BLE stack directly, so a second radio (or a
 * test double) drops in without touching threads, storage or UI.
 */

import type { MeshEnvelope, MeshStatus, PeerPresence } from './MeshEnvelope';

export type EnvelopeListener = (envelope: MeshEnvelope, fromPeerId: string) => void;
export type PeerListener = (peers: PeerPresence[]) => void;
export type Unsubscribe = () => void;

/**
 * Reported by the transport when a directly connected peer confirms it has
 * PERSISTED an envelope.
 *
 * This means one adjacent peer wrote it to disk. It does not mean the room
 * received it. The only user-facing wording this may produce is "Shared with a
 * nearby peer".
 */
export type PeerAck = {
  messageId: string;
  peerId: string;
  receivedAtMs: number;
};

export type AckListener = (ack: PeerAck) => void;

export interface NearbyMeshTransport {
  start(roomId: string): Promise<void>;
  stop(): Promise<void>;

  /**
   * Hand an envelope to the radio. Resolving means the frames were queued for
   * transmission, not that any peer received them. Delivery is observed only
   * through `onAck`.
   */
  broadcast(envelope: MeshEnvelope): Promise<void>;

  onEnvelope(listener: EnvelopeListener): Unsubscribe;
  onPeerChange(listener: PeerListener): Unsubscribe;
  onAck(listener: AckListener): Unsubscribe;

  getStatus(): Promise<MeshStatus>;
}

/**
 * Why a transport could not start. Every one of these must produce a specific,
 * recoverable message in the UI — never a generic failure, and never a claim
 * that the mesh is active.
 */
export type TransportBlocker =
  | 'bluetooth_unsupported'
  | 'bluetooth_off'
  | 'permission_denied'
  | 'advertising_unsupported'
  | 'already_running';

export class TransportUnavailableError extends Error {
  constructor(
    readonly blocker: TransportBlocker,
    message: string,
  ) {
    super(message);
    this.name = 'TransportUnavailableError';
  }
}
