import type { ChartFamily } from "../theme/document.js";
import { ANIMATION_EASINGS, type AnimationEasing } from "./animation.js";
import { SEGMENT_DIVISORS } from "./segments.js";

/**
 * Which settings each chart family accepts, as editable field descriptors.
 *
 * The **one owner** of that question. It previously had four
 * encodings that nothing related: the settings interfaces in `types.ts` and
 * `charts/*.ts`, the `default*Settings` objects, `validate.ts`'s `KNOWN_KEYS`
 * plus its `validateSettingsRange`, and the JSON schema. The editor had a
 * fifth — none at all, which is why no chart setting was editable despite all
 * four families being fully typed and validated.
 *
 * ## What this declares, and what it deliberately does not
 *
 * Scalar settings only: numbers, booleans and enumerations. **Paint is not
 * here.** `track`, `progress`, `stroke`, `fill`, `area`, `remainderFill` and
 * the two `palette` arrays are all `Fill` — `solid | thresholds | gradient` —
 * and color belongs at the theme level. Persisted chart paint now
 * references palette tokens; its control still needs to author those references
 * and threshold-band offsets without writing literal colors onto a chart.
 *
 * ## Grouping and hints
 *
 * A long list is a navigability problem and navigation is the answer: a field is
 * grouped, never trimmed. Every descriptor answers one **question** — its
 * `section` — and the four questions are ordered in one place,
 * `SETTINGS_SECTIONS`. A chart's own settings answer Content, because they are
 * what the chart shows; paint answers Paint. A `hint` is **required**: it says
 * what the setting does in the author's language, so the label never has to
 * carry the whole meaning, and a descriptor without one does not compile.
 * `advanced` marks a field for the collapsed-and-counted treatment, never for
 * removal. **Which fields are `advanced` is a judgement, not a measurement** —
 * it is which settings an author reaches for rarely, and moving one costs
 * nothing but this list.
 *
 * ## Two settings one level down
 *
 * `path` names where a field writes when it is not the top-level `property`, and
 * `visibleWhen` asks it only in the state it applies to. Both exist for exactly
 * two settings — `PieSettings.total.value` and the optional `AnimationSettings`
 * block on every family — which is why a path was chosen over a nested
 * descriptor tree. A surface reads and writes them through `settings-path.ts`,
 * so the write path is the renderer's read path.
 *
 * ## It does not restate the defaults
 *
 * A field carries no default value. The `default*Settings` objects already own
 * those and the option builders already apply them, so repeating one here would
 * be a fifth home for a number that is only correct in one place. A field with
 * no authored value shows its placeholder and the renderer's default applies —
 * the same rule the style rows follow.
 *
 * ## A bound that is not a number
 *
 * `min`/`max` are numbers; a pixel measure's ceiling is not. `bound` says where
 * it comes from instead — the chart's own drawn box, halved for a radius — and
 * the surface reads it at projection time off the object the renderer sizes its
 * canvas from, so a chart the author resized re-bounds its own fields and a
 * surface that cannot read the box leaves the field typed rather than guessing.
 * A field with a floor and no ceiling this table can name (`windowSeconds`,
 * `maxPoints`, `total.value`) carries neither, and is deliberately not a slider:
 * a track would offer a range the sample store or the data does not honour.
 *
 * ## The validator reads this table
 *
 * `min`/`max` below are **the document's bounds**, not only the control's: the
 * envelope loader refuses a present value outside them, and refuses a family's
 * crossed `min`/`max` pair where both halves are present (per
 * `vg-348`'s ruling of 2026-10-12). A change to a number here therefore changes
 * what loads, not only what a control offers — the table is the one owner of
 * that question, which is why the loader reads it instead of keeping a second
 * list of the same numbers.
 *
 * `bound` is **not** a document bound. It names a ceiling only the drawn box
 * knows — the chart's own box, halved for a radius — so a field carrying one
 * contributes its numeric floor and no ceiling, and a field with a floor and no
 * `bound` has no ceiling the envelope can name either.
 *
 * This reverses an earlier position recorded in this header, that driving
 * validation from the table was decided against because the range a control
 * offers and the invariants an adapter cannot recover from were held to be
 * different questions. That equivalence was never measured, and it is the
 * reason the table rather than a second list owns the numbers. The `validate.ts`
 * / `validateSettingsRange` validator this header used to lean on was deleted
 * before `vg-348` was filed.
 */

/** How a settings field is edited. */
export type SettingsFieldKind = "number" | "boolean" | "select";

/** The question a settings field answers, in the order a surface shows them. */
export type SettingsSection = "content" | "position" | "layer" | "paint";

export interface SettingsSectionDefinition {
  readonly id: SettingsSection;
  /** The section's name in the author's language. */
  readonly label: string;
}

/**
 * The four questions, ordered — **the one place section order is decided**.
 *
 * Position and Layer stay separate because moving a thing and scaling it are
 * different mistakes. A field's own place inside its section is its order
 * in the family array below, so this list orders the sections and nothing else.
 *
 * It carried a fifth, `spends`, until item 17 removed the read-only section that
 * was its only surface: no descriptor ever declared it, and the column that read
 * this order stopped asking the question.
 */
export const SETTINGS_SECTIONS: readonly SettingsSectionDefinition[] = [
  { id: "content", label: "Content" },
  { id: "position", label: "Position" },
  { id: "layer", label: "Layer" },
  { id: "paint", label: "Paint" },
];

export interface SettingsFieldDescriptor {
  /**
   * The field's name: the key inside the family's settings object, or a dotted
   * path for a nested field, so it stays unique within the family.
   */
  readonly property: string;
  readonly label: string;
  readonly kind: SettingsFieldKind;
  /** The question this field answers; one of `SETTINGS_SECTIONS`. */
  readonly section: SettingsSection;
  /** What the setting does, in the author's language — never its label again. */
  readonly hint: string;
  /** Present when the field belongs behind the collapsed-and-counted treatment. */
  readonly advanced?: true;
  /**
   * The settings interface declares this key optional, so **absent is an
   * authorable state**: the renderer decides and an explicit value overrides it.
   * A control for one has to be able to get back to it — clearing the field
   * removes the key rather than writing a value the author did not choose.
   */
  readonly optional?: true;
  /**
   * Where inside the settings object this field writes, when that is not the
   * top-level `property`. Defaults to `[property]`.
   */
  readonly path?: readonly string[];
  /**
   * The field is a question about one state of another, asked only in that
   * state — `total.value` applies when `total.kind` is `fixed`.
   */
  readonly visibleWhen?:
    | {
        readonly path: readonly string[];
        readonly equals: string;
      }
    | {
        /** Asked when the state at `path` is **not** this value. An absent
         *  setting is not the named state either, so a question about a mode
         *  the document never opted into stays hidden. */
        readonly path: readonly string[];
        readonly notEquals: string;
      };
  readonly min?: number;
  readonly max?: number;
  /** How far one step of a bounded number moves, for the surface that draws a
   *  native field; absent means one. */
  readonly step?: number;
  /**
   * The field accepts whole numbers only. A share that means "how wide the gap
   * is" is not finer than a percent in the author's terms, and the envelope
   * refuses a fraction the way it refuses an out-of-bounds value — the same
   * rule `values` states for a discrete field.
   */
  readonly integer?: true;
  /**
   * What this field's ceiling is read from, when it is not a number.
   *
   * A pixel measure cannot exceed the chart's own drawn box, and a radius
   * cannot exceed **half** of it — which is what Fabric's own `Rect` does with
   * `rx` at draw time (`vg-478`), and the same finding this rule met in the
   * selection column. The box is read at projection time from the object the
   * renderer sizes its canvas from, never written here as a constant: a chart
   * the author resized re-bounds its own measures, and a surface that cannot
   * read the box leaves the field typed rather than guessing a ceiling.
   *
   * A field with `min` alone and no `bound` has no ceiling this table can name
   * — `windowSeconds` and `maxPoints` are bounded by the sample store and
   * `total.value` by the chart's own data — so it is not a slider: a track
   * would offer a range the store or the data does not honour (`vg-469`).
   */
  readonly bound?: "drawnBox" | "halfDrawnBox";
  /** For `select`, the allowed values in the order a picker should list them. */
  readonly options?: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  /**
   * For `number`, the only values the field accepts, in ascending order.
   *
   * A discrete setting is not a bounded one: `min`/`max` alone would offer every
   * integer between the ends, and each of those is a value the adapters cannot
   * draw. The list is the document's own — the envelope refuses a present value
   * outside it — so the control, the loader and the adapters read one list.
   */
  readonly values?: readonly number[];
  /**
   * How many decimals the control shows. The stored value keeps its own
   * precision; this is display only, so a share reads `2.5` rather than `2.50`
   * or a bare `2`.
   */
  readonly decimals?: number;
  /** The unit the number is measured in, written beside the control so a share
   *  of the chart is not read as pixels or degrees. */
  readonly suffix?: string;
}

/** Persisted chart paint settings; token choice is shared across editor surfaces. */
export interface ChartPaintFieldDescriptor {
  readonly property: string;
  readonly label: string;
  /** Paint answers one question, and it is this one — the type says so. */
  readonly section: "paint";
  /** What the setting does, in the author's language — never its label again. */
  readonly hint: string;
  /** Present when the field belongs behind the collapsed-and-counted treatment. */
  readonly advanced?: true;
  /** A palette assigns one token to each existing series slot. */
  readonly multiple?: true;
}

/** `smooth` is authored geometry: a smoothed segment bends once when a sample
    lands, which the data clock makes the only reshape. */
const INTERPOLATION = [
  { value: "linear", label: "Linear" },
  { value: "step", label: "Step" },
  { value: "smooth", label: "Smooth" },
] as const;

const DASH = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
] as const;

const SAMPLING = [
  { value: "none", label: "None" },
  { value: "lttb", label: "LTTB" },
  { value: "average", label: "Average" },
] as const;

const ORIENTATION = [
  { value: "horizontal", label: "Horizontal" },
  { value: "vertical", label: "Vertical" },
] as const;

const RADAR_SHAPE = [
  { value: "polygon", label: "Polygon" },
  { value: "circle", label: "Circle" },
] as const;

/** Every easing named for an author; a `Record` so a new one must be named too. */
const EASING_LABELS: Readonly<Record<AnimationEasing, string>> = {
  linear: "Linear",
  cubicOut: "Cubic out",
  cubicInOut: "Cubic in-out",
  quadraticInOut: "Quadratic in-out",
  quinticInOut: "Quintic in-out",
};

const EASING = ANIMATION_EASINGS.map((value) => ({
  value,
  label: EASING_LABELS[value],
}));

/**
 * The animation block — one level down, the same four fields on every family.
 *
 * `AnimationSettings` is optional but, when present, a whole object, so a write
 * into it materialises the block from its own owner (`charts/animation.ts`) and
 * the table still declares no default. There is deliberately no on/off field:
 * absence means the defaults apply, not that the chart is static — `animate` is
 * supplied by the build.
 */
const ANIMATION_FIELDS: readonly SettingsFieldDescriptor[] = [
  {
    property: "animation.durationMs",
    label: "Transition duration",
    kind: "number",
    section: "layer",
    hint: "How long the chart takes to move an existing reading to its new value, in milliseconds.",
    path: ["animation", "durationMs"],
    min: 0,
    max: 5000,
  },
  {
    property: "animation.easing",
    label: "Transition easing",
    kind: "select",
    section: "layer",
    hint: "The curve that change follows; Linear is constant, the others start or end gently.",
    path: ["animation", "easing"],
    options: EASING,
  },
  {
    property: "animation.appearMs",
    label: "Appearance duration",
    kind: "number",
    section: "layer",
    hint: "How long the chart takes to draw itself in when it first appears, in milliseconds.",
    path: ["animation", "appearMs"],
    advanced: true,
    min: 0,
    max: 5000,
  },
  {
    property: "animation.appearEasing",
    label: "Appearance easing",
    kind: "select",
    section: "layer",
    hint: "The curve the chart follows as it draws itself in.",
    path: ["animation", "appearEasing"],
    advanced: true,
    options: EASING,
  },
];

/**
 * Every scalar setting, per family.
 *
 * Keyed by `ChartFamily` as a `Record`, so a new family is a compile error
 * until it gains a row — the same mechanism the capability matrix uses.
 *
 * Array order is the likelihood order: the fields an author reaches for most sit
 * first, and it is the order the surface renders. Preserve it; do not re-sort.
 */
export const CHART_SETTINGS_FIELDS: Readonly<
  Record<ChartFamily, readonly SettingsFieldDescriptor[]>
> = {
  gauge: [
    // §85's gauge-arc approximation: angles are degrees, 0 at the right of
    // center, 90 straight up.
    {
      property: "startAngle",
      label: "Start angle",
      kind: "number",
      section: "content",
      hint: "Where the drawn arc begins, in degrees — 0 points right of center and 90 straight up.",
      min: -360,
      max: 360,
    },
    {
      property: "endAngle",
      label: "End angle",
      kind: "number",
      section: "content",
      hint: "Where the drawn arc stops. The reading fills a share of the sweep, so it reaches here only at the maximum.",
      min: -360,
      max: 360,
    },
    {
      property: "min",
      label: "Minimum",
      kind: "number",
      section: "content",
      hint: "The value the arc's start stands for; a lower reading draws as an empty arc.",
    },
    {
      property: "max",
      label: "Maximum",
      kind: "number",
      section: "content",
      hint: "The value a full arc stands for; a higher reading draws full rather than rescaling the sweep.",
    },
    {
      property: "thickness",
      label: "Arc thickness",
      kind: "number",
      section: "content",
      hint: "How wide the ring is drawn, in pixels.",
      min: 0,
      bound: "drawnBox",
    },
    {
      property: "roundCap",
      label: "Rounded ends",
      kind: "boolean",
      section: "content",
      hint: "Rounds the two cut ends of the arc instead of leaving them square.",
    },
    {
      property: "segmentDivisor",
      label: "Segments",
      kind: "number",
      section: "content",
      hint: "Splits the arc into equal slices, each inheriting the rounded ends; 100 leaves it continuous.",
      min: 1,
      max: 100,
      values: SEGMENT_DIVISORS,
    },
    {
      property: "segmentSpacingPercent",
      label: "Segment spacing",
      kind: "number",
      section: "content",
      optional: true,
      hint: "How wide the empty space is, as a share of a slice; 100 leaves as much space as painted slice.",
      min: 1,
      max: 100,
      integer: true,
      suffix: "%",
    },
    {
      property: "segmentFill",
      label: "Fill",
      kind: "select",
      section: "content",
      optional: true,
      hint: "Whole lights the slice the reading reaches; partial stops the fill at the reading.",
      visibleWhen: { path: ["segmentDivisor"], notEquals: "100" },
      options: [
        { value: "whole", label: "Whole segment" },
        { value: "partial", label: "Partial segment" },
      ],
    },
    {
      property: "gradientSegments",
      label: "Gradient segments",
      kind: "number",
      section: "content",
      optional: true,
      advanced: true,
      hint: "How finely a gradient arc is approximated. The engine cannot draw a true angular gradient (§85).",
      min: 2,
      max: 256,
    },
    ...ANIMATION_FIELDS,
  ],
  line: [
    {
      property: "lineWidth",
      label: "Line width",
      kind: "number",
      section: "content",
      hint: "How thick the line is drawn, in pixels.",
      min: 0,
      bound: "drawnBox",
    },
    {
      property: "interpolation",
      label: "Interpolation",
      kind: "select",
      section: "content",
      hint: "How samples are joined: straight, stepped or smoothed segments.",
      options: INTERPOLATION,
    },
    {
      property: "dash",
      label: "Dash",
      kind: "select",
      section: "content",
      optional: true,
      hint: "Draws the stroke broken rather than solid, so two series that share a color are still told apart.",
      options: DASH,
    },
    {
      property: "showMarkers",
      label: "Show markers",
      kind: "boolean",
      section: "content",
      hint: "Draws a dot on each sample.",
    },
    {
      property: "markerSize",
      label: "Marker size",
      kind: "number",
      section: "content",
      hint: "The diameter of those dots, in pixels.",
      min: 0,
      bound: "drawnBox",
    },
    {
      property: "windowSeconds",
      label: "Visible history (s)",
      kind: "number",
      section: "content",
      hint: "How much history the plot spans. Bounded by the sample store, which keeps 300 s.",
      min: 1,
    },
    {
      property: "maxPoints",
      label: "Max points",
      kind: "number",
      section: "content",
      advanced: true,
      hint: "The hardest cap on drawn points; older ones are dropped, never interpolated over.",
      min: 2,
    },
    {
      property: "min",
      label: "Y minimum",
      kind: "number",
      section: "content",
      optional: true,
      hint: "The value at the bottom of the axis; empty lets the data choose it.",
    },
    {
      property: "max",
      label: "Y maximum",
      kind: "number",
      section: "content",
      optional: true,
      hint: "The value at the top of the axis; empty lets the data choose it.",
    },
    {
      property: "showAxes",
      label: "Show axes",
      kind: "boolean",
      section: "content",
      hint: "Draws the time and value axes and their gridlines.",
    },
    {
      property: "sampling",
      label: "Downsampling",
      kind: "select",
      section: "content",
      optional: true,
      advanced: true,
      hint: "Render-time only. LTTB keeps the visible shape of a dense series at a fraction of the draw cost; it changes what is drawn, never what was measured.",
      options: SAMPLING,
    },
    ...ANIMATION_FIELDS,
  ],
  bar: [
    {
      property: "orientation",
      label: "Orientation",
      kind: "select",
      section: "content",
      hint: "Whether bars grow sideways from the left or upward from the bottom.",
      options: ORIENTATION,
    },
    {
      property: "min",
      label: "Minimum",
      kind: "number",
      section: "content",
      hint: "The value an empty bar stands for; a lower reading draws empty.",
    },
    {
      property: "max",
      label: "Maximum",
      kind: "number",
      section: "content",
      hint: "The value a full bar stands for; a higher reading draws full rather than rescaling every bar.",
    },
    {
      property: "barWidth",
      label: "Bar width",
      kind: "number",
      section: "content",
      optional: true,
      hint: "How thick each bar is, in pixels; empty sizes it to the category.",
      min: 0,
      bound: "drawnBox",
    },
    {
      property: "categoryGapPercent",
      label: "Category gap %",
      kind: "number",
      section: "content",
      advanced: true,
      hint: "How much of each category slot is left as space between bars.",
      min: 0,
      max: 100,
    },
    {
      property: "cornerRadius",
      label: "Corner radius",
      kind: "number",
      section: "content",
      hint: "How much the bar's own corners are rounded, in pixels.",
      min: 0,
      bound: "halfDrawnBox",
    },
    {
      property: "trackCornerRadius",
      label: "Track corner radius",
      kind: "number",
      section: "content",
      optional: true,
      advanced: true,
      hint: "The unfilled remainder's own rounding, beside the bar's. Empty leaves it square.",
      min: 0,
      bound: "halfDrawnBox",
    },
    {
      property: "segmentDivisor",
      label: "Segments",
      kind: "number",
      section: "content",
      hint: "Splits the bar into equal slices, each inheriting the corner radius; 100 leaves it continuous.",
      min: 1,
      max: 100,
      values: SEGMENT_DIVISORS,
    },
    {
      property: "segmentSpacingPercent",
      label: "Segment spacing",
      kind: "number",
      section: "content",
      optional: true,
      hint: "How wide the empty space is, as a share of a slice; 100 leaves as much space as painted slice.",
      min: 1,
      max: 100,
      integer: true,
      suffix: "%",
    },
    {
      property: "segmentFill",
      label: "Fill",
      kind: "select",
      section: "content",
      optional: true,
      hint: "Whole lights the slice the reading reaches; partial stops the fill at the reading.",
      visibleWhen: { path: ["segmentDivisor"], notEquals: "100" },
      options: [
        { value: "whole", label: "Whole segment" },
        { value: "partial", label: "Partial segment" },
      ],
    },
    {
      property: "showAxes",
      label: "Show axes",
      kind: "boolean",
      section: "content",
      hint: "Draws the value axis and its gridlines.",
    },
    ...ANIMATION_FIELDS,
  ],
  pie: [
    {
      property: "innerRadiusPercent",
      label: "Inner radius %",
      kind: "number",
      section: "content",
      hint: "Zero is a full pie; anything above makes a donut.",
      min: 0,
      max: 100,
    },
    {
      property: "outerRadiusPercent",
      label: "Outer radius %",
      kind: "number",
      section: "content",
      hint: "How far out the ring reaches; 100 fills the available space.",
      min: 0,
      max: 100,
    },
    {
      property: "startAngle",
      label: "Start angle",
      kind: "number",
      section: "content",
      advanced: true,
      hint: "Where the first slice begins, in degrees — 0 points right of center and 90 straight up.",
      min: -360,
      max: 360,
    },
    {
      property: "endAngle",
      label: "End angle",
      kind: "number",
      section: "content",
      optional: true,
      advanced: true,
      hint: "Where the ring stops; empty closes it into a full circle.",
      min: -360,
      max: 360,
    },
    {
      property: "padAngle",
      label: "Slice gap",
      kind: "number",
      section: "content",
      advanced: true,
      hint: "The gap left between neighbouring slices, in degrees.",
      min: 0,
      max: 360,
    },
    {
      property: "cornerRadius",
      label: "Corner radius",
      kind: "number",
      section: "content",
      advanced: true,
      hint: "How much each slice's outer corners are rounded, in pixels.",
      min: 0,
      bound: "halfDrawnBox",
    },
    {
      property: "segmentDivisor",
      label: "Segments",
      kind: "number",
      section: "content",
      hint: "Splits each slice's fill into equal wedges, each inheriting the corner radius; 100 leaves it continuous.",
      min: 1,
      max: 100,
      values: SEGMENT_DIVISORS,
    },
    {
      property: "segmentSpacingPercent",
      label: "Segment spacing",
      kind: "number",
      section: "content",
      optional: true,
      hint: "How wide the empty space is, as a share of a slice; 100 leaves as much space as painted slice.",
      min: 1,
      max: 100,
      integer: true,
      suffix: "%",
    },
    {
      property: "total",
      label: "Total",
      kind: "select",
      section: "content",
      hint: "What the slices add up to: the parts themselves, or a total you fix so what no part accounts for is drawn as a remainder.",
      path: ["total", "kind"],
      options: [
        { value: "sum", label: "Sum of the parts" },
        { value: "fixed", label: "A fixed total" },
      ],
    },
    {
      property: "total.value",
      label: "Fixed total",
      kind: "number",
      section: "content",
      hint: "The whole each slice is a share of; anything no part accounts for is drawn as the remainder slice.",
      path: ["total", "value"],
      visibleWhen: { path: ["total", "kind"], equals: "fixed" },
      min: 0,
    },
    ...ANIMATION_FIELDS,
  ],
  radar: [
    {
      property: "min",
      label: "Minimum",
      kind: "number",
      section: "content",
      hint: "The value the center stands for; a lower reading draws at the center.",
    },
    {
      property: "max",
      label: "Maximum",
      kind: "number",
      section: "content",
      hint: "The value the outer edge stands for, shared by every spoke. Readings in different units must be normalized through the series.",
    },
    {
      property: "shape",
      label: "Shape",
      kind: "select",
      section: "content",
      hint: "Joins the spokes with straight edges or draws the frame as a circle.",
      options: RADAR_SHAPE,
    },
    {
      property: "splitNumber",
      label: "Split rings",
      kind: "number",
      section: "content",
      advanced: true,
      hint: "How many rings divide the scale from the center to the edge.",
      min: 1,
      max: 10,
    },
    {
      property: "lineWidth",
      label: "Line width",
      kind: "number",
      section: "content",
      hint: "How thick the polygon's outline is drawn, in pixels.",
      min: 0,
      bound: "drawnBox",
    },
    {
      property: "showMarkers",
      label: "Show markers",
      kind: "boolean",
      section: "content",
      hint: "Draws a dot at each reading on the polygon.",
    },
    {
      property: "markerSize",
      label: "Marker size",
      kind: "number",
      section: "content",
      advanced: true,
      hint: "How large each reading's dot is, in pixels.",
      min: 0,
      bound: "drawnBox",
    },
    {
      property: "showAxes",
      label: "Show axes",
      kind: "boolean",
      section: "content",
      hint: "Draws the spokes, the rings and the split area behind the polygon.",
    },
    ...ANIMATION_FIELDS,
  ],
  polarBar: [
    {
      property: "startAngle",
      label: "Start angle",
      kind: "number",
      section: "content",
      hint: "Where the first category begins, in degrees — 90 is twelve o'clock and bars run clockwise.",
      min: -360,
      max: 360,
    },
    {
      property: "innerRadiusPercent",
      label: "Inner radius %",
      kind: "number",
      section: "content",
      hint: "How far from the center the bars begin; anything above zero leaves a hole.",
      min: 0,
      max: 100,
    },
    {
      property: "outerRadiusPercent",
      label: "Outer radius %",
      kind: "number",
      section: "content",
      hint: "How far out a full bar reaches; 100 fills the available space.",
      min: 0,
      max: 100,
    },
    {
      property: "min",
      label: "Minimum",
      kind: "number",
      section: "content",
      hint: "The value the inner edge stands for; a lower reading draws as an empty bar.",
    },
    {
      property: "max",
      label: "Maximum",
      kind: "number",
      section: "content",
      hint: "The value a bar reaching the outer edge stands for; a higher reading draws full rather than rescaling.",
    },
    {
      property: "barWidth",
      label: "Bar width",
      kind: "number",
      section: "content",
      optional: true,
      hint: "How many degrees wide each bar is; empty lets the category gap size it.",
      min: 0,
      max: 360,
    },
    {
      property: "categoryGapPercent",
      label: "Category gap %",
      kind: "number",
      section: "content",
      advanced: true,
      hint: "How much of each angle slot is left as space between bars.",
      min: 0,
      max: 100,
    },
    {
      property: "cornerRadius",
      label: "Corner radius",
      kind: "number",
      section: "content",
      hint: "How much each bar's own corners are rounded, in pixels.",
      min: 0,
      bound: "halfDrawnBox",
    },
    {
      property: "trackCornerRadius",
      label: "Track corner radius",
      kind: "number",
      section: "content",
      optional: true,
      advanced: true,
      hint: "The unfilled track's own rounding, beside the bar's. Empty leaves it square.",
      min: 0,
      bound: "halfDrawnBox",
    },
    {
      property: "showAxes",
      label: "Show axes",
      kind: "boolean",
      section: "content",
      hint: "Draws the angle and radius axes with their gridlines, without labels.",
    },
    ...ANIMATION_FIELDS,
  ],
};

/** The editable scalar settings for one family. */
export function settingsFieldsFor(
  family: ChartFamily,
): readonly SettingsFieldDescriptor[] {
  return CHART_SETTINGS_FIELDS[family];
}

export const CHART_PAINT_FIELDS: Readonly<
  Record<ChartFamily, readonly ChartPaintFieldDescriptor[]>
> = {
  gauge: [
    {
      property: "track",
      label: "Track paint",
      section: "paint",
      hint: "The unfilled ring the reading is drawn over.",
    },
    {
      property: "progress",
      label: "Progress paint",
      section: "paint",
      hint: "The arc that fills to show the reading.",
    },
  ],
  line: [
    {
      property: "stroke",
      label: "Stroke paint",
      section: "paint",
      hint: "The line's own color, and the fallback for a series the palette does not cover.",
    },
    {
      property: "palette",
      label: "Series paint",
      section: "paint",
      hint: "One color per series, cycled when there are more series than entries.",
      multiple: true,
    },
    {
      property: "area",
      label: "Area paint",
      section: "paint",
      hint: "The fill between the line and the axis; drawn for the first series only.",
    },
  ],
  bar: [
    {
      property: "fill",
      label: "Fill paint",
      section: "paint",
      hint: "The ink each bar is drawn in.",
    },
    {
      property: "track",
      label: "Track paint",
      section: "paint",
      hint: "The unfilled slot behind each bar; giving one turns the bars into progress bars.",
    },
  ],
  pie: [
    {
      property: "remainderFill",
      label: "Remainder paint",
      section: "paint",
      hint: "The slice standing for the part of a fixed total no sensor accounts for.",
    },
    {
      property: "palette",
      label: "Slice paint",
      section: "paint",
      hint: "One color per slice, cycled when there are more slices than entries.",
      multiple: true,
    },
  ],
  radar: [
    {
      property: "stroke",
      label: "Outline paint",
      section: "paint",
      hint: "The polygon's outline. One polygon cannot carry a color per spoke, so a threshold takes its top band.",
    },
    {
      property: "area",
      label: "Fill paint",
      section: "paint",
      hint: "The area inside the polygon; empty draws the outline alone.",
    },
  ],
  polarBar: [
    {
      property: "fill",
      label: "Fill paint",
      section: "paint",
      hint: "The ink each bar is drawn in.",
    },
    {
      property: "track",
      label: "Track paint",
      section: "paint",
      hint: "The unfilled track behind each bar; giving one turns the bars into progress bars.",
    },
  ],
};

export function chartPaintFieldsFor(
  family: ChartFamily,
): readonly ChartPaintFieldDescriptor[] {
  return CHART_PAINT_FIELDS[family];
}

/**
 * The settings key a family's settings live under, e.g. `gaugeSettings`.
 *
 * Derived rather than listed, because `validate.ts` already derives the same
 * string the same way (`` `${family}Settings` ``) — two spellings of one
 * convention is how a rename breaks half a feature.
 */
export function settingsKeyFor(family: ChartFamily): string {
  return `${family}Settings`;
}
