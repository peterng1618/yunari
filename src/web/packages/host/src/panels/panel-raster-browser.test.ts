import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { CdpReply, Devtools } from "./panel-raster.js";
import {
  createRasterBrowser,
  type RasterBrowser,
} from "./panel-raster-browser.js";

const BROWSER_URL = "ws://127.0.0.1:9222/devtools/browser/abc";
const PAGE_URL = "ws://127.0.0.1:9222/devtools/page/";

interface Sent {
  readonly method: string;
  readonly params: Record<string, unknown>;
}

/** Records requests and answers with what the browser would. */
class FakeClient implements Devtools {
  readonly sent: Sent[] = [];
  closed = false;
  private readonly replies = new Map<string, CdpReply | (() => CdpReply)>();
  private readonly failures = new Map<string, string>();

  reply(method: string, reply: CdpReply | (() => CdpReply)): void {
    this.replies.set(method, reply);
  }

  fail(method: string, message: string): void {
    this.failures.set(method, message);
  }

  async send(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<CdpReply> {
    this.sent.push({ method, params });

    const failure = this.failures.get(method);
    if (failure !== undefined) throw new Error(failure);

    const reply = this.replies.get(method);
    if (typeof reply === "function") return reply();
    return reply ?? { result: {} };
  }

  on(): void {}

  close(): void {
    this.closed = true;
  }
}

interface FakeChild {
  exitCode: number | null;
  kill: () => void;
  once: (event: string, listener: (code: number | null) => void) => void;
  off: (event: string, listener: (code: number | null) => void) => void;
  emitExit: (code: number | null) => void;
}

function fakeChild(): FakeChild {
  const listeners = new Set<(code: number | null) => void>();
  const child: FakeChild = {
    exitCode: null,
    kill: vi.fn(() => {
      child.exitCode = 0;
      child.emitExit(0);
    }),
    once: (event, listener) => {
      if (event === "exit") listeners.add(listener);
    },
    off: (event, listener) => {
      if (event === "exit") listeners.delete(listener);
    },
    emitExit: (code) => {
      for (const listener of listeners) listener(code);
    },
  };
  return child;
}

function harness(): {
  readonly spawn: ReturnType<typeof vi.fn>;
  readonly connect: ReturnType<typeof vi.fn>;
  readonly children: FakeChild[];
  readonly profiles: string[];
  readonly clients: Map<string, FakeClient>;
  failPage: (method: string, message: string) => void;
  holdPageConnect: () => void;
  releasePageConnect: () => void;
  client: (url: string) => FakeClient;
} {
  const children: FakeChild[] = [];
  const profiles: string[] = [];
  const clients = new Map<string, FakeClient>();
  let targetCount = 0;
  let pageFailure: { method: string; message: string } | undefined;
  let pageGate: Promise<void> | undefined;
  let releaseGate: (() => void) | undefined;

  const spawn = vi.fn(async (_executable: string, profile: string) => {
    const child = fakeChild();
    children.push(child);
    profiles.push(profile);
    return {
      child: child as unknown as ChildProcess,
      endpoint: BROWSER_URL,
    };
  });

  const connect = vi.fn(async (url: string) => {
    if (url.startsWith(PAGE_URL) && pageGate !== undefined) await pageGate;

    const client = new FakeClient();
    client.reply("Target.createTarget", () => {
      targetCount += 1;
      return { result: { targetId: `T${targetCount}` } };
    });
    client.reply("Runtime.evaluate", {
      result: { result: { type: "boolean", value: true } },
    });
    if (url.startsWith(PAGE_URL) && pageFailure !== undefined) {
      client.fail(pageFailure.method, pageFailure.message);
    }
    clients.set(url, client);
    return client as Devtools;
  });

  const client = (url: string): FakeClient => {
    const found = clients.get(url);
    if (found === undefined) throw new Error(`no client for ${url}`);
    return found;
  };

  return {
    spawn,
    connect,
    children,
    profiles,
    clients,
    client,
    failPage: (method, message) => {
      pageFailure = { method, message };
    },
    holdPageConnect: () => {
      pageGate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });
    },
    releasePageConnect: () => {
      releaseGate?.();
      pageGate = undefined;
    },
  };
}

function browserOver(
  over: ReturnType<typeof harness>,
  more: Partial<Parameters<typeof createRasterBrowser>[0]> = {},
): RasterBrowser {
  return createRasterBrowser({
    executable: "C:/fake/chrome.exe",
    spawn: over.spawn as never,
    connect: over.connect as never,
    idleStopMs: 50,
    ...more,
  });
}

function pageOptions(
  url = "http://127.0.0.1:1/?display=strip",
  width = 4,
  height = 4,
): { url: string; geometry: { width: number; height: number } } {
  return { url, geometry: { width, height } };
}

function request(client: FakeClient, method: string): Sent {
  const found = client.sent.find((entry) => entry.method === method);
  if (found === undefined) throw new Error(`no ${method} was sent`);
  return found;
}

/** Lets queued work run without depending on a timer. */
async function flush(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(check: () => boolean, ms = 2_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check() && Date.now() < deadline) await pause(5);
}

describe("createRasterBrowser", () => {
  it("starts one browser for concurrent creates", async () => {
    const over = harness();
    const browser = browserOver(over);

    const [first, second] = await Promise.all([
      browser.create(pageOptions()),
      browser.create(pageOptions()),
    ]);

    expect(over.spawn).toHaveBeenCalledTimes(1);
    expect(
      over.connect.mock.calls.filter(([url]) => String(url) === BROWSER_URL),
    ).toHaveLength(1);
    expect(
      request(over.client(BROWSER_URL), "Target.createTarget").params,
    ).toEqual({ url: "about:blank", newWindow: true });
    expect(over.children).toHaveLength(1);

    await Promise.all([first.close(), second.close()]);
    await browser.stop();
  });

  it("opens every target as its own headless window", async () => {
    const over = harness();
    const browser = browserOver(over);

    const page = await browser.create(pageOptions());

    expect(request(over.client(BROWSER_URL), "Target.createTarget").params).toEqual(
      { url: "about:blank", newWindow: true },
    );
    expect(over.connect).toHaveBeenNthCalledWith(2, `${PAGE_URL}T1`);

    await page.close();
    await browser.stop();
  });

  it("gives each page its own geometry and URL", async () => {
    const over = harness();
    const browser = browserOver(over);

    const first = await browser.create(
      pageOptions("http://127.0.0.1:1/?display=strip", 800, 480),
    );
    const second = await browser.create(
      pageOptions("http://127.0.0.1:1/?display=tower", 320, 320),
    );

    const firstPage = over.client(`${PAGE_URL}T1`);
    expect(request(firstPage, "Emulation.setDeviceMetricsOverride").params).toEqual(
      {
        width: 800,
        height: 480,
        deviceScaleFactor: 1,
        mobile: false,
      },
    );
    expect(request(firstPage, "Page.navigate").params).toEqual({
      url: "http://127.0.0.1:1/?display=strip",
    });

    const secondPage = over.client(`${PAGE_URL}T2`);
    expect(
      request(secondPage, "Emulation.setDeviceMetricsOverride").params,
    ).toEqual({ width: 320, height: 320, deviceScaleFactor: 1, mobile: false });
    expect(request(secondPage, "Page.navigate").params).toEqual({
      url: "http://127.0.0.1:1/?display=tower",
    });

    await Promise.all([first.close(), second.close()]);
    await browser.stop();
  });

  it("closes its target and arms the idle stop when setup fails", async () => {
    vi.useFakeTimers();
    try {
      const over = harness();
      over.failPage("Page.navigate", "navigation refused");
      const browser = browserOver(over);

      await expect(browser.create(pageOptions())).rejects.toThrow(
        "navigation refused",
      );

      expect(
        request(over.client(BROWSER_URL), "Target.closeTarget").params,
      ).toEqual({ targetId: "T1" });

      await vi.advanceTimersByTimeAsync(50);

      expect(over.children[0]?.kill).toHaveBeenCalled();
      expect(browser.closed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the browser while another rasterizer is active", async () => {
    vi.useFakeTimers();
    try {
      const over = harness();
      const browser = browserOver(over);

      const first = await browser.create(pageOptions());
      const second = await browser.create(pageOptions());

      await first.close();
      await vi.advanceTimersByTimeAsync(500);
      expect(over.children[0]?.kill).not.toHaveBeenCalled();

      await second.close();
      await vi.advanceTimersByTimeAsync(50);
      expect(over.children[0]?.kill).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops the browser after the idle deadline when the last rasterizer closes", async () => {
    vi.useFakeTimers();
    try {
      const over = harness();
      const browser = browserOver(over);

      const page = await browser.create(pageOptions());
      await page.close();

      await vi.advanceTimersByTimeAsync(49);
      expect(over.children[0]?.kill).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(over.children[0]?.kill).toHaveBeenCalled();
      expect(browser.closed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels the idle stop when a create arrives before the deadline", async () => {
    vi.useFakeTimers();
    try {
      const over = harness();
      const browser = browserOver(over);

      const first = await browser.create(pageOptions());
      await first.close();

      await vi.advanceTimersByTimeAsync(49);
      expect(over.children[0]?.kill).not.toHaveBeenCalled();

      const second = await browser.create(pageOptions());
      await vi.advanceTimersByTimeAsync(500);

      expect(over.children[0]?.kill).not.toHaveBeenCalled();
      expect(over.clients.has(`${PAGE_URL}T2`)).toBe(true);

      await second.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops once, removes the profile, and makes later creates fail", async () => {
    const over = harness();
    const browser = browserOver(over);

    await browser.create(pageOptions());
    const first = browser.stop();
    const second = browser.stop();

    expect(second).toBe(first);
    await first;

    expect(browser.closed).toBe(true);
    expect(existsSync(over.profiles[0] ?? "")).toBe(false);
    await expect(browser.create(pageOptions())).rejects.toThrow(/closed/);
  });

  it("reports a child exit once and refuses the next create", async () => {
    const over = harness();
    const onError = vi.fn();
    const browser = browserOver(over, { onError });

    await browser.create(pageOptions());
    over.children[0]?.emitExit(1);
    over.children[0]?.emitExit(1);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]?.[0])).toMatch(/exited/);
    expect(browser.closed).toBe(true);
    await expect(browser.create(pageOptions())).rejects.toThrow(/closed/);
  });

  it("fails a create that resumes after stop", async () => {
    const over = harness();
    const browser = browserOver(over);
    over.holdPageConnect();

    const creating = browser.create(pageOptions());
    await until(
      () =>
        over.connect.mock.calls.some(([url]) =>
          String(url).startsWith(PAGE_URL),
        ),
    );

    const stopping = browser.stop();
    over.releasePageConnect();
    await flush();

    await expect(creating).rejects.toThrow(/closed/);
    await stopping;

    expect(
      request(over.client(BROWSER_URL), "Target.closeTarget").params,
    ).toEqual({ targetId: "T1" });
  });
});
