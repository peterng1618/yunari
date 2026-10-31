# 0029 — No frame-rate command before the blocks, and each block waits its own playing time

- **Date:** 2026-10-31
- **Status:** accepted
- **Supersedes:** 0027's pacing is reinstated and corrected here (0028 rejected
  it for the stall; the stall was the read timeout, not the pacing). Amends 0025
  (its feed is right except for command 15) and 0028 (its feed is right except
  for the pacing).
- **Paths:** `src/web/packages/host/src/panels/tur-usb-panel.ts`,
  `src/web/packages/host/src/panels/tur-usb-video.ts`

## Problem

With 0028's 100 ms reads the picture no longer stalls, but every clip except
the owner's car clip leaves a mangled colour ghost behind moving parts — the
same artifact the vendor's own uploaded stream showed when fed this loop. Two
candidate causes remained: the `frame-rate` (15) command the driver sent just
before the blocks, and the loop's write rate.

## Rung 1 — internal owner

`tur-usb-panel.ts` owns the feed: `startVideo` (the pre-playback commands),
`feedVideo` (the block cadence), `writeVideoBlock` (pause, ack, drain).
`tur-usb-video.ts` is the only place ffmpeg's report of the input is read, and
in 0027 it already returned the clip's duration before that was removed.

## Rung 2 — installed dependencies

`usb` gives one bulk transfer and one timeout per IN; `ffmpeg-static` prints the
input's `Duration:` before encoding. Neither paces the wire.

## Rung 3 — native platform

Nothing above the driver sees the decoder. The webcam filming the glass and the
panel's own depth reply are the instruments.

## Rung 4 — public solutions

The decompiled vendor (`lianli.slv3.dll` 1.5.0.146): `ThemeController.PlayH264`
sends `SetFrameRate` before the loop, and the loop itself is write, sleep 30 ms,
non-blocking read, drain above depth 3 — no other pacing. Its `SetFrameRate`
ignores its argument and sends `120`, not the clip's rate. L-Connect's own
outputs (`C:\ProgramData\Lian-Li\L-Connect 3\uploaded\vm-9.2-inch\landscape`)
are all 464×1920 at 24 fps from 1920×464 intermediates, so the vendor's loop is
fed a stream at L-Connect's own bitrate. `deyloop/lianli_207_lcd` and
`andyjusa/hydroshift2-rs` both stream from a live encode and report the panel
NAKing writes while it drains; neither paces to the clip.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Vendor loop verbatim, 15 before blocks | The vendor's own sequence | Ghosts on every clip slower than ~11 Mbps | Reject |
| Keep 15, add pacing | | The 15 alone ghosts; pacing does not repair it | Reject |
| Drop 15, keep the unpaced loop | Small diff | Ghosts from ~1.1× on slow clips | Reject |
| **Drop 15, pace each block to its own share of the clip** | **Clean at 1.0× on every clip measured** | Needs ffmpeg's `Duration:` line; a stream without one falls back to the 30 ms floor | **Adopt** |

## Rung 6 — smallest probe

Attached 9.2", filmed at 30 fps, same Wind-Mills clip, judged on the glass:

| Feed | Result |
|---|---|
| Vendor loop with 15 before the blocks | ghost trails |
| Same loop, 15 omitted | ghost trails |
| 15 omitted, paced to 1.0× | clean |
| 15 omitted, 1.11× and 1.22× | ghost trails |
| 15 omitted, 1.4× | heavy trails |
| 12 Mbps re-encode, unpaced | ghost trails (bitrate alone is not the cause) |

The car clip explains itself: 11.5 MB over 8.13 s makes one 202,752-byte block
about 0.14 s of video, so the vendor's loop runs at ≈1× by accident. The other
theme clips are 2–4 MB over 8–29 s and arrive 3–4×.

The shipped path then played Wind-Mills for the owner: 91 blocks at gaps p50
696 ms (max 767), no drain, overlay pushes mean 63 ms (p50 57, max 130) — and
the glass was called clean and smooth with the overlay pushes on.

## Decision

`startVideo` sends no command 15; the stream's own timing is what the panel
uses. `encodePanelH264` reports the clip's duration again (`PanelClip.seconds`,
from the `Duration:` line) and `feedVideo` waits `(blockBytes / clipBytes) *
clipMs`, floored at 30 ms and measured from before the block write, **outside
the endpoint lock**. The 100 ms reads of 0028 and the depth gate of 0023 stay:
with this pacing the gate never fires.
