# Segment spacing and fill mode — design

> Follows [`2026-10-25-chart-playback-and-segmented-fill-design.md`](2026-10-25-chart-playback-and-segmented-fill-design.md)
> (Design B). That design's `SEGMENT_GAP_RATIO = 0.2` is a share of each
> **slot**, and this design replaces it for the gauge and the bar. The first
> implementation measured the gap against the chart's drawn edge and is
> superseded by [ADR 0121](../../decisions/0121-segment-spacing-is-a-share-of-the-segment.md);
> the spacing below is a share of the **segment**.

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

The first fix measured the gap against the chart's smaller edge. It failed the
owner's test: the 45%-of-a-band clamp took the slider's useful range at ordinary
counts, and the rounded caps ate the first part of every gap, so raising the
setting barely moved the picture.

## Decisions

- **Spacing is a share of the segment's painted width.** One setting,
  `segmentSpacingPercent: integer 1–100`, means the empty space is that share of
  the painted segment beside it. At 100 the space is as wide as the painted
  segment, with or without its rounded corners. A smaller band gets a
  proportionally smaller gap, so the relationship survives every count and
  size, and the slider always moves the picture.
- **Rounded ends are solved for, not overridden.** A round cap overhangs each
  band end by half the thickness, so the *stop* gap is solved for the painted
  extent the author defined. Spacing 0 closes the gap exactly to the caps.
- **A fill-mode toggle governs the gauge and the bar.** New setting
  `segmentFill: "whole" | "partial"`. `whole` lights a segment once the reading
  reaches its painted end; `partial` stops the fill at the reading itself. Absent
  means each family's current mode — gauge `"whole"`, bar `"partial"` — so
  existing documents do not change appearance. Pie has no toggle: its
  sub-slices are exact shares, and there is no "band containing the reading".
- **Pie takes the same spacing, per piece.** Each internal gap is the authored
  share of the piece it follows, so a larger slice leaves a larger gap.

## B6. The settings

`GaugeSettings`, `BarSettings` and `PieSettings` gain:

```ts
readonly segmentSpacingPercent?: number; // integer 1–100; absent = 10
readonly segmentFill?: "whole" | "partial"; // gauge and bar only
```

Defaults live in `defaultGaugeSettings`, `defaultBarSettings` and
`defaultPieSettings`, as every other setting's do:

| family | `segmentSpacingPercent` | `segmentFill` |
|---|---|---|
| gauge | `10` | `"whole"` |
| bar | `10` | `"partial"` |
| pie | `10` | — (`"whole"` by construction) |

`10` is the look the owner approved on the reference gauge: the fifth of a band
the old slot ratio drew at divisor `20`, now stated as a share of the painted
band and therefore the same picture at every count.

`settings-fields.ts` gains one descriptor per family:

- `segmentSpacingPercent`: number, `min: 1`, `max: 100`, `integer: true`,
  suffix `%`, section `content`, hint "How wide the empty space is, as a share
  of a slice; 100 leaves as much space as painted slice."
- `segmentFill` (gauge, bar): select with `Whole segment` / `Partial segment`,
  `visibleWhen` `segmentDivisor !== 100`, hint "Whole lights the slice the
  reading reaches; partial stops the fill at the reading."

The descriptor table stays the one owner: the envelope validator refuses a
non-enum `segmentFill` through its existing select branch, and refuses a
non-finite, out-of-range or fractional spacing through the number branch.

The editor's chart column renders the spacing as a `ControlSlider` with a
whole-number step and a well that refuses a fraction; the `%` suffix says what
the number is a share of. The setting is optional, so the well's empty draft is
the way back to the renderer's default.

## B7. Gauge geometry

With `b` the band sweep in degrees (`sweep / count`), `c` the cap clearance
across one gap in degrees, `q = segmentSpacingPercent / 100`, and `radius` the
**backing canvas's** half edge — `drawnEdgePx / 2`, because ECharts draws at
`radius: "100%"` of that canvas and the option's `thickness` is in the same
pixels:

```
capClearance = roundCap ? thickness / radius  (radians → degrees) : 0
stopGap      = (q (b + c) + c) / (1 + q)      clamped to b
painted      = b - stopGap + c
empty        = stopGap - c = q · painted
```

At `q = 0` the stop gap is `c`, so the caps meet and the painted band is the
whole band; at `q = 1` the empty space and the painted band are both `b / 2`.
The 45%-of-a-band clamp is gone: the percentage defines the relationship, and
the only bound is that a band cannot be negative. When the gap takes the whole
band — only reachable with caps wider than the band — the adapter draws the
continuous track rather than a list of zero-width bands.

`stopGap` is subtracted from each band end, with the gap belonging to the slice
it follows. `partial` mode adds the reading's own position as a colour-band
boundary, so the band containing the reading is split at the reading and the
filled part takes the progress paint. `whole` mode keeps today's `reaches` test
against the painted band end.

## B8. Bar geometry

The custom `renderItem` works in pixels and has nothing overhanging, so the same
equation with `c = 0` gives the gap from the band alone — no drawn box:

```
gapPx   = q · bandPx / (1 + q)
visible = bandPx - gapPx
```

The fill edge follows the reading: a band is painted `clamp(reach - bandStart,
0, visible)` px long, so a band reaches its painted end exactly when the reading
does and the next band starts only then. `whole` mode paints a band in full once
that length reaches `visible`, and not before. A reading in the gap leaves the
gap empty, as a gap should be.

## B9. Pie geometry

Values are angles in degrees and the segmented items sum to one full turn. With
`n` pieces per slice, the authored `padAngle` between slices, `W = 360 −
slices · pad`, and `T` the sum of the authored values:

```
piece = W · value / (T · (n + (n − 1) q))
gap   = q · piece            (internal, after every piece but the last)
boundary = pad               (between slices, as authored)
```

The painted pieces of each slice stay proportional to its value, so the
composition reads exactly as it did; only the internal gaps change, and they
scale with the piece they follow.

## What this design does not do

- **No polar-bar segmentation.** Still deferred by the parent design.
- **No per-family spacing unit.** One integer percentage of the segment across
  the three families; each adapter converts it to its own axis.
- **No theme format version bump.** Both keys are additive and absent means the
  family default; the parent design already accepted additive chart settings
  without a bump.
- **No automatic disabling of rounded ends.** The stop gap is solved to include
  the caps instead.

## Verification

- Unit: the algebra at 0, 10 and 100% for the gauge (square and round ends, the
  backing-radius clearance, the clamp to the band), the bar (gap as a share of
  the band at two sizes, the fill edge reaching the band end before the next
  starts), pie (each gap a tenth of its own piece, the ring summing to 360), and
  the descriptors' 1–100 whole-percent bounds.
- Browser: the reference RAM gauge at divisor `20` and at half the chart size
  shows an empty space that is a tenth of the painted band, and at 100 the two
  are equal; switching fill mode moves the last band's fill edge.
- Every new test is watched fail first by removing its behaviour.
