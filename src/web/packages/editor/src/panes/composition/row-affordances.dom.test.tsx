// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { EditorShellBridge } from "../../editor-shell/bridge.js";
import { LayerActions } from "../../editor-shell/layer-panel.js";
import type { LayerRow } from "../../editor-shell/layer-tree.js";
import { type ObjectTarget, objectActionsFor } from "../../object-actions.js";
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
  // Rename is not a column here and is not a case: the pen answers attention
  // and nothing else, so no control's presence is a row-state decision.
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
      shows: [
        `${uiCopy.panels.rename} loose-0`,
        uiCopy.panels.hide,
        uiCopy.actions.lock,
      ],
    },
    {
      what: "a selected row with nobody on it",
      row: row({ selected: true }),
      attended: false,
      // A selection is not attention: it paints the row, but the controls
      // belong to the author's attention and leave when the pointer does.
      shows: [],
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

it("withdraws the controls when the pointer leaves the row it had selected", async () => {
  // The reported defect: the selection kept the strip alive after the pointer
  // had gone, so the row it was on carried controls the author had moved off.
  const subject = row({ selected: true });
  const host = await renderPane([subject]);
  await hover(host, subject.id);
  expect(affordanceLabels(host)).not.toEqual([]);
  await act(async () =>
    host
      .querySelector<HTMLElement>(`[data-yunari-layer="${subject.id}"]`)
      ?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })),
  );
  expect(affordanceLabels(host)).toEqual([]);
  host.remove();
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
    [
      `${uiCopy.panels.rename} loose-0`,
      uiCopy.panels.hide,
      uiCopy.actions.lock,
    ],
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
  ).toEqual([
    `${uiCopy.panels.rename} loose-0`,
    uiCopy.panels.hide,
    uiCopy.actions.lock,
  ]);

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

it("draws a rename control on the attended row, and the name still opens for typing", async () => {
  // The pen says a layer's name can change, which nothing on a row at rest
  // says. Double-click and F2 still open the field — the pen is the pointer's
  // discoverable route to the same field, not a second editor — so both are
  // checked here.
  const host = await renderPane([row()]);
  // In the document, because the case proves where focus lands.
  document.body.append(host);
  const line = host.querySelector<HTMLElement>(
    '[data-yunari-layer="loose-0"]',
  )!;
  await hover(host, "loose-0");

  const pen = host.querySelector<HTMLButtonElement>(
    ".yunari-layer-state button[data-yunari-layer-rename]",
  );
  expect(pen?.getAttribute("aria-label")).toBe(
    `${uiCopy.panels.rename} loose-0`,
  );
  await act(async () => pen?.click());
  expect(
    host.querySelector<HTMLInputElement>('input[aria-label="Rename loose-0"]'),
    "the pen opens the same field the row does",
  ).not.toBeNull();
  // A press on the pen is not a press on the row.
  expect(host.querySelector<HTMLElement>('[data-yunari-layer="loose-0"]')).toBe(
    line,
  );

  // Escape cancels that draft and returns focus to the row it was renaming, not
  // to the document body.
  await act(async () =>
    host
      .querySelector<HTMLInputElement>('input[aria-label="Rename loose-0"]')
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
  );
  expect(host.querySelector('input[aria-label="Rename loose-0"]')).toBeNull();
  expect(document.activeElement).toBe(line);

  // The row itself is still a route: a double-click on it opens the field even
  // with no pointer on the pen.
  await act(async () =>
    line.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
  );
  expect(
    host.querySelector<HTMLInputElement>('input[aria-label="Rename loose-0"]'),
  ).not.toBeNull();
  host.remove();
});

it("draws at most four controls in the state slot, whatever the row's state", async () => {
  // The ceiling `editor-shell.css`'s reserve is written against: the rename
  // pen, the two state controls, and the pane's one entry control beside them.
  // The row is drawn in the one state that shows all four — attended, so the
  // pen and both state controls are up, entered, so the entry control is up
  // without attention, and hidden and locked, so each state control says
  // something. A fifth `:has` arm cannot match against this count, which is why
  // the arm's own case reads the stylesheet rather than a render.
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
  await hover(host, "group-a");

  expect(
    affordanceLabels(host),
    "the state slot draws a control the row's reserve is not written for",
  ).toEqual([
    `${uiCopy.panels.rename} group-a`,
    `${uiCopy.panels.leave} group-a`,
    uiCopy.panels.show,
    uiCopy.actions.unlock,
  ]);
  host.remove();
});

it("draws the registry's filtered commands with a subject, and no footer without one", async () => {
  // The footer decides nothing: eligibility is `objectActionsFor`'s, and the
  // expected column below is that function's own answer rather than a copy of
  // its rule. A surface that re-spelled the filter would agree with it on one
  // selection and diverge on another — which is why a locked object is asked as
  // well as an unlocked one, where the delete half of the registry refuses.
  //
  // **Nothing selected draws no footer at all** (#345), which supersedes the
  // older ruling that kept the registry's commands greyed: an empty action row
  // is space the pane does not need to spend, and the footer now appears with
  // the selection it acts on.
  const cases: readonly {
    readonly what: string;
    readonly target: ObjectTarget;
  }[] = [
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
    const expected = offered.map((action) => action.label);
    expect(labels, what).toEqual(expected);
    // The filter has already removed what the selection cannot run, so nothing
    // that reaches the footer is left to grey.
    expect(disabled, what).toEqual(offered.map(() => false));
    // The press carries the registry's own id, so the footer is rendering the
    // registry's entries rather than a list of its own that happens to match —
    // and a disabled control carries nothing at all.
    const first = offered[0];
    if (first !== undefined) {
      await act(async () =>
        host.querySelector<HTMLButtonElement>("button")?.click(),
      );
      expect(run.mock.calls, what).toEqual([[first.id]]);
    }
    host.remove();
  }

  const empty = await renderFooter({
    kind: "none",
    locked: false,
    memberCount: 0,
    isGroup: false,
  });
  expect(
    empty.labels,
    "an empty selection drew a footer instead of no footer",
  ).toEqual([]);
  empty.host.remove();

  // The absences the filter buys once there is a subject, said outright: a locked
  // object is offered no Delete and no Lock, and it is offered Unlock. The
  // no-selection row is the one that does not filter, and the disabled flags
  // above are what say so for every command whose subject is the selection —
  // Paste is the one whose subject is the clipboard.
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
