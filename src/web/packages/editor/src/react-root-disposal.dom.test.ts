// @vitest-environment jsdom

/**
 * Every React root the editor creates is unmounted on its own disposal path.
 *
 * `createRoot` is a subscription: unmounting is the only thing that releases
 * the tree it rendered, and neither `element.remove()` nor dropping the last
 * reference does it. The Add pane was the first shipped root disposed by DOM
 * removal alone; the palette panel was the second, and it was worse — its picker
 * and gradient roots were nested `createRoot`s re-created every time the field
 * set rebuilt (the `built`/`shape` rule), so it leaked per token switch as well
 * as per session teardown. Task 5 replaced that file's rendering leaves: the
 * picker and the gradient editor are children of the Tokens pane's tree now, so
 * the file declares one root and the cases below pin that it stays one.
 *
 * Three instruments, because the defect has three faces and only one of them is
 * a document listener:
 *
 * - the **root count** disposes the panel the way `editor-session` does and
 *   asserts every root it created was unmounted;
 * - the **listener balance** opens the popover and asserts every document
 *   listener its mount registered was removed again;
 * - the **source guard** refuses a shipped `createRoot` with no `unmount` on its
 *   disposal path, and pins how many roots each shipped file creates.
 *
 * **What the root count is for.** The Add pane's instrument — a tally of
 * `document.addEventListener` against `removeEventListener` — cannot balance
 * against a panel whose popover is *closed*, which is the state a session
 * teardown usually finds. A closed popover registers nothing of its own, and the
 * only document listener left is React DOM's own `selectionchange`, added once
 * per document at `createRoot` (`react-dom-client.development.js:20897-20913`)
 * and never removed by `unmount`. So the closed-popover tally is `added: 1,
 * removed: 0` with the fix and without it; what is actually stranded there is
 * the root itself. The balance instrument below is the same idea where it does
 * bite: with the popover **open**, Base UI registers twelve document listener
 * types and unmounting removes exactly those.
 *
 * A zero on both sides is the vacuous pass every case refuses: each asserts its
 * own added count too.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FabricPalette } from "@yunari/renderer-core";
import { act } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPalettePanel } from "./palette-manager/panel.js";

const SRC = dirname(fileURLToPath(import.meta.url));

interface CreatedRoot {
  readonly container: Element | DocumentFragment;
  unmounted: boolean;
}

/** Every root this file's panel asked React for, in creation order. Held in
 *  `vi.hoisted` so the module mock below can reach it — `vi.mock` factories are
 *  hoisted above every import in this file. */
const createdRoots = vi.hoisted(() => [] as CreatedRoot[]);

vi.mock("react-dom/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom/client")>();
  return {
    ...actual,
    createRoot(
      container: Element | DocumentFragment,
      options?: Parameters<typeof actual.createRoot>[1],
    ) {
      const root = actual.createRoot(container, options);
      const record: CreatedRoot = { container, unmounted: false };
      createdRoots.push(record);
      const unmount = root.unmount.bind(root);
      root.unmount = () => {
        record.unmounted = true;
        unmount();
      };
      return root;
    },
  };
});

beforeAll(() => {
  // jsdom's selector engine cannot answer `:modal`/`:popover-open`, and
  // floating-ui asks for both on every position; each unanswerable call costs
  // ~0.5s of selector parsing, which turns one popover open into ~35s and would
  // time the open case out.
  const matches = Element.prototype.matches;
  Element.prototype.matches = Object.assign(function (
    this: Element,
    selector: string,
  ): boolean {
    if (selector === ":modal" || selector === ":popover-open") return false;
    return matches.call(this, selector);
  }, matches);
});

beforeEach(() => {
  createdRoots.length = 0;
  document.body.replaceChildren();
});

/**
 * The fixture is `transparent` — the picker's own no-paint value, and the one
 * `panel.dom.test.ts` already uses — because what these cases measure is
 * whether the root was released, not what it paints.
 */
const paletteWithOneSolidToken: FabricPalette = {
  panel: { name: "Panel", value: { kind: "solid", color: "transparent" } },
};

/** The same token as a gradient, which is a *different shape*, so `render`
 *  rebuilds the field set — in the same tree, since Task 5. */
const paletteWithOneGradientToken: FabricPalette = {
  panel: {
    name: "Panel",
    value: {
      kind: "gradient",
      angle: 0,
      stops: [
        { offset: 0, color: "transparent" },
        { offset: 1, color: "transparent" },
      ],
    },
  },
};

function mountHost(): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  return host;
}

/** The trigger the picker renders, which is what opens its popover. */
function pickerTrigger(host: HTMLElement): HTMLElement {
  const trigger = host.querySelector<HTMLElement>(
    '[data-testid="picker-trigger"]',
  );
  if (trigger === null) throw new Error("The picker rendered no trigger.");
  return trigger;
}

/**
 * Document registration counted by event type.
 *
 * Both sides are mocked, so a tree that relies on a real document listener has
 * none here — the open case below mounts the popover through React and never
 * needs a listener to fire.
 */
function spyDocumentListeners(): {
  readonly added: Map<string, number>;
  readonly removed: Map<string, number>;
} {
  const added = new Map<string, number>();
  const removed = new Map<string, number>();
  const count =
    (into: Map<string, number>) =>
    (type: string): void => {
      into.set(type, (into.get(type) ?? 0) + 1);
    };
  vi.spyOn(document, "addEventListener").mockImplementation(
    count(added) as never,
  );
  vi.spyOn(document, "removeEventListener").mockImplementation(
    count(removed) as never,
  );
  return { added, removed };
}

/**
 * Document listeners this panel's roots do **not** own, so the balance below is
 * about the panel and not about the harness:
 *
 * - `selectionchange` — React DOM's own, registered once per document at
 *   `createRoot` and never removed by `unmount`
 *   (`react-dom-client.development.js:20897-20913`);
 * - `mouseover`/`mouseout` — jsdom's selector engine, `nwsapi`, which registers
 *   the pair on the document the first time `Element.matches` is asked a
 *   `:hover`-bearing selector (`node_modules/nwsapi/src/nwsapi.js:1961-1962`).
 *   Nothing in the editor asked for them, and they survive every unmount here.
 */
const NOT_THE_PANELS = new Set(["selectionchange", "mouseover", "mouseout"]);

describe("a palette panel's React roots", () => {
  it("are all unmounted when the panel is disposed", () => {
    const panel = createPalettePanel(mountHost(), () => {}, undefined, {});
    panel.render(paletteWithOneSolidToken);

    // The field set really mounted a root: without this, a panel that created
    // none would report every root unmounted, which is the vacuous pass.
    expect(createdRoots.length).toBeGreaterThan(0);

    panel.destroy();

    expect(createdRoots.map((root) => root.unmounted)).toEqual(
      createdRoots.map(() => true),
    );
  });

  it("keeps one root across a rebuild of the field set", () => {
    const panel = createPalettePanel(mountHost(), () => {}, undefined, {});
    panel.render(paletteWithOneSolidToken);
    const firstFieldSet = createdRoots.length;
    expect(firstFieldSet).toBeGreaterThan(0);

    // The same token as a gradient is a *different shape*, so the field set
    // rebuilds. It used to be rebuilt as a second root — the picker's, holding
    // the discarded token in its closures — and it is the same tree now, which
    // is why this asserts a count that does not move rather than one that does.
    panel.render(paletteWithOneGradientToken);

    expect(createdRoots.length).toBe(firstFieldSet);
    expect(createdRoots.map((root) => root.unmounted)).toEqual(
      createdRoots.map(() => false),
    );
  });

  it("releases the document listeners its open popover registered", async () => {
    const host = mountHost();
    const listeners = spyDocumentListeners();
    const panel = createPalettePanel(host, () => {}, undefined, {});
    await act(async () => {
      panel.render(paletteWithOneSolidToken);
    });

    // The popover has to be *open*: closed, Base UI registers nothing on the
    // document and this case would measure the harness instead of the panel.
    await act(async () => {
      pickerTrigger(host).click();
    });
    expect(
      document.querySelector('[data-testid="colour-picker"]'),
    ).not.toBeNull();

    await act(async () => {
      panel.destroy();
    });

    const owned = [...listeners.added.keys()].filter(
      (type) => !NOT_THE_PANELS.has(type),
    );
    // Non-vacuity: a popover that never mounted has nothing to leak, and a
    // balance of zero against zero proves nothing.
    expect(
      owned.length,
      "the open popover registered no document listener",
    ).toBeGreaterThan(0);
    for (const type of owned) {
      expect(
        listeners.removed.get(type) ?? 0,
        `${type} was registered but not released`,
      ).toBe(listeners.added.get(type));
    }
  });
});

/**
 * The shipped sources, minus the two kinds of file whose root outlives any
 * editor surface and so has no disposal path to be on:
 *
 * - `*.test.*` and `*.test-stage.*` — a test's tree is the test's;
 * - `control-fixture.tsx` — the control set's preview page, a build entry whose
 *   lifetime is the page's, not an editor surface's.
 *
 * Those exclusions are the ones this task enumerated, and the case below names
 * the three harness pages so the exclusion stays a judgement about them rather
 * than a pattern that happened to miss them.
 */
function shippedSourceFiles(dir = SRC): readonly string[] {
  // `readdirSync(path)` plus `statSync`, not `withFileTypes`: the editor's Node
  // typings are deliberately narrow (`node-builtins.d.ts`), and widening them
  // for a test's convenience is the act that file exists to make visible.
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return shippedSourceFiles(path);
    if (!/\.tsx?$/.test(name)) return [];
    if (/\.test\.tsx?$/.test(name)) return [];
    if (/\.test-stage\.tsx?$/.test(name)) return [];
    if (name === "control-fixture.tsx") return [];
    return [path];
  });
}

/**
 * The shipped roots, one entry per file that has any, with how many that file
 * creates. The count is the point: a file that already unmounts one root passes
 * a per-file `unmount` search with a *second*, stranded root beside it, so the
 * arity is pinned here and a new root in a known file is red.
 */
const SHIPPED_ROOTS: readonly (readonly [string, number])[] = [
  // the artboard panel's own tree, released by `destroy()` (Task 8). It was
  // imperative field builders until then, so it created no root; the Document
  // pane is a React tree now and the file declares the one it makes.
  ["artboard-panel.ts", 1],
  // the three converted dialogs' host (plan 5 Task 4a). It creates one root per
  // open rather than one per session, and releases it in `finish()` — the root is
  // the dialog's lifetime, so there is no `destroy()` to be on.
  ["components/ui/modal-host.tsx", 1],
  // the shell itself, and the canvas dock's separate root.
  ["editor-shell/shell-layout.tsx", 2],
  // the Add pane, one root (Task 3).
  ["new-object-panel.ts", 1],
  // the palette panel's own tree, released by `destroy()`. It was **2** until
  // Task 5: the picker and the gradient editor were nested `createRoot`s, one
  // per field-set rebuild. They are React children of the Tokens pane now, so
  // the file creates one root and this declaration follows the code.
  ["palette-manager/panel.ts", 1],
  // the Assets pane's own tree, released by `createAssetsPane`'s `destroy()`.
  ["panes/assets/assets-pane.tsx", 1],
  // the selected token's own column, released by `destroy()` (Task 15a) — the
  // same duplicate-pane shape the Assets pane's entry above pins.
  ["panes/tokens/token-inspector.tsx", 1],
  ["selection-inspector/column.tsx", 1],
  ["selection-inspector/inspector.tsx", 1],
  // the lead block's own tree, between the subject and the sections, released
  // by `destroy()` on the inspector's disposal path (`vg-463`, `vg-465`).
  ["selection-inspector/selection-lead.tsx", 1],
  // the type-preset panel's own tree, released by `destroy()` (Task 6). It was
  // imperative field builders until then, so it created no root; the preset
  // library is a React tree now and the file declares the one it makes.
  ["type-preset-manager/panel.ts", 1],
];

describe("every shipped React root", () => {
  it("is unmounted on its own disposal path, and the scan reaches each known one", () => {
    const sites = shippedSourceFiles()
      .filter((path) => /createRoot\s*\(/.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path).split("\\").join("/"))
      .sort();

    // The files this task enumerated, and no others: a file that quietly stopped
    // being scanned — a rename, a new exclusion — fails here rather than leaving
    // the loop below checking nothing and passing.
    expect(sites).toEqual(SHIPPED_ROOTS.map(([file]) => file));

    for (const [file, roots] of SHIPPED_ROOTS) {
      const source = readFileSync(resolve(SRC, file), "utf8");
      const created = [...source.matchAll(/createRoot\s*\(/g)].length;
      expect(created, `${file} creates a different number of React roots`).toBe(
        roots,
      );

      // The arity the count is for: one release, per file, of the roots it
      // creates. A file that builds a root and releases nothing fails here; a
      // file that released one of two fails above.
      expect(
        /\.unmount\s*\(/.test(source),
        `${file} creates a React root and never unmounts one`,
      ).toBe(true);
    }
  });

  it("does not read the dev harness pages it excludes", () => {
    // These three do contain `createRoot`; naming them here is what makes the
    // exclusion above a decision about them rather than an accident.
    for (const harness of [
      "control-fixture.tsx",
      "chart-manager/chart-stage.test-stage.tsx",
      "selection-inspector/runs.test-stage.tsx",
    ]) {
      expect(
        readFileSync(resolve(SRC, harness), "utf8"),
        `${harness} is excluded as a dev harness page`,
      ).toMatch(/createRoot\s*\(/);
    }
  });
});
