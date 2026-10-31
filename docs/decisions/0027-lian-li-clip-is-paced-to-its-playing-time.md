# 0027 — The Lian Li clip is paced to its own playing time

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/tur-usb-panel.ts`,
  `src/web/packages/host/src/panels/tur-usb-video.ts`

## Problem

A video theme on the 9.2" plays with a pause of one to two seconds every one to
two seconds, then resumes. The earlier work had replaced realtime pacing with
the vendor's own feed (0025) and added a depth gate (0023); neither explained a
period that regular.

## Rung 1 — internal owner

`tur-usb-panel.ts` owns the feed (`startVideo`, `feedVideo`,
`writeVideoBlock`, `drain`). `tur-usb-video.ts` owns the encode and is the only
place that sees ffmpeg's report of the input, including its duration. No runner
or manager paces the block stream.

## Rung 2 — installed dependencies

`usb` gives a bulk transfer and `ffmpeg-static` the encoder. Neither reports the
decoder's ring except through the panel's own `buffer-level` reply, which the
driver already polls.

## Rung 3 — native platform

No OS or Node API sees the panel's decoder. The webcam is the only instrument
that can say whether the glass advanced, which is why the probe below films it.

## Rung 4 — public solutions

The vendor's `PlayH264` reads the ack depth and drains to 2 above 3, with no
other pacing — but its own clips are produced by a realtime encoder, so its
writes were paced by the source. The Rust replacement streams from a live encode
and records the panel NAKing bulk OUT while it drains. Both feed at picture
rate; neither feeds at wire rate.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep the ack-only feed | The vendor's loop, verbatim | Measured 48 ms block gaps and a 2.2 s drain every 2.5 s: the ring drains empty | Reject |
| Shorten the reads in the drain | Cheap | The drain waits for playback, not for a reply; the hole stays | Reject |
| **Pace each block to its own share of the clip** | **Realtime by construction; the ring stays shallow** | Needs the duration from ffmpeg's stderr | **Adopt** |
| Fixed pause per block | Simple | 30 ms per 198 KiB is six times realtime | Reject |

## Rung 6 — smallest probe

The attached 9.2" was opened directly, played an 8.13 s clip, and had its bulk
writes timestamped; a 1 s overlay push ran beside it. Unpaced: gaps of 48 ms
for five blocks, then 2.17 s holes; overlay pushes alternated 100 ms and
1,300 ms. Filming the glass at 30 fps showed almost no change over 21 s (frame
difference median 0.35, max 1.39). Paced: gaps p50 142 ms, max 195 ms, pushes
~60 ms, and the same film showed continuous motion (median 0.63, max 45.7).

## Decision

`encodePanelH264` also reports the clip's duration from ffmpeg's `Duration:`
line. The feed waits out each block's own share of that duration, 10% ahead of
realtime, with the vendor's 30 ms pause as the floor, **outside the endpoint's
exclusive lock** — a sleep inside it held the UI overlay for a whole block. The
depth gate of 0023 stays as the ceiling; with this pacing it never fires.

0025 is amended: its "the clip is fed exactly as L-Connect does it" holds for
the packet sequence and the encode, but not for the cadence. Its evidence
against pacing came from a run where the cancelled-write bug (fixed later in
0023) still froze the picture.
