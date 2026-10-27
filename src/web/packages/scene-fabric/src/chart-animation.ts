import type { ChartFamily } from "@yunari/renderer-core";

/**
 * Value families animate between readings; the line moves with its data, so an
 * engine transition would animate that jump over pixels the reader has already
 * seen (0124).
 */
export function chartAnimationFor(family: ChartFamily): boolean {
  return family !== "line";
}
