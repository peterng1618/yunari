// @vitest-environment jsdom
import { reviveScene, serialiseScene } from "@yunari/scene-fabric";
import { Canvas, FabricImage, Rect, Textbox } from "fabric/es";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCropManager } from "../crop-manager/index.js";
import { createErrorManager } from "../error-manager/index.js";
import { createSelectionInspector } from "./index.js";

/** jsdom cannot drawImage an undecoded img inside Fabric's render pass; the
    proxy forwards everything, no-ops only drawImage, and swallows Fabric's
    node-canvas-only `patternQuality` writes. */
beforeEach(() => {
  const real = document.createElement("canvas").getContext("2d");
  if (real === null) return;
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
      }) as CanvasRenderingContext2D,
  );
});

function imageObject(): FabricImage {
  const element = document.createElement("img");
  Object.defineProperty(element, "naturalWidth", { value: 400 });
  Object.defineProperty(element, "naturalHeight", { value: 200 });
  const image = new FabricImage(element, { id: "image-1" });
  image.set({ width: 400, height: 200, left: 100, top: 100 });
  return image;
}

/** A real canvas, a real crop session and a real history, so a drag is Fabric's
    own rather than a stand-in. */
function setup(objects: readonly object[] = []) {
  const canvas = new Canvas(document.createElement("canvas"));
  for (const object of objects) canvas.add(object as never);
  const saveState = vi.fn();
  const suspend = vi.fn(() => {
    const release = vi.fn();
    return release;
  });
  const crop = createCropManager({
    canvas,
    save: saveState,
    suspend: () => {
      suspend();
      return () => {};
    },
    errors: createErrorManager(canvas),
  });
  const editor = {
    canvas,
    cropManager: crop,
    historyManager: { attachGlobals: () => {}, saveState },
    errorManager: { warn: vi.fn(), error: vi.fn() },
  };
  const host = document.createElement("div");
  const inspector = createSelectionInspector(host, {
    editor: editor as never,
    refreshGlass: vi.fn(),
  });
  return { canvas, host, inspector, editor, crop, saveState, suspend };
}

const cropButton = (host: HTMLElement): HTMLButtonElement =>
  host.querySelector<HTMLButtonElement>("[data-yunari-crop]")!;

describe("the crop control", () => {
  it("appears when an image is selected and disappears for a text box", () => {
    const image = imageObject();
    const text = new Textbox("hello", { id: "text-1", width: 100 });
    const { canvas, host, inspector } = setup([image, text]);

    canvas.setActiveObject(image);
    inspector.render();
    expect(cropButton(host)).not.toBeNull();

    canvas.setActiveObject(text);
    inspector.render();
    expect(cropButton(host)).toBeNull();
  });

  it("offers no crop for a rotated image, which the session refuses", () => {
    const image = imageObject();
    const { canvas, host, inspector, crop } = setup([image]);

    // The control is present, and the rotation is what withholds it.
    canvas.setActiveObject(image);
    inspector.render();
    expect(cropButton(host)).not.toBeNull();

    image.set("angle", 30);
    inspector.render();
    expect(cropButton(host)).toBeNull();
    expect(crop.begin()).toBe(false);
    expect(crop.active).toBe(false);
  });

  it("begins, writes no history, and leaves exactly one entry on apply", () => {
    const image = imageObject();
    const { canvas, host, inspector, crop, saveState, suspend } = setup([
      image,
    ]);
    canvas.setActiveObject(image);
    inspector.render();

    cropButton(host).click();

    // History is suspended for the whole session, so the drag that follows
    // cannot record an entry per pixel of travel.
    expect(crop.active).toBe(true);
    expect(suspend).toHaveBeenCalledOnce();
    expect(saveState).not.toHaveBeenCalled();
    // The session's own controls replace the button that started it.
    expect(cropButton(host)).toBeNull();
    expect(host.querySelector("[data-yunari-crop-apply]")).not.toBeNull();

    // The frame is Fabric's own object and the author drags it directly.
    const frame = canvas
      .getObjects()
      .find((candidate) => candidate !== image) as Rect;
    frame.set({ scaleX: 0.5, scaleY: 0.5 });
    frame.setCoords();
    expect(saveState).not.toHaveBeenCalled();

    inspector.render();
    host.querySelector<HTMLButtonElement>("[data-yunari-crop-apply]")!.click();

    expect(image.clipPath).toBeInstanceOf(Rect);
    expect(crop.active).toBe(false);
    // One committed edit per crop, §67.
    expect(saveState).toHaveBeenCalledOnce();
  });

  it("leaves the image exactly as it was, and records nothing, on cancel", () => {
    const image = imageObject();
    const { canvas, host, inspector, saveState } = setup([image]);
    canvas.setActiveObject(image);
    inspector.render();
    cropButton(host).click();

    const frame = canvas
      .getObjects()
      .find((candidate) => candidate !== image) as Rect;
    frame.set({ scaleX: 0.5, scaleY: 0.5 });
    frame.setCoords();

    inspector.render();
    host.querySelector<HTMLButtonElement>("[data-yunari-crop-cancel]")!.click();

    expect(image.clipPath).toBeUndefined();
    expect(canvas.getObjects()).toEqual([image]);
    expect(saveState).not.toHaveBeenCalled();
  });

  it("keeps describing the image while its frame is the active object", () => {
    const image = imageObject();
    const { canvas, host, inspector, crop } = setup([image]);
    canvas.setActiveObject(image);
    inspector.render();
    cropButton(host).click();

    // The session made the frame active; the fields must not follow it there.
    expect(canvas.getActiveObject()).not.toBe(image);
    inspector.render();
    expect(crop.target).toBe(image);
    expect(host.querySelector("[data-yunari-crop-apply]")).not.toBeNull();
  });

  it("locks the frame to the ratio the author picked", () => {
    const image = imageObject();
    const { canvas, host, inspector } = setup([image]);
    canvas.setActiveObject(image);
    inspector.render();
    cropButton(host).click();
    inspector.render();

    host
      .querySelector<HTMLButtonElement>('[data-yunari-crop-aspect="16:9"]')!
      .click();

    const frame = canvas
      .getObjects()
      .find((candidate) => candidate !== image) as Rect;
    // Object space, not the scaled measures: the frame's 1px stroke is part of
    // those, and the session deliberately locks the stroke-free base.
    expect(frame.width / frame.height).toBeCloseTo(16 / 9, 5);
  });

  it("keeps the crop through a save and a reopen", async () => {
    const image = imageObject();
    const { canvas, host, inspector } = setup([image]);
    canvas.setActiveObject(image);
    inspector.render();
    cropButton(host).click();
    const frame = canvas
      .getObjects()
      .find((candidate) => candidate !== image) as Rect;
    frame.set({ scaleX: 0.5, scaleY: 0.25 });
    frame.setCoords();
    inspector.render();
    host.querySelector<HTMLButtonElement>("[data-yunari-crop-apply]")!.click();

    const saved = serialiseScene(canvas);
    const reopened = new Canvas(document.createElement("canvas"));
    await reviveScene(reopened, saved);

    const revived = reopened.getObjects()[0] as FabricImage;
    expect(revived.clipPath).toBeInstanceOf(Rect);
    // Unscaled image-local units, so the crop is the half-width, quarter-height
    // frame the author dragged rather than a pixel measurement. The frame's own
    // 1px stroke is inside the bounds the author sees, so the crop keeps it.
    expect((revived.clipPath as Rect).width).toBeCloseTo(201, 5);
    expect((revived.clipPath as Rect).height).toBeCloseTo(51, 5);
    expect(revived.clipPath).not.toBe(image.clipPath);
  });
});
