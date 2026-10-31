# 0023 — The clip feed waits for decoder room before every block

- **Date:** 2026-10-31
- **Status:** accepted
- **Supersedes:** none. Amends 0022's flow-control paragraph.
- **Paths:** `src/web/packages/host/src/panels/tur-usb-panel.ts`

## Problem

The Lian Li 9.2" plays its own H.264 clip with ghost trails, double exposure
and multi-second freezes, while L-Connect plays the same source smoothly and the
TURZX panel (an MP4 upload, not this feed) is clean. The host sends the clip; it
does not render it, so the defect is in how the stream is paced onto the wire.

Measured on the attached panel with `YUNARI_PANEL_TRACE=1`: an 8.00 s clip
encodes to ≈3.24 MB, i.e. ≈405 kB/s of stream. The feed wrote 198 KiB blocks
≈50 ms apart — ≈4 MB/s, about **ten times realtime** — and the decoder's
reported buffer level climbed 4→9. The existing guard read the level *after*
the block was already on the wire and then drained for seconds, which is
exactly the frozen picture and the jump that follows it.

## Rung 1 — internal owner

`tur-usb-panel.ts` owns the feed (`startVideo`, `feedVideo`,
`writeVideoBlock`) and the panel's only flow-control signal
(`buffer-level`, opcode 122). No runner samples this panel while a clip plays.

## Rung 2 — installed dependencies

`usb` gives a bulk transfer and nothing else: no queue-depth call, no
backpressure, no notion of a decoder. The vendor addon serialises its writes
the same way and reads the level itself.

## Rung 3 — native platform

No OS or Node API can see a USB device's internal ring. The device's own reply
is the only source of truth.

## Rung 4 — public solutions

The vendor sequence (0016) writes a block, pauses 30 ms and polls the level,
stopping at 2. That pause is a wire-speed guard (6.6 MB/s), not a picture-rate
guard; the vendor's own clips are produced by a realtime encoder, so its writes
were already paced by the encoder. `liquidctl` does not speak this protocol and
no public driver documents the level.

The contemporary Rust replacement (`sgtaziz/lian-li-linux`, PR #161 and commit
`ee62feb`) records what the device does under a real stream: the panel **NAKs
bulk OUT for more than 200 ms while it drains its H.264 buffer**, and when the
host's transfer timeout is short the URB is cancelled mid-packet — "`write_full`
resumes from that offset". The vendor's own WinUSB pipe timeout is unbounded;
that driver raised its LCD write timeout to 5 s and logs any stall over 100 ms.
This host's 2 s timeout produced exactly that cancel: the trace showed
`write FAILED bytes=203264 Cancelled`, and the whole block was then written
again — into a decoder that already held part of it.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep the post-write check | Current code | A block already overran before it is seen; the drain that follows is a visible freeze | Reject |
| Pace to the clip's own bitrate | Deterministic | Needs the duration from the encoder and a fixed lead; drifts if the decoder is slower than its clip | Reject |
| **Poll the level before every block and wait for room** | **Uses the device's own backpressure; self-adapting** | The reply can be one of several queued acks, so it must be read fresh | **Adopt** |
| Let a write wait instead of cancelling | Matches the vendor and the Rust driver | Needs a timeout long enough to outlast a drain | **Adopt** |
| Rewrite a cancelled block | Current code | A partial block is already in the decoder; rewriting duplicates bytes and breaks the reference chain | Reject |
| **Restart the clip after a cancelled block** | **A keyframe resets the decoder** | Costs a visible restart on a real stall | **Adopt** |

## Rung 6 — smallest probe

The trace above is the probe: block write duration, gap, and level. It showed
the level rising under a feed ten times faster than the stream, and the gaps
sitting in `drain()` rather than in the writes. A second trace showed the feed's
only actual failure: a `Cancelled` block write, after which nothing was written
again and the overlay's updates blocked behind the same lock — the frozen ghost.

## Decision

`writeVideoBlock` asks `awaitRoom()` **before** writing: it reads
`buffer-level` until the panel reports a depth at or below 2. **A poll that
times out is not room** — a saturated panel stops answering, and treating no
reply as empty is the burst that fills the ring; only a reported low depth lets
a block through, and the 30 s deadline is the single fail-open case. The level
is read with `lastReply()`, which empties the IN queue and keeps the newest
answer — the oldest queued ack can describe a ring two blocks ago — on a 250 ms
read so every poll is one cheap attempt. The fixed 30 ms pause stays as a floor.

Every outbound transfer gets `WRITE_TIMEOUT_MS` (5 s) and a clip block gets
`BLOCK_WRITE_TIMEOUT_MS` (30 s): the panel is allowed to stall while it drains
rather than have the block cancelled under it. A cancelled block is what wedges
this device — measured — so a block write is made effectively as patient as the
vendor's unbounded pipe timeout. If a write fails anyway, it is not retried;
the feed logs it, clears the halt, sends `stop-play` and restarts from the
clip's first block, so the decoder resumes on a keyframe instead of on a stream
with duplicate bytes in it. The post-write drain is gone.
