import { describe, expect, it } from "vitest";

import { CHART_FAMILIES, type ChartFamily } from "../theme/document.js";
import type { Sample } from "../types.js";
import { defaultGaugeSettings } from "../types.js";
import { defaultAnimationSettings } from "./animation.js";
import { defaultBarSettings } from "./bar.js";
import { defaultLineSettings } from "./line.js";
import {
  buildPieOption,
  computeComposition,
  defaultPieSettings,
} from "./pie.js";
import { defaultPolarBarSettings } from "./polar-bar.js";
import { defaultRadarSettings } from "./radar.js";
import { settingsFieldsFor } from "./settings-fields.js";
import { readSetting, writeSetting } from "./settings-path.js";

/** Write the field the table declares, through the path it declares. */
function writeField<T extends object>(
  settings: T,
  family: ChartFamily,
  property: string,
  value: unknown,
): T {
  const field = settingsFieldsFor(family).find((f) => f.property === property);

  if (field === undefined) {
    throw new Error(`no ${property} descriptor for ${family}`);
  }

  return writeSetting(settings, field.path ?? [field.property], value);
}

/** Read the field the table declares, through the path it declares. */
function readField(
  settings: object,
  family: ChartFamily,
  property: string,
): unknown {
  const field = settingsFieldsFor(family).find((f) => f.property === property);

  if (field === undefined) {
    throw new Error(`no ${property} descriptor for ${family}`);
  }

  return readSetting(settings, field.path ?? [field.property]);
}

function sample(value: number, sensorId: string): Sample {
  return {
    sensorId,
    timestamp: "2026-01-01T00:00:00Z",
    status: "ok",
    value,
    unit: "GB",
  };
}

describe("readSetting", () => {
  it("returns undefined for an absent parent, one level and two levels deep", () => {
    // `defaultPieSettings` has no `animation` block: the parent is absent, so
    // both the block and its fields answer undefined rather than a default.
    expect(readSetting(defaultPieSettings, ["animation"])).toBeUndefined();
    expect(
      readSetting(defaultPieSettings, ["animation", "durationMs"]),
    ).toBeUndefined();
    expect(
      readSetting(defaultPieSettings, ["animation", "easing"]),
    ).toBeUndefined();
  });

  it("returns undefined for a key a present parent does not have", () => {
    expect(readSetting(defaultPieSettings, ["total", "value"])).toBeUndefined();
    expect(readSetting(defaultPieSettings, ["total", "kind"])).toBe("sum");
  });

  it("does not throw when the settings themselves are absent", () => {
    expect(readSetting(undefined, ["animation", "durationMs"])).toBeUndefined();
  });
});

describe("writeSetting", () => {
  it("returns a new object and leaves the argument alone", () => {
    const next = writeSetting(defaultPieSettings, ["innerRadiusPercent"], 40);

    expect(next).not.toBe(defaultPieSettings);
    expect(next.innerRadiusPercent).toBe(40);
    expect(defaultPieSettings.innerRadiusPercent).toBe(60);
  });

  it("materialises the animation block whole from its own owner's defaults", () => {
    const next = writeField(
      defaultPieSettings,
      "pie",
      "animation.durationMs",
      2000,
    );

    // The author's one field plus the other three from `charts/animation.ts` —
    // never a partial block, and never a default declared in the table.
    expect(next.animation).toEqual({
      ...defaultAnimationSettings,
      durationMs: 2000,
    });
    expect(Object.keys(next.animation ?? {}).sort()).toEqual([
      "appearEasing",
      "appearMs",
      "durationMs",
      "easing",
    ]);
    expect("animation" in defaultPieSettings).toBe(false);
    expect(readSetting(next, ["animation", "easing"])).toBe(
      defaultAnimationSettings.easing,
    );
  });

  it("keeps the block's other fields when one of them is written", () => {
    const authored = writeField(
      writeField(defaultPieSettings, "pie", "animation.appearMs", 800),
      "pie",
      "animation.easing",
      "quinticInOut",
    );

    expect(authored.animation).toEqual({
      ...defaultAnimationSettings,
      appearMs: 800,
      easing: "quinticInOut",
    });
  });
});

describe("the pie's total is a union, and the writes respect it", () => {
  it("drops `value` when the total goes back to the sum of the parts", () => {
    const fixed = writeField(
      writeField(defaultPieSettings, "pie", "total", "fixed"),
      "pie",
      "total.value",
      64,
    );
    expect(readSetting(fixed, ["total"])).toEqual({ kind: "fixed", value: 64 });

    const summed = writeField(fixed, "pie", "total", "sum");

    // A sibling the union does not have is a document that validates and lies.
    expect(summed.total).toEqual({ kind: "sum" });
    expect(readSetting(summed, ["total", "value"])).toBeUndefined();
  });

  it("leaves `value` absent, not zero, when the tag is fixed with no number", () => {
    const fixed = writeField(defaultPieSettings, "pie", "total", "fixed");

    expect(fixed.total).toEqual({ kind: "fixed" });
    expect(readSetting(fixed, ["total", "value"])).toBeUndefined();
  });
});

describe("Review Focus 1 — a descriptor that writes nowhere must fail", () => {
  it("makes the renderer see the author's fixed total", () => {
    const authored = writeField(
      writeField(defaultPieSettings, "pie", "total", "fixed"),
      "pie",
      "total.value",
      64,
    );

    // The real composition, not a restatement: the path the descriptor declares
    // has to be the path `computeComposition` reads, or the remainder is never
    // measurable however many controls the column gains.
    const composition = computeComposition(authored, [
      { sensorId: "ram.used", sample: sample(20, "ram.used") },
      { sensorId: "ram.cached", sample: sample(12, "ram.cached") },
    ]);

    expect(composition.knownTotal).toBe(32);
    expect(composition.remainder).toBe(64 - 32);
    expect(composition.whole).toBe(64);
    expect(composition.overflow).toBe(false);
  });

  it("hands that value back through the descriptor's own path", () => {
    const authored = writeField(
      writeField(defaultPieSettings, "pie", "total", "fixed"),
      "pie",
      "total.value",
      64,
    );

    expect(readField(authored, "pie", "total")).toBe("fixed");
    expect(readField(authored, "pie", "total.value")).toBe(64);
  });

  it("makes the fixed-total field visible exactly in the state it applies to", () => {
    const field = settingsFieldsFor("pie").find(
      (f) => f.property === "total.value",
    );

    if (field?.visibleWhen === undefined) {
      throw new Error("total.value declares no visibleWhen");
    }

    expect(readSetting(defaultPieSettings, field.visibleWhen.path)).not.toBe(
      field.visibleWhen.equals,
    );
    expect(
      readSetting(
        writeField(defaultPieSettings, "pie", "total", "fixed"),
        field.visibleWhen.path,
      ),
    ).toBe(field.visibleWhen.equals);
  });
});

describe("Review Focus 3 — the nested write round-trips through the option builder", () => {
  it("is what the pie's engine option reads, for all four fields", () => {
    let authored = defaultPieSettings;
    authored = writeField(authored, "pie", "animation.durationMs", 2400);
    authored = writeField(authored, "pie", "animation.easing", "quinticInOut");
    authored = writeField(authored, "pie", "animation.appearMs", 800);
    authored = writeField(
      authored,
      "pie",
      "animation.appearEasing",
      "cubicInOut",
    );

    // A flat `{...settings, [property]: value}` commit passes a naive assertion
    // on the settings object and dies here: the builder reads `settings.animation`,
    // which that commit never creates.
    const option = buildPieOption(authored, []);

    expect(option.animationDurationUpdate).toBe(2400);
    expect(option.animationEasingUpdate).toBe("quinticInOut");
    expect(option.animationDuration).toBe(800);
    expect(option.animationEasing).toBe("cubicInOut");
  });

  it("lands where the descriptor says, for every family", () => {
    const defaults: Record<ChartFamily, object> = {
      gauge: defaultGaugeSettings,
      line: defaultLineSettings,
      bar: defaultBarSettings,
      pie: defaultPieSettings,
      radar: defaultRadarSettings,
      polarBar: defaultPolarBarSettings,
    };

    for (const family of CHART_FAMILIES) {
      const authored = writeField(
        defaults[family],
        family,
        "animation.easing",
        "cubicOut",
      );

      expect(readField(authored, family, "animation.easing")).toBe("cubicOut");
      expect(readSetting(authored, ["animation", "appearEasing"])).toBe(
        defaultAnimationSettings.appearEasing,
      );
    }
  });
});
