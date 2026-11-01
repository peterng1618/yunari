// @vitest-environment jsdom
import type { FabricThemeEnvelopeInput } from "@yunari/renderer-core";
import {
  serialiseThemeEnvelope,
  setObjectAssetReference,
} from "@yunari/scene-fabric";
import { readWidgetPackage, writeWidgetPackage } from "@yunari/theme-package";
import {
  ActiveSelection,
  Canvas,
  type FabricObject,
  Rect,
  Textbox,
} from "fabric/es";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AssetManager,
  type LocalAssetReference,
} from "./asset-manager/index.js";
import { EditorDocument } from "./editor-document.js";
import type { EditorShell } from "./editor-shell.js";
import { uiCopy } from "./ui-copy.js";
import { extractSelectionWidget } from "./widget-export.js";

const FONT: LocalAssetReference = {
  id: "font",
  kind: "font",
  path: "assets/body.woff2",
  sha256: "f".repeat(64),
  family: "system-ui",
  weight: "400",
  style: "normal",
  format: "woff2",
};
const PHOTO: LocalAssetReference = {
  id: "photo",
  kind: "image",
  path: "assets/photo.png",
  sha256: "b".repeat(64),
};
const UNUSED: LocalAssetReference = {
  id: "unused",
  kind: "image",
  path: "assets/unused.png",
  sha256: "c".repeat(64),
};

function canvasWith(objects: readonly FabricObject[] = []): Canvas {
  const canvas = new Canvas(document.createElement("canvas"), {
    width: 400,
    height: 300,
  });
  for (const object of objects) canvas.add(object);
  return canvas;
}

function textbox(): Textbox {
  const value = new Textbox("42", { left: 10, top: 10, width: 100 });
  value.set("id", "value");
  value.set("yunariText", {
    runs: [
      {
        kind: "literal",
        text: "42",
        typeToken: "typeTokens.body",
        style: { color: { ref: "palette.ink" } },
      },
    ],
  });
  return value;
}

function panel(): Rect {
  const value = new Rect({ left: 0, top: 0, width: 50, height: 50 });
  value.set("id", "panel");
  setObjectAssetReference(value, { assetId: "photo", kind: "image" });
  return value;
}

function other(): Rect {
  const value = new Rect({ left: 200, top: 0, width: 50, height: 50 });
  value.set("id", "other");
  value.set("yunariPaint", { fill: "palette.muted" });
  return value;
}

function envelopeInput(): FabricThemeEnvelopeInput {
  return {
    id: "card-theme",
    artboard: { width: 400, height: 300 },
    metadata: { name: "Card theme", themeLanguage: "en" },
    globals: {
      palette: {
        none: { name: "None", value: { kind: "solid", color: "transparent" } },
        ink: { name: "Ink", value: { kind: "solid", color: "#ffffff" } },
        muted: { name: "Muted", value: { kind: "solid", color: "#888888" } },
      },
      typeTokens: {
        body: {
          family: "system-ui",
          weight: "400",
          face: { assetId: "font" },
        },
        mono: { family: "monospace", weight: "400" },
      },
    },
    assets: [FONT, PHOTO, UNUSED],
    bindings: {
      value: [{ id: "reading", semanticKey: "cpu.load" }],
      other: [{ id: "reading-other", semanticKey: "gpu.load" }],
    },
  };
}

function assets(omitPhoto = false): Record<string, Uint8Array> {
  return {
    "assets/body.woff2": new Uint8Array([1]),
    ...(omitPhoto ? {} : { "assets/photo.png": new Uint8Array([2]) }),
    "assets/unused.png": new Uint8Array([3]),
  };
}

function sceneIds(
  objects: readonly Readonly<Record<string, unknown>>[],
): string[] {
  return objects.flatMap((object) => [
    String(object["id"]),
    ...sceneIds(
      Array.isArray(object["objects"])
        ? object["objects"].filter(
            (child): child is Readonly<Record<string, unknown>> =>
              typeof child === "object" && child !== null,
          )
        : [],
    ),
  ]);
}

function shell(canvas: Canvas): EditorShell {
  return {
    snapshot: (value: FabricThemeEnvelopeInput) =>
      serialiseThemeEnvelope(canvas, value),
    backdrop: () => undefined,
    editor: {
      canvas,
      errorManager: { warn: () => {} },
      historyManager: { attachGlobals: () => {} },
    },
  } as unknown as EditorShell;
}

function documentWith(
  canvas: Canvas,
  declarations: readonly LocalAssetReference[],
  bytes: Record<string, Uint8Array>,
  onError?: (message: string) => void,
): EditorDocument {
  const assets = new AssetManager();
  assets.load({ assets: declarations }, bytes);
  return new EditorDocument({
    source: {
      shell: shell(canvas),
      envelope: envelopeInput(),
      assetManager: assets,
      onNew: async () => {},
      onNewFromStarter: async () => {},
      onSaved: () => {},
      ...(onError === undefined ? {} : { onError }),
    },
    consumers: {
      runtime: () => ({ setThemeLanguage: () => {} }),
      selection: () => ({ setLocale: () => {} }),
    } as never,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("selection widget export", () => {
  it("round-trips the selected subtree, its bindings and its assets", () => {
    const canvas = canvasWith();
    const value = textbox();
    const picture = panel();
    canvas.add(value, picture, other());
    canvas.setActiveObject(new ActiveSelection([value, picture], { canvas }));

    const result = extractSelectionWidget({
      canvas,
      envelope: serialiseThemeEnvelope(canvas, envelopeInput()),
      declarations: [FONT, PHOTO, UNUSED],
      assets: assets(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(sceneIds(result.document.scene.objects as never)).toEqual([
      "value",
      "panel",
    ]);
    expect(result.document.bindings).toEqual({
      value: [{ id: "reading", semanticKey: "cpu.load" }],
    });
    expect(result.document.assets?.map((asset) => asset.id)).toEqual([
      "font",
      "photo",
    ]);
    expect(result.document.globals?.typeTokens).toEqual({
      body: { family: "system-ui", weight: "400", face: { assetId: "font" } },
    });
    expect(result.document.globals?.palette).toMatchObject({
      none: { name: "None" },
      ink: { name: "Ink" },
    });
    expect(result.document.globals?.palette?.["muted"]).toBeUndefined();

    const written = writeWidgetPackage({
      document: result.document,
      assets: result.assets,
    });
    if (!written.ok) throw new Error(written.message);
    expect(written.ok).toBe(true);
    const read = readWidgetPackage(written.bytes);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.document.scene).toEqual(result.document.scene);
    expect(read.document.bindings).toEqual(result.document.bindings);
    expect(read.document.assets).toEqual(result.document.assets);
    expect(read.assets["assets/photo.png"]).toEqual(new Uint8Array([2]));
  });

  it("refuses an empty selection", () => {
    const canvas = canvasWith();
    expect(
      extractSelectionWidget({
        canvas,
        envelope: serialiseThemeEnvelope(canvas, envelopeInput()),
        declarations: [FONT, PHOTO, UNUSED],
        assets: assets(),
      }),
    ).toEqual({
      ok: false,
      message: uiCopy.widgetExport.nothingSelected,
    });
  });

  it("refuses a selection containing a locked object, naming it", () => {
    const canvas = canvasWith();
    const object = panel();
    object.set("locked", true);
    canvas.add(object);
    canvas.setActiveObject(object);

    expect(
      extractSelectionWidget({
        canvas,
        envelope: serialiseThemeEnvelope(canvas, envelopeInput()),
        declarations: [FONT, PHOTO, UNUSED],
        assets: assets(),
      }),
    ).toEqual({
      ok: false,
      message: uiCopy.widgetExport.locked("panel"),
    });
  });

  it("refuses an asset whose bytes are missing, naming it", () => {
    const canvas = canvasWith();
    const object = panel();
    canvas.add(object);
    canvas.setActiveObject(object);

    expect(
      extractSelectionWidget({
        canvas,
        envelope: serialiseThemeEnvelope(canvas, envelopeInput()),
        declarations: [FONT, PHOTO, UNUSED],
        assets: assets(true),
      }),
    ).toEqual({
      ok: false,
      message: uiCopy.widgetExport.missingAsset("assets/photo.png"),
    });
  });

  it("downloads the widget package from the document action", async () => {
    const canvas = canvasWith();
    const value = textbox();
    canvas.add(value, panel(), other());
    canvas.setActiveObject(value);

    let blob: Blob | undefined;
    vi.spyOn(URL, "createObjectURL").mockImplementation((source) => {
      blob = source as Blob;
      return "blob:widget";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    documentWith(canvas, [FONT, PHOTO, UNUSED], assets()).exportWidget();

    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    if (blob === undefined) throw new Error("No package was downloaded.");
    const read = readWidgetPackage(new Uint8Array(await blob.arrayBuffer()));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(sceneIds(read.document.scene.objects as never)).toEqual(["value"]);
  });

  it("reports a refusal through the document's error sink", () => {
    const canvas = canvasWith();
    const errors: string[] = [];
    documentWith(canvas, [FONT, PHOTO, UNUSED], assets(), (message) =>
      errors.push(message),
    ).exportWidget();
    expect(errors).toEqual([uiCopy.widgetExport.nothingSelected]);
  });
});
