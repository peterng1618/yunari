import { Path } from "fabric/es";

/**
 * A custom shape's own drawing as the Add pane's tile mark.
 *
 * The preset *is* the figure, so the tile shows it rather than a Lucide
 * stand-in that would only approximate a shape the author authored. The viewBox
 * is Fabric's own measured bounds, padded so a stroked or hairline path is not
 * clipped; an open preset is stroked in the current text colour and a closed
 * one is filled with it.
 */
export function PathGlyph({
  data,
  paint,
  size = 20,
}: {
  readonly data: string;
  readonly paint: "stroke" | "fill";
  readonly size?: number;
}): React.JSX.Element | null {
  let path: Path;
  try {
    path = new Path(data);
  } catch {
    return null;
  }
  if (!(path.width >= 0) || !(path.height >= 0)) return null;

  const pad = 1;
  const width = Math.max(path.width, 1);
  const height = Math.max(path.height, 1);
  const x = path.pathOffset.x - path.width / 2 - pad;
  const y = path.pathOffset.y - path.height / 2 - pad;

  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox={`${x} ${y} ${width + pad * 2} ${height + pad * 2}`}
      fill="none"
    >
      <path
        d={data}
        fill={paint === "fill" ? "currentColor" : "none"}
        stroke={paint === "stroke" ? "currentColor" : "none"}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
