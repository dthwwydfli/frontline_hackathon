import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CommonThreadEvent, PeerID } from "@core/Domain/CommonThreadEvent";
import type { MaterialisedThread } from "@core/Domain/ThreadState";
import { recordToEvent } from "@core/Persistence/CommonThreadEventStore";
import { IndexedDbEventStore } from "@core/Persistence/IndexedDbEventStore";
import {
  LanRelayMeshTransport,
  type MeshStatus,
} from "@core/Transport/LanRelayMeshTransport";
import { CommonThreadService } from "@core/Services/CommonThreadService";
import {
  fallbackName,
  loadIdentity,
  loadPeerDirectory,
  savePeerDirectory,
  saveDisplayName,
} from "./identity";

export interface CommonThreadRuntime {
  peerID: PeerID;
  displayName: string;
  setDisplayName: (name: string) => void;
  service: CommonThreadService | null;
  threads: MaterialisedThread[];
  events: CommonThreadEvent[];
  status: MeshStatus;
  ready: boolean;
  nameFor: (peerID: string) => string;
  refresh: () => Promise<void>;
  clearLocalData: () => Promise<void>;
}

const IDLE_STATUS: MeshStatus = {
  connection: "connecting",
  peers: [],
  queued: 0,
};

/**
 * Owns the real domain stack for this device: IndexedDB store → mesh transport
 * → CommonThreadService. The UI issues intents and renders materialised
 * threads; it never touches transport frames.
 */
export function useCommonThread(): CommonThreadRuntime {
  const identity = useMemo(() => loadIdentity(), []);
  const [displayName, setDisplayNameState] = useState(identity.displayName);
  const [threads, setThreads] = useState<MaterialisedThread[]>([]);
  const [events, setEvents] = useState<CommonThreadEvent[]>([]);
  const [status, setStatus] = useState<MeshStatus>(IDLE_STATUS);
  const [ready, setReady] = useState(false);
  const [peerNames, setPeerNames] = useState<Record<string, string>>(() =>
    loadPeerDirectory(),
  );

  const serviceRef = useRef<CommonThreadService | null>(null);
  const storeRef = useRef<IndexedDbEventStore | null>(null);
  const transportRef = useRef<LanRelayMeshTransport | null>(null);

  const refresh = useCallback(async () => {
    const service = serviceRef.current;
    const store = storeRef.current;
    if (!service || !store) {
      return;
    }
    const [materialised, rows] = await Promise.all([
      service.listMaterialisedThreads(),
      store.listAllValid(),
    ]);
    setThreads(materialised);
    setEvents(rows.map(recordToEvent));
  }, []);

  useEffect(() => {
    const store = new IndexedDbEventStore();
    const transport = new LanRelayMeshTransport(identity.peerID, {
      displayName: identity.displayName,
    });
    const service = new CommonThreadService(store, transport, identity.peerID);

    storeRef.current = store;
    transportRef.current = transport;
    serviceRef.current = service;

    const unsubscribeService = service.subscribe(() => {
      void refresh();
    });
    const unsubscribeStatus = transport.subscribe(setStatus);

    service.startInboundProcessing();
    transport.connect();
    void refresh().then(() => setReady(true));

    return () => {
      unsubscribeService();
      unsubscribeStatus();
      void service.stopInboundProcessing();
      void transport.close();
      void store.close();
      serviceRef.current = null;
      storeRef.current = null;
      transportRef.current = null;
    };
  }, [identity.peerID, identity.displayName, refresh]);

  // Learn names from presence and keep them after the peer disconnects.
  useEffect(() => {
    if (status.peers.length === 0) {
      return;
    }
    setPeerNames((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const peer of status.peers) {
        if (peer.displayName && next[peer.peerID] !== peer.displayName) {
          next[peer.peerID] = peer.displayName;
          changed = true;
        }
      }
      if (!changed) {
        return previous;
      }
      savePeerDirectory(next);
      return next;
    });
  }, [status.peers]);

  const setDisplayName = useCallback((name: string) => {
    saveDisplayName(name);
    setDisplayNameState(name);
    transportRef.current?.setDisplayName(name);
  }, []);

  const nameFor = useCallback(
    (peerID: string) => {
      if (peerID === identity.peerID) {
        return displayName || "You";
      }
      const live = status.peers.find((item) => item.peerID === peerID);
      return live?.displayName || peerNames[peerID] || fallbackName(peerID);
    },
    [displayName, identity.peerID, peerNames, status.peers],
  );

  const clearLocalData = useCallback(async () => {
    await storeRef.current?.clear();
    await refresh();
  }, [refresh]);

  return {
    peerID: identity.peerID,
    displayName,
    setDisplayName,
    service: serviceRef.current,
    threads,
    events,
    status,
    ready,
    nameFor,
    refresh,
    clearLocalData,
  };
}
