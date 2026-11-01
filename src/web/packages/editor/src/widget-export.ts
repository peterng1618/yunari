import {
  type FabricGlobals,
  type FabricPalette,
  type FabricPaletteEntry,
  type FabricThemeEnvelope,
  objectName,
  type TypeToken,
} from "@yunari/renderer-core";
import {
  isLocked,
  objectAssetReference,
  objectPaletteReferences,
  objectTypeTokenReferences,
  type SerialisedScene,
  sceneObjects,
  visitSceneObjects,
} from "@yunari/scene-fabric";
import type { WidgetDocument } from "@yunari/theme-package";
import { type Canvas, type FabricObject, Group } from "fabric/es";
import {
  assetReferencedBy,
  type LocalAssetReference,
} from "./asset-manager/index.js";
import { uiCopy } from "./ui-copy.js";

export interface WidgetSelectionSource {
  /** The live editor canvas, which owns the selection. */
  readonly canvas: Canvas;
  /** The document as a save would write it: the scene, globals, bindings and
   *  asset declarations the export reads. */
  readonly envelope: FabricThemeEnvelope;
  readonly declarations: readonly LocalAssetReference[];
  readonly assets: Readonly<Record<string, Uint8Array>>;
}

export type WidgetExportResult =
  | {
      readonly ok: true;
      readonly document: WidgetDocument;
      readonly assets: Readonly<Record<string, Uint8Array>>;
    }
  | { readonly ok: false; readonly message: string };

function refuse(message: string): WidgetExportResult {
  return { ok: false, message };
}

function nameOf(object: FabricObject): string {
  const id = object.get("id");
  return objectName(object) ?? (typeof id === "string" ? id : object.type);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

/**
 * The current selection as a widget document.
 *
 * The subtree is the selected objects and their descendants, with every
 * ancestor group kept on the path so a nested selection's own transform still
 * resolves. Object ids travel unchanged, which is what keeps the carried
 * bindings — keyed by object id — pointing at the objects that show them.
 * Only the globals and assets those objects name travel: a widget package is a
 * unit, not a copy of the theme's library.
 */
export function extractSelectionWidget(
  source: WidgetSelectionSource,
): WidgetExportResult {
  const selected = source.canvas.getActiveObjects();
  if (selected.length === 0) return refuse(uiCopy.widgetExport.nothingSelected);

  const locked = selected
    .flatMap((object) => sceneObjects([object]))
    .find((object) => isLocked(object));
  if (locked !== undefined)
    return refuse(uiCopy.widgetExport.locked(nameOf(locked)));

  const scene = source.envelope.scene as SerialisedScene;
  const roots = source.canvas.getObjects();
  if (scene.objects.length !== roots.length)
    return refuse(uiCopy.widgetExport.unreadableScene);

  const selectedObjects = new Set(selected);
  const included = (object: FabricObject): boolean =>
    selectedObjects.has(object) ||
    (object instanceof Group && object.getObjects().some(included));

  const prune = (
    object: FabricObject,
    serialised: Readonly<Record<string, unknown>> | undefined,
  ): Readonly<Record<string, unknown>> | undefined => {
    if (!included(object)) return undefined;
    if (selectedObjects.has(object) || serialised === undefined)
      return serialised;
    const children = object instanceof Group ? object.getObjects() : [];
    const serialisedChildren = Array.isArray(serialised["objects"])
      ? serialised["objects"]
      : [];
    return {
      ...serialised,
      objects: children
        .map((child, index) => prune(child, serialisedChildren[index]))
        .filter(isRecord),
    };
  };

  const objects = roots
    .map((root, index) => prune(root, scene.objects[index]))
    .filter(isRecord);

  const exportedIds = new Set<string>();
  const collectIds = (
    serialised: readonly Readonly<Record<string, unknown>>[],
  ): void => {
    for (const object of serialised) {
      const id = object["id"];
      if (typeof id === "string") exportedIds.add(id);
      const children = object["objects"];
      if (Array.isArray(children)) collectIds(children.filter(isRecord));
    }
  };
  collectIds(objects);

  const palette = source.envelope.globals?.palette ?? {};
  const typeTokens = source.envelope.globals?.typeTokens ?? {};
  const usedPaletteEntries: Record<string, FabricPaletteEntry> =
    Object.fromEntries(
      Object.keys(palette)
        .filter(
          (id) =>
            objectPaletteReferences(
              selected,
              `palette.${id}` as `palette.${string}`,
            ).length > 0,
        )
        .map((id) => [id, palette[id]!]),
    );
  // `none` is the format's one mandatory token rather than a reference: a
  // widget that carries any palette has to carry it, or the document it writes
  // is refused by the same validator every other document passes.
  if (Object.keys(usedPaletteEntries).length > 0) {
    const none = palette["none"];
    if (none !== undefined) usedPaletteEntries["none"] = none;
  }
  const usedPalette = usedPaletteEntries as FabricPalette;
  const usedTokens: Record<string, TypeToken> = {};
  for (const id of Object.keys(typeTokens))
    if (
      objectTypeTokenReferences(
        selected,
        `typeTokens.${id}` as `typeTokens.${string}`,
      ).length > 0
    )
      usedTokens[id] = typeTokens[id]!;

  const globals: FabricGlobals = {
    ...(Object.keys(usedPalette).length === 0 ? {} : { palette: usedPalette }),
    ...(Object.keys(usedTokens).length === 0 ? {} : { typeTokens: usedTokens }),
  };

  const usedAssetIds = new Set<string>();
  for (const declaration of source.declarations)
    if (assetReferencedBy(selected, declaration.id))
      usedAssetIds.add(declaration.id);
  // The walk above only asks about declared ids. A scene reference whose
  // declaration is gone is the same missing bytes one step earlier, and it
  // would otherwise travel as a reference the package cannot answer.
  for (const root of selected)
    visitSceneObjects([root], (object) => {
      const reference = objectAssetReference(object);
      if (reference !== undefined) usedAssetIds.add(reference.assetId);
    });
  for (const token of Object.values(usedTokens))
    if (token.face !== undefined) usedAssetIds.add(token.face.assetId);

  for (const id of usedAssetIds) {
    const declaration = source.declarations.find((asset) => asset.id === id);
    const bytes =
      declaration === undefined ? undefined : source.assets[declaration.path];
    if (declaration === undefined || bytes === undefined)
      return refuse(uiCopy.widgetExport.missingAsset(declaration?.path ?? id));
  }

  const usedDeclarations = source.declarations.filter((asset) =>
    usedAssetIds.has(asset.id),
  );
  const usedAssets = Object.fromEntries(
    usedDeclarations.map((asset) => [asset.path, source.assets[asset.path]!]),
  );

  const bindings = Object.fromEntries(
    Object.entries(source.envelope.bindings ?? {}).filter(([id]) =>
      exportedIds.has(id),
    ),
  );

  return {
    ok: true,
    document: {
      schemaVersion: source.envelope.schemaVersion,
      fabricVersion: source.envelope.fabricVersion,
      id: source.envelope.id,
      scene: { ...scene, objects },
      ...(source.envelope.metadata === undefined
        ? {}
        : { metadata: source.envelope.metadata }),
      ...(Object.keys(globals).length === 0 ? {} : { globals }),
      ...(usedDeclarations.length === 0 ? {} : { assets: usedDeclarations }),
      ...(Object.keys(bindings).length === 0 ? {} : { bindings }),
    },
    assets: usedAssets,
  };
}
