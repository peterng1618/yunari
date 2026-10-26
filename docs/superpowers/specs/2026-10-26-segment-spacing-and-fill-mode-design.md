# Segment spacing and fill mode — design

> Follows [`2026-10-25-chart-playback-and-segmented-fill-design.md`](2026-10-25-chart-playback-and-segmented-fill-design.md)
> (Design B). That design's `SEGMENT_GAP_RATIO = 0.2` is a share of each
> **slot**, and this design replaces it for the gauge and the bar.

## The two defects this design fixes

1. **The gap does not survive a resize or a smaller slot.** Every gap is 20% of
   its own band, so its angular size shrinks as the segment count rises and its
   pixel size shrinks with the chart. A gauge band's rounded ends are drawn by
   ECharts `roundCap`, whose caps extend `thickness / 2` **pixels** past each
   band end — a length that does not scale with the chart at all. When the gap
   falls below `thickness` pixels the two caps meet and the ring reads as one
   continuous arc. That is why the starter RAM gauge looks right at divisor
   `20` (five bands) and why a divisor below `20`, or a smaller chart, makes the
   gap a visual no-op, and why turning rounded ends off restores it.
2. **The gap cannot be authored.** The only control is the discrete divisor, so
   an author cannot widen the spacing without changing the count.

## Decisions

- **Spacing is a share of the chart, not of the slot.** One new setting,
  `segmentSpacingPercent: number`, is read as a percentage of the chart's
  **smaller drawn edge**. Its on-screen size is therefore constant relative to
  the chart as the segment count changes, and it scales with the chart on a
  resize.
- **Rounded ends widen the gap to clear the caps.** The effective gap is the
  larger of the authored spacing and the clearance the two round caps need,
  clamped to 45% of a slot so a band is never consumed. The author's
  rounded-ends toggle is respected; it is never silently overridden.
- **A fill-mode toggle governs the gauge and the bar.** New setting
  `segmentFill: "whole" | "partial"`. `whole` quantises the reading to band
  edges (the gauge's current mode); `partial` fills the band that contains the
  reading up to the reading (the bar's current mode). Absent means each family's
  current mode — gauge `"whole"`, bar `"partial"` — so existing documents do not
  change appearance. Pie has no toggle: its sub-slices are exact equal shares,
  and there is no "band containing the reading" to shorten.
- **Pie keeps its shape but takes the spacing setting.** Its sub-sweep gap is
  converted from the same chart-share spacing.

## B6. The settings

`GaugeSettings`, `BarSettings` and `PieSettings` gain:

```ts
readonly segmentSpacingPercent?: number; // absent = the family default below
readonly segmentFill?: "whole" | "partial"; // gauge and bar only
```

Defaults live in `defaultGaugeSettings`, `defaultBarSettings` and
`defaultPieSettings`, as every other setting's do:

| family | `segmentSpacingPercent` | `segmentFill` |
|---|---|---|
| gauge | `2.5` | `"whole"` |
| bar | `2.5` | `"partial"` |
| pie | `2.5` | — (`"whole"` by construction) |

`2.5` is chosen by the SSR probe in the plan: at divisor `20` on the reference
chart size it must read as the current gap does. The plan records the measured
pixel gap at that size and at half size; if `2.5` does not reproduce the
reference look the plan sets the measured value instead.

`settings-fields.ts` gains one descriptor per family:

- `segmentSpacingPercent`: number, `min: 0`, `max: 20`, section `content`,
  hint "How much of the chart's smaller edge is left empty between slices."
- `segmentFill` (gauge, bar): select with `Whole segment` / `Partial segment`,
  `visibleWhen` `segmentDivisor !== 100`, hint "Whole lights the slice the
  reading reaches; partial stops the fill at the reading."

The descriptor table stays the one owner: the envelope validator refuses a
non-enum `segmentFill` through its existing select branch, and refuses a
non-finite or out-of-range spacing through the number branch.

The editor's `ControlSlider` already renders a continuous number as a track.
`segmentSpacingPercent` uses that track with one addition: the well and
`aria-valuetext` show one decimal and a `%` suffix, because a bare `2.5`
beside a `Bar width` slider that means degrees would be read as the same unit.
The setting is not discrete, so it commits on release as every continuous
setting does.

## B7. Gauge geometry

Settings in hand, with `edge` the chart's smaller drawn edge in pixels,
`radius = edge / 2` (the gauge draws at `radius: "100%"`), and `bandSweep` the
authored sweep divided by the segment count:

```
spacingAngle = 2 * segmentSpacingPercent / 100        // radians, radius cancels
capClearance = thickness / radius                     // radians
gapAngle     = min(max(spacingAngle, capClearance), 0.45 * bandSweep)
```

The radius cancels for the spacing term because the spacing is a share of
`edge` and the radius is half of it; the clearance term keeps the `edge`
dependency that makes the caps scale. `gapAngle` is subtracted from each band
end as today, with the gap belonging to the slice it follows.

`partial` mode adds the reading's own position as a colour-band boundary, so
the band containing the reading is split at the reading and the filled part
takes the progress paint. `whole` mode keeps today's `reaches` test.

## B8. Bar geometry

The custom `renderItem` already works in pixels, so the chart share is applied
directly:

```
edge     = min(api.getWidth(), api.getHeight())
gapPx    = min(segmentSpacingPercent / 100 * edge, 0.45 * bandPx)
visible  = bandPx - gapPx
```

Rect corner radius is clamped by ECharts to the rect, so no cap clearance term
is needed. In `whole` mode `fraction` becomes `fraction >= 1 ? 1 : 0`; in
`partial` mode it stays the reading's own fraction.

## B9. Pie geometry

A slice's sub-sweep in degrees is `share * 360 / count`; the spacing converts
to an angle the same way as the gauge, with `radius` taken at the pie's
`outerRadiusPercent` of half the drawn edge rather than the gauge's fixed half.
The spacer construction in B4 is unchanged; only the target angle it solves for
changes.

## What this design does not do

- **No polar-bar segmentation.** Still deferred by the parent design.
- **No per-family spacing unit.** One percentage of the drawn edge across the
  three families.
- **No theme format version bump.** Both keys are additive and absent means the
  family default; the parent design already accepted additive chart settings
  without a bump.
- **No automatic disabling of rounded ends.** The clearance term widens the gap
  instead; at a segment count where even 45% of a slot is less than the cap
  clearance the caps still meet, and the author's rounded-ends toggle remains
  the remedy.

## Verification

- Unit: formula cases for gauge (angle cancels radius, clearance wins at small
  sizes, 45% clamp), bar (pixel gap from `getWidth`/`getHeight`, whole vs
  partial fraction), pie (target angle), and the settings descriptors/defaults.
- Browser: the reference RAM gauge at divisor `20` and at half the chart size
  shows a gap that is the same share of the chart; toggling rounded ends does
  not collapse it; switching fill mode moves the last band's fill edge.
- Every new test is watched fail first by removing its behaviour.
