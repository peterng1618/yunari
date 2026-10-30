// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { EditorShellBridge } from "../../editor-shell/bridge.js";
import { LayerActions } from "../../editor-shell/layer-panel.js";
import type { LayerRow } from "../../editor-shell/layer-tree.js";
import {
  OBJECT_ACTIONS,
  type ObjectTarget,
  objectActionsFor,
} from "../../object-actions.js";
import { uiCopy } from "../../ui-copy.js";
import { CompositionPane } from "./composition-pane.js";

// React only flushes work scheduled inside `act` when it has been told it is in
// a test; without this, `act` warns and the update lands after the assertion.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** One row as the projection emits it, with the three required arms filled in:
 *  a fixture that left the mark, the role or the bound key out would crash the
 *  panel before the assertion under test ran. */
function row(parts: Partial<LayerRow> = {}): LayerRow {
  return {
    id: "loose-0",
    name: "loose-0",
    kind: "shape",
    mark: { kind: "shape", shape: "rect" },
    role: { kind: "shape" },
    bound: [],
    depth: 0,
    parentId: undefined,
    hasChildren: false,
    collapsed: false,
    visible: true,
    locked: false,
    selected: false,
    ...parts,
  };
}

/** Only the members these cases drive: the panel reads the projection, the
 *  entered context, and the commands behind the controls. */
function paneBridge(
  rows: readonly LayerRow[],
  overrides: Record<string, unknown> = {},
): EditorShellBridge {
  return {
    layers: () => rows,
    groupContext: () => [],
    subscribe: () => () => undefined,
    selectLayer: vi.fn(),
    renameLayer: vi.fn(),
    setLayerVisible: vi.fn(),
    setLayerLocked: vi.fn(),
    ...overrides,
  } as unknown as EditorShellBridge;
}

async function renderPane(
  rows: readonly LayerRow[],
  overrides: Record<string, unknown> = {},
): Promise<HTMLElement> {
  const host = document.createElement("div");
  await act(async () =>
    (await Promise.resolve(createRoot(host))).render(
      <CompositionPane bridge={paneBridge(rows, overrides)} />,
    ),
  );
  return host;
}

/** Every control the row's state slot is drawing, by its own name. The twisty
 *  is outside the slot, so this is the affordances and nothing else. */
function affordanceLabels(host: HTMLElement): readonly (string | null)[] {
  return [
    ...host.querySelectorAll<HTMLElement>(".yunari-layer-state button"),
  ].map((button) => button.getAttribute("aria-label"));
}

/** A pointer over a row, which is one of the two ways a row is attended. */
async function hover(host: HTMLElement, id: string): Promise<void> {
  await act(async () =>
    host
      .querySelector<HTMLElement>(`[data-yunari-layer="${id}"]`)
      ?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
  );
}

it("shows the row's own controls on the attended row and on a row whose state is not the default", async () => {
  // The whole rule in one table, because the cases are what it is made of: a
  // default row carries nothing, and a row says something the moment either its
  // own state or the author's attention says something. Two flags that are both
  // true carry no information, so a visible unlocked row at rest draws no
  // control at all — 104 icons reading "visible, unlocked" was the measured
  // defect, and it grows with the row count.
  //
  // Rename is not a column here and is not a case: `vg-462` removed the pen, so
  // there is no control whose presence a row's state could decide.
  const cases: readonly {
    readonly what: string;
    readonly row: LayerRow;
    readonly attended: boolean;
    readonly shows: readonly string[];
  }[] = [
    {
      what: "a default row, with nobody on it",
      row: row(),
      attended: false,
      shows: [],
    },
    {
      what: "the attended row",
      row: row(),
      attended: true,
      shows: [uiCopy.panels.hide, uiCopy.actions.lock],
    },
    {
      what: "a selected row",
      row: row({ selected: true }),
      attended: false,
      shows: [uiCopy.panels.hide, uiCopy.actions.lock],
    },
    {
      what: "a hidden row",
      row: row({ visible: false }),
      attended: false,
      // The row's own state brings back the control that names it, and only
      // that one: a hidden row is still unlocked, and an unlocked lock icon is
      // noise even here.
      shows: [uiCopy.panels.show],
    },
    {
      what: "a locked row",
      row: row({ locked: true }),
      attended: false,
      shows: [uiCopy.actions.unlock],
    },
  ];

  for (const { what, row: subject, attended, shows } of cases) {
    const host = await renderPane([subject]);
    if (attended) await hover(host, subject.id);
    expect(affordanceLabels(host), what).toEqual(shows);
    host.remove();
  }
});

it("reaches visibility and lock from the keyboard, with a name each", async () => {
  // Review Focus 3. A pointer-only gate would leave a keyboard author with no
  // way to reach either control, so attendance is hover OR focus — and the
  // focus half is checked with no pointer anywhere near the row. Each control
  // is a real button with its own name, so it is in the tab order and it is
  // announced; and a press on one reaches the bridge rather than selecting the
  // layer underneath it, which is the other thing the row's own click does.
  const setLayerVisible = vi.fn();
  const setLayerLocked = vi.fn();
  const selectLayer = vi.fn();
  const host = await renderPane([row()], {
    setLayerVisible,
    setLayerLocked,
    selectLayer,
  });
  document.body.append(host);

  const line = host.querySelector<HTMLElement>(
    '[data-yunari-layer="loose-0"]',
  )!;
  // The row the keyboard can land on at all: `focusin` alone would fire on a row
  // nothing can focus, so the tab stop is asserted rather than assumed.
  expect(line.tabIndex, "the row is in the tab order").toBe(0);
  // `focusin`, not `focus`: React's onFocus is the bubbling one, so this is the
  // event a keyboard author's Tab actually raises on the row.
  await act(async () =>
    line.dispatchEvent(new FocusEvent("focusin", { bubbles: true })),
  );

  const controls = [
    ...host.querySelectorAll<HTMLButtonElement>(".yunari-layer-state button"),
  ];
  expect(controls.map((control) => control.getAttribute("aria-label"))).toEqual(
    [uiCopy.panels.hide, uiCopy.actions.lock],
  );
  for (const control of controls) {
    expect(
      control.tagName,
      "a control the keyboard can reach is a button",
    ).toBe("BUTTON");
    expect(control.getAttribute("aria-label")?.trim(), "a name each").not.toBe(
      "",
    );
  }

  // The load-bearing half of the gate, and the one a synthetic `focusin` cannot
  // see: Tab from the row goes *to* one of these controls, which raises a
  // `focusout` on the row whose `relatedTarget` is still inside it. That is not
  // leaving the row, so the controls stay mounted and the author can reach the
  // next one; stand them down here and the row is a pointer-only gate again.
  const inside = controls[0]!;
  await act(async () =>
    line.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: inside }),
    ),
  );
  expect(
    affordanceLabels(host),
    "focus that stays inside the row does not stand the controls down",
  ).toEqual([uiCopy.panels.hide, uiCopy.actions.lock]);

  // The other half, so the case above is not vacuous: focus that leaves the row
  // entirely does stand them down.
  await act(async () =>
    line.dispatchEvent(
      new FocusEvent("focusout", {
        bubbles: true,
        relatedTarget: document.body,
      }),
    ),
  );
  expect(
    affordanceLabels(host),
    "focus leaving the row entirely stands them down",
  ).toEqual([]);
  // And back onto the row for the presses below.
  await act(async () =>
    line.dispatchEvent(new FocusEvent("focusin", { bubbles: true })),
  );

  const press = async (label: string): Promise<void> => {
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(
          `.yunari-layer-state button[aria-label="${label}"]`,
        )
        ?.click(),
    );
  };
  await press(uiCopy.panels.hide);
  await press(uiCopy.actions.lock);
  expect(setLayerVisible.mock.calls).toEqual([["loose-0", false]]);
  expect(setLayerLocked.mock.calls).toEqual([["loose-0", true]]);

  // A press on a control is not a press on the row: selecting the layer under
  // the control the author pressed is the failure this guards.
  expect(selectLayer).not.toHaveBeenCalled();
  host.remove();
});

it("draws no rename control on an attended row, and the name still opens for typing", async () => {
  // vg-462's item is a removal: the name the pen acted on is the row's own, so a
  // control beside it was a second route to what a double-click had always
  // opened. The failure mode to guard is the other half — removing the pen while
  // taking the pointer and keyboard routes with it.
  const host = await renderPane([row()]);
  // In the document, because the case proves where focus lands.
  document.body.append(host);
  const line = host.querySelector<HTMLElement>(
    '[data-yunari-layer="loose-0"]',
  )!;
  await hover(host, "loose-0");

  // Attended, so every control this row draws at all is on screen: none of them
  // is a rename, and none wears the pen's own name.
  expect(affordanceLabels(host)).not.toContain(uiCopy.panels.rename);
  expect(
    host.querySelector(`[aria-label="${uiCopy.panels.rename} loose-0"]`),
    "no control opens the field on the author's behalf",
  ).toBeNull();
  expect(host.querySelector('[aria-label="Rename loose-0"]')).toBeNull();

  // The name itself is the route: a double-click on the row opens the field.
  await act(async () =>
    line.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
  );
  expect(
    host.querySelector<HTMLInputElement>('[aria-label="Rename loose-0"]'),
  ).not.toBeNull();

  // Escape cancels the draft and returns focus to the row it was renaming, not
  // to the document body.
  await act(async () =>
    host
      .querySelector<HTMLInputElement>('[aria-label="Rename loose-0"]')
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
  );
  expect(host.querySelector('[aria-label="Rename loose-0"]')).toBeNull();
  expect(document.activeElement).toBe(line);
  host.remove();
});

it("draws at most three controls in the state slot, whatever the row's state", async () => {
  // The ceiling `editor-shell.css`'s reserve is written against (`vg-492`): the
  // two state controls, and the pane's one entry control beside them. The row is
  // drawn in the one state that shows all three — entered, so the entry control
  // is up without attention, and selected, hidden and locked, so each state
  // control says something. A fourth `:has` arm cannot match against this count,
  // which is why the arm's own case reads the stylesheet rather than a render.
  const host = await renderPane(
    [
      row({
        id: "group-a",
        name: "group-a",
        kind: "group",
        mark: { kind: "group" },
        role: { kind: "group", unit: undefined },
        hasChildren: true,
        selected: true,
        visible: false,
        locked: true,
      }),
    ],
    { groupContext: () => ["group-a"] },
  );

  expect(
    affordanceLabels(host),
    "the state slot draws a control the row's reserve is not written for",
  ).toEqual([
    `${uiCopy.panels.leave} group-a`,
    uiCopy.panels.show,
    uiCopy.actions.unlock,
  ]);
  host.remove();
});

it("draws the registry's commands disabled with nothing selected, and its filter's answer with one", async () => {
  // The footer decides nothing: eligibility is `objectActionsFor`'s, and the
  // expected column below is that function's own answer rather than a copy of
  // its rule. A surface that re-spelled the filter would agree with it on one
  // selection and diverge on another — which is why a locked object is asked as
  // well as an unlocked one, where the delete half of the registry refuses.
  //
  // **The no-selection case is `vg-570`'s ruling.** The footer keeps the
  // registry's own commands and draws them disabled — not the Add pane's
  // constructions (`vg-460`'s answer, which the user never asked for) and not an
  // empty row. So there the expected column is the whole registry and every
  // button in it is disabled; where a subject exists the filter has already
  // removed what the selection cannot run, so nothing is left to grey.
  const cases: readonly {
    readonly what: string;
    readonly target: ObjectTarget;
  }[] = [
    {
      what: "nothing selected",
      target: { kind: "none", locked: false, memberCount: 0, isGroup: false },
    },
    {
      what: "a locked object",
      target: { kind: "object", locked: true, memberCount: 1, isGroup: false },
    },
    {
      what: "an unlocked object",
      target: {
        kind: "object",
        locked: false,
        memberCount: 1,
        isGroup: false,
      },
    },
  ];

  const renderFooter = async (
    target: ObjectTarget,
  ): Promise<{
    readonly host: HTMLElement;
    readonly labels: readonly (string | null)[];
    readonly disabled: readonly boolean[];
    readonly offered: ReturnType<typeof objectActionsFor>;
    readonly run: ReturnType<typeof vi.fn>;
  }> => {
    const run = vi.fn();
    const bridge = {
      target: () => target,
      canArrange: () => false,
      run,
    } as unknown as EditorShellBridge;
    const host = document.createElement("div");
    await act(async () =>
      (await Promise.resolve(createRoot(host))).render(
        <LayerActions bridge={bridge} />,
      ),
    );
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")];
    return {
      host,
      run,
      offered: objectActionsFor(bridge),
      labels: buttons.map((button) => button.getAttribute("aria-label")),
      disabled: buttons.map((button) => button.disabled),
    };
  };

  for (const { what, target } of cases) {
    const { host, labels, disabled, offered, run } = await renderFooter(target);
    const nothing = target.kind === "none";
    const expected = (nothing ? OBJECT_ACTIONS : offered).map(
      (action) => action.label,
    );
    expect(labels, what).toEqual(expected);
    expect(disabled, what).toEqual(expected.map(() => nothing));
    // The press carries the registry's own id, so the footer is rendering the
    // registry's entries rather than a list of its own that happens to match —
    // and a disabled control carries nothing at all.
    const first = (nothing ? OBJECT_ACTIONS : offered)[0];
    if (first !== undefined) {
      await act(async () =>
        host.querySelector<HTMLButtonElement>("button")?.click(),
      );
      expect(run.mock.calls, what).toEqual(nothing ? [] : [[first.id]]);
    }
    host.remove();
  }

  // The absences the filter buys once there is a subject, said outright: a locked
  // object is offered no Delete and no Lock, and it is offered Unlock. The
  // no-selection row is the one that does not filter, and the disabled flags
  // above are what say so — rendering the registry and leaving it *enabled*
  // would put a control on the footer that the selection cannot run.
  const locked = await renderFooter({
    kind: "object",
    locked: true,
    memberCount: 1,
    isGroup: false,
  });
  expect(locked.labels).not.toContain(uiCopy.actions.delete);
  expect(locked.labels).not.toContain(uiCopy.actions.lock);
  expect(locked.labels).toContain(uiCopy.actions.unlock);
});
