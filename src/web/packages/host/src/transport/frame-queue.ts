/**
 * A bounded FIFO for streamed frames.
 *
 * Each frame is a measurement batch, not a superseding snapshot: a slow
 * connection must receive every batch it can, in order, or a chart's history
 * loses readings it can never recover. The bound is what stops a wedged client
 * growing without limit; past it the oldest frame is dropped and counted, which
 * is §122's "bound queues".
 */
export class FrameQueue<T> {
  readonly #pending: T[] = [];
  readonly #limit: number;
  #dropped = 0;
  #delivered = 0;

  constructor(limit: number) {
    this.#limit = Math.max(1, Math.floor(limit));
  }

  /** Queues an item; reports whether it displaced the oldest queued one. */
  offer(item: T): boolean {
    const displaced = this.#pending.length >= this.#limit;

    if (displaced) {
      this.#pending.shift();
      this.#dropped += 1;
    }

    this.#pending.push(item);

    return displaced;
  }

  /** Takes the oldest queued item. */
  take(): T | undefined {
    const item = this.#pending.shift();

    if (item !== undefined) {
      this.#delivered += 1;
    }

    return item;
  }

  get size(): number {
    return this.#pending.length;
  }

  /** Items displaced before delivery. */
  get droppedCount(): number {
    return this.#dropped;
  }

  get deliveredCount(): number {
    return this.#delivered;
  }
}
