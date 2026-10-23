import { expect, type Page, test } from "@playwright/test";
import { writeThemePackage } from "@yunari/theme-package";
import {
  CLIP_FIELD,
  CLIP_INK,
  CLIP_PALETTE,
  CLIP_PLATE,
  QUADRANTS_SVG,
} from "./clip-parity-fixture.js";
import { HOST_PORT } from "./host-theme.js";
import { openThemeFromStore, storedThemeOfPackage } from "./store-library.js";
import { isDesktopSurface } from "./surface.js";

/**
 * The artboard clip beside the two clips that were already there.
 *
 * `vg-046` says Fabric has no scene-level clip that is free: `clipPath` is
 * per-object, so the obvious repairs land on top of the crop manager's authored
 * per-image clip and the derived text-box clip. The editor takes a route that is
 * neither — `canvas.clipPath`, scene-level and on no object (`editor-shell.ts`,
 * `artboardClip`) — and that route was argued from Fabric's source. **Nobody
 * measured it.**
 *
 * So this measures it. One scene, two clips, **one document** through both
 * surfaces: the editor opens the exported package through the store's own
 * **Open in editor** control, and a real host serves the same document to the
 * player. The claim is
 * not "both clip at the artboard". That was `host-bleed.spec.ts`'s, and it went
 * with the crop notice (`docs/decisions/0069`); the cases below read it on both
 * surfaces' own pixels now, and the player's mount of the clip is
 * `packages/player/src/artboard-clip.dom.test.ts`. It is the narrower one the
 * row asks for: the artboard clip does not
 * *interfere* with a clip that already existed, and the two surfaces agree on
 * the pixels.
 *
 * ## Why the read is a classifier and not `canvas.getObjects()`
 *
 * The artboard clip is a `StaticCanvas` property and Fabric never puts it on an
 * object — which is the whole reason the route is free, and also why reading the
 * scene graph cannot see a collision with it. Both per-object clips are ordinary
 * `FabricObject.clipPath`s, so a collision would be a question about rendered
 * output rather than about properties. Everything below is a pixel class read off
 * a backing store.
 *
 * ## What each case had to be, for the clips to be visible at all
 *
 * **The crop.** A four-quadrant SVG under an authored crop that keeps exactly
 * its right half, hanging 80 units off the right edge. Red and blue are the half
 * the author threw away and green and yellow the half they kept, so a clip that
 * was truncated, shifted, mirrored or replaced announces itself as a colour
 * rather than as a number. The kept half **straddles** the artboard edge, which
 * is the only arrangement in which the two clips overlap at all: crop the left
 * half instead and the artboard clip would never touch it, so there would be
 * nothing to measure.
 *
 * **The text box.** `yunariText.box` **shorter than one line** — 20 units at
 * `fontSize 40`. `withLineCapacity` derives a `maxLines` from that box, but
 * nothing writes it onto the object: only `fits()` reads it, and `fits()` is
 * reached on the ellipsis path alone. So with `overflow: "clip"` the text lays
 * out every line it has and **`applyClip` is the only thing that cuts them**,
 * which is what makes this the decisive case rather than the obvious "a long
 * paragraph in a box", where the clip has nothing to bite on. A twin box
 * carries the same glyphs at the same size with `overflow: "visible"` and so
 * **no clip at all**, which is what the clip's own behaviour is measured
 * against, rather than a font metric guessed here. Both boxes hang off the same
 * edge.
 */

const EDITOR = "http://127.0.0.1:4174/";
const HOST = `http://127.0.0.1:${HOST_PORT}`;
/** One id, published through the host's own route; no other spec owns it. */
const THEME_ID = "e2e-clip-parity";

const ARTBOARD = { width: 800, height: 500 } as const;

/** The image's own box, and the midline its authored crop starts on. */
const BADGE = { left: 640, top: 120, size: 240 } as const;
const BADGE_MID_X = BADGE.left + BADGE.size / 2;
const BADGE_MID_Y = BADGE.top + BADGE.size / 2;

/**
 * The authored crop, in `cropClipRect`'s own terms: a `Rect` anchored at the
 * **image's centre**, in unscaled image units — where Fabric positions a
 * non-absolute `clipPath`, and where `crop-manager/index.ts:168` writes what an
 * author dragged. The frame the crop session would have had is the badge's right
 * half, scene x 760…880, so the clip sits at `left = 820 − 760 = 60`.
 */
const CROP_CLIP = {
  left: 60,
  top: 0,
  width: BADGE.size / 2,
  height: BADGE.size,
};

/** Two text boxes: one clipped to its authored box, one with no clip at all. */
const CLIPPED_TEXT_BOX = { left: 620, top: 90, width: 300, height: 20 };
const VISIBLE_TEXT_BOX = { left: 620, top: 200, width: 300, height: 20 };
const TEXT = "OVERHANG ROW";
const FONT_SIZE = 40;

/** How far down the unclipped twin sits; only its top differs from the clipped box. */
const VISIBLE_BOX_SHIFT = VISIBLE_TEXT_BOX.top - CLIPPED_TEXT_BOX.top;

const BADGE_ASSET = "assets/quadrants.svg";

const PALETTE = CLIP_PALETTE;

/** One text box; `overflow` is the only difference between the twins. */
function textBox(
  id: string,
  box: { left: number; top: number; width: number; height: number },
  overflow: "clip" | "visible",
) {
  return {
    type: "Textbox" as const,
    version: "7.4.0" as const,
    originX: "left" as const,
    originY: "top" as const,
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    text: TEXT,
    fontSize: FONT_SIZE,
    fontFamily: "Segoe UI, system-ui, sans-serif",
    lineHeight: 1,
    // Resolved paint, with the authored token beside it: a display resolves no
    // palette paints of its own (ADR-0026), and the validator refuses a
    // resolved colour with no token behind it. The value is the palette
    // entry's own, read from the one place both spell.
    fill: CLIP_INK,
    id,
    yunariPaint: { fill: "palette.ink" },
    yunariText: {
      runs: [
        {
          kind: "literal" as const,
          text: TEXT,
          typePreset: "typePresets.40-400",
          style: { color: { ref: "palette.ink" } },
        },
      ],
      box: { width: box.width, height: box.height },
      overflow,
    },
  };
}

const ENVELOPE = {
  schemaVersion: 2 as const,
  fabricVersion: "7.4.0" as const,
  id: THEME_ID,
  metadata: { name: "E2E clip parity", themeLanguage: "en" },
  artboard: {
    width: ARTBOARD.width,
    height: ARTBOARD.height,
    contentFit: "contain" as const,
  },
  background: { color: { ref: "palette.bar" as const } },
  globals: {
    palette: PALETTE,
    typePresets: {
      "40-400": {
        name: "Measure",
        value: {
          family: "Segoe UI, system-ui, sans-serif",
          size: FONT_SIZE,
          weight: "400",
        },
      },
    },
  },
  assets: [
    {
      id: "quadrants",
      kind: "svg" as const,
      path: BADGE_ASSET,
      license: { name: "MIT", attribution: "Yunari test fixture." },
    },
  ],
  scene: {
    version: "7.4.0" as const,
    objects: [
      {
        // Opaque across the whole artboard, so "the crop did not paint here" is
        // a colour rather than an alpha — and so the measurement never depends
        // on how each surface resolves an artboard background reference.
        type: "Rect" as const,
        version: "7.4.0" as const,
        originX: "left" as const,
        originY: "top" as const,
        left: 0,
        top: 0,
        width: ARTBOARD.width,
        height: ARTBOARD.height,
        fill: CLIP_PLATE,
        id: "plate",
        yunariPaint: { fill: "palette.plate" },
      },
      {
        // The field the text is read against. It overhangs too, so ink that
        // escaped either clip has something to be ink against.
        type: "Rect" as const,
        version: "7.4.0" as const,
        originX: "left" as const,
        originY: "top" as const,
        left: 600,
        top: 60,
        width: 350,
        height: 200,
        fill: CLIP_FIELD,
        id: "text-field",
        yunariPaint: { fill: "palette.field" },
      },
      {
        type: "Image" as const,
        version: "7.4.0" as const,
        originX: "left" as const,
        originY: "top" as const,
        left: BADGE.left,
        top: BADGE.top,
        width: BADGE.size,
        height: BADGE.size,
        scaleX: 1,
        scaleY: 1,
        id: "badge",
        yunariAsset: { assetId: "quadrants", kind: "svg" as const },
        // The crop the author made, in the shape the crop manager writes it.
        clipPath: {
          type: "Rect",
          version: "7.4.0",
          originX: "center",
          originY: "center",
          left: CROP_CLIP.left,
          top: CROP_CLIP.top,
          width: CROP_CLIP.width,
          height: CROP_CLIP.height,
        },
      },
      textBox("clipped-text", CLIPPED_TEXT_BOX, "clip"),
      textBox("visible-text", VISIBLE_TEXT_BOX, "visible"),
    ],
  },
};

type ClassName =
  | "clear"
  | "ink"
  | "red"
  | "green"
  | "blue"
  | "yellow"
  | "other";

/** Where a class was found, in scene units. */
type ClassBox = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  pixels: number;
};

type Reading = {
  /** Fraction of the region's device pixels that fell on the surface. */
  covered: number;
} & Readonly<Record<ClassName, ClassBox>>;

type Rect = { x: number; y: number; width: number; height: number };

/** The artboard plus 90 units of overhang on every side — the crop's and the
 * text's alike, and the pasteboard the editor shows there. */
const WHOLE: Rect = {
  x: 0,
  y: 0,
  width: ARTBOARD.width + 90,
  height: ARTBOARD.height + 90,
};

/** One text box and the twenty units of ink its clip has to cut. */
const CLIPPED_BAND: Rect = { x: 600, y: 70, width: 350, height: 80 };
/**
 * The twin's band is deeper, because nothing cuts *its* ink: measured, an
 * unclipped line at `fontSize 40` reaches 49 units below its box's top, which a
 * band ending 20 units lower reports as the band's own edge rather than as the
 * text's — and a measurement that stops where the probe stops measures nothing.
 */
const VISIBLE_BAND: Rect = { x: 600, y: 180, width: 350, height: 140 };

/**
 * Every class's extent inside one scene-space region, read off a backing store.
 *
 * `surface` picks which canvas and which camera: the editor's lower canvas
 * through `yunariEditorBridge`, the player's artboard through the `window.yunari`
 * handle. Both map scene units through their own `viewportTransform`, and both
 * are then scaled by `backingStore / CSS box`, so nothing here assumes a device
 * pixel ratio.
 */
async function reading(
  page: Page,
  surface: "editor" | "player",
  region: Rect,
): Promise<Reading> {
  return page.evaluate(
    ([which, rect]) => {
      const classOf = (r: number, g: number, b: number, a: number): string => {
        if (a < 24) return "clear";
        if (r >= 170 && g >= 170 && b >= 170) return "ink";
        if (r >= 170 && g >= 170 && b <= 110) return "yellow";
        if (g >= 150 && r <= 110 && b <= 110) return "green";
        if (r >= 150 && g <= 110 && b <= 110) return "red";
        if (b >= 150 && r <= 110 && g <= 110) return "blue";
        return "other";
      };

      const win = window as unknown as {
        yunariEditorBridge?: {
          editor: { canvas: { viewportTransform: number[] } };
        };
        yunari?: { handle: Record<string, unknown> };
      };
      let element: HTMLCanvasElement | null;
      let vpt: number[];

      if (which === "editor") {
        const bridge = win.yunariEditorBridge;
        if (bridge === undefined) throw new Error("no editor bridge");
        element = document.querySelector<HTMLCanvasElement>(
          "#yunari-fabric-editor canvas.lower-canvas",
        );
        vpt = bridge.editor.canvas.viewportTransform;
      } else {
        const handle = win.yunari?.handle;
        if (handle === undefined) throw new Error("no player handle");
        element = document.querySelector<HTMLCanvasElement>(
          'canvas[data-yunari="artboard"]',
        );
        vpt = (handle["canvas"] as { viewportTransform: number[] })
          .viewportTransform;
      }
      if (element === null) throw new Error(`no ${which} canvas`);
      const context = element.getContext("2d");
      if (context === null) throw new Error(`no ${which} 2d context`);

      const box = element.getBoundingClientRect();
      const device = element.width / box.width;
      const zoom = vpt[0] ?? 1;
      const tx = vpt[4] ?? 0;
      const ty = vpt[5] ?? 0;
      // Scene to device pixels and back. Scene y grows downward on both
      // surfaces, so a device row grows with the scene row.
      const toDevice = (sx: number, sy: number): [number, number] => [
        (sx * zoom + tx) * device,
        (sy * zoom + ty) * device,
      ];
      const toSceneX = (dx: number): number => (dx / device - tx) / zoom;
      const toSceneY = (dy: number): number => (dy / device - ty) / zoom;

      const [rx, ry] = toDevice(rect.x, rect.y);
      const x0 = Math.max(0, Math.round(rx));
      const y0 = Math.max(0, Math.round(ry));
      const x1 = Math.min(
        element.width,
        Math.round(rx + rect.width * zoom * device),
      );
      const y1 = Math.min(
        element.height,
        Math.round(ry + rect.height * zoom * device),
      );
      const width = x1 - x0;
      const height = y1 - y0;
      const total = width * height;
      const data =
        width > 0 && height > 0
          ? context.getImageData(x0, y0, width, height).data
          : new Uint8ClampedArray(0);

      const seen: Record<
        string,
        {
          minX: number;
          maxX: number;
          minY: number;
          maxY: number;
          pixels: number;
        }
      > = {};
      for (let index = 0; index < data.length; index += 4) {
        const pixel = index / 4;
        const name = classOf(
          data[index] ?? 0,
          data[index + 1] ?? 0,
          data[index + 2] ?? 0,
          data[index + 3] ?? 0,
        );
        const sx = toSceneX(x0 + (pixel % width));
        const sy = toSceneY(y0 + Math.floor(pixel / width));
        const box = seen[name];
        if (box === undefined) {
          seen[name] = { minX: sx, maxX: sx, minY: sy, maxY: sy, pixels: 1 };
          continue;
        }
        if (sx < box.minX) box.minX = sx;
        if (sx > box.maxX) box.maxX = sx;
        if (sy < box.minY) box.minY = sy;
        if (sy > box.maxY) box.maxY = sy;
        box.pixels += 1;
      }

      const empty = { minX: 0, maxX: 0, minY: 0, maxY: 0, pixels: 0 };
      const result: Record<string, unknown> = {
        covered: total > 0 ? data.length / 4 / total : 0,
      };
      for (const name of [
        "clear",
        "ink",
        "red",
        "green",
        "blue",
        "yellow",
        "other",
      ]) {
        result[name] = seen[name] ?? empty;
      }
      return result;
    },
    [surface, region] as const,
  ) as Promise<Reading>;
}

/** Scene units between two measurements. */
function within(
  measured: number,
  expected: number,
  tolerance: number,
): boolean {
  return Math.abs(measured - expected) <= tolerance;
}

/** Publishes the one fixture through the host's own route, as a client would. */
async function publish(page: Page): Promise<void> {
  const response = await page.request.put(`${HOST}/api/themes/${THEME_ID}`, {
    data: {
      envelope: ENVELOPE,
      assets: {
        [BADGE_ASSET]: Buffer.from(QUADRANTS_SVG, "utf8").toString("base64"),
      },
    },
  });
  expect(
    response.status(),
    `the host accepted the fixture: ${await response.text().catch(() => "")}`,
  ).toBe(200);
}

/** The editor, with the fixture open and the camera pulled back far enough. */
async function openEditor(page: Page): Promise<void> {
  // Validated by the archive writer too, so a fixture that cannot be exported
  // cannot be saved, and the failure names the real problem.
  const written = writeThemePackage({
    envelope: ENVELOPE,
    assets: { [BADGE_ASSET]: new TextEncoder().encode(QUADRANTS_SVG) },
  });
  if (!written.ok)
    throw new Error(`the fixture is invalid: ${written.message}`);

  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();
  await openThemeFromStore(page, storedThemeOfPackage(written.bytes));
  await page.waitForFunction(
    () =>
      (window as unknown as { yunariEditorBridge?: unknown })
        .yunariEditorBridge !== undefined,
  );
  // The image is a fetched asset and the type needs a measured face: a read
  // before either lands is a read of a half-painted canvas.
  await page.waitForFunction(
    () => {
      const objects = (
        window as unknown as {
          yunariEditorBridge: {
            editor: {
              canvas: {
                getObjects(): { get(key: string): unknown }[];
                requestRenderAll(): void;
              };
            };
          };
        }
      ).yunariEditorBridge.editor.canvas.getObjects();
      const badge = objects.find((object) => object.get("id") === "badge");
      return badge !== undefined && (badge.get("width") as number) > 0;
    },
    undefined,
    { timeout: 20_000 },
  );
  // Zoom out, so the 90 units past the right edge land on the pasteboard rather
  // than off the end of the stage — the reason `editor-clip.spec.ts` does the
  // same, and the `covered` guard below is what would catch it if it did not.
  await page.evaluate(() => {
    const bridge = (
      window as unknown as {
        yunariEditorBridge: {
          editor: {
            canvas: { requestRenderAll(): void };
            viewport: { zoomBy(factor: number): void };
          };
        };
      }
    ).yunariEditorBridge;
    bridge.editor.viewport.zoomBy(0.6);
    bridge.editor.canvas.requestRenderAll();
  });
  await page.waitForTimeout(400);
}

/** The player, showing the same document through the real host. */
async function openPlayer(page: Page): Promise<void> {
  await page.goto(`${HOST}/?theme=${THEME_ID}&static=1`);
  await expect(page.locator('canvas[data-yunari="artboard"]')).toBeVisible();
  await page.waitForFunction(
    () => {
      const handle = (
        window as unknown as {
          yunari?: {
            handle: {
              canvas: { getObjects(): { get(key: string): unknown }[] };
            };
          };
        }
      ).yunari?.handle;
      if (handle === undefined) return false;
      const badge = handle.canvas
        .getObjects()
        .find((object) => object.get("id") === "badge");
      return badge !== undefined && (badge.get("width") as number) > 0;
    },
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(400);
}

test.describe("the artboard clip beside the two clips that were already there", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      !isDesktopSurface(testInfo),
      "one document, two desktop surfaces",
    );
    await publish(page);
  });

  test("the crop's authored clip keeps its half, and the artboard clip stops the rest", async ({
    context,
    page,
  }) => {
    await openEditor(page);
    const player = await context.newPage();
    await openPlayer(player);

    const editor = await reading(page, "editor", WHOLE);
    const displayed = await reading(player, "player", WHOLE);
    const surfaces = { editor, displayed };

    for (const [name, read] of Object.entries(surfaces)) {
      expect(
        read.covered,
        `${name}: the whole scene, overhang included, is on the surface`,
      ).toBeGreaterThan(0.97);
    }

    for (const [name, read] of Object.entries(surfaces)) {
      // **The authored half is still gone.** Red and blue are the left half of
      // the badge — the half the author's crop discarded. Neither appears
      // anywhere else in the scene, so either one showing means the artboard
      // clip disturbed the crop rather than merely meeting it.
      expect(
        read.red.pixels,
        `${name}: the half the author's crop discarded is still discarded`,
      ).toBe(0);
      expect(read.blue.pixels, `${name}: and the rest of it`).toBe(0);
      expect(
        read.green.pixels,
        `${name}: the half the author kept is painted`,
      ).toBeGreaterThan(500);
      expect(
        read.yellow.pixels,
        `${name}: both of its quadrants`,
      ).toBeGreaterThan(500);
    }

    for (const [name, read] of Object.entries(surfaces)) {
      // **The kept half starts where the author put it.** The crop's left edge
      // is the badge's own midline, so a clip that shifted or scaled moves this.
      expect(
        within(read.green.minX, BADGE_MID_X, 8),
        `${name}: the crop's left edge is the badge midline, at ${read.green.minX.toFixed(1)}`,
      ).toBe(true);
      expect(
        within(read.green.minY, BADGE.top, 8),
        `${name}: its top is the badge's, at ${read.green.minY.toFixed(1)}`,
      ).toBe(true);
      expect(
        within(read.yellow.minY, BADGE_MID_Y, 8),
        `${name}: the lower quadrant starts on the other midline, at ${read.yellow.minY.toFixed(1)}`,
      ).toBe(true);
    }

    for (const [name, read] of Object.entries(surfaces)) {
      // **And it stops at the artboard.** 80 units of the kept half are past the
      // edge; this is where they were cut, on both quadrants, on both surfaces.
      for (const [quadrant, box] of Object.entries({
        green: read.green,
        yellow: read.yellow,
      })) {
        expect(
          within(box.maxX, ARTBOARD.width, 8),
          `${name}/${quadrant}: the kept half stops at the artboard's right edge, at ${box.maxX.toFixed(1)}`,
        ).toBe(true);
        expect(
          box.maxX,
          `${name}/${quadrant}: and not short of it`,
        ).toBeGreaterThan(ARTBOARD.width - 12);
      }
    }

    // **The same pixels on both surfaces.** Every class both surfaces painted has
    // to land in the same place, which is what "one document rendered twice"
    // means once antialiasing is allowed for.
    for (const name of ["green", "yellow"] as const) {
      for (const axis of ["minX", "maxX", "minY", "maxY"] as const) {
        expect(
          Math.abs(editor[name][axis] - displayed[name][axis]),
          `${name}.${axis}: the editor put it at ${editor[name][axis].toFixed(1)}, the player at ${displayed[name][axis].toFixed(1)}`,
        ).toBeLessThanOrEqual(10);
      }
    }

    await player.close();
  });

  test("the derived text-box clip still cuts its own box, and the artboard clip stops the ink", async ({
    context,
    page,
  }) => {
    await openEditor(page);
    const player = await context.newPage();
    await openPlayer(player);

    const editorClipped = await reading(page, "editor", CLIPPED_BAND);
    const playerClipped = await reading(player, "player", CLIPPED_BAND);
    const editorVisible = await reading(page, "editor", VISIBLE_BAND);
    const playerVisible = await reading(player, "player", VISIBLE_BAND);

    for (const [name, read] of Object.entries({
      "editor/clipped": editorClipped,
      "player/clipped": playerClipped,
      "editor/visible": editorVisible,
      "player/visible": playerVisible,
    })) {
      expect(
        read.covered,
        `${name}: the whole band, overhang included, is on the surface`,
      ).toBeGreaterThan(0.97);
      expect(
        read.ink.pixels,
        `${name}: ink is there to measure`,
      ).toBeGreaterThan(80);
    }

    for (const [name, clipped, visible] of [
      ["editor", editorClipped, editorVisible],
      ["player", playerClipped, playerVisible],
    ] as const) {
      // **The derived clip is what stopped the clipped box.** Its box ends 20
      // units below its own top; the twin carries the same glyphs at the same
      // size with no clip at all and ran on past that. Without the twin this
      // would be "some ink stops at y = 110", which a font metric satisfies with
      // no clip present at all.
      expect(
        within(
          clipped.ink.maxY,
          CLIPPED_TEXT_BOX.top + CLIPPED_TEXT_BOX.height,
          8,
        ),
        `${name}: the clipped box's ink stops at its own box, at ${clipped.ink.maxY.toFixed(1)}`,
      ).toBe(true);
      expect(
        clipped.ink.minY,
        `${name}: and began inside it, at ${clipped.ink.minY.toFixed(1)}`,
      ).toBeGreaterThan(CLIPPED_TEXT_BOX.top - 8);
      // **The twin ran past the height the clip holds the other to**, by more
      // than the tolerance above could absorb — so the difference is the clip,
      // not the measurement.
      expect(
        visible.ink.maxY,
        `${name}: the unclipped twin ran to ${visible.ink.maxY.toFixed(1)}, well past the box's own bottom`,
      ).toBeGreaterThan(
        CLIPPED_TEXT_BOX.top + CLIPPED_TEXT_BOX.height + VISIBLE_BOX_SHIFT + 10,
      );
      expect(
        visible.ink.maxY - visible.ink.minY,
        `${name}: a whole line of ink, not the twenty units the clip allows`,
      ).toBeGreaterThan(FONT_SIZE);
    }

    for (const [name, clipped, visible] of [
      ["editor", editorClipped, editorVisible],
      ["player", playerClipped, playerVisible],
    ] as const) {
      // **The artboard clip stopped both at the same edge.** The glyphs reach
      // ~264 units from x = 620 and the edge is at 800, so both boxes carry
      // ink that the artboard clip had to cut — and identically, because they
      // hold the same text at the same size.
      for (const [box, read] of Object.entries({ clipped, visible })) {
        expect(
          within(read.ink.maxX, ARTBOARD.width, 10),
          `${name}/${box}: the ink stops at the artboard's right edge, at ${read.ink.maxX.toFixed(1)}`,
        ).toBe(true);
        expect(
          read.ink.maxX,
          `${name}/${box}: and not short of it`,
        ).toBeGreaterThan(ARTBOARD.width - 24);
      }
      expect(
        Math.abs(clipped.ink.maxX - visible.ink.maxX),
        `${name}: the clipped box and the unclipped twin were cut at the same x`,
      ).toBeLessThanOrEqual(10);
    }

    for (const [name, editor, displayed] of [
      ["clipped", editorClipped, playerClipped],
      ["visible", editorVisible, playerVisible],
    ] as const) {
      for (const axis of ["minX", "maxX", "minY", "maxY"] as const) {
        expect(
          Math.abs(editor.ink[axis] - displayed.ink[axis]),
          `${name} ink.${axis}: the editor put it at ${editor.ink[axis].toFixed(1)}, the player at ${displayed.ink[axis].toFixed(1)}`,
        ).toBeLessThanOrEqual(12);
      }
    }

    await player.close();
  });
});
