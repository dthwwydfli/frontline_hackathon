/**
 * Wires transport, store, outbox and reducer into the state a screen renders.
 *
 * Delivery language is fixed here so no screen can invent a stronger claim:
 *   pending -> "Waiting for nearby peer"
 *   shared  -> "Shared with a nearby peer"
 * There is no "delivered" state, because nothing in this system can observe
 * one.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';

import { isNearbyBleAvailable } from '../../modules/nearby-ble';
import { toHex } from '../crypto/bytes';
import { EventStore } from '../db/EventStore';
import {
  applyEnvelope,
  emptyState,
  listThreads,
  type Thread,
  type ThreadState,
} from '../domain/ThreadReducer';
import { BleNearbyMeshTransport } from '../mesh/BleNearbyMeshTransport';
import { LanNearbyMeshTransport } from '../mesh/LanNearbyMeshTransport';
import { resolveRelayUrl } from '../mesh/relayUrl';
import { createEnvelope, type RoomSecret } from '../mesh/EnvelopeCodec';
import type {
  MeshEnvelope,
  MeshEventType,
  MeshStatus,
  PeerPresence,
} from '../mesh/MeshEnvelope';
import {
  TransportUnavailableError,
  type NearbyMeshTransport,
  type TransportBlocker,
} from '../mesh/NearbyMeshTransport';
import { OutboxSender, type DeliveryState } from '../mesh/OutboxSender';

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

export type MeshError = {
  blocker: TransportBlocker | 'unknown';
  message: string;
  /** What the user can actually do about it. Never a bare failure. */
  recovery: string;
};

const RECOVERY: Record<TransportBlocker | 'unknown', string> = {
  bluetooth_unsupported:
    'This device cannot use Bluetooth Low Energy, so it cannot reach nearby participants.',
  bluetooth_off: 'Turn Bluetooth on in system settings, then tap Retry.',
  permission_denied:
    'Open system settings, allow Common Thread to use Bluetooth and nearby devices, then tap Retry.',
  advertising_unsupported:
    'This device cannot advertise over Bluetooth, so others cannot discover it. It can still receive from devices that can.',
  already_running: 'Nearby communication is already running.',
  unknown: 'Tap Retry. If it keeps failing, restart the app.',
};

/**
 * Which pipe is carrying messages. The UI must name this accurately — calling
 * a Wi-Fi relay "Bluetooth" would be the one lie this product cannot afford.
 */
export type MeshLink = 'bluetooth' | 'wifi';

export type NearbyMeshState = {
  threads: Thread[];
  peers: PeerPresence[];
  link: MeshLink;
  status: MeshStatus | null;
  /** messageId -> delivery state, for locally created posts only. */
  delivery: Record<string, DeliveryState>;
  error: MeshError | null;
  starting: boolean;
  running: boolean;
};

export type NearbyMeshApi = NearbyMeshState & {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  post: (type: MeshEventType, payload: Record<string, unknown>) => Promise<void>;
  refreshStatus: () => Promise<void>;
  /** Best known name for a peer id. Never throws, always returns something. */
  nameFor: (peerId: string) => string;
};

export function useNearbyMesh(options: {
  roomId: string;
  displayName: string;
  deviceId: string;
  secret: RoomSecret;
}): NearbyMeshApi {
  const { roomId, displayName, deviceId, secret } = options;

  const [threads, setThreads] = useState<Thread[]>([]);
  const [peers, setPeers] = useState<PeerPresence[]>([]);
  const [status, setStatus] = useState<MeshStatus | null>(null);
  const [delivery, setDelivery] = useState<Record<string, DeliveryState>>({});
  const [error, setError] = useState<MeshError | null>(null);
  const [starting, setStarting] = useState(false);
  const [running, setRunning] = useState(false);
  const [link, setLink] = useState<MeshLink>('bluetooth');

  const storeRef = useRef<EventStore | null>(null);
  const transportRef = useRef<NearbyMeshTransport | null>(null);
  const senderRef = useRef<OutboxSender | null>(null);
  const stateRef = useRef<ThreadState>(emptyState());

  // Presence only carries a name while a peer is connected, but their posts
  // outlive the connection. Names learned once are kept so an old request does
  // not silently lose its author.
  const namesRef = useRef<Record<string, string>>({});

  const republish = useCallback(() => {
    setThreads(listThreads(stateRef.current));
  }, []);

  /** Opened once and reused: a second connection to the same file would race
   *  the first on writes. */
  const getStore = useCallback(async (): Promise<EventStore> => {
    if (storeRef.current !== null) return storeRef.current;

    const db = await SQLite.openDatabaseAsync('common-thread.db');
    const store = new EventStore(db as never);
    await store.migrate();
    storeRef.current = store;
    return store;
  }, []);

  const start = useCallback(async () => {
    setStarting(true);
    setError(null);

    try {
      const store = await getStore();

      // Replay what is already on disk before the radio starts, so a restart
      // shows the room's history immediately rather than an empty screen.
      const stored = await store.listEvents(roomId);
      const state = emptyState();
      for (const event of stored) applyEnvelope(state, event);
      stateRef.current = state;
      republish();

      const persist = async (envelope: MeshEnvelope, fromPeerId: string) => {
        await store.recordEvent(envelope, {
          receivedFrom: fromPeerId,
          receivedAtMs: Date.now(),
          isLocal: false,
        });
      };
      const hasSeen = (messageId: string) => store.hasSeen(messageId);

      // The radio is the real transport. Expo Go cannot load it — its native
      // half is fixed when Expo builds it — so there we fall back to a relay
      // on the same Wi-Fi. Everything above this line is identical either way:
      // same envelopes, same signatures, same reducer, same store.
      const relayUrl = resolveRelayUrl();
      const useRadio = isNearbyBleAvailable() || relayUrl === null;

      const transport: NearbyMeshTransport = useRadio
        ? new BleNearbyMeshTransport({ displayName, secret, persist, hasSeen })
        : new LanNearbyMeshTransport({
            url: relayUrl,
            peerId: deviceId,
            displayName,
            persist,
            hasSeen,
          });

      setLink(useRadio ? 'bluetooth' : 'wifi');

      transport.onEnvelope((envelope) => {
        applyEnvelope(stateRef.current, envelope);
        republish();
      });

      transport.onPeerChange((next) => {
        for (const peer of next) {
          if (peer.displayName !== null && peer.displayName.length > 0) {
            namesRef.current[peer.peerId] = peer.displayName;
          }
        }
        setPeers(next);
      });

      const sender = new OutboxSender({ store, transport, roomId });
      sender.onDeliveryChange((messageId, state) => {
        setDelivery((current) => ({ ...current, [messageId]: state }));
      });
      sender.start();

      transportRef.current = transport;
      senderRef.current = sender;

      await transport.start(roomId);
      setRunning(true);
      setStatus(await transport.getStatus());

      // Anything queued from a previous session goes out as soon as a peer
      // is in range.
      await sender.flush();
    } catch (caught) {
      const blocker =
        caught instanceof TransportUnavailableError ? caught.blocker : 'unknown';
      setError({
        blocker,
        message: caught instanceof Error ? caught.message : String(caught),
        recovery: RECOVERY[blocker],
      });
      setRunning(false);
    } finally {
      setStarting(false);
    }
  }, [displayName, getStore, republish, roomId, secret]);

  const stop = useCallback(async () => {
    senderRef.current?.stop();
    await transportRef.current?.stop();
    senderRef.current = null;
    transportRef.current = null;
    setRunning(false);
    setPeers([]);
    setStatus(null);
  }, []);

  const post = useCallback(
    async (type: MeshEventType, payload: Record<string, unknown>) => {
      const sender = senderRef.current;
      if (sender === null) {
        throw new Error('Nearby communication is not running.');
      }

      const envelope: MeshEnvelope = createEnvelope(
        {
          messageId: toHex(Crypto.getRandomBytes(12)),
          senderId: deviceId,
          type,
          payload,
          createdAtMs: Date.now(),
          ttlMs: DEFAULT_TTL_MS,
        },
        secret,
      );

      // Applied locally first: the user sees their own post immediately,
      // marked "Waiting for nearby peer" until a peer confirms.
      applyEnvelope(stateRef.current, envelope);
      republish();

      await sender.enqueue(envelope);
    },
    [deviceId, republish, secret],
  );

  const refreshStatus = useCallback(async () => {
    const transport = transportRef.current;
    if (transport === null) return;
    setStatus(await transport.getStatus());
  }, []);

  const nameFor = useCallback(
    (peerId: string) => {
      if (peerId === deviceId) return 'You';
      const known = namesRef.current[peerId];
      if (known !== undefined && known.length > 0) return known;

      // Seeded example posts carry their author in the id, so the board reads
      // like a neighbourhood rather than a list of hashes.
      if (peerId.startsWith('seed-')) {
        const name = peerId.slice('seed-'.length);
        return name.charAt(0).toUpperCase() + name.slice(1);
      }

      // Never show a raw device id to a user; it reads as noise, not a person.
      return peerId.length > 0 ? `Neighbour ${peerId.slice(0, 4)}` : 'Someone nearby';
    },
    [deviceId],
  );

  // Start once the session exists. Nothing about this screen should be gated
  // behind a button the user has no reason to understand.
  useEffect(() => {
    void start();
  }, [start]);

  useEffect(() => {
    return () => {
      senderRef.current?.stop();
      void transportRef.current?.stop();
    };
  }, []);

  return useMemo(
    () => ({
      threads,
      peers,
      link,
      status,
      delivery,
      error,
      starting,
      running,
      start,
      stop,
      post,
      refreshStatus,
      nameFor,
    }),
    [
      delivery,
      error,
      link,
      nameFor,
      peers,
      post,
      refreshStatus,
      running,
      start,
      starting,
      status,
      stop,
      threads,
    ],
  );
}

/** The only delivery wording the UI may show. */
export function deliveryLabel(state: DeliveryState | undefined): string {
  switch (state) {
    case 'shared':
      return 'Shared with a nearby peer';
    case 'pending':
      return 'Waiting for nearby peer';
    default:
      return '';
  }
}
