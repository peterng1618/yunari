import type { ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  connectDevtools,
  createPageRasterizer,
  type Devtools,
  type Rasterizer,
  type RasterPageOptions,
  startBrowser,
} from "./panel-raster.js";

/**
 * The browser every panel shares.
 *
 * **One runtime, one target per panel.** Each `create` asks the browser for a
 * target that is its own headless window. `newWindow: true` is load-bearing: a
 * target created as a tab is hidden in headless Chromium, so its screencast
 * emits nothing and its screenshots stall. The browser, its GPU process, its
 * profile and its cache are shared; the page, geometry, screencast and overlay
 * stay per target.
 *
 * The browser starts on the first panel and stops after the last one has been
 * closed for `idleStopMs`, so a restart does not pay for a runtime no panel is
 * using.
 */

const IDLE_STOP_MS = 5_000;
/** A wedged child must not hold shutdown open; the profile is disposable. */
const EXIT_TIMEOUT_MS = 5_000;
const CLOSED = "The raster browser is closed.";

export interface TargetHandle {
  readonly targetId: string;
  readonly webSocketDebuggerUrl: string;
}

export interface RasterBrowser {
  /** Opens one panel's page in its own window; the caller owns the result. */
  create(options: RasterPageOptions): Promise<Rasterizer>;
  /** Stops the child and removes the profile. Idempotent. */
  stop(): Promise<void>;
  readonly closed: boolean;
}

export interface RasterBrowserOptions {
  readonly executable: string;
  /** Asynchronous failures (a child exit, a failed cleanup), never a failed
   *  `create`, which rejects to the panel's own error path. */
  readonly onError?: (message: string) => void;
  readonly idleStopMs?: number;
  // Test seams; production uses the real spawn, WebSocket and CDP.
  readonly spawn?: typeof startBrowser;
  readonly connect?: typeof connectDevtools;
  readonly openTarget?: (browser: Devtools) => Promise<TargetHandle>;
  readonly closeTarget?: (browser: Devtools, targetId: string) => Promise<void>;
}

/** The page socket behind a target id, on the host the browser announced. */
function pageSocketUrl(endpoint: string, targetId: string): string {
  const url = new URL(endpoint);
  url.pathname = `/devtools/page/${targetId}`;
  return url.toString();
}

async function openWindow(
  browser: Devtools,
  endpoint: string,
): Promise<TargetHandle> {
  const reply = await browser.send("Target.createTarget", {
    url: "about:blank",
    newWindow: true,
  });
  const targetId = reply.result?.["targetId"];
  if (typeof targetId !== "string") {
    throw new Error("the browser opened no target for the panel");
  }

  return { targetId, webSocketDebuggerUrl: pageSocketUrl(endpoint, targetId) };
}

async function closeWindow(browser: Devtools, targetId: string): Promise<void> {
  await browser.send("Target.closeTarget", { targetId });
}

/** Answers once the child exits, or after `ms`; the wait never keeps Node up. */
function killAndWait(child: ChildProcess, ms: number): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();

  return new Promise<void>((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      child.off("exit", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    timer.unref();
    child.once("exit", done);

    try {
      child.kill();
    } catch {
      done();
    }
  });
}

export function createRasterBrowser(
  options: RasterBrowserOptions,
): RasterBrowser {
  const spawnBrowser = options.spawn ?? startBrowser;
  const connect = options.connect ?? connectDevtools;
  const closeTarget = options.closeTarget ?? closeWindow;
  const idleStopMs = options.idleStopMs ?? IDLE_STOP_MS;

  let child: ChildProcess | undefined;
  let profile: string | undefined;
  let endpoint: string | undefined;
  /** The browser-level client: `Target.*` lives here, not on a page socket. */
  let browser: Devtools | undefined;
  let starting: Promise<Devtools> | undefined;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  /** Rasterizers handed out and not closed yet. */
  let active = 0;
  let stopping: Promise<void> | undefined;
  let failureReported = false;

  const report = (message: string): void => {
    if (failureReported) return;
    failureReported = true;
    options.onError?.(message);
  };

  const clearIdle = (): void => {
    if (idle === undefined) return;
    clearTimeout(idle);
    idle = undefined;
  };

  const removeProfile = async (): Promise<void> => {
    const dir = profile;
    profile = undefined;
    if (dir === undefined) return;
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  };

  const assertOpen = (): void => {
    if (closed) throw new Error(CLOSED);
  };

  /** Drops what a failed start left behind; a retry starts clean. */
  const discard = async (): Promise<void> => {
    browser?.close();
    browser = undefined;
    if (child !== undefined) {
      try {
        child.kill();
      } catch {
        // Already gone.
      }
      child = undefined;
    }
    await removeProfile();
  };

  const watch = (process: ChildProcess): void => {
    process.once("exit", (code) => {
      if (stopping !== undefined || closed) return;

      closed = true;
      clearIdle();
      browser?.close();
      browser = undefined;
      report(`the shared browser exited with ${code ?? "no code"}`);
      void removeProfile();
    });
  };

  const startOnce = (): Promise<Devtools> => {
    if (browser !== undefined) return Promise.resolve(browser);
    if (starting !== undefined) return starting;
    if (closed) return Promise.reject(new Error(CLOSED));

    const started = (async (): Promise<Devtools> => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "yunari-raster-"));
      profile = dir;
      assertOpen();

      const spawned = await spawnBrowser(options.executable, dir);
      child = spawned.child;
      endpoint = spawned.endpoint;
      assertOpen();

      const client = await connect(spawned.endpoint);
      if (closed) {
        client.close();
        throw new Error(CLOSED);
      }

      browser = client;
      watch(spawned.child);
      return client;
    })();

    starting = started.then(
      (client) => client,
      async (error: unknown) => {
        starting = undefined;
        await discard();
        throw error;
      },
    );

    return starting;
  };

  const armIdle = (): void => {
    if (idle !== undefined || closed || active > 0) return;

    idle = setTimeout(() => {
      idle = undefined;
      void stop();
    }, idleStopMs);
    idle.unref();
  };

  const stop = (): Promise<void> => {
    if (stopping !== undefined) return stopping;

    stopping = (async (): Promise<void> => {
      closed = true;
      clearIdle();
      starting = undefined;

      browser?.close();
      browser = undefined;

      const process = child;
      child = undefined;
      if (process !== undefined) await killAndWait(process, EXIT_TIMEOUT_MS);

      await removeProfile();
    })();

    return stopping;
  };

  const openTarget =
    options.openTarget ??
    ((client: Devtools) => openWindow(client, endpoint ?? ""));

  const create = async (page: RasterPageOptions): Promise<Rasterizer> => {
    assertOpen();
    clearIdle();

    let browserClient: Devtools | undefined;
    let target: TargetHandle | undefined;
    let pageClient: Devtools | undefined;
    let rasterizer: Rasterizer | undefined;

    try {
      browserClient = await startOnce();
      const client = browserClient;
      assertOpen();

      target = await openTarget(client);
      assertOpen();

      pageClient = await connect(target.webSocketDebuggerUrl);
      assertOpen();

      const targetId = target.targetId;
      rasterizer = await createPageRasterizer(pageClient, page, () =>
        closeTarget(client, targetId),
      );
      assertOpen();
    } catch (error) {
      if (rasterizer !== undefined) {
        await rasterizer.close().catch(() => {});
      } else {
        pageClient?.close();
        if (browserClient !== undefined && target !== undefined) {
          await closeTarget(browserClient, target.targetId).catch(() => {});
        }
      }

      // No panel is attached, but the browser may have started for this
      // attempt: let the idle stop reclaim it rather than leave it running.
      if (active === 0 && browserClient !== undefined && !closed) armIdle();
      throw error;
    }

    if (rasterizer === undefined) throw new Error(CLOSED);
    const opened = rasterizer;

    active += 1;
    clearIdle();

    let released = false;
    return {
      capture: () => opened.capture(),
      captureOverlay: () => opened.captureOverlay(),

      async close(): Promise<void> {
        if (released) return;
        released = true;

        try {
          await opened.close();
        } finally {
          active -= 1;
          if (active === 0 && !closed) armIdle();
        }
      },
    };
  };

  return {
    create,
    stop,
    get closed() {
      return closed;
    },
  };
}
