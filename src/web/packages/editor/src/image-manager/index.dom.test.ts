// @vitest-environment jsdom
import { Canvas, FabricImage } from "fabric/es";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  boundedImageElement,
  boundedImportSize,
  createImageManager,
} from "./index.js";

// Fabric's async RAF render of the added image can land after a test ends and
// restoreMocks has restored jsdom's real context, which cannot drawImage an
// undecoded img. The proxy keeps the render inert (browser covers paint).
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

afterEach(() => {
  // `createImageBitmap` does not exist in jsdom; each test that needs it stubs
  // the global, and `restoreMocks` does not undo a `stubGlobal`.
  vi.unstubAllGlobals();
});

/** A plain bitmap stand-in: jsdom's canvas cannot draw one, and the size and
 *  `close` are the two things the decode path is observable through. */
function bitmapStub(
  width: number,
  height: number,
  close = vi.fn(),
): ImageBitmap {
  return { width, height, close } as unknown as ImageBitmap;
}

/** jsdom never loads images; capture decode's src and resolve the load event. */
function interceptDecode(): { readonly urls: string[] } {
  const urls: string[] = [];
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLImageElement.prototype,
    "src",
  )!;
  vi.spyOn(HTMLImageElement.prototype, "src", "set").mockImplementation(
    function (this: HTMLImageElement, value: string) {
      urls.push(value);
      descriptor.set!.call(this, value);
      this.dispatchEvent(new Event("load"));
    },
  );
  return { urls };
}

function decodedImage(width: number, height: number): HTMLImageElement {
  const element = document.createElement("img");
  Object.defineProperty(element, "naturalWidth", { value: width });
  Object.defineProperty(element, "naturalHeight", { value: height });
  return element;
}

describe("ImageManager", () => {
  it("imports, adds and selects an image, then saves history", async () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const save = vi.fn();
    const manager = createImageManager(canvas, save);
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:image");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    vi.spyOn(HTMLImageElement.prototype, "src", "set").mockImplementation(
      function (this: HTMLImageElement, value: string) {
        Object.defineProperty(this, "naturalWidth", { value: 200 });
        Object.defineProperty(this, "naturalHeight", { value: 100 });
        this.dispatchEvent(new Event("load"));
      },
    );
    const file = new File(["pixels"], "logo.png", { type: "image/png" });

    const result = await manager.importImage({ source: file });

    expect(result?.image).toBeInstanceOf(FabricImage);
    expect(canvas.getActiveObject()).toBe(result?.image);
    expect(save).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(result?.image.get("id")).toMatch(/^image-[0-9a-f-]{36}$/);
    // An unnamed row falls back to its id (see `object-name.ts`), which here is
    // `image-<uuid>` — 42 characters in the layer list. Every other creator
    // names through `newObjectName`; the paste path was the one that did not.
    expect(result?.image.get("name")).toBe("Image");
    expect(result?.image.get("format")).toBe("png");
  });

  it("keeps the object URL alive for as long as a history entry can name it", async () => {
    // U4: the URL was revoked the moment decode finished, but the image's
    // persisted `src` is that URL. Any history restore then re-read a dead
    // blob, Fabric could not enliven the image, and undo deleted the asset
    // instead of the edit. A history entry outlives the image instance —
    // undo replaces every object — so removing the image is not the end of it.
    const canvas = new Canvas(document.createElement("canvas"));
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:image");
    interceptDecode();
    const manager = createImageManager(canvas, vi.fn());

    const result = await manager.importImage({
      source: new File(["pixels"], "logo.png", { type: "image/png" }),
    });
    expect(revokeObjectURL).not.toHaveBeenCalled();

    canvas.remove(result?.image as FabricImage);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    manager.destroy();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:image");
  });

  it("revokes the URL of a file that never decoded", async () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:image");
    const manager = createImageManager(canvas, vi.fn());
    vi.spyOn(HTMLImageElement.prototype, "src", "set").mockImplementation(
      function (this: HTMLImageElement) {
        this.dispatchEvent(new Event("error"));
      },
    );

    await expect(
      manager.importImage({
        source: new File(["pixels"], "logo.png", { type: "image/png" }),
      }),
    ).rejects.toThrow();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:image");
  });

  it("derives format from the source MIME type", async () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const manager = createImageManager(canvas, vi.fn());
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:image");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    interceptDecode();
    const file = new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" });

    const result = await manager.importImage({ source: file });

    expect(result?.image.get("format")).toBe("svg");
  });

  it("skips adding and saving when withoutAdding is set", async () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const save = vi.fn();
    const manager = createImageManager(canvas, save);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:image");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    interceptDecode();
    const file = new File(["pixels"], "logo.png", { type: "image/png" });

    await manager.importImage({ source: file, withoutAdding: true });

    expect(canvas.getActiveObject()).toBeUndefined();
    expect(save).not.toHaveBeenCalled();
  });

  it("decodes and resizes an oversized image through createImageBitmap", async () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const manager = createImageManager(canvas, vi.fn());
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:image");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    const probeClose = vi.fn();
    const scaledClose = vi.fn();
    const createImageBitmap = vi
      .fn()
      .mockResolvedValueOnce(bitmapStub(8192, 4096, probeClose))
      .mockResolvedValueOnce(bitmapStub(4096, 2048, scaledClose));
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    const createElement = vi.spyOn(document, "createElement");
    const file = new File(["pixels"], "photo.png", { type: "image/png" });

    const result = await manager.importImage({ source: file });

    // The resize pair is `boundedImportSize` of the source, so the browser
    // downscales off the main thread instead of the drawImage doing it.
    expect(createImageBitmap).toHaveBeenNthCalledWith(2, file, {
      resizeWidth: 4096,
      resizeHeight: 2048,
      resizeQuality: "high",
    });
    expect(
      createElement.mock.calls.filter(([tag]) => tag === "img"),
    ).toHaveLength(0);
    const element = (result?.image as FabricImage).getElement();
    expect(element).toBeInstanceOf(HTMLCanvasElement);
    const bounded = element as HTMLCanvasElement;
    expect([bounded.width, bounded.height]).toEqual([4096, 2048]);
    expect(probeClose).toHaveBeenCalledOnce();
    expect(scaledClose).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it("keeps the object URL as the persisted src after a bitmap decode", async () => {
    // A canvas element would otherwise persist its pixels as a data URL, so
    // every history entry would carry a second copy of the image. The field
    // undo and the package name is the object URL.
    const canvas = new Canvas(document.createElement("canvas"));
    const manager = createImageManager(canvas, vi.fn());
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:image");
    vi.spyOn(URL, "revokeObjectURL");
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue(bitmapStub(1920, 1080)),
    );

    const result = await manager.importImage({
      source: new File(["pixels"], "photo.png", { type: "image/png" }),
    });

    const image = result?.image as FabricImage;
    expect(image.getSrc()).toBe("blob:image");
    expect(image.toObject()).toMatchObject({ src: "blob:image" });
  });

  it("falls back to the element path when createImageBitmap is absent", async () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const manager = createImageManager(canvas, vi.fn());
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:image");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    // jsdom has no `createImageBitmap`, and no stub is installed here.
    expect("createImageBitmap" in globalThis).toBe(false);
    vi.spyOn(HTMLImageElement.prototype, "src", "set").mockImplementation(
      function (this: HTMLImageElement, value: string) {
        Object.defineProperty(this, "naturalWidth", { value: 8192 });
        Object.defineProperty(this, "naturalHeight", { value: 4096 });
        this.dispatchEvent(new Event("load"));
      },
    );

    const result = await manager.importImage({
      source: new File(["pixels"], "photo.png", { type: "image/png" }),
    });

    const bounded = (
      result?.image as FabricImage
    ).getElement() as HTMLCanvasElement;
    expect([bounded.width, bounded.height]).toEqual([4096, 2048]);
  });

  it("retries through the element path when the bitmap decode rejects", async () => {
    // SVG and formats the bitmap decoder refuses take the retry, not a failed
    // import: the element path is the one that produced the image before.
    const canvas = new Canvas(document.createElement("canvas"));
    const manager = createImageManager(canvas, vi.fn());
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:image");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockRejectedValue(new Error("not a bitmap")),
    );
    vi.spyOn(HTMLImageElement.prototype, "src", "set").mockImplementation(
      function (this: HTMLImageElement) {
        Object.defineProperty(this, "naturalWidth", { value: 8192 });
        Object.defineProperty(this, "naturalHeight", { value: 4096 });
        this.dispatchEvent(new Event("load"));
      },
    );

    const result = await manager.importImage({
      source: new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" }),
    });

    const bounded = (
      result?.image as FabricImage
    ).getElement() as HTMLCanvasElement;
    expect([bounded.width, bounded.height]).toEqual([4096, 2048]);
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it("closes the probe when sizing refuses the decoded dimensions", async () => {
    // The size call sits inside the same try as the draw, so a refusal there
    // still releases the bitmap before the error reaches the retry.
    const canvas = new Canvas(document.createElement("canvas"));
    const manager = createImageManager(canvas, vi.fn());
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:image");
    vi.spyOn(URL, "revokeObjectURL");
    const probeClose = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue(bitmapStub(0, 0, probeClose)),
    );
    vi.spyOn(HTMLImageElement.prototype, "src", "set").mockImplementation(
      function (this: HTMLImageElement) {
        this.dispatchEvent(new Event("error"));
      },
    );

    await expect(
      manager.importImage({
        source: new File(["pixels"], "logo.png", { type: "image/png" }),
      }),
    ).rejects.toThrow("Could not decode the selected image.");
    expect(probeClose).toHaveBeenCalledOnce();
  });

  it("revokes the URL when both decode paths fail", async () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const manager = createImageManager(canvas, vi.fn());
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:image");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockRejectedValue(new Error("not a bitmap")),
    );
    vi.spyOn(HTMLImageElement.prototype, "src", "set").mockImplementation(
      function (this: HTMLImageElement) {
        this.dispatchEvent(new Event("error"));
      },
    );

    await expect(
      manager.importImage({
        source: new File(["pixels"], "logo.png", { type: "image/png" }),
      }),
    ).rejects.toThrow("Could not decode the selected image.");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:image");
  });
});

describe("boundedImportSize", () => {
  it("leaves an image within the bound untouched", () => {
    expect(boundedImportSize(1920, 1080)).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it("scales the longest edge down to the bound and preserves aspect", () => {
    expect(boundedImportSize(8192, 4096)).toEqual({
      width: 4096,
      height: 2048,
    });
    expect(boundedImportSize(4096, 8192)).toEqual({
      width: 2048,
      height: 4096,
    });
  });

  it("never rounds a bounded edge below one pixel", () => {
    expect(boundedImportSize(10000, 1)).toEqual({ width: 4096, height: 1 });
  });

  it("refuses a non-finite or non-positive dimension", () => {
    expect(() => boundedImportSize(Number.NaN, 100)).toThrow();
    expect(() => boundedImportSize(0, 100)).toThrow();
    expect(() => boundedImportSize(100, -1)).toThrow();
  });

  it("honours an explicit bound", () => {
    expect(boundedImportSize(1000, 500, 100)).toEqual({
      width: 100,
      height: 50,
    });
  });
});

describe("boundedImageElement", () => {
  it("returns an oversized element downscaled through a canvas", () => {
    const context = {
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context,
    );
    const source = decodedImage(8192, 4096);

    const bounded = boundedImageElement(source);

    expect(bounded).not.toBe(source);
    expect((bounded as HTMLCanvasElement).width).toBe(4096);
    expect((bounded as HTMLCanvasElement).height).toBe(2048);
    expect(context.drawImage).toHaveBeenCalledWith(source, 0, 0, 4096, 2048);
  });

  it("returns the source unchanged when it already fits", () => {
    const source = decodedImage(1920, 1080);

    expect(boundedImageElement(source)).toBe(source);
  });
});
