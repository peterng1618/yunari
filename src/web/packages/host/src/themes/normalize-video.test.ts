import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import { readVideoFacts, videoRefusals } from "@yunari/theme-package";
import { describe, expect, it, vi } from "vitest";
import { verifyFfmpeg } from "./ffmpeg-hash.mjs";
import { ffmpegArgs, normalizeVideo } from "./normalize-video.js";

// The real module resolves to a bundled binary on this machine; the missing-
// encoder case is a module that gave none, which is what a build without the
// optional download looks like.
vi.mock("ffmpeg-static", () => ({ default: null }));

// The shipped path, without the seam: the digest is read from disk on every
// spawn, so a case that counts the seam cannot see a cache behind it.
vi.mock("./ffmpeg-hash.mjs", () => ({
  verifyFfmpeg: vi.fn((): { ok: true } => ({ ok: true })),
}));

function fixture(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(
      new URL(`../../../theme-package/test-fixtures/${name}`, import.meta.url),
    ),
  );
}

function runWriting(output: Uint8Array) {
  return vi.fn(async (args: readonly string[]) => {
    const file = args.at(-1);
    if (file === undefined) throw new Error("no output path");
    await fs.writeFile(file, output);
    return { code: 0, stderr: "" };
  });
}

/** The spawn gate's seam: a fake encoder has no digest recorded for it. */
const acceptHash = (): { ok: true } => ({ ok: true });

describe("normalizeVideo", () => {
  it("returns the same bytes object for a conforming input", async () => {
    const bytes = fixture("conforming.mp4");
    const run = vi.fn(async () => ({ code: 0, stderr: "" }));

    const result = await normalizeVideo(bytes, { run });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes).toBe(bytes);
    expect(result.reencoded).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses a 31-second input without spawning the encoder", async () => {
    const run = vi.fn(async () => ({ code: 0, stderr: "" }));

    const result = await normalizeVideo(fixture("long.mp4"), { run });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("30000");
    expect(run).not.toHaveBeenCalled();
  });

  it("re-encodes an out-of-envelope input once and returns the re-probed result", async () => {
    const encoded = fixture("conforming.mp4");
    const run = runWriting(encoded);

    const result = await normalizeVideo(fixture("wide.mp4"), {
      ffmpegPath: "ffmpeg-stub",
      run,
      verifyForTest: acceptHash,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reencoded).toBe(true);
    expect(result.bytes).toEqual(encoded);
    expect(run).toHaveBeenCalledTimes(1);
    // `contain` by default: the long edge is capped at 4096 and the frame is
    // padded to the even box rather than cropped.
    const args = run.mock.calls[0]?.[0] ?? [];
    expect(args).toContain("-vf");
    expect(args[args.indexOf("-vf") + 1]).toMatch(/^scale=4096:144:.*,pad=/);
    expect(args[args.indexOf("-maxrate") + 1]).toBe("20000000");
    expect(args[args.indexOf("-crf") + 1]).toBe("23");
  });

  it("drops audio by copying the video stream, without an encode", async () => {
    const run = runWriting(fixture("conforming.mp4"));

    const result = await normalizeVideo(fixture("audio.mp4"), {
      ffmpegPath: "ffmpeg-stub",
      run,
      verifyForTest: acceptHash,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reencoded).toBe(true);
    const args = run.mock.calls[0]?.[0] ?? [];
    expect(args[args.indexOf("-c:v") + 1]).toBe("copy");
    expect(args).not.toContain("-vf");
    expect(args).not.toContain("libx264");
  });

  it("moves moov by copying the video stream, without an encode", async () => {
    const run = runWriting(fixture("conforming.mp4"));

    const result = await normalizeVideo(fixture("nofaststart.mp4"), {
      ffmpegPath: "ffmpeg-stub",
      run,
      verifyForTest: acceptHash,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const args = run.mock.calls[0]?.[0] ?? [];
    expect(args[args.indexOf("-c:v") + 1]).toBe("copy");
    expect(args).not.toContain("-vf");
  });

  it("refuses encoder output that does not conform to the envelope", async () => {
    // A build that ignored `-r`/`-an`/`+faststart` would return bytes like this:
    // trusted, they would replace the master with a non-conforming video.
    const run = runWriting(new Uint8Array([1, 2, 3, 4]));

    const result = await normalizeVideo(fixture("wide.mp4"), {
      ffmpegPath: "ffmpeg-stub",
      run,
      verifyForTest: acceptHash,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("publish envelope");
    expect(result.message).not.toContain("avc1");
  });

  it("refuses encoder output that parses but breaks the envelope", async () => {
    // The case above dies at "not even a readable MP4"; this one reaches the
    // `videoRefusals` arm: an encoder that ignored the bounds wrote a parseable
    // 31.5-second file, which must not be handed back as a success.
    const encoded = fixture("long.mp4");
    const refusal = videoRefusals("normalized", readVideoFacts(encoded)!);
    expect(refusal).toContain(
      "normalized: duration 31500 ms exceeds the 30000 ms maximum",
    );
    const run = runWriting(encoded);

    const result = await normalizeVideo(fixture("wide.mp4"), {
      ffmpegPath: "ffmpeg-stub",
      run,
      verifyForTest: acceptHash,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("publish envelope");
  });

  it("covers the requested aspect, and the output conforms to it", async () => {
    // The stub plays the encoder: the bytes it writes are a conforming 16:9
    // clip, so the test proves the route's options reach the filter and the
    // answer is re-probed, without a 30-second encode in the suite.
    const encoded = fixture("conforming.mp4");
    const run = runWriting(encoded);

    const result = await normalizeVideo(fixture("wide.mp4"), {
      fit: "cover",
      aspect: { width: 16, height: 9 },
      ffmpegPath: "ffmpeg-stub",
      run,
      verifyForTest: acceptHash,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reencoded).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    const args = run.mock.calls[0]?.[0] ?? [];
    expect(args[args.indexOf("-vf") + 1]).toBe(
      "scale=4096:2304:force_original_aspect_ratio=increase:force_divisible_by=2,crop=4096:2304",
    );
    expect(args[args.indexOf("-maxrate") + 1]).toBe("20000000");
    const facts = readVideoFacts(result.bytes);
    expect(facts?.width).toBe(320);
    expect(facts?.height).toBe(180);
    expect(facts === undefined ? [] : videoRefusals("out.mp4", facts)).toEqual(
      [],
    );
  });

  it("refuses cover without an aspect, without spawning", async () => {
    const run = vi.fn(async () => ({ code: 0, stderr: "" }));

    const result = await normalizeVideo(fixture("wide.mp4"), {
      fit: "cover",
      run,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("aspect");
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses a non-zero exit without echoing the raw stderr", async () => {
    const result = await normalizeVideo(fixture("wide.mp4"), {
      ffmpegPath: "ffmpeg-stub",
      run: async () => ({ code: 1, stderr: "ENCODER INTERNAL DETAIL" }),
      verifyForTest: acceptHash,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("code 1");
    expect(result.message).not.toContain("ENCODER INTERNAL DETAIL");
  });

  it("verifies once per spawn, not once per path", async () => {
    // The digests are read immediately before each spawn because the binary can
    // be replaced between them; a per-path cache would accept the second.
    const run = runWriting(fixture("conforming.mp4"));
    const verifyForTest = vi.fn(acceptHash);

    const options = { ffmpegPath: "ffmpeg-stub", run, verifyForTest };
    await normalizeVideo(fixture("wide.mp4"), options);
    await normalizeVideo(fixture("wide.mp4"), options);

    expect(verifyForTest).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("verifies once per spawn, not once per path, on the default path", async () => {
    // The case above counts the seam, which production never passes; the
    // shipped defect sat behind it. Here the real verifier is mocked, so a
    // cache in `verified` leaves the second spawn unhashed and this fails.
    const run = runWriting(fixture("conforming.mp4"));
    vi.mocked(verifyFfmpeg).mockClear();

    const options = { ffmpegPath: "ffmpeg-stub", run };
    await normalizeVideo(fixture("wide.mp4"), options);
    await normalizeVideo(fixture("wide.mp4"), options);

    expect(verifyFfmpeg).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("refuses a binary whose hash does not match, without spawning it", async () => {
    const run = vi.fn(async () => ({ code: 0, stderr: "" }));

    const result = await normalizeVideo(fixture("wide.mp4"), {
      ffmpegPath: "ffmpeg-stub",
      run,
      verifyForTest: () => ({
        ok: false,
        message: "ffmpeg-static 5.3.0 win32-x64: expected aa, got bb.",
      }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe(
      "The bundled ffmpeg does not match the hash recorded for this platform, " +
        "so the video was not re-encoded.",
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("names the missing encoder when the module supplied none", async () => {
    const run = vi.fn(async () => ({ code: 0, stderr: "" }));

    const result = await normalizeVideo(fixture("wide.mp4"), { run });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("ffmpeg");
    expect(run).not.toHaveBeenCalled();
  });
});

describe("ffmpegArgs", () => {
  it("fills the box and crops for cover", () => {
    const facts = {
      width: 2048,
      height: 180,
      durationMs: 1000,
      frameRate: 30,
      constantFrameRate: true,
      codec: "avc1",
      profile: 100,
      chromaFormat: 1,
      hasAudio: false,
      faststart: true,
    };

    const args = ffmpegArgs("in.mp4", "out.mp4", facts, "cover", {
      width: 16,
      height: 9,
    });

    expect(args[args.indexOf("-vf") + 1]).toMatch(
      /^scale=4096:2304:.*force_original_aspect_ratio=increase.*,crop=4096:2304$/,
    );
  });

  it("caps the rate by the output's resolution", () => {
    const at = (width: number, height: number): string => {
      const facts = {
        width,
        height,
        durationMs: 1000,
        frameRate: 30,
        constantFrameRate: true,
        codec: "avc1",
        profile: 100,
        chromaFormat: 1,
        hasAudio: false,
        faststart: true,
      };
      const args = ffmpegArgs("in.mp4", "out.mp4", facts, "contain");
      return args[args.indexOf("-maxrate") + 1] ?? "";
    };

    expect(at(1920, 1080)).toBe("6000000");
    expect(at(2560, 1440)).toBe("12000000");
    expect(at(3840, 2160)).toBe("20000000");
  });
});
