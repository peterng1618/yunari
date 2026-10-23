// @vitest-environment jsdom

/**
 * The palette panel's factory: what `editor-session` constructs and calls.
 *
 * The field rules — a colour edit, a paint-kind switch, the picker's identity,
 * the reassignment-on-delete — are the Tokens pane's now and are asserted in
 * `panes/tokens/paint-list.dom.test.tsx`, against the component that owns them.
 * What is left here is the contract the session holds: `render` paints
 * synchronously, a commit travels out through the callbacks it was built with,
 * and `destroy` releases what it created.
 */
import type { FabricPalette } from "@yunari/renderer-core";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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

/** Types into a field the way an author does, and commits it by leaving. */
async function commitField(control: string, value: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>(control);
  if (input === null) throw new Error(`no field matches ${control}`);
  await act(async () => {
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input) as HTMLInputElement,
      "value",
    )?.set;
    if (setter === undefined) input.value = value;
    else setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input.blur();
  });
}

/** Opens the picker's popover, fills its one colour field and commits by
 *  leaving the field — the pane owns no exact-value field of its own. */
async function commitColour(value: string): Promise<void> {
  const trigger = document.querySelector<HTMLButtonElement>(
    "[data-yunari-palette-picker]",
  );
  if (trigger === null) throw new Error("the panel rendered no picker trigger");
  await act(async () => {
    trigger.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  await commitField("[data-yunari-palette-color]", value);
}

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

  it("commits an edit under the token's stable id, through the callback it was built with", async () => {
    const change = vi.fn();
    const settled = vi.fn();
    const panel = createPalettePanel(document.body, change, undefined, {
      onSettled: settled,
    });
    panel.render(palette);

    await commitColour("rgb(16 32 48)");

    // The picker reports a colour, not the document's spelling of one: the
    // stored value is the hex form (Review Focus 1).
    expect(change).toHaveBeenLastCalledWith({
      ...palette,
      background: {
        name: "Background",
        value: { kind: "solid", color: "#102030" },
      },
    });
    expect(
      settled,
      "the pane forwards the session's settled boundary",
    ).toHaveBeenCalledOnce();

    // The popover's portal is open; releasing the root is what removes it from
    // `body` before the next case's cleanup.
    await act(async () => {
      panel.destroy();
    });
  });

  it("carries the reassignment-on-delete out through its own callback", async () => {
    const remove = vi.fn();
    const panel = createPalettePanel(document.body, vi.fn(), remove);
    panel.render(palette);

    await act(async () => {
      panel.root
        .querySelector<HTMLButtonElement>("[data-yunari-palette-delete]")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // The default target is the first token the chooser does not exclude —
    // `none` included, as the imperative panel allowed: reassigning to the
    // reserved transparent token is how an author says "stop painting this".
    expect(remove).toHaveBeenCalledWith("background", "none");
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
    const panel = createPalettePanel(document.body, vi.fn(), undefined, {
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
