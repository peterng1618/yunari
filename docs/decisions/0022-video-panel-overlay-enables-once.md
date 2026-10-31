# 0022 — A video panel's overlay is enabled once, and pushes share the feed's endpoint

- **Date:** 2026-10-31
- **Status:** accepted
- **Supersedes:** none. Extends 0016 (the panel decodes its own picture).
- **Paths:** `src/web/packages/host/src/panels/tur-usb-panel.ts`

## Problem

A 1920x464 panel that decodes and plays its own clip shows a stuttering picture
and ghost trails, while its UI layer updates. The clip is not rendered by the
host: `startVideo` sends it once as H.264 blocks and `feedVideo` keeps writing
blocks so the decoder never drains. Anything that interrupts those writes is
the picture stuttering, so the overlay path is the only suspect: it writes to
the same endpoint, under the same `exclusive` lock, once per tick.

## Rung 1 — internal owner

`tur-usb-panel.ts` owns both writers: `writeVideoBlock` (the clip) and
`presentOverlay` (the UI PNG). `panel-runner.ts` owns which of them a tick
asks for, and never asks for a still while the clip plays.

## Rung 2 — installed dependencies

`usb` gives one bulk endpoint and no notion of priority or framing between two
writers; the vendor addon serialises them the same way, one write at a time.

## Rung 3 — native platform

No OS or Node API can make a USB transfer preempt another. Ordering is the
driver's problem.

## Rung 4 — public solutions

The vendor addon (analysed for 0016) enables the PNG layer when it starts
showing a dashboard and pushes PNGs afterwards; the enable is not part of every
push. `liquidctl` does not speak this protocol. No public driver documents
whether a push requires the enable.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Enable the layer before every push | Current code | One extra request on the endpoint per tick, and a re-enable that can blank the layer while the PNG loads | Reject |
| **Enable once, push afterwards** | **Matches the vendor's own sequence; the enable is idempotent** | Needs a flag that is reset when the clip is stopped | **Adopt** |
| Push on a separate lane | No preemption exists | — | Impossible |

## Rung 6 — probe

`YUNARI_PANEL_TRACE=1` names each clip block, its write duration, the decoder's
reported buffer level and each overlay push. It is temporary: it exists to
attribute the stutter to the feed or to the overlay, and is removed once the
numbers are in this note.

## Decision

The layer is enabled when it is first needed (and after a clip stop), and a
push is a PNG write alone. Every push to this panel goes out under the existing
`exclusive` lock, so the clip feed and the UI alternate rather than overlap.
