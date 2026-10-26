// @vitest-environment jsdom

/**
 * The Tokens pane's preset list, now a list.
 *
 * **A row is a selector, not a control.** Pressing it selects the token for the
 * inspector; nothing in the list edits the document, so the cases that drove
 * the removed fields went with them. What a row shows is the specimen `Aa` in
 * the preset's own family, its name, its role badge where it has a role, and
 * its resolution line.
 *
 * **The resolver is the owner, so the expectation is its answer.** The line's
 * value is `resolveTypeToken`'s own output, never a copy of the
 * "family weight sizepx" rule this file would otherwise restate.
 *
 * `Harness` is the session's half of the contract: an add comes back as a new
 * `presets` prop, exactly as `editor-session`'s `render()` hands one back.
 */
import type { TypeToken } from "@yunari/renderer-core";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type {
  ActiveKind,
  EditorShellBridge,
} from "../../editor-shell/bridge.js";
import {
  SelectionStore,
  TokenSelectionStore,
} from "../../editor-shell/shell-stores.js";
import { newPresetType } from "../../new-fabric-theme-globals.js";
import { resolveTypeToken } from "../../selection-inspector/appearance.js";
import type { TypeTokens } from "../../type-preset-manager/panel.js";
import { uiCopy } from "../../ui-copy.js";
import { PresetList, type PresetListProps } from "./preset-list.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

afterEach(async () => {
  if (root !== undefined) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** The shell bridge, as far as a token selection can see one: a snapshot, a
 *  subscription, and the clear gesture. `selectLayers([])` moves the snapshot
 *  to empty and notifies, which is what the real bridge does, so the clear a
 *  press causes arrives back through the same path a canvas click uses. */
function canvas(initial: {
  readonly selectedCount: number;
  readonly activeKind: ActiveKind;
}) {
  let snapshot = {
    objectCount: 1,
    tokenCount: 1,
    selectedCount: initial.selectedCount,
    locked: false,
    activeKind: initial.activeKind,
    documentName: "Theme",
    selectionPresetId: undefined as string | undefined,
  };
  const listeners = new Set<() => void>();
  const selectLayers = vi.fn((ids: readonly string[]) => {
    if (ids.length !== 0) return;
    snapshot = { ...snapshot, selectedCount: 0, activeKind: "none" };
    for (const listener of listeners) listener();
  });
  const bridge = {
    snapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    selectLayers,
  } as unknown as EditorShellBridge;
  return { bridge, selectLayers };
}

/** The list over a preset map it owns, so an add comes back the way the panel's
 *  own `onChange` hands one back rather than leaving the component on stale
 *  props. */
function Harness(props: {
  readonly initial: TypeTokens;
  readonly selection: PresetListProps["selection"];
  readonly tokenSelection: PresetListProps["tokenSelection"];
  readonly change: (presets: TypeTokens) => void;
}): React.JSX.Element {
  const [presets, setPresets] = useState(props.initial);
  const commit = (next: TypeTokens): void => {
    props.change(next);
    setPresets(next);
  };
  return (
    <PresetList
      presets={presets}
      // The panel's own add: the list mints the id, the host builds the record.
      onAdd={(id) =>
        commit({
          ...presets,
          [id]: newPresetType,
        })
      }
      selection={props.selection}
      tokenSelection={props.tokenSelection}
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
  initial: TypeTokens,
  options: {
    readonly selection?: PresetListProps["selection"];
    readonly tokenSelection?: PresetListProps["tokenSelection"];
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
        selection={options.selection}
        tokenSelection={options.tokenSelection}
        change={change}
      />,
    );
  });
  return { host, change };
}

async function click(target: Element): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
}

/** A preset's resolution value span, by the row that carries the preset's id. */
function resolutionLine(host: HTMLElement, id: string): HTMLElement {
  const value = host.querySelector<HTMLElement>(
    `[data-yunari-type-preset-row="${id}"] [data-yunari-type-preset-resolution]`,
  );
  if (value === null) throw new Error(`no resolution line for ${id}`);
  return value;
}

/** The readout the pane states its answer in, as against the list below it. */
function binding(host: HTMLElement): HTMLElement {
  const found = host.querySelector<HTMLElement>(
    "[data-yunari-type-preset-binding]",
  );
  if (found === null) throw new Error("the list states no binding");
  return found;
}

/** The interim name the list prints until Task 4.1's computed name lands. */
function tokenName(id: string, token: TypeToken): string {
  return `${id} ${token.family}${token.weight === undefined ? "" : ` ${token.weight}`}`;
}

const withWeight: TypeTokens = {
  body: { family: "Inter", weight: 600 },
  caption: { family: "Inter" },
};

/** Tokens keyed by a role id and one that is not, so the badge's presence and
 *  its absence are both read. */
const withRoles: TypeTokens = {
  heading: { family: "Inter", weight: 600 },
  body: { family: "Inter" },
  plain: { family: "Inter" },
};

/** A library whose *first declared* key is also the one the selection is set
 *  in, so restoring the `Object.keys(presets)[0]` default cannot pass the
 *  "nothing is selected" case by naming some other token. */
const withNumbers: TypeTokens = {
  "24-400": { family: "Inter", weight: 400 },
  body: { family: "Inter" },
};
const firstDeclaredPresetId = Object.keys(withNumbers)[0]!;

it("draws each preset as a row with a specimen and a resolution, and no input controls", async () => {
  // DESIGN.md §5.1–§5.3: a row with a well would read as editable. This row is
  // a selector — one pressable line, nothing to type in.
  const { host } = await mount(withRoles);
  const row = host.querySelector<HTMLButtonElement>(
    '[data-yunari-type-preset-row="heading"]',
  );
  if (row === null) throw new Error("no heading row");

  expect(row.tagName).toBe("BUTTON");
  expect(row.getAttribute("aria-pressed")).toBe("false");

  // The specimen is `Aa` in the preset's own family: packaged faces are already
  // in `document.fonts`, so nothing is fetched to draw it.
  const specimen = row.querySelector<HTMLElement>(
    "[data-yunari-type-preset-specimen]",
  );
  expect(specimen?.textContent).toBe("Aa");
  expect(specimen?.style.fontFamily).toBe("Inter");

  expect(row.textContent).toContain(tokenName("heading", withRoles.heading!));
  // The badge is the copy table's word, read on the badge itself rather than
  // matched anywhere in the row: a hardcoded "Heading" would otherwise hide
  // behind the token's own name.
  expect(row.querySelector("[data-yunari-type-preset-role]")?.textContent).toBe(
    uiCopy.assets.fontPreview.role.heading,
  );

  const expected = resolveTypeToken(
    { typeTokens: withRoles },
    "typeTokens.heading",
  );
  expect(resolutionLine(host, "heading").textContent).toBe(expected);
  expect(resolutionLine(host, "heading").textContent).not.toBe("");

  expect(row.querySelector("input, select, textarea")).toBeNull();
  // A roleless token carries no badge, so the badge means a role rather than
  // "every row has one".
  expect(
    host.querySelector(
      '[data-yunari-type-preset-row="plain"] [data-yunari-type-preset-role]',
    ),
  ).toBeNull();
  // The pane is a list now: the chooser that browsed it for the deleted field
  // set is gone with the fields.
  expect(host.querySelector("[data-yunari-type-preset]")).toBeNull();
});

it("selects a token when a row is pressed, and clears the canvas selection", async () => {
  const surface = canvas({ selectedCount: 1, activeKind: "object" });
  const selection = new SelectionStore();
  selection.set(surface.bridge);
  const tokenSelection = new TokenSelectionStore(selection);
  const { host } = await mount(withWeight, { tokenSelection });

  await click(
    host.querySelector('[data-yunari-type-preset-row="caption"]') as Element,
  );

  // The canvas selection is cleared through the bridge's own empty-list
  // gesture — the Fabric boundary stays in `bridge.ts`.
  expect(surface.selectLayers).toHaveBeenCalledWith([]);
  expect(selection.get().selectedCount).toBe(0);
  expect(tokenSelection.get()).toEqual({ kind: "preset", id: "caption" });
  // The row states the token selection, so a press reads back on the list.
  expect(
    host
      .querySelector('[data-yunari-type-preset-row="caption"]')
      ?.getAttribute("aria-pressed"),
  ).toBe("true");
  expect(
    host
      .querySelector('[data-yunari-type-preset-row="body"]')
      ?.getAttribute("aria-pressed"),
  ).toBe("false");
});

it("says nothing is selected rather than showing the first declared preset", async () => {
  // The `vg-094` case, first, because it is the whole row: restoring the
  // `Object.keys(presets)[0]` default must fail here and only here. The readout
  // is the pane's *answer*, and a default that reads like one is the defect.
  const selection = stage();
  const { host } = await mount(withNumbers, { selection: selection.source });

  await act(async () => selection.set(undefined, false));

  const text = binding(host).textContent;
  expect(text).not.toContain(
    tokenName(firstDeclaredPresetId, withNumbers[firstDeclaredPresetId]!),
  );
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
  expect(text).toContain(tokenName("24-400", withNumbers["24-400"]!));
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
  expect(binding(host).textContent).toContain(
    tokenName("24-400", withNumbers["24-400"]!),
  );
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
  expect(text).toContain("typeTokens.gone");
  expect(text).toContain(uiCopy.inspectorFields.unresolved);
  expect(text).not.toContain(uiCopy.panels.selectionEmpty);
  expect(text).not.toContain(uiCopy.panels.selectionNoType);
});

it("adds a preset under the first free id", async () => {
  const { host, change } = await mount(withWeight);

  await click(host.querySelector("[data-yunari-type-preset-add]") as Element);

  const added = change.mock.calls[0]?.[0] as TypeTokens;
  expect(added.type).toEqual(newPresetType);
  expect(added.body).toEqual(withWeight.body);
});
