import { objectName } from "@yunari/renderer-core";
import { type FabricObject, type StaticCanvas } from "fabric/es";
import { YUNARI_TEXT_PROPERTY } from "./fabric-text.js";
import { type FabricPaintRefs, YUNARI_PAINT_PROPERTY } from "./object-paint.js";
import { visitSceneObjects } from "./scene-objects.js";

/** One object that names a palette token, and where. */
export interface PaletteReference {
  /** The object's authored id — the key the layer list and bindings use. */
  readonly objectId: string;
  /** The name the author reads, or its id when the object carries none (§75). */
  readonly name: string;
  /** Zero-based run indexes, when the reference is a text run's colour. */
  readonly runs: readonly number[];
}

/**
 * Every object naming `ref`, at any depth.
 *
 * The read side of the same walk `reassignObjectPaletteReferences` performs.
 * The two must stay one traversal: a panel reading "3 uses" while a delete
 * guard counts something else is how a token is removed from under a live
 * object, and the grouped case is the one that regresses — a root-only walk
 * cannot see inside a group, so it calls a token unused while a grouped object
 * is painted with it.
 *
 * One entry per **object**, not per reference: a panel whose fill, stroke and
 * shadow all name the token is one object the author has to look at.
 */
export function objectPaletteReferences(
  objects: readonly FabricObject[],
  ref: `palette.${string}`,
): readonly PaletteReference[] {
  const found: PaletteReference[] = [];
  visitSceneObjects(objects, (object) => {
    const use = referenceOn(object, ref);
    if (use !== undefined) found.push(use);
  });
  return found;
}

/** Rewrite persisted object/run palette references before a token is removed. */
export function reassignObjectPaletteReferences(
  canvas: StaticCanvas,
  from: `palette.${string}`,
  to: `palette.${string}`,
): number {
  let changes = 0;
  visitSceneObjects(canvas.getObjects(), (object) => {
    const paints = object.get(YUNARI_PAINT_PROPERTY);
    if (isPaintRefs(paints)) {
      const next = Object.fromEntries(
        Object.entries(paints).map(([property, ref]) => {
          if (ref === from) {
            changes += 1;
            return [property, to];
          }
          return [property, ref];
        }),
      );
      object.set(YUNARI_PAINT_PROPERTY, next);
    }
    const text = object.get(YUNARI_TEXT_PROPERTY);
    if (isText(text)) {
      const runs = text.runs.map((run) => {
        const color = run.style?.color;
        if (color?.ref !== from) return run;
        changes += 1;
        return { ...run, style: { ...run.style, color: { ref: to } } };
      });
      object.set(YUNARI_TEXT_PROPERTY, { ...text, runs });
    }
  });
  return changes;
}

type TextRun = { style?: { color?: { ref?: string } }; [key: string]: unknown };
type AuthoredText = { runs: readonly TextRun[]; [key: string]: unknown };

/** What one object names, or `undefined` when it names nothing. */
function referenceOn(
  object: FabricObject,
  ref: `palette.${string}`,
): PaletteReference | undefined {
  const runs: number[] = [];
  const text = object.get(YUNARI_TEXT_PROPERTY);
  if (isText(text))
    text.runs.forEach((run, index) => {
      if (run.style?.color?.ref === ref) runs.push(index);
    });
  const paints = object.get(YUNARI_PAINT_PROPERTY);
  const painted = isPaintRefs(paints) && Object.values(paints).includes(ref);
  // A chart is a canvas object like any other, and names its tokens in
  // `settings` rather than in paint — a gauge is a canvas object and carries no
  // `yunariPaint` at all. Reading it here is what stops the panel calling a
  // token dead while a chart is visibly painted with it. The *rewrite* stays in
  // `ChartManager`, which owns the chart and has to re-apply the engine option
  // afterwards; reading is not that decision.
  const chart = chartNames(object.get("settings"), ref);
  if (!painted && runs.length === 0 && !chart) return undefined;
  const objectId = object.get("id");
  const id = typeof objectId === "string" ? objectId : "";
  return { objectId: id, name: objectName(object) ?? id, runs };
}

/**
 * Whether a chart's persisted settings name `ref` anywhere.
 *
 * The settings tree is a chart's own shape — `track`, `progress`, a series
 * palette, threshold bands — so this walks it for the ref it carries rather
 * than assuming which key holds it. `ChartManager` rewrites those references;
 * this only answers whether there are any, which is a different question and
 * needs no chart.
 */
function chartNames(settings: unknown, ref: string): boolean {
  if (Array.isArray(settings))
    return settings.some((entry) => chartNames(entry, ref));
  if (typeof settings !== "object" || settings === null) return false;
  const record = settings as Record<string, unknown>;
  if (record["ref"] === ref) return true;
  return Object.values(record).some((entry) => chartNames(entry, ref));
}

function isPaintRefs(value: unknown): value is FabricPaintRefs {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every(
      (ref) => typeof ref === "string" && ref.startsWith("palette."),
    )
  );
}
function isText(value: unknown): value is AuthoredText {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as Record<string, unknown>)["runs"])
  );
}
