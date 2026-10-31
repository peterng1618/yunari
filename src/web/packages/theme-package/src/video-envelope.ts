/**
 * The publish-time video envelope, read from an MP4's own boxes.
 *
 * The parser is pure and hostile-input hardened: every read is bounds-checked,
 * every loop has a box/entry budget, and anything unreadable returns
 * `undefined` rather than throwing, so a crafted upload cannot hang or allocate
 * without bound.
 */

import type { FabricThemeEnvelope } from "@yunari/renderer-core";

export interface VideoLimits {
  readonly maxDurationMs: number;
  readonly maxLongEdge: number;
  readonly maxFrameRate: number;
}

export const VIDEO_LIMITS: VideoLimits = {
  maxDurationMs: 60_000,
  maxLongEdge: 4096,
  maxFrameRate: 30,
};

/** A span an author selected from a longer source, in source milliseconds. The
 *  editor sends it to the host's normalizer; the host is the one that decides
 *  whether it fits the envelope. */
export interface VideoTrimRange {
  readonly startMs: number;
  readonly endMs: number;
}

/** A trimmed loop's dissolve, and the shortest span that leaves a body after
 *  it. The editor's trim UI and the host's encoder both read these, so the two
 *  cannot disagree about what a usable selection is. */
export const VIDEO_TRIM = {
  blendMs: 1_000,
  minSpanMs: 2_000,
} as const;

export interface VideoFacts {
  readonly width: number;
  readonly height: number;
  /** The longest of media, edit-list, track and movie duration, so a clip that
   *  repeats or holds its media cannot present past the cap. */
  readonly durationMs: number;
  /** Measured average; a cadence that is not constant says so in `constantFrameRate`. */
  readonly frameRate: number;
  readonly constantFrameRate: boolean;
  /** Sample entry fourcc, e.g. "avc1". */
  readonly codec: string | undefined;
  /** `avcC`'s `profile_idc`. */
  readonly profile: number | undefined;
  /** SPS `chroma_format_idc`: 1 is 4:2:0, 2 is 4:2:2, 3 is 4:4:4, 0 is monochrome. */
  readonly chromaFormat: number | undefined;
  readonly hasAudio: boolean;
  /** `moov` appears before the first `mdat`. */
  readonly faststart: boolean;
}

/** Boxes are counted across the whole walk, not per level. */
const MAX_BOXES = 1024;
const MAX_DEPTH = 8;
const MAX_STSD_ENTRIES = 32;
const MAX_STTS_ENTRIES = 100_000;
const MAX_ELST_ENTRIES = 256;
const MAX_SPS_BYTES = 4096;
const VISUAL_SAMPLE_ENTRY_BYTES = 78;

/** Profile families whose SPS carries `chroma_format_idc`; the rest are 4:2:0. */
const CHROMA_PROFILES = new Set([
  44, 83, 86, 100, 110, 118, 122, 128, 134, 135, 138, 139, 244,
]);

interface BoxSpan {
  readonly type: string;
  readonly start: number;
  readonly end: number;
}

interface Budget {
  left: number;
  /** A walk stopped before its declared end, so nothing it returned is complete. */
  truncated: boolean;
}

interface Track {
  handler: string | undefined;
  timescale: number | undefined;
  /** The `mdhd` duration in `timescale` ticks. */
  duration: number | undefined;
  samples: number;
  /** `stts`'s total media time in `timescale` ticks: what the player actually decodes. */
  sampleTicks: number;
  /** Sum of `elst` segment_durations in movie-timescale ticks: what the track
   *  presents, which an edit can stretch past its media. `undefined` without an
   *  edit list. */
  editTicks: number | undefined;
  /** `tkhd` duration in movie-timescale ticks. */
  trackTicks: number | undefined;
  deltas: Set<number>;
  codec: string | undefined;
  width: number;
  height: number;
  profile: number | undefined;
  chromaFormat: number | undefined;
}

interface VideoRead {
  readonly facts: VideoFacts | undefined;
  /** An MP4-shaped file whose walk stopped before its declared end: it is
   *  incomplete or too complex, which is not the claim "not an H.264 MP4". */
  readonly truncated: boolean;
}

/** `undefined` means the bytes are not an MP4 this parser can read. */
export function readVideoFacts(bytes: Uint8Array): VideoFacts | undefined {
  return readVideo(bytes).facts;
}

function readVideo(bytes: Uint8Array): VideoRead {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const budget: Budget = { left: MAX_BOXES, truncated: false };
  const top = boxes(view, 0, view.byteLength, budget, 0);
  // A top-level `ftyp` is what separates an incomplete MP4 from bytes that are
  // not an MP4 at all: only the former may be told it is truncated.
  const mp4 = top.some((box) => box.type === "ftyp");
  // A walk that stopped early has not seen the whole file, so its silence about
  // a track means nothing; only a completed walk can answer "no audio".
  if (budget.truncated) return unreadable(budget, mp4);
  const moov = top.find((box) => box.type === "moov");
  if (moov === undefined) return unreadable(budget, mp4);
  const mdat = top.find((box) => box.type === "mdat");
  const faststart = mdat !== undefined && moov.start < mdat.start;

  const tracks: Track[] = [];
  let movieTimescale: number | undefined;
  let movieTicks: number | undefined;
  for (const box of boxes(view, moov.start, moov.end, budget, 1)) {
    if (box.type === "trak") tracks.push(readTrak(view, box, budget));
    else if (box.type === "mvhd") {
      const timing = readTimescaleDuration(view, box);
      if (timing !== undefined) {
        movieTimescale = timing.timescale;
        movieTicks = timing.duration;
      }
    }
  }
  if (budget.truncated) return unreadable(budget, mp4);
  const video = tracks.find((track) => track.handler === "vide");
  if (video === undefined) return unreadable(budget, mp4);

  // Timing the parser cannot read is unreadable, not a zero-duration video: a
  // cap must never be satisfied by an absent measurement.
  const timescale = video.timescale;
  if (timescale === undefined || timescale <= 0) return unreadable(budget, mp4);

  const mdhdMs =
    video.duration === undefined
      ? undefined
      : (video.duration / timescale) * 1000;
  const sampleMs =
    video.sampleTicks > 0 ? (video.sampleTicks / timescale) * 1000 : undefined;
  // Edit-list and track durations are stated on the movie timeline, so a
  // conversion with no movie timescale cannot bound the presentation. Refuse
  // rather than ignore the claim.
  const editMs = ticksToMs(video.editTicks, movieTimescale);
  const trackMs = ticksToMs(video.trackTicks, movieTimescale);
  const movieMs = ticksToMs(movieTicks, movieTimescale);
  if (
    (video.editTicks !== undefined && editMs === undefined) ||
    (video.trackTicks !== undefined && trackMs === undefined)
  )
    return unreadable(budget, mp4);
  // The fields can lie about each other. For a cap the larger wins: a duration
  // under-reported by any one must not shorten the file, and an edit list that
  // repeats or holds media presents longer than the sample table.
  const durationMsRaw = Math.max(
    mdhdMs ?? 0,
    sampleMs ?? 0,
    editMs ?? 0,
    trackMs ?? 0,
    movieMs ?? 0,
  );

  const uniformDelta =
    video.deltas.size === 1 ? [...video.deltas][0] : undefined;
  // A zero delta is not a cadence. Left alone it would read as 0 fps and a
  // constant rate while the table carries no time at all, which is the absent
  // measurement this parser exists to refuse.
  if (uniformDelta !== undefined && uniformDelta <= 0)
    return unreadable(budget, mp4);
  const sampleSeconds = sampleMs === undefined ? undefined : sampleMs / 1000;
  const frameRateRaw =
    video.samples <= 0
      ? 0
      : uniformDelta !== undefined && uniformDelta > 0
        ? // A uniform table's cadence is exact, where samples/seconds merely
          // averages and can under-report a rounded `mdhd` duration (F2).
          timescale / uniformDelta
        : sampleSeconds !== undefined && sampleSeconds > 0
          ? video.samples / sampleSeconds
          : 0;

  return {
    facts: {
      width: video.width,
      height: video.height,
      durationMs: capCeil(durationMsRaw),
      frameRate: capCeil(frameRateRaw * 1000) / 1000,
      constantFrameRate: video.samples > 0 && video.deltas.size === 1,
      codec: video.codec,
      profile: video.profile,
      chromaFormat: video.chromaFormat,
      hasAudio: tracks.some((track) => track.handler === "soun"),
      faststart,
    },
    truncated: false,
  };
}

function unreadable(budget: Budget, mp4: boolean): VideoRead {
  return { facts: undefined, truncated: mp4 && budget.truncated };
}

/** Rounds a bound up, tolerating only floating-point noise. A rounded display
 *  value must not let 30.0004 s or fps pass a 30 cap. */
function capCeil(value: number): number {
  const nearest = Math.round(value);
  return Math.abs(value - nearest) < 1e-6 ? nearest : Math.ceil(value);
}

/** Ticks to milliseconds, or `undefined` when either side is missing. A zero
 *  timescale is not a unit, so it converts nothing. */
function ticksToMs(
  ticks: number | undefined,
  timescale: number | undefined,
): number | undefined {
  return ticks === undefined || timescale === undefined || timescale <= 0
    ? undefined
    : (ticks / timescale) * 1000;
}

/** Every way `facts` breaks the envelope, in a fixed order. Empty means conforming. */
export function videoRefusals(path: string, facts: VideoFacts): string[] {
  const refusals: string[] = [];
  if (!facts.faststart)
    refusals.push(`${path}: moov comes after mdat; +faststart is required`);
  if (facts.codec !== "avc1")
    refusals.push(
      `${path}: video codec ${printable(facts.codec ?? "none")}; H.264 (avc1) is required`,
    );
  if (facts.profile !== 100)
    refusals.push(
      `${path}: H.264 profile ${facts.profile ?? "unknown"}; High (100) is required`,
    );
  if (facts.chromaFormat !== 1)
    refusals.push(
      `${path}: chroma format ${facts.chromaFormat ?? "unknown"}; 4:2:0 is required`,
    );
  if (facts.width % 2 !== 0 || facts.height % 2 !== 0)
    refusals.push(
      `${path}: odd dimensions ${facts.width}x${facts.height}; even width and height are required`,
    );
  if (!facts.constantFrameRate)
    refusals.push(
      `${path}: variable frame rate; a constant frame rate is required`,
    );
  if (facts.frameRate > VIDEO_LIMITS.maxFrameRate)
    refusals.push(
      `${path}: frame rate ${facts.frameRate} fps exceeds the ${VIDEO_LIMITS.maxFrameRate} fps maximum`,
    );
  if (facts.hasAudio)
    refusals.push(`${path}: audio track present; video must be silent`);
  if (facts.durationMs > VIDEO_LIMITS.maxDurationMs)
    refusals.push(
      `${path}: duration ${facts.durationMs} ms exceeds the ${VIDEO_LIMITS.maxDurationMs} ms maximum`,
    );
  const longEdge = Math.max(facts.width, facts.height);
  if (longEdge > VIDEO_LIMITS.maxLongEdge)
    refusals.push(
      `${path}: long edge ${longEdge} px exceeds the ${VIDEO_LIMITS.maxLongEdge} px maximum`,
    );
  return refusals;
}

/**
 * Every way the theme's declared videos break the envelope, in declaration
 * order. Empty means every video conforms. Bytes the parser cannot read are
 * refused too: an unreadable video is not a pass.
 */
export function themeVideoRefusals(
  envelope: FabricThemeEnvelope,
  assets: Readonly<Record<string, Uint8Array>>,
): string[] {
  for (const asset of envelope.assets ?? []) {
    if (asset.kind !== "video") continue;
    const bytes = assets[asset.path];
    const read = bytes === undefined ? undefined : readVideo(bytes);
    if (read === undefined || read.facts === undefined)
      return [
        // Truncation is not a codec fault: telling the author to change the
        // codec would send them to re-export the same way again.
        read?.truncated === true
          ? `${asset.path}: video cannot be read; the file is truncated or too complex, so re-export it as a plain H.264 MP4`
          : `${asset.path}: video cannot be read; an H.264 MP4 is required`,
      ];
    const refusals = videoRefusals(asset.path, read.facts);
    if (refusals.length > 0) return refusals;
  }
  return [];
}

function boxes(
  view: DataView,
  start: number,
  end: number,
  budget: Budget,
  depth: number,
): BoxSpan[] {
  const spans: BoxSpan[] = [];
  if (depth > MAX_DEPTH) {
    budget.truncated = true;
    return spans;
  }
  let offset = start;
  while (offset + 8 <= end) {
    if (budget.left <= 0) {
      budget.truncated = true;
      return spans;
    }
    budget.left -= 1;
    let size = view.getUint32(offset);
    const type = fourcc(view, offset + 4);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) {
        budget.truncated = true;
        return spans;
      }
      // A payload past 4 GiB cannot fit in a Uint8Array, so a non-zero high
      // word is malformed for our purposes.
      if (view.getUint32(offset + 8) !== 0) {
        budget.truncated = true;
        return spans;
      }
      size = view.getUint32(offset + 12);
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || size > end - offset) {
      budget.truncated = true;
      return spans;
    }
    spans.push({ type, start: offset + header, end: offset + size });
    offset += size;
  }
  return spans;
}

/** A fourcc from untrusted bytes, made safe to print in a refusal sentence. */
function printable(value: string): string {
  return [...value]
    .map((character) =>
      character.charCodeAt(0) >= 0x20 && character.charCodeAt(0) <= 0x7e
        ? character
        : "?",
    )
    .join("");
}

function fourcc(view: DataView, offset: number): string {
  if (offset + 4 > view.byteLength) return "";
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function readTrak(view: DataView, trak: BoxSpan, budget: Budget): Track {
  const track: Track = {
    handler: undefined,
    timescale: undefined,
    duration: undefined,
    samples: 0,
    sampleTicks: 0,
    deltas: new Set(),
    codec: undefined,
    width: 0,
    height: 0,
    profile: undefined,
    chromaFormat: undefined,
    editTicks: undefined,
    trackTicks: undefined,
  };
  for (const child of boxes(view, trak.start, trak.end, budget, 1)) {
    if (child.type === "edts") {
      const editTicks = readEdts(view, child, budget);
      if (editTicks !== undefined) track.editTicks = editTicks;
      continue;
    }
    if (child.type === "tkhd") {
      const timing = readTimescaleDuration(view, child);
      if (timing !== undefined) track.trackTicks = timing.duration;
      continue;
    }
    if (child.type !== "mdia") continue;
    for (const box of boxes(view, child.start, child.end, budget, 2)) {
      if (box.type === "hdlr") {
        if (box.start + 12 <= box.end)
          track.handler = fourcc(view, box.start + 8);
      } else if (box.type === "mdhd") {
        const timing = readTimescaleDuration(view, box);
        if (timing !== undefined) {
          track.timescale = timing.timescale;
          track.duration = timing.duration;
        }
      } else if (box.type === "minf") {
        for (const stbl of boxes(view, box.start, box.end, budget, 3)) {
          if (stbl.type !== "stbl") continue;
          for (const entry of boxes(view, stbl.start, stbl.end, budget, 4)) {
            if (entry.type === "stsd") readStsd(view, entry, budget, track);
            else if (entry.type === "stts")
              readStts(view, entry, budget, track);
          }
        }
      }
    }
  }
  return track;
}

/** The sum of an `edts`'s edit-list segment durations, in movie-timescale
 *  ticks. An edit can hold or repeat media, so this presentation length can
 *  exceed the media the sample table carries. */
function readEdts(
  view: DataView,
  edts: BoxSpan,
  budget: Budget,
): number | undefined {
  for (const box of boxes(view, edts.start, edts.end, budget, 2)) {
    if (box.type === "elst") return readElst(view, box, budget);
  }
  return undefined;
}

function readElst(
  view: DataView,
  box: BoxSpan,
  budget: Budget,
): number | undefined {
  if (box.start + 8 > box.end) {
    budget.truncated = true;
    return undefined;
  }
  const version = view.getUint8(box.start);
  // Only the two defined layouts can be read; an unknown one may claim any
  // presentation length, so it is unreadable rather than ignored.
  if (version !== 0 && version !== 1) {
    budget.truncated = true;
    return undefined;
  }
  const entryBytes = version === 1 ? 20 : 12;
  const declared = view.getUint32(box.start + 4);
  const count = Math.min(
    declared,
    Math.floor((box.end - box.start - 8) / entryBytes),
    MAX_ELST_ENTRIES,
  );
  // Entries the budget dropped would under-report the presentation, so the
  // untidy list is unreadable rather than short.
  if (count < declared) {
    budget.truncated = true;
    return undefined;
  }
  let total = 0;
  for (let i = 0; i < count; i++) {
    const offset = box.start + 8 + i * entryBytes;
    total +=
      version === 1
        ? view.getUint32(offset) * 2 ** 32 + view.getUint32(offset + 4)
        : view.getUint32(offset);
    if (!Number.isSafeInteger(total)) {
      budget.truncated = true;
      return undefined;
    }
  }
  return count > 0 ? total : undefined;
}

/** `mvhd`, `tkhd` and `mdhd` share the version/creation/modification/timescale/
 *  duration prefix. Edit-list and track durations are on the movie timeline,
 *  media duration on the track's own. */
function readTimescaleDuration(
  view: DataView,
  box: BoxSpan,
): { timescale: number; duration: number } | undefined {
  if (box.start + 4 > box.end) return undefined;
  const version = view.getUint8(box.start);
  if (version === 1) {
    if (box.start + 32 > box.end) return undefined;
    return {
      timescale: view.getUint32(box.start + 20),
      duration:
        view.getUint32(box.start + 24) * 2 ** 32 +
        view.getUint32(box.start + 28),
    };
  }
  if (box.start + 20 > box.end) return undefined;
  return {
    timescale: view.getUint32(box.start + 12),
    duration: view.getUint32(box.start + 16),
  };
}

function readStsd(
  view: DataView,
  box: BoxSpan,
  budget: Budget,
  track: Track,
): void {
  if (box.start + 8 > box.end) {
    budget.truncated = true;
    return;
  }
  const count = Math.min(view.getUint32(box.start + 4), MAX_STSD_ENTRIES);
  let offset = box.start + 8;
  for (let i = 0; i < count; i++) {
    if (offset + 8 > box.end) {
      budget.truncated = true;
      return;
    }
    const size = view.getUint32(offset);
    if (size < 8 || size > box.end - offset) {
      budget.truncated = true;
      return;
    }
    const codec = fourcc(view, offset + 4);
    const payload = offset + 8;
    const payloadEnd = offset + size;
    track.codec = codec;
    // VisualSampleEntry: width/height sit 24/26 bytes into the entry payload.
    if (payload + 28 <= payloadEnd) {
      track.width = view.getUint16(payload + 24);
      track.height = view.getUint16(payload + 26);
    }
    if (
      (codec === "avc1" || codec === "avc3") &&
      payload + VISUAL_SAMPLE_ENTRY_BYTES <= payloadEnd
    ) {
      for (const child of boxes(
        view,
        payload + VISUAL_SAMPLE_ENTRY_BYTES,
        payloadEnd,
        budget,
        5,
      )) {
        if (child.type !== "avcC") continue;
        track.profile =
          child.start + 1 < child.end
            ? view.getUint8(child.start + 1)
            : undefined;
        track.chromaFormat = readAvcCChroma(view, child);
      }
    }
    return;
  }
}

/** First SPS's `chroma_format_idc`; `undefined` when the avcC carries none we can read. */
function readAvcCChroma(view: DataView, avcC: BoxSpan): number | undefined {
  if (avcC.start + 6 > avcC.end) return undefined;
  const profileId = view.getUint8(avcC.start + 1);
  const spsCount = Math.min(view.getUint8(avcC.start + 5) & 0x1f, 32);
  let offset = avcC.start + 6;
  for (let i = 0; i < spsCount; i++) {
    if (offset + 2 > avcC.end) return undefined;
    const length = view.getUint16(offset);
    const start = offset + 2;
    if (length === 0 || length > MAX_SPS_BYTES || start + length > avcC.end)
      return undefined;
    const chroma = readSpsChroma(view, start, start + length, profileId);
    if (chroma !== undefined) return chroma;
    offset = start + length;
  }
  return undefined;
}

function readSpsChroma(
  view: DataView,
  start: number,
  end: number,
  profileId: number,
): number | undefined {
  // RBSP: drop the NAL header byte and every emulation-prevention 0x03.
  const rbsp: number[] = [];
  let zeros = 0;
  for (let i = start + 1; i < end; i++) {
    const byte = view.getUint8(i);
    if (zeros >= 2 && byte === 3) {
      zeros = 0;
      continue;
    }
    rbsp.push(byte);
    zeros = byte === 0 ? zeros + 1 : 0;
  }
  const bits = new BitReader(Uint8Array.from(rbsp));
  // H.264 SPS RBSP: profile_idc, constraint flags and level_idc, then the
  // parameter-set id; `chroma_format_idc` follows only for the High families.
  if (!bits.skip(24)) return undefined;
  if (bits.ue() === undefined) return undefined; // seq_parameter_set_id
  if (!CHROMA_PROFILES.has(profileId)) return 1; // the non-High families are 4:2:0
  const chroma = bits.ue();
  return chroma !== undefined && chroma <= 3 ? chroma : undefined;
}

function readStts(
  view: DataView,
  box: BoxSpan,
  budget: Budget,
  track: Track,
): void {
  if (box.start + 8 > box.end) {
    budget.truncated = true;
    return;
  }
  const declared = view.getUint32(box.start + 4);
  const count = Math.min(
    declared,
    Math.floor((box.end - box.start - 8) / 8),
    MAX_STTS_ENTRIES,
  );
  // Entries the budget dropped would under-report the media length, so the
  // untidy table is unreadable rather than short.
  if (count < declared) budget.truncated = true;
  let offset = box.start + 8;
  for (let i = 0; i < count; i++) {
    const samples = view.getUint32(offset);
    const delta = view.getUint32(offset + 4);
    track.samples += samples;
    track.sampleTicks += samples * delta;
    track.deltas.add(delta);
    offset += 8;
  }
}

/** Bounded exp-Golomb reader; every read past the end returns `undefined`. */
class BitReader {
  private readonly view: DataView;
  private bit = 0;

  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private get end(): number {
    return this.view.byteLength * 8;
  }

  skip(count: number): boolean {
    if (count < 0 || this.bit + count > this.end) return false;
    this.bit += count;
    return true;
  }

  u(count: number): number | undefined {
    if (count < 0 || count > 32 || this.bit + count > this.end)
      return undefined;
    let value = 0;
    for (let i = 0; i < count; i++) {
      value = value * 2 + this.readBit();
    }
    return value;
  }

  /** Unsigned exp-Golomb, bounded to 31 leading zeros. */
  ue(): number | undefined {
    let leading = 0;
    while (true) {
      const bit = this.u(1);
      if (bit === undefined) return undefined;
      if (bit === 1) break;
      leading += 1;
      if (leading > 31) return undefined;
    }
    if (leading === 0) return 0;
    const rest = this.u(leading);
    if (rest === undefined) return undefined;
    return 2 ** leading - 1 + rest;
  }

  private readBit(): number {
    const byte = this.view.getUint8(this.bit >>> 3);
    const bit = (byte >>> (7 - (this.bit & 7))) & 1;
    this.bit += 1;
    return bit;
  }
}
