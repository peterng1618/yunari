// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setObjectAssetReference } from "@yunari/scene-fabric";
import { Canvas, FabricImage, Group, Rect, type StaticCanvas } from "fabric/es";
import { describe, expect, it, vi } from "vitest";
import { fontTrio } from "../font-catalog.js";
import { AssetManager, assetFileName, assetReferencedBy } from "./index.js";

const PNG = new Uint8Array([137, 80, 78, 71]);
/** Bare signatures for the cases that only need a format match; `FONT_FIXTURE`
 *  is the real container the parsing case reads. */
const WOFF2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32]);
const TTF = new Uint8Array([0x00, 0x01, 0x00, 0x00]);
/** A real Inter WOFF2, so a test parses a container rather than a signature
 *  this file made up. Provenance and licence are in `THIRD-PARTY-NOTICES.md`. */
const FONT_FIXTURE = new Uint8Array(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "fixtures",
      "inter-400-latin.woff2",
    ),
  ),
);

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

  it("writes the import's metadata on the declaration, and a package keeps it", async () => {
    const manager = new AssetManager();
    const sourceUrl =
      "https://steamcommunity.com/sharedfiles/filedetails/?id=202";

    const asset = await manager.import(
      file(new Uint8Array([0, 1, 2]), "night.mp4", "video/mp4"),
      { sourceUrl, license: { name: "unknown" } },
    );

    expect(asset).toMatchObject({
      kind: "video",
      sourceUrl,
      license: { name: "unknown" },
    });

    // The envelope travels as JSON inside the package, so the same JSON trip is
    // what a reopened theme reads back.
    const reopened = new AssetManager();
    reopened.load(
      JSON.parse(JSON.stringify({ assets: manager.declarations })),
      manager.assets,
    );
    expect(reopened.declarations[0]).toMatchObject({
      sourceUrl,
      license: { name: "unknown" },
    });
  });

  it("copies a declared WOFF2 face into package storage", async () => {
    const manager = new AssetManager();

    const asset = await manager.import(
      file(WOFF2, "metric.woff2", "font/woff2"),
    );

    expect(asset).toMatchObject({
      id: "metric",
      kind: "font",
      path: "assets/metric.woff2",
    });
    expect(manager.assets["assets/metric.woff2"]).toEqual(WOFF2);
  });

  it("refuses an extension the theme cannot declare", async () => {
    // Four font formats are declarable — `woff2`, `woff`, `ttf` and `otf` — and
    // the picker's accept list is derived from this same table. Anything outside
    // it is refused at import, before any bytes are kept.
    const manager = new AssetManager();

    await expect(
      manager.import(file(new Uint8Array([0, 1, 2]), "body.html", "text/html")),
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
      subset: face.subset,
    });
    // The subset is a fact about the file the author chose, so it survives the
    // package JSON that carries the declaration into the saved theme.
    const packaged = JSON.parse(JSON.stringify(asset)) as Record<
      string,
      unknown
    >;
    expect(packaged["subset"]).toBe(face.subset);
    expect(manager.assets[`assets/${face.id}.woff2`]).toEqual(
      new Uint8Array([0, 1, 2]),
    );
  });

  it("amends a face's licence name without dropping its URL", async () => {
    const manager = new AssetManager();
    const face = fontTrio("minimal")!.faces[0]!;
    expect(face.license.url).toBeDefined();
    await manager.adoptFont(face, new Uint8Array([0, 1, 2]));

    const amended = manager.amendFont(face.id, {
      family: face.family,
      weight: 500,
      style: "normal",
      licence: "SIL OFL 1.1",
    });

    expect(amended.license).toEqual({
      ...face.license,
      name: "SIL OFL 1.1",
    });
    expect(amended.weight).toBe(500);
  });

  it("imports a ttf and writes a local reference without a sourceUrl", async () => {
    const manager = new AssetManager();

    const asset = await manager.importFont(
      file(TTF, "Inter-Bold.ttf", "font/ttf"),
      { family: "Inter", weight: 700, style: "normal", licence: "unknown" },
      async () => undefined,
    );

    expect(asset).toMatchObject({
      id: "Inter-Bold",
      kind: "font",
      path: "assets/Inter-Bold.ttf",
      family: "Inter",
      weight: 700,
      style: "normal",
      format: "ttf",
      license: { name: "unknown" },
    });
    // A local file names no origin; an absent URL is not an empty one.
    expect(asset.sourceUrl).toBeUndefined();
    // A local import came from no published subset, so the key is absent
    // rather than present and empty.
    expect("subset" in asset).toBe(false);
    expect("subset" in (JSON.parse(JSON.stringify(asset)) as object)).toBe(
      false,
    );
    expect(manager.assets["assets/Inter-Bold.ttf"]).toEqual(TTF);
  });

  it("reads the chosen font file's bytes once", async () => {
    // The parser needs the bytes before `import` can validate the signature.
    // Reading the file again for `import` handed the same file to the browser
    // twice; the bytes read for the parser are the ones that are declared.
    const manager = new AssetManager();
    const chosen = file(TTF, "Inter-Bold.ttf", "font/ttf");
    const read = vi.spyOn(chosen, "arrayBuffer");

    await manager.importFont(
      chosen,
      { family: "Inter", weight: 700, style: "normal", licence: "unknown" },
      async () => undefined,
    );

    expect(read).toHaveBeenCalledTimes(1);
  });

  it("accepts a font whose media type is empty or wrong when its signature matches", async () => {
    // A Windows shell reports no type for a `.woff2`, and some report one the
    // table never uses; the leading bytes, not `File.type`, make it a font.
    const manager = new AssetManager();

    const empty = await manager.importFont(
      file(TTF, "Inter-Bold.ttf", ""),
      { family: "Inter", weight: 700, style: "normal", licence: "unknown" },
      async () => undefined,
    );
    const wrong = await manager.importFont(
      file(WOFF2, "Inter-Regular.woff2", "application/octet-stream"),
      { family: "Inter", weight: 400, style: "normal", licence: "unknown" },
      async () => undefined,
    );

    expect(empty).toMatchObject({
      kind: "font",
      path: "assets/Inter-Bold.ttf",
    });
    expect(wrong).toMatchObject({
      kind: "font",
      path: "assets/Inter-Regular.woff2",
    });
  });

  it("refuses a font whose bytes do not match its extension", async () => {
    // A real mismatch still fails even when the browser names the media type
    // the extension claims: a PNG renamed `.woff2` is not a font.
    const manager = new AssetManager();

    await expect(
      manager.importFont(
        file(PNG, "logo.woff2", "font/woff2"),
        { family: "Logo", weight: 400, style: "normal", licence: "unknown" },
        async () => undefined,
      ),
    ).rejects.toThrow("bytes do not match its extension");

    expect(manager.declarations).toEqual([]);
    expect(manager.assets).toEqual({});
  });

  it("refuses a file whose bytes do not parse as a font", async () => {
    const manager = new AssetManager();
    const loadFace = vi.fn(async () => {
      throw new Error("not a font");
    });

    await expect(
      manager.importFont(
        file(new Uint8Array([0, 1, 2]), "Inter-Bold.ttf", "font/ttf"),
        { family: "Inter", weight: 700, style: "normal", licence: "unknown" },
        loadFace,
      ),
    ).rejects.toThrow("not a font the browser can read");

    expect(loadFace).toHaveBeenCalledTimes(1);
    // The refusal happens before the declaration, so nothing is left behind.
    expect(manager.declarations).toEqual([]);
    expect(manager.assets).toEqual({});
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
    // A video's declared bytes are as showable as a picture's: the pane draws
    // it as a thumbnail and the preview modal plays it.
    expect(manager.previewUrl("clip")).toBe("blob:probe");
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

    await manager.replace("other", file(WOFF2, "other.woff2", "font/woff2"));

    expect(manager.declarations).toHaveLength(before);
    // The catalogue owns family, weight, licence and source; the file owns the
    // bytes and the digest, and replacing the file must not rewrite the former.
    expect(manager.declarations.find((a) => a.id === "other")).toMatchObject({
      family: "Other",
      license: face.license,
    });
    expect(manager.assets["assets/other.woff2"]).toEqual(WOFF2);
  });
});

describe("font fixture", () => {
  it("parses a real WOFF2 container and its table directory", () => {
    const view = new DataView(
      FONT_FIXTURE.buffer,
      FONT_FIXTURE.byteOffset,
      FONT_FIXTURE.byteLength,
    );

    expect(String.fromCharCode(...FONT_FIXTURE.subarray(0, 4))).toBe("wOF2");
    // Flavor 0x00010000 is the sfnt version a TrueType-outline font has, and
    // the length field counts the bytes this test just read.
    expect(view.getUint32(4)).toBe(0x00010000);
    expect(view.getUint32(8)).toBe(FONT_FIXTURE.byteLength);
    expect(view.getUint16(12)).toBeGreaterThan(0);

    expect(woff2TableTags(FONT_FIXTURE)).toEqual(
      expect.arrayContaining([
        "cmap",
        "head",
        "hhea",
        "hmtx",
        "maxp",
        "name",
        "glyf",
        "loca",
      ]),
    );
  });
});

/** WOFF2's known tags, indexed by the low six bits of a directory entry's
 *  flags. Index 63 (`0x3f`) is followed by the four-byte tag instead. */
const WOFF2_TABLE_TAGS = [
  "cmap",
  "head",
  "hhea",
  "hmtx",
  "maxp",
  "name",
  "OS/2",
  "post",
  "cvt ",
  "fpgm",
  "glyf",
  "loca",
  "prep",
  "CFF ",
  "VORG",
  "EBDT",
  "EBLC",
  "gasp",
  "hdmx",
  "kern",
  "LTSH",
  "PCLT",
  "VDMX",
  "vhea",
  "vmtx",
  "BASE",
  "GDEF",
  "GPOS",
  "GSUB",
  "EBSC",
  "JSTF",
  "MATH",
  "CBDT",
  "CBLC",
  "COLR",
  "CPAL",
  "SVG ",
  "sbix",
  "acnt",
  "avar",
  "bdat",
  "bloc",
  "bsln",
  "cvar",
  "fdsc",
  "feat",
  "fmtx",
  "fvar",
  "gvar",
  "hsty",
  "just",
  "lcar",
  "mort",
  "morx",
  "opbd",
  "prop",
  "trak",
  "Zapf",
  "Silf",
  "Glat",
  "Gloc",
  "Feat",
  "Sill",
] as const;

/** Reads a WOFF2 UIntBase128, the directory's variable-length number. */
function readBase128(
  bytes: Uint8Array,
  start: number,
): { readonly value: number; readonly next: number } {
  let offset = start;
  let value = 0;
  for (let count = 0; count < 5; count += 1) {
    const byte = bytes[offset];
    if (byte === undefined) throw new Error("Truncated WOFF2 table directory.");
    offset += 1;
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return { value, next: offset };
  }
  throw new Error("A WOFF2 UIntBase128 is at most five bytes.");
}

/** Walks the table directory that follows the 48-byte WOFF2 header. */
function woff2TableTags(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(12);
  const tags: string[] = [];
  let offset = 48;
  for (let index = 0; index < count; index += 1) {
    const flags = bytes[offset];
    if (flags === undefined)
      throw new Error("Truncated WOFF2 table directory.");
    offset += 1;
    const tagIndex = flags & 0x3f;
    let tag: string;
    if (tagIndex === 0x3f) {
      tag = String.fromCharCode(...bytes.subarray(offset, offset + 4));
      offset += 4;
    } else {
      const known = WOFF2_TABLE_TAGS[tagIndex];
      if (known === undefined)
        throw new Error(`Unknown WOFF2 table tag index ${tagIndex}.`);
      tag = known;
    }
    offset = readBase128(bytes, offset).next;
    const transformVersion = (flags >> 6) & 0x3;
    // `glyf` and `loca` are transformed by default; every other table is not.
    const transformed =
      tag === "glyf" || tag === "loca"
        ? transformVersion === 0
        : transformVersion !== 0;
    if (transformed) offset = readBase128(bytes, offset).next;
    tags.push(tag);
  }
  return tags;
}

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
      canvas: { setActiveObject: vi.fn(), centerObject: vi.fn() },
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
      canvas: { setActiveObject: vi.fn(), centerObject: vi.fn() },
    } as never;

    await manager.placeImage(editor, file(PNG, "solo.png", "image/png"));

    expect(manager.declarations).toHaveLength(1);
  });

  it("places an imported image at the canvas centre", async () => {
    // R3: an import's one automatic placement is the canvas centre. Fabric owns
    // the operation, so the proof is that the declared object is handed to it
    // after it becomes active — reverting the call leaves the image at its
    // default origin and reds this case.
    const manager = new AssetManager();
    const image = new FabricImage(document.createElement("img"));
    const centerObject = vi.fn();
    const editor = {
      imageManager: {
        importImage: vi.fn(async () => ({ image })),
      },
      canvas: { setActiveObject: vi.fn(), centerObject },
    } as never;

    await manager.placeImage(editor, file(PNG, "centred.png", "image/png"));

    expect(centerObject).toHaveBeenCalledWith(image);
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

describe("assetFileName", () => {
  /** A provider cut's packaged id is a byte address with the source's name in
   *  it (`google-fonts-cut-bebas-neue-…`), so the card, the cleanup sheet and
   *  the background list read the family and weight instead. */
  it("names a face by its family and weight, and a file by its own name", () => {
    expect(
      assetFileName({
        id: "google-fonts-cut-bebas-neue-40bc1f2e",
        kind: "font",
        path: "assets/google-fonts-cut-bebas-neue-40bc1f2e.woff2",
        family: "Bebas Neue",
        weight: 400,
        style: "normal",
        format: "woff2",
      }),
    ).toBe("Bebas Neue 400");
    expect(
      assetFileName({ id: "logo", kind: "image", path: "assets/logo.png" }),
    ).toBe("logo.png");
  });
});
