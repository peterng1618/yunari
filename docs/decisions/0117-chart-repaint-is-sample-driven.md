# 0117 — Chart repaint is sample-driven, not frame-driven

- **Date:** 2026-10-25
- **Status:** accepted 2026-10-25
- **Paths:** `src/web/packages/scene-fabric/src/chart-object.ts`,
  `src/web/packages/scene-fabric/src/chart-refresh.ts`,
  `src/web/packages/scene-fabric/src/scene.ts`,
  `src/web/packages/scene-fabric/src/background-media.ts`,
  `src/web/packages/renderer-core/src/charts/line.ts`

## The problem

The player refreshed every bound object at 30 Hz, whether or not the source had
a new sample. Gauge, bar and pie options were identical on 29 of every 30
frames, but each `setOption` still cloned the model and repainted. The chart
loop re-armed RAF before checking its cadence, so a display authored at 1 fps
still woke at 60 Hz. A hidden phone kept streaming, ingesting and decoding video.
A `pagehide` listener disposed the scene permanently, so a bfcache restore showed
a dead page.

The non-obvious shape is not "skip a repaint". It is deciding what may be stale:
a line chart's visible window is a function of the presentation clock, while a
gauge's value is a function of the newest sample. Treating both the same either
freezes the line or burns the CPU on the gauge.

## Rung 1 — Yunari

Searched: `scene-fabric/src/chart-refresh.ts`, `chart-object.ts`, `scene.ts`,
`background-media.ts`; `renderer-core/src/charts/`; `player/src/main.ts`'s
`refresh`, `hydrateCharts`, `refreshBoundText`, `refreshBoundImages`,
`showAvailabilityNotice`; `renderer-core/src/data/store.ts`'s `history`.

Found:
- `chart-refresh.ts` arms `frames.requestFrame(tick)` before the cadence check.
- `chart-object.ts` calls `setOption(..., { notMerge: true, lazyUpdate: false })`.
- `main.ts` rebuilds charts, images, text and the availability notice on every
  refresh and then calls `requestRenderAll` unconditionally.
- `store.ts` parses every sample's timestamp string on every history query;
  `charts/line.ts` rebuilds its points on every refresh.
- `background-media.ts` has a video frame callback with no consumer count.
- `scene.ts` refits on every resize event without comparing pixel sizes.

## Rung 2 — dependencies

Searched: `scene-fabric/package.json`, `renderer-core/package.json`, the
workspace lockfile.

Found: Fabric 7.4.0 and ECharts 6 are already the renderers. Fabric exposes
`requestRenderAll`; ECharts exposes `setOption` options. No change-detection
library, scheduler or virtual-DOM layer is installed, and none is needed.

## Rung 3 — platform

Searched: `requestAnimationFrame`, `setTimeout`, `document.visibilityState`,
`visibilitychange`, `pageshow`/`persisted`, `createImageBitmap`,
`OffscreenCanvas`, `HTMLVideoElement.requestVideoFrameCallback`.

Found:
- RAF is the right clock only when the presentation rate needs every frame. A
  1 fps presentation wants one wake at the due time; `setTimeout` gives that
  without a 60 Hz callback that immediately returns.
- `visibilitychange` is the only reliable hidden-page signal; a hidden page may
  throttle timers and RAF, and video decoding continues without it.
- `pageshow` with `event.persisted` fires on bfcache restore; `pagehide` cannot
  distinguish a restore from a real unload.
- `createImageBitmap(blob, { resizeWidth, resizeHeight })` decodes and scales
  off the paint path; `OffscreenCanvas` keeps the downscale off the main thread.

## Rung 4 — ecosystem

Searched: Apache ECharts `setOption` API and options docs; ECharts issue #17656
("setOption takes most of the execution time in clone"); ECharts issue #15154
(fast `setOption` succession); the ECharts animation-transition handbook;
`replaceMerge` guidance; common chart-streaming examples.

Found:
- ECharts documents `notMerge: true` as removing all previous components, and
  `replaceMerge: ["series"]` as replacing series while keeping axes and other
  components. `lazyUpdate` defers to the next frame but does not stop the clone.
- Issue #17656 measured 107.93 ms per `setOption` on a large series set, with
  about 54.26 ms in `clone`; supplying the whole history is the documented
  dynamic-data pattern and still pays that cost.
- Issue #15154 records a merge glitch when `setOption` is called again before
  the previous animation finishes; the maintainers fixed it in 5.4.2. Our
  updates are 30 Hz with animations off, which is the high-risk shape.
- The community pattern is to update `series.data` and keep the instance, not
  to rebuild the chart. Nobody ships a "repaint only when the sample changed"
  helper for Fabric-bound ECharts objects; that decision belongs to this app.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Keep 30 Hz full refresh | No new state | Highest CPU; identical options 29/30 frames | Phone battery and thermals | Rejected |
| `notMerge: true` for every update | Simple | Destroys and recreates components; loses component state | Visible flicker and cost | Rejected |
| `notMerge: false` + `replaceMerge: ["series"]` | Keeps the instance and axes; replaces series data | Needs stable/deterministic series shape | A removed series must be absent, not merely empty | Chosen |
| Update `series.data` only, no option merge | Cheapest | Other option fields (axis range, title) go stale | Wrong rendered labels after a settings edit | Rejected |
| One RAF loop for every rate | Simple | 60 Hz wake at 1 fps | Wasted battery, the audit's P2 | Rejected |
| RAF at ≥30 fps, timer at <30 fps | Matches the presentation | Two scheduling paths | A rate change must cancel and recompute | Chosen |
| Sample revision gate for all chart families | One rule | A line chart would freeze between samples | Wrong for a sliding window | Rejected |
| Revision gate for non-line, per-frame line | Matches each family's clock | Two paths in one refresh | Must keep the notice and text gated too | Chosen |
| Rebuild line points every frame | Simple | Parses and allocates at 30 Hz | Wasted work between samples | Rejected |
| Cache points per revision and settings | Reuses between samples | Cache invalidation on settings change | A stale cache renders the wrong window | Chosen |

## Rung 6 — probe

Source reading on 2026-10-25 confirmed the RAF-before-cadence order in
`chart-refresh.ts` and the unconditional `requestRenderAll` in `player/src/main.ts`.
The audit measured the shape, not a device profile: 30 fps means 30 full
rebuilds per second per chart, and a 1 fps display still receives up to 60 RAF
callbacks per second. Task 3.3's fake-clock test pins the callback count; Task
3.2's spy test pins 1 gauge update against 30 line updates; Task 3.4's DOM test
pins the hidden/restored transitions. The browser capture in Task 3.2 is the
visible check that merging did not change the rendered chart.

## Rung 7 — build

No new dependency. The revision is a number on the existing sample store; the
timer is `setTimeout`; the point cache is a module-local map keyed by revision
and settings. Fabric still renders imperatively; no Fabric object enters React.
The player's existing bundle is the only artifact affected.

## Decision

- `SampleSource` and `SampleStore` expose a monotonic `revision`.
- Gauge, bar, pie, bound text, images and the availability notice refresh only
  when the revision moved; line charts still refresh per frame but reuse points
  when it did not.
- `requestRenderAll` runs only when something changed.
- `startChartRefresh` wakes at the due time: RAF at 30 fps and above, a timer
  below it, with re-arm after the due check.
- Hidden pages stop the loop and pause video; `pageshow` with `persisted`
  reloads; resize compares pixel size.
- ECharts updates merge with `replaceMerge: ["series"]` instead of tearing the
  model down.

The split is the decision: a line's window is clock-driven, a gauge's value is
sample-driven, and one gate for both is wrong either way.
