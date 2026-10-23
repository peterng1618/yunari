import type { FabricGlobals } from "@yunari/renderer-core";
import { type SerialisedScene, targetsOf } from "@yunari/scene-fabric";
import { ActiveSelection, type Canvas, type FabricObject } from "fabric/es";

type HistoryCanvas = Canvas;

/** The envelope's half of undo state. The scene is the canvas's; the palette
 *  and type presets are the document's, so history asks its host for them
 *  rather than reaching into an envelope it does not own. */
export interface HistoryGlobalsPort {
  readonly read: () => FabricGlobals | undefined;
  readonly write: (globals: FabricGlobals | undefined) => void;
}

interface HistoryEntry {
  readonly scene: SerialisedScene;
  readonly globals: FabricGlobals | undefined;
}

/** Owns authored Fabric-scene undo state. The selection is not undo state, but
 *  a revive replaces every object the selection held, so carrying it across is
 *  part of undoing rather than something this hands back to its caller. */
export class EditorHistory {
  readonly #canvas: HistoryCanvas;
  readonly #serialize: (canvas: HistoryCanvas) => SerialisedScene;
  readonly #revive: (
    canvas: HistoryCanvas,
    scene: SerialisedScene,
  ) => Promise<void>;
  #entries: HistoryEntry[] = [];
  #index = -1;
  #suspended = 0;
  #restoring: Promise<void> = Promise.resolve();
  #port: HistoryGlobalsPort | undefined;

  constructor(options: {
    readonly canvas: HistoryCanvas;
    readonly serialize: (canvas: HistoryCanvas) => SerialisedScene;
    readonly revive: (
      canvas: HistoryCanvas,
      scene: SerialisedScene,
    ) => Promise<void>;
  }) {
    this.#canvas = options.canvas;
    this.#serialize = options.serialize;
    this.#revive = options.revive;
  }

  get canRedo(): boolean {
    return this.#index + 1 < this.#entries.length;
  }

  reset(): void {
    this.#entries = [this.#capture(this.#serialize(this.#canvas))];
    this.#index = 0;
  }

  /** Tells history where an entry's envelope half comes from. The shell resets
   *  while creating the editor, before the document exists, so this arrives
   *  after `reset()` and patches the entry it could not capture. Undoing to
   *  entry 0 must restore the palette the author started with, not delete it. */
  attachGlobals(port: HistoryGlobalsPort): void {
    this.#port = port;
    const entry = this.#entries[this.#index];
    if (entry === undefined) return;
    this.#entries[this.#index] = { ...entry, globals: port.read() };
  }

  /** Interactive sessions mutate the canvas before the user commits. */
  suspend(): () => void {
    this.#suspended += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#suspended -= 1;
    };
  }

  save(): void {
    if (this.#suspended > 0) return;
    const entry = this.#capture(this.#serialize(this.#canvas));
    if (sameEntry(entry, this.#entries[this.#index])) return;
    this.#entries.splice(this.#index + 1);
    this.#entries.push(entry);
    this.#index += 1;
    // A recorded entry is the one signal that an edit landed, so it is where a
    // reason the author was given goes stale. A refused edit records nothing
    // and so never reaches here: the refusal survives the field that raised it.
    this.#canvas.fire("editor:edit-committed" as never);
  }

  undo(): Promise<void> {
    return this.#queued(async () => {
      if (this.#index > 0) await this.#restore(this.#index - 1);
    });
  }

  redo(): Promise<void> {
    return this.#queued(async () => {
      if (this.canRedo) await this.#restore(this.#index + 1);
    });
  }

  /** One restore at a time. A restore is asynchronous, so two presses that both
   *  read the index before either finishes land on the same entry: two presses
   *  undo one edit, and an author who presses again after seeing nothing happen
   *  walks the history backwards in steps of one that are really steps of two. */
  #queued(restore: () => Promise<void>): Promise<void> {
    const next = this.#restoring.then(restore, restore);
    this.#restoring = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /** `scene` and `globals` captured together, so one entry is one authored
   *  state: the palette alone can change while no Fabric object moves. */
  #capture(scene: SerialisedScene): HistoryEntry {
    return { scene, globals: this.#port?.read() };
  }

  async #restore(index: number): Promise<void> {
    const entry = this.#entries[index];
    if (entry === undefined) return;
    const selected = selectedIds(this.#canvas);
    this.#suspended += 1;
    try {
      await this.#revive(this.#canvas, entry.scene);
      // After the revive: the scene is what the globals were authored against.
      this.#port?.write(entry.globals);
      reselect(this.#canvas, selected);
      this.#index = index;
      this.#canvas.fire("editor:history-state-loaded" as never);
    } finally {
      this.#suspended -= 1;
    }
  }
}

/** What the author had selected, by id — a revive replaces every object, so the
 *  instances Fabric is holding are the ones that go. */
function selectedIds(canvas: HistoryCanvas): readonly string[] {
  const active = canvas.getActiveObject();
  if (active === undefined) return [];
  const objects = targetsOf(active);
  return objects
    .map((object) => object.get("id"))
    .filter((id): id is string => typeof id === "string");
}

/** Whatever survived the revive, in the order the author had it. Nothing found
 *  selects nothing: the undo removed what was selected, or what was selected was
 *  never an authored object. A group child is only ever selected on its own —
 *  a multi-selection is a box the canvas owns, and it cannot own a child's. */
function reselect(canvas: HistoryCanvas, ids: readonly string[]): void {
  if (ids.length === 0) return;
  const byId = new Map<string, FabricObject>();
  const walk = (objects: readonly FabricObject[]): void => {
    for (const object of objects) {
      const id = object.get("id");
      if (typeof id === "string") byId.set(id, object);
      const children = (
        object as FabricObject & {
          getObjects?: () => FabricObject[];
        }
      ).getObjects;
      if (typeof children === "function") walk(children.call(object));
    }
  };
  const topLevel = canvas.getObjects();
  walk(topLevel);
  const onCanvas = new Set(topLevel);
  const found = ids
    .map((id) => byId.get(id))
    .filter((object): object is FabricObject => object !== undefined);
  const only = found.length === 1 ? found[0] : undefined;
  if (only !== undefined) {
    canvas.setActiveObject(only);
    return;
  }
  const many = found.filter((object) => onCanvas.has(object));
  if (many.length > 0)
    canvas.setActiveObject(new ActiveSelection(many, { canvas }));
}

function sameEntry(
  left: HistoryEntry,
  right: HistoryEntry | undefined,
): boolean {
  return right !== undefined && JSON.stringify(left) === JSON.stringify(right);
}
