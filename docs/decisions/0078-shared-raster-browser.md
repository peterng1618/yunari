# 0078 — one shared Chromium runtime for USB panels

- **Date:** 2026-11-01
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/panel-raster-browser.ts`
  `src/web/packages/host/src/panels/panel-raster.ts`
  `src/web/packages/host/src/panels/panel-manager.ts`
  `src/web/packages/host/src/panels/panel-manager.fixtures.ts`

## Problem

Every panel currently starts its own full Chromium with its own profile. At
three panels that is three browsers and three GPU processes; the measured tree
spends 982.6 MB of 1,748.3 MB on browser + GPU. The cost sits in the browser
runtime, not in Node or in the per-panel renderers. A wrong integration here
fails quietly: a target created as a tab never composites, so captures stall
without an error.

## Rung 1 — internal owner

Searched: `createRasterizer`, `createPanelManager`, `startScreencast`,
`setOverlayMode`, `PanelRunner`, and the panel tests.

Found: `panel-raster.ts` already owns every per-target CDP operation;
`panel-manager.ts` already owns panel lifecycle and the one-chain-per-display
order. `Rasterizer` and `PanelRunner` need no change. The missing owner is a
browser-level component between the manager and the page rasterizer.

## Rung 2 — installed dependencies

Searched: `node:child_process`, `node:fs/promises`, `node:os`, global
`WebSocket`, and the host's dependency list.

Found: the current rasterizer already uses all of them, including the devtools
protocol over Node's own WebSocket. The new target path needs no HTTP endpoint:
`Target.createTarget` and `Target.closeTarget` are CDP methods on the
browser-level socket. No package donates shared-browser lifecycle, and none is
needed.

## Rung 3 — native platform

Searched: Chrome DevTools Protocol `Page`, `Emulation` and target endpoints;
Chromium headless multi-tab behaviour; Chromium background throttling flags.

Found: one Chromium process hosts many independent targets. A target created
with `Target.createTarget({ newWindow: true })` gets its own headless window and
reports `document.visibilityState: "visible"`; a target created as a tab
(`newWindow: false`, or `/json/new`) is hidden and does not composite.
Per-target `Page.navigate`, `Emulation.setDeviceMetricsOverride`,
`Page.startScreencast`, `Runtime.evaluate` and `Page.captureScreenshot` remain
independent. The three background flags keep timers unthrottled but do not make
a hidden tab visible. The renderer stays per target.

## Rung 4 — public solutions

Searched: Puppeteer `Browser`/`BrowserContext`/`Page`, Playwright
`browser.newContext()`/`browser.newPage()`, Chrome headless multi-tab docs, and
Tauri/WebView2 capture alternatives.

Found: both automation libraries model one browser process with many pages, but
their page APIs create tabs, which the discovery probe shows stay hidden. The
window distinction is a CDP `Target.createTarget` option below those APIs.
WebView2 can host multiple webviews in one environment, but Tauri exposes no
`Page.startScreencast`; `CapturePreview` is a one-shot PNG and is not proven at
the Kraken's 140 ms cadence. It remains a separate future probe.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep one Chromium per panel | Preserves quirks exactly | None; cost grows linearly, measured | Rejected: current cost |
| One Chromium, one target per panel, each a headless window | Preserves every per-target capability; shares browser/GPU; both capture paths hold | Crash blast radius; `newWindow` requirement; idle stop | **Chosen** |
| One page, switch viewport per panel | One renderer | Panels render at different cadences; serialising loses frames | Rejected |
| WebView2 hidden views | Removes external browser | No screencast; cadence unproven; Tauri out of scope | Rejected for this change |
| One browser per panel family | Limits blast radius | Still one browser per panel; little saving | Rejected |

## Rung 6 — smallest probe

The measured process tree establishes where the cost sits. A disposable probe
started one Chromium with the planned flags and three synthetic targets:
480x1920 at 140 ms and 800x480 at 1 s. With tabs, only the last target was
visible and the screencast ran at 0 / 0 / 1.1 fps. With `newWindow: true`, all
three reported visible; the 140 ms screencast held 7.2 fps (median 137 ms) and
the 1 s targets held 1.2 fps. One 140 ms screencast beside two 1 s screenshot
loops held 7.3 fps and 1.00 fps. Both capture paths work when each target is its
own headless window.

## Decision

Reuse the existing per-target rasterizer and replace its per-panel browser with
one shared Chromium runtime. Keep one target per panel, each target a separate
headless window, one profile per browser, and the default browser context. Add
no dependency and no compatibility path. The rejected options either keep the
measured cost, serialise panel rendering, or replace the proved capture stack.

## Runtime flags

The browser starts with `--process-per-site` on top of the switches the panel
browser already had, and an overlay panel pauses its page video. All panel pages
are the same origin, so one renderer serves all of them.

Measured on the three-panel hardware run (medians of three 60 s samples, private
bytes, CPU seconds per 60 s):

| Change | Procs | Private MB | CPU s | Renderers | Browser + GPU MB |
|---|---:|---:|---:|---:|---:|
| Shared browser, no flags | 13 | 1,187.3 | 53.5 | 6 | 620.0 |
| `--process-per-site` | 11 | 1,138.6 | 47.3 | 4 | 603.4 |
| Overlay video pause | 11 | 1,060.2 | 35.9 | 4 | 576.8 |

The shipped set measured 1,150.1 MB, 32.6 s and 568.2 MB browser + GPU across
three trials; the ranges are in the spec.

**Canvas and raster switches are rejected on visual grounds.**
`--disable-features=CanvasOopRasterization`, `--disable-gpu-rasterization`,
`--disable-accelerated-2d-canvas` and `--enable-low-end-device-mode` together
measured 10 processes, 1,028.1 MB, 26.6 s and 515.7 MB browser + GPU — the
cheapest result — but software canvas rasterisation banded the glass material
on the Lian Li and TURZX panels, so they are not shipped. Visual output is a
hard constraint; a cheaper frame that a person can see is a regression.

An overlay panel's page video is paused while the overlay mode is on: the media
layer is hidden and the device plays the clip, so decoding it is frames nobody
reads. Still panels keep their video, because their capture is the page with
its background. Glass is unaffected: a hardware panel page forces static
sampling, which paints no live video frame.

Rejected, each measured as one trial because the cost moved rather than
disappeared: `--disable-gpu` (browser + GPU 120 MB, but 211 s CPU and 2,192 MB
total), `--disable-gpu-compositing` (176 MB, 121 s, 2,193 MB),
`--disable-accelerated-video-decode` (369 MB, 95 s, 2,181 MB),
`--in-process-gpu` (828 MB browser + GPU, 1,353 MB total). Neutral:
`--disable-gpu-memory-buffer-video-frames` (611 MB),
`--force-gpu-mem-available-mb=128` (587 MB), `--disable-features=SkiaGraphite`
(569 vs 552 MB), `--disable-gpu-program-cache` (518 vs 513 MB), and creating
each target at the panel's size (522 vs 513 MB).

The shipped set does not meet the spec's browser + GPU criterion (568.2 MB
against 459.5 MB). The criterion assumed a shared browser keeps a one-panel GPU
footprint; the measured growth is about 78 MB per extra headless window, and
removing it moves the bytes into renderers and CPU. The spec records the miss.
