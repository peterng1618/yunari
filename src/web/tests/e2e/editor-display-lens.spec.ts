import { expect, test } from "@playwright/test";
import { lensBox } from "../../packages/editor/src/display-lens.js";
import { uiCopy } from "../../packages/editor/src/ui-copy.js";
import { openDisplayStage } from "./editor-display-entry.js";
import {
  artboardPageBox,
  aspect,
  BLUE_PNG,
  type Bridge,
  boxOf,
  canvasInkBox,
  chooseDisplay,
  corners,
  createBlankTheme,
  fillDisplayBounds,
  importBackground,
  isColour,
  MEDIA,
  measure,
  mediaGeometry,
  openAssets,
  panCamera,
  pixelAt,
  RED_PNG,
  SCREEN,
  solidPng,
  stageBackground,
} from "./editor-stage.js";
import { isDesktopSurface } from "./surface.js";

/**
 * What the lens draws: the guide frame over a mismatched board, the circle
 * clip, the letterbox the background paints, and the stage's own texture.
 *
 * Every case here measures a drawing rather than the camera's arithmetic — the
 * guide against Fabric's own projection, the disc against the canvas' painted
 * ink, the letterbox against the pixels the browser composed. The display
 * choice and its framing are `editor-display.spec.ts`.
 */

test.describe("the stage looks through a display", () => {
  test.beforeEach(async ({ page }) => {
    await openDisplayStage(page);
  });

  /** the glyph-only hover rule, on the one glyph-only control this task adds: hover *acquires*
   *  the border rather than washing the background, and acquires it without
   *  moving anything.
   *
   *  The two colours are compared to each other, not to a palette value, so all
   *  six palettes are the same measurement — the claim is the *relationship*
   *  ("nothing at rest, an edge on hover"), which is what a page cannot state
   *  for itself and jsdom cannot see at all. The rested border is asserted
   *  transparent rather than merely different, because a resting border of any
   *  colour would be a different control.
   *
   *  **The edge arrives over a transition, so the read has to wait for it.**
   *  This control transitions `border-color` over 0.14 s, and a read in the same
   *  frame as the hover returns the resting value *exactly* — measured on the
   *  running editor: transparent at +0 ms, `rgba(79, 102, 89, 0.62)` at +30 ms,
   *  the token's own `rgb(79, 102, 89)` by +250 ms. The state was never the
   *  problem (`:hover` matched from the first frame); reading it as though the
   *  change were instant was, which is how this case failed every time it was
   *  measured rather than intermittently. Polling waits for the edge without
   *  naming a duration, and still fails if the rule is removed, because then the
   *  colour never leaves the resting value at all. */
  test("a camera step acquires its edge on hover, and nothing moves", async ({
    page,
  }) => {
    const step = page.locator('.editor-shell-view-step[aria-label="Zoom in"]');
    await expect(step).toBeVisible();
    // **Before the resting box is read, because `hover()` scrolls.** On the phone
    // surface the stage starts below the fold, so the resting box was measured
    // pre-scroll and the box after the hover post-scroll — 457 against 356 on
    // `x`, with the size identical, which is a scroll and not a movement. The
    // older zone case carried this call for the same reason.
    await step.scrollIntoViewIfNeeded();

    const borderOf = () =>
      step.evaluate((node) => getComputedStyle(node).borderTopColor);

    const resting = await borderOf();
    const restedBox = await step.boundingBox();
    expect(
      resting,
      "the glyph-only control rests with no border of its own",
    ).toMatch(/^(rgba\(0, 0, 0, 0\)|transparent)$/);

    await step.hover();
    await expect
      .poll(borderOf, { message: "and hover is what gives it one" })
      .not.toBe(resting);
    expect(
      await step.boundingBox(),
      "the border changes no box, so nothing moves",
    ).toEqual(restedBox);
  });

  test("the stage paints its own texture, not the theme's", async ({
    page,
  }) => {
    // The stage's own texture is the palette's, and it is a paint on the stage
    // element rather than on the host the canvas mounts into: the theme's paint
    // is for the board and the letterbox inside the lens.
    expect(await stageBackground(page)).toContain("repeating-linear-gradient");
  });

  test("a display-bounded background follows zoom and pan", async ({
    page,
  }, testInfo) => {
    // The background's bounds live in the inspector, which the phone surface
    // does not draw; the editor is a desktop surface.
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await createBlankTheme(page);
    await openAssets(page);
    await importBackground(page, solidPng("red.png", RED_PNG));
    await fillDisplayBounds(page);
    await chooseDisplay(page, "16:9");

    const before = await mediaGeometry(page);
    // The camera claims **bare** keys: `=` and `+` zoom in, and the Ctrl
    // chords are the browser's page zoom (navigation.ts refuses any modifier).
    await page.keyboard.press("=");
    const zoomed = await mediaGeometry(page);
    expect(zoomed.left).not.toBeCloseTo(before.left, 3);
    expect(zoomed.width / before.width).toBeCloseTo(
      zoomed.zoom / before.zoom,
      3,
    );
    await panCamera(page, 40, -20);
    const panned = await mediaGeometry(page);
    // Precision 1, not 3: the layer's box is a laid-out element, and the
    // browser rounds it to a device pixel (`39.984375` for a 40px pan), which a
    // thousandth-of-a-pixel comparison calls a failure.
    expect(panned.left - zoomed.left).toBeCloseTo(40, 1);
    expect(panned.top - zoomed.top).toBeCloseTo(-20, 1);
  });

  test("the guide frame marks a mismatched artboard, and leaves a near-match alone", async ({
    page,
  }) => {
    await chooseDisplay(page, "1:1");
    const guide = page.locator("[data-yunari-theme-guide]");
    await expect(guide).toBeVisible();

    // The starter is 1672 × 941 — 16:9 to the eye and not to an exact aspect
    // comparison. The guide is hidden here because the 16:9 lens box is within
    // **one artboard unit** of the board on either edge, which is the rule the
    // spec states; an exact match would have drawn a second frame over the board.
    const board = await page.evaluate(() => {
      const bridge = (window as unknown as { yunariEditorBridge: Bridge })
        .yunariEditorBridge;
      return bridge.editor.artboard();
    });
    const fitted = lensBox({ aspect: 16 / 9, shape: "rect" }, board);
    const drift = Math.max(
      Math.abs(fitted.width - board.width),
      Math.abs(fitted.height - board.height),
    );
    expect(drift, "the fitted box is not exactly the board").toBeGreaterThan(0);
    expect(
      drift,
      "but it is within one artboard unit on either edge",
    ).toBeLessThanOrEqual(1);

    await chooseDisplay(page, "16:9");
    await expect(
      guide,
      "one unit is noise, so the frame stays hidden",
    ).toBeHidden();
  });

  test("the guide sits on the board's Fabric-projected box through zoom and pan", async ({
    page,
  }) => {
    await createBlankTheme(page);
    await chooseDisplay(page, "1:1");
    const guide = page.locator("[data-yunari-theme-guide]");
    await expect(guide).toBeVisible();

    /** The guide's page box against the board's, projected from Fabric's own
     *  transform — never from `artboardScreenRect()`, the camera helper the
     *  guide itself is written with. */
    const expectOnBoard = async (step: string): Promise<void> => {
      const drawing = await guide.boundingBox();
      const board = await artboardPageBox(page);
      if (drawing === null) throw new Error(`the guide is not drawn ${step}`);
      expect(drawing.x, `the guide's left ${step}`).toBeCloseTo(board.left, 0);
      expect(drawing.y, `the guide's top ${step}`).toBeCloseTo(board.top, 0);
      expect(drawing.width, `the guide's width ${step}`).toBeCloseTo(
        board.width,
        0,
      );
      expect(drawing.height, `the guide's height ${step}`).toBeCloseTo(
        board.height,
        0,
      );
    };

    await expectOnBoard("at the fit");
    // Bare `=`, the camera's own zoom-in key; see the media test above.
    await page.keyboard.press("=");
    await expectOnBoard("after a zoom");
    await panCamera(page, 40, -20);
    await expectOnBoard("after a 40/−20 pan");

    await page.locator("[data-yunari-zoom]").click();
    await page.getByRole("menuitemradio", { name: uiCopy.display.fit }).click();
    await expect(guide, "Fit frames no display, so no guide").toBeHidden();
    await chooseDisplay(page, "16:9");
    await expect(
      guide,
      "a lens matching the board's own aspect would draw the same box twice",
    ).toBeHidden();
  });

  test("a circle lens puts the artboard corners on the disc", async ({
    page,
  }) => {
    await createBlankTheme(page);
    await chooseDisplay(page, "Circle");

    const screen = page.locator(SCREEN);
    await expect(screen, "the screen is a disc").toHaveCSS(
      "border-radius",
      "50%",
    );
    // The disc is the screen element's **rendered** box, and the board is the
    // canvas' own painted extent: two independently-measured drawings, not two
    // reads of one camera transform that a wrong fit would move together.
    const disc = await boxOf(page, SCREEN);
    expect(disc.width, "the disc's box is square").toBeCloseTo(disc.height, 1);
    const board = await canvasInkBox(page);

    const centre = { x: disc.x + disc.width / 2, y: disc.y + disc.height / 2 };
    const radius = disc.width / 2;
    for (const corner of corners(board)) {
      const distance = Math.hypot(corner.x - centre.x, corner.y - centre.y);
      // 1px: the ink box is quantised to the canvas' backing-store pixels, and
      // the plate's antialiased edge adds up to one more.
      expect(
        Math.abs(distance - radius),
        "each board corner sits on the disc",
      ).toBeLessThanOrEqual(1);
    }
  });

  test("a circle lens clips the media to its disc, and a rect lens clears it", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await createBlankTheme(page);
    await openAssets(page);
    await importBackground(page, solidPng("red.png", RED_PNG));
    await fillDisplayBounds(page);
    await chooseDisplay(page, "Circle");

    const screen = page.locator(SCREEN);
    const media = page.locator(MEDIA);
    await expect(screen, "the screen is a disc").toHaveCSS(
      "border-radius",
      "50%",
    );
    await expect(media, "and the media is clipped to the same disc").toHaveCSS(
      "border-radius",
      "50%",
    );

    const box = await boxOf(page, SCREEN);
    const centre = await pixelAt(
      page,
      box.x + box.width / 2,
      box.y + box.height / 2,
    );
    expect(isColour(centre, [255, 0, 0]), "the centre is the picture").toBe(
      true,
    );
    const corner = await pixelAt(page, box.x + 6, box.y + 6);
    expect(
      isColour(corner, [255, 0, 0]),
      "the square's corner is outside the disc, so it is not the picture",
    ).toBe(false);

    await chooseDisplay(page, "4:3");
    await expect(screen, "a rect lens clears the screen's radius").toHaveCSS(
      "border-radius",
      "0px",
    );
    await expect(media, "and the layer's").toHaveCSS("border-radius", "0px");
    const rect = await boxOf(page, SCREEN);
    const rectCorner = await pixelAt(page, rect.x + 6, rect.y + 6);
    expect(
      isColour(rectCorner, [255, 0, 0]),
      "the layer fills the whole rect again",
    ).toBe(true);
  });

  test("a display-bounded background paints the letterbox before and after a remount", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    // A blank theme's paint is the letterbox colour, so a picture on top of it
    // is distinguishable by pixel rather than by stacking order alone.
    await createBlankTheme(page);
    await openAssets(page);
    await importBackground(page, solidPng("red.png", RED_PNG));
    await fillDisplayBounds(page);
    await chooseDisplay(page, "4:3");

    const layerOrder = await page.evaluate(() => ({
      isolation: getComputedStyle(
        document.querySelector(".editor-shell-stage") as Element,
      ).isolation,
      screen: getComputedStyle(
        document.querySelector("[data-yunari-display-screen]") as Element,
      ).zIndex,
    }));
    expect(layerOrder.isolation, "the stage owns the stacking context").toBe(
      "isolate",
    );
    expect(
      layerOrder.screen,
      "the screen paints beneath every stage child",
    ).toBe("-1");

    const letterboxPaint = await page
      .locator(SCREEN)
      .evaluate((node) => getComputedStyle(node).backgroundColor);

    /** One read: the media box is the screen's, and a pixel in the top bar —
     *  the letterbox, above the artboard — is the picture rather than the
     *  screen's own paint. */
    const expectPictureInTheLetterbox = async (
      want: readonly [number, number, number],
      step: string,
    ): Promise<void> => {
      const m = await measure(page);
      const screenBox = await boxOf(page, SCREEN);
      const mediaBox = await boxOf(page, MEDIA);
      expect(mediaBox.x, `the media box's left ${step}`).toBeCloseTo(
        screenBox.x,
        0,
      );
      expect(mediaBox.y, `the media box's top ${step}`).toBeCloseTo(
        screenBox.y,
        0,
      );
      expect(mediaBox.width, `the media box's width ${step}`).toBeCloseTo(
        screenBox.width,
        0,
      );
      expect(mediaBox.height, `the media box's height ${step}`).toBeCloseTo(
        screenBox.height,
        0,
      );

      // The top bar: between the screen's top and the artboard's, at the
      // display's horizontal centre.
      const spot = {
        x: m.stage.x + m.screen.left + m.screen.width / 2,
        y: m.stage.y + (m.screen.top + m.board.top) / 2,
      };
      expect(
        spot.y,
        `${step}: the artboard leaves a bar under 4:3`,
      ).toBeLessThan(m.stage.y + m.board.top);
      await expect
        .poll(async () => isColour(await pixelAt(page, spot.x, spot.y), want), {
          message: `${step}: the picture is the pixel, not the letterbox`,
        })
        .toBe(true);
      const paint = letterboxPaint.replace(/[^\d,]/g, "").split(",");
      expect(
        [Number(paint[0]), Number(paint[1]), Number(paint[2])],
        `${step}: the screen's paint is a different colour from the picture`,
      ).not.toEqual([...want]);
    };

    await expectPictureInTheLetterbox([255, 0, 0], "before the remount");

    // A different asset is a `setBackgroundMedia` remount, not a repaint. The
    // layer is torn down and mounted again, which is exactly when a placement
    // or a z-order can be lost.
    await importBackground(page, solidPng("blue.png", BLUE_PNG));
    await expectPictureInTheLetterbox([0, 0, 255], "after the remount");
  });

  test("the screen's colour is the artboard plate's paint under a mismatched lens", async ({
    page,
  }) => {
    await createBlankTheme(page);
    await chooseDisplay(page, "1:1");
    const m = await measure(page);
    expect(aspect(m.screen), "the lens is square").toBeCloseTo(1, 2);
    expect(
      aspect(m.board),
      "and the board is not, so the bars are the letterbox",
    ).toBeCloseTo(16 / 9, 2);

    const paint = await page.evaluate(() => {
      const bridge = (window as unknown as { yunariEditorBridge: Bridge })
        .yunariEditorBridge;
      const plate = (bridge.editor.canvas as { backgroundImage?: unknown })
        .backgroundImage as { fill?: unknown } | undefined;
      const screen = document.querySelector(
        "[data-yunari-display-screen]",
      ) as Element;
      if (plate === undefined || plate === null)
        throw new Error("the blank theme drew no artboard plate");
      // The plate's **painted** colour, not a token read a second time: the
      // probe normalises whatever Fabric holds into the same computed form the
      // screen reports. A non-string fill is a failure, not an empty colour
      // compared against an empty one: a silently skipped read would let a
      // black plate pass against a black screen.
      const fill = plate.fill;
      if (typeof fill !== "string" || fill.length === 0)
        throw new Error(
          `the artboard plate's fill is not a plain colour: ${String(fill)}`,
        );
      const probe = document.createElement("span");
      probe.style.color = fill;
      document.body.append(probe);
      const normalized = getComputedStyle(probe).color;
      probe.remove();
      return {
        normalized,
        computed: getComputedStyle(screen).backgroundColor,
      };
    });

    expect(paint.normalized, "the plate paints a flat colour").not.toBe("");
    expect(
      paint.computed,
      "the letterbox is the plate's paint, not a second copy of the token",
    ).toBe(paint.normalized);
  });
});
