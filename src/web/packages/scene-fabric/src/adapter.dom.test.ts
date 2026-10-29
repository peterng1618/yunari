// @vitest-environment jsdom

import {
  buildLineOption,
  defaultLineSettings,
  type PlanBox,
  type PlanNode,
  type Sample,
  type ScenePlan,
  type TextContent,
} from "@yunari/renderer-core";
import {
  Ellipse,
  type FabricObject,
  Group,
  IText,
  Rect,
  StaticCanvas,
  Textbox,
} from "fabric/es";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSceneAdapter, type SceneAdapter } from "./adapter.js";
import { YunariChart } from "./chart-object.js";

/**
 * The reconciler, against real Fabric.
 *
 * ## Why this is not deferred to Playwright
 *
 * Nothing here looks at a pixel — that is still the browser suite's job. What
 * it asserts is **arithmetic and bookkeeping**: that an object lands where the
 * document put it, that a group's child lands where the group's coordinate
 * space says it should, that an update moves things instead of duplicating
 * them, and that a removed node's chart is actually disposed.
 *
 * All of that is decided by Fabric's own matrix code, which is exactly why it
 * cannot be asserted against a hand-rolled model and why stage 1's lesson
 * applies: a green suite over an object Fabric could not even construct. So
 * these mount a real `StaticCanvas` and ask Fabric where things are.
 *
 * ## The group arithmetic is the reason this file exists
 *
 * A plan child's box is relative to its parent group's **top-left**, unrotated.
 * A Fabric child's coordinates are relative to the group's **centre**, and
 * `Group.add()` converts by inverting the group's matrix — so the conversion is
 * correct only if the group is at its content origin, with no angle and no
 * scale, at the moment its children are added. That is three conditions in
 * `buildGroup` that no type can enforce, and `calcTransformMatrix` is what
 * proves them.
 */

const NOW_MS = Date.UTC(2026, 8, 15, 12, 0, 0);

const canvases: StaticCanvas[] = [];
const adapters: SceneAdapter[] = [];

afterEach(() => {
  while (adapters.length > 0) {
    adapters.pop()?.dispose();
  }

  while (canvases.length > 0) {
    void canvases.pop()?.destroy();
  }
});

function box(overrides: Partial<PlanBox> = {}): PlanBox {
  return {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    ...overrides,
  };
}

function node(
  overrides: Partial<PlanNode> & Pick<PlanNode, "id" | "content">,
): PlanNode {
  return {
    box: box(),
    visible: true,
    style: {},
    children: [],
    ...overrides,
  };
}

function rectangle(
  id: string,
  geometry: Partial<PlanBox>,
  style: PlanNode["style"] = {},
): PlanNode {
  return node({
    id,
    content: { kind: "shape", shape: "rectangle", cornerRadius: 0 },
    box: box(geometry),
    style,
  });
}

function textNode(
  id: string,
  text: string,
  style: PlanNode["style"] = {},
  wrap = false,
): PlanNode {
  const authored: TextContent = { runs: [{ kind: "literal", text }] };

  return node({
    id,
    box: box({ width: 100, height: 30 }),
    style,
    content: {
      kind: "text",
      authored,
      segments: [{ text, style: {} }],
      layout: {
        wrap,
        overflow: wrap ? "clip" : "visible",
        align: "left",
        verticalAlign: "top",
      },
    },
  });
}

function plan(
  nodes: readonly PlanNode[],
  artboard: Partial<ScenePlan["artboard"]> = {},
): ScenePlan {
  return {
    artboard: {
      width: 1920,
      height: 1080,
      contentFit: "contain",
      background: "#101216",
      ...artboard,
    },
    nodes,
    issues: [],
  };
}

function sample(value: number, offsetMs = 0): Sample {
  return {
    sensorId: "cpu.load",
    timestamp: new Date(NOW_MS - offsetMs).toISOString(),
    status: "ok",
    value,
  };
}

function chartNode(
  id: string,
  geometry: Partial<PlanBox>,
  value = 42,
): PlanNode {
  return node({
    id,
    box: box(geometry),
    content: {
      kind: "chart",
      family: "line",
      settings: defaultLineSettings,
      option: buildLineOption(
        defaultLineSettings,
        [
          {
            sensorId: "cpu.load",
            samples: [sample(value, 1000), sample(value)],
          },
        ],
        NOW_MS,
        false,
      ),
    },
  });
}

function mount(
  options: Parameters<typeof createSceneAdapter>[0] extends never
    ? never
    : {
        readonly onUnsupported?: (nodeId: string, reason: string) => void;
      } = {},
): { canvas: StaticCanvas; adapter: SceneAdapter } {
  const canvas = new StaticCanvas(undefined, {
    width: 1920,
    height: 1080,
    renderOnAddRemove: false,
  });
  const adapter = createSceneAdapter({ canvas, ...options });

  canvases.push(canvas);
  adapters.push(adapter);

  return { canvas, adapter };
}

/** Where Fabric thinks an object's centre is, in canvas coordinates. */
function absoluteCentre(object: FabricObject): { x: number; y: number } {
  const matrix = object.calcTransformMatrix();

  // With a centre origin — which every object here has — the matrix's
  // translation *is* the centre, and it includes every ancestor's transform.
  return { x: matrix[4], y: matrix[5] };
}

describe("creating a scene", () => {
  it("draws one object per node, findable by id", () => {
    const { canvas, adapter } = mount();

    adapter.apply(
      plan([
        rectangle("bg", { width: 100, height: 50 }),
        rectangle("fg", { width: 10, height: 10 }),
      ]),
    );

    expect(canvas.getObjects()).toHaveLength(2);
    expect(adapter.objectFor("bg")).toBeInstanceOf(Rect);
    expect(adapter.objectFor("nope")).toBeUndefined();
  });

  it("builds an auto text as IText and a fixed text as Textbox", () => {
    // The plan's derived `layout.wrap` is the class choice; a plan builder that
    // sets it from the element's own class is the only thing that keeps the two
    // paths agreeing.
    const { adapter } = mount();

    adapter.apply(
      plan([textNode("auto", "CPU"), textNode("fixed", "CPU", {}, true)]),
    );

    expect(adapter.objectFor("auto")).toBeInstanceOf(IText);
    expect(adapter.objectFor("auto")).not.toBeInstanceOf(Textbox);
    expect(adapter.objectFor("fixed")).toBeInstanceOf(Textbox);
  });

  it("puts an object where the document put it, centre origin and all", () => {
    const { adapter } = mount();

    adapter.apply(
      plan([rectangle("r", { x: 10, y: 20, width: 100, height: 50 })]),
    );

    expect(absoluteCentre(adapter.objectFor("r")!)).toEqual({ x: 60, y: 45 });
  });

  it("keeps the authored box as the OUTER box when a stroke is painted", () => {
    // `mount.ts` had `box-sizing: border-box`; Fabric centres a stroke on the
    // path. Without the inset a 4 px outline would make this 104 px wide and
    // push every neighbour's alignment out by 2 px.
    const { adapter } = mount();

    adapter.apply(
      plan([
        rectangle(
          "r",
          { x: 0, y: 0, width: 100, height: 50 },
          { strokeColor: "#f00", strokeWidth: 4 },
        ),
      ]),
    );

    const object = adapter.objectFor("r")!;

    expect(object.width).toBe(96);
    expect(object.height).toBe(46);
    // The measured outer extent, which is the number that actually matters.
    expect(object.getScaledWidth()).toBe(100);
    expect(absoluteCentre(object)).toEqual({ x: 50, y: 25 });
  });

  it("clamps a corner radius the way CSS does, not the way Fabric does", () => {
    // `cornerRadius: 999` means "fully rounded". Fabric caps each axis on its
    // own, which turns a wide box into a full ellipse; CSS scales both radii by
    // one factor, giving a capsule. The stress fixture draws visibly different
    // shapes on the two paths without this.
    const { adapter } = mount();

    adapter.apply(
      plan([
        node({
          id: "pill",
          box: box({ width: 120, height: 40 }),
          content: { kind: "shape", shape: "rectangle", cornerRadius: 999 },
        }),
      ]),
    );

    expect(adapter.objectFor("pill")).toMatchObject({ rx: 20, ry: 20 });
  });

  it("gives an ellipse radii rather than a width and a height", () => {
    const { adapter } = mount();

    adapter.apply(
      plan([
        node({
          id: "e",
          box: box({ width: 80, height: 40 }),
          content: { kind: "shape", shape: "ellipse", cornerRadius: 0 },
        }),
      ]),
    );

    const ellipse = adapter.objectFor("e");

    expect(ellipse).toBeInstanceOf(Ellipse);
    expect(ellipse).toMatchObject({ rx: 40, ry: 20, width: 80, height: 40 });
  });

  it("stacks objects in the plan’s order", () => {
    const { canvas, adapter } = mount();

    adapter.apply(
      plan([rectangle("a", {}), rectangle("b", {}), rectangle("c", {})]),
    );

    expect(canvas.getObjects().map((object) => object.get("id"))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("clips to the artboard and leaves the board's paint to the host", () => {
    // §53: content outside the artboard must not paint over the letterbox
    // bars, which are the host's background showing where the design is not.
    //
    // **The paint is deliberately absent here.** This canvas sits above
    // the media layer, so a fill on it hides the media and leaves the reader no
    // letterbox; `scene.ts` owns the paint and applies it only when the theme
    // declares no background media. Asserted as empty rather than left alone,
    // because a fill reappearing here is that defect returning in silence.
    const { canvas, adapter } = mount();

    adapter.apply(
      plan([rectangle("r", {})], {
        width: 800,
        height: 600,
        background: "#123456",
      }),
    );

    expect(canvas.backgroundColor).toBe("");
    expect(canvas.clipPath).toBeInstanceOf(Rect);
    expect(canvas.clipPath).toMatchObject({
      width: 800,
      height: 600,
      absolutePositioned: true,
    });
  });
});

describe("it actually draws", () => {
  /** One pixel, straight off the canvas' own backing store. */
  function pixelAt(
    canvas: StaticCanvas,
    x: number,
    y: number,
  ): readonly number[] {
    const context = canvas.getContext();

    return [...context.getImageData(x, y, 1, 1).data];
  }

  it("paints a filled node, and clips what falls outside the artboard", () => {
    // Every other test here would pass with the whole scene clipped away, or
    // with nothing painted at all — they assert where objects *are*. This is
    // the one that says ink reached the canvas. Verified by sabotage: dropping
    // the artboard clip fails it. Dropping only `absolutePositioned` does
    // *not*, so that property is asserted directly above rather than claimed
    // to be covered here.
    const canvas = new StaticCanvas(undefined, {
      width: 400,
      height: 300,
      renderOnAddRemove: false,
    });
    const adapter = createSceneAdapter({ canvas });

    canvases.push(canvas);
    adapters.push(adapter);

    adapter.apply(
      plan(
        [
          rectangle(
            "r",
            { x: 0, y: 0, width: 400, height: 300 },
            { fill: "#ff0000" },
          ),
        ],
        {
          width: 200,
          height: 100,
          background: "",
        },
      ),
    );
    canvas.renderAll();

    // Inside the artboard: the node's fill.
    expect(pixelAt(canvas, 50, 50)).toEqual([255, 0, 0, 255]);
    // Outside it: nothing, even though the node's own box covers this point.
    // §53's letterbox bars are the host's background showing through.
    expect(pixelAt(canvas, 300, 200)[3]).toBe(0);
  });

  it("leaves a node with no authored fill transparent", () => {
    // Fabric's default fill is opaque black, so this is the assertion that the
    // explicit `fill: ''` in `paint.ts` is doing its job — on a dark dashboard
    // a black slab is very nearly invisible in review and obvious in use.
    const canvas = new StaticCanvas(undefined, {
      width: 100,
      height: 100,
      renderOnAddRemove: false,
    });
    const adapter = createSceneAdapter({ canvas });

    canvases.push(canvas);
    adapters.push(adapter);

    adapter.apply(
      plan([rectangle("r", { x: 0, y: 0, width: 100, height: 100 })], {
        width: 100,
        height: 100,
        background: "",
      }),
    );
    canvas.renderAll();

    expect(pixelAt(canvas, 50, 50)[3]).toBe(0);
  });
});

describe("a group’s children", () => {
  const child = rectangle("child", { x: 10, y: 10, width: 50, height: 50 });

  function grouped(
    groupBox: Partial<PlanBox>,
    children: readonly PlanNode[] = [child],
  ): ScenePlan {
    return plan([
      node({
        id: "group",
        box: box(groupBox),
        content: { kind: "group" },
        children,
      }),
    ]);
  }

  it("land at the group’s position plus their own", () => {
    // The conversion this whole file is for: 100 + 10 + 25.
    const { adapter } = mount();

    adapter.apply(grouped({ x: 100, y: 100, width: 200, height: 200 }));

    expect(absoluteCentre(adapter.objectFor("child")!)).toEqual({
      x: 135,
      y: 135,
    });
  });

  it("keep the group’s own authored size, which Fabric would otherwise recompute", () => {
    // `FitContentLayout` — the default — would shrink the group to its
    // children's bounding box, which is 60x60 here, and §137's reversal says
    // the authored box is the group's.
    const { adapter } = mount();

    adapter.apply(grouped({ x: 100, y: 100, width: 200, height: 200 }));

    const group = adapter.objectFor("group")!;

    expect(group).toBeInstanceOf(Group);
    expect(group).toMatchObject({ width: 200, height: 200 });
    expect(absoluteCentre(group)).toEqual({ x: 200, y: 200 });
  });

  it("take the children’s extent when the document gives the group no size", () => {
    // Not an edge case: `capabilities.ts` gives a group position but no size,
    // so most authored groups arrive at 0x0. In the DOM that was harmless — a
    // zero-sized div does not clip — but `FabricObject.render` starts with
    // `isNotVisible()`, which is true at width 0, height 0 and no stroke, so
    // the group returned before drawing a single child. Three levels of nested
    // group vanished from the stress fixture under a green suite.
    const { adapter } = mount();

    adapter.apply(grouped({ x: 100, y: 100, width: 0, height: 0 }));

    const group = adapter.objectFor("group")!;

    expect(group.width).toBeGreaterThan(0);
    expect(group.height).toBeGreaterThan(0);
    expect(group.isNotVisible()).toBe(false);

    // And the child has not moved: a sized group must not reposition what it
    // contains. Authored at 10,10 within a group at 100,100, so 135,135.
    expect(absoluteCentre(adapter.objectFor("child")!)).toEqual({
      x: 135,
      y: 135,
    });
  });

  it("keep an authored group size rather than fitting to content", () => {
    // The other half, and §137's reversal: a group that *has* geometry owns it.
    const { adapter } = mount();

    adapter.apply(grouped({ x: 100, y: 100, width: 200, height: 200 }));

    expect(adapter.objectFor("group")).toMatchObject({
      width: 200,
      height: 200,
    });
  });

  it("rotate with the group, about the group’s centre", () => {
    // A rotated group is where "build at the content origin, then transform"
    // earns itself: adding a child to an already-rotated group would invert
    // the rotation into the child's coordinates and place it somewhere the
    // document never asked for.
    const { adapter } = mount();

    adapter.apply(
      grouped({ x: 0, y: 0, width: 200, height: 200, rotation: 90 }),
    );

    // The child's centre is at (35, 35) unrotated, i.e. (-65, -65) from the
    // group's centre at (100, 100). Rotating that by 90° clockwise gives
    // (65, -65), so the child lands at (165, 35).
    const centre = absoluteCentre(adapter.objectFor("child")!);

    expect(centre.x).toBeCloseTo(165, 6);
    expect(centre.y).toBeCloseTo(35, 6);
  });

  it("are nested inside the group rather than added to the canvas", () => {
    const { canvas, adapter } = mount();

    adapter.apply(grouped({ width: 200, height: 200 }));

    expect(canvas.getObjects()).toHaveLength(1);
    expect(adapter.objectFor("child")?.group).toBe(adapter.objectFor("group"));
  });

  it("move with the group when a later plan moves it", () => {
    const { adapter } = mount();

    adapter.apply(grouped({ x: 100, y: 100, width: 200, height: 200 }));
    adapter.apply(grouped({ x: 300, y: 100, width: 200, height: 200 }));

    expect(absoluteCentre(adapter.objectFor("child")!)).toEqual({
      x: 335,
      y: 135,
    });
  });

  it("move on their own when a later plan moves only the child", () => {
    // The update path, which has no `Group.add()` to convert for it — this is
    // what `withinGroup` is for, and the number says whether it was applied.
    const { adapter } = mount();

    adapter.apply(grouped({ x: 100, y: 100, width: 200, height: 200 }));
    adapter.apply(
      grouped({ x: 100, y: 100, width: 200, height: 200 }, [
        rectangle("child", { x: 50, y: 10, width: 50, height: 50 }),
      ]),
    );

    expect(absoluteCentre(adapter.objectFor("child")!)).toEqual({
      x: 175,
      y: 135,
    });
  });
});

describe("updating a scene", () => {
  it("moves an object instead of replacing it", () => {
    const { canvas, adapter } = mount();

    adapter.apply(
      plan([rectangle("r", { x: 0, y: 0, width: 10, height: 10 })]),
    );

    const first = adapter.objectFor("r");

    adapter.apply(
      plan([rectangle("r", { x: 40, y: 0, width: 10, height: 10 })]),
    );

    expect(adapter.objectFor("r")).toBe(first);
    expect(canvas.getObjects()).toHaveLength(1);
    expect(absoluteCentre(first!)).toEqual({ x: 45, y: 5 });
  });

  it("re-applies a changed style, including one that clears a shadow", () => {
    const { adapter } = mount();

    adapter.apply(
      plan([
        rectangle(
          "r",
          { width: 10, height: 10 },
          { fill: "#f00", shadowColor: "#000" },
        ),
      ]),
    );
    expect(adapter.objectFor("r")?.shadow).not.toBeNull();

    adapter.apply(
      plan([rectangle("r", { width: 10, height: 10 }, { fill: "#0f0" })]),
    );

    expect(adapter.objectFor("r")).toMatchObject({ fill: "#0f0" });
    expect(adapter.objectFor("r")?.shadow).toBeNull();
  });

  it("hides a node the document turned off", () => {
    const { adapter } = mount();
    const shown = rectangle("r", { width: 10, height: 10 });

    adapter.apply(plan([shown]));
    expect(adapter.objectFor("r")?.visible).toBe(true);

    adapter.apply(plan([{ ...shown, visible: false }]));
    expect(adapter.objectFor("r")?.visible).toBe(false);
  });

  it("removes a node the document dropped, and disposes it", () => {
    const { canvas, adapter } = mount();

    adapter.apply(
      plan([
        rectangle("keep", { width: 10, height: 10 }),
        chartNode("drop", { width: 200, height: 100 }),
      ]),
    );

    const chart = adapter.objectFor("drop") as YunariChart;

    expect(chart.disposed).toBe(false);

    adapter.apply(plan([rectangle("keep", { width: 10, height: 10 })]));

    expect(adapter.objectFor("drop")).toBeUndefined();
    expect(canvas.getObjects()).toHaveLength(1);
    // `canvas.remove()` does not dispose, so the adapter — the party removing a
    // node the document dropped — says so itself (`vg-486`). Without
    // it a chart leaks its ECharts instance and its backing store: 196x the heap
    // over 100 cycles, measured.
    expect(chart.disposed).toBe(true);
  });

  it("rebuilds when the tree changes shape rather than mismatching objects", () => {
    // A node that changes content kind is a different Fabric class, and one
    // that changes parent is in a different coordinate space. Reusing an object
    // across either is how a scene ends up subtly, unexplainably wrong.
    const { adapter } = mount();

    adapter.apply(plan([rectangle("r", { width: 10, height: 10 })]));

    const before = adapter.objectFor("r");

    adapter.apply(
      plan([
        node({
          id: "r",
          box: box({ width: 10, height: 10 }),
          content: { kind: "shape", shape: "ellipse", cornerRadius: 0 },
        }),
      ]),
    );

    expect(adapter.objectFor("r")).not.toBe(before);
    expect(adapter.objectFor("r")).toBeInstanceOf(Ellipse);
  });
});

describe("charts", () => {
  it("builds one from the plan’s authored settings, not from the built option", () => {
    const { adapter } = mount();

    adapter.apply(
      plan([chartNode("c", { x: 10, y: 20, width: 300, height: 180 })]),
    );

    const chart = adapter.objectFor("c");

    expect(chart).toBeInstanceOf(YunariChart);
    // `settings` is what the object persists, and it is only in the plan
    // because a renderer may have to create the chart.
    expect((chart as YunariChart).settings).toEqual(defaultLineSettings);
    expect(absoluteCentre(chart!)).toEqual({ x: 160, y: 110 });
  });

  it("hands over every frame’s option without comparing them", () => {
    const { adapter } = mount();

    adapter.apply(plan([chartNode("c", { width: 300, height: 180 }, 10)]));

    const chart = adapter.objectFor("c") as YunariChart;
    const setOption = vi.spyOn(chart, "setOption");

    adapter.apply(plan([chartNode("c", { width: 300, height: 180 }, 90)]));

    expect(setOption).toHaveBeenCalledTimes(1);
  });

  it("re-lays out rather than scaling when the box changes", () => {
    const { adapter } = mount();

    adapter.apply(plan([chartNode("c", { width: 300, height: 180 })]));

    const chart = adapter.objectFor("c") as YunariChart;

    adapter.apply(plan([chartNode("c", { width: 400, height: 200 })]));

    // Re-layout, so ECharts re-ticks its axes and type stays at its authored
    // size — which means the Fabric scale must be back at 1.
    expect(chart).toMatchObject({
      width: 400,
      height: 200,
      scaleX: 1,
      scaleY: 1,
    });
  });

  it("refuses a chart with no size instead of taking the frame down", () => {
    // `YunariChart` throws on a zero-sized box, correctly. A document that
    // gets here is a validation failure, and killing the frame for it would
    // hide every other node's problem.
    const onUnsupported = vi.fn();
    const { canvas, adapter } = mount({ onUnsupported });

    expect(() =>
      adapter.apply(plan([chartNode("c", { width: 0, height: 0 })])),
    ).not.toThrow();

    expect(onUnsupported).toHaveBeenCalledWith(
      "c",
      expect.stringContaining("positive size"),
    );
    expect(canvas.getObjects()).toHaveLength(0);
  });

  it("passes the render scale on, and a later change to it", () => {
    const { adapter } = mount();

    adapter.apply(plan([chartNode("c", { width: 300, height: 180 })]));
    adapter.setRenderScale(2);

    expect((adapter.objectFor("c") as YunariChart).renderScale).toBe(2);
  });
});

describe("what it will not draw", () => {
  it("reports a video rather than pretending", () => {
    // Measured and rejected: a full-canvas repaint per frame, 22.9–28.2 ms
    // against a 33.3 ms budget. Stage 7 puts it on a DOM layer behind the
    // canvas instead.
    const onUnsupported = vi.fn();
    const { canvas, adapter } = mount({ onUnsupported });

    adapter.apply(
      plan([
        node({
          id: "v",
          box: box({ width: 100, height: 100 }),
          content: { kind: "video", src: "/clip.mp4", loop: true, muted: true },
        }),
      ]),
    );

    expect(onUnsupported).toHaveBeenCalledWith(
      "v",
      expect.stringContaining("video"),
    );
    expect(canvas.getObjects()).toHaveLength(0);
  });

  it("reports a style property canvas has no equivalent for", () => {
    const onUnsupported = vi.fn();
    const { adapter } = mount({ onUnsupported });

    adapter.apply(plan([textNode("t", "42", { tabularNumerals: true })]));

    expect(onUnsupported).toHaveBeenCalledWith(
      "t",
      expect.stringContaining("tabularNumerals"),
    );
  });
});

describe("a scene that already exists", () => {
  it("is adopted by id rather than duplicated", () => {
    // The stage-3 seam: a scene revived with `loadFromJSON` arrives as objects
    // carrying their own geometry and their `id`, and the plan must configure
    // them rather than replace them. Building the identity map by *reading* the
    // canvas is what makes that work — and this is testable now, before the
    // format lands, because it is the same map either way.
    const canvas = new StaticCanvas(undefined, { width: 1920, height: 1080 });
    const existing = new Rect({
      width: 10,
      height: 10,
      originX: "center",
      originY: "center",
    });

    existing.set("id", "r");
    canvas.add(existing);
    canvases.push(canvas);

    const adapter = createSceneAdapter({ canvas });
    adapters.push(adapter);

    adapter.apply(
      plan([rectangle("r", { x: 40, y: 40, width: 10, height: 10 })]),
    );

    expect(canvas.getObjects()).toHaveLength(1);
    expect(adapter.objectFor("r")).toBe(existing);
    expect(absoluteCentre(existing)).toEqual({ x: 45, y: 45 });
  });
});

describe("a font arriving after the first paint", () => {
  /**
   * A stand-in for `FontFaceSet`.
   *
   * `document.fonts` is **undefined** under jsdom — verified, and it is why
   * every other test in this file passes without a stub: the adapter guards
   * the lookup rather than assuming a browser. So the hook cannot be observed
   * without supplying one.
   */
  function stubFontFaceSet(): {
    fire: () => void;
    listeners: () => number;
    restore: () => void;
  } {
    const target = new EventTarget() as EventTarget & {
      ready: Promise<unknown>;
    };
    const add = target.addEventListener.bind(target);
    const remove = target.removeEventListener.bind(target);
    let count = 0;

    // Never resolves. The `loadingdone` path is the one under test, and a
    // resolving `ready` would fire a second, untimed re-apply into it.
    target.ready = new Promise(() => {});

    target.addEventListener = (...args: Parameters<typeof add>) => {
      count += 1;
      add(...args);
    };
    target.removeEventListener = (...args: Parameters<typeof remove>) => {
      count -= 1;
      remove(...args);
    };

    Object.defineProperty(document, "fonts", {
      value: target,
      configurable: true,
    });

    return {
      fire: () => target.dispatchEvent(new Event("loadingdone")),
      listeners: () => count,
      restore: () => {
        Reflect.deleteProperty(document, "fonts");
      },
    };
  }

  it("re-measures text against the face that arrived", () => {
    // The DOM path reflows for free when a face lands; a canvas measured its
    // text once, at `initDimensions()`, and every alignment, ellipsis cut and
    // line clamp was computed from the fallback's metrics.
    //
    // Text only — not a full re-apply, which would also re-send every chart's
    // option and restack the canvas at a moment no clock controls.
    //
    // Observed by tampering rather than by counting calls: the re-measure is
    // only worth anything if it actually rewrites the object.
    const fonts = stubFontFaceSet();

    try {
      const canvas = new StaticCanvas(undefined, { width: 1920, height: 1080 });
      canvases.push(canvas);

      const adapter = createSceneAdapter({ canvas });
      adapters.push(adapter);

      adapter.apply(plan([textNode("t", "CPU 42%")]));

      const object = adapter.objectFor("t");

      expect(object).toBeDefined();
      object?.set("text", "measured against the fallback");

      fonts.fire();

      expect(object?.get("text")).toBe("CPU 42%");
    } finally {
      fonts.restore();
    }
  });

  it("unsubscribes on dispose, so a torn-down scene is not kept alive", () => {
    // Asserted as listener removal rather than as "nothing happens", and the
    // difference matters: dropping `lastPlan` in `dispose` already makes the
    // callback a no-op, so a behavioural assertion here passes with the
    // unsubscribe deleted. Verified by deleting it. What the unsubscribe is
    // actually for is the leak — a live listener on `document.fonts` holds the
    // closure, and through it the canvas and every object on it, for as long as
    // the page lives.
    const fonts = stubFontFaceSet();

    try {
      const canvas = new StaticCanvas(undefined, { width: 1920, height: 1080 });
      canvases.push(canvas);

      const adapter = createSceneAdapter({ canvas });

      adapter.apply(plan([textNode("t", "CPU 42%")]));

      expect(fonts.listeners()).toBe(1);

      adapter.dispose();

      expect(fonts.listeners()).toBe(0);
      expect(() => {
        fonts.fire();
      }).not.toThrow();
      expect(canvas.getObjects()).toHaveLength(0);
    } finally {
      fonts.restore();
    }
  });
});
