import { expect, type Page, test } from "@playwright/test";

/**
 * The editor clips the object layer to the artboard, and the handles do not.
 *
 * A rendering claim, so measured in a real browser rather than inferred from
 * the unit tests. Every read is the alpha at one point of the editor's own
 * lower canvas, taken inside the page: it says what the renderer put there.
 *
 * **The starter scene cannot make this case on its own.** Measured in Chromium
 * at the default fit: the board is 1672 scene units wide and the canvas is 626
 * device-independent pixels, so the board fills the canvas exactly and the
 * widest card stops at 1632 — inside the board, with nothing overhanging to
 * clip and no pasteboard to read. Zooming out is what makes the case real: at
 * half fit the board's right edge lands at x≈469 on a 626px stage with the
 * pasteboard beside it, so "past the edge" is a point the canvas can show
 * rather than a point off the end of the backing store. Both facts were read
 * off this scene rather than assumed; an earlier version of this file sampled
 * off-canvas and would have passed with the clip deleted.
 */

const EDITOR = "http://127.0.0.1:4174/?mode=editor";

/** The starter document's artboard width, as the scene reports it. */
const STARTER_BOARD_WIDTH = 1672;

/**
 * The card pushed past the artboard's right edge, and by how much.
 *
 * Measured on the starter: the card sits at scene x 1332 and is 300 wide, so
 * its right edge is at 1632 and the board's is at 1672. A push of 40 lands it
 * exactly *on* the boundary, which is not an overhang at all — the first
 * version of this file did that and its "the card overhangs the board" guard
 * failed at 449.5 vs 449.5. 120 puts its right edge at 1752, a clear 80 past,
 * and still lands well inside the 626px stage.
 */
const OVERHANG_CARD = "group-vram-card";
const OVERHANG_PAST_EDGE = 120;

type Bridge = {
  editor: {
    canvas: {
      clipPath?: unknown;
      viewportTransform: number[];
      getWidth(): number;
      getHeight(): number;
      getObjects(): Array<{
        id?: string;
        get(key: string): unknown;
        set(values: Record<string, unknown>): void;
        setCoords(): void;
        getBoundingRect(): {
          left: number;
          top: number;
          width: number;
          height: number;
        };
        calcOCoords(): Record<
          string,
          {
            x: number;
            y: number;
            corner: {
              tl: { x: number; y: number };
              br: { x: number; y: number };
            };
          }
        >;
      }>;
      setActiveObject(object: unknown): void;
      getActiveObject(): unknown;
      requestRenderAll(): void;
    };
    viewport: {
      zoom(): number;
      zoomBy(factor: number): void;
      panBy(dx: number, dy: number): void;
    };
  };
};

/**
 * Alpha at a client point, read from the lower canvas' backing store.
 *
 * The canvas is scaled by devicePixelRatio and by any CSS sizing, so the client
 * point goes through the element's own box rather than being assumed to be a
 * canvas pixel — a probe in the wrong space reads empty and looks like a
 * working clip.
 */
async function alphaAt(page: Page, x: number, y: number): Promise<number> {
  return page.evaluate(
    ([cx, cy]: readonly [number, number]) => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        "#yunari-fabric-editor canvas.lower-canvas",
      );
      if (canvas === null) throw new Error("no lower canvas in the editor");
      const box = canvas.getBoundingClientRect();
      if (box.width === 0) throw new Error("the lower canvas has no box");
      const scale = canvas.width / box.width;
      const context = canvas.getContext("2d");
      if (context === null)
        throw new Error("no 2d context on the lower canvas");
      const data = context.getImageData(
        Math.round((cx - box.x) * scale),
        Math.round((cy - box.y) * scale),
        1,
        1,
      ).data;
      return data[3] ?? 0;
    },
    [x, y] as const,
  );
}

/** A scene point in page coordinates, through the camera the editor owns. */
async function sceneToClient(
  page: Page,
  x: number,
  y: number,
): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([sx, sy]: readonly [number, number]) => {
      const bridge = (window as unknown as { yunariEditorBridge: Bridge })
        .yunariEditorBridge;
      const vpt = bridge.editor.canvas.viewportTransform;
      const upper = document.querySelector<HTMLCanvasElement>(
        "#yunari-fabric-editor canvas.upper-canvas",
      );
      if (upper === null) throw new Error("no upper canvas in the editor");
      const box = upper.getBoundingClientRect();
      return {
        x: box.x + (vpt[4] ?? 0) + sx * (vpt[0] ?? 1),
        y: box.y + (vpt[5] ?? 0) + sy * (vpt[3] ?? 1),
      };
    },
    [x, y] as const,
  );
}

/** A row through the middle of the overhanging card, in scene units. */
async function cardMiddleRow(page: Page): Promise<number> {
  return page.evaluate((cardId) => {
    const bridge = (window as unknown as { yunariEditorBridge: Bridge })
      .yunariEditorBridge;
    const card = bridge.editor.canvas
      .getObjects()
      .find((object) => object.id === cardId);
    if (card === undefined) throw new Error(`no card with id ${cardId}`);
    return Number(card.get("top")) + Number(card.get("height")) / 2;
  }, OVERHANG_CARD);
}

/** The lower canvas' own box in page coordinates. */
async function stageBox(page: Page): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
}> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      "#yunari-fabric-editor canvas.lower-canvas",
    );
    if (canvas === null) throw new Error("no lower canvas in the editor");
    const box = canvas.getBoundingClientRect();
    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    };
  });
}

/**
 * Zoom out and push one card past the artboard's right edge.
 *
 * Done through the viewport manager and Fabric's own property setters, which
 * are the product's own paths, and every number it returns is measured back so
 * the tests below assert against the geometry that resulted rather than the
 * one that was asked for.
 */
async function arrangeOverhang(page: Page): Promise<{
  zoom: number;
  boardRightX: number;
  cardRightX: number;
  cardInsideX: number;
  stageWidth: number;
}> {
  const measured = await page.evaluate(
    ([cardId, boardWidth, past]: readonly [string, number, number]) => {
      const bridge = (window as unknown as { yunariEditorBridge: Bridge })
        .yunariEditorBridge;
      const canvas = bridge.editor.canvas;

      // Half fit, so the board no longer fills the canvas and there is
      // pasteboard beside it to read.
      bridge.editor.viewport.zoomBy(0.5);
      bridge.editor.viewport.panBy(-20, -10);

      const card = canvas.getObjects().find((object) => object.id === cardId);
      if (card === undefined) throw new Error(`no card with id ${cardId}`);
      // `left`/`width` rather than `getBoundingRect()`: the bounding box is a
      // cached world rect and is only recomputed on a render pass, so reading
      // it straight after a `set` measures where the card *was*. Measured here:
      // reading it immediately returned the pre-move edge, exactly on the board
      // boundary, which is how an overhang test ends up asserting on nothing.
      const beforeLeft = Number(card.get("left"));
      const width = Number(card.get("width"));
      if (!Number.isFinite(beforeLeft) || !Number.isFinite(width)) {
        throw new Error("the card has no usable geometry");
      }
      card.set({ left: beforeLeft + past });
      card.setCoords();
      canvas.requestRenderAll();

      const movedLeft = Number(card.get("left"));
      const vpt = canvas.viewportTransform;
      const toScreen = (sceneX: number): number =>
        (vpt[4] ?? 0) + sceneX * (vpt[0] ?? 1);
      return {
        zoom: vpt[0] ?? 1,
        boardRightX: toScreen(boardWidth),
        cardRightX: toScreen(movedLeft + width),
        cardInsideX: toScreen(movedLeft + width / 2),
        stageWidth: canvas.getWidth(),
      };
    },
    [OVERHANG_CARD, STARTER_BOARD_WIDTH, OVERHANG_PAST_EDGE] as const,
  );
  await page.waitForTimeout(300);
  return measured;
}

test.describe("the editor clips the object layer to the artboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(EDITOR);
    await expect(page.locator("#yunari-fabric-editor")).toBeVisible();
    await page.waitForFunction(
      () =>
        (window as unknown as { yunariEditorBridge?: unknown })
          .yunariEditorBridge !== undefined,
    );
    // The starter paints asynchronously (fonts, images); a read before it has
    // finished is a read of an empty canvas.
    await page.waitForTimeout(1500);
  });

  test("a card overhanging the edge shows only its in-board part", async ({
    page,
  }) => {
    const m = await arrangeOverhang(page);

    // The arrangement has to be the one the assertions below depend on, or
    // they measure the setup rather than the clip.
    expect(m.zoom, "the camera zoomed out").toBeLessThan(0.5);
    expect(
      m.cardRightX,
      "the card really does overhang the board's right edge",
    ).toBeGreaterThan(m.boardRightX);
    expect(
      m.cardRightX,
      "and its overhang is still on the stage, not off the canvas",
    ).toBeLessThan(m.stageWidth);

    // A row through the middle of the card: one sample inside the board, one
    // past the board's right edge but still over the card.
    const y = await cardMiddleRow(page);

    const inside = await sceneToClient(page, STARTER_BOARD_WIDTH - 30, y);
    const outside = await sceneToClient(page, STARTER_BOARD_WIDTH + 20, y);

    expect(
      await alphaAt(page, inside.x, inside.y),
      "the part of the card inside the artboard is painted",
    ).toBeGreaterThan(0);
    expect(
      await alphaAt(page, outside.x, outside.y),
      "the part hanging off the edge is not, though the card covers that point",
    ).toBe(0);

    // The structural read comes *after* the pixels, deliberately. Asserting it
    // first meant this test failed on the structure under sabotage and never
    // reached a pixel, so the pixel assertions — the only ones that can tell a
    // working clip from a missing one — were never proved to fail at all.
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { yunariEditorBridge: Bridge })
            .yunariEditorBridge.editor.canvas.clipPath,
      ),
      "and the mechanism doing it is the scene-level clip the row calls for",
    ).toBeTruthy();
  });

  test("the edge follows the board, not the canvas, under zoom and pan", async ({
    page,
  }) => {
    const m = await arrangeOverhang(page);
    expect(m.cardRightX).toBeGreaterThan(m.boardRightX);

    const y = await cardMiddleRow(page);

    // Move the camera again. The clip is in artboard units, so the edge has to
    // travel with the board; a clip pinned to canvas pixels would not.
    //
    // Zoom out before panning. Measured: at half fit the board fills the whole
    // 626px canvas width, so `panBy` in x is clamped to nothing; zooming out
    // first is what frees the pan. Pan left and down, the way the clamp allows
    // once there is room.
    await page.evaluate(() => {
      const bridge = (window as unknown as { yunariEditorBridge: Bridge })
        .yunariEditorBridge;
      bridge.editor.viewport.zoomBy(0.75);
      bridge.editor.viewport.panBy(-40, 20);
      bridge.editor.canvas.requestRenderAll();
    });
    await page.waitForTimeout(300);

    const moved = await page.evaluate(() => {
      const bridge = (window as unknown as { yunariEditorBridge: Bridge })
        .yunariEditorBridge;
      const vpt = bridge.editor.canvas.viewportTransform;
      return {
        zoom: vpt[0] ?? 1,
        boardRightX: (vpt[4] ?? 0) + 1672 * (vpt[0] ?? 1),
      };
    });
    expect(moved.zoom, "the camera really did move again").not.toBe(m.zoom);

    const inside = await sceneToClient(page, STARTER_BOARD_WIDTH - 30, y);
    const outside = await sceneToClient(page, STARTER_BOARD_WIDTH + 20, y);

    // Bounded against the stage's *page* box: `sceneToClient` returns page
    // coordinates — the canvas element's own offset included — and
    // `canvas.getWidth()` is canvas-local, so comparing the two is a units
    // error that reads as "the probe fell off the stage".
    const stage = await stageBox(page);
    expect(inside.x, "the inside probe is still on the stage").toBeGreaterThan(
      stage.x,
    );
    expect(outside.x, "and so is the outside probe").toBeLessThan(
      stage.x + stage.width,
    );

    expect(
      await alphaAt(page, inside.x, inside.y),
      "just inside the board's right edge, under zoom and pan",
    ).toBeGreaterThan(0);
    expect(
      await alphaAt(page, outside.x, outside.y),
      "just outside it, same camera: the clip followed the board",
    ).toBe(0);
  });

  test("a clipped selection keeps handles that are painted and on the stage", async ({
    page,
  }) => {
    const m = await arrangeOverhang(page);
    expect(m.cardRightX, "the card overhangs the board").toBeGreaterThan(
      m.boardRightX,
    );

    await page.evaluate((cardId) => {
      const bridge = (window as unknown as { yunariEditorBridge: Bridge })
        .yunariEditorBridge;
      const card = bridge.editor.canvas
        .getObjects()
        .find((object) => object.id === cardId);
      if (card === undefined) throw new Error(`no card with id ${cardId}`);
      bridge.editor.canvas.setActiveObject(card);
      bridge.editor.canvas.requestRenderAll();
    }, OVERHANG_CARD);
    await page.waitForTimeout(300);

    const handle = await page.evaluate(() => {
      const bridge = (window as unknown as { yunariEditorBridge: Bridge })
        .yunariEditorBridge;
      const active = bridge.editor.canvas.getActiveObject() as {
        calcOCoords?: () => Record<
          string,
          { x: number; y: number; corner: { br: { x: number; y: number } } }
        >;
      } | null;
      if (active === null || active.calcOCoords === undefined) {
        throw new Error("nothing is active");
      }
      const br = active.calcOCoords()["br"];
      if (br === undefined) throw new Error("no bottom-right handle");
      const upper = document.querySelector<HTMLCanvasElement>(
        "#yunari-fabric-editor canvas.upper-canvas",
      );
      if (upper === null) throw new Error("no upper canvas in the editor");
      const box = upper.getBoundingClientRect();
      return {
        x: box.x + br.x,
        y: box.y + br.y,
        stageWidth: box.width,
        stageHeight: box.height,
      };
    });

    const stage = await stageBox(page);
    // A bounding box inside the stage, not merely non-zero: "the handle
    // exists" is exactly what a clipped handle satisfies while being unusable.
    expect(handle.x, "the handle is on the stage horizontally").toBeGreaterThan(
      stage.x,
    );
    expect(handle.y, "and vertically").toBeGreaterThan(stage.y);
    expect(handle.x, "and within the stage's right edge").toBeLessThan(
      stage.x + stage.width,
    );
    expect(handle.y, "and within its bottom edge").toBeLessThan(
      stage.y + stage.height,
    );

    // Past the board's edge, so this is a *clipped* selection.
    const edge = await sceneToClient(page, STARTER_BOARD_WIDTH, 0);
    expect(handle.x, "the handle really is off the artboard").toBeGreaterThan(
      edge.x,
    );

    // And painted. Sampled over a spread because a handle is a few pixels
    // across and a single probe can straddle its edge.
    let painted = 0;
    for (const dx of [-2, -1, 0, 1, 2]) {
      for (const dy of [-2, -1, 0, 1, 2]) {
        if ((await alphaAt(page, handle.x + dx, handle.y + dy)) > 0) {
          painted += 1;
        }
      }
    }
    expect(
      painted,
      `the handle near (${Math.round(handle.x)},${Math.round(handle.y)}) is painted on the lower canvas: the clip did not take the selection chrome with it`,
    ).toBeGreaterThan(0);
  });
});
