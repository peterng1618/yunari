// @vitest-environment jsdom
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CdpReply, Devtools } from "./panel-raster.js";
import {
  chromiumArguments,
  connectDevtools,
  createPageRasterizer,
  setOverlayMode,
  startBrowser,
  startScreencast,
} from "./panel-raster.js";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

interface Sent {
  readonly method: string;
  readonly params: Record<string, unknown>;
}

/** Records every request and lets a test push the events the browser would. */
function fakeDevtools(replies: Record<string, CdpReply> = {}): {
  readonly devtools: Devtools;
  readonly sent: Sent[];
  readonly closePage: () => boolean;
  readonly push: (method: string, params: Record<string, unknown>) => void;
} {
  const sent: Sent[] = [];
  const listeners = new Map<
    string,
    ((params: Record<string, unknown>) => void)[]
  >();
  let closed = false;

  return {
    sent,
    closePage: () => closed,
    push: (method, params) => {
      for (const listener of listeners.get(method) ?? []) listener(params);
    },
    devtools: {
      send: async (method, params = {}) => {
        sent.push({ method, params });
        if (replies[method] !== undefined) return replies[method];
        // The player announces its mount by having the artboard in the DOM.
        if (method === "Runtime.evaluate") {
          return { result: { result: { type: "boolean", value: true } } };
        }
        return { result: {} };
      },
      on: (method, listener) => {
        listeners.set(method, [...(listeners.get(method) ?? []), listener]);
      },
      close: () => {
        closed = true;
      },
    },
  };
}

function request(sent: readonly Sent[], method: string): Sent {
  const found = sent.find((entry) => entry.method === method);
  if (found === undefined) throw new Error(`no ${method} was sent`);
  return found;
}

function frameEvent(data: string, sessionId: number): Record<string, unknown> {
  return { data: Buffer.from(data).toString("base64"), sessionId };
}

describe("startScreencast", () => {
  it("acks a frame when it is consumed, not when it arrives", async () => {
    const { devtools, sent, push } = fakeDevtools();

    const cast = await startScreencast(devtools, "png");

    expect(request(sent, "Page.startScreencast").params).toEqual({
      format: "png",
      everyNthFrame: 1,
    });

    push("Page.screencastFrame", frameEvent("one", 7));
    await Promise.resolve();
    // An unacknowledged frame is what holds the browser's next one back.
    expect(
      sent.some((entry) => entry.method === "Page.screencastFrameAck"),
    ).toBe(false);

    const frame = await cast.next(0);
    expect(frame.sequence).toBe(1);
    expect(Buffer.from(frame.bytes).toString()).toBe("one");
    expect(request(sent, "Page.screencastFrameAck").params).toEqual({
      sessionId: 7,
    });
  });

  it("asks for JPEG 85 when the device renders that encoding itself", async () => {
    const { devtools, sent } = fakeDevtools();

    await startScreencast(devtools, "jpeg");

    expect(request(sent, "Page.startScreencast").params).toEqual({
      format: "jpeg",
      quality: 85,
      everyNthFrame: 1,
    });
  });

  it("answers only with a frame newer than the one already handed over", async () => {
    const { devtools, push } = fakeDevtools();
    const cast = await startScreencast(devtools, "png");

    push("Page.screencastFrame", frameEvent("one", 1));
    const first = await cast.next(0);
    expect(first.sequence).toBe(1);

    // Nothing new yet: the call waits rather than handing back the same frame,
    // which is what would put an old picture on the glass.
    let settled = false;
    const pending = cast.next(first.sequence).then((frame) => {
      settled = true;
      return frame;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    push("Page.screencastFrame", frameEvent("two", 2));
    expect((await pending).sequence).toBe(2);
  });

  it("acks the frame it hands over, not the one it skipped", async () => {
    const { devtools, sent, push } = fakeDevtools();
    const cast = await startScreencast(devtools, "png");

    push("Page.screencastFrame", frameEvent("one", 1));
    push("Page.screencastFrame", frameEvent("two", 2));

    const frame = await cast.next(0);
    expect(frame.sequence).toBe(2);

    const acks = sent.filter(
      (entry) => entry.method === "Page.screencastFrameAck",
    );
    expect(acks.map((entry) => entry.params)).toEqual([{ sessionId: 2 }]);
  });

  it("refuses after a second with no frame", async () => {
    vi.useFakeTimers();
    try {
      const { devtools } = fakeDevtools();
      const cast = await startScreencast(devtools, "png");

      const pending = cast.next(0);
      const refused = expect(pending).rejects.toThrow(/no frame in 1000 ms/);
      await vi.advanceTimersByTimeAsync(1_000);
      await refused;
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops the page's stream once", async () => {
    const { devtools, sent } = fakeDevtools();
    const cast = await startScreencast(devtools, "png");

    await cast.stop();
    await cast.stop();

    expect(
      sent.filter((entry) => entry.method === "Page.stopScreencast"),
    ).toHaveLength(1);
  });
});

describe("setOverlayMode", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function expressionOf(sent: readonly Sent[]): string {
    return String(request(sent, "Runtime.evaluate").params["expression"]);
  }

  it("enters overlay mode with an alpha backdrop", async () => {
    const { devtools, sent } = fakeDevtools();

    await setOverlayMode(devtools, true);

    expect(sent.map((entry) => entry.method)).toEqual([
      "Runtime.evaluate",
      "Emulation.setDefaultBackgroundColorOverride",
    ]);

    const expression = expressionOf(sent);
    expect(expression).toContain("if (true)");
    expect(expression).toContain("yunari-panel-overlay");
    expect(expression).toContain("[data-yunari-background-media]");
    expect(expression).toContain("[data-yunari-artboard-plate]");
    expect(expression).toContain("[data-yunari-display-disc]");
    expect(expression).toContain('host.style.background = "transparent"');
    expect(expression).toContain('host.dataset["panelOverlayBackground"]');
    // The save happens only once; every later entry re-asserts the clear.
    expect(expression).toContain("if (style === null)");

    expect(
      request(sent, "Emulation.setDefaultBackgroundColorOverride").params,
    ).toEqual({ color: { r: 0, g: 0, b: 0, a: 0 } });
  });

  it("adds no second style on a repeat: the guard is in every entry script", async () => {
    const { devtools, sent } = fakeDevtools();

    await setOverlayMode(devtools, true);
    await setOverlayMode(devtools, true);

    const entries = sent.filter((entry) => entry.method === "Runtime.evaluate");
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(String(entry.params["expression"])).toContain(
        "if (style === null)",
      );
    }
  });

  /**
   * The string assertions above cannot tell the pre-fix script from the fixed
   * one — both contain the same text. This executes the emitted script instead,
   * so moving the clear back inside the dataset guard turns it red.
   */
  it("pauses the page video while the overlay hides it, then resumes it", async () => {
    document.body.innerHTML = "";
    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    canvas.dataset["yunari"] = "artboard";
    host.append(canvas);
    const video = document.createElement("video");
    const pause = vi.fn();
    const play = vi.fn(() => Promise.resolve());
    Object.defineProperty(video, "pause", { value: pause });
    Object.defineProperty(video, "play", { value: play });
    // The scene's first-frame probe. Pausing it stops the callback it is
    // waiting on, so a static glass card loses the still it stands on and the
    // overlay comes back as a bare grey tint (seen on the TURZX panel).
    const probe = document.createElement("video");
    probe.dataset["yunariFrameProbe"] = "";
    const probePause = vi.fn();
    const probePlay = vi.fn(() => Promise.resolve());
    Object.defineProperty(probe, "pause", { value: probePause });
    Object.defineProperty(probe, "play", { value: probePlay });
    document.body.append(host, video, probe);

    const { devtools, sent } = fakeDevtools();

    await setOverlayMode(devtools, true);
    new Function(expressionOf(sent))();
    expect(pause).toHaveBeenCalledTimes(1);
    expect(play).not.toHaveBeenCalled();
    expect(
      probePause,
      "the frame probe is not the panel's video",
    ).not.toHaveBeenCalled();

    await setOverlayMode(devtools, false);
    const entries = sent.filter((entry) => entry.method === "Runtime.evaluate");
    new Function(String(entries[entries.length - 1]?.params["expression"]))();
    expect(play).toHaveBeenCalledTimes(1);
    expect(probePlay).not.toHaveBeenCalled();
  });

  it("re-asserts the transparent paint after a fit repaints the host", async () => {
    document.body.innerHTML = "";
    const host = document.createElement("div");
    host.style.background = "#123456";
    const canvas = document.createElement("canvas");
    canvas.dataset["yunari"] = "artboard";
    host.append(canvas);

    const media = document.createElement("div");
    media.setAttribute("data-yunari-background-media", "");
    const plate = document.createElement("div");
    plate.setAttribute("data-yunari-artboard-plate", "");
    plate.style.background = "#010203";
    const disc = document.createElement("div");
    disc.setAttribute("data-yunari-display-disc", "");
    document.body.append(host, plate, media, disc);

    const { devtools, sent } = fakeDevtools();

    await setOverlayMode(devtools, true);
    const enter = new Function(expressionOf(sent)) as () => unknown;
    enter();

    expect(host.style.background).toBe("transparent");
    expect(getComputedStyle(media).display).toBe("none");
    const saved = host.dataset["panelOverlayBackground"];
    expect(saved).toBeDefined();
    expect(saved).not.toBe("transparent");

    // A fit() re-applies the artboard's paint while the mode is still on.
    host.style.background = "#abcdef";
    enter();
    expect(host.style.background).toBe("transparent");
    expect(host.dataset["panelOverlayBackground"]).toBe(saved);

    await setOverlayMode(devtools, false);
    const exits = sent.filter((entry) => entry.method === "Runtime.evaluate");
    const exit = new Function(
      String(exits[exits.length - 1]?.params["expression"]),
    ) as () => unknown;
    exit();

    expect(host.style.background).toBe(saved);
    expect(host.dataset["panelOverlayBackground"]).toBeUndefined();
    expect(document.getElementById("yunari-panel-overlay")).toBeNull();
  });
});

describe("chromiumArguments", () => {
  it("starts one browser with the panel flags", () => {
    expect(chromiumArguments("C:/tmp/yunari-raster-1")).toEqual([
      "--headless=new",
      "--remote-debugging-port=0",
      "--user-data-dir=C:/tmp/yunari-raster-1",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      // Every panel is the same origin, so one renderer serves them all.
      "--process-per-site",
      "about:blank",
    ]);
  });
});

describe("createPageRasterizer", () => {
  const options = {
    url: "http://127.0.0.1:1/?display=strip",
    geometry: { width: 800, height: 480 },
  };

  it("navigates the page at the panel geometry before returning", async () => {
    const { devtools, sent } = fakeDevtools();

    const page = await createPageRasterizer(devtools, options, async () => {});

    expect(sent.map((entry) => entry.method)).toEqual([
      "Page.enable",
      "Emulation.setDeviceMetricsOverride",
      "Page.navigate",
      "Runtime.evaluate",
    ]);
    expect(request(sent, "Emulation.setDeviceMetricsOverride").params).toEqual({
      width: 800,
      height: 480,
      deviceScaleFactor: 1,
      mobile: false,
    });
    expect(request(sent, "Page.navigate").params).toEqual({ url: options.url });

    await page.close();
  });

  it("closes its page, target and socket, leaving the browser alone", async () => {
    const { devtools, sent, closePage, push } = fakeDevtools();
    const closeTarget = vi.fn(async () => {});

    const page = await createPageRasterizer(devtools, options, closeTarget);

    const capturing = page.capture();
    setTimeout(() => push("Page.screencastFrame", frameEvent("one", 1)), 0);
    await capturing;

    await page.close();

    expect(sent.some((entry) => entry.method === "Page.stopScreencast")).toBe(
      true,
    );
    expect(closeTarget).toHaveBeenCalledTimes(1);
    expect(closePage()).toBe(true);
    // The browser's own lifecycle is the caller's: this page sends no Target.*.
    expect(sent.some((entry) => entry.method.startsWith("Target."))).toBe(
      false,
    );
  });
});

describe("connectDevtools", () => {
  /** The minimum a WebSocket needs to open, send and close under the client. */
  class FakeSocket {
    static last: FakeSocket | undefined;
    private readonly listeners = new Map<
      string,
      Set<(event: { readonly data?: string }) => void>
    >();

    constructor(readonly url: string) {
      FakeSocket.last = this;
    }

    addEventListener(
      type: string,
      listener: (event: { readonly data?: string }) => void,
    ): void {
      const set = this.listeners.get(type) ?? new Set();
      set.add(listener);
      this.listeners.set(type, set);
      if (type === "open") queueMicrotask(() => this.dispatch("open"));
    }

    removeEventListener(
      type: string,
      listener: (event: { readonly data?: string }) => void,
    ): void {
      this.listeners.get(type)?.delete(listener);
    }

    send(): void {}

    close(): void {
      this.dispatch("close");
    }

    private dispatch(type: string): void {
      for (const listener of this.listeners.get(type) ?? []) listener({});
    }
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a pending send when the devtools socket closes", async () => {
    vi.stubGlobal("WebSocket", FakeSocket);

    const devtools = await connectDevtools("ws://fake/devtools/page/1");
    const pending = devtools.send("Page.enable");
    FakeSocket.last?.close();

    const outcome = await Promise.race([
      pending.then(
        () => "resolved",
        () => "rejected",
      ),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve("waiting"), 100);
      }),
    ]);

    expect(outcome).toBe("rejected");
  });
});

describe("startBrowser", () => {
  it("kills the child when the devtools port never starts", async () => {
    const child = Object.assign(new EventEmitter(), {
      stderr: new EventEmitter(),
      kill: vi.fn(),
      exitCode: null,
    });
    spawnMock.mockReturnValue(child);
    queueMicrotask(() => child.emit("exit", 1));

    await expect(
      startBrowser("C:/fake/chrome.exe", "C:/tmp/profile"),
    ).rejects.toThrow(/before starting/);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
});
