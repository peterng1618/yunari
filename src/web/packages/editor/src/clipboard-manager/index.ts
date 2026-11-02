import {
  type Binding,
  createWidgetIdAllocator,
  type WidgetIssue,
} from "@yunari/renderer-core";
import {
  isFabricAssetReference,
  isLocked,
  objectAssetReference,
  SCENE_PERSISTED_PROPERTIES,
  visitSceneObjects,
  YUNARI_ASSET_PROPERTY,
  YUNARI_TEXT_PROPERTY,
} from "@yunari/scene-fabric";
import {
  ActiveSelection,
  type Canvas,
  type FabricObject,
  Group,
  util,
} from "fabric/es";
import type { DeletionManager } from "../deletion-manager/index.js";
import type { ErrorManager } from "../error-manager/index.js";
import type { ImageManager } from "../image-manager/index.js";
import { isTextEntryTarget } from "../shortcut-manager/index.js";
import {
  type ClipboardAsset,
  type ClipboardAssetDeclaration,
  type ClipboardAssets,
} from "./asset-port.js";

const PASTE_OFFSET = 10;

/** Where a copy that outlives this manager is kept. Origin-scoped, so another
 *  tab of the editor reads it, and it survives the shell a theme switch builds
 *  anew. */
const PORTABLE_STORAGE_KEY = "yunari.editor.clipboard";
const PORTABLE_VERSION = 1;

/** What a placed image or SVG owes the clipboard: the source declaration's
 *  bytes, encoded as JSON-safe text. The source id is kept so paste can map it
 *  to the fresh declaration the destination made. */
interface PortableAsset {
  readonly id: string;
  readonly kind: "image" | "svg";
  readonly path: string;
  readonly bytes: string;
}

/** A copy that can be read by another theme in the same browser.
 *
 *  The payload holds the persisted Fabric shape rather than a second scene
 *  model, the declared bytes its objects name, and the readings keyed by the
 *  object that shows them.
 */
interface PortableClipboard {
  readonly version: typeof PORTABLE_VERSION;
  readonly objects: readonly Readonly<Record<string, unknown>>[];
  readonly assets: readonly PortableAsset[];
  readonly bindings: Readonly<Record<string, readonly Binding[]>>;
}

/** The last copy this tab made, kept when the browser refuses the store: same
 *  theme hopping still works, and a refused write is not reported as a copy
 *  that never happened. */
let portableMemory: string | undefined;

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(text: string): Uint8Array | undefined {
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1)
      bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return undefined;
  }
}

function isBinding(value: unknown): value is Binding {
  if (!isRecord(value)) return false;
  if (
    typeof value["id"] !== "string" ||
    value["id"].trim() === "" ||
    typeof value["semanticKey"] !== "string" ||
    value["semanticKey"].trim() === ""
  )
    return false;
  const finite = (field: unknown): boolean =>
    field === undefined ||
    (typeof field === "number" && Number.isFinite(field));
  return (
    finite(value["precision"]) &&
    finite(value["scale"]) &&
    finite(value["offset"]) &&
    (value["unitDisplay"] === undefined ||
      value["unitDisplay"] === "none" ||
      value["unitDisplay"] === "short" ||
      value["unitDisplay"] === "long") &&
    (value["unit"] === undefined || typeof value["unit"] === "string") &&
    (value["autoScale"] === undefined ||
      typeof value["autoScale"] === "boolean") &&
    (value["format"] === undefined || typeof value["format"] === "string") &&
    (value["timeZone"] === undefined || typeof value["timeZone"] === "string")
  );
}

function parseBindings(
  value: unknown,
): Readonly<Record<string, readonly Binding[]>> | undefined {
  if (!isRecord(value)) return undefined;
  const entries: [string, readonly Binding[]][] = [];
  for (const [objectId, readings] of Object.entries(value)) {
    if (objectId === "" || !Array.isArray(readings)) return undefined;
    const parsed: Binding[] = [];
    for (const reading of readings) {
      if (!isBinding(reading)) return undefined;
      parsed.push(reading);
    }
    entries.push([objectId, parsed]);
  }
  return Object.fromEntries(entries);
}

/** Whether a serialized object is one Fabric can revive: a named class, and, at
 *  every depth, either no asset reference or a well-formed one. */
function isPortableObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || typeof value["type"] !== "string") return false;
  const reference = value[YUNARI_ASSET_PROPERTY];
  if (reference !== undefined && !isFabricAssetReference(reference))
    return false;
  const children = value["objects"];
  return (
    children === undefined ||
    (Array.isArray(children) && children.every(isPortableObject))
  );
}

function referencesHeldAssets(
  object: Readonly<Record<string, unknown>>,
  held: ReadonlySet<string>,
): boolean {
  const reference = object[YUNARI_ASSET_PROPERTY];
  if (isFabricAssetReference(reference) && !held.has(reference.assetId))
    return false;
  const children = object["objects"];
  return (
    !Array.isArray(children) ||
    children.every(
      (child) => isRecord(child) && referencesHeldAssets(child, held),
    )
  );
}

/** The stored payload, or `undefined` where it is absent, unreadable or not
 *  something this build may paste. Storage is untrusted input: every field the
 *  paste relies on is checked before the document is touched. */
function parsePortable(raw: string | null): PortableClipboard | undefined {
  if (raw === null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || parsed["version"] !== PORTABLE_VERSION)
    return undefined;
  const objects = parsed["objects"];
  if (
    !Array.isArray(objects) ||
    objects.length === 0 ||
    !objects.every(isPortableObject)
  )
    return undefined;
  const rawAssets = parsed["assets"];
  if (!Array.isArray(rawAssets)) return undefined;
  const assets: PortableAsset[] = [];
  for (const value of rawAssets) {
    if (!isRecord(value)) return undefined;
    const { id, kind, path, bytes } = value;
    if (
      typeof id !== "string" ||
      id.trim() === "" ||
      (kind !== "image" && kind !== "svg") ||
      typeof path !== "string" ||
      path === "" ||
      typeof bytes !== "string" ||
      decodeBase64(bytes) === undefined
    )
      return undefined;
    assets.push({ id, kind, path, bytes });
  }
  const bindings =
    parsed["bindings"] === undefined ? {} : parseBindings(parsed["bindings"]);
  if (bindings === undefined) return undefined;
  const held = new Set(assets.map((asset) => asset.id));
  // One id per carried file, or a payload could declare the same source twice
  // and leave one destination declaration unreachable.
  if (held.size !== assets.length) return undefined;
  if (!objects.every((object) => referencesHeldAssets(object, held)))
    return undefined;
  return {
    version: PORTABLE_VERSION,
    objects: objects as Record<string, unknown>[],
    assets,
    bindings,
  };
}

function readPortable(): PortableClipboard | undefined {
  let raw: string | null = null;
  if (typeof localStorage !== "undefined") {
    try {
      raw = localStorage.getItem(PORTABLE_STORAGE_KEY);
    } catch {
      raw = null;
    }
  }
  // A store that answers is the authority: a malformed payload is refused
  // rather than silently replaced by this tab's older in-memory copy.
  if (raw !== null) return parsePortable(raw);
  return parsePortable(portableMemory ?? null);
}

function writePortable(payload: PortableClipboard): void {
  const raw = JSON.stringify(payload);
  portableMemory = raw;
  try {
    localStorage.setItem(PORTABLE_STORAGE_KEY, raw);
  } catch {
    // The in-memory copy still carries this tab. Clear the shared slot so a
    // stale earlier payload does not outrank it here.
    try {
      localStorage.removeItem(PORTABLE_STORAGE_KEY);
    } catch {
      // Storage is unavailable; memory is all this tab has, which is enough.
    }
  }
}

/** The destination declaration that replaced each source asset id. */
type DeclaredAssets = ReadonlyMap<string, ClipboardAssetDeclaration>;

function repointPortableObject(
  object: Record<string, unknown>,
  declared: DeclaredAssets,
): void {
  const reference = object[YUNARI_ASSET_PROPERTY];
  if (isFabricAssetReference(reference)) {
    const replacement = declared.get(reference.assetId);
    if (replacement === undefined)
      throw new Error(
        `The clipboard did not declare its file: ${reference.assetId}`,
      );
    object[YUNARI_ASSET_PROPERTY] = {
      ...reference,
      assetId: replacement.id,
    };
    // Fabric enlivens an image from `src` alone. Rewriting it here is what makes
    // the destination's declared bytes the picture the object arrives with; the
    // source's URL is a handle into a session that no longer exists.
    object["src"] = replacement.previewUrl;
  }
  const children = object["objects"];
  if (Array.isArray(children))
    for (const child of children)
      if (isRecord(child)) repointPortableObject(child, declared);
}

/** A copy as the other themes of this browser see it. */
function portableOf(
  source: FabricObject,
  bindings: ClipboardBindings | undefined,
  assets: ClipboardAssets | undefined,
): PortableClipboard {
  const roots =
    source instanceof ActiveSelection ? source.getObjects() : [source];
  const objects = roots.map(
    (root) =>
      root.toObject([...SCENE_PERSISTED_PROPERTIES]) as Record<string, unknown>,
  );
  const objectIds = new Set<string>();
  const assetIds = new Set<string>();
  visitSceneObjects(roots, (object) => {
    const id = object.get("id");
    if (typeof id === "string") objectIds.add(id);
    const reference = objectAssetReference(object);
    if (reference !== undefined) assetIds.add(reference.assetId);
  });
  const carried: PortableAsset[] = [];
  for (const assetId of assetIds) {
    const asset = assets?.read(assetId);
    if (asset === undefined)
      throw new Error(
        `The selection uses an asset this theme cannot carry: ${assetId}`,
      );
    carried.push({
      id: asset.id,
      kind: asset.kind,
      path: asset.path,
      bytes: encodeBase64(asset.bytes),
    });
  }
  const held: Record<string, readonly Binding[]> = {};
  for (const [objectId, readings] of Object.entries(bindings?.read() ?? {})) {
    if (objectIds.has(objectId)) held[objectId] = readings;
  }
  return {
    version: PORTABLE_VERSION,
    objects,
    assets: carried,
    bindings: held,
  };
}

/** What places a pasted image. Returns whatever the importer returns. */
type ImageImporter = (file: File) => Promise<unknown>;

/**
 * What a pasted or duplicated object owes the document, written through the
 * session. **A copy is a copy, not a twin** — see `carryBindings` below.
 */
export interface ClipboardBindings {
  /** The document's readings, keyed by the id of the object that shows them. */
  readonly read: () => Readonly<Record<string, readonly Binding[]>>;
  /** Records a copy's readings under its own ids. Envelope state, so the
   * session writes rather than this module holding a second copy. */
  readonly write: (
    additions: Readonly<Record<string, readonly Binding[]>>,
  ) => void;
}

export interface ClipboardManager {
  copy(): Promise<boolean>;
  cut(): Promise<boolean>;
  paste(): Promise<boolean>;
  duplicate(object?: FabricObject): Promise<boolean>;
  setImageImporter(importer: ImageImporter): void;
  /** Installed by the session, which owns the envelope's bindings. */
  setBindings(bindings: ClipboardBindings): void;
  /** Installed by the session, which owns the theme's declarations and bytes. */
  setAssets(assets: ClipboardAssets): void;
  destroy(): void;
}

interface ClipboardManagerOptions {
  readonly canvas: Canvas;
  readonly save: () => void;
  readonly errors: ErrorManager;
  readonly deletion: DeletionManager;
  readonly importImage: ImageManager["importImage"];
  readonly bindings?: ClipboardBindings;
  readonly assets?: ClipboardAssets;
}

/** Everything a minted id has to avoid: the canvas, descended, and the envelope's
 * own binding ids, which live outside the canvas but are unique across the
 * document just the same. */
function takenIds(
  canvas: Canvas,
  bindings: ClipboardBindings | undefined,
): string[] {
  const ids: string[] = [];
  visitSceneObjects(canvas.getObjects(), (object) => {
    const id = object.get("id");
    if (typeof id === "string") ids.push(id);
  });
  for (const readings of Object.values(bindings?.read() ?? {})) {
    for (const binding of readings) ids.push(binding.id);
  }
  return ids;
}

/**
 * A pasted object needs its own id; a duplicate id fails envelope validation.
 *
 * Minted by `createWidgetIdAllocator` — the same rule the card library's
 * insertion uses, because **"a copy is a copy, not a twin" is one policy and
 * not two**: what an author sees in a tree of pasted units is `rect-shape`,
 * not a uuid, and both paths truncate, sanitise and bump past what the document
 * already holds. The prefix is the object's own Fabric type, which is what the
 * inline `${object.type}-${randomUUID()}` produced too.
 *
 * One allocator per object **type**, not per object, because the allocator
 * copies what it was given as `taken`: a fresh allocator per object would copy
 * it once per node, so a deep paste is quadratic in the tree. Sharing per type
 * also preserves the memoisation that makes two members of the same kind share
 * one sanitisation, which is what the bump below then has to correct for.
 *
 * Returns what each id became, which is how a copy's readings travel with it:
 * a binding is keyed by the object that shows it, so without this a card comes
 * back named after a CPU card, shows nothing, and prints no key in the tree.
 */
function reassignIds(
  object: FabricObject,
  ids: Map<string, string>,
  taken: Set<string>,
  allocators: Map<string, (original: string) => string>,
  issues: WidgetIssue[],
): void {
  let allocateId = allocators.get(object.type);
  if (allocateId === undefined) {
    allocateId = createWidgetIdAllocator(object.type, taken, issues);
    allocators.set(object.type, allocateId);
  }
  const from = object.get("id");
  // An unnamed object still needs an id, and the allocator wants something to
  // derive one from; the uuid is that something, never the id itself.
  const original = typeof from === "string" ? from : crypto.randomUUID();
  // The allocator memoises **by original** and consults only the `taken` copy it
  // took at construction, so a second member declaring an id the first already
  // minted would be handed the same answer — two objects at one id, which is the
  // envelope validator's `duplicate-id` and a save that fails for the rest of the
  // session. `taken` is threaded and updated here precisely so that case is
  // visible, and the key bumps rather than the answer repeating.
  //
  // Verified rather than reasoned: hoisting the allocator to one per type, which
  // is what removed the quadratic copy, reintroduced exactly this collision, and
  // the test that caught it is the one that made this loop load-bearing.
  let minted = allocateId(original);
  for (let nth = 2; taken.has(minted); nth += 1) {
    minted = allocateId(`${original}-${nth}`);
  }
  taken.add(minted);
  if (typeof from === "string") ids.set(from, minted);
  object.set("id", minted);
  if (object instanceof Group) {
    for (const child of object.getObjects()) {
      reassignIds(child, ids, taken, allocators, issues);
    }
  }
}

/**
 * The readings a copy carries, under the copy's own object ids and with fresh
 * binding ids, and the run `bindingId`s repointed at them.
 *
 * **A copy is a copy, not a twin.** Two things have to move together or the
 * author is handed a lie:
 *
 *  - The envelope's `bindings` are keyed by object id, and a pasted object has a
 *    new one, so its readings are stripped at the next save by the same
 *    `dropDanglingBindings` that protects a deleted object. The copy arrives
 *    showing nothing at all.
 *  - A run names its binding by id, so copying a binding *under the original's
 *    id* would leave two entries claiming one binding id — the validator's
 *    `duplicate-id`, and an unsaveable session for the rest of the editing
 *    session. Fresh binding ids with the runs repointed are the only shape that
 *    both keeps the readings and keeps the document valid.
 *
 * The semantic keys are carried across unchanged: a copy bound to a sensor
 * nobody else names is not a copy of anything.
 *
 * Binding ids are minted by the same allocator as object ids, so a pasted card
 * reads `binding-cpu-card-load-2` rather than a uuid — one policy for what a
 * fresh id looks like, whichever kind it is.
 *
 * The allocator's issues are reported, not swallowed: an id it could not derive
 * is one the copy carries unchanged, which is the `duplicate-id` this walk
 * exists to prevent, and a paste that cannot be saved should not look saved.
 */
function carryBindings(
  objects: readonly FabricObject[],
  ids: ReadonlyMap<string, string>,
  held: Readonly<Record<string, readonly Binding[]>>,
  taken: Set<string>,
  issues: WidgetIssue[],
): Readonly<Record<string, readonly Binding[]>> {
  const carried: Record<string, readonly Binding[]> = {};
  const repoint = new Map<string, string>();
  const allocateId = createWidgetIdAllocator("binding", taken, issues);
  for (const [from, to] of ids) {
    const readings = held[from];
    if (readings === undefined || readings.length === 0) continue;
    carried[to] = readings.map((binding) => {
      const id = allocateId(binding.id);
      taken.add(id);
      repoint.set(binding.id, id);
      return { ...binding, id };
    });
  }
  if (repoint.size > 0) {
    for (const object of objects) repointRuns(object, repoint);
  }
  return carried;
}

/** Every value run on the copy, at any depth, pointed at the copy's binding. */
function repointRuns(
  object: FabricObject,
  ids: ReadonlyMap<string, string>,
): void {
  const authored = object.get(YUNARI_TEXT_PROPERTY);
  if (isRecord(authored) && Array.isArray(authored["runs"])) {
    object.set(YUNARI_TEXT_PROPERTY, {
      ...authored,
      runs: authored["runs"].map((run) => {
        if (!isRecord(run) || typeof run["bindingId"] !== "string") return run;
        return {
          ...run,
          bindingId: ids.get(run["bindingId"]) ?? run["bindingId"],
        };
      }),
    });
  }
  if (object instanceof Group) {
    for (const child of object.getObjects()) repointRuns(child, ids);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Replaces the fork's text/shape commit hooks; Yunari objects only need coords. */
function settle(object: FabricObject): void {
  if (object instanceof ActiveSelection || object instanceof Group) {
    for (const child of object.getObjects()) child.setCoords();
  }
  object.setCoords();
}

async function cloneOf(object: FabricObject): Promise<FabricObject> {
  const clone = await object.clone([...SCENE_PERSISTED_PROPERTIES]);
  settle(clone);
  return clone;
}

export function createClipboardManager(
  options: ClipboardManagerOptions,
): ClipboardManager {
  const { canvas, save, errors, deletion } = options;
  let held: FabricObject | undefined;
  let documentBindings: ClipboardBindings | undefined = options.bindings;
  let clipboardAssets: ClipboardAssets | undefined = options.assets;

  const add = (clone: FabricObject): void => {
    canvas.discardActiveObject();
    if (clone instanceof ActiveSelection) {
      for (const child of clone.getObjects()) canvas.add(child);
      clone.canvas = canvas;
    } else {
      canvas.add(clone);
    }
    canvas.setActiveObject(clone);
    canvas.requestRenderAll();
    canvas.fire("editor:object-pasted" as never, { object: clone } as never);
    save();
  };

  /** A portable paste is several roots rather than one clone, so they join the
   *  canvas together and leave as one selection — the same gesture a copied
   *  multi-selection takes. */
  const addMany = (clones: readonly FabricObject[]): void => {
    canvas.discardActiveObject();
    for (const clone of clones) canvas.add(clone);
    const active =
      clones.length === 1
        ? clones[0]!
        : new ActiveSelection([...clones], { canvas });
    canvas.setActiveObject(active);
    canvas.requestRenderAll();
    canvas.fire("editor:object-pasted" as never, { object: active } as never);
    save();
  };

  const place = async (source: FabricObject): Promise<boolean> => {
    const clone = await cloneOf(source);
    const ids = new Map<string, string>();
    // One set for the whole copy, object ids and binding ids alike: both are
    // unique across the document, so both mint past what is already there.
    const taken = new Set(takenIds(canvas, documentBindings));
    const issues: WidgetIssue[] = [];
    reassignIds(clone, ids, taken, new Map(), issues);
    clone.set({
      left: clone.left + PASTE_OFFSET,
      top: clone.top + PASTE_OFFSET,
    });
    settle(clone);
    // Before the clone joins the canvas, so the first paint it gets is the one
    // its own readings resolve — an object that arrived ahead of its bindings
    // would paint blank once and wait for a tick nothing had yet asked for.
    const carried =
      documentBindings === undefined
        ? {}
        : carryBindings([clone], ids, documentBindings.read(), taken, issues);
    add(clone);
    if (Object.keys(carried).length > 0) documentBindings?.write(carried);
    for (const issue of issues) {
      errors.error("clipboard", `Pasted copy: ${issue.detail}`);
    }
    return true;
  };

  /**
   * A copy read from another theme in this browser.
   *
   * The source's dead image handles are never trusted: every referenced file is
   * declared in this theme first, under its own fresh id, and only then is the
   * serialized object re-pointed and enlivened. A failure before the add leaves
   * the canvas and the envelope untouched; `ClipboardAssets.declare` rolls back
   * the declarations it made.
   */
  const placePortable = async (
    payload: PortableClipboard,
  ): Promise<boolean> => {
    let declared: DeclaredAssets = new Map();
    if (payload.assets.length > 0) {
      if (clipboardAssets === undefined)
        throw new Error("This theme cannot declare the clipboard's files.");
      const entries: ClipboardAsset[] = payload.assets.map((asset) => {
        const bytes = decodeBase64(asset.bytes);
        if (bytes === undefined)
          throw new Error("The clipboard carries unreadable file bytes.");
        return { id: asset.id, kind: asset.kind, path: asset.path, bytes };
      });
      declared = new Map(
        (await clipboardAssets.declare(entries)).map((entry) => [
          entry.from,
          entry,
        ]),
      );
    }
    for (const object of payload.objects)
      repointPortableObject(object, declared);
    const roots = await util.enlivenObjects<FabricObject>(
      payload.objects as unknown as object[],
    );
    if (roots.length !== payload.objects.length)
      throw new Error("The clipboard did not revive as objects.");
    const taken = new Set(takenIds(canvas, documentBindings));
    const issues: WidgetIssue[] = [];
    const allocators = new Map<string, (original: string) => string>();
    const ids = new Map<string, string>();
    for (const root of roots) {
      reassignIds(root, ids, taken, allocators, issues);
      root.set({
        left: root.left + PASTE_OFFSET,
        top: root.top + PASTE_OFFSET,
      });
      settle(root);
    }
    const carried =
      documentBindings === undefined
        ? {}
        : carryBindings(roots, ids, payload.bindings, taken, issues);
    addMany(roots);
    if (Object.keys(carried).length > 0) documentBindings?.write(carried);
    for (const issue of issues) {
      errors.error("clipboard", `Pasted copy: ${issue.detail}`);
    }
    return true;
  };

  const onPaste = (event: Event): void => {
    // A focused field owns its own paste, text or picture alike. Without this a
    // stored object clipboard would replace the author's typing with an object,
    // and an image on the system clipboard would import itself into the theme.
    if (isTextEntryTarget(event.target)) return;
    const data = (event as ClipboardEvent).clipboardData;
    const items = data?.items;
    if (data === null || data === undefined || items === undefined) {
      void manager.paste();
      return;
    }
    const file = [...items]
      .map((item) => (item.type.startsWith("image/") ? item.getAsFile() : null))
      .find((candidate): candidate is File => candidate !== null);
    if (file !== undefined) {
      event.preventDefault();
      void imageImporter(file).catch((error: unknown) => {
        errors.error("clipboard", "Could not paste that image.", error);
      });
      return;
    }
    void manager.paste();
  };

  let imageImporter = (file: File): Promise<unknown> =>
    options.importImage({ source: file });

  const manager: ClipboardManager = {
    async copy(): Promise<boolean> {
      const active = canvas.getActiveObject();
      if (active === undefined || isLocked(active)) return false;
      try {
        held = await cloneOf(active);
      } catch (error) {
        errors.error("clipboard", "Could not copy that selection.", error);
        return false;
      }
      // The held clone is this document's fast path. The stored payload is what
      // makes the copy reach a theme this manager will not see: a theme switch
      // builds a new shell and destroys this one.
      try {
        writePortable(portableOf(held, documentBindings, clipboardAssets));
      } catch (error) {
        // A selection whose files this theme cannot carry still copies and
        // pastes here; only the portable half is refused, and saying so is the
        // difference between a copy that worked and one that silently cannot
        // leave the document.
        errors.warn(
          "clipboard",
          "Copied, but this selection cannot be pasted into another theme.",
          error,
        );
      }
      return true;
    },

    async cut(): Promise<boolean> {
      if (!(await manager.copy())) return false;
      return deletion.deleteActive();
    },

    async paste(): Promise<boolean> {
      try {
        if (held !== undefined) return await place(held);
        const portable = readPortable();
        if (portable === undefined) return false;
        return await placePortable(portable);
      } catch (error) {
        errors.error("clipboard", "Could not paste the clipboard.", error);
        return false;
      }
    },

    async duplicate(
      object = canvas.getActiveObject() ?? undefined,
    ): Promise<boolean> {
      if (object === undefined || isLocked(object)) return false;
      try {
        return await place(object);
      } catch (error) {
        errors.error("clipboard", "Could not duplicate that selection.", error);
        return false;
      }
    },

    /** Installed by the session, which owns the envelope's bindings. A paste
     * with no owner for them is the same defect this fixes, one layer down: the
     * copy's readings would be stripped at the next save and the author told
     * nothing. */
    setBindings(bindings: ClipboardBindings): void {
      documentBindings = bindings;
    },

    /** Installed by the session, which owns the theme's declarations. The
     *  source half reads the bytes a copied object names; the destination half
     *  declares them before the paste re-points the object. */
    setAssets(assets: ClipboardAssets): void {
      clipboardAssets = assets;
    },

    /** Replaces the image importer.
     *
     * The shell builds this manager before the session exists, and the session
     * owns the asset manager, so the importer that makes a pasted image a
     * *declared asset* rather than a session-local `blob:` URL is installed from
     * there. Half the fix here is worse than none: the image appears, saves,
     * and is gone everywhere else.
     */
    setImageImporter(importer: ImageImporter): void {
      imageImporter = importer;
    },

    destroy(): void {
      document.removeEventListener("paste", onPaste);
      held = undefined;
    },
  };

  document.addEventListener("paste", onPaste);
  return manager;
}
