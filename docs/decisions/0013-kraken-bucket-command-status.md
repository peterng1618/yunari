# 0013 — The Kraken ring does not gate every bucket command on its status

- **Date:** 2026-10-30
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/kraken-z3-panel.ts`

## Problem

A live video theme on the Z73 shows a *pull back*: once every few seconds the
glass replays a frame it already showed — usually the one before, sometimes
three to eight back. Filming the glass at 30 fps against a page whose only
content is a bar that only ever moves forward located the fault after the
capture, not before it:

| Where | Samples | Backward steps |
|---|---|---|
| `Page.captureScreenshot` of the panel page, 70 ms cadence, 300 s | 3886 | 0 |
| The glass, 30 fps camera, 300 s | 2409 | 30 (≈1 per 10 s) |

The page, the capture, the PNG decode and the wire are ordered. What is left is
the bucket hand-off in `KrakenPanel`: `deleteBucket`, `createBucket` and
`switchBucket` each read the firmware's status byte and drop it, and a refused
delete leaves the bucket holding the graphic from when it was last written (the
firmware keeps a bucket's first image), so the switch that follows can put an
older frame on the glass.

## Rung 1 — internal owner

`kraken-z3-panel.ts` is the only module that speaks this protocol; `panel-runner`
owns cadence and the failure threshold. The hand-off belongs in the panel.

## Rung 2 — installed dependencies

`node-hid` answers every read whether or not a command succeeded; `usb` reports
only transfer errors. Neither reports the firmware's status byte.

## Rung 3 — native platform

No OS API observes the LCD's framebuffer. A webcam is the only instrument, and
it is what produced the measurement above.

## Rung 4 — public solutions

- **liquidctl `kraken3.py`** checks the status of every bucket command and
  raises on anything that is not success.
- **AIOLCDUnchained** pre-creates 16 buckets and never deletes per frame, so a
  refused delete cannot leave an old graphic behind.
- 0006 records that a rewrite of the displayed bucket answers status `9` and
  stores nothing; the driver alternates to avoid it.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Carry on after a refused command | Zero cost | The glass shows an older frame, observed once per 10 s | Shipped once, see below |
| Give up the table on any refusal and rebuild with `prepare()` | Reads every status | A refusal costs a dropped frame plus a table rebuild, and `prepare()` switches to liquid mode | **Rejected** |
| 16 pre-created buckets, no deletes | No old graphic to expose | Nothing frees a bucket, so it wedges after 16 frames | Reject |

## Rung 6 — smallest probe

The 30 fps camera over the glass for 300 s, against a page whose only content is
a bar that only ever moves forward, with the panel driven by the host. The same
page sampled through `Page.captureScreenshot` gave no backward step in 3886
samples, which is what puts the fault after the capture.

## Decision

**The ring keeps carrying on after a refused command.** Gating every command on
its status was shipped and reverted the same day: the video became noticeably
worse on every clip — not just the car clip that showed the pull back — and the
delivered frame rate dropped, because a refusal now costs a dropped frame and a
`prepare()` that clears sixteen buckets and switches the glass to liquid mode.
The refusals are frequent enough that this dominates; the old behaviour, which
loses one frame's ordering once every few seconds, is the smaller defect.

What is established and reusable: the page and the capture are ordered, so any
future attempt at this must change the hand-off without rebuilding the table on
the frame path — for example a bucket ring deep enough that a refused delete
still leaves a fresh bucket ahead of the glass.
