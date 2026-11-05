import { describe, expect, it } from "vitest";
import type { Binding, ChartContent } from "../theme/document.js";
import { carriedPaintFor, seriesPaintFor } from "./series-paint.js";

/** The per-series paint array a chart's own settings carry. */
const line = (entries: readonly unknown[]): ChartContent["settings"] =>
  ({ palette: entries }) as unknown as ChartContent["settings"];

const paletteOf = (settings: ChartContent["settings"]): unknown =>
  (settings as unknown as { palette: unknown }).palette;

/**
 * The one-paint-per-chart-series rule, tested where it is declared.
 *
 * These cases sit beside the code they guard: a declared invariant whose guard
 * sat in one consumer was the wrong owner by the map's own test, and that
 * consumer could change the invariant without the guard noticing.
 */
describe("the one-paint-per-chart-series rule", () => {
  it("keeps each series its own colour when a middle one is removed", () => {
    // The per-series paint is a positional array sitting beside the bindings.
    // Filtering the bindings without it slid every later series onto its
    // neighbour's colour — silently, with nothing on screen that looked wrong.
    // Measured on the reference trends chart: removing the middle of CPU/GPU/RAM
    // left CPU on its blue and painted **RAM with the GPU's green**.
    const settings = line([
      { ref: "palette.cpu" },
      { ref: "palette.gpu" },
      { ref: "palette.ram" },
    ]);
    const cpu = { id: "b1", semanticKey: "cpu.load" };
    const gpu = { id: "b2", semanticKey: "gpu.load" };
    const ram = { id: "b3", semanticKey: "ram.used.percent" };
    const paint = (
      previous: readonly Binding[],
      next: readonly Binding[],
    ): unknown => paletteOf(carriedPaintFor("line", settings, previous, next));

    // The middle one, where truncating from the end would leave cpu and gpu.
    expect(paint([cpu, gpu, ram], [cpu, ram])).toEqual([
      { ref: "palette.cpu" },
      { ref: "palette.ram" },
    ]);
    // The last one, which truncation already got right.
    expect(paint([cpu, gpu, ram], [cpu, gpu])).toEqual([
      { ref: "palette.cpu" },
      { ref: "palette.gpu" },
    ]);
    // Nothing removed: the settings come back untouched, so an unrelated edit
    // does not rewrite a chart's paint.
    expect(
      carriedPaintFor("line", settings, [cpu, gpu, ram], [cpu, gpu, ram]),
    ).toBe(settings);
  });

  it("keeps a series' paint when its key is repointed", () => {
    // **Repointing a chart's key emptied its paint, and unmounted the editor.**
    // The filter asked whether the *binding object* survived, but the caller
    // hands over `{ ...binding, semanticKey }` — a fresh object for a binding
    // nobody touched. So the one gesture every author makes on a chart reported
    // every series removed: the paint array was emptied, `seriesPaintFor` grew
    // it back by repeating `current.at(-1)` (which is `undefined`), and the
    // document carried `palette: [null]`.
    //
    // `chartPaint` reads a non-record as "must reference a palette token", so
    // the next `snapshot()` threw `Invalid Fabric theme` from inside React's
    // `useSyncExternalStore` — a render-phase throw, which unmounts the shell.
    // Measured: repointing the starter's own sparkline from `cpu.load` to
    // `gpu.load` unmounted the editor in 200 ms, which is what
    // `reference-theme.spec.ts:533` then waited 90 s for a save button to
    // reappear inside.
    const settings = line([{ ref: "palette.frostInk" }]);
    const before = { id: "cpu-card-spark", semanticKey: "cpu.load" };
    const after = { id: "cpu-card-spark", semanticKey: "gpu.load" };

    // Same series, new key: the paint is untouched, by identity.
    expect(carriedPaintFor("line", settings, [before], [after])).toBe(settings);

    // The removed case this filter exists for still works, on `id` now.
    expect(
      paletteOf(
        carriedPaintFor(
          "line",
          line([{ ref: "palette.cpu" }, { ref: "palette.gpu" }]),
          [
            { id: "b1", semanticKey: "cpu.load" },
            { id: "b2", semanticKey: "gpu.load" },
          ],
          [{ id: "b1", semanticKey: "gpu.temp" }],
        ),
      ),
    ).toEqual([{ ref: "palette.cpu" }]);
  });

  it("keeps a chart's colour when a series is bound to it or unbound from it", () => {
    // **Binding a series to a chart emptied its own property panel.** An author
    // who bound a reading could not then choose the series colour: the panel went
    // from `[stroke, palette.0]` to `[]`, measured in live DOM.
    //
    // The filter walked `previous` and kept only entries whose series survived,
    // so an empty `previous` — binding the *first* series — kept nothing at all.
    // Unbinding the last one emptied it from the other side. `seriesPaintFor`
    // then regrew the empty array by repeating `current.at(-1)`, which is
    // `undefined`, so the envelope carried `palette: [null]`: a paint entry that
    // is not a record, which the validator refuses and no picker can render.
    //
    // Binding the first series to a chart inserted from the Add pane.
    expect(
      paletteOf(
        carriedPaintFor(
          "line",
          line([{ ref: "palette.series" }]),
          [],
          [{ id: "b1", semanticKey: "cpu.load" }],
        ),
      ),
    ).toEqual([{ ref: "palette.series" }]);

    // Unbinding the last one: the series is gone, but the slot it is chosen into
    // is not, and `seriesPaintFor` still guarantees one.
    expect(
      paletteOf(
        carriedPaintFor(
          "line",
          line([{ ref: "palette.cpu" }, { ref: "palette.gpu" }]),
          [
            { id: "b1", semanticKey: "cpu.load" },
            { id: "b2", semanticKey: "gpu.load" },
          ],
          [],
        ),
      ),
    ).toEqual([{ ref: "palette.cpu" }]);
  });

  it("gives a chart one entry per series, repeating the last", () => {
    const settings = line([{ ref: "palette.cpu" }, { ref: "palette.gpu" }]);
    expect(paletteOf(seriesPaintFor("line", settings, 4))).toEqual([
      { ref: "palette.cpu" },
      { ref: "palette.gpu" },
      { ref: "palette.gpu" },
      { ref: "palette.gpu" },
    ]);
  });

  it("leaves a gauge's paints alone, because a gauge has no series", () => {
    const settings = line([{ ref: "palette.ink" }]);
    expect(seriesPaintFor("gauge", settings, 3)).toBe(settings);
    expect(carriedPaintFor("gauge", settings, [], [])).toBe(settings);
  });
});
