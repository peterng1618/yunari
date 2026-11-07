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
 * the simple background: a hard-edged media cover, a colour behind it. The
 * composition keys are refused rather than ignored while the mode is simple, so
 * a document can never claim one model and carry another.
 */

function envelope(
  background: Record<string, unknown>,
): Record<string, unknown> {
  return {
    schemaVersion: "2.1.0",
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
  it("reads an absent mode as simple", () => {
    expect(
      codes({
        media: { ...MEDIA, color: { ref: "palette.ink" } },
      }),
    ).toEqual([]);
  });

  it("accepts a simple background that says so", () => {
    expect(codes({ mode: "simple", media: MEDIA })).toEqual([]);
  });

  it("accepts the composition keys under advanced", () => {
    expect(
      codes({
        mode: "advanced",
        media: {
          ...MEDIA,
          composition: { anchor: "left", extent: 0.5, fade: 0.1 },
        },
      }),
    ).toEqual([]);
  });

  it("refuses a composition while the mode is simple", () => {
    expect(
      codes({ media: { ...MEDIA, composition: { anchor: "left" } } }),
    ).toContain("composition-needs-advanced");
  });

  it("refuses an unknown anchor, extent and fade", () => {
    expect(
      codes({
        mode: "advanced",
        media: {
          ...MEDIA,
          composition: { anchor: "middle", extent: 1.01, fade: 2 },
        },
      }),
    ).toEqual(
      expect.arrayContaining(["invalid-enum", "out-of-range", "out-of-range"]),
    );
  });

  it("refuses an unknown mode rather than treating it as advanced", () => {
    expect(codes({ mode: "fancy", media: MEDIA })).toContain("invalid-enum");
  });
});
