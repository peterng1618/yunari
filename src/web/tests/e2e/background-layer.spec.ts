import { expect, type Page, test } from "@playwright/test";
import {
  BACKGROUND_LAYER_INK,
  BACKGROUND_LAYER_PAINT,
  HOST_BACKGROUND_EDGE_THEME_ID,
  HOST_BACKGROUND_FLIP_THEME_ID,
  HOST_BACKGROUND_LAYER_THEME_ID,
  HOST_PORT,
} from "./host-theme.js";

/**
 * The background media layer on the real player: the authored transform is
 * visible, and the layer clips it.
 *
 * The media always `cover`s its box, so a narrow source in a wide board is much
 * taller than the board and hangs above and below it — the clip is a place on
 * screen, not an off-screen coordinate. Every expected rect is derived here from
 * the measured layer rect and the image's natural size, so no assertion carries
 * a viewport-sized pixel number.
 */

const HOST = `http://127.0.0.1:${HOST_PORT}`;

/** The fixture's artboard, also the layer's own box (`bounds: "theme"`). */
const ARTBOARD = { width: 640, height: 200 } as const;
/** The authored media offset, verbatim from the fixture. The horizontal offset
 *  is inert because the cover rect has no horizontal overhang to pan within. */
const MEDIA = { offsetX: 0, offsetY: 0.25 } as const;
/** The layer fixture's glass panel, so the pixel reads can aim inside it. */
const LAYER_PANEL = { left: 420, top: 20, width: 120, height: 120 } as const;
/** The flip fixture's panel, over the board's left half — the striped half
 *  under the flip. */
const FLIP_PANEL = { left: 40, top: 40, width: 120, height: 120 } as const;
/** The panels' authored fill, `rgba(0, 0, 0, 0.35)`: the glass is translucent,
 *  so a panel pixel is the blur of what is behind it with this much black over
 *  it. A dark tint on the bright media is deliberately far from the media's own
 *  ink, so a read that misses the panel (or a sampler that never ran) cannot
 *  pass the panel assertion by being close enough. */
const PANEL_BLACK_ALPHA = 0.35;

interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface Geometry {
  readonly host: Rect;
  readonly layer: Rect;
  readonly media: Rect;
  readonly natural: { readonly width: number; readonly height: number };
  readonly transform: {
    readonly scale: number;
    readonly offsetX: number;
    readonly offsetY: number;
  };
}

/** Reads the host, the layer and the placed child in one sample, so a live
 *  re-fit cannot make an assertion compare two different moments. */
function readGeometry(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    const host = document.querySelector<HTMLElement>("#artboard");
    const layer = document.querySelector<HTMLElement>(
      "[data-yunari-background-media]",
    );
    const media = layer?.querySelector<HTMLImageElement>("img");
    if (
      host === null ||
      layer === null ||
      media === undefined ||
      media === null
    ) {
      throw new Error("the background media layer is not mounted");
    }
    const toRect = (element: Element) => {
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
      };
    };
    const handle = (
      window as unknown as {
        yunari: {
          handle: {
            transform(): {
              scale: number;
              offsetX: number;
              offsetY: number;
            };
          };
        };
      }
    ).yunari.handle;
    const transform = handle.transform();
    return {
      host: toRect(host),
      layer: toRect(layer),
      media: toRect(media),
      natural: { width: media.naturalWidth, height: media.naturalHeight },
      transform: {
        scale: transform.scale,
        offsetX: transform.offsetX,
        offsetY: transform.offsetY,
      },
    };
  });
}

/** The cover placement oracle, written from the contract rather than imported: a
 *  test that called the renderer's own `placement()` could agree with it while
 *  both were wrong. An offset zooms the picture until the pan it asks for fits
 *  (0095), and the pan is then bounded by the rect's own overhang, which is what
 *  stops an offset from uncovering the box. */
function coveredPlacement(
  box: { readonly width: number; readonly height: number },
  source: { readonly width: number; readonly height: number },
  media: { readonly offsetX: number; readonly offsetY: number },
): Rect {
  const panFloor = (span: number, sourceSpan: number, offset: number): number =>
    (span * (1 + 2 * Math.abs(offset))) / sourceSpan;
  const factor = Math.max(
    box.width / source.width,
    box.height / source.height,
    panFloor(box.width, source.width, media.offsetX),
    panFloor(box.height, source.height, media.offsetY),
  );
  const width = source.width * factor;
  const height = source.height * factor;
  const bounded = (pan: number, overhang: number): number =>
    Math.max(-overhang, Math.min(overhang, pan));
  return {
    left:
      (box.width - width) / 2 +
      bounded(box.width * media.offsetX, (width - box.width) / 2),
    top:
      (box.height - height) / 2 +
      bounded(box.height * media.offsetY, (height - box.height) / 2),
    width,
    height,
  };
}

const within = (actual: number, expected: number, label: string): void => {
  expect(
    Math.abs(actual - expected),
    `${label}: expected ${expected.toFixed(2)} px, read ${actual.toFixed(2)} px`,
  ).toBeLessThanOrEqual(1);
};

interface Pixel {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * Samples one screenshot pixel per viewport point, in one decode.
 *
 * The bitmap is denser than the page on a phone (device pixel ratio), so the
 * conversion is the bitmap's own width over the element's, not a constant.
 */
async function samplePixels(
  page: Page,
  shot: string,
  points: readonly { readonly x: number; readonly y: number }[],
): Promise<Pixel[]> {
  return page.evaluate(
    async ([data, targets]) => {
      const bytes = Uint8Array.from(atob(data!), (char) => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes]));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("no 2d context for the screenshot");
      context.drawImage(bitmap, 0, 0);
      const host = document
        .querySelector<HTMLElement>("#artboard")!
        .getBoundingClientRect();
      const scaleX = bitmap.width / host.width;
      const scaleY = bitmap.height / host.height;
      return targets.map((point) => {
        const x = Math.round((point.x - host.left) * scaleX);
        const y = Math.round((point.y - host.top) * scaleY);
        const pixel = context.getImageData(x, y, 1, 1).data;
        return { r: pixel[0]!, g: pixel[1]!, b: pixel[2]! };
      });
    },
    [shot, points] as const,
  );
}

const expectPixel = (
  actual: Pixel | undefined,
  expected: { readonly r: number; readonly g: number; readonly b: number },
  label: string,
): void => {
  expect(actual, `${label}: a pixel was read`).toBeDefined();
  expect(Math.abs(actual!.r - expected.r), `${label}: red`).toBeLessThanOrEqual(
    12,
  );
  expect(
    Math.abs(actual!.g - expected.g),
    `${label}: green`,
  ).toBeLessThanOrEqual(12);
  expect(
    Math.abs(actual!.b - expected.b),
    `${label}: blue`,
  ).toBeLessThanOrEqual(12);
};

/** The largest per-channel difference between two sampled colours. */
function channelDistance(a: Pixel, b: Pixel): number {
  return Math.max(
    Math.abs(a.r - b.r),
    Math.abs(a.g - b.g),
    Math.abs(a.b - b.b),
  );
}

/** What the translucent panel shows when the fixture's two stripes are behind
 *  it. The backdrop is blurred, and the blur of stripes is their mean, so the
 *  panel's own fill over that mean is the whole composite. */
function panelOver(base: Pixel): Pixel {
  const mix = (channel: number): number =>
    Math.round(channel * (1 - PANEL_BLACK_ALPHA));
  return { r: mix(base.r), g: mix(base.g), b: mix(base.b) };
}

/** Waits for the layer's bytes and the placement that needs them. The layer
 *  mounts before its source decodes, and a read before `load` is a read of the
 *  load-window rect. */
async function settle(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const image = document.querySelector<HTMLImageElement>(
            "[data-yunari-background-media] img",
          );
          return image !== null && image.complete && image.naturalWidth > 0;
        }),
      { timeout: 20_000 },
    )
    .toBe(true);
  await page.waitForTimeout(400);
}

/** Maps artboard units onto viewport points for one measured geometry. */
function artboardMap(geometry: Geometry) {
  const scaleX = geometry.layer.width / ARTBOARD.width;
  const scaleY = geometry.layer.height / ARTBOARD.height;
  return (x: number, y: number) => ({
    x: geometry.layer.left + x * scaleX,
    y: geometry.layer.top + y * scaleY,
  });
}

test.describe("the background media layer on the player", () => {
  test("places the media by its authored transform and clips it to the board", async ({
    page,
  }, testInfo) => {
    await page.goto(`${HOST}/?theme=${HOST_BACKGROUND_LAYER_THEME_ID}`);
    await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();
    // The layer is the claim; without it every pixel below would read the
    // host's paint and pass for the wrong reason.
    await expect(
      page.locator("[data-yunari-background-media]"),
      "the player mounted a background media layer",
    ).toHaveCount(1);
    await settle(page);

    const geometry = await readGeometry(page);
    expect(geometry.natural.width, "the source decoded").toBeGreaterThan(0);
    expect(geometry.transform.scale, "the board is on screen").toBeGreaterThan(
      0,
    );

    // 1. The layer is the board's screen rect.
    const board: Rect = {
      left: geometry.host.left + geometry.transform.offsetX,
      top: geometry.host.top + geometry.transform.offsetY,
      width: ARTBOARD.width * geometry.transform.scale,
      height: ARTBOARD.height * geometry.transform.scale,
    };
    within(geometry.layer.left, board.left, "layer left");
    within(geometry.layer.top, board.top, "layer top");
    within(geometry.layer.width, board.width, "layer width");
    within(geometry.layer.height, board.height, "layer height");

    // 2. The child is the cover placement rect, computed from the measured
    //    layer and the source's own size rather than from a pixel number here.
    const placed = coveredPlacement(
      { width: geometry.layer.width, height: geometry.layer.height },
      geometry.natural,
      MEDIA,
    );
    within(
      geometry.media.left,
      geometry.layer.left + placed.left,
      "media left",
    );
    within(geometry.media.top, geometry.layer.top + placed.top, "media top");
    within(geometry.media.width, placed.width, "media width");
    within(geometry.media.height, placed.height, "media height");

    // 3. The child really does overhang its clip, or the clip cases below would
    //    pass on a layer that never clipped anything.
    expect(
      geometry.media.top,
      "the placed media hangs above the board, so the clip has something to cut",
    ).toBeLessThan(geometry.layer.top - 2);
    expect(
      geometry.media.top + geometry.media.height,
      "the placed media hangs below the board",
    ).toBeGreaterThan(geometry.layer.top + geometry.layer.height + 2);

    // 4. The pixels. Points are viewport coordinates derived from the measured
    //    rects; the expected colours are the fixture's own paint and ink.
    const point = artboardMap(geometry);
    // 68 units off the panel's left edge: still inside it, and on an ink
    // stripe's centre rather than its edge, so a sharp read is one tone and a
    // blurred one is their mean.
    const panelCentre = point(
      LAYER_PANEL.left + 68,
      LAYER_PANEL.top + LAYER_PANEL.height / 2,
    );
    const points = [
      // Inside the board, below the panel, on an ink stripe's centre: the media
      // covers the whole box, so this is its ink and never the paint.
      point(8, LAYER_PANEL.top + LAYER_PANEL.height + 30),
      // Likewise on the far side of the panel.
      point(584, LAYER_PANEL.top + LAYER_PANEL.height + 30),
      // Just above the layer, inside the overhanging child: the clip's own
      // claim. Ten board units out keeps the read inside the host's own paint.
      point(480, -10),
      // Just below the layer, likewise inside the child.
      point(480, ARTBOARD.height + 10),
      // Inside the glass panel's own rect: the panel is what the backdrop
      // sampler reads, so this probes the sampler's answer, not the DOM layer's.
      panelCentre,
    ];

    const screenshot = await page.locator("#artboard").screenshot();
    await testInfo.attach("background-layer.png", {
      body: screenshot,
      contentType: "image/png",
    });
    const pixels = await samplePixels(
      page,
      screenshot.toString("base64"),
      points,
    );

    expectPixel(
      pixels[0],
      BACKGROUND_LAYER_INK,
      "the media covers the board: no colour shows inside the box",
    );
    expectPixel(
      pixels[1],
      BACKGROUND_LAYER_INK,
      "inside the placed rect, the media's own ink shows",
    );
    expectPixel(
      pixels[2],
      BACKGROUND_LAYER_PAINT,
      "above the layer, the clipped child paints nothing",
    );
    expectPixel(
      pixels[3],
      BACKGROUND_LAYER_PAINT,
      "below the layer, the clipped child paints nothing",
    );

    // 5. Inside the glass panel. The media under it is 16-unit ink/bar stripes
    //    on a 32-unit period against a 16-unit blur, so a running sampler
    //    averages them to their mean; a sampler that never ran leaves the sharp
    //    DOM media visible through the translucent panel (one tone), and a read
    //    that missed the panel shows a tone outright.
    const panelMedia = panelOver(BACKGROUND_LAYER_INK);
    const panelPaint = panelOver(BACKGROUND_LAYER_PAINT);
    const panelBlurred = panelOver({
      r: Math.round((BACKGROUND_LAYER_INK.r + BACKGROUND_LAYER_PAINT.r) / 2),
      g: Math.round((BACKGROUND_LAYER_INK.g + BACKGROUND_LAYER_PAINT.g) / 2),
      b: Math.round((BACKGROUND_LAYER_INK.b + BACKGROUND_LAYER_PAINT.b) / 2),
    });
    expect(
      channelDistance(panelMedia, panelBlurred),
      "a tone and the blur's mean are far enough apart to tell apart",
    ).toBeGreaterThan(40);
    expect(
      channelDistance(panelPaint, panelBlurred),
      "the other tone and the blur's mean are far enough apart to tell apart",
    ).toBeGreaterThan(40);
    const panel = pixels[4];
    expect(panel, "the panel's pixel was read").toBeDefined();
    expect(
      channelDistance(panel!, panelBlurred),
      `the sampler blurred the stripes: read ${JSON.stringify(panel)}, expected about ${JSON.stringify(panelBlurred)}`,
    ).toBeLessThanOrEqual(15);
    expect(
      channelDistance(panel!, panelMedia),
      "the panel did not show the sharp media through a transparent canvas",
    ).toBeGreaterThan(40);
    expect(
      channelDistance(panel!, panelPaint),
      "the panel did not show the other sharp tone",
    ).toBeGreaterThan(40);
  });

  test("an offset at its maximum stops at the box edge", async ({ page }) => {
    // The fixture's offset is `1`, so the picture zooms until a full box of pan
    // fits and the pan then stops exactly on the box edge. Without the clamp the
    // top strip would be the paint; with it, both edges are ink.
    await page.goto(`${HOST}/?theme=${HOST_BACKGROUND_EDGE_THEME_ID}`);
    await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();
    await settle(page);

    const geometry = await readGeometry(page);
    const placed = coveredPlacement(
      { width: geometry.layer.width, height: geometry.layer.height },
      geometry.natural,
      { offsetX: 0, offsetY: 1 },
    );
    within(geometry.media.top, geometry.layer.top + placed.top, "media top");
    within(
      geometry.media.top + geometry.media.height,
      geometry.layer.top + placed.top + placed.height,
      "media bottom",
    );

    const point = artboardMap(geometry);
    const screenshot = await page.locator("#artboard").screenshot();
    const pixels = await samplePixels(page, screenshot.toString("base64"), [
      point(320, 1),
      point(320, ARTBOARD.height - 1),
    ]);
    expectPixel(
      pixels[0],
      BACKGROUND_LAYER_INK,
      "the board's top edge is the media, not the colour",
    );
    expectPixel(
      pixels[1],
      BACKGROUND_LAYER_INK,
      "the board's bottom edge is the media, not the colour",
    );
  });

  test("flip survives the stored document and reaches the glass sample", async ({
    page,
  }, testInfo) => {
    // The theme is a stored document (`theme.json` on the host) carrying
    // `flipX`, so this reads the same question twice: the DOM layer mirrors the
    // two-tone source, and the canvas sampler mirrors what it draws.
    await page.goto(`${HOST}/?theme=${HOST_BACKGROUND_FLIP_THEME_ID}`);
    await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();
    await settle(page);

    const geometry = await readGeometry(page);
    const point = artboardMap(geometry);
    const screenshot = await page.locator("#artboard").screenshot();
    await testInfo.attach("background-flip.png", {
      body: screenshot,
      contentType: "image/png",
    });
    const pixels = await samplePixels(page, screenshot.toString("base64"), [
      // Below the panel, on a stripe centre in the board's left half: under the
      // flip that half shows the source's striped right half.
      point(8, 185),
      // The board's right half: under the flip, the source's flat bar half.
      point(600, 185),
      // The panel over the board's left half, drawn by the canvas sampler. 65
      // units in is an ink stripe's centre under the flip.
      point(FLIP_PANEL.left + 65, FLIP_PANEL.top + FLIP_PANEL.height / 2),
    ]);

    expectPixel(
      pixels[0],
      BACKGROUND_LAYER_INK,
      "the flipped source's striped half is on the left",
    );
    expectPixel(
      pixels[1],
      BACKGROUND_LAYER_PAINT,
      "the flipped source's flat bar half is on the right",
    );

    // Three readings the panel can produce, all far apart: the blur's mean when
    // the sampler mirrors the stripes; the bar's tint when the sampler ignores
    // the flip and draws the source's other half; the sharp ink's tint when no
    // sampler ran at all and the DOM media shows through the canvas.
    const panelFlipped = panelOver({
      r: Math.round((BACKGROUND_LAYER_INK.r + BACKGROUND_LAYER_PAINT.r) / 2),
      g: Math.round((BACKGROUND_LAYER_INK.g + BACKGROUND_LAYER_PAINT.g) / 2),
      b: Math.round((BACKGROUND_LAYER_INK.b + BACKGROUND_LAYER_PAINT.b) / 2),
    });
    const panelUnflipped = panelOver(BACKGROUND_LAYER_PAINT);
    const panelNoSampler = panelOver(BACKGROUND_LAYER_INK);
    expect(
      channelDistance(panelFlipped, panelUnflipped),
      "the two tones are far enough apart to tell apart",
    ).toBeGreaterThan(40);
    expect(
      channelDistance(panelFlipped, panelNoSampler),
      "the mean and the sharp tone are far enough apart to tell apart",
    ).toBeGreaterThan(40);
    const panel = pixels[2];
    expect(panel, "the panel's pixel was read").toBeDefined();
    expect(
      channelDistance(panel!, panelFlipped),
      `the sampler mirrored the stripes under the panel: read ${JSON.stringify(panel)}, expected about ${JSON.stringify(panelFlipped)}`,
    ).toBeLessThanOrEqual(15);
    expect(
      channelDistance(panel!, panelUnflipped),
      "the sampler did not draw the unmirrored source",
    ).toBeGreaterThan(40);
    expect(
      channelDistance(panel!, panelNoSampler),
      "the panel did not show the sharp media through a transparent canvas",
    ).toBeGreaterThan(40);
  });
});
