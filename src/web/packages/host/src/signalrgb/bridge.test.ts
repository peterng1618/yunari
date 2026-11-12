import { createSocket } from "node:dgram";
import { afterEach, describe, expect, it } from "vitest";
import type { DeviceSink, DeviceTelemetry } from "../panels/device-sink.js";
import {
  BridgeRequestError,
  createSignalRgbBridge,
  DeviceNotFoundError,
  parseColourFrame,
  parseHexColour,
  type SignalRgbBridge,
} from "./bridge.js";

/** A frame in the contract's shape. */
function frameOf(deviceIndex: number, colours: readonly number[]): Uint8Array {
  const ledCount = colours.length / 3;
  const frame = new Uint8Array(8 + colours.length);
  frame.set([
    0x59,
    0x52,
    0x47,
    0x42,
    1,
    deviceIndex,
    ledCount & 0xff,
    ledCount >> 8,
  ]);
  frame.set(colours, 8);
  return frame;
}

/** A device-sized frame whose first LED carries `first` and whose other 39
 *  are black: the receiver refuses a frame sized for another device. */
function fullFrame(deviceIndex: number, first: readonly number[]): Uint8Array {
  const colours = new Array<number>(40 * 3).fill(0);
  colours[0] = first[0] ?? 0;
  colours[1] = first[1] ?? 0;
  colours[2] = first[2] ?? 0;
  return frameOf(deviceIndex, colours);
}

function send(port: number, frame: Uint8Array): void {
  const socket = createSocket("udp4");
  socket.send(frame, port, "127.0.0.1", () => socket.close());
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition was never met");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const telemetry: DeviceTelemetry = {
  liquidTempC: 31.5,
  pumpRpm: 1_800,
  fanRpm: 900,
  pumpPercent: 55,
  fanPercent: 40,
};

function fakeSink(id: string): DeviceSink & {
  writes: Uint8Array[];
  released: (() => void)[];
  block: boolean;
  controls: {
    pump: boolean;
    fans: boolean;
    telemetry: boolean;
    set(input: {
      pumpPercent?: number | undefined;
      fanPercent?: number | undefined;
    }): Promise<void>;
    read(): Promise<DeviceTelemetry>;
  };
} {
  const writes: Uint8Array[] = [];
  const released: (() => void)[] = [];
  const sink = {
    id,
    kind: "kraken",
    name: "NZXT Kraken Z",
    lighting: {
      ledCount: 40,
      channels: [{ name: "Kraken Z", leds: 40 }],
      layout: { shape: "rings" as const, width: 3, height: 3, count: 3 },
    },
    controls: {
      pump: true,
      fans: true,
      telemetry: true,
      set: async () => undefined,
      read: async () => telemetry,
    },
    display: { kind: "panel" as const, width: 320, height: 320 },
    writes,
    released,
    block: false,
    writeColors: (rgb: Uint8Array): Promise<void> => {
      writes.push(rgb);
      if (!sink.block) return Promise.resolve();
      return new Promise<void>((resolve) => released.push(resolve));
    },
  };
  return sink;
}

const bridges: SignalRgbBridge[] = [];

afterEach(async () => {
  for (const bridge of bridges.splice(0)) await bridge.close();
});

describe("parseColourFrame", () => {
  it("reads the index, LED count and RGB triples", () => {
    const parsed = parseColourFrame(frameOf(2, [1, 2, 3, 4, 5, 6]));

    expect(parsed.deviceIndex).toBe(2);
    expect(parsed.ledCount).toBe(2);
    expect([...parsed.rgb]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("refuses a foreign magic, a version it cannot read and a short body", () => {
    const wrongMagic = frameOf(0, [1, 2, 3]);
    wrongMagic[0] = 0x00;
    expect(() => parseColourFrame(wrongMagic)).toThrow(/YRGB/);

    const wrongVersion = frameOf(0, [1, 2, 3]);
    wrongVersion[4] = 2;
    expect(() => parseColourFrame(wrongVersion)).toThrow(/version 2/);

    expect(() => parseColourFrame(frameOf(0, [1, 2, 3]).slice(0, 10))).toThrow(
      /declares 1 LEDs/,
    );
  });

  it("reads #rrggbb and refuses anything else", () => {
    expect([...parseHexColour("#12AbF0")]).toEqual([0x12, 0xab, 0xf0]);
    expect(() => parseHexColour("red")).toThrow(/rrggbb/);
    expect(() => parseHexColour("#12345")).toThrow(/rrggbb/);
  });
});

describe("SignalRGB bridge", () => {
  it("publishes the hub and one device in the contract's shape", async () => {
    const sink = fakeSink("kraken-z");
    const bridge = await createSignalRgbBridge({
      port: 0,
      sinks: () => [sink],
    });
    bridges.push(bridge);

    const descriptor = bridge.describe();
    expect(descriptor.hub).toEqual({ name: "Yunari", vendor: "Yunari" });
    expect(descriptor.devices).toHaveLength(1);
    expect(descriptor.devices[0]).toMatchObject({
      id: "kraken-z",
      kind: "kraken",
      name: "NZXT Kraken Z",
      lighting: {
        ledCount: 40,
        udpPort: bridge.port,
        channels: [{ name: "Kraken Z", leds: 40 }],
        layout: { shape: "rings", width: 3, height: 3, count: 3 },
      },
      controls: { pump: true, fans: true, telemetry: true },
      display: { kind: "panel", width: 320, height: 320 },
    });
    expect(descriptor.stats).toEqual({
      received: 0,
      malformed: 0,
      dropped: 0,
    });
  });

  it("orders devices by stable id, which is the UDP index", async () => {
    const bridge = await createSignalRgbBridge({
      port: 0,
      sinks: () => [fakeSink("zeta"), fakeSink("alpha")],
    });
    bridges.push(bridge);

    expect(bridge.describe().devices.map((device) => device.id)).toEqual([
      "alpha",
      "zeta",
    ]);
  });

  it("writes the newest frame and counts the one it replaced", async () => {
    const sink = fakeSink("kraken-z");
    sink.block = true;
    const bridge = await createSignalRgbBridge({
      port: 0,
      sinks: () => [sink],
    });
    bridges.push(bridge);

    send(bridge.port, fullFrame(0, [10, 0, 0]));
    await waitFor(() => sink.writes.length === 1);
    // The first write is now blocked on the fake's promise, so both later
    // frames are pending and the second must replace the first.
    send(bridge.port, fullFrame(0, [20, 0, 0]));
    send(bridge.port, fullFrame(0, [30, 0, 0]));
    await waitFor(
      () => bridge.describe().devices[0]?.lighting?.stats.dropped === 1,
    );

    sink.released.splice(0).forEach((release) => release());
    await waitFor(() => sink.writes.length === 2);
    expect(sink.writes[1]?.[0]).toBe(30);

    const descriptor = bridge.describe();
    expect(descriptor.devices[0]?.lighting?.stats).toEqual({
      received: 3,
      dropped: 1,
    });
    expect(descriptor.stats).toEqual({
      received: 3,
      malformed: 0,
      dropped: 1,
    });
  });

  it("counts malformed and device-less frames", async () => {
    const bridge = await createSignalRgbBridge({
      port: 0,
      sinks: () => [fakeSink("kraken-z")],
    });
    bridges.push(bridge);

    send(bridge.port, Uint8Array.of(0, 1, 2));
    send(bridge.port, fullFrame(3, [1, 2, 3]));
    await waitFor(() => {
      const stats = bridge.describe().stats;
      return (
        stats.malformed === 1 && stats.received === 1 && stats.dropped === 1
      );
    });
  });

  it("refuses unknown devices and bad control bodies", async () => {
    const sink = fakeSink("kraken-z");
    const bridge = await createSignalRgbBridge({
      port: 0,
      sinks: () => [sink],
    });
    bridges.push(bridge);

    await expect(
      bridge.controls("missing", { pumpPercent: 50 }),
    ).rejects.toBeInstanceOf(DeviceNotFoundError);
    await expect(
      bridge.controls("kraken-z", { pumpPercent: "50" }),
    ).rejects.toBeInstanceOf(BridgeRequestError);
    await expect(bridge.controls("kraken-z", {})).rejects.toBeInstanceOf(
      BridgeRequestError,
    );
  });

  it("forwards clamped input to the driver that owns the clamp", async () => {
    const sink = fakeSink("kraken-z");
    const seen: unknown[] = [];
    sink.controls.set = async (input) => {
      seen.push(input);
    };
    const bridge = await createSignalRgbBridge({
      port: 0,
      sinks: () => [sink],
    });
    bridges.push(bridge);

    await bridge.controls("kraken-z", { pumpPercent: 150, fanPercent: -5 });
    expect(seen).toEqual([{ pumpPercent: 150, fanPercent: -5 }]);
  });

  it("caches a telemetry reading for a second", async () => {
    const sink = fakeSink("kraken-z");
    let reads = 0;
    let clock = 1_000;
    sink.controls.read = async () => {
      reads += 1;
      return telemetry;
    };
    const bridge = await createSignalRgbBridge({
      port: 0,
      sinks: () => [sink],
      now: () => clock,
    });
    bridges.push(bridge);

    await expect(bridge.telemetry("kraken-z")).resolves.toEqual(telemetry);
    clock += 500;
    await bridge.telemetry("kraken-z");
    expect(reads).toBe(1);

    clock += 600;
    await bridge.telemetry("kraken-z");
    expect(reads).toBe(2);
  });

  it("writes black once for off and stops taking canvas frames", async () => {
    const sink = fakeSink("kraken-z");
    const bridge = await createSignalRgbBridge({
      port: 0,
      sinks: () => [sink],
    });
    bridges.push(bridge);

    await bridge.lightingMode("kraken-z", { mode: "off" });
    expect(sink.writes).toHaveLength(1);
    expect(sink.writes[0]?.every((value) => value === 0)).toBe(true);

    send(bridge.port, fullFrame(0, [9, 9, 9]));
    await waitFor(
      () => bridge.describe().devices[0]?.lighting?.stats.dropped === 1,
    );
    expect(sink.writes).toHaveLength(1);

    await bridge.lightingMode("kraken-z", { mode: "canvas" });
    send(bridge.port, fullFrame(0, [4, 5, 6]));
    await waitFor(() => sink.writes.length === 2);
    expect(sink.writes[1]?.[2]).toBe(6);
  });

  it("writes a forced colour at once and refuses a forced mode with no colour", async () => {
    const sink = fakeSink("kraken-z");
    const bridge = await createSignalRgbBridge({
      port: 0,
      sinks: () => [sink],
    });
    bridges.push(bridge);

    await expect(
      bridge.lightingMode("kraken-z", { mode: "forced" }),
    ).rejects.toBeInstanceOf(BridgeRequestError);

    await bridge.lightingMode("kraken-z", { mode: "forced", color: "#102030" });
    expect(sink.writes).toHaveLength(1);
    // Solid 40 LEDs of the requested colour.
    expect([...sink.writes[0]!.slice(0, 6)]).toEqual([
      0x10, 0x20, 0x30, 0x10, 0x20, 0x30,
    ]);
    expect(sink.writes[0]).toHaveLength(120);
  });
});
