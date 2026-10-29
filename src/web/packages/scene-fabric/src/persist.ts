import {
  type FabricThemeEnvelope,
  type FabricThemeEnvelopeInput,
  SUPPORTED_SCHEMA_VERSION,
  YUNARI_GLASS_PROPERTY,
  YUNARI_NAME_PROPERTY,
} from "@yunari/renderer-core";
import {
  Circle,
  classRegistry,
  type FabricObject,
  version as fabricVersion,
  Group,
  Path,
  Rect,
  type StaticCanvas,
  Textbox,
} from "fabric/es";
// Ensures `YunariChart` is registered before `loadFromJSON` revives custom objects.
import { YunariChart } from "./chart-object.js";
import { YUNARI_TEXT_PROPERTY } from "./fabric-text.js";
import {
  isFabricAssetReference,
  YUNARI_ASSET_PROPERTY,
} from "./object-asset.js";
import {
  ARC_FILL_REFUSED,
  type PaintApplicationOptions,
  refusalIsPaintPasses,
  refusesFill,
  YUNARI_PAINT_PROPERTY,
} from "./object-paint.js";

// `fabric/es` is selective: register every baseline scene class that v2 JSON
// may revive instead of relying on another renderer import to do it first.
classRegistry.setClass(Circle);
classRegistry.setClass(Path);
classRegistry.setClass(Rect);
classRegistry.setClass(Textbox);

/**
 * Single owner of Fabric scene serialization. Defaults are stripped so persisted
 * keys are authored deviations; `id` is explicitly included because Fabric omits it.
 *
 * The three interaction flags are authored state, not runtime state: the lock
 * manager writes them and saves, and a theme's own background is authored
 * non-selectable. Fabric omits all three from `toObject`, so without them here a
 * revived scene hands every object Fabric's `selectable: true` — an undo would
 * turn an authored background or a locked object back into an ordinary one.
 *
 * `subTargetCheck` and `interactive` are the contrast case: Fabric forces both
 * into every `Group.toObject`, and the grouping manager arms them only while an
 * author is inside a group. They are therefore stripped after serialization;
 * `includeDefaultValues = false` cannot do it, because an armed `true` differs
 * from Fabric's `false` default and an author never authors either key.
 */

export const SCENE_PERSISTED_PROPERTIES = [
  "id",
  // The display name an author reads; the id beside it stays the stable key.
  YUNARI_NAME_PROPERTY,
  YUNARI_TEXT_PROPERTY,
  YUNARI_PAINT_PROPERTY,
  YUNARI_ASSET_PROPERTY,
  YUNARI_GLASS_PROPERTY,
  // The unit a card was authored as, on the starter and on a copy (§77). An
  // authored fact about the document, so it has to survive the save like every
  // other authored key — a copy whose origin is remembered only until the first
  // save is a copy whose origin nobody can state. The key is `WidgetProvenance`'s
  // own field name; there is no Fabric-side constant for it, and one would have
  // a single reader.
  "provenance",
  "selectable",
  "evented",
  "locked",
] as const;

export interface SerialisedScene {
  readonly version: string;
  readonly objects: readonly Readonly<Record<string, unknown>>[];
  readonly [key: string]: unknown;
}

/** Serialize all objects with identity and without Fabric defaults. */
export function serialiseScene(canvas: StaticCanvas): SerialisedScene {
  // Keep the canvas in the same mode so stray serialization cannot emit a different shape.
  canvas.includeDefaultValues = false;
  // Fabric gradients retain undefined transform entries in memory; JSON export
  // is canonical persisted state, so normalize through JSON before validation.
  const scene = JSON.parse(
    JSON.stringify(canvas.toObject([...SCENE_PERSISTED_PROPERTIES])),
  ) as SerialisedScene;
  removeRuntimeText(scene.objects);
  removeGroupEntryFlags(scene.objects);
  removeDerivedTextClips(scene.objects);
  removeDerivedTextStyles(scene.objects);
  removeImageCrossOrigin(scene.objects);
  removeResolvedAssetSources(scene.objects);
  return scene;
}

/** Save the product envelope and Fabric object tree through their single owners. */
export function serialiseThemeEnvelope(
  canvas: StaticCanvas,
  input: FabricThemeEnvelopeInput,
): FabricThemeEnvelope {
  // The envelope version the product writes is the one the reader reports, so
  // it comes from the constant rather than a literal that has to agree.
  const version = SUPPORTED_SCHEMA_VERSION;

  return {
    schemaVersion: version,
    fabricVersion,
    ...input,
    scene: serialiseScene(canvas),
  };
}

/** Release chart engines before Fabric replaces the current object graph. */
export function disposeScene(canvas: StaticCanvas): void {
  disposeObjects(canvas.getObjects());
}

/** Replace the canvas contents; image/clip-path enlivening makes this async. */
export async function reviveScene(
  canvas: StaticCanvas,
  scene: SerialisedScene,
  resolveAsset?: (assetId: string) => string | undefined,
  paint: PaintApplicationOptions = {},
  options: ReviveSceneOptions = {},
): Promise<void> {
  disposeScene(canvas);
  // `loadFromJSON` assigns every canvas-level property the document omits, so
  // the artboard clip the mount installed is replaced with `undefined`. It is
  // artboard state rather than scene state, so a scene document never carries
  // it, and a revived display would have no boundary at all: an object outside
  // the artboard paints over the letterbox bars. Restored after the load, from
  // the canvas's own pre-revival values.
  //
  // The background fill is restored for the opposite reason: nothing
  // paints the artboard on the canvas any more — the host carries it, and the
  // glass backdrop carries it — so a fill can only have arrived *from* the
  // document, and left standing it covers the media layer all over again. The
  // pre-revival value is the empty one the mount left, so this clears it.
  const clipPath = canvas.clipPath;
  const backgroundColor = canvas.backgroundColor;
  await canvas.loadFromJSON(
    resolveAssetSources(editableTextScene(scene, options), resolveAsset),
  );
  if (clipPath !== undefined) canvas.clipPath = clipPath;
  if (backgroundColor !== undefined) canvas.backgroundColor = backgroundColor;
  refuseUndrawablePaint(canvas.getObjects(), paint);
}

export interface ReviveSceneOptions {
  /**
   * Revive Fabric's display-only `"Text"` as `IText`, the class the editor can
   * type into. Opt-in because the player renders both classes and has no
   * editing; the editor asks so mount and undo normalise identically.
   */
  readonly editableText?: boolean;
}

/**
 * The document with every nested `"Text"` revived as an editable `IText`.
 *
 * A copy, not a rewrite: the caller's scene is the author's document, and only
 * the class is normalised — geometry, runs and styles are carried through
 * untouched. Groups nest serialised objects, so the walk goes through them.
 */
function editableTextScene(
  scene: SerialisedScene,
  options: ReviveSceneOptions,
): SerialisedScene {
  if (options.editableText !== true) return scene;
  return { ...scene, objects: scene.objects.map(editableTextObject) };
}

function editableTextObject(
  object: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const children = object["objects"];
  return {
    ...object,
    ...(object["type"] === "Text" ? { type: "IText" } : {}),
    ...(Array.isArray(children)
      ? { objects: children.filter(isRecord).map(editableTextObject) }
      : {}),
  };
}

/**
 * Withholds paint the product will not draw, on **every** surface.
 *
 * Here rather than in the editor's paint pass because Fabric restores a serialised
 * fill inside `loadFromJSON`, and the player resolves no palette paints at all —
 * so a theme carrying a hand-authored filled arc reached a phone as the chord its
 * own curve is not, while the editor that authored it showed the curve. The device
 * is a lens on the document only if the two agree what the document says, and this
 * is the one function both surfaces traverse.
 *
 * The authored reference is kept, so refusing on a display does not quietly
 * rewrite the author's theme. `refusesFill` is the one answer to which kind this
 * is; nothing here restates it.
 *
 * **The half only this site can report is reported here.** An arc carrying a
 * `yunariPaint` is refused again by the editor's paint pass, which has its own
 * channel and says the same sentence — so reporting it here too would say it
 * twice on one load. An arc with no reference never reaches that pass, and was
 * previously refused in silence: the author watched a figure vanish with nothing
 * said. That case is this function's alone, so `refusalIsPaintPasses` decides it
 * and no second copy of the rule appears.
 */
function refuseUndrawablePaint(
  objects: readonly FabricObject[],
  paint: PaintApplicationOptions,
): void {
  for (const object of objects) {
    if (object instanceof Group) {
      refuseUndrawablePaint(object.getObjects(), paint);
      continue;
    }
    if (!refusesFill(object)) continue;
    object.set("fill", "");
    if (!refusalIsPaintPasses(object)) {
      paint.onRefusedPaint?.(ARC_FILL_REFUSED);
    }
  }
}

/** Refuse a different Fabric runtime instead of guessing its serialization semantics. */
export async function reviveThemeEnvelope(
  canvas: StaticCanvas,
  envelope: FabricThemeEnvelope,
  resolveAsset?: (assetId: string) => string | undefined,
  paint: PaintApplicationOptions = {},
  options: ReviveSceneOptions = {},
): Promise<void> {
  assertFabricThemeEnvelopeCompatible(envelope);
  await reviveScene(
    canvas,
    envelope.scene as SerialisedScene,
    resolveAsset,
    paint,
    options,
  );
}

/**
 * The scene as Fabric should load it, with every asset reference turned into
 * the URL that asset resolves to.
 *
 * `yunariAsset` is the authored truth and `src` is whatever the session that
 * decoded the image happened to hold — for a pasted image, a `blob:` URL that
 * means nothing in another tab, another browser, or on a phone. Fabric
 * enlivens an image from `src` alone, so resolving here rather than after the
 * load is what makes the declared bytes travel: a second load would first fail
 * on the stale URL and then flash. An asset the resolver cannot name keeps its
 * own `src`, which fails visibly rather than painting the wrong picture.
 */
function resolveAssetSources(
  scene: SerialisedScene,
  resolveAsset: ((assetId: string) => string | undefined) | undefined,
): SerialisedScene {
  if (resolveAsset === undefined) return scene;
  return {
    ...scene,
    objects: scene.objects.map((object) =>
      resolveObjectAsset(object, resolveAsset),
    ),
  };
}

function resolveObjectAsset(
  object: Readonly<Record<string, unknown>>,
  resolveAsset: (assetId: string) => string | undefined,
): Readonly<Record<string, unknown>> {
  const children = object["objects"];
  const reference = object[YUNARI_ASSET_PROPERTY];
  const url = isFabricAssetReference(reference)
    ? resolveAsset(reference.assetId)
    : undefined;
  return {
    ...object,
    ...(url === undefined ? {} : { src: url }),
    ...(Array.isArray(children)
      ? {
          objects: children
            .filter(isRecord)
            .map((child) => resolveObjectAsset(child, resolveAsset)),
        }
      : {}),
  };
}

/** Checks compatibility before a caller replaces an already-mounted scene. */
export function assertFabricThemeEnvelopeCompatible(
  envelope: FabricThemeEnvelope,
): void {
  if (envelope.fabricVersion !== fabricVersion) {
    throw new Error(
      `This theme's renderer version ${envelope.fabricVersion} is incompatible with this runtime's ${fabricVersion}.`,
    );
  }
}

function disposeObjects(objects: readonly object[]): void {
  for (const object of objects) {
    if (object instanceof YunariChart) {
      object.dispose();
    } else if (object instanceof Group) {
      disposeObjects(object.getObjects());
    }
  }
}

/** Fabric serializes its display cache; replace sampled text with a data-free fallback. */
function removeRuntimeText(
  objects: readonly Readonly<Record<string, unknown>>[],
): void {
  for (const object of objects) {
    const runs = valueRuns(object[YUNARI_TEXT_PROPERTY]);
    if (runs !== undefined) {
      (object as Record<string, unknown>)["text"] = runs
        .map((run) => (run.kind === "literal" ? run.text : "—"))
        .join("");
    }
    const children = object["objects"];
    if (Array.isArray(children)) removeRuntimeText(children.filter(isRecord));
  }
}

/**
 * A text object's clip rect and its own `height` are caches of its authored
 * box, not authored state.
 *
 * Fabric serialises both, and the clip is the only thing clipping a text object
 * no refresh pass visits — an unbound label is never re-resolved, so a stale
 * rect from an earlier layout would be what a reader sees. `height` is the
 * sharper of the two: `Textbox.initDimensions` derives it from the wrapped text
 * on construction and every pass puts it back at the box, so a file that
 * carried it would show a different number the moment the document opened and
 * the editor would report the author's own document as edited (§67).
 * `yunariText.box` is the owner; `applyClip` and `assertBoxHeight` rebuild
 * these from it on the first refresh after revival.
 */
function removeDerivedTextClips(
  objects: readonly Readonly<Record<string, unknown>>[],
): void {
  for (const object of objects) {
    if (isRecord(object[YUNARI_TEXT_PROPERTY])) {
      delete (object as Record<string, unknown>)["clipPath"];
      delete (object as Record<string, unknown>)["height"];
    }
    const children = object["objects"];
    if (Array.isArray(children))
      removeDerivedTextClips(children.filter(isRecord));
  }
}

/**
 * An image that names its asset does not also carry a URL.
 *
 * Fabric writes `src` on every image regardless of what the caller asked to be
 * serialised, and what it wrote is whatever session happened to decode it — for
 * a pasted image, a `blob:` handle that means nothing to the next reader. The
 * reference is the authored truth and every reader resolves it before the load,
 * so persisting the URL ships a dead handle beside the live thing.
 *
 * Only where the reference is. An image with no `yunariAsset` has nothing to
 * resolve, and dropping its `src` would leave a picture no one can load.
 */
function removeResolvedAssetSources(
  objects: readonly Readonly<Record<string, unknown>>[],
): void {
  for (const object of objects) {
    if (isFabricAssetReference(object[YUNARI_ASSET_PROPERTY])) {
      delete (object as Record<string, unknown>)["src"];
    }
    const children = object["objects"];
    if (Array.isArray(children))
      removeResolvedAssetSources(children.filter(isRecord));
  }
}

/**
 * Fabric's derived per-character style table is a repaint's output, not a
 * document.
 *
 * `FabricText.toObject` writes `styles` on every text object whatever the
 * caller asked for, and `stylesToArray` reports whatever ranges the last
 * repaint left — so two exports of one unchanged document disagree on it. The
 * authored equivalent is `yunariText.runs`, which nothing here touches, and
 * no reader reads `styles` back.
 */
function removeDerivedTextStyles(
  objects: readonly Readonly<Record<string, unknown>>[],
): void {
  for (const object of objects) {
    delete (object as Record<string, unknown>)["styles"];
    const children = object["objects"];
    if (Array.isArray(children))
      removeDerivedTextStyles(children.filter(isRecord));
  }
}

/**
 * `crossOrigin` is the network policy of the session that decoded an image,
 * not a choice an author made, and a revived reader makes its own.
 *
 * Fabric persists it once set, because it is a set property rather than a
 * Fabric default, so a package can carry a CORS policy that meant something
 * only to the tab that saved it.
 */
function removeImageCrossOrigin(
  objects: readonly Readonly<Record<string, unknown>>[],
): void {
  for (const object of objects) {
    delete (object as Record<string, unknown>)["crossOrigin"];
    const children = object["objects"];
    if (Array.isArray(children))
      removeImageCrossOrigin(children.filter(isRecord));
  }
}

/** Fabric forces both keys into `Group.toObject`; the grouping manager is their only writer. */
function removeGroupEntryFlags(
  objects: readonly Readonly<Record<string, unknown>>[],
): void {
  for (const object of objects) {
    delete (object as Record<string, unknown>)["subTargetCheck"];
    delete (object as Record<string, unknown>)["interactive"];
    const children = object["objects"];
    if (Array.isArray(children))
      removeGroupEntryFlags(children.filter(isRecord));
  }
}

function valueRuns(
  value: unknown,
):
  | readonly (
      | { readonly kind: "literal"; readonly text: string }
      | { readonly kind: "value" }
    )[]
  | undefined {
  if (!isRecord(value) || !Array.isArray(value["runs"])) return undefined;
  const runs = value["runs"];
  if (!runs.some((run) => isRecord(run) && run["kind"] === "value"))
    return undefined;
  if (
    !runs.every(
      (run) =>
        isRecord(run) &&
        ((run["kind"] === "literal" && typeof run["text"] === "string") ||
          run["kind"] === "value"),
    )
  )
    return undefined;
  return runs as readonly (
    | { readonly kind: "literal"; readonly text: string }
    | { readonly kind: "value" }
  )[];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}
