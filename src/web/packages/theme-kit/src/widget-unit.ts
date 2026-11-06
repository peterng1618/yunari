import type { AssetReference } from "@yunari/renderer-core";
import type { WidgetPackageResult, WidgetUnit } from "@yunari/theme-package";
import type { CardUnit } from "./card-library.js";
import type { ObjectJson } from "./objects.js";

/**
 * One unit from one installed pack, ready to insert.
 *
 * A unit id is unique across every installed pack: an insertion names a unit
 * only by id, so two packs claiming one id would make the id name whichever
 * pack was listed first. This is the one owner of that rule — the editor's
 * store and the MCP server both read their units through `packagedUnits`.
 */
export interface PackagedWidgetUnit {
  readonly id: string;
  readonly label: string;
  /** The glyph key, and the id an insertion names. */
  readonly diagram: string;
  readonly packId: string;
  /** The unit as the kit's copier consumes it. */
  readonly unit: CardUnit;
  readonly declarations: readonly AssetReference[];
  readonly assets: Readonly<Record<string, Uint8Array>>;
}

/**
 * Every unit the packs carry, in pack order then unit order.
 *
 * A pack the reader refused carries no units and contributes none; the caller
 * owns whether a refused package is fatal for its surface. A unit id in two
 * packs is not a choice this can make silently, so it throws.
 */
export function packagedUnits(
  packs: readonly {
    readonly packId: string;
    readonly result: WidgetPackageResult;
  }[],
): readonly PackagedWidgetUnit[] {
  const owners = new Map<string, string>();
  const units: PackagedWidgetUnit[] = [];
  for (const { packId, result } of packs) {
    if (!result.ok) continue;
    for (const unit of result.units) {
      const owner = owners.get(unit.id);
      if (owner !== undefined) {
        throw new Error(
          `The unit "${unit.id}" is carried by more than one installed pack ` +
            `("${owner}" and "${packId}"); an insertion names a unit by id, ` +
            "so two packs may not claim one.",
        );
      }
      owners.set(unit.id, packId);
      units.push({
        id: unit.id,
        label: unit.label,
        diagram: unit.id,
        packId,
        unit: cardUnitFromWidget(unit),
        declarations: unit.declarations,
        assets: unit.assets,
      });
    }
  }
  return units;
}

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
