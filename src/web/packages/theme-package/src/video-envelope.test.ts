import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FabricThemeEnvelope } from "@yunari/renderer-core";
import { describe, expect, it } from "vitest";
import {
  readVideoFacts,
  themeVideoRefusals,
  VIDEO_LIMITS,
  videoRefusals,
} from "./video-envelope";

const fixture = (name: string): Uint8Array =>
  new Uint8Array(
    readFileSync(
      fileURLToPath(new URL(`../test-fixtures/${name}`, import.meta.url)),
    ),
  );

const conforming = fixture("conforming.mp4");
const long = fixture("long.mp4");
const wide = fixture("wide.mp4");
const odd = fixture("odd.mp4");
const audio = fixture("audio.mp4");
const noFaststart = fixture("nofaststart.mp4");
const vfr = fixture("vfr.mp4");
const chroma422 = fixture("chroma422.mp4");
const webm = fixture("other.webm");
const truncated = fixture("truncated.mp4");

const PATH = "assets/bg.mp4";

interface BoxLocation {
  readonly start: number;
  readonly payload: number;
  readonly end: number;
}

/** One child box of `type` in `start..end`, read the way the parser reads it. */
function childBox(
  bytes: Uint8Array,
  start: number,
  end: number,
  type: string,
): BoxLocation | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = start;
  while (offset + 8 <= end) {
    const size = view.getUint32(offset);
    const header = size === 1 ? 16 : 8;
    const actual = size === 0 ? end - offset : size;
    if (actual < header || actual > end - offset) return undefined;
    const found = String.fromCharCode(
      view.getUint8(offset + 4),
      view.getUint8(offset + 5),
      view.getUint8(offset + 6),
      view.getUint8(offset + 7),
    );
    if (found === type)
      return { start: offset, payload: offset + header, end: offset + actual };
    offset += actual;
  }
  return undefined;
}

/** The box at a path of nested container types, starting at the file root. */
function boxAt(bytes: Uint8Array, path: readonly string[]): BoxLocation {
  let start = 0;
  let end = bytes.length;
  let found: BoxLocation | undefined;
  for (const type of path) {
    found = childBox(bytes, start, end, type);
    if (found === undefined) throw new Error(`no ${type} in ${path.join("/")}`);
    start = found.payload;
    end = found.end;
  }
  if (found === undefined) throw new Error("empty box path");
  return found;
}

/** A copy with one big-endian 32-bit field rewritten and nothing else moved. */
function patchUint32(
  source: Uint8Array,
  offset: number,
  value: number,
): Uint8Array {
  const copy = source.slice();
  new DataView(copy.buffer, copy.byteOffset, copy.byteLength).setUint32(
    offset,
    value,
  );
  return copy;
}

/** audio.mp4's video trak, then 1100 free boxes inside `moov`, so the box walk's
 *  budget runs out before the audio trak is reached. Only `moov`'s length moves;
 *  every other byte is a copy of the fixture. */
function exhaustedWalk(): Uint8Array {
  const moov = boxAt(audio, ["moov"]);
  const videoTrak = childBox(audio, moov.payload, moov.end, "trak");
  if (videoTrak === undefined) throw new Error("no video trak");
  const freeBoxes = new Uint8Array(1100 * 8);
  for (let index = 0; index < 1100; index += 1)
    freeBoxes.set([0, 0, 0, 8, 0x66, 0x72, 0x65, 0x65], index * 8);

  const crafted = new Uint8Array(audio.length + freeBoxes.length);
  crafted.set(audio.subarray(0, videoTrak.end), 0);
  crafted.set(freeBoxes, videoTrak.end);
  crafted.set(audio.subarray(videoTrak.end), videoTrak.end + freeBoxes.length);
  new DataView(
    crafted.buffer,
    crafted.byteOffset,
    crafted.byteLength,
  ).setUint32(moov.start, moov.end - moov.start + freeBoxes.length);
  return crafted;
}

describe("readVideoFacts", () => {
  it("reads duration, dimensions, cadence and faststart from a conforming file", () => {
    const facts = readVideoFacts(conforming);
    expect(facts).toEqual({
      width: 320,
      height: 180,
      durationMs: 2_000,
      frameRate: 30,
      constantFrameRate: true,
      codec: "avc1",
      profile: 100,
      chromaFormat: 1,
      hasAudio: false,
      faststart: true,
    });
    expect(videoRefusals(PATH, facts!)).toEqual([]);
  });

  it("sees an audio track", () => {
    const facts = readVideoFacts(audio);
    expect(facts?.hasAudio).toBe(true);
    expect(facts?.width).toBe(320);
    expect(facts?.height).toBe(180);
  });

  it("sees moov after mdat", () => {
    expect(readVideoFacts(noFaststart)?.faststart).toBe(false);
    expect(readVideoFacts(conforming)?.faststart).toBe(true);
  });

  it("reads a 4:2:2 chroma format from the SPS", () => {
    expect(readVideoFacts(chroma422)?.chromaFormat).toBe(2);
    expect(readVideoFacts(chroma422)?.profile).toBe(122);
  });

  it("marks a variable cadence as not constant, and averages its rate", () => {
    const facts = readVideoFacts(vfr);
    expect(facts?.constantFrameRate).toBe(false);
    // 12 frames at 9000 ticks plus 28 at 3000 is 40 frames over 192000 ticks
    // (2.133 s): the sample table, not mdhd's rounded 2 s, is the media length.
    expect(facts?.durationMs).toBe(2_134);
    expect(facts?.frameRate).toBe(18.75);
  });

  it("returns undefined for a WebM", () => {
    expect(readVideoFacts(webm)).toBeUndefined();
  });

  it("returns undefined for a truncated MP4", () => {
    expect(readVideoFacts(truncated)).toBeUndefined();
  });

  it("reads a zeroed mdhd timescale as unreadable, not as a zero-duration video", () => {
    const mdhd = boxAt(conforming, ["moov", "trak", "mdia", "mdhd"]);
    const zeroed = patchUint32(conforming, mdhd.payload + 12, 0);
    // The rest of the file is untouched: the zero is the only lie.
    expect(zeroed.subarray(0, mdhd.payload + 12)).toEqual(
      conforming.subarray(0, mdhd.payload + 12),
    );
    expect(readVideoFacts(zeroed)).toBeUndefined();
  });

  it("cannot hide a 60 fps sample table behind a doubled mdhd duration", () => {
    const mdhd = boxAt(conforming, ["moov", "trak", "mdia", "mdhd"]);
    const stts = boxAt(conforming, [
      "moov",
      "trak",
      "mdia",
      "minf",
      "stbl",
      "stts",
    ]);
    // The fixture is 2 s of 30 fps: 60 samples of 512 ticks. Double the
    // container's duration claim and halve the delta, so the table the player
    // decodes is 60 fps while `mdhd` still describes a misleading timeline.
    let crafted = patchUint32(conforming, mdhd.payload + 16, 61_440);
    crafted = patchUint32(crafted, stts.payload + 12, 256);

    const facts = readVideoFacts(crafted)!;
    expect(facts.constantFrameRate).toBe(true);
    expect(videoRefusals(PATH, facts)).toEqual([
      `${PATH}: frame rate 60 fps exceeds the 30 fps maximum`,
    ]);
  });

  it("keeps the larger duration when mdhd and the sample table disagree", () => {
    const mdhd = boxAt(long, ["moov", "trak", "mdia", "mdhd"]);
    // mdhd is shortened to 15.75 s while the 945 samples still total 31.5 s.
    const crafted = patchUint32(long, mdhd.payload + 16, 241_920);

    const facts = readVideoFacts(crafted)!;
    expect(facts.frameRate).toBe(30);
    expect(videoRefusals(PATH, facts)).toEqual([
      `${PATH}: duration 31500 ms exceeds the 30000 ms maximum`,
    ]);
  });

  it("reads an exhausted box walk as unreadable, not as a video without audio", () => {
    // audio.mp4 has the video trak first. Enough free boxes between it and the
    // audio trak exhaust the walk's budget before the audio is reached.
    expect(readVideoFacts(exhaustedWalk())).toBeUndefined();
  });

  it("reads a zero sample delta as unreadable, not as a zero-rate constant video", () => {
    const mdhd = boxAt(conforming, ["moov", "trak", "mdia", "mdhd"]);
    const stts = boxAt(conforming, [
      "moov",
      "trak",
      "mdia",
      "minf",
      "stbl",
      "stts",
    ]);
    // mdhd claims 1 s while the 60-sample table's one entry claims 0 ticks. A
    // zero delta is an absent measurement, not a cadence, so the file must not
    // read as a conforming 0 fps constant-rate video.
    let crafted = patchUint32(conforming, mdhd.payload + 16, 15_360);
    crafted = patchUint32(crafted, stts.payload + 12, 0);

    expect(readVideoFacts(crafted)).toBeUndefined();
  });

  it("returns undefined for hostile bytes rather than throwing", () => {
    expect(readVideoFacts(new Uint8Array(0))).toBeUndefined();
    expect(readVideoFacts(new Uint8Array(4096))).toBeUndefined();
    // A box whose declared size runs past the buffer.
    const lying = new Uint8Array([
      0xff, 0xff, 0xff, 0xff, 0x6d, 0x6f, 0x6f, 0x76,
    ]);
    expect(readVideoFacts(lying)).toBeUndefined();
    // A top-level box that claims to be everything, with nothing inside.
    const empty = new Uint8Array(8);
    empty.set([0x6d, 0x6f, 0x6f, 0x76], 4);
    expect(readVideoFacts(empty)).toBeUndefined();
    // A 64-bit box whose high word is non-zero cannot fit in a typed array.
    const sixtyFour = new Uint8Array(16);
    new DataView(sixtyFour.buffer).setUint32(0, 1);
    sixtyFour.set([0x6d, 0x6f, 0x6f, 0x76], 4);
    new DataView(sixtyFour.buffer).setUint32(8, 1);
    expect(readVideoFacts(sixtyFour)).toBeUndefined();
    // A size-0 box claims to the end of the buffer; a childless moov has no
    // tracks to read.
    const sizeZero = new Uint8Array(8);
    new DataView(sizeZero.buffer).setUint32(0, 0);
    sizeZero.set([0x6d, 0x6f, 0x6f, 0x76], 4);
    expect(readVideoFacts(sizeZero)).toBeUndefined();
  });
});

describe("videoRefusals", () => {
  it("names the file and the duration bound", () => {
    const facts = readVideoFacts(long)!;
    expect(facts.durationMs).toBe(31_500);
    expect(videoRefusals(PATH, facts)).toEqual([
      `${PATH}: duration 31500 ms exceeds the 30000 ms maximum`,
    ]);
  });

  it("refuses a duration just over the bound that display rounding would hide", () => {
    const mdhd = boxAt(conforming, ["moov", "trak", "mdia", "mdhd"]);
    // 460807 / 15360 = 30.00045 s: `Math.round` would print it as 30000 ms.
    const crafted = patchUint32(conforming, mdhd.payload + 16, 460_807);
    const facts = readVideoFacts(crafted)!;
    expect(facts.durationMs).toBe(30_001);
    expect(videoRefusals(PATH, facts)).toContain(
      `${PATH}: duration 30001 ms exceeds the 30000 ms maximum`,
    );
  });

  it("names the file and the long-edge bound", () => {
    const facts = readVideoFacts(wide)!;
    expect(facts.width).toBe(5120);
    expect(videoRefusals(PATH, facts)).toEqual([
      `${PATH}: long edge 5120 px exceeds the 4096 px maximum`,
    ]);
  });

  it("refuses odd dimensions, and says so in the fixed order", () => {
    const facts = readVideoFacts(odd)!;
    expect(facts.width).toBe(641);
    expect(facts.height).toBe(360);
    expect(videoRefusals(PATH, facts)).toEqual([
      `${PATH}: H.264 profile 244; High (100) is required`,
      `${PATH}: chroma format 3; 4:2:0 is required`,
      `${PATH}: odd dimensions 641x360; even width and height are required`,
    ]);
  });

  it("refuses a 4:2:2 file with the chroma sentence", () => {
    const facts = readVideoFacts(chroma422)!;
    const refusals = videoRefusals(PATH, facts);
    expect(refusals).toContain(`${PATH}: chroma format 2; 4:2:0 is required`);
  });

  it("refuses an audio-bearing file", () => {
    expect(videoRefusals(PATH, readVideoFacts(audio)!)).toEqual([
      `${PATH}: audio track present; video must be silent`,
    ]);
  });

  it("refuses a file without +faststart", () => {
    expect(videoRefusals(PATH, readVideoFacts(noFaststart)!)).toEqual([
      `${PATH}: moov comes after mdat; +faststart is required`,
    ]);
  });

  it("refuses a variable cadence with the frame-rate sentence", () => {
    expect(videoRefusals(PATH, readVideoFacts(vfr)!)).toEqual([
      `${PATH}: variable frame rate; a constant frame rate is required`,
    ]);
  });

  it("refuses a measured rate above the cap", () => {
    const facts = { ...readVideoFacts(conforming)!, frameRate: 60 };
    expect(videoRefusals(PATH, facts)).toEqual([
      `${PATH}: frame rate 60 fps exceeds the 30 fps maximum`,
    ]);
  });

  it("lists every breach in one fixed order", () => {
    const facts = readVideoFacts(odd)!;
    expect(videoRefusals(PATH, { ...facts, hasAudio: true })).toEqual([
      `${PATH}: H.264 profile 244; High (100) is required`,
      `${PATH}: chroma format 3; 4:2:0 is required`,
      `${PATH}: odd dimensions 641x360; even width and height are required`,
      `${PATH}: audio track present; video must be silent`,
    ]);
  });

  it("refuses an unreadable video rather than passing it", () => {
    const envelope = {
      schemaVersion: "2.0.0",
      fabricVersion: "7.4.0",
      id: "aurora",
      artboard: { width: 1920, height: 1080 },
      metadata: { name: "Aurora", themeLanguage: "en" },
      scene: { version: "7.4.0", objects: [] },
      assets: [{ id: "clip", kind: "video", path: "assets/clip.webm" }],
    } as FabricThemeEnvelope;

    expect(themeVideoRefusals(envelope, { "assets/clip.webm": webm })).toEqual([
      "assets/clip.webm: video cannot be read; an H.264 MP4 is required",
    ]);
  });

  it("names truncation apart from a wrong codec", () => {
    // An actually-H.264 file whose walk ran out of budget: it does not need a
    // different codec, so the codec sentence would send the author in circles.
    const envelope = {
      schemaVersion: "2.0.0",
      fabricVersion: "7.4.0",
      id: "aurora",
      artboard: { width: 1920, height: 1080 },
      metadata: { name: "Aurora", themeLanguage: "en" },
      scene: { version: "7.4.0", objects: [] },
      assets: [{ id: "clip", kind: "video", path: "assets/clip.mp4" }],
    } as FabricThemeEnvelope;

    expect(
      themeVideoRefusals(envelope, { "assets/clip.mp4": exhaustedWalk() }),
    ).toEqual([
      "assets/clip.mp4: video cannot be read; the file is truncated or too complex, so re-export it as a plain H.264 MP4",
    ]);
  });

  it("checks declared videos only, in declaration order", () => {
    const envelope = {
      schemaVersion: "2.0.0",
      fabricVersion: "7.4.0",
      id: "aurora",
      artboard: { width: 1920, height: 1080 },
      metadata: { name: "Aurora", themeLanguage: "en" },
      scene: { version: "7.4.0", objects: [] },
      assets: [
        { id: "still", kind: "image", path: "assets/still.webm" },
        { id: "clip", kind: "video", path: "assets/clip.mp4" },
      ],
    } as FabricThemeEnvelope;

    // The declared video is over the cap; the image's undecodable bytes are not
    // this check's business.
    expect(
      themeVideoRefusals(envelope, {
        "assets/still.webm": webm,
        "assets/clip.mp4": long,
      }),
    ).toEqual([
      `assets/clip.mp4: duration 31500 ms exceeds the 30000 ms maximum`,
    ]);
  });

  it("publishes the envelope bounds", () => {
    expect(VIDEO_LIMITS).toEqual({
      maxDurationMs: 30_000,
      maxLongEdge: 4096,
      maxFrameRate: 30,
    });
  });
});
