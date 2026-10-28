import { describe, expect, it } from "vitest";
import type { PanelDevice } from "./panel-device.js";
import type { SerialTransport } from "./serial-transport.js";
import {
  attachedTurzxPanels,
  openTurzxPanel,
  type TurzxOptions,
} from "./turzx-panel.js";

/**
 * A transport whose every read answers the next scripted reply, then nothing.
 *
 * The timeouts are not exercised: a fake answers at once or not at all, which
 * is exactly what the adapter's probe has to tolerate on real hardware.
 */
function fakeTransport(...replies: string[]) {
  const writes: Uint8Array[] = [];
  let next = 0;

  return {
    writes,
    transport: {
      write: async (bytes: Uint8Array) => {
        writes.push(Uint8Array.from(bytes));
      },
      read: async () =>
        next < replies.length
          ? new TextEncoder().encode(`${replies[next++]}\0`)
          : new Uint8Array(),
      close: async () => {},
    } satisfies SerialTransport,
  };
}

/**
 * A panel over a transport whose first scripted reply is its HELLO.
 *
 * Tasks 6 and 9 reuse this with option overrides; the port and open defaults
 * are only here so a case does not restate plumbing it is not testing.
 */
export async function opened(
  transport: SerialTransport,
  options: TurzxOptions = {},
): Promise<PanelDevice> {
  return openTurzxPanel({
    ...options,
    ports: async () => [{ path: "COM5", vendorId: 0x1d6b, productId: 0x0106 }],
    open: async () => transport,
  });
}

describe("attachedTurzxPanels", () => {
  it("claims a panel only when HELLO names one", async () => {
    const ours = fakeTransport("chs_5inch.dev1_rom1.88");
    const other = fakeTransport("play_video_success");
    const hints = await attachedTurzxPanels({
      ports: async () => [
        {
          path: "COM5",
          vendorId: 0x1d6b,
          productId: 0x0106,
          serialNumber: "S1",
        },
        {
          path: "COM6",
          vendorId: 0x1d6b,
          productId: 0x0106,
          serialNumber: "S2",
        },
      ],
      open: async (path) =>
        path === "COM5" ? ours.transport : other.transport,
      sleep: async () => {},
    });

    expect(hints).toEqual([
      {
        vendorId: 0x1d6b,
        productId: 0x0106,
        serial: "S1",
        label: 'TURZX 5" Panel',
        model: "chs_5inch",
        firmware: "1.88",
      },
    ]);
  });

  it("skips a port with no usable USB ids and a port another program holds", async () => {
    const hints = await attachedTurzxPanels({
      ports: async () => [
        { path: "COM1" },
        {
          path: "COM5",
          vendorId: 0x1d6b,
          productId: 0x0106,
          serialNumber: "S1",
        },
      ],
      open: async () => {
        throw new Error("Access denied");
      },
      sleep: async () => {},
    });

    expect(hints).toEqual([]);
  });
});

describe("a panel this host is driving", () => {
  it("is reported without reopening its port, and leaves the list when closed", async () => {
    // A held port cannot be opened again, so a probe-only discovery would
    // report a running panel as absent. The identity recorded at open is what
    // keeps it in the list.
    const ports = [
      {
        path: "COM5",
        vendorId: 0x1d6b,
        productId: 0x0106,
        serialNumber: "S1",
      },
    ];
    const panel = await openTurzxPanel({
      ports: async () => ports,
      open: async () => fakeTransport("chs_5inch.dev1_rom1.88").transport,
    });

    try {
      const reopened: string[] = [];
      const hints = await attachedTurzxPanels({
        ports: async () => ports,
        open: async (path) => {
          reopened.push(path);
          throw new Error("Access denied");
        },
      });

      expect(hints).toEqual([
        {
          vendorId: 0x1d6b,
          productId: 0x0106,
          serial: "S1",
          label: 'TURZX 5" Panel',
          model: "chs_5inch",
          firmware: "1.88",
        },
      ]);
      expect(reopened, "the port the host holds was reopened").toEqual([]);

      await panel.close();
      expect(
        await attachedTurzxPanels({
          ports: async () => ports,
          open: async () => {
            throw new Error("Access denied");
          },
        }),
      ).toEqual([]);
    } finally {
      // The map is module state: a case that left an entry would seed the
      // next one with a panel no transport is driving.
      await panel.close();
    }
  });
});

describe("openTurzxPanel", () => {
  it("asks for a lossless still because it is decoded, not streamed", async () => {
    const device = await opened(
      fakeTransport("chs_5inch.dev1_rom1.88").transport,
    );
    try {
      expect(device.stillFormat).toBe("png");
    } finally {
      await device.close();
    }
  });

  it("opens with HELLO, stops video and media, then presents a full frame", async () => {
    const { writes, transport } = fakeTransport("chs_5inch.dev1_rom1.88");
    const panel = await openTurzxPanel({
      ports: async () => [
        { path: "COM5", vendorId: 0x1d6b, productId: 0x0106 },
      ],
      open: async () => transport,
      decode: async (_bytes, width, height) => ({
        width,
        height,
        rgba: new Uint8Array(width * height * 4).fill(255),
      }),
      sleep: async () => {},
    });

    await panel.present(Uint8Array.of(1, 2, 3));

    const helios = writes.filter(
      (bytes) => bytes[0] === 0x01 && bytes[1] === 0xef,
    );
    expect(helios.length).toBeGreaterThanOrEqual(1);
    expect(writes.every((bytes) => bytes.length % 250 === 0)).toBe(true);
    expect([...writes[writes.length - 4]!.slice(0, 7)]).toEqual([
      0x86, 0xef, 0x69, 0, 0, 0, 1,
    ]);
    expect([...writes[writes.length - 3]!.slice(0, 1)]).toEqual([0x2c]);
    expect([...writes[writes.length - 2]!.slice(0, 6)]).toEqual([
      0xc8, 0xef, 0x69, 0, 0x17, 0x70,
    ]);
    expect(writes[writes.length - 1]!.length % 250).toBe(0);
  });
});
