// @vitest-environment jsdom

/**
 * The Tokens pane's paint list: one pressable row per token.
 *
 * **A row is a selector, not a control.** Pressing it selects the token for the
 * inspector, where the fields live, and the list states the held paint the way
 * the preset list states its own. Nothing here edits the document. The row
 * keeps the shape it always had — a swatch, the token's name and its usage
 * figure — so the pane stays browsable without opening a field set.
 *
 * **The figure comes from the caller's one walk.** The count beside a token and
 * the set a deletion moves are `paletteTokenUsage`'s record, so this file
 * asserts the pane states what it is given rather than deriving a second answer.
 *
 * `Harness` is the session's half of that contract: a commit comes back as a new
 * palette prop, exactly as `editor-session`'s `render()` hands one back.
 */
import type { FabricPalette } from "@yunari/renderer-core";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  SelectionStore,
  TokenSelectionStore,
} from "../../editor-shell/shell-stores.js";
import { uiCopy } from "../../ui-copy.js";
import { PaintList, type PaintListProps } from "./paint-list.js";
import { PAINT_LIST_PALETTE } from "./paint-list-fixture.js";

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
  readonly tokenSelection: PaintListProps["tokenSelection"];
  readonly onSettled: PaintListProps["onSettled"];
  readonly change: (palette: FabricPalette) => void;
}): React.JSX.Element {
  const [palette, setPalette] = useState(props.initial);
  return (
    <PaintList
      palette={palette}
      usage={props.usage}
      tokenSelection={props.tokenSelection}
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
    readonly tokenSelection?: PaintListProps["tokenSelection"];
  } = {},
): Promise<{
  readonly host: HTMLElement;
  readonly change: ReturnType<typeof vi.fn>;
  readonly settled: ReturnType<typeof vi.fn>;
  readonly tokenSelection: TokenSelectionStore;
}> {
  if (root !== undefined) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  const host = document.createElement("div");
  document.body.append(host);
  const change = vi.fn();
  const settled = vi.fn();
  const tokenSelection =
    options.tokenSelection ?? new TokenSelectionStore(new SelectionStore());
  const mounted = createRoot(host);
  root = mounted;
  await act(async () => {
    mounted.render(
      <Harness
        initial={initial}
        usage={options.usage}
        tokenSelection={tokenSelection}
        onSettled={settled}
        change={change}
      />,
    );
  });
  return { host, change, settled, tokenSelection };
}

async function click(target: Element): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
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

it("draws rows with a swatch, a name and a usage figure and no fields", async () => {
  const { host } = await mount(PAINT_LIST_PALETTE, {
    usage: usageWith({ background: [], accent: [] }),
  });

  const row = host.querySelector<HTMLElement>(
    '[data-yunari-palette-token-row="background"]',
  );
  // The swatch is the row's own paint sample, decorative to a screen reader.
  const swatch = row?.querySelector<HTMLElement>('span[aria-hidden="true"]');
  // The colour, not merely a `background` declaration: jsdom serialises the
  // fixture's `BACKGROUND_PAINT` (`#102030`) to its rgb form.
  expect(swatch?.style.background).toBe("rgb(16, 32, 48)");
  expect(row?.textContent).toContain("Background");
  expect(usageFigure(host, "background")).toBe("0");

  // Every control left the pane with the field set: the chooser, the fields,
  // the reassignment row and the users list are the inspector's now.
  for (const selector of [
    "[data-yunari-palette-token]",
    "[data-yunari-palette-fields]",
    "[data-yunari-palette-name]",
    "[data-yunari-palette-kind]",
    "[data-yunari-palette-picker]",
    "[data-yunari-palette-replacement]",
    "[data-yunari-palette-delete]",
    "[data-yunari-token-users]",
  ]) {
    expect(host.querySelector(selector), selector).toBeNull();
  }
});

it("selects a paint token when a row is pressed, and marks it pressed", async () => {
  const { host, tokenSelection } = await mount(PAINT_LIST_PALETTE);

  const accent = host.querySelector<HTMLElement>(
    '[data-yunari-palette-token-row="accent"]',
  )!;
  await click(accent);

  expect(tokenSelection.get()).toEqual({ kind: "paint", id: "accent" });
  // The row states the token selection, as a preset row does: the pane shows
  // which paint's fields the inspector is holding.
  expect(accent.getAttribute("aria-pressed")).toBe("true");
  expect(
    host
      .querySelector('[data-yunari-palette-token-row="background"]')
      ?.getAttribute("aria-pressed"),
  ).toBe("false");
});

it("adds a new paint token and selects it, so the inspector shows its fields", async () => {
  const { host, change, settled, tokenSelection } =
    await mount(PAINT_LIST_PALETTE);

  await click(host.querySelector("[data-yunari-palette-add]")!);

  expect(change).toHaveBeenLastCalledWith({
    ...PAINT_LIST_PALETTE,
    colour: {
      name: uiCopy.panels.newColour,
      value: { kind: "solid", color: expect.any(String) },
    },
  });
  expect(tokenSelection.get()).toEqual({ kind: "paint", id: "colour" });
  expect(
    host
      .querySelector('[data-yunari-palette-token-row="colour"]')
      ?.getAttribute("aria-pressed"),
  ).toBe("true");
  // A new token is a discrete globals commit with no gesture to settle behind
  // it, so the pane records the entry itself.
  expect(settled).toHaveBeenCalledOnce();
});

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
  // the missing-reading rule and the host's rule: a missing reading is stated, never defaulted.
  const { host } = await mount(PAINT_LIST_PALETTE, { usage: undefined });

  expect(usageFigure(host, "background")).toBe(uiCopy.panels.notSet);
  expect(usageFigure(host, "background")).not.toBe("0");
  // With no scene there is no list of users either, and the list never draws
  // one: that is the inspector's, read from the same getter.
  expect(host.querySelector("[data-yunari-token-users]")).toBeNull();
});
