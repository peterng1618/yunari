import type { Binding, ChartContent, ChartFamily } from "../theme/document.js";
import { chartPaintFieldsFor } from "./settings-fields.js";

/**
 * The family's per-series paint, with one entry per series.
 *
 * `buildChartPlan` makes a line series, a bar and a slice one binding each, and
 * `chartPaintFieldsFor` declares the paint that repeats as `multiple` — so the
 * two are the same length by definition and this module keeps them so. It lives
 * beside the descriptor that declares the invariant rather than in the editor;
 * a guard in a different module from its declaration is a wrong owner, and a
 * consumer could change the invariant without it. A new entry repeats the last
 * one, which is what an author extending a chart means: the same look, once
 * more, until they choose otherwise. A gauge's paints are not per-series and
 * are left alone.
 */
export function seriesPaintFor(
  family: ChartFamily,
  settings: ChartContent["settings"],
  series: number,
): ChartContent["settings"] {
  const field = chartPaintFieldsFor(family).find((entry) => entry.multiple);
  if (field === undefined) return settings;
  const current = (settings as unknown as Record<string, unknown>)[
    field.property
  ];
  if (!Array.isArray(current)) return settings;
  const wanted = Math.max(1, series);
  if (current.length === wanted) return settings;
  const last = current.at(-1);
  return {
    ...settings,
    [field.property]: Array.from(
      { length: wanted },
      (_, index) => current[index] ?? last,
    ),
  } as ChartContent["settings"];
}

/**
 * Each surviving series' own paint, in its new order.
 *
 * The per-series paint is a positional array sitting beside the bindings, so
 * filtering the bindings without it slides every later series onto its
 * neighbour's colour — silently, with nothing on screen that looks wrong.
 * Measured on the reference trends chart: removing the middle of CPU/GPU/RAM
 * left CPU on its blue and painted **RAM with the GPU's green**, because the GPU
 * entry was still sitting at index 1.
 *
 * **A series is the same series when its `id` is the same.** `next.includes`
 * asked whether the *object* survived, and the one caller that repoints a key
 * hands over `{ ...binding, semanticKey }` — a fresh object for a binding that
 * was not touched. So changing a chart's key reported every series removed,
 * the paint array was emptied, and `seriesPaintFor` grew the empty array back
 * to one entry by repeating `current.at(-1)`, which is `undefined`. The
 * envelope then carried `palette: [null]`.
 *
 * That is not a document the validator can accept: `chartPaint` reads a
 * non-record as "must reference a palette token", so the *next* `snapshot()`
 * threw `Invalid Fabric theme`. `isDirty()` runs inside React's
 * `useSyncExternalStore`, so the throw landed in the render phase and React
 * unmounted the whole editor — canvas, status line and every panel gone —
 * which is what `reference-theme.spec.ts:533` then timed out on, waiting 90 s
 * for a save button that was no longer in the document. Measured: repointing
 * the starter's own sparkline from `cpu.load` to `gpu.load` unmounted the
 * editor in 200 ms.
 *
 * `id` is the identity a binding is minted with and keyed by everywhere else
 * (the chart manager mints it, the run editor keys its bindings by it), so it is
 * the identity this filter should have used.
 *
 * **The same filter also emptied the paint in the other two directions.**
 * A paint entry belongs to a *position*, and a position only means something
 * when a series stood there. Binding the first series to a chart inserted
 * from the Add pane reported every entry removed — `previous` was empty, so
 * nothing survived it — and unbinding the last one did the same from the
 * other side. Either way `seriesPaintFor` regrew the empty array by repeating
 * `current.at(-1)`, which is `undefined`, so the envelope carried
 * `palette: [null]` and the panel rendered no colour control at all: **an
 * author who bound a series to a chart could not then choose its colour.**
 * Measured, the reported DOM read going from `[stroke, palette.0]` to `[]` on
 * the chart's own property panel.
 *
 * So an entry is dropped only when the series it paints is *known* to be gone,
 * which is a claim about `previous` rather than about `next`: an entry with no
 * series behind it was never bound, so there is nothing to have removed.
 */
export function carriedPaintFor(
  family: ChartFamily,
  settings: ChartContent["settings"],
  previous: readonly Binding[],
  next: readonly Binding[],
): ChartContent["settings"] {
  const field = chartPaintFieldsFor(family).find((entry) => entry.multiple);
  if (field === undefined) return settings;
  const current = (settings as unknown as Record<string, unknown>)[
    field.property
  ];
  if (!Array.isArray(current)) return settings;
  const kept = current.filter(
    (_paint, index) =>
      index >= previous.length ||
      previous[index]?.id === next[index]?.id ||
      next.some((survivor) => survivor.id === previous[index]?.id),
  );
  // `seriesPaintFor` guarantees a chart at least one series slot to colour, so a
  // filter that returned nothing here would be regrown from `undefined` rather
  // than from a colour. Unbinding the last series therefore keeps the first
  // entry: the series is gone, but the slot it will be chosen into is not, and
  // an author binding again is choosing a colour, not declaring a default.
  const surviving =
    kept.length === 0 && current.length > 0 ? [current[0]!] : kept;
  if (surviving.length === current.length) return settings;
  return {
    ...settings,
    [field.property]: surviving,
  } as ChartContent["settings"];
}
