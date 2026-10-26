// @vitest-environment jsdom

import { YUNARI_TEXT_PROPERTY } from "@yunari/scene-fabric";
import { Canvas, Textbox } from "fabric/es";
import { describe, expect, it } from "vitest";
import { LiveRuntime } from "./live-runtime.js";

/**
 * What the refresh loop costs, counted.
 *
 * The loop runs at the author's chart rate — 30 fps by default — and it used to
 * run both text passes on every tick over every object in the document. A
 * percentage of blocked main thread is the wrong thing to assert: it moves with
 * the machine, the build, and whatever else is running. How many times a text
 * object was re-measured in a fixed interval is not, so that is what these
 * assert. `initDimensions` is Fabric's full re-measure — it re-splits the text,
 * rebuilds the per-line style map and re-measures every grapheme
 * (`fabric/dist/index.mjs:18447`).
 */
function countingMeasures(body: () => void): number {
  const base = Textbox.prototype.initDimensions;
  let count = 0;
  Textbox.prototype.initDimensions = function (this: Textbox) {
    count += 1;
    base.call(this);
  };
  try {
    body();
  } finally {
    Textbox.prototype.initDimensions = base;
  }
  return count;
}

/** Frames the 30 fps loop delivers in 3.2 s, the interval vg-081 measured idle. */
const IDLE_FRAMES = 96;
const IDLE_MS = 3_200;

describe("LiveRuntime", () => {
  it("shows a value run's token only while that object is being edited", async () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const text = new Textbox("CPU --", { id: "cpu-label" });
    const authored = {
      runs: [
        { kind: "literal" as const, text: "CPU " },
        {
          kind: "value" as const,
          bindingId: "load",
          precision: 0,
          unitDisplay: "short" as const,
        },
      ],
    };
    text.set(YUNARI_TEXT_PROPERTY, authored);
    canvas.add(text);

    const runtime = new LiveRuntime({
      canvas,
      bindings: { "cpu-label": [{ id: "load", semanticKey: "cpu.load" }] },
      source: {
        revision: 0,
        latest: () => undefined,
        history: () => [],
      },
    });

    runtime.showAuthoringView(text);
    expect(text.text).toBe("CPU @cpu.load");

    // The token is the authoring view's, not a mode: the same object shows its
    // reading again as soon as the edit ends.
    text.enterEditing();
    runtime.showAuthoringView(text);
    text.exitEditing();
    runtime.refresh();

    expect(text.text).not.toContain("@cpu.load");
    expect(text.get(YUNARI_TEXT_PROPERTY)).toEqual(authored);
    await canvas.dispose();
  });

  it("shows the live value when no object is being edited", async () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const text = new Textbox("CPU --", { id: "cpu-label" });
    const authored = {
      runs: [
        { kind: "literal" as const, text: "CPU " },
        {
          kind: "value" as const,
          bindingId: "load",
          precision: 0,
          unitDisplay: "short" as const,
        },
      ],
    };
    text.set(YUNARI_TEXT_PROPERTY, authored);
    canvas.add(text);

    const runtime = new LiveRuntime({
      canvas,
      bindings: { "cpu-label": [{ id: "load", semanticKey: "cpu.load" }] },
      source: { revision: 0, latest: () => undefined, history: () => [] },
    });

    runtime.setSource({
      revision: 0,
      latest: (key) =>
        key === "cpu.load"
          ? {
              sensorId: "cpu.load",
              timestamp: "2026-09-20T00:00:00.000Z",
              status: "ok",
              value: 48,
              unit: "%",
            }
          : undefined,
      history: () => [],
    });

    expect(text.text).toBe("CPU 48%");
    expect(text.get(YUNARI_TEXT_PROPERTY)).toEqual(authored);
    await canvas.dispose();
  });
});

describe("LiveRuntime tick", () => {
  /**
   * One bound text object and a clock the test owns.
   *
   * `reads` counts the sample pass alone: `refreshBoundText` is the only pass
   * that consults a source, so a call to `latest` is one repaint of the
   * authored-value pass and cannot be confused with the authored pass, which
   * resolves against the empty source and measures the same object again.
   */
  function stage(options: {
    readonly now: () => number;
    readonly bindings?: Record<
      string,
      readonly { id: string; semanticKey: string }[]
    >;
  }): {
    canvas: Canvas;
    text: Textbox;
    runtime: LiveRuntime;
    reads: () => number;
  } {
    const canvas = new Canvas(document.createElement("canvas"));
    const text = new Textbox("CPU --", { id: "cpu-label" });
    // A value run is what makes the sample pass read a source at all; a
    // literal-only object is resolved entirely from authored content, so
    // counting `latest` calls against one would count nothing.
    text.set(YUNARI_TEXT_PROPERTY, {
      runs:
        options.bindings === undefined
          ? [{ kind: "literal", text: "CPU --" }]
          : [
              { kind: "literal", text: "CPU " },
              { kind: "value", bindingId: "load" },
            ],
    });
    canvas.add(text);
    let reads = 0;
    const runtime = new LiveRuntime({
      canvas,
      ...(options.bindings === undefined ? {} : { bindings: options.bindings }),
      source: {
        revision: 0,
        latest: (key) => {
          reads += 1;
          return key === "cpu.load"
            ? {
                sensorId: key,
                timestamp: "2026-09-20T00:00:00.000Z",
                status: "ok",
                value: 48,
                unit: "%",
              }
            : undefined;
        },
        history: () => [],
      },
      now: options.now,
    });
    // The first tick brings a mounted scene current, before any of the counting.
    runtime.tick();
    return { canvas, text, runtime, reads: () => reads };
  }

  it("does not consult the source on a frame inside the sample interval", async () => {
    let clock = 0;
    const { canvas, runtime, reads } = stage({
      now: () => clock,
      bindings: { "cpu-label": [{ id: "load", semanticKey: "cpu.load" }] },
    });
    const before = reads();

    clock = 20;
    runtime.tick();
    expect(reads() - before).toBe(0);
    await canvas.dispose();
  });

  it("consults the source on the first frame past the sample interval", async () => {
    let clock = 0;
    const { canvas, runtime, reads } = stage({
      now: () => clock,
      bindings: { "cpu-label": [{ id: "load", semanticKey: "cpu.load" }] },
    });
    const before = reads();

    clock = 1_000;
    runtime.tick();
    expect(reads() - before).toBeGreaterThan(0);
    await canvas.dispose();
  });

  it("spends a small fraction of an idle frame budget re-measuring, not all of it", async () => {
    // 3.2 s of idle with no gesture, which is the measurement that explains the
    // row: it cost 7,452 re-measures across the document. Per frame it was
    // every text object on every pass; the loop now repaints on the rate the
    // data can actually change at.
    let clock = 0;
    const { canvas, runtime } = stage({
      now: () => clock,
      bindings: { "cpu-label": [{ id: "load", semanticKey: "cpu.load" }] },
    });

    const measures = countingMeasures(() => {
      for (let frame = 1; frame <= IDLE_FRAMES; frame += 1) {
        clock = (frame * IDLE_MS) / IDLE_FRAMES;
        runtime.tick();
      }
    });

    // A per-frame loop repaints on every frame: 96 frames at two passes each is
    // 192 measures here, and across the Starter's 28 text objects it was 7,084
    // in this same interval on the canvas. 3.2 s at 4 Hz is 12 repaints, so 24.
    // Held at half the frame count so the number states the property — the loop
    // is no longer per-frame work — rather than pinning two constants together.
    expect(measures).toBeLessThan(IDLE_FRAMES / 2);
    await canvas.dispose();
  });

  it("repaints a reading as soon as the interval elapses, so a clock still ticks", async () => {
    // The cost of a lower rate is a stale reading, and this is the bound on it:
    // whatever the value is, the object shows it within one sample interval.
    let clock = 0;
    const canvas = new Canvas(document.createElement("canvas"));
    const text = new Textbox("CPU --", { id: "cpu-label" });
    text.set(YUNARI_TEXT_PROPERTY, {
      runs: [
        { kind: "literal", text: "CPU " },
        { kind: "value", bindingId: "load" },
      ],
    });
    canvas.add(text);
    let reading = 48;
    const runtime = new LiveRuntime({
      canvas,
      bindings: { "cpu-label": [{ id: "load", semanticKey: "cpu.load" }] },
      source: {
        revision: 0,
        latest: (key) =>
          key === "cpu.load"
            ? {
                sensorId: "cpu.load",
                timestamp: "2026-09-20T00:00:00.000Z",
                status: "ok",
                value: reading,
                unit: "%",
              }
            : undefined,
        history: () => [],
      },
      now: () => clock,
    });
    runtime.tick();
    expect(text.text).toBe("CPU 48%");

    reading = 51;
    clock = 300;
    runtime.tick();
    expect(text.text).toBe("CPU 51%");
    await canvas.dispose();
  });

  it("repaints authored runs on the very next frame after the palette moves", async () => {
    // A palette drag reaches the canvas only through the loop: the session hands
    // new globals to six owners (`editor-document.ts`'s `#globalsChanged`) and none of them
    // repaints text. So the authored pass is what shows a colour changing as
    // the saturation square is dragged, and it cannot wait for its own interval
    // to come round.
    let clock = 0;
    const { canvas, text, runtime } = stage({
      now: () => clock,
      bindings: { "cpu-label": [{ id: "load", semanticKey: "cpu.load" }] },
    });

    runtime.setGlobals({
      palette: {
        accent: { name: "Accent", value: { kind: "solid", color: "#f00" } },
      },
    });
    clock = 1;
    expect(countingMeasures(() => runtime.tick())).toBeGreaterThan(0);
    expect(text.width).toBeGreaterThan(0);
    await canvas.dispose();
  });

  it("never shows a bound object its placeholder, however the passes are scheduled", async () => {
    // The authored pass repaints every object from its authored runs, and a
    // value run with no sample resolves to its placeholder. The sample pass is
    // what puts the reading back. So the two are not two repaints: run the
    // authored one on its own schedule and every reading on the canvas flashes
    // to its placeholder between them, four times a second, on a dashboard that
    // never stops moving. This is the assertion that would not have caught it —
    // the counts all looked right while the screen was wrong.
    let clock = 0;
    const { canvas, text, runtime } = stage({
      now: () => clock,
      bindings: { "cpu-label": [{ id: "load", semanticKey: "cpu.load" }] },
    });
    expect(text.text).toBe("CPU 48%");

    // Every frame of a second, with the palette moving on one of them: the
    // authored pass is due, the sample pass is not.
    for (let frame = 1; frame <= 30; frame += 1) {
      clock = frame * 33;
      if (frame === 7) {
        runtime.setGlobals({
          palette: {
            accent: { name: "Accent", value: { kind: "solid", color: "#f00" } },
          },
        });
      }
      runtime.tick();
      expect(text.text, `frame ${frame}`).toBe("CPU 48%");
    }
    await canvas.dispose();
  });

  it("repaints everything at once when a setter asks it to", async () => {
    // The change-driven path, and the reason the loop and the setters are two
    // entry points rather than one gated method: a repaint asked for is owed
    // now, whatever the intervals say.
    let clock = 0;
    const { canvas, runtime } = stage({
      now: () => clock,
      bindings: { "cpu-label": [{ id: "load", semanticKey: "cpu.load" }] },
    });

    clock = 1;
    expect(
      countingMeasures(() =>
        runtime.setBindings({
          "cpu-label": [{ id: "load", semanticKey: "cpu.load" }],
        }),
      ),
    ).toBeGreaterThan(0);
    await canvas.dispose();
  });
});
