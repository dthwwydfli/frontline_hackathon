import { encodeCommonThreadEvent } from "../Domain/CommonThreadEvent.js";
import type {
  CommonThreadEventStore,
  IngestInput,
  IngestResult,
  StoredEventRecord,
} from "./CommonThreadEventStore.js";

const DB_VERSION = 1;
const STORE = "ct_events";
const IDX_UPSTREAM = "by_upstream";
const IDX_THREAD = "by_thread";
const IDX_STATUS = "by_status_received";

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
  });
}

function isConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as DOMException).name === "ConstraintError"
  );
}

/**
 * Append-only browser store. Mirrors `SqliteEventStore` semantics exactly:
 * valid events are immutable, ingest is idempotent on both `eventID` and
 * `upstreamMessageID`, and only rejected rows are ever pruned.
 *
 * Deliberately dependency-free — the demo must run from a laptop with no
 * package install on the phone side.
 */
export class IndexedDbEventStore implements CommonThreadEventStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly databaseName = "common-thread",
    private readonly indexedDB: IDBFactory = globalThis.indexedDB,
  ) {}

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) {
      return this.dbPromise;
    }
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.indexedDB.open(this.databaseName, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (db.objectStoreNames.contains(STORE)) {
          return;
        }
        const store = db.createObjectStore(STORE, { keyPath: "eventID" });
        // Dual-key deduplication: eventID is the primary key, and the upstream
        // ID is unique so a relayed duplicate cannot insert a second row.
        store.createIndex(IDX_UPSTREAM, "upstreamMessageID", { unique: true });
        store.createIndex(IDX_THREAD, "threadID");
        store.createIndex(IDX_STATUS, ["validationStatus", "receivedAt"]);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Could not open IndexedDB"));
      request.onblocked = () =>
        reject(new Error("IndexedDB upgrade blocked by another tab"));
    });
    return this.dbPromise;
  }

  private async read<T>(fn: (store: IDBObjectStore) => Promise<T>): Promise<T> {
    const db = await this.open();
    const tx = db.transaction(STORE, "readonly");
    return fn(tx.objectStore(STORE));
  }

  async ingest(input: IngestInput): Promise<IngestResult> {
    const existingByEvent = await this.getByEventID(input.event.eventID);
    if (existingByEvent) {
      return { inserted: false, duplicate: true, record: existingByEvent };
    }
    const existingByUpstream = await this.getByUpstreamMessageID(
      input.upstreamMessageID,
    );
    if (existingByUpstream) {
      return { inserted: false, duplicate: true, record: existingByUpstream };
    }

    const record: StoredEventRecord = {
      eventID: input.event.eventID,
      upstreamMessageID: input.upstreamMessageID,
      threadID: input.event.threadID,
      authorPeerID: input.event.authorPeerID,
      kind: input.event.kind,
      createdAt: input.event.createdAt,
      receivedAt: input.receivedAt.toISOString(),
      canonicalEventJson: encodeCommonThreadEvent(input.event),
      validationStatus: input.validationStatus,
      ...(input.rejectionReason === undefined
        ? {}
        : { rejectionReason: input.rejectionReason }),
    };

    const db = await this.open();
    const tx = db.transaction(STORE, "readwrite");
    try {
      tx.objectStore(STORE).add(record);
      await txDone(tx);
    } catch (error) {
      // Race-safe: another tab or a concurrent relay frame won the insert.
      if (isConstraintError(error) || isConstraintError(tx.error)) {
        const again =
          (await this.getByEventID(input.event.eventID)) ??
          (await this.getByUpstreamMessageID(input.upstreamMessageID)) ??
          undefined;
        return { inserted: false, duplicate: true, record: again };
      }
      throw error;
    }

    return { inserted: true, duplicate: false, record };
  }

  async getByEventID(eventID: string): Promise<StoredEventRecord | null> {
    return this.read(async (store) => {
      const row = await promisify(store.get(eventID));
      return (row as StoredEventRecord | undefined) ?? null;
    });
  }

  async getByUpstreamMessageID(
    upstreamMessageID: string,
  ): Promise<StoredEventRecord | null> {
    return this.read(async (store) => {
      const row = await promisify(
        store.index(IDX_UPSTREAM).get(upstreamMessageID),
      );
      return (row as StoredEventRecord | undefined) ?? null;
    });
  }

  async listValidByThreadID(threadID: string): Promise<StoredEventRecord[]> {
    return this.read(async (store) => {
      const rows = (await promisify(
        store.index(IDX_THREAD).getAll(threadID),
      )) as StoredEventRecord[];
      return rows.filter((row) => row.validationStatus === "valid");
    });
  }

  async listAllValid(): Promise<StoredEventRecord[]> {
    return this.read(async (store) => {
      const rows = (await promisify(store.getAll())) as StoredEventRecord[];
      return rows.filter((row) => row.validationStatus === "valid");
    });
  }

  async pruneRejected(olderThan: Date): Promise<number> {
    const cutoff = olderThan.toISOString();
    const db = await this.open();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const rows = (await promisify(store.getAll())) as StoredEventRecord[];
    let removed = 0;
    for (const row of rows) {
      if (row.validationStatus === "rejected" && row.receivedAt < cutoff) {
        store.delete(row.eventID);
        removed += 1;
      }
    }
    await txDone(tx);
    return removed;
  }

  /** Demo-only: wipe local state. Never called on the mesh path. */
  async clear(): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    await txDone(tx);
  }

  async close(): Promise<void> {
    if (!this.dbPromise) {
      return;
    }
    const db = await this.dbPromise;
    db.close();
    this.dbPromise = null;
  }
}
