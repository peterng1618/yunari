// @vitest-environment jsdom

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RadioGroup } from "@base-ui/react/radio-group";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { uiCopy } from "../../ui-copy.js";
import { ControlChoiceRow } from "./control-choice-row.js";
import { ControlIconButton } from "./control-icon-button.js";
import { ControlNumber } from "./control-number.js";
import { ControlSegmented } from "./control-segmented.js";
import { ControlSelect } from "./control-select.js";
import { ControlSlider } from "./control-slider.js";
import { ControlSwatch } from "./control-swatch.js";
import { ControlText } from "./control-text.js";
import { ControlToggle } from "./control-toggle.js";
import { wellClasses } from "./control-well.js";
import { InspectorSection } from "./inspector-section.js";

/** `DESIGN.md`, seven levels above this file — the same way `design-md.test.ts`
 *  reaches the root `scripts/`. §3's spacing table is normative for the control
 *  set, and nothing compared it to what the set writes (`vg-498`).
 *
 *  `dirname` on the file's own path rather than `new URL(relative, …)`: under
 *  jsdom the *global* `URL` is the environment's, and a `../`-prefixed
 *  specifier resolves against its `http://localhost:3000/` base rather than
 *  against the file's — which `fileURLToPath` then refuses. */
function design(): string {
  return readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../../../../DESIGN.md",
    ),
    "utf8",
  );
}

/** The editor's own sources — this file is `components/ui/`, two levels in. */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Every shipped editor source file, tests excluded: the same walk
 *  `react-root-disposal.dom.test.ts` makes, and for the same reason — a rule
 *  about the product's files has to read the product's files. */
function sourceFiles(dir = SRC): readonly string[] {
  // `readdirSync(path)` plus `statSync`, not `withFileTypes`: the editor's Node
  // typings are deliberately narrow (`node-builtins.d.ts`), and widening them
  // for a test's convenience is the act that file exists to make visible.
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(name)) return [];
    if (/\.test\.tsx?$/.test(name) || /\.test-stage\.tsx?$/.test(name))
      return [];
    return [path];
  });
}

/**
 * A file's source with its comments blanked to spaces.
 *
 * A comment that *names* an `<input>` is not one, and four files do:
 * `colour-maths.ts` and `colour-picker.tsx` explain why they do not use
 * `<input type="color">`, `control-well.tsx` says a replaced element has no
 * `::before`, and `navigation.ts` describes the ones that reach it. A raw
 * search reads every one of those as a control.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (line) => line.replace(/[^\n]/g, " "));
}

/** The shipped files that render an input of their own, with their source. */
function inputFiles(): readonly {
  readonly file: string;
  readonly source: string;
}[] {
  return sourceFiles().flatMap((path) => {
    const source = readFileSync(path, "utf8");
    if (!/<(?:input|textarea)\b/.test(withoutComments(source))) return [];
    return [{ file: relative(SRC, path).split("\\").join("/"), source }];
  });
}

/**
 * Whether a file **calls** the hook, read off the code rather than the prose
 * about it.
 *
 * Two things make this the call and not the name: the call's own syntax
 * (`useDraftCommit(`), and comments blanked first. Both were missing from the
 * first version of this walk, and each one alone was enough to keep it green —
 * an unused import, or `tags-field.tsx`'s own docblock naming the hook, passed
 * it with the spread deleted. A guard that a *mention* satisfies is not a guard
 * (`vg-203`'s fix round 2).
 */
function callsDraftCommit(source: string): boolean {
  return /\buseDraftCommit\s*\(/.test(withoutComments(source));
}

/** The name a file binds the hook's result to, when it takes the whole object
 *  rather than destructuring it. */
const BINDS_HOOK = /const\s+(\w+)\s*=\s*useDraftCommit\s*\(/;

/**
 * The input-taking files that do **not** take the decision from
 * `useDraftCommit`, each with the reason it does not.
 *
 * **The default is to fail.** A file the walk finds that is neither a hook
 * caller nor named here is red, so a new control has to use the hook or write
 * down why not — which is the shape the list of two files had inverted, and why
 * `panes/document/tags-field.tsx` shipped owning its own Enter and Escape
 * (`vg-203`'s defect, one control later).
 *
 * **Three entries are copies rather than sanctions.** They reimplement the
 * decision — their own Enter, and for the rename field an Escape too — with no
 * composing guard, which is exactly the defect this walk exists to see. They
 * are named so the gap is visible rather than silent, and each belongs to a
 * surface this change does not own.
 */
const EXEMPT: readonly (readonly [string, string])[] = [
  [
    "components/ui/colour-picker.tsx",
    "the hex field commits on each parseable keystroke, so there is no draft to commit or cancel",
  ],
  [
    "font-picker/font-picker.tsx",
    'a `type="search"` filter and a checkbox: neither holds an authored value',
  ],
  [
    "host-settings-mode/region.tsx",
    "a copy: its own Enter and blur commit, with no Escape and no composing guard",
  ],
  [
    "panes/add/file-section.tsx",
    'two hidden `type="file"` inputs, driven by their own buttons',
  ],
  [
    "panes/composition/composition-pane.tsx",
    "a copy: the inline rename field is uncontrolled and keeps its own Enter, Escape and blur",
  ],
  [
    "selection-inspector/runs.tsx",
    "a copy: the run format field keeps its own Enter and Escape, with no composing guard",
  ],
  ["store-mode/region.tsx", "the search well: a filter, not an authored value"],
  [
    "asset-finder/modal.tsx",
    "the search field is a filter that re-runs on a debounce: nothing is authored to commit or cancel",
  ],
  [
    "asset-finder/wallpaper-engine-body.tsx",
    "the search field filters the in-memory listing: nothing is authored to commit or cancel",
  ],
  [
    "editor-shell/settings.tsx",
    "the credential field commits through its own Save button and is cleared there, never on blur or Enter",
  ],
];

/**
 * The shared rules of the one control set — the two that are defects rather
 * than style (a control with no programmatic name, a refusal that omits the
 * row), plus the editing and recovery contract DESIGN.md §5 makes normative.
 *
 * The styles are not asserted here: jsdom resolves no custom properties, so a
 * computed-style assertion would pass whatever the cascade does. The rendered
 * treatment, the hit areas and the six-palette focus contrast belong to the
 * browser fixture, not to this file.
 */

// Base UI's popups need three browser APIs jsdom has none of: floating-ui
// observes its anchor, the popup waits for its own open transition, and it asks
// the selector engine for `:modal`/`:popover-open`, which jsdom parses slowly
// enough (about 0.5s a call) to dominate the file. The fourth is the switch's:
// it re-dispatches a click through a `PointerEvent` to carry modifier state,
// and jsdom has never had one. Each test file that mounts a primitive supplies
// its own — there is no shared harness for it here, so a file cannot inherit a
// shim that was deleted under it.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as never;
Element.prototype.getAnimations ??= (): never[] => [];
window.PointerEvent ??= MouseEvent as never;

// React only flushes work scheduled inside `act` when it has been told it is in
// a test; without this, `act` warns and the update lands after the assertion.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
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
let host: HTMLDivElement | undefined;

/** Mounts into a fresh host, replacing whatever the previous call mounted, so
 *  one case can render a refused control and then its working counterpart. */
async function mount(element: React.ReactNode): Promise<void> {
  if (root !== undefined) await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = document.createElement("div");
  document.body.append(host);
  const mounted = createRoot(host);
  root = mounted;
  await act(async () => {
    mounted.render(element);
  });
}

afterEach(async () => {
  if (root !== undefined) await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  vi.restoreAllMocks();
});

/** React and floating-ui schedule outside `act`, so the popup is flushed with
 *  macrotasks rather than one. */
async function flush(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * The control a label names, resolved the way an assistive technology resolves
 * it: `<label for>` → id, then `aria-label`, then `aria-labelledby`. The id
 * branch is the one the association depends on, so removing the pairing makes
 * this throw rather than fall through to something that merely looks labelled.
 */
function labelled(name: string): HTMLElement {
  for (const label of document.querySelectorAll("label")) {
    if (label.textContent?.trim() !== name) continue;
    const target =
      label.htmlFor === "" ? null : document.getElementById(label.htmlFor);
    if (target !== null) return target;
  }
  for (const element of document.querySelectorAll<HTMLElement>(
    "[aria-label]",
  )) {
    if (element.getAttribute("aria-label") === name) return element;
  }
  for (const element of document.querySelectorAll<HTMLElement>(
    "[aria-labelledby]",
  )) {
    const ids = (element.getAttribute("aria-labelledby") ?? "")
      .split(/\s+/)
      .filter(Boolean);
    const text = ids
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
    if (text === name) return element;
  }
  throw new Error(`no control is labelled "${name}"`);
}

/** The description a control points at, as an assistive technology reads it. */
function description(control: HTMLElement): string {
  const ids = (control.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean);
  return ids
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim();
}

/** A real edit, as React sees one. The value is set through the prototype's
 *  setter rather than the element's: React replaces `value` on the node itself
 *  with a tracker that records every assignment, so `node.value = x` would
 *  update the tracker and the change would be suppressed. `onChange` for a text
 *  input is the native `input` event; the dispatch is inside `act` because a
 *  continuous event's update is scheduled rather than flushed at dispatch. */
async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input) as HTMLInputElement,
      "value",
    )?.set;
    if (setter === undefined) input.value = value;
    else setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(
  target: Element,
  key: string,
  init: KeyboardEventInit = {},
): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });
}

async function click(target: Element, detail = 0): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail }),
    );
  });
}

/** A mouse press. Base UI's list items commit a click only when the press that
 *  precedes it started on the item, so the press is part of the interaction and
 *  not decoration. */
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

async function wheel(target: Element, deltaY: number): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true }),
    );
  });
}

async function unblur(target: HTMLElement): Promise<void> {
  await act(async () => {
    target.blur();
  });
}

const SHOWS: readonly { readonly id: string; readonly name: string }[] = [
  { id: "cpu.load", name: "CPU load" },
  { id: "mem.used", name: "Memory used" },
];
const ALIGN: readonly {
  readonly id: "left" | "center";
  readonly name: string;
}[] = [
  { id: "left", name: "Left" },
  { id: "center", name: "Center" },
];
const PAINTS: readonly { readonly id: string; readonly name: string }[] = [
  { id: "ink", name: "Ink" },
  { id: "paper", name: "Paper" },
];

it("gives every control a programmatic name and an id", async () => {
  await mount(
    <>
      <ControlText label="Title" value="CPU" onCommit={() => {}} />
      <ControlNumber label="Width" value={299} onCommit={() => {}} />
      <ControlSelect
        label="Shows"
        value="cpu.load"
        options={SHOWS}
        onChange={() => {}}
      />
      <ControlSwatch
        label="Fill"
        value="ink"
        options={PAINTS}
        swatch={<span data-swatch="" />}
        onChange={() => {}}
      />
      <ControlToggle label="Glass" checked={false} onChange={() => {}} />
      <ControlSegmented
        label="Align"
        value="left"
        options={ALIGN}
        onChange={() => {}}
      />
      <ControlSlider
        label="Opacity"
        value={50}
        min={0}
        max={100}
        onCommit={() => {}}
      />
      <ControlIconButton label="Delete layer" onClick={() => {}}>
        <span />
      </ControlIconButton>
      {/* A choice row is a radio and needs its group, so it is mounted the way
          the Appearance tab mounts it rather than standing alone. */}
      <RadioGroup value="editorial" onValueChange={() => {}}>
        <ControlChoiceRow
          label="Editorial"
          value="editorial"
          swatch={<span />}
        />
      </RadioGroup>
    </>,
  );

  for (const name of [
    "Title",
    "Width",
    "Shows",
    "Fill",
    "Glass",
    "Align",
    "Opacity",
    "Delete layer",
    "Editorial",
  ]) {
    expect(labelled(name).id, `${name} has no id to be named by`).not.toBe("");
  }
  expect(labelled("Title").tagName).toBe("INPUT");
  expect(labelled("Shows").tagName).toBe("BUTTON");
  expect(labelled("Glass").tagName).toBe("BUTTON");
  expect(labelled("Delete layer").tagName).toBe("BUTTON");
  expect(labelled("Opacity").tagName).toBe("INPUT");
  expect(labelled("Editorial").tagName).toBe("BUTTON");
});

it("gives two instances of one field distinct ids", async () => {
  await mount(
    <>
      <ControlText label="Title" value="a" onCommit={() => {}} />
      <ControlText label="Subtitle" value="b" onCommit={() => {}} />
    </>,
  );

  expect(labelled("Title").id).not.toBe(labelled("Subtitle").id);
});

it("renders a refused control rather than omitting it", async () => {
  await mount(
    <ControlToggle
      label="Glass"
      checked={false}
      onChange={() => {}}
      refused="not offered for a group"
    />,
  );

  expect(document.body.textContent).toContain("not offered for a group");
  const control = labelled("Glass");
  expect(control).toBeTruthy();
  expect(control.getAttribute("aria-disabled")).toBe("true");
  expect(control.hasAttribute("disabled")).toBe(false);
});

it("connects a refusal to its control and to the focus target", async () => {
  await mount(
    <ControlNumber
      label="Blur"
      value={2}
      min={0}
      max={10}
      refused="not offered for a group"
      onCommit={() => {}}
    />,
  );

  const control = labelled("Blur");
  expect(control.getAttribute("aria-disabled")).toBe("true");
  expect(control.hasAttribute("disabled")).toBe(false);
  expect(description(control)).toContain("not offered for a group");
});

it("a refused toggle cannot be turned by pointer, Space or Enter", async () => {
  const refused = vi.fn();
  await mount(
    <ControlToggle
      label="Glass"
      checked={false}
      onChange={refused}
      refused="not offered for a group"
    />,
  );
  const refuser = labelled("Glass");
  await click(refuser);
  await press(refuser, " ");
  await press(refuser, "Enter");
  expect(refused).not.toHaveBeenCalled();

  // The positive control: the same interaction on the same control, only
  // without the refusal, does change it — so the assertion above is about the
  // refusal rather than about a handler that never fires at all.
  const applied = vi.fn();
  await mount(
    <ControlToggle label="Glass" checked={false} onChange={applied} />,
  );
  await click(labelled("Glass"));
  expect(applied).toHaveBeenCalledWith(true);
});

it("a refused select cannot be changed by pointer or keyboard", async () => {
  const refused = vi.fn();
  await mount(
    <ControlSelect
      label="Shows"
      value="cpu.load"
      options={SHOWS}
      onChange={refused}
      refused="not offered for a group"
    />,
  );
  const trigger = labelled("Shows");
  await click(trigger);
  await flush();
  // The popup must actually open, or the refusal below proves nothing: a bare
  // `if (option !== null)` would pass on an implementation that renders no list
  // at all. `readOnly` locks the value but not the browsing, so the options are
  // there and the press is what must be refused.
  const refusedOptions = Array.from(
    document.querySelectorAll<HTMLElement>('[role="option"]'),
  );
  expect(
    refusedOptions.length,
    "the popup did not open, so the refusal below proves nothing",
  ).toBeGreaterThan(1);
  const refusedSecond = refusedOptions.find((option) =>
    (option.textContent ?? "").includes("Memory used"),
  );
  expect(refusedSecond).toBeTruthy();
  if (refusedSecond !== undefined) {
    await pointerDown(refusedSecond);
    await click(refusedSecond, 1);
  }
  await press(trigger, "ArrowDown");
  await press(trigger, "Enter");
  await flush();
  expect(refused).not.toHaveBeenCalled();

  const applied = vi.fn();
  await mount(
    <ControlSelect
      label="Shows"
      value="cpu.load"
      options={SHOWS}
      onChange={applied}
    />,
  );
  await click(labelled("Shows"));
  await flush();
  const options = Array.from(
    document.querySelectorAll<HTMLElement>('[role="option"]'),
  );
  expect(
    options.length,
    "the popup did not open, so the refusal above proves nothing",
  ).toBeGreaterThan(1);
  const second = options.find((option) =>
    (option.textContent ?? "").includes("Memory used"),
  );
  expect(second).toBeTruthy();
  if (second !== undefined) {
    await pointerDown(second);
    await click(second, 1);
  }
  await flush();
  expect(applied).toHaveBeenCalledWith("mem.used");
});

it("a refused segmented choice cannot be changed by pointer or arrow keys", async () => {
  const refused = vi.fn();
  await mount(
    <ControlSegmented
      label="Align"
      value="left"
      options={ALIGN}
      onChange={refused}
      refused="not offered for a group"
    />,
  );
  const group = labelled("Align");
  await press(group, "ArrowRight");
  const refusedSegments = Array.from(
    document.querySelectorAll<HTMLElement>("[role='group'] button"),
  );
  // Each segment is its own focus target, so each carries the refusal state.
  for (const segment of refusedSegments) {
    expect(segment.getAttribute("aria-disabled")).toBe("true");
  }
  for (const option of refusedSegments) {
    await click(option);
  }
  expect(refused).not.toHaveBeenCalled();

  const applied = vi.fn();
  await mount(
    <ControlSegmented
      label="Align"
      value="left"
      options={ALIGN}
      onChange={applied}
    />,
  );
  const buttons = document.querySelectorAll<HTMLElement>(
    "[role='group'] button",
  );
  expect(buttons).toHaveLength(2);
  if (buttons[1] !== undefined) await click(buttons[1]);
  expect(applied).toHaveBeenCalledWith("center");
});

it("a refused slider cannot be moved by arrow keys or by pointer", async () => {
  const refused = vi.fn();
  await mount(
    <ControlSlider
      label="Opacity"
      value={5}
      min={0}
      max={10}
      onCommit={refused}
      refused="not offered for a group"
    />,
  );
  const refuser = document.querySelector<HTMLInputElement>(
    'input[type="range"]',
  );
  expect(refuser, "the slider renders no focus target").toBeTruthy();
  // The nested `input[type=range]` is the element a screen reader reaches, so
  // the refusal state has to reach it and not only the root beside it.
  expect(refuser?.getAttribute("aria-disabled")).toBe("true");
  if (refuser !== null) {
    refuser.focus();
    await press(refuser, "ArrowRight");
    await click(refuser);
  }
  expect(refused).not.toHaveBeenCalled();

  const applied = vi.fn();
  await mount(
    <ControlSlider
      label="Opacity"
      value={5}
      min={0}
      max={10}
      onCommit={applied}
    />,
  );
  const thumb = document.querySelector<HTMLInputElement>('input[type="range"]');
  if (thumb !== null) {
    thumb.focus();
    await press(thumb, "ArrowRight");
  }
  expect(applied).toHaveBeenCalledWith(6);
});

it("refuses a non-numeric entry instead of coercing it to zero", async () => {
  const onCommit = vi.fn();
  await mount(
    <ControlNumber
      label="Width"
      value={299}
      min={0}
      max={1000}
      onCommit={onCommit}
    />,
  );

  const field = labelled("Width") as HTMLInputElement;
  await type(field, "abc");
  expect(onCommit).not.toHaveBeenCalledWith(0);
  expect(onCommit).not.toHaveBeenCalled();

  await press(field, "Enter");
  expect(onCommit).not.toHaveBeenCalled();
  expect(description(field), "the reason is not shown to the field").toContain(
    "not a number",
  );
  expect(field.getAttribute("aria-invalid")).toBe("true");
  // The rejected draft survives until it is corrected or cancelled.
  expect(field.value).toBe("abc");
});

it("does not commit an empty numeric draft, and never writes zero for it", async () => {
  const onCommit = vi.fn();
  await mount(<ControlNumber label="Width" value={299} onCommit={onCommit} />);
  const field = labelled("Width") as HTMLInputElement;
  await type(field, "");
  await press(field, "Enter");
  expect(onCommit).not.toHaveBeenCalled();
  expect(field.getAttribute("aria-invalid")).toBe("true");
  expect(description(field)).not.toBe("");

  // An optional field clears its authored key instead, and writes nothing.
  const cleared = vi.fn();
  await mount(
    <ControlNumber
      label="Width"
      value={299}
      onCommit={onCommit}
      onClear={cleared}
    />,
  );
  const optional = labelled("Width") as HTMLInputElement;
  await type(optional, "");
  await press(optional, "Enter");
  expect(cleared).toHaveBeenCalledTimes(1);
  expect(onCommit).not.toHaveBeenCalled();
});

it("refuses a fraction where the field owner asked for whole numbers", async () => {
  const onCommit = vi.fn();
  await mount(
    <ControlNumber
      label="Width"
      value={299}
      integer
      min={0}
      max={1000}
      onCommit={onCommit}
    />,
  );
  const field = labelled("Width") as HTMLInputElement;
  field.focus();
  await type(field, "45.5");
  await press(field, "Enter");
  expect(onCommit).not.toHaveBeenCalled();
  expect(field.value, "the rejected draft survives to be corrected").toBe(
    "45.5",
  );
  expect(description(field)).toContain("whole");

  // The same field with no integrality prop takes it: the rule is the owner's.
  await mount(<ControlNumber label="Width" value={299} onCommit={onCommit} />);
  const free = labelled("Width") as HTMLInputElement;
  free.focus();
  await type(free, "45.5");
  await press(free, "Enter");
  expect(onCommit).toHaveBeenCalledWith(45.5);
});

it("does not commit a number outside the field owner's bounds", async () => {
  const onCommit = vi.fn();
  await mount(
    <ControlNumber
      label="Width"
      value={299}
      min={0}
      max={1000}
      onCommit={onCommit}
    />,
  );
  const field = labelled("Width") as HTMLInputElement;
  await type(field, "4000");
  await press(field, "Enter");
  expect(onCommit).not.toHaveBeenCalled();
  expect(field.value).toBe("4000");
  expect(description(field)).toContain("1000");
});

/**
 * `vg-264`: the control set's five refusals are the copy table's words, not
 * literals of its own. Each is asserted against its `uiCopy.controls` entry, so
 * a refusal reworded in the set and not in the table — or the reverse — is this
 * red rather than a second vocabulary an author meets on one surface and not
 * another.
 */
it("takes its five refusals from the copy table rather than printing its own English", async () => {
  const onCommit = vi.fn();
  await mount(
    <ControlNumber
      label="Width"
      value={299}
      min={0}
      max={1000}
      integer
      onCommit={onCommit}
    />,
  );
  const field = labelled("Width") as HTMLInputElement;
  const refuse = async (draft: string): Promise<string> => {
    await type(field, draft);
    await press(field, "Enter");
    return description(field);
  };
  expect(await refuse("abc")).toBe(uiCopy.controls.notANumber);
  expect(await refuse("45.5")).toBe(uiCopy.controls.wholeNumber);
  expect(await refuse("2000")).toBe(uiCopy.controls.atMost(1000));
  expect(await refuse("-1")).toBe(uiCopy.controls.atLeast(0));

  // The empty draft is the fifth, and it needs a field with no `onClear` to
  // empty it through.
  await mount(<ControlNumber label="Width" value={299} onCommit={onCommit} />);
  const required = labelled("Width") as HTMLInputElement;
  await type(required, "");
  await press(required, "Enter");
  expect(description(required)).toBe(uiCopy.controls.valueRequired);
});

it("commits once on Enter, and not again on the blur that follows", async () => {
  const onCommit = vi.fn();
  await mount(<ControlNumber label="Width" value={299} onCommit={onCommit} />);
  const field = labelled("Width") as HTMLInputElement;
  field.focus();
  await type(field, "320");
  await press(field, "Enter");
  expect(onCommit).toHaveBeenCalledTimes(1);
  await unblur(field);
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onCommit).toHaveBeenCalledWith(320);
});

it("restores the authored value on Escape without committing", async () => {
  const onCommit = vi.fn();
  await mount(<ControlNumber label="Width" value={299} onCommit={onCommit} />);
  const field = labelled("Width") as HTMLInputElement;
  field.focus();
  await type(field, "320");
  expect(field.value).toBe("320");
  await press(field, "Escape");
  expect(field.value).toBe("299");
  await unblur(field);
  expect(onCommit).not.toHaveBeenCalled();
});

it("does not commit on the Enter of a composition", async () => {
  const onCommit = vi.fn();
  await mount(<ControlText label="Title" value="CPU" onCommit={onCommit} />);
  const field = labelled("Title") as HTMLInputElement;
  field.focus();
  await type(field, "CPU load");
  await act(async () => {
    field.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
  });
  await press(field, "Enter");
  expect(onCommit).not.toHaveBeenCalled();

  await act(async () => {
    field.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
  });
  await press(field, "Enter", { isComposing: true });
  expect(onCommit).not.toHaveBeenCalled();

  await press(field, "Enter");
  expect(onCommit).toHaveBeenCalledWith("CPU load");
});

it("takes the draft/commit keyboard decision from one owner, for the text and number fields alike", async () => {
  // vg-203: the composing ref, the Enter/IME guard and the Escape reset live in
  // `useDraftCommit`, which both controls call, so the *same* contract is run
  // against each — the case that would catch one copy drifting from the other.
  for (const field of ["text", "number"] as const) {
    const onCommit = vi.fn();
    await mount(
      field === "text" ? (
        <ControlText label="Title" value="CPU" onCommit={onCommit} />
      ) : (
        <ControlNumber label="Width" value={299} onCommit={onCommit} />
      ),
    );
    const input = labelled(
      field === "text" ? "Title" : "Width",
    ) as HTMLInputElement;
    const authored = field === "text" ? "CPU" : "299";
    const typed = field === "text" ? "CPU load" : "320";
    const committed = field === "text" ? "CPU load" : 320;
    input.focus();

    // An IME's Enter ends the composition; it never commits a half-typed draft.
    await type(input, typed);
    await act(async () => {
      input.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
    });
    await press(input, "Enter");
    expect(
      onCommit,
      `${field}: a composition's Enter commits`,
    ).not.toHaveBeenCalled();
    await act(async () => {
      input.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      );
    });

    // Enter commits the draft once; the blur it causes commits nothing more.
    await press(input, "Enter");
    expect(onCommit, `${field}: Enter commits the draft`).toHaveBeenCalledWith(
      committed,
    );
    await unblur(input);
    expect(
      onCommit,
      `${field}: Enter then blur commits twice`,
    ).toHaveBeenCalledTimes(1);

    // Escape restores the authored value and commits nothing for the draft.
    input.focus();
    await type(input, typed);
    await press(input, "Escape");
    expect(input.value, `${field}: Escape restores the authored value`).toBe(
      authored,
    );
    await unblur(input);
    expect(
      onCommit,
      `${field}: Escape then blur commits`,
    ).toHaveBeenCalledTimes(1);
  }
});

it("takes the draft/commit decision from the one hook, in every file that holds an input", () => {
  // vg-203: the composing ref, the Enter/IME guard and the Escape reset live in
  // `useDraftCommit`, and this walk is what requires every control to take them
  // from there. It fails by default — a file that holds an input is red until
  // it calls the hook or is named in `EXEMPT` with a reason — because the
  // earlier version of this case listed the two files that did, which let a
  // third one omit the decision in silence.
  const files = inputFiles();
  const named = files.map((entry) => entry.file);

  // **The walk must be able to see the real case.** These two are its floor: a
  // regex narrowed until it stopped matching a raw `<input>` would pass the
  // assertion below by finding nothing to object to.
  for (const known of [
    "components/ui/control-text.tsx",
    "components/ui/control-number.tsx",
  ]) {
    expect(named, `the walk no longer sees ${known}`).toContain(known);
  }

  const exempt = new Map(EXEMPT);
  expect(
    files
      .filter(
        (entry) => !callsDraftCommit(entry.source) && !exempt.has(entry.file),
      )
      .map((entry) => entry.file),
    "an input-taking file neither calls useDraftCommit nor says why it does not",
  ).toEqual([]);

  // And a file that calls the hook may not keep a copy of the decision beside
  // it. Both copies were *correct* when vg-203 was filed, so only reading the
  // source sees one coming back — the behavioural cases pass against either.
  // Comments are blanked here too: this file's own docblock says "composing
  // ref", and prose is not a copy of the decision.
  //
  // The last assertion is the other half of a call: a result that is computed
  // and discarded leaves the handlers reaching nothing, which is the same defect
  // as not calling it. One occurrence count sees it — the binding itself, plus
  // at least one use of it (`{...keys}`, `keys.onKeyDown`) — without
  // enumerating the shapes a use can take. A use has to be a use of *this
  // binding*: a member access off something else is not one, and the lookbehind
  // below is what says so. The ceiling is exactly that: *that* the result is
  // used, not that it is used well, and a file that destructures the call
  // rather than binding it is not checked at all.
  for (const entry of files.filter((file) => callsDraftCommit(file.source))) {
    const code = withoutComments(entry.source);
    expect(code, `${entry.file}: a composing handler of its own`).not.toMatch(
      /onComposition(Start|End)/,
    );
    expect(code, `${entry.file}: a composing ref of its own`).not.toMatch(
      /\buseRef\b/,
    );
    const bound = BINDS_HOOK.exec(code)?.[1];
    if (bound === undefined) continue;
    // `(?<![\w$]\.)`: every caller binds the hook as `keys`, and `Object.keys`
    // is a bare `keys` in the same file — idiomatic here
    // (`control-slider.tsx`, `card-token-mapping.ts`), and one line of it
    // satisfied the count while the wiring was missing. The spread's `...` and
    // a member use's leading position are preceded by no word character and a
    // dot, so both still count.
    expect(
      code.match(new RegExp(`(?<![\\w$]\\.)\\b${bound}\\b`, "g"))?.length ?? 0,
      `${entry.file}: calls useDraftCommit and never uses what it returns`,
    ).toBeGreaterThan(1);
  }

  // An exemption for a file that no longer holds an input is a reason nobody can
  // check, so it goes red rather than staying in the list for ever.
  for (const file of exempt.keys()) {
    expect(named, `${file} is exempted and holds no input`).toContain(file);
  }
});

it("commits one slider step once, and previews it separately from history", async () => {
  const onPreview = vi.fn();
  const onCommit = vi.fn();
  await mount(
    <ControlSlider
      label="Opacity"
      value={5}
      min={0}
      max={10}
      onPreview={onPreview}
      onCommit={onCommit}
    />,
  );
  const thumb = document.querySelector<HTMLInputElement>('input[type="range"]');
  if (thumb !== null) {
    thumb.focus();
    await press(thumb, "ArrowRight");
  }
  expect(onPreview).toHaveBeenCalledWith(6);
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onCommit).toHaveBeenCalledWith(6);
});

it("cancels a slider gesture with Escape and commits nothing for it", async () => {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  await mount(
    <ControlSlider
      label="Opacity"
      value={5}
      min={0}
      max={10}
      onCancel={onCancel}
      onCommit={onCommit}
      data={{ "data-testid": "opacity-slider" }}
    />,
  );
  const slider = document.querySelector<HTMLElement>(
    '[data-testid="opacity-slider"]',
  );
  expect(slider, "the data attributes did not reach the control").toBeTruthy();
  if (slider === null) return;

  // A press in flight is the only gesture jsdom can hold open: it has no
  // layout, so Base UI's pointer drag resolves to no value at all and its
  // release path cannot be reached here. What this asserts is the cancel
  // contract — Escape cancels once and the release that follows commits
  // nothing. The drag itself is the browser fixture's business.
  await act(async () => {
    slider.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );
  });
  await press(slider, "Escape");
  await act(async () => {
    slider.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
  });
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onCommit).not.toHaveBeenCalled();
});

it("commits a value typed into the slider's well, refusing one past the bound", async () => {
  const onCommit = vi.fn();
  await mount(
    <ControlSlider
      label="Opacity"
      value={5}
      min={0}
      max={10}
      onCommit={onCommit}
    />,
  );
  const well = document.querySelector<HTMLInputElement>('input[type="text"]');
  expect(well, "the well is not an input").toBeTruthy();
  if (well === null) return;
  // The row's own label names the well as well as the track: one word for one
  // control, and no second copy of it beside the fixed-width readout.
  const nameId = well.getAttribute("aria-labelledby");
  expect(document.getElementById(nameId ?? "")?.textContent).toBe("Opacity");
  expect(nameId, "the well is unnamed").toBe(
    document
      .querySelector<HTMLInputElement>('input[type="range"]')
      ?.getAttribute("aria-labelledby"),
  );

  await type(well, "8");
  await press(well, "Enter");
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onCommit).toHaveBeenCalledWith(8);

  // A draft past the bound is kept with its reason rather than clamped: §5's
  // rule, and the same one the control's own number field keeps.
  await type(well, "60");
  await press(well, "Enter");
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).toContain("at most 10");
});

it("moves the value by the slider's own step on a wheel, and not when refused", async () => {
  const onCommit = vi.fn();
  const onPreview = vi.fn();
  await mount(
    <ControlSlider
      label="Opacity"
      value={5}
      min={0}
      max={20}
      onPreview={onPreview}
      onCommit={onCommit}
    />,
  );
  const range = document.querySelector<HTMLInputElement>('input[type="range"]');
  const well = document.querySelector<HTMLInputElement>('input[type="text"]');
  expect(range?.getAttribute("step"), "the drag's step is not one").toBe("1");
  expect(well, "the wheel has no surface to be dispatched on").toBeTruthy();
  if (well === null) return;
  await wheel(well, -100);
  expect(onPreview).toHaveBeenCalledWith(6);
  expect(onCommit).toHaveBeenCalledWith(6);

  // The step is read from the slider rather than declared beside it: the
  // input's own step is what the wheel moves by, which a constant could not be.
  await mount(
    <ControlSlider
      label="Opacity"
      value={5}
      min={0}
      max={20}
      onCommit={onCommit}
    />,
  );
  const next = document.querySelector<HTMLInputElement>('input[type="range"]');
  const nextWell =
    document.querySelector<HTMLInputElement>('input[type="text"]');
  if (next === null || nextWell === null) return;
  next.step = "5";
  onCommit.mockClear();
  await wheel(nextWell, 100);
  expect(onCommit).toHaveBeenCalledWith(0);

  const refused = vi.fn();
  await mount(
    <ControlSlider
      label="Opacity"
      value={5}
      min={0}
      max={20}
      refused="not offered for a group"
      onCommit={refused}
    />,
  );
  const refusedWell =
    document.querySelector<HTMLInputElement>('input[type="text"]');
  if (refusedWell === null) return;
  await wheel(refusedWell, -100);
  expect(refused).not.toHaveBeenCalled();
});

it("does nothing on a wheel while the value sits outside the control's own range", async () => {
  // The state another owner's measure leaves behind: a panel carrying a border
  // of 100 whose box is then resized to 40 has `max` 40 and a value of 100. A
  // tick *up* clamped inside the handler would commit 40 — lowering the value
  // and writing history for an edit the gesture never asked for.
  const onCommit = vi.fn();
  const onPreview = vi.fn();
  await mount(
    <ControlSlider
      label="Border"
      value={100}
      min={0}
      max={40}
      onPreview={onPreview}
      onCommit={onCommit}
    />,
  );
  const well = document.querySelector<HTMLInputElement>('input[type="text"]');
  expect(well, "the wheel has no surface to be dispatched on").toBeTruthy();
  if (well === null) return;

  await wheel(well, -100);
  await wheel(well, 100);
  expect(onCommit).not.toHaveBeenCalled();
  expect(onPreview).not.toHaveBeenCalled();
  // And the well still reads the document's own value rather than a clamp.
  expect(well.value).toBe("100");

  // Below the floor is the same state in the other direction: a stored
  // rotation left over from a range this field no longer carries.
  await mount(
    <ControlSlider
      label="Angle"
      value={-500}
      min={-360}
      max={360}
      onCommit={onCommit}
    />,
  );
  const under = document.querySelector<HTMLInputElement>('input[type="text"]');
  if (under === null) return;
  await wheel(under, -100);
  expect(onCommit).not.toHaveBeenCalled();
});

it("states the stored value its own track cannot reach, rather than drawing a different one", async () => {
  // `vg-494`. The state another owner's measure leaves behind, the one the wheel
  // case above is the other half of: a panel carrying a border of 100 whose box
  // is typed down to a drawn edge of 40 has `max` 40 and a stored value of 100.
  // The two halves of one control then read two different numbers, and the track
  // cannot stop doing that — the platform clamps an `input[type=range]` to its
  // own bounds, and ARIA will not let a slider report a value outside them
  // either. So the control says which of the two is the document's.
  await mount(
    <ControlSlider
      label="Border"
      value={100}
      min={0}
      max={40}
      onCommit={() => {}}
    />,
  );
  const track = document.querySelector<HTMLInputElement>('input[type="range"]');
  const well = document.querySelector<HTMLInputElement>('input[type="text"]');
  expect(track, "the track is not a range input").toBeTruthy();
  expect(well, "the well is not an input").toBeTruthy();
  if (track === null || well === null) return;
  // The disagreement itself, read off one mounted control: the thumb at the
  // bound and the well on the document's value.
  expect(track.value, "the platform no longer clamps the thumb").toBe("40");
  expect(well.value).toBe("100");

  const note = document.querySelector<HTMLElement>(
    "[data-yunari-slider-out-of-range]",
  );
  expect(
    note,
    "the track draws the bound and says nothing about the value it cannot " +
      "reach, so the two halves of the control disagree in silence",
  ).not.toBeNull();
  expect(note?.textContent).toContain("100");
  expect(note?.textContent).toContain("40");
  // Connected to both halves: the thumb is the element that cannot report the
  // value, and the well is the element that reads it.
  expect(track.getAttribute("aria-describedby")?.split(" ")).toContain(
    note?.id,
  );
  expect(well.getAttribute("aria-describedby")?.split(" ")).toContain(note?.id);

  // The other direction, and the same state: a stored value under the floor.
  await mount(
    <ControlSlider
      label="Angle"
      value={-500}
      min={-360}
      max={360}
      onCommit={() => {}}
    />,
  );
  const under = document.querySelector<HTMLElement>(
    "[data-yunari-slider-out-of-range]",
  );
  expect(under?.textContent).toContain("-500");
  expect(under?.textContent).toContain("-360");

  // And nothing is said where the two halves agree: a note on every slider
  // would be a row of prose under every bounded number in the product.
  await mount(
    <ControlSlider
      label="Opacity"
      value={5}
      min={0}
      max={10}
      onCommit={() => {}}
    />,
  );
  expect(
    document.querySelector("[data-yunari-slider-out-of-range]"),
    "an in-range slider carries the out-of-range note",
  ).toBeNull();
});

it("gives an icon button its name and its tooltip from one label", async () => {
  await mount(
    <ControlIconButton
      label="Delete layer"
      shortcut={{ printed: "Ctrl+Z", spoken: "Control Z" }}
      onClick={() => {}}
    >
      <span />
    </ControlIconButton>,
  );
  const button = labelled("Delete layer");
  expect(button.getAttribute("aria-label")).toBe("Delete layer");

  // Focus opens it without the hover delay, and the popup is the same one the
  // selection inspector shows — the control wires the one tooltip owner rather
  // than growing a React second.
  await act(async () => button.focus());
  const popup = document.querySelector(".editor-shell-tooltip");
  expect(popup, "focus did not open the tooltip").toBeTruthy();
  expect(popup?.textContent).toContain("Delete layer");
  expect(popup?.querySelector("kbd")?.textContent).toBe("Ctrl+Z");
  expect(popup?.querySelector("kbd")?.getAttribute("aria-label")).toBe(
    "Control Z",
  );
  expect(description(button)).toContain("Delete layer");

  await act(async () => button.blur());
  expect(document.querySelector(".editor-shell-tooltip")).toBeNull();

  // Teardown: unmounting the control takes the popup and its listeners with it.
  await act(async () => button.focus());
  await mount(<span>gone</span>);
  expect(document.querySelector(".editor-shell-tooltip")).toBeNull();
});

it("toggles an inspector section from its header", async () => {
  await mount(
    <InspectorSection id="content" title="Content">
      <span>Position</span>
    </InspectorSection>,
  );
  const header = document.querySelector<HTMLButtonElement>("#content-header");
  expect(header?.getAttribute("aria-expanded")).toBe("true");
  expect(header?.textContent).toContain("Content");
  expect(document.body.textContent).toContain("Position");

  if (header !== null) await click(header);
  expect(header?.getAttribute("aria-expanded")).toBe("false");
  expect(document.getElementById("content-panel")?.hasAttribute("hidden")).toBe(
    true,
  );
});

it("names a section with data-yunari-section from its own id", async () => {
  await mount(
    <InspectorSection id="content" title="Content">
      <span>Position</span>
    </InspectorSection>,
  );
  // Plan 3's locators read `[data-yunari-section="…"]`; the attribute has to
  // be on the section element itself, not only on the header and the panel.
  const section = document.querySelector('[data-yunari-section="content"]');
  expect(
    section,
    "the data-yunari-section hook the later plans read did not render",
  ).toBeTruthy();
  expect(section?.tagName).toBe("SECTION");
});

it("raises the well's edge on hover, except when the control is blocked", () => {
  // DESIGN.md §5 rule 6: hover raises the resting `--edge` to `--muted`. jsdom
  // resolves no custom property, so the pin is the class the cascade is built
  // from — it fails if the hover rule is removed.
  expect(wellClasses("panel")).toContain("hover:border-muted");
  // A blocked control (disabled or refused) must not advertise a change it
  // will not make, so the caller suppresses the raise.
  expect(wellClasses("panel", true)).not.toContain("hover:border-muted");
});

it("pads a well with the step §3's table names for it", () => {
  // `vg-498`. Code padded 6, both current drawings draw `padding:4px 6px`, and
  // §3's table gave the 4px step to well padding — three sources against one
  // table cell, with no case reading either side of the split, so nothing ever
  // reddened on it. `design-tokens.mjs` holds a surface to §3's *steps* and
  // never compares that list to the table's own assignment, and
  // `design-language-controls.spec.ts` reads the well's right edge against the
  // row, which passes at either width. This is the missing read: the table's
  // assignment and the class the well is built from, against each other.
  //
  // The table moves rather than the pad, and that is the row's own ruling: the
  // code and *both* drawings write 6 horizontally, so the cell is the odd one
  // out. The read is anchored on the table row's own words rather than on a
  // line, because a line number here rots and this one has already moved.
  const row =
    /^\|\s*(\d+)\s*\|\s*([^|]*well's horizontal padding[^|]*)\|$/m.exec(
      design(),
    );
  expect(
    row,
    "§3's table names no step for a well's horizontal padding, so the padding " +
      "the wells write is sanctioned by nothing",
  ).not.toBeNull();
  expect(
    wellClasses("panel"),
    `§3's table names the ${row?.[1]}px step for a well's horizontal padding, ` +
      "which the well does not write",
  ).toContain(`px-[var(--space-${row?.[1]})]`);
});

/**
 * `vg-464`: one focus boundary, owned by the well.
 *
 * The well draws it (`focus-within:outline-*`, following the control's
 * `rounded-md`), and the field inside a well declares `outline-none` so the
 * shell's `:focus-visible` fallback is the only other rule that could draw one.
 * That fallback wins the cascade while it is unlayered, whatever the specificity
 * — the fact is `editor-shell.control-rules.test.ts`'s to hold, because jsdom
 * resolves no cascade and a computed-style assertion here would pass whatever
 * the stylesheet said. What this file can read is the *split*: which node takes
 * focus, and which of the two declares the boundary.
 */
it("focuses the field, and leaves the focus boundary to the well around it", async () => {
  await mount(
    <ControlText label="Name" value="wordmark" onCommit={() => {}} />,
  );
  const field = labelled("Name");
  field.focus();

  expect(document.activeElement, "the field is not the focus target").toBe(
    field,
  );
  expect(
    field.className,
    "the field draws a boundary of its own, which is the second outline " +
      "vg-464 records beside the well's rounded one",
  ).toContain("outline-none");
  const well = field.parentElement;
  expect(
    well?.className,
    "nothing inside the well declares the focus boundary, so the field has " +
      "none — the shell's fallback is no longer a substitute for one",
  ).toContain("focus-within:outline-2");
  expect(well?.className).toContain("focus-within:outline-accent");

  // The number field is the same shape in the same cascade, which is what the
  // row's failure mode names: the second outline removed from one input and
  // left on the others.
  await mount(<ControlNumber label="Opacity" value={5} onCommit={() => {}} />);
  const number = labelled("Opacity");
  number.focus();
  expect(number.className).toContain("outline-none");
  expect(
    number.parentElement?.className,
    "the number field's well draws no boundary, so removing the field's own " +
      "left the control with none",
  ).toContain("focus-within:outline-2");
});

it("raises the toggle's edge on hover only while it is unchecked", async () => {
  await mount(
    <ControlToggle label="Glass" checked={false} onChange={() => {}} />,
  );
  const pill = labelled("Glass");
  expect(pill.className).toContain("hover:data-[unchecked]:border-muted");
  // The checked pill carries the boolean as an accent border; hover must not
  // override the state, which the `data-[unchecked]` guard is what prevents.
  expect(pill.className).toContain("data-[checked]:border-accent");
});

it("puts a control's data on the node that takes focus", async () => {
  await mount(
    <ControlSlider
      label="Opacity"
      value={5}
      min={0}
      max={10}
      onCommit={() => {}}
      data={{ "data-testid": "opacity" }}
    />,
  );
  const slider = document.querySelector<HTMLInputElement>(
    '[data-testid="opacity"]',
  );
  expect(slider?.tagName, "the data is not on the range input").toBe("INPUT");
  slider?.focus();
  expect(document.activeElement).toBe(slider);
  expect(document.activeElement?.getAttribute("data-testid")).toBe("opacity");

  await mount(
    <ControlSegmented
      label="Align"
      value="left"
      options={ALIGN}
      onChange={() => {}}
      data={{ "data-testid": "align" }}
    />,
  );
  const segment = document.querySelector<HTMLElement>('[data-testid="align"]');
  expect(segment?.tagName, "the data is not on a segment button").toBe(
    "BUTTON",
  );
  segment?.focus();
  expect(document.activeElement?.getAttribute("data-testid")).toBe("align");
});

it("a refused select or swatch does not raise its well's edge on hover", async () => {
  // The select's well is its trigger, which carries `wellClasses`. A refusal is
  // `readOnly`, not `disabled`, so the blocked state has to reach `wellClasses`
  // or the well still raises `--edge` -> `--muted` on hover.
  await mount(
    <ControlSelect
      label="Shows"
      value="cpu.load"
      options={SHOWS}
      onChange={() => {}}
      refused="not offered for a group"
    />,
  );
  expect(labelled("Shows").className).not.toContain("hover:border-muted");

  await mount(
    <ControlSwatch
      label="Fill"
      value="ink"
      options={PAINTS}
      swatch={<span data-swatch="" />}
      onChange={() => {}}
      refused="not offered for a group"
    />,
  );
  expect(labelled("Fill").className).not.toContain("hover:border-muted");

  // The positive control: the same controls without a refusal do carry the raise.
  await mount(
    <ControlSelect
      label="Shows"
      value="cpu.load"
      options={SHOWS}
      onChange={() => {}}
    />,
  );
  expect(labelled("Shows").className).toContain("hover:border-muted");
});
