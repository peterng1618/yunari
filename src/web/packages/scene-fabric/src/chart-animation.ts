import type { ChartFamily } from "@yunari/renderer-core";
import type { ChartRefreshRate } from "./chart-refresh.js";

/**
 * Value families animate between readings; the line moves with its data, so an
 * engine transition would animate that jump over pixels the reader has already
 * seen. At 1 fps every family stays static.
 */
export function chartAnimationFor(
  family: ChartFamily,
  rate: ChartRefreshRate,
): boolean {
  return rate === 30 && family !== "line";
}
