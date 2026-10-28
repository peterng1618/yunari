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

  it("skips stale acks ahead of a stored size that matches", async () => {
    const fake = fakeTransport(
      "chs_5inch.dev1_rom1.88", // HELLO
      "create_success", // an ack left over from an earlier upload
      "play_video_success",
      "seq_png_init_", // a split reply, not an answer
      "1", // GET_FILE_SIZE: the one-byte clip is already stored
      "play_video_success", // START_VIDEO
      "seq_png_init_sucessneedReSend:0|renderCnt:1", // INIT_VIDEO_OVERLAY
    );
    const panel = await opened(fake.transport, {
      transcode: async () => ({ ok: true as const, bytes: Uint8Array.of(9) }),
      sleep: async () => {},
    });

    try {
      // No upload ack is scripted: resolving at all means the size was read
      // past every stale ack and matched, so the clip was not re-uploaded.
      await panel.video!.start(Uint8Array.of(1, 2, 3), {
        offsetX: 0,
        offsetY: 0,
      });
    } finally {
      await panel.close();
    }
  });

  it("skips stale acks ahead of an empty size and uploads", async () => {
    const fake = fakeTransport(
      "chs_5inch.dev1_rom1.88", // HELLO
      "play_video_success",
      "create_success",
      "seq_png_init_",
      "0", // GET_FILE_SIZE: nothing stored
      "create_success", // UPLOAD_FILE
      "play_video_success", // START_VIDEO
      "seq_png_init_sucessneedReSend:0|renderCnt:1", // INIT_VIDEO_OVERLAY
    );
    const panel = await opened(fake.transport, {
      transcode: async () => ({ ok: true as const, bytes: Uint8Array.of(9) }),
      sleep: async () => {},
    });

    try {
      await panel.video!.start(Uint8Array.of(1, 2, 3), {
        offsetX: 0,
        offsetY: 0,
      });
    } finally {
      await panel.close();
    }
  });

  it("ends a reply wait on an empty read rather than the 30 s deadline", async () => {
    const fake = fakeTransport("chs_5inch.dev1_rom1.88"); // HELLO, then an empty read
    const panel = await opened(fake.transport, {
      transcode: async () => ({ ok: true as const, bytes: Uint8Array.of(9) }),
      sleep: async () => {},
    });

    try {
      const started = Date.now();
      await expect(
        panel.video!.start(Uint8Array.of(1, 2, 3), {
          offsetX: 0,
          offsetY: 0,
        }),
      ).rejects.toThrow(/create_success/);
      expect(Date.now() - started).toBeLessThan(1000);
    } finally {
      await panel.close();
    }
  });

  it("does not accept the bare overlay-init prefix as an answer", async () => {
    const fake = fakeTransport(
      "chs_5inch.dev1_rom1.88", // HELLO
      "0", // GET_FILE_SIZE
      "create_success", // UPLOAD_FILE
      "play_video_success", // START_VIDEO
      "seq_png_init_", // split after the shared prefix: not an answer
      "seq_png_init_failed", // the real one
    );
    const panel = await opened(fake.transport, {
      transcode: async () => ({ ok: true as const, bytes: Uint8Array.of(9) }),
      sleep: async () => {},
    });

    try {
      await expect(
        panel.video!.start(Uint8Array.of(1, 2, 3), {
          offsetX: 0,
          offsetY: 0,
        }),
      ).rejects.toThrow(/could not initialize its overlay/);
    } finally {
      await panel.close();
    }
  });
});

describe("a panel's overlay", () => {
  /** A panel whose video is playing and whose overlay was initialized. */
  async function playing(rgba: Uint8Array) {
    const fake = fakeTransport(
      "chs_5inch.dev1_rom1.88", // HELLO
      "0", // GET_FILE_SIZE: nothing stored yet
      "create_success", // UPLOAD_FILE
      "play_video_success", // START_VIDEO
      "seq_png_init_sucessneedReSend:0|renderCnt:1", // INIT_VIDEO_OVERLAY
    );
    const panel = await opened(fake.transport, {
      transcode: async () => ({ ok: true as const, bytes: Uint8Array.of(9) }),
      sleep: async () => {},
      decode: async (_bytes, width, height) => ({ width, height, rgba }),
    });
    await panel.video!.start(Uint8Array.of(1, 2, 3), {
      offsetX: 0,
      offsetY: 0,
    });

    return { panel, writes: fake.writes };
  }

  it("sends the update header and body, then diffs from the stored frame", async () => {
    // One opaque red pixel at (0,0); every other pixel transparent, as the
    // init frame was.
    const pixels = new Uint8Array(800 * 480 * 4);
    pixels[0] = 255;
    pixels[3] = 255;
    const { panel, writes } = await playing(pixels);

    try {
      await panel.video!.presentOverlay(Uint8Array.of(1));

      const header = writes[writes.length - 2]!;
      const body = writes[writes.length - 1]!;
      expect(header.length).toBe(250);
      // cc ef 69 00, imageSize 15 (3 BE), three zeros, count 1, visible bytes 5.
      expect([...header.slice(0, 18)]).toEqual([
        0xcc, 0xef, 0x69, 0x00, 0x00, 0x00, 0x0f, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x01, 0x00, 0x00, 0x00, 0x05,
      ]);
      // The changed span [offset 0, width 1], its pixel, the visible span,
      // then the terminator.
      expect([...body.slice(0, 15)]).toEqual([
        0x00, 0x00, 0x00, 0x00, 0x01, 0x03, 0x03, 0xf0, 0x00, 0x00, 0x00, 0x00,
        0x01, 0xef, 0x69,
      ]);

      // The same frame again has nothing changed: only the visible span is
      // re-sent, and the count climbs.
      await panel.video!.presentOverlay(Uint8Array.of(2));
      const second = writes[writes.length - 2]!;
      expect([...second.slice(0, 7)]).toEqual([
        0xcc, 0xef, 0x69, 0x00, 0x00, 0x00, 0x07,
      ]);
      expect([...second.slice(10, 14)]).toEqual([0x00, 0x00, 0x00, 0x02]);
      expect([...writes[writes.length - 1]!.slice(0, 7)]).toEqual([
        0x00, 0x00, 0x00, 0x00, 0x01, 0xef, 0x69,
      ]);
    } finally {
      await panel.close();
    }
  });

  it("refuses an update before the video initialized the overlay", async () => {
    const panel = await opened(
      fakeTransport("chs_5inch.dev1_rom1.88").transport,
      {
        decode: async (_bytes, width, height) => ({
          width,
          height,
          rgba: new Uint8Array(width * height * 4),
        }),
      },
    );

    try {
      await expect(
        panel.video!.presentOverlay(Uint8Array.of(1)),
      ).rejects.toThrow(/not initialized/);
    } finally {
      await panel.close();
    }
  });

  it("restarts the update count when the video re-initializes the overlay", async () => {
    const pixels = new Uint8Array(800 * 480 * 4);
    pixels[0] = 255;
    pixels[3] = 255;
    const fake = fakeTransport(
      "chs_5inch.dev1_rom1.88", // HELLO
      "0", // GET_FILE_SIZE: nothing stored yet
      "create_success",
      "play_video_success",
      "seq_png_init_sucessneedReSend:0|renderCnt:1",
      "1", // a second init: the one-byte clip is already stored
      "play_video_success",
      "seq_png_init_sucessneedReSend:0|renderCnt:1",
    );
    const panel = await opened(fake.transport, {
      transcode: async () => ({ ok: true as const, bytes: Uint8Array.of(9) }),
      sleep: async () => {},
      decode: async (_bytes, width, height) => ({
        width,
        height,
        rgba: pixels,
      }),
    });

    try {
      await panel.video!.start(Uint8Array.of(1, 2, 3), {
        offsetX: 0,
        offsetY: 0,
      });
      await panel.video!.presentOverlay(Uint8Array.of(1));
      await panel.video!.start(Uint8Array.of(1, 2, 3), {
        offsetX: 0,
        offsetY: 0,
      });
      await panel.video!.presentOverlay(Uint8Array.of(2));

      const header = fake.writes[fake.writes.length - 2]!;
      expect([...header.slice(10, 14)]).toEqual([0x00, 0x00, 0x00, 0x01]);
    } finally {
      await panel.close();
    }
  });
});
