import { placement } from "@yunari/scene-fabric";
import { describe, expect, it } from "vitest";
import type { PanelDevice } from "./panel-device.js";
import type { SerialTransport } from "./serial-transport.js";
import { openTurzxPanel, type TurzxOptions } from "./turzx-panel.js";
import { panelCrop, transcodeForPanel } from "./turzx-video.js";

/**
 * A transport whose every read answers the next scripted reply, then nothing.
 *
 * The replies are what the adapter's file commands read back; a fake answers at
 * once, which is the case the parser has to accept.
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
      drainPending: () => new Uint8Array(),
      close: async () => {},
    } satisfies SerialTransport,
  };
}

/** A panel over a transport whose first scripted reply is its HELLO. */
function opened(
  transport: SerialTransport,
  options: TurzxOptions = {},
): Promise<PanelDevice> {
  return openTurzxPanel({
    ...options,
    ports: async () => [{ path: "COM5", vendorId: 0x1d6b, productId: 0x0106 }],
    open: async () => transport,
  });
}

/** A clip that transcodes to three bytes, without spawning ffmpeg. */
const threeByteClip = async () => ({
  ok: true as const,
  bytes: Uint8Array.of(9, 9, 9),
});

const still = { offsetX: 0, offsetY: 0 };

describe("transcodeForPanel", () => {
  it("refuses a transcode the encoder failed", async () => {
    const result = await transcodeForPanel(Uint8Array.of(1), {
      run: async () => ({ code: 1, stderr: "" }),
      verifyForTest: true,
    });
    expect(result.ok).toBe(false);
  });
});

describe("panelCrop", () => {
  it("crops to the same edge the player places", () => {
    // An ultrawide source leaves an overhang the offset pans through without
    // the pan floor taking over, so the placed rect's edge is not the box edge.
    const source = { width: 2560, height: 1080 };
    const rect = placement({
      box: { width: 800, height: 480 },
      source,
      offsetX: 0.1,
      offsetY: 0,
    });
    const crop = panelCrop(source, 0.1, 0);

    // The scaled crop edge is the placed rect's left edge, expressed in source
    // pixels; the same pan the player composes is what the panel encodes.
    const scale = rect.width / source.width;
    expect(Math.round(crop.x * scale)).toBe(Math.round(-rect.left));
    expect(crop).toEqual({ x: 200, y: 0, width: 1800, height: 1080 });
    expect(crop.x + crop.width).toBeLessThanOrEqual(source.width);
  });

  it("treats a non-finite offset as centred", () => {
    const source = { width: 1920, height: 1080 };
    expect(panelCrop(source, Number.NaN, Number.POSITIVE_INFINITY)).toEqual(
      panelCrop(source, 0, 0),
    );
  });
});

describe("a panel's video", () => {
  it("uploads only when the device size differs, then starts and inits", async () => {
    const { writes, transport } = fakeTransport(
      "chs_5inch.dev1_rom1.88", // HELLO
      "0", // GET_FILE_SIZE: nothing stored yet
      "create_success", // UPLOAD_FILE
      "file_rev_done", // the panel finished writing the clip
      "play_video_success", // START_VIDEO
      "seq_png_init_sucessneedReSend:0|renderCnt:1", // INIT_VIDEO_OVERLAY
    );
    const panel = await opened(transport, {
      transcode: threeByteClip,
      sleep: async () => {},
    });

    try {
      await panel.video!.start(Uint8Array.of(1, 2, 3), still);

      const upload = writes.find(
        (bytes) => bytes[0] === 0x6f && bytes[1] === 0xef,
      );
      expect(upload).toBeDefined();
      expect(
        writes.some((bytes) => bytes[0] === 0x78 && bytes[1] === 0xef),
      ).toBe(true);
      expect(
        writes.some((bytes) => bytes[0] === 0xd0 && bytes[1] === 0xef),
      ).toBe(true);
      expect(writes.every((bytes) => bytes.length % 250 === 0)).toBe(true);
      // A three-byte clip is one 250-byte chunk carrying those bytes.
      const chunks = writes.filter(
        (bytes) =>
          bytes.length === 250 &&
          bytes[0] === 9 &&
          bytes[1] === 9 &&
          bytes[2] === 9,
      );
      expect(chunks).toHaveLength(1);
    } finally {
      await panel.close();
    }

    // The stored size already matches the transcoded clip: no upload write.
    const same = fakeTransport(
      "chs_5inch.dev1_rom1.88",
      "3", // GET_FILE_SIZE: this clip is already stored
      "play_video_success",
      "seq_png_init_sucessneedReSend:0|renderCnt:1",
    );
    const second = await opened(same.transport, {
      transcode: threeByteClip,
      sleep: async () => {},
    });

    try {
      await second.video!.start(Uint8Array.of(1, 2, 3), still);
      expect(
        same.writes.some((bytes) => bytes[0] === 0x6f && bytes[1] === 0xef),
      ).toBe(false);
    } finally {
      await second.close();
    }
  });

  it("skips the buffered status reply before the stored size", async () => {
    const { writes, transport } = fakeTransport(
      "chs_5inch.dev1_rom1.88",
      "status: ready", // QUERY_STATUS reply buffered by openTurzxPanel
      "0", // GET_FILE_SIZE
      "create_success",
      "file_rev_done", // the panel finished writing the clip
      "play_video_success",
      "seq_png_init_sucessneedReSend:0|renderCnt:1",
    );
    const panel = await opened(transport, {
      transcode: threeByteClip,
      sleep: async () => {},
    });

    try {
      await panel.video!.start(Uint8Array.of(1, 2, 3), still);

      // If the size reader had consumed `create_success` the upload would have
      // failed; reaching the start proves it stopped at the size.
      expect(
        writes.some((bytes) => bytes[0] === 0x6f && bytes[1] === 0xef),
      ).toBe(true);
    } finally {
      await panel.close();
    }
  });

  it("skips a second stale ack before the upload reply", async () => {
    const { transport } = fakeTransport(
      "chs_5inch.dev1_rom1.88",
      "status: ready", // QUERY_STATUS
      "0", // GET_FILE_SIZE
      "delete_success", // DELETE_FILE acknowledgement, late
      "create_success",
      "file_rev_done", // the panel finished writing the clip
      "play_video_success",
      "seq_png_init_sucessneedReSend:0|renderCnt:1",
    );
    const panel = await opened(transport, {
      transcode: threeByteClip,
      sleep: async () => {},
    });

    try {
      await expect(
        panel.video!.start(Uint8Array.of(1, 2, 3), still),
      ).resolves.toBeUndefined();
    } finally {
      await panel.close();
    }
  });

  it("treats a silent size reply as nothing stored and uploads", async () => {
    // A fresh panel (or one whose cache was cleaned) may answer GET_FILE_SIZE
    // with nothing; treating that as unknown must still upload the clip.
    const { writes, transport } = fakeTransport(
      "chs_5inch.dev1_rom1.88",
      "", // GET_FILE_SIZE: an empty read ends the reply wait
      "create_success",
      "file_rev_done", // the panel finished writing the clip
      "play_video_success",
      "seq_png_init_sucessneedReSend:0|renderCnt:1",
    );
    const panel = await opened(transport, {
      transcode: threeByteClip,
      sleep: async () => {},
    });

    try {
      await expect(
        panel.video!.start(Uint8Array.of(1, 2, 3), still),
      ).resolves.toBeUndefined();
      expect(
        writes.some((bytes) => bytes[0] === 0x6f && bytes[1] === 0xef),
      ).toBe(true);
    } finally {
      await panel.close();
    }
  });

  it("reports a reply that never carries the wanted phrase", async () => {
    const { transport } = fakeTransport(
      "chs_5inch.dev1_rom1.88",
      "0", // GET_FILE_SIZE
      "still_not_it", // stale replies with no create_success, then an empty read
      "still_not_it_2",
      "still_not_it_3",
    );
    const panel = await opened(transport, {
      transcode: threeByteClip,
      sleep: async () => {},
    });

    try {
      await expect(
        panel.video!.start(Uint8Array.of(1, 2, 3), still),
      ).rejects.toThrow(/still_not_it_3/);
    } finally {
      await panel.close();
    }
  });

  it("rejects when the overlay init reports a failure", async () => {
    const { transport } = fakeTransport(
      "chs_5inch.dev1_rom1.88",
      "0",
      "create_success",
      "file_rev_done", // the panel finished writing the clip
      "play_video_success",
      "seq_png_init_failed", // INIT_VIDEO_OVERLAY refused
    );
    const panel = await opened(transport, {
      transcode: threeByteClip,
      sleep: async () => {},
    });

    try {
      await expect(
        panel.video!.start(Uint8Array.of(1, 2, 3), still),
      ).rejects.toThrow(/seq_png_init_failed/);
    } finally {
      await panel.close();
    }
  });
});
