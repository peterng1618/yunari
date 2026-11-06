// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { PluginFrame, pluginFrameSrc } from "./plugin-frame.js";

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

function renderFrame(
  onRequest: (
    request: unknown,
    token: string | undefined,
  ) => Promise<unknown> = async () => undefined,
): void {
  mount(
    <PluginFrame
      pluginKey="local/acme"
      entry="index.html"
      title="Acme"
      settings={{}}
      theme={THEME}
      onRequest={onRequest as never}
    />,
  );
}

it("draws a script-only sandbox pointing at the plugin's own UI route", () => {
  renderFrame();
  const frame = document.querySelector("iframe");
  expect(frame).not.toBeNull();
  expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
  expect(frame?.getAttribute("allow")).toBeNull();
  expect(frame?.getAttribute("title")).toBe("Acme");
  expect(frame?.getAttribute("src")).toBe(
    "/api/extensions/local/acme/ui/index.html",
  );
});

it("encodes a nested entry and keeps a plugin key in two segments", () => {
  expect(pluginFrameSrc("local/acme", "settings/index.html")).toBe(
    "/api/extensions/local/acme/ui/settings/index.html",
  );
  expect(pluginFrameSrc("local/acme", "a b.html")).toBe(
    "/api/extensions/local/acme/ui/a%20b.html",
  );
});

it("ignores a message from another source", async () => {
  const onRequest = vi.fn();
  renderFrame(onRequest);
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "yunari.frame.request",
          nonce: "x",
          id: "1",
          method: "settings.get",
          params: {},
        },
        source: window,
      }),
    );
  });
  expect(onRequest).not.toHaveBeenCalled();
});

it("shows the plugin name and a retry when the frame fails", async () => {
  renderFrame();
  const frame = document.querySelector("iframe");
  await act(async () => {
    frame?.dispatchEvent(new Event("error"));
  });

  expect(document.body.textContent).toContain("Acme");
  const retry = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Retry",
  );
  expect(retry).toBeDefined();

  await act(async () => {
    retry?.click();
  });
  expect(document.querySelector("iframe")).not.toBeNull();
  expect(
    [...document.querySelectorAll("button")].some(
      (button) => button.textContent === "Retry",
    ),
  ).toBe(false);
});
