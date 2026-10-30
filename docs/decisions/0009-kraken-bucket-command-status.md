# 0009 — Recover the Kraken ring when a bucket command is refused

- **Date:** 2026-10-30
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/kraken-z3-panel.ts`

## Problem

A live video theme on the Z73 shows a *pull back*: once every few seconds the
glass replays a frame it already showed — usually the one before, sometimes
three to eight back. Measured with a bar whose x position is the only content
on the page (one position per panel frame), filmed at 30 fps:

| Where | Samples | Backward steps |
|---|---|---|
| `Page.captureScreenshot` of the panel page, 70 ms cadence, 300 s | 3886 | 0 |
| The glass, 30 fps camera, 300 s | 2409 | 30 (≈1 per 10 s) |

The page, the capture, the PNG decode and the wire are ordered; the rewind is
introduced between the sent frame and the glass, which is the bucket hand-off
in `KrakenPanel`.

`deleteBucket`, `createBucket` and `switchBucket` each read the firmware's
reply status and then **drop it**. Status `1` is success; anything else is a
command the firmware refused, and the two that matter are already documented in
0006: status `9` (`BucketIsBeingDisplayed`) and `18` (busy). A refused
`32 02` (delete) leaves the bucket holding the graphic from when it was last
written, and the firmware keeps the first graphic stored in a bucket rather
than overwriting it — so the switch that follows puts that older frame on the
glass. A refused `32 01` (create) or `36 01` (begin) after a dropped ack has
the same shape. That is exactly the observed signature: a frame that is one
bucket old, or several when deletes have been failing for a while.

## Rung 1 — internal owner

`kraken-z3-panel.ts` is the only module that speaks this protocol; `panel-runner`
owns cadence and the failure threshold that turns three refused frames into a
lost panel. The recovery belongs in the panel, because only it knows that a
refused command leaves its `shown`/`ready` state untrustworthy.

## Rung 2 — installed dependencies

`node-hid` answers every read whether or not a command succeeded; `usb` reports
only transfer errors. Neither reports the firmware's status byte.

## Rung 3 — native platform

No OS API observes the LCD's framebuffer. The webcam is the only instrument
that can see what the glass shows, and it is what produced the measurement
above.

## Rung 4 — public solutions

- **liquidctl `kraken3.py`** checks the status byte of every bucket command and
  raises on anything that is not success; it does not carry on with a table it
  was refused.
- **AIOLCDUnchained** pre-creates 16 buckets and never deletes per frame, so a
  refused delete cannot leave an old graphic behind — it trades the failure for
  a bucket ring that runs out instead.
- 0006 already records that a rewrite of the displayed bucket is answered with
  status `9` and stores nothing; the driver alternates to avoid it, but never
  reads the answer that says the alternate failed too.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Carry on after a refused command (today) | Zero cost | The glass shows an older frame, observed once per 10 s | Reject |
| 16 pre-created buckets, no deletes | No old graphic to expose | Nothing frees a bucket, so it wedges after 16 frames | Reject |
| **Read every status; a refusal drops `ready`** | Fits the existing `prepare()` recovery | One frame lost while the table is rebuilt | **Implement** |

## Rung 6 — smallest probe

The 30 fps camera over the glass for 300 s, against a page whose only content is
a bar that only ever moves forward, with the panel driven by the host. Counts
backward steps directly; runs 45 s and 300 s gave 25 and 30. The same page
sampled through `Page.captureScreenshot` gave none in 3886 samples, which is
what puts the fault after the capture rather than before it.

## Decision

`writeFrame` reads all three bucket statuses. A refused delete, create, begin,
end or switch throws, and `present` leaves `ready` false, so the next tick
rebuilds the table with `prepare()` before writing again — the same recovery the
driver already uses for a refused begin. A refused command is never carried on
as if the table were still what the last successful frame left it as.

The cost is one lost frame per desync instead of one wrong frame; `prepare()`
switches to liquid mode while it clears the table, which is a visible flash, so
the fix is only correct while refusals are rare — which the 2,316-frame run in
0006 measured them to be.
