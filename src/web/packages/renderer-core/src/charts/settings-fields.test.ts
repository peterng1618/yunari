import { describe, expect, it } from "vitest";

import { CHART_FAMILIES, type ChartFamily } from "../theme/document.js";
import { defaultGaugeSettings, type GaugeSettings } from "../types.js";
import { ANIMATION_EASINGS, type AnimationSettings } from "./animation.js";
import { type BarSettings, defaultBarSettings } from "./bar.js";
import { defaultLineSettings, type LineSettings } from "./line.js";
import { defaultPieSettings, type PieSettings } from "./pie.js";
import { defaultPolarBarSettings, type PolarBarSettings } from "./polar-bar.js";
import { defaultRadarSettings, type RadarSettings } from "./radar.js";
import { SEGMENT_DIVISORS } from "./segments.js";
import {
  CHART_PAINT_FIELDS,
  CHART_SETTINGS_FIELDS,
  chartPaintFieldsFor,
  SETTINGS_SECTIONS,
  type SettingsFieldDescriptor,
  settingsFieldsFor,
  settingsKeyFor,
} from "./settings-fields.js";

describe("the chart settings declaration", () => {
  it("has a row for every chart family", () => {
    expect(Object.keys(CHART_SETTINGS_FIELDS).sort()).toEqual(
      [...CHART_FAMILIES].sort(),
    );
  });

  it("declares each property once per family", () => {
    for (const family of CHART_FAMILIES) {
      const properties = settingsFieldsFor(family).map(
        (field) => field.property,
      );

      expect(new Set(properties).size).toBe(properties.length);
    }
  });

  it("gives every field a label and a kind", () => {
    for (const family of CHART_FAMILIES) {
      for (const field of settingsFieldsFor(family)) {
        expect(field.label.length).toBeGreaterThan(0);
        expect(["number", "boolean", "select"]).toContain(field.kind);
      }
    }
  });

  it("gives every select its options", () => {
    for (const family of CHART_FAMILIES) {
      for (const field of settingsFieldsFor(family)) {
        if (field.kind === "select") {
          expect(field.options?.length ?? 0).toBeGreaterThan(0);
        }
      }
    }
  });

  it("declares no default values — the default*Settings objects own those", () => {
    // A default repeated here would be a fifth home for a number that is only
    // correct in one place.
    for (const family of CHART_FAMILIES) {
      for (const field of settingsFieldsFor(family)) {
        expect("default" in field).toBe(false);
      }
    }
  });
});

describe("the chart paint declaration", () => {
  it("has a labelled row for every persisted paint setting", () => {
    expect(Object.keys(CHART_PAINT_FIELDS).sort()).toEqual(
      [...CHART_FAMILIES].sort(),
    );
    for (const family of CHART_FAMILIES) {
      const properties = chartPaintFieldsFor(family).map(
        (field) => field.property,
      );
      expect(new Set(properties).size).toBe(properties.length);
      expect(
        chartPaintFieldsFor(family).every((field) => field.label.length > 0),
      ).toBe(true);
    }
  });
});

/**
 * Every key of every settings interface, classified.
 *
 * **The type is the gate.** A key added to one of these interfaces and not
 * classified here does not compile, and a classification the interface does not
 * have does not compile either. The runtime half below proves each
 * classification resolves to a real descriptor, in both directions.
 *
 * This replaces `NON_SCALAR_SETTINGS`, an allowlist whose doc comment said it
 * existed so the declared list and the excluded list "together account for every
 * property" — which was true and useless, because `animation` and `total` sat in
 * the excluded list and had no control at all (`vg-122`).
 */
const GAUGE_COVERAGE: Record<keyof GaugeSettings, "setting" | "paint"> = {
  startAngle: "setting",
  endAngle: "setting",
  min: "setting",
  max: "setting",
  thickness: "setting",
  track: "paint",
  progress: "paint",
  roundCap: "setting",
  segmentDivisor: "setting",
  segmentSpacingPercent: "setting",
  segmentFill: "setting",
  gradientSegments: "setting",
  animation: "setting",
};

const LINE_COVERAGE: Record<keyof LineSettings, "setting" | "paint"> = {
  lineWidth: "setting",
  interpolation: "setting",
  stroke: "paint",
  palette: "paint",
  dash: "setting",
  area: "paint",
  showMarkers: "setting",
  markerSize: "setting",
  windowSeconds: "setting",
  maxPoints: "setting",
  min: "setting",
  max: "setting",
  showAxes: "setting",
  sampling: "setting",
  animation: "setting",
};

const BAR_COVERAGE: Record<keyof BarSettings, "setting" | "paint"> = {
  orientation: "setting",
  min: "setting",
  max: "setting",
  barWidth: "setting",
  categoryGapPercent: "setting",
  cornerRadius: "setting",
  fill: "paint",
  track: "paint",
  trackCornerRadius: "setting",
  segmentDivisor: "setting",
  segmentSpacingPercent: "setting",
  segmentFill: "setting",
  showAxes: "setting",
  animation: "setting",
};

const PIE_COVERAGE: Record<keyof PieSettings, "setting" | "paint"> = {
  innerRadiusPercent: "setting",
  outerRadiusPercent: "setting",
  startAngle: "setting",
  endAngle: "setting",
  padAngle: "setting",
  cornerRadius: "setting",
  segmentDivisor: "setting",
  segmentSpacingPercent: "setting",
  total: "setting",
  remainderFill: "paint",
  palette: "paint",
  animation: "setting",
};

const RADAR_COVERAGE: Record<keyof RadarSettings, "setting" | "paint"> = {
  min: "setting",
  max: "setting",
  shape: "setting",
  splitNumber: "setting",
  lineWidth: "setting",
  showMarkers: "setting",
  markerSize: "setting",
  showAxes: "setting",
  stroke: "paint",
  area: "paint",
  animation: "setting",
};

const POLAR_COVERAGE: Record<keyof PolarBarSettings, "setting" | "paint"> = {
  min: "setting",
  max: "setting",
  barWidth: "setting",
  categoryGapPercent: "setting",
  cornerRadius: "setting",
  fill: "paint",
  track: "paint",
  trackCornerRadius: "setting",
  showAxes: "setting",
  animation: "setting",
  startAngle: "setting",
  innerRadiusPercent: "setting",
  outerRadiusPercent: "setting",
};

const ANIMATION_COVERAGE: Record<keyof AnimationSettings, "setting"> = {
  durationMs: "setting",
  easing: "setting",
  appearMs: "setting",
  appearEasing: "setting",
};

const COVERAGE: Record<
  ChartFamily,
  Readonly<Record<string, "setting" | "paint">>
> = {
  gauge: GAUGE_COVERAGE,
  line: LINE_COVERAGE,
  bar: BAR_COVERAGE,
  pie: PIE_COVERAGE,
  radar: RADAR_COVERAGE,
  polarBar: POLAR_COVERAGE,
};

const DEFAULTS: Record<ChartFamily, object> = {
  gauge: defaultGaugeSettings,
  line: defaultLineSettings,
  bar: defaultBarSettings,
  pie: defaultPieSettings,
  radar: defaultRadarSettings,
  polarBar: defaultPolarBarSettings,
};

/**
 * The top-level settings key a descriptor accounts for.
 *
 * A nested descriptor resolves through its `path` prefix — `total.value` answers
 * for `total`, and each `animation.*` answers for `animation` — which is what
 * lets one record cover the two settings that sit a level down.
 */
function topLevelKey(field: SettingsFieldDescriptor): string {
  return field.path?.[0] ?? field.property.split(".")[0] ?? field.property;
}

describe("coverage against the real settings shapes", () => {
  for (const family of CHART_FAMILIES) {
    it(`resolves every ${family} key the record calls a setting`, () => {
      const fields = settingsFieldsFor(family);
      const unresolved = Object.entries(COVERAGE[family])
        .filter(([, kind]) => kind === "setting")
        .map(([key]) => key)
        .filter((key) => !fields.some((field) => topLevelKey(field) === key));

      expect(unresolved).toEqual([]);
    });

    it(`resolves every ${family} key the record calls paint`, () => {
      const paintKeys = Object.entries(COVERAGE[family])
        .filter(([, kind]) => kind === "paint")
        .map(([key]) => key);

      expect(paintKeys.length).toBeGreaterThan(0);
      expect(
        chartPaintFieldsFor(family)
          .map((field) => field.property)
          .sort(),
      ).toEqual([...paintKeys].sort());
    });

    it(`classifies every ${family} descriptor as a setting`, () => {
      const stray = settingsFieldsFor(family)
        .map(topLevelKey)
        .filter((key) => COVERAGE[family][key] !== "setting");

      expect(stray).toEqual([]);
    });

    it(`resolves every key ${family}'s defaults set`, () => {
      const fields = settingsFieldsFor(family);
      const paints = new Set(
        chartPaintFieldsFor(family).map((field) => field.property),
      );

      const unresolved = Object.keys(DEFAULTS[family]).filter((key) => {
        const kind = COVERAGE[family][key];

        if (kind === "setting") {
          return !fields.some((field) => topLevelKey(field) === key);
        }

        return kind !== "paint" || !paints.has(key);
      });

      expect(unresolved).toEqual([]);
    });
  }

  it("resolves every AnimationSettings key through the animation descriptors", () => {
    for (const family of CHART_FAMILIES) {
      const fields = settingsFieldsFor(family);
      const animation = fields.filter(
        (field) => topLevelKey(field) === "animation",
      );

      const unresolved = Object.keys(ANIMATION_COVERAGE).filter(
        (key) => !animation.some((field) => field.path?.[1] === key),
      );
      const stray = animation
        .map((field) => field.path?.[1])
        .filter((key) => key === undefined || !(key in ANIMATION_COVERAGE));

      expect(unresolved).toEqual([]);
      expect(stray).toEqual([]);
    }
  });
});

describe("the segment divisor", () => {
  it("declares the discrete divisors on all three segmented families", () => {
    for (const family of ["gauge", "bar", "pie"] as const) {
      expect(
        settingsFieldsFor(family).find((f) => f.property === "segmentDivisor"),
      ).toMatchObject({ kind: "number", values: SEGMENT_DIVISORS });
    }
  });

  it("declares both new families' settings", () => {
    expect(settingsFieldsFor("radar").map((f) => f.property)).toContain(
      "shape",
    );
    expect(settingsFieldsFor("polarBar").map((f) => f.property)).toContain(
      "innerRadiusPercent",
    );
    expect(settingsFieldsFor("polarBar").map((f) => f.property)).not.toContain(
      "segmentDivisor",
    );
  });
});

describe("the collapsed-and-counted treatment", () => {
  it("collapses at least one obscure setting of each family's own", () => {
    // The animation appearance pair is obscure too, so a family whose only
    // advanced fields were that pair would leave the treatment unreachable for
    // the settings that family's author rarely touches. Which settings those
    // are is a judgement, not a measurement — the list lives in the table.
    for (const family of CHART_FAMILIES) {
      const advanced = settingsFieldsFor(family).filter(
        (field) => field.advanced,
      );

      expect(advanced.length).toBeGreaterThan(0);
      expect(
        advanced.some((field) => !field.property.startsWith("animation.")),
      ).toBe(true);
    }
  });
});

describe("the section vocabulary", () => {
  it("orders the four questions, each with a label", () => {
    // Four, not five: `spends` was the read-only section's and item 17 removed
    // the section, the question and the vocabulary member together.
    expect(SETTINGS_SECTIONS.map((section) => section.id)).toEqual([
      "content",
      "position",
      "layer",
      "paint",
    ]);
    expect(SETTINGS_SECTIONS.every((section) => section.label.length > 0)).toBe(
      true,
    );
  });
});

describe("every descriptor answers a question", () => {
  it("uses a section from the vocabulary, for settings and paint alike", () => {
    const ids = SETTINGS_SECTIONS.map((section) => section.id);

    for (const family of CHART_FAMILIES) {
      for (const field of [
        ...settingsFieldsFor(family),
        ...chartPaintFieldsFor(family),
      ]) {
        expect(ids).toContain(field.section);
      }
    }
  });

  it("makes every paint descriptor answer Paint", () => {
    for (const family of CHART_FAMILIES) {
      expect(
        chartPaintFieldsFor(family).every((field) => field.section === "paint"),
      ).toBe(true);
    }
  });
});

describe("every descriptor carries a hint that earns it", () => {
  it("is non-empty, and never just the label again", () => {
    for (const family of CHART_FAMILIES) {
      for (const field of [
        ...settingsFieldsFor(family),
        ...chartPaintFieldsFor(family),
      ]) {
        expect(field.hint.trim().length).toBeGreaterThan(0);
        expect(field.hint).not.toBe(field.label);
      }
    }
  });
});

describe("descriptor order is the likelihood order", () => {
  // Written from the table as it stood before sections and hints were added,
  // with the two nested settings appended where Task 3 put them. A re-sort would
  // silently change which settings surface first, so the order is pinned here
  // rather than re-derived from the table it guards.
  const ANIMATION_PROPERTIES = [
    "animation.durationMs",
    "animation.easing",
    "animation.appearMs",
    "animation.appearEasing",
  ];

  const expected: Record<ChartFamily, readonly string[]> = {
    gauge: [
      "startAngle",
      "endAngle",
      "min",
      "max",
      "thickness",
      "roundCap",
      "segmentDivisor",
      "segmentSpacingPercent",
      "segmentFill",
      "gradientSegments",
      ...ANIMATION_PROPERTIES,
    ],
    line: [
      "lineWidth",
      "interpolation",
      "dash",
      "showMarkers",
      "markerSize",
      "windowSeconds",
      "maxPoints",
      "min",
      "max",
      "showAxes",
      "sampling",
      ...ANIMATION_PROPERTIES,
    ],
    bar: [
      "orientation",
      "min",
      "max",
      "barWidth",
      "categoryGapPercent",
      "cornerRadius",
      "trackCornerRadius",
      "segmentDivisor",
      "segmentSpacingPercent",
      "segmentFill",
      "showAxes",
      ...ANIMATION_PROPERTIES,
    ],
    pie: [
      "innerRadiusPercent",
      "outerRadiusPercent",
      "startAngle",
      "endAngle",
      "padAngle",
      "cornerRadius",
      "segmentDivisor",
      "segmentSpacingPercent",
      "total",
      "total.value",
      ...ANIMATION_PROPERTIES,
    ],
    radar: [
      "min",
      "max",
      "shape",
      "splitNumber",
      "lineWidth",
      "showMarkers",
      "markerSize",
      "showAxes",
      ...ANIMATION_PROPERTIES,
    ],
    polarBar: [
      "startAngle",
      "innerRadiusPercent",
      "outerRadiusPercent",
      "min",
      "max",
      "barWidth",
      "categoryGapPercent",
      "cornerRadius",
      "trackCornerRadius",
      "showAxes",
      ...ANIMATION_PROPERTIES,
    ],
  };

  for (const family of CHART_FAMILIES) {
    it(`keeps ${family}'s settings in their authored order`, () => {
      expect(settingsFieldsFor(family).map((field) => field.property)).toEqual(
        expected[family],
      );
    });
  }

  const expectedPaint: Record<ChartFamily, readonly string[]> = {
    gauge: ["track", "progress"],
    line: ["stroke", "palette", "area"],
    bar: ["fill", "track"],
    pie: ["remainderFill", "palette"],
    radar: ["stroke", "area"],
    polarBar: ["fill", "track"],
  };

  for (const family of CHART_FAMILIES) {
    it(`keeps ${family}'s paint fields in their authored order`, () => {
      expect(
        chartPaintFieldsFor(family).map((field) => field.property),
      ).toEqual(expectedPaint[family]);
    });
  }
});

describe("the two settings one level down", () => {
  it("keeps pie's fixed total directly below the tag it depends on", () => {
    const properties = settingsFieldsFor("pie").map((field) => field.property);
    const tag = properties.indexOf("total");

    expect(tag).toBeGreaterThan(-1);
    expect(properties[tag + 1]).toBe("total.value");
  });

  it("writes the total through its nested path, and asks for the number only when fixed", () => {
    const total = settingsFieldsFor("pie").find((f) => f.property === "total");
    const value = settingsFieldsFor("pie").find(
      (f) => f.property === "total.value",
    );

    expect(total?.path).toEqual(["total", "kind"]);
    expect(total?.options?.map((option) => option.value)).toEqual([
      "sum",
      "fixed",
    ]);
    expect(total?.options?.map((option) => option.label)).toEqual([
      "Sum of the parts",
      "A fixed total",
    ]);
    expect(value?.path).toEqual(["total", "value"]);
    expect(value?.visibleWhen).toEqual({
      path: ["total", "kind"],
      equals: "fixed",
    });
  });

  it("declares the spacing as a share of the chart and the fill as a mode", () => {
    const spacing = settingsFieldsFor("gauge").find(
      (field) => field.property === "segmentSpacingPercent",
    );
    expect(spacing?.kind).toBe("number");
    expect(spacing?.min).toBe(0);
    expect(spacing?.max).toBe(20);

    const fill = settingsFieldsFor("bar").find(
      (field) => field.property === "segmentFill",
    );
    expect(fill?.kind).toBe("select");
    expect(fill?.options?.map((option) => option.value)).toEqual([
      "whole",
      "partial",
    ]);
    expect(fill?.visibleWhen).toEqual({
      path: ["segmentDivisor"],
      notEquals: "100",
    });
  });

  it("declares the same four animation fields for every family", () => {
    for (const family of CHART_FAMILIES) {
      const animation = settingsFieldsFor(family).filter((field) =>
        field.property.startsWith("animation."),
      );

      expect(animation.map((field) => field.property)).toEqual([
        "animation.durationMs",
        "animation.easing",
        "animation.appearMs",
        "animation.appearEasing",
      ]);
      expect(animation.every((field) => field.section === "layer")).toBe(true);
      expect(animation.every((field) => field.path?.[0] === "animation")).toBe(
        true,
      );
      // The obscure half is collapsed and counted, never removed.
      expect(
        animation.filter((field) => field.advanced).map((f) => f.property),
      ).toEqual(["animation.appearMs", "animation.appearEasing"]);
    }
  });

  it("names every easing for an author rather than showing its identifier", () => {
    for (const family of CHART_FAMILIES) {
      for (const property of ["animation.easing", "animation.appearEasing"]) {
        const field = settingsFieldsFor(family).find(
          (f) => f.property === property,
        );

        expect(field?.kind).toBe("select");
        expect(field?.options?.map((option) => option.value)).toEqual([
          ...ANIMATION_EASINGS,
        ]);
        expect(
          field?.options?.every((option) => option.label.trim().length > 0),
        ).toBe(true);
        expect(
          field?.options?.every((option) => option.label !== option.value),
        ).toBe(true);
      }
    }
  });
});

describe("settingsKeyFor", () => {
  it("derives the key the validator and schema already use", () => {
    expect(settingsKeyFor("gauge")).toBe("gaugeSettings");
    expect(settingsKeyFor("pie")).toBe("pieSettings");
  });
});
