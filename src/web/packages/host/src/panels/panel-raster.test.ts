// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Devtools } from "./panel-raster.js";
import { setOverlayMode, startScreencast } from "./panel-raster.js";

interface Sent {
  readonly method: string;
  readonly params: Record<string, unknown>;
}

/** Records every request and lets a test push the events the browser would. */
function fakeDevtools(): {
  readonly devtools: Devtools;
  readonly sent: Sent[];
  readonly push: (method: string, params: Record<string, unknown>) => void;
} {
  const sent: Sent[] = [];
  const listeners = new Map<
    string,
    ((params: Record<string, unknown>) => void)[]
  >();

  return {
    sent,
    push: (method, params) => {
      for (const listener of listeners.get(method) ?? []) listener(params);
    },
    devtools: {
      send: async (method, params = {}) => {
        sent.push({ method, params });
        return { result: {} };
      },
      on: (method, listener) => {
        listeners.set(method, [...(listeners.get(method) ?? []), listener]);
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
  it("pushes every frame in the device's encoding and acks each one", async () => {
    const { devtools, sent, push } = fakeDevtools();

    const cast = await startScreencast(devtools, "png");

    expect(request(sent, "Page.startScreencast").params).toEqual({
      format: "png",
      everyNthFrame: 1,
    });

    push("Page.screencastFrame", frameEvent("one", 7));
    await Promise.resolve();

    expect(request(sent, "Page.screencastFrameAck").params).toEqual({
      sessionId: 7,
    });
    const frame = await cast.next(0);
    expect(frame.sequence).toBe(1);
    expect(Buffer.from(frame.bytes).toString()).toBe("one");
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
  it("re-asserts the transparent paint after a fit repaints the host", async () => {
    document.body.innerHTML = "";
    const host = document.createElement("div");
    host.style.background = "#123456";
    const canvas = document.createElement("canvas");
    canvas.dataset["yunari"] = "artboard";
    host.append(canvas);

    const media = document.createElement("div");
    media.setAttribute("data-yunari-background-media", "");
    const disc = document.createElement("div");
    disc.setAttribute("data-yunari-display-disc", "");
    document.body.append(host, media, disc);

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
