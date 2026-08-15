/**
 * Folds accepted envelopes into thread state.
 *
 * Pure and order-independent: envelopes arrive over a mesh in whatever order
 * the radio delivers them, and a reply can land before the request it belongs
 * to. Feeding the same set in any order must produce the same state.
 */

import type { MeshEnvelope } from '../mesh/MeshEnvelope';

export type ThreadStatus = 'open' | 'matched' | 'resolved';

export type Reply = {
  messageId: string;
  senderId: string;
  text: string;
  createdAtMs: number;
};

export type Offer = {
  messageId: string;
  senderId: string;
  description: string;
  createdAtMs: number;
  accepted: boolean;
};

export type Thread = {
  threadId: string;
  /** Null when replies arrived before the request that created the thread. */
  createdBy: string | null;
  title: string | null;
  category: string | null;
  place: string | null;
  createdAtMs: number | null;
  status: ThreadStatus;
  replies: Reply[];
  offers: Offer[];
  resolvedOutcome: string | null;
};

export type ThreadState = {
  threads: Map<string, Thread>;
};

export function emptyState(): ThreadState {
  return { threads: new Map() };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Thread a given envelope belongs to. */
function threadIdFor(envelope: MeshEnvelope): string | null {
  if (envelope.type === 'thread.created') return envelope.messageId;
  const id = envelope.payload.threadId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function ensureThread(state: ThreadState, threadId: string): Thread {
  let thread = state.threads.get(threadId);
  if (thread === undefined) {
    // A placeholder, created when a reply or offer outruns its request. The
    // request fills in the metadata whenever it arrives.
    thread = {
      threadId,
      createdBy: null,
      title: null,
      category: null,
      place: null,
      createdAtMs: null,
      status: 'open',
      replies: [],
      offers: [],
      resolvedOutcome: null,
    };
    state.threads.set(threadId, thread);
  }
  return thread;
}

/** Stable order: creation time, then message id to break ties across devices. */
function byCreatedAt<T extends { createdAtMs: number; messageId: string }>(
  a: T,
  b: T,
): number {
  if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs - b.createdAtMs;
  return a.messageId < b.messageId ? -1 : a.messageId > b.messageId ? 1 : 0;
}

/**
 * Apply one envelope. Mutates and returns `state`.
 *
 * Authorisation: only the thread creator may accept an offer or resolve a
 * thread. With a shared room secret any member could forge a senderId, so this
 * check constrains honest clients, not attackers. It is not a security
 * boundary and must not be described as one.
 */
export function applyEnvelope(state: ThreadState, envelope: MeshEnvelope): ThreadState {
  const threadId = threadIdFor(envelope);
  if (threadId === null) return state;

  switch (envelope.type) {
    case 'thread.created': {
      const thread = ensureThread(state, threadId);
      thread.createdBy = envelope.senderId;
      thread.title = stringOrNull(envelope.payload.title);
      thread.category = stringOrNull(envelope.payload.category);
      thread.place = stringOrNull(envelope.payload.place);
      thread.createdAtMs = envelope.createdAtMs;

      // An offer may already have been accepted while the request was still
      // in flight. Recompute rather than forcing 'open'.
      if (thread.status !== 'resolved') {
        thread.status = thread.offers.some((o) => o.accepted) ? 'matched' : 'open';
      }
      break;
    }

    case 'thread.reply': {
      const thread = ensureThread(state, threadId);
      const text = stringOrNull(envelope.payload.text);
      if (text === null) break;

      const isOffer = envelope.payload.isOffer === true;

      if (isOffer) {
        const existing = thread.offers.find((o) => o.messageId === envelope.messageId);

        if (existing === undefined) {
          thread.offers.push({
            messageId: envelope.messageId,
            senderId: envelope.senderId,
            description: text,
            createdAtMs: envelope.createdAtMs,
            accepted: false,
          });
          thread.offers.sort(byCreatedAt);
        } else if (existing.senderId === '') {
          // A stub left by an accept that outran this offer. Fill in the body
          // and keep the accepted flag, so arrival order does not change the
          // result. A real duplicate has a senderId and is left alone.
          existing.senderId = envelope.senderId;
          existing.description = text;
          existing.createdAtMs = envelope.createdAtMs;
          thread.offers.sort(byCreatedAt);
        }
      } else if (!thread.replies.some((r) => r.messageId === envelope.messageId)) {
        thread.replies.push({
          messageId: envelope.messageId,
          senderId: envelope.senderId,
          text,
          createdAtMs: envelope.createdAtMs,
        });
        thread.replies.sort(byCreatedAt);
      }
      break;
    }

    case 'offer.accepted': {
      const thread = ensureThread(state, threadId);
      const offerId = stringOrNull(envelope.payload.offerId);
      if (offerId === null) break;

      // createdBy null means the request has not arrived yet. Accept
      // provisionally: rejecting would make the outcome depend on arrival
      // order, and the request will not contradict it.
      if (thread.createdBy !== null && thread.createdBy !== envelope.senderId) break;

      const offer = thread.offers.find((o) => o.messageId === offerId);
      if (offer !== undefined) {
        offer.accepted = true;
      } else {
        // The offer itself is still in flight. Record a stub so the accept is
        // not lost; the offer body fills in when it arrives.
        thread.offers.push({
          messageId: offerId,
          senderId: '',
          description: '',
          createdAtMs: envelope.createdAtMs,
          accepted: true,
        });
        thread.offers.sort(byCreatedAt);
      }

      if (thread.status === 'open') thread.status = 'matched';
      break;
    }

    case 'thread.resolved': {
      const thread = ensureThread(state, threadId);
      if (thread.createdBy !== null && thread.createdBy !== envelope.senderId) break;
      thread.status = 'resolved';
      thread.resolvedOutcome = stringOrNull(envelope.payload.outcome);
      break;
    }

    case 'presence':
      // Presence carries no thread state.
      break;
  }

  return state;
}

/** Fold a whole set. Result does not depend on the order given. */
export function reduceEnvelopes(envelopes: MeshEnvelope[]): ThreadState {
  const state = emptyState();
  for (const envelope of envelopes) {
    applyEnvelope(state, envelope);
  }
  return state;
}

/** Threads for display, newest activity first. */
export function listThreads(state: ThreadState): Thread[] {
  return [...state.threads.values()].sort((a, b) => {
    const aTime = a.createdAtMs ?? 0;
    const bTime = b.createdAtMs ?? 0;
    if (aTime !== bTime) return bTime - aTime;
    return a.threadId < b.threadId ? -1 : 1;
  });
}
