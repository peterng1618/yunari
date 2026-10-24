import { type ChildProcess, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { writeThemePackage } from "@yunari/theme-package";
import { canvasProp } from "./canvas-probe.js";
import { isDesktopSurface } from "./surface.js";

/**
 * A game with no Steam manifest, named and covered by a store fixture.
 *
 * **The whole real path is the proof.** Nothing is stubbed into the page: the
 * fixture store answers `storesearch`, `appdetails` and the portrait bytes, the
 * real host matches the executable's stem and caches the answer, and the real
 * player paints the canonical name and the cover. The page never talks to Valve
 * — every request it makes is same-origin — and the host asks the fixture for
 * the name exactly once.
 *
 * Two offline arms, each proving only what it can observe, ordered so neither
 * inherits the other's state. Arm 2 comes first, before any cache is cleared:
 * the fixture is switched to answering 500 while still recording, and both the
 * name and the cover must render from cache with zero new requests. Arm 1 is
 * last: the fixture stops and the cover cache is cleared, so the host still
 * holds the match in memory and the canonical name stays while only the cover
 * is gone — this proves the missing-cover fallback, not a cold failed lookup.
 *
 * Its own host on its own port, over an app folder minted under the OS temp
 * directory, so no other spec's store, cache or port is shared.
 */

/** The host's port. 4241/4243 belong to `host-player`; `game-artwork` owns 4239. */
const PORT = 4245;
/** The fixture store's port, distinct from every Playwright host port. */
const FIXTURE_PORT = 4293;

const HOST = `http://127.0.0.1:${PORT}`;
const FIXTURE = `http://127.0.0.1:${FIXTURE_PORT}`;
const THEME_ID = "e2e-game-metadata";
const IMAGE_NODE_ID = "game-artwork";
const TEXT_NODE_ID = "game-name";
const APP_ID = 1201270;
/** The executable's stem is what the host searches for. */
const GAME_NAME = "Example Game";
/** The store's canonical title, which the local name does not spell out. */
const CANONICAL_NAME = "Example Game: Definitive Edition";
const AUTHORED_URL = `/api/themes/${THEME_ID}/assets/authored.svg`;
const LIVE_URL = `/api/game/artwork/${APP_ID}.jpg`;

/** The authored bytes: the picture a display shows until a reading arrives. */
const AUTHORED = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <rect width="200" height="200" fill="#e8ecf3" />
</svg>
`;
/** The fixture store's portrait: a real 1x1 JPEG the browser decodes. */
const COVER = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==",
  "base64",
);

const envelope = {
  schemaVersion: "2.0.0" as const,
  fabricVersion: "7.4.0",
  id: THEME_ID,
  metadata: { name: "E2E game metadata", themeLanguage: "en" },
  artboard: { width: 640, height: 360, contentFit: "contain" as const },
  background: { color: { ref: "palette.bar" as const } },
  globals: {
    palette: {
      none: {
        name: "None",
        value: { kind: "solid" as const, color: "transparent" },
      },
      bar: { name: "Bar", value: { kind: "solid" as const, color: "#101318" } },
      ink: { name: "Ink", value: { kind: "solid" as const, color: "#e8ecf3" } },
    },
    typePresets: {
      "20-400": {
        name: "Value",
        value: {
          family: "system-ui, sans-serif",
          size: 20,
          weight: "400",
        },
      },
    },
  },
  assets: [
    {
      id: "authored",
      kind: "svg" as const,
      path: "assets/authored.svg",
      license: { name: "MIT", attribution: "Yunari test fixture." },
    },
  ],
  scene: {
    version: "7.4.0" as const,
    objects: [
      {
        type: "Image" as const,
        version: "7.4.0" as const,
        originX: "left" as const,
        originY: "top" as const,
        left: 40,
        top: 80,
        width: 200,
        height: 200,
        id: IMAGE_NODE_ID,
        yunariAsset: { assetId: "authored", kind: "svg" as const },
      },
      {
        type: "Textbox" as const,
        version: "7.4.0" as const,
        originX: "left" as const,
        originY: "top" as const,
        left: 300,
        top: 80,
        width: 300,
        height: 48,
        text: "--",
        fontSize: 20,
        fontFamily: "system-ui, sans-serif",
        fill: "palette.ink",
        id: TEXT_NODE_ID,
        selectable: false,
        evented: false,
        yunariPaint: { fill: "palette.ink" as const },
        yunariText: {
          runs: [
            {
              kind: "value" as const,
              bindingId: `bound-${TEXT_NODE_ID}`,
              typePreset: "typePresets.20-400",
              style: { color: { ref: "palette.ink" as const } },
            },
          ],
        },
      },
    ],
  },
  bindings: {
    [IMAGE_NODE_ID]: [{ id: "image", semanticKey: "game.artwork" }],
    [TEXT_NODE_ID]: [{ id: `bound-${TEXT_NODE_ID}`, semanticKey: "game.name" }],
  },
};

let appDir = "";
let executable = "";
let cacheDir = "";
const THEMES_DIR = (): string => path.join(appDir, "themes");
const coverFile = (): string => path.join(cacheDir, `${APP_ID}.jpg`);

/** Every URL the fixture store was asked for, in arrival order. */
const fixtureRequests: URL[] = [];
let fixture: Server | undefined;

function seedLibrary(): void {
  const assets = { "assets/authored.svg": new TextEncoder().encode(AUTHORED) };
  const result = writeThemePackage({ envelope, assets });
  if (!result.ok) {
    throw new Error(`game metadata fixture is invalid: ${result.message}`);
  }

  const folder = path.join(THEMES_DIR(), THEME_ID);
  mkdirSync(path.join(folder, "assets"), { recursive: true });
  writeFileSync(path.join(folder, "theme.json"), JSON.stringify(envelope));
  for (const [assetPath, bytes] of Object.entries(assets)) {
    writeFileSync(path.join(folder, ...assetPath.split("/")), bytes);
  }
}

/**
 * A store that plays the two endpoints and the portrait the host asks for.
 * `fail` makes every endpoint answer 500 while still recording the request,
 * so arm 2 can observe that the host made none.
 */
async function startFixture(fail = false): Promise<Server> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", FIXTURE);
    fixtureRequests.push(url);

    if (fail) {
      response.writeHead(500);
      response.end();
      return;
    }

    if (url.pathname === "/api/storesearch/") {
      const body = {
        total: 1,
        items: [{ type: "app", id: APP_ID, name: GAME_NAME }],
      };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
      return;
    }

    if (url.pathname === "/api/appdetails") {
      const body = {
        [String(APP_ID)]: {
          success: true,
          data: {
            name: CANONICAL_NAME,
            header_image: `${FIXTURE}/header.jpg`,
          },
        },
      };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
      return;
    }

    if (url.pathname === `/steam/apps/${APP_ID}/library_600x900.jpg`) {
      response.writeHead(200, {
        "content-type": "image/jpeg",
        "content-length": COVER.byteLength,
      });
      response.end(COVER);
      return;
    }

    response.writeHead(404);
    response.end();
  });

  await new Promise<void>((resolve) => {
    server.listen(FIXTURE_PORT, "127.0.0.1", resolve);
  });
  return server;
}

/** Stop answering, and drop the keep-alive sockets a host fetch left open. */
async function stopFixture(): Promise<void> {
  const server = fixture;
  fixture = undefined;
  if (server === undefined) return;

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

async function startHost(): Promise<ChildProcess> {
  const child = spawn(
    "node",
    [
      "packages/host/bin/yunari.js",
      "--no-browser",
      "--port",
      String(PORT),
      "--app-dir",
      appDir,
    ],
    {
      cwd: process.cwd(),
      stdio: "ignore",
      env: {
        ...process.env,
        YUNARI_STEAM_STORE: FIXTURE,
        YUNARI_FOREGROUND_EXE: executable,
        // An empty library: the fixture game is outside Steam on purpose.
        YUNARI_STEAM_ROOT: path.join(appDir, "steam-empty"),
      },
    },
  );

  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(`${HOST}/api/health`)).ok) return child;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  child.kill();
  throw new Error(`the game-metadata host never answered on ${PORT}`);
}

/** The mounted image object's own reading of its element. */
async function imageState(
  page: Page,
): Promise<{ readonly src: string; readonly width: number } | undefined> {
  return page.evaluate((id) => {
    type Obj = {
      get(key: string): unknown;
      getObjects?(): readonly Obj[];
    };
    const handle = (
      window as unknown as {
        yunari?: { handle: { canvas: { getObjects(): readonly Obj[] } } };
      }
    ).yunari?.handle;
    const find = (objects: readonly Obj[]): Obj | undefined => {
      for (const candidate of objects) {
        if (candidate.get("id") === id) return candidate;
        const found = find(candidate.getObjects?.() ?? []);
        if (found !== undefined) return found;
      }
      return undefined;
    };
    const object =
      handle === undefined ? undefined : find(handle.canvas.getObjects());
    if (object === undefined) return undefined;
    const image = object as unknown as {
      getSrc(): string;
      getElement(): { naturalWidth?: number } | undefined;
    };
    return {
      src: image.getSrc(),
      // Natural pixels, not the authored box: a picture that did not decode
      // would still report the authored width.
      width: image.getElement()?.naturalWidth ?? 0,
    };
  }, IMAGE_NODE_ID);
}

async function openDisplay(page: Page): Promise<void> {
  await page.goto(`${HOST}/?theme=${THEME_ID}`);
  await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();
}

test.describe.configure({ timeout: 120_000 });

test.describe("a non-Steam game's name and cover from the store", () => {
  let host: ChildProcess | undefined;

  test.beforeAll(async ({}, testInfo) => {
    if (!isDesktopSurface(testInfo)) return;

    appDir = mkdtempSync(path.join(tmpdir(), "yunari-game-metadata-"));
    cacheDir = path.join(appDir, "cache", "game-metadata");
    mkdirSync(THEMES_DIR(), { recursive: true });
    mkdirSync(path.join(appDir, "steam-empty"), { recursive: true });
    // An empty file: only its stem participates in the name.
    executable = path.join(appDir, `${GAME_NAME}.exe`);
    writeFileSync(executable, "");

    seedLibrary();
    fixture = await startFixture();
    host = await startHost();
  });

  test.afterAll(async () => {
    const child = host;
    if (child !== undefined && child.exitCode === null) {
      await new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        child.kill();
      });
    }
    await stopFixture();
    if (appDir !== "") rmSync(appDir, { recursive: true, force: true });
  });

  test("paints the store's name and cover, then falls back honestly offline", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the display is read on a desktop");

    const pageOrigins = new Set<string>();
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.protocol === "http:" || url.protocol === "https:") {
        pageOrigins.add(url.origin);
      }
    });

    await openDisplay(page);

    // The store's canonical title, not the executable's stem.
    await expect
      .poll(() => canvasProp(page, TEXT_NODE_ID, "text"), {
        timeout: 25_000,
        message: "the display never painted the store's canonical name",
      })
      .toBe(CANONICAL_NAME);
    await expect
      .poll(async () => (await imageState(page))?.width, {
        timeout: 25_000,
        message: "the display never decoded the store's cover",
      })
      .toBe(1);
    expect((await imageState(page))?.src).toContain(LIVE_URL);

    // The page reads the host and nothing else: no display talks to Valve.
    expect([...pageOrigins]).toEqual([HOST]);
    expect(
      [...pageOrigins].some(
        (origin) =>
          origin.includes("steampowered.com") ||
          origin.includes("steamstatic.com"),
      ),
    ).toBe(false);

    // The name was resolved once, for the stem, and cached.
    const searches = fixtureRequests.filter(
      (url) => url.pathname === "/api/storesearch/",
    );
    expect(searches, "the host searched the store more than once").toHaveLength(
      1,
    );
    // Exactly the name and the two fixed constants: a new parameter would be a
    // privacy change and must fail here.
    expect(Object.fromEntries(searches[0]?.searchParams ?? [])).toEqual({
      term: GAME_NAME,
      cc: "us",
      l: "en",
    });

    await expect
      .poll(() => existsSync(coverFile()), { timeout: 20_000 })
      .toBe(true);

    // Arm 2 — cache-first under an outage, before any cache is cleared. The
    // fixture listens again but answers 500, so any request the host makes is
    // recorded. The name and the cover must both come from cache with the
    // request count unchanged.
    await stopFixture();
    fixture = await startFixture(true);
    const requestsBefore = fixtureRequests.length;

    await page.reload();
    await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();
    await expect
      .poll(() => canvasProp(page, TEXT_NODE_ID, "text"), {
        timeout: 25_000,
        message: "the cached match did not survive the reload",
      })
      .toBe(CANONICAL_NAME);
    await expect
      .poll(async () => (await imageState(page))?.width, {
        timeout: 25_000,
        message: "the cached cover did not render offline",
      })
      .toBe(1);
    expect((await imageState(page))?.src).toContain(LIVE_URL);
    expect(fixtureRequests.length).toBe(requestsBefore);

    // Arm 1 — the missing-cover fallback, last. The host still holds the match
    // in memory, so the canonical name stays; with the cover cache cleared,
    // only the cover is gone. This is not a cold failed lookup.
    await stopFixture();
    rmSync(cacheDir, { recursive: true, force: true });
    await page.reload();
    await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();

    await expect
      .poll(() => canvasProp(page, TEXT_NODE_ID, "text"), {
        timeout: 25_000,
        message: "the in-memory match did not survive the reload",
      })
      .toBe(CANONICAL_NAME);

    await expect
      .poll(async () => (await imageState(page))?.width, {
        timeout: 25_000,
        message: "the authored picture did not come back",
      })
      .toBe(200);
    expect((await imageState(page))?.src).toContain(AUTHORED_URL);
    await expect(page.locator("#yunari-availability")).toContainText(
      "Game artwork is not available yet.",
      { timeout: 20_000 },
    );
  });
});
