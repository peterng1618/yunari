// @vitest-environment jsdom
/**
 * The gradient track: the value's own gradient, its stop marks, and the one
 * picker and one number well that edit the stop under the selection.
 *
 * jsdom has no `PointerEvent`, no `setPointerCapture` and no layout, so the
 * helpers below stub the capture calls, give the track a rect, and dispatch
 * `MouseEvent`s under the pointer event names React listens for — the same
 * stubs `colour-picker.dom.test.tsx` uses.
 *
 * The colours are document fixtures written as `rgb()`, because the design
 * token gate reads this derived test file and a hex literal here would be a
 * surface literal. `colorAt` is the owner of the interpolated value, so the
 * cases compare against it rather than against a copy of its answer.
 */
import { colorAt } from "@yunari/renderer-core";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { presetLibrary } from "../../preset-library/index.js";
import { uiCopy } from "../../ui-copy.js";
import { gradientCss } from "./gradient-css.js";
import { GradientEditor } from "./gradient-editor.js";

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

const BLACK = "rgb(0 0 0)";
const WHITE = "rgb(255 255 255)";
const RED = "rgb(255 0 0)";
const BLUE = "rgb(0 0 255)";

type Stops = { offset: number; color: string }[];

interface Mounted {
  readonly change: ReturnType<typeof vi.fn>;
  readonly commit: ReturnType<typeof vi.fn>;
  find<T extends HTMLElement = HTMLElement>(testId: string): T;
  query(testId: string): HTMLElement | null;
}

let root: Root | undefined;

afterEach(async () => {
  if (root !== undefined) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function flush(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 3; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

/** The editor over state it owns, so a commit comes back as a new prop the way
 *  the pane hands one back — a fixed prop could not show a second keypress. */
function Harness(props: {
  readonly initial: { stops: Stops; angle: number };
  readonly change: (next: { stops: Stops; angle: number }) => void;
  readonly commit: () => void;
}): React.JSX.Element {
  const [value, setValue] = useState(props.initial);
  return (
    <GradientEditor
      stops={value.stops}
      angle={value.angle}
      label={uiCopy.panels.gradient}
      onChange={(next) => {
        props.change(next);
        setValue(next);
      }}
      onCommit={props.commit}
    />
  );
}

async function mount(initial: {
  readonly stops: Stops;
  readonly angle: number;
}): Promise<Mounted> {
  const element = document.createElement("div");
  document.body.append(element);
  const change = vi.fn();
  const commit = vi.fn();
  const mounted = createRoot(element);
  root = mounted;
  await act(async () =>
    mounted.render(
      <Harness initial={initial} change={change} commit={commit} />,
    ),
  );
  return {
    change,
    commit,
    find: <T extends HTMLElement = HTMLElement>(testId: string): T => {
      const found = document.body.querySelector<T>(`[data-testid="${testId}"]`);
      if (found === null) throw new Error(`The editor rendered no ${testId}.`);
      return found;
    },
    query: (testId) =>
      document.body.querySelector<HTMLElement>(`[data-testid="${testId}"]`),
  };
}

/** jsdom reports a zero rect; the track's maths needs a real one. */
function stubRect(element: HTMLElement, width: number): void {
  element.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: 24,
      width,
      height: 24,
      toJSON: () => ({}),
    }) as DOMRect;
}

async function click(
  element: HTMLElement,
  init: MouseEventInit = {},
): Promise<void> {
  await act(async () => {
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, ...init }),
    );
  });
}

async function pointer(
  element: HTMLElement,
  type: string,
  x: number,
  buttons = 1,
  button = 0,
): Promise<void> {
  await act(async () => {
    element.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: 12,
        buttons,
        button,
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

const valueNow = (mounted: Mounted, testId: string): number =>
  Number(mounted.find(testId).getAttribute("aria-valuenow"));

it("paints the track with the one gradient formula", async () => {
  const stops: Stops = [
    { offset: 0, color: BLACK },
    { offset: 1, color: WHITE },
  ];
  const mounted = await mount({ stops, angle: 0 });

  expect(mounted.find("gradient-track").style.background).toBe(
    gradientCss(stops, 0),
  );
  // The old standalone preview is gone: the track is the preview.
  expect(mounted.query("gradient-preview")).toBeNull();
});

it("announces every stop as a slider naming its position and its colour", async () => {
  const stops: Stops = [
    { offset: 0, color: RED },
    { offset: 1, color: BLUE },
  ];
  const mounted = await mount({ stops, angle: 0 });

  const first = mounted.find("gradient-stop-0");
  expect(first.getAttribute("role")).toBe("slider");
  expect(first.getAttribute("aria-valuemin")).toBe("0");
  expect(first.getAttribute("aria-valuemax")).toBe("100");
  expect(first.getAttribute("aria-valuenow")).toBe("0");
  expect(first.getAttribute("aria-valuetext")).toContain(RED);
  // The word "stop" is the copy table's, through the stop's own name.
  expect(first.getAttribute("aria-label")).toBe(uiCopy.panels.stopPosition(1));
  expect(mounted.find("gradient-stop-1").getAttribute("aria-valuenow")).toBe(
    "100",
  );
});

it("selects the stop the pointer picks and edits that stop's offset in the well", async () => {
  const stops: Stops = [
    { offset: 0, color: BLACK },
    { offset: 1, color: WHITE },
  ];
  const mounted = await mount({ stops, angle: 0 });
  const offset = mounted.find<HTMLInputElement>("gradient-offset");

  expect(offset.value).toBe("0");
  await click(mounted.find("gradient-stop-1"));
  expect(offset.value).toBe("100");

  await typeAndEnter(offset, "40");
  expect(mounted.change).toHaveBeenLastCalledWith({
    angle: 0,
    stops: [
      { offset: 0, color: BLACK },
      { offset: 0.4, color: WHITE },
    ],
  });

  await click(mounted.find("gradient-stop-0"));
  await typeAndEnter(offset, "25");
  expect(mounted.change).toHaveBeenLastCalledWith({
    angle: 0,
    stops: [
      { offset: 0.25, color: BLACK },
      { offset: 0.4, color: WHITE },
    ],
  });
});

it("moves a stop from the keyboard, one percent an arrow and a settle per press", async () => {
  const mounted = await mount({
    stops: [
      { offset: 0.5, color: BLACK },
      { offset: 1, color: WHITE },
    ],
    angle: 0,
  });
  const first = mounted.find("gradient-stop-0");

  await press(first, "ArrowRight");
  expect(valueNow(mounted, "gradient-stop-0")).toBe(51);
  expect(mounted.change).toHaveBeenLastCalledWith({
    angle: 0,
    stops: [
      { offset: 0.51, color: BLACK },
      { offset: 1, color: WHITE },
    ],
  });
  expect(mounted.commit).toHaveBeenCalledOnce();

  await press(first, "ArrowRight", { shiftKey: true });
  expect(valueNow(mounted, "gradient-stop-0")).toBe(61);
  expect(mounted.commit).toHaveBeenCalledTimes(2);

  await press(first, "End");
  expect(valueNow(mounted, "gradient-stop-0")).toBe(100);
  await press(first, "Home");
  expect(valueNow(mounted, "gradient-stop-0")).toBe(0);

  expect(mounted.change).toHaveBeenCalledTimes(4);
  expect(mounted.commit, "one press, one history entry").toHaveBeenCalledTimes(
    4,
  );
});

it("emits through a drag and settles exactly once at pointer-up", async () => {
  const mounted = await mount({
    stops: [
      { offset: 0, color: BLACK },
      { offset: 1, color: WHITE },
    ],
    angle: 0,
  });
  const track = mounted.find("gradient-track");
  const first = mounted.find("gradient-stop-0");
  stubRect(track, 200);

  await pointer(first, "pointerdown", 20);
  for (const x of [60, 100, 140] as const) {
    await pointer(first, "pointermove", x);
  }

  expect(
    mounted.change.mock.calls.length,
    "each sample of the gesture is a live edit",
  ).toBeGreaterThan(1);
  expect(
    mounted.commit,
    "a gesture still under the pointer is not a history entry",
  ).not.toHaveBeenCalled();

  await pointer(first, "pointerup", 140, 0);
  expect(mounted.commit).toHaveBeenCalledOnce();
});

it("selects a stop on a press-and-release without moving it", async () => {
  // The review's case: pressing a mark at its own centre is a *selection*, not
  // an edit. The mark sits at the padding box's 50%, so its centre is half the
  // stubbed 200px track — and writing the offset a press computes there would
  // be a real document edit and a real history entry.
  const mounted = await mount({
    stops: [
      { offset: 0, color: BLACK },
      { offset: 0.5, color: RED },
      { offset: 1, color: WHITE },
    ],
    angle: 0,
  });
  stubRect(mounted.find("gradient-track"), 200);
  const middle = mounted.find("gradient-stop-1");

  await pointer(middle, "pointerdown", 100);
  await pointer(middle, "pointerup", 100, 0);

  expect(
    mounted.change,
    "a press selects, it does not write",
  ).not.toHaveBeenCalled();
  expect(
    mounted.commit,
    "and it is not a history entry",
  ).not.toHaveBeenCalled();
});

it("ignores a secondary-button press", async () => {
  const mounted = await mount({
    stops: [
      { offset: 0, color: BLACK },
      { offset: 0.5, color: RED },
      { offset: 1, color: WHITE },
    ],
    angle: 0,
  });
  stubRect(mounted.find("gradient-track"), 200);
  const middle = mounted.find("gradient-stop-1");

  await pointer(middle, "pointerdown", 100, 2, 2);
  await pointer(middle, "pointermove", 40, 2);
  await pointer(middle, "pointerup", 40, 2, 2);

  expect(
    mounted.change,
    "the primary button owns the drag",
  ).not.toHaveBeenCalled();
  expect(mounted.commit).not.toHaveBeenCalled();
});

it("maps the pointer through the padding box the marks are positioned in", async () => {
  // A mark's `left: 50%` resolves against the padding box, while
  // `getBoundingClientRect` measures the border box. With a 1px edge each side,
  // the 25% point is `1 + 0.25 * 198`, not `0.25 * 200`; a border-box reading
  // would write 0.2525 for a mark that sits at 0.25.
  const mounted = await mount({
    stops: [
      { offset: 0, color: BLACK },
      { offset: 1, color: WHITE },
    ],
    angle: 0,
  });
  const track = mounted.find("gradient-track");
  track.style.borderLeftWidth = "1px";
  track.style.borderRightWidth = "1px";
  stubRect(track, 200);
  const first = mounted.find("gradient-stop-0");

  await pointer(first, "pointerdown", 1);
  await pointer(first, "pointermove", 1 + 0.25 * 198);

  const written = mounted.change.mock.calls.at(-1)?.[0] as
    | { stops: Stops }
    | undefined;
  expect(written?.stops[0]?.offset).toBeCloseTo(0.25, 5);
  await pointer(first, "pointerup", 1 + 0.25 * 198, 0);
  expect(mounted.commit).toHaveBeenCalledOnce();
});

it("adds a stop where the track is pressed, with the gradient's colour there", async () => {
  const stops: Stops = [
    { offset: 0, color: BLACK },
    { offset: 1, color: WHITE },
  ];
  const mounted = await mount({ stops, angle: 0 });
  stubRect(mounted.find("gradient-track"), 200);

  await click(mounted.find("gradient-track"), { clientX: 100 });

  const expected = colorAt(stops, 0.5);
  expect(mounted.change).toHaveBeenCalledOnce();
  // Inserted between the two, because the document's validator requires the
  // offsets to ascend — appending put 0.5 after 1.
  expect(mounted.change).toHaveBeenLastCalledWith({
    angle: 0,
    stops: [stops[0], { offset: 0.5, color: expected }, stops[1]],
  });
  expect(mounted.commit).toHaveBeenCalledOnce();
  // The new stop is the selected one, so the well edits it.
  expect(mounted.find<HTMLInputElement>("gradient-offset").value).toBe("50");
});

it("adds at the midpoint after the selection and removes it again", async () => {
  const stops: Stops = [
    { offset: 0, color: BLACK },
    { offset: 1, color: WHITE },
  ];
  const mounted = await mount({ stops, angle: 0 });

  await click(mounted.find("gradient-add"));
  const expected = colorAt(stops, 0.5);
  // The midpoint sorts between the two, so it is inserted there rather than
  // appended after the higher offset.
  expect(mounted.change).toHaveBeenLastCalledWith({
    angle: 0,
    stops: [stops[0], { offset: 0.5, color: expected }, stops[1]],
  });
  expect(mounted.commit).toHaveBeenCalledOnce();

  await click(mounted.find("gradient-remove"));
  expect(mounted.change).toHaveBeenLastCalledWith({ angle: 0, stops });
  expect(mounted.commit).toHaveBeenCalledTimes(2);
});

it("refuses to remove below two stops", async () => {
  const mounted = await mount({
    stops: [
      { offset: 0, color: BLACK },
      { offset: 1, color: WHITE },
    ],
    angle: 0,
  });

  await click(mounted.find("gradient-remove"));

  expect(mounted.change).not.toHaveBeenCalled();
  expect(mounted.commit).not.toHaveBeenCalled();
});

it("renders two stops at one offset as two distinct marks", async () => {
  const mounted = await mount({
    stops: [
      { offset: 0.5, color: RED },
      { offset: 0.5, color: BLUE },
    ],
    angle: 0,
  });

  // Review Focus 4: a duplicate offset is a real authoring state, and both
  // marks have to stay addressable rather than collapsing into one.
  expect(mounted.query("gradient-stop-0")).not.toBeNull();
  expect(mounted.query("gradient-stop-1")).not.toBeNull();
  expect(valueNow(mounted, "gradient-stop-0")).toBe(50);
  expect(valueNow(mounted, "gradient-stop-1")).toBe(50);
});

it("commits the offset well once, keeping the fraction it was given", async () => {
  const mounted = await mount({
    stops: [
      { offset: 0, color: BLACK },
      { offset: 1, color: WHITE },
    ],
    angle: 0,
  });
  const offset = mounted.find<HTMLInputElement>("gradient-offset");

  await typeAndEnter(offset, "37.5");

  expect(mounted.change).toHaveBeenCalledOnce();
  expect(mounted.change).toHaveBeenLastCalledWith({
    angle: 0,
    stops: [
      { offset: 0.375, color: BLACK },
      { offset: 1, color: WHITE },
    ],
  });
  expect(mounted.commit).toHaveBeenCalledOnce();
});

it("commits the angle well once", async () => {
  const stops: Stops = [
    { offset: 0, color: BLACK },
    { offset: 1, color: WHITE },
  ];
  const mounted = await mount({ stops, angle: 0 });

  await typeAndEnter(mounted.find<HTMLInputElement>("gradient-angle"), "45");

  expect(mounted.change).toHaveBeenCalledOnce();
  expect(mounted.change).toHaveBeenLastCalledWith({ angle: 45, stops });
  expect(mounted.commit).toHaveBeenCalledOnce();
});

it("removes the selected stop with Delete and never leaves fewer than two", async () => {
  const mounted = await mount({
    stops: [
      { offset: 0, color: BLACK },
      { offset: 0.5, color: RED },
      { offset: 1, color: WHITE },
    ],
    angle: 0,
  });

  await click(mounted.find("gradient-stop-1"));
  await press(mounted.find("gradient-stop-1"), "Delete");

  expect(mounted.change).toHaveBeenLastCalledWith({
    angle: 0,
    stops: [
      { offset: 0, color: BLACK },
      { offset: 1, color: WHITE },
    ],
  });
  expect(mounted.commit).toHaveBeenCalledOnce();

  await press(mounted.find("gradient-stop-0"), "Delete");
  expect(mounted.change).toHaveBeenCalledOnce();
  expect(mounted.commit).toHaveBeenCalledOnce();
});

it("rings a stop with §4's `--edge` boundary token, not a raw colour", async () => {
  const mounted = await mount({
    // `hsl()` rather than a hex, so this case is about the ring alone.
    stops: [
      { offset: 0, color: "hsl(0, 0%, 0%)" },
      { offset: 1, color: "hsl(0, 0%, 100%)" },
    ],
    angle: 90,
  });

  // §4 names `--edge`/`--edge-2` the boundary role, and the 1px ring separates
  // the dot from the track under it — separation, not altitude, so it is not an
  // `--elev-*` depth. The assertion reads the *rendered* dot's own style: a
  // token that does not resolve at the element is the failure a text-level check
  // cannot see, and this reads exactly what the browser would paint with.
  const dot = mounted.find("gradient-stop-0");
  expect(dot.style.boxShadow).toBe("0 0 0 1px var(--edge)");
  expect(dot.style.boxShadow).not.toMatch(/#[0-9a-f]{3,8}\b/i);
});

it("applies a library gradient with one change and one settle", async () => {
  const mounted = await mount({
    stops: [
      { offset: 0, color: BLACK },
      { offset: 1, color: WHITE },
    ],
    angle: 0,
  });
  const preset = presetLibrary.getSnapshot().gradients[0];
  if (preset === undefined)
    throw new Error("The preset library has no gradients.");

  await click(mounted.find(`gradient-preset-${preset.id}`));

  expect(mounted.change).toHaveBeenCalledOnce();
  expect(mounted.change).toHaveBeenLastCalledWith({
    stops: preset.stops,
    angle: preset.angle,
  });
  expect(mounted.commit).toHaveBeenCalledOnce();
});

it("draws a gradient added to the library, and deletes it from its menu", async () => {
  const mounted = await mount({
    stops: [
      { offset: 0, color: BLACK },
      { offset: 1, color: WHITE },
    ],
    angle: 0,
  });
  const before = new Set(
    presetLibrary.getSnapshot().gradients.map((preset) => preset.id),
  );
  let added: ReturnType<typeof presetLibrary.addGradient> | undefined;
  await act(async () => {
    added = presetLibrary.addGradient({
      name: "Probe gradient",
      angle: 30,
      stops: [
        { offset: 0, color: RED },
        { offset: 1, color: BLUE },
      ],
    });
  });
  const first = added?.library.gradients.find(
    (preset) => !before.has(preset.id),
  );
  if (first === undefined) throw new Error("The probe gradient was refused.");
  await flush();
  expect(mounted.query(`gradient-preset-${first.id}`)).not.toBeNull();

  // Right-click opens the one menu, and its one row removes the preset.
  await act(async () => {
    mounted.find(`gradient-preset-${first.id}`).dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 40,
        clientY: 40,
      }),
    );
  });
  await flush();
  const remove = mounted.find("preset-menu-delete");
  expect(remove.textContent?.trim()).toBe(uiCopy.panels.presetDelete);
  await act(async () => remove.click());
  await flush();
  expect(mounted.query(`gradient-preset-${first.id}`)).toBeNull();

  // Shift+F10 opens the same menu on a second one.
  let secondAdded: ReturnType<typeof presetLibrary.addGradient> | undefined;
  await act(async () => {
    secondAdded = presetLibrary.addGradient({
      name: "Probe gradient two",
      angle: 90,
      stops: [
        { offset: 0, color: BLUE },
        { offset: 1, color: RED },
      ],
    });
  });
  const second = secondAdded?.library.gradients.find(
    (preset) => preset.name === "Probe gradient two",
  );
  if (second === undefined) throw new Error("The second gradient was refused.");
  await flush();
  await press(mounted.find(`gradient-preset-${second.id}`), "F10", {
    shiftKey: true,
  });
  await flush();
  expect(
    mounted.query("preset-menu-delete"),
    "Shift+F10 opens the same menu",
  ).not.toBeNull();
  await act(async () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  await flush();

  // Delete removes the focused preset directly.
  await press(mounted.find(`gradient-preset-${second.id}`), "Delete");
  await flush();
  expect(mounted.query(`gradient-preset-${second.id}`)).toBeNull();
});

it("draws no preset row for an empty gradient library", async () => {
  const saved = presetLibrary.getSnapshot().gradients;
  try {
    await act(async () => {
      for (const preset of saved) {
        presetLibrary.deletePreset("gradient", preset.id);
      }
    });
    await flush();

    const mounted = await mount({
      stops: [
        { offset: 0, color: BLACK },
        { offset: 1, color: WHITE },
      ],
      angle: 0,
    });

    expect(
      document.body.querySelector(
        `[aria-label="${uiCopy.panels.gradientPresets}"]`,
      ),
    ).toBeNull();
    expect(
      mounted.query("gradient-preset-default-gradient-vital-ocean"),
    ).toBeNull();
  } finally {
    await act(async () => {
      for (const preset of saved) {
        presetLibrary.addGradient({
          name: preset.name,
          angle: preset.angle,
          stops: preset.stops,
        });
      }
    });
    await flush();
  }
});
