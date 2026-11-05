import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { blendRampStops } from "@yunari/renderer-core";
import { placement } from "@yunari/scene-fabric";
import { describe, expect, it } from "vitest";
import type { PanelDevice, PanelVideoPlacement } from "./panel-device.js";
import { panelCrop } from "./panel-video-composition.js";
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

/** A cache directory outside the repository, removed by each case. */
function cacheDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "yunari-transcode-"));
}

/** A fake ffmpeg that succeeds and writes `encoded` at its output argument. */
function encoder(encoded: Uint8Array, calls: { count: number }) {
  return async (args: readonly string[]) => {
    calls.count += 1;
    await writeFile(args[args.length - 1]!, encoded);
    return { code: 0, stderr: "" };
  };
}

/** The cache key `transcodeForPanel` derives for a centred, upright placement. */
function cacheKey(bytes: Uint8Array): string {
  return createHash("sha256")
    .update(bytes)
    .update("\0" + "0,0,none")
    .digest("hex");
}

describe("the panel clip cache", () => {
  it("transcodes the same clip once into the host cache", async () => {
    const directory = await cacheDir();

    try {
      const calls = { count: 0 };
      const encoded = Uint8Array.of(7, 8, 9);
      const run = encoder(encoded, calls);
      const first = await transcodeForPanel(Uint8Array.of(1, 2, 3), {
        cacheDir: directory,
        run,
        verifyForTest: true,
      });
      const second = await transcodeForPanel(Uint8Array.of(1, 2, 3), {
        cacheDir: directory,
        run,
        verifyForTest: true,
      });

      expect(calls.count).toBe(1);
      expect(first).toEqual({ ok: true, bytes: encoded });
      expect(second).toEqual(first);
      expect(
        (await readdir(directory)).some((name) => name.endsWith(".mp4")),
      ).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("transcodes again when the clip changed", async () => {
    const directory = await cacheDir();

    try {
      const calls = { count: 0 };
      const run = encoder(Uint8Array.of(9), calls);
      await transcodeForPanel(Uint8Array.of(1, 2, 3), {
        cacheDir: directory,
        run,
        verifyForTest: true,
      });
      await transcodeForPanel(Uint8Array.of(1, 2, 4), {
        cacheDir: directory,
        run,
        verifyForTest: true,
      });

      expect(calls.count).toBe(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("never reads a partial temp file as the clip", async () => {
    const directory = await cacheDir();
    const bytes = Uint8Array.of(1, 2, 3);

    try {
      // What an interrupted scratch write leaves beside the entry: the cache
      // lookup only reads the final name, so these bytes are never served.
      await writeFile(
        path.join(directory, `.v1-${cacheKey(bytes)}.mp4.${process.pid}.1.tmp`),
        Uint8Array.of(0, 0, 0),
      );

      const calls = { count: 0 };
      const encoded = Uint8Array.of(9);
      const result = await transcodeForPanel(bytes, {
        cacheDir: directory,
        run: encoder(encoded, calls),
        verifyForTest: true,
      });

      expect(calls.count).toBe(1);
      expect(result).toEqual({ ok: true, bytes: encoded });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

/**
 * A run that records the arguments and writes the output ffmpeg would have.
 *
 * The source is random so the transcode cache never answers a second case: a
 * cached clip would skip the run these assertions read.
 */
function recordingRun(written: readonly number[] = [1]) {
  const calls: string[][] = [];

  return {
    calls,
    run: async (args: readonly string[]) => {
      calls.push([...args]);
      await writeFile(args[args.length - 1]!, Uint8Array.from(written));
      return { code: 0, stderr: "" };
    },
  };
}

/** The `-vf` argument, which is where the picture's composition is decided. */
function filterOf(args: readonly string[]): string {
  return args[args.indexOf("-vf") + 1] ?? "";
}

describe("transcodeForPanel", () => {
  it("refuses a transcode the encoder failed", async () => {
    const result = await transcodeForPanel(Uint8Array.of(1), {
      run: async () => ({ code: 1, stderr: "" }),
      verifyForTest: true,
    });
    expect(result.ok).toBe(false);
  });

  it("fits the box the mount puts the clip in, then turns it", async () => {
    // A test's own cache, with the same home as every other transcode case:
    // the host's default directory is shared and its eviction only counts
    // bytes, so these small random clips would leak an entry per run and make
    // every later directory scan slower.
    const directory = await cacheDir();
    try {
      const upright = recordingRun();
      const bytes = randomBytes(16);
      await transcodeForPanel(bytes, {
        cacheDir: directory,
        run: upright.run,
        verifyForTest: true,
      });
      expect(filterOf(upright.calls[0]!)).toBe(
        "scale=800:480:force_original_aspect_ratio=increase:force_divisible_by=2,crop=800:480",
      );

      // A quarter turn swaps the layer's box before it turns, so the crop is
      // portrait and the turn comes after it.
      const turned = recordingRun();
      await transcodeForPanel(randomBytes(16), {
        cacheDir: directory,
        run: turned.run,
        verifyForTest: true,
        rotation: 90,
      });
      expect(filterOf(turned.calls[0]!)).toBe(
        "scale=480:800:force_original_aspect_ratio=increase:force_divisible_by=2,crop=480:800,transpose=1",
      );

      const counter = recordingRun();
      await transcodeForPanel(randomBytes(16), {
        cacheDir: directory,
        run: counter.run,
        verifyForTest: true,
        rotation: 270,
      });
      expect(filterOf(counter.calls[0]!)).toMatch(/,transpose=2$/);

      const upsideDown = recordingRun();
      await transcodeForPanel(randomBytes(16), {
        cacheDir: directory,
        run: upsideDown.run,
        verifyForTest: true,
        rotation: 180,
      });
      expect(filterOf(upsideDown.calls[0]!)).toMatch(/,hflip,vflip$/);
      expect(filterOf(upsideDown.calls[0]!)).toContain("crop=800:480");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("refuses an angle the panel cannot compose, without encoding", async () => {
    const recorded = recordingRun();
    const result = await transcodeForPanel(randomBytes(16), {
      run: recorded.run,
      verifyForTest: true,
      rotation: 45,
    });

    expect(result.ok).toBe(false);
    expect(recorded.calls).toHaveLength(0);
  });

  it("encodes again when only the mounting angle changed", async () => {
    const bytes = randomBytes(16);
    const directory = await cacheDir();

    try {
      const upright = recordingRun([1]);
      expect(
        (
          await transcodeForPanel(bytes, {
            cacheDir: directory,
            run: upright.run,
            verifyForTest: true,
          })
        ).ok,
      ).toBe(true);

      // The same source and pan on a turned glass is a different clip: a cache
      // keyed without the angle would serve the upright file.
      const turned = recordingRun([2]);
      expect(
        (
          await transcodeForPanel(bytes, {
            cacheDir: directory,
            run: turned.run,
            verifyForTest: true,
            rotation: 90,
          })
        ).ok,
      ).toBe(true);
      expect(turned.calls).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

/** The composed filter graph for one placement, or the plain `-vf` string. */
async function filterFor(
  placement: PanelVideoPlacement,
  rotation = 0,
): Promise<string> {
  const directory = await cacheDir();
  try {
    const recorded = recordingRun();
    const result = await transcodeForPanel(randomBytes(16), {
      cacheDir: directory,
      run: recorded.run,
      verifyForTest: true,
      placement,
      rotation,
    });
    expect(result.ok).toBe(true);
    const args = recorded.calls[0]!;
    const at = args.indexOf("-filter_complex");
    return at >= 0 ? args[at + 1]! : filterOf(args);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("the composed panel clip", () => {
  it("crops the source to the media's band and composites it over a solid fill", async () => {
    const filter = await filterFor({
      offsetX: 0,
      offsetY: 0,
      composition: { anchor: "left", extent: 0.65, fade: 0.12 },
      fill: { kind: "solid", color: "#101418" },
    });

    expect(filter).toContain("crop=");
    expect(filter).toContain("color=c=0x101418");
    expect(filter).toMatch(/maskedmerge|overlay/);
    // A left band keeping 65% of the 800px box is 520px wide and full height.
    expect(filter).toContain("scale=520:480");
  });

  it("renders a gradient fill with gradients=", async () => {
    const filter = await filterFor({
      offsetX: 0,
      offsetY: 0,
      composition: { anchor: "top", extent: 0.5 },
      fill: {
        kind: "gradient",
        angle: 90,
        stops: [
          { offset: 0, color: "#000000" },
          { offset: 1, color: "#ffffff" },
        ],
      },
    });

    expect(filter).toContain("gradients=");
    expect(filter).toContain("loop=loop=-1:size=1:start=0");
  });

  it("keeps every gradient endpoint inside its source", async () => {
    const filter = await filterFor({
      offsetX: 0,
      offsetY: 0,
      composition: { anchor: "top", extent: 0.5, fade: 0.3 },
      fill: {
        kind: "gradient",
        angle: 90,
        stops: [
          { offset: 0, color: "#000000" },
          { offset: 1, color: "#ffffff" },
        ],
      },
    });

    // `gradients` reads pixels, not fractions: an endpoint on the far edge is
    // outside the frame and paints the whole ramp wrong.
    const lines = filter.matchAll(
      /gradients=s=(\d+)x(\d+):[^[]*?:x0=(\d+):y0=(\d+):x1=(\d+):y1=(\d+)/g,
    );
    let checked = 0;
    for (const line of lines) {
      const [width = 0, height = 0, x0 = 0, y0 = 0, x1 = 0, y1 = 0] = line
        .slice(1)
        .map((value) => Number(value));
      expect(x0).toBeLessThan(width);
      expect(x1).toBeLessThan(width);
      expect(y0).toBeLessThan(height);
      expect(y1).toBeLessThan(height);
      checked += 1;
    }
    expect(checked).toBe(2);
  });

  it("draws the shared eased ramp, not a straight one", async () => {
    const filter = await filterFor({
      offsetX: 0,
      offsetY: 0,
      composition: { anchor: "left", extent: 0.35, fade: 0.4 },
    });
    // Eight grayscale stops from the one ramp the DOM and the glass paint.
    expect(filter).toMatch(/gradients=/);
    expect(filter).toContain("nb_colors=8");
    expect(filter).toContain("alphamerge=shortest=1");
    // The gradient source turns by default; the bake must hold it still.
    expect(filter).toContain("loop=loop=-1:size=1:start=0");
    const stops = blendRampStops()
      .map((stop) =>
        Math.round(stop.alpha * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .map((value) => `0x${value}${value}${value}`);
    for (const stop of stops) expect(filter).toContain(stop);
  });

  it("keeps the plain -vf path when there is no composition", async () => {
    const directory = await cacheDir();
    try {
      const recorded = recordingRun();
      await transcodeForPanel(randomBytes(16), {
        cacheDir: directory,
        run: recorded.run,
        verifyForTest: true,
        placement: { offsetX: 0.25, offsetY: 0 },
      });

      const args = recorded.calls[0]!;
      expect(args).toContain("-vf");
      expect(args).not.toContain("-filter_complex");
      expect(filterOf(args)).toContain("crop=");
      expect(filterOf(args)).not.toContain("gradients=");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("encodes again when only the composition changed", async () => {
    const bytes = randomBytes(16);
    const directory = await cacheDir();

    try {
      const plain = recordingRun([1]);
      await transcodeForPanel(bytes, {
        cacheDir: directory,
        run: plain.run,
        verifyForTest: true,
        placement: { offsetX: 0, offsetY: 0 },
      });

      const composed = recordingRun([2]);
      await transcodeForPanel(bytes, {
        cacheDir: directory,
        run: composed.run,
        verifyForTest: true,
        placement: {
          offsetX: 0,
          offsetY: 0,
          composition: { anchor: "left", extent: 0.65 },
          fill: { kind: "solid", color: "#101418" },
        },
      });

      expect(plain.calls).toHaveLength(1);
      expect(composed.calls, "the composition is part of the key").toHaveLength(
        1,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("panelCrop", () => {
  const box = { width: 800, height: 480 };

  it("crops to the same edge the player places", () => {
    // An ultrawide source leaves an overhang the offset pans through without
    // the pan floor taking over, so the placed rect's edge is not the box edge.
    const source = { width: 2560, height: 1080 };
    const rect = placement({
      box,
      source,
      offsetX: 0.1,
      offsetY: 0,
    });
    const crop = panelCrop(source, 0.1, 0, box);

    // The scaled crop edge is the placed rect's left edge, expressed in source
    // pixels; the same pan the player composes is what the panel encodes.
    const scale = rect.width / source.width;
    expect(Math.round(crop.x * scale)).toBe(Math.round(-rect.left));
    expect(crop).toEqual({ x: 200, y: 0, width: 1800, height: 1080 });
    expect(crop.x + crop.width).toBeLessThanOrEqual(source.width);
  });

  it("crops the box the mounting angle puts the layer in", () => {
    // A 90° mount lays the layer out in 480×800 before turning it onto the
    // glass, so the source window is portrait too.
    const crop = panelCrop({ width: 1920, height: 1080 }, 0, 0, {
      width: 480,
      height: 800,
    });

    expect(crop.width / crop.height).toBeCloseTo(480 / 800, 2);
    expect(crop.x + crop.width).toBeLessThanOrEqual(1920);
  });

  it("treats a non-finite offset as centred", () => {
    const source = { width: 1920, height: 1080 };
    expect(
      panelCrop(source, Number.NaN, Number.POSITIVE_INFINITY, box),
    ).toEqual(panelCrop(source, 0, 0, box));
  });
});

describe("a panel's video", () => {
  it("hands the display's mounting angle to the transcode", async () => {
    const angles: number[] = [];
    const { transport } = fakeTransport(
      "chs_5inch.dev1_rom1.88",
      "0",
      "create_success",
      "file_rev_done",
      "play_video_success",
      "seq_png_init_sucessneedReSend:0|renderCnt:1",
    );
    const panel = await opened(transport, {
      transcode: async (_bytes, _placement, rotation) => {
        angles.push(rotation);
        return threeByteClip();
      },
      sleep: async () => {},
    });

    try {
      await panel.video!.start(Uint8Array.of(1, 2, 3), still, 90);
      expect(angles).toEqual([90]);
    } finally {
      await panel.close();
    }
  });

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

  it("reuses the host cache and uploads the clip once across two starts", async () => {
    const directory = await cacheDir();

    try {
      const calls = { count: 0 };
      const encoded = Uint8Array.of(9, 9, 9);
      const { writes, transport } = fakeTransport(
        "chs_5inch.dev1_rom1.88", // HELLO
        "0", // GET_FILE_SIZE: nothing stored
        "create_success",
        "file_rev_done",
        "play_video_success",
        "seq_png_init_sucessneedReSend:0|renderCnt:1",
        "3", // the second start: the encoded clip is already stored
        "play_video_success",
        "seq_png_init_sucessneedReSend:0|renderCnt:1",
      );
      const panel = await opened(transport, {
        transcode: (bytes, placement) =>
          transcodeForPanel(bytes, {
            placement,
            cacheDir: directory,
            run: encoder(encoded, calls),
            verifyForTest: true,
          }),
        sleep: async () => {},
      });

      try {
        await panel.video!.start(Uint8Array.of(1, 2, 3), still);
        await panel.video!.start(Uint8Array.of(1, 2, 3), still);
      } finally {
        await panel.close();
      }

      // The cache answers the second start, and the panel's own name+size
      // check means neither start carries the clip twice.
      expect(calls.count).toBe(1);
      expect(
        writes.filter((bytes) => bytes[0] === 0x6f && bytes[1] === 0xef),
      ).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
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
