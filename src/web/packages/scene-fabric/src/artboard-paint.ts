import { Gradient } from "fabric/es";

/** The paint when it is one flat colour, whatever form it arrived in. */
function solidColor(value: unknown): string | undefined {
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
function gradientLine(
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

/** Converts the v2 palette paint owned by renderer-core at the Fabric boundary. */
export function fabricArtboardPaint(
  value: unknown,
  width: number,
  height: number,
): string | Gradient<"linear"> | undefined {
  const solid = solidColor(value);
  if (solid !== undefined) return solid;
  if (!isGradient(value)) return undefined;

  return new Gradient({
    type: "linear",
    gradientUnits: "pixels",
    coords: gradientLine(value, width, height),
    colorStops: [...value.stops],
  });
}

/** CSS is the matching paint form for letterbox bars outside the Fabric canvas. */
export function cssArtboardPaint(value: unknown): string | undefined {
  const solid = solidColor(value);
  if (solid !== undefined) return solid;
  if (!isGradient(value)) return undefined;
  return `linear-gradient(${90 - value.angle}deg, ${value.stops.map((stop) => `${stop.color} ${stop.offset * 100}%`).join(", ")})`;
}

/**
 * Paints the same paint into a **2D context** — the form the glass backdrop
 * needs, because neither a Fabric `Gradient` nor CSS's `linear-gradient(...)`
 * string is a legal `fillStyle`.
 *
 * `region` is the box to cover and `device` is the artboard's rect in that
 * context's own pixels, which is what a gradient is mapped to: a board's paint
 * is the same picture wherever it is drawn, so a panel sampling it must get the
 * geometry the canvas and the host are showing. False when the value resolves
 * to nothing paintable.
 */
export function fillArtboardPaint(
  ctx: CanvasRenderingContext2D,
  region: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  },
  device: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  },
  value: unknown,
): boolean {
  const solid = solidColor(value);
  if (solid !== undefined) {
    ctx.fillStyle = solid;
  } else if (isGradient(value)) {
    const line = gradientLine(value, device.width, device.height);
    const gradient = ctx.createLinearGradient(
      device.left + line.x1,
      device.top + line.y1,
      device.left + line.x2,
      device.top + line.y2,
    );
    for (const stop of value.stops)
      gradient.addColorStop(stop.offset, stop.color);
    ctx.fillStyle = gradient;
  } else {
    return false;
  }
  ctx.fillRect(region.left, region.top, region.width, region.height);
  return true;
}

/** Cheap identity for a resolved artboard paint, so a repaint can skip rebuilding
 * a Gradient. Two paints with the same key are interchangeable for `fabricArtboardPaint`. */
export function artboardPaintKey(value: unknown): string {
  if (typeof value === "string") return `s:${value}`;
  if (isSolid(value)) return `o:${value.color}`;
  if (isGradient(value))
    return `g:${value.angle}:${value.stops.map((stop) => `${stop.offset}/${stop.color}`).join(",")}`;
  return "none";
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

function isGradient(value: unknown): value is {
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
