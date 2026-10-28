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

  /** `serialport` queues a write on a closed handle until the next `open`,
   *  which never comes: a fake that called back would hide the hang the
   *  transport's own guard exists to prevent. */
  write(_bytes: Uint8Array, callback: (error?: Error | null) => void): void {
    if (!this.isOpen) return;
    callback(null);
  }

  drain(callback: (error?: Error | null) => void): void {
    if (!this.isOpen) return;
    callback(null);
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

  it("settles the waiting read when the port errors, with what arrived", async () => {
    const port = new FakePort();
    const transport = transportOver(port);

    // Silence then an unplug: the read must not wait out the 10 s cap.
    const started = Date.now();
    const silent = transport.read(5000);
    // The waiter is installed a microtask after the call.
    await Promise.resolve();
    port.emit("error", new Error("unplugged"));
    expect((await silent).length).toBe(0);
    expect(Date.now() - started).toBeLessThan(1000);

    // And a half-arrived reply is handed over rather than dropped; the next
    // write surfaces the disconnect.
    const reading = transport.read(5000);
    await Promise.resolve();
    port.emit("data", Buffer.from("par"));
    port.emit("error", new Error("unplugged"));
    expect(decode(await reading)).toBe("par");
  });

  it("settles a waiting read on close and stops listening", async () => {
    const port = new FakePort();
    const transport = transportOver(port);
    const reading = transport.read(5000);

    await transport.close();

    expect((await reading).length).toBe(0);
    expect(port.listenerCount("data")).toBe(0);

    // Nothing arrives from a port nobody listens to, and a read after close
    // answers at once rather than waiting out its cap.
    port.emit("data", Buffer.from("late"));
    const started = Date.now();
    expect((await transport.read(50)).length).toBe(0);
    expect(Date.now() - started).toBeLessThan(40);
  });

  it("drains what arrived unread, then reads the answer that follows", async () => {
    const port = new FakePort();
    const transport = transportOver(port);

    // A reply that arrived with nothing reading is exactly the open-time
    // QUERY_STATUS text a `status` command must not mistake for its answer.
    port.emit("data", Buffer.from("needReSend:0|renderCnt:0"));
    await pause(SETTLED_MS);

    const started = Date.now();
    expect(decode(transport.drainPending())).toBe("needReSend:0|renderCnt:0");
    expect(Date.now() - started).toBeLessThan(40);

    // The drain's discard window ends on a quiet gap; the command's write and
    // the device's answer come after it.
    await pause(SETTLED_MS);
    port.emit("data", Buffer.from("needReSend:0|renderCnt:1"));
    expect(decode(await transport.read(1000))).toBe("needReSend:0|renderCnt:1");
  });

  it("drops the rest of a burst drained mid-arrival", async () => {
    const port = new FakePort();
    const transport = transportOver(port);

    port.emit("data", Buffer.from("stal"));
    expect(decode(transport.drainPending())).toBe("stal");

    // The same burst's tail arrives after the drain; read on its own it would
    // seal 50 ms later and be served as the next command's answer.
    port.emit("data", Buffer.from("e"));
    await pause(SETTLED_MS);

    expect((await transport.read(30)).length).toBe(0);
  });

  it("drops a chunk just after the drain and reads the answer that follows", async () => {
    const port = new FakePort();
    const transport = transportOver(port);

    transport.drainPending();
    await pause(10);
    port.emit("data", Buffer.from("tail"));
    await pause(SETTLED_MS);

    const reading = transport.read(1000);
    port.emit("data", Buffer.from("needReSend:0|renderCnt:1"));

    expect(decode(await reading)).toBe("needReSend:0|renderCnt:1");
  });

  it("reads the answer a write starts inside the drain's quiet window", async () => {
    const port = new FakePort();
    const transport = transportOver(port);

    // The open-time status reply is drained with nothing reading, which arms
    // the discard window; the command's own write follows immediately.
    port.emit("data", Buffer.from("needReSend:0|renderCnt:0"));
    await pause(SETTLED_MS);
    expect(decode(transport.drainPending())).toBe("needReSend:0|renderCnt:0");

    // A USB-CDC write flushes in about a millisecond, so the answer lands well
    // inside the 50 ms quiet window the drain armed.
    await transport.write(Uint8Array.of(1));
    await pause(2);
    port.emit("data", Buffer.from("needReSend:0|renderCnt:1"));

    // The write is the boundary: those bytes are this read's answer, not the
    // stale burst's tail.
    expect(decode(await transport.read(1000))).toBe("needReSend:0|renderCnt:1");
  });

  it("drains nothing when the wire has been silent", () => {
    const transport = transportOver(new FakePort());

    expect(transport.drainPending().length).toBe(0);
  });

  it("runs two concurrent reads one at a time, in order", async () => {
    const port = new FakePort();
    const transport = transportOver(port);

    const first = transport.read(1000);
    const second = transport.read(1000);

    port.emit("data", Buffer.from("one"));
    await pause(SETTLED_MS);
    port.emit("data", Buffer.from("two"));

    // The second read must not share the first one's waiter, or its reply is
    // delivered to a promise nobody is left to answer.
    expect(decode(await first)).toBe("one");
    expect(decode(await second)).toBe("two");
  });
});

describe("the serial transport's write", () => {
  it("resolves a write while the port is open", async () => {
    const port = new FakePort();
    const transport = transportOver(port);

    await expect(transport.write(Uint8Array.of(1))).resolves.toBeUndefined();
  });

  it("refuses a write once close has begun instead of queueing it forever", async () => {
    const port = new FakePort();
    const transport = transportOver(port);
    await transport.close();

    // A command racing a stop reaches a handle the binding queues on `open`
    // forever; the transport must refuse it so the route can answer.
    const started = Date.now();
    await expect(transport.write(Uint8Array.of(1))).rejects.toMatchObject({
      code: "ERR_SERIAL_PORT_CLOSED",
    });
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
