// @vitest-environment jsdom

/**
 * The chrome vocabulary's two invariants: one weight rule, one family.
 *
 * **The weight case reads the rendered DOM, not the source.** `stroke-width`
 * is an attribute lucide writes on the `<svg>` it renders, and the eight card
 * unit diagrams write it on theirs, so a scan of the source cannot see a
 * component prop and this reads what the browser would.
 * It is **bounded by what it mounts**: the fleet below draws the vocabulary, the
 * rail, the camera cluster, a pane title, the row's affordances, every kind mark
 * and the whole Add pane. The surfaces it does *not* mount — settings, the
 * keyboard panel, the header menus, the dock, the layer footer, the composition
 * pane, the diagnostic line, the font picker — are covered by Task 9's browser
 * assertion over the built bundle, which is the net that is not bounded by a
 * fixture.
 *
 * **The family case reads the source**, because "hand-authored path" is a
 * property of a file rather than of a render: it names every file that draws a
 * glyph without going through the vocabulary, and every entry there needs §6's
 * reason beside it. The case forbids an unaccounted source, not a particular
 * list.
 *
 * **The third invariant is the kind set's**: one glyph per object kind, closed
 * against the kind vocabulary rather than against `KIND_GLYPHS`' own keys, and
 * the Add pane drawing every object its owner offers. The layer row's own arms
 * are drawn by the fleet below but asserted in `kind-mark.dom.test.tsx`, which
 * is where one kind's mark and another's are told apart.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { insertGroups } from "../new-object-panel.js";
import { AddPane } from "../panes/add/add-pane.js";
import { KindMark } from "../panes/composition/kind-mark.js";
import { RowAffordances } from "../panes/composition/row-affordances.js";
import { uiCopy } from "../ui-copy.js";
import type { ViewportManager } from "../viewport-manager/index.js";
import { DisplaySwitch } from "./display-switch.js";
import {
  BACKGROUND_GLYPH,
  CHART_BAR_GLYPH,
  CHART_GAUGE_GLYPH,
  CHART_LINE_GLYPH,
  CHART_PIE_GLYPH,
  CHECK_GLYPH,
  ENTER_GLYPH,
  ERROR_GLYPH,
  FIT_GLYPH,
  Glyph,
  glyphStrokeWidth,
  HIDDEN_GLYPH,
  INFO_GLYPH,
  KEYBOARD_GLYPH,
  KIND_GLYPHS,
  LEAVE_GLYPH,
  LOCK_GLYPH,
  type LucideIcon,
  MINUS_GLYPH,
  PAGE_GLYPH,
  PALETTE_GLYPH,
  PENCIL_GLYPH,
  PLUS_GLYPH,
  RAIL_GLYPHS,
  SETTINGS_GLYPH,
  STACK_GLYPH,
  STAR_GLYPH,
  TWISTY_GLYPHS,
  VISIBLE_GLYPH,
  WARNING_GLYPH,
} from "./icons.js";
import type { LayerMark, LayerRow } from "./layer-tree.js";
import { Pane } from "./pane.js";
import { Rail } from "./rail.js";

/**
 * The sources allowed to draw a glyph without going through `icons.ts`, each
 * with §6's reason. `icons.ts` is the vocabulary itself and the one chrome
 * reader of `lucide-react`; the theme icons are authored scene geometry rather
 * than chrome; the registry is §6's own authority on action icons; and the card
 * diagrams are §6's unit-tile escape — "a card unit in the Add pane is not
 * arbitrary … so a unit tile may carry a diagram of what it builds". The Add
 * pane is *not* here: its shape, chart and text tiles are the vocabulary's own
 * glyphs, so a tile that went back to drawing its own path would arrive in this
 * list and fail the case below.
 */
const EXEMPT_SOURCES: readonly string[] = [
  "editor-shell/icons.ts", // the vocabulary: one family, one weight, and the one place both are decided
  "new-fabric-theme-icons.ts", // authored scene icons — lucide geometry turned into Fabric paths, not chrome
  "object-actions.ts", // §6: the registry owns which action wears which icon
  "panes/add/card-diagrams.tsx", // §6: "a unit tile may carry a diagram of what it builds"
];

/** Where the editor's own sources live, from this file's directory. */
const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** An `import type` statement cannot draw a glyph, so it is not a family
 *  breach; a value import from `lucide-react` is. */
const TYPE_IMPORT = /import\s+type\b[^;]*?;/g;
const LUCIDE_IMPORT = /from\s+"lucide-react[^"]*"/;

/** A hand-authored chrome `<svg>` that hardcodes its weight as a numeric JSX
 *  prop — `strokeWidth={2}`. Such a source imports no lucide value and names no
 *  `glyphStrokeWidth`, so both signals above miss it; a third one arriving would
 *  otherwise slip this case unless its surface happened to be in the fleet. */
const RAW_SVG = /<svg\b/;
const NUMERIC_STROKE = /strokeWidth=\{\s*\d/;

function sourceFiles(root: string): readonly string[] {
  const found: string[] = [];
  for (const name of readdirSync(root)) {
    if (name === "node_modules") continue;
    const path = join(root, name);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(name)) found.push(path);
  }
  return found;
}

/**
 * Every source that draws a glyph without the vocabulary: a file that reads
 * `lucide-react` directly, a file that sets the vocabulary's weight on an
 * inline `<svg>` of its own, or a file that draws a raw `<svg>` with a numeric
 * `strokeWidth` literal. Test files and declarations are not chrome.
 */
function glyphSources(): readonly string[] {
  const found: string[] = [];
  for (const path of sourceFiles(SOURCE_ROOT)) {
    const rel = relative(SOURCE_ROOT, path).replaceAll("\\", "/");
    if (/\.d\.ts$/.test(rel) || /\.test\.tsx?$/.test(rel)) continue;
    const source = readFileSync(path, "utf8");
    const withoutTypes = source.replace(TYPE_IMPORT, "");
    if (
      LUCIDE_IMPORT.test(withoutTypes) ||
      source.includes("glyphStrokeWidth") ||
      (RAW_SVG.test(source) && NUMERIC_STROKE.test(source))
    ) {
      found.push(rel);
    }
  }
  return found.sort();
}

it("keeps the family one, so no chrome glyph is a hand-authored path", () => {
  expect(glyphSources()).toEqual(EXEMPT_SOURCES);
});

/** One glyph drawn at a size, and whether it takes §6's fill. */
type Drawn = {
  readonly icon: LucideIcon;
  readonly size: number;
  readonly filled?: boolean;
};

/** Every glyph the vocabulary names, so the case is not satisfied by a surface
 *  that happens to draw only the ones somebody thought of. */
const VOCABULARY: readonly Drawn[] = [
  { icon: STACK_GLYPH, size: 13 },
  { icon: BACKGROUND_GLYPH, size: 13 },
  { icon: PAGE_GLYPH, size: 14 },
  { icon: PALETTE_GLYPH, size: 14 },
  { icon: PLUS_GLYPH, size: 15 },
  { icon: MINUS_GLYPH, size: 15 },
  { icon: FIT_GLYPH, size: 15 },
  { icon: SETTINGS_GLYPH, size: 17 },
  { icon: CHECK_GLYPH, size: 12 },
  { icon: CHECK_GLYPH, size: 12, filled: true }, // the live check, §6's filled escape
  { icon: ERROR_GLYPH, size: 13 },
  { icon: WARNING_GLYPH, size: 13 },
  { icon: CHART_GAUGE_GLYPH, size: 13 },
  { icon: CHART_LINE_GLYPH, size: 13 },
  { icon: CHART_BAR_GLYPH, size: 13 },
  { icon: CHART_PIE_GLYPH, size: 13 },
  { icon: KEYBOARD_GLYPH, size: 14 },
  { icon: INFO_GLYPH, size: 14 },
  { icon: PENCIL_GLYPH, size: 15 },
  { icon: STAR_GLYPH, size: 13 },
  { icon: STAR_GLYPH, size: 13, filled: true },
  { icon: ENTER_GLYPH, size: 13 },
  { icon: LEAVE_GLYPH, size: 13 },
  { icon: VISIBLE_GLYPH, size: 15 },
  { icon: HIDDEN_GLYPH, size: 15 },
  { icon: LOCK_GLYPH.locked.icon, size: 15, filled: true },
  { icon: LOCK_GLYPH.unlocked.icon, size: 15 },
  { icon: RAIL_GLYPHS.composition, size: 17 },
  { icon: RAIL_GLYPHS.add, size: 17 },
  { icon: RAIL_GLYPHS.tokens, size: 17 },
  { icon: RAIL_GLYPHS.document, size: 17 },
  { icon: TWISTY_GLYPHS.collapsed, size: 13 },
  { icon: TWISTY_GLYPHS.expanded, size: 13 },
];

/** Every mark a row can carry, so all six arms are drawn — and the shape arm
 *  with a primitive of its own, since its glyph comes from `SHAPE_GLYPHS`
 *  rather than from the kind map. */
const MARKS: readonly LayerMark[] = [
  { kind: "text" },
  { kind: "chart", family: "gauge" },
  { kind: "shape", shape: "wedge" },
  { kind: "image" },
  { kind: "group" },
  { kind: "background" },
];

function row(over: Partial<LayerRow> = {}): LayerRow {
  return {
    id: "row-1",
    name: "Row",
    kind: "group",
    mark: { kind: "group" },
    role: { kind: "group", unit: undefined },
    bound: [],
    depth: 0,
    parentId: undefined,
    hasChildren: false,
    collapsed: false,
    visible: true,
    locked: true,
    selected: false,
    ...over,
  };
}

/** A camera that answers every read and does nothing on a write: the cluster
 *  renders its three controls and no more. */
function camera(): ViewportManager {
  return {
    zoom: () => 1,
    zoomBy: () => {},
    zoomToFit: () => {},
    zoomToSelection: () => {},
    reset: () => {},
    display: () => undefined,
    showDisplay: () => {},
    isFitted: () => false,
    onChange: () => () => {},
  } as unknown as ViewportManager;
}

function Fleet(): React.JSX.Element {
  return (
    <>
      {VOCABULARY.map((drawn, index) => (
        <Glyph key={index} {...drawn} />
      ))}
      <Rail
        slot="composition"
        collapsed={false}
        onChoose={() => {}}
        onOpenSettings={() => {}}
      />
      <DisplaySwitch
        viewport={camera()}
        artboard={() => ({ width: 1920, height: 1080 })}
      />
      <Pane id="fleet" title="Fleet" icon={STACK_GLYPH}>
        <div />
      </Pane>
      <RowAffordances
        row={row()}
        attended
        onToggleVisible={() => {}}
        onToggleLocked={() => {}}
      />
      {MARKS.map((mark) => (
        <KindMark key={mark.kind} mark={mark} />
      ))}
      <AddPane groups={insertGroups()} onInsert={() => {}} />
    </>
  );
}

const mounted: Root[] = [];
afterEach(async () => {
  while (mounted.length > 0) {
    const root = mounted.pop();
    if (root !== undefined) await act(async () => root.unmount());
  }
  document.body.innerHTML = "";
});

/** Every `<svg>` the fleet drew. */
function renderedGlyphs(): readonly SVGSVGElement[] {
  return [...document.querySelectorAll("svg")];
}

it("draws every chrome glyph at its own size's weight, in §6's tiers", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted.push(root);
  act(() => root.render(<Fleet />));

  const glyphs = renderedGlyphs();
  // A guard that asserted over nothing would pass for the wrong reason.
  expect(glyphs.length).toBeGreaterThan(20);
  // Pair each rendered glyph's weight with the size it was given — the `<svg>`'s
  // own `width` is that size — and require the rule's own answer. A case that
  // only asserted one value would pass over a flat weight, which is the defect
  // the drawing's tiers replaced.
  const sizes = new Set<string>();
  for (const svg of glyphs) {
    const size = Number(svg.getAttribute("width"));
    sizes.add(String(size));
    expect(svg.getAttribute("stroke-width")).toBe(
      String(glyphStrokeWidth(size)),
    );
  }
  // Both in-fleet tiers are exercised, so the case is not passing over one
  // weight by accident: 13px is the 1.8 tier, the rail and pane sizes the 1.7.
  expect(sizes.has("13")).toBe(true);
  expect(sizes.has("17")).toBe(true);
});

it("rises the stroke as the glyph shrinks, in §6's tiers", () => {
  // The 10px tier is the `--faint` disclosure chevron, which the fleet above
  // does not mount, so the boundaries are checked on the pure rule.
  expect(glyphStrokeWidth(10)).toBe(2);
  expect(glyphStrokeWidth(11)).toBe(1.8);
  expect(glyphStrokeWidth(13)).toBe(1.8);
  expect(glyphStrokeWidth(14)).toBe(1.7);
  expect(glyphStrokeWidth(24)).toBe(1.7);
});

it("gives every kind a glyph, so a new kind cannot arrive without one", () => {
  // The list comes from the kind vocabulary and **never from `KIND_GLYPHS`'
  // own keys**: a case that enumerated the map would pass over a map with
  // anything in it, and over an empty one. `uiCopy.panels.layerKinds` is the
  // second place a kind has to reach (its own doc says "Keys mirror
  // `LayerKind`"), so the two closings are checked against each other rather
  // than each against itself.
  //
  // The compile-time half is `satisfies Readonly<Record<LayerKind, LucideIcon>>`
  // in `icons.ts`. It is not visible here and this run is exactly what a plan
  // executes, which is why both halves exist.
  expect(Object.keys(KIND_GLYPHS).sort()).toEqual(
    Object.keys(uiCopy.panels.layerKinds).sort(),
  );
});

it("draws a group with the generic glyph rather than a diagram of it", () => {
  // §6's own rule: a group is an arbitrary set of elements, so it cannot be
  // depicted — it gets the stack glyph and its name. The kind vocabulary reads
  // the *constant* the row's group arm reads, so the two cannot grow two marks
  // for one kind.
  expect(KIND_GLYPHS.group).toBe(STACK_GLYPH);
});

it("draws every object the Add pane offers, so an insertable kind cannot arrive unmarked", () => {
  // The list is the owner's (`insertGroups()`), never a fixture written here: an
  // object added there arrives in this case the day it is added. Three of the
  // four kinds are `LayerKind`s the case above closes; a card lands as a group,
  // which wears the same stack glyph.
  const offered = insertGroups().flatMap((group) => group.objects);
  // A count over nothing would pass for the wrong reason.
  expect(offered.length).toBeGreaterThan(0);

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted.push(root);
  act(() =>
    root.render(<AddPane groups={insertGroups()} onInsert={() => {}} />),
  );

  const tiles = [...host.querySelectorAll("button")];
  expect(tiles).toHaveLength(offered.length);
  // A card's tile is §6's depicted unit and a primitive's is the object it
  // builds; what this asks is only that each one is drawn, because a kind
  // offered with no mark is a tile an author cannot choose.
  for (const tile of tiles) {
    const svg = tile.querySelector("svg");
    expect(svg).not.toBeNull();
    // **Rendered, not read off the source.** Every tile but a card unit's now
    // wears a vocabulary glyph, and a lucide glyph is the only mark that writes
    // this class — the pane's own hand-authored `<svg>`s wrote none, which is
    // how a tile drawn by hand again is caught here rather than in a reading.
    if (tile.getAttribute("data-yunari-panel-card") === null) {
      // `?? ""` so a glyph rendered with no class fails as a mismatch against
      // the pattern rather than as vitest's "expected a string, got object".
      expect(svg?.getAttribute("class") ?? "").toMatch(/^lucide/);
    }
  }
});
