import {
  type Artboard,
  type Background,
  type Binding,
  createWidgetIdAllocator,
  type FabricPalette,
  type FabricThemeEnvelope,
  type TypeToken,
} from "@yunari/renderer-core";
import type { ObjectJson } from "./objects.js";

/**
 * Mutations over a persisted Fabric envelope.
 *
 * Every function returns a new envelope and never writes to the one it was
 * given: a draft, an undo entry and the document on screen all read the same
 * value, and an in-place edit would move one of them behind the others' backs.
 *
 * The scene stays the envelope's own opaque `{version, objects}` record. Nothing
 * here introduces a second simplified scene tree.
 */

/** One object the scene holds, at any depth. */
export interface SceneObjectInfo {
  readonly id: string;
  readonly type: string | undefined;
  readonly name: string | undefined;
}

interface SceneRecord {
  readonly version?: unknown;
  readonly objects?: readonly ObjectJson[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function childrenOf(object: ObjectJson): readonly ObjectJson[] {
  const children = object["objects"];
  return Array.isArray(children) ? children.filter(isRecord) : [];
}

function idOf(object: ObjectJson): string | undefined {
  const id = object["id"];
  return typeof id === "string" ? id : undefined;
}

function sceneOf(envelope: FabricThemeEnvelope): {
  readonly scene: SceneRecord;
  readonly objects: readonly ObjectJson[];
} {
  const scene = isRecord(envelope.scene) ? (envelope.scene as SceneRecord) : {};
  return {
    scene,
    objects: Array.isArray(scene.objects) ? scene.objects.filter(isRecord) : [],
  };
}

/** Every object the scene holds, roots first. */
export function listSceneObjects(
  envelope: FabricThemeEnvelope,
): readonly SceneObjectInfo[] {
  const found: SceneObjectInfo[] = [];
  const walk = (objects: readonly ObjectJson[]): void => {
    for (const object of objects) {
      const id = idOf(object);
      if (id !== undefined) {
        const type = object["type"];
        const name = object["name"];
        found.push({
          id,
          type: typeof type === "string" ? type : undefined,
          name: typeof name === "string" ? name : undefined,
        });
      }
      walk(childrenOf(object));
    }
  };
  walk(sceneOf(envelope).objects);
  return found;
}

/**
 * Appends one object subtree, minting a fresh id for every object in it.
 *
 * The allocator is the same one a card copy and a paste use, so an object
 * inserted through this API cannot collide with what the canvas already holds.
 * Bindings may be the root object's list or a record keyed by the authored ids;
 * either way they land under the minted ids.
 */
export function addSceneObject(
  envelope: FabricThemeEnvelope,
  object: ObjectJson,
  bindings?: readonly Binding[] | Readonly<Record<string, readonly Binding[]>>,
): { readonly envelope: FabricThemeEnvelope; readonly ids: readonly string[] } {
  const next = clone(envelope);
  const { scene, objects } = sceneOf(next);
  const issues: Parameters<typeof createWidgetIdAllocator>[2] = [];
  const existingBindings = Object.values(next.bindings ?? {}).flatMap((list) =>
    list.map((binding) => binding.id),
  );
  const allocateId = createWidgetIdAllocator(
    "object",
    [...listSceneObjects(next).map((entry) => entry.id), ...existingBindings],
    issues,
  );

  const minted = new Map<string, string>();
  const ids: string[] = [];
  const copy = (source: ObjectJson): ObjectJson => {
    const authored = idOf(source);
    const id = authored === undefined ? undefined : allocateId(authored);
    if (authored !== undefined && id !== undefined) {
      minted.set(authored, id);
      ids.push(id);
    }
    const children = childrenOf(source);
    return {
      ...source,
      ...(id === undefined ? {} : { id }),
      ...(children.length === 0 ? {} : { objects: children.map(copy) }),
    };
  };
  const added = copy(object);

  const merged: Record<string, readonly Binding[]> = {
    ...(next.bindings ?? {}),
  };
  const remap = (record: Readonly<Record<string, readonly Binding[]>>) => {
    for (const [authoredId, list] of Object.entries(record)) {
      merged[minted.get(authoredId) ?? authoredId] = list;
    }
  };
  if (Array.isArray(bindings)) {
    const root = idOf(added);
    if (root !== undefined && bindings.length > 0) merged[root] = bindings;
  } else if (isRecord(bindings)) {
    remap(bindings as Readonly<Record<string, readonly Binding[]>>);
  }

  return {
    envelope: {
      ...next,
      scene: {
        ...scene,
        version: scene.version ?? "7.4.0",
        objects: [...objects, added],
      },
      bindings: merged,
    },
    ids,
  };
}

/**
 * Shallow-merges `patch` into the object with `id`, at any depth.
 *
 * A shallow merge is what a validated JSON merge means for a scene object: the
 * caller hands the fields it owns and the rest of the object stays authored.
 */
export function updateSceneObject(
  envelope: FabricThemeEnvelope,
  id: string,
  patch: ObjectJson,
): FabricThemeEnvelope {
  const next = clone(envelope);
  const { scene, objects } = sceneOf(next);
  let updated = false;
  const walk = (list: readonly ObjectJson[]): readonly ObjectJson[] =>
    list.map((object) => {
      if (idOf(object) === id) {
        updated = true;
        return { ...object, ...patch };
      }
      const children = childrenOf(object);
      return children.length === 0
        ? object
        : { ...object, objects: walk(children) };
    });
  const write = walk(objects);
  if (!updated) throw new Error(`There is no object "${id}" in this scene.`);
  return { ...next, scene: { ...scene, objects: write } };
}

/** Removes the object with `id`, and every binding it carried. */
export function removeSceneObject(
  envelope: FabricThemeEnvelope,
  id: string,
): FabricThemeEnvelope {
  const next = clone(envelope);
  const { scene, objects } = sceneOf(next);
  const removed = new Set<string>();
  const walk = (list: readonly ObjectJson[]): readonly ObjectJson[] =>
    list
      .filter((object) => {
        const objectId = idOf(object);
        if (objectId === id) {
          collectIds(object, removed);
          return false;
        }
        return true;
      })
      .map((object) => {
        const children = childrenOf(object);
        return children.length === 0
          ? object
          : { ...object, objects: walk(children) };
      });
  const write = walk(objects);
  if (removed.size === 0)
    throw new Error(`There is no object "${id}" in this scene.`);
  const bindings = Object.fromEntries(
    Object.entries(next.bindings ?? {}).filter(([key]) => !removed.has(key)),
  );
  return {
    ...next,
    scene: { ...scene, objects: write },
    bindings,
  };
}

function collectIds(object: ObjectJson, into: Set<string>): void {
  const id = idOf(object);
  if (id !== undefined) into.add(id);
  for (const child of childrenOf(object)) collectIds(child, into);
}

/** Replaces one object's binding list; other objects keep theirs. */
export function setBindings(
  envelope: FabricThemeEnvelope,
  id: string,
  bindings: readonly Binding[],
): FabricThemeEnvelope {
  const next = clone(envelope);
  const merged = { ...(next.bindings ?? {}) };
  if (bindings.length === 0) delete merged[id];
  else merged[id] = bindings;
  return { ...next, bindings: merged };
}

export function setPalette(
  envelope: FabricThemeEnvelope,
  palette: FabricPalette,
): FabricThemeEnvelope {
  const next = clone(envelope);
  return {
    ...next,
    globals: { ...next.globals, palette },
  };
}

export function setTypeTokens(
  envelope: FabricThemeEnvelope,
  typeTokens: Readonly<Record<string, TypeToken>>,
): FabricThemeEnvelope {
  const next = clone(envelope);
  return {
    ...next,
    globals: { ...next.globals, typeTokens },
  };
}

export function setArtboard(
  envelope: FabricThemeEnvelope,
  artboard: Artboard,
): FabricThemeEnvelope {
  const next = clone(envelope);
  return { ...next, artboard };
}

export function setBackground(
  envelope: FabricThemeEnvelope,
  background: Background | undefined,
): FabricThemeEnvelope {
  const next = clone(envelope);
  if (background === undefined) {
    const { background: _background, ...withoutBackground } = next;
    return withoutBackground;
  }
  return { ...next, background };
}
