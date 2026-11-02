// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { bakeStoredThemeCrops } from "./bake-stored.js";

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1,
]);

afterEach(() => {
  vi.restoreAllMocks();
});

function envelope(objects: readonly Record<string, unknown>[]): {
  readonly scene: {
    readonly version: string;
    readonly objects: readonly Record<string, unknown>[];
  };
  readonly assets: readonly {
    readonly id: string;
    readonly kind: "image";
    readonly path: string;
    readonly sha256: string;
  }[];
} {
  return {
    scene: { version: "7.0.0", objects },
    assets: [
      { id: "photo", kind: "image", path: "assets/photo.png", sha256: "old" },
    ],
  };
}

const CROPPED = {
  type: "Image",
  left: 200,
  top: 100,
  width: 100,
  height: 100,
  scaleX: 2,
  scaleY: 2,
  angle: 35,
  flipX: true,
  yunariCrop: true,
  yunariAsset: { assetId: "photo", kind: "image" },
  clipPath: { type: "Rect", left: 0, top: 0, width: 50, height: 40 },
};

function canvasMocks(): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/png;base64,AAAA",
  );
}

describe("exporting and publishing bake a stored crop", () => {
  it("crops the source rectangle and drops the old declaration", async () => {
    canvasMocks();
    const baked = await bakeStoredThemeCrops({
      envelope: envelope([CROPPED]),
      assets: { "assets/photo.png": Uint8Array.from([1, 2, 3]) },
      decode: async () => ({
        source: document.createElement("canvas"),
        width: 100,
        height: 100,
      }),
    });

    expect(baked.baked).toBe(1);
    expect(baked.envelope.assets).toEqual([
      expect.objectContaining({
        id: "photo-crop",
        kind: "image",
        path: "assets/photo-crop.png",
      }),
    ]);
    const [object] = baked.envelope.scene.objects;
    expect(object).toMatchObject({
      left: 200,
      top: 100,
      width: 50,
      height: 40,
      yunariAsset: { assetId: "photo-crop", kind: "image" },
    });
    expect(object?.["clipPath"]).toBeUndefined();
    expect(object?.["yunariCrop"]).toBeUndefined();
    expect(Object.keys(baked.assets)).toEqual(["assets/photo-crop.png"]);
  });

  it("keeps a source another object still shows whole", async () => {
    canvasMocks();
    const whole = {
      type: "Image",
      left: 10,
      top: 10,
      width: 100,
      height: 100,
      yunariAsset: { assetId: "photo", kind: "image" },
    };
    const baked = await bakeStoredThemeCrops({
      envelope: envelope([CROPPED, whole]),
      assets: { "assets/photo.png": PNG },
      decode: async () => ({
        source: document.createElement("canvas"),
        width: 100,
        height: 100,
      }),
    });

    expect(baked.envelope.assets?.map((asset) => asset.path)).toEqual([
      "assets/photo.png",
      "assets/photo-crop.png",
    ]);
    expect(baked.assets["assets/photo.png"]).toEqual(PNG);
  });

  it("clears a marker whose clip no longer hides anything", async () => {
    const decode = vi.fn();
    const baked = await bakeStoredThemeCrops({
      envelope: envelope([
        {
          ...CROPPED,
          scaleX: 1,
          scaleY: 1,
          clipPath: { type: "Rect", left: 0, top: 0, width: 100, height: 100 },
        },
      ]),
      assets: { "assets/photo.png": PNG },
      decode,
    });

    expect(decode).not.toHaveBeenCalled();
    expect(baked.baked).toBe(0);
    const [object] = baked.envelope.scene.objects;
    expect(object).not.toHaveProperty("yunariCrop");
    expect(baked.envelope.assets).toHaveLength(1);
  });
});
