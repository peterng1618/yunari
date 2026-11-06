// @vitest-environment jsdom
import { act, type ReactElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginFrameSession } from "./use-plugin-frame.js";
import { usePluginFrame } from "./use-plugin-frame.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const THEME = { palette: {}, typeTokens: {} };

let host: HTMLDivElement | undefined;
let root: Root | undefined;

afterEach(async () => {
  const mounted = root;
  root = undefined;
  await act(async () => {
    mounted?.unmount();
  });
  host?.remove();
  host = undefined;
  document.body.replaceChildren();
});

function mount(element: ReactElement): void {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(element);
  });
}

function harness(
  onRequest: (request: unknown, token: string | undefined) => Promise<unknown>,
) {
  const latest: { current: PluginFrameSession | undefined } = {
    current: undefined,
  };

  function Harness(): ReactElement {
    const iframe = useRef<HTMLIFrameElement | null>(null);
    latest.current = usePluginFrame({
      pluginKey: "local/acme",
      entry: "index.html",
      iframe,
      theme: THEME,
      onRequest: onRequest as never,
    });
    return <iframe ref={iframe} title="plugin" />;
  }

  mount(<Harness />);
  const frame = document.querySelector("iframe");
  if (frame === null) throw new Error("the harness rendered no frame");
  return { latest, frame };
}

function request(overrides: Record<string, unknown> = {}): unknown {
  return {
    type: "yunari.frame.request",
    nonce: "unknown",
    id: "req-1",
    method: "settings.get",
    params: {},
    ...overrides,
  };
}

async function deliver(frame: HTMLIFrameElement, data: unknown): Promise<void> {
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent("message", { data, source: frame.contentWindow }),
    );
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useRealTimers();
});

describe("usePluginFrame", () => {
  it("passes a gesture token only to a write method", async () => {
    const onRequest = vi.fn(async () => ({ ok: true }));
    const { latest } = harness(onRequest);

    let token: string | undefined;
    act(() => {
      token = latest.current?.grantGesture();
    });
    expect(token).toEqual(expect.any(String));

    await act(async () => {
      await latest.current?.request("settings.set", { a: 1 });
    });
    expect(onRequest).toHaveBeenCalledWith(
      expect.objectContaining({ method: "settings.set", params: { a: 1 } }),
      token,
    );

    await act(async () => {
      await latest.current?.request("settings.get", {});
    });
    expect(onRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({ method: "settings.get" }),
      undefined,
    );
  });

  it("refuses a write with no gesture", async () => {
    const onRequest = vi.fn();
    const { latest } = harness(onRequest);
    await expect(
      latest.current?.request("settings.set", {}),
    ).rejects.toThrow("host control");
    expect(onRequest).not.toHaveBeenCalled();
  });

  it("ignores a message from another source", async () => {
    const onRequest = vi.fn();
    const { frame } = harness(onRequest);
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: request(),
          source: window,
        }),
      );
    });
    expect(onRequest).not.toHaveBeenCalled();
    expect(frame).toBeDefined();
  });

  it("ignores a message with the wrong nonce", async () => {
    const onRequest = vi.fn();
    const { frame } = harness(onRequest);
    await deliver(frame, request({ nonce: "wrong", id: "1" }));
    expect(onRequest).not.toHaveBeenCalled();
  });

  it("answers a valid read request", async () => {
    const onRequest = vi.fn(async () => ({ theme: "dark" }));
    const { latest, frame } = harness(onRequest);
    const post = vi.spyOn(frame.contentWindow as Window, "postMessage");

    await deliver(
      frame,
      request({ nonce: latest.current?.nonce, id: "read-1" }),
    );

    expect(onRequest).toHaveBeenCalledWith(
      expect.objectContaining({ method: "settings.get", id: "read-1" }),
      undefined,
    );
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "yunari.frame.result",
        id: "read-1",
        ok: true,
        value: { theme: "dark" },
      }),
      "*",
    );
  });

  it("accepts a write carrying the outstanding token exactly once", async () => {
    const onRequest = vi.fn(async () => ({ ok: true }));
    const { latest, frame } = harness(onRequest);

    let token: string | undefined;
    act(() => {
      token = latest.current?.grantGesture();
    });
    const nonce = latest.current?.nonce;

    await deliver(
      frame,
      request({
        nonce,
        id: "write-1",
        method: "settings.set",
        gestureToken: token,
      }),
    );
    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(onRequest).toHaveBeenCalledWith(
      expect.objectContaining({ method: "settings.set" }),
      token,
    );

    await deliver(
      frame,
      request({
        nonce,
        id: "write-2",
        method: "settings.set",
        gestureToken: token,
      }),
    );
    expect(onRequest).toHaveBeenCalledTimes(1);
  });

  it("refuses a write whose token was never granted", async () => {
    const onRequest = vi.fn();
    const { latest, frame } = harness(onRequest);
    await deliver(
      frame,
      request({
        nonce: latest.current?.nonce,
        id: "write-1",
        method: "settings.set",
        gestureToken: "forged",
      }),
    );
    expect(onRequest).not.toHaveBeenCalled();
  });

  it("expires a gesture after thirty seconds", async () => {
    vi.useFakeTimers();
    const onRequest = vi.fn();
    const { latest, frame } = harness(onRequest);

    let token: string | undefined;
    act(() => {
      token = latest.current?.grantGesture();
    });
    await act(async () => {
      vi.advanceTimersByTime(30_001);
    });

    await deliver(
      frame,
      request({
        nonce: latest.current?.nonce,
        id: "write-1",
        method: "settings.set",
        gestureToken: token,
      }),
    );
    expect(onRequest).not.toHaveBeenCalled();
  });

  it("sends the initial settings once the frame is ready", async () => {
    const onRequest = vi.fn();
    const { latest, frame } = harness(onRequest);
    const post = vi.spyOn(frame.contentWindow as Window, "postMessage");

    await deliver(frame, { type: "yunari.frame.event", event: "ready" });

    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "yunari.frame.init",
        nonce: latest.current?.nonce,
        pluginKey: "local/acme",
      }),
      "*",
    );
    expect(latest.current?.ready).toBe(true);
  });

  it("answers a refused method with a stated reason", async () => {
    const onRequest = vi.fn(async () => {
      throw new Error("The host refused that request.");
    });
    const { latest, frame } = harness(onRequest);
    const post = vi.spyOn(frame.contentWindow as Window, "postMessage");

    await deliver(
      frame,
      request({ nonce: latest.current?.nonce, id: "read-1" }),
    );

    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "yunari.frame.result",
        id: "read-1",
        ok: false,
        reason: "The host refused that request.",
      }),
      "*",
    );
  });
});
