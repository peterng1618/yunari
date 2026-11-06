// @vitest-environment jsdom

import type { AssetReference, FontAssetReference } from "@yunari/renderer-core";
import { describe, expect, it, vi } from "vitest";
import { AssetManager, mimeOf } from "./index.js";

/** A PNG signature is enough: the manager pairs a file's bytes with its
 *  extension, and no case here decodes the picture. */
const PNG_BYTES = new Uint8Array([137, 80, 78, 71]);
/** The lowercase SHA-256 of `PNG_BYTES`. */
const SHA = "0f4636c78f65d3639ece5a064b5ae753e3408614a14fb18ab4d7540d2c248543";

/**
 * A chosen file, named by the package path the cases compare against.
 *
 * `import` allocates from `File.name`, which is a bare file name — the
 * directory is not part of it. Dropping the directory here makes the imported
 * declaration sit at that same package path, which is the collision under
 * test; keeping it would allocate an `assets/assets-…` path and prove nothing.
 */
function file(path: string, bytes: Uint8Array): File {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return Object.assign(
    new File([bytes as unknown as BlobPart], name, {
      type: mimeOf(name) ?? "application/octet-stream",
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

async function digestOf(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as unknown as BufferSource,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("AssetManager.adoptPackaged", () => {
  it("adopts a colliding asset under a fresh id and path", async () => {
    const manager = new AssetManager();
    await manager.import(file("assets/card.png", PNG_BYTES));
    const adopted = await manager.adoptPackaged(
      [
        {
          id: "card-image",
          kind: "image",
          path: "assets/card.png",
          sha256: SHA,
        },
      ],
      { "assets/card.png": PNG_BYTES },
    );
    expect(adopted.get("card-image")).not.toBe("card-image");
    expect(manager.declarations).toHaveLength(2);
    expect(manager.declarations[1]?.path).not.toBe("assets/card.png");
  });

  it("refuses bytes whose digest does not match", async () => {
    await expect(
      new AssetManager().adoptPackaged(
        [{ id: "x", kind: "image", path: "assets/x.png", sha256: "00" }],
        { "assets/x.png": PNG_BYTES },
      ),
    ).rejects.toThrow("does not match");
  });

  it("keeps the pack's id, path and credit when nothing collides", async () => {
    const manager = new AssetManager();
    const declaration: AssetReference = {
      id: "card-image",
      kind: "image",
      path: "assets/card.png",
      sha256: SHA,
      sourceUrl: "https://example.test/card",
      license: { name: "CC0", url: "https://example.test/cc0" },
    };

    const adopted = await manager.adoptPackaged([declaration], {
      "assets/card.png": PNG_BYTES,
    });

    expect(adopted.get("card-image")).toBe("card-image");
    expect(manager.declarations).toHaveLength(1);
    expect(manager.declarations[0]).toMatchObject(declaration);
    expect(manager.assets["assets/card.png"]).toEqual(PNG_BYTES);
    expect(manager.mutationCount).toBe(1);
  });

  it("keeps a packaged face's font metadata", async () => {
    const manager = new AssetManager();
    const bytes = new Uint8Array([0x77, 0x4f, 0x46, 0x32]);
    const face: FontAssetReference = {
      id: "face",
      kind: "font",
      path: "assets/face.woff2",
      sha256: await digestOf(bytes),
      family: "Inter",
      weight: 400,
      style: "normal",
      format: "woff2",
      subset: "latin",
      sourceUrl: "https://example.test/inter",
      license: { name: "OFL" },
    };

    await manager.adoptPackaged([face], { "assets/face.woff2": bytes });

    expect(manager.declarations[0]).toMatchObject({
      id: "face",
      kind: "font",
      path: "assets/face.woff2",
      family: "Inter",
      weight: 400,
      style: "normal",
      format: "woff2",
      subset: "latin",
      sourceUrl: "https://example.test/inter",
      license: { name: "OFL" },
    });
  });

  it("refuses a missing path before adopting an earlier declaration", async () => {
    const manager = new AssetManager();

    await expect(
      manager.adoptPackaged(
        [
          { id: "a", kind: "image", path: "assets/a.png", sha256: SHA },
          { id: "b", kind: "image", path: "assets/b.png", sha256: SHA },
        ],
        { "assets/a.png": PNG_BYTES },
      ),
    ).rejects.toThrow("no bytes");

    expect(manager.declarations).toEqual([]);
    expect(manager.assets).toEqual({});
    expect(manager.mutationCount).toBe(0);
  });

  it("refuses an extension the editor does not package", async () => {
    const manager = new AssetManager();

    await expect(
      manager.adoptPackaged(
        [{ id: "clip", kind: "gif", path: "assets/clip.gif", sha256: SHA }],
        { "assets/clip.gif": PNG_BYTES },
      ),
    ).rejects.toThrow("Unsupported asset file type");

    expect(manager.declarations).toEqual([]);
    expect(manager.mutationCount).toBe(0);
  });

  it("refuses a declaration whose kind disagrees with its extension", async () => {
    const manager = new AssetManager();

    await expect(
      manager.adoptPackaged(
        [{ id: "clip", kind: "video", path: "assets/clip.png", sha256: SHA }],
        { "assets/clip.png": PNG_BYTES },
      ),
    ).rejects.toThrow("declares kind");

    expect(manager.declarations).toEqual([]);
    expect(manager.mutationCount).toBe(0);
  });
});

describe("AssetManager.rollbackPackaged", () => {
  it("removes the adoption and keeps an asset imported after it", async () => {
    const manager = new AssetManager();
    const adopted = await manager.planPackaged(
      [
        {
          id: "card-image",
          kind: "image",
          path: "assets/card.png",
          sha256: SHA,
        },
      ],
      { "assets/card.png": PNG_BYTES },
    );
    manager.commitPackaged(adopted);
    const late = await manager.import(file("assets/late.png", PNG_BYTES));

    manager.rollbackPackaged(adopted);

    expect(manager.declarations.map((entry) => entry.id)).toEqual([late.id]);
    expect(manager.assets["assets/late.png"]).toEqual(PNG_BYTES);
    expect(manager.assets["assets/card.png"]).toBeUndefined();
  });

  it("keeps a declaration that was already here before the adoption", async () => {
    const manager = new AssetManager();
    const resident = await manager.import(file("assets/card.png", PNG_BYTES));
    const adopted = await manager.planPackaged(
      [
        {
          id: "card-image",
          kind: "image",
          path: "assets/card.png",
          sha256: SHA,
        },
      ],
      { "assets/card.png": PNG_BYTES },
    );
    manager.commitPackaged(adopted);

    manager.rollbackPackaged(adopted);

    expect(manager.declarations.map((entry) => entry.id)).toEqual([
      resident.id,
    ]);
    expect(manager.assets[resident.path]).toEqual(PNG_BYTES);
  });

  it("cancels the adoption's mutation when nothing arrived after it", async () => {
    const manager = new AssetManager();
    const listener = vi.fn();
    manager.subscribe(listener);
    const adopted = await manager.planPackaged(
      [
        {
          id: "card-image",
          kind: "image",
          path: "assets/card.png",
          sha256: SHA,
        },
      ],
      { "assets/card.png": PNG_BYTES },
    );
    manager.commitPackaged(adopted);
    expect(manager.mutationCount).toBe(1);
    listener.mockClear();

    manager.rollbackPackaged(adopted);

    // The commit and its undo cancel for the dirty marker; panes still redraw.
    expect(manager.mutationCount).toBe(0);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("revokes the adopted preview and leaves a later import's URL alone", async () => {
    const create = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation(() => `blob:preview-${create.mock.calls.length}`);
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const manager = new AssetManager();
    const adopted = await manager.planPackaged(
      [
        {
          id: "card-image",
          kind: "image",
          path: "assets/card.png",
          sha256: SHA,
        },
      ],
      { "assets/card.png": PNG_BYTES },
    );
    manager.commitPackaged(adopted);
    const adoptedUrl = manager.previewUrl("card-image");
    const late = await manager.import(file("assets/late.png", PNG_BYTES));
    const lateUrl = manager.previewUrl(late.id);

    manager.rollbackPackaged(adopted);

    expect(adoptedUrl).toBeDefined();
    expect(revoke).toHaveBeenCalledWith(adoptedUrl);
    expect(revoke).not.toHaveBeenCalledWith(lateUrl);
    expect(manager.previewUrl(late.id)).toBe(lateUrl);
  });
});
