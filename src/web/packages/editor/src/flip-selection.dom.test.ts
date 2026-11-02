// @vitest-environment jsdom
import {
  objectAssetReference,
  setObjectAssetReference,
} from "@yunari/scene-fabric";
import { Canvas, FabricImage, Path, Polygon, Rect } from "fabric/es";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssetManager } from "./asset-manager/index.js";
import { flipSelection } from "./flip-selection.js";

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
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/png;base64,AAAA",
  );
});

function assets(): AssetManager {
  const manager = new AssetManager();
  manager.load(
    {
      assets: [
        {
          id: "photo",
          kind: "image",
          path: "assets/photo.png",
          sha256: "0".repeat(64),
        },
      ],
    },
    { "assets/photo.png": new Uint8Array([1, 2, 3]) },
  );
  return manager;
}

function image(): FabricImage {
  const element = document.createElement("canvas");
  element.width = 40;
  element.height = 20;
  const picture = new FabricImage(element, {
    id: "image-1",
    left: 100,
    top: 50,
  });
  setObjectAssetReference(picture, { assetId: "photo", kind: "image" });
  return picture;
}

describe("flipSelection", () => {
  it("rewrites a picture's bytes instead of carrying a flip flag", async () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const picture = image();
    canvas.add(picture);
    canvas.setActiveObject(picture);
    const manager = assets();

    expect(
      await flipSelection({ canvas, assets: manager, axis: "horizontal" }),
    ).toBe(true);

    expect(picture.flipX).toBe(false);
    expect(picture.flipY).toBe(false);
    const reference = objectAssetReference(picture);
    expect(reference?.assetId).not.toBe("photo");
    expect(reference?.kind).toBe("image");
    // The source stays declared: history may still replay the pre-flip object,
    // and flipping is not a privacy boundary.
    expect(manager.declarations.map((asset) => asset.id)).toContain("photo");
    expect(manager.declarations.map((asset) => asset.id)).toContain(
      reference?.assetId,
    );
    expect({ left: picture.left, top: picture.top }).toEqual({
      left: 100,
      top: 50,
    });
  });

  it("mirrors a path's own commands and leaves its position alone", async () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const path = new Path("M 0 0 L 10 0 L 10 10 Z", {
      left: 100,
      top: 50,
    });
    canvas.add(path);
    canvas.setActiveObject(path);
    const before = path.pathOffset;

    await flipSelection({ canvas, assets: assets(), axis: "horizontal" });

    const xs = path.path.flatMap((command) =>
      command[0] === "M" || command[0] === "L" ? [command[1] as number] : [],
    );
    expect(xs).toEqual([2 * before.x, 2 * before.x - 10, 2 * before.x - 10]);
    expect(path.pathOffset.x).toBeCloseTo(before.x, 5);
    expect(path.left).toBe(100);
    expect(path.flipX).toBe(false);
  });

  it("mirrors a polygon's points around its offset", async () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const polygon = new Polygon(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      { left: 100, top: 50 },
    );
    canvas.add(polygon);
    canvas.setActiveObject(polygon);
    const offset = polygon.pathOffset;
    const xs = polygon.points.map((point) => point.x);

    await flipSelection({ canvas, assets: assets(), axis: "horizontal" });

    expect(polygon.points.map((point) => point.x)).toEqual(
      xs.map((x) => 2 * offset.x - x),
    );
    expect(polygon.flipX).toBe(false);
  });

  it("refuses a rectangle, whose mirror would change nothing", async () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const rectangle = new Rect({ left: 0, top: 0, width: 10, height: 10 });
    canvas.add(rectangle);
    canvas.setActiveObject(rectangle);

    expect(
      await flipSelection({ canvas, assets: assets(), axis: "horizontal" }),
    ).toBe(false);
    expect(rectangle.flipX).toBe(false);
  });
});
