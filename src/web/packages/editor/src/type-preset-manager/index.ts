import {
  objectTypeTokenReferences,
  reassignObjectTypeTokenReferences,
} from "@yunari/scene-fabric";
import type { Canvas } from "fabric/es";
import type { TokenUse } from "../panes/tokens/token-use.js";
import type { TypeTokens } from "./panel.js";

/**
 * Every type token's objects, read from the live scene.
 *
 * This sits beside `reassignTypeToken` on purpose. Both go through the same
 * walk in `scene-fabric`, so the figure the author reads beside a token and the
 * set a deletion moves come from one answer — a token reported unused is
 * unused in the sense the delete will act on.
 */
export function typeTokenUsage(
  canvas: Canvas,
  typeTokens: TypeTokens,
): Record<string, readonly TokenUse[]> {
  const objects = canvas.getObjects();
  const usage: Record<string, readonly TokenUse[]> = {};
  for (const id of Object.keys(typeTokens)) {
    usage[id] = objectTypeTokenReferences(
      objects,
      `typeTokens.${id}` as `typeTokens.${string}`,
    );
  }
  return usage;
}

/** Rewrites every canvas reference to a deleted type preset and drops it. */
export function reassignTypeToken(
  canvas: Canvas,
  typeTokens: TypeTokens,
  id: string,
  replacement: string,
): TypeTokens {
  reassignObjectTypeTokenReferences(
    canvas,
    `typeTokens.${id}` as const,
    `typeTokens.${replacement}` as const,
  );
  const next = { ...typeTokens };
  delete next[id];
  return next;
}

export {
  createTypeTokenPanel,
  type TypeTokenFontActions,
  type TypeTokenPanel,
  type TypeTokens,
} from "./panel.js";
