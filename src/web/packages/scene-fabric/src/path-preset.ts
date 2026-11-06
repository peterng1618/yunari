import { Path } from "fabric/es";
import { hasClosedPath } from "./glass.js";

export interface PathPresetGeometry {
  readonly ok: true;
  readonly width: number;
  readonly height: number;
  readonly paint: "stroke" | "fill";
}

export type PathPresetGeometryResult =
  | PathPresetGeometry
  | { readonly ok: false; readonly reason: "unreadable" | "empty" };

/**
 * The geometry and paint a custom shape's data describes.
 *
 * Parsed by Fabric's own `Path`, so what is measured is exactly what the canvas
 * would draw: an unreadable string is refused, and so is a drawing with no
 * extent on either axis. Either axis alone may be zero — a horizontal line is
 * still a drawing. Paint follows closedness: a closed path fills, an open one
 * is stroked.
 *
 * Shared by the editor's form and the host's store so the two cannot disagree
 * about what a storable preset is.
 */
export function pathPresetGeometry(data: string): PathPresetGeometryResult {
  let path: Path;
  try {
    path = new Path(data.trim());
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  if (!(path.width > 0) && !(path.height > 0)) {
    return { ok: false, reason: "empty" };
  }
  return {
    ok: true,
    width: path.width,
    height: path.height,
    paint: hasClosedPath(path) ? "fill" : "stroke",
  };
}
