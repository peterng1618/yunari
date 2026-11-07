import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { writeThemePackage } from "@yunari/theme-package";
import { uiCopy } from "../../packages/player/src/ui-copy.js";

/**
 * What a display's stream does when the host moves its binding.
 *
 * The move is a rebind on the same port (`cli/hosting.ts`), and it destroys
 * every connection the old socket held (`hosting.ts:98`) right after it has
 * ended each stream deliberately (`server.ts:3767`, `SseConnection.close()` is
 * `response.end()`). Whether that end reaches a browser — rather than a hang or
 * an uncaught error — is not observable from the host's own tests, which is
 * why this case runs a real host and a real display.
 *
 * **The display survives because the origin survives.** The host rebinds
 * `127.0.0.1` → `0.0.0.0`, which still answers loopback, so the browser's own
 * `EventSource` retries the same URL and the stream goes live again. What the
 * page reports in between is the product's sentence, not one invented here.
 */

/** A port no other agent and no Playwright runner owns. */
const PORT = 4249;
const APP_DIR = path.join(process.cwd(), ".e2e-host-move-app");
const THEMES_DIR = path.join(APP_DIR, "themes");
const HOST = `http://127.0.0.1:${PORT}`;
const THEME_ID = "e2e-host-move";

/** One bound clock: the stream asks for a key the host always answers, so
 *  "live" is a reading that moved rather than an open socket with no frames. */
const envelope = {
  schemaVersion: "2.1.0" as const,
  fabricVersion: "7.4.0",
  id: THEME_ID,
  metadata: { name: "E2E host move", themeLanguage: "en" },
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
      ink: { name: "Ink", value: { kind: "solid" as const, color: "#e8ecf3" } },
    },
    typeTokens: {
      heading: { family: "system-ui, sans-serif", weight: "600" },
      body: { family: "system-ui, sans-serif", weight: "400" },
      mono: { family: "ui-monospace, monospace", weight: "400" },
    },
  },
  assets: [],
  scene: {
    version: "7.4.0" as const,
    objects: [
      {
        type: "Textbox",
        version: "7.4.0",
        originX: "left",
        originY: "top",
        left: 40,
        top: 140,
        width: 420,
        height: 60,
        text: "--:--:--",
        fontSize: 22,
        fontFamily: "system-ui, sans-serif",
        fill: "palette.ink",
        id: "clock",
        yunariPaint: { fill: "palette.ink" },
        yunariText: {
          runs: [
            {
              kind: "value",
              bindingId: "bound-value",
              typeToken: "typeTokens.body",
              style: {
                color: { ref: "palette.ink" },
                fontSize: { value: 22 },
              },
            },
          ],
        },
      },
    ],
  },
  bindings: {
    clock: [{ id: "bound-value", semanticKey: "time.now", format: "HH:mm:ss" }],
  },
};

function seedLibrary(): void {
  const result = writeThemePackage({ envelope, assets: {} });
  if (!result.ok) {
    throw new Error(`host-move fixture is invalid: ${result.message}`);
  }

  const folder = path.join(THEMES_DIR, THEME_ID);
  mkdirSync(path.join(folder, "assets"), { recursive: true });
  writeFileSync(path.join(folder, "theme.json"), JSON.stringify(envelope));
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
      APP_DIR,
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
  throw new Error(`the host-move host never answered on ${PORT}`);
}

interface StreamCounts {
  readonly opened: number;
  readonly errored: number;
}

/** Counts the real `EventSource` the player constructs. It is the browser's own
 *  object, not a stand-in: an `open` per successful (re)connect and an `error`
 *  when the stream ends is exactly what "the socket ended and came back" is. */
async function instrumentStream(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const counts = { opened: 0, errored: 0 };
    (window as unknown as { __yunariStream: StreamCounts }).__yunariStream =
      counts;
    const Native = window.EventSource;
    window.EventSource = class extends Native {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        this.addEventListener("open", () => {
          counts.opened += 1;
        });
        this.addEventListener("error", () => {
          counts.errored += 1;
        });
      }
    } as typeof EventSource;
  });
}

function streamCounts(page: Page): Promise<StreamCounts> {
  return page.evaluate(
    () =>
      (window as unknown as { __yunariStream: StreamCounts }).__yunariStream,
  );
}

/** The move destroys whatever connection was unlucky enough to be answering
 *  (`hosting.ts:98`), so a GET landing in that window gets an empty reply.
 *  The route's own `idle()` makes a served answer the landing; this retries
 *  until one is served. */
async function hostingState(request: APIRequestContext): Promise<{
  readonly lan: boolean;
  readonly port: number;
  readonly refusal?: string;
}> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const answer = await request.get(`${HOST}/api/hosting`);
      if (answer.ok()) return await answer.json();
    } catch {
      /* the move destroyed this connection; ask again */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`the host-move host never answered /api/hosting on ${PORT}`);
}

test.describe("a display's stream across a host move", () => {
  let host: ChildProcess | undefined;

  test.beforeAll(async () => {
    rmSync(APP_DIR, { recursive: true, force: true });
    mkdirSync(THEMES_DIR, { recursive: true });
    seedLibrary();
    host = await startHost();
  });

  test.afterAll(() => {
    host?.kill();
    // The app folder is this spec's own, and a run that left it behind is
    // scratch the gate sweeps; `host-pwa` removes its own the same way.
    rmSync(APP_DIR, { recursive: true, force: true });
  });

  test("the stream ends, the display says so, and the same origin reconnects", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);

    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await instrumentStream(page);
    await page.goto(`${HOST}/?theme=${THEME_ID}`);

    // Live first: the stream opened and a batch arrived, which is what takes
    // the connection strip down.
    await page.waitForFunction(
      () =>
        (window as unknown as { __yunariStream: StreamCounts }).__yunariStream
          .opened >= 1,
    );
    const strip = page.locator("#yunari-connection");
    await expect(strip).toBeHidden();
    expect((await streamCounts(page)).errored).toBe(0);

    const before = await hostingState(request);
    expect(before.lan, "the host did not start loopback-only").toBe(false);

    // The editor's own control, same route (`server.ts:3730`).
    const answered = await request.put(`${HOST}/api/hosting`, {
      data: { lan: true },
    });
    expect(answered.status()).toBe(200);

    // The host ended every stream before it destroyed the socket, and the
    // browser sees that end rather than waiting on a dead connection.
    await page.waitForFunction(
      () =>
        (window as unknown as { __yunariStream: StreamCounts }).__yunariStream
          .errored >= 1,
    );
    await expect(strip).toHaveText(uiCopy.connection.reconnecting);

    // It landed on the same port, and the display's own origin still answers.
    const landed = await hostingState(request);
    expect(landed).toMatchObject({ lan: true, port: PORT });
    expect(page.url()).toContain(`127.0.0.1:${PORT}/`);

    // The reconnect is the browser's `EventSource` retrying the same URL, and
    // a fresh batch takes the strip down again: no hang, no stuck notice.
    await page.waitForFunction(
      () =>
        (window as unknown as { __yunariStream: StreamCounts }).__yunariStream
          .opened >= 2,
    );
    await expect(strip).toBeHidden();

    // Put the binding back so the app folder this run leaves behind is the
    // loopback-only one the host starts with.
    const restored = await request.put(`${HOST}/api/hosting`, {
      data: { lan: false },
    });
    expect(restored.status()).toBe(200);
    expect(await hostingState(request)).toMatchObject({
      lan: false,
      port: PORT,
    });

    expect(pageErrors, "the move threw inside the page").toEqual([]);
  });
});
