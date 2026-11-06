import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  readWidgetPackage,
  readWidgetPackageFiles,
  type WidgetDocument,
  writeWidgetPackage,
} from "./index.js";

/**
 * A widget is a theme's scene fields without an artboard: the object subtree,
 * the bindings keyed by it, the globals it uses and the assets it references.
 * These cases hold the package container to that shape and the round trip to
 * the acceptance issue's three survivors.
 */
const widget: WidgetDocument = {
  schemaVersion: "2.0.0",
  fabricVersion: "7.4.0",
  id: "card",
  metadata: { themeLanguage: "en" },
  globals: {
    palette: {
      none: { name: "None", value: { kind: "solid", color: "transparent" } },
      ink: { name: "Ink", value: { kind: "solid", color: "#ffffff" } },
    },
  },
  assets: [
    {
      id: "photo",
      kind: "image",
      path: "assets/photo.png",
      sha256: "a".repeat(64),
    },
  ],
  scene: {
    version: "7.4.0",
    objects: [
      { type: "Rect", id: "panel" },
      {
        type: "Group",
        id: "card",
        objects: [{ type: "Rect", id: "value" }],
      },
    ],
  },
  bindings: {
    value: [{ id: "reading", semanticKey: "cpu.load" }],
  },
};

const photo = new Uint8Array([1, 2, 3]);

/** The brief's assertion: fail the case here, and narrow the result after. */
function assert(value: unknown): asserts value {
  expect(value).toBe(true);
}

/** One top-level unit, stamped the way the editor stamps a card. */
function groupWithProvenance(
  widgetId: string,
  widgetName: string,
): Readonly<Record<string, unknown>> {
  return {
    type: "Group",
    id: widgetId,
    objects: [{ type: "Rect", id: `${widgetId}-value` }],
    provenance: { widgetId, widgetName },
  };
}

function widgetFiles(options: {
  readonly objects: readonly Readonly<Record<string, unknown>>[];
  readonly manifestUnits?: readonly {
    readonly id: string;
    readonly label: string;
    readonly objectId: string;
  }[];
  readonly assets?: readonly Readonly<Record<string, unknown>>[];
  readonly assetBytes?: Readonly<Record<string, Uint8Array>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly globals?: Readonly<Record<string, unknown>>;
  readonly background?: Readonly<Record<string, unknown>>;
  readonly bindings?: Readonly<
    Record<string, readonly Readonly<Record<string, unknown>>[]>
  >;
}): Readonly<Record<string, Uint8Array>> {
  const document = {
    ...widget,
    scene: { version: "7.4.0", objects: options.objects },
    bindings:
      options.bindings ??
      Object.fromEntries(
        options.objects.map((object) => [
          String(object["id"]),
          [{ id: `${String(object["id"])}-binding`, semanticKey: "cpu.load" }],
        ]),
      ),
    assets: options.assets ?? [],
    ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
    ...(options.globals === undefined ? {} : { globals: options.globals }),
    ...(options.background === undefined
      ? {}
      : { background: options.background }),
  };
  return {
    "manifest.json": strToU8(
      JSON.stringify({
        format: "yunari-widget-package",
        version: 1,
        widget: "widget.json",
        ...(options.manifestUnits === undefined
          ? {}
          : { units: options.manifestUnits }),
      }),
    ),
    "widget.json": strToU8(JSON.stringify(document)),
    ...Object.fromEntries(
      (options.assets ?? []).map((asset) => [
        String(asset["path"]),
        options.assetBytes?.[String(asset["path"])] ?? new Uint8Array([1]),
      ]),
    ),
  };
}

describe("widget package", () => {
  it("round-trips the scene subtree, its bindings and its assets", () => {
    const written = writeWidgetPackage({
      document: widget,
      assets: { "assets/photo.png": photo },
    });
    expect(written.ok).toBe(true);
    if (!written.ok) return;

    const read = readWidgetPackage(written.bytes);
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    expect(read.document.scene).toEqual(widget.scene);
    expect(read.document.bindings).toEqual(widget.bindings);
    expect(read.document.assets).toEqual(widget.assets);
    expect(read.document.globals).toEqual(widget.globals);
    expect(read.assets["assets/photo.png"]).toEqual(photo);
  });

  it("names its kind in the manifest", () => {
    const written = writeWidgetPackage({
      document: widget,
      assets: { "assets/photo.png": photo },
    });
    if (!written.ok) throw new Error(written.message);
    const files = unzipSync(written.bytes);
    expect(JSON.parse(strFromU8(files["manifest.json"]!))).toEqual({
      format: "yunari-widget-package",
      version: 1,
      widget: "widget.json",
    });
    expect(files["widget.json"]).toBeDefined();
  });

  it("refuses a document that declares an asset the package does not carry", () => {
    expect(writeWidgetPackage({ document: widget, assets: {} })).toMatchObject({
      ok: false,
      message: "Package assets must exactly match the theme declaration.",
    });
  });

  it("refuses an archive that is not a widget package", () => {
    const themeManifest = zipSync({
      "manifest.json": strToU8(
        JSON.stringify({
          format: "yunari-theme-package",
          version: 1,
          theme: "theme.json",
        }),
      ),
      "theme.json": strToU8(JSON.stringify(widget)),
      "assets/photo.png": photo,
    });
    expect(readWidgetPackage(themeManifest)).toMatchObject({
      ok: false,
      message: "That package contains unsafe archive entries.",
    });
  });

  it("refuses a widget document that carries an artboard", () => {
    const written = zipSync({
      "manifest.json": strToU8(
        JSON.stringify({
          format: "yunari-widget-package",
          version: 1,
          widget: "widget.json",
        }),
      ),
      "widget.json": strToU8(
        JSON.stringify({ ...widget, artboard: { width: 10, height: 10 } }),
      ),
      "assets/photo.png": photo,
    });
    expect(readWidgetPackage(written)).toMatchObject({
      ok: false,
      message: "A widget document must not carry an artboard.",
    });
  });

  it("reads two provenance units from one package", () => {
    const result = readWidgetPackageFiles(
      widgetFiles({
        objects: [
          groupWithProvenance("a", "Alpha"),
          groupWithProvenance("b", "Beta"),
        ],
      }),
    );
    assert(result.ok);
    expect(result.units.map((unit) => [unit.id, unit.label])).toEqual([
      ["a", "Alpha"],
      ["b", "Beta"],
    ]);
    expect(result.units[0]?.document.scene["objects"]).toHaveLength(1);
    expect(result.units[0]?.document.bindings).toHaveProperty("a");
    expect(result.units[0]?.document.bindings).not.toHaveProperty("b");
  });

  it("refuses a manifest unit naming no top-level object", () => {
    const result = readWidgetPackageFiles(
      widgetFiles({
        objects: [groupWithProvenance("a", "Alpha")],
        manifestUnits: [{ id: "missing", label: "Missing", objectId: "nope" }],
      }),
    );
    expect(result).toEqual({
      ok: false,
      message: 'Widget unit "missing" names no top-level object "nope".',
    });
  });

  it("refuses a duplicate manifest unit id", () => {
    const result = readWidgetPackageFiles(
      widgetFiles({
        objects: [
          groupWithProvenance("a", "Alpha"),
          groupWithProvenance("b", "Beta"),
        ],
        manifestUnits: [
          { id: "same", label: "One", objectId: "a" },
          { id: "same", label: "Two", objectId: "b" },
        ],
      }),
    );
    expect(result).toEqual({
      ok: false,
      message: 'Widget unit "same" is declared more than once.',
    });
  });

  it("keeps only the asset declarations a unit's subtree references", () => {
    const usedBytes = new Uint8Array([7, 8, 9]);
    const unusedBytes = new Uint8Array([4, 5, 6]);
    const result = readWidgetPackageFiles(
      widgetFiles({
        objects: [
          {
            ...groupWithProvenance("a", "Alpha"),
            yunariAsset: { assetId: "used", kind: "image" },
          },
        ],
        assets: [
          {
            id: "used",
            kind: "image",
            path: "assets/used.png",
            sha256: "a".repeat(64),
          },
          {
            id: "unused",
            kind: "image",
            path: "assets/unused.png",
            sha256: "a".repeat(64),
          },
        ],
        assetBytes: {
          "assets/used.png": usedBytes,
          "assets/unused.png": unusedBytes,
        },
      }),
    );
    assert(result.ok);
    expect(result.units[0]?.declarations.map((asset) => asset.id)).toEqual([
      "used",
    ]);
    expect(Object.keys(result.units[0]?.assets ?? {})).toEqual([
      "assets/used.png",
    ]);
    expect(result.units[0]?.assets["assets/used.png"]).toEqual(usedBytes);
  });

  it("refuses an asset declaration with no SHA-256 digest", () => {
    const result = readWidgetPackageFiles(
      widgetFiles({
        objects: [
          {
            ...groupWithProvenance("a", "Alpha"),
            yunariAsset: { assetId: "used", kind: "image" },
          },
        ],
        assets: [{ id: "used", kind: "image", path: "assets/used.png" }],
      }),
    );
    // An install must refuse at the container boundary: the insert path
    // verifies digests and would otherwise fail only when the unit is used.
    expect(result).toEqual({
      ok: false,
      message: "Package asset assets/used.png declares no SHA-256 digest.",
    });
  });

  it("keeps a type-token face the kept globals name", () => {
    const face = new Uint8Array([9, 9, 9]);
    const result = readWidgetPackageFiles(
      widgetFiles({
        objects: [groupWithProvenance("a", "Alpha")],
        globals: {
          typeTokens: { body: { family: "Inter", face: { assetId: "face" } } },
        },
        assets: [
          {
            id: "face",
            kind: "font",
            path: "assets/face.woff2",
            sha256: "a".repeat(64),
            family: "Inter",
            weight: 400,
            style: "normal",
            format: "woff2",
          },
        ],
        assetBytes: { "assets/face.woff2": face },
      }),
    );
    assert(result.ok);
    const unit = result.units[0]!;
    expect(unit.declarations.map((asset) => asset.id)).toEqual(["face"]);
    expect(unit.assets["assets/face.woff2"]).toEqual(face);
    expect(
      writeWidgetPackage({ document: unit.document, assets: unit.assets }).ok,
    ).toBe(true);
  });

  it("drops a media background from the derived unit", () => {
    const result = readWidgetPackageFiles(
      widgetFiles({
        objects: [groupWithProvenance("a", "Alpha")],
        background: { media: { assetId: "clip", bounds: "theme" } },
        assets: [
          {
            id: "clip",
            kind: "video",
            path: "assets/clip.mp4",
            sha256: "a".repeat(64),
          },
        ],
      }),
    );
    assert(result.ok);
    const unit = result.units[0]!;
    expect(unit.document).not.toHaveProperty("background");
    expect(
      writeWidgetPackage({ document: unit.document, assets: unit.assets }).ok,
    ).toBe(true);
  });

  it("derives unique ids for two copies of one card", () => {
    const result = readWidgetPackageFiles(
      widgetFiles({
        objects: [
          {
            ...groupWithProvenance("a", "Alpha"),
            id: "a-1",
            objects: [{ type: "Rect", id: "a-1-value" }],
          },
          {
            ...groupWithProvenance("a", "Alpha"),
            id: "a-2",
            objects: [{ type: "Rect", id: "a-2-value" }],
          },
        ],
      }),
    );
    assert(result.ok);
    expect(result.units.map((unit) => [unit.id, unit.label])).toEqual([
      ["a", "Alpha"],
      ["a-2", "Alpha"],
    ]);
  });

  it("falls back to the widget id when provenance carries no name", () => {
    const result = readWidgetPackageFiles(
      widgetFiles({
        objects: [
          {
            type: "Group",
            id: "a",
            objects: [],
            provenance: { widgetId: "a" },
          },
        ],
      }),
    );
    assert(result.ok);
    expect(result.units[0]?.label).toBe("a");
  });

  it("keeps the package identity fields on a unit", () => {
    const metadata = { name: "Pack", version: "1.2.3", themeLanguage: "en" };
    const result = readWidgetPackageFiles(
      widgetFiles({
        objects: [groupWithProvenance("a", "Alpha")],
        metadata,
        globals: widget.globals!,
      }),
    );
    assert(result.ok);
    const unit = result.units[0]!;
    expect(unit.document.schemaVersion).toBe(widget.schemaVersion);
    expect(unit.document.fabricVersion).toBe(widget.fabricVersion);
    expect(unit.document.id).toBe(widget.id);
    expect(unit.document.metadata).toEqual(metadata);
    expect(unit.document.globals).toEqual(widget.globals);
    expect(result.name).toBe("Pack");
    expect(result.version).toBe("1.2.3");
  });

  it("keeps a child's binding and drops a sibling's", () => {
    const result = readWidgetPackageFiles(
      widgetFiles({
        objects: [
          {
            type: "Group",
            id: "a",
            objects: [{ type: "Rect", id: "child" }],
            provenance: { widgetId: "a", widgetName: "Alpha" },
          },
          groupWithProvenance("b", "Beta"),
        ],
        bindings: {
          a: [{ id: "a-binding", semanticKey: "cpu.load" }],
          child: [{ id: "child-binding", semanticKey: "cpu.load" }],
          b: [{ id: "b-binding", semanticKey: "cpu.load" }],
        },
      }),
    );
    assert(result.ok);
    expect(
      Object.keys(result.units[0]?.document.bindings ?? {}).sort(),
    ).toEqual(["a", "child"]);
  });
});
