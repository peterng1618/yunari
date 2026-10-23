import {
  CHART_BAR_GLYPH,
  CHART_GAUGE_GLYPH,
  CHART_LINE_GLYPH,
  CHART_PIE_GLYPH,
  Glyph,
  KIND_GLYPHS,
  type LucideIcon,
  SHAPE_GLYPHS,
  STACK_GLYPH,
} from "../../editor-shell/icons.js";
import type { LayerMark } from "../../editor-shell/layer-tree.js";
import type { ShapeKind } from "../../new-object-defaults.js";

/**
 * A chart's family mark, one icon per family the document can name.
 *
 * The old column said "chart" to every chart, which is the word a card of eight
 * charts repeats eight times and the one thing an author scanning for the ring
 * cannot use. `ChartColumn` is the fallback for a family this build does not
 * know, so the row still says what it is rather than what it is not.
 */
const CHART_ICONS: Readonly<Record<string, LucideIcon>> = {
  gauge: CHART_GAUGE_GLYPH,
  line: CHART_LINE_GLYPH,
  bar: CHART_BAR_GLYPH,
  pie: CHART_PIE_GLYPH,
};

/**
 * The glyph a chart family wears, wherever one is drawn.
 *
 * One owner, because two surfaces draw these four: the layer row's mark and the
 * Add pane's tile. A family that wore a gauge in the row and a column on the
 * tile would be two answers to one question, and the author would have to learn
 * both.
 *
 * **A family this build does not know wears the kind's generic mark, not bar's**
 * (`vg-489`). The fallback used to be `CHART_BAR_GLYPH`, which named a family the
 * document never named — and because `KIND_GLYPHS.chart` was the same constant,
 * the generic kind mark and the unknown-family mark were one glyph. This is the
 * rule the shape arm below already follows: an unnamed kind gets the kind's own
 * mark, which is honest about being unable to name it.
 */
export function chartFamilyGlyph(family: string | undefined): LucideIcon {
  return family === undefined
    ? KIND_GLYPHS.chart
    : (CHART_ICONS[family] ?? KIND_GLYPHS.chart);
}

/**
 * The kind, drawn as one chrome glyph.
 *
 * One mark per kind, from the one family and the one weight rule
 * (`editor-shell/icons.ts`): `text` the vocabulary's `T`, `image` its picture
 * mark, `group` the stack glyph, `shape` the primitive's own glyph and `chart`
 * its family's. The four marks this replaced — the text object's own words in
 * its own face, a paint swatch, an image thumbnail, a family glyph — were four
 * drawings in one column, and three of them said nothing at 13px that the row's
 * name, role and bound key do not already say in words.
 *
 * A row whose kind this build cannot name still draws rather than printing
 * nothing: the shape and chart arms each fall back to their kind's generic mark
 * (`icons.ts`), so the slot is never empty and the row never claims a kind the
 * document does not hold.
 *
 * Every arm sits in one fixed-width slot, which is what lines the names up. A
 * group still takes the slot rather than collapsing it, so an eight-card
 * document has its rows in one column rather than two ragged ones.
 *
 * `data-yunari-layer-mark` names which arm drew, so a browser case can measure
 * the treatment rather than infer it from the icon's class.
 */
export function KindMark({
  mark,
}: {
  readonly mark: LayerMark;
}): React.JSX.Element {
  return <span className="yunari-layer-mark">{treatment(mark)}</span>;
}

/** The six arms: one glyph each, and nothing drawn beside it. */
function treatment(mark: LayerMark): React.JSX.Element {
  switch (mark.kind) {
    case "text":
      return markGlyph(mark.kind, KIND_GLYPHS.text);
    case "chart":
      return markGlyph(mark.kind, chartFamilyGlyph(mark.family));
    case "shape":
      return markGlyph(mark.kind, shapeGlyph(mark.shape));
    case "image":
      return markGlyph(mark.kind, KIND_GLYPHS.image);
    // The group arm reads no member of `mark` and takes no children-derived
    // input: the same constant is drawn for every group, which is what keeps a
    // bespoke per-card diagram from growing back in behind a data field.
    case "group":
      return markGlyph(mark.kind, STACK_GLYPH);
    case "background":
      return markGlyph(mark.kind, KIND_GLYPHS.background);
  }
}

/** One arm's glyph, in the slot. The `data-` attribute is on the glyph's own
 *  span rather than on the slot, so a case can name the arm that drew. */
function markGlyph(
  arm: LayerMark["kind"],
  icon: LucideIcon,
): React.JSX.Element {
  return (
    <span data-yunari-layer-mark={arm}>
      <Glyph icon={icon} size={13} />
    </span>
  );
}

/** The glyph a primitive wears: its own kind's, or the generic shape mark for a
 *  kind this build cannot name — the rule `chartFamilyGlyph` follows above. */
function shapeGlyph(kind: ShapeKind | undefined): LucideIcon {
  return kind === undefined ? KIND_GLYPHS.shape : SHAPE_GLYPHS[kind];
}
