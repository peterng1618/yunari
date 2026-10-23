import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FabricThemeEnvelope } from "@yunari/renderer-core";
import { writeThemePackage } from "@yunari/theme-package";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// The editor package cannot type-check `node:fs`, so this is the one suite where
// the store's listing and the mount's pick are in the same program — and the
// bare mount's answer is a composition of the two (`vg-363`).
import { bootTheme } from "../../../editor/src/boot-theme.js";
import {
  createThemeStore,
  isValidThemeId,
  ThemeAssetLimitError,
  ThemeConflictError,
  type ThemeContent,
  ThemeIdTakenError,
  type ThemeStore,
  ThemeTooLargeError,
  ThemeValidationError,
} from "./store.js";

function envelopeFor(id: string, name: string): FabricThemeEnvelope {
  return {
    schemaVersion: 2,
    fabricVersion: "7.4.0",
    id,
    artboard: { width: 1920, height: 1080 },
    metadata: { name, author: "Ada", themeLanguage: "en" },
    scene: { version: "7.4.0", objects: [] },
  };
}

function withAsset(
  id: string,
  name: string,
  assetPath: string,
  bytes: Uint8Array,
): ThemeContent {
  return {
    envelope: {
      ...envelopeFor(id, name),
      assets: [
        {
          id: "badge",
          kind: "image",
          path: assetPath,
        },
      ],
    },
    assets: { [assetPath]: bytes },
  };
}

/**
 * A save that dies, at the point named — the one thing a test cannot get by
 * writing folders by hand, because the state that matters is the one the store
 * itself leaves there.
 *
 * `write` stages the whole folder and swaps it in with two renames. The spy
 * performs the operation that names the crash point for real and then hands
 * back a promise that never settles, so the save stops there exactly as a
 * killed process stops: what it had already written is on disk, the rest of the
 * save never runs, and no `catch` cleans up after it. `crashed` resolves once
 * that point is really on disk, so the caller observes the crash rather than
 * assuming it, and the write is deliberately never awaited.
 */
async function crashSave(
  store: ThemeStore,
  id: string,
  content: ThemeContent,
  at: "mid-write" | "between-renames",
): Promise<void> {
  const crashed = new Promise<void>((resolve) => {
    const realRename = fs.rename;
    const realWriteFile = fs.writeFile;
    const never = (): Promise<never> => new Promise<never>(() => undefined);

    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (at !== "between-renames" || !String(to).includes(".retired-")) {
        await realRename(from, to);
        return;
      }
      // The theme is really moved aside first; only the second rename, which
      // would bring the new folder in, is what never arrives.
      await realRename(from, to);
      resolve();
      return never();
    });

    vi.spyOn(fs, "writeFile").mockImplementation(async (file, data) => {
      // `theme.json` is written once into the staging folder, so stopping on
      // it stops the save before it has written anything worth committing.
      if (
        at !== "mid-write" ||
        !String(file).includes(`${path.sep}.staging-`)
      ) {
        await realWriteFile(file, data);
        return;
      }
      resolve();
      return never();
    });
  });

  void store.write(id, content);
  await crashed;
}

/** Scratch folder names for one theme, read back off disk rather than guessed. */
async function scratchNames(library: string, id: string, kind: string) {
  return (await fs.readdir(library)).filter(
    (name) => name.startsWith(`.${kind}-`) && name.endsWith(`.${id}`),
  );
}

describe("ThemeStore", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "yunari-theme-store-test-"),
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes and reads a valid theme as a folder", async () => {
    const store = createThemeStore(tmpDir);

    const entry = await store.write("living-room", {
      envelope: envelopeFor("living-room", "Living Room"),
      assets: {},
    });
    expect(entry.id).toBe("living-room");
    expect(entry.name).toBe("Living Room");
    expect(entry.author).toBe("Ada");
    expect(typeof entry.updatedAt).toBe("string");

    const read = await store.read("living-room");
    expect(read?.envelope.id).toBe("living-room");
    expect(read?.envelope.metadata?.name).toBe("Living Room");
    expect(read?.assets).toEqual({});
  });

  it("round-trips a theme's assets through the folder", async () => {
    const store = createThemeStore(tmpDir);
    const content = withAsset(
      "living-room",
      "Living Room",
      "assets/badge.svg",
      new TextEncoder().encode("<svg/>"),
    );

    await store.write("living-room", content);

    // The shape on disk is the claim, so it is read from the filesystem rather
    // than inferred from what the store returned.
    expect((await fs.readdir(path.join(tmpDir, "living-room"))).sort()).toEqual(
      ["assets", "theme.json"],
    );
    expect(
      await fs.readFile(
        path.join(tmpDir, "living-room", "assets", "badge.svg"),
        "utf8",
      ),
    ).toBe("<svg/>");

    const read = await store.read("living-room");
    const stored = read?.assets["assets/badge.svg"];
    expect(stored).toBeDefined();
    expect([...(stored ?? [])]).toEqual([
      ...content.assets["assets/badge.svg"]!,
    ]);
  });

  /**
   * The regression that motivated ADR-0017: `list()` used to inflate every
   * package in the library to print one line each. It now reads only
   * `theme.json`, so an asset it cannot read costs the theme nothing in the
   * list — under the archive this theme would simply have vanished from it.
   */
  it("lists name, author and modified time without reading the assets", async () => {
    const store = createThemeStore(tmpDir);
    await store.write("theme-a", {
      envelope: envelopeFor("theme-a", "Theme Alpha"),
      assets: {},
    });
    await store.write("theme-b", {
      envelope: envelopeFor("theme-b", "Theme Beta"),
      assets: {},
    });
    await store.write(
      "theme-c",
      withAsset(
        "theme-c",
        "Theme Gamma",
        "assets/badge.svg",
        new Uint8Array([1]),
      ),
    );
    // A directory where the asset file belongs: unreadable, but the document
    // beside it is intact.
    await fs.rm(path.join(tmpDir, "theme-c", "assets", "badge.svg"));
    await fs.mkdir(path.join(tmpDir, "theme-c", "assets", "badge.svg"));

    const list = await store.list();
    expect(
      list.map((item) => ({
        id: item.id,
        name: item.name,
        author: item.author,
      })),
    ).toEqual([
      { id: "theme-a", name: "Theme Alpha", author: "Ada" },
      { id: "theme-b", name: "Theme Beta", author: "Ada" },
      { id: "theme-c", name: "Theme Gamma", author: "Ada" },
    ]);
    for (const item of list) {
      expect(typeof item.updatedAt).toBe("string");
    }

    // Reading it properly still refuses, so the list is not hiding a fault.
    expect(await store.read("theme-c")).toBeUndefined();
  });

  /**
   * The version travels with the entry the store already built (R128): the
   * store's caption line prints `1.4.0 · 2026-10-14`, and a listing that opened
   * each theme to find its version would be the second pass over the library
   * R114 refuses.
   *
   * **A document that declares none has no key at all** rather than an empty
   * string: the caption draws the separator only between two readings that
   * exist, so an absence must be distinguishable from a version spelled "".
   */
  it("carries the document's version on the entry, and its absence as an absence", async () => {
    const store = createThemeStore(tmpDir);
    await store.write("versioned", {
      envelope: {
        ...envelopeFor("versioned", "Versioned"),
        metadata: {
          name: "Versioned",
          themeLanguage: "en",
          version: "1.4.0",
        },
      },
      assets: {},
    });
    await store.write("bare", {
      envelope: {
        ...envelopeFor("bare", "Bare"),
        metadata: { name: "Bare", themeLanguage: "en" },
      },
      assets: {},
    });

    const listed = new Map(
      (await store.list()).map((item) => [item.id, item.version]),
    );

    expect(listed.get("versioned")).toBe("1.4.0");
    expect(listed.get("bare")).toBeUndefined();
  });

  /**
   * The credit travels with the entry the store already built, for the same
   * reason the version does: the library prints it from the listing, and a
   * document that declares no credit has no key at all rather than one holding
   * `undefined`.
   */
  it("carries a remix credit on the entry, and no key when there is none", async () => {
    const store = createThemeStore(tmpDir);
    const remix = {
      catalogueId: "8f14e45f-ceea-4670-9c1e-0f4b4b9d0a11",
      name: "System dashboard",
      version: "1.2.0",
    };
    await store.write("remixed", {
      envelope: {
        ...envelopeFor("remixed", "Remixed"),
        metadata: {
          name: "Remixed",
          author: "Ada",
          themeLanguage: "en",
          remixOf: remix,
        },
      },
      assets: {},
    });
    await store.write("plain", {
      envelope: envelopeFor("plain", "Plain"),
      assets: {},
    });

    const byId = new Map(
      (await store.list()).map((entry) => [entry.id, entry]),
    );

    expect(byId.get("remixed")?.remixOf).toEqual(remix);
    expect(Object.hasOwn(byId.get("plain") ?? {}, "remixOf")).toBe(false);
  });

  it("carries each theme's costs on the entry it already built", async () => {
    const store = createThemeStore(tmpDir);
    // A video background, which is the one cost a listing can answer from the
    // document alone — no asset is ever opened for it.
    const video: FabricThemeEnvelope = {
      ...envelopeFor("night-sky", "Night Sky"),
      artboard: {
        width: 1920,
        height: 1080,
      },
      background: {
        media: { assetId: "loop", bounds: "theme" },
      },
      assets: [
        {
          id: "loop",
          kind: "video",
          path: "assets/loop.webm",
          license: { name: "CC0", attribution: "Yunari test fixture." },
        },
      ],
    };
    await store.write("night-sky", {
      envelope: video,
      assets: { "assets/loop.webm": new Uint8Array([1, 2, 3]) },
    });
    await store.write("plain", {
      envelope: envelopeFor("plain", "Plain"),
      assets: {},
    });

    const list = await store.list();
    const byId = new Map(list.map((entry) => [entry.id, entry]));

    // Both asserted, so the case cannot pass by the field being absent on both.
    expect(byId.get("night-sky")?.costs).toEqual(["video-background"]);
    expect(byId.get("plain")?.costs).toEqual([]);
  });

  it("carries each theme's facets on the entry it already built", async () => {
    const store = createThemeStore(tmpDir);
    // A portrait board on a dark ground, which is the whole point: the record
    // is read off this theme's own document, not off the one beside it.
    await store.write("night-sky", {
      envelope: {
        ...envelopeFor("night-sky", "Night Sky"),
        artboard: {
          width: 1080,
          height: 1920,
        },
        background: { color: { ref: "palette.night" } },
        globals: {
          palette: {
            // The immutable fallback every palette must carry.
            none: {
              name: "None",
              value: { kind: "solid", color: "transparent" },
            },
            night: {
              name: "Night",
              value: { kind: "solid", color: "#101014" },
            },
          },
        },
      },
      assets: {},
    });
    await store.write("plain", {
      envelope: envelopeFor("plain", "Plain"),
      assets: {},
    });

    const list = await store.list();
    const byId = new Map(list.map((entry) => [entry.id, entry]));

    expect(byId.get("night-sky")?.facets).toEqual({
      author: "Ada",
      colourMode: "dark",
      sensors: [],
      tags: [],
      orientation: "portrait",
      // The published bucket for both orientations, which is what a 9:16
      // artboard reads as.
      aspect: "16:9",
      width: 1080,
      height: 1920,
    });
    // A board with no ground at all is one the record will not classify, and a
    // landscape 1920×1080 is exactly 16:9.
    expect(byId.get("plain")?.facets).toEqual({
      author: "Ada",
      colourMode: "unclassified",
      sensors: [],
      tags: [],
      orientation: "landscape",
      aspect: "16:9",
      width: 1920,
      height: 1080,
    });
    // The line's own fields are untouched by the new one.
    expect(byId.get("night-sky")).toMatchObject({
      id: "night-sky",
      name: "Night Sky",
      author: "Ada",
    });
    expect(typeof byId.get("night-sky")?.updatedAt).toBe("string");
  });

  it("carries each theme's ground on the entry it already built", async () => {
    const store = createThemeStore(tmpDir);
    // The palette's own colour, resolved through the document's own resolver and
    // converted at the CSS boundary — a gallery cell draws this string.
    await store.write("night-sky", {
      envelope: {
        ...envelopeFor("night-sky", "Night Sky"),
        artboard: {
          width: 1920,
          height: 1080,
        },
        background: { color: { ref: "palette.night" } },
        globals: {
          palette: {
            none: {
              name: "None",
              value: { kind: "solid", color: "transparent" },
            },
            night: {
              name: "Night",
              value: { kind: "solid", color: "#101014" },
            },
          },
        },
      },
      assets: {},
    });
    // Media behind the board, **with a paint of its own**: the picture is the
    // ground and the token is not what a viewer sees, so the entry carries no
    // ground even though the reference resolves.
    await store.write("film", {
      envelope: {
        ...envelopeFor("film", "Film"),
        artboard: {
          width: 1920,
          height: 1080,
        },
        background: {
          color: { ref: "palette.night" },
          media: { assetId: "loop", bounds: "theme" },
        },
        globals: {
          palette: {
            none: {
              name: "None",
              value: { kind: "solid", color: "transparent" },
            },
            night: {
              name: "Night",
              value: { kind: "solid", color: "#101014" },
            },
          },
        },
        assets: [
          {
            id: "loop",
            kind: "video",
            path: "assets/loop.webm",
            license: { name: "CC0", attribution: "Yunari test fixture." },
          },
        ],
      },
      assets: { "assets/loop.webm": new Uint8Array([1, 2, 3]) },
    });
    await store.write("plain", {
      envelope: envelopeFor("plain", "Plain"),
      assets: {},
    });

    const list = await store.list();
    const byId = new Map(list.map((entry) => [entry.id, entry]));

    expect(byId.get("night-sky")?.ground).toBe("#101014");
    expect(byId.get("film")?.ground).toBeUndefined();
    // A board with no paint at all is the same absence as one with media.
    expect(byId.get("plain")?.ground).toBeUndefined();
  });

  it("carries a gradient ground as the CSS form a cell draws", async () => {
    const store = createThemeStore(tmpDir);
    // The gradient branch of `cssArtboardPaint`, which every case above reaches
    // only through a solid: the CSS form carries every stop, and the angle is
    // CSS's own convention rather than the authored one.
    await store.write("dusk", {
      envelope: {
        ...envelopeFor("dusk", "Dusk"),
        artboard: {
          width: 1920,
          height: 1080,
        },
        background: { color: { ref: "palette.dusk" } },
        globals: {
          palette: {
            none: {
              name: "None",
              value: { kind: "solid", color: "transparent" },
            },
            dusk: {
              name: "Dusk",
              value: {
                kind: "gradient",
                angle: 0,
                stops: [
                  { offset: 0, color: "#101014" },
                  { offset: 1, color: "#2b2b3a" },
                ],
              },
            },
          },
        },
      },
      assets: {},
    });

    const list = await store.list();

    expect(list[0]?.ground).toBe(
      "linear-gradient(90deg, #101014 0%, #2b2b3a 100%)",
    );
    // The same document is still classified, so the gradient is not a ground the
    // rest of the entry disagrees with.
    expect(list[0]?.facets.colourMode).toBe("dark");
  });

  /**
   * The bare mount's answer has to be reproducible, and a tie is ordinary here
   * rather than exotic: the e2e fixtures seed the whole library in one pass and
   * `updatedAt` is `stat.mtime` to the millisecond. The ruling ranks by recency
   * with `id` ascending as the tie-break, so this pins the two halves together —
   * the store's listing order and the mount's pick — rather than either alone.
   */
  it("opens the lower id when two themes share a modified time", async () => {
    const store = createThemeStore(tmpDir);
    // Saved higher-id-first, so a listing in write order would name `theme-b`:
    // the id sort has to be doing the work here, not insertion order.
    await store.write("theme-b", {
      envelope: envelopeFor("theme-b", "Theme Beta"),
      assets: {},
    });
    await store.write("theme-a", {
      envelope: envelopeFor("theme-a", "Theme Alpha"),
      assets: {},
    });
    // One instant, written after both saves so neither folder is the newer one.
    const sameMillisecond = new Date("2026-10-12T01:16:55.827Z");
    for (const id of ["theme-a", "theme-b"]) {
      await fs.utimes(path.join(tmpDir, id), sameMillisecond, sameMillisecond);
    }

    const outcome = await bootTheme("", {
      list: () => store.list(),
      open: async (id) => {
        const stored = await store.read(id);
        if (stored === undefined) throw new Error(`no theme "${id}"`);
        return stored;
      },
      save: async () => "base-after-save",
      // The display map is not what this test is about: it exercises the mount.
      assign: async () => undefined,
      listDisplays: async () => ({ default: null, displays: [] }),
    });

    // The document the mount opened, not the argument it passed: which theme
    // the author is handed is the claim.
    if (outcome.kind !== "opened") {
      throw new Error(`expected an opened theme, got "${outcome.kind}"`);
    }
    expect(outcome.content.envelope.id).toBe("theme-a");
  });

  it("ignores an archive left in the library, as ruled: there is no migration", async () => {
    const store = createThemeStore(tmpDir);
    const written = writeThemePackage({
      envelope: envelopeFor("old-archive", "Old Archive"),
      assets: {},
    });
    if (!written.ok) throw new Error(written.message);
    await fs.writeFile(
      path.join(tmpDir, "old-archive.yunari-theme"),
      written.bytes,
    );

    expect(await store.list()).toEqual([]);
    expect(await store.read("old-archive")).toBeUndefined();
  });

  it("leaves the previous theme intact when a save is refused", async () => {
    const store = createThemeStore(tmpDir);
    await store.write("living-room", {
      envelope: envelopeFor("living-room", "First Name"),
      assets: {},
    });
    const first = await fs.readFile(
      path.join(tmpDir, "living-room", "theme.json"),
      "utf8",
    );

    // An asset the document does not declare is refused before the folder is
    // staged, so the stored theme is never touched.
    await expect(
      store.write("living-room", {
        envelope: envelopeFor("living-room", "Second Name"),
        assets: { "assets/ghost.svg": new Uint8Array([1]) },
      }),
    ).rejects.toThrow("Assets must exactly match the theme declaration.");

    expect(await store.read("living-room")).toMatchObject({
      name: "First Name",
    });
    expect(
      await fs.readFile(path.join(tmpDir, "living-room", "theme.json"), "utf8"),
    ).toBe(first);
    // Nothing half-written is left where a listing would see it.
    expect(await fs.readdir(tmpDir)).toEqual(["living-room"]);
  });

  it("lists themes with metadata only", async () => {
    const store = createThemeStore(tmpDir);
    await store.write("theme-a", {
      envelope: envelopeFor("theme-a", "Theme Alpha"),
      assets: {},
    });

    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(
      (list[0] as unknown as { envelope?: unknown }).envelope,
    ).toBeUndefined();
  });

  it("refuses invalid or path traversal theme IDs", async () => {
    const store = createThemeStore(tmpDir);
    const content: ThemeContent = {
      envelope: envelopeFor("living-room", "Living Room"),
      assets: {},
    };

    for (const id of ["../escape", "/etc/passwd", "", "bad id with spaces"]) {
      await expect(store.write(id, content)).rejects.toThrow(
        "Invalid theme id",
      );
    }

    expect(await store.read("../escape")).toBeUndefined();
  });

  it("refuses a document that is not a theme and keeps the stored one", async () => {
    const store = createThemeStore(tmpDir);
    await store.write("living-room", {
      envelope: envelopeFor("living-room", "Initial Name"),
      assets: {},
    });

    await expect(
      store.write("living-room", {
        envelope: { nonsense: true } as unknown as FabricThemeEnvelope,
        assets: {},
      }),
    ).rejects.toThrow();
    await expect(
      store.write("other-room", {
        envelope: envelopeFor("living-room", "Mismatched"),
        assets: {},
      }),
    ).rejects.toThrow('does not match target id "other-room"');

    expect(await store.read("living-room")).toMatchObject({
      name: "Initial Name",
    });
  });

  it("returns undefined when theme is not found", async () => {
    const store = createThemeStore(tmpDir);
    expect(await store.read("non-existent")).toBeUndefined();
  });

  it("throws the validation error for a theme on disk that does not validate", async () => {
    // vg-110: a `theme.json` that exists and fails validation answered the same
    // `undefined` a missing file gets, so the store threw the validator's own
    // diagnosis away one layer below the reader. It is the typed error now,
    // carrying the issues (ADR-0043) — the read-side sibling of the `409`/`413`
    // refusals, not a sentence flattened into a bare failure.
    const store = createThemeStore(tmpDir);
    await fs.mkdir(path.join(tmpDir, "broken"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "broken", "theme.json"),
      JSON.stringify({ id: "broken" }),
    );
    // An unparseable document is the same fact — present and unreadable.
    await fs.mkdir(path.join(tmpDir, "unparseable"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "unparseable", "theme.json"),
      "{ this is not json",
    );

    const refusal = store.read("broken");
    await expect(refusal).rejects.toThrow(ThemeValidationError);
    const error = await refusal.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ThemeValidationError);
    expect((error as ThemeValidationError).issues[0]?.path).toBe(
      "/schemaVersion",
    );

    await expect(store.read("unparseable")).rejects.toThrow(
      ThemeValidationError,
    );

    // A theme that is not there is still `undefined`, not this error.
    expect(await store.read("not-there")).toBeUndefined();
  });

  it("throws the too-large error for a stored theme past the size bound", async () => {
    // vg-409: an over-large `theme.json` answered the same `undefined` a missing
    // file gets, so the open route said 404, `bootTheme` returned `none` and the
    // editor mounted the template under "Editor ready" — over a document the
    // author has on disk. It is the typed error now, its own member of the
    // family above rather than a validation failure: the validator never sees
    // this document, and the bound is the store's own (decisions/0043, 0084).
    const store = createThemeStore(tmpDir);
    await fs.mkdir(path.join(tmpDir, "oversized"), { recursive: true });
    const document = JSON.stringify(envelopeFor("oversized", "Oversized"));
    // Trailing whitespace keeps it valid JSON; the size is the whole point.
    await fs.writeFile(
      path.join(tmpDir, "oversized", "theme.json"),
      document + " ".repeat(33 * 1024 * 1024 - document.length),
    );

    await expect(store.read("oversized")).rejects.toThrow(ThemeTooLargeError);

    // The listing and the write base still see the absence they always did: a
    // theme the store cannot serve is not a library line, and a save over one
    // must not be refused for a document it is replacing.
    expect((await store.list()).map((entry) => entry.id)).not.toContain(
      "oversized",
    );
    await expect(
      store.write("oversized", {
        envelope: envelopeFor("oversized", "Shrunk"),
        assets: {},
      }),
    ).resolves.toMatchObject({ id: "oversized" });
    expect((await store.read("oversized"))?.envelope.metadata?.name).toBe(
      "Shrunk",
    );
  });

  it("keeps an invalid theme out of the listing, and answers a save over it", async () => {
    // The listing half is a different decision (ADR-0043): an unreadable
    // document is not a library line, and `list()` skips it exactly as before.
    // The write path also reads the stored document, and an invalid one is "no
    // previous to compare against" there — otherwise an author could never save
    // over a theme they can see is broken.
    const store = createThemeStore(tmpDir);
    await fs.mkdir(path.join(tmpDir, "broken"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "broken", "theme.json"),
      JSON.stringify({ id: "broken" }),
    );
    await fs.mkdir(path.join(tmpDir, "living-room"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "living-room", "theme.json"),
      JSON.stringify(envelopeFor("living-room", "Living Room")),
    );

    const listed = await store.list();
    expect(listed.map((entry) => entry.id)).toEqual(["living-room"]);

    await expect(
      store.write("broken", {
        envelope: envelopeFor("broken", "Repaired"),
        assets: {},
      }),
    ).resolves.toMatchObject({ id: "broken" });
    expect((await store.read("broken"))?.envelope.metadata?.name).toBe(
      "Repaired",
    );
  });

  /**
   * `vg-221`. The published schema refuses an empty `metadata.name`, and this
   * is the document that would have become unloadable because of it: written
   * before the bound, read after it. The case is a real folder on disk rather
   * than an object handed to the validator, because "a stored document that
   * validates today must not become unloadable" is the whole claim.
   */
  it("names a stored document whose own name is empty", async () => {
    const store = createThemeStore(tmpDir);
    await fs.mkdir(path.join(tmpDir, "nameless"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "nameless", "theme.json"),
      JSON.stringify(envelopeFor("nameless", "")),
    );

    const read = await store.read("nameless");
    expect(read?.envelope.metadata?.name).toBe("nameless");
    // The label is the document's own id, and the library line takes the same
    // repair: `entryFor`'s `??` does not fall back on `""`, so before this the
    // line read empty rather than naming the theme.
    expect((await store.list()).map((entry) => entry.name)).toEqual([
      "nameless",
    ]);
  });

  /**
   * The free-id claim (`expectFree`), which an import makes so that its id
   * decision and its write are one step. It is deliberately **not** the general
   * write's guard: a base-less save onto a taken id still replaces (vg-642), and
   * nothing here widens that.
   */
  describe("free-id claims", () => {
    it("writes an id that is free when the save claims it", async () => {
      const store = createThemeStore(tmpDir);

      const entry = await store.write(
        "living-room",
        { envelope: envelopeFor("living-room", "Living Room"), assets: {} },
        { expectFree: true },
      );

      expect(entry.id).toBe("living-room");
    });

    it("refuses an id the library already holds, and writes nothing", async () => {
      const store = createThemeStore(tmpDir);
      await store.write("living-room", {
        envelope: envelopeFor("living-room", "Living Room"),
        assets: {},
      });
      const before = await fs.readFile(
        path.join(tmpDir, "living-room", "theme.json"),
      );

      await expect(
        store.write(
          "living-room",
          {
            envelope: envelopeFor("living-room", "Something Else"),
            assets: {},
          },
          { expectFree: true },
        ),
      ).rejects.toThrow(ThemeIdTakenError);

      // The stored theme is the same bytes, and no scratch folder was left
      // behind: the claim is settled before anything is created on disk.
      expect(
        await fs.readFile(path.join(tmpDir, "living-room", "theme.json")),
      ).toEqual(before);
      expect(await fs.readdir(tmpDir)).toEqual(["living-room"]);
    });

    it("claims the folder, not a document it can read", async () => {
      const store = createThemeStore(tmpDir);
      // A theme the listing skips is still the author's work, so a save that
      // claimed the id must refuse for it too.
      await fs.mkdir(path.join(tmpDir, "broken"), { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, "broken", "theme.json"),
        JSON.stringify({ id: "broken" }),
      );

      await expect(
        store.write(
          "broken",
          { envelope: envelopeFor("broken", "Broken"), assets: {} },
          { expectFree: true },
        ),
      ).rejects.toThrow(ThemeIdTakenError);
    });

    it("still replaces when the save names a base instead of claiming a free id", async () => {
      const store = createThemeStore(tmpDir);
      const first = await store.write("living-room", {
        envelope: envelopeFor("living-room", "Living Room"),
        assets: {},
      });

      // The pair the general write already had, unchanged by `expectFree`: a
      // base that matches is a save the store applies.
      await expect(
        store.write(
          "living-room",
          {
            envelope: envelopeFor("living-room", "Living Room, edited"),
            assets: {},
          },
          { base: first.base },
        ),
      ).resolves.toMatchObject({ id: "living-room" });
    });
  });
});

/**
 * A crash cannot be made impossible here — renaming onto an existing directory
 * is not portable — so it has to be undone. These kill a real save with
 * `crashSave`, at both points a kill can reach, and then start again.
 */
describe("ThemeStore crash recovery", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "yunari-theme-recovery-test-"),
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const save = (id: string, name: string): ThemeContent => ({
    envelope: envelopeFor(id, name),
    assets: {},
  });

  it("puts back a theme a kill between the two renames left behind", async () => {
    const store = createThemeStore(tmpDir);
    await store.write("living-room", save("living-room", "First Name"));
    await crashSave(
      store,
      "living-room",
      save("living-room", "Second Name"),
      "between-renames",
    );

    // What the kill left: the previous theme under a name no listing can see,
    // the new folder still waiting, and nothing at the theme's own name. The
    // old one is what it was and not what it was becoming, because the save
    // that would have moved it in never reached its second rename.
    expect((await fs.readdir(tmpDir)).sort()).toEqual(
      [
        ...(await scratchNames(tmpDir, "living-room", "retired")),
        ...(await scratchNames(tmpDir, "living-room", "staging")),
      ].sort(),
    );
    expect(await fs.readdir(tmpDir)).not.toContain("living-room");
    expect(await scratchNames(tmpDir, "living-room", "retired")).toHaveLength(
      1,
    );

    // The next start is a new store over the same library, which is all a
    // restart is.
    const next = createThemeStore(tmpDir);
    expect(await next.list()).toMatchObject([
      { id: "living-room", name: "First Name" },
    ]);
    expect(await next.read("living-room")).toMatchObject({
      name: "First Name",
    });
    // The staging folder was a write that never happened; the retired one is
    // the last good copy, now living under its own name again.
    expect(await fs.readdir(tmpDir)).toEqual(["living-room"]);
  });

  it("reaps the staging folder a kill mid-write left behind", async () => {
    const store = createThemeStore(tmpDir);
    await store.write("living-room", save("living-room", "First Name"));
    await crashSave(
      store,
      "living-room",
      save("living-room", "Never Finished"),
      "mid-write",
    );

    // The theme was never touched, and the draft beside it is a folder with
    // nothing in it.
    expect(await scratchNames(tmpDir, "living-room", "staging")).toHaveLength(
      1,
    );
    expect(await scratchNames(tmpDir, "living-room", "retired")).toHaveLength(
      0,
    );

    const next = createThemeStore(tmpDir);
    expect(await next.list()).toMatchObject([
      { id: "living-room", name: "First Name" },
    ]);
    expect(await fs.readdir(tmpDir)).toEqual(["living-room"]);
  });

  it("leaves a retired copy alone when a live theme already holds the name", async () => {
    const crashed = createThemeStore(tmpDir);
    await crashed.write("living-room", save("living-room", "First Name"));
    await crashSave(
      crashed,
      "living-room",
      save("living-room", "Second Name"),
      "between-renames",
    );

    // The author saves again, which succeeds because the name is free — and
    // leaves the older copy retired beside a newer live theme.
    const store = createThemeStore(tmpDir);
    await store.write("living-room", save("living-room", "Third Name"));
    expect(await store.list()).toMatchObject([
      { id: "living-room", name: "Third Name" },
    ]);

    // Restoring the retired copy would trade a crash for silent data loss, so
    // it stays where it is, holding the version it always held.
    const retired = await scratchNames(tmpDir, "living-room", "retired");
    expect(retired).toHaveLength(1);
    expect(
      await fs.readFile(
        path.join(tmpDir, retired[0] as string, "theme.json"),
        "utf8",
      ),
    ).toContain("First Name");
    expect(await fs.readdir(tmpDir)).toContain("living-room");
  });

  it("recovers the same way on every later start", async () => {
    const store = createThemeStore(tmpDir);
    await store.write("living-room", save("living-room", "First Name"));
    await crashSave(
      store,
      "living-room",
      save("living-room", "Second Name"),
      "between-renames",
    );

    const first = await createThemeStore(tmpDir).list();
    const second = await createThemeStore(tmpDir).list();
    expect(second).toEqual(first);
    expect(await fs.readdir(tmpDir)).toEqual(["living-room"]);

    // And it does not loop: what it restored is already a theme, so there is
    // nothing left for a third start to do.
    expect(await createThemeStore(tmpDir).list()).toEqual(first);
    expect(await fs.readdir(tmpDir)).toEqual(["living-room"]);
  });

  it("leaves a scratch folder it cannot read a theme id out of alone", async () => {
    await fs.mkdir(path.join(tmpDir, ".staging-1700000000"));
    await fs.mkdir(path.join(tmpDir, ".retired-1700000000.not a theme id"));
    await fs.mkdir(path.join(tmpDir, ".notes"));

    const store = createThemeStore(tmpDir);
    expect(await store.list()).toEqual([]);
    // Nothing here names a theme, so there is nothing to put back and nothing
    // that may be deleted on a guess.
    expect((await fs.readdir(tmpDir)).sort()).toEqual([
      ".notes",
      ".retired-1700000000.not a theme id",
      ".staging-1700000000",
    ]);
  });

  it("leaves no scratch folder behind after a save that finished", async () => {
    const store = createThemeStore(tmpDir);
    await store.write("living-room", save("living-room", "First Name"));
    // A second save is the one that stages a folder, retires the old theme and
    // cleans both up — the path a crash would interrupt.
    await store.write("living-room", save("living-room", "Second Name"));
    await store.write("theme-a", save("theme-a", "Theme Alpha"));

    expect((await store.list()).map((entry) => entry.id)).toEqual([
      "living-room",
      "theme-a",
    ]);
    expect((await fs.readdir(tmpDir)).sort()).toEqual([
      "living-room",
      "theme-a",
    ]);
  });
});

/** The hash a declaration carries, computed the way import computes it. */
function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * A save that changes nothing must not rewrite what it did not change. The
 * proof is a file's modified time, so the tests put one where only a rewrite
 * would move it: a date far enough in the past that no clock resolution can
 * hide a file landing on it by accident.
 */
describe("ThemeStore asset reuse", () => {
  let tmpDir: string;

  const LONG_AGO = new Date("2001-02-03T04:05:06Z");

  const backport = new TextEncoder().encode("backdrop-bytes");
  const badge = new TextEncoder().encode("<svg/>");

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "yunari-theme-reuse-test-"),
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  /** A theme declaring each asset with the hash of its own bytes, as import does. */
  function themeWith(
    contents: ReadonlyArray<readonly [string, Uint8Array]>,
    hash = true,
  ): ThemeContent {
    return {
      envelope: {
        ...envelopeFor("living-room", "Living Room"),
        assets: contents.map(([assetPath, bytes], index) => ({
          id: `asset-${index}`,
          kind: "image" as const,
          path: assetPath,
          ...(hash ? { sha256: sha256Of(bytes) } : {}),
        })),
      },
      assets: Object.fromEntries(contents),
    };
  }

  const asset = (assetPath: string): string =>
    path.join(tmpDir, "living-room", ...assetPath.split("/"));

  const modifiedAt = async (file: string): Promise<number> =>
    fs
      .stat(file)
      .then((stat) => stat.mtime.getTime())
      .catch(() => Number.NaN);

  const backdate = (file: string): Promise<void> =>
    fs.utimes(file, LONG_AGO, LONG_AGO);

  it("writes no asset whose declared hash the previous theme already holds", async () => {
    const store = createThemeStore(tmpDir);
    const content = themeWith([
      ["assets/backdrop.png", backport],
      ["assets/badge.svg", badge],
    ]);
    await store.write("living-room", content);
    await backdate(asset("assets/backdrop.png"));
    await backdate(asset("assets/badge.svg"));
    await backdate(path.join(tmpDir, "living-room", "theme.json"));

    // The same theme again, with only its name changed.
    await store.write("living-room", {
      ...content,
      envelope: {
        ...content.envelope,
        metadata: { name: "Renamed", author: "Ada", themeLanguage: "en" },
      },
    });

    // Neither asset was rewritten, so neither moved; the document is written on
    // every save, so it did. That is the whole claim, as two clocks disagreeing.
    expect(await modifiedAt(asset("assets/backdrop.png"))).toBe(
      LONG_AGO.getTime(),
    );
    expect(await modifiedAt(asset("assets/badge.svg"))).toBe(
      LONG_AGO.getTime(),
    );
    expect(
      await modifiedAt(path.join(tmpDir, "living-room", "theme.json")),
    ).not.toBe(LONG_AGO.getTime());
    // And the folder is still whole, which is what a copy must not break.
    expect(await store.read("living-room")).toMatchObject({
      name: "Renamed",
    });
    expect(await fs.readFile(asset("assets/badge.svg"), "utf8")).toBe("<svg/>");
  });

  it("writes the one asset that changed and leaves the other alone", async () => {
    const store = createThemeStore(tmpDir);
    await store.write(
      "living-room",
      themeWith([
        ["assets/backdrop.png", backport],
        ["assets/badge.svg", badge],
      ]),
    );
    await backdate(asset("assets/backdrop.png"));
    await backdate(asset("assets/badge.svg"));

    const changed = new TextEncoder().encode("<svg>replaced</svg>");
    await store.write(
      "living-room",
      themeWith([
        ["assets/backdrop.png", backport],
        ["assets/badge.svg", changed],
      ]),
    );

    expect(await modifiedAt(asset("assets/backdrop.png"))).toBe(
      LONG_AGO.getTime(),
    );
    expect(await modifiedAt(asset("assets/badge.svg"))).not.toBe(
      LONG_AGO.getTime(),
    );
    expect(await fs.readFile(asset("assets/badge.svg"), "utf8")).toBe(
      "<svg>replaced</svg>",
    );
  });

  /**
   * The trap a hash-only check falls into: the declaration proves the *content*
   * is right, never that the file is *there*. A theme folder an author emptied
   * must come back from a save whole.
   */
  it("restores an asset the previous theme declared but no longer holds", async () => {
    const store = createThemeStore(tmpDir);
    const content = themeWith([["assets/backdrop.png", backport]]);
    await store.write("living-room", content);
    await backdate(asset("assets/backdrop.png"));
    await fs.rm(asset("assets/backdrop.png"));

    await store.write("living-room", content);

    // Restored, and written rather than copied — a copy would have had nothing
    // to copy from.
    expect(await fs.readFile(asset("assets/backdrop.png"), "utf8")).toBe(
      "backdrop-bytes",
    );
    expect(await modifiedAt(asset("assets/backdrop.png"))).not.toBe(
      LONG_AGO.getTime(),
    );
    expect(await store.read("living-room")).toMatchObject({
      assets: { "assets/backdrop.png": backport },
    });
  });

  it("writes an asset whose path is a directory, not a file", async () => {
    const store = createThemeStore(tmpDir);
    const content = themeWith([["assets/backdrop.png", backport]]);
    await store.write("living-room", content);
    await backdate(asset("assets/backdrop.png"));
    await fs.rm(asset("assets/backdrop.png"));
    await fs.mkdir(asset("assets/backdrop.png"));

    await store.write("living-room", content);

    // Copying a directory there would commit a theme that renders nothing.
    expect((await fs.stat(asset("assets/backdrop.png"))).isFile()).toBe(true);
    expect(await fs.readFile(asset("assets/backdrop.png"), "utf8")).toBe(
      "backdrop-bytes",
    );
  });

  it("writes an asset the declaration does not hash", async () => {
    const store = createThemeStore(tmpDir);
    const content = themeWith([["assets/backdrop.png", backport]], false);
    await store.write("living-room", content);
    await backdate(asset("assets/backdrop.png"));

    await store.write("living-room", content);

    // Two unhashable declarations are not a match; they are no evidence at all.
    expect(await modifiedAt(asset("assets/backdrop.png"))).not.toBe(
      LONG_AGO.getTime(),
    );
  });

  for (const [state, damage] of [
    ["missing", () => fs.rm(path.join(tmpDir, "living-room", "theme.json"))],
    [
      "corrupt",
      () => fs.writeFile(path.join(tmpDir, "living-room", "theme.json"), "{"),
    ],
  ] as const) {
    it(`writes every asset when the previous theme.json is ${state}`, async () => {
      const store = createThemeStore(tmpDir);
      const content = themeWith([["assets/backdrop.png", backport]]);
      await store.write("living-room", content);
      await backdate(asset("assets/backdrop.png"));
      await damage();

      await store.write("living-room", content);

      // Nothing to corroborate the declared hash against, so nothing is skipped
      // on the strength of it.
      expect(await modifiedAt(asset("assets/backdrop.png"))).not.toBe(
        LONG_AGO.getTime(),
      );
      expect(await fs.readFile(asset("assets/backdrop.png"), "utf8")).toBe(
        "backdrop-bytes",
      );
    });
  }

  it("writes every asset of a first save, with no previous folder to copy from", async () => {
    // The library does not exist yet, so a save that tried to reuse anything
    // would have nothing to read and would fail the write.
    const store = createThemeStore(path.join(tmpDir, "not-created-yet"));
    const content = themeWith([
      ["assets/backdrop.png", backport],
      ["assets/badge.svg", badge],
    ]);

    await store.write("living-room", content);

    expect(
      (
        await fs.readdir(
          path.join(tmpDir, "not-created-yet", "living-room", "assets"),
        )
      ).sort(),
    ).toEqual(["backdrop.png", "badge.svg"]);
    expect(await store.read("living-room")).toMatchObject({
      assets: { "assets/badge.svg": badge },
    });
  });
});

/**
 * A save that leaves an asset out of its payload, because the folder it is
 * replacing already holds it.
 *
 * The one thing that makes this safe is that the base matched first, so "the
 * host has these bytes" is the host's own knowledge. Every refusal below is a
 * way of asking what happens when that is not so — and a short payload that
 * answered any of them with a written file would be a quieter way to lose an
 * asset than the clobber the base already prevents.
 */
describe("ThemeStore partial saves", () => {
  let tmpDir: string;
  let store: ThemeStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "yunari-theme-partial-test-"),
    );
    store = createThemeStore(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const LONG_AGO = new Date("2001-02-03T04:05:06Z");
  const backport = new TextEncoder().encode("backdrop-bytes");
  const badge = new TextEncoder().encode("<svg/>");

  /** A theme declaring each asset with the hash of its own bytes, as import does. */
  function themeWith(
    contents: ReadonlyArray<readonly [string, Uint8Array]>,
    name = "Living Room",
  ): ThemeContent {
    return {
      envelope: {
        ...envelopeFor("living-room", name),
        assets: contents.map(([assetPath, bytes], index) => ({
          id: `asset-${index}`,
          kind: "image" as const,
          path: assetPath,
          sha256: sha256Of(bytes),
        })),
      },
      assets: Object.fromEntries(contents),
    };
  }

  /** The payload a second save sends when it changed nothing: the empty map. */
  function only(content: ThemeContent, assetPath: string): ThemeContent {
    const { [assetPath]: _dropped, ...rest } = content.assets;
    return { envelope: content.envelope, assets: rest };
  }

  const asset = (assetPath: string): string =>
    path.join(tmpDir, "living-room", ...assetPath.split("/"));

  const backdate = (file: string): Promise<void> =>
    fs.utimes(file, LONG_AGO, LONG_AGO);

  it("keeps an asset the payload left out, and answers the next save's base", async () => {
    const content = themeWith([
      ["assets/backdrop.png", backport],
      ["assets/badge.svg", badge],
    ]);
    const opened = await store.write("living-room", content);
    await backdate(asset("assets/backdrop.png"));
    await backdate(asset("assets/badge.svg"));

    // The save the editor now makes: the document with a new name, carrying
    // neither asset, on the base it opened with.
    const saved = await store.write(
      "living-room",
      {
        ...only(content, "assets/backdrop.png"),
        envelope: {
          ...content.envelope,
          metadata: { name: "Renamed", author: "Ada", themeLanguage: "en" },
        },
      },
      { base: opened.base },
    );

    // The file nobody sent is still the file the folder had, byte for byte and
    // unmoved, and the one that *was* sent is present too.
    expect(await fs.readFile(asset("assets/backdrop.png"), "utf8")).toBe(
      "backdrop-bytes",
    );
    expect((await fs.stat(asset("assets/backdrop.png"))).mtime.getTime()).toBe(
      LONG_AGO.getTime(),
    );
    expect(await store.read("living-room")).toMatchObject({
      name: "Renamed",
      assets: { "assets/backdrop.png": backport, "assets/badge.svg": badge },
    });
    // And the base moved on, so the next save is not stale against itself.
    expect(saved.base).not.toBe(opened.base);
    await expect(
      store.write("living-room", only(content, "assets/backdrop.png"), {
        base: saved.base,
      }),
    ).resolves.toMatchObject({ name: "Living Room" });
  });

  /**
   * The claim of the whole change, stated where it can be falsified: a save
   * that sends nothing for an asset still ends with that asset on disk, and
   * ends with it by copying rather than by receiving.
   */
  it("restores an omitted asset by copying it, never by writing empty bytes", async () => {
    const content = themeWith([["assets/backdrop.png", backport]]);
    const opened = await store.write("living-room", content);
    await backdate(asset("assets/backdrop.png"));

    await store.write("living-room", only(content, "assets/backdrop.png"), {
      base: opened.base,
    });

    // Copied with its timestamps kept — the stamp is what a write would have
    // moved, and it did not move.
    expect((await fs.stat(asset("assets/backdrop.png"))).mtime.getTime()).toBe(
      LONG_AGO.getTime(),
    );
    expect((await fs.stat(asset("assets/backdrop.png"))).size).toBe(
      backport.byteLength,
    );
  });

  /**
   * The one to read twice. A short payload reconstructs from whatever is
   * stored — so if it can be reached with a base that did not match, the
   * clobber the guard exists to prevent comes back through the side door, and
   * no longer looks like a clobber.
   */
  it("refuses a partial save whose base is stale, and changes nothing", async () => {
    const content = themeWith([["assets/backdrop.png", backport]]);
    const opened = await store.write("living-room", content);
    // Another author saves over it while this tab is open.
    const theirs = themeWith(
      [
        ["assets/backdrop.png", backport],
        ["assets/badge.svg", badge],
      ],
      "Living Room, by someone else",
    );
    await store.write("living-room", theirs);
    const before = await store.read("living-room");

    // The stale tab sends only the badge — the asset it believes the folder
    // still holds — and the base it opened with.
    await expect(
      store.write(
        "living-room",
        { ...only(theirs, "assets/badge.svg"), envelope: content.envelope },
        { base: opened.base },
      ),
    ).rejects.toThrow(ThemeConflictError);

    // Not "the theme still parses": the other author's whole folder, and no
    // scratch left by a save refused before it staged anything.
    expect(await store.read("living-room")).toMatchObject({
      name: "Living Room, by someone else",
      assets: { "assets/backdrop.png": backport, "assets/badge.svg": badge },
    });
    expect(before).toMatchObject({
      base: (await store.read("living-room"))?.base,
    });
    expect((await fs.readdir(tmpDir)).sort()).toEqual(["living-room"]);
  });

  it("refuses a partial save that stands the guard down with an overwrite", async () => {
    const content = themeWith([["assets/backdrop.png", backport]]);
    const opened = await store.write("living-room", content);

    // The one road past the guard is the one road where the stored document is
    // not the one this save came from, so it cannot claim to leave an asset out.
    await expect(
      store.write("living-room", only(content, "assets/backdrop.png"), {
        base: opened.base,
        overwrite: true,
      }),
    ).rejects.toThrow(/exactly match/);
    expect(await store.read("living-room")).toMatchObject({
      name: "Living Room",
      assets: { "assets/backdrop.png": backport },
    });
  });

  it("refuses a partial save with no base, and one for a theme that is not stored", async () => {
    const content = themeWith([["assets/backdrop.png", backport]]);
    const opened = await store.write("living-room", content);

    // No base at all: a first save, and nothing to reconstruct from.
    await expect(
      store.write("living-room", only(content, "assets/backdrop.png")),
    ).rejects.toThrow(/exactly match/);

    // A base against a theme that is not stored is a first save too — there is
    // no stored document for the guard to have matched.
    const fresh = createThemeStore(path.join(tmpDir, "empty-library"));
    await expect(
      fresh.write("living-room", only(content, "assets/backdrop.png"), {
        base: opened.base,
      }),
    ).rejects.toThrow(/exactly match/);
  });

  it("refuses a partial save that names an asset the document does not declare", async () => {
    const content = themeWith([["assets/backdrop.png", backport]]);
    const opened = await store.write("living-room", content);

    await expect(
      store.write(
        "living-room",
        {
          ...only(content, "assets/backdrop.png"),
          assets: { "assets/smuggled.png": badge },
        },
        { base: opened.base },
      ),
    ).rejects.toThrow(/exactly match/);
    expect(await store.read("living-room")).toMatchObject({
      assets: { "assets/backdrop.png": backport },
    });
  });

  /**
   * A hash proves the content, never that the file is *there*. An author who
   * empties the folder under a tab would otherwise get a theme that validates
   * and renders nothing — committed silently, which is the failure this whole
   * mechanism has to be able to make loud.
   */
  it("refuses a partial save whose omitted asset is not in the folder", async () => {
    const content = themeWith([["assets/backdrop.png", backport]]);
    const opened = await store.write("living-room", content);
    await fs.rm(asset("assets/backdrop.png"));
    const before = await store.read("living-room");

    await expect(
      store.write("living-room", only(content, "assets/backdrop.png"), {
        base: opened.base,
      }),
    ).rejects.toThrow(/is not in the library folder/);

    // Nothing written, and nothing half-written: the theme that was already
    // broken is left exactly as broken as it was, and no staging folder is left.
    expect(before).toEqual(await store.read("living-room"));
    expect((await fs.readdir(tmpDir)).sort()).toEqual(["living-room"]);
  });

  it("refuses a partial save whose omitted path is a directory, not a file", async () => {
    const content = themeWith([["assets/backdrop.png", backport]]);
    const opened = await store.write("living-room", content);
    await fs.rm(asset("assets/backdrop.png"));
    await fs.mkdir(asset("assets/backdrop.png"));

    await expect(
      store.write("living-room", only(content, "assets/backdrop.png"), {
        base: opened.base,
      }),
    ).rejects.toThrow(/is not in the library folder/);
    expect((await fs.stat(asset("assets/backdrop.png"))).isDirectory()).toBe(
      true,
    );
  });
});

/**
 * Two editors open on one theme. The one that saves second is holding a
 * document that never saw the first one's work, and because a save replaces
 * the whole folder, applying it would drop the first one's fields *and* the
 * assets it imported. These are the tests that say the store noticed.
 */
describe("ThemeStore concurrent saves", () => {
  let tmpDir: string;
  let store: ThemeStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "yunari-theme-conflict-test-"),
    );
    store = createThemeStore(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const empty: ThemeContent = {
    envelope: envelopeFor("kitchen", "Kitchen"),
    assets: {},
  };
  const edited: ThemeContent = {
    envelope: envelopeFor("kitchen", "Kitchen, edited by the second tab"),
    assets: {},
  };

  /** Every byte of a theme folder, so "unchanged" means unchanged and not
   *  "still parses" — the claim is about the files, not the values. */
  async function folderBytes(id: string): Promise<Record<string, string>> {
    const found: Record<string, string> = {};
    const walk = async (dir: string, prefix: string): Promise<void> => {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const name = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full, name);
        } else {
          found[name] = (await fs.readFile(full)).toString("base64");
        }
      }
    };
    await walk(path.join(tmpDir, id), "");
    return found;
  }

  it("refuses a save built from a document the store has moved past, and changes nothing", async () => {
    // Both tabs open the same stored theme.
    const opened = await store.write("kitchen", empty);
    const tabA = await store.write("kitchen", edited, { base: opened.base });

    // Tab B still holds the document it opened, and saves it.
    const before = await folderBytes("kitchen");
    await expect(
      store.write("kitchen", empty, { base: opened.base }),
    ).rejects.toThrow(ThemeConflictError);

    // Not "the theme still parses" — the same bytes, and no scratch folder
    // left behind by a save that was refused before it staged anything.
    expect(await folderBytes("kitchen")).toEqual(before);
    expect((await fs.readdir(tmpDir)).sort()).toEqual(["kitchen"]);
    expect(tabA.base).not.toBe(opened.base);
  });

  it("keeps the assets a refused save would have dropped", async () => {
    const image = new TextEncoder().encode(
      "a photograph, base64 in a real save",
    );

    // Both tabs open the theme before the image exists.
    const opened = await store.write("kitchen", empty);
    // Tab A imports a picture and saves.
    await store.write(
      "kitchen",
      withAsset("kitchen", "Kitchen", "assets/photo.png", image),
      {
        base: opened.base,
      },
    );

    // Tab B's document predates the import, so its declaration does not
    // mention the picture at all — and a save replaces the whole folder.
    await expect(
      store.write("kitchen", empty, { base: opened.base }),
    ).rejects.toThrow(ThemeConflictError);

    const stored = await fs.readFile(
      path.join(tmpDir, "kitchen", "assets", "photo.png"),
    );
    expect(new Uint8Array(stored)).toEqual(image);
  });

  it("applies a save whose base is the document now stored", async () => {
    const opened = await store.write("kitchen", empty);
    const saved = await store.write("kitchen", edited, { base: opened.base });

    const record = await store.read("kitchen");
    expect(record?.envelope.metadata?.name).toBe(
      "Kitchen, edited by the second tab",
    );
    expect(record?.base).toBe(saved.base);
  });

  it("applies a first save, which has no stored document to be behind", async () => {
    // With no base at all, because the author never opened a stored theme.
    await expect(store.write("kitchen", empty)).resolves.toMatchObject({
      id: "kitchen",
    });
    // And with one, because a theme that was deleted underneath the tab is a
    // create rather than a conflict.
    await expect(
      store.write(
        "garden",
        { envelope: envelopeFor("garden", "Garden"), assets: {} },
        {
          base: "a-base-for-a-theme-that-is-not-there",
        },
      ),
    ).resolves.toMatchObject({ id: "garden" });
  });

  it("applies an overwrite deliberately, and answers the base to build on next", async () => {
    const opened = await store.write("kitchen", empty);
    await expect(
      store.write("kitchen", edited, { base: opened.base, overwrite: true }),
    ).resolves.toMatchObject({ id: "kitchen" });

    const record = await store.read("kitchen");
    expect(record?.envelope.metadata?.name).toBe(
      "Kitchen, edited by the second tab",
    );
    // The refused save's base is dead; the one the overwrite reported is not.
    expect(record?.base).not.toBe(opened.base);
  });

  it("answers a base that is the document's content, not the folder's clock", async () => {
    const opened = await store.write("kitchen", empty);
    expect(opened.base).toMatch(/^[0-9a-f]{64}$/);

    // Saving the same document again lands on the same base even though the
    // store replaced the folder and the folder's mtime moved.
    const again = await store.write("kitchen", empty, { base: opened.base });
    expect(again.base).toBe(opened.base);

    // And something that moves the file's time without touching the document —
    // a checkout, an rsync, a copy that keeps timestamps — is not a change to
    // be stale about. An mtime base would refuse this save.
    const later = new Date("2031-05-06T07:08:09Z");
    await fs.utimes(path.join(tmpDir, "kitchen", "theme.json"), later, later);
    await expect(
      store.write("kitchen", edited, { base: opened.base }),
    ).resolves.toMatchObject({ id: "kitchen" });
  });

  it("refuses a base that is not the stored document, whatever shape it arrives in", async () => {
    const opened = await store.write("kitchen", empty);
    for (const base of [
      "",
      "not-a-hash",
      opened.base.slice(0, -1),
      `${opened.base}0`,
    ]) {
      await expect(store.write("kitchen", edited, { base })).rejects.toThrow(
        ThemeConflictError,
      );
    }
  });
});

describe("isValidThemeId", () => {
  it("accepts alphanumeric, hyphens, and underscores up to 64 chars", () => {
    expect(isValidThemeId("living-room")).toBe(true);
    expect(isValidThemeId("living_room_123")).toBe(true);
    expect(isValidThemeId("a")).toBe(true);
  });

  it("rejects traversal, slashes, spaces, and empty strings", () => {
    expect(isValidThemeId("")).toBe(false);
    expect(isValidThemeId("../escape")).toBe(false);
    expect(isValidThemeId("a/b")).toBe(false);
    expect(isValidThemeId("a b")).toBe(false);
    expect(isValidThemeId("a".repeat(65))).toBe(false);
  });
});

/**
 * The bounds a theme's assets must meet, asked of both paths and the same
 * number, because a store that saves what it will not read reports a save that
 * cannot be opened. Half of each case is put on disk by hand, which is the only
 * way to ask `read` about a theme no save was allowed to make — and the only
 * way the two answers can be compared as answers rather than as expectations.
 */
describe("ThemeStore asset bounds", () => {
  const MIB = 1024 * 1024;

  let tmpDir: string;
  let store: ThemeStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "yunari-theme-bounds-test-"),
    );
    store = createThemeStore(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  /** A theme declaring each asset with the hash of its own bytes, as import does. */
  function themeWith(
    id: string,
    contents: ReadonlyArray<readonly [string, number]>,
    name = "Living Room",
    hash = true,
  ): ThemeContent {
    const bytes = contents.map(
      ([assetPath, length]) => [assetPath, new Uint8Array(length)] as const,
    );
    return {
      envelope: {
        ...envelopeFor(id, name),
        assets: bytes.map(([assetPath, content], index) => ({
          id: `asset-${index}`,
          kind: "image" as const,
          path: assetPath,
          ...(hash ? { sha256: sha256Of(content) } : {}),
        })),
      },
      assets: Object.fromEntries(bytes),
    };
  }

  /** A theme of many small assets, for the count bound. */
  function themeOfCount(id: string, count: number): ThemeContent {
    return themeWith(
      id,
      Array.from({ length: count }, (_unused, index) => [
        `assets/a${index}.png`,
        1,
      ]),
      "Living Room",
      false,
    );
  }

  /** The same theme written straight to the library folder, and the base a
   *  save made from that document would carry. */
  async function placeOnDisk(
    id: string,
    content: ThemeContent,
  ): Promise<string> {
    const folder = path.join(tmpDir, id);
    await fs.mkdir(path.join(folder, "assets"), { recursive: true });
    const document = JSON.stringify(content.envelope);
    await fs.writeFile(path.join(folder, "theme.json"), document);
    for (const [assetPath, bytes] of Object.entries(content.assets)) {
      await fs.writeFile(path.join(folder, ...assetPath.split("/")), bytes);
    }
    return sha256Of(new TextEncoder().encode(document));
  }

  const stored = (id: string) => path.join(tmpDir, id);

  it("refuses a save whose asset is over the bound, and says which and by how much", async () => {
    await store.write(
      "living-room",
      themeWith("living-room", [["assets/badge.svg", 4]], "First Name"),
    );
    const document = await fs.readFile(
      path.join(stored("living-room"), "theme.json"),
    );

    await expect(
      store.write(
        "living-room",
        themeWith("living-room", [["assets/big.png", 81 * MIB]], "Renamed"),
      ),
    ).rejects.toThrow(
      'Asset "assets/big.png" is 81 MB (84,934,656 bytes); one asset may be ' +
        "at most 80 MB (83,886,080 bytes). Shrink or remove it, then save again.",
    );

    // Nothing was renamed into place, so the stored theme is the one the
    // author last saved — byte for byte, not merely by name.
    expect(
      await fs.readFile(path.join(stored("living-room"), "theme.json")),
    ).toEqual(document);
    expect(await store.read("living-room")).toMatchObject({
      name: "First Name",
    });
    expect(await fs.readdir(tmpDir)).toEqual(["living-room"]);
  });

  it("saves an asset exactly at the bound, and refuses the one byte over it", async () => {
    await expect(
      store.write(
        "living-room",
        themeWith("living-room", [["assets/big.png", 80 * MIB]]),
      ),
    ).resolves.toMatchObject({ id: "living-room" });
    expect(
      (await store.read("living-room"))?.assets["assets/big.png"]?.byteLength,
    ).toBe(80 * MIB);

    await expect(
      store.write(
        "living-room",
        themeWith("living-room", [["assets/big.png", 80 * MIB + 1]]),
      ),
    ).rejects.toThrow(ThemeAssetLimitError);
    // The refused save did not shrink the theme to the size it accepted.
    expect(
      (await store.read("living-room"))?.assets["assets/big.png"]?.byteLength,
    ).toBe(80 * MIB);
  });

  it("holds read and write to the same per-asset bound, at the boundary", async () => {
    for (const length of [80 * MIB, 80 * MIB + 1]) {
      const saved = `saved-${length}`;
      const placed = `placed-${length}`;

      const written = await store
        .write(saved, themeWith(saved, [["assets/big.png", length]]))
        .then(() => true)
        .catch(() => false);
      await placeOnDisk(
        placed,
        themeWith(placed, [["assets/big.png", length]]),
      );

      // The same question, asked of both paths: a theme `write` takes is a
      // theme `read` gives back. A bound that drifted between them would put
      // these two answers on opposite sides of this line.
      expect(written).toBe((await store.read(placed)) !== undefined);
    }
  });

  it("holds read and write to the same asset count", async () => {
    await expect(
      store.write("at-bound", themeOfCount("at-bound", 128)),
    ).resolves.toMatchObject({ id: "at-bound" });
    await expect(
      store.write("over-bound", themeOfCount("over-bound", 129)),
    ).rejects.toThrow(
      "This theme declares 129 assets; a theme may declare at most 128.",
    );

    await placeOnDisk("kept-at", themeOfCount("kept-at", 128));
    await placeOnDisk("kept-over", themeOfCount("kept-over", 129));
    expect(await store.read("kept-at")).toBeDefined();
    expect(await store.read("kept-over")).toBeUndefined();
  });

  it("refuses a save whose assets together are over the bound", async () => {
    await expect(
      store.write(
        "living-room",
        themeWith(
          "living-room",
          [
            ["assets/a.png", 46 * MIB],
            ["assets/b.png", 46 * MIB],
            ["assets/e.png", 1],
          ],
          "Living Room",
          false,
        ),
      ),
    ).rejects.toThrow(
      "This theme's assets come to 92 MB (96,468,992 bytes); together " +
        "they may be at most 90 MB (94,371,840 bytes). Shrink or remove " +
        "one, then save again.",
    );
    expect(await store.read("living-room")).toBeUndefined();
    expect(await fs.readdir(tmpDir)).toEqual([]);
  });

  it("weighs an asset a save left out, which is the one already on disk", async () => {
    // The world this defect makes: a folder holding an asset over the bound,
    // written before the write path had a bound to hold it to. It cannot be
    // opened, so the editor's next save carries no bytes for it at all — and
    // that is exactly when the store has to weigh it or a refusal is skipped.
    const onDisk = themeWith("living-room", [["assets/big.png", 81 * MIB]]);
    const base = await placeOnDisk("living-room", onDisk);
    expect(await store.read("living-room")).toBeUndefined();

    await expect(
      store.write(
        "living-room",
        {
          envelope: {
            ...onDisk.envelope,
            metadata: { name: "Renamed", author: "Ada", themeLanguage: "en" },
          },
          assets: {},
        },
        { base },
      ),
    ).rejects.toThrow('Asset "assets/big.png" is 81 MB');
    expect(
      await fs.readFile(path.join(stored("living-room"), "theme.json"), "utf8"),
    ).toBe(JSON.stringify(onDisk.envelope));
  });
});

/**
 * Removing a theme is the one destructive thing the store does, so what it is
 * measured on is which folder leaves and which does not. The trash itself is a
 * child process and is covered by `trash.test.ts`; here it is replaced, so these
 * are about the store's decisions rather than the platform's.
 */
describe("ThemeStore remove", () => {
  let tmpDir: string;
  let trashed: string[];
  let store: ThemeStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-theme-remove-"));
    trashed = [];
    store = createThemeStore(tmpDir, {
      // Stands in for the platform's trash: moves the folder somewhere else,
      // so "it left the library" and "it is still recoverable" are both true
      // and neither depends on this machine having a recycle bin.
      trash: async (folder: string) => {
        trashed.push(folder);
        const bin = path.join(tmpDir, ".trashed");
        await fs.mkdir(bin, { recursive: true });
        await fs.rename(folder, path.join(bin, path.basename(folder)));
      },
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const save = (id: string, name: string): ThemeContent => ({
    envelope: envelopeFor(id, name),
    assets: {},
  });

  it("moves the theme's own folder to the trash, and leaves the rest alone", async () => {
    await store.write("living-room", save("living-room", "Living Room"));
    await store.write("kitchen", save("kitchen", "Kitchen"));

    await store.remove("living-room");

    // The folder is gone from the library, so the listing cannot offer it.
    expect((await store.list()).map((entry) => entry.id)).toEqual(["kitchen"]);
    expect(await store.read("living-room")).toBeUndefined();
    // And it went to the trash by that name, rather than being unlinked.
    expect(trashed).toEqual([path.join(tmpDir, "living-room")]);
    // The author's other work is not collateral.
    expect(await store.read("kitchen")).toBeDefined();
  });

  it("takes only the one theme, when the library root holds what is not a theme", async () => {
    // A real `~/.yunari/themes/` is not a folder of themes and nothing else.
    // Measured on this machine before the change: three theme folders, a
    // `.retired-` scratch folder, three `.yunari-theme` archives left by the
    // pre-ADR-0017 store, and `active-theme.json` — settings, in the library.
    await store.write("living-room", save("living-room", "Living Room"));
    await store.write("cpu-only", save("cpu-only", "CPU only"));
    await fs.writeFile(
      path.join(tmpDir, "active-theme.json"),
      '{"id":"living-room"}\n',
    );
    await fs.writeFile(path.join(tmpDir, "cpu-only.yunari-theme"), "not a zip");
    await fs.mkdir(path.join(tmpDir, ".retired-abc.cpu-only"), {
      recursive: true,
    });

    await store.remove("living-room");

    // The point of the test: a theme is a folder, so "delete a theme" is a
    // folder-scoped operation. Anything else sharing that root — host settings
    // that leaked in, a superseded archive, a crashed save's debris — is not the
    // author's chosen theme and must survive the delete of one that is.
    // (`.trashed` is this test's stand-in for the platform's recycle bin.)
    const remaining = (await fs.readdir(tmpDir))
      .filter((name) => name !== ".trashed")
      .sort();
    expect(remaining).toEqual([
      ".retired-abc.cpu-only",
      "active-theme.json",
      "cpu-only",
      "cpu-only.yunari-theme",
    ]);
    expect(trashed).toEqual([path.join(tmpDir, "living-room")]);
  });

  it("takes the whole folder, so a thumbnail inside it goes with the theme", async () => {
    await store.write("living-room", save("living-room", "Living Room"));
    await fs.writeFile(
      path.join(tmpDir, "living-room", "thumbnail.png"),
      "not really a png",
    );

    await store.remove("living-room");

    // A picture lives inside the theme it renders (thumbnails.ts), so there is
    // no second file to delete — and nothing left behind that names the theme.
    expect(
      await fs.readdir(path.join(tmpDir, ".trashed", "living-room")),
    ).toContain("thumbnail.png");
  });

  it("refuses a folder that is not a theme, and never touches it", async () => {
    // A directory whose name a theme id could claim but which holds no theme:
    // the author left it, or a tool did. The listing does not show it, and a
    // delete that took it would remove something whose loss is unexplained.
    await fs.mkdir(path.join(tmpDir, "notes"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "notes", "shopping.txt"), "milk");

    await expect(store.remove("notes")).resolves.toBe(false);
    expect(trashed).toEqual([]);
    expect(
      await fs.readFile(path.join(tmpDir, "notes", "shopping.txt"), "utf8"),
    ).toBe("milk");
  });

  it("answers false for a theme that is not stored", async () => {
    await expect(store.remove("never-existed")).resolves.toBe(false);
    expect(trashed).toEqual([]);
  });

  it("refuses an id that could name a folder it does not own", async () => {
    for (const id of ["../escape", "", "bad id with spaces"]) {
      await expect(store.remove(id)).rejects.toThrow("Invalid theme id");
    }
    expect(trashed).toEqual([]);
  });

  it("refuses while a save for that theme is in flight, rather than racing it", async () => {
    await store.write("living-room", save("living-room", "First"));
    // A save swaps its folder in with two renames; trashing between them would
    // take the folder the second one is about to rename into place.
    await crashSave(
      store,
      "living-room",
      save("living-room", "Second"),
      "between-renames",
    );

    await expect(store.remove("living-room")).rejects.toThrow("being saved");
    expect(trashed).toEqual([]);
    // The kill moved the theme aside under its `.retired-` name and stopped.
    // The refused delete is what leaves that recoverable copy alone.
    expect(await scratchNames(tmpDir, "living-room", "retired")).toHaveLength(
      1,
    );
  });

  it("removes nothing itself when the trash refuses, and says so", async () => {
    const refusing = createThemeStore(tmpDir, {
      trash: async () => {
        throw new Error("This PC has no trash command (gio, trash-put)");
      },
    });
    await refusing.write("living-room", save("living-room", "Living Room"));

    await expect(refusing.remove("living-room")).rejects.toThrow(
      "trash command",
    );

    // The promise the delete makes is that nothing is lost when it fails. A
    // fallback to `fs.rm` here would break it silently, on the one platform
    // nobody tested.
    expect(await refusing.read("living-room")).toBeDefined();
    expect((await refusing.list()).map((entry) => entry.id)).toEqual([
      "living-room",
    ]);
  });
});
