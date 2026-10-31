import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { PanelControlCommand, PanelDevice } from "./panel-device.js";
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
  const take = (): Uint8Array =>
    next < replies.length
      ? new TextEncoder().encode(`${replies[next++]}\0`)
      : new Uint8Array();

  return {
    writes,
    transport: {
      write: async (bytes: Uint8Array) => {
        writes.push(Uint8Array.from(bytes));
      },
      read: async () => take(),
      // Every scripted reply is already on the wire, so the next one is what a
      // drain discards: a control test scripts the stale reply first.
      drainPending: take,
      close: async () => {},
    } satisfies SerialTransport,
  };
}

/** A black RGBA→RGB PNG of `width`x`height`, as Chromium would write one. */
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

  it("decodes the rasteriser's own PNG when no decoder is injected", async () => {
    const device = await opened(
      fakeTransport("chs_5inch.dev1_rom1.88").transport,
    );
    try {
      const { width, height } = device.geometry;
      await expect(
        device.present(pngOf(width, height)),
      ).resolves.toBeUndefined();
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
      "file_rev_done", // the panel finished writing the clip
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
      "file_rev_done", // the panel finished writing the clip
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

  it("does not start the clip before the upload reports the file is written", async () => {
    // Observed on hardware: START_VIDEO sent between `create_success` and the
    // transfer's own `file_rev_done` was never answered, and the runner fell
    // back to full-frame stills until the next start. The clip must not be
    // started while the panel is still writing it.
    const fake = fakeTransport(
      "chs_5inch.dev1_rom1.88", // HELLO
      "0", // GET_FILE_SIZE: nothing stored
      "create_success", // UPLOAD_FILE opened, not yet finished
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
      ).rejects.toThrow(/file_rev_done/);
      expect(
        fake.writes.some((bytes) => bytes[0] === 0x78 && bytes[1] === 0xef),
        "START_VIDEO was written before the upload finished",
      ).toBe(false);
    } finally {
      await panel.close();
    }
  });

  it("accepts the two upload acks in either order", async () => {
    const fake = fakeTransport(
      "chs_5inch.dev1_rom1.88", // HELLO
      "0", // GET_FILE_SIZE: nothing stored
      "file_rev_done", // the transfer's completion lands first
      "create_success",
      "play_video_success",
      "seq_png_init_sucessneedReSend:0|renderCnt:1",
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
      ).resolves.toBeUndefined();
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
      ).rejects.toThrow(/file_rev_done/);
      expect(Date.now() - started).toBeLessThan(1000);
    } finally {
      await panel.close();
    }
  });

  it("stops a clip it started when the start fails afterwards", async () => {
    // The ack after START_VIDEO never arrives: the panel is already looping
    // and the start throws, so the clip must be stopped before the host lets
    // go of the device.
    const fake = fakeTransport(
      "chs_5inch.dev1_rom1.88", // HELLO at open
      "0", // GET_FILE_SIZE: nothing stored
      "create_success", // UPLOAD_FILE
      "file_rev_done", // the panel finished writing it
      // START_VIDEO is written; no play_video_success follows.
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
      ).rejects.toThrow(/play_video_success/);

      const started = fake.writes.findIndex(
        (bytes) => bytes[0] === 0x78 && bytes[1] === 0xef,
      );
      expect(started, "START_VIDEO was never written").toBeGreaterThanOrEqual(
        0,
      );
      // The last write is the stop that followed it.
      expect([...fake.writes[fake.writes.length - 1]!.slice(0, 7)]).toEqual([
        0x79, 0xef, 0x69, 0x00, 0x00, 0x00, 0x01,
      ]);
      expect(fake.writes.length - 1).toBeGreaterThan(started);
    } finally {
      await panel.close();
    }
  });

  it("reports the start failure even when stopping the clip also fails", async () => {
    const replies = [
      "chs_5inch.dev1_rom1.88",
      "0",
      "create_success",
      "file_rev_done",
    ];
    let next = 0;
    let started = false;
    const transport: SerialTransport = {
      write: async (bytes) => {
        if (bytes[0] === 0x78) started = true; // START_VIDEO
        // The stop that follows a started clip is refused, as a port on its
        // way out would be; the open-time stop before it must succeed.
        if (started && bytes[0] === 0x79) throw new Error("the port went away");
      },
      read: async () =>
        next < replies.length
          ? new TextEncoder().encode(`${replies[next++]}\0`)
          : new Uint8Array(),
      drainPending: () => new Uint8Array(),
      close: async () => {},
    };
    const panel = await opened(transport, {
      transcode: async () => ({ ok: true as const, bytes: Uint8Array.of(9) }),
      sleep: async () => {},
    });

    try {
      await expect(
        panel.video!.start(Uint8Array.of(1, 2, 3), {
          offsetX: 0,
          offsetY: 0,
        }),
      ).rejects.toThrow(/play_video_success/);
    } finally {
      await panel.close();
    }
  });

  it("does not accept the bare overlay-init prefix as an answer", async () => {
    const fake = fakeTransport(
      "chs_5inch.dev1_rom1.88", // HELLO
      "0", // GET_FILE_SIZE
      "create_success", // UPLOAD_FILE
      "file_rev_done", // the panel finished writing the clip
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

describe("a panel's controls", () => {
  /** The command's bytes, then zero fill to the wire's 250-byte frame. */
  function expectCommand(write: Uint8Array, command: readonly number[]): void {
    // Exactly one frame: a two-frame write would mean the command and a body
    // were torn apart or doubled.
    expect(write.length).toBe(250);
    expect([...write.slice(0, command.length)]).toEqual([...command]);
    expect(write.slice(command.length).every((byte) => byte === 0)).toBe(true);
  }

  const BRIGHTNESS = [0x7b, 0xef, 0x69, 0, 0, 0, 1, 0, 0, 0];
  const STATUS = [0xcf, 0xef, 0x69, 0, 0, 0, 1];
  const HELLO = [0x01, 0xef, 0x69, 0, 0, 0, 1, 0, 0, 0, 0xc5, 0xd3];

  it("maps percent brightness to the panel's 0-255 byte", async () => {
    const { writes, transport } = fakeTransport("chs_5inch.dev1_rom1.88");
    const panel = await opened(transport);

    try {
      // Write-only: the device's reply is empty, never a host sentence.
      await expect(
        panel.controls!.run({ kind: "brightness", level: 50 }),
      ).resolves.toBe("");

      const last = writes[writes.length - 1]!;
      expectCommand(last, [...BRIGHTNESS, 128]);
    } finally {
      await panel.close();
    }
  });

  it("maps the ends of the range to 0 and 255", async () => {
    const { writes, transport } = fakeTransport("chs_5inch.dev1_rom1.88");
    const panel = await opened(transport);

    try {
      await panel.controls!.run({ kind: "brightness", level: 0 });
      expectCommand(writes[writes.length - 1]!, [...BRIGHTNESS, 0]);

      await panel.controls!.run({ kind: "brightness", level: 100 });
      expectCommand(writes[writes.length - 1]!, [...BRIGHTNESS, 255]);
    } finally {
      await panel.close();
    }
  });

  it("refuses a level outside 0-100 or a fraction without writing", async () => {
    const { writes, transport } = fakeTransport("chs_5inch.dev1_rom1.88");
    const panel = await opened(transport);
    const sent = writes.length;

    try {
      await expect(
        panel.controls!.run({ kind: "brightness", level: 101 }),
      ).rejects.toThrow(/0 to 100/);
      await expect(
        panel.controls!.run({ kind: "brightness", level: 50.5 }),
      ).rejects.toThrow(/whole/);
      expect(writes.length).toBe(sent);
    } finally {
      await panel.close();
    }
  });

  it("writes QUERY_STATUS, discards the open-time reply and returns the fresh one", async () => {
    const fake = fakeTransport(
      "chs_5inch.dev1_rom1.88", // HELLO at open
      "needReSend:0|renderCnt:0", // the status open left unread: drained
      "needReSend:0|renderCnt:1", // the answer to this command
    );
    const panel = await opened(fake.transport);

    try {
      await expect(panel.controls!.run({ kind: "status" })).resolves.toBe(
        "needReSend:0|renderCnt:1",
      );
      expectCommand(fake.writes[fake.writes.length - 1]!, STATUS);
    } finally {
      await panel.close();
    }
  });

  it("skips a stale ack between the command and its status reply", async () => {
    const fake = fakeTransport(
      "chs_5inch.dev1_rom1.88", // HELLO at open
      "needReSend:0|renderCnt:0", // drained
      "play_video_success", // an earlier command's ack, not a status
      "needReSend:0|renderCnt:5", // the status answer
    );
    const panel = await opened(fake.transport);

    try {
      await expect(panel.controls!.run({ kind: "status" })).resolves.toBe(
        "needReSend:0|renderCnt:5",
      );
    } finally {
      await panel.close();
    }
  });

  it("cuts a reply at the first NUL when a drained tail is glued to it", async () => {
    // Observed on hardware: QUERY_STATUS came back as the same phrase twice,
    // NUL-padded between, once a drained reply's tail shared the burst.
    const fake = fakeTransport(
      "chs_5inch.dev1_rom1.88", // HELLO at open
      "needReSend:0|renderCnt:0", // drained
      `needReSend:0|renderCnt:7${"\0".repeat(40)}needReSend:0|renderCnt:7`,
    );
    const panel = await opened(fake.transport);

    try {
      await expect(panel.controls!.run({ kind: "status" })).resolves.toBe(
        "needReSend:0|renderCnt:7",
      );
    } finally {
      await panel.close();
    }
  });

  it("ends a status wait on silence with the named error", async () => {
    const fake = fakeTransport(
      "chs_5inch.dev1_rom1.88",
      "needReSend:0|renderCnt:0", // drained; nothing answers the command
    );
    const panel = await opened(fake.transport);

    try {
      await expect(panel.controls!.run({ kind: "status" })).rejects.toThrow(
        /QUERY_STATUS/,
      );
    } finally {
      await panel.close();
    }
  });

  it("writes HELLO, discards an older HELLO-shaped reply and returns the fresh one", async () => {
    const fake = fakeTransport(
      "chs_5inch.dev1_rom1.88", // HELLO at open
      // Another identity: the shape check alone would accept it, so only the
      // drain can keep it from being returned as this command's answer.
      "chs_5inch.dev1_rom1.87",
      "chs_5inch.dev1_rom1.88", // the answer to this command
    );
    const panel = await opened(fake.transport);

    try {
      await expect(panel.controls!.run({ kind: "hello" })).resolves.toBe(
        "chs_5inch.dev1_rom1.88",
      );
      expectCommand(fake.writes[fake.writes.length - 1]!, HELLO);
    } finally {
      await panel.close();
    }
  });

  it("writes the screen state without waiting for a reply", async () => {
    const fake = fakeTransport("chs_5inch.dev1_rom1.88");
    const panel = await opened(fake.transport);

    try {
      await expect(
        panel.controls!.run({ kind: "screen", on: true }),
      ).resolves.toBe("");
      expectCommand(
        fake.writes[fake.writes.length - 1]!,
        [0x83, 0xef, 0x69, 0, 0, 0, 0],
      );

      await expect(
        panel.controls!.run({ kind: "screen", on: false }),
      ).resolves.toBe("");
      expectCommand(
        fake.writes[fake.writes.length - 1]!,
        [0x83, 0xef, 0x69, 0, 0, 0, 1],
      );
    } finally {
      await panel.close();
    }
  });

  it("refuses a screen command with no on rather than writing off", async () => {
    const { writes, transport } = fakeTransport("chs_5inch.dev1_rom1.88");
    const panel = await opened(transport);
    const sent = writes.length;

    try {
      await expect(
        panel.controls!.run({
          kind: "screen",
        } as unknown as PanelControlCommand),
      ).rejects.toThrow(/needs on/);
      expect(writes.length).toBe(sent);
    } finally {
      await panel.close();
    }
  });

  it("answers a restart with an empty reply and reads nothing", async () => {
    // Nothing is scripted after HELLO: resolving proves the restart did not
    // wait for a reply the dropped interface cannot send. The device says
    // nothing, so the reply is empty rather than a host sentence.
    const fake = fakeTransport("chs_5inch.dev1_rom1.88");
    const panel = await opened(fake.transport);

    try {
      await expect(panel.controls!.run({ kind: "restart" })).resolves.toBe("");
      expectCommand(
        fake.writes[fake.writes.length - 1]!,
        [0x84, 0xef, 0x69, 0, 0, 0, 1],
      );
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
      "file_rev_done", // the panel finished writing the clip
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
      // cc ef 69 00, imageSize 15 (3 BE), three zeros, count 0, visible bytes 5.
      expect([...header.slice(0, 18)]).toEqual([
        0xcc, 0xef, 0x69, 0x00, 0x00, 0x00, 0x0f, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x05,
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
      expect([...second.slice(10, 14)]).toEqual([0x00, 0x00, 0x00, 0x01]);
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
      "file_rev_done", // the panel finished writing the clip
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
      expect([...header.slice(10, 14)]).toEqual([0x00, 0x00, 0x00, 0x00]);
    } finally {
      await panel.close();
    }
  });
});
