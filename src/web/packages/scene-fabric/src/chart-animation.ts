import type { ChartFamily } from "@yunari/renderer-core";
import type { ChartRefreshRate } from "./chart-refresh.js";

/**
 * Value families animate between readings; the line is placed by the render
 * clock, so an engine transition would restart on every frame. At 1 fps every
 * family stays static.
 */
export function chartAnimationFor(
  family: ChartFamily,
  rate: ChartRefreshRate,
): boolean {
  return rate === 30 && family !== "line";
}
