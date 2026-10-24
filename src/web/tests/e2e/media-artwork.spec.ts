import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { writeThemePackage } from "@yunari/theme-package";
import { canvasProp } from "./canvas-probe.js";
import { isDesktopSurface } from "./surface.js";

/**
 * The media readings on a display: four text bindings, and the artwork.
 *
 * The stream is stubbed in the page rather than served by the host. The host's
 * own provider reads this machine's SMTC session, which is a different session
 * on every machine and none at all on CI; a deterministic sample is the only
 * way the values on screen are known. What stays real is the half the feature
 * is about: the theme is served by the real host, and the artwork URL the
 * sample names is fetched from the host's own route, so the bytes, the content
 * type and the display gate are the shipped ones.
 *
 * The sample is host-relative (`/api/media/artwork/<sha>.png`), exactly what
 * `providers/media/provider.ts` emits. Loopback is this PC and the route
 * admits it without a credential, which is the same arrangement
 * `image-binding.spec.ts` uses for theme assets.
 *
 * Its own host on its own port, because the theme and the artwork cache are
 * written into an app folder this file owns. The folder is minted under the OS
 * temp directory and removed again, so a filesystem walk of the worktree never
 * sees a test store.
 */

/** A port no other spec or runner owns. */
const PORT = 4222;
/** Minted per run in `beforeAll`, outside the repository. */
let appDir = "";
const THEMES_DIR = (): string => path.join(appDir, "themes");
/** `main.ts` puts the cache beside the settings dir, which is `<app>/settings`. */
const ARTWORK_DIR = (): string => path.join(appDir, "cache", "media-artwork");
const HOST = `http://127.0.0.1:${PORT}`;
const THEME_ID = "e2e-media-artwork";

const TEXT_NODES = [
  "media-title",
  "media-artist",
  "media-album",
  "media-state",
] as const;
const IMAGE_NODE = "artwork";

/** The authored picture: a solid dark field the reader sees before a reading. */
const AUTHORED = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <rect width="200" height="200" fill="#1a2233" />
</svg>
`;
const AUTHORED_URL = `/api/themes/${THEME_ID}/assets/authored.svg`;

/**
 * The reading's bytes: opaque white, 20 × 20. Its size is the decoded proof —
 * the authored SVG is 200 wide, so a `naturalWidth` of 20 can only be these
 * bytes. The name is its digest, which is what the route's allow-list checks.
 */
const LIVE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAANUlEQVQ4jWP8////fwYiwAePAmKUMTARpYoEMGrgqIGDwUDG9+75ROUUYsHg9/KogaMGkgEAOzoIbzncHVkAAAAASUVORK5CYII=",
  "base64",
);
const LIVE_NAME = `${createHash("sha256").update(LIVE_PNG).digest("hex")}.png`;
const LIVE_URL = `/api/media/artwork/${LIVE_NAME}`;

const VALUES = {
  "media.title": "So What",
  "media.artist": "Miles Davis",
  "media.album": "Kind of Blue",
  "media.state": "playing",
} as const;

const textNode = (index: number) => ({
  type: "Textbox" as const,
  version: "7.4.0" as const,
  originX: "left" as const,
  originY: "top" as const,
  left: 300,
  top: 40 + index * 70,
  width: 300,
  height: 48,
  text: "--",
  fontSize: 20,
  fontFamily: "system-ui, sans-serif",
  fill: "palette.ink",
  id: TEXT_NODES[index]!,
  selectable: false,
  evented: false,
  yunariPaint: { fill: "palette.ink" as const },
  yunariText: {
    runs: [
      {
        kind: "value" as const,
        bindingId: `bound-${TEXT_NODES[index]!}`,
        typePreset: "typePresets.20-400",
        style: { color: { ref: "palette.ink" as const } },
      },
    ],
  },
});

const envelope = {
  schemaVersion: 2 as const,
  fabricVersion: "7.4.0",
  id: THEME_ID,
  metadata: { name: "E2E media artwork", themeLanguage: "en" },
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
        id: IMAGE_NODE,
        selectable: false,
        evented: false,
        yunariAsset: { assetId: "authored", kind: "svg" as const },
      },
      ...TEXT_NODES.map((_, index) => textNode(index)),
    ],
  },
  bindings: {
    [IMAGE_NODE]: [{ id: "image", semanticKey: "media.artwork" }],
    ...Object.fromEntries(
      TEXT_NODES.map((node, index) => [
        node,
        [{ id: `bound-${node}`, semanticKey: Object.keys(VALUES)[index]! }],
      ]),
    ),
  },
};

function seedLibrary(): void {
  const assets = { "assets/authored.svg": new TextEncoder().encode(AUTHORED) };
  const result = writeThemePackage({ envelope, assets });
  if (!result.ok)
    throw new Error(`media fixture is invalid: ${result.message}`);

  const folder = path.join(THEMES_DIR(), THEME_ID);
  mkdirSync(path.join(folder, "assets"), { recursive: true });
  writeFileSync(path.join(folder, "theme.json"), JSON.stringify(envelope));
  writeFileSync(path.join(folder, "assets", "authored.svg"), AUTHORED);

  // The host's cache reads the name as the address and re-hashes the bytes, so
  // this is exactly the file its own `put` would have written.
  mkdirSync(ARTWORK_DIR(), { recursive: true });
  writeFileSync(path.join(ARTWORK_DIR(), LIVE_NAME), LIVE_PNG);
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
  throw new Error(`the media-artwork host never answered on ${PORT}`);
}

/**
 * The stream the cases push through, plus the URL the player asked to open. The
 * URL is the demand: the host reads `keys` to decide which sensors it samples,
 * so an image binding missing from it is a reading the display never asks for.
 * Installed before any page script, because the player opens its
 * `EventSource` while it starts.
 */
async function stubStream(
  page: Page,
): Promise<{ readonly streamUrl: () => Promise<string> }> {
  await page.addInitScript(() => {
    const listeners = new Map<string, ((event: { data: string }) => void)[]>();
    const opened: string[] = [];
    Reflect.set(window, "__yunariMediaStream", {
      emit: (data: string) => {
        for (const listener of listeners.get("samples") ?? []) {
          listener({ data });
        }
      },
      opened,
    });
    class StubEventSource {
      constructor(url: string) {
        opened.push(String(url));
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

  return {
    streamUrl: async () => {
      const urls = await page.evaluate(
        () =>
          (
            window as unknown as {
              __yunariMediaStream: { opened: string[] };
            }
          ).__yunariMediaStream.opened,
      );
      return urls[0] ?? "";
    },
  };
}

/** Emit one batch of readings, exactly as the host's provider answers them. */
async function emitSamples(
  page: Page,
  samples: readonly {
    readonly semanticKey: string;
    readonly textValue?: string;
    readonly status?: "ok" | "unavailable";
  }[],
): Promise<void> {
  await page.evaluate(
    (entries) => {
      (
        window as unknown as {
          __yunariMediaStream: { emit(data: string): void };
        }
      ).__yunariMediaStream.emit(
        JSON.stringify({
          version: 1,
          sentAt: new Date().toISOString(),
          samples: entries.map((entry) => ({
            semanticKey: entry.semanticKey,
            sample: {
              sensorId: `media:${entry.semanticKey}`,
              timestamp: new Date().toISOString(),
              status: entry.status ?? "ok",
              ...(entry.textValue === undefined
                ? {}
                : { textValue: entry.textValue }),
            },
          })),
        }),
      );
    },
    samples.map((entry) => ({ ...entry })),
  );
}

/** The image object's own reading of its element, by id. */
async function imageState(
  page: Page,
): Promise<
  | { readonly src: string; readonly absolute: string; readonly width: number }
  | undefined
> {
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
      getElement(): { src?: string; naturalWidth?: number } | undefined;
    };
    const element = image.getElement();
    return {
      src: image.getSrc(),
      absolute: element?.src ?? "",
      // Natural pixels, not the authored box: a swap that did not decode would
      // still report the authored size.
      width: element?.naturalWidth ?? 0,
    };
  }, IMAGE_NODE);
}

/** The canvas pixels the reader sees, settled on a frame after a repaint. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function frame(page: Page): Promise<Buffer> {
  await settle(page);
  return page.locator("#artboard canvas.lower-canvas").screenshot();
}

test.describe("the media readings on a display", () => {
  let host: ChildProcess | undefined;

  test.beforeAll(async ({}, testInfo) => {
    if (!isDesktopSurface(testInfo)) return;
    appDir = mkdtempSync(path.join(tmpdir(), "yunari-media-artwork-"));
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

  test("asks for every bound media key, paints each reading, and restores the authored picture", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the display is read on a desktop");

    const stream = await stubStream(page);
    await page.goto(`${HOST}/?theme=${THEME_ID}`);
    await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    // **The demand.** The host samples what this URL names; a key absent here
    // is a reading the display never asks for, whatever the stream can carry.
    const requested = new URL(await stream.streamUrl(), HOST);
    expect(
      requested.searchParams.get("keys")?.split(","),
      "the display asks for every media key its theme binds, the image included",
    ).toEqual(
      expect.arrayContaining([
        "media.artwork",
        "media.title",
        "media.artist",
        "media.album",
        "media.state",
      ]),
    );
    expect(requested.searchParams.get("lang")).toBe("en");

    // The authored picture decoded; nothing a sample did, this is the fallback.
    await expect
      .poll(async () => (await imageState(page))?.width, { timeout: 20_000 })
      .toBe(200);
    expect((await imageState(page))?.src).toContain(AUTHORED_URL);
    const authoredFrame = await frame(page);
    expect(authoredFrame.length, "the authored frame painted").toBeGreaterThan(
      0,
    );

    // **The artwork.** Host-relative, as the provider emits it, and served by
    // the host's own route: the bytes arrive under its content type, pass the
    // cache's digest check, and decode to 20 natural pixels.
    await emitSamples(page, [
      { semanticKey: "media.artwork", textValue: LIVE_URL },
    ]);
    await expect
      .poll(async () => (await imageState(page))?.src, { timeout: 20_000 })
      .toContain(LIVE_URL);
    await expect
      .poll(async () => (await imageState(page))?.width, { timeout: 20_000 })
      .toBe(20);
    expect(
      (await imageState(page))?.absolute,
      "the reading resolves against this host, not a foreign origin",
    ).toBe(`${HOST}${LIVE_URL}`);

    // The picture reaches the pixels, not only the object's source.
    const artworkFrame = await frame(page);
    expect(
      Buffer.compare(authoredFrame, artworkFrame),
      "the artwork reading repainted the artboard",
    ).not.toBe(0);

    // **Each text value.** The repaint is measured, and the text the display
    // paints is the reading the binding resolved.
    const textFrame = await (async () => {
      await emitSamples(
        page,
        Object.entries(VALUES).map(([semanticKey, textValue]) => ({
          semanticKey,
          textValue,
        })),
      );
      await expect
        .poll(
          async () =>
            Promise.all(
              TEXT_NODES.map((node) => canvasProp(page, node, "text")),
            ),
          { timeout: 20_000 },
        )
        .toEqual(Object.values(VALUES));
      return frame(page);
    })();
    expect(
      Buffer.compare(artworkFrame, textFrame),
      "the text readings repainted the artboard",
    ).not.toBe(0);

    // **The gap.** `unavailable` is not a picture, so the authored asset is what
    // a reader sees again.
    await emitSamples(page, [
      { semanticKey: "media.artwork", status: "unavailable" },
    ]);
    await expect
      .poll(async () => (await imageState(page))?.src, { timeout: 20_000 })
      .toContain(AUTHORED_URL);
    await expect
      .poll(async () => (await imageState(page))?.width, { timeout: 20_000 })
      .toBe(200);
    const restoredFrame = await frame(page);
    expect(
      Buffer.compare(textFrame, restoredFrame),
      "the authored picture returned to the artboard",
    ).not.toBe(0);

    // Evidence, not a golden file: the frames this run rendered.
    await testInfo.attach("media-artwork-artwork", {
      body: artworkFrame,
      contentType: "image/png",
    });
    await testInfo.attach("media-artwork-restored", {
      body: await frame(page),
      contentType: "image/png",
    });
  });
});
