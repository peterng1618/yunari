# 0078 — one shared Chromium runtime for USB panels

- **Date:** 2026-11-01
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/panel-raster-browser.ts`
  `src/web/packages/host/src/panels/panel-raster.ts`
  `src/web/packages/host/src/panels/panel-manager.ts`

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
