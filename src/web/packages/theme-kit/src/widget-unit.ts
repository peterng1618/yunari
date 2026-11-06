import type { AssetReference } from "@yunari/renderer-core";
import { YUNARI_ASSET_PROPERTY } from "@yunari/scene-fabric";
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

/**
 * The declarations a unit's authored subtree actually draws.
 *
 * A unit document also carries the font faces its globals name, which a copy
 * can never reference: an insertion keeps the destination theme's globals, not
 * the package's. Adopting those would leave an orphan declaration and its bytes
 * in the document on every insert, so both surfaces select through here rather
 * than each keeping a private copy of the walk.
 */
export function unitAssetDeclarations(
  unit: CardUnit,
  declarations: readonly AssetReference[],
): readonly AssetReference[] {
  const referenced = sceneAssetIds(unit.build());
  return declarations.filter((declaration) => referenced.has(declaration.id));
}

/** Every asset id the authored subtree references through `yunariAsset`. */
function sceneAssetIds(value: ObjectJson): Set<string> {
  const ids = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const record = node as Readonly<Record<string, unknown>>;
    const asset = record[YUNARI_ASSET_PROPERTY];
    if (typeof asset === "object" && asset !== null) {
      const id = (asset as Readonly<Record<string, unknown>>)["assetId"];
      if (typeof id === "string") ids.add(id);
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(value);
  return ids;
}

function isRecord(value: unknown): value is ObjectJson {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
