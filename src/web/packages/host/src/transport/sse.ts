import type { ServerResponse } from "node:http";
import { KeepLatestSlot } from "./keep-latest.js";

/** One display connection. Backpressure keeps only the newest pending snapshot. */
export class SseConnection {
  private readonly slot = new KeepLatestSlot<string>();
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

  /** Sends a frame the batch already built once, or leaves it as the newest
   *  pending frame. The connection does not format: one payload shared by many
   *  connections is framed once, where it is produced. */
  offer(frame: string): void {
    if (this.closed) {
      return;
    }

    this.slot.offer(frame);
    this.flush();
  }

  private flush(): void {
    if (this.closed || this.waitingForDrain) {
      return;
    }

    const frame = this.slot.take();

    if (frame === undefined) {
      return;
    }

    const flushed = this.response.write(frame);

    if (flushed) {
      return;
    }

    this.waitingForDrain = true;
    this.response.once("drain", () => {
      this.waitingForDrain = false;
      this.flush();
    });
  }

  /** Frames displaced before delivery. */
  get droppedCount(): number {
    return this.slot.droppedCount;
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.response.end();
  }
}
