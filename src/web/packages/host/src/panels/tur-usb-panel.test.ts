import { describe, expect, it } from "vitest";
import { TurUsbPanel } from "./tur-usb-panel.js";
import { H264_BLOCK_BYTES } from "./tur-usb-video.js";

/**
 * A fake panel that answers reads from a queue, then answers empty.
 *
 * The empty answer is the panel's own "nothing queued": the driver stops
 * flushing there, which is why the count below distinguishes a flush from a
 * single read.
 */
function fakePanel() {
  const writes: Uint8Array[] = [];
  let queue: Uint8Array[] = [];
  let reads = 0;

  const device = {
    open: async () => {},
    selectConfiguration: async () => {},
    claimInterface: async () => {},
    releaseInterface: async () => {},
    close: async () => {},
    clearHalt: async () => {},
    nativeTransferOut: async (
      _endpoint: number,
      _timeout: number,
      data: Uint8Array,
    ) => {
      writes.push(data);
      return data.length;
    },
    nativeTransferIn: async () => {
      reads += 1;
      return queue.shift() ?? new Uint8Array();
    },
  };

  return {
    device,
    writes,
    reset() {
      writes.length = 0;
      reads = 0;
      queue = [];
    },
    queueReplies(...replies: Uint8Array[]) {
      queue.push(...replies);
    },
    get reads() {
      return reads;
    },
  };
}

const MODEL = {
  id: "test",
  label: "test panel",
  vendorId: 0,
  productId: 0,
  width: 4,
  height: 3,
};

function opened(
  fake: ReturnType<typeof fakePanel>,
  encode?: () => Promise<Uint8Array>,
): TurUsbPanel {
  // The driver's device type is the usb library's, which a test cannot mint.
  return new TurUsbPanel(
    fake.device as unknown as never,
    MODEL,
    encode ?? (async () => new Uint8Array()),
  );
}

describe("TurUsbPanel", () => {
  it("drains replies the panel queued behind the one it asked for", async () => {
    const fake = fakePanel();
    const panel = opened(fake);
    await panel.open();
    fake.reset();

    // Two replies waiting when the driver reads after StopPlay: the second is
    // a queued reply, not the answer to the next command. Leaving it unread is
    // what backs the IN queue up until the panel refuses writes.
    fake.queueReplies(Uint8Array.of(123, 0, 0), Uint8Array.of(101, 0, 0));
    await panel.present(Uint8Array.of(0xff, 0xd8, 0xff));

    // StopPlay: its reply, the queued reply, then the empty that ends the
    // flush. The frame: an empty read, then its own empty flush.
    expect(fake.reads).toBe(5);
  });

  it("stops flushing at the first empty read", async () => {
    const fake = fakePanel();
    const panel = opened(fake);
    await panel.open();
    fake.reset();

    await panel.present(Uint8Array.of(0xff, 0xd8, 0xff));

    // Nothing queued: one read for StopPlay plus its flush, one for the frame
    // plus its flush.
    expect(fake.reads).toBe(4);
  });

  it("sends StopPlay before the frame", async () => {
    const fake = fakePanel();
    const panel = opened(fake);
    await panel.open();
    fake.reset();

    await panel.present(Uint8Array.of(0xff, 0xd8, 0xff));

    // The command is encrypted, so the opcode is asserted through the plaintext
    // builder rather than by reading the ciphertext; what matters here is that
    // two writes went out, the command first, and the frame carried the JPEG.
    expect(fake.writes).toHaveLength(2);
    expect(fake.writes[1]?.length).toBe(512 + 3);
    expect([...(fake.writes[1]?.subarray(512) ?? [])]).toEqual([
      0xff, 0xd8, 0xff,
    ]);
  });

  it("feeds video blocks until stopped, then sends StopPlay", async () => {
    const fake = fakePanel();
    const h264 = new Uint8Array(H264_BLOCK_BYTES + 4).fill(0x11);
    const panel = opened(fake, async () => h264);
    await panel.open();
    fake.reset();

    await panel.video.start(Uint8Array.of(0), { offsetX: 0, offsetY: 0 });

    // StopPlay first, then the first block: that write is what makes the panel
    // draw. The rest of the file follows in the background.
    expect(fake.writes.length).toBeGreaterThanOrEqual(2);
    expect(fake.writes[0]).toHaveLength(512);
    expect(fake.writes[1]?.length).toBe(512 + H264_BLOCK_BYTES);

    // The panel drains a buffer: a stream that stopped at end of file would
    // play once and then rest on its last frame. The feed wraps to the tail.
    const deadline = Date.now() + 2_000;
    while (!fake.writes.some((write) => write.length === 512 + 4)) {
      if (Date.now() > deadline) {
        throw new Error("the feed never reached the final block");
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    await panel.video.stop();
    expect(fake.writes.at(-1)).toHaveLength(512);

    // And the background loop really is gone: nothing follows StopPlay.
    const afterStop = fake.writes.length;
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(fake.writes).toHaveLength(afterStop);
  });

  it("pushes the UI on the overlay layer over the video", async () => {
    const fake = fakePanel();
    const panel = opened(fake);
    await panel.open();
    fake.reset();

    await panel.video.presentOverlay(Uint8Array.of(0x89, 0x50));

    // The layer command, then the PNG in one transfer behind its frame.
    expect(fake.writes).toHaveLength(2);
    expect(fake.writes[1]?.length).toBe(512 + 2);
    expect([...(fake.writes[1]?.subarray(512) ?? [])]).toEqual([0x89, 0x50]);
  });
});
