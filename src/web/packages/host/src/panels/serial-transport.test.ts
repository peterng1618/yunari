import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { type SerialPortLike, transportOver } from "./serial-transport.js";

/** A `SerialPort`-shaped emitter: enough for the transport's read seam. */
class FakePort extends EventEmitter implements SerialPortLike {
  isOpen = true;

  close(callback?: (error: Error | null | undefined) => void): void {
    this.isOpen = false;
    callback?.(null);
  }
}

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

/** Real time on purpose: the quiet gap is the behaviour under test. */
const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Longer than the transport's 50 ms quiet gap, so a burst has sealed. */
const SETTLED_MS = 80;

describe("the serial transport's read", () => {
  it("settles a reply on a quiet gap instead of the whole timeout", async () => {
    const port = new FakePort();
    const transport = transportOver(port);

    const started = Date.now();
    const reading = transport.read(5000);
    port.emit("data", Buffer.from("ok"));

    expect(decode(await reading)).toBe("ok");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("keeps collecting until the device goes quiet", async () => {
    const port = new FakePort();
    const transport = transportOver(port);

    const reading = transport.read(5000);
    port.emit("data", Buffer.from("ch"));
    port.emit("data", Buffer.from("s_5"));

    expect(decode(await reading)).toBe("chs_5");
  });

  it("returns a reply that arrived before the read, including one already settled", async () => {
    const port = new FakePort();
    const transport = transportOver(port);

    // Mid-burst: the bytes are held and the read waits out the rest of it.
    port.emit("data", Buffer.from("burst"));
    expect(decode(await transport.read(5000))).toBe("burst");

    // Sealed with nobody reading: the next read is served at once rather than
    // paying a quiet gap it has already waited.
    port.emit("data", Buffer.from("next"));
    await pause(SETTLED_MS);

    const started = Date.now();
    expect(decode(await transport.read(1000))).toBe("next");
    expect(Date.now() - started).toBeLessThan(40);
  });

  it("answers replies that arrived with no read pending one per read, in order", async () => {
    const port = new FakePort();
    const transport = transportOver(port);

    // Two replies the device spoke while the caller was still writing. Each is
    // its own burst, so each is one read's worth; a merge would lose the ack
    // the upload is waiting for.
    port.emit("data", Buffer.from("first"));
    await pause(SETTLED_MS);
    port.emit("data", Buffer.from("second"));
    await pause(SETTLED_MS);

    expect(decode(await transport.read(1000))).toBe("first");
    expect(decode(await transport.read(1000))).toBe("second");
    expect((await transport.read(20)).length).toBe(0);
  });

  it("splits a reply whose parts are further apart than the quiet gap", async () => {
    const port = new FakePort();
    const transport = transportOver(port);

    // The wire has no frame end: a gap longer than the quiet window is
    // indistinguishable from two replies, so it is two reads' worth. The
    // adapter matches by content rather than by position, so a stale or
    // trailing reply is skipped rather than misread.
    const reading = transport.read(1000);
    port.emit("data", Buffer.from("seq_"));
    await pause(70);
    port.emit("data", Buffer.from("png_init_"));

    expect(decode(await reading)).toBe("seq_");
    expect(decode(await transport.read(1000))).toBe("png_init_");
  });

  it("resolves empty at the timeout for a silent device", async () => {
    const transport = transportOver(new FakePort());

    const started = Date.now();
    const bytes = await transport.read(80);

    expect(bytes.length).toBe(0);
    expect(Date.now() - started).toBeGreaterThanOrEqual(70);
  });
});
