# 0101 — A wallpaper video row reports the container its bytes actually use

- **Date:** 2026-11-03
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/wallpaper-engine/container.ts`,
  `src/web/packages/host/src/wallpaper-engine/source.ts`,
  `src/web/packages/host/src/wallpaper-engine/wire.ts`,
  `src/web/packages/host/src/wallpaper-engine/cache.ts`,
  `src/web/packages/editor/src/wallpaper-engine/client.ts`,
  `src/web/packages/editor/src/asset-finder/wallpaper.tsx`,
  `src/web/packages/editor/src/ui-copy.ts`

## Problem

Wallpaper Engine descriptors name a video payload by file name, and the host's
`resolvePayload` derives the served content type from that extension. A clip
whose `.mp4` name carries Matroska bytes is therefore advertised as `video/mp4`
and presented as a usable video. The editor only learns otherwise when the
host's MP4 parser refuses the bytes after the author pressed "Set as
background", which spends the import attempt on a file the envelope can never
take.

A wrong choice fails quietly in three ways: a guessed content type mislabels
bytes a browser may later decode; sniffing at import time still presents the
row as usable; and a container fact that is not persisted disappears on the
next host start while the rest of the row survives.

## Rung 1 — internal owner

Searched: CodeGraph for `resolvePayload`, `ItemPayload`, `StoredItem`,
`bytesOf`, `videoDurationMs`, `readVideoFacts`, `fetchItemAsset`,
`wallpaperCards`, `wallpaperActionsOf`.

Found: `duration.ts` already range-reads a video's header for its length.
`resolve.ts` owns the payload kind and the extension-derived content type.
`wire.ts` owns the wire row, `cache.ts` persists it, and the editor's
`client.ts` validates it. `wallpaper.tsx` owns the card and its one action.
Nothing read the container, and nothing carried a container fact.

## Rung 2 — installed dependencies

Searched: `@yunari/theme-package` `video-envelope.ts` and its tests, all
`readVideoFacts` callers, and the `ffmpeg-static` usage in the host.

Found: `readVideoFacts` owns ISO BMFF parsing and returns `undefined` for every
non-MP4 container. `ffmpeg-static` ships an encoder but no `ffprobe`, and one
spawn per row during a library scan is too heavy for a header fact. No installed
library identifies EBML.

## Rung 3 — native platform

Searched: Node `fs/promises` positioned reads and the existing header range
reader in `duration.ts`.

Found: the first bytes of a payload can be read without loading the file. Node
does not identify a container; the magic bytes and DocType are the only facts
available without a parser dependency.

## Rung 4 — public solutions

Searched: the repository's existing container knowledge (0097 and
`video-envelope.ts`), and the Matroska/WebM specification's magic bytes and
DocType field. Live web search was unavailable in this session, so this rung
records the standard rather than a fetched page.

Found: ISO BMFF starts with an `ftyp` box at offset 4; EBML starts `1A 45 DF
A3`, and its DocType names `webm` or `matroska`. WebM is the Matroska subset
whose registered type is `video/webm`; other Matroska is `video/x-matroska`.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep the extension-derived type | none | The reported mislabel remains | Rejected |
| Sniff the header at scan and at the byte route | One fact, no dependency, bounded read | A small magic/DocType reader | Accepted |
| Spawn `ffmpeg -i` per row | Reuses an installed binary | No ffprobe, process per row, stderr parsing | Rejected |
| Transcode every non-MP4 clip on import | Accepts more wallpapers | The MP4 parser cannot supply the size/duration the encoder needs; large change | Not this fix |

## Rung 6 — smallest probe

The new `container.test.ts` passes `ftyp`, EBML `webm`, EBML `matroska` and
unrecognised bytes and asserts the four answers and their media types. The
source test writes a `.mp4`-named Matroska payload and asserts the row carries
`container: "matroska"`, no invented duration, and that its byte route answers
`video/x-matroska`; the existing MP4 fixture asserts `container: "mp4"`.

## Decision

Add `container.ts` beside the Wallpaper Engine scan: it reads the first
kilobyte, returns `mp4`, `webm`, `matroska` or `unknown`, and maps that to the
served media type. The scan stores the fact on `StoredItem`, the byte route
serves the sniffed type, and the listing cache version moves to 4 so a
pre-container cache is rescanned. The editor's row names the container when it
is known, and a video whose container is not `mp4` gets a disabled background
action whose label states the envelope's requirement.

Skipped: decoding WebM/Matroska into the publish envelope. Add it only if
Wallpaper Engine libraries commonly hold such clips and the product wants them
importable; the parser's size/duration facts would then need an fps/ffprobe-free
source.
