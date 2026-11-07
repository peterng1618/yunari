// @vitest-environment jsdom
import type { InstalledExtension } from "@yunari/extension-api";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { uiCopy } from "../ui-copy.js";
import {
  type PluginSettingsClient,
  PluginSettingsForm,
  type PluginSettingsPage,
  PluginSettingsView,
  pluginSettingsPages,
} from "./plugin-pages.js";

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

function extension(
  page: NonNullable<
    InstalledExtension["contributions"]["settingsPages"]
  >[number],
): InstalledExtension {
  return {
    key: "local/acme",
    name: "Acme",
    publisher: "local",
    version: "1.0.0",
    execution: "declarative",
    capabilities: ["settings:own"],
    contributions: { settingsPages: [page] },
    consent: "not-required",
    fingerprint: "yc1-abc123",
    devices: [],
  };
}

function pageWithTextField(): PluginSettingsPage {
  const pages = pluginSettingsPages([
    extension({
      id: "acme",
      label: "Acme",
      fields: [{ key: "apiKey", label: "API key", type: "text" }],
    }),
  ]);
  return pages[0] as PluginSettingsPage;
}

function client(writes: unknown[] = []): PluginSettingsClient {
  return {
    read: async () => ({}),
    write: async (key, values) => {
      writes.push([key, values]);
      return { ok: true };
    },
  };
}

function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

it("maps a declarative page and its plugin key", () => {
  const pages = pluginSettingsPages([
    extension({
      id: "acme",
      label: "Acme",
      fields: [{ key: "mode", label: "Mode", type: "boolean" }],
    }),
  ]);
  expect(pages).toEqual([
    {
      id: "plugin:local/acme/acme",
      pluginKey: "local/acme",
      label: "Acme",
      section: undefined,
      fields: [{ key: "mode", label: "Mode", type: "boolean" }],
      ui: undefined,
    },
  ]);
});

it("maps a sandboxed page's entry", () => {
  const pages = pluginSettingsPages([
    extension({ id: "acme", label: "Acme", ui: "settings/index.html" }),
  ]);
  expect(pages[0]).toMatchObject({
    ui: "settings/index.html",
    fields: undefined,
  });
});

it("renders a declared field and saves its value", async () => {
  const writes: unknown[] = [];
  mount(
    <PluginSettingsForm page={pageWithTextField()} client={client(writes)} />,
  );
  await act(async () => {
    await Promise.resolve();
  });

  const input = document.querySelector<HTMLInputElement>(
    'input[aria-label="API key"]',
  );
  expect(input).not.toBeNull();
  if (input === null) return;

  await act(async () => {
    setInput(input, "secret");
  });
  const save = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Save",
  );
  await act(async () => {
    save?.click();
    await Promise.resolve();
  });

  expect(writes).toEqual([["local/acme", { apiKey: "secret" }]]);
});

it("renders a sandboxed page as a frame", () => {
  const page: PluginSettingsPage = {
    id: "plugin:local/acme/acme",
    pluginKey: "local/acme",
    label: "Acme",
    section: undefined,
    fields: undefined,
    ui: "settings/index.html",
  };
  mount(
    <PluginSettingsView
      page={page}
      theme={THEME}
      onRequest={vi.fn(async () => undefined)}
    />,
  );

  const frame = document.querySelector("iframe");
  expect(frame?.getAttribute("title")).toBe("Acme");
  expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
  expect(frame?.getAttribute("src")).toBe(
    "/api/extensions/local/acme/ui/settings/index.html",
  );

  // A settings frame saves through `settings.set`, a write method: the host
  // draws the only control that may mint its gesture token.
  expect(
    [...document.querySelectorAll("button")].map((button) => button.textContent),
  ).toContain(uiCopy.settings.extensions.frameEnableControls);
});
