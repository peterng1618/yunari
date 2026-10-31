// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://192.168.1.10:5227/"}
// **The URL above is the whole reason this file exists.** `main.dom.test.ts`
// runs the same harness at an http URL, so every case there is green whether
// `main.ts` reads the page's scheme or hard-codes `"http"` — and hard-coding it
// is `vg-623` re-created on every display served over https.
// This file is that page: https, paired, its host gone.
// A LAN address rather than a name, because `sweepAddresses("localhost")` is
// empty and a sweep that never runs asserts nothing.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The document `index.html` ships: the top band, the artboard host, the bottom
 *  band, each marked the way the shipped document marks it — the chrome bands
 *  are found by that attribute, and a display without them cannot report
 *  anything. `main.ts` refuses to start without the artboard host. */
function skeleton(): void {
  document.body.replaceChildren();
  const top = document.createElement("div");
  top.id = "yunari-chrome-top";
  top.dataset["yunariChrome"] = "top";
  const host = document.createElement("div");
  host.id = "artboard";
  Object.defineProperty(host, "clientWidth", { value: 412 });
  Object.defineProperty(host, "clientHeight", { value: 839 });
  const bottom = document.createElement("div");
  bottom.id = "yunari-chrome-bottom";
  bottom.dataset["yunariChrome"] = "bottom";
  document.body.append(top, host, bottom);
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** A document the player accepts, so the mount gets past the load and the
 *  follower starts. Its own contents are not what this case is about. */
function mountedEnvelope(): unknown {
  return {
    schemaVersion: "2.0.0",
    fabricVersion: "7.4.0",
    id: "living-room",
    artboard: { width: 1920, height: 1080 },
    metadata: { themeLanguage: "en" },
    globals: {
      typeTokens: {
        heading: { family: "system-ui, sans-serif", weight: "600" },
        body: { family: "system-ui, sans-serif", weight: "400" },
        mono: { family: "monospace", weight: "400" },
      },
    },
    scene: { version: "7.4.0", objects: [] },
  };
}

/** The readings stream: a stub transport, so no socket is opened. */
class SilentEventSource {
  addEventListener(): void {}
  close(): void {}
}

describe("a display served over https", () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
    vi.resetModules();
  });

  /** Microtasks only: the mount, the poll and the sweep are promises. */
  async function flush(): Promise<void> {
    for (let turn = 0; turn < 400; turn += 1) {
      await Promise.resolve();
    }
  }

  it("probes its host over https, at the page's own scheme", async () => {
    // The chart loop's own clock, so a minute of fake time is not ~1900
    // repaints of a scene this case is not about.
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(0);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(
      () => undefined,
    );
    vi.useFakeTimers();
    skeleton();
    history.replaceState(
      {},
      "",
      "/?theme=living-room&display=d1&theme-source=map&session=paired-token",
    );
    vi.stubGlobal("EventSource", SilentEventSource);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );

    const asked: string[] = [];

    Object.defineProperty(window, "fetch", {
      configurable: true,
      writable: true,
      value: vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        asked.push(url);

        // The load's own identity read, which is what stores the pairing the
        // ladder later runs on. Relative, so it is not a probe.
        if (url === "/api/host") {
          return json({ id: "h1", name: "study-pc", port: 5227 });
        }
        if (url.startsWith("/api/published")) {
          // The host has moved: every poll fails, so every tick reports it and
          // the ladder runs.
          throw new Error("down");
        }
        if (url.endsWith("/document")) return json(mountedEnvelope());
        if (url === "/api/themes") return json({ themes: [] });
        // Every probe: a host that is not this display's, so no rung matches
        // and the page never navigates.
        return json({});
      }),
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await import("./main.js");
    await flush();
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();

    // The ladder's probes, and only them: the page's own reads are relative.
    const probes = asked.filter((url) => /^[a-z]+:\/\//.test(url));

    expect(probes.length).toBeGreaterThan(0);
    // The two non-sweep rungs, at the page's scheme. Hard-code `"http"` in
    // `main.ts` and these are http — which is mixed content the browser blocks,
    // so the display never re-finds its host (`vg-623`).
    expect(probes).toContain("https://192.168.1.10:5227/api/host");
    expect(probes).toContain("https://study-pc.local:5227/api/host");
    // And the sweep, which is 253 more: every rung carries the scheme, not only
    // the two that were tried first.
    expect(probes.length).toBeGreaterThan(2);
    expect(probes.filter((url) => url.startsWith("https://")).length).toBe(
      probes.length,
    );
  });
});
