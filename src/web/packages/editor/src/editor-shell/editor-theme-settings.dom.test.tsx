// @vitest-environment jsdom
import {
  EDITOR_THEME_TOKENS,
  writeEditorThemePackage,
} from "@yunari/theme-package";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyEditorThemeTokens,
  clearEditorTheme,
  readShellThemeTokens,
} from "./editor-theme.js";
import { EditorThemeSettings } from "./editor-theme-settings.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const tokens = Object.fromEntries(
  EDITOR_THEME_TOKENS.map((token) => [token, "rgb(17, 34, 51)"]),
) as Record<(typeof EDITOR_THEME_TOKENS)[number], string>;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  clearEditorTheme();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function mount(): void {
  act(() => root.render(<EditorThemeSettings palette="graphite" />));
}

function field(): HTMLInputElement {
  const found = host.querySelector<HTMLInputElement>(
    "[data-yunari-editor-theme-name]",
  );
  if (found === null) throw new Error("no theme name field");
  return found;
}

function button(marker: string): HTMLButtonElement {
  const found = host.querySelector<HTMLButtonElement>(
    `[data-yunari-editor-theme-${marker}]`,
  );
  if (found === null) throw new Error(`no ${marker} button`);
  return found;
}

function typeName(value: string): void {
  const input = field();
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  act(() => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function click(marker: string): void {
  act(() => {
    button(marker).dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
    );
  });
}

function message(): string | undefined {
  return (
    host.querySelector("[data-yunari-editor-theme-message]")?.textContent ??
    undefined
  );
}

describe("the Appearance tab's editor theme", () => {
  it("saves the palette in force as a draft and exports it", () => {
    mount();
    applyEditorThemeTokens(tokens);
    typeName("Warm Paper");

    click("save");
    expect(message()).toBe("Draft saved: Warm Paper.");

    const created = vi.fn(() => "blob:theme");
    const revoked = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: created,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revoked,
    });
    const clicked = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    click("export");
    expect(message()).toBe("Exported Warm Paper.");
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(created).toHaveBeenCalledTimes(1);
    expect(revoked).toHaveBeenCalledWith("blob:theme");
    clicked.mockRestore();
  });

  it("refuses to save without a name", () => {
    mount();
    applyEditorThemeTokens(tokens);
    click("save");
    expect(message()).toBe("A theme needs a name before it can be saved.");
  });

  it("imports a package and applies its tokens", async () => {
    const written = writeEditorThemePackage({
      name: "Warm Paper",
      tokens,
    });
    if (!written.ok) throw new Error(written.message);
    mount();

    const input = host.querySelector<HTMLInputElement>(
      "[data-yunari-editor-theme-import]",
    );
    if (input === null) throw new Error("no import input");
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [
        {
          arrayBuffer: async () =>
            written.bytes.buffer.slice(
              written.bytes.byteOffset,
              written.bytes.byteOffset + written.bytes.byteLength,
            ),
        },
      ],
    });

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(message()).toBe("Applied Warm Paper.");
    expect(field().value).toBe("Warm Paper");
    expect(readShellThemeTokens()).toEqual({ ok: true, tokens });
  });

  it("shows the reader's refusal and applies nothing", async () => {
    mount();
    const input = host.querySelector<HTMLInputElement>(
      "[data-yunari-editor-theme-import]",
    );
    if (input === null) throw new Error("no import input");
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [
        {
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        },
      ],
    });

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(message()).toBe("That file is not a readable editor theme package.");
    expect(readShellThemeTokens()).toMatchObject({ ok: false });
  });
});
