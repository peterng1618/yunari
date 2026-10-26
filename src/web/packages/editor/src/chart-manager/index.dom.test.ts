// @vitest-environment jsdom
import { createDemoSource } from "@yunari/fake-source";
import {
  defaultBarSettings,
  defaultGaugeSettings,
  defaultLineSettings,
  type FabricGlobals,
  type GaugeSettings,
  type LineSettings,
  type Sample,
  SampleStore,
} from "@yunari/renderer-core";
import {
  type SceneAdapter,
  serialiseScene,
  YunariChart,
} from "@yunari/scene-fabric";
import { Canvas, Group } from "fabric/es";
import { describe, expect, it, vi } from "vitest";
import type { EditorInteraction } from "../editor-interaction.js";
import { newObjectPlacement } from "../new-object-defaults.js";
import {
  type ChartFieldsStage,
  choose,
  edit,
  mountChartFields,
  pick,
  pressedLabel,
  segment,
} from "./chart-stage.test-stage.js";
import { ChartManager } from "./index.js";
import { type ChartFieldTarget, chartContentView } from "./panel.js";

/** The authored frame a new chart has to land inside, as the editor supplies it. */
const artboard = () => ({ width: 1920, height: 1080 });

/**
 * Mounts the chart's own fields the way the inspector's column does: the two
 * bodies the owner hands over, rendered over the manager's own `edits`, so the
 * control a test presses goes through the write funnel the product uses.
 *
 * The manager no longer owns a panel that redraws itself, so a test that reads
 * a control after a change re-projects the way the column does — on the
 * `object:modified` the manager announces.
 */
function mountFields(
  manager: ChartManager,
  chart: () => YunariChart | undefined,
): ChartFieldsStage {
  const body = <T>(
    project: (target: YunariChart) => T | undefined,
  ): (() => T | undefined) => {
    return () => {
      const target = chart();
      return target === undefined ? undefined : project(target);
    };
  };
  return mountChartFields({
    content: body((target) => manager.fields.content(target)),
    paint: body((target) => manager.fields.paint(target)),
    edits: manager.edits,
  });
}

describe("ChartManager", () => {
  it.each(["gauge", "line", "bar", "pie"] as const)(
    "adds, selects and records a palette-backed %s",
    (family) => {
      const objects: YunariChart[] = [];
      const canvas = {
        on: vi.fn(),
        off: vi.fn(),
        add: vi.fn((chart: YunariChart) => objects.push(chart)),
        getActiveObject: vi.fn(),
        getObjects: vi.fn(() => objects),
        requestRenderAll: vi.fn(),
        setActiveObject: vi.fn(),
        // A settings write is announced the way a gesture is, so the inspector
        // re-reads the column; a stub canvas carries the same event channel.
        fire: vi.fn(),
      };
      const historyManager = { saveState: vi.fn() };
      const manager = new ChartManager({
        editor: {
          canvas,
          historyManager,
          artboard,
        } as unknown as EditorInteraction,
        scene: {} as SceneAdapter,
        source: createDemoSource(0),
        globals: {
          palette: {
            none: {
              name: "None",
              value: { kind: "solid", color: "transparent" },
            },
            ink: {
              name: "Ink",
              value: { kind: "solid", color: "#102030" },
            },
          },
        },
      });

      manager.addChart(family);

      const chart = objects[0]!;
      expect(chart).toMatchObject({ family, width: 240, height: 160 });
      // A corner origin, as a panel and a text object both now are, so the
      // inspector's X and Y are the chart's corner rather than its middle. A
      // chart is the object a dashboard's layout is most sensitive to, and a
      // centre origin put every one of them half its own size from where the
      // author put it.
      expect(chart.originX).toBe("left");
      expect(chart.originY).toBe("top");
      expect(JSON.stringify(chart.settings)).toContain("palette.ink");
      expect(canvas.setActiveObject).toHaveBeenCalledWith(chart);
      expect(historyManager.saveState).toHaveBeenCalledTimes(1);
      manager.destroy();
    },
  );

  it("draws a chart it did not create once the document's bindings reach it", () => {
    // A chart's series *are* its bindings, and this manager held only what it
    // was constructed with — so a card inserted from the library, whose charts
    // nothing here ever wrote, arrived with a binding set this side had never
    // heard of and drew with no series at all. The envelope is the owner; the
    // chart has to be told when it changed somewhere other than here.
    const objects: unknown[] = [];
    const canvas = {
      on: vi.fn(),
      off: vi.fn(),
      add: vi.fn((chart: unknown) => objects.push(chart)),
      getActiveObject: vi.fn(),
      getObjects: vi.fn(() => objects),
      requestRenderAll: vi.fn(),
      setActiveObject: vi.fn(),
    };
    const chart = new YunariChart({
      id: "card-sparkline",
      family: "line",
      settings: defaultLineSettings,
      width: 240,
      height: 160,
    });
    objects.push(chart);

    const manager = new ChartManager({
      editor: { canvas, artboard } as unknown as EditorInteraction,
      scene: {} as SceneAdapter,
      source: createDemoSource(0),
    });

    expect(chart.option?.series).toHaveLength(0);

    manager.setBindings({
      "card-sparkline": [{ id: "b1", semanticKey: "cpu.load" }],
    });

    expect(chart.option?.series).toHaveLength(1);
    manager.destroy();
    chart.dispose();
  });

  it("places a new chart on the same cascade a shape takes", () => {
    // The defect had two origins: the shapes and the text inset by 40, the
    // charts by their own 120, 80. A gauge inserted after a rectangle therefore
    // landed in a second corner rather than beside it, and neither origin knew
    // the other existed. This is the case that fails if a second origin returns.
    const objects: unknown[] = [];
    const canvas = {
      on: vi.fn(),
      off: vi.fn(),
      add: vi.fn((chart: unknown) => objects.push(chart)),
      getActiveObject: vi.fn(),
      getObjects: vi.fn(() => objects),
      requestRenderAll: vi.fn(),
      setActiveObject: vi.fn(),
      fire: vi.fn(),
    };
    const manager = new ChartManager({
      editor: {
        canvas,
        artboard,
        historyManager: { attachGlobals: () => {}, saveState: vi.fn() },
      } as unknown as EditorInteraction,
      scene: {} as SceneAdapter,
      source: createDemoSource(0),
      globals: {
        palette: {
          none: {
            name: "None",
            value: { kind: "solid" as const, color: "transparent" },
          },
          ink: {
            name: "Ink",
            value: { kind: "solid" as const, color: "#102030" },
          },
        },
      },
    });

    manager.addChart("gauge");
    const first = objects[0] as YunariChart;
    manager.addChart("gauge");
    const second = objects[1] as YunariChart;

    // The first chart takes the inset every other new object takes…
    expect({ left: first.left, top: first.top }).toEqual(
      newObjectPlacement(0, { width: 1920, height: 1080 }),
    );
    // …and the second steps from it, rather than joining it at the chart's own
    // 120, 80 that the shape path never knew about.
    expect({ left: second.left, top: second.top }).toEqual(
      newObjectPlacement(1, { width: 1920, height: 1080 }),
    );
    expect([second.left, second.top]).not.toEqual([120, 80]);
    manager.destroy();
  });

  it("does not add a chart when no palette reference can be derived", () => {
    const canvas = {
      on: vi.fn(),
      off: vi.fn(),
      add: vi.fn(),
      getActiveObject: vi.fn(),
      getObjects: vi.fn(() => []),
      requestRenderAll: vi.fn(),
      setActiveObject: vi.fn(),
    };
    const historyManager = { saveState: vi.fn() };
    const manager = new ChartManager({
      editor: {
        canvas,
        historyManager,
        artboard,
      } as unknown as EditorInteraction,
      scene: {} as SceneAdapter,
      source: createDemoSource(0),
    });

    expect(() => manager.addChart("gauge")).toThrow("palette token");
    expect(canvas.add).not.toHaveBeenCalled();
    expect(historyManager.saveState).not.toHaveBeenCalled();
    manager.destroy();
  });

  it("hydrates a revived chart without bindings", () => {
    const chart = Object.assign(Object.create(YunariChart.prototype), {
      id: "unbound-gauge",
      family: "gauge",
      settings: {
        ...defaultGaugeSettings,
        track: { ref: "palette.track" },
        progress: { ref: "palette.accent" },
      },
    }) as YunariChart;
    const canvas = {
      on: vi.fn(),
      off: vi.fn(),
      getActiveObject: vi.fn(),
      getObjects: vi.fn(() => [chart]),
      requestRenderAll: vi.fn(),
    };
    const manager = new ChartManager({
      editor: { canvas, artboard } as unknown as EditorInteraction,
      scene: {} as SceneAdapter,
      source: createDemoSource(0),
      globals: {
        palette: {
          track: { name: "Track", value: { kind: "solid", color: "#223344" } },
          accent: {
            name: "Accent",
            value: { kind: "solid", color: "#00b8d9" },
          },
        },
      },
    });

    expect(chart.option).toMatchObject({ series: expect.any(Array) });
    manager.destroy();
  });

  it("redraws only the charts whose palette ink the change moves", () => {
    // A palette edit is a live sample per pointer move. Every chart used to be
    // redrawn for every sample — seven ECharts `setOption` calls and their
    // animation work — even when the token the author was dragging is one no
    // chart names. The chart's own plan is what decides its ink, so the ink is
    // part of its reading.
    const accentChart = Object.assign(Object.create(YunariChart.prototype), {
      id: "accent-gauge",
      family: "gauge",
      settings: {
        ...defaultGaugeSettings,
        track: { kind: "solid", color: "rgb(32 32 32)" },
        progress: { ref: "palette.accent" },
      },
      setOption: vi.fn(),
    }) as YunariChart;
    const plainChart = Object.assign(Object.create(YunariChart.prototype), {
      id: "plain-gauge",
      family: "gauge",
      settings: {
        ...defaultGaugeSettings,
        track: { kind: "solid", color: "rgb(32 32 32)" },
        progress: { kind: "solid", color: "rgb(64 64 64)" },
      },
      setOption: vi.fn(),
    }) as YunariChart;
    const canvas = {
      on: vi.fn(),
      off: vi.fn(),
      getActiveObject: vi.fn(),
      getObjects: vi.fn(() => [accentChart, plainChart]),
      requestRenderAll: vi.fn(),
    };
    const palette = (accent: string) => ({
      accent: {
        name: "Accent",
        value: { kind: "solid" as const, color: accent },
      },
      track: {
        name: "Track",
        value: { kind: "solid" as const, color: "rgb(32 32 32)" },
      },
    });
    const manager = new ChartManager({
      editor: { canvas, artboard } as unknown as EditorInteraction,
      scene: {} as SceneAdapter,
      source: createDemoSource(0),
      globals: { palette: palette("rgb(0 184 217)") },
    });
    vi.mocked(accentChart.setOption).mockClear();
    vi.mocked(plainChart.setOption).mockClear();

    manager.setGlobals({ palette: palette("rgb(0 184 217)") });
    expect(
      accentChart.setOption,
      "a change to an unreferenced token draws nothing",
    ).not.toHaveBeenCalled();
    expect(plainChart.setOption).not.toHaveBeenCalled();

    manager.setGlobals({ palette: palette("rgb(255 0 0)") });
    expect(
      accentChart.setOption,
      "the chart that names the token is redrawn",
    ).toHaveBeenCalledOnce();
    expect(
      plainChart.setOption,
      "and a chart with no reference is not",
    ).not.toHaveBeenCalled();
    manager.destroy();
  });

  it("updates the selected Fabric chart from envelope bindings", async () => {
    const listeners = new Map<string, (event?: unknown) => void>();
    const chart = Object.assign(Object.create(YunariChart.prototype), {
      id: "cpu-gauge",
      family: "gauge",
      settings: {
        ...defaultGaugeSettings,
        track: { ref: "palette.track" },
        progress: { ref: "palette.accent" },
      },
      width: 100,
      height: 100,
      scaleX: 2,
      scaleY: 1.5,
      resizeTo: vi.fn(),
    }) as YunariChart;
    let revivedChart = chart;
    let stage: ChartFieldsStage | undefined;
    const canvas = {
      on: vi.fn((event: string, listener: (event?: unknown) => void) =>
        listeners.set(event, listener),
      ),
      off: vi.fn(),
      getActiveObject: vi.fn(() => chart),
      getObjects: vi.fn(() => [revivedChart]),
      requestRenderAll: vi.fn(),
      // The inspector re-reads the column on `object:modified`, so a test
      // reading a control after a change re-projects the bodies the same way.
      fire: () => stage?.render(),
    };
    const scene = { objectFor: vi.fn(() => chart) } as unknown as SceneAdapter;
    const manager = new ChartManager({
      editor: { canvas, artboard } as unknown as EditorInteraction,
      scene,
      source: createDemoSource(0),
      bindings: { "cpu-gauge": [{ id: "cpu", semanticKey: "cpu.load" }] },
      globals: {
        palette: {
          none: {
            name: "None",
            value: { kind: "solid", color: "transparent" },
          },
          track: { name: "Track", value: { kind: "solid", color: "#223344" } },
          accent: {
            name: "Accent",
            value: { kind: "solid", color: "#00b8d9" },
          },
        },
      },
    });
    stage = mountFields(manager, () => chart);
    const host = stage.host;

    expect(chart.option).toMatchObject({ series: expect.any(Array) });

    listeners.get("object:modified")!({ target: chart });
    expect(chart.resizeTo).toHaveBeenCalledWith(200, 150);

    await choose(host, 'data-yunari-binding="cpu"', "RAM used");
    expect(chart.option).toMatchObject({ series: expect.any(Array) });

    await edit(
      pick<HTMLInputElement>(host, 'data-yunari-chart-setting="thickness"'),
      "24",
    );

    expect(chart.settings).toMatchObject({ thickness: 24 });
    // The control reads back what the owner now holds, not a draft of its own.
    stage.render();
    expect(
      pick<HTMLInputElement>(host, 'data-yunari-chart-setting="thickness"')
        .value,
    ).toBe("24");

    await choose(host, 'data-yunari-chart-paint="progress"', "Track");
    expect(chart.settings).toMatchObject({
      progress: { ref: "palette.track" },
    });

    revivedChart = Object.assign(Object.create(YunariChart.prototype), {
      id: "cpu-gauge",
      family: "gauge",
      settings: chart.settings,
    }) as YunariChart;
    listeners.get("editor:history-state-loaded")!();
    expect(revivedChart.option).toMatchObject({ series: expect.any(Array) });

    listeners.get("editor:object-pasted")!();
    expect(revivedChart.option).toMatchObject({ series: expect.any(Array) });

    await stage.dispose();
    manager.destroy();
    // `object:modified`, `editor:history-state-loaded`, `editor:object-pasted`.
    expect(canvas.off).toHaveBeenCalledTimes(3);
  });

  it("announces a ratio resize, so a geometry field re-reads the chart", async () => {
    // **The claim under test.** A ratio button is a deliberate geometry edit,
    // and the object's Height changed — measured, 215 → 241 at 4:1, 321 at 3:1,
    // 482 at 2:1 — while the selection inspector's Height field sat on 215
    // through all four comparisons. The object was right and the field was
    // stale: `#resizeToAspect` re-rendered the chart's own panel and the canvas,
    // but announced nothing, and the inspector re-reads on `object:modified`.
    // The Height field is editable, so an author reading a number the product no
    // longer holds types a height against it.
    const chart = Object.assign(Object.create(YunariChart.prototype), {
      id: "trends",
      family: "line",
      settings: defaultLineSettings,
      width: 963,
      height: 215,
      scaleX: 1,
      scaleY: 1,
      resizeTo(this: { width: number; height: number }, w: number, h: number) {
        this.width = w;
        this.height = h;
      },
    }) as YunariChart;
    const canvas = {
      on: vi.fn(),
      off: vi.fn(),
      getActiveObject: vi.fn(() => chart),
      getObjects: vi.fn(() => [chart]),
      requestRenderAll: vi.fn(),
      fire: vi.fn(),
    };
    const manager = new ChartManager({
      editor: { canvas, artboard } as unknown as EditorInteraction,
      scene: {} as SceneAdapter,
      source: createDemoSource(0),
    });
    const stage = mountFields(manager, () => chart);

    await segment(stage.host, "data-yunari-chart-aspect", "2:1");

    // The object resized, exactly as the saved document showed: 963 wide at
    // 2:1 is 481.5, which is the 482 the inspector rounds to.
    expect(chart.width).toBe(963);
    expect(chart.height).toBe(481.5);
    // And it said so, which is what the inspector reads to re-render.
    expect(canvas.fire).toHaveBeenCalledWith(
      "object:modified",
      expect.objectContaining({ target: chart }),
    );

    await stage.dispose();
    manager.destroy();
  });

  it("names the ratio the chart is at, so a control group says which is active", async () => {
    // The second half of the same finding: three buttons and nothing to tell
    // them apart, so after clicking there was no way to tell 2:1 from 3:1.
    // The ratio is the chart's own width over its height — read from the object
    // rather than remembered, so it is right after a drag as well as a click.
    const chart = Object.assign(Object.create(YunariChart.prototype), {
      id: "trends",
      family: "line",
      settings: defaultLineSettings,
      width: 800,
      height: 400,
      scaleX: 1,
      scaleY: 1,
      resizeTo(this: { width: number; height: number }, w: number, h: number) {
        this.width = w;
        this.height = h;
      },
    }) as YunariChart;
    const listeners = new Map<string, (event?: unknown) => void>();
    const canvas = {
      on: vi.fn((event: string, listener: (event?: unknown) => void) =>
        listeners.set(event, listener),
      ),
      off: vi.fn(),
      getActiveObject: vi.fn(() => chart),
      getObjects: vi.fn(() => [chart]),
      requestRenderAll: vi.fn(),
      fire: vi.fn(),
    };
    const manager = new ChartManager({
      editor: { canvas, artboard } as unknown as EditorInteraction,
      scene: {} as SceneAdapter,
      source: createDemoSource(0),
    });
    const stage = mountFields(manager, () => chart);
    const pressed = (): string | undefined =>
      pressedLabel(stage.host, "data-yunari-chart-aspect");

    // 800 × 400 is 2:1, and that is the only button that says so.
    expect(pressed()).toBe("2:1");

    await segment(stage.host, "data-yunari-chart-aspect", "3:1");

    // The manager announced the change, and the column is what re-reads it.
    stage.render();
    expect(pressed()).toBe("3:1");

    // A chart dragged to a ratio the control group does not offer names none
    // of them, rather than lighting up whichever is nearest.
    chart.width = 1000;
    chart.height = 300;
    chart.scaleX = 1;
    chart.scaleY = 1;
    listeners.get("object:modified")!({ target: chart });
    stage.render();

    expect(pressed()).toBeUndefined();

    await stage.dispose();
    manager.destroy();
  });

  it("keeps the announced ratio out of the saved document", async () => {
    // §67: only authored state persists. The active ratio is read off the
    // chart's own width and height to draw the control group, and a chart
    // carries no `aspect` property — so the state that tells the author which
    // button is live cannot reach a save and become a fourth source of truth
    // beside the geometry it describes.
    const chart = new YunariChart({
      id: "trends",
      family: "line",
      settings: defaultLineSettings,
      width: 800,
      height: 400,
    });
    const canvas = new Canvas(document.createElement("canvas"));
    canvas.add(chart);
    canvas.setActiveObject(chart);
    const manager = new ChartManager({
      editor: { canvas, artboard } as unknown as EditorInteraction,
      scene: {} as SceneAdapter,
      source: createDemoSource(0),
    });
    const stage = mountFields(manager, () => chart);

    await segment(stage.host, "data-yunari-chart-aspect", "4:1");

    // The chart's own persisted shape: no ratio, no pressed state, just the
    // geometry the ratio produced. 4:1 of an 800-wide chart is 200 tall, and
    // that height is authored geometry — the ratio itself is not stored.
    const saved = serialiseScene(canvas).objects[0]!;
    expect(saved).not.toHaveProperty("aspect");
    expect(JSON.stringify(saved)).not.toContain("aria-pressed");
    expect(saved["height"]).toBe(200);

    await stage.dispose();
    manager.destroy();
  });

  it("reassigns a grouped chart's paint, so no token is deleted from under it", () => {
    // §75: deleting a referenced global forces reassignment. A card is a
    // group, so a chart one level down is the case that bites — and a live
    // `Group` keeps its children in `_objects` and exposes `getObjects()`, so
    // a walk reading `object.get("objects")` never descended into one and left
    // every chart inside a card naming the token the author had just deleted.
    //
    // **The claim under test is the saved document, not the canvas.** A
    // dangling global reference is a defect only once it is persisted; the
    // live object could be rewritten at any moment, so asserting on it would
    // pass on a walk that never touches the file.
    //
    // `GaugeSettings`, not `ChartContent["settings"]` — the union cannot be
    // narrowed back through `family` under `exactOptionalPropertyTypes`, so
    // the cast leaves the chart's options unassignable.
    const settings: GaugeSettings = {
      ...defaultGaugeSettings,
      track: { ref: "palette.ink" },
    };
    const canvas = new Canvas(document.createElement("canvas"));
    // `GroupProps` carries no `id`; a group is named the way Fabric accepts
    // one — after construction, the same as the asset panel's own group.
    const card = new Group([
      new YunariChart({
        id: "cpu-gauge",
        family: "gauge",
        settings,
        width: 200,
        height: 200,
      }),
    ]);
    card.set("id", "group-cpu-card");
    canvas.add(card);
    // The same chart at the root, which the walk already reached — this fails
    // if the descent is fixed by stopping at the top level instead.
    canvas.add(
      new YunariChart({
        id: "ram-gauge",
        family: "gauge",
        settings,
        width: 200,
        height: 200,
      }),
    );
    const manager = new ChartManager({
      editor: {
        canvas,
        artboard,
        errorManager: { warn: vi.fn(), error: vi.fn() },
      } as unknown as EditorInteraction,
      scene: {} as SceneAdapter,
      source: createDemoSource(0),
      globals: {
        palette: {
          ink: { name: "Ink", value: { kind: "solid", color: "#102030" } },
          gpu: { name: "GPU", value: { kind: "solid", color: "#00b8d9" } },
        },
      } as never,
    });

    manager.reassignPaletteReferences("palette.ink", "palette.gpu");

    const saved = serialiseScene(canvas);
    const children = saved.objects[0]!["objects"] as Record<string, unknown>[];
    expect(children[0]!["settings"]).toMatchObject({
      track: { ref: "palette.gpu" },
    });
    // And nothing anywhere in the file still names the deleted token.
    expect(JSON.stringify(saved)).not.toContain("palette.ink");

    manager.destroy();
  });
});

describe("a chart that throws", () => {
  it("costs that chart alone, and the rest of the scene keeps repainting", () => {
    // **The claim under test.** `EditorSession.refresh()` composes the text
    // repaint and `ChartManager.refresh()` in one callback, so a chart whose
    // `setOption` throws must not stop the readings beside it — otherwise one
    // bad option freezes the whole editor, which is the same defect one level
    // up in the frame loop.
    const good = new YunariChart({
      id: "good",
      family: "gauge",
      width: 100,
      height: 100,
      settings: defaultGaugeSettings,
    });
    const bad = new YunariChart({
      id: "bad",
      family: "gauge",
      width: 100,
      height: 100,
      settings: defaultGaugeSettings,
    });
    const goodSetOption = vi
      .spyOn(good, "setOption")
      .mockImplementation(() => undefined);
    const badSetOption = vi.spyOn(bad, "setOption").mockImplementation(() => {
      throw new Error("setOption blew up");
    });

    const objects = [bad, good];
    const canvas = {
      on: vi.fn(),
      off: vi.fn(),
      add: vi.fn(),
      getActiveObject: vi.fn(),
      getObjects: vi.fn(() => objects),
      requestRenderAll: vi.fn(),
      setActiveObject: vi.fn(),
    };
    const warn = vi.fn();
    // Both charts read one sensor, and the source is moved between the
    // constructor's own pass and the pass under test — so this is a refresh that
    // has something to draw. A refresh whose readings have not moved draws
    // nothing at all (vg-107), which would make the claim untestable.
    const source = createDemoSource(0);
    const bindings = {
      good: [{ id: "good-read", semanticKey: "cpu.load" }],
      bad: [{ id: "bad-read", semanticKey: "cpu.load" }],
    };
    const manager = new ChartManager({
      editor: {
        canvas,
        artboard,
        historyManager: { attachGlobals: () => {}, saveState: vi.fn() },
        errorManager: { warn, error: vi.fn() },
      } as unknown as EditorInteraction,
      scene: {} as SceneAdapter,
      source,
      bindings,
    });

    // The constructor hydrates too, so the spies are cleared and the assertion
    // is about one refresh pass rather than about how often the manager runs.
    goodSetOption.mockClear();
    badSetOption.mockClear();
    warn.mockClear();
    source.setNow(60_000);

    manager.refresh();

    // The healthy chart drew. If the throw had escaped, the loop would have
    // ended here and this would be zero — which is the whole assertion.
    expect(goodSetOption).toHaveBeenCalledTimes(1);
    expect(badSetOption).toHaveBeenCalledTimes(1);
    // And it was reported rather than swallowed: a silently frozen chart is
    // indistinguishable from a chart with no data.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[1])).toContain("setOption blew up");
    manager.destroy();
  });

  it("costs one chart when the source throws, not the walk behind it", () => {
    // **The guard around the reading read.** The reading is read in the walk,
    // outside `#applyChart`'s own per-chart guard, so a source whose `history`
    // throws would end the walk with every chart after the bad one left
    // undrawn — the property that comment exists to protect, and the one a
    // later refactor inlining the read back into `#applyChart` would quietly
    // lose.
    const at = new Date(Date.UTC(2026, 8, 15, 12, 0, 0)).toISOString();
    let healthy: Sample | undefined = {
      sensorId: "ok",
      timestamp: at,
      status: "ok",
      value: 1,
    };
    const source = {
      latest: (key: string) => (key === "ok" ? healthy : undefined),
      history: (key: string) => {
        if (key === "bad") throw new Error("history blew up");
        return [];
      },
    };
    const bad = new YunariChart({
      id: "bad",
      family: "line",
      width: 100,
      height: 100,
      settings: defaultLineSettings,
    });
    const good = new YunariChart({
      id: "good",
      family: "gauge",
      width: 100,
      height: 100,
      settings: defaultGaugeSettings,
    });
    const objects = [bad, good];
    const canvas = {
      on: vi.fn(),
      off: vi.fn(),
      add: vi.fn(),
      getActiveObject: vi.fn(),
      getObjects: vi.fn(() => objects),
      requestRenderAll: vi.fn(),
      setActiveObject: vi.fn(),
    };
    const warn = vi.fn();
    const manager = new ChartManager({
      editor: {
        canvas,
        artboard,
        historyManager: { attachGlobals: () => {}, saveState: vi.fn() },
        errorManager: { warn, error: vi.fn() },
      } as unknown as EditorInteraction,
      scene: {} as SceneAdapter,
      source: source as never,
      bindings: {
        bad: [{ id: "bad-read", semanticKey: "bad" }],
        good: [{ id: "good-read", semanticKey: "ok" }],
      },
    });
    const goodSetOption = vi.spyOn(good, "setOption");
    goodSetOption.mockClear();
    warn.mockClear();

    // The chart after the bad one has moved, so the walk has something to reach.
    healthy = { ...healthy, value: 2 };
    manager.refresh();

    expect(goodSetOption).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[1])).toContain("history blew up");
    manager.destroy();
  });
});

describe("a chart whose reading has not moved", () => {
  /** A manager over one gauge bound to one sensor, and the source it reads. */
  function harness(
    bindings: Record<string, readonly { id: string; semanticKey: string }[]>,
  ) {
    const chart = new YunariChart({
      id: "cpu",
      family: "gauge",
      width: 100,
      height: 100,
      settings: defaultGaugeSettings,
    });
    const objects = [chart];
    const canvas = {
      on: vi.fn(),
      off: vi.fn(),
      add: vi.fn(),
      getActiveObject: vi.fn(),
      getObjects: vi.fn(() => objects),
      requestRenderAll: vi.fn(),
      setActiveObject: vi.fn(),
    };
    const source = createDemoSource(0);
    const manager = new ChartManager({
      editor: {
        canvas,
        artboard,
        historyManager: { attachGlobals: () => {}, saveState: vi.fn() },
        errorManager: { warn: vi.fn(), error: vi.fn() },
      } as unknown as EditorInteraction,
      scene: {} as SceneAdapter,
      source,
      bindings,
    });
    const setOption = vi.spyOn(chart, "setOption");
    setOption.mockClear();
    return { manager, source, setOption, chart };
  }

  it("is not drawn again, and is drawn the moment the reading moves", () => {
    // **The claim under test.** The loop calls `refresh` at the author's chart
    // rate, 30 times a second by default, and every one of those calls used to
    // re-apply every chart's option whether or not its data had moved. ECharts
    // repainted and Fabric redrew the whole document for an identical picture
    // (vg-107). The rate is the ceiling on how often a chart *may* re-apply,
    // never a promise that it does.
    const { manager, source, setOption } = harness({
      cpu: [{ id: "cpu-read", semanticKey: "cpu.load" }],
    });

    manager.refresh();
    expect(setOption).not.toHaveBeenCalled();

    // The same reading, one frame later: still nothing to draw.
    manager.refresh();
    expect(setOption).not.toHaveBeenCalled();

    // A new sample is what moves a chart, and it is drawn for it.
    source.setNow(60_000);
    manager.refresh();
    expect(setOption).toHaveBeenCalledTimes(1);
    manager.destroy();
  });

  it("is a chart with no bindings: drawn once, and never for the loop again", () => {
    // An unbound chart draws a fixed placeholder, so nothing it reads can move.
    // Re-applying its option thirty times a second was the purest form of the
    // cost the row measures — the picture could not have changed.
    const { manager, setOption } = harness({});

    manager.refresh();
    manager.refresh();
    expect(setOption).not.toHaveBeenCalled();
    manager.destroy();
  });

  it("draws a bar whose newest sample runs ahead of the store's own clock", () => {
    // **Why the reading is the family's own pull.** `SampleStore.history`
    // returns only samples at or before `lastNowMs` (:37, :76-79) while `latest`
    // returns the newest whatever its timestamp — so a sample whose own clock
    // runs ahead, which is reachable on a LAN device, is returned by one and
    // excluded by the other. A bar draws `latest`; gating it on `history` left
    // it drawing the old value while its newest one had changed, which is a
    // wrong reading on screen rather than a saving.
    const t0 = Date.UTC(2026, 8, 15, 12, 0, 0);
    const sample = (atMs: number, value: number): Sample => ({
      sensorId: "cpu.load",
      timestamp: new Date(atMs).toISOString(),
      status: "ok",
      value,
    });
    const source = new SampleStore();
    source.ingest([["cpu.load", sample(t0, 10)]], t0);

    const chart = new YunariChart({
      id: "cpu",
      family: "bar",
      width: 100,
      height: 100,
      settings: defaultBarSettings,
    });
    const objects = [chart];
    const canvas = {
      on: vi.fn(),
      off: vi.fn(),
      add: vi.fn(),
      getActiveObject: vi.fn(),
      getObjects: vi.fn(() => objects),
      requestRenderAll: vi.fn(),
      setActiveObject: vi.fn(),
    };
    const manager = new ChartManager({
      editor: {
        canvas,
        artboard,
        historyManager: { attachGlobals: () => {}, saveState: vi.fn() },
        errorManager: { warn: vi.fn(), error: vi.fn() },
      } as unknown as EditorInteraction,
      scene: {} as SceneAdapter,
      source,
      bindings: { cpu: [{ id: "cpu-read", semanticKey: "cpu.load" }] },
    });
    const setOption = vi.spyOn(chart, "setOption");
    setOption.mockClear();

    // Ingested at the same `nowMs`, two seconds ahead of it.
    source.ingest([["cpu.load", sample(t0 + 2000, 90)]], t0);
    manager.refresh();

    expect(setOption).toHaveBeenCalledTimes(1);
    manager.destroy();
  });
});

describe("a line chart's trailing window", () => {
  /**
   * A manager over one chart bound to one sensor whose sample never changes, so
   * the clock is the only thing that moves between two refreshes.
   */
  function harness(family: "line" | "gauge") {
    const at = new Date(Date.UTC(2026, 8, 15, 12, 0, 0)).toISOString();
    const sample: Sample = {
      sensorId: "cpu.load",
      timestamp: at,
      status: "ok",
      value: 42,
    };
    // Built per family rather than from a union-typed `family`: a chart's
    // options are a discriminated union on `family`, so an object carrying
    // `family: "line" | "gauge"` is assignable to neither arm.
    const box = { id: "cpu", width: 100, height: 100 };
    const chart =
      family === "line"
        ? new YunariChart({
            ...box,
            family: "line",
            settings: defaultLineSettings,
          })
        : new YunariChart({
            ...box,
            family: "gauge",
            settings: defaultGaugeSettings,
          });
    const objects = [chart];
    const canvas = {
      on: vi.fn(),
      off: vi.fn(),
      add: vi.fn(),
      getActiveObject: vi.fn(),
      getObjects: vi.fn(() => objects),
      requestRenderAll: vi.fn(),
      setActiveObject: vi.fn(),
    };
    const manager = new ChartManager({
      editor: {
        canvas,
        artboard,
        historyManager: { attachGlobals: () => {}, saveState: vi.fn() },
        errorManager: { warn: vi.fn(), error: vi.fn() },
      } as unknown as EditorInteraction,
      scene: {} as SceneAdapter,
      // Whatever the clock says, this source answers with the same sample.
      source: { revision: 0, latest: () => sample, history: () => [sample] },
      bindings: { cpu: [{ id: "cpu-read", semanticKey: "cpu.load" }] },
    });
    const setOption = vi.spyOn(chart, "setOption");
    setOption.mockClear();
    return { manager, setOption };
  }

  const pinned = Date.UTC(2026, 8, 15, 12, 0, 0);

  it("is redrawn as the clock advances, though its newest sample has not moved", () => {
    // **The claim under test.** The chart refresh the author picks is the
    // *drawing* rate; polling stays at one sample a second under either choice,
    // and the frames between two samples are the same window interpolated. A
    // line's picture is that window: `buildLineOption` places it from `nowMs`
    // (`xAxis.min`/`max`) and draws the series one playback delay past the
    // visible right edge. vg-107 gated the redraw on the newest sample alone,
    // so a trends chart drew at its data's cadence — 1 fps against a 30 fps
    // selection, which is the refresh that never happened.
    const clock = vi.spyOn(Date, "now").mockReturnValue(pinned);
    try {
      const { manager, setOption } = harness("line");
      // The same instant, the same sample: the window moved for nobody.
      manager.refresh();
      expect(setOption).not.toHaveBeenCalled();

      // One frame later at 30 fps, with the reading untouched.
      clock.mockReturnValue(pinned + 33);
      manager.refresh();
      expect(setOption).toHaveBeenCalledTimes(1);

      // And again, because the window only ever advances.
      clock.mockReturnValue(pinned + 66);
      manager.refresh();
      expect(setOption).toHaveBeenCalledTimes(2);
      manager.destroy();
    } finally {
      clock.mockRestore();
    }
  });

  it("is not, for a gauge whose sample has not moved", () => {
    // The half of vg-107 that stands: a gauge draws `latest` and nothing else,
    // so an idle gauge is genuinely an identical picture and re-applying it
    // thirty times a second was the cost the row measured. A clock in every
    // family's signature would buy the line its rate back by paying that cost
    // again.
    const clock = vi.spyOn(Date, "now").mockReturnValue(pinned);
    try {
      const { manager, setOption } = harness("gauge");
      manager.refresh();
      clock.mockReturnValue(pinned + 33);
      manager.refresh();
      clock.mockReturnValue(pinned + 66);
      manager.refresh();
      expect(setOption).not.toHaveBeenCalled();
      manager.destroy();
    } finally {
      clock.mockRestore();
    }
  });
});

describe("a chart's series paint", () => {
  /**
   * Measured on the surface while building the trends panel: a line chart with
   * three sensors bound showed **one** "Series paint" control, and all three
   * lines drew in it. A new chart declares one series colour and kept it
   * however many bindings arrived, so a three-series chart — the target's
   * blue, violet and teal — was unreachable.
   */
  function harness() {
    const objects: YunariChart[] = [];
    const canvas = {
      add: (object: YunariChart) => objects.push(object),
      setActiveObject: vi.fn(),
      getActiveObject: () => objects.at(-1),
      getObjects: () => objects,
      on: vi.fn(),
      off: vi.fn(),
      requestRenderAll: vi.fn(),
      fire: vi.fn(),
    };
    const manager = new ChartManager({
      editor: {
        canvas,
        artboard,
        historyManager: { attachGlobals: () => {}, saveState: vi.fn() },
        errorManager: { warn: vi.fn(), error: vi.fn() },
      } as never,
      scene: {} as never,
      source: { latest: () => undefined, history: () => [] } as never,
      globals: {
        palette: {
          ink: { name: "Ink", value: { kind: "solid", color: "#102030" } },
        },
      } as never,
    });
    return { manager, objects };
  }

  it("gains a series paint for every series bound", async () => {
    const { manager, objects } = harness();
    manager.addChart("line");
    // The manager announces on change and the column re-projects; this is the
    // column standing in for the inspector.
    const stage = mountFields(manager, () => objects.at(-1));
    const palette = (): unknown =>
      (objects[0]?.settings as unknown as Record<string, unknown>)["palette"];
    expect(Array.isArray(palette()) && (palette() as unknown[]).length).toBe(1);

    for (const semanticKey of [
      "CPU load",
      "GPU load",
      "RAM used (share of total)",
    ]) {
      await choose(stage.host, "data-yunari-chart-binding-add", semanticKey);
      stage.render();
    }

    expect((palette() as unknown[]).length).toBe(3);
    // The control follows the array, so three entries means three pickers.
    expect(
      stage.host.querySelectorAll("[data-yunari-chart-paint^='palette']")
        .length,
    ).toBe(3);
    await stage.dispose();
    manager.destroy();
  });

  it("leaves a gauge's paints alone, because a gauge has no series", async () => {
    const { manager, objects } = harness();
    manager.addChart("gauge");
    const stage = mountFields(manager, () => objects.at(-1));
    const before = objects[0]?.settings;

    await choose(stage.host, "data-yunari-chart-binding-add", "CPU load");

    // A gauge's track and progress are not per-series, so nothing about them
    // changes when a sensor is bound to it.
    expect(objects[0]?.settings).toEqual(before);
    await stage.dispose();
    manager.destroy();
  });
});

describe("a chart control's commit", () => {
  /** A manager whose fields are mounted over whichever chart is current.
   *  `globals` is what the chart's paint resolves against. */
  function mounted(initial: YunariChart, globals?: FabricGlobals) {
    let current = initial;
    const objects = [initial];
    const canvas = {
      add: (object: YunariChart) => objects.push(object),
      setActiveObject: vi.fn(),
      getActiveObject: () => current,
      getObjects: () => objects,
      on: vi.fn(),
      off: vi.fn(),
      requestRenderAll: vi.fn(),
      fire: vi.fn(),
    };
    const manager = new ChartManager({
      editor: {
        canvas,
        artboard,
        historyManager: { attachGlobals: () => {}, saveState: vi.fn() },
        errorManager: { warn: vi.fn(), error: vi.fn() },
      } as never,
      scene: {} as never,
      source: { latest: () => undefined, history: () => [] } as never,
      ...(globals === undefined ? {} : { globals }),
    });
    const stage = mountFields(manager, () => current);
    return {
      manager,
      stage,
      canvas,
      /** A later selection, without the column having re-read it yet. */
      select(next: YunariChart): void {
        current = next;
        objects.push(next);
      },
    };
  }

  it("writes a stale control's edit to the chart it was rendered for", async () => {
    // A control's draft outlives the selection it was rendered for: the column
    // is re-read on the next event, but a commit that arrives first still
    // carries the chart id it was built with. Resolving by id is what stops it
    // landing on whatever happens to be selected now.
    const first = new YunariChart({
      id: "first",
      family: "gauge",
      settings: defaultGaugeSettings,
      width: 100,
      height: 100,
    });
    const second = new YunariChart({
      id: "second",
      family: "gauge",
      settings: defaultGaugeSettings,
      width: 100,
      height: 100,
    });
    const { manager, stage, select } = mounted(first);

    select(second);
    // No re-render: the mounted control is still the one built for `first`.
    await edit(
      pick<HTMLInputElement>(
        stage.host,
        'data-yunari-chart-setting="thickness"',
      ),
      "24",
    );

    expect(first.settings).toMatchObject({ thickness: 24 });
    expect(second.settings).toEqual(defaultGaugeSettings);

    await stage.dispose();
    manager.destroy();
  });

  it("keeps a nested setting through a save and a reopen", async () => {
    // The write path and the read path are one path: a nested commit is
    // persisted as the block the renderer reads, so reopening the document
    // shows the author's number rather than a key with a dot in its name.
    const chart = new YunariChart({
      id: "trends",
      family: "line",
      settings: defaultLineSettings,
      width: 800,
      height: 400,
    });
    const canvas = new Canvas(document.createElement("canvas"));
    canvas.add(chart);
    canvas.setActiveObject(chart);
    const manager = new ChartManager({
      editor: {
        canvas,
        artboard,
        historyManager: { attachGlobals: () => {}, saveState: vi.fn() },
        errorManager: { warn: vi.fn(), error: vi.fn() },
      } as never,
      scene: {} as SceneAdapter,
      source: createDemoSource(0),
    });
    const stage = mountFields(manager, () => chart);

    await edit(
      pick<HTMLInputElement>(
        stage.host,
        'data-yunari-chart-setting="animation.durationMs"',
      ),
      "2400",
    );

    const saved = serialiseScene(canvas).objects[0]!;
    expect(JSON.stringify(saved)).not.toContain('"animation.durationMs"');
    const settings = saved["settings"] as Record<string, unknown>;
    expect(settings["animation"]).toMatchObject({
      durationMs: 2400,
      easing: "linear",
    });

    // The reopened chart: the same projection the column renders reads the
    // author's number back out of the persisted block.
    const revived: ChartFieldTarget = {
      id: "trends",
      content: { family: "line", settings: settings as never },
      bindings: [],
    };
    expect(
      chartContentView(revived).rows.find(
        (row) => row.key === "animation.durationMs",
      ),
    ).toMatchObject({ value: 2400, path: ["animation", "durationMs"] });

    await stage.dispose();
    manager.destroy();
  });

  it("replaces the option when a settings edit clears a bound", async () => {
    // A merge never deletes a key the new option omits, and the line builder
    // omits `yAxis.min`/`max` when the author clears them. Without a
    // replacement the axis keeps the old bounds after the author removed them.
    const bounded = { ...defaultLineSettings, min: 0, max: 100 };
    const chart = new YunariChart({
      id: "trends",
      family: "line",
      settings: bounded,
      width: 800,
      height: 400,
    });
    const { manager, stage } = mounted(chart);
    const engine = (
      chart as unknown as {
        _chart: { setOption: (option: unknown, options: unknown) => void };
      }
    )._chart;
    const applied = vi.spyOn(engine, "setOption");

    manager.edits.onSettings("trends", bounded);
    manager.edits.onSettings("trends", defaultLineSettings);

    const [withBounds, withoutBounds] = applied.mock.calls.slice(-2);
    // The control: the drawing that carried the bounds really had them, so the
    // omission below is the author's clear rather than a worse bug.
    expect(withBounds?.[0]).toMatchObject({ yAxis: { min: 0, max: 100 } });
    expect(withoutBounds?.[0]).not.toHaveProperty("yAxis.min");
    expect(withoutBounds?.[0]).not.toHaveProperty("yAxis.max");
    // And it reached the engine as a replacement, which is what deletes them.
    expect(withoutBounds?.[1]).toEqual({ notMerge: true, lazyUpdate: false });

    await stage.dispose();
    manager.destroy();
  });

  it("replaces the option when a settings edit removes a threshold", async () => {
    // The other conditionally omitted key: a threshold stroke draws a
    // `visualMap`, and a solid stroke omits it. A merge would leave the old
    // bands colouring the line after the author changed the paint.
    const thresholds: LineSettings = {
      ...defaultLineSettings,
      min: 0,
      max: 100,
      stroke: {
        kind: "thresholds",
        bands: [
          { offset: 0, ref: "palette.cold" },
          { offset: 0.5, ref: "palette.warm" },
        ],
      },
    };
    const solid: LineSettings = {
      ...defaultLineSettings,
      min: 0,
      max: 100,
      stroke: { ref: "palette.warm" },
    };
    const chart = new YunariChart({
      id: "trends",
      family: "line",
      settings: thresholds,
      width: 800,
      height: 400,
    });
    const { manager, stage } = mounted(chart, {
      palette: {
        none: { name: "None", value: { kind: "solid", color: "transparent" } },
        cold: { name: "Cold", value: { kind: "solid", color: "#3388ff" } },
        warm: { name: "Warm", value: { kind: "solid", color: "#ff8833" } },
      },
    });
    const engine = (
      chart as unknown as {
        _chart: { setOption: (option: unknown, options: unknown) => void };
      }
    )._chart;
    const applied = vi.spyOn(engine, "setOption");

    manager.edits.onSettings("trends", thresholds);
    manager.edits.onSettings("trends", solid);

    const [withBands, withoutBands] = applied.mock.calls.slice(-2);
    // The control: the threshold drawing really carried a `visualMap`, so its
    // absence below is the author's paint change rather than a worse bug.
    expect(withBands?.[0]).toHaveProperty("visualMap");
    expect(withoutBands?.[0]).not.toHaveProperty("visualMap");
    expect(withoutBands?.[1]).toEqual({ notMerge: true, lazyUpdate: false });

    await stage.dispose();
    manager.destroy();
  });
});
