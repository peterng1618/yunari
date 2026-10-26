import type { Globals } from "@yunari/renderer-core";
import { Group, type StaticCanvas } from "fabric/es";
import { YUNARI_TEXT_PROPERTY } from "./fabric-text.js";

/**
 * Reapply the first authored run's type preset to its Fabric text-object cache.
 *
 * This is the v2 path's owner of object-level type: a v2 document stores a
 * preset *reference* per run and Fabric's own resolved text properties on the
 * object, and the display revives the object without resolving anything. A
 * preset field that never reaches the object here is authored, editable and
 * invisible everywhere except the editor.
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

/** Rewrite persisted text-run preset references before a preset is removed. */
export function reassignObjectTypeTokenReferences(
  canvas: StaticCanvas,
  from: `typeTokens.${string}`,
  to: `typeTokens.${string}`,
): number {
  let changes = 0;
  const visit = (objects: readonly ReassignableObject[]): void => {
    for (const object of objects) {
      const text = object.get(YUNARI_TEXT_PROPERTY);
      if (isAuthoredText(text)) {
        const runs = text.runs.map((run) => {
          if (run.typeToken !== from) return run;
          changes += 1;
          return { ...run, typeToken: to };
        });
        object.set(YUNARI_TEXT_PROPERTY, { ...text, runs });
      }
      if (object instanceof Group) visit(object.getObjects());
    }
  };
  visit(canvas.getObjects());
  return changes;
}

function applyTypes(
  objects: readonly PaintableObject[],
  globals: Globals | undefined,
): void {
  for (const object of objects) {
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
    if (object instanceof Group) applyTypes(object.getObjects(), globals);
  }
}

type Preset = {
  family: string;
  weight?: string | number;
};

type PaintableObject = {
  get(name: string): unknown;
  set(value: Record<string, unknown>): unknown;
};
type ReassignableObject = {
  get(name: string): unknown;
  set(name: string, value: unknown): unknown;
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
