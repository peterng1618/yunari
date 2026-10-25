import {
  type Binding,
  buildChartPlan,
  type ChartContent,
  type ChartFamily,
  carriedPaintFor,
  chartReadingSignature,
  type FabricGlobals,
  reassignChartPaintReferences,
  type SampleSource,
  SEMANTIC_KEYS,
  type SemanticKeyDescriptor,
  seriesPaintFor,
} from "@yunari/renderer-core";
import {
  chartAnimationFor,
  type ChartRefreshRate,
  type SceneAdapter,
  YunariChart,
} from "@yunari/scene-fabric";
import { type FabricObject, Group } from "fabric/es";
import type { EditorInteraction } from "../editor-interaction.js";
import {
  createNewChartDefaults,
  newObjectName,
  nextNewObjectPlacement,
} from "../new-object-defaults.js";
import type { ChartFieldsPort } from "../selection-inspector/per-kind-column.js";
import type { ChartEdits } from "./chart-fields.js";
import {
  ASPECT_RATIOS,
  type ChartFieldTarget,
  chartContentView,
  chartPaintView,
} from "./panel.js";

function newChart(
  family: ChartFamily,
  globals: FabricGlobals | undefined,
  id: string,
  placement: { readonly left: number; readonly top: number },
): YunariChart {
  const common = {
    id,
    // The family is what the author just chose, so it is what the layer list
    // shows; a new chart that arrived as a bare uuid would be unreadable.
    name: newObjectName(family),
    // The same cascade a shape and a text object take. A chart used to carry
    // its own `120, 80`, which is how a gauge inserted after a rectangle landed
    // in a second corner rather than beside it: two origins for one rule, and
    // neither of them knew the other existed.
    ...placement,
    width: 240,
    height: 160,
    // Artboard coordinates, as a panel and a text object now both are, so the
    // inspector's X and Y are the chart's corner. A chart is the object whose
    // position a dashboard is most sensitive to — six of them, each sitting in
    // a card — and a centre origin put every one of them half its own size away
    // from where the author put it: measured, a 200 × 200 gauge placed at
    // (1069, 258) drew at (969, 158). `boxFrom` converts between the two
    // origins on the way out, so a saved chart is unaffected.
    originX: "left",
    originY: "top",
  };

  switch (family) {
    case "gauge":
      return new YunariChart({
        ...common,
        family,
        settings: createNewChartDefaults(globals, family),
      });
    case "line":
      return new YunariChart({
        ...common,
        family,
        settings: createNewChartDefaults(globals, family),
      });
    case "bar":
      return new YunariChart({
        ...common,
        family,
        settings: createNewChartDefaults(globals, family),
      });
    case "pie":
      return new YunariChart({
        ...common,
        family,
        settings: createNewChartDefaults(globals, family),
      });
  }
}

/**
 * The offered ratio a chart is at, or nothing when it is at none of them.
 *
 * Read off the object rather than remembered from the last click, so a chart
 * the author dragged is described by its own shape. A chart at 2.004:1 is at
 * none of them: rounding to the nearest would light up a ratio that was never
 * applied, which is the disagreement this state exists to remove.
 */
function aspectOf(
  chart: YunariChart,
  ratios: readonly number[],
): { readonly aspect: number } | Record<string, never> {
  const width = chart.width * chart.scaleX;
  const height = chart.height * chart.scaleY;
  if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0) {
    return {};
  }
  const ratio = width / height;
  const match = ratios.find((candidate) => Math.abs(candidate - ratio) < 0.01);
  return match === undefined ? {} : { aspect: match };
}

/**
 * The smaller edge of the chart's own drawn box, whole units.
 *
 * The same read `aspectOf` takes — the object's own size at its own scale — and
 * the ceiling the panel bounds a chart's pixel measures with: the canvas the
 * renderer draws into is sized from these two numbers, so a thickness or a
 * radius past them is a value nothing on screen can show. Absent when the object
 * measures nothing: a field with no readable box keeps a typed box rather than a
 * guessed ceiling (`vg-469`).
 */
function drawnEdgeOf(
  chart: YunariChart,
): { readonly drawnEdge: number } | Record<string, never> {
  const width = chart.width * chart.scaleX;
  const height = chart.height * chart.scaleY;
  const smaller = Math.min(width, height);
  return Number.isFinite(smaller) && smaller > 0
    ? { drawnEdge: Math.floor(smaller) }
    : {};
}

/** Yunari-owned chart semantics layered on the editor's generic canvas mechanics. */
export class ChartManager {
  readonly #editor: EditorInteraction;
  readonly #scene: SceneAdapter;
  #source: SampleSource;
  #bindings: Readonly<Record<string, readonly Binding[]>>;
  #globals: FabricGlobals | undefined;
  #onBindingsChange:
    | ((id: string, bindings: readonly Binding[]) => void)
    | undefined;
  /** The readings a series may name, pulled at projection time so a catalogue
      refreshed after mount is offered on the next render. */
  readonly #descriptors: () => readonly SemanticKeyDescriptor[];
  readonly #refreshRate: () => ChartRefreshRate;

  /**
   * The reading each chart last drew with, keyed by object id.
   *
   * The frame loop calls `refresh` at the author's chart rate, which makes that
   * rate the ceiling on how often a chart *may* re-apply — not a promise that
   * every tick draws every chart. Re-applying an option the chart already has
   * made ECharts repaint, and Fabric redraw the whole document, thirty times a
   * second for an identical picture (vg-107). A chart absent from this map has
   * never been drawn by this manager and is drawn.
   */
  readonly #drawnReading = new Map<string, string>();

  /**
   * The chart's own fields, for the selection inspector's column to render.
   *
   * The mount point moved out of a Data tab and into the chart's own column;
   * the owner did not. The values are projected per question and the React
   * column renders them through plan 1's control set, so this hands over a
   * serializable body rather than the elements it used to build.
   */
  readonly fields: ChartFieldsPort = {
    content: (chart) => {
      const target = this.#targetFor(chart);
      return target === undefined
        ? undefined
        : chartContentView(target, this.#descriptors());
    },
    paint: (chart) => {
      const target = this.#targetFor(chart);
      return target === undefined
        ? undefined
        : chartPaintView(target, this.#globals?.palette);
    },
  };

  /** The writes those controls make. Public because the column calls them; the
      chart they land on is resolved by id at call time, so a control whose
      draft outlived its selection writes nothing. */
  readonly edits: ChartEdits = {
    onSettings: (id, settings) => this.#updateSettings(id, settings),
    onBinding: (id, binding) =>
      this.#updateBinding(id, binding, this.#onBindingsChange),
    onAspect: (id, ratio) => this.#resizeToAspect(id, ratio),
    onAddBinding: (id, semanticKey) =>
      this.#writeBindings(
        id,
        [
          ...(this.#bindings[id] ?? []),
          // Minted here rather than in the panel: the id is what the run
          // editor's bindings are keyed by, so one shape for both keeps a
          // document's two kinds of reference legible together.
          { id: `binding-${crypto.randomUUID()}`, semanticKey },
        ],
        this.#onBindingsChange,
      ),
    onRemoveBinding: (id, bindingId) =>
      this.#writeBindings(
        id,
        (this.#bindings[id] ?? []).filter(
          (binding) => binding.id !== bindingId,
        ),
        this.#onBindingsChange,
      ),
  };

  constructor(options: {
    readonly editor: EditorInteraction;
    readonly scene: SceneAdapter;
    readonly source: SampleSource;
    readonly bindings?: Readonly<Record<string, readonly Binding[]>>;
    readonly globals?: FabricGlobals;
    /** The available readings; absent keeps the built-in vocabulary. */
    readonly descriptors?: () => readonly SemanticKeyDescriptor[];
    readonly refreshRate?: () => ChartRefreshRate;
    readonly onBindingsChange?: (
      id: string,
      bindings: readonly Binding[],
    ) => void;
  }) {
    this.#editor = options.editor;
    this.#scene = options.scene;
    this.#source = options.source;
    this.#bindings = options.bindings ?? {};
    this.#globals = options.globals;
    this.#descriptors = options.descriptors ?? (() => SEMANTIC_KEYS);
    this.#refreshRate = options.refreshRate ?? (() => 30);
    this.#onBindingsChange = options.onBindingsChange;
    this.#editor.canvas.on("object:modified", this.#rerasterizeScaledChart);
    this.#editor.canvas.on(
      "editor:history-state-loaded" as never,
      this.#hydrateRevivedCharts,
    );
    this.#editor.canvas.on(
      "editor:object-pasted" as never,
      this.#hydrateRevivedCharts,
    );
    this.#hydrateRevivedCharts();
  }

  destroy(): void {
    this.#editor.canvas.off("object:modified", this.#rerasterizeScaledChart);
    this.#editor.canvas.off(
      "editor:history-state-loaded" as never,
      this.#hydrateRevivedCharts,
    );
    this.#editor.canvas.off(
      "editor:object-pasted" as never,
      this.#hydrateRevivedCharts,
    );
  }

  setGlobals(globals: FabricGlobals | undefined): void {
    this.#globals = globals;
    // A palette decides every chart's ink, so new globals move a chart the
    // data did not.
    this.#applyCharts(true);
  }

  /**
   * The envelope's bindings, whenever they changed somewhere other than here.
   *
   * A chart's series **are** its bindings, so a manager still holding only what
   * it was constructed with draws every chart it did not write itself with no
   * series at all — which is every chart in an inserted card.
   */
  setBindings(bindings: Readonly<Record<string, readonly Binding[]>>): void {
    this.#bindings = bindings;
    // Which series a chart has is a binding, so a re-bound chart moves even
    // where its readings do not.
    this.#applyCharts(true);
  }

  setSource(source: SampleSource): void {
    this.#source = source;
    this.#applyCharts(true);
  }

  refresh(): void {
    this.#applyCharts(false);
  }

  /** Add a typed chart while preserving the editor's canvas and history ownership. */
  addChart(family: ChartFamily): void {
    const id = `chart-${crypto.randomUUID()}`;
    // Placed before the chart joins the canvas, so it takes the n-th slot rather
    // than counting itself.
    const chart = newChart(
      family,
      this.#globals,
      id,
      nextNewObjectPlacement(this.#editor),
    );
    this.#editor.canvas.add(chart);
    this.#editor.canvas.setActiveObject(chart);
    this.#applyChart(id, chart);
    this.#editor.historyManager.saveState();
    this.#editor.canvas.requestRenderAll();
    this.#announce(chart);
  }

  reassignPaletteReferences(from: string, to: string): void {
    // §75: deleting a referenced global forces reassignment, so a chart still
    // naming the deleted token would be a dangling reference in the saved
    // document. A live `Group` keeps its children in `_objects` and exposes
    // `getObjects()` — it has no `objects` property — so reading
    // `object.get("objects")` never descended into one and every chart inside
    // a card kept the token its whole group had just lost.
    const visit = (object: FabricObject): void => {
      if (object instanceof YunariChart) {
        const settings = reassignChartPaintReferences(
          object.settings,
          from,
          to,
        );
        if (settings !== object.settings) {
          object.set("settings", settings);
          const id = object.get("id");
          if (typeof id === "string") this.#applyChart(id, object);
        }
      }
      if (object instanceof Group) object.getObjects().forEach(visit);
    };
    this.#editor.canvas.getObjects().forEach(visit);
    this.#editor.canvas.requestRenderAll();
    // The reassignment runs with the palette's own fan-out, which re-renders
    // the column a moment later; this is for the chart the author is looking
    // at, whose settings just changed under it.
    this.#announce(this.#selectedChart());
  }

  /**
   * Reads one chart as the fields' own input: the family and settings off the
   * object, the bindings off the envelope, the ratio and the drawn box off its
   * own shape. `undefined` for anything that is not a chart this manager owns by
   * id.
   */
  #targetFor(chart: FabricObject): ChartFieldTarget | undefined {
    if (!(chart instanceof YunariChart)) return undefined;
    const id = chart.get("id");
    if (typeof id !== "string") return undefined;
    return {
      id,
      content: {
        family: chart.family,
        settings: chart.settings,
      } as ChartContent,
      bindings: this.#bindings[id] ?? [],
      ...aspectOf(chart, ASPECT_RATIOS),
      ...drawnEdgeOf(chart),
    };
  }

  /**
   * Says the object changed, which is what the selection inspector re-reads on.
   *
   * A settings or binding edit is not a canvas gesture, so nothing else would
   * tell the column its fields are stale — the panel used to redraw itself, and
   * the column is redrawn by the inspector instead.
   */
  #announce(chart: FabricObject | undefined): void {
    if (!(chart instanceof YunariChart)) return;
    this.#editor.canvas.fire("object:modified", { target: chart });
  }

  #updateSettings(id: string, settings: ChartContent["settings"]): void {
    const chart = this.#chartFor(id);

    if (chart instanceof YunariChart) {
      chart.set("settings", settings);
      this.#applyChart(id, chart);
      this.#editor.canvas.requestRenderAll();
    }
    this.#announce(chart);
  }

  #updateBinding(
    id: string,
    nextBinding: Binding,
    onBindingsChange:
      | ((id: string, bindings: readonly Binding[]) => void)
      | undefined,
  ): void {
    this.#writeBindings(
      id,
      (this.#bindings[id] ?? []).map((binding) =>
        binding.id === nextBinding.id ? nextBinding : binding,
      ),
      onBindingsChange,
    );
  }

  /**
   * The one place a chart's binding list is written: the key chooser, the key
   * picker and the remove button all end here, so the envelope, the redraw and
   * the panel cannot disagree about what a chart reads.
   */
  #writeBindings(
    id: string,
    bindings: readonly Binding[],
    onBindingsChange:
      | ((id: string, bindings: readonly Binding[]) => void)
      | undefined,
  ): void {
    const previous = this.#bindings[id] ?? [];
    this.#bindings = { ...this.#bindings, [id]: bindings };
    const chart = this.#chartFor(id);
    if (chart instanceof YunariChart) {
      // A per-series paint is one entry per series, and a series is a binding.
      // Without this a chart inserted from the Add pane declares one series
      // colour and keeps it however many sensors are bound to it, so a
      // three-series trends chart has three lines and **one** colour control —
      // measured, and the reason the target's blue/violet/teal is unreachable.
      chart.set(
        "settings",
        seriesPaintFor(
          chart.family,
          carriedPaintFor(chart.family, chart.settings, previous, bindings),
          bindings.length,
        ),
      );
      this.#applyChart(id, chart);
    }
    this.#editor.canvas.requestRenderAll();
    onBindingsChange?.(id, bindings);
    this.#announce(chart);
  }

  #resizeToAspect(id: string, ratio: number): void {
    const chart = this.#chartFor(id);
    const width = chart === undefined ? 0 : chart.width * chart.scaleX;
    if (
      !(chart instanceof YunariChart) ||
      !Number.isFinite(width) ||
      width <= 0
    ) {
      return;
    }
    chart.resizeTo(width, width / ratio);
    this.#editor.canvas.requestRenderAll();
    // A ratio is a geometry edit, and the object is changed by the time the
    // column has redrawn — measured, 215 → 241 at 4:1 and 482 at 2:1. The
    // selection inspector re-reads on `object:modified` and on nothing else, so
    // without this the Height field kept reporting the height the chart had
    // before the click, on a control an author types into. Announced the way
    // `canvas-nudge` announces a programmatic move.
    this.#announce(chart);
  }

  readonly #rerasterizeScaledChart = (event: { target?: unknown }): void => {
    const chart = event.target;
    if (!(chart instanceof YunariChart)) return;
    const width = chart.width * chart.scaleX;
    const height = chart.height * chart.scaleY;
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      return;
    }
    // A drag changes the ratio too, and this runs on the `object:modified` the
    // inspector re-reads the ratio buttons on — so the buttons follow the drag
    // without anything here announcing a second time.
    chart.resizeTo(width, height);
  };

  /** A revived or pasted chart is a new object, so every chart is redrawn. */
  readonly #hydrateRevivedCharts = (): void => {
    this.#applyCharts(true);
  };

  /**
   * Draw the charts whose reading moved — and, when `force` is set, all of them.
   *
   * `force` is for a change that moves a chart without moving its data: a new
   * palette or source, a re-bound chart, or one revived from history. Everything
   * else is the refresh loop's own call, and it draws nothing where nothing has
   * moved.
   */
  #applyCharts(force: boolean): void {
    let drawn = false;
    // **One clock reading per pass.** A line's drawn picture is placed from the
    // clock (`buildLineOption`'s `xAxis.min`/`max`), so the instant that decides
    // whether a chart is drawn and the instant the plan draws it with have to be
    // the same one: read twice, a chart that moved between the two reads is
    // skipped for a window it never drew.
    const nowMs = Date.now();
    const visit = (objects: readonly object[]): void => {
      for (const object of objects) {
        if (object instanceof YunariChart) {
          const id = object.get("id");
          if (typeof id !== "string") continue;
          // A source that throws costs that chart, the way a throwing option
          // does: the draw is still attempted, so `#applyChart` reports it.
          let reading: string | undefined;
          try {
            const content = {
              family: object.family,
              settings: object.settings,
            } as ChartContent;
            reading = chartReadingSignature(
              content,
              this.#bindings[id] ?? [],
              this.#source,
              nowMs,
            );
          } catch {
            reading = undefined;
          }
          if (
            force ||
            reading === undefined ||
            this.#drawnReading.get(id) !== reading
          ) {
            this.#applyChart(id, object, reading, nowMs);
            drawn = true;
          }
        } else if (object instanceof Group) {
          visit(object.getObjects());
        }
      }
    };
    visit(this.#editor.canvas.getObjects());
    if (drawn) this.#editor.canvas.requestRenderAll();
  }

  #chartFor(id: string): YunariChart | undefined {
    const find = (objects: readonly object[]): YunariChart | undefined => {
      for (const object of objects) {
        if (object instanceof YunariChart && object.get("id") === id)
          return object;
        if (object instanceof Group) {
          const chart = find(object.getObjects());
          if (chart !== undefined) return chart;
        }
      }
      return undefined;
    };
    return find(this.#editor.canvas.getObjects());
  }

  #applyChart(
    id: string,
    chart: YunariChart,
    reading?: string,
    nowMs = Date.now(),
  ): void {
    // **Per chart, and reported, not swallowed.** `refresh()` runs beside the
    // text repaint in one callback, so a chart that throws would take every
    // bound reading on the canvas down with it. One bad chart costs that chart.
    try {
      const plan = buildChartPlan(
        id,
        { family: chart.family, settings: chart.settings } as ChartContent,
        this.#bindings[id] ?? [],
        {
          source: this.#source,
          nowMs,
          animate: chartAnimationFor(chart.family, this.#refreshRate()),
        },
        [],
        this.#globals?.palette,
      );
      chart.setOption(plan.option);
      // Recorded only once it drew, and only for a caller that read a reading:
      // a chart whose option threw is retried on the next pass rather than left
      // blank until its data happens to move.
      if (reading !== undefined) this.#drawnReading.set(id, reading);
    } catch (error) {
      this.#editor.errorManager.warn(
        "controls",
        `Chart "${id}" failed to draw and was left as it was. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  #selectedChart(): YunariChart | undefined {
    const object = this.#editor.canvas.getActiveObject();
    return object instanceof YunariChart ? object : undefined;
  }
}
