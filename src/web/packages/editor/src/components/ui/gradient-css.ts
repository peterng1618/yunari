/**
 * The gradient as a CSS background — one formula for the palette swatch, the
 * gradient editor's track and its preview.
 *
 * A paint with no stops has no gradient to describe, and a single stop has no
 * sweep, so both collapse to a flat colour rather than an invalid declaration.
 */
export function gradientCss(
  stops: readonly { readonly offset: number; readonly color: string }[],
  angle: number,
): string {
  const first = stops[0];
  if (first === undefined) return "transparent";
  if (stops.length === 1) return first.color;
  const ordered = [...stops].sort((a, b) => a.offset - b.offset);
  const painted = ordered
    .map((stop) => `${stop.color} ${Math.round(stop.offset * 100)}%`)
    .join(", ");
  return `linear-gradient(${90 - angle}deg, ${painted})`;
}
