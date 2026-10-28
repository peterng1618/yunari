import { describe, expect, it } from "vitest";
import type { PanelDevice } from "./panel-device.js";
import type { SerialTransport } from "./serial-transport.js";
import { openTurzxPanel, type TurzxOptions } from "./turzx-panel.js";
import { transcodeForPanel } from "./turzx-video.js";

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

describe("transcodeForPanel", () => {
  it("refuses a transcode the encoder failed", async () => {
    const result = await transcodeForPanel(Uint8Array.of(1), {
      run: async () => ({ code: 1, stderr: "" }),
      verifyForTest: true,
    });
    expect(result.ok).toBe(false);
  });
});

describe("a panel's video", () => {
  it("uploads only when the device size differs, then starts and inits", async () => {
    const { writes, transport } = fakeTransport(
      "chs_5inch.dev1_rom1.88", // HELLO
      "0", // GET_FILE_SIZE: nothing stored yet
      "create_success", // UPLOAD_FILE
      "play_video_success", // START_VIDEO
      "seq_png_init_sucessneedReSend:0|renderCnt:1", // INIT_VIDEO_OVERLAY
    );
    const panel = await opened(transport, {
      transcode: async () => ({ ok: true, bytes: Uint8Array.of(9, 9, 9) }),
      sleep: async () => {},
    });

    await panel.video!.start(Uint8Array.of(1, 2, 3), {
      offsetX: 0,
      offsetY: 0,
    });

    const upload = writes.find(
      (bytes) => bytes[0] === 0x6f && bytes[1] === 0xef,
    );
    expect(upload).toBeDefined();
    expect(writes.some((bytes) => bytes[0] === 0x78 && bytes[1] === 0xef)).toBe(
      true,
    );
    expect(writes.some((bytes) => bytes[0] === 0xd0 && bytes[1] === 0xef)).toBe(
      true,
    );
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
  });
});
