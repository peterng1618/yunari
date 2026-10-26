// @vitest-environment jsdom

import {
  defaultPieSettings,
  defaultPolarBarSettings,
  defaultRadarSettings,
  type FabricPalette,
  type PieSettings,
  SEGMENT_DIVISORS,
  SEMANTIC_KEYS,
  type SemanticKeyDescriptor,
  settingsFieldsFor,
} from "@yunari/renderer-core";
import { describe, expect, it } from "vitest";
import { isSettingVisible } from "../editor-shell/controls/settings-field.js";
import type { ChartSettingView } from "./chart-fields.js";
import {
  ASPECT_RATIOS,
  type ChartFieldTarget,
  chartContentView,
  chartPaintView,
} from "./panel.js";

/**
 * What the chart owner hands the column, as data.
 *
 * The controls themselves are `chart-fields.tsx`, and the file that renders
 * them is `chart-fields.dom.test.tsx`. This one is about the reading: which
 * descriptors become rows, where each row writes, which are clearable, which
 * series may be removed, and which paint references are worth a control. A row
 * that is here and cannot be rendered is a defect this file cannot see — which
 * is exactly why the rendering has its own file.
 */

const palette: FabricPalette = {
  cpu: { name: "CPU", value: { kind: "solid", color: "#00b8d9" } },
  gpu: { name: "GPU", value: { kind: "solid", color: "#a78bfa" } },
  ram: { name: "RAM", value: { kind: "solid", color: "#2dd4bf" } },
};

const charts: readonly ChartFieldTarget[] = [
  {
    id: "gauge",
    content: {
      family: "gauge",
      settings: {
        startAngle: 90,
        endAngle: -270,
        min: 0,
        max: 100,
        thickness: 10,
        track: { kind: "solid", color: "#000" },
        progress: { kind: "solid", color: "#fff" },
        roundCap: true,
        segmentDivisor: 100,
      },
    },
    bindings: [{ id: "g", semanticKey: "ram.used.percent" }],
  },
  {
    id: "trend",
    content: {
      family: "line",
      settings: {
        lineWidth: 2,
        interpolation: "linear",
        stroke: { kind: "solid", color: "#00b8d9" },
        showMarkers: false,
        markerSize: 4,
        windowSeconds: 60,
        maxPoints: 600,
        showAxes: false,
        // Three slices of paint: ids must stay unique across a `multiple` row,
        // not just across one family's settings.
        palette: [
          { ref: "palette.cpu" },
          { ref: "palette.gpu" },
          { ref: "palette.ram" },
        ],
      },
    },
    bindings: [
      { id: "cpu", semanticKey: "cpu.load" },
      { id: "gpu", semanticKey: "gpu.load" },
    ],
  },
  {
    id: "storage",
    content: {
      family: "bar",
      settings: {
        orientation: "horizontal",
        min: 0,
        max: 100,
        barWidth: 20,
        categoryGapPercent: 40,
        cornerRadius: 10,
        trackCornerRadius: 10,
        segmentDivisor: 100,
        fill: { ref: "palette.cpu" },
        track: { ref: "palette.gpu" },
        showAxes: false,
      },
    },
    bindings: [{ id: "disk", semanticKey: "disk.used" }],
  },
  {
    id: "pie",
    content: {
      family: "pie",
      settings: {
        innerRadiusPercent: 0,
        outerRadiusPercent: 80,
        startAngle: 0,
        endAngle: 360,
        padAngle: 0,
        cornerRadius: 4,
        segmentDivisor: 100,
        palette: [{ ref: "palette.cpu" }],
        remainderFill: { ref: "palette.gpu" },
        total: { kind: "sum" },
      },
    },
    bindings: [{ id: "slice", semanticKey: "disk.used" }],
  },
];

/** Every id a chart's two bodies render, in one list. */
function idsOf(target: ChartFieldTarget): readonly string[] {
  const content = chartContentView(target);
  const paint = chartPaintView(target, palette);
  return [
    ...content.rows.map((row) => row.id),
    ...paint.rows.map((row) => row.id),
    content.series.id,
  ];
}

describe("the chart fields, as the owner hands them over", () => {
  it("renders one named row for every descriptor the author can see", () => {
    // The projection's half of the completeness record: a descriptor the
    // renderer would show and this list omits is a control nobody gets, and a
    // row here with no descriptor behind it is a control with nothing to write.
    for (const target of charts) {
      const rows = chartContentView(target).rows;
      const visible = settingsFieldsFor(target.content.family).filter((field) =>
        isSettingVisible(field, target.content.settings),
      );

      expect(
        rows.map((row) => row.key),
        `${target.id} descriptors`,
      ).toEqual(visible.map((field) => field.property));

      for (const row of rows) {
        expect(row.id, `${target.id}: "${row.key}" has no id`).not.toBe("");
        expect(
          row.label.trim(),
          `${target.id}: "${row.key}" has no label with words on it`,
        ).not.toBe("");
        expect(
          row.path.length,
          `${target.id}: "${row.key}" writes nowhere`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("keeps those ids unique, including across bindings and repeated paint", () => {
    // Two bindings render the same fields twice and a `multiple` paint row
    // renders one control per slice, so a positional id would collide and the
    // second control's label would name the first.
    for (const target of charts) {
      const ids = idsOf(target);
      expect(new Set(ids).size, `${target.id} ids`).toBe(ids.length);
    }
  });

  it("names the corner-radius control the same way the panel did", () => {
    // The exact lookup that returned nothing twice: name the control, not find
    // it by walking the section.
    const rows = chartContentView(charts[2] as ChartFieldTarget).rows;
    const byLabel = rows.find((row) => row.label === "Corner radius");
    expect(byLabel?.key).toBe("cornerRadius");
    expect(rows.find((row) => row.label === "Track corner radius")?.key).toBe(
      "trackCornerRadius",
    );
  });
});

describe("a chart's bounded settings, as the owner hands them over", () => {
  /** The same targets with a drawn box, which is what the manager always reads
      off a real chart: the smaller edge of the object's own size at its scale. */
  const boxed = (target: ChartFieldTarget): ChartFieldTarget => ({
    ...target,
    drawnEdge: 160,
  });
  const rowOf = (
    target: ChartFieldTarget,
    key: string,
  ): ChartSettingView | undefined =>
    chartContentView(boxed(target)).rows.find((row) => row.key === key);

  it("gives every bounded number a slider, with its bound read from its owner", () => {
    // Ten descriptors carry both bounds and hand those over.
    expect(rowOf(charts[2]!, "categoryGapPercent")).toMatchObject({
      control: "slider",
      min: 0,
      max: 100,
    });
    expect(rowOf(charts[0]!, "startAngle")).toMatchObject({
      control: "slider",
      min: -360,
      max: 360,
    });
    // A segment share is authored, so an unauthored gauge shows the renderer's
    // own 10% rather than a zero-track, and the well says it is a percentage.
    // Whole percents only: the track and the well both refuse a fraction.
    const spacing = rowOf(charts[0]!, "segmentSpacingPercent");
    expect(spacing).toMatchObject({
      control: "slider",
      value: 10,
      min: 1,
      max: 100,
      integer: true,
      suffix: "%",
    });
    expect(spacing).not.toHaveProperty("decimals");
    expect(spacing).not.toHaveProperty("step");
    // A slice gap's ceiling is a full turn, which is the unit's own bound.
    expect(rowOf(charts[3]!, "padAngle")).toMatchObject({
      control: "slider",
      min: 0,
      max: 360,
    });
    // A pixel measure's ceiling is the chart's own drawn box, and a radius
    // takes half of it — the finding `vg-478` met in the selection column.
    expect(rowOf(charts[0]!, "thickness")).toMatchObject({
      control: "slider",
      min: 0,
      max: 160,
    });
    expect(rowOf(charts[2]!, "trackCornerRadius")).toMatchObject({
      control: "slider",
      max: 80,
    });
    expect(rowOf(charts[3]!, "cornerRadius")).toMatchObject({
      control: "slider",
      max: 80,
    });
  });

  it("offers the segment divisor as the discrete track", () => {
    // The track's own range comes from the list, not from the descriptor's
    // numeric bounds: the values between two divisors are not commits anyone
    // can make, so the control steps index to index.
    expect(rowOf(charts[0]!, "segmentDivisor")).toMatchObject({
      control: "slider",
      value: 100,
      min: 1,
      max: 100,
      values: SEGMENT_DIVISORS,
      clearable: false,
    });
  });

  it("leaves the three a track cannot honour typed, and says why", () => {
    // Bounded by the sample store and by the chart's own data: a slider would
    // offer a range the store or the data does not honour.
    for (const [target, key] of [
      [charts[1]!, "windowSeconds"],
      [charts[1]!, "maxPoints"],
    ] as const) {
      expect(rowOf(target, key), key).toMatchObject({ control: "number" });
    }
    const fixed: ChartFieldTarget = {
      id: "ram",
      content: {
        family: "pie",
        settings: {
          ...defaultPieSettings,
          total: { kind: "fixed", value: 64 },
        },
      },
      bindings: [],
    };
    expect(rowOf(fixed, "total.value")).toMatchObject({ control: "number" });
  });

  it("shows the value the renderer draws with when the author set none", () => {
    // A track has no empty state, and an unauthored setting is one the renderer
    // decides: the number shown is the family's own default, read from the
    // object that owns it rather than restated in the descriptor table. The
    // animation block is the case the document usually does not carry at all.
    const line = chartContentView(boxed(charts[1]!));
    expect(
      line.rows.find((row) => row.key === "animation.durationMs"),
    ).toMatchObject({ control: "slider", value: 1000, min: 0, max: 5000 });
    const bare: ChartFieldTarget = {
      id: "bare",
      content: {
        family: "bar",
        settings: {
          orientation: "horizontal",
          min: 0,
          max: 100,
          categoryGapPercent: 40,
          cornerRadius: 7,
          segmentDivisor: 100,
          fill: { kind: "solid", color: "#000" },
          showAxes: false,
        },
      },
      bindings: [],
    };
    expect(rowOf(bare, "barWidth")).toMatchObject({
      control: "slider",
      value: 14,
      clearable: true,
    });
  });

  it("leaves a pixel measure typed when the chart's box cannot be read", () => {
    // No guessed ceiling: an object that measures nothing gets no bound, and the
    // field keeps the typed box it had rather than a track to nowhere.
    expect(
      chartContentView(charts[0] as ChartFieldTarget).rows.find(
        (row) => row.key === "thickness",
      ),
    ).toMatchObject({ control: "number" });
  });
});

describe("the fixed-total question", () => {
  const pie = (settings: PieSettings): ChartFieldTarget => ({
    id: "ram",
    content: { family: "pie", settings },
    bindings: [],
  });

  it("asks only while the total is fixed", () => {
    const rowOf = (settings: PieSettings): string | undefined =>
      chartContentView(pie(settings)).rows.find(
        (row) => row.key === "total.value",
      )?.key;

    expect(rowOf(defaultPieSettings)).toBeUndefined();
    expect(
      rowOf({ ...defaultPieSettings, total: { kind: "fixed", value: 0 } }),
    ).toBe("total.value");
  });

  it("writes the fixed value at the path the renderer reads it from", () => {
    // Committing `{...settings, [property]: value}` writes a key the validator
    // accepts and the renderer never reads, so the author's choice survives the
    // click and dies on reopen. The path is what stops that, and it is the
    // renderer's own path — the same one `computeComposition` reads.
    const rows = chartContentView(
      pie({ ...defaultPieSettings, total: { kind: "fixed", value: 64 } }),
    ).rows;
    expect(rows.find((row) => row.key === "total.value")?.path).toEqual([
      "total",
      "value",
    ]);
    expect(
      rows.find((row) => row.key === "animation.durationMs")?.path,
    ).toEqual(["animation", "durationMs"]);
  });

  it("tells the renderer to remove a key the author cleared", () => {
    // Absent is an authorable state for exactly the descriptors that say so,
    // and an empty box is how the author gets back to it.
    const rows = chartContentView(
      pie({ ...defaultPieSettings, endAngle: 200 }),
    ).rows;
    const clearable = (key: string): boolean | undefined => {
      const row = rows.find((candidate) => candidate.key === key);
      return row?.control === "number" ||
        row?.control === "select" ||
        row?.control === "slider"
        ? row.clearable
        : undefined;
    };

    expect(clearable("endAngle")).toBe(true);
    // A required field's empty box is a mistake, not a removal.
    expect(clearable("innerRadiusPercent")).toBe(false);
  });
});

describe("a chart's series, as a value", () => {
  it("declares the first series, and offers every reading it may name", () => {
    // The panel could only ever edit a binding the document already declared,
    // and a chart inserted through the Add pane declares none — so the whole
    // family was unauthorable from the surface.
    const series = chartContentView({
      id: "trends",
      content: charts[1]!.content,
      bindings: [],
    }).series;

    // Not an edit: a binding cannot exist without the key it names, so the
    // chooser declares both at once.
    expect(series.label).toBe("Add a series");
    expect(series.options[0]).toEqual({ id: "", name: "Add a series" });
    expect(series.options.map((option) => option.id)).toContain("cpu.load");
    expect(series.refused).toBe(false);
    expect(series.full).toBeUndefined();
    expect(series.rows).toEqual([]);
  });

  it("offers a series' own key even when no descriptor declares it", () => {
    // A document can name a key the table no longer has; a picker that dropped
    // it would show the series as reading nothing at all.
    const [row] = chartContentView({
      id: "trends",
      content: charts[1]!.content,
      bindings: [{ id: "a", semanticKey: "retired.key" }],
    }).series.rows;

    const options = row?.keyOptions ?? [];
    expect(options[0]).toEqual({ id: "retired.key", name: "retired.key" });
    // ...and the declared table is still offered beside it, once each.
    expect(options.map((option) => option.id)).toContain("cpu.load");
    expect(new Set(options.map((option) => option.id)).size).toBe(
      options.length,
    );
  });

  it("withholds the removal from the last series", () => {
    // A chart with nothing bound draws its frame and no data, so a control that
    // reaches that state is a control that can empty a card.
    const withOne = chartContentView({
      id: "trends",
      content: charts[1]!.content,
      bindings: [{ id: "a", semanticKey: "cpu.load" }],
    }).series;
    expect(withOne.rows.map((row) => row.removable)).toEqual([false]);

    const withTwo = chartContentView({
      id: "trends",
      content: charts[1]!.content,
      bindings: [
        { id: "a", semanticKey: "cpu.load" },
        { id: "b", semanticKey: "gpu.load" },
      ],
    }).series;
    expect(withTwo.rows.map((row) => row.removable)).toEqual([true, true]);
    // The binding crosses whole: it is the object the manager writes back, and
    // a reconstruction here would be a second spelling of its shape.
    expect(withTwo.rows[1]?.binding).toEqual({
      id: "b",
      semanticKey: "gpu.load",
    });
  });

  it("says a gauge takes one reading rather than accepting a second", () => {
    // `buildChartPlan` reads `bindings[0]` for a gauge and ignores the rest, so
    // a second one would be a control that accepts an edit and applies none.
    const series = chartContentView(charts[0] as ChartFieldTarget).series;
    expect(series.refused).toBe(true);
    expect(series.full).toContain("gauge");
  });

  it("offers a radar twelve spokes and a polar bar unbounded", () => {
    const withBindings = (
      family: "radar" | "polarBar",
      count: number,
    ): ChartFieldTarget => ({
      id: family,
      content:
        family === "radar"
          ? { family, settings: defaultRadarSettings }
          : { family, settings: defaultPolarBarSettings },
      bindings: Array.from({ length: count }, (_, index) => ({
        id: `b${index}`,
        semanticKey: "cpu.load",
      })),
    });

    expect(chartContentView(withBindings("radar", 11)).series.refused).toBe(
      false,
    );
    const full = chartContentView(withBindings("radar", 12)).series;
    expect(full.refused).toBe(true);
    expect(full.full).toContain("radar");

    // A polar bar draws one category per binding, so it has no cap.
    expect(chartContentView(withBindings("polarBar", 40)).series.refused).toBe(
      false,
    );
  });
});

describe("a chart's readings, as the catalogue offers them", () => {
  const fan: SemanticKeyDescriptor = {
    key: "custom.fan",
    family: "custom",
    label: "Fan speed",
    expectedTier: "extended",
  };
  const line = (
    bindings: readonly { id: string; semanticKey: string }[],
    descriptors: readonly SemanticKeyDescriptor[] = [...SEMANTIC_KEYS, fan],
  ) =>
    chartContentView(
      {
        id: "trends",
        content: charts[1]!.content,
        bindings,
      },
      descriptors,
    );

  it("lists a discovered key and its label beside the built-in ones", () => {
    const options = line([]).series.options;
    expect(options).toContainEqual({ id: "custom.fan", name: "Fan speed" });
    expect(options.map((option) => option.id)).toContain("cpu.load");
  });

  it("keeps a saved binding the catalogue does not know", () => {
    // A theme may name a key this host no longer reports; a picker that dropped
    // it would show the series as reading nothing at all.
    const [row] = line([{ id: "a", semanticKey: "retired.key" }], [fan]).series
      .rows;
    const options = row?.keyOptions ?? [];
    expect(options[0]).toEqual({ id: "retired.key", name: "retired.key" });
    expect(options.map((option) => option.id)).not.toContain("cpu.load");
  });
});

describe("the line chart's aspect group", () => {
  it("offers the ratios, and states the one the chart is already at", () => {
    const view = chartContentView({
      ...(charts[1] as ChartFieldTarget),
      aspect: 3,
    });
    expect(view.aspect?.options).toEqual(
      ASPECT_RATIOS.map((ratio) => ({ id: String(ratio), name: `${ratio}:1` })),
    );
    expect(view.aspect?.value).toBe("3");
  });

  it("presses nothing when the chart is at none of them", () => {
    // Read off the object rather than remembered from the last click: rounding
    // a 2.004:1 chart to the nearest would light up a ratio nobody applied.
    expect(chartContentView(charts[1] as ChartFieldTarget).aspect?.value).toBe(
      "",
    );
  });

  it("is not a question the other families are asked", () => {
    for (const target of [charts[0]!, charts[2]!, charts[3]!]) {
      expect(chartContentView(target).aspect, target.id).toBeUndefined();
    }
  });
});

describe("what a chart paints its data with", () => {
  it("offers one control per reference, named for its own family's field", () => {
    const bar = chartPaintView(charts[2] as ChartFieldTarget, palette);
    expect(bar.rows.map((row) => row.key)).toEqual(["fill", "track"]);
    expect(bar.rows.map((row) => row.label)).toEqual([
      "Fill paint",
      "Track paint",
    ]);
    expect(bar.rows.map((row) => row.ref)).toEqual([
      "palette.cpu",
      "palette.gpu",
    ]);
    // The tokens are the palette's own, named as their author named them.
    expect(bar.rows[0]?.options.map((option) => option.id)).toEqual([
      "palette.cpu",
      "palette.gpu",
      "palette.ram",
    ]);
  });

  it("gives a repeated paint one control per slice, and one id per slice", () => {
    const line = chartPaintView(charts[1] as ChartFieldTarget, palette);
    const series = line.rows.filter((row) => row.property === "palette");
    expect(series.map((row) => row.key)).toEqual([
      "palette.0",
      "palette.1",
      "palette.2",
    ]);
    expect(series.map((row) => row.label)).toEqual([
      "Series paint 1",
      "Series paint 2",
      "Series paint 3",
    ]);
    expect(series.map((row) => row.index)).toEqual([0, 1, 2]);
  });

  it("refuses a paint it cannot change rather than offering a token nobody chose", () => {
    // A reference that is not a palette token has no valid choice to change it
    // to, and neither has a palette that offers none.
    const solidInk = chartPaintView(charts[0] as ChartFieldTarget, undefined);
    expect(solidInk.rows.map((row) => row.ref)).toEqual(["", ""]);
    expect(solidInk.rows.map((row) => row.refused)).toEqual([true, true]);

    const tokenBacked = chartPaintView(
      {
        id: "gauge",
        content: {
          family: "gauge",
          settings: {
            startAngle: 90,
            endAngle: -270,
            min: 0,
            max: 100,
            thickness: 10,
            track: { ref: "palette.cpu" },
            progress: { ref: "palette.gpu" },
            roundCap: true,
            segmentDivisor: 100,
          },
        },
        bindings: [],
      },
      palette,
    );
    expect(tokenBacked.rows.map((row) => row.refused)).toEqual([false, false]);
  });

  it("asks nothing about a paint field the chart does not have", () => {
    // A gauge has no per-series palette, so a repeated row that is absent from
    // its settings is not a control with an empty choice — it is not a row.
    const gauge = chartPaintView(charts[0] as ChartFieldTarget, palette);
    expect(gauge.rows.map((row) => row.property)).toEqual([
      "track",
      "progress",
    ]);
  });
});
