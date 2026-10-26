import { type FabricGlobals, type FabricPalette } from "@yunari/renderer-core";
import type { FabricObject } from "fabric/es";
import type { EditorInteraction } from "../editor-interaction.js";
import { uiCopy } from "../ui-copy.js";
import { textRunsOf } from "./authored-text.js";
import type { FieldView } from "./view.js";

/**
 * Appearance of the selected object: its opacity and its name.
 *
 * The two resolvers below are the palette and preset panels' own answer to what
 * a reference means, kept here so a surface that shows a token's value calls the
 * existing owner rather than resolving a second time.
 */

export interface AppearanceContext {
  readonly editor: EditorInteraction;
  readonly globals: FabricGlobals | undefined;
}

/** What a palette token currently resolves to, for display. */
export function resolveToken(
  globals: FabricGlobals | undefined,
  ref: string | undefined,
): string | undefined {
  if (ref === undefined || !ref.startsWith("palette.")) {
    return undefined;
  }

  const palette = globals?.palette as FabricPalette | undefined;
  const entry = palette?.[ref.slice("palette.".length)];
  if (entry === undefined) {
    return undefined;
  }

  const value = entry.value as
    | { readonly kind?: string; readonly color?: string }
    | string;

  if (typeof value === "string") {
    return value;
  }

  return value.kind === "gradient" ? "gradient" : value.color;
}

/**
 * The type token a text object is set in. The model names a token per *run*,
 * and `applyObjectTypeTokens` paints the object from its first run, so the
 * object's own type is that same run's reference — one owner, not a second rule.
 */
export function typeTokenOf(
  object: FabricObject,
): `typeTokens.${string}` | undefined {
  const ref = textRunsOf(object)[0]?.typeToken;
  return ref === undefined ? undefined : ref;
}

/** What a type token resolves to, in the terms the author chose it by. */
export function resolveTypeToken(
  globals: FabricGlobals | undefined,
  ref: string | undefined,
): string | undefined {
  if (ref === undefined || !ref.startsWith("typeTokens.")) {
    return undefined;
  }

  const value = globals?.typeTokens?.[ref.slice("typeTokens.".length)];
  if (value === undefined) {
    return undefined;
  }

  // "Inter 600" — the family and weight the author would see in the token
  // panel, without duplicating its fields. Size lives on the run now.
  return [value.family, value.weight]
    .filter((part) => part !== undefined && part !== "")
    .join(" ");
}
/**
 * Opacity, shown as a percentage and stored as Fabric's 0–1.
 *
 * A bounded number — Fabric's own 0–1, projected here as 0–100 — so it is a
 * slider: DESIGN.md §5's vocabulary says a bounded number gets a track, and
 * `inspector-controls.html` names opacity as its example. The glass blur drew
 * the same conclusion one directory away. The percentage conversion is the
 * projection's, so the number an author reads is the number the row commits,
 * and `writeOpacity` still refuses a value outside 0–100 before it writes — the
 * control's bounds stop the gesture, and the writer is the guard for a
 * bypassed commit.
 */
export function opacityField(object: FabricObject): FieldView {
  return {
    id: "opacity",
    control: "slider",
    label: uiCopy.inspectorFields.opacity,
    value: Math.round(object.opacity * 100),
    min: 0,
    max: 100,
    integer: true,
    data: { "data-yunari-opacity": "" },
  };
}
