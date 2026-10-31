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

/** The box the media layer is laid out in before it turns.
 *
 *  A quarter turn swaps the wire geometry's edges, because the turned layer has
 *  to cover the same glass the upright one did. */
export function turnedBox(
  geometry: PanelGeometry,
  turn: PanelVideoTurn,
): { readonly width: number; readonly height: number } {
  return turn === "cw" || turn === "ccw"
    ? { width: geometry.height, height: geometry.width }
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

/** The sentence an encoder reports for an angle it cannot compose. */
export function turnRefusal(rotation: number): string {
  return `The panel turns its clip by quarter turns only; ${String(rotation)}° is not one.`;
}
