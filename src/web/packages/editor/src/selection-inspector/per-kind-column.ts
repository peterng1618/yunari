import type {
  Binding,
  FabricGlobals,
  SampleSource,
  SettingsSection,
} from "@yunari/renderer-core";
import { SETTINGS_SECTIONS } from "@yunari/renderer-core";
import { isLocked, YunariChart } from "@yunari/scene-fabric";
import {
  ActiveSelection,
  FabricImage,
  type FabricObject,
  Group,
} from "fabric/es";
import type {
  ChartContentFieldsView,
  ChartPaintFieldsView,
} from "../chart-manager/chart-fields.js";
import type { EditorInteraction } from "../editor-interaction.js";
import { uiCopy } from "../ui-copy.js";
import {
  type AppearanceContext,
  nameField,
  opacityField,
  resolveToken,
  typePresetOf,
} from "./appearance.js";
import { cropView } from "./crop.js";
import { glassFields } from "./glass.js";
import { createShapeGeometryFields, panelMaterialFields } from "./panel.js";
import { projectRuns } from "./runs.js";
import {
  type ColumnSectionView,
  type ExtraView,
  type FieldView,
  isTextObject,
  type PairHalfView,
} from "./view.js";

/**
 * The column the inspector renders, as **data**: one entry per section, in the
 * order the questions are asked. A test enumerates this rather than reading the
 * DOM, and the column renders exactly the sections it returns.
 *
 * The four questions are §7.4's — Content is what it shows, Position is where it
 * sits and how big, Layer is how it presents, Paint is what ink — and they come
 * in `SETTINGS_SECTIONS` order, the one place that order is decided. `advanced`
 * is not a fifth question: it is the collapsed-and-counted treatment, and it
 * goes last when it exists.
 *
 * **No section starts closed.** Position was the one that did, on the reasoning
 * that geometry is set once and the binding is chosen constantly. §8 allows
 * putting a section away when it is adjusted rarely, and a new object's position
 * is the thing the author selected it to write — so the asymmetry cost more than
 * it saved and `defaultOpenOf` answers the same for every question. A reader may
 * still close a section; the column only stops deciding that for them.
 */

/**
 * The section vocabulary. `advanced` is **latent and stays**: a caller may mount
 * a collapsed-and-counted treatment under it, but `perKindColumn` never emits
 * one — the chart family's own advanced field is mounted by `chart-manager`, not
 * here. Deleting the member to tidy it would be a behaviour change dressed as
 * tidying.
 */
export type ColumnSectionId = SettingsSection | "advanced";

/** What one section holds, as values: its rows. */
interface SectionParts {
  readonly fields?: readonly FieldView[];
  readonly extras?: readonly ExtraView[];
}

/**
 * Whether the column renders this extra today.
 *
 * All five are wired: `runs`, `chartContent` and `chartPaint` when their
 * sections moved to React, `crop` with Position, and `fontFace` with the face
 * field the ruling gave `FontPicker`. The section's count and
 * the column's rows are the same decision made once, so emitting an extra whose
 * renderer has not landed cannot make a header claim a row that is not there.
 * Wiring one is a change to this predicate and to the column's row together,
 * which is the point.
 */
export function rendersExtra(extra: ExtraView): boolean {
  return (
    extra.kind === "runs" ||
    extra.kind === "crop" ||
    extra.kind === "chartContent" ||
    extra.kind === "chartPaint" ||
    extra.kind === "fontFace"
  );
}

/**
 * The kinds of thing the editor can have selected. This is the partition the
 * column's questions fall on, not the roster of Fabric class names.
 *
 * Deliberately not `layer-tree`'s `LayerKind`, which answers a different
 * question — which label and icon a tree row carries — and always describes one
 * object. A selection is not always one object: `activeSelection` is a kind of
 * its own here, and folding it into `group` would make the column describe a
 * multi-selection as though the author had selected a single thing.
 *
 * **`background` is the union's one member absent from this list.** It is a
 * selected subject and `KIND_WORD` is a record over the union, so it cannot go
 * unworded — but it is no Fabric object: `selectionKindOf` never answers for it
 * and `backgroundColumn` describes it, so no per-kind example can be built for
 * it. `KIND_WORD`'s totality is the compile-time half; the per-kind suites
 * enumerate this list, which is the runnable half.
 */
export const SELECTION_KINDS = [
  "shape",
  "text",
  "chart",
  "image",
  "group",
  "activeSelection",
] as const;

export type SelectionKind = (typeof SELECTION_KINDS)[number] | "background";

/** Fabric lowercases `type` on the instance, so these are its own spellings. */
function isTextKind(object: FabricObject): boolean {
  const type = (object as { readonly type?: string }).type;
  return type === "textbox" || type === "i-text" || type === "text";
}

/**
 * Which kind a selection is.
 *
 * Ordered so the two containers are named before the class they extend: Fabric's
 * `ActiveSelection` **is** a `Group`, so a group tested first would answer for a
 * selection the author made across several objects. It never answers
 * `"background"`: the background is no Fabric object, and its column is
 * `backgroundColumn`'s.
 */
export function selectionKindOf(
  target: FabricObject,
): Exclude<SelectionKind, "background"> {
  if (target instanceof ActiveSelection) return "activeSelection";
  if (target instanceof YunariChart) return "chart";
  if (target instanceof Group) return "group";
  if (isTextKind(target)) return "text";
  if (target instanceof FabricImage) return "image";
  return "shape";
}

/** The five geometry fields, in whole artboard units. */
export type GeometryKey = "left" | "top" | "width" | "height" | "angle";

/**
 * How the column reads and writes an object's geometry. `index.ts` owns the
 * funnel — the write that scales a shape, writes a text box, or sets an angle —
 * and this is the port it hands over, so the column composes fields without a
 * second copy of the write rules.
 */
export interface GeometryPort {
  read(object: FabricObject, key: GeometryKey): number;
  write(object: FabricObject, key: GeometryKey, value: number): void;
}

/**
 * What a chart's column asks its owner for.
 *
 * Declared here for the reason `GeometryPort` is: the column names the
 * questions and its owner answers them, so nothing in this module knows how a
 * chart's settings, bindings or ratio are written — or how they are rendered.
 * `chart-manager` is that owner; the views below cross as values and the
 * controls that render them live with the owner too.
 *
 * Two bodies, because a chart answers Content (what it shows) and Paint (what
 * ink) with different questions. `undefined` is an owner that has nothing to
 * say for that question — a chart it cannot resolve — and is not an empty body:
 * the extra is what the section's count counts, so an absent answer emits none.
 */
export interface ChartFieldsPort {
  content(chart: YunariChart): ChartContentFieldsView | undefined;
  paint(chart: YunariChart): ChartPaintFieldsView | undefined;
}

export interface ColumnContext {
  readonly editor: EditorInteraction;
  readonly globals: FabricGlobals | undefined;
  /** The document's language, so a run's format preview is spelled in it. */
  readonly locale: string | undefined;
  readonly geometry: GeometryPort;
  /** False once the column describes a different object; the edit is refused. */
  readonly stillTarget: (object: FabricObject) => boolean;
  /** Repaints and records: one history entry per committed edit. */
  readonly commit: () => void;
  /** Re-reads the object, so the fields show what was just written. */
  readonly rerender: () => void;
  readonly refreshGlass: () => void;
  readonly nodeBindings: ((nodeId: string) => readonly Binding[]) | undefined;
  readonly onNodeBindingsChange:
    | ((nodeId: string, bindings: readonly Binding[]) => void)
    | undefined;
  readonly sampleSource: (() => SampleSource) | undefined;
  /**
   * The chart owner's own fields, for a chart selection. Absent when no owner
   * is mounted: a column built without one still answers every other kind, and
   * a chart is not a kind this column invents questions for.
   */
  readonly chartFields?: ChartFieldsPort;
  /**
   * Whether an owner that can write a font face is mounted.
   *
   * A capability, not the port: the field's writes are the Tokens pane's own
   * actions, and the column is handed them beside its other ports rather than
   * through this context. Absent means the field is not offered at all — a face
   * browser whose every press did nothing would be worse than no browser, and
   * the gate is what stops one being projected from a column with no owner
   * behind it.
   */
  readonly canWriteFontFace?: boolean;
}

/** Every section is open when the column answers with it. `advanced`, when a
    caller mounts it, is the collapsed-and-counted treatment and starts closed —
    the one disclosure the author is not given a choice about, because the section
    exists to be put away. */
function defaultOpenOf(id: ColumnSectionId): boolean {
  return id !== "advanced";
}

function sectionOrder(id: ColumnSectionId): number {
  if (id === "advanced") return SETTINGS_SECTIONS.length;
  const index = SETTINGS_SECTIONS.findIndex((entry) => entry.id === id);
  return index === -1 ? SETTINGS_SECTIONS.length : index;
}

function titleOf(id: ColumnSectionId): string {
  if (id === "advanced") return uiCopy.inspectorFields.advanced;
  return SETTINGS_SECTIONS.find((entry) => entry.id === id)?.label ?? id;
}

/** One section as the column renders it. Exported because `backgroundColumn`
 *  answers the same two questions for a subject that is no Fabric object, and a
 *  second copy of the title and the count would be a second owner. Order is the
 *  caller's: each column states its own, `perKindColumn` through `sectionOrder`. */
export function sectionView(
  id: ColumnSectionId,
  fields: readonly FieldView[] = [],
  extras: readonly ExtraView[] = [],
): ColumnSectionView {
  return {
    id,
    title: titleOf(id),
    defaultOpen: defaultOpenOf(id),
    count: fields.length + extras.filter(rendersExtra).length,
    fields,
    extras,
  };
}

/** The appearance context the field builders take. */
function appearanceOf(context: ColumnContext): AppearanceContext {
  return { editor: context.editor, globals: context.globals };
}

/** The labels the geometry fields carry. The Size pair marks its boxes W and H
    because the full words wrap the second input onto its own line. */
const GEOMETRY_LABELS: Readonly<Record<GeometryKey, string>> = {
  left: uiCopy.inspectorFields.x,
  top: uiCopy.inspectorFields.y,
  width: uiCopy.inspectorFields.width,
  height: uiCopy.inspectorFields.height,
  angle: uiCopy.inspectorFields.rotation,
};

/** The fewest whole units a dimension can be: zero would make the object
    vanish from the canvas and from its own selection box. The write funnel
    applies it — the pre-plan `numberField` landed an out-of-range value on the
    bound it crossed rather than refusing it, and that is the rule kept. */
export const MIN_DIMENSION = 1;

/**
 * One geometry pair, as a value: `X`/`Y` and `W`/`H` each share a row, and each
 * half commits only its own key.
 *
 * Every half is a whole number. The pre-plan `numberField` refused a typed
 * fraction on **every** one of these fields, so `integer` is declared here and
 * re-checked at the write boundary — a control is a convenience, the boundary is
 * what must hold.
 */
function geometryPair(
  context: ColumnContext,
  object: FabricObject,
  rowLabel: string,
  first: GeometryKey,
  second: GeometryKey,
): FieldView {
  const half = (key: GeometryKey): PairHalfView => ({
    id: key,
    label: GEOMETRY_LABELS[key],
    value: Math.round(context.geometry.read(object, key)),
    integer: true,
    data: { "data-yunari-geometry": key },
  });
  return {
    id: `${first}-${second}`,
    control: "pair",
    label: rowLabel,
    halves: [half(first), half(second)],
    data: {},
  };
}

/**
 * The bounds on a rotation, in degrees. A rotation is modular, so one turn each
 * way covers every angle an object can be at — and the signed range rather than
 * 0–360, because a rotated-left object reads back negative and a floor of zero
 * would show a value the field then refused to accept, the same argument
 * `panel.ts` makes for the shadow's offset.
 */
const MIN_ANGLE_DEGREES = -360;
const MAX_ANGLE_DEGREES = 360;

/** Rotation, the one angle a Layer column asks for. It is whole units, and it
    writes through the same geometry port the Position pair does. */
function rotationField(
  context: ColumnContext,
  object: FabricObject,
): FieldView {
  return {
    id: "angle",
    control: "slider",
    label: GEOMETRY_LABELS.angle,
    value: Math.round(context.geometry.read(object, "angle")),
    min: MIN_ANGLE_DEGREES,
    max: MAX_ANGLE_DEGREES,
    // The control refuses a fraction inline; `editRefusal` refuses it again at
    // the write boundary, which is the copy that must hold.
    integer: true,
    data: { "data-yunari-geometry": "angle" },
  };
}

/** What it shows: the name, and a text object's runs, its face and its layout. */
function contentBody(
  target: FabricObject,
  context: ColumnContext,
  locked: boolean,
): SectionParts {
  const fields: FieldView[] = [];
  const extras: ExtraView[] = [];

  // The name is a field that writes, so a locked object is not offered one.
  if (!locked) fields.push(nameField(target));

  // The run editor is the one sub-surface the row union cannot express, so it
  // crosses as an extra carrying its projected value. `projectRuns` returns
  // undefined for an object with no authored text: an empty box is not a
  // control, and counting one would make the section's own count lie.
  const id = target.get("id");
  const nodeId = typeof id === "string" && id.length > 0 ? id : "";
  const runs = projectRuns(
    target as unknown as {
      get(name: string): unknown;
      set(name: string, value: unknown): void;
    },
    nodeId,
    {
      globals: context.globals,
      locale: context.locale,
      nodeBindings: context.nodeBindings,
      sampleSource: context.sampleSource,
      swatchValue: (ref) => resolveToken(context.globals, ref),
    },
  );
  if (runs !== undefined) extras.push({ kind: "runs", nodeId, runs });

  // The face field: the object's own face, which is its first run's preset.
  // Offered only when that preset resolves, because the field writes *to the
  // preset* and a text object whose runs name none has no face to change — the
  // same rule the run editor follows for a box with no authored text, and the
  // reason an empty box is not given a browser over a value it does not have.
  const presetRef = isTextObject(target) ? typePresetOf(target) : undefined;
  if (presetRef !== undefined && context.canWriteFontFace === true) {
    extras.push({
      kind: "fontFace",
      font: { presetId: presetRef.slice("typePresets.".length) },
    });
  }

  // A chart's own questions: the readings it draws and how its family is set.
  // The owner answers them through the port; asking here is what puts them in
  // the column they answer rather than behind a second tab. Withheld on a
  // locked chart like every other writing field.
  if (
    !locked &&
    target instanceof YunariChart &&
    context.chartFields !== undefined
  ) {
    const chart = context.chartFields.content(target);
    if (chart !== undefined)
      extras.push({ kind: "chartContent", content: chart });
  }

  return { fields, extras };
}

/** Where it sits and how big: the two pairs, crop, and this shape's own
    geometry. Every row is a value; the writes reach the object through the one
    funnel in `index.ts`, so the rules that scale a shape, write a text box or
    adopt new geometry stay in one place. */
function positionBody(
  target: FabricObject,
  context: ColumnContext,
  locked: boolean,
): SectionParts {
  if (locked) return { fields: [] };

  const fields: FieldView[] = [
    geometryPair(
      context,
      target,
      uiCopy.inspectorFields.position,
      "left",
      "top",
    ),
    geometryPair(
      context,
      target,
      uiCopy.inspectorFields.size,
      "width",
      "height",
    ),
  ];

  fields.push(...createShapeGeometryFields(target));

  // Crop sits with the geometry it changes, and only for a selection that can
  // hold one — an image, which is the only kind `canCrop` admits. A session
  // that is open replaces the row with its own controls.
  const extras: ExtraView[] = [];
  const crop = cropView(context.editor, target);
  if (crop !== undefined) extras.push({ kind: "crop", crop });

  return { fields, extras };
}

/** One paint-time mirror. Fabric owns the property, so the row reads and the
    writer writes the same name; a group member flips alone. */
function flipField(image: FabricImage, axis: "flipX" | "flipY"): FieldView {
  return axis === "flipX"
    ? {
        id: "flipX",
        control: "toggle",
        label: uiCopy.inspectorFields.flipX,
        checked: image.flipX,
        data: { "data-yunari-flip-x": "" },
      }
    : {
        id: "flipY",
        control: "toggle",
        label: uiCopy.inspectorFields.flipY,
        checked: image.flipY,
        data: { "data-yunari-flip-y": "" },
      };
}

/** How it presents: rotation, opacity, and — for a picture — its two mirrors. */
function layerBody(
  target: FabricObject,
  context: ColumnContext,
  locked: boolean,
): SectionParts {
  if (locked) return { fields: [] };
  const fields: FieldView[] = [
    rotationField(context, target),
    opacityField(target),
  ];
  // A raster image and an SVG icon are both a `FabricImage`, so one gate covers
  // the whole image kind; text, shape, chart and group have nothing to mirror.
  if (target instanceof FabricImage) {
    fields.push(flipField(target, "flipX"), flipField(target, "flipY"));
  }
  return { fields };
}

/** What ink: the panel's material, the frosted-glass treatment, and a chart's
    own paint. Every row is a value now; the writes reach the object through the
    one funnel in `index.ts`, so the rules that resolve a reference, create a
    default shadow or move a live one stay with the fields that describe them. */
function paintBody(
  target: FabricObject,
  context: ColumnContext,
  locked: boolean,
): SectionParts {
  if (locked) return { fields: [] };
  const fields: FieldView[] = [];
  const extras: ExtraView[] = [];

  // Material applies only to the kinds `supportsPanelFields` admits; the gate is
  // asked, never restated, and answers with no fields for a chart, an image, a
  // text object or a group.
  fields.push(...(panelMaterialFields(appearanceOf(context), target) ?? []));

  // For a subject the treatment reaches, and nothing for one it does not: the
  // reason such a subject is offered no glass section is carried by the block
  // that leads the column (`selection-lead.tsx`, through `index.ts`), so a kind
  // that cannot be frosted gets no Paint section standing over one refusal
  // (vg-465).
  fields.push(...glassFields(target));

  // What a chart paints its data with, from the owner that writes it. A chart's
  // paint is its own question, asked of the same owner that answered Content.
  if (target instanceof YunariChart && context.chartFields !== undefined) {
    const chart = context.chartFields.paint(target);
    if (chart !== undefined) extras.push({ kind: "chartPaint", paint: chart });
  }

  return { fields, extras };
}

/**
 * The sections this selection gets, in the order the questions are asked.
 *
 * A section with nothing in it is not returned at all: the question does not
 * apply to this kind, so there is no header and no count of zero. React renders
 * exactly the sections it is handed, in the order it is handed them, so the
 * empty-section rule and the order both stay here rather than becoming a second
 * owner in the column.
 */
export function perKindColumn(
  target: FabricObject,
  context: ColumnContext,
): readonly ColumnSectionView[] {
  const locked = isLocked(target);

  // Built in question order already; sorted anyway so the order is a statement
  // this module makes rather than one it inherits from the lines above.
  const bodies: readonly (readonly [ColumnSectionId, SectionParts])[] = [
    ["content", contentBody(target, context, locked)],
    ["position", positionBody(target, context, locked)],
    ["layer", layerBody(target, context, locked)],
    ["paint", paintBody(target, context, locked)],
  ];

  const sizeOf = (parts: SectionParts): number =>
    (parts.fields?.length ?? 0) +
    (parts.extras?.filter(rendersExtra).length ?? 0);

  return bodies
    .filter(([, parts]) => sizeOf(parts) > 0)
    .sort(([left], [right]) => sectionOrder(left) - sectionOrder(right))
    .map(([id, parts]) =>
      sectionView(id, parts.fields ?? [], parts.extras ?? []),
    );
}
