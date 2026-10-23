import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  cataloguePackageUrl,
  DASHBOARD_THEME_KIND,
  type FabricThemeEnvelope,
} from "@yunari/renderer-core";
import { writeThemePackage } from "@yunari/theme-package";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createThemeOriginsStore,
  type ThemeOriginsStore,
} from "../settings/theme-origins.js";
import {
  INSTALL_REFUSALS,
  type InstallRequest,
  installCatalogueItem,
} from "./install.js";
import {
  createThemeStore,
  type ThemeContent,
  type ThemeStore,
} from "./store.js";

const PACKAGE_URL = cataloguePackageUrl("aurora", "1.2.0");

function themeOf(id: string, name: string): ThemeContent {
  const envelope: FabricThemeEnvelope = {
    schemaVersion: 2,
    fabricVersion: "7.4.0",
    id,
    artboard: { width: 1920, height: 1080 },
    metadata: { name, themeLanguage: "en" },
    scene: { version: "7.4.0", objects: [] },
  };
  return { envelope, assets: {} };
}

function packageOf(id: string, name: string): Uint8Array {
  const written = writeThemePackage(themeOf(id, name));
  if (!written.ok) throw new Error(written.message);
  return written.bytes;
}

/** The committed 31.5 s fixture, read rather than regenerated. */
const LONG_VIDEO = new Uint8Array(
  readFileSync(
    new URL("../../../theme-package/test-fixtures/long.mp4", import.meta.url),
  ),
);

const DURATION_REFUSAL =
  "assets/clip.mp4: duration 31500 ms exceeds the 30000 ms maximum";

/** A package declaring one video asset, carrying the over-cap fixture. */
function packageWithLongVideo(id: string, name: string): Uint8Array {
  const written = writeThemePackage({
    envelope: {
      ...themeOf(id, name).envelope,
      assets: [{ id: "clip", kind: "video", path: "assets/clip.mp4" }],
    },
    assets: { "assets/clip.mp4": LONG_VIDEO },
  });
  if (!written.ok) throw new Error(written.message);
  return written.bytes;
}

/** An injected fetcher that records every URL it was asked for, so a case can
 *  prove the kind gate refused before the network. */
function recorded(answer: () => Response): {
  readonly fetch: typeof fetch;
  readonly seen: string[];
} {
  const seen: string[] = [];
  const fetcher: typeof globalThis.fetch = async (input) => {
    seen.push(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    return answer();
  };
  return { fetch: fetcher, seen };
}

function serving(bytes: Uint8Array): typeof fetch {
  // `new Uint8Array(bytes)` is ArrayBuffer-backed, which is what `Response`
  // accepts; the writer's return type is the wider `ArrayBufferLike`.
  return async () => new Response(new Uint8Array(bytes));
}

const REQUEST: InstallRequest = {
  packageUrl: PACKAGE_URL,
  catalogueId: "aurora",
  version: "1.2.0",
  kind: DASHBOARD_THEME_KIND,
};

describe("installCatalogueItem", () => {
  let libraryDir: string;
  let originsDir: string;
  let store: ThemeStore;
  let origins: ThemeOriginsStore;

  beforeEach(async () => {
    libraryDir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-install-"));
    originsDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "yunari-install-origins-"),
    );
    // A real trash needs `powershell.exe`, Finder or `gio`, so a runner has
    // none of them. These cases measure the install refusals, not the trash
    // route; `trash.test.ts` owns that.
    store = createThemeStore(libraryDir, {
      trash: async (folder) => {
        await fs.rm(folder, { recursive: true, force: true });
      },
    });
    origins = createThemeOriginsStore(originsDir);
  });

  afterEach(async () => {
    await fs.rm(libraryDir, { recursive: true, force: true });
    await fs.rm(originsDir, { recursive: true, force: true });
  });

  it("installs an item and records its origin", async () => {
    const startedAt = Date.now();

    const result = await installCatalogueItem(REQUEST, {
      store,
      origins,
      fetch: serving(packageOf("living-room", "Living Room")),
    });

    expect(result).toEqual({ ok: true, id: "living-room" });

    const all = await origins.read();
    // Keyed by the library id, not the catalogue id — the two are deliberately
    // different here, so a write that swapped them fails.
    expect(Object.keys(all)).toEqual(["living-room"]);
    const origin = all["living-room"];
    expect(origin?.catalogueId).toBe("aurora");
    expect(origin?.version).toBe("1.2.0");
    const installedAt = Date.parse(origin?.installedAt ?? "");
    expect(Number.isNaN(installedAt)).toBe(false);
    expect(installedAt).toBeGreaterThanOrEqual(startedAt);
  });

  it("records no origin when the write was refused", async () => {
    const result = await installCatalogueItem(REQUEST, {
      store,
      origins,
      fetch: serving(new Uint8Array([1, 2, 3])),
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toContain(
      "not a readable theme package",
    );
    expect(await origins.read()).toEqual({});
    expect(await store.list()).toEqual([]);
  });

  it("refuses a package carrying a video past the duration cap, writing nothing", async () => {
    // The item's existing copy, so the update path is the one a missing check
    // would overwrite.
    await store.write("aurora-copy", themeOf("aurora-copy", "Old Aurora"), {
      expectFree: true,
    });
    await origins.write("aurora-copy", {
      catalogueId: "aurora",
      version: "1.0.0",
      installedAt: new Date(0).toISOString(),
    });
    const listedBefore = await store.list();
    const result = await installCatalogueItem(REQUEST, {
      store,
      origins,
      fetch: serving(packageWithLongVideo("living-room", "Living Room 2")),
    });

    expect(result).toEqual({
      ok: false,
      stage: "package",
      message: DURATION_REFUSAL,
    });
    // The refusal lands before any write: copy and origin are untouched.
    expect(await store.list()).toEqual(listedBefore);
    expect((await store.read("aurora-copy"))?.envelope.metadata?.name).toBe(
      "Old Aurora",
    );
    expect((await origins.read())["aurora-copy"]?.version).toBe("1.0.0");
  });

  it("refuses a kind this build does not run", async () => {
    const { fetch, seen } = recorded(() => new Response("no"));

    const result = await installCatalogueItem(
      { ...REQUEST, kind: "widget-preset" },
      { store, origins, fetch },
    );

    expect(result.ok).toBe(false);
    // The identifier, never a display word.
    expect(result.ok ? "" : result.message).toContain("widget-preset");
    // Refused before anything was fetched or written.
    expect(seen).toEqual([]);
    expect(await origins.read()).toEqual({});
  });

  it("removes a fresh import when its origin could not be written", async () => {
    const refusing: ThemeOriginsStore = {
      ...origins,
      write: async () => {
        throw new Error("the settings directory is read-only");
      },
    };

    const result = await installCatalogueItem(REQUEST, {
      store,
      origins: refusing,
      fetch: serving(packageOf("living-room", "Living Room")),
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.stage).toBe("store");
    // The sentence says what happened here, not what happened to a kept copy.
    expect(result.ok ? "" : result.message).toBe(INSTALL_REFUSALS.rolledBack);
    // The write is undone, so the next press replaces nothing and mints no
    // `living-room-2` beside a copy the catalogue could not see.
    expect(await store.list()).toEqual([]);
    expect(await origins.read()).toEqual({});
  });

  it("says the copy is left behind when the rollback itself fails", async () => {
    const refusing: ThemeOriginsStore = {
      ...origins,
      write: async () => {
        throw new Error("the settings directory is read-only");
      },
    };
    const stuck: ThemeStore = {
      ...store,
      remove: async () => {
        throw new Error("the library is read-only");
      },
    };

    const result = await installCatalogueItem(REQUEST, {
      store: stuck,
      origins: refusing,
      fetch: serving(packageOf("living-room", "Living Room")),
    });

    expect(result.ok ? "" : result.message).toBe(
      INSTALL_REFUSALS.rolledBackFailed,
    );
    // The sentence warns about a theme that is really there, so the listing is
    // what a person sees when they go to delete it.
    expect((await store.list()).map((entry) => entry.id)).toEqual([
      "living-room",
    ]);
  });

  it("keeps the person's copy when an update's origin could not be written", async () => {
    await store.write("aurora-copy", themeOf("aurora-copy", "Old Aurora"), {
      expectFree: true,
    });
    await origins.write("aurora-copy", {
      catalogueId: "aurora",
      version: "1.0.0",
      installedAt: new Date(0).toISOString(),
    });
    const refusing: ThemeOriginsStore = {
      ...origins,
      write: async () => {
        throw new Error("the settings directory is read-only");
      },
    };

    const result = await installCatalogueItem(REQUEST, {
      store,
      origins: refusing,
      fetch: serving(packageOf("living-room", "Living Room 2")),
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.stage).toBe("store");
    expect(result.ok ? "" : result.message).toBe(INSTALL_REFUSALS.updateKept);
    // The previous copy is still the person's, so it stays; only its origin did
    // not move, and the next press is still an update of this copy.
    expect((await store.list()).map((entry) => entry.id)).toEqual([
      "aurora-copy",
    ]);
    expect((await origins.read())["aurora-copy"]?.version).toBe("1.0.0");
  });

  it("stamps the library id into the document", async () => {
    await store.write("living-room", themeOf("living-room", "Mine"), {
      expectFree: true,
    });

    const result = await installCatalogueItem(REQUEST, {
      store,
      origins,
      fetch: serving(packageOf("living-room", "Living Room")),
    });

    expect(result).toEqual({ ok: true, id: "living-room-2" });
    expect((await store.read("living-room-2"))?.envelope.id).toBe(
      "living-room-2",
    );
    expect(Object.keys(await origins.read())).toEqual(["living-room-2"]);
  });

  it("forwards an address no catalogue can produce as the caller's refusal", async () => {
    const { fetch } = recorded(() => new Response("no"));

    const result = await installCatalogueItem(
      { ...REQUEST, packageUrl: "http://github.com/x/y.zip" },
      { store, origins, fetch },
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.stage).toBe("address");
    expect(await origins.read()).toEqual({});
  });

  it("records no origin when the download was refused", async () => {
    const { fetch } = recorded(() => new Response("no", { status: 404 }));

    const result = await installCatalogueItem(REQUEST, {
      store,
      origins,
      fetch,
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.stage).toBe("download");
    expect(await origins.read()).toEqual({});
    expect(await store.list()).toEqual([]);
  });

  it("replaces the copy the origin names", async () => {
    // The library id is deliberately not the package's own id, so a write that
    // followed the package rather than the origin would land somewhere else.
    await store.write("aurora-copy", themeOf("aurora-copy", "Old Aurora"), {
      expectFree: true,
    });
    await origins.write("aurora-copy", {
      catalogueId: "aurora",
      version: "1.0.0",
      installedAt: new Date(0).toISOString(),
    });

    const result = await installCatalogueItem(REQUEST, {
      store,
      origins,
      fetch: serving(packageOf("living-room", "Living Room 2")),
    });

    expect(result).toEqual({ ok: true, id: "aurora-copy" });
    expect((await store.list()).map((entry) => entry.id)).toEqual([
      "aurora-copy",
    ]);
    const stored = await store.read("aurora-copy");
    expect(stored?.envelope.metadata?.name).toBe("Living Room 2");
    expect(stored?.envelope.id).toBe("aurora-copy");
  });

  it("bumps the origin's version", async () => {
    await installCatalogueItem(
      { ...REQUEST, version: "1.2.0" },
      {
        store,
        origins,
        fetch: serving(packageOf("living-room", "Living Room")),
      },
    );
    const before = (await origins.read())["living-room"];

    // Distinct instants, so a second write of the first one is caught.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await installCatalogueItem(
      { ...REQUEST, version: "1.3.0" },
      {
        store,
        origins,
        fetch: serving(packageOf("living-room", "Living Room")),
      },
    );

    const all = await origins.read();
    expect(Object.keys(all)).toEqual(["living-room"]);
    const after = all["living-room"];
    expect(after?.version).toBe("1.3.0");
    expect(Date.parse(after?.installedAt ?? "")).toBeGreaterThan(
      Date.parse(before?.installedAt ?? ""),
    );
  });

  it("still never overwrites a theme the catalogue did not install", async () => {
    await store.write("living-room", themeOf("living-room", "Living Room"), {
      expectFree: true,
    });

    const result = await installCatalogueItem(REQUEST, {
      store,
      origins,
      fetch: serving(packageOf("living-room", "Living Room")),
    });

    expect(result).toEqual({ ok: true, id: "living-room-2" });
    expect((await store.list()).map((entry) => entry.id)).toEqual([
      "living-room",
      "living-room-2",
    ]);
  });

  it("does not replace a theme a stale origin names but the library no longer holds", async () => {
    await origins.write("aurora-old", {
      catalogueId: "aurora",
      version: "1.0.0",
      installedAt: new Date(0).toISOString(),
    });

    const result = await installCatalogueItem(REQUEST, {
      store,
      origins,
      fetch: serving(packageOf("living-room", "Living Room")),
    });

    // The import path's id, not the deleted copy's: an origin alone is not
    // proof a theme is there to replace.
    expect(result).toEqual({ ok: true, id: "living-room" });
    expect((await store.list()).map((entry) => entry.id)).toEqual([
      "living-room",
    ]);
    // The dead key goes with it, so one item never has two origin entries.
    expect(Object.keys(await origins.read())).toEqual(["living-room"]);
  });

  it("repairs an origin naming a theme the library cannot read", async () => {
    const folder = path.join(libraryDir, "aurora-copy");
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, "theme.json"), "{ not json");
    await origins.write("aurora-copy", {
      catalogueId: "aurora",
      version: "1.0.0",
      installedAt: new Date(0).toISOString(),
    });

    const result = await installCatalogueItem(REQUEST, {
      store,
      origins,
      fetch: serving(packageOf("living-room", "Living Room")),
    });

    // Repaired under the origin's id, not minted beside it: the broken folder
    // was still this item's copy.
    expect(result).toEqual({ ok: true, id: "aurora-copy" });
    expect((await store.list()).map((entry) => entry.id)).toEqual([
      "aurora-copy",
    ]);
    expect((await store.read("aurora-copy"))?.envelope.id).toBe("aurora-copy");
    expect(Object.keys(await origins.read())).toEqual(["aurora-copy"]);
  });

  it("serialises two installs of one item", async () => {
    const [first, second] = await Promise.all([
      installCatalogueItem(
        { ...REQUEST, version: "1.2.0" },
        {
          store,
          origins,
          fetch: serving(packageOf("living-room", "Living Room")),
        },
      ),
      installCatalogueItem(
        { ...REQUEST, version: "1.3.0" },
        {
          store,
          origins,
          fetch: serving(packageOf("living-room", "Living Room 2")),
        },
      ),
    ]);

    // Both succeed: the second waits for the first rather than racing its
    // staging rename. Invocation order is the queue's order.
    expect(first).toEqual({ ok: true, id: "living-room" });
    expect(second).toEqual({ ok: true, id: "living-room" });
    expect((await store.list()).map((entry) => entry.id)).toEqual([
      "living-room",
    ]);
    expect((await origins.read())["living-room"]?.version).toBe("1.3.0");
    expect((await store.read("living-room"))?.envelope.metadata?.name).toBe(
      "Living Room 2",
    );
  });
});
