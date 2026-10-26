import { reassignObjectTypeTokenReferences } from "@yunari/scene-fabric";
import type { Canvas } from "fabric/es";
import type { TypeTokens } from "./panel.js";

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
