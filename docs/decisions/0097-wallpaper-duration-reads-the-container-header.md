# 0097 — A wallpaper row's duration is read from its container header

- **Date:** 2026-11-03
- **Status:** accepted
- **Paths:** `src/web/packages/theme-package/src/video-envelope.ts`,
  `src/web/packages/host/src/wallpaper-engine/duration.ts`,
  `src/web/packages/host/src/wallpaper-engine/source.ts`,
  `src/web/packages/host/src/wallpaper-engine/wire.ts`,
  `src/web/packages/host/src/wallpaper-engine/cache.ts`

## Problem

A Wallpaper Engine row lists the file's size but not its length. An item over
the import cap must be trimmed with `startMs`/`endMs`; without a duration the
end time is a guess. The host scan is the only place that knows the payload
path, so the length has to be established there and survive into the listing,
the persisted scan and the editor's row.

A wrong choice fails quietly in three ways: reading a whole multi-hundred-MB
clip to find its header stalls the scan; a guessed or zero duration makes a
trim look informed when it is not; a duration that is not persisted disappears
on the next host start while the row's other fields remain.

## Rung 1 — internal owner

Searched: `readVideoFacts`, `video-envelope`, `wallpaper-engine/wire`,
`wallpaper-engine/source`, `wallpaper-engine/cache`, `asset-finder/wallpaper`.

Found: `@yunari/theme-package`'s `readVideoFacts` already parses an ISO BMFF
container (`ftyp`, `moov`, `mvhd` timescale/duration, faststart) and is the
owner of the fact on every other path (`normalize-video`, `video-frame`,
`turzx-video`). It takes the whole file's bytes. The Wallpaper Engine scan owns
the payload path, and `StoredItem` is the row shape. Nothing read a header from
a range, and nothing carried a duration on the row.

## Rung 2 — installed dependencies

Searched: `video-envelope.ts`, its tests, and every `readVideoFacts` caller.

Found: the parser's rules (box walk, `size32 === 1` 64-bit form, `size32 === 0`
to end of file, refusal on truncated or non-MP4 input, `MAX_BOXES`) are the
behaviour a range reader must preserve. Reusing the parser over a joined
`ftyp` + `moov` pair keeps one set of rules. The package has no streaming or
range API of its own.

## Rung 3 — native platform

Searched: Node `fs/promises` `open`/`stat`/`read` and `FileHandle.close`.

Found: positioned reads answer bytes at an offset without loading the file, and
a failed `open`, a directory or an empty file is a caught error rather than a
throw. Node does not parse the container.

## Rung 4 — public solutions

Searched: repository for `ffprobe`/`ffmpeg` usage; the installed
`ffmpeg-static` binary and its recorder (`host/src/panels/tur-usb-video.ts`).

Found: `ffmpeg-static` ships an encoder and is already used for panel video;
it reports a duration in its own progress stream. It is not an ISO BMFF
container parser, and one spawned process per video row during a library scan
is a heavy dependency for a fact already available in the header. No `ffprobe`
binary is shipped. Upstream MP4 parsing references describe the same
`mvhd`-inside-`moov` walk this repo's parser already implements.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Spawn `ffmpeg -i` per video row | Reuses an installed binary | Process per row, stderr parsing, timeout and error policy, slower scan | Rejected: cost outweighs one header read |
| Read the whole file and reuse `readVideoFacts` | One parser, no new rules | Reads 299 MB to learn 4 bytes of duration; scan memory spike | Rejected on large clips |
| Range-read `ftyp`/`moov` and reuse `readVideoFacts` on the joined bytes | One parser, bounded reads | A small range walker that recognises the two boxes it needs | Accepted |
| Do nothing; keep guessing the trim | none | The reported defect remains | Rejected |

## Rung 6 — smallest probe

`videoDurationMs` over the theme-package `conforming.mp4` fixture returns
`2000`; the range test records the requested offsets and lengths and asserts
the payload is never requested (the first read is 16 bytes at offset 0, and no
read exceeds 4096 bytes even when `moov` follows `mdat`). The scan test lists a
real MP4 as `durationMs: 2000` and the restart test finds the same value in the
cache. A non-movie, missing, empty, WebM and truncated input all answer
`undefined` rather than zero.

## Decision

Add `readVideoFactsFrom(ranges)` to the theme-package owner: it walks top-level
boxes with positioned reads, collects `ftyp` and `moov` only, refuses a `moov`
over 32 MB or any box whose bounds leave the file, then hands the joined bytes
to the existing `readVideoFacts`. The host's `videoDurationMs` adapts a
`FileHandle` to that interface. The scan fills `StoredItem.durationMs` for a
video whose header parses; absent stays absent. The listing cache version moves
to 3 so a pre-duration cache is rescanned, and the wire and editor row read the
field only when it is a finite non-negative number. The row shows
`mm:ss` between kind and size.

Skipped: spawning ffmpeg/ffprobe for a library row, and persisting an
`undefined` duration as zero. Add the former only if a container the parser
cannot read becomes common; the latter would be fabricated telemetry.
