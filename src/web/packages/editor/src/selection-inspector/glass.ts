import {
  type GlassTreatment,
  glassTreatment,
  MAX_GLASS_BLUR_RADIUS,
  supportsGlass,
  YUNARI_GLASS_PROPERTY,
} from "@yunari/renderer-core";
import { applyObjectPalettePaints } from "@yunari/scene-fabric";
import { type FabricObject, Group } from "fabric/es";
import { frostedShapeFill } from "../new-object-defaults.js";
import { uiCopy } from "../ui-copy.js";
import type { AppearanceContext } from "./appearance.js";
import { paintRefs, writeRef } from "./panel.js";
import type { FieldView } from "./view.js";

/**
 * The authored frosted-glass treatment: an enable and a blur radius, both on
 * the existing `yunariGlass` property. Nothing here invents a scene model —
 * the property is `renderer-core`'s, the lifecycle is `scene-fabric`'s, and this
 * is the control that writes one and tells the other.
 */

/**
 * The radius a panel gets when the author turns the treatment on.
 *
 * A value to move, not a rule: a treatment with no blur is valid and shows
 * nothing, so enabling one has to leave something visible. It sits inside the
 * band Task 1 measured flat, and it is **not** measured off the reference image
 * — that image is a design mockup over a photograph, not a rendering whose
 * radius can be read back.
 */
const DEFAULT_GLASS_BLUR_RADIUS = 16;

/**
 * The kind name the treatment is written in. Fabric lowercases the instance's
 * `type`, so the class's own static is the spelling the envelope, the published
 * schema and `supportsGlass` all use — and therefore the one to ask with.
 */
function kindOf(object: FabricObject): string {
  return (object.constructor as { readonly type?: string }).type ?? object.type;
}

/**
 * Whether the control is offered enabled. The membership is the owner's and is
 * asked, never restated: a copy of `GLASS_OBJECT_TYPES` here would agree with it
 * only until someone added a kind there and forgot this file, and then a shape
 * would be frostable in a theme and un-authorable in the editor with no error
 * anywhere.
 *
 * `Group` is the one subtraction, and it is a different fact from membership
 * rather than a second copy of it — checked on the live class, because that is
 * what Fabric's overridden `drawObject` is. Fabric renders a group's children
 * directly, so a group never fires `before:render` and there is no boundary to
 * sample its backdrop through; `scene-fabric/src/glass.ts` refuses the
 * treatment there. Enabling it would take an edit that paints nothing, so no
 * control is offered for it.
 *
 * Kept apart from `panel.ts`'s `supportsPanelFields` on purpose. That answers
 * "may these fields write this object's material?" — a group has no own fill,
 * radius or border. This answers "may its backdrop be sampled?", and the two
 * differ on `Polyline`, `Line` and `Path`: those have material and no closed
 * area. `glass.dom.test.ts` checks this against `supportsGlass` for every kind
 * Fabric ships, so widening either set cannot reopen the gap silently.
 */
export function supportsGlassControl(object: FabricObject): boolean {
  return supportsGlass(kindOf(object)) && !(object instanceof Group);
}

/** The panel's authored treatment, or none. */
function treatmentOf(object: FabricObject): GlassTreatment | undefined {
  return glassTreatment(object);
}

/** Removes the property outright: an ordinary panel carries no treatment at all. */
function clearTreatment(object: FabricObject): void {
  delete (object as unknown as Record<string, unknown>)[YUNARI_GLASS_PROPERTY];
}

/**
 * Writes the treatment and asks `renderer-core`'s own reader whether it is one.
 *
 * The reader, not a check of its own, is what accepts the value — so the
 * control is refused by the same code that refuses it at import. `false` means
 * the object was left exactly as it was.
 */
function writeTreatment(
  object: FabricObject,
  next: GlassTreatment | undefined,
): boolean {
  const before = object.get(YUNARI_GLASS_PROPERTY);
  if (next === undefined) {
    clearTreatment(object);
    return true;
  }
  object.set(YUNARI_GLASS_PROPERTY, next);
  if (treatmentOf(object) !== undefined) return true;
  if (before === undefined) clearTreatment(object);
  else object.set(YUNARI_GLASS_PROPERTY, before);
  return false;
}

/**
 * Puts the frosted surface on a card that is carrying the default one, and
 * resolves the paint so the canvas shows it this frame rather than the next.
 *
 * Nothing here is a second copy of the surface rule: `new-object-defaults`
 * wrote the default this is compared against, and `panel.ts` owns both how a
 * paint reference is read and how it is written. What is left is the decision
 * to apply the answer, which belongs to the control the author used.
 */
function frostTheSurface(
  context: AppearanceContext,
  object: FabricObject,
): void {
  const frost = frostedShapeFill(context.globals, paintRefs(object).fill);
  if (frost === undefined) return;
  writeRef(object, "fill", frost);
  // The shell's own channel, for the same reason `panel.ts` passes it: this is a
  // whole-canvas pass, so an arc elsewhere in the scene is refused by it too and
  // must not do so in silence.
  applyObjectPalettePaints(context.editor.canvas, context.globals, {
    onRefusedPaint: (message) =>
      context.editor.errorManager.warn("paint", message),
  });
}

/**
 * The glass fields, for a subject that can carry the treatment, and none for
 * one that cannot.
 *
 * **The section is withheld rather than rendered refused**, which reverses the
 * decision recorded here before (`vg-006`): the control used to appear on every
 * subject with the shape's own reason in the row, because withholding it "left
 * nothing anywhere saying so". The author has since ruled the other way — the
 * subject's inability is a fact about its kind, and a section that exists only
 * to refuse one row is not a question (§7.4, "a property a kind does not have is
 * not shown as a field"). The reason is not carried elsewhere either: an author
 * selecting a group is simply offered no glass, without a sentence explaining
 * what was never theirs to set.
 *
 * Values, not controls: React renders them through the control set and
 * `index.ts` writes them through {@link writeGlassField}.
 */
export function glassFields(object: FabricObject): readonly FieldView[] {
  if (!supportsGlassControl(object)) return [];
  const fields: FieldView[] = [
    {
      id: "glass-enabled",
      control: "toggle",
      label: uiCopy.inspectorFields.glassEnabled,
      checked: treatmentOf(object) !== undefined,
      data: { "data-yunari-glass-enabled": "" },
    },
  ];

  // Only offered when there is a treatment for it to change: a blur box over a
  // panel with no glass accepts an edit and applies none.
  const treatment = treatmentOf(object);
  if (treatment !== undefined) {
    fields.push({
      id: "glass-blur",
      control: "slider",
      label: uiCopy.inspectorFields.glassBlur,
      value: treatment.blurRadius,
      // It had both bounds pre-plan (`0 … MAX_GLASS_BLUR_RADIUS`) and so drew a
      // slider; DESIGN.md's vocabulary says a bounded number is a slider (§5).
      // The pre-plan field refused a fraction unconditionally; the boundary
      // re-checks it. See `panelMaterialFields`.
      min: 0,
      max: MAX_GLASS_BLUR_RADIUS,
      integer: true,
      data: { "data-yunari-glass-blur": "" },
    });
    // Always offered, whatever the background is today: a theme may swap the
    // media for a video later, and a row that appeared only for one background
    // would have to be re-read on every media change.
    fields.push({
      id: "glass-sampling",
      control: "segmented",
      label: uiCopy.inspectorFields.glassSampling,
      value: treatment.sampling ?? "dynamic",
      options: [
        { id: "dynamic", name: uiCopy.inspectorFields.glassSamplingDynamic },
        { id: "static", name: uiCopy.inspectorFields.glassSamplingStatic },
      ],
      data: { "data-yunari-glass-sampling": "" },
    });
  }

  return fields;
}

/**
 * Writes one of the glass fields and hands back whether the edit applied.
 *
 * `supportsGlassControl` is re-checked here rather than trusted to the control:
 * a bypassed toggle must not write a treatment the renderer would never
 * composite, which is the same rule the predicate states.
 *
 * The blur lands on the ceiling rather than being refused: `MAX_GLASS_BLUR_RADIUS`
 * is the validator's bound, asked of the owner, and the pre-plan field taught it
 * by landing on it. Turning the treatment on also puts the frosted surface on
 * the card; see {@link frostTheSurface}.
 */
export function writeGlassField(
  object: FabricObject,
  context: AppearanceContext,
  fieldId: string,
  value: string | number | boolean,
): boolean {
  if (fieldId === "glass-enabled") {
    if (!supportsGlassControl(object)) return false;
    if (value === true) {
      if (!writeTreatment(object, { blurRadius: DEFAULT_GLASS_BLUR_RADIUS }))
        return false;
      frostTheSurface(context, object);
      return true;
    }
    // Turning it off restores nothing: what it would restore is the author's own
    // default, and overwriting that is the same edit in reverse.
    clearTreatment(object);
    return true;
  }

  if (fieldId === "glass-blur" && typeof value === "number") {
    const current = treatmentOf(object);
    if (current === undefined) return false;
    return writeTreatment(object, {
      ...current,
      blurRadius: Math.min(Math.max(value, 0), MAX_GLASS_BLUR_RADIUS),
    });
  }

  if (
    fieldId === "glass-sampling" &&
    (value === "static" || value === "dynamic")
  ) {
    const current = treatmentOf(object);
    if (current === undefined) return false;
    return writeTreatment(object, { ...current, sampling: value });
  }

  return false;
}
