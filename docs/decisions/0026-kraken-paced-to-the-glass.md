# 0026 — The Kraken is paced to the glass, not to the wire

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/kraken-z3-panel.ts`

## Problem

A live theme on the Kraken Z73 still judders after the screencast and settle
changes: frames jerk back, the picture tears, and the motion is choppier than
NZXT CAM's own integration on the same glass. The host's wire work measures
clean — every bucket command answers status 1 — so the defect is in how often
the glass is asked to change, not in whether the device accepts the work.

## Rung 1 — internal owner

This worktree has no CodeGraph index, so the sources were read directly.
`kraken-z3-panel.ts` owns the bucket ring and states the cadence as
`KRAKEN_FRAME_INTERVAL_MS`; `panel-runner.ts` owns the tick, the overlap and
the dedupe; `panel-manager.ts` only passes the device's `frameIntervalMs` to
`setInterval`. No other module schedules a panel frame, so the cadence target
belongs in the driver.

## Rung 2 — installed dependencies

`node-hid` reports the report bytes and `usb` reports the transfer. Neither
exposes the firmware's display pipeline, and the firmware itself answers a
dropped switch with status 1. The runner's `setInterval` and its queued
follow-up are the only scheduling primitives involved.

## Rung 3 — native platform

No Node or Windows API observes the LCD. The webcam is the only instrument that
can say whether a switch became a picture, which is why the probe below films
the glass rather than trusting the wire.

## Rung 4 — public solutions

- **liquidctl** and **AIOLCDUnchained** switch buckets without publishing any
  switch-rate limit; neither streams live frames, so neither meets the case.
- **NZXT CAM's captured stream (0018)** switches a paletted 101-slot bucket
  about every 110 ms. Its payload is 103,424 bytes, a quarter of a mode-2 frame.
- No public driver documents a dropped-switch behaviour or a minimum switch
  interval. The device's own glass is the only source.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep 70 ms and let the runner send as fast as the wire allows | Most pictures asked for | The glass showed 60% of them, unevenly | Reject |
| Gate each switch on a status | Reads the firmware | The firmware reports success for a dropped switch | Reject |
| Return to the paletted mode for its smaller frame | CAM's own rate | 256 colours reintroduce the banding 0020 removed | Reject for now |
| **Pace the runner to the cadence the glass honours** | **Every sent frame becomes a picture** | Trades rate for regularity; the ceiling is per-frame bytes | **Adopt** |
| Skip the settle and rely on pacing | Fewer bytes per tick | No measured benefit at this pace; the settle costs no rate at 140 ms | Keep the settle |

## Rung 6 — smallest probe

A barcode frame (four rows, each bit a white/black pair so a glare gradient
cannot fake it) was presented at a chosen cadence while a 30 fps webcam filmed
the glass. The index held in the film is compared against the index sent:
forward skips are dropped switches, backward steps are pull-backs, and a tear
is two rows showing different indices for two or more camera frames.

| Send cadence | Settle | Sent | Pictures on glass | Pull-backs | Held tears |
|---|---|---|---|---|---|
| 70 ms | 0 ms | 293 | 174 | 3 | 1 |
| 70 ms | 10 ms | 254 | 128 | 4 | 1 |
| 100 ms | 0 ms | 163 | 138 | 3 | 2 |
| 130 ms | 0 ms | 127 | 128 | 0 | 0 |
| 135 ms | 10 ms | 134 | 132 | 0 | 1 |
| 140 ms | 10 ms | 129 | 130 | 0 | 0 |
| 250 ms | 40 ms | 79 | 80 | 0 | 0 |

At 70 ms a single index could be held ~130 ms while its neighbours vanished;
the same driver at 140 ms showed every frame. The wire timings for the same
frames are 409,600 bytes of bulk ~52 ms, the five bucket commands ~22 ms, the
10 ms settle and the PNG decode ~4 ms: about 90 ms, well under the glass's
ceiling.

## Decision

`KRAKEN_FRAME_INTERVAL_MS` becomes **140 ms**. The driver continues to send
24-bit frames and keeps the settle; the glass, not the wire, sets the rate.
This costs the nominal 14 FPS rate the old interval claimed — which the glass
never showed — and buys a regular ~7 FPS with no dropped, repeated or torn
frame. CAM's ~9 FPS comes from a paletted frame a quarter of the size; matching
it would mean returning to 256 colours, which 0020 rejected for visible
banding. Whether a paletted frame also raises the glass's switch ceiling is
recorded as an open hardware question, not assumed.
