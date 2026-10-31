# 0028 — The clip feed reads on the vendor's own 100 ms timeout

- **Date:** 2026-10-31
- **Status:** accepted
- **Supersedes:** 0027. Amends 0025 (its feed is right except for the ack
  read's timeout) and 0023 (the depth gate stays; the pre-write read does not).
- **Paths:** `src/web/packages/host/src/panels/tur-usb-panel.ts`

## Problem

The picture still stalls for about a second after every few seconds, even
with the clip paced to its own playing time (0027). Both the vendor's packet
sequence and this host's feed looked right, so the remaining difference had to
be in a constant rather than in the loop's shape.

## Rung 1 — internal owner

`tur-usb-panel.ts` owns every endpoint read: `read`, `readOne`, `flushReplies`,
`level`, and the block ack in `writeVideoBlock`. Before this change the block
ack and the drain's level read used `LEVEL_READ_TIMEOUT_MS` (250 ms) and the
reply flush used `READ_TIMEOUT_MS` (2,000 ms).

## Rung 2 — installed dependencies

The `usb` transfer gives one timeout per IN transfer; an IN that times out is a
cancelled URB, not an error. Nothing in the library chooses that number.

## Rung 3 — native platform

No OS timer is involved. The wait is the USB transfer's own timeout, so the
only way to see it is to timestamp the feed.

## Rung 4 — public solutions

Decompiled from the shipped app (`ilspycmd` over
`C:\Program Files\Lian-Li\L-Connect 3\lianli.slv3.dll`, 1.5.0.146):
`slv3.WinUsb.TLV3Read` calls `reader.Read(result, 100, /* cancel */ ...)`. Every
vendor read — the block ack and the `waitBuffer` level poll — waits 100 ms at
most. The vendor's loop is therefore write, `Delay(30)`, read (≤100 ms), and a
drain only above depth 3; nothing else paces it.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep the 2 s command timeout for block acks | Already in place | A reply that arrives with nothing to say costs 2 s: the ring empties for 2 s | Reject |
| Keep 250 ms | Shorter | Still longer than the vendor's; two such reads per second starve the ring | Reject |
| **Use the vendor's 100 ms for acks, level and flush** | **The vendor's own number** | More cancelled IN URBs when the panel is silent — the same rate L-Connect has run with for years | **Adopt** |
| Restore 0027's realtime pacing | Realtime by construction | Not the vendor's loop, and it did not remove the stall | Reject |

## Rung 6 — smallest probe

The attached 9.2" played the owner's car clip directly. Instrumented: the old
flush read blocked 2,003 ms after a drain (a two-second hole in the feed);
overlay pushes alternated 100 ms and 1,300 ms. With 100 ms reads the block
gaps were uniform (~200 ms), a short drain of ~170 ms fired every ~200–300 ms,
and overlay pushes took mean 159 ms (p50 159, max 265). Filmed at 30 fps, the
glass's per-second frame difference stayed at 0.6–0.8 for the whole clip; the
old unpaced feed alternated 0.35 and 0.5–0.8 — a still picture with nudges.

## Decision

Every feed read uses the vendor's 100 ms (`VENDOR_READ_TIMEOUT_MS`): the block
ack, the buffer-level poll and the reply flush. The block cadence is the
vendor's — 30 ms pause, then the ack, then a drain to 2 only above depth 3 —
with no other pacing. Command replies that are not part of the feed keep the
2 s timeout, because a cancelled write is what wedges the panel and command
writes are not on the feed's clock.
