import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FabricThemeEnvelope } from "@yunari/renderer-core";
import { readThemePackage, writeThemePackage } from "@yunari/theme-package";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createThemeStore } from "./store.js";
import { createThumbnailStore, pngDimensions } from "./thumbnails.js";

/** A real 1×1 PNG: the header's declared size is what the store bounds. */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44,
  0x41, 0x54, 0x78, 0xda, 0x63, 0xfc, 0xcf, 0xc0, 0x50, 0x0f, 0x00, 0x04, 0x85,
  0x01, 0x80, 0x84, 0xa9, 0x8c, 0x21, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);

/** The 1×1 PNG with its header rewritten to declare another size. The store
 *  bounds what a file claims, so the image data past the header is irrelevant
 *  to these tests. */
function pngDeclaring(width: number, height: number): Uint8Array {
  const bytes = Uint8Array.from(PNG);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

const envelopeFor = (id: string): FabricThemeEnvelope => ({
  schemaVersion: "2.0.0",
  fabricVersion: "7.4.0",
  id,
  metadata: { name: "Living Room", themeLanguage: "en" },
  artboard: { width: 1920, height: 1080 },
  scene: { version: "7.4.0", objects: [] },
});

describe("thumbnails", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "yunari-thumbs-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("has nothing for a theme that was never captured", async () => {
    expect(await createThumbnailStore(dir).read("living-room")).toBeUndefined();
  });

  it("round-trips a picture", async () => {
    const store = createThumbnailStore(dir);
    await store.write("living-room", PNG);

    expect(await store.read("living-room")).toEqual(PNG);
  });

  it("puts the picture inside the theme's own folder, and nowhere else", async () => {
    const store = createThumbnailStore(dir);
    await store.write("living-room", PNG);

    expect(await readdir(path.join(dir, "living-room"))).toEqual([
      "thumbnail.png",
    ]);
    // The old shape was a shared `thumbnails/` directory beside the library;
    // a theme folder that is only ever its theme is the whole point of the move.
    expect(await readdir(dir)).toEqual(["living-room"]);
  });

  it("leaves no staging file behind", async () => {
    const store = createThumbnailStore(dir);
    await store.write("living-room", PNG);
    await store.write("living-room", PNG);

    expect(await readdir(path.join(dir, "living-room"))).toEqual([
      "thumbnail.png",
    ]);
  });

  it("lists a theme folder holding a picture as one theme, not two", async () => {
    const themes = createThemeStore(dir);
    await themes.write("living-room", {
      envelope: envelopeFor("living-room"),
      assets: {},
    });
    // Written straight into the folder, so this is the `list()` filter being
    // asked the question rather than a store that happens to place it there.
    await writeFile(path.join(dir, "living-room", "thumbnail.png"), PNG);

    // The picture is the only thing in the library that is a file rather than a
    // folder, so `list()`'s directory filter is all that stands between it and
    // a phantom theme.
    expect((await themes.list()).map((entry) => entry.id)).toEqual([
      "living-room",
    ]);
  });

  it("takes the picture with the theme when the folder goes", async () => {
    const themes = createThemeStore(dir);
    await themes.write("living-room", {
      envelope: envelopeFor("living-room"),
      assets: {},
    });
    const store = createThumbnailStore(dir);
    await store.write("living-room", PNG);

    // A theme is removed by removing its folder, so this is the whole removal.
    await rm(path.join(dir, "living-room"), { recursive: true });

    expect(await store.read("living-room")).toBeUndefined();
  });

  it("refuses bytes that are not a PNG", async () => {
    const store = createThumbnailStore(dir);

    await expect(
      store.write("living-room", new TextEncoder().encode("not an image")),
    ).rejects.toThrow("PNG");
  });

  it("refuses an oversized picture", async () => {
    const store = createThumbnailStore(dir);
    const huge = new Uint8Array(3 * 1024 * 1024);
    huge.set(PNG);

    await expect(store.write("living-room", huge)).rejects.toThrow("too large");
  });

  it("reads the size a PNG header declares", () => {
    expect(pngDimensions(PNG)).toEqual({ width: 1, height: 1 });
  });

  it("refuses a picture whose header declares an impossible size", async () => {
    const store = createThumbnailStore(dir);

    await expect(
      store.write("living-room", pngDeclaring(100000, 100000)),
    ).rejects.toThrow("may be at most");
  });

  it("will not serve a stored picture whose header declares an impossible size", async () => {
    await mkdir(path.join(dir, "living-room"), { recursive: true });
    await writeFile(
      path.join(dir, "living-room", "thumbnail.png"),
      pngDeclaring(100000, 100000),
    );

    expect(await createThumbnailStore(dir).read("living-room")).toBeUndefined();
  });

  it("will not serve a stored picture over the write bound", async () => {
    await mkdir(path.join(dir, "living-room"), { recursive: true });
    // A valid PNG at the head, so only the size bound can refuse it.
    const huge = new Uint8Array(3 * 1024 * 1024);
    huge.set(PNG);
    await writeFile(path.join(dir, "living-room", "thumbnail.png"), huge);

    expect(await createThumbnailStore(dir).read("living-room")).toBeUndefined();
  });

  it("refuses an id that could name something outside the library", async () => {
    const store = createThumbnailStore(dir);

    await expect(store.write("../escape", PNG)).rejects.toThrow(
      "Invalid theme id",
    );
    expect(await readdir(dir)).toEqual([]);
  });

  it("keeps the theme when the capture is refused", async () => {
    // A capture that fails must not cost the theme: the picture is the only
    // thing that is missing, and the previous one is left readable.
    const themes = createThemeStore(dir);
    await themes.write("living-room", {
      envelope: envelopeFor("living-room"),
      assets: {},
    });
    const store = createThumbnailStore(dir);
    await store.write("living-room", PNG);

    await expect(
      store.write("living-room", new TextEncoder().encode("not an image")),
    ).rejects.toThrow("PNG");

    expect((await themes.read("living-room"))?.envelope.id).toBe("living-room");
    expect(await store.read("living-room")).toEqual(PNG);
  });

  it("ignores a file someone else wrote in its place", async () => {
    const store = createThumbnailStore(dir);
    await store.write("living-room", PNG);

    // A corrupt file must read as absent rather than reaching a browser.
    await writeFile(
      path.join(dir, "living-room", "thumbnail.png"),
      "junk",
      "utf8",
    );

    expect(await store.read("living-room")).toBeUndefined();
  });

  it("removes a picture without touching the theme", async () => {
    const themes = createThemeStore(dir);
    await themes.write("living-room", {
      envelope: envelopeFor("living-room"),
      assets: {},
    });
    const store = createThumbnailStore(dir);
    await store.write("living-room", PNG);

    await store.remove("living-room");

    expect(await store.read("living-room")).toBeUndefined();
    expect((await themes.read("living-room"))?.envelope.id).toBe("living-room");
  });

  it("keeps the picture out of the exported package", async () => {
    // A thumbnail is a rendering of one machine's fonts and GPU, so it is not
    // portable and does not belong in the share artifact (§139). It now sits in
    // the same folder as `theme.json`, so the export has to be proved to read
    // the declaration rather than the directory.
    const themes = createThemeStore(dir);
    await themes.write("living-room", {
      envelope: envelopeFor("living-room"),
      assets: {},
    });
    await createThumbnailStore(dir).write("living-room", PNG);

    const record = await themes.read("living-room");
    const written = writeThemePackage({
      envelope: record?.envelope ?? envelopeFor("living-room"),
      assets: record?.assets ?? {},
    });
    expect(written.ok).toBe(true);

    // Read back through the package's own reader, which admits exactly
    // `manifest.json`, `theme.json` and declared `assets/*` and rejects
    // anything else, so a thumbnail in the archive would fail here.
    const opened = readThemePackage(
      written.ok ? written.bytes : new Uint8Array(),
    );
    expect(opened.ok).toBe(true);
    expect(opened.ok ? Object.keys(opened.assets) : []).toEqual([]);
  });
});
