import type { PeerID } from "@core/Domain/CommonThreadEvent";

const PEER_KEY = "common-thread.peerID";
const NAME_KEY = "common-thread.displayName";

export interface LocalIdentity {
  peerID: PeerID;
  displayName: string;
}

/**
 * There are no accounts (PLD-01). A device mints its own peer ID once and
 * keeps it locally; the display name is a nickname for presence only and never
 * enters a CommonThreadEvent body.
 */
export function loadIdentity(): LocalIdentity {
  let peerID = localStorage.getItem(PEER_KEY);
  if (!peerID) {
    peerID = `peer-${crypto.randomUUID().slice(0, 8)}`;
    localStorage.setItem(PEER_KEY, peerID);
  }
  return { peerID, displayName: localStorage.getItem(NAME_KEY) ?? "" };
}

export function saveDisplayName(displayName: string): void {
  localStorage.setItem(NAME_KEY, displayName);
}

/** Short, stable label for a peer we have never seen a name for. */
export function fallbackName(peerID: string): string {
  return `Neighbour ${peerID.replace(/^peer-/, "").slice(0, 4)}`;
}

const DIRECTORY_KEY = "common-thread.peerNames";

/**
 * Names of peers seen at any point, not just those currently connected.
 *
 * Presence is live state: a phone that sleeps or walks out of range drops off
 * it. Their posts stay in the append-only log, so without this their name would
 * revert to "Neighbour a1b2" on every thread they wrote.
 */
export function loadPeerDirectory(): Record<string, string> {
  try {
    const raw = localStorage.getItem(DIRECTORY_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function savePeerDirectory(directory: Record<string, string>): void {
  try {
    localStorage.setItem(DIRECTORY_KEY, JSON.stringify(directory));
  } catch {
    // Private browsing with storage disabled: names fall back, nothing breaks.
  }
}
