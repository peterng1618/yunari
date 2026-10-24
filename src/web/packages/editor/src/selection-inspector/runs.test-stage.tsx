import {
  type Binding,
  type FabricGlobals,
  type SampleSource,
  SEMANTIC_KEYS,
  type TextRun,
} from "@yunari/renderer-core";
import { YUNARI_TEXT_PROPERTY } from "@yunari/scene-fabric";
import { Canvas, Textbox } from "fabric/es";
import { act } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  appendRun,
  dropRun,
  type RunTarget,
  writeBindingFormat,
  writeBindingZone,
  writeRunColour,
  writeRunPreset,
  writeRunSource,
  writeRunText,
  writeTextLayout,
  writeUnitDisplay,
} from "./run-edits.js";
import { projectRuns, RunEditor } from "./runs.js";
import type { RunEdits } from "./view.js";

/**
 * The run editor's test stage: a text object, the binding store a run's reading
 * lives in, and the React editor mounted over them.
 *
 * Shared by `runs.dom.test.ts` (what each control writes) and
 * `runs.dom.test.tsx` (the two cases that need a real re-publish, where the
 * editor keeps its own state). The writes go through the same functions
 * `index.ts`'s port calls, so a case here fails when the rule does rather than
 * when a copy of it drifts.
 */

// React flushes work scheduled inside `act` only when it has been told it is in
// a test; without this the update lands after the assertion.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Base UI's popups need three browser APIs jsdom has none of: floating-ui
// observes its anchor, the popup waits for its own open transition, and it
// re-dispatches a click through a `PointerEvent` to carry modifier state.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as never;
Element.prototype.getAnimations ??= (): never[] => [];
window.PointerEvent ??= MouseEvent as never;

// jsdom parses `:modal`/`:popover-open` slowly enough to dominate a file, and
// Base UI asks for both whenever a popup opens.
const nativeMatches = Element.prototype.matches;
Element.prototype.matches = Object.assign(function (
  this: Element,
  selector: string,
): boolean {
  if (selector === ":modal" || selector === ":popover-open") return false;
  return nativeMatches.call(this, selector);
}, nativeMatches);

/** The label a semantic key is offered under — the source list names the reading
 *  the way the rest of the editor does, not by its spelling. */
export function sourceLabel(key: string): string {
  return (
    SEMANTIC_KEYS.find((descriptor) => descriptor.key === key)?.label ?? key
  );
}

export interface RunEditorStage {
  readonly host: HTMLElement;
  readonly object: Textbox;
  /** Re-projects the object and re-renders, as the editor's own re-publish does. */
  readonly render: () => void;
  readonly runs: () => readonly TextRun[];
  /** The object's whole authored text, layout fields included. */
  readonly content: () => Record<string, unknown>;
  readonly stored: () => readonly Binding[];
  readonly notes: () => readonly string[];
  readonly binding: () => {
    readonly text: string | undefined;
    readonly problem: string | undefined;
  };
  readonly pick: <T extends HTMLElement>(selector: string) => T;
  readonly dispose: () => Promise<void>;
}

export function mountRunEditor(options: {
  readonly runs: readonly TextRun[];
  readonly locale?: string;
  readonly globals?: FabricGlobals;
  /** Keys a reading has arrived for; absent means nothing has. */
  readonly arrived?: readonly string[];
  readonly declared?: readonly Binding[];
}): RunEditorStage {
  // A popup renders into `document.body`, not the host, so a case that failed
  // before disposing would leave its list open for the next one to pick an
  // option out of. Each stage starts from an empty body.
  document.body.replaceChildren();

  const canvas = new Canvas(document.createElement("canvas"));
  const object = new Textbox("", { id: "clock-label" });
  object.set(YUNARI_TEXT_PROPERTY, { runs: options.runs });
  canvas.add(object);

  let bindings: readonly Binding[] = [...(options.declared ?? [])];
  const nodeId = "clock-label";
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  const arrived = options.arrived ?? [];
  const sampleSource = (): SampleSource => ({
    latest: (key: string) =>
      arrived.includes(key)
        ? {
            sensorId: key,
            timestamp: "2026-09-20T00:00:00.000Z",
            status: "ok" as const,
            value: 1,
          }
        : undefined,
    history: () => [],
  });

  const target = (): RunTarget => ({
    object,
    nodeId,
    bindings: () => bindings,
    setBindings: (next) => {
      bindings = next;
    },
  });

  const render = (): void => {
    const view = projectRuns(object, nodeId, {
      globals: options.globals,
      locale: options.locale,
      nodeBindings: () => bindings,
      sampleSource,
      wraps: object instanceof Textbox,
      swatchValue: () => undefined,
    });
    if (view === undefined) {
      throw new Error("the object carries no authored text to edit");
    }
    flushSync(() => {
      root.render(<RunEditor runs={view} edits={edits} />);
    });
  };

  const apply = (change: (t: RunTarget) => boolean): boolean => {
    const done = change(target());
    render();
    return done;
  };

  const edits: RunEdits = {
    setRunText: (index, text) => apply((t) => writeRunText(t, index, text)),
    setRunPreset: (index, ref) => apply((t) => writeRunPreset(t, index, ref)),
    setRunColour: (index, ref) => apply((t) => writeRunColour(t, index, ref)),
    setUnitDisplay: (index, value) =>
      apply((t) => writeUnitDisplay(t, index, value)),
    setSource: (index, key) => apply((t) => writeRunSource(t, index, key)),
    setFormat: (index, format) =>
      apply((t) => writeBindingFormat(t, index, format)),
    setZone: (index, zone) => apply((t) => writeBindingZone(t, index, zone)),
    writeLayout: (patch) => apply((t) => writeTextLayout(t, patch)),
    addRun: () => apply(appendRun),
    removeRun: (index) => apply((t) => dropRun(t, index)),
  };

  render();

  return {
    host,
    object,
    render,
    runs: () => {
      const content = object.get(YUNARI_TEXT_PROPERTY) as {
        readonly runs?: readonly TextRun[];
      };
      return content.runs ?? [];
    },
    content: () =>
      (object.get(YUNARI_TEXT_PROPERTY) ?? {}) as Record<string, unknown>,
    stored: () => bindings,
    notes: () =>
      [...host.querySelectorAll<HTMLElement>("[data-yunari-run-note]")].map(
        (note) => note.textContent ?? "",
      ),
    binding: () => {
      const note = host.querySelector<HTMLElement>("[data-yunari-run-binding]");
      return {
        text: note?.textContent ?? undefined,
        problem: note?.dataset["yunariRunProblem"],
      };
    },
    pick: <T extends HTMLElement>(selector: string): T =>
      host.querySelector<T>(selector)!,
    dispose: async () => {
      await act(async () => {
        root.unmount();
      });
      host.remove();
      await canvas.dispose();
    },
  };
}

/** React and floating-ui schedule outside `act`, so a popup is flushed with
 *  macrotasks rather than one. */
export async function flush(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 3; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

export async function click(target: Element, detail = 0): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail }),
    );
  });
}

/** A mouse press. Base UI's list items commit a click only when the press that
 *  precedes it started on the item, so the press is part of the interaction. */
export async function pointerDown(target: Element): Promise<void> {
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

export async function press(target: Element, key: string): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

/**
 * Steps a plan-1 slider the way a person does: focus its `input[type=range]`
 * and press an arrow key, or `Home`/`End` to reach a bound. Base UI commits a
 * keyboard step, which is the only gesture jsdom can resolve — it has no
 * layout, so a pointer drag ends on no value at all (see `ControlSlider`).
 */
export async function slide(
  element: HTMLInputElement,
  key: "ArrowRight" | "ArrowLeft" | "Home" | "End",
): Promise<void> {
  await act(async () => {
    element.focus();
  });
  await press(element, key);
}

/** A real edit, as React sees one: the value goes in through the prototype's
 *  setter, because React replaces `value` with a tracker that would suppress a
 *  plain assignment. The draft commits on blur or Enter. */
export async function typeInto(
  input: HTMLInputElement,
  value: string,
): Promise<void> {
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

/** Off the field, which is what commits an edit. jsdom fires `blur` only for an
 *  element that holds focus, so the focus is taken and given up in one turn. */
export async function blur(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.focus();
    element.blur();
  });
}

/** The trigger of a select, addressed by the hook on it. */
function trigger(host: HTMLElement, hook: string): HTMLElement {
  const found = host.querySelector<HTMLElement>(`[${hook}]`);
  if (found === null) throw new Error(`no control carries ${hook}`);
  return found;
}

/** What a select shows, without the chevron its well draws beside the value. */
export function valueText(host: HTMLElement, hook: string): string {
  return (trigger(host, hook).textContent ?? "").replace(/▼/g, "").trim();
}

/** Opens a select and picks the entry reading `option`. */
export async function choose(
  host: HTMLElement,
  hook: string,
  option: string,
): Promise<void> {
  const open = trigger(host, hook);
  await click(open);
  await flush();
  const items = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
  const item = items.find(
    (candidate) => (candidate.textContent ?? "").trim() === option,
  );
  if (item === undefined) {
    throw new Error(
      `no option reads "${option}"; the list holds ${items
        .map((candidate) => (candidate.textContent ?? "").trim())
        .join(", ")}`,
    );
  }
  await pointerDown(item);
  await click(item, 1);
  await flush();
}

/** The entries a select offers, in order. */
export async function optionsOf(
  host: HTMLElement,
  hook: string,
): Promise<readonly string[]> {
  const open = trigger(host, hook);
  await click(open);
  await flush();
  const texts = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].map((candidate) => (candidate.textContent ?? "").trim());
  await press(open, "Escape");
  await flush();
  return texts;
}

/** Clicks the element a hook names — an add or remove button. */
export async function clickHook(
  host: HTMLElement,
  hook: string,
): Promise<void> {
  const found = host.querySelector<HTMLElement>(`[${hook}]`);
  if (found === null) throw new Error(`no element carries ${hook}`);
  await click(found);
}

/** Presses a segmented option, addressed by the hook on every segment. */ export async function segment(
  host: HTMLElement,
  hook: string,
  label: string,
): Promise<void> {
  const buttons = [...host.querySelectorAll<HTMLElement>(`button[${hook}]`)];
  const button = buttons.find(
    (candidate) => (candidate.textContent ?? "").trim() === label,
  );
  if (button === undefined) throw new Error(`no segment reads "${label}"`);
  await click(button);
}

/** The label of the segment currently pressed, or `undefined` when none is. */
export function pressedLabel(
  host: HTMLElement,
  hook: string,
): string | undefined {
  const pressed = host.querySelector<HTMLElement>(
    `button[${hook}][aria-pressed="true"]`,
  );
  return pressed === undefined || pressed === null
    ? undefined
    : (pressed.textContent ?? "").trim();
}
