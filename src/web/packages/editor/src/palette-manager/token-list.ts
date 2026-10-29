import type { FabricPalette } from "@yunari/renderer-core";

/**
 * The tokens a palette lists, in the order the document declares them.
 *
 * **The reserved `none` is not one of them.** It is the transparent token with
 * a fixed value and no paint kind of its own, so a row for it would be a control
 * that opens a field set refusing every edit; it stays a reassignment target,
 * which is the one thing an author has it for.
 *
 * Its own module rather than a helper beside the panel, because the two readers
 * are on opposite sides of the React boundary: `PaintList` draws the rows, and
 * the bridge's snapshot counts them for the pane's title bar. Importing
 * the panel from the bridge would pull a React tree into the shell's projection,
 * and importing the bridge from the panel is worse — so the membership rule the
 * two must agree on lives here, where neither owns it.
 */
export function paletteTokenIds(palette: FabricPalette): readonly string[] {
  return Object.keys(palette).filter((id) => id !== "none");
}
