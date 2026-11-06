import type { Binding, FabricGlobals } from "@yunari/renderer-core";
import { visitSceneObjects, YUNARI_ASSET_PROPERTY } from "@yunari/scene-fabric";
import {
  instantiateCard,
  type ObjectJson,
  type TokenSubstitution,
} from "@yunari/theme-kit";
import { type FabricObject, util } from "fabric/es";
import type { AssetManager } from "./asset-manager/index.js";
import type { EditorInteraction } from "./editor-interaction.js";
import { nextNewObjectPlacement } from "./new-object-defaults.js";
import { activeWidgetUnits, type InstalledWidgetUnit } from "./widget-packs.js";

/**
 * The card library's editor half: inserting one unit onto the live canvas.
 *
 * The units, the copy and the token mapping live in `@yunari/theme-kit`; this
 * module owns only the canvas, history and diagnostic work that a browser
 * session adds. A second copy of `instantiateCard` here would be a card the MCP
 * server could not insert.
 */

/**
 * Inserts one card as a unit: a copy on the canvas, its readings recorded under
 * its own ids, one history entry, left selected.
 *
 * **A card this theme cannot express is refused; a card it can express
 * differently is mapped and named.** An unresolved reference survives to
 * `snapshot`, which validates and throws, so a card that arrived anyway would
 * leave the author with a canvas that looks right and a save that fails for the
 * rest of the session, told nothing. What changed is that "this theme has no
 * token for `palette.cpu`" no longer *is* the answer when the theme has a CPU
 * colour under another name: `card-token-mapping.ts` resolves the reference
 * first, and what it had to substitute is reported through `errorManager`.
 */
export async function insertCard(
  editor: EditorInteraction,
  cardId: string,
  options: {
    readonly globals: FabricGlobals | undefined;
    /**
     * The readings the document already carries. Read so a copy's binding ids
     * mint past them; the envelope owns them, so this is a copy of a reference
     * and never a second place that decides what a card reads.
     */
    readonly bindings?: Readonly<Record<string, readonly Binding[]>>;
    /**
     * Records the copy's readings under its new ids. The envelope owns them, so
     * the caller writes rather than this module holding a second copy.
     */
    readonly onBindings: (
      bindings: Readonly<Record<string, readonly Binding[]>>,
    ) => void;
    /**
     * Adopts a packaged unit's declared assets before its copy is built. The
     * manager owns ids, paths and collision renames, so the copy is handed its
     * map rather than resolving bytes itself.
     */
    readonly assetManager?: Pick<AssetManager, "adoptPackaged">;
  },
): Promise<FabricObject> {
  const installed = installedUnit(cardId);
  const assetIds = await adoptedAssets(installed, options.assetManager);
  const unit = installed.unit;
  const copy = instantiateCard({
    unit,
    globals: options.globals,
    existingIds: sceneIds(editor.canvas),
    existingBindingIds: Object.values(options.bindings ?? {}).flatMap(
      (bindings) => bindings.map((binding) => binding.id),
    ),
    ...(assetIds === undefined ? {} : { assetIds }),
    // The one place a new object's position is decided — the same cascade every
    // other insertion takes, rather than a corner this module invented.
    origin: nextNewObjectPlacement(editor),
  });

  const unresolved = copy.issues.filter(
    (issue) => issue.code === "unmapped-global",
  );
  if (unresolved.length > 0) {
    throw new Error(unresolved.map((issue) => issue.detail).join(" "));
  }

  const [object] = await util.enlivenObjects<FabricObject>([copy.card]);
  if (object === undefined) {
    throw new Error(`The ${unit.label} card could not be built.`);
  }

  // Added before its readings are recorded: every pass that resolves them walks
  // the canvas, so an object that arrived ahead of its bindings would paint once
  // blank and wait for a tick nothing had yet asked for.
  editor.canvas.add(object);
  // **Told here, between the two.** Before the readings, because recording them
  // resolves every bound run and a document with no source for one throws —
  // which would swallow the only sentence explaining why the card now looks
  // different. And before `saveState`, because the shell retires a diagnostic on
  // the next committed edit, and the edit that would retire this one is this
  // insert.
  if (copy.substitutions.length > 0)
    reportSubstitutions(editor, unit.label, copy.substitutions);
  options.onBindings(copy.bindings);
  editor.canvas.setActiveObject(object);
  editor.historyManager.saveState();
  editor.canvas.requestRenderAll();
  return object;
}

/**
 * What the theme made the card map onto, in one line an author can act on.
 *
 * Every substituted token is named: a mapping that says only "the card was
 * adjusted" leaves the author with a card painted in a colour they did not
 * choose and no way to learn which token to edit. `warn`, not `error`, because
 * nothing failed — the card is on the canvas and the document saves.
 */
function reportSubstitutions(
  editor: EditorInteraction,
  cardLabel: string,
  substitutions: readonly TokenSubstitution[],
): void {
  const named = substitutions
    .map((entry) => `"${entry.from}" → "${entry.to}"`)
    .join(", ");
  editor.errorManager.warn(
    "controls",
    `The ${cardLabel} card was inserted with ${named}, because this theme has no ` +
      "token of its own there — edit the card's paint to change it.",
  );
}

/** The unit an insertion names, from the packs the host has installed. */
function installedUnit(cardId: string): InstalledWidgetUnit {
  const unit = activeWidgetUnits().find((candidate) => candidate.id === cardId);
  if (unit === undefined) {
    throw new Error(`There is no "${cardId}" card installed.`);
  }
  return unit;
}

/** Adopts the unit's scene assets, refusing a surface that cannot carry them.
 *
 * **Only what the unit's own subtree names is adopted.** A unit document also
 * carries its globals' font faces, which a card may not draw; adopting those
 * would leave an orphan declaration behind on every copy. */
async function adoptedAssets(
  installed: InstalledWidgetUnit,
  manager: Pick<AssetManager, "adoptPackaged"> | undefined,
): Promise<ReadonlyMap<string, string> | undefined> {
  const referenced = sceneAssetIds(installed.unit.build());
  const declarations = installed.declarations.filter((declaration) =>
    referenced.has(declaration.id),
  );
  if (declarations.length === 0) return undefined;
  if (manager === undefined) {
    throw new Error(
      `The ${installed.label} card carries packaged assets, and this surface cannot adopt them.`,
    );
  }
  const assets: Record<string, Uint8Array> = {};
  for (const declaration of declarations) {
    const bytes = installed.assets[declaration.path];
    if (bytes !== undefined) assets[declaration.path] = bytes;
  }
  return await manager.adoptPackaged(declarations, assets);
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

/** Every id the canvas already holds, descending into groups. */
function sceneIds(canvas: {
  getObjects(): readonly FabricObject[];
}): Set<string> {
  const ids = new Set<string>();
  visitSceneObjects(canvas.getObjects(), (object) => {
    const id = object.get("id");
    if (typeof id === "string") ids.add(id);
  });
  return ids;
}
