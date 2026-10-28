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

describe("the serial transport's read", () => {
  it("settles a reply on a quiet gap instead of the whole timeout", async () => {
    const port = new FakePort();
    const transport = transportOver(port);

    const started = Date.now();
    const reading = transport.read(5000);
    port.emit("data", Buffer.from("ok"));

    expect(new TextDecoder().decode(await reading)).toBe("ok");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("keeps collecting until the device goes quiet", async () => {
    const port = new FakePort();
    const transport = transportOver(port);

    const reading = transport.read(5000);
    port.emit("data", Buffer.from("ch"));
    port.emit("data", Buffer.from("s_5"));

    expect(new TextDecoder().decode(await reading)).toBe("chs_5");
  });

  it("resolves empty at the timeout for a silent device", async () => {
    const transport = transportOver(new FakePort());

    const started = Date.now();
    const bytes = await transport.read(80);

    expect(bytes.length).toBe(0);
    expect(Date.now() - started).toBeGreaterThanOrEqual(70);
  });
});
