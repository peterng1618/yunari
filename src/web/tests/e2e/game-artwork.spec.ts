import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { writeThemePackage } from "@yunari/theme-package";
import { isDesktopSurface } from "./surface.js";

/**
 * The running game's box art, on the real host and the real player.
 *
 * The host is given a fake Steam root whose cache holds Steam's 600x900 art for
 * one installed app. The page's stream is stubbed — the route itself is tested
 * against the host separately — so this proves the transport-to-render path:
 * `game.artwork` binds to an image object, the host-relative URL decodes, and
 * an `unavailable` reading puts the authored picture back.
 *
 * Its own host on its own port, over a theme folder minted under the OS temp
 * directory, so no other spec's store or port is shared.
 */

/** A port no other spec or runner owns. */
const PORT = 4239;
/** Minted per run in `beforeAll`, outside the repository. */
let appDir = "";
let steamRoot = "";
const THEMES_DIR = (): string => path.join(appDir, "themes");
const HOST = `http://127.0.0.1:${PORT}`;
const THEME_ID = "e2e-game-artwork";
const NODE_ID = "game-artwork";
const APP_ID = "480";

/** The authored bytes: the picture a display shows until a reading arrives. */
const AUTHORED = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <rect width="200" height="200" fill="#e8ecf3" />
</svg>
`;
/** Steam's cached box art stand-in: a real 1x1 JPEG the browser decodes. */
const BOX_ART = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==",
  "base64",
);
const AUTHORED_URL = `/api/themes/${THEME_ID}/assets/authored.svg`;
const LIVE_URL = `/api/game/artwork/${APP_ID}.jpg`;

const envelope = {
  schemaVersion: 2 as const,
  fabricVersion: "7.4.0",
  id: THEME_ID,
  metadata: { name: "E2E game artwork", themeLanguage: "en" },
  artboard: {
    width: 640,
    height: 360,
    contentFit: "contain" as const,
  },
  background: { color: { ref: "palette.bar" as const } },
  globals: {
    palette: {
      none: {
        name: "None",
        value: { kind: "solid" as const, color: "transparent" },
      },
      bar: { name: "Bar", value: { kind: "solid" as const, color: "#101318" } },
    },
    typePresets: {},
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
        id: NODE_ID,
        yunariAsset: { assetId: "authored", kind: "svg" as const },
      },
    ],
  },
  bindings: {
    [NODE_ID]: [{ id: "image", semanticKey: "game.artwork" }],
  },
};

function seedLibrary(): void {
  const assets = {
    "assets/authored.svg": new TextEncoder().encode(AUTHORED),
  };
  const result = writeThemePackage({ envelope, assets });
  if (!result.ok)
    throw new Error(`game artwork fixture is invalid: ${result.message}`);

  const folder = path.join(THEMES_DIR(), THEME_ID);
  mkdirSync(path.join(folder, "assets"), { recursive: true });
  writeFileSync(path.join(folder, "theme.json"), JSON.stringify(envelope));
  for (const [assetPath, bytes] of Object.entries(assets)) {
    writeFileSync(path.join(folder, ...assetPath.split("/")), bytes);
  }
}

/** The installed app and the art Steam caches for it, under the fake root. */
function seedSteam(): void {
  const apps = path.join(steamRoot, "steamapps");
  mkdirSync(apps, { recursive: true });
  writeFileSync(
    path.join(apps, `appmanifest_${APP_ID}.acf`),
    `"AppState"\n{\n\t"appid"\t\t"${APP_ID}"\n\t"name"\t\t"Spacewar"\n\t"installdir"\t\t"Spacewar"\n}\n`,
  );

  const cache = path.join(steamRoot, "appcache", "librarycache", APP_ID);
  mkdirSync(cache, { recursive: true });
  writeFileSync(path.join(cache, "library_600x900.jpg"), BOX_ART);
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
      env: { ...process.env, YUNARI_STEAM_ROOT: steamRoot },
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
  throw new Error(`the game-artwork host never answered on ${PORT}`);
}

/** A stream the case pushes through; installed before the player starts. */
async function stubStream(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const listeners = new Map<string, ((event: { data: string }) => void)[]>();
    class StubEventSource {
      constructor() {
        Reflect.set(window, "__yunariGameSamples", {
          emit: (data: string) => {
            for (const listener of listeners.get("samples") ?? []) {
              listener({ data });
            }
          },
        });
      }
      addEventListener(
        type: string,
        listener: (event: { data: string }) => void,
      ): void {
        const existing = listeners.get(type) ?? [];
        existing.push(listener);
        listeners.set(type, existing);
      }
      close(): void {}
    }
    Reflect.set(window, "EventSource", StubEventSource);
  });
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
  }, NODE_ID);
}

async function emitSample(
  page: Page,
  sample: { status: string; textValue?: string; message?: string },
): Promise<void> {
  await page.evaluate(
    (batch) => {
      (
        window as unknown as {
          __yunariGameSamples: { emit(data: string): void };
        }
      ).__yunariGameSamples.emit(JSON.stringify(batch));
    },
    {
      version: 1,
      sentAt: new Date().toISOString(),
      samples: [
        {
          semanticKey: "game.artwork",
          sample: {
            sensorId: "game.artwork",
            timestamp: new Date().toISOString(),
            ...sample,
          },
        },
      ],
    },
  );
}

test.describe("the running game's box art on a display", () => {
  let host: ChildProcess | undefined;

  test.beforeAll(async ({}, testInfo) => {
    if (!isDesktopSurface(testInfo)) return;
    appDir = mkdtempSync(path.join(tmpdir(), "yunari-game-artwork-"));
    steamRoot = path.join(appDir, "steam");
    mkdirSync(THEMES_DIR(), { recursive: true });
    seedLibrary();
    seedSteam();
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
    if (appDir !== "") rmSync(appDir, { recursive: true, force: true });
  });

  test("paints the local box art, then restores the authored picture when it is unavailable", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the display is read on a desktop");

    await stubStream(page);
    await page.goto(`${HOST}/?theme=${THEME_ID}`);
    await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();

    // The authored asset decoded: nothing a sample did, this is the fallback.
    await expect
      .poll(async () => (await imageState(page))?.width, { timeout: 20_000 })
      .toBe(200);
    expect((await imageState(page))?.src).toContain(AUTHORED_URL);

    await emitSample(page, { status: "ok", textValue: LIVE_URL });
    await expect
      .poll(async () => (await imageState(page))?.src, { timeout: 20_000 })
      .toContain(LIVE_URL);
    // The route's JPEG bytes were decoded, not merely requested: Steam's box
    // art fixture is 1x1 and the authored SVG is 200x200.
    await expect.poll(async () => (await imageState(page))?.width).toBe(1);

    await emitSample(page, {
      status: "unavailable",
      message: "Game artwork is not available.",
    });
    await expect
      .poll(async () => (await imageState(page))?.src, { timeout: 20_000 })
      .toContain(AUTHORED_URL);
    await expect.poll(async () => (await imageState(page))?.width).toBe(200);
  });
});
