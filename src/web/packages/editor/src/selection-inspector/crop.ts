import type { FabricObject } from "fabric/es";
import { canCrop } from "../crop-manager/index.js";
import type { EditorInteraction } from "../editor-interaction.js";
import type { CropView } from "./view.js";

/**
 * The control over a selected image's crop.
 *
 * It lives in the selection inspector rather than in the Add pane's file
 * section because it acts on the *selection*, not on the asset library: an
 * author crops the image they have already placed, and the Assets pane lists
 * and replaces what the package declares. The inspector is where a control over
 * a selected object already lives.
 *
 * The session is `crop-manager`'s. This starts one, locks a ratio, and applies
 * or abandons it; it owns none of the drag, because the drag is Fabric's own
 * handles on the frame the session installs.
 *
 * The row is a value: `cropView` projects the session's state and `index.ts`
 * owns the four commands, so React holds no session and no Fabric object.
 */

/** The ratios an author is offered, as width over height. */
export const CROP_ASPECTS: readonly (readonly [
  label: string,
  ratio: number,
])[] = [
  ["1:1", 1],
  ["4:3", 4 / 3],
  ["16:9", 16 / 9],
];

/**
 * The crop row for one selection, or undefined when there is nothing to crop.
 *
 * While a session is open the row shows the session's own controls and ignores
 * the selection: the session has made its frame the active object, so the
 * selection is the frame rather than the image the author is cropping.
 *
 * `canStart` is asked on the image, and `canCrop` withholds a rotated one the
 * session itself would refuse — the predicate is the owner's, not a copy.
 */
export function cropView(
  editor: EditorInteraction,
  object: FabricObject | undefined,
): CropView | undefined {
  if (editor.cropManager.active) return { active: true, canStart: false };
  if (object === undefined || !canCrop(object)) return undefined;
  return { active: false, canStart: true };
}
