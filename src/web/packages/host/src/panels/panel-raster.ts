import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PanelGeometry } from "./panel-device.js";

/**
 * The rasteriser: a hidden Chromium showing the real player page, asked for a
 * still of the artboard.
 *
 * **It renders the product's own player rather than a second scene tree.** That
 * is the whole decision (`0130`): glass sampling a video backdrop, ECharts
 * charts and packaged fonts already work in the player, and are exactly the
 * pieces a Node reimplementation would have to rebuild and then keep in step.
 * A screenshot is the cheapest correct answer to "what does this theme look
 * like", because the browser has already answered it.
 *
 * Every call is devtools-protocol over Node's own `WebSocket`: no dependency,
 * no `puppeteer`, and no second copy of a browser download — it drives the
 * Chromium the launcher already finds.
 */

/** How long a page gets to mount, fetch its theme and settle before a capture. */
const MOUNT_TIMEOUT_MS = 20_000;
/** Chrome's own log line is the only reliable signal that the port is up. */
const START_TIMEOUT_MS = 20_000;

export interface RasterOptions {
  /** The browser executable, from `findBrowser`. */
  readonly browser: string;
  /** The player page for a display, including its session. */
  readonly url: string;
  readonly geometry: PanelGeometry;
  /** The still encoding the device consumes; JPEG when it states none. */
  readonly stillFormat?: "jpeg" | "png";
}

export interface Rasterizer {
  /**
   * One still of the artboard, in `geometry`.
   *
   * Refused rather than blank when the page did not render: a panel showing the
   * previous theme is honest, and one showing black is a display that looks
   * broken.
   */
  capture(): Promise<Uint8Array>;
  /**
   * The UI alone, as a PNG with alpha, with the theme's background media
   * hidden — the layer a panel composites over a video it plays itself.
   *
   * A transparent background is asked of the browser rather than keyed out
   * afterwards: the player draws the media in a sibling layer, so hiding that
   * layer is the whole difference between "the theme" and "the theme without
   * its picture".
   */
  captureOverlay(): Promise<Uint8Array>;
  close(): Promise<void>;
}

/**
 * The `Page.captureScreenshot` format parameters for a still, in `format`.
 *
 * PNG carries no `quality`: the protocol refuses one, and the mode exists to be
 * lossless for a device that decodes the still rather than showing it as-is.
 */
export function screenshotParameters(format: "jpeg" | "png"): {
  readonly format: "jpeg" | "png";
  readonly quality?: number;
} {
  return format === "jpeg" ? { format, quality: 85 } : { format };
}

interface CdpReply {
  readonly id?: number;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly message?: string };
}

/**
 * A minimal devtools client: one request in flight per id, and no event
 * handling beyond what a capture needs.
 */
class Devtools {
  private constructor(
    private readonly socket: WebSocket,
    private nextId: number,
  ) {}

  static async connect(url: string): Promise<Devtools> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener(
        "error",
        () => reject(new Error("the browser's devtools socket refused")),
        { once: true },
      );
    });

    return new Devtools(socket, 1);
  }

  send(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<CdpReply> {
    const id = this.nextId;
    this.nextId += 1;

    return new Promise((resolve, reject) => {
      const onMessage = (event: MessageEvent): void => {
        const message = JSON.parse(String(event.data)) as CdpReply;
        if (message.id !== id) return;

        this.socket.removeEventListener("message", onMessage);
        if (message.error !== undefined) {
          reject(new Error(message.error.message ?? method));
          return;
        }

        resolve(message);
      };

      this.socket.addEventListener("message", onMessage);
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.socket.close();
  }
}

/** The devtools endpoint a freshly started browser announces on stderr. */
function waitForEndpoint(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let seen = "";
    const timer = setTimeout(() => {
      reject(new Error("the browser did not start a devtools port"));
    }, START_TIMEOUT_MS);

    const onData = (chunk: Buffer): void => {
      seen += chunk.toString();
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(seen);
      if (match?.[1] === undefined) return;

      clearTimeout(timer);
      child.stderr?.off("data", onData);
      resolve(match[1]);
    };

    child.stderr?.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(
          `the browser exited with ${code ?? "no code"} before starting`,
        ),
      );
    });
  });
}

async function startBrowser(
  browser: string,
  profile: string,
): Promise<{ readonly child: ChildProcess; readonly endpoint: string }> {
  const child = spawn(
    browser,
    [
      // `new` headless is the full browser without a window: the old mode has
      // no layout engine for some CSS, and glass needs a real compositor.
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      // A panel is a display of its own; a URL bar or scrollbar in the capture
      // would be part of the frame.
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
  );

  const endpoint = await waitForEndpoint(child);
  return { child, endpoint };
}

/**
 * Starts a page on `url` at exactly `geometry` and captures it.
 *
 * One browser per capture would be a second of latency per frame; one browser
 * for the rasteriser's life is the shape that is affordable. The page is
 * navigated once and re-captured, so a live theme's samples keep arriving over
 * its own stream and the screenshot picks up whatever is on screen.
 */
export async function createRasterizer(
  options: RasterOptions,
): Promise<Rasterizer> {
  const profile = await mkdtemp(path.join(os.tmpdir(), "yunari-panel-"));
  const { child, endpoint } = await startBrowser(options.browser, profile);

  const base = endpoint
    .replace(/^ws:\/\//, "http://")
    .replace(/\/devtools\/browser\/.*$/, "");

  let devtools: Devtools | undefined;

  try {
    const target = (await fetch(`${base}/json/new?about:blank`, {
      method: "PUT",
    }).then((response) => response.json())) as {
      readonly webSocketDebuggerUrl?: string;
    };

    if (target.webSocketDebuggerUrl === undefined) {
      throw new Error("the browser opened no page to render into");
    }

    devtools = await Devtools.connect(target.webSocketDebuggerUrl);
    await devtools.send("Page.enable");

    // The page is told its size rather than resized: a panel has one geometry,
    // and the player letterboxes the artboard into it the way it does for any
    // display whose shape is not the artboard's.
    await devtools.send("Emulation.setDeviceMetricsOverride", {
      width: options.geometry.width,
      height: options.geometry.height,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await devtools.send("Page.navigate", { url: options.url });
    await waitForScene(devtools);
  } catch (error) {
    child.kill();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  let closed = false;

  const live = (): Devtools => {
    if (closed || devtools === undefined) {
      throw new Error("The rasteriser is closed.");
    }

    return devtools;
  };

  const shot = async (format: "jpeg" | "png"): Promise<Uint8Array> => {
    const reply = await live().send("Page.captureScreenshot", {
      ...screenshotParameters(format),
      clip: {
        x: 0,
        y: 0,
        width: options.geometry.width,
        height: options.geometry.height,
        scale: 1,
      },
      // The page is exactly the clip size, so nothing here is off-screen; the
      // flag keeps a shorter page from producing a short image.
      captureBeyondViewport: false,
    });

    const data = reply.result?.["data"];
    if (typeof data !== "string") {
      throw new Error("The browser returned no image.");
    }

    return new Uint8Array(Buffer.from(data, "base64"));
  };

  return {
    async capture(): Promise<Uint8Array> {
      await overlayMode(live(), false);
      return shot(options.stillFormat ?? "jpeg");
    },

    async captureOverlay(): Promise<Uint8Array> {
      await overlayMode(live(), true);
      return shot("png");
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;

      devtools?.close();
      child.kill();
      await rm(profile, { recursive: true, force: true }).catch(() => {});
    },
  };
}

const OVERLAY_STYLE_ID = "yunari-panel-overlay";

/**
 * Switches the page between "the theme" and "the theme without its picture".
 *
 * Hiding the media layer is not enough: the artboard's paint is an **inline**
 * `background` on the scene host, which would cover the video, and no stylesheet
 * can outrank an inline value without `!important` leaking into a still capture.
 * So the host's own paint is saved on the element and restored on the way out.
 */
async function overlayMode(devtools: Devtools, on: boolean): Promise<void> {
  await devtools.send("Runtime.evaluate", {
    expression: `(() => {
      const id = ${JSON.stringify(OVERLAY_STYLE_ID)};
      const style = document.getElementById(id);
      const host = document.querySelector('canvas[data-yunari="artboard"]')?.parentElement;
      if (${on ? "true" : "false"}) {
        if (style === null) {
          const made = document.createElement("style");
          made.id = id;
          made.textContent =
            "[data-yunari-background-media]{display:none !important}" +
            "[data-yunari-display-disc]{background:transparent !important}" +
            "html,body{background:transparent !important}";
          document.head.append(made);
        }
        if (host !== null && host.dataset["panelOverlayBackground"] === undefined) {
          host.dataset["panelOverlayBackground"] = host.style.background;
          host.style.background = "transparent";
        }
      } else {
        style?.remove();
        if (host !== null && host.dataset["panelOverlayBackground"] !== undefined) {
          host.style.background = host.dataset["panelOverlayBackground"];
          delete host.dataset["panelOverlayBackground"];
        }
      }
      return true;
    })()`,
    returnByValue: true,
  });

  await devtools.send(
    "Emulation.setDefaultBackgroundColorOverride",
    on ? { color: { r: 0, g: 0, b: 0, a: 0 } } : {},
  );
}

/**
 * Waits until the player has mounted a scene.
 *
 * Polling `document.querySelector` rather than an event: the player announces
 * nothing, and the artboard is the one thing it creates. A page that never gets
 * there is an error rather than an empty frame.
 */
async function waitForScene(devtools: Devtools): Promise<void> {
  const deadline = Date.now() + MOUNT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const reply = await devtools.send("Runtime.evaluate", {
      expression: 'document.querySelector("canvas[data-yunari]") !== null',
      returnByValue: true,
    });

    if (reply.result?.["result"] !== undefined) {
      const value = reply.result["result"] as { value?: unknown };
      if (value.value === true) return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    "The player page mounted no scene, so the panel has nothing to show.",
  );
}
