// @vitest-environment jsdom

/**
 * The Tokens pane's paint list.
 *
 * **The figure and the delete come from one walk.** A token reported unused by
 * this list is unused in the sense the reassignment-on-delete acts on, because
 * both read `paletteTokenUsage`'s record — this file asserts the pane states
 * what it is given rather than deriving a second answer.
 *
 * **The picker's host is identity, and that is a measured defect.** The
 * imperative panel rebuilt its field set on every commit, which destroyed the
 * colour picker's trigger, and the open popover then measured a detached node —
 * one click on the saturation square threw the picker to (0, 6). The React form
 * of the rule is the key on the field set — **both** its terms, token and paint
 * kind: a colour change re-renders in place, a paint-kind switch remounts, and a
 * token switch remounts too. The token term is load-bearing for the same reason
 * the kind term is: `ColourPicker` seeds its HSV and its draft from `value` at
 * mount and only resyncs in a passive effect, so a token switch that did not
 * remount would render the previous token's state for a frame. All three are
 * asserted, because only the first two are what the measured defect named.
 *
 * **This file's colour literals are document fixtures** — the values a case
 * asserts an author typed — not styling, and they live in
 * `paint-list-fixture.ts` beside this file for exactly that reason. The ratchet
 * reads this file by rule (`vg-228`), so the fixture is where a document value
 * belongs and this file is where the behaviour does.
 *
 * `Harness` is the session's half of that contract: a commit comes back as a new
 * palette prop, exactly as `editor-session`'s `render()` hands one back.
 */
import type { FabricPalette } from "@yunari/renderer-core";
import { colorAt } from "@yunari/renderer-core";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { uiCopy } from "../../ui-copy.js";
import { PaintList, type PaintListProps } from "./paint-list.js";
import {
  AUTHORED_RGB_HEX,
  AUTHORED_RGB_PAINT,
  AUTHORED_RGB_PALETTE,
  BACKGROUND_PAINT,
  EDITED_ACCENT_PAINT,
  FROST_PAINT,
  FROSTED_PANEL,
  GLOW_GRADIENT,
  MOVED_FROST_PAINT,
  PAINT_LIST_PALETTE,
  RED_PAINT,
  TYPED_PAINT,
} from "./paint-list-fixture.js";

// Base UI's popups need three browser APIs jsdom has none of — the same three
// `control.dom.test.tsx` supplies, for the same reason.
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
  const matches = Element.prototype.matches;
  Element.prototype.matches = Object.assign(function (
    this: Element,
    selector: string,
  ): boolean {
    if (selector === ":modal" || selector === ":popover-open") return false;
    return matches.call(this, selector);
  }, matches);
});

let root: Root | undefined;

afterEach(async () => {
  if (root !== undefined) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** The list over a palette it owns, so a commit comes back the way the session
 *  hands one back rather than leaving the component on stale props. */
function Harness(props: {
  readonly initial: FabricPalette;
  readonly usage: PaintListProps["usage"];
  readonly onDelete: PaintListProps["onDelete"];
  readonly onSettled: PaintListProps["onSettled"];
  readonly change: (palette: FabricPalette) => void;
}): React.JSX.Element {
  const [palette, setPalette] = useState(props.initial);
  return (
    <PaintList
      palette={palette}
      usage={props.usage}
      onDelete={props.onDelete}
      onSettled={props.onSettled}
      onChange={(next) => {
        props.change(next);
        setPalette(next);
      }}
    />
  );
}

async function mount(
  initial: FabricPalette,
  options: {
    readonly usage?: PaintListProps["usage"];
    readonly onDelete?: PaintListProps["onDelete"];
  } = {},
): Promise<{
  readonly host: HTMLElement;
  readonly change: ReturnType<typeof vi.fn>;
  readonly settled: ReturnType<typeof vi.fn>;
}> {
  if (root !== undefined) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  const host = document.createElement("div");
  document.body.append(host);
  const change = vi.fn();
  const settled = vi.fn();
  const mounted = createRoot(host);
  root = mounted;
  await act(async () => {
    mounted.render(
      <Harness
        initial={initial}
        usage={options.usage}
        onDelete={options.onDelete}
        onSettled={settled}
        change={change}
      />,
    );
  });
  return { host, change, settled };
}

/** React and floating-ui schedule outside `act`, so a popup is flushed with
 *  macrotasks rather than one. */
async function flush(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function click(target: Element, detail = 0): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail }),
    );
  });
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

/** A real edit, as React sees one: the value goes through the prototype's
 *  setter because React replaces `value` on the node with a tracker that
 *  records every assignment, and `input` is the native event for a text field. */
async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    // Focused first: `blur()` on an element that never held focus is a no-op
    // and fires no event, so the commit below would never arrive.
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

/** Types into the field a hook names and commits it, the way an author does. */
async function commitField(control: string, value: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>(control);
  if (input === null) throw new Error(`no field matches ${control}`);
  await type(input, value);
}

/** Picks the option whose value is `id` — the id the control commits, never the
 *  label it prints, because the labels are the document's own token names. */
async function chooseIn(control: string, id: string): Promise<void> {
  const trigger = document.querySelector<HTMLElement>(control);
  if (trigger === null) throw new Error(`no control matches ${control}`);
  await click(trigger);
  await flush();
  const option = document.querySelector<HTMLElement>(
    `[role="option"][data-yunari-option="${id}"]`,
  );
  if (option === null) throw new Error(`no option ${id} in ${control}`);
  await pointerDown(option);
  await click(option, 1);
  await flush();
}

const usageWith =
  (
    record: Readonly<
      Record<string, readonly { objectId: string; name: string }[]>
    >,
  ) =>
  (): Readonly<Record<string, readonly { objectId: string; name: string }[]>> =>
    record;

/** The token ids the list offers, in order — every token but the reserved one. */
function listedTokenIds(host: HTMLElement): string[] {
  return Array.from(
    host.querySelectorAll<HTMLElement>("[data-yunari-palette-token-row]"),
    (row) => row.getAttribute("data-yunari-palette-token-row") ?? "",
  );
}

/** The figure the list prints beside a token. */
function usageFigure(host: HTMLElement, id: string): string {
  return (
    host
      .querySelector(`[data-yunari-palette-token-row="${id}"]`)
      ?.querySelector("[data-yunari-palette-usage]")
      ?.textContent?.trim() ?? ""
  );
}

const pickerHost = (host: HTMLElement): Element | null =>
  host.querySelector("[data-yunari-palette-picker]");
const fieldsHost = (host: HTMLElement): Element | null =>
  host.querySelector("[data-yunari-palette-fields]");

/** The picker's one exact-value field, which lives in the popup's portal rather
 *  than in the pane (the `host` query stays null for exactly that reason). */
function popupField(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(
    "[data-yunari-palette-color]",
  );
}

/** Types into the popup field and presses Enter, the way §5's text control
 *  commits — no blur, because the press is what settles the gesture. */
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
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

/** Opens the picker the way an author does, and hands back its value field. */
async function openPicker(host: HTMLElement): Promise<HTMLInputElement> {
  const trigger = pickerHost(host);
  if (trigger === null) throw new Error("The pane rendered no picker trigger.");
  await click(trigger);
  await flush();
  const field = popupField();
  if (field === null) throw new Error("The picker rendered no value field.");
  return field;
}

/** A colour typed exactly into the one field: trigger, fill, Enter. */
async function commitColour(host: HTMLElement, value: string): Promise<void> {
  await typeAndEnter(await openPicker(host), value);
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

it("lists every token with its name and its usage figure, and skips the none token", async () => {
  const { host } = await mount(PAINT_LIST_PALETTE, {
    usage: usageWith({
      none: [],
      background: [
        { objectId: "a", name: "Card title" },
        { objectId: "b", name: "Header" },
        { objectId: "c", name: "RAM gauge" },
      ],
      accent: [],
    }),
  });

  expect(listedTokenIds(host)).toEqual(["background", "accent"]);
  expect(listedTokenIds(host)).not.toContain("none");
  expect(usageFigure(host, "background")).toBe("3");
  // A token nothing uses reads as unused without being selected first.
  expect(usageFigure(host, "accent")).toBe("0");
  expect(host.textContent).toContain("Background");
});

it("states a missing reading rather than fabricating a zero when there is no scene", async () => {
  // §2.3 and the host's rule: a missing reading is stated, never defaulted.
  const { host } = await mount(PAINT_LIST_PALETTE, { usage: undefined });

  expect(usageFigure(host, "background")).toBe(uiCopy.panels.notSet);
  expect(usageFigure(host, "background")).not.toBe("0");
  // With no scene there is no list of users either: an empty one would read as
  // a measurement of zero rather than as an absent reading.
  expect(host.querySelector("[data-yunari-palette-users]")).toBeNull();
});

it("renders one trigger per colour, and no exact-value field of the pane's own", async () => {
  const { host } = await mount(PAINT_LIST_PALETTE, { usage: undefined });

  const triggers = host.querySelectorAll("[data-yunari-palette-picker]");
  expect(triggers, "one colour, one trigger").toHaveLength(1);
  expect(triggers[0]?.tagName).toBe("BUTTON");
  // The exact-value field is the popover's, so it is not in the pane at all
  // until the trigger is opened — and not in the document before that either.
  expect(host.querySelector("[data-yunari-palette-color]")).toBeNull();
  expect(popupField()).toBeNull();
});

it("opens the popup's one value field from the trigger", async () => {
  const { host } = await mount(PAINT_LIST_PALETTE, { usage: undefined });

  const field = await openPicker(host);

  expect(field).toBe(popupField());
  // Portalled: the pane does not own it.
  expect(host.querySelector("[data-yunari-palette-color]")).toBeNull();
  expect(field.value).toBe(BACKGROUND_PAINT);
});

it("keeps the picker's element standing while a value changes", async () => {
  const { host } = await mount(PAINT_LIST_PALETTE, { usage: undefined });
  const beforeHost = pickerHost(host);
  const beforeFields = fieldsHost(host);
  const beforeTrigger = pickerHost(host);
  expect(beforeHost).not.toBeNull();

  await commitColour(host, TYPED_PAINT);

  expect(pickerHost(host), "a colour change re-renders in place").toBe(
    beforeHost,
  );
  expect(fieldsHost(host), "and the field set is the same one").toBe(
    beforeFields,
  );
  expect(
    pickerHost(host),
    "the trigger the popover is anchored to is still the same node",
  ).toBe(beforeTrigger);
});

it("remounts the field set when the paint kind changes", async () => {
  const { host } = await mount(PAINT_LIST_PALETTE, { usage: undefined });
  const before = fieldsHost(host);
  expect(before).not.toBeNull();

  await chooseIn("[data-yunari-palette-kind]", "gradient");

  // The other direction of the rule above: a gradient is a different shape of
  // fields, so the set is rebuilt — which is what the imperative panel did and
  // what must not happen on a mere colour change.
  expect(fieldsHost(host), "a kind switch rebuilds the field set").not.toBe(
    before,
  );
});

it("rebuilds the field set when the token changes, so the picker cannot show the last token's colour", async () => {
  // The key's **token** term, which nothing else holds. Both tokens here are
  // solid, so the kind is unchanged and only `selected` moves the key — a key
  // trimmed to the paint kind keeps the whole file green, which is exactly what
  // this case is for.
  //
  // Identity is the measurement because it is the only thing a jsdom test can
  // see in time: the stale frame `ColourPicker`'s passive resync would show is
  // flushed by `act` before any assertion runs, so the value read here would
  // agree with the correct implementation either way. A node that survived the
  // switch is the same defect stated where it can be caught.
  const { host } = await mount(PAINT_LIST_PALETTE, { usage: undefined });
  const before = pickerHost(host);
  expect(before).not.toBeNull();

  await click(host.querySelector('[data-yunari-palette-token-row="accent"]')!);

  expect(pickerHost(host), "a token switch rebuilds the field set").not.toBe(
    before,
  );
});

it("commits a typed colour once and settles the history exactly once", async () => {
  const { host, change, settled } = await mount(PAINT_LIST_PALETTE, {
    usage: undefined,
  });

  await commitColour(host, AUTHORED_RGB_PAINT);

  // A colour typed in `rgb()` is stored as the hex the picker reports, and it
  // is the token that was being edited — not the rest of the palette
  // (Review Focus 1).
  expect(change).toHaveBeenLastCalledWith({
    ...PAINT_LIST_PALETTE,
    background: {
      name: "Background",
      value: { kind: "solid", color: AUTHORED_RGB_HEX },
    },
  });
  expect(settled, "one gesture is one history entry").toHaveBeenCalledOnce();
});

it("emits while the area is dragged, and settles nothing until pointer-up", async () => {
  const { host, change, settled } = await mount(PAINT_LIST_PALETTE, {
    usage: undefined,
  });
  await openPicker(host);
  const area = document.querySelector<HTMLElement>(
    '[data-testid="picker-area"]',
  );
  if (area === null) throw new Error("The picker rendered no area.");
  stubRect(area, 200, 200);

  await pointer(area, "pointerdown", 20, 20);
  for (const [x, y] of [
    [40, 40],
    [60, 60],
    [80, 80],
  ] as const) {
    await pointer(area, "pointermove", x, y);
  }

  expect(
    change.mock.calls.length,
    "each sample of the gesture is a live edit",
  ).toBeGreaterThan(1);
  expect(
    settled,
    "a gesture still under the pointer is not a history entry",
  ).not.toHaveBeenCalled();
});

it("refuses a value that is not a colour, and associates the reason with the field", async () => {
  const { host, change, settled } = await mount(PAINT_LIST_PALETTE, {
    usage: undefined,
  });

  const field = await openPicker(host);
  await typeAndEnter(field, "not-a-colour");

  expect(change).not.toHaveBeenCalled();
  expect(settled).not.toHaveBeenCalled();
  // The control set's editable-invalid channel (`vg-263`): the refusal is
  // announced — `aria-invalid` plus a described-by reason — and the field stays
  // editable, so the author can type a different colour. Before this the pane
  // drew a sibling `<p>` associated with nothing.
  expect(field.getAttribute("aria-invalid")).toBe("true");
  expect(field.readOnly, "the field must stay editable").toBe(false);
  const described = (field.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
  expect(described).toContain("not-a-colour");
});

it("shows an authored rgb() token as its hex form, in the trigger and the field", async () => {
  // Review Focus 1: the picker's one field is a colour, not a copy of the
  // document's spelling. The stored value's shape stays untouched elsewhere.
  const { host } = await mount(AUTHORED_RGB_PALETTE, { usage: undefined });

  expect(pickerHost(host)?.textContent).toContain(AUTHORED_RGB_HEX);
  expect((await openPicker(host)).value).toBe(AUTHORED_RGB_HEX);
});

it("edits the token the author picks, and commits it under its own stable id", async () => {
  const { host, change } = await mount(PAINT_LIST_PALETTE, {
    usage: undefined,
  });

  await click(host.querySelector('[data-yunari-palette-token-row="accent"]')!);
  await commitColour(host, EDITED_ACCENT_PAINT);

  expect(change).toHaveBeenLastCalledWith({
    ...PAINT_LIST_PALETTE,
    accent: {
      name: "Accent",
      value: { kind: "solid", color: EDITED_ACCENT_PAINT },
    },
  });
});

it("carries the colour across a paint-kind switch in both directions", async () => {
  // The measured defect: choosing Linear gradient over a 30% alpha panel
  // replaced it, in one dropdown choice, with an opaque white-to-black sweep,
  // and undo was the way back.
  const { host, change } = await mount(FROSTED_PANEL, { usage: undefined });

  await chooseIn("[data-yunari-palette-kind]", "gradient");
  expect(change).toHaveBeenLastCalledWith({
    frost: {
      name: "Frosted panel",
      value: {
        kind: "gradient",
        angle: 0,
        stops: [
          { offset: 0, color: FROST_PAINT },
          { offset: 1, color: FROST_PAINT },
        ],
      },
    },
  });

  // Now the gradient's first stop has been moved, and going back to a solid
  // takes that rather than white. The stop's colour is the picker's, the one
  // control the gradient editor gives a stop.
  await commitColour(host, MOVED_FROST_PAINT);
  await chooseIn("[data-yunari-palette-kind]", "solid");
  expect(change).toHaveBeenLastCalledWith({
    frost: {
      name: "Frosted panel",
      value: { kind: "solid", color: MOVED_FROST_PAINT },
    },
  });
  void host;
});

it("edits a gradient's angle, its stops and an added stop through its one editor", async () => {
  const { host, change } = await mount(GLOW_GRADIENT, { usage: undefined });

  await commitField('[data-testid="gradient-angle"]', "45");
  expect(change).toHaveBeenLastCalledWith({
    glow: {
      name: "Glow",
      value: {
        kind: "gradient",
        angle: 45,
        stops: [
          { offset: 0, color: BACKGROUND_PAINT },
          { offset: 1, color: BACKGROUND_PAINT },
        ],
      },
    },
  });

  // Both edits come from one editor, so a handler closing over the entry it was
  // built with would write the second stop list over the first.
  await commitColour(host, RED_PAINT);
  expect(change).toHaveBeenLastCalledWith({
    glow: {
      name: "Glow",
      value: {
        kind: "gradient",
        angle: 45,
        stops: [
          { offset: 0, color: RED_PAINT },
          { offset: 1, color: BACKGROUND_PAINT },
        ],
      },
    },
  });

  await click(host.querySelector('[data-testid="gradient-add"]')!);
  expect(change).toHaveBeenLastCalledWith({
    glow: {
      name: "Glow",
      value: {
        kind: "gradient",
        angle: 45,
        stops: [
          { offset: 0, color: RED_PAINT },
          // The midpoint is inserted between the two, where its offset sorts:
          // the document's validator requires the offsets to ascend.
          {
            offset: 0.5,
            color: colorAt(
              [
                { offset: 0, color: RED_PAINT },
                { offset: 1, color: BACKGROUND_PAINT },
              ],
              0.5,
            ),
          },
          { offset: 1, color: BACKGROUND_PAINT },
        ],
      },
    },
  });
});

it("keeps the fraction the stop's own percent well types", async () => {
  // `vg-494`: a percentage projection that rounds would show 38 for a stored
  // 0.375 and write 0.38 back. The well is a percent, and the fraction behind
  // it is the document's own value.
  const { host, change } = await mount(GLOW_GRADIENT, { usage: undefined });

  const well = host.querySelector<HTMLInputElement>(
    '[data-testid="gradient-offset"]',
  );
  expect(well, "the selected stop's offset well").not.toBeNull();
  expect(well?.value).toBe("0");

  await type(well!, "37.5");
  expect(change).toHaveBeenLastCalledWith({
    glow: {
      name: "Glow",
      value: {
        kind: "gradient",
        angle: 0,
        stops: [
          { offset: 0.375, color: BACKGROUND_PAINT },
          { offset: 1, color: BACKGROUND_PAINT },
        ],
      },
    },
  });
});

it("carries a replacement into the delete, and deletes through the port", async () => {
  const remove = vi.fn();
  const { host } = await mount(PAINT_LIST_PALETTE, {
    usage: undefined,
    onDelete: remove,
  });

  await chooseIn("[data-yunari-palette-replacement]", "accent");
  await click(
    host.querySelector<HTMLButtonElement>("[data-yunari-palette-delete]")!,
  );

  expect(remove).toHaveBeenCalledWith("background", "accent");
});

it("names the objects a token is used by, for the chosen token", async () => {
  const { host } = await mount(PAINT_LIST_PALETTE, {
    usage: usageWith({
      background: [{ objectId: "card", name: "Card title" }],
      accent: [{ objectId: "header", name: "Header" }],
    }),
  });

  expect(
    host.querySelector("[data-yunari-palette-users]")?.textContent,
  ).toContain("Card title");

  await click(host.querySelector('[data-yunari-palette-token-row="accent"]')!);
  const users = host.querySelector("[data-yunari-palette-users]")?.textContent;
  expect(users).toContain("Header");
  expect(users).not.toContain("Card title");
});
