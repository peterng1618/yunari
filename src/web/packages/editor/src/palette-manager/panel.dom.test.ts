// @vitest-environment jsdom

/**
 * The palette panel's factory: what `editor-session` constructs and calls.
 *
 * The field rules — a colour edit, a paint-kind switch, the picker's identity,
 * the reassignment-on-delete — are the token inspector's now and are asserted in
 * `panes/tokens/paint-fields.dom.test.tsx` and
 * `panes/tokens/token-inspector.dom.test.tsx`, against the components that own
 * them. What is left here is the contract the session holds: `render` paints
 * synchronously, a row press travels out through the selection port, and
 * `destroy` releases what it created.
 */
import type { FabricPalette } from "@yunari/renderer-core";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { uiCopy } from "../ui-copy.js";
import { createPalettePanel } from "./panel.js";

const palette = {
  none: {
    name: "None",
    value: { kind: "solid" as const, color: "transparent" },
  },
  background: {
    name: "Background",
    value: { kind: "solid" as const, color: "#102030" },
  },
  accent: {
    name: "Accent",
    value: { kind: "solid" as const, color: "#00b8d9" },
  },
};

// The three browser APIs Base UI's popups need and jsdom has none of — the same
// three `control.dom.test.tsx` supplies, for the same reason.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as never;
Element.prototype.getAnimations ??= (): never[] => [];
window.PointerEvent ??= MouseEvent as never;

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  // jsdom's selector engine cannot answer `:modal`/`:popover-open`, and
  // Base UI's focus manager asks for both when a popup opens.
  const matches = Element.prototype.matches;
  Element.prototype.matches = Object.assign(function (
    this: Element,
    selector: string,
  ): boolean {
    if (selector === ":modal" || selector === ":popover-open") return false;
    return matches.call(this, selector);
  }, matches);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("palette panel", () => {
  it("paints the tokens on render without waiting for a frame", () => {
    const panel = createPalettePanel(document.body, vi.fn());
    expect(
      document.querySelectorAll("[data-yunari-palette-token-row]"),
    ).toHaveLength(0);

    panel.render(palette);

    // Read straight after the call, with no `act` in between: the session
    // renders this on every envelope change, and a surface that landed later
    // would be a frame behind the document it describes.
    expect(
      Array.from(
        document.querySelectorAll("[data-yunari-palette-token-row]"),
        (row) => row.getAttribute("data-yunari-palette-token-row"),
      ),
    ).toEqual(["background", "accent"]);
  });

  it("hands a row press to the selection port, so the inspector can open", async () => {
    const select = vi.fn();
    const panel = createPalettePanel(document.body, vi.fn(), {
      onSelect: select,
    });
    panel.render(palette);

    await act(async () => {
      panel.root
        .querySelector<HTMLButtonElement>(
          '[data-yunari-palette-token-row="accent"]',
        )!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(select).toHaveBeenCalledWith("accent");
  });

  it("adds a token through the change callback and selects it", async () => {
    const change = vi.fn();
    const select = vi.fn();
    const panel = createPalettePanel(document.body, change, {
      onSelect: select,
    });
    panel.render(palette);

    await act(async () => {
      panel.root
        .querySelector<HTMLButtonElement>("[data-yunari-palette-add]")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(change).toHaveBeenLastCalledWith({
      ...palette,
      colour: {
        name: uiCopy.panels.newColour,
        value: { kind: "solid", color: expect.any(String) },
      },
    });
    expect(select).toHaveBeenCalledWith("colour");
  });

  it("re-reads the scene on every render, and states an absent reading", () => {
    // The figure is derived, so it needs the walk re-read per draw; without one
    // the pane prints a number that only refreshes when the palette changes.
    let uses: Readonly<
      Record<string, readonly { objectId: string; name: string }[]>
    > = {
      background: [{ objectId: "a", name: "Card title" }],
      accent: [],
    };
    const panel = createPalettePanel(document.body, vi.fn(), {
      usage: () => uses,
    });
    panel.render(palette);
    // Scoped to the panel's own root: this test stands two of them at once, and
    // a document-wide query would read whichever was mounted first.
    const figure = (): string =>
      panel.root
        .querySelector(
          '[data-yunari-palette-token-row="background"] [data-yunari-palette-usage]',
        )
        ?.textContent?.trim() ?? "";
    expect(figure()).toBe("1");

    uses = { background: [], accent: [] };
    panel.render(palette);
    expect(figure()).toBe("0");

    const bare = createPalettePanel(document.body, vi.fn());
    bare.render(palette);
    const stated =
      bare.root
        .querySelector(
          '[data-yunari-palette-token-row="background"] [data-yunari-palette-usage]',
        )
        ?.textContent?.trim() ?? "";
    // §97: a panel with no scene to read says so rather than defaulting to 0.
    expect(stated).not.toBe("0");
    expect(stated).not.toBe("");
  });

  it("removes its own section on destroy", () => {
    const panel = createPalettePanel(document.body, vi.fn());
    panel.render(palette);
    expect(panel.root.isConnected).toBe(true);

    panel.destroy();

    expect(panel.root.isConnected).toBe(false);
    expect(
      document.querySelectorAll("[data-yunari-palette-token-row]"),
    ).toHaveLength(0);
  });

  it("holds no fabricated state between two palettes", () => {
    const panel = createPalettePanel(document.body, vi.fn());
    panel.render(palette);
    const next: FabricPalette = {
      accent: palette.accent,
      accent2: { name: "Accent 2", value: { kind: "solid", color: "#ff0000" } },
    };

    panel.render(next);

    expect(
      Array.from(
        document.querySelectorAll("[data-yunari-palette-token-row]"),
        (row) => row.getAttribute("data-yunari-palette-token-row"),
      ),
    ).toEqual(["accent", "accent2"]);
  });
});
