/** The paint when it is one flat colour, whatever form it arrived in. */
export function artboardSolidColor(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (isSolid(value)) return value.color;
  return undefined;
}

/** The gradient's axis across a `width`x`height` box, which is the one piece of
 * geometry the Fabric and canvas forms share.
 *
 * **The stored angle is `90 - cssDegrees`** (`gradientCss`), so its direction in
 * the canvas's y-down space is `(cos, -sin)`: 0 is left-to-right and 90 is
 * bottom-to-top. A positive `sin` mirrored every rotated gradient against the
 * CSS preview and the gradient track, while a horizontal one agreed — which is
 * why the sign survived. */
export function artboardGradientLine(
  value: { readonly angle: number },
  width: number,
  height: number,
): { x1: number; y1: number; x2: number; y2: number } {
  const radians = (value.angle * Math.PI) / 180;
  const dx = Math.cos(radians);
  const dy = -Math.sin(radians);
  const reach = Math.abs((width * dx) / 2) + Math.abs((height * dy) / 2);
  return {
    x1: width / 2 - dx * reach,
    y1: height / 2 - dy * reach,
    x2: width / 2 + dx * reach,
    y2: height / 2 + dy * reach,
  };
}

/** CSS is the matching paint form for letterbox bars outside the Fabric canvas. */
export function cssArtboardPaint(value: unknown): string | undefined {
  const solid = artboardSolidColor(value);
  if (solid !== undefined) return solid;
  if (!isArtboardGradient(value)) return undefined;
  return `linear-gradient(${90 - value.angle}deg, ${value.stops.map((stop) => `${stop.color} ${stop.offset * 100}%`).join(", ")})`;
}

/** A box in the coordinates the two boxes share; only their geometry is read. */
export interface PaintBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The paint mapped to `board` inside a larger `box`, as CSS.
 *
 * A bare `linear-gradient(...)` maps its stops across whatever element carries
 * it, so a letterbox element would restart the plate's gradient at its own
 * edge. This rewrites the stops into `box`'s gradient line instead: the same
 * line `artboardGradientLine` gives the plate, extended across the element.
 *
 * The CSS gradient line's length is `|w·sin θ| + |h·cos θ|` for CSS angle `θ`
 * ([spec](https://drafts.csswg.org/css-images/#linear-gradients), "gradient
 * line"), and the paint's stored angle is `90 - θ`. A stop at plate parameter
 * `t` therefore lands on the element at
 * `0.5 + ((t - 0.5)·boardLine + (boardCentre - boxCentre)·direction) / boxLine`.
 * Stops outside `[0, 1]` clamp, which is the colour a CSS gradient extends
 * there when the board overflows the element.
 */
export function cssArtboardPaintMapped(
  value: unknown,
  box: PaintBox,
  board: PaintBox,
): string | undefined {
  const solid = artboardSolidColor(value);
  if (solid !== undefined) return solid;
  if (!isArtboardGradient(value)) return undefined;

  const radians = (value.angle * Math.PI) / 180;
  const dx = Math.cos(radians);
  const dy = -Math.sin(radians);
  const lineLength = (width: number, height: number): number =>
    Math.abs(width * dx) + Math.abs(height * dy);
  const boardLine = lineLength(board.width, board.height);
  const boxLine = lineLength(box.width, box.height);
  // A degenerate box has no gradient line to map onto; the bare form is the
  // only answer left, and it is what the element would draw anyway.
  if (!(boardLine > 0) || !(boxLine > 0)) return cssArtboardPaint(value);

  const shift =
    (board.left + board.width / 2 - box.width / 2) * dx +
    (board.top + board.height / 2 - box.height / 2) * dy;
  const stops = value.stops.map((stop) => {
    const offset = Math.min(
      1,
      Math.max(0, 0.5 + ((stop.offset - 0.5) * boardLine + shift) / boxLine),
    );
    return `${stop.color} ${Number((offset * 100).toFixed(4))}%`;
  });
  return `linear-gradient(${90 - value.angle}deg, ${stops.join(", ")})`;
}

function isSolid(
  value: unknown,
): value is { readonly kind: "solid"; readonly color: string } {
  const color =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)["color"]
      : undefined;
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>)["kind"] === "solid" &&
    typeof color === "string" &&
    color.length > 0
  );
}

export function isArtboardGradient(value: unknown): value is {
  readonly kind: "gradient";
  readonly angle: number;
  readonly stops: readonly {
    readonly offset: number;
    readonly color: string;
  }[];
} {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>)["kind"] === "gradient" &&
    typeof (value as Record<string, unknown>)["angle"] === "number" &&
    Array.isArray((value as Record<string, unknown>)["stops"])
  );
}
