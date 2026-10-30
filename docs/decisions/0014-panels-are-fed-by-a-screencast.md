# 0014 — A panel is fed by a screencast, not one screenshot per frame

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/panel-raster.ts`

## Problem

A video theme on the Kraken Z73 is choppy and once every few seconds shows a
frame the glass already had, while the same theme in NZXT CAM's own web
integration is smooth. The panel page itself is fine: it presents 30 fps and its
layer ordering is correct. What the host does with it is not.

Today each frame is a `Page.captureScreenshot` round trip. That round trip is
request/response, so the frame the host sends is whatever the renderer had
committed when the request landed, and the next request cannot start until the
reply arrives. Measured on the panel page:

| Path | Frames/s | Gap median | Gap p90 | Gap max |
|---|---|---|---|---|
| `Page.captureScreenshot`, 70 ms cadence | 9.1 | 110 ms | 195 ms | 504 ms |
| `Page.startScreencast`, `everyNthFrame: 1` | 30.7 | 30 ms | 47 ms | 78 ms |

Slow, uneven sampling of a constant-rate source is what judder is: motion that
should advance 2.7 source frames per panel frame advances 1 to 5 depending on
where the capture landed. A stale surface also re-sends content the glass
already had, which is the pull back.

## Rung 1 — internal owner

`panel-raster.ts` owns the browser and every capture; `panel-runner.ts` owns
cadence; `panel-manager.ts` only passes the device's interval. The change is
confined to the rasteriser: the runner still asks for a frame on its own tick.

## Rung 2 — installed dependencies

The rasteriser already speaks devtools-protocol over Node's own `WebSocket`,
with request/reply only. Screencast is the one protocol feature it lacked:
`Page.screencastFrame` events plus `Page.screencastFrameAck`. No dependency is
added.

## Rung 3 — native platform

Chromium's compositor is the owner of "the latest frame". `Page.startScreencast`
hands the host every commit in order and drops frames when the ack is late,
which is exactly the back-pressure a panel wants; `captureScreenshot` re-reads a
surface on demand and cannot promise freshness.

## Rung 4 — public solutions

- **Puppeteer's `page.screencast()` API** (2024) exists because screenshot loops
  are the wrong shape for continuous output; it acks per frame and exposes the
  newest.
- **Chrome DevTools "Screencast" panel** and **`chrome-remote-interface`
  examples** consume the same two commands.
- **NZXT CAM's own web-integration sender** does not screenshot a page at all;
  it pushes RGBA frames about nine times a second. Its smoothness is a
  consequence of sampling a live source, not of a faster wire.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| `Page.captureScreenshot` per tick (today) | Simple | 110 ms round trip, uneven gaps, stale commits | Reject |
| **Screencast, host keeps the newest frame** | In-order, 30 fps, bounded gaps | Ack loop, one frame slot, overlay-mode toggles must settle a frame | **Implement** |
| Capture at the panel's cadence by polling a `<canvas>` in the page | One round trip per frame | The page would have to render the video into a canvas itself, duplicating the compositor | Reject |
| Device-side video playback | No host frames at all | The Z73 paints no video of its own (0006) | Reject |

## Rung 6 — smallest probe

`screencast.mjs` against the live TURZX panel page: `Page.startScreencast` with
`everyNthFrame: 1`, acking every event, for 10 s — 308 frames, 30.7 fps, median
gap 30 ms, p90 47 ms, max 78 ms, median PNG 153 KB. The same page under
`Page.captureScreenshot` on a 70 ms timer measured 9.1 fps with a 195 ms p90.

## Decision

The rasteriser starts a screencast after the page mounts and keeps the newest
frame in one slot. `capture()` returns the newest frame the renderer has not
already handed over, waiting at most one screencast timeout; `captureOverlay()`
toggles overlay mode first and then waits for a frame produced after the toggle,
so the alpha layer reflects the mode rather than the frame before it. The
screenshot path, its clip and its background-override dance are deleted: two
capture mechanisms would drift.
