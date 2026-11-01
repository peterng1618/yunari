import { type Globals, objectName } from "@yunari/renderer-core";
import { type FabricObject, type StaticCanvas } from "fabric/es";
import { YUNARI_TEXT_PROPERTY } from "./fabric-text.js";
import { visitSceneObjects } from "./scene-objects.js";

/**
 * Reapply the first authored run's type token face to its Fabric text-object.
 *
 * This is the v2 path's owner of the object-level *face*: a v2 document stores
 * a token *reference* per run and Fabric's own resolved text properties on the
 * object, and the display revives the object without resolving anything. Size,
 * leading and tracking are the run's own style and are painted by
 * `applyAuthoredText`/`refreshBoundText`; a face that never reaches the object
 * here is authored, editable and invisible everywhere except the editor.
 */
export function applyObjectTypeTokens(
  canvas: StaticCanvas,
  globals: Globals | undefined,
): void {
  if (
    typeof (canvas as unknown as { getObjects?: unknown }).getObjects !==
    "function"
  )
    return;
  applyTypes(canvas.getObjects(), globals);
  canvas.requestRenderAll();
}

/** One object that names a type token, and where. */
export interface TypeTokenReference {
  /** The object's authored id — the key the layer list and bindings use. */
  readonly objectId: string;
  /** The name the author reads, or its id when the object carries none (§75). */
  readonly name: string;
  /** Zero-based run indexes that name the token. */
  readonly runs: readonly number[];
}

/**
 * Every object naming `ref`, at any depth.
 *
 * The read side of the same walk `reassignObjectTypeTokenReferences` performs.
 * The two must stay one traversal: a panel reading "3 uses" while a delete
 * guard counts something else is how a token is removed from under a live
 * object, and the grouped case is the one that regresses — a root-only walk
 * cannot see inside a group, so it calls a token unused while a grouped object
 * is set in it.
 *
 * One entry per **object**, not per run: a panel whose runs all name the token
 * is one object the author has to look at.
 */
export function objectTypeTokenReferences(
  objects: readonly FabricObject[],
  ref: `typeTokens.${string}`,
): readonly TypeTokenReference[] {
  const found: TypeTokenReference[] = [];
  visitSceneObjects(objects, (object) => {
    const runs: number[] = [];
    const text = object.get(YUNARI_TEXT_PROPERTY);
    if (isAuthoredText(text)) {
      text.runs.forEach((run, index) => {
        if (run.typeToken === ref) runs.push(index);
      });
    }
    if (runs.length > 0) {
      const objectId = object.get("id");
      const id = typeof objectId === "string" ? objectId : "";
      found.push({ objectId: id, name: objectName(object) ?? id, runs });
    }
  });
  return found;
}

/** Rewrite persisted text-run preset references before a preset is removed. */
export function reassignObjectTypeTokenReferences(
  canvas: StaticCanvas,
  from: `typeTokens.${string}`,
  to: `typeTokens.${string}`,
): number {
  let changes = 0;
  visitSceneObjects(canvas.getObjects(), (object) => {
    const text = object.get(YUNARI_TEXT_PROPERTY);
    if (isAuthoredText(text)) {
      const runs = text.runs.map((run) => {
        if (run.typeToken !== from) return run;
        changes += 1;
        return { ...run, typeToken: to };
      });
      object.set(YUNARI_TEXT_PROPERTY, { ...text, runs });
    }
  });
  return changes;
}

function applyTypes(
  objects: readonly FabricObject[],
  globals: Globals | undefined,
): void {
  visitSceneObjects(objects, (object) => {
    const run = firstRun(object.get(YUNARI_TEXT_PROPERTY));
    const ref = run?.["typeToken"];
    const value =
      typeof ref === "string" && ref.startsWith("typeTokens.")
        ? globals?.typeTokens?.[ref.slice("typeTokens.".length)]
        : undefined;
    if (isPreset(value)) {
      object.set({
        fontFamily: value.family,
        ...(value.weight === undefined ? {} : { fontWeight: value.weight }),
      });
    }
  });
}

type Preset = {
  family: string;
  weight?: string | number;
};

type AuthoredRun = {
  readonly typeToken?: string;
  readonly [key: string]: unknown;
};
type AuthoredText = {
  readonly runs: readonly AuthoredRun[];
  readonly [key: string]: unknown;
};

function firstRun(value: unknown): Record<string, unknown> | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    !Array.isArray((value as Record<string, unknown>)["runs"])
  )
    return undefined;
  const run = (value as { runs: unknown[] }).runs[0];
  return typeof run === "object" && run !== null
    ? (run as Record<string, unknown>)
    : undefined;
}

function isAuthoredText(value: unknown): value is AuthoredText {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as Record<string, unknown>)["runs"])
  );
}

function isPreset(value: unknown): value is Preset {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)["family"] === "string"
  );
}
