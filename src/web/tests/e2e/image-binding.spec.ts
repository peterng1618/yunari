import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { writeThemePackage } from "@yunari/theme-package";
import { isDesktopSurface } from "./surface.js";

/**
 * An image reading, on the real host and the real player.
 *
 * The reading is a URL, and the security rule is the whole task: only a
 * host-relative path may reach an `<img>`. A fixture theme authors one picture
 * and binds the node to `media.artwork`; a stubbed stream then sends the path of
 * a second packaged picture, and an absolute URL. The first must decode, the
 * second must leave the authored picture on screen and never be requested.
 *
 * Its own host on its own port, because a fixture theme is written into an app
 * folder this file owns. The shared host is `host-theme.ts`'s, and a spec that
 * wrote into its themes directory would race the host project's serial cases.
 * The folder is minted under the OS temp directory and removed again, so a
 * filesystem walk of the worktree never sees a test store.
 *
 * The stream is stubbed in the page rather than through the host: no provider
 * reports an image reading, and the source this exercises is the player's
 * transport-to-render path.
 */

/** A port no other spec or runner owns. */
const PORT = 4221;
/** Minted per run in `beforeAll`, outside the repository. */
let appDir = "";
const THEMES_DIR = (): string => path.join(appDir, "themes");
const HOST = `http://127.0.0.1:${PORT}`;
const THEME_ID = "e2e-image-binding";
const NODE_ID = "artwork";

/** The authored bytes: the picture a display shows until a reading arrives. */
const AUTHORED = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <rect width="200" height="200" fill="#e8ecf3" />
</svg>
`;
/** The reading's bytes: a different size, so a decoded swap is measurable. */
const LIVE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" fill="#e8ecf3" />
</svg>
`;
const AUTHORED_URL = `/api/themes/${THEME_ID}/assets/authored.svg`;
const LIVE_URL = `/api/themes/${THEME_ID}/assets/live.svg`;
const ABSOLUTE_URL = "https://evil.example/never.png";

const envelope = {
  schemaVersion: "2.0.0" as const,
  fabricVersion: "7.4.0",
  id: THEME_ID,
  metadata: { name: "E2E image binding", themeLanguage: "en" },
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
    typeTokens: {},
  },
  assets: [
    {
      id: "authored",
      kind: "svg" as const,
      path: "assets/authored.svg",
      license: { name: "MIT", attribution: "Yunari test fixture." },
    },
    {
      id: "live",
      kind: "svg" as const,
      path: "assets/live.svg",
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
    [NODE_ID]: [{ id: "image", semanticKey: "media.artwork" }],
  },
};

function seedLibrary(): void {
  const assets = {
    "assets/authored.svg": new TextEncoder().encode(AUTHORED),
    "assets/live.svg": new TextEncoder().encode(LIVE),
  };
  const result = writeThemePackage({ envelope, assets });
  if (!result.ok)
    throw new Error(`image fixture is invalid: ${result.message}`);

  const folder = path.join(THEMES_DIR(), THEME_ID);
  mkdirSync(path.join(folder, "assets"), { recursive: true });
  writeFileSync(path.join(folder, "theme.json"), JSON.stringify(envelope));
  for (const [assetPath, bytes] of Object.entries(assets)) {
    writeFileSync(path.join(folder, ...assetPath.split("/")), bytes);
  }
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
    { cwd: process.cwd(), stdio: "ignore" },
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
  throw new Error(`the image-binding host never answered on ${PORT}`);
}

/**
 * A stream the case pushes through. Installed before any page script, because
 * the player opens its `EventSource` while it starts.
 */
async function stubStream(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const listeners = new Map<string, ((event: { data: string }) => void)[]>();
    class StubEventSource {
      constructor() {
        Reflect.set(window, "__yunariImageSamples", {
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
      width: number;
      getElement(): { naturalWidth?: number } | undefined;
    };
    return {
      src: image.getSrc(),
      // Natural pixels, not the authored box: a swap that did not decode would
      // still report the authored width.
      width: image.getElement()?.naturalWidth ?? 0,
    };
  }, NODE_ID);
}

async function emitSample(page: Page, textValue: string): Promise<void> {
  await page.evaluate(
    (batch) => {
      (
        window as unknown as {
          __yunariImageSamples: { emit(data: string): void };
        }
      ).__yunariImageSamples.emit(JSON.stringify(batch));
    },
    {
      version: 1,
      sentAt: new Date().toISOString(),
      samples: [
        {
          semanticKey: "media.artwork",
          sample: {
            sensorId: "media.artwork",
            timestamp: new Date().toISOString(),
            status: "ok",
            textValue,
          },
        },
      ],
    },
  );
}

test.describe("an image reading on a display", () => {
  let host: ChildProcess | undefined;

  test.beforeAll(async ({}, testInfo) => {
    if (!isDesktopSurface(testInfo)) return;
    appDir = mkdtempSync(path.join(tmpdir(), "yunari-image-binding-"));
    mkdirSync(THEMES_DIR(), { recursive: true });
    seedLibrary();
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

  test("paints the authored picture, then the reading's, and refuses an absolute URL", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the display is read on a desktop");

    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));

    await stubStream(page);
    await page.goto(`${HOST}/?theme=${THEME_ID}`);
    await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();

    // The authored asset decoded: nothing a sample did, this is the fallback.
    await expect
      .poll(async () => (await imageState(page))?.width, { timeout: 20_000 })
      .toBe(200);
    expect((await imageState(page))?.src).toContain(AUTHORED_URL);

    await emitSample(page, LIVE_URL);
    await expect
      .poll(async () => (await imageState(page))?.src, { timeout: 20_000 })
      .toContain(LIVE_URL);
    // The reading's bytes were decoded, not merely requested.
    await expect.poll(async () => (await imageState(page))?.width).toBe(64);

    await emitSample(page, ABSOLUTE_URL);
    // The authored picture is back, and the refused URL never left the page.
    await expect
      .poll(async () => (await imageState(page))?.src, { timeout: 20_000 })
      .toContain(AUTHORED_URL);
    expect(
      requested.filter((url) => url.includes("evil.example")),
      "an absolute reading was fetched",
    ).toEqual([]);
    expect((await imageState(page))?.src).not.toContain("evil.example");
  });
});
