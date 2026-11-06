import type { WidgetUnit } from "@yunari/theme-package";
import type { CardUnit } from "./card-library.js";
import type { ObjectJson } from "./objects.js";

/**
 * A packaged widget unit as something an author can insert.
 *
 * The unit's document already carries its own subtree and its own readings, so
 * this is an adaptation and not a rebuild: `build` hands back the authored
 * object, and `bindings` are the unit's, keyed by the ids inside that object.
 *
 * The glyph key is the unit id because it is the only name the package owns:
 * two authors may ship different cards called "CPU", and the id is what tells
 * their packages apart.
 */
export function cardUnitFromWidget(unit: WidgetUnit): CardUnit {
  const objects = unit.document.scene["objects"];
  const first = Array.isArray(objects) ? objects[0] : undefined;
  if (!isRecord(first))
    throw new Error(
      `Widget unit "${unit.id}" has no top-level scene object to insert.`,
    );
  return {
    id: unit.id,
    label: unit.label,
    diagram: unit.id,
    build: () => first,
    ...(unit.document.bindings === undefined
      ? {}
      : { bindings: unit.document.bindings }),
  };
}

function isRecord(value: unknown): value is ObjectJson {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
