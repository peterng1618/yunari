/**
 * The host's half of an import: which id a package lands under, and that
 * landing never replaces what is already there. The reader is
 * `@yunari/theme-package`'s and is exercised in its own suite, so the fixtures
 * here are packages written by the format's own writer.
 */
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FabricThemeEnvelope } from "@yunari/renderer-core";
import { writeThemePackage } from "@yunari/theme-package";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importIdCandidates, importThemePackage } from "./import.js";
import { createThemeStore, type ThemeStore } from "./store.js";
import { createThumbnailStore } from "./thumbnails.js";

function envelopeFor(id: string, name: string): FabricThemeEnvelope {
  return {
    schemaVersion: "2.0.0",
    fabricVersion: "7.4.0",
    id,
    artboard: { width: 1920, height: 1080 },
    metadata: { name, themeLanguage: "en" },
    globals: {
      typeTokens: {
        heading: { family: "system-ui, sans-serif", weight: "600" },
        body: { family: "system-ui, sans-serif", weight: "400" },
        mono: { family: "monospace", weight: "400" },
      },
    },
    scene: { version: "7.4.0", objects: [] },
  };
}

/** A real 1×1 PNG, as the reader and the thumbnail store both require. */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44,
  0x41, 0x54, 0x78, 0xda, 0x63, 0xfc, 0xcf, 0xc0, 0x50, 0x0f, 0x00, 0x04, 0x85,
  0x01, 0x80, 0x84, 0xa9, 0x8c, 0x21, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);

function packageBytes(input: {
  readonly envelope: FabricThemeEnvelope;
  readonly assets?: Readonly<Record<string, Uint8Array>>;
  readonly thumbnail?: Uint8Array;
}): Uint8Array {
  const written = writeThemePackage({
    envelope: input.envelope,
    assets: input.assets ?? {},
    ...(input.thumbnail === undefined ? {} : { thumbnail: input.thumbnail }),
  });
  if (!written.ok) throw new Error(written.message);
  return written.bytes;
}

/** Committed media, read rather than regenerated — the envelope module's own
 *  fixtures, so a case here tests the same bytes its declarations describe. */
const fixture = (name: string): Uint8Array =>
  new Uint8Array(
    readFileSync(
      fileURLToPath(
        new URL(
          `../../../theme-package/test-fixtures/${name}`,
          import.meta.url,
        ),
      ),
    ),
  );

/** An envelope declaring one video at the path the cases below store. */
function videoEnvelope(id: string, name: string): FabricThemeEnvelope {
  return {
    ...envelopeFor(id, name),
    assets: [{ id: "clip", kind: "video", path: "assets/clip.mp4" }],
  };
}

/**
 * Every file under a theme's folder, base64 by relative path. The no-overwrite
 * rule is about *bytes*, so the proof has to be bytes rather than a listing or
 * a parsed document — a replace that happened to keep the shape would pass
 * either of those.
 */
async function folderBytes(
  library: string,
  id: string,
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const next = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(next, `${prefix}${entry.name}/`);
      } else {
        files[`${prefix}${entry.name}`] = (await fs.readFile(next)).toString(
          "base64",
        );
      }
    }
  };
  await walk(path.join(library, id), "");
  return files;
}

describe("importThemePackage", () => {
  let library: string;
  let store: ThemeStore;

  beforeEach(async () => {
    library = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-import-test-"));
    store = createThemeStore(library);
  });

  afterEach(async () => {
    await fs.rm(library, { recursive: true, force: true });
  });

  it("lands a package under its own id when the library does not hold it", async () => {
    const imported = await importThemePackage(
      packageBytes({ envelope: envelopeFor("family-room", "Living Room") }),
      { store },
    );

    expect(imported).toEqual({ ok: true, id: "family-room" });
    const stored = await store.read("family-room");
    expect(stored?.envelope.id).toBe("family-room");
    expect(stored?.envelope.metadata?.name).toBe("Living Room");
  });

  it("lands a taken id under a suffixed one, and leaves the theme already there byte-for-byte unchanged", async () => {
    await store.write("family-room", {
      envelope: envelopeFor("family-room", "Living Room, edited here"),
      assets: {},
    });
    const before = await folderBytes(library, "family-room");

    const imported = await importThemePackage(
      packageBytes({ envelope: envelopeFor("family-room", "Living Room") }),
      { store },
    );

    // The name is what the second entry is derived from, and the suffix is what
    // makes the collision visible rather than silent.
    expect(imported).toEqual({ ok: true, id: "living-room" });
    // The theme the author already had is untouched — the same bytes, not
    // merely a document that still parses.
    expect(await folderBytes(library, "family-room")).toEqual(before);
    expect((await store.read("family-room"))?.envelope.metadata?.name).toBe(
      "Living Room, edited here",
    );
    // And the import is a second entry, not a replacement.
    expect((await store.read("living-room"))?.envelope.id).toBe("living-room");
    expect(await store.list()).toHaveLength(2);
  });

  it("takes the next suffix when the name-derived id is taken too", async () => {
    await store.write("family-room", {
      envelope: envelopeFor("family-room", "Living Room, edited here"),
      assets: {},
    });
    await store.write("living-room", {
      envelope: envelopeFor("living-room", "Living Room, again"),
      assets: {},
    });

    const imported = await importThemePackage(
      packageBytes({ envelope: envelopeFor("family-room", "Living Room") }),
      { store },
    );

    expect(imported).toEqual({ ok: true, id: "living-room-2" });
  });

  it("mints a base for a name that holds nothing the id shape can use", async () => {
    await store.write("family-room", {
      envelope: envelopeFor("family-room", "Living Room"),
      assets: {},
    });

    const imported = await importThemePackage(
      packageBytes({ envelope: envelopeFor("family-room", "日本語") }),
      { store },
    );

    // A name the id shape has no letters for still has to land somewhere, and
    // the library id space is the host's to mint in.
    expect(imported).toEqual({ ok: true, id: "theme" });
  });

  it("writes the package's picture under the id it landed under", async () => {
    const thumbnails = createThumbnailStore(library);

    const imported = await importThemePackage(
      packageBytes({
        envelope: envelopeFor("family-room", "Living Room"),
        thumbnail: PNG,
      }),
      { store, thumbnails },
    );

    expect(imported).toEqual({ ok: true, id: "family-room" });
    const written = await fs.readFile(
      path.join(library, "family-room", "thumbnail.png"),
    );
    expect([...written]).toEqual([...PNG]);
  });

  it("drops a picture the store would refuse rather than refusing the theme", async () => {
    const thumbnails = createThumbnailStore(library);

    const imported = await importThemePackage(
      packageBytes({
        envelope: envelopeFor("family-room", "Living Room"),
        // Not a PNG: the reader drops it, and the library falls back to text.
        thumbnail: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]),
      }),
      { store, thumbnails },
    );

    expect(imported).toEqual({ ok: true, id: "family-room" });
    await expect(
      fs.stat(path.join(library, "family-room", "thumbnail.png")),
    ).rejects.toThrow();
  });

  it("refuses a package the reader will not read, with the reader's own reason, and writes nothing", async () => {
    const imported = await importThemePackage(new Uint8Array([1, 2, 3]), {
      store,
    });

    expect(imported.ok).toBe(false);
    if (!imported.ok) {
      // §141's refusal reaching the author, not a sentence composed here.
      expect(imported.message).toBe(
        "That file is not a readable theme package.",
      );
    }
    expect(await fs.readdir(library)).toEqual([]);
  });

  it("refuses an occupied id even when the folder holds no readable theme", async () => {
    // A folder the listing skips is still the author's work: replacing it would
    // be the same silent loss as replacing a listed theme.
    await fs.mkdir(path.join(library, "family-room"), { recursive: true });
    await fs.writeFile(
      path.join(library, "family-room", "theme.json"),
      JSON.stringify({ id: "family-room" }),
    );

    const imported = await importThemePackage(
      packageBytes({ envelope: envelopeFor("family-room", "Living Room") }),
      { store },
    );

    expect(imported).toEqual({ ok: true, id: "living-room" });
    expect(
      await fs.readFile(
        path.join(library, "family-room", "theme.json"),
        "utf8",
      ),
    ).toBe(JSON.stringify({ id: "family-room" }));
  });

  it("refuses a video with an audio track, and writes nothing", async () => {
    const imported = await importThemePackage(
      packageBytes({
        envelope: videoEnvelope("family-room", "Living Room"),
        assets: { "assets/clip.mp4": fixture("audio.mp4") },
      }),
      { store },
    );

    // The envelope module's sentence, the same one installTheme shows.
    expect(imported).toEqual({
      ok: false,
      message: "assets/clip.mp4: audio track present; video must be silent",
    });
    await expect(fs.stat(path.join(library, "family-room"))).rejects.toThrow();
  });

  it("refuses an over-long video, and writes nothing", async () => {
    const imported = await importThemePackage(
      packageBytes({
        envelope: videoEnvelope("family-room", "Living Room"),
        assets: { "assets/clip.mp4": fixture("too-long.mp4") },
      }),
      { store },
    );

    expect(imported).toEqual({
      ok: false,
      message:
        "assets/clip.mp4: duration 61500 ms exceeds the 60000 ms maximum",
    });
    await expect(fs.stat(path.join(library, "family-room"))).rejects.toThrow();
  });

  it("imports a conforming video and stores its bytes", async () => {
    const video = fixture("conforming.mp4");

    const imported = await importThemePackage(
      packageBytes({
        envelope: videoEnvelope("family-room", "Living Room"),
        assets: { "assets/clip.mp4": video },
      }),
      { store },
    );

    expect(imported).toEqual({ ok: true, id: "family-room" });
    expect(
      await fs.readFile(path.join(library, "family-room", "assets/clip.mp4")),
    ).toEqual(Buffer.from(video));
  });
});

/**
 * The id rule's own seam. The reader will not hand over a document whose id is
 * out of shape — the envelope validator refuses it — so that arm is reachable
 * here and not through a package, and it is kept because the id rule is the
 * host's rather than another package's validator's.
 */
describe("importIdCandidates", () => {
  it("takes the package's own id first when the library's shape admits it", () => {
    expect(
      importIdCandidates(envelopeFor("family-room", "Living Room"))[0],
    ).toBe("family-room");
  });

  it("falls to the name when the package's own id is not one the library can hold", () => {
    expect(
      importIdCandidates(envelopeFor("Family Room", "Living Room")).slice(0, 3),
    ).toEqual(["living-room", "living-room-2", "living-room-3"]);
  });

  it("tries each id once, even when the name slugs to the package's own id", () => {
    const candidates = importIdCandidates(
      envelopeFor("living-room", "Living Room"),
    );

    expect(candidates.filter((id) => id === "living-room")).toHaveLength(1);
    expect(candidates[1]).toBe("living-room-2");
  });

  it("mints a base when the name holds nothing the id shape can use", () => {
    expect(importIdCandidates(envelopeFor("Family Room", "日本語"))[0]).toBe(
      "theme",
    );
  });
});
