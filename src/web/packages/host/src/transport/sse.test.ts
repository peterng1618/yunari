import type { ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { SseConnection } from "./sse.js";

/** A response that records what a stream wrote, and can refuse a write so the
 *  drain path is reachable. */
function fakeResponse(writable = (): boolean => true): {
  readonly response: ServerResponse;
  readonly writes: string[];
  readonly ends: () => number;
  readonly drain: () => void;
} {
  const writes: string[] = [];
  const drainListeners: (() => void)[] = [];
  let ends = 0;

  const response = {
    writeHead: () => response,
    write: (chunk: string) => {
      writes.push(chunk);
      return writable();
    },
    once: (event: string, listener: () => void) => {
      if (event === "drain") drainListeners.push(listener);
      return response;
    },
    end: () => {
      ends += 1;
    },
  } as unknown as ServerResponse;

  return {
    response,
    writes,
    ends: () => ends,
    drain: () => {
      for (const listener of drainListeners.splice(0)) listener();
    },
  };
}

/** The batch a tick frames once for every connection that shares it. */
const FRAME = 'event: sample\ndata: {"sentAt":"2026-10-25T00:00:00.000Z"}\n\n';

describe("SseConnection", () => {
  it("writes the frame it was handed, without framing it a second time", () => {
    const fake = fakeResponse();
    const connection = new SseConnection(fake.response, ["gpu.temp"], "living");

    connection.offer(FRAME);

    // A connection that still formatted its payload would write an
    // `event: sample` header of its own around this text.
    expect(fake.writes.at(-1)).toBe(FRAME);
  });

  it("gives two connections sharing one batch the same frame text", () => {
    const one = fakeResponse();
    const two = fakeResponse();
    const first = new SseConnection(one.response, ["gpu.temp"], "living");
    const second = new SseConnection(two.response, ["gpu.temp"], "living");

    // One payload, two connections: the frame is built once and offered twice.
    first.offer(FRAME);
    second.offer(FRAME);

    expect(one.writes.at(-1)).toBe(FRAME);
    expect(two.writes.at(-1)).toBe(FRAME);

    const next =
      'event: sample\ndata: {"sentAt":"2026-10-25T00:00:05.000Z"}\n\n';
    first.offer(next);
    expect(one.writes.at(-1)).toBe(next);
  });

  it("drops a frame offered to a connection that has closed", () => {
    const fake = fakeResponse();
    const connection = new SseConnection(fake.response, ["gpu.temp"], "living");
    const before = fake.writes.length;

    connection.close();
    connection.offer(FRAME);

    expect(fake.writes.length).toBe(before);
    expect(fake.ends()).toBe(1);
  });

  it("delivers every frame that waited on a drain, in order", () => {
    let writable = false;
    const fake = fakeResponse(() => writable);
    const connection = new SseConnection(fake.response, ["gpu.temp"], "living");

    connection.offer("first");
    connection.offer("second");
    connection.offer("third");

    // The socket refused "first" and has not drained, so the other two wait
    // rather than replacing each other: each frame carries its own batch of
    // readings (0124).
    expect(fake.writes.at(-1)).toBe("first");
    expect(connection.droppedCount).toBe(0);

    writable = true;
    fake.drain();

    // The constructor's `: connected` header is the first write.
    expect(fake.writes.slice(1)).toEqual(["first", "second", "third"]);
  });
});
