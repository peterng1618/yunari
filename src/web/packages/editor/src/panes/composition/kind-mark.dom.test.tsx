// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CHART_FAMILIES } from "@yunari/renderer-core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import {
  Glyph,
  KIND_GLYPHS,
  type LucideIcon,
  SHAPE_GLYPHS,
  STACK_GLYPH,
} from "../../editor-shell/icons.js";
import type { LayerMark } from "../../editor-shell/layer-tree.js";
import { SHAPE_KINDS } from "../../new-object-defaults.js";
import { KindMark } from "./kind-mark.js";

// React only flushes work scheduled inside `act` when it has been told it is in
// a test; without this, `act` warns and the update lands after the assertion.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** One arm per kind, so a case can ask every arm rather than the ones it happens
 *  to get right. The shape carries a primitive, because its glyph is the one
 *  that comes from `SHAPE_GLYPHS` rather than from the kind map. */
const ARMS: readonly LayerMark[] = [
  { kind: "text" },
  { kind: "chart", family: "gauge" },
  { kind: "shape", shape: "rect" },
  { kind: "image" },
  { kind: "group" },
  { kind: "background" },
];

function render(mark: LayerMark): HTMLElement {
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<KindMark mark={mark} />));
  return host;
}

/** The class lucide writes on the `<svg>` it renders for a glyph. Every mark's
 *  expected icon is read off the vocabulary through this rather than written as
 *  a literal, so moving an entry in `icons.ts` moves these cases with it instead
 *  of leaving stale names that still pass. The two chart-family literals in the
 *  third case below are the deliberate exception: a family reaches the row
 *  through `chartFamilyGlyph`'s own map rather than through an exported
 *  constant, so there is nothing to read it off — and a literal that goes stale
 *  fails there rather than passing over a mark that changed. */
function lucideClass(icon: LucideIcon): string | null {
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<Glyph icon={icon} size={13} />));
  return host.querySelector("svg")?.getAttribute("class") ?? null;
}

/** The one glyph an arm drew, in the arm's own slot. */
function armGlyph(mark: LayerMark): string | null | undefined {
  return render(mark)
    .querySelector<SVGElement>(`[data-yunari-layer-mark="${mark.kind}"] svg`)
    ?.getAttribute("class");
}

it("gives a group a generic glyph, and nothing it could not know", () => {
  const host = render({ kind: "group" });
  const slot = host.querySelector<HTMLElement>(".yunari-layer-mark");
  const glyph = host.querySelector<SVGElement>(
    '[data-yunari-layer-mark="group"]',
  );

  // The group's own arm drew, and it drew a glyph rather than nothing — the
  // whole correction to the earlier "a group shows nothing here". It is the
  // chrome vocabulary's stack glyph (`icons.ts`), the same one the rail's
  // Composition slot wears, rather than a second hand-authored path set.
  expect(glyph).not.toBeNull();
  expect(glyph?.querySelector("svg")?.getAttribute("class")).toBe(
    lucideClass(STACK_GLYPH),
  );
  // A glyph, not a word: the mark says "this holds others" without a second
  // string the treeitem's accessible name would then repeat.
  expect(slot?.textContent).toBe("");

  // **Nothing it could not know.** The same mark carrying fields the kind arm
  // never reads — the shape of a group's members, its name — draws the *same*
  // glyph. A treatment derived from a group's contents would differ here, which
  // is what makes §5.1's correction structural rather than a comment.
  const planted = {
    kind: "group",
    name: "CPU card",
    children: [{ kind: "shape", shape: "wedge" }],
  } as unknown as LayerMark;
  const plantedHost = render(planted);
  expect(
    plantedHost.querySelector('[data-yunari-layer-mark="group"]')?.outerHTML,
  ).toBe(glyph?.outerHTML);
});

it("draws a text row as the vocabulary's T, and never the object's words", () => {
  // A row's own words, set in the object's own face, were a 28px column
  // pretending to be a canvas: at 11px they clipped to `V…` and said nothing the
  // row's name does not. The kind's glyph is what belongs in the slot.
  const host = render({ kind: "text" });
  const glyph = host.querySelector<SVGElement>(
    '[data-yunari-layer-mark="text"] svg',
  );

  expect(glyph).not.toBeNull();
  expect(glyph?.getAttribute("class")).toBe(lucideClass(KIND_GLYPHS.text));
  // Nothing is drawn beside the glyph: no specimen, and no `title` carrying the
  // words either — a tooltip only a pointer can reach is not where a row says
  // what it holds.
  const slot = host.querySelector<HTMLElement>(".yunari-layer-mark");
  expect(slot?.textContent).toBe("");
  expect(slot?.querySelector("[title]")).toBeNull();
});

it("gives each kind a mark that says which kind it is", () => {
  // The negative half matters as much as the positive: one mark for everything
  // would pass a case that only checked the arms it happens to get right.
  expect(
    render({ kind: "chart", family: "gauge" })
      .querySelector('[data-yunari-layer-mark="chart"] svg')
      ?.getAttribute("class"),
  ).toContain("lucide-gauge");
  expect(
    render({ kind: "chart", family: "line" })
      .querySelector('[data-yunari-layer-mark="chart"] svg')
      ?.getAttribute("class"),
  ).toContain("lucide-chart-line");
  // A shape wears its own primitive's glyph, from the vocabulary: the two shapes
  // below are told apart by their marks, which is the one question a kind mark
  // answers. The expected classes are read off `SHAPE_GLYPHS`, so a primitive
  // that leaves the map is a compile error rather than a stale assertion.
  expect(armGlyph({ kind: "shape", shape: "rect" })).toBe(
    lucideClass(SHAPE_GLYPHS.rect),
  );
  expect(armGlyph({ kind: "shape", shape: "wedge" })).toBe(
    lucideClass(SHAPE_GLYPHS.wedge),
  );
  expect(
    armGlyph({ kind: "shape", shape: "rect" }),
    "two primitives do not wear one mark",
  ).not.toBe(armGlyph({ kind: "shape", shape: "wedge" }));
  // A primitive this build cannot name still draws, with the kind's generic
  // shape mark — a row that drew nothing would be a row with no kind at all.
  expect(armGlyph({ kind: "shape", shape: undefined })).toBe(
    lucideClass(KIND_GLYPHS.shape),
  );
  // An image is the vocabulary's picture mark rather than its own bytes, which
  // is what puts every kind's mark in one family at one weight.
  expect(armGlyph({ kind: "image" })).toBe(lucideClass(KIND_GLYPHS.image));
  // A group draws the generic stack glyph, never a diagram of what it holds.
  expect(
    render({ kind: "group" }).querySelector(
      '[data-yunari-layer-mark="group"] svg',
    ),
  ).not.toBeNull();
});

/** A mark's own words, so a failure names the pair that shared rather than two
 *  rendered class strings. */
function label(mark: LayerMark): string {
  switch (mark.kind) {
    case "shape":
      return `${mark.shape ?? "unnamed"} shape`;
    case "chart":
      return `${mark.family ?? "unnamed"} chart`;
    default:
      return mark.kind;
  }
}

it("gives every kind a mark no other kind wears", () => {
  // Written for the pair that did collide: `wedge` and `pie` were the same
  // component twice in `icons.ts`, so a wedge shape row and a pie chart row
  // rendered one class and neither mark named its kind. Reading the vocabulary
  // did not show it — the two entries sit rows apart — and the case above
  // compares `rect` against `wedge` alone. So every mark is rendered and every
  // pair compared.
  const marks: readonly LayerMark[] = [
    { kind: "text" },
    { kind: "image" },
    { kind: "group" },
    { kind: "shape", shape: undefined },
    ...SHAPE_KINDS.map((shape) => ({ kind: "shape", shape }) as const),
    // The unnamed family, in the set rather than after it: `vg-489` was this
    // mark colliding with `bar`'s, and a pair compared outside the loop could
    // still collide with a third mark the loop never saw.
    { kind: "chart", family: undefined },
    ...CHART_FAMILIES.map((family) => ({ kind: "chart", family }) as const),
  ];
  const drawn = marks.map((mark) => ({
    name: label(mark),
    glyph: armGlyph(mark) ?? "",
  }));
  // A loop over a short list would pass for the wrong reason: the count is one
  // mark per primitive, one per family, the unnamed chart and the four kinds
  // that wear one mark.
  expect(drawn).toHaveLength(SHAPE_KINDS.length + CHART_FAMILIES.length + 5);
  for (const { name, glyph } of drawn) {
    expect(glyph, `the ${name} mark drew no glyph`).not.toBe("");
  }
  // Every pair, because the defect was one pair: a set's size would report that
  // two marks matched without saying which two.
  for (const [index, one] of drawn.entries()) {
    for (const other of drawn.slice(index + 1)) {
      expect(
        other.glyph,
        `${one.name} and ${other.name} wear one mark`,
      ).not.toBe(one.glyph);
    }
  }

  // `vg-489` was here, asserted as a collision: a chart whose family this build
  // cannot name wore `bar`'s mark, because `chartFamilyGlyph`'s fallback *was*
  // `CHART_BAR_GLYPH` — and `KIND_GLYPHS.chart` was the same constant, so the
  // kind's generic mark and the unknown family's mark were one glyph. Nothing
  // else on the row corrected it: the role abstains and reads the kind word
  // ("Chart", `ui-copy.ts`), so the row claimed `bar` through the mark alone.
  // The unnamed chart now wears the *kind's* generic mark, which is what the
  // shape arm above already does for a shape kind it cannot name.
  expect(armGlyph({ kind: "chart", family: undefined })).toBe(
    lucideClass(KIND_GLYPHS.chart),
  );
  expect(armGlyph({ kind: "chart", family: undefined })).not.toBe(
    armGlyph({ kind: "chart", family: "bar" }),
  );
});

it("draws the mark the projection named, and never walks the group's children", () => {
  for (const mark of ARMS) {
    const host = render(mark);
    expect(
      host.querySelector(`[data-yunari-layer-mark="${mark.kind}"]`),
      `the ${mark.kind} arm drew its own treatment`,
    ).not.toBeNull();
  }

  // A group whose mark was handed a member's own treatment data must still draw
  // one mark, and it must be the group's: a descendant's `data-yunari-layer-mark`
  // appearing here would be the mark walking the children.
  const planted = render({
    kind: "group",
    children: [
      { kind: "chart", family: "pie" },
      { kind: "shape", shape: "wedge" },
    ],
  } as unknown as LayerMark);
  expect(planted.querySelectorAll("[data-yunari-layer-mark]")).toHaveLength(1);
  expect(
    planted.querySelector('[data-yunari-layer-mark="group"]'),
  ).not.toBeNull();
});

it("keeps every arm inside one fixed-width slot, so names stay in one column", () => {
  // Every arm is wrapped by the one slot, whatever it draws inside it, which is
  // what lines the names up across rows. A treatment that returned its own slot
  // would let two rows disagree about where the name begins.
  for (const mark of ARMS) {
    const host = render(mark);
    const slots = host.querySelectorAll(".yunari-layer-mark");
    expect(slots, `one slot for the ${mark.kind} arm`).toHaveLength(1);
    expect(
      slots[0]?.querySelector(`[data-yunari-layer-mark="${mark.kind}"]`),
      `the ${mark.kind} treatment sits inside the slot`,
    ).not.toBeNull();
  }

  // The slot's fixed width is a stylesheet fact, so it is read from the
  // stylesheet rather than restated: jsdom applies no CSS, and a copy here would
  // drift from the rule that actually lays the column out.
  const css = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../editor-shell/editor-shell.css",
    ),
    "utf8",
  );
  const at = css.indexOf("\n.yunari-layer-mark {");
  expect(at, ".yunari-layer-mark is not in the stylesheet").toBeGreaterThan(-1);
  const declarations = css.slice(at, css.indexOf("}", at));
  expect(declarations).toMatch(/flex:\s*0 0 \d+px/);
});
