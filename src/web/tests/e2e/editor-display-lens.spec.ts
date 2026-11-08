import { expect, test } from "@playwright/test";
import { writeThemePackage } from "@yunari/theme-package";
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
  EDITOR,
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
import { openThemeFromStore, storedThemeOfPackage } from "./store-library.js";
import { isDesktopSurface } from "./surface.js";
import { withRoleTokens } from "./theme-fixture.js";

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

  test("the display screen's drawn box follows the camera through a zoom and a pan", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await chooseDisplay(page, "4:3");

    const read = async () => {
      const m = await measure(page);
      const box = await boxOf(page, SCREEN);
      return { m, box };
    };
    /** The element's own laid-out box against the camera's rect: two paths to
     *  one frame, not the camera's arithmetic twice. */
    const expectOnScreen = (
      reading: Awaited<ReturnType<typeof read>>,
      step: string,
    ): void => {
      expect(reading.m.screen.width / reading.m.screen.height).toBeCloseTo(
        4 / 3,
        2,
      );
      expect(reading.box.x, `the drawn screen's left ${step}`).toBeCloseTo(
        reading.m.stage.x + reading.m.screen.left,
        0,
      );
      expect(reading.box.y, `its top ${step}`).toBeCloseTo(
        reading.m.stage.y + reading.m.screen.top,
        0,
      );
      expect(reading.box.width, `its width ${step}`).toBeCloseTo(
        reading.m.screen.width,
        0,
      );
      expect(reading.box.height, `and its height ${step}`).toBeCloseTo(
        reading.m.screen.height,
        0,
      );
    };

    const fitted = await read();
    expectOnScreen(fitted, "at the fit");

    // Bare `=`, the camera's own zoom-in key.
    await page.keyboard.press("=");
    const zoomed = await read();
    expect(
      zoomed.m.screen.width,
      "the camera really did zoom, or the comparison below is vacuous",
    ).not.toBeCloseTo(fitted.m.screen.width, 3);
    expectOnScreen(zoomed, "after a zoom");

    await panCamera(page, 40, -20);
    const panned = await read();
    expect(
      panned.box.x - zoomed.box.x,
      "the drawn box follows the pan",
    ).toBeCloseTo(40, 1);
    expect(panned.box.y - zoomed.box.y).toBeCloseTo(-20, 1);
    expectOnScreen(panned, "after a 40/−20 pan");
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
    await page
      .getByRole("menuitem", { name: uiCopy.display.actualSize })
      .click();
    await expect(guide, "100 % clears the lens, so no guide").toBeHidden();
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
    const cornerPoint = { x: box.x + 6, y: box.y + 6 };
    const corner = await pixelAt(page, cornerPoint.x, cornerPoint.y);
    expect(
      isColour(corner, [255, 0, 0]),
      "the square's corner is outside the disc, so it is not the picture",
    ).toBe(false);
    // And it is the **stage**: hide the two clipped layers and read the same
    // pixel. A corner that is merely "not red" could be any third surface.
    const setLayerVisibility = (visibility: "hidden" | ""): Promise<void> =>
      page.evaluate((next) => {
        for (const selector of [
          "[data-yunari-display-screen]",
          "[data-yunari-background-media]",
        ]) {
          const node = document.querySelector<HTMLElement>(selector);
          if (node !== null) node.style.visibility = next;
        }
      }, visibility);
    await setLayerVisibility("hidden");
    const stageCorner = await pixelAt(page, cornerPoint.x, cornerPoint.y);
    await setLayerVisibility("");
    for (const [index, channel] of corner.slice(0, 3).entries()) {
      expect(
        Math.abs(channel - (stageCorner[index] ?? 0)),
        "the disc's corner is the stage the lens reveals",
      ).toBeLessThanOrEqual(2);
    }

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

  test("the letterbox continues the plate's gradient mapping", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    // A 4:3 board under a 19.5:9 lens leaves side bars, and a horizontal
    // gradient makes the board's edge and the bar meet on one axis.
    const envelope = withRoleTokens({
      schemaVersion: "3.0.0" as const,
      fabricVersion: "7.4.0" as const,
      id: "e2e-gradient-lens",
      metadata: { name: "Gradient lens", themeLanguage: "en" },
      artboard: { width: 1000, height: 750 },
      background: { color: { ref: "palette.background" as const } },
      globals: {
        palette: {
          none: {
            name: "None",
            value: { kind: "solid" as const, color: "transparent" },
          },
          background: {
            name: "Background",
            value: {
              kind: "gradient" as const,
              angle: 0,
              stops: [
                { offset: 0, color: "#000000" },
                { offset: 1, color: "#ffffff" },
              ],
            },
          },
        },
      },
      scene: { version: "7.4.0", objects: [] },
    });
    const fixture = writeThemePackage({ envelope, assets: {} });
    if (!fixture.ok) throw new Error(fixture.message);
    expect(fixture.ok).toBe(true);

    await page.goto(EDITOR);
    await openThemeFromStore(page, storedThemeOfPackage(fixture.bytes));
    await chooseDisplay(page, "19.5:9");

    const m = await measure(page);
    expect(m.board.left, "the board leaves a bar on each side").toBeGreaterThan(
      m.screen.left + 20,
    );
    const y = m.stage.y + m.screen.top + m.screen.height / 2;
    const boardLeft = m.stage.x + m.board.left;
    const boardRight = m.stage.x + m.board.left + m.board.width;

    // The plate's own ends, sampled inside the board.
    const plateLeft = await pixelAt(page, boardLeft + 6, y);
    const plateRight = await pixelAt(page, boardRight - 6, y);
    expect(isColour(plateLeft, [0, 0, 0], 8), "the plate starts black").toBe(
      true,
    );
    expect(isColour(plateRight, [255, 255, 255], 8), "and ends white").toBe(
      true,
    );

    // Just outside it, the bars must be the gradient **continued**: clamped to
    // the plate's first and last stops. A gradient restarted over the lens box
    // would read roughly 48 and 207 here instead.
    const leftBar = await pixelAt(page, boardLeft - 6, y);
    const rightBar = await pixelAt(page, boardRight + 6, y);
    expect(
      isColour(leftBar, [0, 0, 0], 8),
      "the left bar is the plate's first stop",
    ).toBe(true);
    expect(
      isColour(rightBar, [255, 255, 255], 8),
      "the right bar is the plate's last stop",
    ).toBe(true);
  });
});
