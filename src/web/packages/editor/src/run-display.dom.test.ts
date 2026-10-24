// @vitest-environment jsdom

import { YUNARI_TEXT_PROPERTY } from "@yunari/scene-fabric";
import { Canvas, Textbox } from "fabric/es";
import { describe, expect, it } from "vitest";
import { LiveRuntime } from "./live-runtime.js";

/**
 * What a value run shows while an author works on the theme.
 *
 * The canvas default is the value, because a dashboard that shows
 * `@ram.used.percent` where the reader expects `61%` is not a preview of the
 * thing. The token is what an author needs *while editing that run*, and the
 * object's own `isEditing` is the only thing that knows when that is.
 */

const AUTHORED = {
  runs: [
    { kind: "literal" as const, text: "MEM " },
    {
      kind: "value" as const,
      bindingId: "load",
      precision: 0,
      unitDisplay: "none" as const,
    },
    { kind: "literal" as const, text: " %" },
  ],
};

const BINDINGS = {
  "mem-label": [{ id: "load", semanticKey: "ram.used.percent" }],
};

function sample(value: number) {
  return {
    latest: (key: string) =>
      key === "ram.used.percent"
        ? {
            sensorId: key,
            timestamp: "2026-09-20T00:00:00.000Z",
            status: "ok" as const,
            value,
          }
        : undefined,
    history: () => [],
  };
}

function scene(): { canvas: Canvas; objects: Record<string, Textbox> } {
  const canvas = new Canvas(document.createElement("canvas"));
  const make = (id: string): Textbox => {
    const object = new Textbox("MEM -- %", { id });
    object.set(YUNARI_TEXT_PROPERTY, AUTHORED);
    canvas.add(object);
    return object;
  };
  return {
    canvas,
    objects: { "mem-label": make("mem-label"), other: make("other") },
  };
}

function runtimeOf(canvas: Canvas): LiveRuntime {
  const runtime = new LiveRuntime({
    canvas,
    bindings: {
      "mem-label": BINDINGS["mem-label"],
      other: BINDINGS["mem-label"],
    },
    source: sample(61),
  });
  runtime.refresh();
  return runtime;
}

describe("what a value run shows", () => {
  it("shows the reading by default, not the token", () => {
    const { canvas, objects } = scene();
    runtimeOf(canvas);

    expect(objects["mem-label"]?.text).toBe("MEM 61 %");
  });

  it("shows the token for the object about to be edited, and the value beside it", () => {
    const { canvas, objects } = scene();
    const runtime = runtimeOf(canvas);
    const edited = objects["mem-label"] as Textbox;

    // Fabric enters editing on the first click's mouse-up, so the runtime is
    // asked for the authoring view once the object is already editing. Only
    // that object changes: its neighbour shows a reading, and stays on one.
    edited.enterEditing();
    runtime.showAuthoringView(edited);

    expect(edited.text).toBe("MEM @ram.used.percent %");
    expect(objects["other"]?.text).toBe("MEM 61 %");
  });

  it("leaves the object being typed into alone on every later refresh", () => {
    const { canvas, objects } = scene();
    const runtime = runtimeOf(canvas);
    const edited = objects["mem-label"] as Textbox;

    edited.enterEditing();
    runtime.showAuthoringView(edited);
    edited.set("text", "MEM 16.0 G");
    runtime.refresh();
    runtime.refresh();

    // Otherwise the periodic pass would replace what was just typed.
    expect(edited.text).toBe("MEM 16.0 G");
  });

  it("goes back to the reading when editing ends", () => {
    const { canvas, objects } = scene();
    const runtime = runtimeOf(canvas);
    const edited = objects["mem-label"] as Textbox;

    edited.enterEditing();
    runtime.showAuthoringView(edited);
    edited.exitEditing();
    runtime.refresh();

    expect(edited.text).toBe("MEM 61 %");
  });

  it("leaves the authored runs alone while it shows a token", () => {
    const { canvas, objects } = scene();
    const runtime = runtimeOf(canvas);

    runtime.showAuthoringView(objects["mem-label"] as Textbox);

    expect(objects["mem-label"]?.get(YUNARI_TEXT_PROPERTY)).toEqual(AUTHORED);
  });
});
