import { describe, expect, it } from "vitest";
import { CHART_SERIALISED_KEYS, YunariChart } from "./chart-object.js";

/**
 * The chart object's decisions and its shape.
 *
 * `vitest.config.ts` runs in a **node** environment and says why: unit tests
 * cover pure logic, and visual or cross-device behaviour belongs to Playwright.
 * So nothing here constructs a chart — that needs a document, a 2D context and
 * a live ECharts instance, and asserting against a fake canvas proves nothing
 * about the thing that draws.
 *
 * What *is* testable without a browser turned out to be more than "pure
 * functions". The class object, its statics and its prototype are all
 * inspectable in Node, and the one defect that reached `main` was a prototype
 * shape — so those are asserted here rather than deferred.
 */

describe("the persisted surface", () => {
  it("carries only authored configuration", () => {
    // The §67 rule, structural rather than reviewed. These are `ChartContent`'s
    // keys: the family and the typed settings the document already stores.
    expect([...CHART_SERIALISED_KEYS]).toEqual(["family", "settings"]);
  });

  it("never carries the built engine option", () => {
    // The built option is derived — `plan.ts` rebuilds it from the settings,
    // the theme's tokens and the current samples on every frame — and it holds
    // live readings inside `series[].data`. Serialising it put telemetry in the
    // persisted document where no key-name check could see it: a canvas
    // snapshot would bake a reading into the next undo entry taken for an
    // unrelated reason, and undo would restore a stale number.
    expect([...CHART_SERIALISED_KEYS]).not.toContain("option");

    // Device state, too: renderScale is DPR x viewport zoom, so persisting it
    // would carry the authoring machine's display into a portable document.
    expect([...CHART_SERIALISED_KEYS]).not.toContain("renderScale");
  });

  it("is what Fabric actually emits, not a parallel list", () => {
    // Fabric's own `toObject` concatenates `customProperties` into the keys it
    // picks, so deriving this from CHART_SERIALISED_KEYS makes the declaration
    // and the behaviour one thing. The previous `toObject` override kept a
    // second hand-written list beside it.
    expect(YunariChart.customProperties).toEqual([...CHART_SERIALISED_KEYS]);
  });

  it("leaves revival entirely to Fabric", () => {
    // `FabricObject.fromObject` routes through `_fromObject`, which runs
    // `enlivenObjectEnlivables` first — the step that turns a serialised
    // clipPath, gradient or pattern back into an instance. An override calling
    // `new YunariChart(object)` skipped it and revived a clip path as a plain
    // object, which matters from stage 2, where content is clipped to the
    // artboard.
    expect(Object.hasOwn(YunariChart, "fromObject")).toBe(false);
  });
});

describe("every property Fabric may assign is assignable", () => {
  /**
   * Fabric has exactly one way in: `_setOptions` walks the options bag and does
   * `this[key] = value` for every key (`CommonMethods.ts:9-40`). That path is
   * used by the constructor, by `set`, by `clone` and by `loadFromJSON`, so a
   * key that cannot be assigned breaks all four.
   *
   * This is the test that was missing. `option` was declared as a getter with
   * no setter, so `new YunariChart({ option })` threw
   * `TypeError: Cannot set property option of #<YunariChart> which has only a
   * getter` on **every** construction that supplied one — and because no unit
   * test instantiated the class and the browser tests were deferred to stage 2,
   * the suite stayed green against an object that could not be built.
   *
   * `Object.create` gives a prototype-backed instance without running the
   * constructor, so the assignment path is exercised for real with no DOM.
   */
  const assignableKeys = [
    ...YunariChart.customProperties,
    "option",
    "renderScale",
  ];

  it.each(assignableKeys)("accepts an assignment to `%s`", (key) => {
    const instance = Object.create(YunariChart.prototype) as Record<
      string,
      unknown
    >;

    expect(() => {
      instance[key] = undefined;
    }).not.toThrow();
  });

  it("has no getter-only accessor anywhere on the prototype chain", () => {
    // The general form of the same defect, so a future property cannot
    // reintroduce it under a different name. A read-only view of internal
    // state must not be reachable by a name Fabric might assign.
    const offenders: string[] = [];

    for (
      let prototype: object | null = YunariChart.prototype;
      prototype !== null && prototype !== Object.prototype;
      prototype = Object.getPrototypeOf(prototype) as object | null
    ) {
      for (const [name, descriptor] of Object.entries(
        Object.getOwnPropertyDescriptors(prototype),
      )) {
        if (descriptor.get !== undefined && descriptor.set === undefined) {
          offenders.push(name);
        }
      }
    }

    // `disposed` is read-only by intent and is not a key Fabric assigns from an
    // options bag. Fabric's own `type` does not appear: it pairs its getter
    // with a setter that warns and discards, precisely so this assignment path
    // cannot throw. Anything else appearing here is the bug above returning —
    // give the property a setter, or rename it so it cannot collide with a
    // Fabric property.
    expect(offenders.sort()).toEqual(["disposed"]);
  });
});

describe("the defaults Fabric actually applies", () => {
  it("declares them once, through Fabric’s own mechanism", () => {
    // `FabricObject`'s constructor assigns `FabricObject.ownDefaults` by name
    // rather than calling `this.constructor.getDefaults()` (`Object.ts:370`),
    // so a subclass must assign its own — the pattern `Rect` and `Group` use.
    // Setting them a second time in the constructor body, as this class used
    // to, both duplicated the declaration and overrode the caller.
    expect(YunariChart.getDefaults()).toMatchObject(YunariChart.ownDefaults);
  });

  it("uses Fabric’s centre origin rather than the deprecated top-left", () => {
    // Fabric 7 marks every origin except `center` deprecated ("please use
    // 'center' as value in new projects"). The PlanBox top-left -> centre
    // conversion is two additions in the adapter. Note this value is *not*
    // persisted — it equals the default and defaults are stripped, which is
    // deliberate; see `persist.ts`. It still has to be declared, because
    // `_render` and every box measurement work in centred local space.
    expect(YunariChart.ownDefaults).toMatchObject({
      originX: "center",
      originY: "center",
    });
  });

  it("carries no stroke, so the bounding box is the chart’s box", () => {
    // Fabric adds strokeWidth into `_getTransformedDimensions`, so the default
    // of 1 inflates the bounding box, the hit area and every control position.
    // It is the whole 1.4 px error measured at 37 degrees: 1 x (cos 37 + sin 37)
    // is 1.4004. `_render` never calls `_renderPaintInOrder`, so no stroke was
    // ever drawn — only measured.
    expect(YunariChart.ownDefaults.strokeWidth).toBe(0);
  });

  it("never caches the object", () => {
    // 7.99 ms mean / 36.5 ms p95 at DPR 2.75 against 0.12/0.2 ms, and past
    // viewport zoom ~8 the capped raster is upscaled — the bitmap label §91
    // forbids.
    expect(YunariChart.ownDefaults.objectCaching).toBe(false);
  });
});

describe("how an option reaches the engine", () => {
  /** A prototype-backed instance with a recording engine behind it. */
  function recording(): {
    readonly instance: YunariChart;
    readonly calls: unknown[][];
  } {
    const calls: unknown[][] = [];
    const instance = Object.create(YunariChart.prototype) as YunariChart &
      Record<string, unknown>;

    Object.assign(instance, {
      width: 10,
      height: 10,
      _renderScale: 1,
      _element: { width: 10, height: 10 },
      _chart: {
        setOption: (option: unknown, options: unknown) => {
          calls.push([option, options]);
        },
        resize: () => undefined,
        getZr: () => ({ flush: () => undefined }),
      },
    });

    return { instance, calls };
  }

  it("merges the series and flushes before Fabric blits", () => {
    // `notMerge: true` threw away every component the previous option carried,
    // so a repaint rebuilt the whole chart. `replaceMerge` on the series alone
    // keeps the axes, grid and visual map while still dropping a series the
    // new option no longer has.
    const { instance, calls } = recording();

    instance.setOption({ series: [{ type: "line" }] } as never);

    expect(calls).toEqual([
      [
        { series: [{ type: "line" }] },
        { notMerge: false, replaceMerge: ["series"], lazyUpdate: false },
      ],
    ]);
  });

  it("replaces the whole option when the caller asks for it", () => {
    // A merge never deletes a key the new option omits, and the line builders
    // omit `visualMap` and `yAxis.min`/`max` when the author removes the
    // threshold or clears the bound. An editor settings edit is therefore a
    // replacement; the player's merge stays the default.
    const { instance, calls } = recording();

    instance.setOption({ series: [] } as never, { replace: true });

    expect(calls).toEqual([
      [{ series: [] }, { notMerge: true, lazyUpdate: false }],
    ]);
  });
});
