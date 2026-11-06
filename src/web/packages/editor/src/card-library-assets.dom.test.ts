// @vitest-environment jsdom

import { createHash, webcrypto } from "node:crypto";
import type { AssetReference, FabricGlobals } from "@yunari/renderer-core";
import { addImageObject, createBlankTheme } from "@yunari/theme-kit";
import { writeWidgetPackage } from "@yunari/theme-package";
import { Canvas, FabricImage } from "fabric/es";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssetManager } from "./asset-manager/index.js";
import { insertCard } from "./card-library.js";
import { createNewFabricTheme } from "./new-fabric-theme.js";
import {
  installStarterUnits,
  installWidgetPack,
} from "./testing/widget-units.js";

/** Holds one insertion inside enlivening, so a concurrent import can land. */
const enlivenHold = vi.hoisted(() => ({
  wait: undefined as undefined | (() => Promise<void>),
}));

// The namespace export is not configurable, so the module is mocked and every
// other case falls through to the real enlivener.
vi.mock("fabric/es", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fabric/es")>();
  return {
    ...actual,
    util: {
      ...actual.util,
      enlivenObjects: async (objects: unknown, options?: unknown) => {
        await enlivenHold.wait?.();
        return actual.util.enlivenObjects(objects as never, options as never);
      },
    },
  };
});

// jsdom's `crypto` has no SubtleCrypto, and adoption verifies digests through
// it exactly as a browser does.
if (globalThis.crypto?.subtle === undefined) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}

const STARTER_GLOBALS = createNewFabricTheme().globals as FabricGlobals;
const PICTURE_BYTES = new Uint8Array([137, 80, 78, 71]);
const FACE_BYTES = new Uint8Array([0, 1, 2, 3]);
const PICTURE_URL = "blob:pack-picture";

function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * A pack whose one declaration draws a picture, plus a body face no object in
 * the subtree names. `unmappable` makes the visible object reference a token
 * the insertion can refuse, so adoption must not have landed first.
 */
function picturePack(
  options: {
    readonly unmappable?: boolean;
    readonly unknownType?: boolean;
  } = {},
): Uint8Array {
  const picture: AssetReference = {
    id: "pack-image",
    kind: "image",
    path: "assets/pack.png",
    sha256: sha256Of(PICTURE_BYTES),
  };
  const face = {
    id: "unused-face",
    kind: "font",
    path: "assets/face.woff2",
    sha256: sha256Of(FACE_BYTES),
    family: "Inter",
    weight: 400,
    style: "normal",
    format: "woff2",
  } as const;
  const { artboard: _artboard, ...document } = createBlankTheme({
    artboard: { width: 1, height: 1 },
  });
  const globals = document.globals as Record<string, unknown>;
  const written = writeWidgetPackage({
    document: {
      ...document,
      scene: {
        version: "7.4.0",
        objects: [
          {
            ...addImageObject({
              id: "picture-image",
              assetId: picture.id,
              kind: "image",
              left: 0,
              top: 0,
              width: 20,
              height: 20,
            }),
            provenance: { widgetId: "picture", widgetName: "Picture" },
            ...(options.unmappable === true
              ? { yunariPaint: { fill: "palette.frost" } }
              : {}),
            // The envelope accepts any non-empty type string; enlivening is
            // what discovers the class registry has no such object.
            ...(options.unknownType === true
              ? { type: "NotARealFabricObject" }
              : {}),
          },
          {
            type: "Group",
            id: "nested-picture",
            left: 0,
            top: 0,
            width: 20,
            height: 20,
            provenance: {
              widgetId: "nested-picture",
              widgetName: "Nested picture",
            },
            objects: [
              addImageObject({
                id: "nested-picture-image",
                assetId: picture.id,
                kind: "image",
                left: 0,
                top: 0,
                width: 20,
                height: 20,
              }),
            ],
          },
        ],
      },
      bindings: {},
      globals: {
        ...globals,
        typeTokens: {
          ...(globals["typeTokens"] as Record<string, unknown>),
          body: { family: "Inter", face: { assetId: face.id } },
        },
      },
      assets: [picture, face],
    } as never,
    assets: {
      "assets/pack.png": PICTURE_BYTES,
      "assets/face.woff2": FACE_BYTES,
    },
  });
  if (!written.ok) throw new Error(written.message);
  return written.bytes;
}

/** A chosen file, as the assets pane hands one to `import`. */
function chosenFile(path: string, bytes: Uint8Array): File {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return Object.assign(
    new File([bytes as unknown as BlobPart], name, {
      type: "image/png",
    }),
    {
      arrayBuffer: async () =>
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
    },
  );
}

function stage(): Canvas {
  const element = document.createElement("canvas");
  element.width = 1672;
  element.height = 941;
  document.body.append(element);
  return new Canvas(element);
}

/** The surface an insertion writes through, as the editor's managers expose it. */
function editorStub(canvas: Canvas) {
  return {
    canvas,
    artboard: () => ({ width: 1672, height: 941 }),
    historyManager: { attachEnvelope: () => {}, saveState: vi.fn() },
    errorManager: { warn: vi.fn(), error: vi.fn() },
  };
}

/**
 * Records the `src` each image is enlivened with. jsdom cannot decode a blob
 * URL, so `fromObject` is the probe: it proves the src existed before revival.
 */
function recordImageRevival(): Record<string, unknown>[] {
  const seen: Record<string, unknown>[] = [];
  vi.spyOn(FabricImage, "fromObject").mockImplementation(async (serialized) => {
    seen.push(serialized as Record<string, unknown>);
    return new FabricImage(document.createElement("img"), {
      id: serialized["id"] as string,
      left: serialized["left"] as number,
      top: serialized["top"] as number,
    });
  });
  return seen;
}

beforeEach(async () => {
  await installStarterUnits();
  // jsdom cannot drawImage an undecoded img, and a card carries frosted parts.
  const real = document.createElement("canvas").getContext("2d");
  if (real === null) return;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      new Proxy(real, {
        get(target, property) {
          if (property === "drawImage") return (): void => {};
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
        set(target, property, value) {
          if (property === "patternQuality") return true;
          return Reflect.set(target, property, value);
        },
      }) as unknown as CanvasRenderingContext2D,
  );
});

afterEach(() => {
  enlivenHold.wait = undefined;
  vi.restoreAllMocks();
});

describe("an inserted unit that carries an image", () => {
  it.each(["picture", "nested-picture"])(
    "points %s's image at its adopted preview URL before enlivening it",
    async (unit) => {
      await installWidgetPack("picture-pack", picturePack());
      vi.spyOn(URL, "createObjectURL").mockReturnValue(PICTURE_URL);
      const seen = recordImageRevival();

      await insertCard(editorStub(stage()) as never, unit, {
        globals: STARTER_GLOBALS,
        onBindings: vi.fn(),
        assetManager: new AssetManager(),
      });

      expect(seen[0]?.["src"]).toBe(PICTURE_URL);
    },
  );

  it("leaves the asset list unchanged when the copy is refused", async () => {
    // The unit carries a picture *and* a token this theme cannot resolve, so
    // adoption would have landed before the refusal if it ran first.
    await installWidgetPack("picture-pack", picturePack({ unmappable: true }));
    const assets = new AssetManager();

    await expect(
      insertCard(editorStub(stage()) as never, "picture", {
        globals: undefined,
        onBindings: vi.fn(),
        assetManager: assets,
      }),
    ).rejects.toThrow(/palette\.frost/);

    expect(assets.declarations).toEqual([]);
    expect(assets.assets).toEqual({});
    expect(assets.mutationCount).toBe(0);
  });

  it("leaves the asset list unchanged when enlivening the copy fails", async () => {
    // The envelope accepts the type string, so adoption commits; enlivening
    // then discovers no such Fabric class and the insert rejects.
    await installWidgetPack("picture-pack", picturePack({ unknownType: true }));
    vi.spyOn(URL, "createObjectURL").mockReturnValue(PICTURE_URL);
    const assets = new AssetManager();

    await expect(
      insertCard(editorStub(stage()) as never, "picture", {
        globals: STARTER_GLOBALS,
        onBindings: vi.fn(),
        assetManager: assets,
      }),
    ).rejects.toThrow();

    expect(assets.declarations).toEqual([]);
    expect(assets.assets).toEqual({});
    expect(assets.mutationCount).toBe(0);
  });

  it("keeps an asset imported while the insert is enlivening", async () => {
    await installWidgetPack("picture-pack", picturePack());
    const create = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation(() => `blob:preview-${create.mock.calls.length}`);
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const assets = new AssetManager();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const enlivening = new Promise<void>((resolve) => {
      entered = resolve;
    });
    enlivenHold.wait = async () => {
      entered();
      await gate;
      throw new Error("enliven failed");
    };
    const insertion = insertCard(editorStub(stage()) as never, "picture", {
      globals: STARTER_GLOBALS,
      onBindings: vi.fn(),
      assetManager: assets,
    });
    // The adoption is committed before enlivening starts, so the import below
    // lands exactly in the window the rollback used to erase.
    await enlivening;
    const adoptedUrl = assets.previewUrl("pack-image");
    const late = await assets.import(
      chosenFile("assets/late.png", PICTURE_BYTES),
    );
    const lateUrl = assets.previewUrl(late.id);
    release();

    await expect(insertion).rejects.toThrow("enliven failed");

    expect(assets.declarations.map((entry) => entry.id)).toEqual([late.id]);
    expect(assets.assets["assets/late.png"]).toEqual(PICTURE_BYTES);
    expect(assets.assets["assets/pack.png"]).toBeUndefined();
    expect(adoptedUrl).toBeDefined();
    expect(revoke).toHaveBeenCalledWith(adoptedUrl);
    expect(revoke).not.toHaveBeenCalledWith(lateUrl);
    expect(assets.previewUrl(late.id)).toBe(lateUrl);
  });
});
