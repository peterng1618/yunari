import {
  type Binding,
  createWidgetIdAllocator,
  type WidgetIssue,
} from "@yunari/renderer-core";
import {
  isLocked,
  SCENE_PERSISTED_PROPERTIES,
  visitSceneObjects,
  YUNARI_TEXT_PROPERTY,
} from "@yunari/scene-fabric";
import {
  ActiveSelection,
  type Canvas,
  type FabricObject,
  Group,
} from "fabric/es";
import type { DeletionManager } from "../deletion-manager/index.js";
import type { ErrorManager } from "../error-manager/index.js";
import type { ImageManager } from "../image-manager/index.js";

const PASTE_OFFSET = 10;

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
  destroy(): void;
}

interface ClipboardManagerOptions {
  readonly canvas: Canvas;
  readonly save: () => void;
  readonly errors: ErrorManager;
  readonly deletion: DeletionManager;
  readonly importImage: ImageManager["importImage"];
  readonly bindings?: ClipboardBindings;
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
  object: FabricObject,
  ids: ReadonlyMap<string, string>,
  bindings: ClipboardBindings,
  taken: Set<string>,
  issues: WidgetIssue[],
): Readonly<Record<string, readonly Binding[]>> {
  const held = bindings.read();
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
  if (repoint.size > 0) repointRuns(object, repoint);
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
        : carryBindings(clone, ids, documentBindings, taken, issues);
    add(clone);
    if (Object.keys(carried).length > 0) documentBindings?.write(carried);
    for (const issue of issues) {
      errors.error("clipboard", `Pasted copy: ${issue.detail}`);
    }
    return true;
  };

  const onPaste = (event: Event): void => {
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
        return true;
      } catch (error) {
        errors.error("clipboard", "Could not copy that selection.", error);
        return false;
      }
    },

    async cut(): Promise<boolean> {
      if (!(await manager.copy())) return false;
      return deletion.deleteActive();
    },

    async paste(): Promise<boolean> {
      if (held === undefined) return false;
      try {
        return await place(held);
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
