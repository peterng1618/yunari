# The display animates without a chart rate setting

- **Date:** 2026-10-27
- **Status:** design, awaiting review
- **Objective:** remove the per-display chart refresh-rate setting and make every chart's own motion visible on the display, while samples still arrive on the host's cadence.

## The problem

The display has a rate choice (1 or 30 fps) that was written when a line's axis
followed a wall clock and had to be repainted every frame. 0124 moved the line
to its data clock, and value charts have been sample-driven since 0117: nothing
on a display needs a repaint between samples for *data* reasons. What remains
is *motion* — an ECharts transition the reader should see — and the rate
setting neither causes nor enables that. Today it only decides how often the
scene wakes (RAF at 30, a timer at 1) and gates engine animation to 30.

Worse, animation is not actually visible even at 30: `_onEngineRendered` marks
the chart dirty but does not request a Fabric render (vg-107), so ECharts paints
frames the scene never blits. A "smooth" display is therefore not a setting
away; it needs the transition's frames blitted for as long as the transition
runs.

The intended behaviour, as the owner stated it:

- bound text and bound images take the host's polling cadence;
- a clock repaints on the granularity its authored format shows — seconds once
  a second, minutes once a minute, a date once a day;
- the line follows the host's sample cadence and does not animate;
- every other chart family animates whenever its value changes;
- the preview source supports every sensor in the semantic dictionary.

## Decisions

1. **One cadence, fixed.** `chart-refresh.ts` exports `startSceneRefresh(refresh)`:
   RAF wake with the existing due-time gate at 30 fps. `setRate`, the 1 fps
   timer branch and the `ChartRefreshRate` type are deleted.
2. **Animation permission is a family rule.** `chartAnimationFor(family)`:
   `false` for `"line"`, `true` for every other family. No rate argument.
3. **A transition-scoped render pump in `YunariChart`.** When `setOption` is
   given an option that permits animation, the chart arms a pending transition.
   While pending, each zrender `rendered` requests one canvas render, at most one
   per 1/30 s. ECharts' `finished` event disarms it; `dispose` unsubscribes.
   This reopens vg-107 in its bounded form: the render is asked for by the object
   whose pixels changed, only while they are changing.
4. **The rate setting goes end to end.** `chartFps` leaves the host's display
   poll, the display record and the patch validation; `onRateChange` leaves the
   player's publish follower; the View menu's 1/30 choice and the
   `chartRefreshRate`/`setChartRefreshRate` facade methods leave the editor.
   Stored `chartFps` values are dropped on read; no migration (pre-release
   internal format).
5. **Clock paint is skip-if-unchanged.** `refreshBoundText` compares the
   resolved string with the object's current text and skips `set`, layout and
   the render request when identical. The 1 Hz host clock sample then paints a
   seconds clock every second, a minutes clock once a minute, a date once a day.
6. **Preview coverage follows the descriptor, not the key suffix.**
   `FakeSampleSource.sampleAt` resolves the descriptor first:
   - `instant` → the ISO instant, as today;
   - `valueKind: "text"` → `textValue` from a small synthetic table, falling
     back to the descriptor's label for a key the table does not name;
   - `valueKind: "boolean"` → `booleanValue`, deterministic per key;
   - numeric → the waveform, with the descriptor's `unit` taking precedence over
     the profile's;
   - `disk.total` and `disk.data.total` join `ram.total`/`vram.total` as
     constants.
   Image keys (`weather.icon`, `media.artwork`, `game.artwork`) emit a text
   placeholder: an image reading must be host-relative, and the editor does not
   hydrate bound images, so nothing consumes it today.

## Scope by owner

| Owner | Change |
|---|---|
| `scene-fabric/chart-refresh.ts` | fixed 30 fps loop; rate and timer branch deleted |
| `scene-fabric/chart-animation.ts` | family-only predicate |
| `scene-fabric/chart-object.ts` | transition pump; no behavioural change to `replace` |
| `scene-fabric/fabric-text.ts` | skip an unchanged resolved text |
| `scene-fabric/index.ts` | drop the `ChartRefreshRate` export and `setRate` surface |
| `host/settings/displays.ts` | drop `chartFps` from record, patch, read and `chartFpsFor` |
| `host/server.ts` | drop `chartFpsForDisplay` and the poll's `chartFps` |
| `player/publish-follower.ts`, `player/main.ts` | drop `onRateChange`, `chartRate`, rate comments |
| `editor/editor-main.ts`, `editor-session.ts`, `session-facade.ts`, `shell-menu-bar.tsx` | drop the rate control and plumbing; loop fixed at 30 |
| `editor/ui-copy.ts` | drop the refresh-rate menu strings |
| `fake-source/index.ts` | descriptor-driven sample kinds, units, totals |
| `editor/live-runtime.ts` | comments that name "the author's chart rate" |

## Behaviour after the change

- A value chart receiving a sample starts an ECharts update transition
  (`animationDurationUpdate`, authored, default 1000 ms) and the scene blits its
  frames until `finished`.
- At a 1 Hz host the transition fills the interval; at 30 Hz each sample restarts
  it, which is the continuously-animating case (ECharts' repeated-`setOption`
  fix is in 5.4.2; we run 6.x).
- A line chart repaints when a sample arrives, static between samples, with no
  engine transition — its data-clock jump is the one motion on the chart.
- Anime-free charts (a chart with animation disabled in its settings) never arm
  the pump.
- Bound text/images repaint on the revision move, as today; a clock's text now
  repaints only when its rendered string changes.

## Risks and accepted costs

- **Worst case rendering cost:** a 30 Hz host plus animated charts keeps the pump
  armed, so the scene renders at up to 30 fps continuously. That is the price of
  visible motion; the fixed cap bounds it.
- **Whole-scene blits:** Fabric has no per-object render, so a transition
  redraws the document. Bounded to transition windows and to 30 fps.
- **The 30 fps cap is the display rate:** a 120 Hz panel does not get 120 Hz
  motion. Chosen deliberately over RAF.
- **A stopped host freezes the clock**, because the clock reading is a host
  sample (§116). This matches "never fabricate a reading".

## Verification

- Unit: `chart-animation` returns false only for line; the refresh loop's cadence
  test moves to a fixed 30; `setRate` no longer exists.
- DOM: an animated `setOption` causes at least one canvas render between
  `setOption` and `finished`, and none after `finished`; an `animate: false`
  option causes none. Red first: today no render is requested.
- DOM: `refreshBoundText` with an unchanged resolved string does not set text or
  request a render; a changed string does.
- Unit: the dictionary invariant — every `SEMANTIC_KEYS` entry yields an `ok`
  sample carrying the field its descriptor declares (text/boolean/instant/number)
  and numeric samples carry the descriptor's unit; totals stay constant across
  time.
- Host: the poll payload has no `chartFps`; a record written with one reads back
  without it; a patch naming it changes nothing else.
- Editor: the View menu no longer offers a refresh rate; the source toggle still
  works; preview still ticks a clock.
- Focused suites plus `npm run gate` at the merge boundary.

## Out of scope

- Line animation, or retuning `animationDurationUpdate` per host cadence.
- Hydrating bound images in the editor preview.
- Any host UI for a per-display rate (none exists today).
- Removing the `animate` parameter from the builders: capture paths and tests
  still need a static option.
