import type { PanelGeometry } from "./panel-device.js";

/**
 * How a display's mounting angle turns a panel's clip.
 *
 * **One rule, both families.** The device decodes the clip itself and never
 * sees the page, so the record's angle has to be composed into the pixels. The
 * player's display-bounded media layer states what that looks like
 * (`scene-fabric`'s `displayBox`): the layer is laid out in a box turned with
 * the composition — a quarter turn swaps its edges, so it still covers the
 * glass once it turns — and the layer itself turns about its centre.
 *
 * Each encoder applies the rule to its own wire geometry: 800×480 landscape for
 * the TURZX, 464×1920 portrait for the TUR USB, where the same rule is what
 * makes a 90° record the measured upright picture on the 9.2".
 */

/** Quarter turns a panel's decoder can be handed. */
export type PanelVideoTurn = "none" | "cw" | "half" | "ccw";

/** The two display shapes `renderer-core`'s mount rule distinguishes. */
export type PanelDisplayShape = "rect" | "circle";

/** What one display record asks the encoder to do with its clip. */
export type PanelVideoRotation =
  | { readonly kind: "turn"; readonly turn: PanelVideoTurn }
  | { readonly kind: "angle"; readonly degrees: number };

/** The turn a whole angle asks for, or `undefined` for one no panel composes. */
export function videoTurn(rotation: number): PanelVideoTurn | undefined {
  switch (rotation) {
    case 0:
      return "none";
    case 90:
      return "cw";
    case 180:
      return "half";
    case 270:
      return "ccw";
    default:
      return undefined;
  }
}

/**
 * The rotation one display asks of its panel's clip, or `undefined` when the
 * record is not one the mount rule allows.
 *
 * **One rule with the player.** `renderer-core` lets a rectangle take exactly
 * the quarter turns and a circle take any whole degree below 360. A quarter
 * turn is composed by transposing the frame; a circle's other angles are
 * composed by rotating it.
 */
export function videoRotation(
  rotation: number,
  shape: PanelDisplayShape,
): PanelVideoRotation | undefined {
  const turn = videoTurn(rotation);
  if (turn !== undefined) return { kind: "turn", turn };
  if (shape !== "circle") return undefined;
  if (!Number.isInteger(rotation) || rotation < 0 || rotation >= 360)
    return undefined;
  return { kind: "angle", degrees: rotation };
}

/** The box the media layer is laid out in before it turns.
 *
 *  A quarter turn swaps the wire geometry's edges, because the turned layer has
 *  to cover the same glass the upright one did. An arbitrary angle keeps the
 *  frame and is cropped back to it after rotating. */
export function turnedBox(
  geometry: PanelGeometry,
  turn: PanelVideoTurn,
): { readonly width: number; readonly height: number } {
  return turn === "cw" || turn === "ccw"
    ? { width: geometry.height, height: geometry.width }
    : { width: geometry.width, height: geometry.height };
}

/** The layout box a whole rotation asks for. */
export function rotationBox(
  geometry: PanelGeometry,
  rotation: PanelVideoRotation,
): { readonly width: number; readonly height: number } {
  return rotation.kind === "turn"
    ? turnedBox(geometry, rotation.turn)
    : { width: geometry.width, height: geometry.height };
}

/** The ffmpeg `-vf` fragment that turns the scaled picture onto the wire frame;
 *  empty when the display is upright. */
export function turnFilter(turn: PanelVideoTurn): string {
  switch (turn) {
    case "cw":
      return ",transpose=1";
    case "half":
      return ",hflip,vflip";
    case "ccw":
      return ",transpose=2";
    case "none":
      return "";
  }
}

/** The ffmpeg fragment that mirrors the placed media in its own frame.
 *
 *  Applied before the turn, because the page mirrors the media layer inside the
 *  box and turns the box as a whole: flipping after the turn would mirror the
 *  screen, which is the opposite axis once the display is at 90°. */
export function flipFilter(placement: {
  readonly flipX?: boolean;
  readonly flipY?: boolean;
}): string {
  const x = placement.flipX === true ? ",hflip" : "";
  const y = placement.flipY === true ? ",vflip" : "";
  return `${x}${y}`;
}

/** The ffmpeg fragment that turns an arbitrary circle angle, cropped back to
 *  the wire frame afterwards. The corners the rotation exposes are outside a
 *  round display's glass. */
export function angleFilter(
  degrees: number,
  box: { readonly width: number; readonly height: number },
): string {
  return (
    `,rotate=${String(degrees)}*PI/180:ow=rotw(iw):oh=roth(ih):c=black` +
    `,scale=${String(box.width)}:${String(box.height)}` +
    `:force_original_aspect_ratio=increase:force_divisible_by=2` +
    `,crop=${String(box.width)}:${String(box.height)}`
  );
}

/** The sentence an encoder reports for an angle it cannot compose. */
export function turnRefusal(rotation: number): string {
  return `The panel turns its clip by quarter turns only; ${String(rotation)}° is not one.`;
}
