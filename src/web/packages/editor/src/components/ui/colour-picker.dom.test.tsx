// @vitest-environment jsdom
/**
 * The picker's popover surface: a trigger in a well, a 2-D area, two channel
 * tracks, a value field, the preset library row and the eyedropper.
 *
 * jsdom has no `PointerEvent`, no `setPointerCapture` and no layout, so the
 * tests below stub the capture calls, give the area a rect, and dispatch
 * `MouseEvent`s under the pointer event names React listens for. The colours in
 * assertions come from `renderer-core` rather than from literals: the design
 * token gate reads this file.
 */
import { formatColor } from "@yunari/renderer-core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { presetLibrary } from "../../preset-library/index.js";
import { uiCopy } from "../../ui-copy.js";
import { ColourPicker } from "./colour-picker.js";
import { GREY, PURE_RED } from "./colour-picker-fixture.js";

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
  // jsdom's selector engine cannot answer `:modal`/`:popover-open`, and
  // floating-ui asks for both on every position.
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
});

const HEX_TEXT = /#(?:[0-9a-f]{6}|[0-9a-f]{8})/;

interface Picker {
  readonly trigger: HTMLButtonElement;
  readonly change: ReturnType<typeof vi.fn>;
  readonly settled: ReturnType<typeof vi.fn>;
  find<T extends HTMLElement = HTMLElement>(testId: string): T;
  query(testId: string): HTMLElement | null;
  close(): Promise<void>;
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 3; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

/** A root opened on the picker, its popup open, and the two callbacks. */
async function openPicker(value: string): Promise<Picker> {
  const host = document.createElement("div");
  document.body.append(host);
  const change = vi.fn();
  const settled = vi.fn();
  const root: Root = createRoot(host);
  await act(async () => {
    root.render(
      <ColourPicker
        value={value}
        label={uiCopy.panels.colour}
        onValueChange={change}
        onValueCommit={settled}
      />,
    );
  });
  const trigger = host.querySelector<HTMLButtonElement>(
    '[data-testid="picker-trigger"]',
  );
  if (trigger === null) throw new Error("The picker rendered no trigger.");
  await act(async () => {
    trigger.click();
  });
  await flush();

  const find = <T extends HTMLElement = HTMLElement>(testId: string): T => {
    const found = document.body.querySelector<T>(`[data-testid="${testId}"]`);
    if (found === null) throw new Error(`The picker rendered no ${testId}.`);
    return found;
  };

  return {
    trigger,
    change,
    settled,
    find,
    query: (testId) =>
      document.body.querySelector<HTMLElement>(`[data-testid="${testId}"]`),
    close: async () => {
      root.unmount();
      host.remove();
      await act(async () => {});
    },
  };
}

/** A pointer event under the name React listens for on a pointer handler. */
async function pointer(
  element: HTMLElement,
  type: string,
  x: number,
  y: number,
  buttons = 1,
): Promise<void> {
  await act(async () => {
    element.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        buttons,
      }),
    );
  });
}

async function press(
  element: HTMLElement,
  key: string,
  init: KeyboardEventInit = {},
): Promise<void> {
  element.focus();
  await act(async () => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });
}

/** jsdom reports a zero rect; the area's maths needs a real one. */
function stubRect(element: HTMLElement, width: number, height: number): void {
  element.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    }) as DOMRect;
}

const valueOf = (picker: Picker, testId: string): number =>
  Number(picker.find(testId).getAttribute("aria-valuenow"));

/** Types into the field and presses Enter, the way §5's text control commits. */
async function typeAndEnter(
  input: HTMLInputElement,
  value: string,
): Promise<void> {
  await act(async () => {
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input) as object,
      "value",
    )?.set;
    if (setter === undefined) input.value = value;
    else setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await press(input, "Enter");
}

it("renders a labelled trigger inside the well, and the trigger opens the popup", async () => {
  const picker = await openPicker(GREY);

  expect(picker.trigger.tagName).toBe("BUTTON");
  expect(picker.trigger.getAttribute("aria-label")).toBe(uiCopy.panels.colour);
  expect(
    picker.trigger.closest("[class*='bg-panel-2']"),
    "the trigger sits inside a §5 well",
  ).not.toBeNull();
  expect(picker.query("colour-picker")).not.toBeNull();

  await picker.close();
});

it("announces the area as a two-channel slider and says both channels and the hex", async () => {
  const picker = await openPicker(GREY);
  const area = picker.find("picker-area");

  expect(area.getAttribute("role")).toBe("slider");
  expect(area.getAttribute("aria-valuemin")).toBe("0");
  expect(area.getAttribute("aria-valuemax")).toBe("100");
  const announced = area.getAttribute("aria-valuetext") ?? "";
  expect(announced).toContain(uiCopy.panels.pickerSaturation);
  expect(announced).toContain("brightness");
  expect(announced).toMatch(HEX_TEXT);

  await picker.close();
});

it("emits live on every area move and settles exactly once at pointer-up", async () => {
  const picker = await openPicker(GREY);
  const area = picker.find("picker-area");
  stubRect(area, 200, 200);

  await pointer(area, "pointerdown", 20, 20);
  for (const [x, y] of [
    [40, 40],
    [60, 60],
    [80, 80],
  ] as const) {
    await pointer(area, "pointermove", x, y);
  }
  await pointer(area, "pointerup", 80, 80, 0);

  expect(
    picker.change.mock.calls.length,
    "a gesture emits a value per sample",
  ).toBeGreaterThan(1);
  expect(picker.settled).toHaveBeenCalledOnce();
  expect(picker.settled.mock.calls[0]?.[0]).toBe(
    picker.change.mock.calls.at(-1)?.[0],
  );

  await picker.close();
});

it("moves the area from the keyboard and settles once per press", async () => {
  const picker = await openPicker(GREY);
  const area = picker.find("picker-area");

  // GREY has zero saturation, so an arrow has somewhere to go.
  await press(area, "ArrowRight");
  expect(valueOf(picker, "picker-area")).toBe(1);
  expect(picker.change).toHaveBeenCalledOnce();
  expect(picker.settled).toHaveBeenCalledOnce();

  await press(area, "End");
  expect(valueOf(picker, "picker-area"), "End is the top").toBe(100);

  await press(area, "Home");
  expect(valueOf(picker, "picker-area"), "Home is the bottom").toBe(0);

  await picker.close();
});

it("gives hue and alpha the same keyboard model", async () => {
  const picker = await openPicker(PURE_RED);
  const hue = picker.find("picker-hue");
  expect(valueOf(picker, "picker-hue")).toBe(0);

  await press(hue, "ArrowRight");
  expect(valueOf(picker, "picker-hue")).toBe(1);
  expect(picker.settled).toHaveBeenCalledOnce();

  await press(hue, "End");
  expect(valueOf(picker, "picker-hue")).toBe(360);
  await press(hue, "Home");
  expect(valueOf(picker, "picker-hue")).toBe(0);

  // Pure red is opaque, so alpha starts at the top and a left arrow steps down.
  const alpha = picker.find("picker-alpha");
  expect(valueOf(picker, "picker-alpha")).toBe(100);
  await press(alpha, "ArrowLeft");
  expect(valueOf(picker, "picker-alpha")).toBe(99);
  await press(alpha, "Home");
  expect(valueOf(picker, "picker-alpha")).toBe(0);
  await press(alpha, "End");
  expect(valueOf(picker, "picker-alpha")).toBe(100);

  await picker.close();
});

it("parses typed text and emits it live and settled exactly once", async () => {
  const picker = await openPicker(PURE_RED);
  const field = picker.find<HTMLInputElement>("picker-hex");

  await typeAndEnter(field, "rgb(16 32 48)");

  const expected = formatColor({ r: 16, g: 32, b: 48, a: 1 });
  expect(picker.change).toHaveBeenCalledOnce();
  expect(picker.change).toHaveBeenCalledWith(expected);
  expect(picker.settled).toHaveBeenCalledOnce();
  expect(picker.settled).toHaveBeenCalledWith(expected);
  expect(field.getAttribute("aria-invalid")).toBeNull();

  await picker.close();
});

it("keeps a refused draft, marks it invalid and emits nothing", async () => {
  const picker = await openPicker(PURE_RED);
  const field = picker.find<HTMLInputElement>("picker-hex");

  await typeAndEnter(field, "nope");

  expect(picker.change).not.toHaveBeenCalled();
  expect(picker.settled).not.toHaveBeenCalled();
  expect(field.value).toBe("nope");
  expect(field.getAttribute("aria-invalid")).toBe("true");

  await picker.close();
});

it("offers the library's colours as one labelled radiogroup, and choosing one settles once", async () => {
  const picker = await openPicker(PURE_RED);
  const group = document.body.querySelector<HTMLElement>('[role="radiogroup"]');
  if (group === null) throw new Error("The picker rendered no preset group.");
  expect(group.getAttribute("aria-label")).toBe(uiCopy.panels.pickerPresets);

  const first = presetLibrary.getSnapshot().colours[0];
  if (first === undefined) throw new Error("The preset library is empty.");
  const row = picker.find(`picker-preset-${first.id}`);

  await act(async () => {
    row.click();
  });

  expect(picker.change).toHaveBeenCalledOnce();
  expect(picker.settled).toHaveBeenCalledOnce();
  expect(picker.settled).toHaveBeenCalledWith(first.value);

  await picker.close();
});

it("adds a colour to the open row, deletes it by right-click and by Shift+F10, and by Delete", async () => {
  const picker = await openPicker(PURE_RED);
  const before = new Set(
    presetLibrary.getSnapshot().colours.map((preset) => preset.id),
  );
  const added = presetLibrary.addColours([
    { name: "Probe one", value: "rgb(1 2 3)" },
  ]);
  const firstAdded = added.library.colours.find(
    (preset) => !before.has(preset.id),
  );
  if (firstAdded === undefined)
    throw new Error("The probe colour was refused.");
  await flush();

  const row = picker.find(`picker-preset-${firstAdded.id}`);
  await act(async () => {
    row.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 40,
        clientY: 40,
      }),
    );
  });
  await flush();

  const remove = picker.find("preset-menu-delete");
  expect(remove.textContent?.trim()).toBe(uiCopy.panels.presetDelete);
  await act(async () => {
    remove.click();
  });
  await flush();
  expect(picker.query(`picker-preset-${firstAdded.id}`)).toBeNull();

  const addedAgain = presetLibrary.addColours([
    { name: "Probe two", value: "rgb(4 5 6)" },
  ]);
  const secondAdded = addedAgain.library.colours.find(
    (preset) => preset.name === "Probe two",
  );
  if (secondAdded === undefined)
    throw new Error("The second colour was refused.");
  await flush();

  const focusedRow = picker.find(`picker-preset-${secondAdded.id}`);
  await press(focusedRow, "F10", { shiftKey: true });
  await flush();
  expect(
    picker.query("preset-menu-delete"),
    "Shift+F10 opens the same menu",
  ).not.toBeNull();

  await act(async () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  await flush();

  focusedRow.focus();
  await press(focusedRow, "Delete");
  await flush();
  expect(picker.query(`picker-preset-${secondAdded.id}`)).toBeNull();

  await picker.close();
});

it("maps a channel track's pointer through the padding box its handle sits in", async () => {
  // The handle's `left: n%` resolves against the padding box, while
  // `getBoundingClientRect` measures the border box. With a 1px edge each side,
  // the 25% point is `1 + 0.25 * 198`; a border-box reading would write 25.25%.
  const picker = await openPicker(PURE_RED);
  const hue = picker.find("picker-hue");
  hue.style.borderLeftWidth = "1px";
  hue.style.borderRightWidth = "1px";
  stubRect(hue, 200, 12);

  await pointer(hue, "pointerdown", 1 + 0.25 * 198, 6);

  // The hue range is 0–360, so a quarter along it is 90 exactly.
  expect(valueOf(picker, "picker-hue")).toBe(90);

  await picker.close();
});

it("draws no preset group for an empty colour library", async () => {
  const saved = presetLibrary.getSnapshot().colours;
  const picker = await (async () => {
    await act(async () => {
      for (const preset of saved) {
        presetLibrary.deletePreset("colour", preset.id);
      }
    });
    return openPicker(PURE_RED);
  })();
  try {
    await flush();
    expect(
      document.body.querySelector(
        `[role="radiogroup"][aria-label="${uiCopy.panels.pickerPresets}"]`,
      ),
      "an empty library states zero rather than an empty labelled group",
    ).toBeNull();
  } finally {
    await picker.close();
    await act(async () => {
      presetLibrary.addColours(
        saved.map((preset) => ({ name: preset.name, value: preset.value })),
      );
    });
    await flush();
  }
});

it("renders no eyedropper where the browser has none, and Escape returns focus to the trigger", async () => {
  const picker = await openPicker(GREY);

  expect(picker.query("picker-eyedropper")).toBeNull();

  await act(async () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  await flush();

  expect(picker.query("colour-picker")).toBeNull();
  expect(document.activeElement).toBe(picker.trigger);

  await picker.close();
});
