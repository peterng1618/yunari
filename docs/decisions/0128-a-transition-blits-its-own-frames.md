# 0128 — A transition blits its own frames

- **Date:** 2026-10-27
- **Status:** accepted 2026-10-27
- **Paths:** `src/web/packages/scene-fabric/src/chart-object.ts`,
  `src/web/packages/host/src/server.ts`

## The problem

Value charts have been sample-driven since 0117 and the line is on its data
clock since 0124, so nothing on a display needs a repaint between samples for
*data* reasons. What is missing is *motion*: an ECharts update transition runs,
but no one shows its frames. vg-107 made `_onEngineRendered` mark the chart
dirty without asking Fabric to render, so every transition frame is painted into
the detached ECharts canvas and never blitted. The per-display rate setting
(1 or 30 fps) does not cause or fix this; it only decides how often the scene
wakes and gates animation to 30.

The question is how to show a transition without reopening vg-107 as a
permanent render loop, and how a chart knows the transition is over.

## Rung 1 — Yunari

Searched: `scene-fabric/src/chart-object.ts` (`_mount`, `_onEngineRendered`,
`setOption`, `dispose`), `scene-fabric/src/chart-refresh.ts`,
`scene-fabric/src/chart-animation.ts`, `editor/src/live-runtime.ts`, decisions
0116, 0117, 0124 and the vg-107 register row.

Found:
- `setOption` already asks the canvas to render once, synchronously after the
  engine call; that is the frame vg-107 permits.
- `_onEngineRendered` runs on every zrender frame and only sets `dirty`.
- `refreshBoundText` requests a render for the text pass, so text repaints are
  already covered; the gap is the frames *between* two readings.
- The scene loop is a RAF with a due-time gate; it decides when `setOption` is
  applied, not when transition frames reach the canvas.

## Rung 2 — dependencies

Searched: installed `echarts` 6.x `lib/core/echarts.js` (`bindRenderedEvent`
around line 1615) and `lib/animation/*`.

Found: `finished` is triggered from zrender's `rendered` handler exactly when
`zr.animation.isFinished()` and no pending update, scheduler work or action is
queued (`echarts.js:1626`). That is precisely "the transition is over". No
public hook reports progress of an update transition frame by frame, so the
per-frame signal has to be zrender's own `rendered`.

## Rung 3 — platform

Searched: Fabric 7 `StaticCanvas.requestRenderAll`, RAF, `performance.now`.

Found: Fabric renders the whole scene on request and has no per-object render
entry point, so a blit is a document render. RAF is the only frame clock.

## Rung 4 — ecosystem

Searched: ECharts docs/examples for `rendered`/`finished` event use, and
Fabric + ECharts integration patterns (detached canvas as an image source).

Found: ECharts' documented use of `rendered` is realtime snapshotting and media
recording; `finished` is the documented end signal. The integration pattern
(ECharts in a hidden canvas blitted by another renderer) is common, and none of
the examples solves the transition-scoped repaint for the host renderer — each
host either renders continuously or records frames itself.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Permanent render loop while a chart exists | Simplest | Renders identical frames continuously | Reopens vg-107 in the exact form it was closed; battery and heat | Rejected |
| Keep vg-107 — render only on `setOption` | No change | Transitions stay invisible | The reader sees a freeze then a jump | Rejected |
| Transition-scoped pump: arm before `setOption`, blit `rendered` at most 30/s, disarm on `finished`, one final blit | The object whose pixels changed asks for the render, only while they change | Whole-scene renders for the transition window | A host at 30 Hz restarts the transition each sample, so the pump stays armed; bounded by the 30 fps cap | Chosen |
| Raise the scene loop rate and blit every RAF frame unconditionally | Fewer moving parts | Never idle | 120 Hz panels burn 120 renders/s for a 1 Hz reading | Rejected |

## Rung 6 — probe

DOM-level: `chart-object.dom.test.ts` spies `StaticCanvas.requestRenderAll` and
drives `_onEngineRendered`/`_onEngineFinished` directly. Planned assertions: an
animated `setOption` blits during the transition; a second frame within 1/30 s
does not; an `animate: false` option never arms; after `finished` a `rendered`
event does not blit, while `finished` itself blits the final frame once.

The final-frame blit is not cosmetic: `finished` fires from the same zrender
`rendered` dispatch *before* the chart's own listener runs (ECharts binds its
handler at init, the chart binds later), so without it the last painted frame
would never reach Fabric and the chart would rest one frame short of its value.

## Rung 7 — build

No new dependency; the pump lives in `YunariChart` beside the existing engine
listeners.

## Decision

`YunariChart` arms a pending transition immediately before `setOption`, blits
one canvas render per `rendered` while armed at most once per 1/30 s, disarms on
`finished` and blits once more on `finished` for the final frame. `dispose`
unsubscribes. The render is still requested by the object whose pixels changed,
bounded to a transition — vg-107 in its bounded form.

The scene loop consequently becomes a single fixed 30 fps wake (no rate), and
animation permission becomes a family rule (`startSceneRefresh`,
`chartAnimationFor(family)`), because the transition's own `finished` event now
decides when rendering stops.
