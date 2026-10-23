import { describe, expect, it } from "vitest";
import {
  type IssueCode,
  namedEnvelope,
  type ValidationIssue,
  validateEnvelopeSemantics,
} from "./envelope-semantics.js";
import type { FabricThemeEnvelope } from "./fabric-envelope.js";

/**
 * The Yunari-owned half of an envelope, decided without Fabric.
 *
 * These are the cases that outlived the retired v1 document validator: the
 * semantic checks over metadata, id, artboard, globals, assets and background
 * media are the ones a v2 envelope still runs, so their coverage moves here
 * rather than dying with the format that used to host them.
 */

/** A minimal valid envelope. Tests mutate clones of this. */
function baseEnvelope(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    fabricVersion: "7.4.0",
    id: "demo-theme",
    metadata: { themeLanguage: "en" },
    artboard: { width: 1920, height: 1080, contentFit: "contain" },
    scene: { version: "7.4.0", objects: [] },
  };
}

function issuesFor(input: Record<string, unknown>): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  validateEnvelopeSemantics(input, issues);
  return issues;
}

/** Collects issue codes so assertions name the rule rather than the message. */
function codes(input: Record<string, unknown>): IssueCode[] {
  return issuesFor(input).map((issue) => issue.code);
}

function expectValid(input: Record<string, unknown>): void {
  const issues = issuesFor(input);
  if (issues.length > 0) {
    throw new Error(
      `Expected a valid envelope, got: ${JSON.stringify(issues, null, 2)}`,
    );
  }
}

describe("artboard", () => {
  it("requires positive, bounded dimensions", () => {
    expect(
      codes({ ...baseEnvelope(), artboard: { width: 0, height: 1080 } }),
    ).toContain("out-of-range");
    expect(
      codes({ ...baseEnvelope(), artboard: { width: 100, height: 99999 } }),
    ).toContain("out-of-range");
  });

  it("rejects a non-numeric dimension", () => {
    expect(
      codes({ ...baseEnvelope(), artboard: { width: "1920", height: 1080 } }),
    ).toContain("wrong-type");
  });

  it("rejects an unknown content fit", () => {
    expect(
      codes({
        ...baseEnvelope(),
        artboard: { width: 10, height: 10, contentFit: "stretch" },
      }),
    ).toContain("invalid-enum");
  });

  it("refuses the superseded fitMode name rather than ignoring it", () => {
    // Pre-release, so the old key dies with the rename instead of being read as
    // a second, quieter way to say the same thing. A silent drop would let a
    // theme that asks for a crop open letterboxed and blame the player.
    expect(
      codes({
        ...baseEnvelope(),
        artboard: { width: 10, height: 10, fitMode: "cover" },
      }),
    ).toContain("unknown-field");
  });
});

describe("background paint", () => {
  const withPaint = (
    color: Record<string, unknown>,
  ): Record<string, unknown> => ({
    ...baseEnvelope(),
    globals: { palette: { accent: { name: "Accent", value: "#00b8d9" } } },
    background: { color },
  });

  it("accepts a resolvable palette reference", () => {
    expectValid(withPaint({ ref: "palette.accent" }));
  });

  it("rejects a reference and a literal together", () => {
    // Resolving by precedence is how a theme ends up showing a colour nobody
    // can find in the inspector.
    expect(codes(withPaint({ ref: "palette.accent", value: "#fff" }))).toEqual([
      "style-value-ambiguous",
    ]);
  });

  it("rejects a style value that declares neither", () => {
    expect(codes(withPaint({}))).toEqual(["style-value-ambiguous"]);
  });

  it("rejects a reference to a global that does not exist", () => {
    expect(codes(withPaint({ ref: "palette.missing" }))).toEqual([
      "unresolved-global-ref",
    ]);
  });

  it("rejects a reference into an unknown group", () => {
    expect(codes(withPaint({ ref: "colours.accent" }))).toEqual([
      "unresolved-global-ref",
    ]);
  });

  it("rejects a reference with no entry id", () => {
    expect(codes(withPaint({ ref: "palette" }))).toEqual([
      "unresolved-global-ref",
    ]);
  });
});

describe("globals", () => {
  it("rejects an unknown group", () => {
    expect(codes({ ...baseEnvelope(), globals: { shadows: {} } })).toEqual([
      "invalid-enum",
    ]);
  });

  it("requires a display name and a value on every entry", () => {
    expect(
      codes({
        ...baseEnvelope(),
        globals: { palette: { accent: { name: "" } } },
      }),
    ).toContain("missing-field");
  });

  it("rejects an entry id that is not a stable id", () => {
    expect(
      codes({
        ...baseEnvelope(),
        globals: { palette: { "not valid": { name: "x", value: 1 } } },
      }),
    ).toContain("invalid-id");
  });

  it("accepts a typed preset and refuses a malformed one", () => {
    expectValid({
      ...baseEnvelope(),
      globals: {
        typePresets: {
          body: {
            name: "Body",
            value: {
              family: "Inter",
              size: 16,
              weight: 500,
              letterSpacing: 0.2,
              lineHeight: 1.2,
            },
          },
        },
      },
    });

    expect(
      codes({
        ...baseEnvelope(),
        globals: {
          typePresets: {
            body: { name: "Body", value: { family: "", size: 0 } },
          },
        },
      }),
    ).toEqual(expect.arrayContaining(["missing-field", "out-of-range"]));
  });
});

describe("metadata and identity", () => {
  it("rejects an unknown metadata property", () => {
    expect(
      codes({
        ...baseEnvelope(),
        metadata: { themeLanguage: "en", locale: "en" },
      }),
    ).toEqual(["unknown-field"]);
  });

  it("rejects a release version that is not semantic", () => {
    expect(
      codes({
        ...baseEnvelope(),
        metadata: { themeLanguage: "en", version: "v1" },
      }),
    ).toEqual(["wrong-type"]);
  });

  it("rejects an id that is not a stable id", () => {
    expect(codes({ ...baseEnvelope(), id: "!! not valid !!" })).toEqual([
      "invalid-id",
    ]);
  });
});

describe("assets (§141)", () => {
  const withAssets = (assets: unknown[]): Record<string, unknown> => ({
    ...baseEnvelope(),
    assets,
  });

  it("accepts a package-relative path", () => {
    expectValid(
      withAssets([{ id: "logo", kind: "image", path: "assets/logo.png" }]),
    );
  });

  it("rejects a traversal segment", () => {
    // The schema's own path pattern permits dots, so it does NOT reject this on
    // its own. This check is the one that actually holds.
    expect(
      codes(
        withAssets([
          { id: "bad", kind: "image", path: "assets/../../secrets.env" },
        ]),
      ),
    ).toEqual(["invalid-asset-path"]);
  });

  it("rejects an absolute path and one outside assets/", () => {
    expect(
      codes(withAssets([{ id: "a", kind: "image", path: "/etc/passwd" }])),
    ).toEqual(["invalid-asset-path"]);
    expect(
      codes(
        withAssets([{ id: "a", kind: "image", path: "elsewhere/logo.png" }]),
      ),
    ).toEqual(["invalid-asset-path"]);
  });

  it("rejects an unknown asset kind", () => {
    expect(
      codes(
        withAssets([{ id: "a", kind: "executable", path: "assets/a.exe" }]),
      ),
    ).toEqual(["invalid-enum"]);
  });

  it("rejects a malformed sha256", () => {
    expect(
      codes(
        withAssets([
          { id: "a", kind: "image", path: "assets/a.png", sha256: "ABC" },
        ]),
      ),
    ).toEqual(["wrong-type"]);
  });

  it("rejects a duplicate asset id", () => {
    expect(
      codes(
        withAssets([
          { id: "a", kind: "image", path: "assets/a.png" },
          { id: "a", kind: "image", path: "assets/b.png" },
        ]),
      ),
    ).toEqual(["duplicate-id"]);
  });
});

describe("the background layer", () => {
  const withBackground = (background: unknown): Record<string, unknown> => ({
    ...baseEnvelope(),
    globals: {
      palette: {
        ink: { name: "Ink", value: { kind: "solid", color: "#101216" } },
      },
    },
    assets: [{ id: "clip", kind: "video", path: "assets/clip.mp4" }],
    background,
  });

  it("accepts bounds, flips and offsets", () => {
    expect(
      codes(
        withBackground({
          color: { ref: "palette.ink" },
          media: {
            assetId: "clip",
            bounds: "display",
            flipX: true,
            flipY: false,
            offsetX: 0.25,
            offsetY: -0.1,
          },
        }),
      ),
    ).toEqual([]);
  });

  it("refuses the removed fit and scale, and an out-of-range offset", () => {
    // `cover` is not a field any more but the whole model, and a scale is the
    // control that could shrink the media below its box. Both are refused by
    // the key bag (`unknown-field`), not read and ignored.
    for (const background of [
      { media: { assetId: "clip", bounds: "theme", fit: "contain" } },
      { media: { assetId: "clip", bounds: "theme", scale: 1.4 } },
    ])
      expect(codes(withBackground(background))).toContain("unknown-field");
    for (const background of [
      { media: { assetId: "clip", bounds: "theme", offsetX: 2 } },
      { media: { assetId: "clip", bounds: "theme", offsetY: -2 } },
    ])
      expect(codes(withBackground(background))).toContain("out-of-range");
  });

  it("refuses a flip that is not a boolean", () => {
    expect(
      codes(
        withBackground({
          media: { assetId: "clip", bounds: "theme", flipX: "yes" },
        }),
      ),
    ).toContain("wrong-type");
  });

  it("refuses an unknown key on the background and on its media", () => {
    expect(codes(withBackground({ rotation: 1 }))).toContain("unknown-field");
    expect(
      codes(
        withBackground({
          media: { assetId: "clip", bounds: "theme", rotation: 1 },
        }),
      ),
    ).toContain("unknown-field");
  });

  it("does not offer a removed media key as a misspelling of a live one", () => {
    // `fit` is three edits from `flipX`: close enough for a distance-only
    // suggestion to name a mirror instead of saying the key is gone.
    const issue = issuesFor(
      withBackground({
        media: { assetId: "clip", bounds: "theme", fit: "contain" },
      }),
    ).find((candidate) => candidate.code === "unknown-field");
    expect(issue?.message).not.toContain("Did you mean");
  });

  it("refuses media with no bounds", () => {
    // `bounds` decides which box the layer is placed in, so a media with no
    // bounds has no placement; the enum check is what refuses it.
    expect(codes(withBackground({ media: { assetId: "clip" } }))).toContain(
      "invalid-enum",
    );
  });

  it("refuses the old artboard keys", () => {
    // Both removed keys are refused by name: `background` was the colour and
    // `backgroundMedia` its media, and `schemaVersion` stays 2 precisely
    // because an old document is rejected here rather than silently read with
    // its background dropped.
    for (const artboard of [
      { width: 10, height: 10, background: { ref: "palette.ink" } },
      { width: 10, height: 10, backgroundMedia: { assetId: "clip" } },
    ]) {
      expect(codes({ ...baseEnvelope(), artboard })).toContain("unknown-field");
    }
  });

  it("requires the media to resolve to an image, SVG or video", () => {
    expect(
      codes({
        ...baseEnvelope(),
        assets: [{ id: "clip", kind: "gif", path: "assets/a.gif" }],
        background: { media: { assetId: "clip", bounds: "theme" } },
      }),
    ).toContain("unresolved-asset-ref");
  });
});

describe("naming a document that carries none", () => {
  it("supplies the document's own id, and never renames a named theme", () => {
    const nameless = baseEnvelope() as unknown as FabricThemeEnvelope;
    expect(namedEnvelope(nameless).metadata?.name).toBe("demo-theme");

    const named = {
      ...baseEnvelope(),
      metadata: { themeLanguage: "en", name: "Kitchen" },
    } as unknown as FabricThemeEnvelope;
    const again = namedEnvelope(named);

    expect(again.metadata?.name).toBe("Kitchen");
    // Returned as it is rather than rebuilt, so the label is stable across
    // loads: a second load cannot rename a theme the author already named.
    expect(again).toBe(named);
  });

  it("names a document whose stored name is not a string at all", () => {
    // A foreign `theme.json` can carry `null` here, and the loader is the last
    // place a stored document is allowed to stop loading: reading the name as
    // "present" rather than as a string threw out of it, and the store's
    // listing catches to `[]`, so one such document emptied the library.
    const nullName = {
      ...baseEnvelope(),
      metadata: { themeLanguage: "en", name: null },
    } as unknown as FabricThemeEnvelope;

    expect(namedEnvelope(nullName).metadata?.name).toBe("demo-theme");
  });
});

describe("issue reporting", () => {
  it("accumulates every issue rather than stopping at the first", () => {
    // Import UX needs the whole list; fixing one problem at a time through
    // repeated imports is the experience this avoids.
    const issues = issuesFor({
      ...baseEnvelope(),
      id: "!! not valid !!",
      artboard: { width: -1, height: -1 },
      assets: [{ id: "a", kind: "image", path: "/etc/passwd" }],
    });

    expect(issues.length).toBeGreaterThanOrEqual(4);
  });

  it("points at the fault with a JSON pointer", () => {
    expect(
      issuesFor({
        ...baseEnvelope(),
        background: { color: { ref: "palette.x" } },
      })[0]!.path,
    ).toBe("/background/color/ref");
  });
});
