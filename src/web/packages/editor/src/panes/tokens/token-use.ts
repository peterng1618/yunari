import { uiCopy } from "../../ui-copy.js";

/** One object a design token is linked to. The name is what the pane shows;
 *  the id is the stable key the layer list and every binding use (§75). */
export interface TokenUse {
  readonly objectId: string;
  readonly name: string;
}

/** Every token's objects, keyed by token id. Shared by both token kinds,
 *  because a paint and a type token answer the same question — which layers
 *  carry me — and the two lists must not spell that answer twice. */
export type TokenUsage = Readonly<Record<string, readonly TokenUse[]>>;

/** The figure beside a token. A missing reading is stated, never a default:
 *  with no scene to read the pane says so rather than fabricating a zero
 *  (§97). */
export function usageFigure(uses: TokenUsage | undefined, id: string): string {
  if (uses === undefined) return uiCopy.panels.notSet;
  return String((uses[id] ?? []).length);
}
