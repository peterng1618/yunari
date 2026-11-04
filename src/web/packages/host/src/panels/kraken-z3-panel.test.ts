import { deflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { openKraken } from "./kraken-z3-panel.js";

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
    /** Every control report the driver wrote, for assertions. */
    writes: [] as number[][],
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
        state.queue.push(reply(0x11, 0x01));
      } else if (first === 0x30 && second === 0x01) {
        state.queue.push(reply(0x31, 0x01));
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
    nativeTransferOut: () => {
      fake.state.transfers += 1;
      return Promise.resolve();
    },
    releaseInterface: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };

  return { state, FakeHid, bulkDevice };
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
});
