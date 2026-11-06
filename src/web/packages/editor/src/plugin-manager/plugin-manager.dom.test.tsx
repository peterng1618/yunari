// @vitest-environment jsdom
import type { InstalledExtension } from "@yunari/extension-api";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { PluginManager } from "./plugin-manager.js";
import type { EditorProviderOrder } from "./use-extensions.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ORDER: EditorProviderOrder = { version: 1, pluginOrder: [] };

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
  overrides: Partial<InstalledExtension> = {},
): InstalledExtension {
  return {
    key: "local/acme-sensors",
    name: "Acme Sensors",
    version: "1.2.0",
    execution: "trusted-worker",
    capabilities: ["sensor:provide"],
    contributions: { sensorProviders: [{ id: "acme", label: "Acme" }] },
    consent: "missing",
    fingerprint: "yc1-abc123",
    ...overrides,
  };
}

function render(
  overrides: {
    readonly extensions?: readonly InstalledExtension[];
    readonly providerOrder?: EditorProviderOrder;
    readonly busy?: boolean;
    readonly error?: string;
    readonly onInstall?: (file: File) => void;
    readonly onGrant?: (key: string, fingerprint: string) => void;
    readonly onRemove?: (key: string) => void;
    readonly onReorderProvider?: (key: string, direction: -1 | 1) => void;
  } = {},
): void {
  mount(
    <PluginManager
      extensions={overrides.extensions ?? []}
      providerOrder={overrides.providerOrder ?? ORDER}
      busy={overrides.busy ?? false}
      error={overrides.error}
      onInstall={overrides.onInstall ?? vi.fn()}
      onGrant={overrides.onGrant ?? vi.fn()}
      onRemove={overrides.onRemove ?? vi.fn()}
      onReorderProvider={overrides.onReorderProvider ?? vi.fn()}
    />,
  );
}

function button(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll("button")].find(
    (element) => element.textContent === label,
  );
}

it("shows the capabilities and approves with the host fingerprint", () => {
  const onGrant = vi.fn();
  render({ extensions: [extension()], onGrant });

  expect(document.body.textContent).toContain("sensor:provide");
  expect(document.body.textContent).toContain("trusted-worker");

  act(() => {
    button("Approve")?.click();
  });
  expect(onGrant).toHaveBeenCalledWith("local/acme-sensors", "yc1-abc123");
});

it("does not render plugin-supplied markup", () => {
  render({ extensions: [extension({ name: "<img src=x onerror=alert(1)>" })] });

  expect(document.querySelector("img")).toBeNull();
  expect(document.body.textContent).toContain("<img src=x onerror=alert(1)>");
});

it("installs one chosen file", () => {
  const onInstall = vi.fn();
  render({ onInstall });

  const input = document.querySelector<HTMLInputElement>(
    'input[aria-label="Install extension"]',
  );
  expect(input).not.toBeNull();
  if (input === null) return;

  const file = new File([new Uint8Array([1])], "acme.zip");
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [file],
  });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  expect(onInstall).toHaveBeenCalledWith(
    expect.objectContaining({ name: "acme.zip" }),
  );
});

it("asks before removing and names the extension", () => {
  const onRemove = vi.fn();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  render({ extensions: [extension()], onRemove });

  act(() => {
    button("Remove")?.click();
  });

  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Acme Sensors"));
  expect(onRemove).toHaveBeenCalledWith("local/acme-sensors");
});

it("moves a plugin provider down without moving built-ins", () => {
  const onReorderProvider = vi.fn();
  render({
    extensions: [
      extension({
        key: "local/acme",
        name: "Acme",
        capabilities: ["sensor:provide"],
        consent: "granted",
      }),
    ],
    providerOrder: { version: 1, pluginOrder: ["local/acme"] },
    onReorderProvider,
  });

  const down = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Move local/acme down"]',
  );
  expect(down).not.toBeNull();
  act(() => {
    down?.click();
  });
  expect(onReorderProvider).toHaveBeenCalledWith("local/acme", 1);
});

it("shows the host's error verbatim", () => {
  render({ error: "That plugin could not be installed." });
  expect(document.body.textContent).toContain(
    "That plugin could not be installed.",
  );
});
