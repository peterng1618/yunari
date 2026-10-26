import { randomFillSync } from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FabricThemeEnvelope } from "@yunari/renderer-core";
import { MAX_ARCHIVE_BYTES, readThemePackage } from "@yunari/theme-package";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createThemeStore,
  type ThemeContent,
  type ThemeStore,
} from "./store.js";
import {
  type StoreBaseline,
  type StoreClient,
  StoreClientError,
  type VersionPlan,
} from "./store-client.js";
import { submissionFiles } from "./submission.js";
import { createThumbnailStore, type ThumbnailStore } from "./thumbnails.js";

const NOW = new Date("2026-10-22T09:30:00.000Z");

/** Fixed UUID theme ids, the shape every new document gets. */
const THEME_ID = "3f2a1c9e-8b7d-4c6a-9e0f-1a2b3c4d5e6f";
const MISSING_ID = "0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";
const UPLOAD_URL = "https://r2.test/packages/the-theme/1.0.0.zip";

/** A real 1×1 PNG: the header's declared size is what the thumbnail store checks. */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44,
  0x41, 0x54, 0x78, 0xda, 0x63, 0xfc, 0xcf, 0xc0, 0x50, 0x0f, 0x00, 0x04, 0x85,
  0x01, 0x80, 0x84, 0xa9, 0x8c, 0x21, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);

const PUBLISHED_AT = "2026-10-01T00:00:00.000Z";

/** `version: undefined` writes a theme that declares none, which the envelope
 *  cannot express as a present key. */
function themeOf(
  id: string,
  name: string,
  version: string | undefined,
): ThemeContent {
  const envelope: FabricThemeEnvelope = {
    schemaVersion: "2.0.0",
    fabricVersion: "7.4.0",
    id,
    artboard: { width: 1920, height: 1080 },
    metadata: {
      name,
      ...(version === undefined ? {} : { version }),
      themeLanguage: "en",
    },
    scene: { version: "7.4.0", objects: [] },
  };
  return { envelope, assets: {} };
}

/** The store's answer for an item it already holds. */
function baselineOf(
  version: string,
  envelope: FabricThemeEnvelope,
): StoreBaseline {
  return { version, createdAt: PUBLISHED_AT, envelope, status: "published" };
}

/** A client whose two calls submission makes answer what the test says. */
function fakeClient(
  baseline: StoreBaseline | undefined,
  plan: VersionPlan = {
    version: "1.0.0",
    status: "pending",
    uploadUrl: UPLOAD_URL,
  },
  seen?: { envelope?: FabricThemeEnvelope; name?: string },
): StoreClient {
  const unused = async () => {
    throw new Error("not used by submissionFiles");
  };
  return {
    baseline: async () => baseline,
    createVersion: async (
      _id: string,
      input: { readonly envelope: FabricThemeEnvelope; readonly name: string },
    ) => {
      if (seen !== undefined) {
        seen.envelope = input.envelope;
        seen.name = input.name;
      }
      return plan;
    },
    upload: unused,
    finalize: unused,
    unpublish: unused,
    publish: unused,
    mine: unused,
    favorite: unused,
  } as unknown as StoreClient;
}

/** A client whose baseline is the refusal the Worker would give. */
function refusingClient(error: StoreClientError): StoreClient {
  return {
    baseline: async () => {
      throw error;
    },
    createVersion: async () => {
      throw new Error("not reached");
    },
  } as unknown as StoreClient;
}

/** One scene object whose `left` is the only thing that moves. */
function sceneAt(left: number): FabricThemeEnvelope["scene"] {
  return { version: "7.4.0", objects: [{ id: "node", type: "rect", left }] };
}

/** The library theme, with a scene the stored copy can differ from. */
function themeWithScene(
  left: number,
  version: string | undefined,
): ThemeContent {
  const theme = themeOf(THEME_ID, "Aurora", version);
  return { ...theme, envelope: { ...theme.envelope, scene: sceneAt(left) } };
}

describe("submissionFiles", () => {
  let libraryDir: string;
  let store: ThemeStore;
  let thumbnails: ThumbnailStore;

  beforeEach(async () => {
    libraryDir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-item-"));
    store = createThemeStore(libraryDir);
    thumbnails = createThumbnailStore(libraryDir);
  });

  afterEach(async () => {
    await fs.rm(libraryDir, { recursive: true, force: true });
  });

  it("builds the package and the versioned envelope from one library theme", async () => {
    await store.write(THEME_ID, themeOf(THEME_ID, "Aurora", "1.2.0"), {
      expectFree: true,
    });
    await thumbnails.write(THEME_ID, PNG);

    const result = await submissionFiles(THEME_ID, store, {
      thumbnails,
      now: () => NOW,
      client: fakeClient(undefined),
    });
    if (!result.ok) throw new Error(result.message);

    const { files } = result;
    // The store holds nothing under this id, so the ladder mints 1.0.0 — the
    // document's own 1.2.0 never chooses a published version.
    expect(files).toMatchObject({
      version: "1.0.0",
      from: undefined,
      level: "initial",
      status: "pending",
      uploadUrl: UPLOAD_URL,
    });
    expect(files.envelope.metadata?.version).toBe("1.0.0");

    const read = readThemePackage(files.packageBytes);
    if (!read.ok) throw new Error(read.message);
    expect(read.envelope.id).toBe(THEME_ID);
    expect(read.envelope.metadata?.name).toBe("Aurora");
    expect(read.envelope.metadata?.version).toBe("1.0.0");
    expect(files.thumbnailBytes).toEqual(PNG);
    expect(read.thumbnail).toEqual(PNG);
  });

  it("sends the document's own name to the Worker", async () => {
    await store.write(THEME_ID, themeOf(THEME_ID, "Aurora", "1.0.0"), {
      expectFree: true,
    });
    await thumbnails.write(THEME_ID, PNG);
    const seen: { envelope?: FabricThemeEnvelope; name?: string } = {};

    await submissionFiles(THEME_ID, store, {
      thumbnails,
      now: () => NOW,
      client: fakeClient(undefined, undefined, seen),
    });

    expect(seen.name).toBe("Aurora");
    expect(seen.envelope?.metadata?.version).toBe("1.0.0");
  });

  it("keeps the document's remix credit in the package", async () => {
    const remix = {
      catalogueId: MISSING_ID,
      name: "System dashboard",
      version: "1.2.0",
    };
    const theme = themeOf(THEME_ID, "Aurora", "1.0.0");
    await store.write(
      THEME_ID,
      {
        envelope: {
          ...theme.envelope,
          metadata: { ...theme.envelope.metadata, remixOf: remix },
        },
        assets: {},
      },
      { expectFree: true },
    );
    await thumbnails.write(THEME_ID, PNG);

    const result = await submissionFiles(THEME_ID, store, {
      thumbnails,
      now: () => NOW,
      client: fakeClient(undefined),
    });
    if (!result.ok) throw new Error(result.message);

    const read = readThemePackage(result.files.packageBytes);
    if (!read.ok) throw new Error(read.message);
    expect(read.envelope.metadata?.remixOf).toEqual(remix);
  });

  it("lets a local metadata.version never choose the published version", async () => {
    await store.write(THEME_ID, themeOf(THEME_ID, "Aurora", "0.9.0"), {
      expectFree: true,
    });
    await thumbnails.write(THEME_ID, PNG);

    const result = await submissionFiles(THEME_ID, store, {
      thumbnails,
      now: () => NOW,
      client: fakeClient(undefined),
    });
    if (!result.ok) throw new Error(result.message);

    expect(result.files.version).toBe("1.0.0");
    expect(result.files.envelope.metadata?.version).toBe("1.0.0");
    // The first release is written back over the local guess.
    const stored = await store.read(THEME_ID);
    expect(stored?.envelope.metadata?.version).toBe("1.0.0");
  });

  it("bumps a changed theme to the next patch above the stored version", async () => {
    await store.write(THEME_ID, themeWithScene(10, undefined), {
      expectFree: true,
    });
    await thumbnails.write(THEME_ID, PNG);
    const baseline = baselineOf("1.4.0", themeWithScene(0, "1.4.0").envelope);

    const result = await submissionFiles(THEME_ID, store, {
      thumbnails,
      now: () => NOW,
      client: fakeClient(baseline, {
        version: "1.4.1",
        status: "published",
        uploadUrl: UPLOAD_URL,
      }),
    });
    if (!result.ok) throw new Error(result.message);

    expect(result.files.version).toBe("1.4.1");
    expect(result.files.from).toBe("1.4.0");
    expect(result.files.level).toBe("patch");
    expect(result.files.status).toBe("published");

    // The version is written to the library document before the package is
    // built, and the package is built from that written document.
    const stored = await store.read(THEME_ID);
    expect(stored?.envelope.metadata?.version).toBe("1.4.1");
    const read = readThemePackage(result.files.packageBytes);
    if (!read.ok) throw new Error(read.message);
    expect(read.envelope.metadata?.version).toBe("1.4.1");
  });

  it("refuses a theme that has not changed since the stored version", async () => {
    const unchanged = themeWithScene(10, "1.4.0");
    await store.write(THEME_ID, unchanged, { expectFree: true });
    await thumbnails.write(THEME_ID, PNG);
    const before = await store.read(THEME_ID);

    const result = await submissionFiles(THEME_ID, store, {
      thumbnails,
      now: () => NOW,
      client: fakeClient(baselineOf("1.4.0", unchanged.envelope)),
    });

    expect(result).toEqual({
      ok: false,
      message:
        "Version 1.4.0 is published and this theme has not changed since it.",
    });
    // Nothing was written: the stored document is byte-for-byte the one read.
    expect((await store.read(THEME_ID))?.base).toBe(before?.base);
  });

  it("throws the Worker's refusal rather than claiming the theme is bad", async () => {
    await store.write(THEME_ID, themeOf(THEME_ID, "Aurora", undefined), {
      expectFree: true,
    });
    await thumbnails.write(THEME_ID, PNG);
    const before = await store.read(THEME_ID);

    await expect(
      submissionFiles(THEME_ID, store, {
        thumbnails,
        client: refusingClient(new StoreClientError("Unauthorized", 401)),
      }),
    ).rejects.toThrow("Unauthorized");
    expect((await store.read(THEME_ID))?.base).toBe(before?.base);
  });

  it("refuses a stored version the ladder cannot bump", async () => {
    await store.write(THEME_ID, themeWithScene(10, undefined), {
      expectFree: true,
    });
    await thumbnails.write(THEME_ID, PNG);
    // Version-shaped, but past the safe-integer range `bumpVersion` refuses.
    const unsafe = "9007199254740993.0.0";

    const result = await submissionFiles(THEME_ID, store, {
      thumbnails,
      client: fakeClient(
        baselineOf(unsafe, themeWithScene(0, undefined).envelope),
      ),
    });

    expect(result).toEqual({
      ok: false,
      message: `The store's copy of this theme records version "${unsafe}", which cannot be bumped.`,
    });
  });

  it("refuses a write that raced a save, keeping the save's version", async () => {
    const real = store;
    let saved = false;
    const racing: ThemeStore = {
      ...real,
      async write(id, content, options) {
        // Another save lands between the submission's read and its write.
        if (!saved && options?.base !== undefined) {
          saved = true;
          const current = await real.read(id);
          if (current !== undefined) {
            await real.write(
              id,
              {
                envelope: {
                  ...current.envelope,
                  metadata: { ...current.envelope.metadata, version: "9.9.9" },
                },
                assets: current.assets,
              },
              { overwrite: true },
            );
          }
        }
        return real.write(id, content, options);
      },
    };
    await store.write(THEME_ID, themeWithScene(10, undefined), {
      expectFree: true,
    });
    await thumbnails.write(THEME_ID, PNG);

    const result = await submissionFiles(THEME_ID, racing, {
      thumbnails,
      now: () => NOW,
      client: fakeClient(
        baselineOf("1.4.0", themeWithScene(0, "1.4.0").envelope),
      ),
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toContain(
      "changed by someone else",
    );
    // The racing save is the stored document; the submission did not replace it.
    expect((await store.read(THEME_ID))?.envelope.metadata?.version).toBe(
      "9.9.9",
    );
  });

  it("publishes a theme that declares no version as its first release", async () => {
    await store.write(THEME_ID, themeOf(THEME_ID, "Quiet", undefined), {
      expectFree: true,
    });
    await thumbnails.write(THEME_ID, PNG);

    const result = await submissionFiles(THEME_ID, store, {
      thumbnails,
      client: fakeClient(undefined),
    });
    if (!result.ok) throw new Error(result.message);

    expect(result.files.envelope.metadata?.version).toBe("1.0.0");
  });

  it("refuses a video past the duration cap before a submission is built", async () => {
    // The committed 31.5 s fixture, read rather than regenerated.
    const long = new Uint8Array(
      readFileSync(
        new URL(
          "../../../theme-package/test-fixtures/long.mp4",
          import.meta.url,
        ),
      ),
    );
    const content = themeOf(THEME_ID, "Aurora", "1.2.0");
    await store.write(
      THEME_ID,
      {
        envelope: {
          ...content.envelope,
          assets: [{ id: "clip", kind: "video", path: "assets/clip.mp4" }],
        },
        assets: { "assets/clip.mp4": long },
      },
      { expectFree: true },
    );
    await thumbnails.write(THEME_ID, PNG);

    const result = await submissionFiles(THEME_ID, store, {
      thumbnails,
      client: fakeClient(undefined),
    });

    expect(result).toEqual({
      ok: false,
      message:
        "assets/clip.mp4: duration 31500 ms exceeds the 30000 ms maximum",
    });
  });

  it("refuses a theme with no picture, naming what to do", async () => {
    await store.write(THEME_ID, themeOf(THEME_ID, "Quiet", "1.0.0"), {
      expectFree: true,
    });

    const result = await submissionFiles(THEME_ID, store, {
      thumbnails,
      client: fakeClient(undefined),
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toBe(
      "This theme has no picture yet; set one before submitting.",
    );
  });

  it("refuses an id the store would never hold", async () => {
    const result = await submissionFiles("../aurora", store, {
      thumbnails,
      client: fakeClient(undefined),
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toContain("../aurora");
    expect(result.ok ? "" : result.message).toContain("not a theme id");
  });

  it("refuses a package over the reader's cap before uploading it", async () => {
    // Incompressible, so the zip's own size stays over the cap: the check is on
    // the bytes that would be committed, not on the assets' declared sizes.
    const big = new Uint8Array(MAX_ARCHIVE_BYTES + 1024);
    randomFillSync(big);
    const envelope: FabricThemeEnvelope = {
      ...themeOf(THEME_ID, "Big", "1.0.0").envelope,
      assets: [{ id: "big", kind: "image", path: "assets/big.png" }],
    };
    const oversized = {
      read: async () => ({ envelope, assets: { "assets/big.png": big } }),
      // The version write itself succeeds; the package is what is measured.
      write: async () => ({ ok: true }),
    } as unknown as ThemeStore;
    const picture = { read: async () => PNG } as unknown as ThumbnailStore;

    const result = await submissionFiles(THEME_ID, oversized, {
      thumbnails: picture,
      now: () => NOW,
      client: fakeClient(undefined),
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toContain(
      "That package is too large to open",
    );
    expect(result.ok ? "" : result.message).toContain(
      String(MAX_ARCHIVE_BYTES),
    );
  }, 30_000);

  it("does not put a store failure's path in the refusal", async () => {
    const failing = {
      read: async () => {
        throw new Error(`EPERM: D:\\Users\\peter\\library\\${THEME_ID}.json`);
      },
    } as unknown as ThemeStore;

    const result = await submissionFiles(THEME_ID, failing, {
      thumbnails,
      client: fakeClient(undefined),
    });

    expect(result.ok ? "" : result.message).toBe(
      `This PC's library could not read theme "${THEME_ID}".`,
    );
  });

  it("refuses an id the library does not hold", async () => {
    const result = await submissionFiles(MISSING_ID, store, {
      thumbnails,
      client: fakeClient(undefined),
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toContain(MISSING_ID);
    expect(result.ok ? "" : result.message).toContain("holds no theme");
  });
});
