// @vitest-environment jsdom
import { Canvas } from "fabric/es";
import { describe, expect, it, vi } from "vitest";
import { bindViewportNavigation } from "./navigation.js";

function setup() {
  const host = document.createElement("div");
  Object.defineProperties(host, {
    clientWidth: { value: 1000 },
    clientHeight: { value: 800 },
  });
  const canvas = new Canvas(document.createElement("canvas"));
  // The wheel-zoom assertion needs a zoom the test can move: a constant stub
  // would pass with `Math.exp(-deltaY / 1000)`'s sign inverted.
  let zoom = 1;
  const viewport = {
    zoom: () => zoom,
    zoomToPoint: vi.fn(),
    zoomBy: vi.fn(),
    zoomToFit: vi.fn(),
    zoomToSelection: vi.fn(),
    reset: vi.fn(),
    panBy: vi.fn(),
    artboardScreenRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    display: () => undefined,
    showDisplay: vi.fn(),
    displayScreenRect: () => undefined,
    displayShape: () => undefined,
    isFitted: () => false,
    resize: vi.fn(),
    // Declared by Task 1's ViewportManager; navigation does not call it, but the
    // stub has to satisfy the interface or this call does not compile.
    onChange: vi.fn(() => (): void => undefined),
    destroy: vi.fn(),
  };
  const unbind = bindViewportNavigation({ canvas, viewport });
  return {
    canvas,
    viewport,
    unbind,
    setZoom: (value: number) => {
      zoom = value;
    },
  };
}

describe("viewport navigation", () => {
  it("pans vertically on a wheel", () => {
    const { canvas, viewport } = setup();
    canvas.upperCanvasEl.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true }),
    );
    expect(viewport.panBy).toHaveBeenCalledWith(0, -100);
    expect(viewport.zoomToPoint).not.toHaveBeenCalled();
  });

  it("pans horizontally on a shifted wheel", () => {
    const { canvas, viewport } = setup();
    canvas.upperCanvasEl.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 100,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(viewport.panBy).toHaveBeenCalledWith(-100, 0);
  });

  it("zooms about the pointer on a ctrl-wheel", () => {
    const { canvas, viewport } = setup();
    canvas.upperCanvasEl.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -100,
        ctrlKey: true,
        clientX: 40,
        clientY: 50,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(viewport.zoomToPoint).toHaveBeenCalled();
    expect(viewport.panBy).not.toHaveBeenCalled();
  });

  it("pans on a space-drag and stops on release", () => {
    const { canvas, viewport } = setup();
    // The brief requires the grab affordance, and a pan must not select: with
    // target find still on, the same press would drag the object underneath.
    expect(canvas.skipTargetFind).toBe(false);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    expect(canvas.upperCanvasEl.style.cursor).toBe("grab");
    expect(canvas.skipTargetFind).toBe(true);
    canvas.upperCanvasEl.dispatchEvent(
      new MouseEvent("mousedown", {
        clientX: 10,
        clientY: 10,
        bubbles: true,
        cancelable: true,
      }),
    );
    // Fabric re-applies `defaultCursor` on hover, so a cursor written straight
    // to the element is overwritten mid-drag; during the drag the dragging
    // cursor has to be the one Fabric re-applies.
    expect(canvas.defaultCursor).toBe("grabbing");
    window.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: 40,
        clientY: 25,
        buttons: 1,
        bubbles: true,
      }),
    );
    expect(viewport.panBy).toHaveBeenCalledWith(30, 15);
    // A second move pins the anchor update: a handler that kept the first
    // press position as its origin would still satisfy the single-move
    // assertion above.
    window.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: 55,
        clientY: 40,
        buttons: 1,
        bubbles: true,
      }),
    );
    expect(viewport.panBy).toHaveBeenNthCalledWith(2, 15, 15);
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: " " }));
    viewport.panBy.mockClear();
    // Releasing the key gives target find back: a stuck claim would make the
    // canvas permanently unselectable at the end of a pan. The cursor goes
    // back to the pre-gesture value too, not to the pan cursor.
    expect(canvas.skipTargetFind).toBe(false);
    expect(canvas.defaultCursor).toBe("default");
    window.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: 80,
        clientY: 80,
        buttons: 1,
        bubbles: true,
      }),
    );
    expect(viewport.panBy).not.toHaveBeenCalled();
  });

  it("gives back the target-find and selection flags it found, not defaults", () => {
    const { canvas, unbind } = setup();
    // The state the claim is supposed to *preserve*, chosen so that each value
    // differs from what a hardcoded restore would write — `release()` writing
    // `skipTargetFind = false; selection = true;` must fail here. That is exactly
    // what the existing space-drag assertions cannot see: there the captured
    // values happen to equal those literals, so a hardcoded restore passes them.
    //
    // `claim()` writes `skipTargetFind = true` and `selection = false`, so these
    // are also the only pre-set values that leave the claim itself observable at
    // all: a boolean has no third value to distinguish "preserved" from "written".
    canvas.skipTargetFind = true;
    canvas.selection = false;

    window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    // Liveness only — the claim really started, so it is `release()` that runs
    // below. The cursor is the non-vacuous signal here: both flags already hold
    // the values the claim writes, so re-asserting them would prove nothing.
    expect(canvas.upperCanvasEl.style.cursor).toBe("grab");

    window.dispatchEvent(
      new MouseEvent("mousedown", {
        clientX: 10,
        clientY: 10,
        bubbles: true,
        cancelable: true,
      }),
    );
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: " " }));

    // Restored, not reset: a pan must not silently clear a flag something else set.
    expect(canvas.skipTargetFind).toBe(true);
    expect(canvas.selection).toBe(false);
    unbind();
  });

  it("ends the pan when a move reports no button held", () => {
    // A `mouseup` outside the window never reaches `endPan`; without this the
    // claim would outlive the drag and the canvas would never find a target.
    const { canvas, viewport } = setup();
    canvas.upperCanvasEl.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 1,
        clientX: 10,
        clientY: 10,
        bubbles: true,
        cancelable: true,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: 70,
        clientY: 60,
        buttons: 0,
        bubbles: true,
      }),
    );

    expect(viewport.panBy).not.toHaveBeenCalled();
    expect(canvas.skipTargetFind).toBe(false);

    // The gesture is over: a later move with the button down is a fresh drag,
    // not a continuation of the one the window lost.
    window.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: 90,
        clientY: 90,
        buttons: 1,
        bubbles: true,
      }),
    );
    expect(viewport.panBy).not.toHaveBeenCalled();
  });

  it("pans on a middle-drag", () => {
    // Step 3 specifies middle-drag panning; without this test the button
    // number and the release handling are both unverified.
    const { canvas, viewport } = setup();
    canvas.upperCanvasEl.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 1,
        clientX: 10,
        clientY: 10,
        bubbles: true,
        cancelable: true,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: 25,
        clientY: 40,
        buttons: 4,
        bubbles: true,
      }),
    );
    expect(viewport.panBy).toHaveBeenCalledWith(15, 30);
    // The anchor update again: a middle-drag that measured every move from the
    // press point would pass the first assertion and pan twice as fast.
    window.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: 40,
        clientY: 55,
        buttons: 4,
        bubbles: true,
      }),
    );
    expect(viewport.panBy).toHaveBeenNthCalledWith(2, 15, 15);
    window.dispatchEvent(
      new MouseEvent("mouseup", { button: 1, bubbles: true }),
    );
    viewport.panBy.mockClear();
    window.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: 90,
        clientY: 90,
        buttons: 4,
        bubbles: true,
      }),
    );
    expect(viewport.panBy).not.toHaveBeenCalled();
  });

  it("leaves Space to the control that activates on it", () => {
    // Space activates a focused control; claiming it for panning would silently
    // break that control for keyboard users. Each case is asserted separately,
    // so a failure names which control regressed. The default is not prevented
    // either, so the control still sees the key.
    const { canvas } = setup();
    const controls: ReadonlyArray<readonly [string, () => HTMLElement]> = [
      ["button", () => document.createElement("button")],
      [
        "checkbox",
        () => {
          const input = document.createElement("input");
          input.type = "checkbox";
          return input;
        },
      ],
      [
        "anchor with href",
        () => {
          const anchor = document.createElement("a");
          anchor.href = "#layers";
          return anchor;
        },
      ],
      [
        "role=switch",
        () => {
          const span = document.createElement("span");
          span.setAttribute("role", "switch");
          return span;
        },
      ],
    ];

    for (const [name, create] of controls) {
      const control = create();
      document.body.append(control);
      control.focus();
      const event = new KeyboardEvent("keydown", {
        key: " ",
        bubbles: true,
        cancelable: true,
      });
      control.dispatchEvent(event);

      expect([name, event.defaultPrevented]).toEqual([name, false]);
      expect([name, canvas.skipTargetFind]).toEqual([name, false]);
      control.remove();
    }
  });

  it("still claims Space over a text field's owner, and over the canvas", () => {
    // The complement: a text input consumes Space as a character, so the camera
    // must leave it alone; a bare canvas-owned target still pans.
    const { canvas } = setup();
    const text = document.createElement("input");
    text.type = "text";
    document.body.append(text);
    text.focus();
    const typed = new KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
    });
    text.dispatchEvent(typed);
    expect(typed.defaultPrevented).toBe(false);
    expect(canvas.skipTargetFind).toBe(false);
    text.remove();

    // A body-level Space is the camera's.
    const bare = new KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(bare);
    expect(canvas.skipTargetFind).toBe(true);
  });

  it("normalises a line-mode wheel to pixels", () => {
    // A line-mode wheel reports ~3 where a pixel-mode one reports ~48; without
    // normalising, one notch pans ~3px on those mice.
    const { canvas, viewport } = setup();
    canvas.upperCanvasEl.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 48,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        bubbles: true,
        cancelable: true,
      }),
    );
    const pixel = viewport.panBy.mock.calls[0];

    viewport.panBy.mockClear();
    canvas.upperCanvasEl.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 3,
        deltaMode: WheelEvent.DOM_DELTA_LINE,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(viewport.panBy.mock.calls[0]).toEqual(pixel);
  });

  // Direction only, deliberately: pinning the magnitude would assert a literal
  // zoom that moves whenever WHEEL_ZOOM_DIVISOR is retuned. A wrong divisor is
  // uncaught here and would show up as a feel regression, not a failure.
  it("zooms in on a wheel up and out on a wheel down", () => {
    // The modulus is what this observes: with a constant stub zoom, an inverted
    // sign or a wrong divisor would both pass.
    const { canvas, viewport, setZoom } = setup();
    setZoom(2);
    const zoomTo = () =>
      (viewport.zoomToPoint.mock.calls.at(-1)?.[1] as number | undefined) ?? 0;

    canvas.upperCanvasEl.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -100,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(zoomTo()).toBeGreaterThan(2);

    canvas.upperCanvasEl.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 100,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(zoomTo()).toBeLessThan(2);
  });

  it("unbinds every listener", () => {
    const { canvas, viewport, unbind } = setup();
    unbind();
    canvas.upperCanvasEl.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 100, bubbles: true }),
    );
    expect(viewport.panBy).not.toHaveBeenCalled();
  });

  it("defers the camera keys to a focused text field", () => {
    // `-`, `=` and `shift+1` are all ordinary text characters, so an unguarded
    // window listener would zoom while the author types a layer name.
    const { viewport } = setup();
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    const eventFor = (key: string, shiftKey = false) =>
      new KeyboardEvent("keydown", { key, shiftKey, bubbles: true });
    const keys = ["-", "=", "+"];
    // Both delivery paths are covered: a real keystroke inside the field
    // retargets to the field, while a listener that saw the window instead
    // still has to consult what is focused.
    const fieldEvents = keys.map((key) => eventFor(key));
    const windowEvents = [
      ...keys.map((key) => eventFor(key)),
      eventFor("!", true),
    ];

    for (const event of fieldEvents) input.dispatchEvent(event);
    expect(viewport.zoomBy).not.toHaveBeenCalled();

    for (const event of windowEvents) window.dispatchEvent(event);
    expect(viewport.zoomToPoint).not.toHaveBeenCalled();
    expect(viewport.zoomBy).not.toHaveBeenCalled();
    expect(viewport.zoomToFit).not.toHaveBeenCalled();
    // A guard that swallowed the key would also stop a hyphen reaching the
    // field: the event has to stay uncancelled for the character to be typed.
    for (const event of [...fieldEvents, ...windowEvents]) {
      expect(event.defaultPrevented).toBe(false);
    }
    input.remove();
  });

  it("zooms in on =, out on -, and fits on shift+1", () => {
    // The direction is the substance: `zoomBy(any number)` would pass with the
    // sign inverted, which is the difference between zooming in and out.
    const { viewport } = setup();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "=", bubbles: true }),
    );
    expect(viewport.zoomBy).toHaveBeenCalledOnce();
    expect(viewport.zoomBy.mock.calls[0]?.[0]).toBeGreaterThan(1);

    viewport.zoomBy.mockClear();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "-", bubbles: true }),
    );
    expect(viewport.zoomBy.mock.calls[0]?.[0]).toBeLessThan(1);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "!", shiftKey: true, bubbles: true }),
    );
    expect(viewport.zoomToFit).toHaveBeenCalled();
  });
});
