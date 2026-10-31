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
