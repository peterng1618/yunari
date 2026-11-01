import { type FabricObject, Group } from "fabric/es";

/**
 * Visit every object the scene holds, at any depth, roots first.
 *
 * Fabric's `getObjects()` is the root only; a `Group` keeps its children in its
 * own collection. A walk that stops at the root calls a grouped object absent —
 * an image the author had grouped reported itself unused, and a binding keyed by
 * an object inside a card read as dangling — so every "what does the scene
 * hold" question spends this one traversal and keeps its own question in the
 * callback.
 *
 * Groups are visited as well as leaves, in pre-order: an object precedes its
 * children, and siblings keep their authored order.
 */
export function visitSceneObjects(
  objects: readonly FabricObject[],
  visit: (object: FabricObject) => void,
): void {
  for (const object of objects) {
    visit(object);
    if (object instanceof Group) visitSceneObjects(object.getObjects(), visit);
  }
}

/** Every object the scene holds, at any depth, roots first. */
export function sceneObjects(
  objects: readonly FabricObject[],
): readonly FabricObject[] {
  const found: FabricObject[] = [];
  visitSceneObjects(objects, (object) => found.push(object));
  return found;
}
