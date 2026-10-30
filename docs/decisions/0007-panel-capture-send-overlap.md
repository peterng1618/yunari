# 0007 — Overlap the panel capture with its send

- **Date:** 2026-10-30
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/panel-runner.ts`,
  `src/web/packages/host/src/panels/kraken-z3-panel.ts`,
  `src/web/packages/host/src/panels/panel-raster.ts`

## Problem

The Kraken's frame ring can carry 12.9 FPS, but the panel ran at 3.6–4.5 FPS.
The cost was in the runner, not the wire.

## Rung 1 — internal owner

`panel-runner.ts` owns capture cadence and the capture→send sequence for every
panel family; `panel-raster.ts` owns the devtools capture; `kraken-z3-panel.ts`
owns the wire. Nothing else schedules a panel frame.

## Rung 2 — installed dependencies

The devtools client in `panel-raster.ts` is a hand-rolled WebSocket client with
one request in flight per id; it can hold a second request, which is what makes
a prefetch possible without adding a dependency.

## Rung 3 — native platform

No runtime API makes a capture cheaper. Chromium does offer `Page.startScreencast`
(~38 FPS of pushed frames here), but that is a different capture mechanism with
its own ack protocol and its own frame pacing, and it is rung 5 work rather than
this change.

## Rung 4 — measurements on the attached Z73

Instrumented host run, per tick: capture 62–83 ms (`Page.captureScreenshot` of
the 320x320 player, PNG), present 74–76 ms typical (decode, five HID commands,
one 409,600-byte bulk write). Serialised, that is ~145 ms; the 111 ms timer plus
the in-flight skip rounded it to 222 ms, giving 4.5 FPS. Occasional stalls
reached 224 ms and once 2,084 ms, which is `readUntil` missing one reply and
burning its full 12 x 300 ms window.

## Rung 5 — integration comparison

| Option | Fit | Cost | Verdict |
|---|---|---|---|
| Raise the interval only | None | Starts more ticks that are skipped | Reject |
| One-deep capture prefetch | Fits the existing single-request devtools client | +1 frame latency | **Implement** |
| Queue a follow-up tick instead of dropping it | Keeps one capture in flight | None | **Implement** |
| `Page.startScreencast` | No per-frame request | New ack protocol, frame pacing the panel does not control | Not now |
| More buckets / smaller payload | Wire is not the bottleneck | None gained | Reject |

## Rung 6 — smallest probe

The instrumented run above is the probe: it names each stage's milliseconds, and
each stage was exercised by the hardware run that produced 2,316 frames.

## Decision

`panel-runner.ts` starts the next capture as soon as the current frame is in
hand, so the capture of frame N+1 runs while frame N is on the wire. The result
is `max(capture, present)` instead of their sum.

A tick that arrives while one is in flight is remembered rather than dropped:
when the in-flight tick settles, one follow-up tick starts immediately. The
capture is still never concurrent with another capture.

`kraken-z3-panel.ts` asks for a frame every 70 ms and reads control replies with
`MAX_READ_ATTEMPTS = 8` at `READ_TIMEOUT_MS = 120` — the window the three-minute
soak used for 2,316 frames — so a missed reply costs under a second instead of
3.6 s.

**A prefetched capture nobody awaits is caught, not left unhandled**, and
`stop()` waits for it before closing the rasteriser so the devtools socket is
not closed under a request.

## Downside

The picture trails the page by one capture: frame N+1 is captured while N is
sent. On a wall panel nothing reads that latency, and the capture is capped by
the runner's interval anyway.

## Result

The same live theme went from 3.6–4.5 FPS to **10.0 FPS** end to end (490 frames
in 48.8 s, median gap 88 ms, p90 195 ms), measured from `onFrame` timestamps.

Not done, because it bought nothing: dropping the `33 02`/`33 01` reply waits on
delete and create measured 9.3 FPS — inside the noise of 10.0 — while leaving
four stale replies per frame for `readUntil` to skip. The waits stayed.

The remaining floor is the serial send: a 409,600-byte bulk write (~36–50 ms),
the three reply waits (~15 ms) and the in-process PNG decode (~10 ms). Past
10 FPS means pushing frames from `Page.startScreencast` instead of asking for
each one, which is a capture-mechanism change and not this note.

