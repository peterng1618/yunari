// @vitest-environment jsdom

/**
 * The token inspector: the selected preset's own properties, in the column the
 * object inspector gives up while a token is selected.
 *
 * **The panel is the factory's, not the component's**, so the cases drive what
 * the session drives: `render(ref, presets, globals)` and the four write ports.
 * The panel never writes the document — each case asserts the port, because the
 * session owns the write.
 */
import type { FabricPalette } from "@yunari/renderer-core";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { TypeTokens } from "../../type-preset-manager/panel.js";
import { uiCopy } from "../../ui-copy.js";
import {
  BACKGROUND_PAINT,
  PAINT_INSPECTOR_PALETTE as PAINTS,
} from "./paint-list-fixture.js";
import {
  createTokenInspectorPanel,
  type TokenInspectorActions,
} from "./token-inspector.js";

// Base UI's popups need three browser APIs jsdom has none of — the same three
// `paint-list.dom.test.tsx` supplies, for the same reason.
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
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  // jsdom has no `:modal` or `:popover-open`; Base UI asks both while opening a
  // popup, and an unpatched `matches` throws where the library expects a boolean.
  const matches = Element.prototype.matches;
  Element.prototype.matches = Object.assign(function (
    this: Element,
    selector: string,
  ): boolean {
    if (selector === ":modal" || selector === ":popover-open") return false;
    return matches.call(this, selector);
  }, matches);
});

afterEach(() => document.body.replaceChildren());

const PRESETS: TypeTokens = {
  body: { family: "Inter", weight: "600" },
  bound: { family: "Manrope", weight: 700, face: { assetId: "manrope-700" } },
  caption: { family: "Inter" },
};

type PaintPort = NonNullable<TokenInspectorActions["paints"]>;

function paintActions(
  options: {
    readonly palette?: FabricPalette;
    readonly usage?: PaintPort["usage"];
  } = {},
): PaintPort {
  const palette = options.palette ?? PAINTS;
  return {
    palette: () => palette,
    onChange: vi.fn<(next: FabricPalette) => void>(),
    onDelete: vi.fn<(id: string, replacement: string) => void>(),
    usage: options.usage,
  };
}

function actions(
  paints?: PaintPort,
  facesOf?: TokenInspectorActions["facesOf"],
): TokenInspectorActions {
  return {
    onChange: vi.fn<(presets: TypeTokens) => void>(),
    onDelete: vi.fn<(id: string, replacement: string) => void>(),
    unbindFace: vi.fn<(id: string) => void>(),
    ...(facesOf === undefined ? {} : { facesOf }),
    paints,
  };
}

function field(host: HTMLElement, selector: string): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>(selector);
  if (input === null) throw new Error(`no field matches ${selector}`);
  return input;
}

/** The id a control commits, read from the element that prints it. */
function valueOf(host: HTMLElement, selector: string): string | null {
  return (
    host
      .querySelector(`${selector} [data-yunari-value]`)
      ?.getAttribute("data-yunari-value") ?? null
  );
}

/** The labels a list offers, in the order it offers them. */
function optionNames(): readonly (string | null | undefined)[] {
  return [...document.querySelectorAll('[role="option"]')].map((option) =>
    option.textContent?.trim(),
  );
}

/** A real edit, as React sees one: the value goes through the prototype's
 *  setter because React replaces `value` on the node with a tracker, and `blur`
 *  is what commits a plan-1 field. */
async function edit(input: HTMLInputElement, value: string): Promise<void> {
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

/** React and floating-ui schedule outside `act`, so a popup is flushed with
 *  macrotasks rather than one. */
async function flush(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function click(target: Element): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
  await flush();
}

/** Base UI commits a list item only when the press that precedes the click
 *  started on it, so the press is part of the interaction. */
async function pointerDown(target: Element): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerType: "mouse",
        button: 0,
      }),
    );
  });
}

/** Picks the option whose value is `id` — the id the control commits, never the
 *  label it prints. */
async function chooseIn(
  host: HTMLElement,
  control: string,
  id: string,
): Promise<void> {
  const trigger = host.querySelector<HTMLElement>(control);
  if (trigger === null) throw new Error(`no control matches ${control}`);
  await click(trigger);
  const option = document.querySelector<HTMLElement>(
    `[role="option"][data-yunari-option="${id}"]`,
  );
  if (option === null) throw new Error(`no option ${id} in ${control}`);
  await pointerDown(option);
  await click(option);
}

describe("token inspector", () => {
  it("shows the computed name and only the face fields", () => {
    const write = actions();
    const panel = createTokenInspectorPanel(document.body, write);
    panel.render({ kind: "preset", id: "body" }, PRESETS, {
      typeTokens: PRESETS,
    });

    // The name is a reading, not a field: `[Body] Inter 600` is computed from
    // the id and the face, so there is nothing to type over.
    expect(
      panel.root.querySelector("[data-yunari-token-name]")?.textContent,
    ).toBe("[Body] Inter 600");
    expect(
      panel.root.querySelector("input[data-yunari-token-name]"),
    ).toBeNull();

    // The removed fields stay removed: a name, a role tag and the old
    // size/leading/tracking rows would each write a theme the validator refuses.
    for (const selector of [
      "[data-yunari-token-role]",
      "[data-yunari-token-size]",
      "[data-yunari-token-line-height]",
      "[data-yunari-token-letter-spacing]",
    ]) {
      expect(panel.root.querySelector(selector), selector).toBeNull();
    }

    expect(valueOf(panel.root, "[data-yunari-token-family]")).toBe("Inter");
    expect(field(panel.root, "[data-yunari-token-weight]").value).toBe("600");
    panel.destroy();
  });

  it("computes an unroled token's name from its face", () => {
    const panel = createTokenInspectorPanel(document.body, actions());
    panel.render({ kind: "preset", id: "caption" }, PRESETS, {
      typeTokens: PRESETS,
    });

    expect(
      panel.root.querySelector("[data-yunari-token-name]")?.textContent,
    ).toBe("Inter");
    panel.destroy();
  });

  it("draws no delete or reassign control for a role token", () => {
    // A role is the id and the validator requires all three, so the role's
    // token is not removable.
    const panel = createTokenInspectorPanel(document.body, actions());
    panel.render({ kind: "preset", id: "body" }, PRESETS, {
      typeTokens: PRESETS,
    });

    expect(panel.root.querySelector("[data-yunari-token-delete]")).toBeNull();
    expect(
      panel.root.querySelector("[data-yunari-token-replacement]"),
    ).toBeNull();
    panel.destroy();
  });

  it("shows a bound preset's family and weight as read-only with Unbind", () => {
    const write = actions();
    const panel = createTokenInspectorPanel(document.body, write);
    panel.render({ kind: "preset", id: "bound" }, PRESETS, {
      typeTokens: PRESETS,
    });

    // No editable family or weight: the face owns both while it is bound.
    expect(panel.root.querySelector("[data-yunari-token-family]")).toBeNull();
    expect(panel.root.querySelector("[data-yunari-token-weight]")).toBeNull();
    expect(
      panel.root.querySelector("[data-yunari-token-face-bound]")?.textContent,
    ).toContain("Manrope");
    expect(
      panel.root.querySelector("[data-yunari-token-face-bound]")?.textContent,
    ).toContain("700");
    expect(
      panel.root.querySelector("[data-yunari-token-unbind]")?.textContent,
    ).toBe(uiCopy.panels.unbindFont);
    panel.destroy();
  });

  it("offers only the weights the family's package holds", async () => {
    // A weight the package does not hold would draw in the browser fallback, so
    // the bound weight is a list of the declared faces, lightest first.
    const write = actions(undefined, () => [
      { assetId: "manrope-700", weight: 700, style: "normal" },
      { assetId: "manrope-400", weight: 400, style: "normal" },
      { assetId: "manrope-700-italic", weight: 700, style: "italic" },
    ]);
    const panel = createTokenInspectorPanel(document.body, write);
    panel.render({ kind: "preset", id: "bound" }, PRESETS, {
      typeTokens: PRESETS,
    });

    await chooseIn(panel.root, "[data-yunari-token-weight]", "manrope-400");
    expect(write.onChange).toHaveBeenCalledWith({
      ...PRESETS,
      bound: {
        ...PRESETS["bound"]!,
        weight: 400,
        face: { assetId: "manrope-400" },
      },
    });

    // The italic face is a different option, not folded into its weight.
    await chooseIn(
      panel.root,
      "[data-yunari-token-weight]",
      "manrope-700-italic",
    );
    expect(write.onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        bound: expect.objectContaining({
          weight: 700,
          face: { assetId: "manrope-700-italic" },
        }),
      }),
    );
    panel.destroy();
  });

  it("writes weight and face.assetId together when a weight is chosen", async () => {
    // The weight list is the weight dropdown; the write it makes carries both
    // halves, because a weight without its face would draw from a file the
    // family may not hold.
    const presets: TypeTokens = {
      bound: {
        family: "Manrope",
        weight: 400,
        face: { assetId: "manrope-latin-400" },
      },
    };
    const write = actions(undefined, () => [
      { assetId: "manrope-latin-400", weight: 400, style: "normal" },
      { assetId: "manrope-latin-700", weight: 700, style: "normal" },
    ]);
    const panel = createTokenInspectorPanel(document.body, write);
    panel.render({ kind: "preset", id: "bound" }, presets, {
      typeTokens: presets,
    });

    await chooseIn(
      panel.root,
      "[data-yunari-token-weight]",
      "manrope-latin-700",
    );

    expect(write.onChange).toHaveBeenCalledTimes(1);
    expect(write.onChange).toHaveBeenCalledWith({
      bound: {
        family: "Manrope",
        weight: 700,
        face: { assetId: "manrope-latin-700" },
      },
    });
    panel.destroy();
  });

  it("prints the weight list in the order the producer gave it", async () => {
    // `facesOf` already answers lightest first, `italic` after `normal`. A sort
    // here would put `700 italic` before `700` and discard that order.
    const write = actions(undefined, () => [
      { assetId: "manrope-400", weight: 400, style: "normal" },
      { assetId: "manrope-700", weight: 700, style: "normal" },
      { assetId: "manrope-700-italic", weight: 700, style: "italic" },
    ]);
    const panel = createTokenInspectorPanel(document.body, write);
    panel.render({ kind: "preset", id: "bound" }, PRESETS, {
      typeTokens: PRESETS,
    });

    await click(
      panel.root.querySelector("[data-yunari-token-weight]") as HTMLElement,
    );

    expect(
      [...document.querySelectorAll('[role="option"]')].map((option) =>
        option.textContent?.trim(),
      ),
    ).toEqual(["400", "700", "700 italic"]);
    panel.destroy();
  });

  it("offers declared families, a not-in-package reading, then the actions", async () => {
    // The family list: the package's own families in the producer's order, the
    // token's family appended as a reading when the package does not declare it,
    // then the two action rows.
    const importLocalFont = vi.fn();
    const openFontFinder = vi.fn();
    const write: TokenInspectorActions = {
      ...actions(),
      familiesOf: () => ["Inter", "Manrope"],
      importLocalFont,
      openFontFinder,
    };
    const panel = createTokenInspectorPanel(document.body, write);
    const presets: TypeTokens = {
      caption: { family: "Custom Sans", weight: "600" },
    };
    panel.render({ kind: "preset", id: "caption" }, presets, {
      typeTokens: presets,
    });

    expect(valueOf(panel.root, "[data-yunari-token-family]")).toBe(
      "Custom Sans",
    );
    await click(
      panel.root.querySelector("[data-yunari-token-family]") as HTMLElement,
    );
    expect(optionNames()).toEqual([
      "Inter",
      "Manrope",
      "Custom Sans (not in package)",
      uiCopy.panels.importLocalFont,
      uiCopy.panels.fontFinder,
    ]);
    // The family the package does not hold is a reading, not a choice.
    const reading = document.querySelector(
      '[role="option"][data-yunari-option="Custom Sans"]',
    );
    expect(
      reading?.getAttribute("aria-disabled") === "true" ||
        reading?.hasAttribute("data-disabled") === true,
    ).toBe(true);
    panel.destroy();
  });

  it("never lets a declared family stand in for an action row", async () => {
    // A family whose name is a sentinel id would render a second option with
    // that id, and the trigger could not say which one it commits.
    const importLocalFont = vi.fn();
    const write: TokenInspectorActions = {
      ...actions(),
      familiesOf: () => ["Inter", "@yunari:import-local-font"],
      importLocalFont,
    };
    const panel = createTokenInspectorPanel(document.body, write);
    const presets: TypeTokens = { caption: { family: "Inter" } };
    panel.render({ kind: "preset", id: "caption" }, presets, {
      typeTokens: presets,
    });

    await click(
      panel.root.querySelector("[data-yunari-token-family]") as HTMLElement,
    );

    expect(optionNames()).toEqual(["Inter", uiCopy.panels.importLocalFont]);
    expect(
      document.querySelectorAll(
        '[role="option"][data-yunari-option="@yunari:import-local-font"]',
      ),
    ).toHaveLength(1);
    panel.destroy();
  });

  it("appends the current family only when the package does not declare it, ignoring case", async () => {
    // The producer deduplicates families case-insensitively, so `inter` and
    // `Inter` are one family: appending the reading here would offer the same
    // family twice.
    const write: TokenInspectorActions = {
      ...actions(),
      familiesOf: () => ["inter"],
      importLocalFont: vi.fn(),
    };
    const panel = createTokenInspectorPanel(document.body, write);
    const presets: TypeTokens = { caption: { family: "Inter" } };
    panel.render({ kind: "preset", id: "caption" }, presets, {
      typeTokens: presets,
    });

    await click(
      panel.root.querySelector("[data-yunari-token-family]") as HTMLElement,
    );

    expect(optionNames()).toEqual(["inter", uiCopy.panels.importLocalFont]);
    panel.destroy();
  });

  it("writes only the family when one is chosen", async () => {
    const write: TokenInspectorActions = {
      ...actions(),
      familiesOf: () => ["Inter", "Manrope"],
      importLocalFont: vi.fn(),
      openFontFinder: vi.fn(),
    };
    const panel = createTokenInspectorPanel(document.body, write);
    const presets: TypeTokens = {
      caption: { family: "Inter", weight: "600" },
    };
    panel.render({ kind: "preset", id: "caption" }, presets, {
      typeTokens: presets,
    });

    await chooseIn(panel.root, "[data-yunari-token-family]", "Manrope");

    expect(write.onChange).toHaveBeenCalledTimes(1);
    expect(write.onChange).toHaveBeenCalledWith({
      ...presets,
      caption: { family: "Manrope", weight: "600" },
    });
    panel.destroy();
  });

  it("dispatches each action row once and writes nothing", async () => {
    const importLocalFont = vi.fn();
    const openFontFinder = vi.fn();
    const write: TokenInspectorActions = {
      ...actions(),
      familiesOf: () => ["Inter"],
      importLocalFont,
      openFontFinder,
    };
    const panel = createTokenInspectorPanel(document.body, write);
    const presets: TypeTokens = { caption: { family: "Inter" } };
    panel.render({ kind: "preset", id: "caption" }, presets, {
      typeTokens: presets,
    });

    await chooseIn(
      panel.root,
      "[data-yunari-token-family]",
      "@yunari:import-local-font",
    );
    expect(importLocalFont).toHaveBeenCalledTimes(1);
    // The token record is the one it was: an action changes nothing.
    expect(write.onChange).not.toHaveBeenCalled();
    expect(valueOf(panel.root, "[data-yunari-token-family]")).toBe("Inter");
    // The control still prints the token's family, not the action it ran.
    expect(
      panel.root.querySelector("[data-yunari-token-family]")?.textContent,
    ).toContain("Inter");

    await chooseIn(
      panel.root,
      "[data-yunari-token-family]",
      "@yunari:font-finder",
    );
    expect(openFontFinder).toHaveBeenCalledTimes(1);
    expect(importLocalFont).toHaveBeenCalledTimes(1);
    expect(write.onChange).not.toHaveBeenCalled();
    panel.destroy();
  });

  it("keeps a bound token's family read-only and still draws both actions", async () => {
    const importLocalFont = vi.fn();
    const openFontFinder = vi.fn();
    const write: TokenInspectorActions = {
      ...actions(),
      familiesOf: () => ["Manrope"],
      importLocalFont,
      openFontFinder,
    };
    const panel = createTokenInspectorPanel(document.body, write);
    panel.render({ kind: "preset", id: "bound" }, PRESETS, {
      typeTokens: PRESETS,
    });

    // The face owns the family: no list to change it from, but both actions.
    expect(panel.root.querySelector("[data-yunari-token-family]")).toBeNull();
    const importRow = panel.root.querySelector(
      '[data-yunari-token-action="@yunari:import-local-font"]',
    );
    expect(importRow?.textContent).toBe(uiCopy.panels.importLocalFont);
    await click(importRow as HTMLElement);
    expect(importLocalFont).toHaveBeenCalledTimes(1);
    await click(
      panel.root.querySelector(
        '[data-yunari-token-action="@yunari:font-finder"]',
      ) as HTMLElement,
    );
    expect(openFontFinder).toHaveBeenCalledTimes(1);
    expect(write.onChange).not.toHaveBeenCalled();
    panel.destroy();
  });

  it("makes family and weight editable after Unbind", async () => {
    const write = actions();
    const panel = createTokenInspectorPanel(document.body, write);
    panel.render({ kind: "preset", id: "bound" }, PRESETS, {
      typeTokens: PRESETS,
    });

    await click(
      panel.root.querySelector("[data-yunari-token-unbind]") as HTMLElement,
    );
    expect(write.unbindFace).toHaveBeenCalledWith("bound");

    // The session answers an unbind by re-rendering without the face, which is
    // the state the editable fields appear in.
    const freed: TypeTokens = {
      ...PRESETS,
      bound: { family: "Manrope", weight: 700 },
    };
    panel.render({ kind: "preset", id: "bound" }, freed, {
      typeTokens: freed,
    });

    const family = valueOf(panel.root, "[data-yunari-token-family]");
    const weight = field(panel.root, "[data-yunari-token-weight]");
    expect(family).toBe("Manrope");
    expect(weight.value).toBe("700");

    await edit(weight, "600");
    expect(write.onChange).toHaveBeenCalledWith({
      ...freed,
      bound: { family: "Manrope", weight: "600" },
    });
    panel.destroy();
  });

  it("reassigns other tokens before deleting an unroled one", async () => {
    const write = actions();
    const panel = createTokenInspectorPanel(document.body, write);
    panel.render({ kind: "preset", id: "caption" }, PRESETS, {
      typeTokens: PRESETS,
    });

    // The replacement names the remaining tokens in role-first order — the
    // token being deleted is not a place its references can go — and defaults
    // to the first, which is the choice Delete commits. `body` is a role, and
    // roles sort first.
    const replacement = panel.root.querySelector(
      "[data-yunari-token-replacement]",
    ) as HTMLElement;
    expect(
      replacement
        .querySelector("[data-yunari-value]")
        ?.getAttribute("data-yunari-value"),
    ).toBe("body");

    const remove = panel.root.querySelector(
      "[data-yunari-token-delete]",
    ) as HTMLButtonElement;
    await click(remove);
    expect(write.onDelete).toHaveBeenCalledWith("caption", "body");
    panel.destroy();
  });

  it("draws nothing when no token is selected", () => {
    const panel = createTokenInspectorPanel(document.body, actions());
    panel.render(undefined, PRESETS, { typeTokens: PRESETS });

    expect(panel.root.textContent).toBe("");
    panel.destroy();
  });
});

describe("the paint section", () => {
  it("shows a paint token's name, kind and value", () => {
    const panel = createTokenInspectorPanel(
      document.body,
      actions(paintActions()),
    );
    panel.render({ kind: "paint", id: "background" }, PRESETS, {
      typeTokens: PRESETS,
    });

    // A paint's properties are its existing field set: the editable name, the
    // paint kind and the value's one control.
    expect(field(panel.root, "[data-yunari-palette-name]").value).toBe(
      "Background",
    );
    expect(valueOf(panel.root, "[data-yunari-palette-kind]")).toBe("solid");
    expect(
      panel.root.querySelector("[data-yunari-palette-picker]")?.textContent,
    ).toContain(BACKGROUND_PAINT);
    panel.destroy();
  });

  it("writes a paint's edit through the palette port", async () => {
    const paints = paintActions();
    const panel = createTokenInspectorPanel(document.body, actions(paints));
    panel.render({ kind: "paint", id: "background" }, PRESETS, {
      typeTokens: PRESETS,
    });

    await edit(field(panel.root, "[data-yunari-palette-name]"), "Renamed");

    // The whole palette travels, edited under the token's stable id — the
    // document's write is the session's, not the inspector's.
    expect(paints.onChange).toHaveBeenLastCalledWith({
      ...PAINTS,
      background: { name: "Renamed", value: PAINTS.background?.value },
    });
    panel.destroy();
  });

  it("reassigns other paints before deleting one", async () => {
    const paints = paintActions();
    const panel = createTokenInspectorPanel(document.body, actions(paints));
    panel.render({ kind: "paint", id: "background" }, PRESETS, {
      typeTokens: PRESETS,
    });

    // The replacement names the other paints only, and defaults to the first.
    expect(valueOf(panel.root, "[data-yunari-palette-replacement]")).toBe(
      "accent",
    );
    await click(
      panel.root.querySelector("[data-yunari-palette-delete]") as HTMLElement,
    );
    expect(paints.onDelete).toHaveBeenCalledWith("background", "accent");
    panel.destroy();
  });

  it("draws the objects a paint token is linked to", () => {
    const paints = paintActions({
      usage: () => ({ background: [{ objectId: "card", name: "Card title" }] }),
    });
    const panel = createTokenInspectorPanel(document.body, actions(paints));
    panel.render({ kind: "paint", id: "background" }, PRESETS, {
      typeTokens: PRESETS,
    });

    expect(
      panel.root.querySelector("[data-yunari-palette-users]")?.textContent,
    ).toContain("Card title");

    // With no scene, the reading is absent rather than an empty list: an empty
    // one would read as a measured zero.
    const bare = createTokenInspectorPanel(
      document.body,
      actions(paintActions()),
    );
    bare.render({ kind: "paint", id: "background" }, PRESETS, {
      typeTokens: PRESETS,
    });
    expect(bare.root.querySelector("[data-yunari-palette-users]")).toBeNull();
    panel.destroy();
    bare.destroy();
  });

  it("never draws a preset section for a paint token", () => {
    const panel = createTokenInspectorPanel(
      document.body,
      actions(paintActions()),
    );
    panel.render({ kind: "paint", id: "background" }, PRESETS, {
      typeTokens: PRESETS,
    });

    expect(
      panel.root.querySelector("[data-yunari-palette-fields]"),
    ).not.toBeNull();
    for (const selector of [
      "[data-yunari-token-fields]",
      "[data-yunari-token-name]",
      "[data-yunari-token-delete]",
    ]) {
      expect(panel.root.querySelector(selector), selector).toBeNull();
    }
    panel.destroy();
  });

  it("rebuilds a paint's field set when the paint kind changes", () => {
    // The measured defect: a field set that survives a kind switch keeps the
    // picker's trigger, and the open popover then measures a detached node. The
    // key carries the paint kind for exactly this — so the **same** token id is
    // rendered both times and only its kind moves. A key carrying only the id
    // keeps the node standing and fails here.
    let palette = PAINTS;
    const paints: PaintPort = { ...paintActions(), palette: () => palette };
    const panel = createTokenInspectorPanel(document.body, actions(paints));
    panel.render({ kind: "paint", id: "background" }, PRESETS, {
      typeTokens: PRESETS,
    });
    const before = panel.root.querySelector("[data-yunari-palette-fields]");
    expect(before).not.toBeNull();

    palette = {
      ...PAINTS,
      background: {
        name: "Background",
        value: {
          kind: "gradient",
          angle: 0,
          stops: [
            { offset: 0, color: BACKGROUND_PAINT },
            { offset: 1, color: BACKGROUND_PAINT },
          ],
        },
      },
    };
    panel.render({ kind: "paint", id: "background" }, PRESETS, {
      typeTokens: PRESETS,
    });

    expect(panel.root.querySelector("[data-yunari-palette-fields]")).not.toBe(
      before,
    );
    panel.destroy();
  });

  it("rebuilds a paint's field set when the token changes", () => {
    // The key's token term: both tokens here are solid, so only the id moves
    // it. `ColourPicker` seeds its draft at mount, so a set that survived the
    // switch would show the previous token for a frame.
    const paints = paintActions();
    const panel = createTokenInspectorPanel(document.body, actions(paints));
    panel.render({ kind: "paint", id: "background" }, PRESETS, {
      typeTokens: PRESETS,
    });
    const before = panel.root.querySelector("[data-yunari-palette-fields]");
    expect(before).not.toBeNull();

    panel.render({ kind: "paint", id: "accent" }, PRESETS, {
      typeTokens: PRESETS,
    });

    expect(panel.root.querySelector("[data-yunari-palette-fields]")).not.toBe(
      before,
    );
    panel.destroy();
  });
});
