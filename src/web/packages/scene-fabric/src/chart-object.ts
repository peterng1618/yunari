import {
  type ChartContent,
  type ChartFamily,
  type ChartOption,
  toEngineOption,
} from "@yunari/renderer-core";
import * as echarts from "echarts/core";
import { classRegistry, FabricObject } from "fabric/es";
import "./chart-engine.js";
import { clampRenderScale, DEFAULT_RENDER_SCALE } from "./render-scale.js";

/**
 * Fabric object backed by a detached ECharts canvas. Keep caching and engine
 * animation off; use center origin and zero stroke so bounds/controls stay exact.
 * Engine repaint invalidation must go through `set('dirty', true)` so group
 * caches are invalidated too.
 */

/** Authored chart properties persisted beyond Fabric's own state. */
export const CHART_SERIALISED_KEYS = [
  "family",
  "settings",
] as const satisfies readonly (keyof ChartContent)[];

export type ChartSerialisedKey = (typeof CHART_SERIALISED_KEYS)[number];

/** Compile-time guard: every `ChartContent` key must be persisted. */
type AssertNever<T extends never> = T;
type _EveryContentKeyIsPersisted = AssertNever<
  Exclude<keyof ChartContent, ChartSerialisedKey>
>;

/** `option` and `renderScale` are runtime-only and never persisted. */
export type YunariChartOptions = ChartContent &
  Record<string, unknown> & {
    readonly width: number;
    readonly height: number;
    readonly option?: ChartOption;
    readonly renderScale?: number;
  };

export class YunariChart extends FabricObject {
  public static override type = "YunariChart";

  public static override customProperties: string[] = [
    ...CHART_SERIALISED_KEYS,
  ];

  /** Fabric-native defaults; declare once so caller options are not overwritten later. */
  public static override ownDefaults: Record<string, unknown> = {
    originX: "center",
    originY: "center",
    objectCaching: false,
    strokeWidth: 0,
  };

  public static override getDefaults(): Record<string, unknown> {
    return { ...super.getDefaults(), ...YunariChart.ownDefaults };
  }

  /** Field initializer would overwrite values assigned by `setOptions`. */
  declare public family: ChartFamily;

  private _settings!: ChartContent["settings"];

  private _renderScale: number = DEFAULT_RENDER_SCALE;

  private _option: ChartOption | undefined;

  private _element: HTMLCanvasElement | undefined;

  private _chart: echarts.ECharts | undefined;

  private _disposed = false;

  public constructor(options: YunariChartOptions) {
    // Match Fabric subclass order: base defaults, subclass defaults, caller options.
    super();
    Object.assign(this, YunariChart.ownDefaults);
    this.setOptions(options);

    if (!(this.width > 0) || !(this.height > 0)) {
      throw new Error(
        `A chart needs a positive width and height; received ${this.width}×${this.height}.`,
      );
    }

    // `renderScale` may be assigned before width/height by `setOptions`.
    this._renderScale = clampRenderScale(
      this._renderScale,
      this.width,
      this.height,
    );

    this._mount();
  }

  /** Deep-freeze because Fabric serializes custom-property objects by reference. */
  public get settings(): ChartContent["settings"] {
    return this._settings;
  }

  public set settings(settings: ChartContent["settings"]) {
    this._settings = freezeDeep(settings);
  }

  /** Accessor keeps backing resolution synchronized with Fabric `set(...)`. */
  public get renderScale(): number {
    return this._renderScale;
  }

  public set renderScale(scale: number) {
    this.setRenderScale(scale);
  }

  /** Accessor is required because Fabric assigns option-bag keys onto the instance. */
  public get option(): ChartOption | undefined {
    return this._option;
  }

  public set option(option: ChartOption | undefined) {
    this.setOption(option);
  }

  public get disposed(): boolean {
    return this._disposed;
  }

  /**
   * Apply an option before Fabric blits it.
   *
   * The default merges: replacing only the series keeps the axes, grid and
   * visual map while still dropping a series the new option no longer has — the
   * frame loop's own path. `replace` is for an authored change, because a merge
   * never deletes a key the new option omits and the builders omit `visualMap`
   * and `yAxis.min`/`max` when the author removes them.
   */
  public setOption(
    option: ChartOption | undefined,
    options: { readonly replace?: boolean } = {},
  ): void {
    if (this._disposed) {
      return;
    }

    this._option = option;

    if (option === undefined) {
      return;
    }

    this._resizeBackingCanvas();
    this._chart?.setOption(
      toEngineOption(option),
      options.replace === true
        ? { notMerge: true, lazyUpdate: false }
        : { notMerge: false, replaceMerge: ["series"], lazyUpdate: false },
    );
    this._requestCanvasRender();
  }

  /** Re-layout ECharts at committed size instead of permanently scaling pixels. */
  public resizeTo(width: number, height: number): void {
    if (this._disposed) {
      return;
    }

    this.set({ width, height, scaleX: 1, scaleY: 1 });
    this._renderScale = clampRenderScale(this._renderScale, width, height);
    this._resizeBackingCanvas();
    this.setCoords();
    this._requestCanvasRender();
  }

  /** Change oversampling without reinitializing ECharts. */
  public setRenderScale(scale: number): void {
    const next = clampRenderScale(scale, this.width, this.height);

    if (this._disposed || next === this._renderScale) {
      return;
    }

    this._renderScale = next;
    this._resizeBackingCanvas();
    this.set("dirty", true);
    this._requestCanvasRender();
  }

  /**
   * Release ECharts and backing pixels. `canvas.remove()` does not call this;
   * canvas ownership must dispose removed charts explicitly.
   */
  public override dispose(): void {
    if (this._disposed) {
      super.dispose();
      return;
    }

    this._disposed = true;
    this._chart?.getZr().off("rendered", this._onEngineRendered);
    this._chart?.dispose();
    this._chart = undefined;

    if (this._element !== undefined) {
      this._element.width = 0;
      this._element.height = 0;
      this._element = undefined;
    }

    super.dispose();
  }

  /** Fabric has already applied object transforms; blit in centered local space. */
  public override _render(ctx: CanvasRenderingContext2D): void {
    const element = this._element;

    if (this._disposed || element === undefined || element.width === 0) {
      return;
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      element,
      0,
      0,
      element.width,
      element.height,
      -this.width / 2,
      -this.height / 2,
      this.width,
      this.height,
    );
  }

  /**
   * ECharts changed pixels outside Fabric's knowledge; invalidate through Fabric.
   *
   * **The canvas render is asked for by the call that changed the pixels, not
   * here.** Requesting one from this event made every engine repaint redraw the
   * whole document — including repaints this object did not cause — and with a
   * refresh loop driving `setOption` that was every chart, every frame (vg-107).
   * `set` is what propagates the invalidation to an enclosing group's cache.
   */
  private readonly _onEngineRendered = (): void => {
    if (this._disposed) {
      return;
    }

    this.set("dirty", true);
  };

  /** Blit the pixels this object just repainted. One request per change, not per engine event. */
  private _requestCanvasRender(): void {
    this.canvas?.requestRenderAll();
  }

  private _mount(): void {
    const element = document.createElement("canvas");
    this._element = element;

    const { width, height } = this._backingSize();
    element.width = width;
    element.height = height;

    // Backing dimensions already include oversampling; keep zrender DPR fixed at 1.
    this._chart = echarts.init(element, null, {
      renderer: "canvas",
      devicePixelRatio: 1,
      width,
      height,
    });

    this._chart.getZr().on("rendered", this._onEngineRendered);
    this.setOption(this._option);
  }

  private _backingSize(): { width: number; height: number } {
    return {
      width: Math.max(1, Math.round(this.width * this._renderScale)),
      height: Math.max(1, Math.round(this.height * this._renderScale)),
    };
  }

  private _resizeBackingCanvas(): void {
    const chart = this._chart;

    if (chart === undefined) {
      return;
    }

    const size = this._backingSize();
    if (
      this._element?.width === size.width &&
      this._element.height === size.height
    ) {
      return;
    }
    chart.resize(size);
    // `resize()` defers painting; flush before Fabric can blit a half-cleared canvas.
    chart.getZr().flush();
  }
}

/** Deep-freeze authored settings so snapshots cannot be mutated through aliases. */
function freezeDeep<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);

  for (const entry of Object.values(value)) {
    freezeDeep(entry);
  }

  return value;
}

// Use Fabric's inherited revival so clip paths/gradients are enlivened correctly.
classRegistry.setClass(YunariChart);
