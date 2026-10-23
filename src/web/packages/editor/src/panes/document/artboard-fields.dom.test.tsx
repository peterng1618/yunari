// @vitest-environment jsdom
// No colour literal appears in this file: every fixture is a document value the
// panel only ever prints, so the design ratchet has nothing here to hold to a
// token.

/**
 * The Document pane, measured against the enumeration taken from the imperative
 * panel before a line of it was rewritten.
 *
 * **Every hook the pane kept is still there**, the size note is **derived from
 * the scene** rather than printed from a stored figure, and **no native select
 * survives** — a `select` is the control the shell's own set replaced, and
 * `input[type=range]` is the slider primitive's hidden thumb rather than a
 * control this pane may hold.
 *
 * The board's colour, media and position are not this pane's any more: they are the
 * background layer's, and the selection inspector's `backgroundColumn` renders
 * them. This file asserts both halves — the size controls remain, and none of
 * the background hooks is here.
 *
 * The pane is mounted the way the session mounts it — through
 * `createArtboardPanel`, whose `root`/`render` pair is the contract
 * `editor-session.ts` keeps — so a hook asserted here is a hook the editor's own
 * wiring really reaches.
 */
import { type Artboard, type ThemeMetadata } from "@yunari/renderer-core";
import { outsideCount, type SceneBox } from "@yunari/scene-fabric";
import { act } from "react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  type ArtboardPanel,
  createArtboardPanel,
} from "../../artboard-panel.js";
import { uiCopy } from "../../ui-copy.js";

// Base UI's popups need three browser APIs jsdom has none of — the same three
// `preset-list.dom.test.tsx` supplies, for the same reason.
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

let panel: ArtboardPanel | undefined;

afterEach(async () => {
  if (panel !== undefined) await act(async () => panel?.destroy());
  panel = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/**
 * Every `data-yunari-*` hook this pane still renders, in the order it renders
 * them. A field the pane drops is a missing hook, and this list is the only
 * thing that catches it.
 *
 * The background's three hooks are deliberately absent: they left with the
 * controls, which `backgroundColumn` now owns.
 */
const enumeratedHooks = [
  // Metadata: the theme's own description.
  "theme-name",
  "theme-author",
  "theme-description",
  "theme-language",
  "theme-language-sample",
  "theme-version",
  // The artboard: the three controls that derive a size, and the free pair for
  // a size no preset names.
  "artboard-ratio",
  "artboard-orientation",
  "artboard-resolution",
  "artboard-width",
  "artboard-height",
  "artboard-note",
] as const;

/** The controls the background layer took with it. The pane offers no second
 *  surface for a value the inspector already asks. */
const BACKGROUND_HOOKS = [
  "artboard-background",
  "background-asset",
  "background-bounds",
  "background-flip-x",
] as const;

async function mount(
  options: { readonly sceneBoxes?: () => readonly SceneBox[] } = {},
): Promise<{
  readonly host: HTMLElement;
  readonly change: ReturnType<typeof vi.fn>;
}> {
  // The previous panel goes the way the session takes it, so a case that mounts
  // twice leaves one tree behind rather than two.
  if (panel !== undefined) await act(async () => panel?.destroy());
  panel = undefined;
  document.body.replaceChildren();
  const host = document.createElement("div");
  document.body.append(host);
  const change = vi.fn();
  await act(async () => {
    panel = createArtboardPanel(host, change, {
      onMetadataChange: vi.fn(),
      ...options,
    });
  });
  return { host, change };
}

async function draw(artboard: Artboard, metadata?: ThemeMetadata) {
  if (panel === undefined) throw new Error("no panel mounted");
  await act(async () => panel?.render(artboard, metadata));
}

/** The boxes a scene reports: one object, outside the 1000 × 1000 board when
 *  `outside`, wholly inside it otherwise. */
function scene(outside: boolean): readonly SceneBox[] {
  return [
    {
      visible: true,
      left: outside ? 950 : 100,
      top: 100,
      width: 100,
      height: 100,
      depth: 0,
    },
  ];
}

/** What the note says for a scene, from the owners' own answers: `uiCopy`'s
 *  wording and `scene-fabric`'s count, never a restatement of either. */
function noteFor(boxes: readonly SceneBox[]): string {
  const { outside, counted } = outsideCount(boxes, {
    width: 1000,
    height: 1000,
  });
  return outside === 0
    ? uiCopy.panels.artboardSizeNote
    : uiCopy.panels.artboardOutside(
        uiCopy.panels.artboardSizeNote,
        outside,
        counted,
      );
}

function note(host: HTMLElement): string {
  return host.querySelector("[data-yunari-artboard-note]")?.textContent ?? "";
}

it("renders the board's size controls, and none of the background's", async () => {
  const { host } = await mount();
  await draw({ width: 1280, height: 720 }, { name: "Living Room" });

  for (const hook of enumeratedHooks) {
    expect(host.querySelector(`[data-yunari-${hook}]`), hook).not.toBeNull();
  }

  // The background layer's colour, media and position are the selection inspector's
  // rows now (`backgroundColumn`), so the Document pane holds no control for
  // them — a second surface for one value is a second owner of it.
  for (const hook of BACKGROUND_HOOKS) {
    expect(host.querySelector(`[data-yunari-${hook}]`), hook).toBeNull();
  }
});

it("derives the size note rather than printing a stored figure", async () => {
  // The note is `sceneBoxes`', so it moves when the boxes move and cannot go
  // stale on disk: the same board says one thing for a scene that fits and
  // another for one that does not.
  const boxes = scene(true);
  const { host } = await mount({ sceneBoxes: () => boxes });
  await draw({ width: 1000, height: 1000 });

  expect(note(host)).toBe(noteFor(boxes));
  expect(note(host)).not.toBe(noteFor(scene(false)));

  // And the rule alone when nothing is outside, which is the arm the figure
  // would otherwise hide behind a count of zero.
  const { host: fitting } = await mount({ sceneBoxes: () => scene(false) });
  await draw({ width: 1000, height: 1000 });
  expect(note(fitting)).toBe(uiCopy.panels.artboardSizeNote);
});

it("states the note's role and describes the controls it is about with it", async () => {
  // The note is the one place the panel says what a size change costs, so it
  // reaches a screen reader through the controls that change a size — the free
  // pair and all three preset controls — rather than only to whoever reads the
  // pane top to bottom.
  const { host } = await mount();
  await draw({ width: 1280, height: 720 });

  const noteElement = host.querySelector("[data-yunari-artboard-note]");
  expect(noteElement?.getAttribute("role")).toBe("note");
  const id = noteElement?.id ?? "";
  expect(id).not.toBe("");
  for (const hook of [
    "artboard-width",
    "artboard-height",
    "artboard-ratio",
    "artboard-orientation",
    "artboard-resolution",
  ]) {
    expect(
      host
        .querySelector(`[data-yunari-${hook}]`)
        ?.getAttribute("aria-describedby"),
      hook,
    ).toBe(id);
  }
});

it("has no native select left in the pane", async () => {
  const { host } = await mount();
  await draw({ width: 1280, height: 720 });

  expect(host.querySelectorAll("select")).toHaveLength(0);
  expect(host.querySelectorAll('input[type="range"]')).toHaveLength(0);
});
