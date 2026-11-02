import type { FabricGlobals } from "@yunari/renderer-core";
import {
  isOfferedPaletteToken,
  paletteTokenOptions,
} from "@yunari/renderer-core";
import {
  applyObjectPalettePaints,
  type FabricPaintRefs,
  paintPropertyFor,
  YUNARI_PAINT_PROPERTY,
} from "@yunari/scene-fabric";
import {
  Circle,
  Ellipse,
  type FabricObject,
  Path,
  Polygon,
  Rect,
  Shadow,
  Triangle,
} from "fabric/es";
import { cornersForSides } from "../new-object-defaults.js";
import { uiCopy } from "../ui-copy.js";
import { type AppearanceContext, resolveToken } from "./appearance.js";
import {
  boundedIntegerField,
  drawnEdge,
  integerField,
  radiusBound,
} from "./bounds-from-drawn-box.js";
import type { FieldHooks, FieldOption, FieldView } from "./view.js";

/**
 * A shape's authored material: which tokens paint its fill, border and shadow,
 * the native geometry that makes them visible, and whatever belongs to that one
 * kind of shape. Everything here is a property Fabric already owns, so an
 * author can edit it, save it, undo it and read it back — no second model beside
 * the scene.
 *
 * Paint resolves through `applyObjectPalettePaints`, the same owner the editor
 * uses when a palette changes, so a field and a palette edit cannot disagree
 * about what a reference means.
 */

/** The paint properties a panel may reference, matching `FabricPaintRefs`. */
type PaintProperty = keyof FabricPaintRefs;

/**
 * A starting blur for a shadow the author has just given a colour. A colour
 * alone draws nothing, so the committed edit must leave something visible —
 * and the blur field appears with it, so this is a value to move, not a rule.
 */
const DEFAULT_PANEL_SHADOW_BLUR = 8;

/**
 * How far a newly shadowed panel's shadow falls below it. A shadow with no
 * offset is a symmetric halo, not a shadow: the captured editor evidence showed
 * the light panel token drawing a white glow around the panel until this moved.
 */
const DEFAULT_PANEL_SHADOW_OFFSET = 4;

/**
 * Whether these fields apply at all. Every primitive Fabric 7 ships owns a
 * fill, a stroke, a border width and a shadow, so all of them get the same
 * fields; a chart, an image, a text object or a group would be offered controls
 * that accept an edit and apply none.
 *
 * The corner radius is narrower and is offered for a rectangle alone, because
 * `rx` is a `Rect` property and no other class reads it.
 *
 * Checked on the live class rather than the persisted `"type"` string: Fabric
 * lowercases `object.type`, and only the scene JSON spells it `Rect`.
 */
function supportsPanelFields(object: FabricObject): boolean {
  return (
    object instanceof Rect ||
    object instanceof Circle ||
    object instanceof Ellipse ||
    object instanceof Triangle ||
    object instanceof Polygon ||
    object instanceof Path
  );
}

/** The object's own stored references. Only `writeRef` writes, and it spreads
    first, so nothing here can mutate the object behind the validator. Exported
    for the same reason `writeRef` is: the frosted-glass control reads this
    object's fill before it decides whether to move it. */
export function paintRefs(object: FabricObject): FabricPaintRefs {
  const value = object.get(YUNARI_PAINT_PROPERTY);
  return typeof value === "object" && value !== null
    ? (value as FabricPaintRefs)
    : {};
}

/**
 * Sets one property's reference and leaves the others alone. Palette identity
 * is per property: choosing a fill must not re-point a border or a shadow the
 * author already set, and clearing one must not clear the rest.
 *
 * Exported because the frosted-glass control writes this object's fill too, and
 * a second copy of the spread would be a second place that decides what a paint
 * reference set means.
 */
export function writeRef(
  object: FabricObject,
  property: PaintProperty,
  ref: `palette.${string}` | undefined,
): void {
  const next: { -readonly [K in PaintProperty]?: `palette.${string}` } = {
    ...paintRefs(object),
  };
  if (ref === undefined) delete next[property];
  else next[property] = ref;
  object.set(YUNARI_PAINT_PROPERTY, next);
}

/** The theme's tokens, each under the name its author gave it, as the entries a
    paint picker offers. The empty id is the "not set" row the picker needs to
    clear a reference, which the imperative field carried as its first option. */
function paintOptions(
  globals: FabricGlobals | undefined,
  solidOnly: boolean,
): readonly FieldOption[] {
  return [
    { id: "", name: uiCopy.inspectorFields.notSet },
    ...paletteTokenOptions(
      globals?.palette,
      (id, entry) =>
        isOfferedPaletteToken(id) &&
        !(solidOnly && entry.value.kind !== "solid"),
    ),
  ];
}

/**
 * The panel's material fields — fill (or ink), stroke, border width, corner
 * radius, shadow, shadow blur and shadow offset — as values, or nothing when the
 * selection is not a panel.
 *
 * Values, not controls: React renders them through the control set and
 * `index.ts` writes them through {@link writePanelField}. The eligibility gate is
 * `supportsPanelFields` and nothing else, and the corner radius is narrower still
 * — a rectangle's alone, because `rx` is a `Rect` property and no other class
 * reads it.
 *
 * Every number is whole units, and the control shape for each comes from
 * `bounds-from-drawn-box.ts`: the pair when the field has a ceiling to draw, a
 * typed box when it has none.
 *
 * The bounded ones carry a slider, and their bound is the panel's own drawn box
 * rather than a number chosen here. The shadow's offset is the one that does
 * not: Fabric's `offsetY` is unbounded — a shadow above a panel is legitimate —
 * so it keeps a typed box, which is `vg-007`'s rule not reaching a field with no
 * ceiling.
 */
export function panelMaterialFields(
  context: AppearanceContext,
  object: FabricObject,
): readonly FieldView[] | undefined {
  if (!supportsPanelFields(object)) return undefined;

  const refs = paintRefs(object);
  /** An unfilled path is stroked; one of the fields below paints that ink. */
  const paintProperty = paintPropertyFor(object);
  const fields: FieldView[] = [];

  const swatch = (
    id: string,
    label: string,
    selected: `palette.${string}` | undefined,
    solidOnly: boolean,
    data: FieldHooks,
  ): FieldView => ({
    id,
    control: "swatch",
    label,
    value: selected ?? "",
    options: paintOptions(context.globals, solidOnly),
    colour: resolveToken(context.globals, selected) ?? "transparent",
    data,
  });
  const edge = drawnEdge(object);

  // One field on the paint, and which property it writes is the scene's own
  // decision: an unfilled path is stroked, so its paint is ink.
  fields.push(
    swatch(
      "panel-fill",
      paintProperty === "stroke"
        ? uiCopy.inspectorFields.panelInk
        : uiCopy.inspectorFields.panelFill,
      refs[paintProperty],
      false,
      { "data-yunari-panel-fill": "" },
    ),
  );

  // Not offered twice: on an unfilled path the field above already writes the
  // stroke, and two fields on one property is a coin toss for the author.
  if (paintProperty !== "stroke") {
    fields.push(
      swatch(
        "panel-stroke",
        uiCopy.inspectorFields.panelStroke,
        refs.stroke,
        false,
        {
          "data-yunari-panel-stroke": "",
        },
      ),
    );
  }

  fields.push(
    boundedIntegerField(
      "panel-border",
      uiCopy.inspectorFields.panelBorder,
      Math.round(object.get("strokeWidth") as number),
      edge,
      { "data-yunari-panel-border": "" },
    ),
  );

  // A rectangle's alone: `rx` belongs to `Rect`, and a radius box over any
  // other shape would read back `NaN` and write a property nothing draws.
  if (object instanceof Rect) {
    fields.push(
      boundedIntegerField(
        "panel-radius",
        uiCopy.inspectorFields.panelRadius,
        Math.round(object.get("rx") as number),
        radiusBound(edge),
        { "data-yunari-panel-radius": "" },
      ),
    );
  }

  fields.push(
    swatch(
      "panel-shadow",
      uiCopy.inspectorFields.panelShadow,
      refs.shadowColor,
      true,
      {
        "data-yunari-panel-shadow": "",
      },
    ),
  );

  // Only offered when there is a shadow for them to change: a blur box over a
  // panel with no shadow accepts an edit and applies none.
  const shadow = object.get("shadow");
  if (shadow instanceof Shadow) {
    fields.push(
      boundedIntegerField(
        "panel-shadow-blur",
        uiCopy.inspectorFields.panelShadowBlur,
        Math.round(shadow.blur),
        edge,
        { "data-yunari-panel-shadow-blur": "" },
      ),
      // Unbounded, because Fabric's own `offsetY` is: a shadow above a panel is
      // legitimate, and a floor of zero would display a value the field then
      // refused to accept on the author's next edit. Its ceiling is the page
      // rather than the panel — an offset of 400 is still a shadow — so it
      // carries no slider and the rule that a bounded number does not reach it.
      integerField(
        "panel-shadow-offset",
        uiCopy.inspectorFields.panelShadowOffset,
        Math.round(shadow.offsetY),
        { "data-yunari-panel-shadow-offset": "" },
      ),
    );
  }

  return fields;
}

/**
 * Writes one of the panel's material fields and hands back whether the edit
 * applied. The rules that resolve a reference through the palette owner, clear
 * the live paint a cleared reference leaves behind, and give a fresh shadow its
 * blur and offset live here with the fields that describe them; `index.ts` is
 * the funnel that asks for them and this module owns no second one.
 *
 * A number **lands on its bound** rather than being refused here: the pre-plan
 * `numberField` clamped an out-of-range value to the bound it crossed, and this
 * writer still does, because a commit can reach it without the control. The
 * control is the stricter of the two — a draft past a bound is kept with its
 * reason rather than coerced — so the clamp is the copy that holds for a
 * bypassed one, and the fraction rule is the control's `integer` flag and
 * `editRefusal`'s, not this writer's.
 */
export function writePanelField(
  object: FabricObject,
  context: AppearanceContext,
  fieldId: string,
  value: string | number,
): boolean {
  const typed = typeof value === "string" ? value : "";
  const number = typeof value === "number" ? value : Number.NaN;

  switch (fieldId) {
    case "panel-fill":
      return writePaint(object, context, paintPropertyFor(object), typed);
    case "panel-stroke":
      return writePaint(object, context, "stroke", typed);
    case "panel-shadow":
      return writeShadow(object, context, typed);
    case "panel-border":
      object.set("strokeWidth", Math.max(number, 0));
      return true;
    case "panel-radius": {
      // Both axes, because Fabric derives `ry` from `rx` only while it is
      // unset; persisting one and reading the other back would depend on that
      // default.
      //
      // Clamped to what the renderer can show: Fabric draws
      // `Math.min(rx, w / 2)`, so a larger stored value is a field claiming a
      // corner the canvas never draws (`vg-478`). An unreadable box clamps to
      // the floor alone rather than to a guessed ceiling.
      const ceiling = radiusBound(drawnEdge(object));
      const radius =
        ceiling === undefined
          ? Math.max(number, 0)
          : Math.min(Math.max(number, 0), ceiling);
      object.set({ rx: radius, ry: radius });
      return true;
    }
    case "panel-shadow-blur":
      writeIntoShadow(object, (live) => {
        live.blur = Math.max(number, 0);
      });
      return true;
    case "panel-shadow-offset":
      writeIntoShadow(object, (live) => {
        live.offsetY = number;
      });
      return true;
    default:
      return false;
  }
}

/** Sets one paint property's reference and re-resolves the canvas, so a fill
    written here and a fill written by a palette edit cannot disagree about what
    the reference means. A cleared reference also clears the live paint: nothing
    re-resolves it back, so it would otherwise keep the last token's colour. */
function writePaint(
  object: FabricObject,
  context: AppearanceContext,
  property: "fill" | "stroke",
  raw: string,
): boolean {
  const ref = raw === "" ? undefined : (raw as `palette.${string}`);
  writeRef(object, property, ref);
  if (ref === undefined) object.set(property, "");
  repaint(context);
  return true;
}

/**
 * Sets the shadow colour and gives a shadow that had none a real, visible one.
 *
 * A colour alone draws nothing, so the committed edit must leave something to
 * see and tune — falling below the panel rather than glowing evenly around it.
 * A shadow already there keeps its own blur and offsets; only its colour is
 * re-resolved from the colour just written.
 */
function writeShadow(
  object: FabricObject,
  context: AppearanceContext,
  raw: string,
): boolean {
  const ref = raw === "" ? undefined : (raw as `palette.${string}`);
  writeRef(object, "shadowColor", ref);
  if (ref === undefined) {
    object.set("shadow", null);
  } else if (!(object.get("shadow") instanceof Shadow)) {
    object.set(
      "shadow",
      new Shadow({
        color: resolveToken(context.globals, ref) ?? "",
        blur: DEFAULT_PANEL_SHADOW_BLUR,
        offsetX: 0,
        offsetY: DEFAULT_PANEL_SHADOW_OFFSET,
      }),
    );
  }
  repaint(context);
  return true;
}

/** Writes one native shadow property, if the shadow is still there. A no-op when
    it is not: the field only exists while a shadow does. */
function writeIntoShadow(
  object: FabricObject,
  write: (live: Shadow) => void,
): void {
  const live = object.get("shadow");
  if (live instanceof Shadow) write(live);
}

/** The shell's own whole-canvas paint pass. */
function repaint(context: AppearanceContext): void {
  applyObjectPalettePaints(context.editor.canvas, context.globals);
}

/**
 * The geometry that belongs to this one kind of shape — a polygon's sides, a
 * path's data — or nothing when every number the shape has is already the
 * general W/H pair.
 *
 * Values, not controls: React renders them and `index.ts` writes them through
 * the one funnel, which calls {@link writeShapeGeometryField} for the objects
 * this module owns.
 */
export function createShapeGeometryFields(
  object: FabricObject,
): readonly FieldView[] {
  return createShapeFields(object);
}

/** The fewest sides a closed shape can have, and the most an author can ask
    for: two is a line, and past this the count is a mistake rather than a
    design. */
const MIN_POLYGON_SIDES = 3;
const MAX_POLYGON_SIDES = 32;

/**
 * Adopts geometry the author just typed, and drops the scale that belonged to
 * the geometry it replaced.
 *
 * A polygon's points and a path's commands are both **absolute coordinates in
 * the object's own space**, so any `scaleX`/`scaleY` on the object is a scale
 * from a different drawing. Measured: a path sized to 28 × 28 and then given
 * 14 × 14 of new data drew **1 × 3 units** — the new data multiplied by the old
 * geometry's scale, which is the order every icon in a dashboard is built in
 * (insert, size, then draw).
 *
 * So the data wins and the scale goes back to 1, which leaves the object at the
 * size its own geometry measures and makes the W and H fields mean what they
 * mean on every other shape. This is the rule the polygon branch above already
 * keeps — *"the points remain the only persisted truth"* — completed.
 */
function adoptGeometry(object: FabricObject): void {
  // Every caller is a `Polygon` or a `Path`; both re-measure from their own
  // geometry through this one method.
  (object as FabricObject & { setDimensions(): void }).setDimensions();
  object.set({ scaleX: 1, scaleY: 1 });
}

/**
 * The geometry that belongs to this one kind of shape, as values.
 *
 * A circle, an ellipse and a triangle own none: each is fully described by the
 * width and height the general fields already carry, and a field that derived
 * one of those would be a second way to say the same number.
 */
function createShapeFields(object: FabricObject): readonly FieldView[] {
  const fields: FieldView[] = [];

  // A polygon's side count is its own field; a path edits its commands below.
  if (object instanceof Polygon) {
    fields.push({
      id: "shape-sides",
      control: "slider",
      label: uiCopy.inspectorFields.shapeSides,
      value: object.points.length,
      min: MIN_POLYGON_SIDES,
      max: MAX_POLYGON_SIDES,
      integer: true,
      data: { "data-yunari-shape-sides": "" },
    });
  }

  if (object instanceof Path) {
    fields.push({
      id: "shape-path",
      control: "text",
      label: uiCopy.inspectorFields.shapePath,
      value: pathDataOf(object),
      multiline: true,
      rows: 3,
      data: { "data-yunari-shape-path": "" },
    });
  }

  return fields;
}

/** The whole-number bounds a value is landed on, never crossed. The pre-plan
    `numberField` put an out-of-range value on the bound it crossed rather than
    refusing it — "landing on the bound teaches it" — and that is the rule the
    imported field carried, so the funnel keeps it here. */
function bound(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * A number the author typed in full, or nothing.
 *
 * `Number` accepts `""`, `" "`, `"0x10"` and `"1e5"`, so a finite check after
 * it would commit a value the author never wrote — and the sibling path branch
 * and `ControlNumber.parse` both refuse those. A plain decimal with an optional
 * sign and fraction is the one grammar all three callers share.
 */
function parsedGeometryNumber(value: string | number): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Writes one of a shape's own geometry fields, and hands back whether the edit
 * applied. The rules that parse, bound and adopt geometry live here with the
 * fields that describe them; `index.ts` is the funnel that asks for them.
 *
 * `false` means the object was left exactly as it was — a polyline's points or a
 * path's data that Fabric cannot read would otherwise replace a real shape with
 * one nothing can select or see.
 */
export function writeShapeGeometryField(
  object: FabricObject,
  fieldId: string,
  value: string | number,
): boolean {
  if (fieldId === "shape-sides" && object instanceof Polygon) {
    const typed = parsedGeometryNumber(value);
    if (typed === undefined) return false;
    const sides = bound(typed, MIN_POLYGON_SIDES, MAX_POLYGON_SIDES);
    const { minX, minY, width, height } = boundsOf(object.points);
    object.set(
      "points",
      cornersForSides(sides, width, height).map((corner) => ({
        x: corner.x + minX,
        y: corner.y + minY,
      })),
    );
    // Fabric does not re-measure a points change on its own, so the object would
    // keep the old box until something else asked for it.
    adoptGeometry(object);
    return true;
  }

  if (fieldId === "shape-path" && object instanceof Path) {
    const parsed = parsedPath(String(value));
    if (parsed === undefined) return false;
    object.set("path", parsed);
    adoptGeometry(object);
    return true;
  }

  return false;
}

/** The box a set of points occupies, in the object's own untransformed space —
    the space the general W and H fields scale, not the space they display. */
function boundsOf(points: readonly { x: number; y: number }[]): {
  minX: number;
  minY: number;
  width: number;
  height: number;
} {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    minX,
    minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  };
}

/** The stored commands as the SVG data that produced them, so the field shows
    the author something they can edit rather than Fabric's tuple form. */
function pathDataOf(path: Path): string {
  const commands: unknown = path.get("path");
  if (typeof commands === "string") return commands;
  if (!Array.isArray(commands)) return "";
  return commands
    .filter((command): command is readonly unknown[] => Array.isArray(command))
    .map((command) => command.map(String).join(" "))
    .join(" ");
}

/**
 * The typed data as Fabric's own parser reads it, or nothing.
 *
 * Read through `Path` rather than a second parser, so the commands stored are
 * the ones Fabric would have produced. Refused on two grounds: data it cannot
 * parse comes back empty, and a lone moveto has no extent at all — either would
 * replace a real shape with one nothing can see or select.
 */
function parsedPath(text: string): unknown[] | undefined {
  const parsed = new Path(text);
  const path: unknown = parsed.get("path");
  if (!Array.isArray(path) || path.length === 0) return undefined;
  if (parsed.width === 0 && parsed.height === 0) return undefined;
  return path;
}
