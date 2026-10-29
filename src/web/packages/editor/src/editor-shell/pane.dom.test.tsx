// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import {
  type ActionGate,
  OBJECT_ACTIONS,
  type ObjectTarget,
  objectActionsFor,
} from "../object-actions.js";
import { uiCopy } from "../ui-copy.js";
import type { EditorShellBridge } from "./bridge.js";
import { STACK_GLYPH } from "./icons.js";
import { LayerActions } from "./layer-panel.js";
import { Pane } from "./pane.js";

// React only flushes work scheduled inside `act` when it has been told it is in
// a test; without this, `act` warns and the update lands after the assertion.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A bridge whose only interesting member is the gate the footer reads: `target`
 * (what the selection is) and `canArrange` (whether an arrange action would
 * land). The footer reaches none of the others, so they are absent rather than
 * stubbed — the cast is the whole point of a partial double.
 */
function bridge(target: ObjectTarget): EditorShellBridge {
  return {
    target: () => target,
    canArrange: () => false,
  } as unknown as EditorShellBridge;
}

function object(): ObjectTarget {
  return { kind: "object", locked: false, memberCount: 1, isGroup: false };
}

function nothing(): ObjectTarget {
  return { kind: "none", locked: false, memberCount: 0, isGroup: false };
}

/** The Composition pane as `shell-layout` builds it: the pane's chrome with the
 *  registry's actions in its footer. The body is a stand-in, because what this
 *  file measures is the chrome and the footer, not the tree `layer-panel` owns. */
function Composition({
  gate,
}: {
  readonly gate: EditorShellBridge;
}): React.JSX.Element {
  return (
    <Pane
      id="layers"
      title="Layers"
      icon={STACK_GLYPH}
      footer={<LayerActions bridge={gate} />}
    >
      <div />
    </Pane>
  );
}

function render(gate: EditorShellBridge): {
  readonly host: HTMLElement;
  readonly root: ReturnType<typeof createRoot>;
} {
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<Composition gate={gate} />));
  return { host, root };
}

it("names the section and draws the title bar DESIGN.md's panes wear", () => {
  const { host, root } = render(bridge(object()));

  // The DOM name is the browsable contract the browser specs share, so the
  // chrome is drawn around it rather than moving it: the section is what
  // `data-yunari-panel` names, and the title bar is inside it.
  const pane = host.querySelector('[data-yunari-panel="layers"]');
  expect(pane).not.toBeNull();
  expect(pane?.querySelector(".editor-shell-pane-name")?.textContent).toBe(
    "Layers",
  );
  expect(pane?.querySelector(".editor-shell-pane-title svg")).not.toBeNull();

  act(() => root.unmount());
});

it("draws the registry's commands disabled with nothing selected, never an empty row", () => {
  // **This is `vg-570`'s regression case.** The user ruled on 2026-10-17 that a
  // footer with nothing selected keeps the layer's own object commands and draws
  // them disabled — not the Add pane's constructions (`vg-460`'s answer, which
  // was never asked for), and not an empty row. Emptying this footer again, or
  // putting the constructions back, reddens here: the labels are the registry's
  // own list and every one of them is disabled.
  const empty = render(bridge(nothing()));
  const emptyButtons = [
    ...(empty.host
      .querySelector("[data-yunari-layer-actions]")
      ?.querySelectorAll("button") ?? []),
  ];
  expect(
    emptyButtons.map((button) => button.getAttribute("aria-label")),
  ).toEqual(OBJECT_ACTIONS.map((action) => action.label));
  expect(emptyButtons.map((button) => button.disabled)).toEqual(
    OBJECT_ACTIONS.map(() => true),
  );

  // One unlocked object: the registry's own filter answers, and what it keeps is
  // enabled — the absent-not-greyed rule is unchanged once a subject exists.
  const filled = render(bridge(object()));
  const filledButtons = [
    ...(filled.host
      .querySelector("[data-yunari-layer-actions]")
      ?.querySelectorAll("button") ?? []),
  ];
  expect(
    filledButtons.map((button) => button.getAttribute("aria-label")),
  ).toEqual(objectActionsFor(bridge(object())).map((action) => action.label));
  expect(filledButtons.every((button) => button.disabled)).toBe(false);
  expect(filledButtons.length).toBeGreaterThan(0);

  act(() => empty.root.unmount());
  act(() => filled.root.unmount());
});

it("asks the registry for eligibility and decides nothing itself", () => {
  const gate = bridge(object());
  const { host, root } = render(gate);

  // Derived rather than written out: a literal list would pass if the footer
  // re-derived eligibility, which is the drift this pins. `objectActionsFor` is
  // the dock's own filter, so the two surfaces cannot disagree about the set —
  // and with a selection it is the only source, the no-selection branch aside.
  const expected = objectActionsFor(gate as unknown as ActionGate)
    .map((action) => action.label)
    .sort();
  const rendered = Array.from(
    host
      .querySelector("[data-yunari-layer-actions]")
      ?.querySelectorAll("button") ?? [],
  )
    .map((button) => button.getAttribute("aria-label"))
    .sort();
  expect(rendered).toEqual(expected);
  expect(expected.length).toBeGreaterThan(1);

  act(() => root.unmount());
});

it("marks delete destructive in the footer too, from the registry", () => {
  const { host, root } = render(bridge(object()));

  // The footer is the second surface of the registry, and the mark is its own:
  // read off the rendered controls, so a footer that stopped reading the flag
  // reddens. `delete` and only `delete` carries it.
  //
  // The *colour* the mark paints is not asserted here and cannot be: jsdom has
  // no cascade, so a class or an inline value would prove only the string.
  // `[data-yunari-destructive]` in the stylesheet is what paints it, and
  // `editor-shell.control-rules.test.ts` reads that rule as text.
  const marked = Array.from(
    host.querySelectorAll(
      "[data-yunari-layer-actions] button[data-yunari-destructive]",
    ),
  ).map((button) => button.getAttribute("aria-label"));
  expect(marked).toEqual([uiCopy.actions.delete]);

  act(() => root.unmount());
});
