import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  readWidgetPackage,
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
});
