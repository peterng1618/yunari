import { defaultFacetsFor } from "@yunari/renderer-core";
import {
  COLLECTION_PACKAGE_FORMAT,
  type CollectionInclude,
  EDITOR_THEME_TOKENS,
  writeEditorThemePackage,
  writeWidgetPackage,
} from "@yunari/theme-package";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { planPackVersion } from "../version/plan.js";
import {
  readPackSubmission,
  validateCollectionIncludes,
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
      schemaVersion: "3.0.0",
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

const SELF_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const MEMBER_ID = "11111111-2222-4ccc-8ddd-555555555555";
const OTHER_COLLECTION_ID = "99999999-8888-4777-8666-555555555555";

function collectionPackage(includes: readonly unknown[]): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      format: COLLECTION_PACKAGE_FORMAT,
      version: 1,
      name: "Starter Kit",
      description: "Hand-picked.",
      includes,
    }),
  );
}

function include(id: string, optional = false): CollectionInclude {
  return { id, optional };
}

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

  /** A pack's own vocabulary is what a wrong kind is told, and `collection` is
   *  one of them; the theme envelope is refused by its own sentence. */
  it("names the pack kinds in its wrong-kind sentence", () => {
    const read = readPackSubmission(submission({ kind: "sensor-pack" }));
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.message).toContain("collection");
    expect(read.message).not.toContain("dashboard-theme");
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

  it("finalizes a collection package into its name and includes", () => {
    const includes = [include(MEMBER_ID), include(OTHER_COLLECTION_ID, true)];
    expect(
      validateFinalizedPackage("collection", collectionPackage(includes)),
    ).toEqual({
      ok: true,
      finalized: {
        metadata: {
          name: "Starter Kit",
          description: "Hand-picked.",
          includes,
        },
        executionProfile: null,
        collection: {
          name: "Starter Kit",
          description: "Hand-picked.",
          includes,
        },
      },
    });
  });

  it("refuses a duplicate include", () => {
    const result = validateFinalizedPackage(
      "collection",
      collectionPackage([include(MEMBER_ID), include(MEMBER_ID)]),
    );
    expect(result).toEqual({
      ok: false,
      message: `The collection include "${MEMBER_ID}" appears twice.`,
    });
  });
});

describe("validateCollectionIncludes", () => {
  it("accepts published ids that are not collections", () => {
    expect(
      validateCollectionIncludes(
        [include(MEMBER_ID)],
        new Map([[MEMBER_ID, "widget-pack"]]),
        SELF_ID,
      ),
    ).toEqual({ ok: true });
  });

  it("refuses a collection including an unpublished id", () => {
    expect(
      validateCollectionIncludes([include(MEMBER_ID)], new Map(), SELF_ID),
    ).toEqual({
      ok: false,
      message: `The collection includes "${MEMBER_ID}", which is not a published item.`,
    });
  });

  it("refuses a collection including itself", () => {
    expect(
      validateCollectionIncludes(
        [include(SELF_ID)],
        new Map([[SELF_ID, "collection"]]),
        SELF_ID,
      ),
    ).toEqual({ ok: false, message: "A collection cannot include itself." });
  });

  it("refuses a nested collection", () => {
    expect(
      validateCollectionIncludes(
        [include(OTHER_COLLECTION_ID)],
        new Map([[OTHER_COLLECTION_ID, "collection"]]),
        SELF_ID,
      ),
    ).toEqual({
      ok: false,
      message: `The collection includes "${OTHER_COLLECTION_ID}", which is itself a collection; collections are one level deep.`,
    });
  });
});
