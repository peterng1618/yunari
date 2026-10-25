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

/**
 * The playback delay a rate allows: the source's own at 30 fps, none at 1 fps.
 *
 * The delay exists so a line's edge stays inside the newest segment between
 * batches; a chart that redraws once a second already does, and keeping the
 * delay there would only make every reading two seconds late.
 */
export function chartPlaybackDelayFor(
  rate: ChartRefreshRate,
  delayMs: number | undefined,
): number {
  return rate === 1 ? 0 : (delayMs ?? 0);
}
