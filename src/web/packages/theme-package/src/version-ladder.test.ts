import {
  envelopeKeysFor,
  type FabricThemeEnvelope,
} from "@yunari/renderer-core";
import { describe, expect, it } from "vitest";
import {
  bumpVersion,
  CLASSIFIED_ENVELOPE_KEYS,
  classifyThemeChange,
  IGNORED_ENVELOPE_KEYS,
  isSemanticVersion,
  versionFor,
} from "./version-ladder.js";

type EnvelopeOverrides = Omit<Partial<FabricThemeEnvelope>, "schemaVersion"> & {
  readonly schemaVersion?: number;
};

/** A minimal valid envelope. Tests mutate clones of this. */
function base(overrides: EnvelopeOverrides = {}): FabricThemeEnvelope {
  return {
    schemaVersion: 2,
    fabricVersion: "7.4.0",
    id: "demo-theme",
    metadata: { themeLanguage: "en" },
    artboard: { width: 1280, height: 720, contentFit: "contain" },
    bindings: {},
    scene: { version: "7.4.0", objects: [] },
    ...overrides,
  } as unknown as FabricThemeEnvelope;
}

describe("isSemanticVersion", () => {
  it.each(["0.0.0", "1.4.0", "10.20.30"])("accepts %s", (text) =>
    expect(isSemanticVersion(text)).toBe(true),
  );
  it.each(["v1.4.0", "1.4", "1.4.0-beta.1", "1.4.0+build", ""])(
    "refuses %s",
    (text) => expect(isSemanticVersion(text)).toBe(false),
  );
});

describe("bumpVersion", () => {
  it.each([
    ["1.4.0", "patch", "1.4.1"],
    ["1.4.0", "minor", "1.5.0"],
    ["1.4.0", "major", "2.0.0"],
    ["0.9.9", "minor", "0.10.0"],
    ["1.9.9", "patch", "1.9.10"],
    ["9.9.9", "major", "10.0.0"],
  ] as const)("%s + %s = %s", (previous, level, expected) =>
    expect(bumpVersion(previous, level)).toBe(expected),
  );
  it("answers undefined for a previous that is not a version", () =>
    expect(bumpVersion("v1.4", "patch")).toBeUndefined());
  it("answers undefined for digits past the safe-integer range", () =>
    expect(bumpVersion("9007199254740992.0.0", "patch")).toBeUndefined());
});

describe("versionFor", () => {
  it("mints 1.0.0 for a first publication", () =>
    expect(versionFor(undefined, { level: "initial", reasons: [] })).toBe(
      "1.0.0",
    ));
  it("keeps the published version when nothing changed", () =>
    expect(versionFor("1.4.0", { level: "none", reasons: [] })).toBe("1.4.0"));
  it("bumps the published version by the level", () =>
    expect(versionFor("1.4.0", { level: "minor", reasons: [] })).toBe("1.5.0"));
  it("answers undefined for a previous that is not a version", () =>
    expect(versionFor("v1", { level: "patch", reasons: [] })).toBeUndefined());
  it("answers undefined for initial without a previous", () =>
    expect(
      versionFor("1.4.0", { level: "initial", reasons: [] }),
    ).toBeUndefined());
});

describe("classifyThemeChange", () => {
  it("is initial with no published package", () => {
    expect(classifyThemeChange(undefined, base())).toEqual({
      level: "initial",
      reasons: [],
    });
  });
  it("is none when only ignored fields move", () => {
    const next = base({
      fabricVersion: "7.5.0",
      scene: { ...base().scene, version: "7.5.0" },
      editorMetadata: { zoom: 2 },
      metadata: {
        ...base().metadata,
        version: "9.9.9",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(classifyThemeChange(base(), next)).toEqual({
      level: "none",
      reasons: [],
    });
  });
  it("is major when the schema version changes", () => {
    expect(classifyThemeChange(base(), base({ schemaVersion: 3 }))).toEqual({
      level: "major",
      reasons: ["schema"],
    });
  });
  it("is major when the artboard's width or height changes", () => {
    const next = base({ artboard: { ...base().artboard, width: 1920 } });
    expect(classifyThemeChange(base(), next)).toEqual({
      level: "major",
      reasons: ["canvas"],
    });
  });
  it("is major when a bound sensor is no longer bound", () => {
    const withSensor = base({
      bindings: {
        chart: [{ id: "cpu", semanticKey: "cpu.load", precision: 0 }],
      },
    });
    const next = base({ bindings: {} });
    expect(classifyThemeChange(withSensor, next)).toEqual({
      level: "major",
      reasons: ["sensor-removed"],
    });
  });
  it("is minor when a sensor is added", () => {
    const next = base({
      bindings: {
        chart: [{ id: "cpu", semanticKey: "cpu.load", precision: 0 }],
      },
    });
    expect(classifyThemeChange(base(), next)).toEqual({
      level: "minor",
      reasons: ["sensor-added"],
    });
  });
  it("is patch when a binding moves between objects and keeps its sensor", () => {
    const before = base({
      bindings: { a: [{ id: "cpu", semanticKey: "cpu.load", precision: 0 }] },
    });
    const after = base({
      bindings: { b: [{ id: "cpu", semanticKey: "cpu.load", precision: 0 }] },
    });
    expect(classifyThemeChange(before, after)).toEqual({
      level: "patch",
      reasons: ["content"],
    });
  });
  it("is major for a member no rule knows", () => {
    const next = { ...base(), futureThing: {} } as unknown as ReturnType<
      typeof base
    >;
    expect(classifyThemeChange(base(), next)).toEqual({
      level: "major",
      reasons: ["schema"],
    });
  });
});

/** A Fabric scene carrying the given top-level objects. */
function scene(objects: readonly unknown[]) {
  return { version: "7.4.0", objects };
}

function withMetadata(metadata: Record<string, unknown>): FabricThemeEnvelope {
  return base({
    metadata: metadata as NonNullable<FabricThemeEnvelope["metadata"]>,
  });
}

describe("classifyThemeChange — scene objects", () => {
  it("is minor when an object is added at depth", () => {
    const before = base({ scene: scene([{ id: "group", objects: [] }]) });
    const after = base({
      scene: scene([{ id: "group", objects: [{ id: "panel" }] }]),
    });
    expect(classifyThemeChange(before, after)).toEqual({
      level: "minor",
      reasons: ["structure"],
    });
  });
  it("is minor when an object at depth is removed", () => {
    const before = base({
      scene: scene([{ id: "group", objects: [{ id: "panel" }] }]),
    });
    const after = base({ scene: scene([{ id: "group", objects: [] }]) });
    expect(classifyThemeChange(before, after)).toEqual({
      level: "minor",
      reasons: ["structure"],
    });
  });
  it("is patch when a kept object's geometry changes", () => {
    const before = base({ scene: scene([{ id: "chart", left: 10 }]) });
    const after = base({ scene: scene([{ id: "chart", left: 20 }]) });
    expect(classifyThemeChange(before, after)).toEqual({
      level: "patch",
      reasons: ["content"],
    });
  });
  it("is patch when the objects array is reordered", () => {
    const before = base({ scene: scene([{ id: "a" }, { id: "b" }]) });
    const after = base({ scene: scene([{ id: "b" }, { id: "a" }]) });
    expect(classifyThemeChange(before, after)).toEqual({
      level: "patch",
      reasons: ["content"],
    });
  });
  it("is patch when a kept object is re-parented into another group", () => {
    const before = base({
      scene: scene([
        { id: "left", objects: [{ id: "panel", type: "Rect" }] },
        { id: "right", objects: [] },
      ]),
    });
    const after = base({
      scene: scene([
        { id: "left", objects: [] },
        { id: "right", objects: [{ id: "panel", type: "Rect" }] },
      ]),
    });
    expect(classifyThemeChange(before, after)).toEqual({
      level: "patch",
      reasons: ["content"],
    });
  });
  it("is patch when an id-less object's geometry changes", () => {
    const before = base({ scene: scene([{ type: "Rect", left: 10 }]) });
    const after = base({ scene: scene([{ type: "Rect", left: 20 }]) });
    expect(classifyThemeChange(before, after)).toEqual({
      level: "patch",
      reasons: ["content"],
    });
  });
  it("is minor when an id-less object is added", () => {
    const rect = { type: "Rect", left: 10 };
    const before = base({ scene: scene([rect]) });
    const after = base({ scene: scene([rect, { type: "Rect", left: 20 }]) });
    expect(classifyThemeChange(before, after)).toEqual({
      level: "minor",
      reasons: ["structure"],
    });
  });
  it("is minor when an id-less object is removed", () => {
    const rect = { type: "Rect", left: 10 };
    const before = base({ scene: scene([rect, { type: "Rect", left: 20 }]) });
    const after = base({ scene: scene([rect]) });
    expect(classifyThemeChange(before, after)).toEqual({
      level: "minor",
      reasons: ["structure"],
    });
  });
  it("is patch when an object gains an unknown member carrying an id", () => {
    const before = base({ scene: scene([{ id: "panel", type: "Rect" }]) });
    const after = base({
      scene: scene([{ id: "panel", type: "Rect", clipPath: { id: "clip" } }]),
    });
    expect(classifyThemeChange(before, after)).toEqual({
      level: "patch",
      reasons: ["content"],
    });
  });
});

describe("classifyThemeChange — assets", () => {
  const hero = { id: "hero", kind: "image", path: "assets/hero.png" } as const;
  it("is minor when an asset id is added", () => {
    expect(classifyThemeChange(base(), base({ assets: [hero] }))).toEqual({
      level: "minor",
      reasons: ["structure"],
    });
  });
  it("is minor when an asset id is removed", () => {
    expect(classifyThemeChange(base({ assets: [hero] }), base())).toEqual({
      level: "minor",
      reasons: ["structure"],
    });
  });
  it("is patch when a kept asset's reference fields change", () => {
    const next = base({ assets: [{ ...hero, path: "assets/other.png" }] });
    expect(classifyThemeChange(base({ assets: [hero] }), next)).toEqual({
      level: "patch",
      reasons: ["content"],
    });
  });
});

describe("classifyThemeChange — globals", () => {
  const accent = {
    name: "Accent",
    value: { kind: "solid", color: "#fff" },
  } as const;
  const heading = { name: "Heading", value: { family: "Inter", size: 32 } };
  it("is minor when a palette token is added or removed", () => {
    const empty = base({ globals: { typePresets: {}, palette: {} } });
    const withToken = base({
      globals: { typePresets: {}, palette: { accent } },
    });
    expect(classifyThemeChange(empty, withToken)).toEqual({
      level: "minor",
      reasons: ["structure"],
    });
    expect(classifyThemeChange(withToken, empty)).toEqual({
      level: "minor",
      reasons: ["structure"],
    });
  });
  it("is minor when a type preset is added or removed", () => {
    const empty = base({ globals: { typePresets: {} } });
    const withPreset = base({ globals: { typePresets: { heading } } });
    expect(classifyThemeChange(empty, withPreset)).toEqual({
      level: "minor",
      reasons: ["structure"],
    });
    expect(classifyThemeChange(withPreset, empty)).toEqual({
      level: "minor",
      reasons: ["structure"],
    });
  });
  it("is minor when a token group arrives or leaves whole", () => {
    // `globals` itself is optional, so the group can be absent on one side.
    const withoutGlobals = base();
    const withPalette = base({
      globals: { typePresets: {}, palette: { accent } },
    });
    expect(classifyThemeChange(withoutGlobals, withPalette)).toEqual({
      level: "minor",
      reasons: ["structure"],
    });
    expect(classifyThemeChange(withPalette, withoutGlobals)).toEqual({
      level: "minor",
      reasons: ["structure"],
    });
  });
  it("is patch when a kept palette token's value changes", () => {
    const before = base({ globals: { typePresets: {}, palette: { accent } } });
    const after = base({
      globals: {
        typePresets: {},
        palette: {
          accent: { ...accent, value: { kind: "solid", color: "#000" } },
        },
      },
    });
    expect(classifyThemeChange(before, after)).toEqual({
      level: "patch",
      reasons: ["content"],
    });
  });
});

describe("classifyThemeChange — metadata tags", () => {
  it("is minor when tag membership changes", () => {
    const before = withMetadata({ themeLanguage: "en", tags: ["dark"] });
    const after = withMetadata({
      themeLanguage: "en",
      tags: ["dark", "minimal"],
    });
    expect(classifyThemeChange(before, after)).toEqual({
      level: "minor",
      reasons: ["metadata"],
    });
  });
  it("is none when the tags are only reordered", () => {
    const before = withMetadata({
      themeLanguage: "en",
      tags: ["dark", "minimal"],
    });
    const after = withMetadata({
      themeLanguage: "en",
      tags: ["minimal", "dark"],
    });
    expect(classifyThemeChange(before, after)).toEqual({
      level: "none",
      reasons: [],
    });
  });
});

describe("classifyThemeChange — the background layer", () => {
  const media = (bounds: "theme" | "display") => ({
    media: { assetId: "hero", bounds },
  });
  it("is minor when background media is added", () => {
    const next = base({ background: media("theme") });
    expect(classifyThemeChange(base(), next)).toEqual({
      level: "minor",
      reasons: ["backdrop"],
    });
  });
  it("is minor when background media is removed", () => {
    const before = base({ background: media("theme") });
    expect(classifyThemeChange(before, base())).toEqual({
      level: "minor",
      reasons: ["backdrop"],
    });
  });
  it("is minor when background media changes", () => {
    const before = base({ background: media("theme") });
    const after = base({ background: media("display") });
    expect(classifyThemeChange(before, after)).toEqual({
      level: "minor",
      reasons: ["backdrop"],
    });
  });
  it("is patch when the background colour changes", () => {
    const before = base({ background: { color: { value: "#fff" } } });
    const after = base({ background: { color: { value: "#000" } } });
    expect(classifyThemeChange(before, after)).toEqual({
      level: "patch",
      reasons: ["content"],
    });
  });
});

describe("classifyThemeChange — metadata fields", () => {
  it.each([
    ["name", "Before", "After"],
    ["author", "Before", "After"],
    ["description", "Before", "After"],
    ["themeLanguage", "en", "fr"],
  ])("is patch when metadata.%s changes", (key, before, after) => {
    const first = withMetadata({ themeLanguage: "en", [key]: before });
    const second = withMetadata({ themeLanguage: "en", [key]: after });
    expect(classifyThemeChange(first, second)).toEqual({
      level: "patch",
      reasons: ["metadata"],
    });
  });
  it("is patch when metadata.remixOf changes", () => {
    const remix = (version: string) => ({
      catalogueId: "5f0c4f30-0f8c-4e4f-9c1f-1f0f0f0f0f0f",
      name: "Parent",
      version,
    });
    const first = withMetadata({
      themeLanguage: "en",
      remixOf: remix("1.0.0"),
    });
    const second = withMetadata({
      themeLanguage: "en",
      remixOf: remix("1.1.0"),
    });
    expect(classifyThemeChange(first, second)).toEqual({
      level: "patch",
      reasons: ["metadata"],
    });
  });
});

describe("classifyThemeChange — mixed levels", () => {
  it("is major with both reasons in enum order when major and minor members move", () => {
    const before = base();
    const after = base({
      artboard: { ...base().artboard, width: 1920 },
      assets: [{ id: "hero", kind: "image", path: "assets/hero.png" }],
    });
    expect(classifyThemeChange(before, after)).toEqual({
      level: "major",
      reasons: ["canvas", "structure"],
    });
  });
});

it("classifies every envelope member the schema can carry", () => {
  const known = new Set([
    ...CLASSIFIED_ENVELOPE_KEYS,
    ...IGNORED_ENVELOPE_KEYS,
  ]);
  expect([...envelopeKeysFor("envelope")].sort()).toEqual([...known].sort());
});
