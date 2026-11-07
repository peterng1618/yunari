import {
  EDITOR_THEME_TOKENS,
  writeEditorThemePackage,
  writeWidgetPackage,
} from "@yunari/theme-package";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { planPackVersion } from "../version/plan.js";
import {
  defaultFacetsFor,
  readPackSubmission,
  validateFinalizedPackage,
} from "./kinds.js";

function submission(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    kind: "widget-pack",
    name: "Starter Cards",
    version: "1.0.0",
    metadata: { name: "Starter Cards" },
    sha256: "a".repeat(64),
    bytes: 1024,
    ...overrides,
  };
}

function widgetPack(): Uint8Array {
  const written = writeWidgetPackage({
    document: {
      schemaVersion: "2.1.0",
      fabricVersion: "7.4.0",
      id: "starter",
      metadata: { themeLanguage: "en", name: "Starter Cards" },
      globals: {},
      scene: { version: "7.4.0", objects: [] },
    },
    assets: {},
  });
  if (!written.ok) throw new Error(written.message);
  return written.bytes;
}

function editorTheme(): Uint8Array {
  const tokens = Object.fromEntries(
    EDITOR_THEME_TOKENS.map((token) => [token, "#112233"]),
  );
  const written = writeEditorThemePackage({ name: "Graphite", tokens });
  if (!written.ok) throw new Error(written.message);
  return written.bytes;
}

function pluginPackage(
  overrides: Readonly<Record<string, unknown>> = {},
): Uint8Array {
  return zipSync(
    {
      "yunari-plugin.json": strToU8(
        JSON.stringify({
          manifestVersion: 1,
          id: "plugin-one",
          name: "Plugin One",
          version: "1.0.0",
          description: "A declarative plugin.",
          engines: { yunari: ">=0.1.0" },
          pluginApi: 1,
          execution: "declarative",
          capabilities: [],
          contributes: {},
          ...overrides,
        }),
      ),
    },
    { level: 0 },
  );
}

const PATH_PACK = new TextEncoder().encode(
  JSON.stringify({
    format: "yunari-path-preset-pack",
    version: 1,
    id: "acme-shapes",
    name: "Acme Shapes",
    presets: [
      { id: "wave", label: "Wave", data: "M 0 0 L 10 10", paint: "stroke" },
    ],
  }),
);

describe("readPackSubmission", () => {
  it("reads a well-formed pack submission", () => {
    expect(readPackSubmission(submission())).toEqual({
      ok: true,
      submission: {
        kind: "widget-pack",
        name: "Starter Cards",
        version: "1.0.0",
        metadata: { name: "Starter Cards" },
        sha256: "a".repeat(64),
        bytes: 1024,
      },
    });
  });

  it("refuses a dashboard theme, an unknown kind and a bad digest", () => {
    expect(readPackSubmission(submission({ kind: "dashboard-theme" })).ok).toBe(
      false,
    );
    expect(readPackSubmission(submission({ kind: "sensor-pack" })).ok).toBe(
      false,
    );
    expect(readPackSubmission(submission({ sha256: "abc" })).ok).toBe(false);
    expect(readPackSubmission(submission({ bytes: 0 })).ok).toBe(false);
    expect(readPackSubmission(submission({ metadata: [] })).ok).toBe(false);
    expect(readPackSubmission(submission({ version: "1.0" })).ok).toBe(false);
  });
});

describe("planPackVersion", () => {
  it("accepts a first version and requires a strictly greater later one", () => {
    expect(planPackVersion(undefined, "1.0.0")).toEqual({
      ok: true,
      version: "1.0.0",
    });
    expect(planPackVersion("1.0.0", "1.0.0").ok).toBe(false);
    expect(planPackVersion("1.0.0", "0.9.9").ok).toBe(false);
    expect(planPackVersion("1.0.0", "1.0.1")).toEqual({
      ok: true,
      version: "1.0.1",
    });
  });

  it("orders a prerelease below its release", () => {
    expect(planPackVersion("1.0.0", "1.0.0-rc.1").ok).toBe(false);
    expect(planPackVersion("1.0.0-rc.1", "1.0.0").ok).toBe(true);
  });
});

describe("defaultFacetsFor", () => {
  it("files a pack as one square tile with no ground", () => {
    const facets = defaultFacetsFor("widget-pack");
    expect(facets).toMatchObject({
      colourMode: "unclassified",
      orientation: "square",
      aspect: "1:1",
      width: 1,
      height: 1,
    });
  });
});

describe("validateFinalizedPackage", () => {
  it("reads each kind's own package and refuses a dashboard theme", () => {
    expect(validateFinalizedPackage("widget-pack", widgetPack())).toEqual({
      ok: true,
      finalized: {
        metadata: { name: "Starter Cards", units: [] },
        executionProfile: null,
      },
    });
    expect(validateFinalizedPackage("path-preset-pack", PATH_PACK)).toEqual({
      ok: true,
      finalized: {
        metadata: {
          name: "Acme Shapes",
          presets: [{ id: "wave", label: "Wave" }],
        },
        executionProfile: null,
      },
    });
    expect(validateFinalizedPackage("editor-theme", editorTheme())).toEqual({
      ok: true,
      finalized: {
        metadata: { name: "Graphite" },
        executionProfile: null,
      },
    });
    expect(validateFinalizedPackage("plugin", pluginPackage()).ok).toBe(true);
    expect(validateFinalizedPackage("dashboard-theme", widgetPack()).ok).toBe(
      false,
    );
  });

  it("refuses bytes that are not the kind's package", () => {
    expect(validateFinalizedPackage("widget-pack", PATH_PACK).ok).toBe(false);
    expect(validateFinalizedPackage("plugin", widgetPack()).ok).toBe(false);
  });
});
