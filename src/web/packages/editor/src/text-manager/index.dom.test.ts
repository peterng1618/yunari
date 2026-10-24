// @vitest-environment jsdom
import { applyAuthoredText, YUNARI_TEXT_PROPERTY } from "@yunari/scene-fabric";
import { Canvas, IText, Textbox } from "fabric/es";
import { describe, expect, it, vi } from "vitest";
import {
  createTextManager,
  PLACEMENT_DRAG_THRESHOLD,
  type TextPlacementPort,
} from "./index.js";

/**
 * A double-click on a bound run, and a width the author dragged.
 *
 * A value run has no text of its own, so a double-click that merely put a
 * cursor in the middle of a painted reading would make typing *insert* a
 * character into a value that no longer means anything. The run is selected, so
 * the first keystroke replaces it, and what was typed becomes the authored run.
 */

const TOKEN = "@ram.used.percent";
const AUTHORED = {
  runs: [
    {
      kind: "value" as const,
      bindingId: "load",
      typePreset: "typePresets.60-600",
    },
  ],
};

/** The starter's `ram-value`: an authored 180-wide box on a bound run. */
function authoredReading(
  id = "ram-value",
  Class: typeof IText | typeof Textbox = Textbox,
): IText {
  const object = new (Class as typeof Textbox)("MEM 61", {
    id,
    left: 40,
    top: 30,
    width: 180,
    fontSize: 32,
    originX: "left",
    originY: "top",
  }) as IText;
  object.set(YUNARI_TEXT_PROPERTY, {
    overflow: "ellipsis",
    align: "center",
    box: { width: 180, height: 72 },
    ...AUTHORED,
  });
  return object;
}

function scene(object: IText | Textbox): Canvas {
  const canvas = new Canvas(document.createElement("canvas"));
  canvas.add(object);
  return canvas;
}

/**
 * Stands in for the session, which owns the run display this painting comes
 * from. The assertion is about the order the manager asks for it in, not about
 * which side owns it.
 */
function withAuthoringView(
  canvas: Canvas,
  save: () => void,
): ReturnType<typeof createTextManager> {
  const text = createTextManager(canvas, save);
  text.setAuthoringView((object) => {
    object.set("text", TOKEN);
  });
  return text;
}

describe("TextManager", () => {
  it("adds selected authored text and saves history", () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const save = vi.fn();
    const manager = createTextManager(canvas, save);

    const text = manager.addText({ text: "New text", fill: "#fff" });

    expect(text).toBeInstanceOf(IText);
    expect(canvas.getActiveObject()).toBe(text);
    expect(save).toHaveBeenCalledOnce();
    expect(text.get("id")).toMatch(/^text-[0-9a-f-]{36}$/);
  });

  it("keeps a caller-supplied id instead of generating one", () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const manager = createTextManager(canvas, vi.fn());

    const text = manager.addText({ text: "New text", id: "explicit-id" });

    expect(text.get("id")).toBe("explicit-id");
  });

  it("creates a Text, with no authored box, when no box is asked for", () => {
    // An auto text measures its own ink; an authored box would be a width the
    // class cannot honour. A seeded one also made a new text a Textbox wearing
    // an IText's name — the class is the width mode, so it is the whole answer.
    const canvas = new Canvas(document.createElement("canvas"));
    const manager = createTextManager(canvas, vi.fn());

    const text = manager.addText({
      text: "New text",
      fontSize: 32,
      yunariText: {
        runs: [{ kind: "literal", text: "New text" }],
      },
    });

    const authored = text.get(YUNARI_TEXT_PROPERTY) as {
      box?: { width: number; height: number };
    };
    expect(text).toBeInstanceOf(IText);
    expect(text).not.toBeInstanceOf(Textbox);
    expect(authored.box).toBeUndefined();
    expect(text.textLines).toHaveLength(1);
    expect(text.width).toBeGreaterThan(0);
  });

  it("creates a Text box whose authored box is the one it was given", () => {
    // The box is the author's rectangle, not a measurement. It is also the
    // width the guard has to hold: Fabric widens a Textbox to its longest word
    // on every `initDimensions`, so the written box is what the next drag and
    // the clip read.
    const canvas = new Canvas(document.createElement("canvas"));
    const manager = createTextManager(canvas, vi.fn());
    const box = { width: 200, height: 80 };

    const text = manager.addText({
      text: "New text",
      fontSize: 32,
      box,
      yunariText: {
        runs: [{ kind: "literal", text: "New text" }],
      },
    });

    const authored = text.get(YUNARI_TEXT_PROPERTY) as {
      box?: { width: number; height: number };
    };
    expect(text).toBeInstanceOf(Textbox);
    expect(authored.box).toEqual(box);
    expect(text.textLines).toHaveLength(1);
    expect(text.width).toBe(box.width);
    // Below the longest unbreakable word: unguarded, Fabric's `initDimensions`
    // widens to that word, so this is the width the guard has to hold.
    expect((text as Textbox).dynamicMinWidth).toBeGreaterThan(40);
    text.set("width", 40);
    expect(text.width).toBe(40);
    expect(
      (text.get(YUNARI_TEXT_PROPERTY) as { box?: { width: number } }).box
        ?.width,
    ).toBe(200);
  });

  it("refuses a box it could not draw, before constructing anything", () => {
    // A zero or NaN dimension becomes a clip that hides the text, and the
    // construction owner reports the throw. Nothing may be added or saved.
    const canvas = new Canvas(document.createElement("canvas"));
    const save = vi.fn();
    const manager = createTextManager(canvas, save);
    const authored = { runs: [{ kind: "literal" as const, text: "New text" }] };

    expect(() =>
      manager.addText({
        text: "New text",
        box: { width: 0, height: 80 },
        yunariText: authored,
      }),
    ).toThrow(/at least 1/);
    expect(() =>
      manager.addText({
        text: "New text",
        box: { width: 200, height: Number.NaN },
        yunariText: authored,
      }),
    ).toThrow(/at least 1/);
    expect(canvas.getObjects()).toHaveLength(0);
    expect(save).not.toHaveBeenCalled();
  });
});

describe.each([
  ["Text", IText],
  ["Text box", Textbox],
] as const)("double-clicking a bound run on a %s", (_name, Class) => {
  const reading = (): IText => authoredReading("ram-value", Class);
  it("paints the token and syncs Fabric's textarea with it", () => {
    // Fabric enters inline editing on the first click's mouse-up, so the
    // object is already editing when the double-click arrives, and its hidden
    // textarea holds the reading. `selectAll` is what pushes the token into that
    // textarea; without the sync the author's first keystroke edits the reading
    // they can no longer see.
    const object = reading();
    const canvas = scene(object);
    const text = withAuthoringView(canvas, vi.fn());

    canvas.fire("mouse:dblclick", { target: object } as never);

    expect(object.isEditing).toBe(true);
    expect(object.text).toBe(TOKEN);
    expect(object.hiddenTextarea?.value).toBe(TOKEN);
    text.destroy();
  });

  it("selects the whole run, so typing replaces it rather than appending", () => {
    const object = reading();
    const canvas = scene(object);
    const text = withAuthoringView(canvas, vi.fn());
    canvas.setActiveObject(object);

    canvas.fire("mouse:dblclick", { target: object } as never);

    expect(object.isEditing).toBe(true);
    // Fabric's own double-click selects a word only while already editing, so
    // the selection has to be made here or the first keystroke inserts.
    expect([object.selectionStart, object.selectionEnd]).toEqual([
      0,
      object.text.length,
    ]);
    text.destroy();
  });

  it("puts the value back on the frame the edit ends, not on the next tick", () => {
    // The token belongs to the edit. Waiting for the sample loop would leave it
    // on the canvas for up to a quarter second after Escape, which reads as a
    // mode rather than as an editing view.
    const object = reading();
    const canvas = scene(object);
    const text = createTextManager(canvas, vi.fn());
    const repaint = vi.fn();
    text.setAuthoringView((target) => target.set("text", TOKEN));
    text.setRepaint(repaint);
    canvas.fire("mouse:dblclick", { target: object } as never);

    object.exitEditing();

    expect(repaint).toHaveBeenCalled();
    text.destroy();
  });

  it("keeps the binding when the author only looked at the run", () => {
    // Fabric's `exitEditing` (`index.mjs:17102-17105`) compares `_textBeforeEdit`
    // to decide whether to fire `modified`; it never restores it. So after a
    // double-click and nothing else, `text` is still the token the authoring
    // view painted, and writing that back would turn a sensor card into prose —
    // permanently, in both mounts, from a gesture that changed nothing.
    const object = reading();
    const canvas = scene(object);
    const text = withAuthoringView(canvas, vi.fn());
    canvas.fire("mouse:dblclick", { target: object } as never);

    expect(object.text).toBe(TOKEN);
    object.exitEditing();

    expect(object.get(YUNARI_TEXT_PROPERTY)).toEqual({
      overflow: "ellipsis",
      align: "center",
      box: { width: 180, height: 72 },
      ...AUTHORED,
    });
    text.destroy();
  });

  it("writes what was typed back as the object's authored run", () => {
    const object = reading();
    const canvas = scene(object);
    const save = vi.fn();
    const text = withAuthoringView(canvas, save);
    canvas.setActiveObject(object);
    canvas.fire("mouse:dblclick", { target: object } as never);

    // What the author types lands on the object, and `editing:exited` is when
    // the content is worth keeping.
    object.set("text", "MEM 16.0 GB");
    object.exitEditing();

    const authored = object.get(YUNARI_TEXT_PROPERTY) as {
      runs: Readonly<Record<string, unknown>>[];
    };
    // The value run became what the author typed, and kept its type preset.
    expect(authored.runs).toHaveLength(1);
    expect(authored.runs[0]).toMatchObject({
      kind: "literal",
      text: "MEM 16.0 GB",
      typePreset: "typePresets.60-600",
    });
    expect(save).toHaveBeenCalled();
    text.destroy();
  });
});

describe("a width the author dragged", () => {
  it("records it as the new authored box, on every step of the drag", () => {
    const object = authoredReading();
    const canvas = scene(object);
    const save = vi.fn();
    const text = withAuthoringView(canvas, save);

    // The statement Fabric's `changeWidth` control executes
    // (`fabric/dist/index.mjs:6737`), then the event it fires around it.
    for (const width of [170, 150, 130, 120]) {
      object.set("width", width);
      canvas.fire("object:resizing", {
        transform: { target: object },
      } as never);
      const authored = object.get(YUNARI_TEXT_PROPERTY) as {
        box?: { width: number };
      };
      expect(authored.box?.width, `step ${width}`).toBe(width);
    }
    text.destroy();
  });

  it("records the first drag on a text that has no box yet", () => {
    // The editor's new text carries runs and no box until something states a
    // size. The resize handler used to return early on that shape, so the pass
    // that followed measured the old clip and the drag snapped back.
    const object = new Textbox("New text", {
      id: "new-text",
      left: 40,
      top: 30,
      width: 180,
      fontSize: 32,
    });
    object.set(YUNARI_TEXT_PROPERTY, {
      runs: [{ kind: "literal", text: "New text" }],
    });
    const canvas = scene(object);
    const text = createTextManager(canvas, vi.fn());

    object.set("width", 260);
    canvas.fire("object:resizing", {
      transform: { target: object },
    } as never);

    const authored = object.get(YUNARI_TEXT_PROPERTY) as {
      box?: { width: number; height: number };
    };
    expect(authored.box?.width).toBe(260);
    // The other dimension is seeded, so the box is never half-written.
    expect(authored.box?.height).toBeCloseTo(object.height, 6);
    text.destroy();
  });

  it("saves once, when the gesture ends, and not once per step", () => {
    // `save` is `history.save()`, a full `serialiseScene` and an undo entry per
    // call. A drag is dozens of `object:resizing` events, so saving on each
    // would be dozens of serialisations and dozens of undos. Fabric reports the
    // gesture as finished on `object:modified`, and that is where the codebase
    // already answers this — see `editor-shell.ts:213-215`.
    const object = authoredReading();
    const canvas = scene(object);
    const save = vi.fn();
    const text = withAuthoringView(canvas, save);

    for (const width of [170, 150, 130, 120]) {
      object.set("width", width);
      canvas.fire("object:resizing", {
        transform: { target: object },
      } as never);
    }
    expect(save).not.toHaveBeenCalled();

    canvas.fire("object:modified", { target: object } as never);
    expect(save).toHaveBeenCalledOnce();
    text.destroy();
  });
});

describe("typing over an object that carries more than one run", () => {
  /**
   * A value and its unit: the shape a card is built from, and the shape Fabric
   * cannot edit. It hands back one flat string and no way to say which run each
   * character came from, so the only write available would drop the siblings.
   */
  function twoRuns(): Textbox {
    const object = new Textbox("42%", { id: "cpu-value", left: 40, top: 30 });
    object.set(YUNARI_TEXT_PROPERTY, {
      runs: [
        { kind: "value" as const, bindingId: "load" },
        { kind: "literal" as const, text: "%" },
      ],
    });
    return object;
  }

  it("keeps both runs and says why, rather than flattening the object", () => {
    const object = twoRuns();
    const canvas = scene(object);
    const save = vi.fn();
    const warn = vi.fn();
    const text = createTextManager(canvas, save, warn);
    let repainted = 0;
    text.setRepaint(() => {
      repainted += 1;
    });
    canvas.setActiveObject(object);
    canvas.fire("mouse:dblclick", { target: object } as never);

    object.set("text", "typed over");
    object.exitEditing();

    const authored = object.get(YUNARI_TEXT_PROPERTY) as {
      runs: readonly { kind: string }[];
    };
    expect(authored.runs).toHaveLength(2);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("more than one run"),
    );
    // The canvas must not be left standing on text the document does not hold.
    expect(repainted).toBe(1);
    text.destroy();
  });
});

/**
 * The placement gesture: a click makes a Text, a drag makes a Text box.
 *
 * The canvas is real and its scene conversion is stubbed to client units, so
 * the assertions read as the gesture's own arithmetic rather than as jsdom's
 * zero-size element. `contained` stands in for the artboard, and `onPlace` for
 * the construction the session owns.
 */
function placementScene(
  options: {
    readonly contained?: TextPlacementPort["contained"];
    /** Off when a test sets the canvas state the arming has to restore. */
    readonly arm?: boolean;
  } = {},
) {
  const canvas = new Canvas(document.createElement("canvas"));
  const getScenePoint = vi.spyOn(canvas, "getScenePoint").mockImplementation(((
    event: PointerEvent,
  ) => ({
    x: event.clientX,
    y: event.clientY,
  })) as never);
  const save = vi.fn();
  const manager = createTextManager(canvas, save);
  const port: TextPlacementPort = {
    contained: vi.fn(options.contained ?? (() => true)),
    onPlace: vi.fn(),
  };
  if (options.arm !== false) manager.beginPlacement(port);
  return { canvas, getScenePoint, manager, port, save };
}

function pointer(
  canvas: Canvas,
  type: "mouse:down" | "mouse:move" | "mouse:up",
  x: number,
  y: number,
  button = 0,
): void {
  canvas.fire(
    type as never,
    {
      e: { clientX: x, clientY: y, button },
    } as never,
  );
}

function escape(): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
}

describe("placing a text by click or drag", () => {
  it("makes a Text at the press point from a click", () => {
    const { canvas, manager, port, save } = placementScene();

    pointer(canvas, "mouse:down", 100, 120);
    pointer(canvas, "mouse:up", 100, 120);

    expect(port.onPlace).toHaveBeenCalledOnce();
    const placement = (port.onPlace as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as Record<string, unknown>;
    expect(placement).toEqual({ left: 100, top: 120 });
    expect("box" in placement).toBe(false);
    // Construction owns the history entry; a gesture-side save would be a
    // second one for the object `onPlace` is about to add.
    expect(save).not.toHaveBeenCalled();
    manager.destroy();
  });

  it("converts the press through getScenePoint", () => {
    // Zoom and pan are Fabric's conversion's business, not this gesture's: a
    // client point that halves in scene units must land at 50, 60.
    const { canvas, getScenePoint, manager, port } = placementScene();
    getScenePoint.mockImplementation(((event: PointerEvent) => ({
      x: event.clientX / 2,
      y: event.clientY / 2,
    })) as never);

    pointer(canvas, "mouse:down", 100, 120);
    pointer(canvas, "mouse:up", 100, 120);

    expect(port.onPlace).toHaveBeenCalledWith({ left: 50, top: 60 });
    manager.destroy();
  });

  it("uses the normalised rectangle of a down-right drag as the box", () => {
    const { canvas, manager, port, save } = placementScene();

    pointer(canvas, "mouse:down", 100, 100);
    pointer(canvas, "mouse:move", 160, 150);
    pointer(canvas, "mouse:up", 160, 150);

    expect(port.onPlace).toHaveBeenCalledOnce();
    expect(port.onPlace).toHaveBeenCalledWith({
      left: 100,
      top: 100,
      box: { width: 60, height: 50 },
    });
    expect(save).not.toHaveBeenCalled();
    manager.destroy();
  });

  it("normalises an up-left drag to a positive box at the upper-left", () => {
    // Review Focus 1: the author drags from the bottom-right towards the
    // top-left. The object may not be created inverted or with a negative size.
    const { canvas, manager, port } = placementScene();

    pointer(canvas, "mouse:down", 160, 150);
    pointer(canvas, "mouse:move", 130, 120);
    pointer(canvas, "mouse:up", 100, 100);

    expect(port.onPlace).toHaveBeenCalledWith({
      left: 100,
      top: 100,
      box: { width: 60, height: 50 },
    });
    manager.destroy();
  });

  it("treats three pixels of jitter as a click", () => {
    // Review Focus 2: the hand shakes on a click; a one-pixel Text box would be
    // an object the author cannot see.
    const { canvas, manager, port } = placementScene();

    pointer(canvas, "mouse:down", 100, 100);
    pointer(canvas, "mouse:move", 103, 100);
    pointer(canvas, "mouse:up", 103, 100);

    expect(port.onPlace).toHaveBeenCalledWith({ left: 100, top: 100 });
    expect(port.onPlace).toHaveBeenCalledOnce();
    manager.destroy();
  });

  it("treats a drag thinner than one scene unit as a click", () => {
    // At or above the pixel threshold but with no drawable box: the author
    // meant a click, not a zero-height Text box.
    const { canvas, manager, port } = placementScene();

    pointer(canvas, "mouse:down", 100, 100);
    pointer(canvas, "mouse:up", 104, 100);

    expect(PLACEMENT_DRAG_THRESHOLD).toBe(4);
    expect(port.onPlace).toHaveBeenCalledWith({ left: 100, top: 100 });
    manager.destroy();
  });

  it("draws a dashed outline that follows the drag and is never content", () => {
    const { canvas, manager, port, save } = placementScene();
    const strokeRect = vi.spyOn(canvas.contextContainer, "strokeRect");
    const setLineDash = vi.spyOn(canvas.contextContainer, "setLineDash");

    pointer(canvas, "mouse:down", 100, 100);
    pointer(canvas, "mouse:move", 160, 150);
    canvas.fire("after:render", {} as never);

    expect(setLineDash).toHaveBeenCalledWith([4, 4]);
    expect(strokeRect).toHaveBeenCalledWith(100, 100, 60, 50);
    // No object and no history entry came from the move: the outline is editor
    // chrome painted after the render, not canvas content.
    expect(canvas.getObjects()).toHaveLength(0);
    expect(port.onPlace).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    manager.destroy();
  });

  it("draws no outline for a click", () => {
    const { canvas, manager } = placementScene();
    const strokeRect = vi.spyOn(canvas.contextContainer, "strokeRect");

    pointer(canvas, "mouse:down", 100, 100);
    pointer(canvas, "mouse:up", 100, 100);
    canvas.fire("after:render", {} as never);

    expect(strokeRect).not.toHaveBeenCalled();
    manager.destroy();
  });

  it("arms a crosshair without target finding and restores the canvas exactly", () => {
    const { canvas, manager, port } = placementScene({ arm: false });
    canvas.defaultCursor = "grab";
    canvas.skipTargetFind = false;
    canvas.selection = true;

    manager.beginPlacement(port);
    expect(canvas.defaultCursor).toBe("crosshair");
    expect(canvas.skipTargetFind).toBe(true);
    expect(canvas.selection).toBe(false);

    pointer(canvas, "mouse:down", 100, 100);
    pointer(canvas, "mouse:up", 100, 100);

    expect(canvas.defaultCursor).toBe("grab");
    expect(canvas.skipTargetFind).toBe(false);
    expect(canvas.selection).toBe(true);
    manager.destroy();
  });

  it("cancels on Escape and leaves no object, history entry or outline", () => {
    // Review Focus 3: the pressed state and the drag outline must both go.
    const { canvas, manager, port, save } = placementScene({ arm: false });
    const strokeRect = vi.spyOn(canvas.contextContainer, "strokeRect");
    canvas.defaultCursor = "grab";
    manager.beginPlacement(port);

    pointer(canvas, "mouse:down", 100, 100);
    pointer(canvas, "mouse:move", 160, 150);
    escape();

    expect(port.onPlace).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(canvas.getObjects()).toHaveLength(0);
    expect(canvas.defaultCursor).toBe("grab");
    expect(canvas.skipTargetFind).toBe(false);
    expect(canvas.selection).toBe(true);
    canvas.fire("after:render", {} as never);
    expect(strokeRect).not.toHaveBeenCalled();
    // The cancelled gesture also disarmed: the release that follows places
    // nothing.
    pointer(canvas, "mouse:up", 160, 150);
    expect(port.onPlace).not.toHaveBeenCalled();
    manager.destroy();
  });

  it("cancels a non-primary press", () => {
    const { canvas, manager, port } = placementScene({ arm: false });
    canvas.defaultCursor = "grab";
    manager.beginPlacement(port);

    pointer(canvas, "mouse:down", 100, 100, 2);
    pointer(canvas, "mouse:up", 100, 100, 2);

    expect(port.onPlace).not.toHaveBeenCalled();
    expect(canvas.defaultCursor).toBe("grab");
    expect(canvas.skipTargetFind).toBe(false);
    expect(canvas.selection).toBe(true);
    manager.destroy();
  });

  it("cancels a press outside the artboard", () => {
    const contained = vi.fn(() => false);
    const { canvas, manager, port } = placementScene({ contained });

    pointer(canvas, "mouse:down", 100, 100);
    pointer(canvas, "mouse:up", 100, 100);

    expect(contained).toHaveBeenCalledWith({ x: 100, y: 100 });
    expect(port.onPlace).not.toHaveBeenCalled();
    expect(canvas.skipTargetFind).toBe(false);
    expect(canvas.selection).toBe(true);
    manager.destroy();
  });

  it("is one-shot: a completed gesture does not place a second object", () => {
    const { canvas, manager, port } = placementScene();

    pointer(canvas, "mouse:down", 100, 100);
    pointer(canvas, "mouse:up", 100, 100);
    pointer(canvas, "mouse:down", 200, 200);
    pointer(canvas, "mouse:up", 200, 200);

    expect(port.onPlace).toHaveBeenCalledOnce();
    manager.destroy();
  });

  it("leaves the one history entry to the construction it asks for", () => {
    const { canvas, manager, save } = placementScene({ arm: false });
    manager.beginPlacement({
      contained: () => true,
      onPlace: (placement) => {
        manager.addText({
          text: "New text",
          ...(placement.box === undefined ? {} : { box: placement.box }),
        });
      },
    });

    pointer(canvas, "mouse:down", 100, 100);
    pointer(canvas, "mouse:up", 160, 150);

    expect(save).toHaveBeenCalledOnce();
    manager.destroy();
  });

  it("disarms and restores on destroy", () => {
    const { canvas, manager, port } = placementScene({ arm: false });
    canvas.defaultCursor = "grab";
    manager.beginPlacement(port);

    manager.destroy();

    expect(canvas.defaultCursor).toBe("grab");
    expect(canvas.skipTargetFind).toBe(false);
    expect(canvas.selection).toBe(true);
    pointer(canvas, "mouse:down", 100, 100);
    pointer(canvas, "mouse:up", 100, 100);
    expect(port.onPlace).not.toHaveBeenCalled();
  });
});

describe("what a text object an author inserts can do", () => {
  it("wraps inside the box the author set", () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const manager = createTextManager(canvas, vi.fn());
    const text = manager.addText({
      text: "New text",
      box: { width: 200, height: 400 },
      yunariText: { runs: [{ kind: "literal", text: "New text" }] },
    });
    canvas.setActiveObject(text);
    text.set(
      "text",
      "AMD Ryzen 7 7800X3D sixteen core thirty two thread processor",
    );

    expect(text.width).toBeLessThanOrEqual(200);
    expect(text.height).toBeGreaterThan(36);
    manager.destroy();
  });

  it("keeps a grown type inside the authored box it was given", () => {
    // **The claim under test, and the measurement behind it.** The starter's
    // `cpu-card-title` is authored 140 x 27.12 for its 24px face. Applying the
    // `90-600` preset leaves `yunariText.box` at exactly {140, 27.12} — it does
    // not grow — while Fabric's own measured height goes 27.12 -> 101.7 and the
    // clip is rebuilt at the box's 27.12. So the glyphs are far taller than the
    // box that is told to contain them, and the canvas shows the title cut off,
    // while the inspector's Height field keeps reporting the box truthfully.
    //
    // The box staying put is not the bug: ADR 0003 makes it the owner precisely
    // so a type change cannot move it, and §89 wants fixed boxes so a reading
    // cannot jitter. The defect is that nothing ever told the box it no longer
    // fits — an author who picks a larger face is left with text they cannot
    // read and a Height field that is right about a box that is wrong.
    const object = authoredReading("cpu-card-title");
    object.set(YUNARI_TEXT_PROPERTY, {
      overflow: "clip",
      align: "left",
      verticalAlign: "top",
      box: { width: 140, height: 27.12 },
      runs: [
        {
          kind: "literal" as const,
          text: "CPU",
          typePreset: "typePresets.90-600",
        },
      ],
    });
    const canvas = scene(object);
    const globals = {
      typePresets: {
        "90-600": {
          name: "Card reading",
          value: { family: "Inter", size: 90, weight: "600" },
        },
      },
    } as never;

    applyAuthoredText(canvas, globals);

    const box = (
      object.get(YUNARI_TEXT_PROPERTY) as {
        box: { width: number; height: number };
      }
    ).box;

    // What the author chose: the box is the owner's, and it has not moved.
    expect(box).toEqual({ width: 140, height: 27.12 });
    // What the canvas now has to fit inside it. The glyphs are 90px, so one
    // line is far taller than the box — measured off the line, because the
    // object's own `height` is the box by design (a `Textbox` re-derives it
    // from the wrapped text on every `initDimensions`, and the pass puts it
    // back at the box so the selection and the clip cannot disagree).
    expect(object.getHeightOfLine(0)).toBeGreaterThan(box.height);
    expect(object.height).toBeCloseTo(box.height, 6);
    // And the clip the object carries is the box, so the overflow is cut off
    // rather than merely reported. This is the visible half of the finding.
    expect(object.clipPath?.height).toBeCloseTo(box.height, 6);
  });
});
