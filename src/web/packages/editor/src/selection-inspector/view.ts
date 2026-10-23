import { isObjectName } from "@yunari/renderer-core";
import { isLocked } from "@yunari/scene-fabric";
import type { FabricObject } from "fabric/es";
import type {
  ChartContentFieldsView,
  ChartPaintFieldsView,
} from "../chart-manager/chart-fields.js";
import { rowNameOf } from "../editor-shell/layer-tree.js";
import type { CuratedFontFace } from "../font-catalog.js";
import { uiCopy } from "../ui-copy.js";
import {
  type ColumnContext,
  type ColumnSectionId,
  type GeometryKey,
  type GeometryPort,
  type SelectionKind,
  selectionKindOf,
} from "./per-kind-column.js";

/**
 * The column as a value.
 *
 * Every leaf is a primitive, an array or a plain object, so a test can round-trip
 * it through JSON and a renderer can diff it. A Fabric object here would be the
 * one thing [ADR-0039] forbids — React holds this view and never the object it
 * describes, and the imperative edit port below is the only way back.
 */

export interface SelectionView {
  readonly targetRevision: number;
  readonly subject: SubjectView | undefined;
  readonly locked: boolean;
  readonly sections: readonly ColumnSectionView[];
}

/**
 * The block that heads the column: what the selection is called, the kind whose
 * glyph heads it, and the key a binding on it reads.
 *
 * **The kind is a kind, not a word** (vg-466): the header draws `KIND_GLYPHS`'
 * mark for it, so `selectionKindOf`'s own union is what crosses the boundary and
 * `activeSelection` — which is not a `LayerKind` and has no glyph — is the one
 * member the header draws nothing for. Its name already says "Selection".
 */
export interface SubjectView {
  readonly name: string;
  readonly kind: SelectionKind;
  /**
   * The binding key this node reads, where one is bound. It is the fact that
   * tells two otherwise identical subjects apart, and it is *not* the kind word
   * the glyph replaced: a key is the object's own, the kind is its type.
   */
  readonly key: string | undefined;
}

export interface ColumnSectionView {
  readonly id: ColumnSectionId;
  readonly title: string;
  readonly defaultOpen: boolean;
  /**
   * How many rows the section holds: its fields and its extras. An extra counts
   * once however many controls it carries — it is one row in this count's
   * vocabulary, the same way a run editor is — and it counts only while
   * `rendersExtra` says the column renders it, so the header can never claim a
   * row that is not there.
   *
   * It lives in the value because the header prints it: collapsing a section is
   * ordering, not removal, so a closed section still says how much it holds.
   */
  readonly count: number;
  /** Flat, one control each. */
  readonly fields: readonly FieldView[];
  /** The sub-surfaces that are not one control. */
  readonly extras: readonly ExtraView[];
}

/**
 * The `data-*` hooks a row's own focus target carries.
 *
 * The hook is not the field identity: `data-yunari-geometry` names five values,
 * so a suite reads `[data-yunari-geometry="width"]` and then reads `.value` off
 * the element the hook is on. Fields carry the attribute names, and the renderer
 * spreads them onto the control itself, never a wrapper — a hook on a wrapper is
 * a broken locator wearing a passing test.
 */
export type FieldHooks = Readonly<Record<`data-${string}`, string>>;

interface FieldBase {
  readonly id: string;
  readonly label: string;
  readonly data: FieldHooks;
  readonly refused?: string;
}

/** One entry in a list control: the stored value, and the name it shows. */
export interface FieldOption {
  readonly id: string;
  readonly name: string;
}

/**
 * One half of a paired row: two numbers sharing a line, each committing its
 * own. A pair is not one control — each half has its own id, its own hook and
 * its own commit — but they share a row and a set of bounds, which is what the
 * geometry lines (`X`/`Y`, `W`/`H`, a line's two ends) are.
 */
export interface PairHalfView {
  /** The field id the half commits through, not the DOM hook. */
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly data: FieldHooks;
  readonly integer?: boolean;
  /** The stored value is a fraction the field shows as a percentage; the commit
      converts back, so the write boundary still receives the fraction. */
  readonly percent?: boolean;
}

export type FieldView =
  | (FieldBase & {
      readonly control: "text";
      readonly value: string;
      /** A multi-line field: a polyline's points and a path's data are
          documents, not one-line answers. */
      readonly multiline?: boolean;
      readonly rows?: number;
    })
  | (FieldBase & {
      readonly control: "number";
      readonly value: number;
      readonly unit?: string;
      readonly min?: number;
      readonly max?: number;
      /**
       * The field's owner says the value is a whole one. Rotation's legacy
       * `numberField` refused a fraction, and the control set has no other way
       * to say so — a per-field check would be dropped again by each section
       * that converts its own geometry fields.
       */
      readonly integer?: boolean;
      /**
       * The stored value is a fraction the field shows as a percentage — the
       * background's offsets. The control multiplies on the way in and
       * divides on the way out, so the write boundary still receives a fraction.
       */
      readonly percent?: boolean;
    })
  | (FieldBase & {
      readonly control: "pair";
      readonly halves: readonly PairHalfView[];
    })
  | (FieldBase & { readonly control: "toggle"; readonly checked: boolean })
  | (FieldBase & {
      readonly control: "select";
      readonly value: string;
      readonly options: readonly FieldOption[];
    })
  | (FieldBase & {
      readonly control: "slider";
      readonly value: number;
      readonly min: number;
      readonly max: number;
      /**
       * The owner says the value is whole. A slider steps by 1, so this is not
       * the step — it is the same declaration the number arm carries, kept here
       * because sides, a sweep and the glass blur refused a fraction as numbers
       * and still must as sliders. The boundary (`WRITABLE_FIELD_IDS`) is the
       * copy that enforces it.
       */
      readonly integer?: boolean;
    })
  | (FieldBase & {
      readonly control: "segmented";
      readonly value: string;
      readonly options: readonly FieldOption[];
    })
  /**
   * A paint reference, as DESIGN.md §5's *swatch well*: the list is still the only
   * way to change the value and the swatch is a picture of it, resolved by the
   * caller so nothing here is a second resolver. `colour` is that picture — the
   * selected token's colour, or `transparent` when the value is empty or no
   * longer resolves.
   */
  | (FieldBase & {
      readonly control: "swatch";
      readonly value: string;
      readonly options: readonly FieldOption[];
      readonly colour: string;
    });

/** One entry in a run editor's dropdowns: the stored reference, and its name. */
export interface RunOptionView {
  readonly id: string;
  readonly name: string;
}

/**
 * One run of a text object, as the run editor renders it.
 *
 * The run editor is the one sub-surface the row union cannot express, so it
 * crosses the boundary as this value plus the imperative `RunEdits` port below
 * — never as the Fabric object, whose `runs` are what it reads.
 */
export interface RunRowView {
  /**
   * What the row *is*, for React's key.
   *
   * A run carries no id in the persisted model, and the ruling keeps it that
   * way, so the identity is the run's own object — minted by `run-identity.ts`
   * and carried across the writes that replace one. It is deliberately not a
   * spelling of the run's fields: two literal runs sharing a type preset are the
   * same fields, and a removal then hands the survivor the removed row's draft.
   * Keying by `index` has the same failure on every removal; keying by the text
   * remounts the row under the caret, because `ControlText` commits on Enter.
   */
  readonly id: string;
  readonly index: number;
  readonly kind: "literal" | "value";
  /** What the row is called: a reading's key, or the prose it says. */
  readonly label: string;
  readonly text: string;
  readonly typePreset: string;
  readonly colour: string;
  /**
   * The binding this run names, for the note's `data-yunari-run-binding` — the
   * key `run.bindingId` carried before the column was React, and what a spec
   * reads to learn *which* binding a value run failed to resolve. `""` for
   * prose, which names no binding. It is not the row's ordinal: that is
   * `index`, and it rides the row's own `data-yunari-run` hook.
   */
  readonly bindingId: string;
  /** The semantic key a value run reads, or `""` for prose. */
  readonly sourceKey: string;
  readonly unitDisplay: string;
  /** The note under a value run, and the problem it carries when one is. */
  readonly bindingNote?: string;
  readonly bindingProblem?: "undeclared" | "unmapped";
  /** Present on a value run whose binding is declared and pinned to an instant. */
  readonly format?: string;
  readonly formatDefault?: string;
  readonly zone?: string;
}

/** Everything the run editor renders, projected from the object it describes. */
export interface RunsView {
  readonly nodeId: string;
  readonly runs: readonly RunRowView[];
  readonly layout: {
    readonly align: string;
    readonly verticalAlign: string;
    readonly wrap: string;
    readonly overflow: string;
  };
  readonly presets: readonly RunOptionView[];
  readonly palettes: readonly RunOptionView[];
  /**
   * What each palette reference the editor offers currently resolves to, so a
   * swatch is a picture of the value rather than a second resolver. Keyed by
   * reference; a reference that no longer resolves is absent.
   */
  readonly swatchValues: Readonly<Record<string, string>>;
  readonly unitOptions: readonly RunOptionView[];
  /** What a value run may read; the prose option is the row's own first entry. */
  readonly sources: readonly RunOptionView[];
  readonly zones: readonly string[];
  /** True when the node declares bindings at all — it has an id to hang them on. */
  readonly bindable: boolean;
  /** A last run is not removable: a text object with no runs paints nothing. */
  readonly removable: boolean;
  readonly locale: string | undefined;
  readonly notes: readonly string[];
}

/**
 * The crop row, as a value: whether a session is open, and whether this
 * selection can start one. The ratios it offers are `crop.ts`'s own list, read
 * by the component rather than copied into every published view.
 */
export interface CropView {
  /** A session is open, so the row shows its own controls and ignores the selection. */
  readonly active: boolean;
  /** This selection can hold a crop, so the row offers to start one. */
  readonly canStart: boolean;
}

/** The crop row's one way to write, beside `SelectionEdits`. */
export interface CropEdits {
  readonly begin: () => boolean;
  readonly setAspect: (ratio: number) => void;
  readonly apply: () => void;
  readonly cancel: () => void;
}

/**
 * The face field: the type preset whose face the field changes.
 *
 * A text object's face is not the object's own — a run names a preset and the
 * preset carries the face — so the field writes to the preset the object is set
 * in (`typePresetOf`, the one owner of that reading) rather than to the object.
 * That is also why the field carries the preset and nothing else: the catalogue,
 * the author's favourites and the specimen cache are the control's own, and
 * `favorites` in particular is asynchronous, which a projected value cannot be.
 */
export interface FontFaceView {
  /** The preset id, without the `typePresets.` prefix the writer takes off. */
  readonly presetId: string;
}

/**
 * The face field's one way to write, and its two reads of the author's own
 * favourites.
 *
 * The face and trio writes are the Tokens pane's own actions — a face is bound
 * to a preset, and a trio rewrites every preset that names a role — so they are
 * performed by that owner and asked for here rather than re-implemented. The
 * favourites live on the host rather than in the document, so they are read and
 * written rather than held.
 */
export interface FontFaceEdits {
  readonly applyFace: (
    presetId: string,
    face: CuratedFontFace,
  ) => Promise<void>;
  readonly applyTrio: (trioId: string) => Promise<void>;
  readonly listFavorites: () => Promise<readonly string[]>;
  readonly saveFavorites: (
    ids: readonly string[],
  ) => Promise<readonly string[]>;
}

/**
 * The five sub-surfaces that are not one control. Each names one React
 * component in this family; no other kind is added without amending this.
 */
export type ExtraView =
  | { readonly kind: "runs"; readonly nodeId: string; readonly runs: RunsView }
  | { readonly kind: "crop"; readonly crop: CropView }
  | {
      readonly kind: "chartContent";
      readonly content: ChartContentFieldsView;
    }
  | { readonly kind: "chartPaint"; readonly paint: ChartPaintFieldsView }
  | { readonly kind: "fontFace"; readonly font: FontFaceView };

/**
 * The run editor's one way to write, beside `SelectionEdits`.
 *
 * A run is an authored value — a whole `TextRun`, or the layout map it shares
 * with its siblings — and React holds only the projected `RunsView`, never the
 * run it describes. So the port is expressed as intent keyed by run index, and
 * `index.ts` resolves it against the live object it owns: it reads the run, keeps
 * the fields the edit does not name, and records one history entry.
 */
export interface RunEdits {
  readonly setRunText: (index: number, text: string) => boolean;
  readonly setRunPreset: (index: number, ref: string) => boolean;
  readonly setRunColour: (index: number, ref: string) => boolean;
  readonly setUnitDisplay: (index: number, value: string) => boolean;
  readonly setSource: (index: number, semanticKey: string) => boolean;
  readonly setFormat: (index: number, format: string) => boolean;
  readonly setZone: (index: number, zone: string) => boolean;
  readonly writeLayout: (patch: TextLayoutPatch) => boolean;
  readonly addRun: () => boolean;
  readonly removeRun: (index: number) => boolean;
}

/** The text layout keys the run editor writes, whichever are present. */
interface TextLayoutPatch {
  readonly align?: string;
  readonly verticalAlign?: string;
  readonly wrap?: boolean;
  readonly overflow?: string;
}

/**
 * The read-only context the projection needs: the same shapes the column already
 * takes, not an injected copy of every pure predicate. `geometry` is the read
 * half of the port `index.ts` owns, so a value is never re-derived here.
 */
export type ProjectionPorts = Pick<
  ColumnContext,
  "globals" | "locale" | "nodeBindings" | "sampleSource"
> & {
  readonly geometry: Pick<GeometryPort, "read">;
};

/**
 * The column's one way to write.
 *
 * `index.ts` owns the dispatcher and the write funnel behind it. An edit carries
 * the target revision the view was projected from; the dispatcher compares it
 * with the live target before it writes, so a control whose draft outlived its
 * selection is refused rather than writing an old value into a new object.
 *
 * **Three routes, one funnel, and only one of them records.** A gesture in
 * flight previews through `preview` — the same write as `commit`, with no
 * history entry and no re-publish — so the canvas shows what the author is
 * choosing while the column's own value stays the last committed one. `commit`
 * is the release: one changed value, one entry (§5's one undo boundary).
 * `cancelPreview` puts the value the gesture started from back, through the same
 * writer, and records nothing, because nothing was recorded to undo.
 */
export interface SelectionEdits {
  readonly commit: (
    expectedRevision: number,
    fieldId: string,
    value: string | number | boolean,
  ) => boolean;
  readonly preview: (
    expectedRevision: number,
    fieldId: string,
    value: string | number | boolean,
  ) => boolean;
  readonly cancelPreview: (
    expectedRevision: number,
    fieldId: string,
    value: string | number | boolean,
  ) => void;
}

/**
 * The field ids the dispatcher can write, and what a value of each must be.
 *
 * The geometry keys were the first five; a Text column's name and a Layer
 * column's opacity joined them when their sections moved to React. Membership is
 * the eligibility rule: a field id absent here reaches no writer, so a control
 * that renders a hook the dispatcher does not know is refused rather than
 * silently accepted.
 *
 * The kind is the boundary's own copy of the rule its control carries, and for
 * `angle` the two are `"integer"` here and `integer: true` on its `FieldView`.
 * The control is a convenience; this table is what must hold, so a fraction
 * that a wrongly-built control let through is still refused here.
 */
type WritableKind =
  | "number"
  | "integer"
  | "name"
  | "boolean"
  | "text"
  | "reference";
const WRITABLE_FIELD_IDS: ReadonlyMap<string, WritableKind> = new Map([
  ["left", "integer"],
  ["top", "integer"],
  ["width", "integer"],
  ["height", "integer"],
  ["angle", "integer"],
  ["opacity", "number"],
  ["name", "name"],
  // A shape's own geometry. The pre-plan surface refused a typed fraction on
  // every one of these (`numberField`'s unconditional `Number.isInteger`), so
  // the boundary copies that rule rather than trusting the control to have kept
  // it.
  ["shape-sides", "integer"],
  ["shape-line-x1", "integer"],
  ["shape-line-y1", "integer"],
  ["shape-line-x2", "integer"],
  ["shape-line-y2", "integer"],
  ["shape-angle-startAngle", "integer"],
  ["shape-angle-endAngle", "integer"],
  ["shape-points", "text"],
  ["shape-path", "text"],
  // Paint. The four whole-number fields are `"integer"` for the same reason the
  // geometry ids are: the pre-plan `numberField` refused a typed fraction on
  // every one of them, and `ControlNumber`'s `integer` flag is a convenience the
  // boundary must not depend on. A token field carries a `palette.` reference or
  // `""` for none — the boundary checks the shape, not the token.
  ["panel-fill", "reference"],
  ["panel-stroke", "reference"],
  ["panel-shadow", "reference"],
  ["panel-border", "integer"],
  ["panel-radius", "integer"],
  ["panel-shadow-blur", "integer"],
  ["panel-shadow-offset", "integer"],
  ["glass-enabled", "boolean"],
  ["glass-blur", "integer"],
  // A picture's paint-time mirrors. Fabric owns the property; the boundary only
  // holds its type, so a switch cannot smuggle a number into it.
  ["flipX", "boolean"],
  ["flipY", "boolean"],
]);

/** Why an edit was refused; `undefined` means it may reach the write funnel. */
type EditRefusal = "stale" | "locked" | "unknown" | "invalid";

/**
 * The guard in front of the write funnel, as a pure decision so it can be
 * driven without a React control.
 *
 * An edit carries the revision the view was projected from and the live object
 * carries its own; a mismatch is a draft that outlived its selection, refused
 * **before** the funnel, because the funnel would resolve the *current* target
 * and write an old draft into a newly selected object. Lock and field
 * eligibility are re-checked here too: a control cannot be trusted to have
 * checked them, and a field that writes the object directly is withheld from a
 * locked one.
 *
 * The value rule is per field: a number must be finite, a whole-number field
 * must be whole, and a name must be one the document envelope would accept —
 * refused rather than coerced or truncated.
 */
export function editRefusal(
  edit: {
    readonly expectedRevision: number;
    readonly fieldId: string;
    readonly value: string | number | boolean;
  },
  live: { readonly targetRevision: number; readonly locked: boolean },
): EditRefusal | undefined {
  if (edit.expectedRevision !== live.targetRevision) return "stale";
  if (live.locked) return "locked";
  const kind = WRITABLE_FIELD_IDS.get(edit.fieldId);
  if (kind === undefined) return "unknown";
  if (kind === "name") {
    if (typeof edit.value !== "string") return "invalid";
    const trimmed = edit.value.trim();
    return trimmed === "" || isObjectName(trimmed) ? undefined : "invalid";
  }
  if (kind === "boolean") {
    return typeof edit.value === "boolean" ? undefined : "invalid";
  }
  if (kind === "text") {
    // A multi-line draft (a polyline's points, a path's data) is parsed by the
    // writer; the boundary only insists it is a string, never `Number("")`'s zero.
    return typeof edit.value === "string" ? undefined : "invalid";
  }
  if (kind === "reference") {
    // A paint reference is a token id or the empty string a cleared picker
    // writes. The writer resolves it through the palette owner; the boundary
    // only refuses a value that is not one.
    return typeof edit.value === "string" &&
      (edit.value === "" || edit.value.startsWith("palette."))
      ? undefined
      : "invalid";
  }
  if (typeof edit.value !== "number" || !Number.isFinite(edit.value)) {
    // Refuse rather than coerce: a non-finite number is not a dimension.
    return "invalid";
  }
  // `angle` was whole units before its field was converted, and a rotated
  // object's own angle is the only thing the write would move.
  if (kind === "integer" && !Number.isInteger(edit.value)) return "invalid";
  return undefined;
}

/** Whether the object is a text object, whose size is a box and not a scale. */
export function isTextObject(object: FabricObject): boolean {
  const authored = object.get("yunariText");
  return typeof authored === "object" && authored !== null;
}

/**
 * Fabric reports geometry in the object's own origin; these read whole artboard
 * units (§57). Position is the object's own `left`/`top` — its placement in the
 * artboard — not the drawn box, which also includes any stroke and the group
 * context, so the numbers an author types match what they placed.
 *
 * A size is the object's own measured edge, scale included: the number the
 * canvas has. It used to prefer `yunariText.box` for a text object, and where
 * that object carried a scale the two disagreed — a 140 × 27 box at scale 2
 * read **27** in H while the canvas drew 54 — so the readout was a probe that
 * could be wrong about the surface it describes, and two findings had to be
 * told apart before either could be fixed (vg-109). Where the box and the edge
 * are the same number, which is every object the text pass has been through,
 * this reads the same value it did before.
 */
export function readField(object: FabricObject, key: GeometryKey): number {
  if (key === "width") return object.width * object.scaleX;
  if (key === "height") return object.height * object.scaleY;
  if (key === "left") return object.left;
  if (key === "top") return object.top;
  return object.angle;
}

/** The word the column shows for each kind of thing it can describe. The six
    layer kinds keep their one owner; a multi-selection has no layer kind and is
    named by the copy table's own word for a selection. */
const KIND_WORD: Readonly<Record<SelectionKind, string>> = {
  text: uiCopy.panels.layerKinds.text,
  shape: uiCopy.panels.layerKinds.shape,
  chart: uiCopy.panels.layerKinds.chart,
  group: uiCopy.panels.layerKinds.group,
  image: uiCopy.panels.layerKinds.image,
  activeSelection: uiCopy.inspectorFields.selection,
  // `selectionKindOf` never answers "background" — it is no Fabric object — but
  // the union carries it so the subject can name one.
  background: uiCopy.panels.layerKinds.background,
};

/**
 * What the column says the selection is called. The rule is `layer-tree`'s one
 * owner, so the subject prints exactly what that object's own layer row prints —
 * two copies of the fallback chain already disagreed about a nameless object
 * with a blank id.
 */
function subjectNameOf(object: FabricObject): string {
  return rowNameOf(object, KIND_WORD[selectionKindOf(object)]);
}

/** The key a binding on this node carries, when one does. The subject's second
    line is about the object, and the key is the fact a reader needs to tell two
    otherwise identical rows apart. */
function bindingKeyOf(
  object: FabricObject,
  ports: ProjectionPorts,
): string | undefined {
  const id = object.get("id");
  if (typeof id !== "string" || id.length === 0) return undefined;
  return ports.nodeBindings?.(id)[0]?.semanticKey;
}

/**
 * The projection. Reads only, through the owners — it resolves no target of its
 * own (`index.ts`'s `target()` decides which object is described and hands it
 * here) and it holds no writer and no DOM.
 *
 * The sections arrive already as values: the per-kind builders return
 * `ColumnSectionView`s and nothing imperative survives beside them, so there is
 * no element to strip and no DOM node a `SelectionView` could carry.
 */
export function projectSelection(
  target: FabricObject | undefined,
  targetRevision: number,
  ports: ProjectionPorts,
  sections: readonly ColumnSectionView[] = [],
): SelectionView {
  if (target === undefined) {
    return { targetRevision, subject: undefined, locked: false, sections: [] };
  }

  return {
    targetRevision,
    subject: {
      name: subjectNameOf(target),
      kind: selectionKindOf(target),
      key: bindingKeyOf(target, ports),
    },
    locked: isLocked(target),
    sections,
  };
}
