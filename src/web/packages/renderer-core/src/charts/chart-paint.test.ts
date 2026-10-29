import { describe, expect, it } from "vitest";
import {
  reassignChartPaintReferences,
  resolveChartPaint,
} from "./chart-paint.js";

const palette = {
  none: {
    name: "None",
    value: { kind: "solid" as const, color: "transparent" },
  },
  accent: {
    name: "Accent",
    value: { kind: "solid" as const, color: "#00b8d9" },
  },
  glow: {
    name: "Glow",
    value: {
      kind: "gradient" as const,
      angle: 45,
      stops: [
        { offset: 0, color: "#00b8d9" },
        { offset: 1, color: "#6554c0" },
      ],
    },
  },
};

describe("chart paint", () => {
  it("resolves palette paint only while deriving engine input", () => {
    expect(resolveChartPaint({ ref: "palette.glow" }, palette)).toEqual({
      kind: "gradient",
      stops: palette.glow.value.stops,
    });
  });

  it("resolves threshold bands through solid palette tokens", () => {
    expect(
      resolveChartPaint(
        { kind: "thresholds", bands: [{ offset: 0.5, ref: "palette.accent" }] },
        palette,
      ),
    ).toEqual({
      kind: "thresholds",
      bands: [{ offset: 0.5, color: "#00b8d9" }],
    });
  });

  // A gap and a transparent fill look identical on screen and are not the same
  // fact, so the resolver has to say which one it produced.
  it("resolves a reference with no palette entry to no paint at all", () => {
    expect(
      resolveChartPaint({ ref: "palette.absent" }, palette),
    ).toBeUndefined();
    expect(
      resolveChartPaint({ ref: "palette.absent" }, undefined),
    ).toBeUndefined();
    expect(
      resolveChartPaint(
        { kind: "thresholds", bands: [{ offset: 1, ref: "palette.absent" }] },
        palette,
      ),
    ).toBeUndefined();
  });

  it("keeps resolving a palette entry whose value is transparent", () => {
    // An author may genuinely ask for no ink. That is a colour they chose, so
    // it resolves like any other and only the missing entry is a gap.
    expect(resolveChartPaint({ ref: "palette.none" }, palette)).toEqual({
      kind: "solid",
      color: "transparent",
    });
  });

  it("reassigns token references in chart settings before a palette deletion", () => {
    const settings = {
      track: { ref: "palette.old" },
      progress: {
        kind: "thresholds" as const,
        bands: [{ offset: 1, ref: "palette.old" }],
      },
    };
    expect(
      reassignChartPaintReferences(settings, "palette.old", "palette.new"),
    ).toEqual({
      track: { ref: "palette.new" },
      progress: {
        kind: "thresholds",
        bands: [{ offset: 1, ref: "palette.new" }],
      },
    });
  });
});
