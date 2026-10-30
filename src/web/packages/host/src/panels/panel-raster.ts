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
 * is the whole point: glass sampling a video backdrop, ECharts
 * charts and packaged fonts already work in the player, and are exactly the
 * pieces a Node reimplementation would have to rebuild and then keep in step.
 * The compositor's own frames are the cheapest correct answer to "what does this
 * theme look like", because the browser has already answered it.
 *
 * Every call is devtools-protocol over Node's own `WebSocket`: no dependency,
 * no `puppeteer`, and no second copy of a browser download — it drives the
 * Chromium the launcher already finds.
 */

/** How long a page gets to mount, fetch its theme and settle before a capture. */
const MOUNT_TIMEOUT_MS = 20_000;
/** Chrome's own log line is the only reliable signal that the port is up. */
const START_TIMEOUT_MS = 20_000;
/** A capture measures ~45 ms. A reply that never comes must free the loop that
 *  is waiting for it, rather than leave the panel frozen with no message. */
const REPLY_TIMEOUT_MS = 5_000;
/** A composited frame is 33 ms away; a second of nothing is a page that stopped. */
const FRAME_TIMEOUT_MS = 1_000;

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
   * The newest frame of the artboard, in `geometry`.
   *
   * Refused rather than blank when the page stopped composing: a panel showing
   * the previous theme is honest, and one showing black is a display that looks
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

/** The newest frame the compositor has handed over, and its place in order. */
export interface LiveFrame {
  readonly sequence: number;
  readonly bytes: Uint8Array;
}

export interface Screencast {
  /** The first frame newer than `after`; waits at most `FRAME_TIMEOUT_MS`. */
  next(after: number): Promise<LiveFrame>;
  stop(): Promise<void>;
}

/**
 * Turns the page's compositor into a frame source.
 *
 * `Page.captureScreenshot` answers "what is on screen now" with a round trip of
 * its own: the reply lands later, on a surface the renderer had already
 * committed, and the next request cannot start until it arrives. The screencast
 * pushes every commit instead, in order, and drops one when the ack is late —
 * the back-pressure a panel wants, and the only way the host can send the frame
 * that is current rather than the frame that was current.
 */
export async function startScreencast(
  devtools: Devtools,
  format: "jpeg" | "png",
): Promise<Screencast> {
  let sequence = 0;
  let newest: LiveFrame | undefined;
  let waiting: ((frame: LiveFrame) => void) | undefined;
  let stopped = false;

  devtools.on("Page.screencastFrame", (params) => {
    const data = params["data"];
    if (typeof data !== "string" || stopped) return;

    sequence += 1;
    const frame = {
      sequence,
      bytes: new Uint8Array(Buffer.from(data, "base64")),
    };
    newest = frame;

    const sessionId = params["sessionId"];
    if (typeof sessionId === "number") {
      void devtools
        .send("Page.screencastFrameAck", { sessionId })
        .catch(() => undefined);
    }

    const resolve = waiting;
    waiting = undefined;
    resolve?.(frame);
  });

  await devtools.send("Page.startScreencast", {
    format,
    ...(format === "jpeg" ? { quality: 85 } : {}),
    everyNthFrame: 1,
  });

  return {
    async next(after: number): Promise<LiveFrame> {
      const available = newest;
      if (available !== undefined && available.sequence > after) {
        return available;
      }

      return await new Promise<LiveFrame>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting = undefined;
          reject(
            new Error(
              `the panel page produced no frame in ${FRAME_TIMEOUT_MS} ms`,
            ),
          );
        }, FRAME_TIMEOUT_MS);

        waiting = (frame) => {
          clearTimeout(timer);
          resolve(frame);
        };
      });
    },

    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      await devtools.send("Page.stopScreencast").catch(() => undefined);
    },
  };
}

export interface CdpReply {
  readonly id?: number;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly message?: string };
}

/** A protocol event: the browser's own push, carrying no request id. */
interface CdpEvent {
  readonly id?: number;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly message?: string };
}

/**
 * What a capture needs from the devtools client.
 *
 * An interface rather than the browser-backed class so the capture paths can be
 * exercised without a Chromium: the request sequence *is* the behaviour.
 */
export interface Devtools {
  send(method: string, params?: Record<string, unknown>): Promise<CdpReply>;
  /** One handler per protocol event; the screencast is the only source. */
  on(method: string, listener: (params: Record<string, unknown>) => void): void;
}

interface Pending {
  readonly method: string;
  readonly resolve: (reply: CdpReply) => void;
  readonly reject: (error: Error) => void;
  readonly settle: () => void;
}

/**
 * A minimal devtools client: one request in flight per id, plus the events the
 * screencast pushes.
 */
class BrowserDevtools implements Devtools {
  private closed = false;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Map<
    string,
    Set<(params: Record<string, unknown>) => void>
  >();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("close", () => {
      this.closed = true;
    });
    // One handler for the socket: a reply settles its request, anything else is
    // an event, and a request that never arrives settles by its own timer.
    socket.addEventListener("message", (event) => {
      this.receive(String(event.data));
    });
  }

  static async connect(url: string): Promise<BrowserDevtools> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener(
        "error",
        () => reject(new Error("the browser's devtools socket refused")),
        { once: true },
      );
    });

    return new BrowserDevtools(socket);
  }

  private receive(raw: string): void {
    const message = JSON.parse(raw) as CdpEvent;

    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (pending === undefined) return;

      this.pending.delete(message.id);
      pending.settle();
      if (message.error !== undefined) {
        pending.reject(new Error(message.error.message ?? pending.method));
        return;
      }

      pending.resolve(message);
      return;
    }

    if (typeof message.method !== "string") return;

    for (const listener of this.listeners.get(message.method) ?? []) {
      listener(message.params ?? {});
    }
  }

  on(
    method: string,
    listener: (params: Record<string, unknown>) => void,
  ): void {
    const listeners = this.listeners.get(method) ?? new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
  }

  send(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<CdpReply> {
    if (this.closed) {
      return Promise.reject(
        new Error(`the browser's devtools socket closed before ${method}`),
      );
    }

    const id = this.nextId;
    this.nextId += 1;

    return new Promise((resolve, reject) => {
      // **A reply that never comes is the failure that froze a panel.** Without
      // this the caller waits on a promise nothing will settle, and the tick
      // that owns it never returns to try again.
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} got no reply in ${REPLY_TIMEOUT_MS} ms`));
      }, REPLY_TIMEOUT_MS);

      this.pending.set(id, {
        method,
        resolve,
        reject,
        settle: () => {
          clearTimeout(timer);
        },
      });

      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
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
 * navigated once and screencast for the rest of its life, so a live theme's
 * samples keep arriving over its own stream and a capture returns the newest one
 * rather than asking the renderer to compose on demand.
 */
export async function createRasterizer(
  options: RasterOptions,
): Promise<Rasterizer> {
  const profile = await mkdtemp(path.join(os.tmpdir(), "yunari-panel-"));
  const { child, endpoint } = await startBrowser(options.browser, profile);

  const base = endpoint
    .replace(/^ws:\/\//, "http://")
    .replace(/\/devtools\/browser\/.*$/, "");

  let devtools: BrowserDevtools | undefined;
  let frames: Screencast | undefined;
  /** The encoding the running screencast produces; the overlay needs PNG. */
  let encoding: "jpeg" | "png" = options.stillFormat ?? "jpeg";

  try {
    const target = (await fetch(`${base}/json/new?about:blank`, {
      method: "PUT",
    }).then((response) => response.json())) as {
      readonly webSocketDebuggerUrl?: string;
    };

    if (target.webSocketDebuggerUrl === undefined) {
      throw new Error("the browser opened no page to render into");
    }

    devtools = await BrowserDevtools.connect(target.webSocketDebuggerUrl);
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
    // The compositor is the frame source from here: a capture is a lookup of
    // what it has already committed, not a request for a fresh surface.
    frames = await startScreencast(devtools, encoding);
  } catch (error) {
    child.kill();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  let closed = false;
  /** The identity of the last frame handed to the runner. */
  let sequence = 0;
  /** The mode the last frame was composed in, so a switch settles once. */
  let overlay = false;

  const connected = (): Devtools => {
    if (closed || devtools === undefined) {
      throw new Error("The rasteriser is closed.");
    }

    return devtools;
  };

  /**
   * The next frame the renderer has not already given us, composed in
   * `wantOverlay`.
   *
   * A mode change is spent before it is answered: a frame the compositor
   * committed before the switch would carry the old mode, so that one is
   * consumed and the next frame is the one the caller asked for.
   */
  const nextFrame = async (wantOverlay: boolean): Promise<Uint8Array> => {
    const format = wantOverlay ? "png" : (options.stillFormat ?? "jpeg");

    if (format !== encoding) {
      await frames?.stop();
      frames = await startScreencast(connected(), format);
      encoding = format;
      sequence = 0;
    }

    if (frames === undefined) throw new Error("The rasteriser is closed.");

    if (wantOverlay !== overlay) {
      await setOverlayMode(connected(), wantOverlay);
      overlay = wantOverlay;
      sequence = (await frames.next(sequence)).sequence;
    }

    const frame = await frames.next(sequence);
    sequence = frame.sequence;
    return frame.bytes;
  };

  return {
    capture(): Promise<Uint8Array> {
      return nextFrame(false);
    },

    captureOverlay(): Promise<Uint8Array> {
      return nextFrame(true);
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;

      await frames?.stop();
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
export async function setOverlayMode(
  devtools: Devtools,
  on: boolean,
): Promise<void> {
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
        if (host !== null) {
          if (host.dataset["panelOverlayBackground"] === undefined) {
            host.dataset["panelOverlayBackground"] = host.style.background;
          }
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
