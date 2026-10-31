# 0016 — A TURZX frame decodes in process, not through ffmpeg

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/turzx-panel.ts`,
  `src/web/packages/host/src/panels/panel-image.ts`

## Problem

Every panel in the host is paced by one Node process. A CPU profile of a live
host (`node --cpu-prof`, 54 s, three panels and one browser page each) puts
**6.8 s of the 54 s in `verifyFfmpeg` + `readFileSync`**, all inside
`decodeStill` called from the TURZX overlay path, plus 1.1 s of garbage
collection and 3.0 s in `spawnSync` from `systeminformation`'s `nvidia-smi`.
The Kraken's frame transfer stalls for 150–250 ms about **once a second**, and
the trace shows the stall inside the bulk-write await while event-loop delay
peaks at 225–260 ms — a synchronous read of the bundled ffmpeg binary is what
holds the loop while the USB completion callback waits to run.

A panel that is fed a PNG the host produced itself has no reason to spawn a
decoder for it, and verifying a 70 MB binary's digest per frame is not a
security rule the protocol needs.

## Rung 1 — internal owner

`turzx-panel.ts` owns the still and overlay paths and takes a `decode` seam;
`panel-image.ts` owns `decodeStill` (ffmpeg plus the digest check);
`png-raster.ts` already owns the in-process PNG decode, and its docblock and
`panel-image.ts`'s own docblock both state that a live panel is meant to use it
("a live panel decodes the PNG the rasteriser already produces in process").
The code disagrees with its own contract; the fix is to finish that move.

## Rung 2 — installed dependencies

`node:zlib`'s `inflateSync` is the only dependency `png-raster.ts` uses, and it
already refuses non-PNG input by name. No dependency is added or removed;
`ffmpeg-static` stays for theme video transcoding (`tur-usb-video.ts`,
`turzx-video.ts`, `normalize-video.ts`), where it is the only decoder.

## Rung 3 — native platform

Chromium's `Page.startScreencast` produces PNG (or JPEG) and the host asks for
PNG for every panel that decodes pixels itself (`stillFormat = "png"` on both
TURZX and Kraken). Node's zlib is native; the per-row unfilter loop is a few
milliseconds at 800x480.

## Rung 4 — public solutions

- `panel-image.ts` already measured this path: "A spawn plus digest check costs
  220-250 ms for a 320x320 PNG, and ffmpeg emits nothing before its input's EOF".
- The in-process decoder was added for exactly this reason
  (`png-raster.ts`, 0006's decision) and is already the Kraken's path.
- ffmpeg's own documentation treats it as a filter graph for files and streams;
  there is no cheaper way to use it for a single PNG than spawning it.
- Chromium's PNG output is 8-bit truecolour, non-interlaced, which is the only
  shape `decodePngRgba` accepts, so no generality is lost.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| `decodeStill` (ffmpeg spawn + SHA-256 of the binary) per frame | Works | 220–250 ms per frame, a synchronous 70 MB read and digest, blocks every panel | Reject |
| `decodePngRgba` in process | The rasteriser already writes PNG | Needs a `RawFrame` shape at the seam | **Implement** |
| Cache `verifyFfmpeg`'s digest result | Keeps ffmpeg in the live path | The spawn alone is still a subprocess per frame, and the cache weakens a check the code deliberately repeats | Reject |
| Keep `panel-image.ts` with no callers | — | Dead decoder path, a second decoder to keep in step | Reject |

## Rung 6 — smallest probe

`node --cpu-prof` against the live host, 54 s: `update @ hash` 5.6 s under
`verifyFfmpeg`, `readFileSync` 1.2 s under the same call, `decodePngRgba` 0.4 s
for the Kraken's 13 frames a second, and event-loop delay peaks of 225–260 ms
aligned with the Kraken's slow frames. After the change the same profile must
show no `verifyFfmpeg` entries on a live panel still.

## Decision

`turzx-panel.ts` defaults `decode` to `decodePngRgba` and wraps it in the
`RawFrame` shape. `panel-image.ts` is deleted: with the TURZX panel on the
in-process decoder it has no caller, and two decoders for one PNG is the drift
this change exists to remove.

The other half of the profile — `systeminformation`'s `nvidia-smi` running
synchronously once a second — is a graphics-provider cost, not a panel one, and
is left for its own change.
