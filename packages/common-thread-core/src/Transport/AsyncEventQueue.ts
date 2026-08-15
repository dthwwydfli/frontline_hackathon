import type { ReceivedCommonThreadEvent } from "./CommonThreadMeshTransport.js";

/**
 * Push-driven async iterable with a non-blocking drain.
 *
 * Parked `next()` waiters are resolved in FIFO order so a relay burst cannot be
 * stolen by an abandoned waiter (see ISSUE-001). `close()` completes every
 * parked waiter so consumers of `receivedPublicEvents` can shut down without
 * needing one more inbound event to unblock them.
 */
export class AsyncEventQueue {
  private readonly queue: ReceivedCommonThreadEvent[] = [];
  private readonly waiters: Array<
    (v: IteratorResult<ReceivedCommonThreadEvent>) => void
  > = [];
  private closed = false;

  readonly iterable: AsyncIterable<ReceivedCommonThreadEvent> = {
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        if (this.queue.length > 0) {
          return { value: this.queue.shift()!, done: false };
        }
        if (this.closed) {
          return { value: undefined, done: true };
        }
        return new Promise<IteratorResult<ReceivedCommonThreadEvent>>(
          (resolve) => {
            this.waiters.push(resolve);
          },
        );
      },
    }),
  };

  push(item: ReceivedCommonThreadEvent): void {
    if (this.closed) {
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: item, done: false });
    } else {
      this.queue.push(item);
    }
  }

  /** Take everything buffered without parking a waiter. */
  drainPending(): ReceivedCommonThreadEvent[] {
    return this.queue.splice(0, this.queue.length);
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()!({ value: undefined, done: true });
    }
  }
}
