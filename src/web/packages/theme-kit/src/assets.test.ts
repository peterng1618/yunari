import { describe, expect, it } from "vitest";
import {
  addAsset,
  declareAsset,
  MAX_ASSET_BYTES,
  removeAsset,
  sha256Hex,
} from "./assets.js";
import { createBlankTheme } from "./starter.js";

const BYTES = new TextEncoder().encode("abc");

describe("declaring an asset", () => {
  it("derives an id, path, digest, kind and credit from the bytes", async () => {
    const declared = await declareAsset({
      path: "photos/Sunset Photo.PNG",
      bytes: BYTES,
      license: "Unsplash License",
      sourceUrl: "https://example.test/photo",
      author: "Jane Doe",
    });

    // SHA-256("abc"), a value this test states rather than one the code
    // computed beside it.
    expect(await sha256Hex(BYTES)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(declared.reference).toMatchObject({
      id: "sunset-photo-ba7816bf",
      kind: "image",
      path: "assets/sunset-photo-ba7816bf.png",
      sha256:
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      sourceUrl: "https://example.test/photo",
      license: { name: "Unsplash License" },
    });
    expect(declared.credit).toEqual({
      kind: "image",
      title: "sunset-photo",
      author: { name: "Jane Doe" },
      source: { url: "https://example.test/photo" },
      license: "Unsplash License",
      changes: "Imported unchanged",
      assetId: "sunset-photo-ba7816bf",
    });
    expect(declared.bytes).toBe(BYTES);
  });

  it("is stable for the same bytes and distinct for different bytes", async () => {
    const first = await declareAsset({
      path: "a.png",
      bytes: BYTES,
      license: "MIT",
    });
    const again = await declareAsset({
      path: "a.png",
      bytes: BYTES,
      license: "MIT",
    });
    const other = await declareAsset({
      path: "a.png",
      bytes: new TextEncoder().encode("abd"),
      license: "MIT",
    });

    expect(again.reference.path).toBe(first.reference.path);
    expect(other.reference.path).not.toBe(first.reference.path);
  });

  it("refuses an absolute or escaping path, and an unknown extension", async () => {
    await expect(
      declareAsset({ path: "C:\\photo.png", bytes: BYTES, license: "MIT" }),
    ).rejects.toThrow(/relative/);
    // Drive-relative, without a separator: still not a package-relative path.
    await expect(
      declareAsset({ path: "C:photo.png", bytes: BYTES, license: "MIT" }),
    ).rejects.toThrow(/relative/);
    await expect(
      declareAsset({ path: "/photo.png", bytes: BYTES, license: "MIT" }),
    ).rejects.toThrow(/relative/);
    await expect(
      declareAsset({ path: "a/../photo.png", bytes: BYTES, license: "MIT" }),
    ).rejects.toThrow(/leaves/);
    await expect(
      declareAsset({ path: "notes.txt", bytes: BYTES, license: "MIT" }),
    ).rejects.toThrow(/can declare/);
  });

  it("refuses empty bytes and bytes over the shared cap", async () => {
    await expect(
      declareAsset({ path: "a.png", bytes: new Uint8Array(), license: "MIT" }),
    ).rejects.toThrow(/empty/);
    await expect(
      declareAsset({
        path: "a.png",
        bytes: new Uint8Array(MAX_ASSET_BYTES + 1),
        license: "MIT",
      }),
    ).rejects.toThrow(/cap/);
  });
});

describe("the envelope's asset declarations", () => {
  it("adds a declaration once and removes it by id", async () => {
    const declared = await declareAsset({
      path: "a.png",
      bytes: BYTES,
      license: "MIT",
    });
    const original = createBlankTheme({
      artboard: { width: 800, height: 480 },
    });
    const added = addAsset(original, declared.reference, declared.bytes);
    const again = addAsset(added, declared.reference, declared.bytes);

    expect(original.assets).toEqual([]);
    expect(added.assets).toEqual([declared.reference]);
    expect(again.assets).toEqual([declared.reference]);
    expect(removeAsset(again, declared.reference.id).assets).toEqual([]);
    expect(again.assets).toHaveLength(1);
    expect(() => removeAsset(again, "missing-asset")).toThrow(
      /There is no asset "missing-asset"/,
    );
  });
});
