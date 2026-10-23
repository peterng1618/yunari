// @vitest-environment jsdom

/**
 * The Tokens pane's preset list.
 *
 * **A resolution is not a control.** The line beside a preset is its label and a
 * mono value with no well — a border means editable (DESIGN.md §5.1) — and the
 * editable copy of the same numbers is a bordered field inches below it. The
 * case below reads the resolution's own row, where a well would land, the way
 * the selection inspector's `index.dom.test.ts` reads its resolution row.
 *
 * **The resolver is the owner, so the expectation is its answer.** The line's
 * value is `resolveTypePreset`'s own output, never a copy of the
 * "family weight sizepx" rule this file would otherwise restate.
 *
 * `Harness` is the session's half of the contract: a commit comes back as a new
 * `presets` prop, exactly as `editor-session`'s `render()` hands one back.
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import type { ActiveKind } from "../../editor-shell/bridge.js";
import { catalogFaces, fontTrios } from "../../font-catalog.js";
import { resolveTypePreset } from "../../selection-inspector/appearance.js";
import type {
  TypePresetFontActions,
  TypePresets,
} from "../../type-preset-manager/panel.js";
import { uiCopy } from "../../ui-copy.js";
import { PresetList, type PresetListProps } from "./preset-list.js";

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

/** The list over a preset map it owns, so a commit comes back the way the
 *  session hands one back rather than leaving the component on stale props. */
function Harness(props: {
  readonly initial: TypePresets;
  readonly onDelete: PresetListProps["onDelete"];
  readonly fontActions: PresetListProps["fontActions"];
  readonly selection: PresetListProps["selection"];
  readonly change: (presets: TypePresets) => void;
}): React.JSX.Element {
  const [presets, setPresets] = useState(props.initial);
  return (
    <PresetList
      presets={presets}
      onDelete={props.onDelete}
      fontActions={props.fontActions}
      selection={props.selection}
      onChange={(next) => {
        props.change(next);
        setPresets(next);
      }}
    />
  );
}

/**
 * A selection the test drives, shaped like the shell's `SelectionStore`: the
 * snapshot is cached and returned as one object, because
 * `useSyncExternalStore` compares snapshots by identity and a fresh object per
 * read would loop.
 */
function stage(): {
  readonly source: NonNullable<PresetListProps["selection"]>;
  set(
    presetId: string | undefined,
    hasSelection: boolean,
    activeKind?: ActiveKind,
  ): void;
} {
  // A plain object, not a one-object selection: `activeKind` is what tells the
  // pane a container apart, and "object" is the case that has no children.
  let snapshot = {
    selectedCount: 0,
    activeKind: "object" as ActiveKind,
    selectionPresetId: undefined as string | undefined,
  };
  const listeners = new Set<() => void>();
  return {
    source: {
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      get: () => snapshot,
    },
    set(presetId, hasSelection, activeKind = hasSelection ? "object" : "none") {
      snapshot = {
        selectedCount: hasSelection ? 1 : 0,
        activeKind,
        selectionPresetId: presetId,
      };
      for (const listener of listeners) listener();
    },
  };
}

async function mount(
  initial: TypePresets,
  options: {
    readonly onDelete?: PresetListProps["onDelete"];
    readonly fontActions?: PresetListProps["fontActions"];
    readonly selection?: PresetListProps["selection"];
  } = {},
): Promise<{
  readonly host: HTMLElement;
  readonly change: ReturnType<typeof vi.fn>;
}> {
  if (root !== undefined) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  const host = document.createElement("div");
  document.body.append(host);
  const change = vi.fn();
  const mounted = createRoot(host);
  root = mounted;
  await act(async () => {
    mounted.render(
      <Harness
        initial={initial}
        onDelete={options.onDelete}
        fontActions={options.fontActions}
        selection={options.selection}
        change={change}
      />,
    );
  });
  return { host, change };
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
async function type(control: Element, value: string): Promise<void> {
  await act(async () => {
    // Focused first: `blur()` on an element that never held focus is a no-op
    // and fires no event, so the commit below would never arrive.
    (control as HTMLElement).focus();
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(control) as HTMLInputElement,
      "value",
    )?.set;
    if (setter === undefined) (control as HTMLInputElement).value = value;
    else setter.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    (control as HTMLElement).blur();
  });
}

/** The first preset is the selected one in every fixture here, so a field is
 *  named by its hook alone and no preset has to be chosen first. */
async function commitField(control: string, value: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>(control);
  if (input === null) throw new Error(`no field matches ${control}`);
  await type(input, value);
}

/** A select's trigger, opened; the options are read and chosen from the popup
 *  this leaves standing, because Base UI renders none until it is open. */
async function openControl(control: string): Promise<readonly Element[]> {
  const trigger = document.querySelector<HTMLElement>(control);
  if (trigger === null) throw new Error(`no control matches ${control}`);
  await click(trigger);
  await flush();
  return Array.from(document.querySelectorAll('[role="option"]'));
}

/** Picks the option whose value is `id` — the id the control commits, never the
 *  label it prints, because the labels are the document's own preset names. */
async function chooseIn(control: string, id: string): Promise<void> {
  const options = await openControl(control);
  const option = options.find(
    (candidate) => candidate.getAttribute("data-yunari-option") === id,
  );
  if (option === undefined) throw new Error(`no option ${id} in ${control}`);
  await pointerDown(option);
  await click(option, 1);
  await flush();
}

/** A preset's resolution value span, by the row that carries the preset's id. */
function resolutionLine(host: HTMLElement, id: string): HTMLElement {
  const value = host.querySelector<HTMLElement>(
    `[data-yunari-type-preset-row="${id}"] [data-yunari-type-preset-resolution]`,
  );
  if (value === null) throw new Error(`no resolution line for ${id}`);
  return value;
}

/** The words a control is announced under: the label its own row points at,
 *  read the way a screen reader finds it, not the source string that built it. */
function controlName(host: HTMLElement, control: string): string {
  const target = host.querySelector<HTMLElement>(control);
  const id = target?.id ?? "";
  if (id === "") return "";
  return host.querySelector(`label[for="${id}"]`)?.textContent ?? "";
}

/** The ports the panel adopts faces and trios through, all recording. */
function ports() {
  return {
    preview: vi.fn(async () => {}),
    applyFace: vi.fn(async () => {}),
    applyTrio: vi.fn(async () => {}),
  } satisfies TypePresetFontActions;
}

const withWeight: TypePresets = {
  body: {
    name: "Body",
    value: { family: "Inter", size: 16, weight: 600, lineHeight: 1.4 },
  },
  caption: { name: "Caption", value: { family: "Inter", size: 12 } },
};

/** A library whose *first declared* key is also the one the selection is set
 *  in, so restoring the `Object.keys(presets)[0]` default cannot pass the
 *  "nothing is selected" case by naming some other preset. */
const withNumbers: TypePresets = {
  "24-400": {
    name: "Card title",
    value: { family: "Inter", size: 24, weight: 400 },
  },
  body: { name: "Body", value: { family: "Inter", size: 16 } },
};
const firstDeclaredPresetId = Object.keys(withNumbers)[0]!;

/** The readout the pane states its answer in, as against the chooser: the
 *  chooser prints preset names too, so a case that read the whole pane could
 *  not tell the two apart. */
function binding(host: HTMLElement): HTMLElement {
  const found = host.querySelector<HTMLElement>(
    "[data-yunari-type-preset-binding]",
  );
  if (found === null) throw new Error("the list states no binding");
  return found;
}

it("shows each preset's resolved family, weight and size as a resolution, not as a field", async () => {
  // DESIGN.md §5.1–§5.3: a border means editable, and the two treatments sit inches
  // apart in this pane. The expected line is `resolveTypePreset`'s own answer,
  // read from the same record the panel is given — never a copy of its rule.
  const { host } = await mount(withWeight);
  const expected = resolveTypePreset(
    { typePresets: withWeight },
    "typePresets.body",
  );
  const line = resolutionLine(host, "body");

  expect(line.textContent).toBe(expected);
  expect(line.textContent).not.toBe("");

  // A row, not a control: no border on the row, no bordered descendant, and
  // nothing to type in. This is where a well would land.
  const row = line.parentElement;
  expect(row?.classList.contains("border")).toBe(false);
  expect(row?.querySelector('[class~="border"]')).toBeNull();
  expect(row?.querySelector("input, select, button, textarea")).toBeNull();
  expect(row?.textContent).toContain("Body");
});

it("says nothing is selected rather than showing the first declared preset", async () => {
  // The `vg-094` case, first, because it is the whole row: restoring the
  // `Object.keys(presets)[0]` default must fail here and only here. The readout
  // is the pane's *answer*, and a default that reads like one is the defect.
  const selection = stage();
  const { host } = await mount(withNumbers, { selection: selection.source });

  await act(async () => selection.set(undefined, false));

  const text = binding(host).textContent;
  expect(text).not.toContain(withNumbers[firstDeclaredPresetId]!.name);
  expect(text?.trim(), "an absent answer is stated, not left blank").not.toBe(
    "",
  );
});

it("names the preset the selected run is set in", async () => {
  // The binding reads what the shell's projection reports — never a second walk
  // of the scene — and prints the preset's own name.
  const selection = stage();
  const { host } = await mount(withNumbers, { selection: selection.source });

  await act(async () => selection.set("24-400", true));

  const text = binding(host).textContent;
  expect(text).toContain(withNumbers["24-400"]!.name);
  expect(text).not.toContain(uiCopy.panels.selectionEmpty);
});

it("says the selection carries no preset when it carries none", async () => {
  // A default and an answer must not read the same: these two lines differ.
  const selection = stage();
  const { host } = await mount(withNumbers, { selection: selection.source });

  await act(async () => selection.set(undefined, true));
  const carriesNone = binding(host).textContent;
  await act(async () => selection.set(undefined, false));
  const nothing = binding(host).textContent;

  expect(carriesNone).not.toBe(nothing);
  expect(carriesNone).toContain(uiCopy.panels.selectionNoType);
  expect(nothing).toContain(uiCopy.panels.selectionEmpty);
});

it("reads a group or a multi-selection as its children's presets, not as none", async () => {
  // Two surfaces, one selection. `selection-inspector` reads a container's
  // children for exactly this case (`per-kind-column`'s `childrenAppearance`),
  // so a pane that told the author its selection "carries no type preset" would
  // contradict the column beside it. A container is not a failed lookup.
  const selection = stage();
  const { host } = await mount(withNumbers, { selection: selection.source });

  await act(async () => selection.set(undefined, true, "group"));
  const container = binding(host).textContent;

  expect(container).toContain(uiCopy.panels.selectionChildrenTypes);
  expect(container).not.toContain(uiCopy.panels.selectionNoType);
  expect(container).not.toContain(uiCopy.panels.selectionEmpty);

  // The branch is bounded to a container with no preset to name: an ordinary
  // object set in none still says so, and a container that *does* carry a
  // reference still names it rather than folding into the container answer.
  await act(async () => selection.set(undefined, true, "object"));
  expect(binding(host).textContent).toContain(uiCopy.panels.selectionNoType);
  await act(async () => selection.set("24-400", true, "group"));
  expect(binding(host).textContent).toContain(withNumbers["24-400"]!.name);
});

it("reads a background selection as nothing selected, because it has no type", async () => {
  // The background is a layer rather than a Fabric object: it carries no type
  // preset, and calling that a failed lookup would name a preset the author
  // never had. `target().kind` is "none" for it, which is the same answer.
  const selection = stage();
  const { host } = await mount(withNumbers, { selection: selection.source });

  await act(async () => selection.set(undefined, true, "background"));

  const text = binding(host).textContent;
  expect(text).toContain(uiCopy.panels.selectionEmpty);
  expect(text).not.toContain(uiCopy.panels.selectionNoType);
});

it("reads a dangling reference as unresolved, which is neither empty answer", async () => {
  // A third answer: the author chose a preset the document no longer declares,
  // so the pane must not fold it into "carries none" or into "nothing
  // selected" — both would erase the fact that a reference is broken.
  const selection = stage();
  const { host } = await mount(withNumbers, { selection: selection.source });

  await act(async () => selection.set("gone", true));

  const text = binding(host).textContent;
  expect(text).toContain("typePresets.gone");
  expect(text).toContain(uiCopy.inspectorFields.unresolved);
  expect(text).not.toContain(uiCopy.panels.selectionEmpty);
  expect(text).not.toContain(uiCopy.panels.selectionNoType);
});

it("opens the chooser on the preset the selection is set in, and stays browseable", async () => {
  // Library selection is not document selection: the chooser opens on what the
  // selection is set in, the author may still pick any preset to edit, and the
  // readout above keeps stating the selection's own reference either way.
  const selection = stage();
  const { host } = await mount(withNumbers, { selection: selection.source });

  await act(async () => selection.set("24-400", true));
  const chooser = (): string | null | undefined =>
    host
      .querySelector("[data-yunari-type-preset] [data-yunari-value]")
      ?.getAttribute("data-yunari-value");
  expect(chooser()).toBe("24-400");

  await chooseIn("[data-yunari-type-preset]", "body");

  expect(chooser()).toBe("body");
  expect(binding(host).textContent).toContain(withNumbers["24-400"]!.name);
});

it("drops an optional field when the author empties it, rather than writing an empty string", async () => {
  const { change } = await mount(withWeight);

  await commitField("[data-yunari-type-weight]", "");

  const committed = change.mock.calls[0]?.[0] as TypePresets;
  expect(Object.keys(committed)).toEqual(["body", "caption"]);
  expect(committed.body?.value).not.toHaveProperty("weight");
  // The rest of the value survives the removal.
  expect(committed.body?.value).toEqual({
    family: "Inter",
    size: 16,
    lineHeight: 1.4,
  });
});

it("drops an optional number when the author clears it", async () => {
  const { change } = await mount(withWeight);

  await commitField("[data-yunari-type-line-height]", "");

  const committed = change.mock.calls[0]?.[0] as TypePresets;
  expect(committed.body?.value).not.toHaveProperty("lineHeight");
  expect(committed.body?.value?.weight).toBe(600);
});

it("drops an optional letter spacing when the author clears it", async () => {
  // The third clause of the same rule, and its own sibling block: a copy-paste
  // slip is what a shared weight/lineHeight case cannot see.
  const { change } = await mount({
    body: {
      name: "Body",
      value: {
        family: "Inter",
        size: 16,
        weight: 600,
        lineHeight: 1.4,
        letterSpacing: 0.2,
      },
    },
  });

  await commitField("[data-yunari-type-letter-spacing]", "");

  // The whole value, so a clear that committed nothing at all is red here too.
  expect((change.mock.calls[0]?.[0] as TypePresets).body?.value).toEqual({
    family: "Inter",
    size: 16,
    weight: 600,
    lineHeight: 1.4,
  });
});

it("refuses an empty name or family", async () => {
  const { change } = await mount(withWeight);

  await commitField("[data-yunari-type-name]", "");
  expect(change).not.toHaveBeenCalled();

  // Whitespace is empty after the trim the rule applies, so it is refused too;
  // a family of `"   "` would be a name no renderer can resolve.
  await commitField("[data-yunari-type-family]", "   ");
  expect(change).not.toHaveBeenCalled();
});

it("refuses a size that is not a positive number", async () => {
  const { change } = await mount(withWeight);

  await commitField("[data-yunari-type-size]", "0");
  expect(change).not.toHaveBeenCalled();

  await commitField("[data-yunari-type-size]", "abc");
  expect(change).not.toHaveBeenCalled();

  await commitField("[data-yunari-type-size]", "18");
  expect((change.mock.calls[0]?.[0] as TypePresets).body?.value.size).toBe(18);
});

it("refuses to delete the last preset, because nothing is left to reassign to", async () => {
  const remove = vi.fn();
  const { host } = await mount(
    { body: { name: "Body", value: { family: "Inter", size: 16 } } },
    { onDelete: remove },
  );

  const remove1 = host.querySelector<HTMLButtonElement>(
    "[data-yunari-type-delete]",
  );
  expect(remove1).toHaveProperty("disabled", true);
  await click(remove1!);
  expect(remove).not.toHaveBeenCalled();
});

it("offers every other preset as the replacement, and deletes through the port", async () => {
  const remove = vi.fn();
  const { host } = await mount(withWeight, { onDelete: remove });

  const deleteControl = host.querySelector<HTMLButtonElement>(
    "[data-yunari-type-delete]",
  );
  expect(deleteControl).toHaveProperty("disabled", false);

  const options = await openControl("[data-yunari-type-replacement]");
  expect(
    options.map((option) => option.getAttribute("data-yunari-option")),
  ).toEqual(["caption"]);

  const caption = options.find(
    (option) => option.getAttribute("data-yunari-option") === "caption",
  )!;
  await pointerDown(caption);
  await click(caption, 1);
  await flush();

  await click(deleteControl!);
  expect(remove.mock.calls).toEqual([["body", "caption"]]);
});

it("runs the face preview, the face adoption and the trio adoption through the ports it was given", async () => {
  const fontActions = ports();
  const { host } = await mount(withWeight, { fontActions });
  // The second face, so the choice is proven to be the one the ports receive
  // rather than the list's first row.
  const face = catalogFaces()[1]!;

  await chooseIn("[data-yunari-font-face]", face.id);
  await click(host.querySelector("[data-yunari-font-preview]")!);
  expect(fontActions.preview.mock.calls).toEqual([[face]]);

  await click(host.querySelector("[data-yunari-font-apply]")!);
  expect(fontActions.applyFace.mock.calls).toEqual([["body", face]]);

  const trio = fontTrios()[1]!;
  await chooseIn("[data-yunari-font-trio]", trio.id);
  await click(host.querySelector("[data-yunari-font-trio-apply]")!);
  expect(fontActions.applyTrio.mock.calls).toEqual([[trio.id]]);
});

it("names the two adoption controls Font face and Font trio", async () => {
  // Amended R20. These were `Font`/`Trio` on the imperative panel; the words are
  // pinned **on the controls** and not only in the table, so a rename in
  // `ui-copy.ts` cannot drift the two names back with the whole suite green.
  const { host } = await mount(withWeight, { fontActions: ports() });

  expect(uiCopy.panels.fontFace).toBe("Font face");
  expect(uiCopy.panels.fontTrioAdopt).toBe("Font trio");
  expect(controlName(host, "[data-yunari-font-face]")).toBe("Font face");
  expect(controlName(host, "[data-yunari-font-trio]")).toBe("Font trio");
});

it("preserves packaged face metadata when editing size", async () => {
  const { change } = await mount({
    body: {
      name: "Body",
      value: {
        family: "Inter",
        size: 16,
        weight: 600,
        letterSpacing: 0.2,
        lineHeight: 1.4,
        face: { assetId: "inter-600" },
        trioRole: "body",
      },
    },
  });

  await commitField("[data-yunari-type-size]", "18");

  expect(change).toHaveBeenLastCalledWith({
    body: {
      name: "Body",
      value: {
        family: "Inter",
        size: 18,
        weight: 600,
        letterSpacing: 0.2,
        lineHeight: 1.4,
        face: { assetId: "inter-600" },
        trioRole: "body",
      },
    },
  });
});

it("adds a preset under the first free id", async () => {
  const { host, change } = await mount(withWeight);

  await click(host.querySelector("[data-yunari-type-preset-add]")!);

  const added = change.mock.calls[0]?.[0] as TypePresets;
  expect(added.type).toEqual({
    name: uiCopy.panels.newType,
    value: { family: "Segoe UI, sans-serif", size: 16 },
  });
  expect(added.body).toEqual(withWeight.body);
});
