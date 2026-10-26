// @vitest-environment jsdom

import { setObjectAssetReference } from "@yunari/scene-fabric";
import { Canvas, FabricImage, Group, Rect, type StaticCanvas } from "fabric/es";
import { describe, expect, it, vi } from "vitest";
import { fontTrio } from "../font-catalog.js";
import { AssetManager, assetReferencedBy } from "./index.js";

const PNG = new Uint8Array([137, 80, 78, 71]);

function file(bytes: Uint8Array | string, name: string, type: string): File {
  const source =
    typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return Object.assign(
    new File([source as unknown as BlobPart], name, { type }),
    {
      arrayBuffer: async () =>
        source.buffer.slice(
          source.byteOffset,
          source.byteOffset + source.byteLength,
        ),
    },
  );
}

describe("AssetManager", () => {
  it("copies an allowed image into a collision-safe package path", async () => {
    const manager = new AssetManager();

    const first = await manager.import(file(PNG, "logo.png", "image/png"));
    const second = await manager.import(file(PNG, "logo.png", "image/png"));

    expect(first).toMatchObject({
      id: "logo",
      kind: "image",
      path: "assets/logo.png",
    });
    expect(second).toMatchObject({
      id: "logo-2",
      kind: "image",
      path: "assets/logo-2.png",
    });
    expect(manager.assets["assets/logo.png"]).toEqual(PNG);
    expect(manager.assets["assets/logo-2.png"]).toEqual(PNG);
  });

  it("counts every change to the bytes or the declarations", async () => {
    const manager = new AssetManager();
    expect(manager.mutationCount).toBe(0);

    const logo = await manager.import(file(PNG, "logo.png", "image/png"));
    expect(manager.mutationCount).toBe(1);

    await manager.replace(logo.id, file(PNG, "logo.png", "image/png"));
    expect(manager.mutationCount).toBe(2);

    await manager.replaceBytes(logo.id, new Uint8Array([1, 2]));
    expect(manager.mutationCount).toBe(3);

    const face = fontTrio("minimal")!.faces[0]!;
    await manager.adoptFont(face, new Uint8Array([0, 1, 2]));
    expect(manager.mutationCount).toBe(4);

    expect(manager.remove(logo.id)).toBe(true);
    expect(manager.mutationCount).toBe(5);
    // A refused removal changed nothing, so it must not move the counter.
    expect(manager.remove(logo.id)).toBe(false);
    expect(manager.mutationCount).toBe(5);

    manager.load({ assets: [] }, {});
    expect(manager.mutationCount).toBe(6);
  });

  it("leaves package bytes unchanged for unsafe or mismatched files", async () => {
    const manager = new AssetManager();
    const unsafe = file(
      "<svg><script>alert(1)</script></svg>",
      "logo.svg",
      "image/svg+xml",
    );
    const mismatch = file(PNG, "logo.png", "image/jpeg");

    await expect(manager.import(unsafe)).rejects.toThrow("unsafe SVG");
    await expect(manager.import(mismatch)).rejects.toThrow("MIME type");

    expect(manager.assets).toEqual({});
  });

  it("retains MP4 bytes and supplies a disposable background source", async () => {
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:loop");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const manager = new AssetManager();

    const asset = await manager.import(
      file(new Uint8Array([0, 1, 2]), "loop.mp4", "video/mp4"),
    );
    const source = manager.backgroundSource(asset.id);

    expect(asset).toMatchObject({ kind: "video", path: "assets/loop.mp4" });
    expect(manager.assets["assets/loop.mp4"]).toEqual(
      new Uint8Array([0, 1, 2]),
    );
    expect(source?.url).toBe("blob:loop");
    source?.dispose?.();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:loop");
    expect(createObjectURL).toHaveBeenCalledOnce();
  });

  it("copies a declared WOFF2 face into package storage", async () => {
    const manager = new AssetManager();

    const asset = await manager.import(
      file(new Uint8Array([0, 1, 2]), "metric.woff2", "font/woff2"),
    );

    expect(asset).toMatchObject({
      id: "metric",
      kind: "font",
      path: "assets/metric.woff2",
    });
    expect(manager.assets["assets/metric.woff2"]).toEqual(
      new Uint8Array([0, 1, 2]),
    );
  });

  it("refuses a font format the theme cannot declare", async () => {
    // The package types a font's format as `woff2` and the envelope validator
    // refuses anything else, so offering `.woff` here promised a file that
    // could not be saved. Refused at import, before any bytes are kept.
    const manager = new AssetManager();

    await expect(
      manager.import(file(new Uint8Array([0, 1, 2]), "body.woff", "font/woff")),
    ).rejects.toThrow("Unsupported asset file type.");

    expect(manager.assets).toEqual({});
    expect(manager.declarations).toEqual([]);
  });

  it("adopts a curated face with its declared package metadata", async () => {
    const manager = new AssetManager();
    const face = fontTrio("minimal")!.faces[0]!;

    const asset = await manager.adoptFont(face, new Uint8Array([0, 1, 2]));

    expect(asset).toMatchObject({
      id: face.id,
      kind: "font",
      path: `assets/${face.id}.woff2`,
      family: face.family,
      weight: face.weight,
      format: "woff2",
    });
    expect(manager.assets[`assets/${face.id}.woff2`]).toEqual(
      new Uint8Array([0, 1, 2]),
    );
  });

  it("rejects a MIME type that does not match a WebM extension", async () => {
    const manager = new AssetManager();

    await expect(
      manager.import(file(PNG, "loop.webm", "video/mp4")),
    ).rejects.toThrow("MIME type");

    expect(manager.assets).toEqual({});
  });

  it("revokes each preview URL when the manager is destroyed", async () => {
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:logo");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const manager = new AssetManager();

    await manager.import(file(PNG, "logo.png", "image/png"));
    manager.destroy();

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:logo");
  });

  it("answers a reference it cannot name with nothing rather than throwing", () => {
    // This is what a scene revival asks, before Fabric loads anything: an
    // asset the manager has no bytes for has to be a miss the caller can
    // handle. It threw before, out of a revival that had no way to catch it.
    const manager = new AssetManager();
    manager.load(
      {
        assets: [
          { id: "logo", kind: "image", path: "assets/logo.png" },
          { id: "clip", kind: "video", path: "assets/clip.mp4" },
        ],
      },
      { "assets/clip.mp4": new Uint8Array([1]) },
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:probe");

    // `logo` is declared and its bytes never arrived, which is what a document
    // opened without its package looks like.
    expect(manager.previewUrl("logo")).toBeUndefined();
    expect(manager.previewUrl("clip")).toBeUndefined();
    expect(manager.previewUrl("never-declared")).toBeUndefined();
    // Readable, so the miss is a wrong answer rather than a crash.
    expect(manager.previewUrl("logo")).not.toBe("blob:probe");
  });

  it("answers an avif preview and a miss for an extension it cannot type", () => {
    // `avif` is in the shared media-type table, so the host serves it and the
    // editor must be able to show it; an extension the table does not type is
    // the miss `previewUrl` promises, not an exception out of a revival.
    const manager = new AssetManager();
    manager.load(
      {
        assets: [
          { id: "photo", kind: "image", path: "assets/photo.avif" },
          { id: "mystery", kind: "image", path: "assets/mystery.tiff" },
        ],
      },
      {
        "assets/photo.avif": new Uint8Array([1]),
        "assets/mystery.tiff": new Uint8Array([2]),
      },
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:photo");

    expect(manager.previewUrl("photo")).toBe("blob:photo");
    expect(manager.previewUrl("mystery")).toBeUndefined();
  });

  it("hydrates an asset-referenced Fabric image from declared package bytes", async () => {
    const manager = new AssetManager();
    const element = document.createElement("img");
    const image = Object.assign(Object.create(FabricImage.prototype), {
      get: vi.fn(() => ({ assetId: "logo", kind: "image" })),
      setElement: vi.fn(),
    }) as FabricImage;
    const canvas = {
      getObjects: () => [image],
      requestRenderAll: vi.fn(),
    } as unknown as StaticCanvas;
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:logo");
    vi.spyOn(FabricImage, "fromURL").mockResolvedValue({
      getElement: () => element,
    } as FabricImage);
    manager.load(
      { assets: [{ id: "logo", kind: "image", path: "assets/logo.png" }] },
      { "assets/logo.png": PNG },
    );

    await manager.hydrate(canvas);

    expect(FabricImage.fromURL).toHaveBeenCalledWith("blob:logo");
    expect(image.setElement).toHaveBeenCalledWith(element);
  });

  it("bounds a rehydrated oversized image to the import bound", async () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const object = new FabricImage(document.createElement("img"), {
      id: "image-1",
    });
    setObjectAssetReference(object, { assetId: "big", kind: "image" });
    canvas.add(object);

    const manager = new AssetManager();
    manager.load(
      {
        assets: [
          { id: "big", kind: "image", path: "assets/big.png", sha256: "x" },
        ],
      },
      { "assets/big.png": new Uint8Array([1]) },
    );
    vi.spyOn(FabricImage, "fromURL").mockResolvedValue(
      new FabricImage(oversizedImage(8192, 4096)),
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);

    await manager.hydrate(canvas);

    const element = object.getElement();
    expect(element.width).toBe(4096);
    expect(element.height).toBe(2048);
    manager.destroy();
  });

  it("replaces an asset's bytes in place, keeping its id and path", async () => {
    // U1: "Replace" had no path that swapped bytes. It declared a *new* asset
    // and re-pointed whichever object was selected, so the chosen asset kept
    // the bytes it had and the package grew by one file per press.
    const manager = new AssetManager();
    const original = await manager.import(file(PNG, "logo.png", "image/png"));
    const replacement = new Uint8Array([137, 80, 78, 72]);

    const next = await manager.replace(
      original.id,
      file(replacement, "other.png", "image/png"),
    );

    expect(next).toMatchObject({
      id: "logo",
      kind: "image",
      path: "assets/logo.png",
    });
    expect(manager.declarations).toHaveLength(1);
    expect(manager.assets["assets/logo.png"]).toEqual(replacement);
    expect(manager.previewUrl("logo")).toBeDefined();
  });

  it("revokes the stale preview so the new bytes are what a preview shows", async () => {
    const manager = new AssetManager();
    const created = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:old")
      .mockReturnValue("blob:new");
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const original = await manager.import(file(PNG, "logo.png", "image/png"));
    expect(manager.previewUrl("logo")).toBe("blob:old");

    await manager.replace(
      original.id,
      file(new Uint8Array([1, 2, 3]), "logo.png", "image/png"),
    );

    expect(revoke).toHaveBeenCalledWith("blob:old");
    expect(manager.previewUrl("logo")).toBe("blob:new");
    created.mockRestore();
  });

  it("refuses to replace an asset it does not hold", async () => {
    const manager = new AssetManager();

    await expect(
      manager.replace("missing", file(PNG, "logo.png", "image/png")),
    ).rejects.toThrow(/missing/);
  });

  it("refuses a replacement whose MIME type does not match its extension", async () => {
    const manager = new AssetManager();
    const original = await manager.import(file(PNG, "logo.png", "image/png"));

    await expect(
      manager.replace(original.id, file(PNG, "logo.jpg", "image/png")),
    ).rejects.toThrow(/MIME/);
    expect(manager.assets["assets/logo.png"]).toEqual(PNG);
  });

  it("refuses a replacement that would change the declared file extension", async () => {
    const manager = new AssetManager();
    const original = await manager.import(file(PNG, "logo.png", "image/png"));

    await expect(
      manager.replace(original.id, file(PNG, "logo.jpg", "image/jpeg")),
    ).rejects.toThrow(/extension/);
    expect(manager.assets["assets/logo.png"]).toEqual(PNG);
  });

  it("replaces a font's bytes without touching its curated metadata", async () => {
    const manager = new AssetManager();
    const trio = fontTrio("minimal");
    const face = trio?.faces[0];
    if (trio === undefined || face === undefined)
      throw new Error("the catalogue has no faces");
    await manager.adoptFont(face, new Uint8Array([1]));
    const other = { ...face, id: "other", family: "Other" };
    await manager.adoptFont(other, new Uint8Array([9]));
    const before = manager.declarations.length;

    await manager.replace(
      "other",
      file(new Uint8Array([7, 7]), "other.woff2", "font/woff2"),
    );

    expect(manager.declarations).toHaveLength(before);
    // The catalogue owns family, weight, licence and source; the file owns the
    // bytes and the digest, and replacing the file must not rewrite the former.
    expect(manager.declarations.find((a) => a.id === "other")).toMatchObject({
      family: "Other",
      license: face.license,
    });
    expect(manager.assets["assets/other.woff2"]).toEqual(
      new Uint8Array([7, 7]),
    );
  });
});

/** jsdom reports zero natural size, so declare it the way a decode would. */
function oversizedImage(width: number, height: number): HTMLImageElement {
  const element = document.createElement("img");
  Object.defineProperty(element, "naturalWidth", { value: width });
  Object.defineProperty(element, "naturalHeight", { value: height });
  return element;
}

describe("AssetManager.placeImage", () => {
  it("does not declare a file twice when the caller already declared it", async () => {
    // The pane imports a file and then places it. `placeImage` imports as well,
    // so a caller that hands over its own declaration must not be given a
    // second one — one Import click produced `name` and `name-2` with one
    // object on the canvas, and an author has no way to tell which is which.
    const manager = new AssetManager();
    const source = file(PNG, "test-image.png", "image/png");
    const declared = await manager.import(source);
    const editor = {
      imageManager: {
        importImage: vi.fn(async () => ({
          image: new FabricImage(document.createElement("img")),
        })),
      },
      canvas: { setActiveObject: vi.fn() },
    } as never;

    await manager.placeImage(editor, source, declared);

    expect(manager.declarations).toHaveLength(1);
    expect(manager.declarations[0]?.id).toBe(declared.id);
  });

  it("declares the file itself when the caller has not", async () => {
    const manager = new AssetManager();
    const editor = {
      imageManager: {
        importImage: vi.fn(async () => ({
          image: new FabricImage(document.createElement("img")),
        })),
      },
      canvas: { setActiveObject: vi.fn() },
    } as never;

    await manager.placeImage(editor, file(PNG, "solo.png", "image/png"));

    expect(manager.declarations).toHaveLength(1);
  });
});

describe("assetReferencedBy", () => {
  /** `vg-367`: the same depth `dropDanglingBindings` reads. A re-spelled walk
   *  that stops at the canvas, or at the first group, reports a grouped image as
   *  unused and takes its declaration out from under a live object — so this
   *  pins the answer two groups down, where a shallow spelling diverges. */
  it("finds a reference two groups down", () => {
    const referenced = new FabricImage(document.createElement("img"));
    setObjectAssetReference(referenced, { assetId: "logo", kind: "image" });
    const inner = new Group([referenced]);
    const outer = new Group([inner, new Rect({ width: 4, height: 4 })]);
    const canvas = new Canvas(document.createElement("canvas"));
    canvas.add(outer);

    expect(assetReferencedBy(canvas.getObjects(), "logo")).toBe(true);
    expect(assetReferencedBy(canvas.getObjects(), "absent")).toBe(false);
  });
});
