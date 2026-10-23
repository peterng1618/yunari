// @vitest-environment jsdom

import {
  type AssetReference,
  YUNARI_NAME_PROPERTY,
} from "@yunari/renderer-core";
import { serialiseScene } from "@yunari/scene-fabric";
import {
  type Canvas as FabricCanvas,
  type FabricObject,
  Group,
  Rect,
  Textbox,
} from "fabric/es";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountEditorShell } from "./editor-shell.js";

/**
 * The artboard clips the object layer, and the handles do not.
 *
 * `vg-046`: Fabric has no scene-level clip that is free — `clipPath` on an
 * *object* collides with the crop manager's authored image clip and with the
 * derived text-box clip, and wrapping the scene in a Group changes what
 * `canvas.getObjects()` means, which is the layer tree's and every walk's. So
 * this file is mostly the gates that keep both of those routes out, and the
 * one route that satisfies the row is `canvas.clipPath`, which is neither: it
 * is a canvas property, so no object owns it, no object serialises it, and the
 * scene root is still the scene root.
 *
 * Measured on Fabric 7.4.0 (the version this repo pins), which is what decided
 * the shape of this change and corrects one premise in the task brief: Fabric
 * 7 draws selection controls onto the *lower* canvas, not `upperCanvasEl`.
 * `upperCanvasEl` exists but carries only text selection and free drawing. So a
 * DOM clip of the lower canvas — the brief's route — would take the handles
 * with it, which is the one outcome the brief says must not happen. The
 * canvas-level `clipPath` plus `controlsAboveOverlay` is what separates them.
 */

// jsdom cannot decode an `<img>`, so Fabric's render pass throws on one; that
// is the *only* thing stubbed here, and it is stubbed per-source rather than
// for `drawImage` as a whole. The harness this file replaces forwarded every
// draw to one shared context, which is why the object layer read back empty:
// Fabric caches each object onto its own canvas and blits that cache, so
// no-oping `drawImage` no-ops the object layer itself. Keeping jsdom's own
// (node-canvas-backed) context is what lets the clip be measured in pixels
// rather than asserted on Fabric.
beforeEach(() => {
  const original = HTMLCanvasElement.prototype.getContext;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement, ...args: unknown[]) {
      const context = original.apply(
        this,
        args as never,
      ) as CanvasRenderingContext2D | null;
      if (context === null) return context;
      return new Proxy(context, {
        get(target, property) {
          if (property !== "drawImage") {
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          }
          return (source: unknown, ...rest: unknown[]): void => {
            if (source instanceof HTMLImageElement) return;
            return (
              Reflect.get(target, "drawImage", target) as (
                s: unknown,
                ...r: unknown[]
              ) => void
            )(source, ...rest);
          };
        },
        set(target, property, value) {
          // Fabric writes this; node-canvas reads it as a plain property and
          // jsdom's context rejects it.
          if (property === "patternQuality") return true;
          return Reflect.set(target, property, value);
        },
      }) as unknown as CanvasRenderingContext2D;
    } as never,
  );
});

const ARTBOARD = { width: 400, height: 300 } as const;

/**
 * A stage with visible pasteboard down its sides.
 *
 * The camera fills the tighter axis and `clampPan` keeps the board spanning
 * the other one, so a 400x300 board in the obvious 800x600 stage covers the
 * canvas whole and every off-board sample point falls off the canvas — where
 * the read is empty whether or not the clip works. That is a false pass and it
 * was one: with the clip deleted outright, these tests still passed. At
 * 1600x900 the board is 1200x900 with 200px of pasteboard each side, so
 * "outside the board" horizontally is a point the canvas can show.
 *
 * The horizontal axis is the one to test on: a fitted camera pins the board to
 * the full stage height, so an object below the board is off-canvas by
 * construction and cannot distinguish a working clip from a broken one.
 */
const STAGE = { width: 1600, height: 900 } as const;

function stageHost(width = STAGE.width, height = STAGE.height): HTMLElement {
  const host = document.createElement("div");
  Object.defineProperties(host, {
    clientWidth: { value: width },
    clientHeight: { value: height },
  });
  document.body.append(host);
  return host;
}

/** One pixel of the canvas' own backing store: what a reader would actually see. */
function pixelAt(canvas: FabricCanvas, x: number, y: number): number {
  return canvas.getContext().getImageData(x, y, 1, 1).data[3] ?? 0;
}

/**
 * A sample point the canvas can actually show.
 *
 * Reading outside the backing store throws or returns zero, and a zero read is
 * exactly what a working clip produces — so an off-canvas point makes every
 * "is this clipped?" assertion pass for the wrong reason. That is not
 * hypothetical: the first version of this file had three such points and passed
 * with the clip deleted outright. Every pixel assertion goes through here.
 */
function onStage(
  canvas: FabricCanvas,
  artboardX: number,
  artboardY: number,
): {
  x: number;
  y: number;
} {
  const point = toScreen(canvas, artboardX, artboardY);
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  expect(
    x >= 0 && y >= 0 && x < canvas.getWidth() && y < canvas.getHeight(),
    `sample point artboard(${artboardX},${artboardY}) lands at (${x},${y}), outside the ${canvas.getWidth()}x${canvas.getHeight()} canvas; the assertion below would pass whether or not the clip works`,
  ).toBe(true);
  return { x, y };
}

/**
 * Paint now, rather than at the end of the frame.
 *
 * `requestRenderAll` is what the running editor calls, and it defers to a
 * scheduled render; every pixel below is read immediately after, so a deferred
 * render would leave the backing store from the previous test and assert
 * nothing. `renderAll` is the synchronous pass behind it.
 */
function render(canvas: FabricCanvas): void {
  canvas.renderAll();
}

/** Where the camera puts an artboard-space point, in canvas pixels. */
function toScreen(
  canvas: FabricCanvas,
  x: number,
  y: number,
): {
  x: number;
  y: number;
} {
  const vpt = canvas.viewportTransform;
  return { x: vpt[4] + x * vpt[0], y: vpt[5] + y * vpt[3] };
}

function rect(left: number, top: number, size = 60): Rect {
  return new Rect({
    left,
    top,
    width: size,
    height: size,
    fill: "#ff0000",
    originX: "left",
    originY: "top",
  });
}

/** The two properties the layer tree and the layer panel key an object by. */
function named<T extends Rect | Textbox>(shape: T, id: string): T {
  shape.set({ id, [YUNARI_NAME_PROPERTY]: id });
  return shape;
}

function mountOn(host: HTMLElement) {
  return mountEditorShell({ host, artboard: { ...ARTBOARD } });
}

describe("the stage clips the object layer to the artboard", () => {
  it("does not paint an object that lies wholly outside the artboard", async () => {
    const host = stageHost();
    const shell = await mountOn(host);
    const canvas = shell.editor.canvas;

    // Both on the board's own row, so the pair differs only in whether it is
    // past the right edge. The horizontal axis is the one with pasteboard at a
    // fitted camera; see STAGE.
    const inside = named(rect(40, 150), "inside");
    const outside = named(rect(ARTBOARD.width + 40, 150), "outside");
    canvas.add(inside, outside);
    render(canvas);

    const inPoint = onStage(canvas, 60, 180);
    const outPoint = onStage(canvas, ARTBOARD.width + 60, 180);

    expect(
      pixelAt(canvas, inPoint.x, inPoint.y),
      "an object inside the artboard is painted",
    ).toBe(255);
    expect(
      pixelAt(canvas, outPoint.x, outPoint.y),
      "an object wholly outside the artboard is not painted",
    ).toBe(0);

    shell.destroy();
  });

  it("paints only the in-board quarter of a shape straddling the edge", async () => {
    // The reported case: a quarter-disc with three quarters off the edge draws
    // as a full disc in the editor and as a quarter on the phone. A square
    // straddling the edge measures the same disagreement without the arcs.
    const host = stageHost();
    const shell = await mountOn(host);
    const canvas = shell.editor.canvas;

    // 30px of board on the left of the edge, 30px hanging off the right.
    canvas.add(named(rect(ARTBOARD.width - 30, 150), "straddle"));
    render(canvas);

    const inside = onStage(canvas, ARTBOARD.width - 15, 180);
    const outside = onStage(canvas, ARTBOARD.width + 15, 180);

    expect(
      pixelAt(canvas, inside.x, inside.y),
      "the part inside the artboard is painted",
    ).toBe(255);
    expect(
      pixelAt(canvas, outside.x, outside.y),
      "the part hanging off the edge is not",
    ).toBe(0);

    shell.destroy();
  });

  it("clips at the board's edge, not the canvas', under zoom and pan", async () => {
    // The failure mode a wrong coordinate space would produce: a clip applied
    // in canvas pixels holds still while the camera moves, so it drifts off the
    // artboard the moment the author zooms.
    const host = stageHost();
    const shell = await mountOn(host);
    const canvas = shell.editor.canvas;

    // A sheet wider than the artboard, so there is material on both sides of
    // the edge to sample.
    canvas.add(named(rect(0, 0, 600), "sheet"));

    // Through the viewport manager, which is the only writer of the transform
    // and clamps every pass. Writing `viewportTransform` by hand fights that
    // clamp and measures the clamp instead of the clip.
    //
    // Zooming *out* and panning keeps the artboard's right edge on the canvas:
    // zooming in centres on the viewport and walks the edge off the side, which
    // would measure the sample point rather than the clip.
    shell.editor.viewport.zoomBy(0.5);
    shell.editor.viewport.panBy(-20, -15);
    render(canvas);

    expect(canvas.getZoom(), "the camera really did move").not.toBe(2);

    const justInside = onStage(canvas, ARTBOARD.width - 10, 150);
    const justOutside = onStage(canvas, ARTBOARD.width + 10, 150);

    expect(
      pixelAt(canvas, justInside.x, justInside.y),
      "just inside the artboard's right edge, under zoom and pan",
    ).toBe(255);
    expect(
      pixelAt(canvas, justOutside.x, justOutside.y),
      "just outside it, the same camera: the clip followed the board",
    ).toBe(0);

    shell.destroy();
  });
});

describe("the clip does not change what the scene root means", () => {
  it("leaves canvas.getObjects() identical in length and ids", async () => {
    // Review Focus 1, and `vg-046`'s stated cost of the Group-wrapper repair:
    // a scene wrapped in a group is one object where the document had many, so
    // the layer tree, `sceneBoxesOf`, `snap-manager` and every walk over the
    // root would read a different document. This fails if the clip is built by
    // wrapping the scene, and that is the point of asserting it by length and
    // by id rather than merely "there is a clip".
    const host = stageHost();
    const shell = await mountOn(host);
    const canvas = shell.editor.canvas;

    canvas.add(
      named(rect(20, 20), "a"),
      named(rect(120, 40), "b"),
      named(rect(220, 60), "c"),
    );

    const idsOf = (): readonly unknown[] =>
      canvas.getObjects().map((object) => object.get("id"));

    const before = idsOf();
    expect(before, "three authored objects at the scene root").toHaveLength(3);

    // Toggling the clip through Fabric's own property, which is typed
    // non-optional under `exactOptionalPropertyTypes`, so the reads are widened
    // rather than the writes narrowed to `never`.
    const clip: FabricObject | undefined = canvas.clipPath;
    delete canvas.clipPath;
    render(canvas);
    const unclipped = idsOf();

    if (clip !== undefined) canvas.clipPath = clip;
    render(canvas);
    const clipped = idsOf();

    expect(unclipped, "the root is the same scene without the clip").toEqual(
      before,
    );
    expect(clipped, "and the same scene with it").toEqual(before);
    expect(
      canvas.getObjects().some((object) => object instanceof Group),
      "no wrapper group was introduced",
    ).toBe(false);

    shell.destroy();
  });

  it("does not put the clip on any object, or in the saved scene", async () => {
    const host = stageHost();
    const shell = await mountOn(host);
    const canvas = shell.editor.canvas;

    canvas.add(named(rect(20, 20), "a"));

    // The artboard boundary belongs to the envelope, not the document: a scene
    // that carried a second copy of it would re-clip on a board that no longer
    // has that size. `artboardPlate` sets the same flag for the same reason.
    const scene = serialiseScene(canvas);
    expect(
      Object.keys(scene).includes("clipPath"),
      "the canvas clip is not serialised into the scene document",
    ).toBe(false);

    expect(
      canvas.getObjects()[0]?.clipPath,
      "and no object's own clipPath was touched",
    ).toBeUndefined();

    shell.destroy();
  });
});

describe("the stage's artboard paint", () => {
  /** The background is an envelope section now, so the painter is exercised
   *  through a document that authors one. */
  function envelopeWith(
    background: NonNullable<
      NonNullable<
        Parameters<typeof mountEditorShell>[0]["envelope"]
      >["background"]
    >,
    assets: readonly AssetReference[] = [],
  ): NonNullable<Parameters<typeof mountEditorShell>[0]["envelope"]> {
    return {
      schemaVersion: 2,
      fabricVersion: "7.4.0",
      id: "paint-probe",
      artboard: ARTBOARD,
      background,
      globals: {
        palette: {
          none: {
            name: "None",
            value: { kind: "solid", color: "transparent" },
          },
          ink: { name: "Ink", value: { kind: "solid", color: "#112233" } },
        },
      },
      assets,
      metadata: { themeLanguage: "en" },
      scene: { version: "7.4.0", objects: [] },
    } as unknown as NonNullable<
      Parameters<typeof mountEditorShell>[0]["envelope"]
    >;
  }

  it("drops the plate once the board declares background media", async () => {
    // 0080. The plate is a `Rect` on the canvas, and the canvas sits above the
    // media layer, so a plate covers the media exactly as the player's canvas
    // fill did. The host's background — which the shell sets either way — is
    // behind the layer instead, so it is the board's colour and the letterbox
    // both. Both arms asserted, because a plate reappearing here is the defect
    // returning in silence.
    const color = { ref: "palette.ink" as const };

    const plainHost = stageHost();
    const plain = await mountEditorShell({
      host: plainHost,
      artboard: ARTBOARD,
      envelope: envelopeWith({ color }),
    });
    expect(
      plain.editor.canvas.backgroundImage,
      "with no media, the plate is the board's paint",
    ).toBeInstanceOf(Rect);
    expect(plainHost.style.background).toBe("rgb(17, 34, 51)");
    plain.destroy();
    plainHost.remove();

    const mediaHost = stageHost();
    const assets = [
      { id: "loop", kind: "video" as const, path: "assets/loop.webm" },
    ];
    const withMedia = await mountEditorShell({
      host: mediaHost,
      artboard: ARTBOARD,
      envelope: envelopeWith(
        { color, media: { assetId: "loop", bounds: "theme" } },
        assets,
      ),
      assets,
      resolveAsset: () => ({ url: "blob:loop" }),
    });
    expect(
      withMedia.editor.canvas.backgroundImage,
      "with media declared, nothing on the canvas may cover it",
    ).toBeUndefined();
    expect(
      mediaHost.querySelector("[data-yunari-background-media]"),
      "and the layer it would have covered is mounted",
    ).not.toBeNull();
    expect(
      mediaHost.style.background,
      "while the host still carries the board's colour",
    ).toBe("rgb(17, 34, 51)");
    withMedia.destroy();
    mediaHost.remove();
  });
});

describe("the two clips that already exist still behave", () => {
  it("keeps the crop manager's authored per-image clip", async () => {
    // `vg-046` names this as the collision: a crop clip is an *object* clipPath,
    // so a repair that also wrote one would either overwrite it or be
    // overwritten by it. Asserted by name, because "the clip still works" is
    // exactly what a silent overwrite looks like.
    const host = stageHost();
    const shell = await mountOn(host);
    const canvas = shell.editor.canvas;

    const image = named(rect(40, 40, 80), "cropped");
    // The shape `crop-manager` commits: a rect in the image's own units, which
    // Fabric positions from the object's centre rather than its top-left (the
    // note above `cropClipRect` says so, and it was measured here: a 40x40 clip
    // at left/top 0 lands on the middle of the object, not its corner).
    const crop = new Rect({
      width: 40,
      height: 40,
      left: 0,
      top: 0,
      originX: "center",
      originY: "center",
    });
    image.set({ clipPath: crop });
    canvas.add(image);
    render(canvas);

    expect(
      image.clipPath,
      "the artboard clip did not overwrite the authored crop clip",
    ).toBe(crop);
    expect(image.clipPath).toBeInstanceOf(Rect);

    // And it still clips: the image's centre is inside the crop rect and its
    // corners are not — all of it well inside the artboard, so this is the
    // per-object clip doing the cutting and the artboard clip not involved.
    const kept = onStage(canvas, 80, 80);
    const croppedAway = onStage(canvas, 50, 50);
    expect(pixelAt(canvas, kept.x, kept.y), "inside the crop rect").toBe(255);
    expect(
      pixelAt(canvas, croppedAway.x, croppedAway.y),
      "outside the crop rect but inside the artboard",
    ).toBe(0);

    shell.destroy();
  });

  it("keeps the derived text-box clip", async () => {
    // The other half of `vg-046`'s named pair, and the one with the sharper
    // failure: `persist.ts` deletes a text object's serialised clipPath and
    // rebuilds it from `yunariText.box`, so a repair that adopted the object's
    // clipPath would put a stale or artboard-sized rect where a text box's own
    // clip belongs.
    const host = stageHost();
    const shell = await mountOn(host);
    const canvas = shell.editor.canvas;

    const box = new Textbox(
      "A label that is deliberately long enough to wrap",
      {
        left: 40,
        top: 40,
        width: 120,
        height: 40,
        fontSize: 20,
        originX: "left",
        originY: "top",
      },
    );
    named(box, "label");
    // The shape `authored-box`'s `applyClip` writes: a rect in the text's own
    // units, sized to the authored box.
    const textClip = new Rect({
      width: 120,
      height: 40,
      originX: "center",
      originY: "center",
      left: 0,
      top: 0,
    });
    box.set({ clipPath: textClip });
    canvas.add(box);
    render(canvas);

    expect(
      box.clipPath,
      "the artboard clip did not overwrite the derived text-box clip",
    ).toBe(textClip);
    expect(box.clipPath).toBeInstanceOf(Rect);
    expect(
      (box.clipPath as Rect).width,
      "still the text box' own width, not the artboard's",
    ).toBe(120);

    shell.destroy();
  });
});

describe("a clipped selection stays grabbable", () => {
  it("keeps the handle's box inside the stage, not merely non-zero", async () => {
    // The user's own requirement in the report `vg-046` came from. Asserted as
    // a bounding box inside the stage: "the handle exists" is exactly what a
    // clipped handle satisfies while being unusable.
    const host = stageHost();
    const shell = await mountOn(host);
    const canvas = shell.editor.canvas;

    // Straddles the right edge, so its right-hand handles are off the artboard
    // and would be cut away with it.
    const target = named(rect(ARTBOARD.width - 40, 40, 100), "partial");
    canvas.add(target);
    canvas.setActiveObject(target);
    render(canvas);

    // Fabric's own per-control geometry: where each handle sits and the box it
    // occupies, in canvas coordinates. `getCoords` returns the four corner
    // *points* of the object, which says nothing about whether a handle is
    // visible, so it cannot answer this.
    const coords = target.calcOCoords();
    const entries = Object.entries(coords);
    expect(entries.length, "there are controls to measure").toBeGreaterThan(0);

    for (const [key, control] of entries) {
      const xs = [
        control.corner.tl.x,
        control.corner.tr.x,
        control.corner.br.x,
        control.corner.bl.x,
      ];
      const ys = [
        control.corner.tl.y,
        control.corner.tr.y,
        control.corner.br.y,
        control.corner.bl.y,
      ];
      const left = Math.min(...xs);
      const right = Math.max(...xs);
      const top = Math.min(...ys);
      const bottom = Math.max(...ys);

      expect(
        Math.round(right - left),
        `handle "${key}" has a real width, so it is not a degenerate point`,
      ).toBeGreaterThan(0);
      expect(
        Math.round(bottom - top),
        `handle "${key}" has a real height`,
      ).toBeGreaterThan(0);
      expect(
        left >= 0 &&
          top >= 0 &&
          right <= canvas.getWidth() &&
          bottom <= canvas.getHeight(),
        `handle "${key}" box (${Math.round(left)},${Math.round(top)})-(${Math.round(right)},${Math.round(bottom)}) lies inside the ${canvas.getWidth()}x${canvas.getHeight()} stage`,
      ).toBe(true);
    }

    shell.destroy();
  });

  it("paints the handles even though the object is clipped", async () => {
    // The pixel half of the same requirement. Fabric 7 draws controls onto the
    // lower canvas and composites the canvas clip after them, so without
    // `controlsAboveOverlay` this is transparent and the handle is a ghost.
    const host = stageHost();
    const shell = await mountOn(host);
    const canvas = shell.editor.canvas;

    const target = named(rect(ARTBOARD.width - 40, 40, 100), "ghost");
    canvas.add(target);
    canvas.setActiveObject(target);
    render(canvas);

    // The bottom-right handle, read from Fabric's own control geometry so this
    // samples where the handle is rather than where a box was guessed to be.
    // `getBoundingRect` is in scene units, so it goes through the camera.
    const corner = target.calcOCoords().br?.corner;
    expect(corner, "the object has a bottom-right handle").toBeDefined();
    const handleX = Math.round((corner?.br.x ?? 0) + (corner?.tl.x ?? 0)) / 2;
    const handleY = Math.round((corner?.br.y ?? 0) + (corner?.tl.y ?? 0)) / 2;

    // It must be off the artboard for this to mean anything.
    expect(
      handleX,
      "the handle is outside the artboard's right edge",
    ).toBeGreaterThan(toScreen(canvas, ARTBOARD.width, 0).x);
    expect(
      pixelAt(canvas, handleX, handleY),
      `the handle at (${handleX},${handleY}) is painted, not clipped away`,
    ).toBeGreaterThan(0);

    shell.destroy();
  });
});
