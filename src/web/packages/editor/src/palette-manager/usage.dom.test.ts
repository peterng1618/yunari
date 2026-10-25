// @vitest-environment jsdom

/**
 * What a token is linked to, as the pane's rows state it.
 *
 * The count and the delete guard have to come from one walk: a pane saying
 * "3 uses" while the delete decides from a different traversal is how a token
 * is removed from under a live object. `usage` is injected rather than
 * recomputed here, so this file asserts the pane reports what it is given — the
 * traversal itself is proven in scene-fabric.
 *
 * The figure rides each row, so a dead token is visible without being selected
 * first. The list that names the objects is the token inspector's now
 * (`panes/tokens/paint-fields.dom.test.tsx`), reading the same getter.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { uiCopy } from "../ui-copy.js";
import { createPalettePanel } from "./panel.js";

const palette = {
  accent: {
    name: "Accent",
    value: { kind: "solid" as const, color: "#00b8d9" },
  },
  unused: {
    name: "Unused",
    value: { kind: "solid" as const, color: "#334455" },
  },
};

// Base UI's popups need the browser APIs jsdom has none of.
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

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const usage = (): Readonly<
  Record<string, readonly { objectId: string; name: string }[]>
> => ({
  accent: [
    { objectId: "card", name: "Card title" },
    { objectId: "header", name: "Header" },
    { objectId: "gauge", name: "RAM gauge" },
  ],
  unused: [],
});

function render(withScene = true): HTMLElement {
  const panel = createPalettePanel(
    document.body,
    vi.fn(),
    withScene ? { usage } : {},
  );
  panel.render(palette);
  return document.body;
}

/** The figure the row for a token prints. */
const figure = (id: string): string =>
  document
    .querySelector(`[data-yunari-palette-token-row="${id}"]`)
    ?.querySelector("[data-yunari-palette-usage]")?.textContent ?? "";

/** The whole row, which carries the token's own name beside the figure. */
const row = (id: string): HTMLElement =>
  document.querySelector<HTMLElement>(
    `[data-yunari-palette-token-row="${id}"]`,
  )!;

describe("palette token usage", () => {
  it("names how many objects a token is linked to, per token", () => {
    render();

    expect(figure("accent")).toContain("3");
    expect(figure("unused")).toContain("0");
  });

  it("still shows the token's own name beside the count", () => {
    render();

    expect(row("accent").textContent).toContain("Accent");
  });

  it("marks a dead token on its row, without selecting it first", () => {
    render();

    expect(figure("unused")).toContain("0");
  });

  it("states an absent reading when the panel is given no scene to read", () => {
    // Without a usage source the panel has no scene. Printing 0 there would be
    // fabricating a measurement — the same rule as a gap in telemetry (§97).
    render(false);

    expect(figure("accent")).toBe(uiCopy.panels.notSet);
    expect(figure("accent")).not.toBe("0");
  });
});
