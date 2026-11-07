// @vitest-environment jsdom
import { Canvas, Rect } from "fabric/es";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createIndicatorManager, formatAngle, formatSize } from "./index.js";
import { IndicatorStore } from "./store.js";

function pointer(): MouseEvent {
  return new MouseEvent("mousemove", { clientX: 40, clientY: 60 });
}

// Fabric's render pass touches the 2D context; jsdom's real context cannot
// drawImage an undecoded img, so the paint is made inert (browser covers paint).
beforeEach(() => {
  const real = document.createElement("canvas").getContext("2d");
  if (real !== null) {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () =>
        new Proxy(real, {
          get(target, property) {
            if (property === "drawImage") return (): void => {};
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
          set(target, property, value) {
            if (property === "patternQuality") return true;
            return Reflect.set(target, property, value);
          },
        }) as unknown as CanvasRenderingContext2D,
    );
  }
});

describe("formatAngle", () => {
  it("rounds to a whole degree with the degree sign", () => {
    expect(formatAngle(12.4)).toBe("12°");
    expect(formatAngle(0)).toBe("0°");
  });

  it("normalises to the range -180 to 180", () => {
    expect(formatAngle(190)).toBe("-170°");
    expect(formatAngle(-190)).toBe("170°");
    expect(formatAngle(720)).toBe("0°");
  });

  it("keeps a negative sign and never prepends a plus", () => {
    expect(formatAngle(-45)).toBe("-45°");
    expect(formatAngle(45)).toBe("45°");
  });
});

describe("formatSize", () => {
  it("rounds each dimension and joins them", () => {
    expect(formatSize({ width: 100.4, height: 50.6 })).toBe("100 × 51");
  });

  it("rounds a .5 boundary up despite float error", () => {
    expect(formatSize({ width: 0.5, height: 1.5 })).toBe("1 × 2");
  });

  it("separates thousands with a space", () => {
    expect(formatSize({ width: 1234, height: 12345 })).toBe("1 234 × 12 345");
  });

  it("takes the absolute value so a flip still reads correctly", () => {
    expect(formatSize({ width: -100, height: 50 })).toBe("100 × 50");
  });

  it("is undefined for a non-finite dimension", () => {
    expect(formatSize({ width: Number.NaN, height: 50 })).toBeUndefined();
    expect(
      formatSize({ width: Number.POSITIVE_INFINITY, height: 5 }),
    ).toBeUndefined();
  });
});

describe("IndicatorManager", () => {
  it("publishes the angle while rotating and clears it when modified", () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const object = new Rect({ id: "shape", width: 10, height: 10, angle: 30 });
    canvas.add(object);
    const store = new IndicatorStore();
    const indicators = createIndicatorManager({ canvas, store });

    canvas.fire(
      "object:rotating" as never,
      { transform: { target: object }, e: pointer() } as never,
    );
    expect(store.get().angle).toEqual({ visible: true, text: "30°" });

    canvas.fire("object:modified" as never, { target: object } as never);
    expect(store.get().angle.visible).toBe(false);
    indicators.destroy();
  });

  it("publishes the scaled size while scaling", () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const object = new Rect({
      id: "shape",
      width: 100,
      height: 50,
      strokeWidth: 0,
    });
    canvas.add(object);
    const store = new IndicatorStore();
    const indicators = createIndicatorManager({ canvas, store });

    canvas.fire(
      "object:scaling" as never,
      { transform: { target: object }, e: pointer() } as never,
    );

    expect(store.get().size).toEqual({ visible: true, text: "100 × 50" });
    indicators.destroy();
  });

  it("stays silent when its option is off", () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const object = new Rect({ id: "shape", width: 10, height: 10, angle: 30 });
    canvas.add(object);
    const store = new IndicatorStore();
    const indicators = createIndicatorManager({
      canvas,
      store,
      showRotationAngle: false,
    });

    canvas.fire(
      "object:rotating" as never,
      { transform: { target: object }, e: pointer() } as never,
    );

    expect(store.get().angle.visible).toBe(false);
    indicators.destroy();
  });

  it("suppresses the size indicator for a locked object", () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const object = new Rect({
      id: "shape",
      width: 10,
      height: 10,
      locked: true,
    });
    canvas.add(object);
    const store = new IndicatorStore();
    const indicators = createIndicatorManager({ canvas, store });

    canvas.fire(
      "object:scaling" as never,
      { transform: { target: object }, e: pointer() } as never,
    );

    expect(store.get().size.visible).toBe(false);
    indicators.destroy();
  });

  it("clears a reading left over from the session it is releasing", () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const object = new Rect({ id: "shape", width: 10, height: 10, angle: 30 });
    canvas.add(object);
    const store = new IndicatorStore();
    const indicators = createIndicatorManager({ canvas, store });
    canvas.fire(
      "object:rotating" as never,
      { transform: { target: object }, e: pointer() } as never,
    );

    indicators.destroy();

    expect(store.get().angle).toEqual({ visible: false, text: "" });
    expect(store.get().size).toEqual({ visible: false, text: "" });
  });

  it("reports scene size rather than screen size when the camera is zoomed", () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const object = new Rect({
      id: "shape",
      width: 100,
      height: 50,
      strokeWidth: 0,
    });
    canvas.add(object);
    // Zoom the CAMERA, not the object: `getScaledWidth()` must ignore this, or the
    // readout would report the on-screen size and disagree with the inspector.
    canvas.setViewportTransform([2, 0, 0, 2, 0, 0]);
    const store = new IndicatorStore();
    const indicators = createIndicatorManager({ canvas, store });

    canvas.fire(
      "object:scaling" as never,
      { transform: { target: object }, e: pointer() } as never,
    );

    expect(store.get().size.text).toBe("100 × 50");
    indicators.destroy();
  });
});
