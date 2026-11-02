import type { Globals } from "@yunari/renderer-core";
import {
  type FabricObject,
  Group,
  Path,
  Shadow,
  type StaticCanvas,
} from "fabric/es";
import { fabricArtboardPaint } from "./artboard-paint.js";

/** Persisted semantic palette references for Fabric object paint properties. */
export const YUNARI_PAINT_PROPERTY = "yunariPaint";

/** Properties a palette reference may own. */
const PAINT_REF_PROPERTIES: ReadonlySet<string> = new Set([
  "fill",
  "stroke",
  "shadowColor",
]);

export interface FabricPaintRefs {
  readonly fill?: `palette.${string}`;
  readonly stroke?: `palette.${string}`;
  /** Fabric keeps the shadow colour inside its native `shadow` object. */
  readonly shadowColor?: `palette.${string}`;
}

type PaintableObject = {
  get(name: string): unknown;
  set(name: string, value: unknown): unknown;
  width?: number;
  height?: number;
  scaleX?: number;
  scaleY?: number;
};

/**
 * Which Fabric property a paint the author picks belongs on.
 *
 * A `Path` carrying no fill is a stroked object, and this product already says
 * so: `newShapeStroke` fills nothing and is the palette's answer for a line, a
 * polyline and — by its own comment — a path. The Starter's icons are authored
 * the same way, `fill: null` and `stroke`/`strokeWidth` carrying the ink.
 *
 * Filling one of those paints whatever region its centrelines happen to
 * enclose, which for a stroke glyph is not the glyph. `starterIcons.storage`
 * declares one closed subpath and no second, so under any fill rule the whole
 * drive body floods and every counter closes: there is no hole in the data for
 * even one to open. What the author meant was the ink, so on an unfilled path
 * the ink is the stroke.
 *
 * Everything else is untouched. A path that arrives filled — a filled author's
 * glyph, the new-path default — keeps filling the region it encloses, and so
 * does a rounded card or a chevron.
 */
export function paintPropertyFor(object: FabricObject): "fill" | "stroke" {
  if (objectHasFill(object)) return "fill";
  return object instanceof Path ? "stroke" : "fill";
}

/** Fabric spells "no fill" three ways across revival, the inspector and authoring. */
function objectHasFill(object: FabricObject): boolean {
  const fill: unknown = object.get("fill");

  return fill !== null && fill !== undefined && fill !== "" && fill !== false;
}

/** Reapply global palette changes without making resolved Fabric paint authored state. */
export function applyObjectPalettePaints(
  canvas: StaticCanvas,
  globals: Globals | undefined,
): void {
  if (
    typeof (canvas as unknown as { getObjects?: unknown }).getObjects !==
    "function"
  )
    return;
  applyPaints(canvas.getObjects(), globals);
  canvas.requestRenderAll();
}

function applyPaints(
  objects: readonly PaintableObject[],
  globals: Globals | undefined,
): void {
  for (const object of objects) {
    const refs = object.get(YUNARI_PAINT_PROPERTY);
    if (isPaintRefs(refs)) {
      for (const [property, ref] of Object.entries(refs)) {
        const value = globals?.palette?.[ref.slice("palette.".length)]?.value;
        const paint = fabricArtboardPaint(
          value,
          extent(object.width, object.scaleX),
          extent(object.height, object.scaleY),
        );
        if (paint === undefined) continue;
        // A shadow colour lives inside Fabric's native Shadow, and only a
        // solid paint can fill it; a gradient token leaves the authored shadow
        // alone rather than being coerced into something Fabric cannot draw.
        if (property === "shadowColor") {
          const shadow = object.get("shadow");
          // Spread the live instance rather than `toObject`: persist.ts is the
          // only module allowed to call it, and the native geometry the author
          // set (blur, offsets) must survive the recolour.
          if (shadow instanceof Shadow && typeof paint === "string")
            object.set("shadow", new Shadow({ ...shadow, color: paint }));
        } else object.set(property, paint);
      }
    }
    if (object instanceof Group) applyPaints(object.getObjects(), globals);
  }
}

function extent(value: number | undefined, scale: number | undefined): number {
  return Math.max(1, (value ?? 1) * Math.abs(scale ?? 1));
}

function isPaintRefs(value: unknown): value is FabricPaintRefs {
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).every(
    ([property, ref]) =>
      PAINT_REF_PROPERTIES.has(property) &&
      typeof ref === "string" &&
      ref.startsWith("palette."),
  );
}
