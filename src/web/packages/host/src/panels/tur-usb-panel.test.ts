import forge from "node-forge";
import { describe, expect, it } from "vitest";
import { PACKET_KEY } from "./panel-protocol.js";
import { TurUsbPanel } from "./tur-usb-panel.js";
import { H264_BLOCK_BYTES } from "./tur-usb-video.js";

/** The encrypted command block inside a 512-byte frame. */
const CIPHER_BYTES = 504;

/** The plaintext of a command frame: opcode at 0, fields after it. */
function commandOf(write: Uint8Array): Uint8Array | undefined {
  if (write.length < 512) return undefined;

  const decipher = forge.cipher.createDecipher(
    "DES-CBC",
    forge.util.createBuffer(PACKET_KEY),
  );
  decipher.start({ iv: PACKET_KEY });
  decipher.update(
    forge.util.createBuffer(
      String.fromCharCode(...write.subarray(0, CIPHER_BYTES)),
    ),
  );
  decipher.finish();

  const plain = decipher.output.getBytes();
  return plain.length === 0
    ? undefined
    : Uint8Array.from(plain, (c) => c.charCodeAt(0));
}

/** A reply whose big-endian word at byte 8 is `value`. */
function wordReply(value: number): Uint8Array {
  const reply = new Uint8Array(512);
  new DataView(reply.buffer).setUint32(8, value, false);
  return reply;
}

/** The commands whose reply carries the decoder's depth at byte 8. */
const DEPTH_COMMANDS = new Set([121, 122]);

/**
 * A fake panel that answers each command once, then answers empty.
 *
 * The one-answer-per-command shape is the device's: a command's reply arrives
 * behind it, and the driver's flush then finds nothing. Making a fake that
 * answers forever is what hides a driver that never drains its IN queue.
 */
function fakePanel() {
  const writes: Uint8Array[] = [];
  /** Every command opcode seen, in order. */
  const opcodes: number[] = [];
  let queue: Uint8Array[] = [];
  let reads = 0;
  /** What the panel reports as its decoder's depth while nothing is queued;
   *  negative means the panel answers nothing. */
  let level = -1;
  /** Which numbered clip block fails, counting from the reset; 0 never fails. */
  let failBlockAt = 0;
  let blockWrites = 0;
  /** Replies that belong to one command rather than to the depth read. */
  const replies = new Map<number, Uint8Array>();
  /** The answer waiting for one command's read. */
  let pending: Uint8Array | undefined;

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
      const command = commandOf(data);
      if (command !== undefined) {
        const opcode = command[0] ?? -1;
        opcodes.push(opcode);
        pending =
          replies.get(opcode) ??
          (level >= 0 && DEPTH_COMMANDS.has(opcode)
            ? levelReply(level)
            : undefined);
      }
      if (data.length > 512) {
        blockWrites += 1;
        if (blockWrites === failBlockAt) throw new Error("Cancelled");
      }
      writes.push(data);
      return data.length;
    },
    nativeTransferIn: async () => {
      reads += 1;
      const queued = queue.shift();
      if (queued !== undefined) return queued;
      if (pending !== undefined) {
        const reply = pending;
        pending = undefined;
        return reply;
      }
      return new Uint8Array();
    },
  };

  return {
    device,
    writes,
    opcodes,
    reset() {
      writes.length = 0;
      opcodes.length = 0;
      reads = 0;
      queue = [];
      level = -1;
      failBlockAt = 0;
      blockWrites = 0;
      pending = undefined;
    },
    failBlock(at: number) {
      failBlockAt = at;
      blockWrites = 0;
    },
    setLevel(depth: number) {
      level = depth;
    },
    reply(opcode: number, reply: Uint8Array) {
      replies.set(opcode, reply);
    },
    queueReplies(...replies: Uint8Array[]) {
      queue.push(...replies);
    },
    get reads() {
      return reads;
    },
  };
}

function levelReply(depth: number): Uint8Array {
  const reply = new Uint8Array(512);
  reply[8] = depth;
  return reply;
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
  encode?: () => Promise<{ h264: Uint8Array; fps: number; seconds: number }>,
): TurUsbPanel {
  // The driver's device type is the usb library's, which a test cannot mint.
  return new TurUsbPanel(
    fake.device as unknown as never,
    MODEL,
    encode ?? (async () => ({ h264: new Uint8Array(), fps: 0, seconds: 0 })),
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
    const panel = opened(fake, async () => ({ h264, fps: 0, seconds: 0 }));
    await panel.open();
    fake.reset();
    fake.setLevel(0);

    await panel.video.start(Uint8Array.of(0), { offsetX: 0, offsetY: 0 });

    // The block-size query, then StopPlay, then the first block: that write is
    // what makes the panel draw. The rest of the file follows in the
    // background.
    expect(fake.writes.length).toBeGreaterThanOrEqual(3);
    expect(fake.writes[0]).toHaveLength(512);
    expect(fake.writes[1]).toHaveLength(512);
    expect(fake.writes[2]?.length).toBe(512 + H264_BLOCK_BYTES);

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

  it("asks the panel for its block size and cuts the clip to it", async () => {
    const fake = fakePanel();
    const size = 1_000;
    const h264 = new Uint8Array(size * 3).fill(0x11);
    const panel = opened(fake, async () => ({ h264, fps: 0, seconds: 0 }));
    await panel.open();
    fake.reset();
    fake.setLevel(0);
    fake.reply(17, wordReply(size));

    await panel.video.start(Uint8Array.of(0), { offsetX: 0, offsetY: 0 });

    // The vendor driver sizes every block from the panel's answer, not from a
    // constant: a block the panel did not ask for is one its decoder refuses.
    expect(fake.opcodes).toContain(17);
    const blocks = fake.writes.filter((write) => write.length > 512);
    expect(blocks[0]?.length).toBe(512 + size);

    await panel.video.stop();
  });

  it("sets the panel's frame rate to the clip's own and flags its final block", async () => {
    const fake = fakePanel();
    const h264 = Uint8Array.of(0x11, 0x22, 0x33);
    const panel = opened(fake, async () => ({ h264, fps: 24, seconds: 0 }));
    await panel.open();
    fake.reset();
    fake.setLevel(0);

    await panel.video.start(Uint8Array.of(0), { offsetX: 0, offsetY: 0 });

    expect(fake.opcodes).toContain(15);

    const block = fake.writes.find((write) => write.length === 512 + 3);
    expect(block).toBeDefined();
    expect(commandOf(block ?? new Uint8Array())?.[12]).toBe(1);

    await panel.video.stop();
  });

  it("drains the decoder when a block's ack reports a full ring", async () => {
    const fake = fakePanel();
    const h264 = new Uint8Array(H264_BLOCK_BYTES * 2).fill(0x11);
    const panel = opened(fake, async () => ({ h264, fps: 0, seconds: 0 }));
    await panel.open();
    fake.reset();

    // A full ring: the ack of the first block says the decoder has stopped
    // reading, so the next block waits for the drain rather than overrunning.
    fake.setLevel(6);
    const started = panel.video.start(Uint8Array.of(0), {
      offsetX: 0,
      offsetY: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));

    const blocks = () => fake.writes.filter((write) => write.length > 512);
    expect(blocks()).toHaveLength(1);

    fake.setLevel(0);
    await started;

    // The drain released the feed, which writes the next block in its own
    // loop rather than inside `start`.
    const deadline = Date.now() + 2_000;
    while (blocks().length < 2) {
      if (Date.now() > deadline) throw new Error("the feed never resumed");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    await panel.video.stop();
  });

  it("restarts the clip after a cancelled block instead of resending it", async () => {
    const fake = fakePanel();
    const h264 = new Uint8Array(H264_BLOCK_BYTES * 3);
    h264[0] = 0xaa;
    h264[H264_BLOCK_BYTES] = 0xbb;
    h264[2 * H264_BLOCK_BYTES] = 0xcc;
    const panel = opened(fake, async () => ({ h264, fps: 0, seconds: 0 }));
    await panel.open();
    fake.reset();
    fake.setLevel(0);
    fake.failBlock(2);

    await panel.video.start(Uint8Array.of(0), { offsetX: 0, offsetY: 0 });

    // Block 1 was cancelled mid-transfer: the decoder may already hold part of
    // it, so rewriting it duplicates bytes into the stream. The feed starts
    // over from the clip's first block, which is a keyframe.
    const starts = (): (number | undefined)[] =>
      fake.writes
        .filter((write) => write.length > 512)
        .map((write) => write[512]);

    const deadline = Date.now() + 2_000;
    while (starts().length < 2) {
      if (Date.now() > deadline) throw new Error("the feed never recovered");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(starts().slice(0, 2)).toEqual([0xaa, 0xaa]);
    await panel.video.stop();
  });

  it("pushes the UI on the overlay layer over the video", async () => {
    const fake = fakePanel();
    const panel = opened(fake);
    await panel.open();
    fake.reset();

    await panel.video.presentOverlay(Uint8Array.of(0x89, 0x50));

    // `open` already showed the layer for its clear, and a shown layer stays
    // shown: one transfer, the PNG behind its frame, and no second enable.
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]?.length).toBe(512 + 2);
    expect([...(fake.writes[0]?.subarray(512) ?? [])]).toEqual([0x89, 0x50]);
  });

  it("shows the layer again after a clip is stopped", async () => {
    const fake = fakePanel();
    const panel = opened(fake);
    await panel.open();
    fake.setLevel(0);
    await panel.video.start(Uint8Array.of(0), { offsetX: 0, offsetY: 0 });
    await panel.video.stop();
    fake.reset();

    await panel.video.presentOverlay(Uint8Array.of(0x89, 0x50));

    // StopPlay leaves the layer off, so the next overlay has to show it.
    expect(fake.writes).toHaveLength(2);
    expect(fake.writes[0]).toHaveLength(512);
    expect(fake.writes[1]?.length).toBe(512 + 2);
  });
});
