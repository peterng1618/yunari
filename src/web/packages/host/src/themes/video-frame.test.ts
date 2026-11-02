import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import { readVideoFacts } from "@yunari/theme-package";
import { describe, expect, it, vi } from "vitest";
import { extractVideoFrame, transcodeVideo } from "./video-frame.js";

function fixture(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(
      new URL(`../../../theme-package/test-fixtures/${name}`, import.meta.url),
    ),
  );
}

/** The smallest bytes the extractor will accept back: signature and nothing
 *  more, because that check exists to catch ffmpeg writing no image at all. */
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);

function runWriting(output: Uint8Array) {
  return vi.fn(async (args: readonly string[]) => {
    const file = args.at(-1);
    if (file === undefined) throw new Error("no output path");
    await fs.writeFile(file, output);
    return { code: 0, stderr: "" };
  });
}

const acceptHash = (): { ok: true } => ({ ok: true });

function options(run: ReturnType<typeof runWriting>) {
  return { ffmpegPath: "ffmpeg-stub", run, verifyForTest: acceptHash };
}

describe("extractVideoFrame", () => {
  it("asks for one scaled frame at the declared index", async () => {
    const bytes = fixture("conforming.mp4");
    const run = runWriting(PNG);

    const result = await extractVideoFrame(bytes, 0, options(run));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes).toEqual(PNG);

    const args = run.mock.calls[0]?.[0] ?? [];
    expect(args).toContain("-frames:v");
    expect(args[args.indexOf("-frames:v") + 1]).toBe("1");
    // Input seek: before `-i`, where ffmpeg decodes forward from the keyframe.
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"));
    expect(args[args.indexOf("-ss") + 1]).toBe("0");
    expect(String(args[args.indexOf("-vf") + 1])).toMatch(
      /^scale=\d+:\d+:force_original_aspect_ratio=decrease$/u,
    );
    expect(args.at(-1)).toMatch(/out\.png$/u);
  });

  it("clamps a frame past the end to the last one", async () => {
    const bytes = fixture("conforming.mp4");
    const facts = readVideoFacts(bytes);
    if (facts === undefined) throw new Error("fixture is not a video");
    const run = runWriting(PNG);

    const result = await extractVideoFrame(bytes, 100_000, options(run));

    expect(result.ok).toBe(true);
    const args = run.mock.calls[0]?.[0] ?? [];
    const seconds = Number(args[args.indexOf("-ss") + 1]);
    const lastFrame = Math.max(
      0,
      Math.round((facts.durationMs / 1000) * facts.frameRate) - 1,
    );
    expect(seconds).toBeCloseTo(lastFrame / facts.frameRate, 3);
  });

  it("refuses bytes that are not a readable video without spawning anything", async () => {
    const run = runWriting(PNG);

    const result = await extractVideoFrame(
      new Uint8Array([1, 2, 3]),
      0,
      options(run),
    );

    expect(result.ok).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses a frame that is not a whole, non-negative index", async () => {
    const run = runWriting(PNG);

    for (const frame of [-1, 1.5, Number.NaN]) {
      const result = await extractVideoFrame(
        fixture("conforming.mp4"),
        frame,
        options(run),
      );
      expect(result.ok).toBe(false);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("reports an encoder that wrote no picture", async () => {
    const run = runWriting(new Uint8Array([1, 2, 3]));

    const result = await extractVideoFrame(
      fixture("conforming.mp4"),
      0,
      options(run),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/poster frame/iu);
  });
});

describe("transcodeVideo", () => {
  it("crops the painted rect and scales it to the panel box", async () => {
    const encoded = fixture("conforming.mp4");
    const run = runWriting(encoded);

    const result = await transcodeVideo(
      encoded,
      { width: 160, height: 160 },
      options(run),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes).toEqual(encoded);

    const args = run.mock.calls[0]?.[0] ?? [];
    // 320×180 cover of a square box: the square source window is 180×180 at
    // x=70, then encoded at the box's own 160×160.
    expect(String(args[args.indexOf("-vf") + 1])).toBe(
      "crop=180:180:70:0,scale=160:160:flags=lanczos",
    );
  });

  it("keeps the authored pan and zoom in the crop", async () => {
    const encoded = fixture("conforming.mp4");
    const run = runWriting(encoded);

    const result = await transcodeVideo(
      encoded,
      { width: 160, height: 160, offsetX: 0.25, scale: 2 },
      options(run),
    );

    expect(result.ok).toBe(true);
    const args = run.mock.calls[0]?.[0] ?? [];
    // The 2× zoom and quarter-box pan select a 90×90 window, moved 92 px right
    // and 44 px up from the centred crop. The source window is smaller than the
    // panel here, so it is left for the page to magnify.
    expect(String(args[args.indexOf("-vf") + 1])).toBe(
      "crop=90:90:92:44,scale=90:90:flags=lanczos",
    );
  });

  it("never upscales a clip past the source window", async () => {
    const encoded = fixture("conforming.mp4");
    const run = runWriting(encoded);

    const result = await transcodeVideo(
      encoded,
      { width: 4096, height: 4096 },
      options(run),
    );

    expect(result.ok).toBe(true);
    const args = run.mock.calls[0]?.[0] ?? [];
    // The source window is 180×180; the page may magnify it, but the encoder
    // adds no pixels of its own.
    expect(String(args[args.indexOf("-vf") + 1])).toBe(
      "crop=180:180:70:0,scale=180:180:flags=lanczos",
    );
  });

  it("refuses a target that is not a pixel size", async () => {
    const run = runWriting(fixture("conforming.mp4"));

    for (const target of [
      { width: 0, height: 320 },
      { width: 320, height: -1 },
      { width: Number.NaN, height: 320 },
      { width: 320.5, height: 320 },
    ]) {
      const result = await transcodeVideo(
        fixture("conforming.mp4"),
        target,
        options(run),
      );
      expect(result.ok).toBe(false);
    }
    expect(run).not.toHaveBeenCalled();
  });
});
