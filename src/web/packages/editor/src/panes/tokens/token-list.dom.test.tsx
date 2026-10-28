// @vitest-environment jsdom

/**
 * The Tokens pane's type-token list.
 *
 * **A row is a selector, not a control.** Pressing it selects the token for the
 * inspector; nothing in the list edits the document. What a row shows is the
 * specimen `Aa` in the token's own family, its computed name, and its usage
 * figure — the same three readings the paint list's rows carry.
 *
 * **The name is the whole reading.** The token's name is computed from family
 * and weight, so no second line restates them; the canvas-binding readout that
 * used to sit above the list went with the rest of the pane's selection copy.
 *
 * `Harness` is the session's half of the contract: an add comes back as a new
 * `presets` prop, exactly as `editor-session`'s `render()` hands one back.
 */
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
import { newTypeToken } from "../../new-fabric-theme-globals.js";
import { freePresetId } from "../../type-preset-apply.js";
import type { TypeTokens } from "../../type-preset-manager/panel.js";
import { tokenName } from "../../type-token-manager/name.js";
import { uiCopy } from "../../ui-copy.js";
import { TokenList, type TokenListProps } from "./token-list.js";
import type { TokenUsage } from "./token-use.js";

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

/** The list over a token map it owns, so an add comes back the way the panel's
 *  own `onChange` hands one back rather than leaving the component on stale
 *  props. */
function Harness(props: {
  readonly initial: TypeTokens;
  readonly tokenSelection: TokenListProps["tokenSelection"];
  readonly usage: TokenListProps["usage"];
  readonly change: (presets: TypeTokens) => void;
}): React.JSX.Element {
  const [presets, setPresets] = useState(props.initial);
  const commit = (next: TypeTokens): void => {
    props.change(next);
    setPresets(next);
  };
  return (
    <TokenList
      presets={presets}
      // The panel owns the duplicate check and mints the id; this harness
      // stands in for it, so it mints the same free unroled id.
      onAdd={() =>
        commit({
          ...presets,
          [freePresetId(presets)]: newTypeToken,
        })
      }
      tokenSelection={props.tokenSelection}
      usage={props.usage}
    />
  );
}

async function mount(
  initial: TypeTokens,
  options: {
    readonly tokenSelection?: TokenListProps["tokenSelection"];
    readonly usage?: TokenListProps["usage"];
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
        tokenSelection={options.tokenSelection}
        usage={options.usage}
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

/** A row's usage figure, by the token id the row carries. */
function figure(host: HTMLElement, id: string): HTMLElement {
  const value = host.querySelector<HTMLElement>(
    `[data-yunari-type-preset-row="${id}"] [data-yunari-type-preset-usage]`,
  );
  if (value === null) throw new Error(`no usage figure for ${id}`);
  return value;
}

/** The rows in the order the list draws them. */
function rows(host: HTMLElement): readonly string[] {
  return [
    ...host.querySelectorAll<HTMLElement>("[data-yunari-type-preset-row]"),
  ]
    .map((row) => row.getAttribute("data-yunari-type-preset-row"))
    .filter((id): id is string => id !== null);
}

const withWeight: TypeTokens = {
  body: { family: "Inter", weight: 600 },
  caption: { family: "Inter" },
};

/** Tokens keyed by a role id and one that is not, so a role's computed name and
 *  an unroled one are both read. */
const withRoles: TypeTokens = {
  heading: { family: "Inter", weight: 600 },
  body: { family: "Inter" },
  plain: { family: "Inter" },
};

it("draws each token as a row with a specimen and its computed name, and no input controls", async () => {
  // DESIGN.md §5.1–§5.3: a row with a well would read as editable. This row is
  // a selector — one pressable line, nothing to type in.
  const { host } = await mount(withRoles);
  const row = host.querySelector<HTMLButtonElement>(
    '[data-yunari-type-preset-row="heading"]',
  );
  if (row === null) throw new Error("no heading row");

  expect(row.tagName).toBe("BUTTON");
  expect(row.getAttribute("aria-pressed")).toBe("false");

  // The specimen is `Aa` in the token's own family: packaged faces are already
  // in `document.fonts`, so nothing is fetched to draw it.
  const specimen = row.querySelector<HTMLElement>(
    "[data-yunari-type-preset-specimen]",
  );
  expect(specimen?.textContent).toBe("Aa");
  expect(specimen?.style.fontFamily).toBe("Inter");

  // The computed name carries the role word, so no separate badge is drawn,
  // and it is the only reading of family and weight on the row.
  expect(row.textContent).toContain(tokenName("heading", withRoles.heading!));
  expect(row.querySelector("[data-yunari-type-preset-role]")).toBeNull();

  expect(row.querySelector("input, select, textarea")).toBeNull();
});

it("lists the roles first in heading/body/mono order, then by name", async () => {
  const { host } = await mount({
    alpha: { family: "Zebra", weight: 400 },
    mono: { family: "Fira Code", weight: 400 },
    body: { family: "Inter", weight: 400 },
    heading: { family: "Manrope", weight: 700 },
  });

  expect(rows(host)).toEqual(["heading", "body", "mono", "alpha"]);
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

it("puts each token's usage figure at the end of its row", async () => {
  // The same reading the paint list carries: how many layers are set in it.
  const usage: TokenUsage = {
    body: [
      { objectId: "a", name: "Title" },
      { objectId: "b", name: "Body copy" },
    ],
    caption: [],
  };
  const { host } = await mount(withWeight, { usage: () => usage });

  expect(figure(host, "body").textContent).toBe("2");
  expect(figure(host, "caption").textContent).toBe("0");
  // The figure is the row's last reading, after the name.
  const row = host.querySelector('[data-yunari-type-preset-row="body"]');
  expect(
    row?.lastElementChild?.getAttribute("data-yunari-type-preset-usage"),
  ).not.toBeNull();
});

it("says the scene is not set rather than inventing a count when there is no usage", async () => {
  // A pane with no scene has no answer — and `0` is an answer.
  const { host } = await mount(withWeight);

  expect(figure(host, "body").textContent).toBe(uiCopy.panels.notSet);
  expect(figure(host, "caption").textContent).not.toBe("0");
});

it("adds a token under the first free unroled id", async () => {
  const { host, change } = await mount(withWeight);

  await click(host.querySelector("[data-yunari-type-preset-add]") as Element);

  const added = change.mock.calls[0]?.[0] as TypeTokens;
  expect(added.type).toEqual(newTypeToken);
  expect(added.body).toEqual(withWeight.body);
});
