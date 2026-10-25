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
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FontTrioRole } from "../../type-preset-apply.js";
import type { TypePresets } from "../../type-preset-manager/panel.js";
import { uiCopy } from "../../ui-copy.js";
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

const PRESETS: TypePresets = {
  body: {
    name: "Body",
    value: {
      family: "Inter",
      size: 16,
      weight: "600",
      lineHeight: 1.4,
      letterSpacing: 0.5,
      trioRole: "body",
    },
  },
  bound: {
    name: "Bound",
    value: {
      family: "Manrope",
      size: 24,
      weight: 700,
      face: { assetId: "manrope-700" },
      trioRole: "heading",
    },
  },
  caption: { name: "Caption", value: { family: "Inter", size: 12 } },
};

function actions(): TokenInspectorActions {
  return {
    onChange: vi.fn<(presets: TypePresets) => void>(),
    onDelete: vi.fn<(id: string, replacement: string) => void>(),
    setRole: vi.fn<(id: string, role: FontTrioRole | null) => void>(),
    unbindFace: vi.fn<(id: string) => void>(),
  };
}

function field(host: HTMLElement, selector: string): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>(selector);
  if (input === null) throw new Error(`no field matches ${selector}`);
  return input;
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
  it("shows name, role, size, weight, line height and letter spacing for a preset", () => {
    const write = actions();
    const panel = createTokenInspectorPanel(document.body, write);
    panel.render({ kind: "preset", id: "body" }, PRESETS, {
      typePresets: PRESETS,
    });

    expect(field(panel.root, "[data-yunari-token-name]").value).toBe("Body");
    expect(
      panel.root
        .querySelector("[data-yunari-token-role] [data-yunari-value]")
        ?.getAttribute("data-yunari-value"),
    ).toBe("body");
    expect(field(panel.root, "[data-yunari-token-size]").value).toBe("16");
    expect(field(panel.root, "[data-yunari-token-weight]").value).toBe("600");
    expect(field(panel.root, "[data-yunari-token-line-height]").value).toBe(
      "1.4",
    );
    expect(field(panel.root, "[data-yunari-token-letter-spacing]").value).toBe(
      "0.5",
    );
    panel.destroy();
  });

  it("shows a bound preset's family and weight as read-only with Unbind", () => {
    const write = actions();
    const panel = createTokenInspectorPanel(document.body, write);
    panel.render({ kind: "preset", id: "bound" }, PRESETS, {
      typePresets: PRESETS,
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

  it("writes the role the author chooses, and clears it with None", async () => {
    const write = actions();
    const panel = createTokenInspectorPanel(document.body, write);
    panel.render({ kind: "preset", id: "body" }, PRESETS, {
      typePresets: PRESETS,
    });

    await chooseIn(panel.root, "[data-yunari-token-role]", "heading");
    expect(write.setRole).toHaveBeenCalledWith("body", "heading");

    // `""` is the None row's id; the panel maps it to the document's `null`,
    // which is the branch that removes `trioRole` rather than writing a role.
    await chooseIn(panel.root, "[data-yunari-token-role]", "");
    expect(write.setRole).toHaveBeenLastCalledWith("body", null);
    panel.destroy();
  });

  it("makes family and weight editable after Unbind", async () => {
    const write = actions();
    const panel = createTokenInspectorPanel(document.body, write);
    panel.render({ kind: "preset", id: "bound" }, PRESETS, {
      typePresets: PRESETS,
    });

    await click(
      panel.root.querySelector("[data-yunari-token-unbind]") as HTMLElement,
    );
    expect(write.unbindFace).toHaveBeenCalledWith("bound");

    // The session answers an unbind by re-rendering without the face, which is
    // the state the editable fields appear in.
    const freed: TypePresets = {
      ...PRESETS,
      bound: {
        name: "Bound",
        value: { family: "Manrope", size: 24, weight: 700 },
      },
    };
    panel.render({ kind: "preset", id: "bound" }, freed, {
      typePresets: freed,
    });

    const family = field(panel.root, "[data-yunari-token-family]");
    const weight = field(panel.root, "[data-yunari-token-weight]");
    expect(family.value).toBe("Manrope");
    expect(weight.value).toBe("700");

    await edit(weight, "600");
    expect(write.onChange).toHaveBeenCalledWith({
      ...freed,
      bound: {
        name: "Bound",
        value: { family: "Manrope", size: 24, weight: "600" },
      },
    });
    panel.destroy();
  });

  it("reassigns other presets before deleting one", async () => {
    const write = actions();
    const panel = createTokenInspectorPanel(document.body, write);
    panel.render({ kind: "preset", id: "body" }, PRESETS, {
      typePresets: PRESETS,
    });

    // The replacement names the remaining presets only — the preset being
    // deleted is not a place its references can go — and defaults to the first,
    // which is the choice Delete commits.
    const replacement = panel.root.querySelector(
      "[data-yunari-token-replacement]",
    ) as HTMLElement;
    expect(
      replacement
        .querySelector("[data-yunari-value]")
        ?.getAttribute("data-yunari-value"),
    ).toBe("bound");

    const remove = panel.root.querySelector(
      "[data-yunari-token-delete]",
    ) as HTMLButtonElement;
    await click(remove);
    expect(write.onDelete).toHaveBeenCalledWith("body", "bound");
    panel.destroy();
  });

  it("draws nothing when no token is selected", () => {
    const panel = createTokenInspectorPanel(document.body, actions());
    panel.render(undefined, PRESETS, { typePresets: PRESETS });

    expect(panel.root.textContent).toBe("");
    panel.destroy();
  });
});
