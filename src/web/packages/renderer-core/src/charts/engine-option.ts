import type { EChartsCoreOption } from "echarts/core";
import type { ChartFamily } from "../theme/document.js";
import type { BarOption } from "./bar.js";
import type { GaugeOption } from "./gauge.js";
import type { LineOption } from "./line.js";
import type { PieOption } from "./pie.js";
import type { PolarBarOption } from "./polar-bar.js";
import type { RadarOption } from "./radar.js";

/**
 * The one place a Yunari chart option becomes an engine option.
 *
 * ## Why this file exists rather than a cast at each call site
 *
 * The `buildXOption` builders emit **Yunari's** typed shapes — narrow,
 * reviewable, unit-tested objects that happen to be structured the way ECharts
 * wants. That is the point of "typed chart settings only": raw engine options
 * never enter the theme format, and a feature never reaches for
 * `EChartsCoreOption`.
 *
 * Handing one to `setOption` still needs a cast, because the builders describe
 * a deliberately small subset and ECharts' own type is enormous and largely
 * optional. **That cast is the engine boundary**, and the rule about it is that
 * there is exactly one. It used to live inline in `scene/mount.ts`; a second
 * renderer needed the same cast, and two of them is how a boundary becomes a
 * habit. Grep for `toEngineOption` to find every crossing.
 */

/**
 * Each family's option type, keyed by `ChartFamily`.
 *
 * A `Record` over the union rather than a hand-written union, so a new family
 * is a compile error here instead of a silently unhandled case — the same
 * mechanism `charts/settings-fields.ts` uses for its descriptors.
 */
export interface ChartOptionByFamily extends Record<ChartFamily, unknown> {
  readonly gauge: GaugeOption;
  readonly line: LineOption;
  readonly bar: BarOption;
  readonly pie: PieOption;
  readonly radar: RadarOption;
  readonly polarBar: PolarBarOption;
}

/** Any family's built option. */
export type ChartOption = ChartOptionByFamily[ChartFamily];

/**
 * Crosses the engine boundary.
 *
 * The only sanctioned `as unknown as EChartsCoreOption` in the codebase. If you
 * find yourself wanting another, the option you are holding is not one of the
 * builders' outputs, and the question to answer first is why.
 */
export function toEngineOption(option: ChartOption): EChartsCoreOption {
  return option as unknown as EChartsCoreOption;
}
