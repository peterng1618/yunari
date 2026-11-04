import { describe, expect, it } from "vitest";
import {
  type IssueCode,
  type ValidationIssue,
  validateEnvelopeSemantics,
} from "./envelope-semantics.js";

/**
 * Background modes.
 *
 * A theme authored before composition existed declares no mode and must keep
 * the basic background: a hard-edged media cover, a colour behind it. The
 * composition keys are refused rather than ignored while the mode is basic, so
 * a document can never claim one model and carry another.
 */

function envelope(
  background: Record<string, unknown>,
): Record<string, unknown> {
  return {
    schemaVersion: "2.0.0",
    fabricVersion: "7.4.0",
    id: "demo-theme",
    metadata: { themeLanguage: "en" },
    artboard: { width: 1920, height: 1080, contentFit: "contain" },
    scene: { version: "7.4.0", objects: [] },
    globals: {
      palette: {
        ink: { name: "Ink", value: { kind: "solid", color: "#101216" } },
      },
    },
    assets: [{ id: "clip", kind: "video", path: "assets/clip.mp4" }],
    background,
  };
}

function codes(background: Record<string, unknown>): IssueCode[] {
  const issues: ValidationIssue[] = [];
  validateEnvelopeSemantics(envelope(background), issues);
  return issues.map((issue) => issue.code);
}

const MEDIA = { assetId: "clip", bounds: "theme" } as const;

describe("background modes", () => {
  it("reads an absent mode as basic", () => {
    expect(codes({ color: { ref: "palette.ink" }, media: MEDIA })).toEqual([]);
  });

  it("accepts a basic background that says so", () => {
    expect(codes({ mode: "basic", media: MEDIA })).toEqual([]);
  });

  it("accepts the composition keys under advanced", () => {
    expect(
      codes({
        mode: "advanced",
        fill: { ref: "palette.ink" },
        media: {
          ...MEDIA,
          region: {
            left: 0.5,
            blend: { shape: "linear", edge: "left", length: 0.1 },
          },
        },
      }),
    ).toEqual([]);
  });

  it("refuses a fill while the mode is basic", () => {
    expect(codes({ fill: { ref: "palette.ink" } })).toContain(
      "composition-needs-advanced",
    );
    expect(codes({ mode: "basic", fill: { ref: "palette.ink" } })).toContain(
      "composition-needs-advanced",
    );
  });

  it("refuses a region while the mode is basic", () => {
    expect(codes({ media: { ...MEDIA, region: { left: 0.5 } } })).toContain(
      "composition-needs-advanced",
    );
  });

  it("refuses a fill with no media to sit behind", () => {
    expect(codes({ mode: "advanced", fill: { ref: "palette.ink" } })).toContain(
      "fill-needs-media",
    );
  });

  it("refuses an unknown mode rather than treating it as advanced", () => {
    expect(codes({ mode: "fancy", media: MEDIA })).toContain("invalid-enum");
  });
});
