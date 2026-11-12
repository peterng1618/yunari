import { deflateSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KRAKEN_FAMILIES, openKraken } from "./kraken-z3-panel.js";

/**
 * The firmware's transfer lifecycle, which the wire cannot report.
 *
 * A `36 01` whose reply is missed still opens a transfer on the device: the
 * next begin answers status 2 (`already transferring`) for as long as it stays
 * open. The host saw exactly that loop — none, 2, reconnect, none, 2 — until
 * the driver learned to close the transfer it abandoned.
 */

const fake = vi.hoisted(() => {
  const state = {
    /** Replies waiting to be read, in order. */
    queue: [] as number[][],
    /** The firmware holds a transfer the driver has not ended. */
    transferOpen: false,
    /** Begin-writes whose reply is deliberately lost. */
    dropBegins: 0,
    /** The status the create answers with; `1` unless a case refuses it. */
    createStatus: 1,
    /** Bulk transfers the driver made, so a refused setup can prove none ran. */
    transfers: 0,
    /** The bytes of every bulk transfer, in order. */
    bulkWrites: [] as Uint8Array[],
    /** Every control report the driver wrote, for assertions. */
    writes: [] as number[][],
    /** What `11 01` reports as the firmware version. */
    firmware: [5, 11, 0] as [number, number, number],
    /** What `31 01` reports as the LCD state. */
    lcdBrightness: 55,
    lcdOrientation: 2,
    /** What the `75 01` status reply reports. */
    status: {
      liquidTempC: 34.5,
      pumpRpm: 2_100,
      pumpPercent: 60,
      fanRpm: 1_200,
      fanPercent: 45,
    },
  };

  const reply = (first: number, second: number, status = 1): number[] => {
    const report = new Array<number>(64).fill(0);
    report[0] = first;
    report[1] = second;
    report[14] = status;
    return report;
  };

  class FakeHid {
    static devices = () => [
      {
        vendorId: 0x1e71,
        productId: 0x3008,
        path: "fake-kraken",
        serialNumber: "344A35613131",
      },
    ];

    write(report: number[]): void {
      state.writes.push([...report]);

      const [first, second, value] = report;

      if (first === 0x10 && second === 0x01) {
        const info = reply(0x11, 0x01);
        info[0x11] = state.firmware[0];
        info[0x12] = state.firmware[1];
        info[0x13] = state.firmware[2];
        state.queue.push(info);
      } else if (first === 0x30 && second === 0x01) {
        const info = reply(0x31, 0x01);
        info[0x18] = state.lcdBrightness;
        info[0x1a] = state.lcdOrientation;
        state.queue.push(info);
      } else if (first === 0x30 && second === 0x02) {
        // A brightness write draws no reply, as liquidctl's path assumes.
      } else if (first === 0x36 && second === 0x03) {
        // Liquid mode also ends whatever transfer was open.
        state.transferOpen = false;
        state.queue.push(reply(0x37, 0x03));
      } else if (first === 0x36 && second === 0x01) {
        if (state.dropBegins > 0) {
          state.dropBegins -= 1;
          // The command landed even though its reply never reached the host.
          state.transferOpen = true;
          return;
        }
        state.queue.push(reply(0x37, 0x01, state.transferOpen ? 2 : 1));
        state.transferOpen = true;
      } else if (first === 0x36 && second === 0x02) {
        state.transferOpen = false;
        state.queue.push(reply(0x37, 0x02));
      } else if (first === 0x38 && second === 0x01) {
        state.queue.push(reply(0x39, 0x01));
      } else if (first === 0x32 && second === 0x02) {
        state.queue.push(reply(0x33, 0x02));
      } else if (first === 0x32 && second === 0x01) {
        state.queue.push(reply(0x33, 0x01, state.createStatus));
      } else if (first === 0x74 && second === 0x01) {
        const status = reply(0x75, 0x01);
        status[15] = Math.floor(state.status.liquidTempC);
        status[16] = Math.round((state.status.liquidTempC % 1) * 10);
        status[17] = state.status.pumpRpm & 0xff;
        status[18] = state.status.pumpRpm >> 8;
        status[19] = state.status.pumpPercent;
        status[23] = state.status.fanRpm & 0xff;
        status[24] = state.status.fanRpm >> 8;
        status[25] = state.status.fanPercent;
        state.queue.push(status);
      } else if (first === 0x22 || first === 0x72) {
        // Lighting and fan writes draw no reply.
      } else {
        throw new Error(`unexpected report ${value}`);
      }
    }

    readTimeout(): number[] | undefined {
      return state.queue.shift();
    }

    close(): void {}
  }

  const bulkDevice = {
    open: () => Promise.resolve(),
    selectConfiguration: () => Promise.resolve(),
    claimInterface: () => Promise.resolve(),
    nativeTransferOut: (
      _endpoint: number,
      _timeout: number,
      bytes: Uint8Array,
    ) => {
      fake.state.transfers += 1;
      fake.state.bulkWrites.push(Uint8Array.from(bytes));
      return Promise.resolve();
    },
    releaseInterface: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };

  return { state, FakeHid, bulkDevice, reply };
});

vi.mock("node-hid", () => ({
  default: { devices: fake.FakeHid.devices, HID: fake.FakeHid },
}));

vi.mock("usb", () => ({
  usb: { findDeviceByIds: () => Promise.resolve(fake.bulkDevice) },
}));

/** A black RGB PNG of `width`x`height`, as Chromium would write one. */
function pngOf(width: number, height: number): Uint8Array {
  const chunk = (kind: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    new DataView(out.buffer).setUint32(0, data.length);
    for (let index = 0; index < 4; index += 1) {
      out[4 + index] = kind.charCodeAt(index);
    }
    out.set(data, 8);
    return out;
  };

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = 2;

  const raw = new Uint8Array((width * 3 + 1) * height);
  const parts = [
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }

  return out;
}

describe("KrakenPanel transfers", () => {
  it("ends a transfer whose begin reply was lost so the next frame is not refused", async () => {
    const panel = await openKraken("The NZXT Kraken");
    const frame = pngOf(320, 320);
    fake.state.dropBegins = 1;

    await expect(panel.present(frame)).rejects.toThrow(/status none/);

    // The begin landed on the device even though its reply did not reach us.
    const ended = fake.state.writes.filter(
      ([first, second]) => first === 0x36 && second === 0x02,
    );
    expect(ended.length).toBeGreaterThan(0);

    await expect(panel.present(frame)).resolves.toBeUndefined();
    await panel.close();
  });

  it("streams nothing into a bucket the firmware refused to set up", async () => {
    const panel = await openKraken("The NZXT Kraken");
    const frame = pngOf(320, 320);
    const before = fake.state.transfers;
    fake.state.createStatus = 18;

    await expect(panel.present(frame)).rejects.toThrow(/create, status 18/);
    // The header and the pixels are both bulk writes; a refused setup must
    // leave the device untouched by either.
    expect(fake.state.transfers).toBe(before);

    fake.state.createStatus = 1;
    await expect(panel.present(frame)).resolves.toBeUndefined();
    expect(fake.state.transfers).toBeGreaterThan(before);
    await panel.close();
  });

  it("finds a reply queued behind the firmware's status broadcasts", async () => {
    const panel = await openKraken("The NZT Kraken".replace("NZT", "NZXT"));
    const frame = pngOf(320, 320);
    // The first frame builds the table; the second is the one that arrives
    // after the device has been broadcasting for a while.
    await expect(panel.present(frame)).resolves.toBeUndefined();
    for (let index = 0; index < 20; index += 1) {
      fake.state.queue.push(fake.reply(0x75, 0x02));
    }

    await expect(panel.present(frame)).resolves.toBeUndefined();
    await panel.close();
  });
});

describe("KrakenPanel mode B", () => {
  // The fake's ledger is module-level, so a case reads only its own writes.
  beforeEach(() => {
    fake.state.writes.length = 0;
    fake.state.bulkWrites.length = 0;
  });

  const created = (): number[][] =>
    fake.state.writes.filter(
      ([first, second]) => first === 0x32 && second === 0x01,
    );

  it("streams CAM's paletted frame from all sixteen buckets", async () => {
    const panel = await openKraken("The NZXT Kraken", "mode-b");
    expect(panel.frameIntervalMs).toBe(110);

    const frame = pngOf(320, 320);
    await panel.present(frame);
    await panel.present(frame);
    await panel.present(frame);

    // The ring advances across the whole table, one bucket per frame, and each
    // bucket is exactly CAM's 101 slots.
    const buckets = created();
    expect(buckets.map((write) => write[2])).toEqual([1, 2, 3]);
    for (const write of buckets) {
      expect(write[6]).toBe(101);
      expect(write[7]).toBe(0);
    }
    expect(
      buckets.map((write) => (write[4] ?? 0) + ((write[5] ?? 0) << 8)),
    ).toEqual([101, 202, 303]);

    const headers = fake.state.bulkWrites.filter(
      (bytes) => bytes.length === 20,
    );
    expect(headers).toHaveLength(3);
    for (const header of headers) {
      expect(header[12]).toBe(0x03);
      expect(new DataView(header.buffer).getUint32(16, true)).toBe(103_424);
    }

    const payloads = fake.state.bulkWrites.filter(
      (bytes) => bytes.length === 103_424,
    );
    expect(payloads).toHaveLength(3);
    // The firmware ignores the fourth palette byte; CAM writes 0 and so do we.
    for (let entry = 0; entry < 256; entry += 1) {
      expect(payloads[0]?.[entry * 4 + 3]).toBe(0);
    }

    await panel.close();
  });

  it("deletes the target twice and switches without a settle", async () => {
    const panel = await openKraken("The NZXT Kraken", "mode-b");
    const frame = pngOf(320, 320);
    await panel.present(frame);

    const before = fake.state.writes.length;
    await panel.present(frame);
    const frameWrites = fake.state.writes.slice(before);
    const deletes = frameWrites.filter(
      ([first, second]) => first === 0x32 && second === 0x02,
    );
    expect(deletes).toHaveLength(2);
    // End then switch are adjacent: nothing waits between them.
    const end = frameWrites.findIndex(
      ([first, second]) => first === 0x36 && second === 0x02,
    );
    expect(frameWrites[end + 1]?.slice(0, 2)).toEqual([0x38, 0x01]);

    await panel.close();
  });
});

describe("KrakenPanel device sink", () => {
  beforeEach(() => {
    fake.state.writes.length = 0;
    fake.state.queue.length = 0;
  });

  const rgb = (): Uint8Array => {
    const frame = new Uint8Array(120);
    for (let index = 0; index < 120; index += 1) frame[index] = index;
    return frame;
  };

  it("describes the one LED channel and the controls it accepts", async () => {
    const panel = await openKraken("The NZXT Kraken");
    const sink = panel.sink;
    if (sink === undefined) throw new Error("no sink");

    expect(sink.id).toBe("kraken-z");
    expect(sink.lighting).toEqual({
      ledCount: 40,
      channels: [{ name: "Kraken Z", leds: 40 }],
      layout: { shape: "rings", width: 3, height: 3, count: 3 },
    });
    expect(sink.controls).toMatchObject({
      pump: true,
      fans: true,
      telemetry: true,
    });
    expect(sink.display).toEqual({ kind: "panel", width: 320, height: 320 });

    await panel.close();
  });

  it("writes two 20-LED reports in GRB and then commits", async () => {
    const panel = await openKraken("The NZXT Kraken");
    const frame = rgb();
    const sink = panel.sink;
    if (sink === undefined) throw new Error("no sink");
    await sink.writeColors(frame);

    const lighting = fake.state.writes.filter((write) => write[0] === 0x22);
    expect(lighting).toHaveLength(3);
    expect(lighting[0]?.slice(0, 4)).toEqual([0x22, 0x10, 0x01, 0x00]);
    expect(lighting[1]?.slice(0, 4)).toEqual([0x22, 0x11, 0x01, 0x00]);
    // GRB: the frame's green component leads its red one.
    expect(lighting[0]?.[4]).toBe(frame[1]);
    expect(lighting[0]?.[5]).toBe(frame[0]);
    expect(lighting[0]?.[6]).toBe(frame[2]);
    expect(lighting[0]?.[63]).toBe(frame[59]);
    expect(lighting[1]?.[4]).toBe(frame[61]);
    expect(lighting[2]?.slice(0, 16)).toEqual([
      0x22, 0xa0, 0x01, 0x00, 0x01, 0x00, 0x00, 0x28, 0x00, 0x00, 0x80, 0x00,
      0x32, 0x00, 0x00, 0x01,
    ]);

    await panel.close();
  });

  it("queues a lighting write behind an LCD frame instead of interleaving", async () => {
    const panel = await openKraken("The NZXT Kraken");
    const sink = panel.sink;
    if (sink === undefined) throw new Error("no sink");
    fake.state.writes.length = 0;

    const presenting = panel.present(pngOf(320, 320));
    await sink.writeColors(rgb());
    await presenting;

    const firstLighting = fake.state.writes.findIndex(
      (write) => write[0] === 0x22,
    );
    const lastSwitch = fake.state.writes
      .map((write) => write[0])
      .lastIndexOf(0x38);
    expect(firstLighting).toBeGreaterThan(lastSwitch);
    expect(
      fake.state.writes
        .slice(firstLighting)
        .filter(
          (write) =>
            write[0] === 0x32 || write[0] === 0x36 || write[0] === 0x38,
        ),
    ).toHaveLength(0);

    await panel.close();
  });

  it("clamps the pump to its 25% floor and the fans to 0-100", async () => {
    const panel = await openKraken("The NZXT Kraken");
    const controls = panel.sink?.controls;
    if (controls === undefined) throw new Error("no controls");

    await controls.set({ pumpPercent: 0, fanPercent: 150 });

    const pump = fake.state.writes.find(
      ([first, second]) => first === 0x72 && second === 0x01,
    );
    const fan = fake.state.writes.find(
      ([first, second]) => first === 0x72 && second === 0x02,
    );
    expect(pump?.slice(4, 44)).toEqual(new Array(40).fill(25));
    expect(fan?.slice(4, 44)).toEqual(new Array(40).fill(100));

    await panel.close();
  });

  it("answers the status reply's measured fields", async () => {
    const panel = await openKraken("The NZXT Kraken");
    const controls = panel.sink?.controls;
    if (controls === undefined) throw new Error("no controls");

    await expect(controls.read()).resolves.toEqual({
      liquidTempC: 34.5,
      pumpRpm: 2_100,
      pumpPercent: 60,
      fanRpm: 1_200,
      fanPercent: 45,
    });

    await panel.close();
  });
});

describe("KrakenPanel controls", () => {
  beforeEach(() => {
    fake.state.writes.length = 0;
    fake.state.queue.length = 0;
    fake.state.firmware = [5, 11, 0];
    fake.state.lcdBrightness = 55;
    fake.state.lcdOrientation = 2;
  });

  it("declares the controls the editor can draw", async () => {
    const panel = await openKraken("The NZXT Kraken");

    expect(panel.controls?.commands).toEqual([
      "brightness",
      "screen",
      "status",
    ]);
    expect(KRAKEN_FAMILIES[0]?.commands).toEqual([
      "brightness",
      "screen",
      "status",
    ]);

    await panel.close();
  });

  it("carries the panel's own orientation into a brightness write", async () => {
    const panel = await openKraken("The NZXT Kraken");
    if (panel.controls === undefined) throw new Error("no controls");

    await expect(
      panel.controls.run({ kind: "brightness", level: 40 }),
    ).resolves.toBe("");

    const write = fake.state.writes
      .filter(([first, second]) => first === 0x30 && second === 0x02)
      .at(-1);
    expect(write?.slice(0, 8)).toEqual([0x30, 0x02, 0x01, 40, 0, 0, 1, 2]);

    await panel.close();
  });

  it("answers status with the firmware and LCD state", async () => {
    const panel = await openKraken("The NZXT Kraken");
    if (panel.controls === undefined) throw new Error("no controls");

    await expect(panel.controls.run({ kind: "status" })).resolves.toBe(
      "Firmware 5.11.0, LCD brightness 55%, orientation 180°",
    );

    await panel.close();
  });

  it("refuses a brightness outside the percent range", async () => {
    const panel = await openKraken("The NZXT Kraken");
    if (panel.controls === undefined) throw new Error("no controls");

    await expect(
      panel.controls.run({ kind: "brightness", level: -1 }),
    ).rejects.toThrow(/from 0 to 100/);

    await panel.close();
  });

  it("turns the screen off at zero and back on at the level last written", async () => {
    const panel = await openKraken("The NZXT Kraken");
    if (panel.controls === undefined) throw new Error("no controls");

    await panel.controls.run({ kind: "brightness", level: 40 });
    await panel.controls.run({ kind: "screen", on: false });
    await panel.controls.run({ kind: "screen", on: true });

    const writes = fake.state.writes.filter(
      ([first, second]) => first === 0x30 && second === 0x02,
    );
    expect(writes.at(-2)?.slice(0, 8)).toEqual([
      0x30, 0x02, 0x01, 0, 0, 0, 1, 2,
    ]);
    expect(writes.at(-1)?.slice(0, 8)).toEqual([
      0x30, 0x02, 0x01, 40, 0, 0, 1, 2,
    ]);

    await panel.close();
  });

  it("starts a screen-on at full brightness before a level is written", async () => {
    const panel = await openKraken("The NZXT Kraken");
    if (panel.controls === undefined) throw new Error("no controls");

    await panel.controls.run({ kind: "screen", on: false });
    await panel.controls.run({ kind: "screen", on: true });

    const writes = fake.state.writes.filter(
      ([first, second]) => first === 0x30 && second === 0x02,
    );
    expect(writes.at(-1)?.[3]).toBe(100);

    await panel.close();
  });

  it("refuses a screen command without a boolean", async () => {
    const panel = await openKraken("The NZXT Kraken");
    if (panel.controls === undefined) throw new Error("no controls");

    await expect(
      panel.controls.run({ kind: "screen", on: "yes" as never }),
    ).rejects.toThrow(/true or false/);

    await panel.close();
  });
});
