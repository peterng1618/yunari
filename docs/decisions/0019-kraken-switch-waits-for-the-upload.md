# 0019 — The Kraken waits for an upload to settle before switching to it

- **Date:** 2026-10-31
- **Status:** accepted
- **Supersedes:** none. Extends 0013, whose decision (carry on after a refused
  command rather than rebuild the table) still holds.
- **Paths:** `src/web/packages/host/src/panels/kraken-z3-panel.ts`

## Problem

The glass replays a frame it already showed — the *pull back* 0013 measured at
about one per 10 s — and, with a smooth-gradient theme, shows bands of the
previous picture inside the new one. Neither is a capture fault: the page, the
screencast, the PNG and the encode are ordered. This note is about the last step
of the hand-off, which 0013 did not vary.

## Rung 1 — internal owner

`kraken-z3-panel.ts` owns the bucket hand-off: `writeFrame` deletes and recreates
a bucket, sends the header and payload, ends the transfer and switches the glass
to it. No other module speaks this protocol.

## Rung 2 — installed dependencies

`node-hid` and `usb` report the wire, not the firmware's state. Neither says when
the device has finished writing the payload into the bucket.

## Rung 3 — native platform

Nothing on the OS side observes the panel's framebuffer. The webcam is the only
instrument, as in 0013.

## Rung 4 — public solutions

liquidctl and AIOLCDUnchained both end the transfer before switching, and neither
inserts a wait: the ordering they rely on is the same one this driver uses.
CAM's captured stream (0018) shows the same sequence with no visibility into its
timing gaps. No public source states whether the switch may race the write.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Switch immediately after `36 02` | Zero cost | Measured 9–11 pull-backs per 45 s | Reject |
| Gate every command on its status | Reads the firmware | 0013 tried it: it costs frames and a table rebuild, and the pull-back was still 9–11 per 45 s | Reject |
| Two deletes per frame (CAM's own sequence) | Matches CAM | 6 per 45 s — no better than one | Reject |
| No delete or create after the ring is built | Fewer commands | The firmware keeps a bucket's first graphic, so 8 per 45 s and no new picture | Reject |
| **Wait for the upload to settle, then switch** | **One constant** | **A fixed wait is a guess about the device's own timing** | **Adopt** |

## Rung 6 — probe

One uniform colour per frame, cycling red, green, blue, yellow, cyan, magenta at
70 ms into a three-bucket ring, filmed at 30 fps. The camera's six colours are
learned from the capture (its white balance is not the panel's), torn samples are
dropped, and a pull-back is a return to the colour shown two frames earlier.
Every command reported success throughout, so the refusals 0013 blamed never
occurred here.

| Variant | Runs | Pull-backs per 45 s |
|---|---|---|
| Switch straight after `36 02` | 3 | 9, 10, 11 |
| Two deletes per frame | 1 | 6 |
| Status of every command checked | 1 | 9 |
| No delete/create after the ring is built | 1 | 8 |
| **10 ms between `36 02` and `38 01`** | 3 | **1, 1, 0** |

## Decision

`writeFrame` waits `UPLOAD_SETTLE_MS` after the end of the transfer before
switching the glass to the bucket. Ten milliseconds is above the device's own
write cost (an end-transfer answers in 3 ms) and below the frame's remaining
budget at the 70 ms cadence. The other four variants are refuted above, and none
of them touches the table on the frame path, so 0013's ruling stands.
