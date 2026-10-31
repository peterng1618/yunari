# 0024 — The clip is paced to its own playing time and encoded within the panel's budget

- **Date:** 2026-10-31
- **Status:** superseded by 0025, which replaces the realtime pacing and the
  bitrate cap with L-Connect's own encode and feed. Kept for the trace of the
  burst that made the ring's behaviour visible.
- **Paths:** `src/web/packages/host/src/panels/tur-usb-video.ts`,
  `src/web/packages/host/src/panels/tur-usb-panel.ts`

## Problem

With the depth gate in place the picture is clean for a few seconds and then
freezes. The trace of that run is the evidence: the feed wrote 13 blocks
(2.6 MB) in the first 1.1 s — the ring was empty, so every pre-write depth read
said "room" — and the panel's reported depth then sat at 3–6 for the rest of
the clip while it played out what it had, and the next block was cancelled
after waiting. A stream handed over faster than the panel plays is played from
a full ring and then starves; the vendor's own rule stops at 3 because above
that the ring stops draining.

## Rung 1 — internal owner

`tur-usb-video.ts` owns the encode (`panelH264Args`) and is the only place that
knows the clip's duration, which ffmpeg reports on stderr. `tur-usb-panel.ts`
owns the feed's cadence. Both already exist; nothing new is needed.

## Rung 2 — installed dependencies

`ffmpeg-static` prints `Duration: HH:MM:SS.xx` for the input; the run helper
currently throws its stderr away on success. No ffprobe is bundled, and this
one line is the whole fact needed.

## Rung 3 — native platform

No platform API knows a USB device's decode budget. Pacing has to be computed.

## Rung 4 — public solutions

The vendor's clips are produced by a realtime encoder, so its writes were
paced by the encoder, not by a timer (`WinUsb.PlayH264`, `isRepeat`). The
Rust replacement (`sgtaziz/lian-li-linux`) streams from a live encode and
records the panel NAKing bulk OUT as its buffer drains; its measured failure
is a keyframe arriving on a full buffer, which kills the firmware. Both point
at the same requirement: never hand the panel more stream than it can play.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Depth gate alone | Current code | An empty ring admits a whole-clip burst before any depth is reported | Reject |
| Fixed pause per block | Simple | 30 ms per 198 KiB is 6.6 MB/s, twelve times realtime | Reject |
| **Sleep the block's own playing time** | **Realtime by construction; the gate stays as the ceiling** | Needs the clip's duration from ffmpeg's stderr | **Adopt** |
| Lower the bitrate | Reduces the decoder's work | Quality loss without proof that decode rate is the limit | **Adopt as a bound** |

## Rung 6 — smallest probe

The 0023 trace, extended: block offsets against wall time show the feed
leading the clip, and the reported depth staying above the vendor's own limit
until the panel stops draining.

## Decision

The encoder also caps the stream at 1.5 Mbit/s (`-b:v`/`-maxrate`), so the
panel's decode budget is not the thing that decides whether a moving theme
plays, and hands back the clip's duration parsed from ffmpeg's stderr
(`Duration:`). The feed sleeps each block's own playing time — 10% faster than
realtime to keep a small lead — with the 30 ms floor and the depth gate of 0023
as the ceiling. A clip whose duration cannot be read keeps the floor-only
cadence and still relies on the gate.
