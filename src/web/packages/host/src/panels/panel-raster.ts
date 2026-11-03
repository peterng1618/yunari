import { type ChildProcess, spawn } from "node:child_process";
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
/** A one-shot wait for the page to say its stream is live and its background
 *  picture is ready; a page that never reports either keeps what it has
 *  painted after this. */
const LIVE_WAIT_MS = 6_000;

export interface RasterPageOptions {
  /** The player page for a display, including its session. */
  readonly url: string;
  readonly geometry: PanelGeometry;
  /** The still encoding the device consumes; JPEG when it states none. */
  readonly stillFormat?: "jpeg" | "png";
  /**
   * Photograph the page once instead of reading its compositor frames.
   *
   * A panel consumes a stream, but a preview or a thumbnail is one instant:
   * the screencast's first frame can still be the blank page before the theme
   * paints, while a screenshot waits for the live signal and composes then.
   */
  readonly oneShot?: boolean;
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
 * pushes every commit instead, in order, and stops pushing while acks are
 * outstanding — the back-pressure a panel wants, and the only way the host can
 * send the frame that is current rather than the frame that was current.
 */
export async function startScreencast(
  devtools: Devtools,
  format: "jpeg" | "png",
): Promise<Screencast> {
  let sequence = 0;
  let newest: LiveFrame | undefined;
  /** The frame the browser sent and has not been told we are done with. */
  let unacked: number | undefined;
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
    unacked = typeof sessionId === "number" ? sessionId : undefined;

    const resolve = waiting;
    waiting = undefined;
    resolve?.(frame);
  });

  /**
   * Tells the browser this frame is spent.
   *
   * **The ack is the throttle.** Chromium stops producing frames once a few
   * are unacknowledged, which is the back-pressure a panel wants: the browser
   * encodes one frame per frame the host actually consumes, instead of encoding
   * and shipping ten a second that a 13-per-second wire throws away.
   */
  const ack = (): void => {
    const sessionId = unacked;
    if (sessionId === undefined) return;
    unacked = undefined;

    void devtools
      .send("Page.screencastFrameAck", { sessionId })
      .catch(() => undefined);
  };

  await devtools.send("Page.startScreencast", {
    format,
    ...(format === "jpeg" ? { quality: 85 } : {}),
    everyNthFrame: 1,
  });

  return {
    async next(after: number): Promise<LiveFrame> {
      const available = newest;
      if (available !== undefined && available.sequence > after) {
        ack();
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
          ack();
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
  /** Closes the socket and settles every request still waiting on it. */
  close(): void;
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
      this.shutdown("the browser's devtools socket closed");
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

  /** Stops every waiter at once: a dead browser has no reply to give. */
  private shutdown(message: string): void {
    if (this.closed) return;
    this.closed = true;

    for (const pending of this.pending.values()) {
      pending.settle();
      pending.reject(new Error(`${message} before ${pending.method}`));
    }
    this.pending.clear();
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
    this.shutdown("the browser's devtools socket closed");
    this.socket.close();
  }
}

/** Opens one devtools socket; the browser-level and page-level clients share it. */
export async function connectDevtools(url: string): Promise<Devtools> {
  return await BrowserDevtools.connect(url);
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

/**
 * Every flag the shared browser starts with.
 *
 * The three throttling flags matter to a panel: Chromium otherwise slows timers
 * and rendering for a target it treats as backgrounded, and a panel keeps
 * updating while nobody is looking at it. They keep an occluded window
 * unthrottled; they do not make a hidden tab visible — `newWindow: true` does.
 */
export function chromiumArguments(profile: string): readonly string[] {
  return [
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
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    // Every panel page is the same origin, and one renderer can hold them all:
    // the default is one renderer per window, which pays the same heap and
    // code pages once per panel.
    "--process-per-site",
    // No compositor or canvas-quality switches: software canvas rasterisation
    // banded the glass gradients on the real panels, so the renderer keeps the
    // accelerated path even though it costs private bytes.
    // A panel is a display of its own; a URL bar or scrollbar in the capture
    // would be part of the frame.
    "about:blank",
  ];
}

export async function startBrowser(
  executable: string,
  profile: string,
): Promise<{ readonly child: ChildProcess; readonly endpoint: string }> {
  const child = spawn(executable, chromiumArguments(profile), {
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });

  try {
    const endpoint = await waitForEndpoint(child);
    return { child, endpoint };
  } catch (error) {
    // The caller never sees this child, so this is its only chance to free it.
    try {
      child.kill();
    } catch {
      // It exited on its own.
    }
    throw error;
  }
}

/**
 * One `Page.captureScreenshot` of the artboard, clipped to the panel.
 *
 * **The overlay is photographed, not screencast.** A screencast frame is a
 * surface the renderer had already committed, and hiding the media layer is a
 * script the compositor applies afterwards: the frame that follows the switch
 * can still carry the video, which for a 464x1920 panel is a 1.3 MB PNG the
 * device refuses (512,000-byte cap) where the UI alone is 48 KB. A screenshot
 * is composed after the script, so the bytes are the UI by construction.
 */
async function shot(
  devtools: Devtools,
  geometry: PanelGeometry,
  format: "jpeg" | "png",
): Promise<Uint8Array> {
  const reply = await devtools.send("Page.captureScreenshot", {
    format,
    ...(format === "jpeg" ? { quality: 85 } : {}),
    clip: {
      x: 0,
      y: 0,
      width: geometry.width,
      height: geometry.height,
      scale: 1,
    },
    // The page is exactly the clip size, so nothing here is off-screen.
    captureBeyondViewport: false,
  });

  const data = reply.result?.["data"];
  if (typeof data !== "string") {
    throw new Error("the browser answered a screenshot with no image");
  }

  return new Uint8Array(Buffer.from(data, "base64"));
}

/**
 * Starts a page on `url` at exactly `geometry` and captures it.
 *
 * The page is navigated once and screencast for the rest of its life, so a
 * live theme's samples keep arriving over its own stream and a capture returns
 * the newest one rather than asking the renderer to compose on demand. The
 * target and the browser are the caller's: `closePage` closes this page's
 * target, and this function closes only its own socket.
 */
export async function createPageRasterizer(
  devtools: Devtools,
  options: RasterPageOptions,
  closePage: () => Promise<void>,
): Promise<Rasterizer> {
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

  let closed = false;
  let frames: Screencast | undefined;
  /** The identity of the last frame handed to the runner. */
  let sequence = 0;
  /** True while the page is composing without its picture, for an overlay. */
  let overlay = false;
  /** Temporary probe: the first overlay, returned forever when asked. */
  let frozenOverlay: Uint8Array | undefined;
  const connected = (): Devtools => {
    if (closed) {
      throw new Error("The rasteriser is closed.");
    }

    return devtools;
  };

  /**
   * The next still the compositor has not already given us.
   *
   * **A screencast starts on the first still, not at page load.** A panel that
   * plays its own video asks for no stills at all, and a screencast of a
   * 464x1920 page decoding video is a compositor running at video rate for
   * pixels nobody reads — CPU the device's own feed then competes with.
   */
  const nextFrame = async (): Promise<Uint8Array> => {
    if (closed) throw new Error("The rasteriser is closed.");

    // A still is the theme with its picture: the overlay leaves a transparent
    // backdrop behind, and a JPEG has no alpha to carry it.
    if (overlay) {
      await setOverlayMode(connected(), false);
      overlay = false;
    }

    frames ??= await startScreencast(
      connected(),
      options.stillFormat ?? "jpeg",
    );

    const frame = await frames.next(sequence);
    sequence = frame.sequence;
    return frame.bytes;
  };

  return {
    async capture(): Promise<Uint8Array> {
      if (options.oneShot === true) {
        await waitForLive(connected());
        return shot(
          connected(),
          options.geometry,
          options.stillFormat ?? "png",
        );
      }
      return await nextFrame();
    },

    async captureOverlay(): Promise<Uint8Array> {
      if (
        process.env["YUNARI_PANEL_FREEZE_OVERLAY"] === "1" &&
        frozenOverlay !== undefined
      ) {
        return frozenOverlay;
      }

      // **Re-asserted on every capture, never remembered.** The mode lives in
      // the page: a publish reload navigates the document and takes the
      // injected style and the host's transparent paint with it. Keeping a
      // "already on" flag left the overlay opaque over the device's still-
      // playing clip — the video looked frozen until the panel was reassigned
      // (TURZX, 2026-11-03). The script is idempotent, so re-entry is cheap;
      // switching back stays a still's job.
      await setOverlayMode(connected(), true);
      overlay = true;

      const image = await shot(connected(), options.geometry, "png");

      frozenOverlay ??= image;
      return image;
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;

      await frames?.stop();
      await closePage().catch(() => {});
      devtools.close();
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
            // The board's plate carries the artboard's paint as its own layer,
            // and it sits above the host fill. A theme whose paint is opaque —
            // including the black fallback of one that declares no colour —
            // would otherwise come back with the overlay and hide the clip.
            "[data-yunari-artboard-plate]{background:transparent !important}" +
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
        // The media layer is hidden and the device plays its own clip: a video
        // left decoding is frames nobody reads. The scene's first-frame probe
        // is the exception — it is mid-seek for the still a static glass card
        // stands on, and a paused probe never delivers that frame.
        for (const media of document.querySelectorAll(
          "video:not([data-yunari-frame-probe])",
        ))
          media.pause();
      } else {
        style?.remove();
        if (host !== null && host.dataset["panelOverlayBackground"] !== undefined) {
          host.style.background = host.dataset["panelOverlayBackground"];
          delete host.dataset["panelOverlayBackground"];
        }
        // A still capture shows the page's own picture; autoplay may refuse,
        // which is the page's state rather than a failed capture.
        for (const media of document.querySelectorAll(
          "video:not([data-yunari-frame-probe])",
        )) {
          const started = media.play();
          if (started !== undefined) started.catch(() => {});
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

/**
 * Waits for the page to say its stream is live, so a one-shot picture does not
 * photograph the connection strip or the blank page before the theme paints.
 *
 * The player's own live marker (`data-yunari-live`) says the stream started,
 * and the background layer's own media says its picture is ready: a theme's
 * image loads after the stream, and a thumbnail without it advertises a
 * different theme. A page that never reports either is bounded and photographed
 * as it stands; no second readiness model is added to the player.
 */
async function waitForLive(devtools: Devtools): Promise<void> {
  const deadline = Date.now() + LIVE_WAIT_MS;

  while (Date.now() < deadline) {
    const reply = await devtools.send("Runtime.evaluate", {
      expression: `(() => {
        if (document.documentElement.dataset["yunariLive"] !== "true") return false;
        const media = document.querySelectorAll(
          "[data-yunari-background-media] img, [data-yunari-background-media] video",
        );
        return [...media].every((element) =>
          element.tagName === "IMG"
            ? element.complete && element.naturalWidth > 0
            : element.readyState >= 2,
        );
      })()`,
      returnByValue: true,
    });
    const value = reply.result?.["result"] as { value?: unknown } | undefined;
    if (value?.value === true) return;

    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
