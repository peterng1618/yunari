import { isTypeTokenRole } from "./document.js";

/**
 * A role's default size as a share of the artboard height: heading 1/15,
 * body 1/67.5, mono 1/77 — 72/16/14 at 1080.
 *
 * One owner so the editor's inspector and the player's canvas agree; a token
 * whose id is not a role takes the body ratio.
 */
const TYPE_SIZE_RATIOS = {
  heading: 1 / 15,
  body: 1 / 67.5,
  mono: 1 / 77,
} as const;

/** The size a run takes when it authors none, rounded, never below 1. */
export function defaultTypeSize(id: string, artboardHeight: number): number {
  const ratio = isTypeTokenRole(id)
    ? TYPE_SIZE_RATIOS[id]
    : TYPE_SIZE_RATIOS.body;
  return Math.max(1, Math.round(artboardHeight * ratio));
}
