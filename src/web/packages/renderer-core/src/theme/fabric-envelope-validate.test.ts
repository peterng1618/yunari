import { describe, expect, it } from "vitest";
import { isThemeRemix } from "./document.js";
import type { ValidationIssue } from "./envelope-semantics.js";
import {
  type FabricEnvelopeValidationResult,
  validateFabricThemeEnvelope,
} from "./fabric-envelope-validate.js";
import { MAX_OBJECT_NAME_LENGTH } from "./object-name.js";

function withMetadata(
  base: Record<string, unknown>,
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  return { ...base, metadata };
}

function withoutKey(
  base: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const copy = { ...base };
  delete copy[key];
  return copy;
}

function issuesOf(
  result: FabricEnvelopeValidationResult,
): readonly ValidationIssue[] {
  return result.ok ? [] : result.issues;
}

function envelope(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    fabricVersion: "7.4.0",
    id: "theme",
    metadata: { themeLanguage: "en" },
    artboard: { width: 400, height: 300 },
    bindings: { chart: [{ id: "cpu", semanticKey: "cpu.load", precision: 0 }] },
    scene: {
      version: "7.4.0",
      objects: [
        {
          type: "YunariChart",
          id: "chart",
          objects: [{ type: "Rect", id: "child" }],
        },
      ],
    },
  };
}

function chartEnvelope(
  family: string,
  settings: unknown,
): Record<string, unknown> {
  return {
    ...envelope(),
    scene: {
      version: "7.4.0",
      objects: [{ type: "YunariChart", id: "chart", family, settings }],
    },
  };
}

function fontAsset(id: string, weight: number): Record<string, unknown> {
  return {
    id,
    kind: "font",
    path: `assets/${id}.woff2`,
    family: "Inter",
    weight,
    style: "normal",
    format: "woff2",
    sourceUrl:
      "https://cdn.jsdelivr.net/fontsource/fonts/inter@5.1.1/latin-400-normal.woff2",
    license: {
      name: "SIL Open Font License 1.1",
      url: "https://openfontlicense.org/",
    },
  };
}

function envelopeWithFontRoles(): Record<string, unknown> {
  return {
    ...envelope(),
    assets: [
      fontAsset("heading-face", 700),
      fontAsset("body-face", 400),
      fontAsset("mono-face", 400),
    ],
    globals: {
      typePresets: {
        heading: {
          name: "Heading",
          value: {
            family: "Inter",
            size: 32,
            weight: 700,
            face: { assetId: "heading-face" },
            trioRole: "heading",
          },
        },
        metric: {
          name: "Metric",
          value: {
            family: "Inter",
            size: 48,
            weight: 700,
            face: { assetId: "heading-face" },
            trioRole: "heading",
          },
        },
        body: {
          name: "Body",
          value: {
            family: "Inter",
            size: 16,
            face: { assetId: "body-face" },
            trioRole: "body",
          },
        },
        mono: {
          name: "Mono",
          value: {
            family: "Inter",
            size: 14,
            face: { assetId: "mono-face" },
            trioRole: "mono",
          },
        },
      },
    },
  };
}

describe("Fabric theme envelope validation", () => {
  it("accepts a bounded Fabric scene with identities and semantic bindings", () => {
    expect(validateFabricThemeEnvelope(envelope())).toMatchObject({ ok: true });
  });

  it("accepts one declared background image or video and a semantic release version", () => {
    expect(
      validateFabricThemeEnvelope({
        ...envelope(),
        metadata: { version: "1.2.3", themeLanguage: "en" },
        background: { media: { assetId: "clip", bounds: "theme" } },
        assets: [{ id: "clip", kind: "video", path: "assets/clip.mp4" }],
      }),
    ).toMatchObject({ ok: true });
  });

  it("rejects malformed versions and invalid background-media references", () => {
    const result = validateFabricThemeEnvelope({
      ...envelope(),
      metadata: { version: "v1.2.3", themeLanguage: "en" },
      background: {
        media: { assetId: "font", bounds: "stretch" },
      },
      assets: [{ id: "font", kind: "font", path: "assets/body.woff2" }],
    });

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ path: "/metadata/version" }),
        expect.objectContaining({ path: "/background/media/bounds" }),
        expect.objectContaining({ path: "/background/media/assetId" }),
      ]),
    });
  });

  it("reports an unknown version alone before interpreting the envelope", () => {
    const result = validateFabricThemeEnvelope({
      ...envelope(),
      schemaVersion: 3,
      artboard: "wrong",
    });

    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "newer-schema-version", path: "/schemaVersion" }],
    });
    if (!result.ok) expect(result.issues).toHaveLength(1);
  });

  it("rejects unknown envelope fields and malformed Fabric scene state", () => {
    const result = validateFabricThemeEnvelope({
      ...envelope(),
      unexpected: true,
      scene: {
        version: "7.4.0",
        objects: [{ type: "Rect", id: "x", width: Number.POSITIVE_INFINITY }],
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "unknown-field",
            path: "/unexpected",
          }),
          expect.objectContaining({
            code: "invalid-fabric-scene",
            path: "/scene/objects/0/width",
          }),
        ]),
      );
    }
  });

  it("rejects anonymous or duplicate Fabric objects and malformed bindings", () => {
    const result = validateFabricThemeEnvelope({
      ...envelope(),
      bindings: {
        chart: [
          { id: "same", semanticKey: "" },
          { id: "same", semanticKey: "gpu.load" },
        ],
      },
      scene: {
        version: "7.4.0",
        objects: [
          { type: "Rect", id: "same" },
          { type: "Rect", id: "same" },
          { type: "Rect" },
        ],
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "duplicate-id",
            path: "/bindings/chart/1/id",
          }),
          expect.objectContaining({
            code: "missing-field",
            path: "/bindings/chart/0/semanticKey",
          }),
          expect.objectContaining({
            code: "duplicate-id",
            path: "/scene/objects/1/id",
          }),
          expect.objectContaining({
            code: "invalid-id",
            path: "/scene/objects/2/id",
          }),
        ]),
      );
    }
  });

  it("keeps shared semantics valid while refusing obsolete GIF assets", () => {
    const result = validateFabricThemeEnvelope({
      ...envelope(),
      metadata: { name: "Valid", themeLanguage: "en", unexpected: true },
      assets: [{ id: "animated", kind: "gif", path: "assets/animated.gif" }],
      editorMetadata: ["not-an-object"],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "unknown-field",
            path: "/metadata/unexpected",
          }),
          expect.objectContaining({
            code: "invalid-enum",
            path: "/assets/0/kind",
          }),
          expect.objectContaining({
            code: "wrong-type",
            path: "/editorMetadata",
          }),
        ]),
      );
    }
  });

  it("requires an immutable transparent palette.none whenever a palette is present", () => {
    const missing = validateFabricThemeEnvelope({
      ...envelope(),
      globals: {
        palette: {
          accent: {
            name: "Accent",
            value: { kind: "solid", color: "#00b8d9" },
          },
        },
      },
    });
    const renamed = validateFabricThemeEnvelope({
      ...envelope(),
      globals: {
        palette: {
          none: {
            name: "Clear",
            value: { kind: "solid", color: "transparent" },
          },
        },
      },
    });

    expect(missing).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ path: "/globals/palette/none" })],
    });
    expect(renamed).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ path: "/globals/palette/none" })],
    });
    expect(
      validateFabricThemeEnvelope({
        ...envelope(),
        globals: {
          palette: {
            none: {
              name: "None",
              value: { kind: "solid", color: "transparent" },
            },
          },
        },
      }),
    ).toMatchObject({ ok: true });
  });

  it("accepts CSS-compatible solid colours and ordered angled gradients", () => {
    expect(
      validateFabricThemeEnvelope({
        ...envelope(),
        globals: {
          palette: {
            none: {
              name: "None",
              value: { kind: "solid", color: "transparent" },
            },
            ink: { name: "Ink", value: { kind: "solid", color: "#101216" } },
            glow: {
              name: "Glow",
              value: {
                kind: "gradient",
                angle: 45,
                stops: [
                  { offset: 0, color: "rgb(0, 0, 0)" },
                  { offset: 1, color: "#ffffff" },
                ],
              },
            },
          },
        },
      }),
    ).toMatchObject({ ok: true });
  });

  it("rejects resolved object paint without a palette reference", () => {
    const result = validateFabricThemeEnvelope({
      ...envelope(),
      globals: {
        palette: {
          none: {
            name: "None",
            value: { kind: "solid", color: "transparent" },
          },
          ink: { name: "Ink", value: { kind: "solid", color: "#fff" } },
        },
      },
      scene: {
        version: "7.4.0",
        objects: [{ type: "Rect", id: "box", fill: "#fff" }],
      },
    });
    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "unresolved-global-ref",
          path: "/scene/objects/0/fill",
        }),
      ]),
    });
  });

  it("requires a palette reference for the string form of a shadow", () => {
    // Fabric accepts a shadow as a CSS string and parses it into a real Shadow
    // with a real colour, so the unowned-literal hole is the same one the
    // object form has. A hand-edited theme would otherwise smuggle a resolved
    // colour past the check that exists precisely to prevent that.
    const result = validateFabricThemeEnvelope({
      ...withoutKey(
        {
          ...envelope(),
          globals: {
            palette: {
              none: {
                name: "None",
                value: { kind: "solid", color: "transparent" },
              },
              edge: {
                name: "Edge",
                value: { kind: "solid", color: "#0a0f16" },
              },
            },
          },
        },
        "bindings",
      ),
      scene: {
        version: "7.4.0",
        objects: [{ type: "Rect", id: "panel", shadow: "0 0 18 #123456" }],
      },
    });

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "unresolved-global-ref",
          path: "/scene/objects/0/shadowColor",
        }),
      ]),
    });
  });

  it("refuses a shadow colour reference the renderer cannot apply", () => {
    // A gradient token resolves fine, but Fabric's `Shadow.color` is a string;
    // applyingPaints drops it. A reference that cannot be applied must be an
    // issue, matching how an unresolvable palette ref is already reported,
    // rather than a silent no-op that leaves the shadow unowned in practice.
    const result = validateFabricThemeEnvelope({
      ...withoutKey(
        {
          ...envelope(),
          globals: {
            palette: {
              none: {
                name: "None",
                value: { kind: "solid", color: "transparent" },
              },
              edge: {
                name: "Edge",
                value: {
                  kind: "gradient",
                  angle: 90,
                  stops: [
                    { offset: 0, color: "#0a0f16" },
                    { offset: 1, color: "#0d1b2a" },
                  ],
                },
              },
            },
          },
        },
        "bindings",
      ),
      scene: {
        version: "7.4.0",
        objects: [
          {
            type: "Rect",
            id: "panel",
            shadow: { color: "#0a0f16", blur: 18 },
            yunariPaint: { shadowColor: "palette.edge" },
          },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "unresolved-global-ref",
          path: "/scene/objects/0/shadowColor",
        }),
      ]),
    });
  });

  it("requires a palette reference for a persisted shadow colour", () => {
    // Shadow is a native Fabric property, so its colour is resolved state
    // exactly like fill and stroke: it needs an owner in `yunariPaint`.
    const withPalette = {
      ...withoutKey(
        {
          ...envelope(),
          globals: {
            palette: {
              none: {
                name: "None",
                value: { kind: "solid", color: "transparent" },
              },
              edge: {
                name: "Edge",
                value: { kind: "solid", color: "#0a0f16" },
              },
            },
          },
        },
        "bindings",
      ),
    };

    expect(
      validateFabricThemeEnvelope({
        ...withPalette,
        scene: {
          version: "7.4.0",
          objects: [
            {
              type: "Rect",
              id: "panel",
              shadow: { color: "#0a0f16", blur: 18 },
              yunariPaint: { shadowColor: "palette.edge" },
            },
          ],
        },
      }).ok,
    ).toBe(true);

    expect(
      validateFabricThemeEnvelope({
        ...withPalette,
        scene: {
          version: "7.4.0",
          objects: [
            {
              type: "Rect",
              id: "panel",
              shadow: { color: "#0a0f16", blur: 18 },
            },
          ],
        },
      }),
    ).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "unresolved-global-ref",
          path: "/scene/objects/0/shadowColor",
        }),
      ]),
    });

    expect(
      validateFabricThemeEnvelope({
        ...withPalette,
        scene: {
          version: "7.4.0",
          objects: [
            {
              type: "Rect",
              id: "panel",
              shadow: { color: "#0a0f16", blur: 18 },
              yunariPaint: { shadowColor: "palette.gone" },
            },
          ],
        },
      }).ok,
    ).toBe(false);
  });

  it("requires palette references for persisted chart paint", () => {
    const base = {
      ...envelope(),
      globals: {
        palette: {
          none: {
            name: "None",
            value: { kind: "solid", color: "transparent" },
          },
          accent: {
            name: "Accent",
            value: { kind: "solid", color: "#00b8d9" },
          },
        },
      },
    };
    const valid = validateFabricThemeEnvelope({
      ...base,
      scene: {
        version: "7.4.0",
        objects: [
          {
            type: "YunariChart",
            id: "chart",
            family: "gauge",
            settings: {
              track: { ref: "palette.none" },
              progress: { ref: "palette.accent" },
            },
          },
        ],
      },
    });
    const literal = validateFabricThemeEnvelope({
      ...base,
      scene: {
        version: "7.4.0",
        objects: [
          {
            type: "YunariChart",
            id: "chart",
            family: "gauge",
            settings: {
              track: { kind: "solid", color: "#000" },
              progress: { ref: "palette.accent" },
            },
          },
        ],
      },
    });

    expect(valid).toMatchObject({ ok: true });
    expect(literal).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "unresolved-global-ref",
          path: "/scene/objects/0/settings/track",
        }),
      ]),
    });
  });

  it("refuses a chart scalar the descriptor table bounds", () => {
    const window = validateFabricThemeEnvelope(
      chartEnvelope("line", { windowSeconds: 0 }),
    );
    const points = validateFabricThemeEnvelope(
      chartEnvelope("line", { maxPoints: -5 }),
    );
    const width = validateFabricThemeEnvelope(
      chartEnvelope("line", { lineWidth: -1 }),
    );

    expect(issuesOf(window)).toEqual([
      {
        code: "out-of-range",
        path: "/scene/objects/0/settings/windowSeconds",
        message: "windowSeconds must be at least 1.",
      },
    ]);
    expect(issuesOf(points)).toMatchObject([
      { code: "out-of-range", path: "/scene/objects/0/settings/maxPoints" },
    ]);
    expect(issuesOf(width)).toMatchObject([
      { code: "out-of-range", path: "/scene/objects/0/settings/lineWidth" },
    ]);
  });

  it("refuses a crossed pair the family's own descriptors own", () => {
    const gauge = validateFabricThemeEnvelope(
      chartEnvelope("gauge", { min: 10, max: 1 }),
    );
    const bar = validateFabricThemeEnvelope(
      chartEnvelope("bar", { min: 100, max: 100 }),
    );
    const line = validateFabricThemeEnvelope(
      chartEnvelope("line", { min: 100, max: 0 }),
    );
    const pie = validateFabricThemeEnvelope(
      chartEnvelope("pie", { innerRadiusPercent: 80, outerRadiusPercent: 20 }),
    );

    expect(issuesOf(gauge)).toMatchObject([
      { code: "out-of-range", path: "/scene/objects/0/settings/max" },
    ]);
    expect(issuesOf(bar)).toMatchObject([
      { code: "out-of-range", path: "/scene/objects/0/settings/max" },
    ]);
    expect(issuesOf(line)).toMatchObject([
      { code: "out-of-range", path: "/scene/objects/0/settings/max" },
    ]);
    expect(issuesOf(pie)).toMatchObject([
      {
        code: "out-of-range",
        path: "/scene/objects/0/settings/outerRadiusPercent",
      },
    ]);
  });

  it("refuses a settings bag that is not an object, and an unknown key", () => {
    const array = validateFabricThemeEnvelope(
      chartEnvelope("line", ["windowSeconds"]),
    );
    const unknown = validateFabricThemeEnvelope(
      chartEnvelope("gauge", { minimum: 0 }),
    );

    expect(issuesOf(array)).toEqual([
      {
        code: "wrong-type",
        path: "/scene/objects/0/settings",
        message: "Chart settings must be an object.",
      },
    ]);
    expect(issuesOf(unknown)).toMatchObject([
      { code: "unknown-field", path: "/scene/objects/0/settings/minimum" },
    ]);
  });

  it("refuses a fixed pie total with no finite value", () => {
    const absent = validateFabricThemeEnvelope(
      chartEnvelope("pie", { total: { kind: "fixed" } }),
    );
    const nulled = validateFabricThemeEnvelope(
      chartEnvelope("pie", { total: { kind: "fixed", value: null } }),
    );

    expect(issuesOf(absent)).toMatchObject([
      { code: "missing-field", path: "/scene/objects/0/settings/total/value" },
    ]);
    expect(issuesOf(nulled)).toMatchObject([
      { code: "wrong-type", path: "/scene/objects/0/settings/total/value" },
    ]);
  });

  it("accepts absent, in-range and nested settings the table declares", () => {
    expect(validateFabricThemeEnvelope(chartEnvelope("gauge", {})).ok).toBe(
      true,
    );
    expect(
      validateFabricThemeEnvelope(chartEnvelope("gauge", { min: 0, max: 100 }))
        .ok,
    ).toBe(true);
    expect(
      validateFabricThemeEnvelope(
        chartEnvelope("pie", {
          innerRadiusPercent: 60,
          outerRadiusPercent: 100,
          total: { kind: "fixed", value: 120 },
        }),
      ).ok,
    ).toBe(true);
    expect(
      validateFabricThemeEnvelope(
        chartEnvelope("line", { min: 0, max: 100, windowSeconds: 60 }),
      ).ok,
    ).toBe(true);
    expect(
      validateFabricThemeEnvelope(chartEnvelope("line", { animation: {} })).ok,
    ).toBe(true);
  });

  it("rejects resolved text type without a preset reference", () => {
    const result = validateFabricThemeEnvelope({
      ...envelope(),
      globals: {
        typePresets: {
          body: { name: "Body", value: { family: "Inter", size: 16 } },
        },
      },
      scene: {
        version: "7.4.0",
        objects: [
          { type: "Textbox", id: "label", fontFamily: "Inter", fontSize: 16 },
        ],
      },
    });
    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "unresolved-global-ref",
          path: "/scene/objects/0/yunariText",
        }),
      ]),
    });
  });

  it("accepts typed presets as v2 globals", () => {
    expect(
      validateFabricThemeEnvelope({
        ...envelope(),
        globals: {
          typePresets: {
            metric: {
              name: "Metric",
              value: {
                family: "Inter",
                size: 32,
                weight: 700,
                lineHeight: 1.1,
              },
            },
          },
        },
      }),
    ).toMatchObject({ ok: true });
  });

  it("validates exact declared font faces and shared trio roles", () => {
    expect(
      validateFabricThemeEnvelope(envelopeWithFontRoles(), {
        requireTrioRoles: true,
      }),
    ).toMatchObject({ ok: true });
  });

  it("rejects a face with metadata that disagrees with its WOFF2 declaration", () => {
    const result = validateFabricThemeEnvelope({
      ...envelopeWithFontRoles(),
      assets: [
        fontAsset("heading-face", 600),
        fontAsset("body-face", 400),
        fontAsset("mono-face", 400),
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: "/globals/typePresets/heading/value/face/assetId",
        }),
      ]),
    });
  });

  it("requires all starter roles only when requested", () => {
    const theme = envelopeWithFontRoles();
    const globals = theme["globals"] as Record<string, unknown>;
    const presets = globals["typePresets"] as Record<string, unknown>;
    delete presets["mono"];

    expect(validateFabricThemeEnvelope(theme)).toMatchObject({ ok: true });
    expect(
      validateFabricThemeEnvelope(theme, { requireTrioRoles: true }),
    ).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ path: "/globals/typePresets" }),
      ]),
    });
  });

  it("rejects transitional globals and literal background paint", () => {
    const result = validateFabricThemeEnvelope({
      ...envelope(),
      background: { color: { value: "#101216" } },
      globals: { fonts: { body: { name: "Body", value: "Inter" } } },
    });

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "unknown-field",
          path: "/globals/fonts",
        }),
        expect.objectContaining({
          code: "unresolved-global-ref",
          path: "/background/color",
        }),
      ]),
    });
  });

  it("rejects local text-run colour and type settings", () => {
    const result = validateFabricThemeEnvelope({
      ...envelope(),
      globals: {
        palette: {
          none: {
            name: "None",
            value: { kind: "solid", color: "transparent" },
          },
          text: { name: "Text", value: { kind: "solid", color: "#fff" } },
        },
        typePresets: {
          body: { name: "Body", value: { family: "Inter", size: 16 } },
        },
      },
      scene: {
        version: "7.4.0",
        objects: [
          {
            type: "Textbox",
            id: "label",
            fill: "#fff",
            yunariPaint: { fill: "palette.text" },
            yunariText: {
              runs: [
                {
                  kind: "literal",
                  text: "CPU",
                  typePreset: "typePresets.body",
                  style: { color: { value: "#fff" }, fontSize: { value: 16 } },
                },
              ],
            },
          },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "unknown-field",
          path: "/scene/objects/0/yunariText/runs/0/style/fontSize",
        }),
        expect.objectContaining({
          code: "unresolved-global-ref",
          path: "/scene/objects/0/yunariText/runs/0/style/color",
        }),
      ]),
    });
  });

  it("requires the theme to declare the language its text is written in", () => {
    // The realistic case: every v2 theme already has a metadata bag with a name
    // and author, so the refusal that matters is a bag without `themeLanguage` in it —
    // not a document missing metadata entirely. Both paths are pinned, since the
    // validator handles them separately.
    const withoutLocale = withMetadata(envelope(), {
      name: "Fixture",
      author: "Yunari",
    });

    const missing = validateFabricThemeEnvelope(withoutLocale);
    expect(missing.ok).toBe(false);
    // A refusal that names the field, not a crash: a theme saved before this
    // change must fail legibly.
    expect(issuesOf(missing)).toContainEqual(
      expect.objectContaining({ path: "/metadata/themeLanguage" }),
    );

    const withoutMetadata = withoutKey(envelope(), "metadata");
    expect(
      issuesOf(validateFabricThemeEnvelope(withoutMetadata)),
    ).toContainEqual(
      expect.objectContaining({ path: "/metadata/themeLanguage" }),
    );
  });

  it("refuses a language this runtime cannot render", () => {
    for (const language of ["en_US", "xx-YY"]) {
      const result = validateFabricThemeEnvelope(
        withMetadata(envelope(), { name: "Fixture", themeLanguage: language }),
      );

      expect(result.ok).toBe(false);
      expect(issuesOf(result)).toContainEqual(
        expect.objectContaining({ path: "/metadata/themeLanguage" }),
      );
    }
  });

  it("accepts a theme that declares a language but binds no clock", () => {
    // The language is a fact about the document, not a demand that it show a clock.
    const result = validateFabricThemeEnvelope(
      withMetadata(envelope(), { name: "Fixture", themeLanguage: "ja" }),
    );

    expect(result.ok).toBe(true);
  });

  it("accepts a theme that declares a language but binds nothing at all", () => {
    // The factory's own binding is `cpu.load`, so the case above only proves the
    // absence of a clock key. A theme with no bindings whatsoever must also
    // validate: a language is a fact about the document, not a promise that any
    // reading is bound. Both spellings of "no bindings" are pinned, since the
    // validator only skips the bag entirely when the key is absent.
    const noBindingsKey = withoutKey(envelope(), "bindings");
    expect(
      validateFabricThemeEnvelope(
        withMetadata(noBindingsKey, { name: "Fixture", themeLanguage: "ja" }),
      ).ok,
    ).toBe(true);

    const emptyBindings = { ...envelope(), bindings: {} };
    expect(
      validateFabricThemeEnvelope(
        withMetadata(emptyBindings, { name: "Fixture", themeLanguage: "ja" }),
      ).ok,
    ).toBe(true);
  });
});

describe("authored glass treatment", () => {
  function withObjects(objects: readonly unknown[]): Record<string, unknown> {
    // The shared fixture binds a chart; these cases replace the scene, so the
    // binding would fail for an unrelated reason and hide the real one.
    return withoutKey(
      { ...envelope(), scene: { version: "7.4.0", objects } },
      "bindings",
    );
  }

  it("accepts a bounded radius, and treats absence as off", () => {
    // Absence must stay legal forever: a theme authored before glass existed
    // is not invalid because it lacks the property.
    expect(
      validateFabricThemeEnvelope(withObjects([{ type: "Rect", id: "panel" }]))
        .ok,
    ).toBe(true);
    expect(
      validateFabricThemeEnvelope(
        withObjects([
          { type: "Rect", id: "panel", yunariGlass: { blurRadius: 0 } },
          { type: "Rect", id: "soft", yunariGlass: { blurRadius: 48 } },
        ]),
      ).ok,
    ).toBe(true);
  });

  it("refuses a radius that is out of range, non-finite or the wrong type", () => {
    for (const blurRadius of [
      -1,
      48.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "12",
      null,
    ]) {
      const result = validateFabricThemeEnvelope(
        withObjects([
          { type: "Rect", id: "panel", yunariGlass: { blurRadius } },
        ]),
      );
      expect(result, `blurRadius ${String(blurRadius)}`).toMatchObject({
        ok: false,
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "invalid-fabric-scene",
            path: "/scene/objects/0/yunariGlass",
          }),
        ]),
      });
    }
  });

  it("refuses a treatment that is not an object, or carries extra authored state", () => {
    for (const yunariGlass of [
      12,
      "glass",
      {},
      { radius: 12 },
      // A resolved surface or sampled pixel is exactly the derived state a
      // portable document must not carry.
      { blurRadius: 12, surface: "data:image/png;base64,AAAA" },
      { blurRadius: 12, sample: 42.7 },
    ]) {
      expect(
        validateFabricThemeEnvelope(
          withObjects([{ type: "Rect", id: "panel", yunariGlass }]),
        ),
        JSON.stringify(yunariGlass),
      ).toMatchObject({ ok: false });
    }
  });

  it("refuses glass on an object kind with no sampleable clipped area", () => {
    const result = validateFabricThemeEnvelope(
      withObjects([
        { type: "Textbox", id: "label", yunariGlass: { blurRadius: 12 } },
      ]),
    );

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "invalid-enum",
          path: "/scene/objects/0/yunariGlass",
        }),
      ]),
    });
  });

  it("accepts a treatment on every kind the product proves is closed", () => {
    // The round trip the widening exists for: written on a Circle, an Ellipse,
    // a Triangle and a Polygon as well as a Rect, the envelope accepts it.
    // Refusing any of these would be a theme that saves and will not open.
    for (const type of ["Rect", "Circle", "Ellipse", "Triangle", "Polygon"]) {
      expect(
        validateFabricThemeEnvelope(
          withObjects([{ type, id: "panel", yunariGlass: { blurRadius: 24 } }]),
        ),
        type,
      ).toMatchObject({ ok: true });
    }
  });

  it("refuses an open path, whose interior there is nothing to sample", () => {
    // Polyline and Line are open; a `Path` is arbitrary author data whose
    // closedness the product cannot know. Naming the three here is the point:
    // the set is the geometry claim, and a silent widening of it would frost
    // a shape with no area under the blur.
    for (const type of ["Polyline", "Line", "Path"]) {
      expect(
        validateFabricThemeEnvelope(
          withObjects([
            { type, id: "sketch", yunariGlass: { blurRadius: 24 } },
          ]),
        ),
        type,
      ).toMatchObject({
        ok: false,
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "invalid-enum",
            path: "/scene/objects/0/yunariGlass",
          }),
        ]),
      });
    }
  });

  it("refuses a malformed treatment on a newly admitted kind", () => {
    // Widening the vocabulary must not widen what counts as a treatment: the
    // kind rule and the value rule are separate, and a bad radius on a Circle
    // is refused exactly as it is on a Rect.
    expect(
      validateFabricThemeEnvelope(
        withObjects([
          { type: "Circle", id: "orb", yunariGlass: { blurRadius: 999 } },
        ]),
      ),
    ).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "invalid-fabric-scene",
          path: "/scene/objects/0/yunariGlass",
        }),
      ]),
    });
  });

  it("validates a nested treatment at the child's own path", () => {
    // The scene walk is the only thing that reaches a group child, so a
    // treatment validated only at the top level would let a bad nested value
    // through into revival.
    const result = validateFabricThemeEnvelope(
      withObjects([
        {
          type: "Group",
          id: "card",
          objects: [
            { type: "Rect", id: "panel", yunariGlass: { blurRadius: 12 } },
            { type: "Rect", id: "inner", yunariGlass: { blurRadius: 999 } },
          ],
        },
      ]),
    );

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "invalid-fabric-scene",
          path: "/scene/objects/0/objects/1/yunariGlass",
        }),
      ]),
    });
  });
});

describe("an object's authored display name", () => {
  function withObjects(objects: readonly unknown[]): Record<string, unknown> {
    // The shared fixture binds a chart; these cases replace the scene, so the
    // binding would fail for an unrelated reason and hide the real one.
    return withoutKey(
      { ...envelope(), scene: { version: "7.4.0", objects } },
      "bindings",
    );
  }

  it("accepts a name, and treats absence as unnamed", () => {
    // Absence must stay legal forever: a scene authored before the field is not
    // invalid because it lacks the property, and the id is what it falls back
    // to.
    expect(
      validateFabricThemeEnvelope(withObjects([{ type: "Rect", id: "panel" }]))
        .ok,
    ).toBe(true);
    expect(
      validateFabricThemeEnvelope(
        withObjects([
          { type: "Rect", id: "panel", name: "Header panel" },
          {
            type: "Rect",
            id: "body",
            name: "x".repeat(MAX_OBJECT_NAME_LENGTH),
          },
        ]),
      ).ok,
    ).toBe(true);
  });

  it("refuses a name that is not a label an author could read", () => {
    // The envelope is the trust boundary: a value that is not a name is
    // refused rather than kept and printed into a layer row.
    for (const name of [
      42,
      null,
      ["Header panel"],
      { text: "Header panel" },
      // A blank name is worse than none: it prints as an empty row, where
      // absence falls back to the id.
      "",
      "   ",
      "x".repeat(MAX_OBJECT_NAME_LENGTH + 1),
    ]) {
      expect(
        validateFabricThemeEnvelope(
          withObjects([{ type: "Rect", id: "panel", name }]),
        ),
        JSON.stringify(name),
      ).toMatchObject({ ok: false });
    }
  });

  it("validates a nested name at the child's own path", () => {
    // The scene walk is the only thing that reaches a group child, so a name
    // validated only at the top level would let a bad nested value through.
    const result = validateFabricThemeEnvelope(
      withObjects([
        {
          type: "Group",
          id: "card",
          objects: [{ type: "Rect", id: "inner", name: 42 }],
        },
      ]),
    );

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: "/scene/objects/0/objects/0/name",
        }),
      ]),
    });
  });
});

describe("a theme saved before a key was retired", () => {
  it("still loads when it carries a key the schema no longer publishes", () => {
    // The persisted-key decision (`docs/decisions/0069`): `yunariBleeds` left
    // the published schema, and the object's `additionalProperties: jsonValue`
    // is what keeps a document that still carries it loadable. The scene walk
    // refuses an unknown *value*, never an unknown key, so retiring a key is a
    // schema deletion rather than a migration — and the failure this guards is
    // data loss, which is not the same decision as deleting a dead branch.
    const objects = [
      { type: "Rect", id: "panel", yunariBleeds: true },
      { type: "Rect", id: "plain" },
    ];

    expect(
      validateFabricThemeEnvelope(
        withoutKey(
          { ...envelope(), scene: { version: "7.4.0", objects } },
          "bindings",
        ),
      ).ok,
    ).toBe(true);
  });
});

describe("a text object's fixed box", () => {
  const withBox = (box: unknown): Record<string, unknown> => {
    const base = envelope();
    return {
      ...base,
      scene: {
        version: "7.4.0",
        objects: [
          {
            type: "Textbox",
            id: "label",
            fill: "#fff",
            yunariText: {
              box,
              runs: [{ kind: "literal", text: "CPU" }],
            },
          },
        ],
      },
    };
  };

  /** Whether anything complained about the box, whatever else it did. */
  const boxIssues = (box: unknown): readonly ValidationIssue[] =>
    issuesOf(validateFabricThemeEnvelope(withBox(box))).filter(
      (issue) => issue.path === "/scene/objects/0/yunariText/box",
    );

  it("accepts the two dimensions an author wrote", () => {
    expect(boxIssues({ width: 180, height: 72 })).toEqual([]);
  });

  it("refuses a box it cannot lay text into", () => {
    // Fabric re-measures the width on every refresh, so a box that is missing a
    // dimension is not a box the renderer can honour — it is a silent fallback.
    for (const box of [
      { width: 180 },
      { width: 0, height: 72 },
      { width: 180, height: Number.NaN },
      { width: 180, height: 72, top: 30 },
    ]) {
      expect(boxIssues(box), JSON.stringify(box)).toHaveLength(1);
    }
  });
});

describe("a theme's style tags", () => {
  const withTags = (tags: unknown): Record<string, unknown> =>
    withMetadata(envelope(), { themeLanguage: "en", tags });

  const tagIssue = (tag: unknown): Record<string, unknown> => ({
    code: typeof tag === "string" ? "invalid-id" : "wrong-type",
    path: "/metadata/tags/0",
    message: `A style tag must match ^[a-z0-9-]{1,24}$ — 1–24 lowercase letters, digits or hyphens; got ${JSON.stringify(tag) ?? String(tag)}.`,
  });

  it("accepts a well-formed tag list", () => {
    expect(
      validateFabricThemeEnvelope(withTags(["retro", "neon-2"])),
    ).toMatchObject({ ok: true });
    // A duplicate is not a refusal: the facet deduplicates, and the spec makes the
    // shape and the count the whole of what the format enforces (docs/decisions/0087).
    expect(validateFabricThemeEnvelope(withTags(["retro", "retro"])).ok).toBe(
      true,
    );
  });

  it("accepts a tag no vocabulary holds yet, which is the only way it can join one", () => {
    // The spec's own sentence, as a case: a tag the vocabulary does not yet know
    // has to be writable before the vocabulary can grow to include it. This fails
    // the moment anyone adds an enum `dystopian` is not in (docs/decisions/0087).
    expect(validateFabricThemeEnvelope(withTags(["dystopian"]))).toMatchObject({
      ok: true,
    });
  });

  it("refuses an uppercase tag", () => {
    expect(issuesOf(validateFabricThemeEnvelope(withTags(["Retro"])))).toEqual([
      tagIssue("Retro"),
    ]);
  });

  it("refuses a tag with a space or an underscore", () => {
    for (const tag of ["science fiction", "science_fiction"]) {
      expect(
        issuesOf(validateFabricThemeEnvelope(withTags([tag]))),
        tag,
      ).toEqual([tagIssue(tag)]);
    }
  });

  it("refuses a tag longer than 24 characters", () => {
    const tag = "a".repeat(25);

    expect(issuesOf(validateFabricThemeEnvelope(withTags([tag])))).toEqual([
      tagIssue(tag),
    ]);
  });

  it("refuses an empty tag list member", () => {
    expect(issuesOf(validateFabricThemeEnvelope(withTags([""])))).toEqual([
      tagIssue(""),
    ]);
  });

  it("accepts five tags and refuses a sixth", () => {
    expect(
      validateFabricThemeEnvelope(withTags(["a", "b", "c", "d", "e"])).ok,
    ).toBe(true);

    expect(
      issuesOf(
        validateFabricThemeEnvelope(withTags(["a", "b", "c", "d", "e", "f"])),
      ),
    ).toEqual([
      {
        code: "out-of-range",
        path: "/metadata/tags",
        message: "A theme declares at most 5 style tags; this one declares 6.",
      },
    ]);
  });

  it("refuses tags that are not strings", () => {
    expect(issuesOf(validateFabricThemeEnvelope(withTags([42])))).toEqual([
      tagIssue(42),
    ]);
    // The bag itself is a value this rule reads, so a string where the list belongs
    // is refused as the wrong type rather than iterated character by character.
    expect(
      issuesOf(validateFabricThemeEnvelope(withTags("retro"))),
    ).toContainEqual(
      expect.objectContaining({ code: "wrong-type", path: "/metadata/tags" }),
    );
  });
});

describe("a theme's remix provenance", () => {
  const catalogueId = "5f0c4f30-0f8c-4e4f-9c1f-1f0f0f0f0f0f";
  const withRemix = (remixOf: unknown): Record<string, unknown> =>
    withMetadata(envelope(), { themeLanguage: "en", remixOf });

  it("accepts the parent it was remixed from", () => {
    expect(
      validateFabricThemeEnvelope(
        withRemix({ catalogueId, name: "Parent", version: "1.2.0" }),
      ),
    ).toMatchObject({ ok: true });
    // Provenance is optional: a theme authored from scratch carries none.
    expect(validateFabricThemeEnvelope(envelope()).ok).toBe(true);
  });

  it("refuses a parent id that is not a catalogue UUID", () => {
    const result = validateFabricThemeEnvelope(
      withRemix({
        catalogueId: "parent-slug",
        name: "Parent",
        version: "1.2.0",
      }),
    );

    expect(issuesOf(result)).toEqual([
      expect.objectContaining({
        code: "invalid-id",
        path: "/metadata/remixOf/catalogueId",
      }),
    ]);
  });

  it("refuses credit with no name to print", () => {
    const result = validateFabricThemeEnvelope(
      withRemix({ catalogueId, version: "1.2.0" }),
    );

    expect(issuesOf(result)).toEqual([
      expect.objectContaining({
        code: "missing-field",
        path: "/metadata/remixOf/name",
      }),
    ]);
  });

  it("refuses a version that is not semantic major.minor.patch", () => {
    const result = validateFabricThemeEnvelope(
      withRemix({ catalogueId, name: "Parent", version: "v1.2" }),
    );

    expect(issuesOf(result)).toEqual([
      expect.objectContaining({
        code: "wrong-type",
        path: "/metadata/remixOf/version",
      }),
    ]);
  });

  it("refuses a member the published shape does not declare", () => {
    const result = validateFabricThemeEnvelope(
      withRemix({
        catalogueId,
        name: "Parent",
        version: "1.2.0",
        author: "Someone",
      }),
    );

    expect(issuesOf(result)).toEqual([
      expect.objectContaining({
        code: "unknown-field",
        path: "/metadata/remixOf/author",
      }),
    ]);
  });
});

describe("isThemeRemix", () => {
  const wellFormed = {
    catalogueId: "5f0c4f30-0f8c-4e4f-9c1f-1f0f0f0f0f0f",
    name: "Parent",
    version: "1.2.0",
  };

  it("accepts exactly the published three-member shape", () => {
    expect(isThemeRemix(wellFormed)).toBe(true);
  });

  it("refuses a non-object, a missing member and an undeclared one", () => {
    for (const value of [
      null,
      "remix",
      [],
      { ...wellFormed, name: undefined },
      { ...wellFormed, version: "1.2" },
      { ...wellFormed, author: "Someone" },
    ]) {
      expect(isThemeRemix(value), JSON.stringify(value)).toBe(false);
    }
  });
});
