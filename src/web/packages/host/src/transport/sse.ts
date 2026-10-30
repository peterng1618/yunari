import type { ServerResponse } from "node:http";
import { FrameQueue } from "./frame-queue.js";

/**
 * How far behind a connection may fall before its oldest frames are dropped.
 *
 * 120 frames is two minutes at the host's 1 s cadence — longer than any chart
 * window the display draws, and far longer than a chart's 5 minute store. It
 * bounds a wedged client's memory at a few hundred kilobytes while keeping
 * every ordinary stall recoverable.
 */
export const SSE_FRAME_QUEUE_LIMIT = 120;

/**
 * One display connection.
 *
 * Each frame is a batch of measurements, so backpressure queues rather than
 * replaces them: losing a frame loses that tick's readings from the display's
 * history for good. The queue is bounded, so a client that never drains
 * cannot grow the host without limit.
 */
export class SseConnection {
  private readonly queue = new FrameQueue<string>(SSE_FRAME_QUEUE_LIMIT);
  private waitingForDrain = false;
  private closed = false;

  /**
   * Keys requested by this display, the display itself, and the language it
   * declared: the host resolves each display's own device assignment and polls
   * their union across connections, and localizes text per display.
   */
  constructor(
    private readonly response: ServerResponse,
    readonly semanticKeys: readonly string[],
    readonly display: string,
    readonly language?: string,
  ) {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });

    // Flush headers so EventSource can report open before the first sample batch.
    response.write(": connected\n\n");
  }

  /** Sends a frame the batch already built once, or queues it behind the
   *  frames a backed-up socket has not taken yet. The connection does not
   *  format: one payload shared by many connections is framed once, where it is
   *  produced. */
  offer(frame: string): void {
    if (this.closed) {
      return;
    }

    this.queue.offer(frame);
    this.flush();
  }

  private flush(): void {
    if (this.closed || this.waitingForDrain) {
      return;
    }

    // Drain everything the socket will take. Writing one frame and returning
    // would leave a queue delivered at one frame per offer — a slow client
    // would then lag a further cadence per batch and never catch up.
    for (;;) {
      const frame = this.queue.take();

      if (frame === undefined) {
        return;
      }

      if (this.response.write(frame)) {
        continue;
      }

      this.waitingForDrain = true;
      this.response.once("drain", () => {
        this.waitingForDrain = false;
        this.flush();
      });
      return;
    }
  }

  /** Frames displaced before delivery. */
  get droppedCount(): number {
    return this.queue.droppedCount;
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    // A write that lost its client raises on the response before the server's
    // own listener has removed this connection; ending an already-destroyed
    // response would raise again, from inside `close`.
    if (!this.response.destroyed) {
      this.response.end();
    }
  }
}
