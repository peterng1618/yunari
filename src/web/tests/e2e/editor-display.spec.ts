import { expect, test } from "@playwright/test";
import { lensBox } from "../../packages/editor/src/display-lens.js";
import { uiCopy } from "../../packages/editor/src/ui-copy.js";
import { chooseIn } from "./control-set.js";
import {
  addRatio,
  artboardPageBox,
  aspect,
  BLUE_PNG,
  type Bridge,
  boxOf,
  CHOOSER_DISPLAY,
  canvasInkBox,
  chooseDisplay,
  chooserSize,
  closeSettings,
  corners,
  createBlankTheme,
  displayMenuItems,
  EDITOR,
  fillDisplayBounds,
  freezeClock,
  importBackground,
  isColour,
  labelOffsets,
  MEDIA,
  measure,
  mediaGeometry,
  openAssets,
  openMenu,
  openNewDocument,
  openSettings,
  panCamera,
  pickPreview,
  pixelAt,
  RED_PNG,
  ratioRows,
  removeRatio,
  resetRatios,
  SCREEN,
  STARTER,
  solidPng,
  stageBackground,
} from "./editor-stage.js";
import { isDesktopSurface } from "./surface.js";

/**
 * The stage looks through a display, and the display is a lens.
 *
 * A framing claim, so it is measured in a real browser against built bundles
 * rather than inferred from the unit tests: every number below is read back
 * out of the running editor's own camera, through the product's own control.
 *
 * The load-bearing assertion is the *containment*: the artboard must sit
 * wholly inside the display's screen, at its own aspect, with pasteboard
 * showing either side. A lens that cropped to fill would produce a larger,
 * wrong-shaped artboard and pass every "is something drawn here" check —
 * which is why the bars are asserted as bars and not as emptiness.
 */

test.describe("the stage looks through a display", () => {
  test.beforeEach(async ({ page }) => {
    // Before the navigation: see `freezeClock`.
    await freezeClock(page);
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

  test("opens on the display the starter is drawn in, framing it whole", async ({
    page,
  }) => {
    const m = await measure(page);

    // The starter is 1672 × 941 — 1.7768, which is 16:9. The default used to be
    // a 19.5:9 lens on the stated grounds that this was its shape; it is not,
    // and the mismatch cost ~287 px of a 1600 px stage on bars. The lens is now
    // the active catalogue's first landscape entry, which is 16:9 by default.
    expect(
      m.display,
      "the default display is the one the starter is drawn in",
    ).toBe("16:9");
    expect(
      aspect(m.screen),
      "and its screen carries that aspect, not the window's",
    ).toBeCloseTo(16 / 9, 2);
    expect(
      Math.abs(aspect(m.stage) - aspect(m.screen)),
      "so the screen is not the stage",
    ).toBeGreaterThan(0.05);

    // Containment, which is the whole claim. The artboard keeps its own
    // aspect...
    expect(
      aspect(m.board),
      "the artboard is presented at its own aspect, not the screen's",
    ).toBeCloseTo(STARTER.width / STARTER.height, 3);
    // ...and sits wholly inside the screen rather than being cropped to fill.
    expect(
      m.board.left,
      "pasteboard on the left of the artboard",
    ).toBeGreaterThan(m.screen.left - 0.5);
    expect(m.board.left + m.board.width, "and on the right").toBeLessThan(
      m.screen.left + m.screen.width + 0.5,
    );

    // It is the artboard and nothing larger that the camera holds: at the
    // device framing the whole board fits, which a cropped preview would not.
    expect(
      m.board.height,
      "the board's height in screen px",
    ).toBeLessThanOrEqual(m.screen.height + 0.5);
    // The frame the author actually sees, in the DOM, not only in the camera's
    // own arithmetic. A frame that is not drawn is not a frame.
    expect(
      await page.evaluate(() => {
        const frame = document.querySelector<HTMLElement>(
          "[data-yunari-display-screen]",
        );
        if (frame === null || frame.hidden) return undefined;
        return (
          Number.parseFloat(frame.style.width) /
          Number.parseFloat(frame.style.height)
        );
      }),
      "the drawn frame carries the same aspect as the camera's",
    ).toBeCloseTo(16 / 9, 2);
  });

  test("frames a new theme through the display the author asked for", async ({
    page,
  }) => {
    // **The answer to the first question is read, not written and dropped.**
    // Before, `New` derived the artboard from the chosen display and then
    // mounted without ever calling `showDisplay`, so a portrait artboard opened
    // inside a landscape frame — the only place this branch removed a freedom
    // rather than a step.
    //
    // Asserted on the **stage frame**, not on a call having been made. A spy
    // proves the mechanism ran; this proves the author sees what they chose.
    await page.keyboard.press("Control+n");
    const chooser = page.locator('[role="dialog"]');
    await expect(chooser).toBeVisible();
    await chooseIn(page, CHOOSER_DISPLAY, "9:19.5");
    await chooser.locator("[data-yunari-new-document-create]").click();
    // New asks in two steps, chooser first. **The second is answered only if it
    // comes**: a `New` mounts a fresh session whose baseline is the document it
    // just made, so a fresh editor is not dirty and nothing prompts. Measured on
    // one: zero `[role="dialog"]` after Create.
    const prompt = page.locator('[role="dialog"]');
    await prompt
      .waitFor({ state: "visible", timeout: 3_000 })
      .then(() =>
        prompt.getByRole("button", { name: "Discard", exact: true }).click(),
      )
      .catch(() => undefined);
    await expect(page.locator("#status-message")).toHaveText("New theme");

    const after = await measure(page);

    // **The frame first, and the drawn one.** Disabling the `showDisplay` call
    // has to fail here rather than on an assertion about a call having been
    // made: the camera's own `display()` reporting the old lens would be a
    // mechanism reading, and a lens that reports correctly while the stage is
    // framed wrongly is the defect this test exists to catch.
    expect(
      await page.evaluate(() => {
        const frame = document.querySelector<HTMLElement>(
          "[data-yunari-display-screen]",
        );
        if (frame === null || frame.hidden) return undefined;
        return {
          aspect:
            Number.parseFloat(frame.style.width) /
            Number.parseFloat(frame.style.height),
          width: Number.parseFloat(frame.style.width),
        };
      }),
      "the frame drawn on the stage carries the chosen display's aspect",
    ).toMatchObject({ aspect: expect.closeTo(1 / (19.5 / 9), 2) });
    expect(
      aspect(after.screen),
      "and the camera's own screen rect agrees with it",
    ).toBeCloseTo(1 / (19.5 / 9), 2);
    expect(
      after.display,
      "the camera reports the display that was chosen",
    ).toBe("9:19.5");
    // **The preview no longer rewrites the size.** The board is the nearest
    // preset to the document it replaced — 16:9 at 1080p — seen through the
    // portrait lens the author picked, so it leaves bars rather than filling
    // the frame. Containment is "not cropped, not spilling"; the size is the
    // technical controls' answer, and this is the browser proof that picking a
    // preview did not move it.
    expect(
      aspect(after.board),
      "the artboard is still the landscape shape it opened on",
    ).toBeCloseTo(16 / 9, 2);
    expect(after.board.left, "not cropped at the left").toBeGreaterThanOrEqual(
      after.screen.left - 1,
    );
    expect(
      after.board.left + after.board.width,
      "or spilling at the right",
    ).toBeLessThanOrEqual(after.screen.left + after.screen.width + 1);
    expect(after.board.top, "or top").toBeGreaterThanOrEqual(
      after.screen.top - 1,
    );
    expect(
      after.board.top + after.board.height,
      "or bottom",
    ).toBeLessThanOrEqual(after.screen.top + after.screen.height + 1);

    // The document is unchanged by the choice (§67, Review Focus 4), read
    // through the same comparison the lens tests use: the scene before the New
    // was the starter's, and this document is blank — so what is compared here
    // is that framing it did not add anything to it.
    expect(
      await page.evaluate(() => {
        const artboard = (
          window as unknown as {
            yunariEditorBridge: {
              editor: { artboard(): { width: number; height: number } };
            };
          }
        ).yunariEditorBridge.editor.artboard();
        // The dimensions only: the artboard also carries its background and
        // bar colours, and this is about the size the answer carried.
        return { width: artboard.width, height: artboard.height };
      }),
      "the artboard is the size the chooser answered, untouched by the preview",
    ).toEqual({ width: 1920, height: 1080 });
  });

  test("the artboard's authored dimensions are untouched by the choice", async ({
    page,
  }) => {
    // The size only, not the whole artboard: the starter's carries a background,
    // bars and a media reference, so a whole-object comparison would report a
    // difference in any of those rather than in the dimensions this is about.
    const read = () =>
      page.evaluate(() => {
        const artboard = (
          window as unknown as { yunariEditorBridge: Bridge }
        ).yunariEditorBridge.editor.artboard();
        return { width: artboard.width, height: artboard.height };
      });

    expect(await read(), "the starter is 16:9 to begin with").toEqual(STARTER);

    for (const name of ["9:19.5", "16:9", "Fit"]) {
      // Every entry is a radio: Fit is "no display" and the three lenses are
      // displays, so they are one fact with four values, not two controls.
      await page.locator("[data-yunari-zoom]").click();
      await page.getByRole("menuitemradio", { name }).click();
      // The lens frames what the author wrote; it never rewrites it (§57).
      expect(await read(), `after choosing ${name}`).toEqual(STARTER);
    }
  });

  test("each display frames the board to its own shape, and Fit restores the window", async ({
    page,
  }) => {
    const seen: { readonly name: string; readonly aspect: number }[] = [];

    for (const [name, want] of [
      ["16:9", 16 / 9],
      ["19.5:9", 19.5 / 9],
      ["4:3", 4 / 3],
      ["9:16", 1 / (16 / 9)],
      ["9:19.5", 1 / (19.5 / 9)],
      ["3:4", 1 / (4 / 3)],
    ] as const) {
      await chooseDisplay(page, name);
      const m = await measure(page);
      expect(aspect(m.screen), `${name}'s screen aspect`).toBeCloseTo(want, 2);
      // The board is never cropped to suit the screen it is being shown on.
      expect(
        aspect(m.board),
        `${name} still shows the board whole`,
      ).toBeCloseTo(STARTER.width / STARTER.height, 3);
      seen.push({ name, aspect: aspect(m.screen) });
    }

    // Six genuinely different framings, not one zoom relabelled six times.
    expect(new Set(seen.map((row) => row.aspect.toFixed(2))).size).toBe(6);

    await page.locator("[data-yunari-zoom]").click();
    await page.getByRole("menuitemradio", { name: "Fit" }).click();
    // Fit is one click away and is the whole window again — no screen drawn
    // around a display the author did not choose.
    expect(
      await page.evaluate(() =>
        (
          window as unknown as { yunariEditorBridge: Bridge }
        ).yunariEditorBridge.editor.viewport.displayScreenRect(),
      ),
      "Fit has no screen to draw",
    ).toBeUndefined();
    // The trigger reads the zoom whatever is chosen. That readout predates this
    // task and two browser specs pin it, so a display must not take it over —
    // and the default is a display, so it would have gone on open.
    expect(
      await page.locator("[data-yunari-zoom]").textContent(),
      "and the trigger still reads the camera's scale",
    ).toMatch(/^\d+%$/);
  });

  test("the previews are two labelled groups, and a portrait theme leads with portrait", async ({
    page,
  }) => {
    // The starter is landscape, so the landscape group leads — through the same
    // predicate that decides what a new document opens at. A switch to a
    // portrait document moves the leading group, which is the half of this
    // that cannot be satisfied by a fixed order in the source.
    const headings = async () =>
      page.evaluate(() =>
        [...document.querySelectorAll(".editor-shell-menu-label")]
          .map((label) => label.textContent)
          .filter((text): text is string => text !== null),
      );

    await openMenu(page);
    expect(
      await headings(),
      "the landscape starter leads with Landscape",
    ).toEqual(["Landscape", "Portrait"]);
    await page.keyboard.press("Escape");

    await page.keyboard.press("Control+n");
    const chooser = page.locator('[role="dialog"]');
    await expect(chooser).toBeVisible();
    // **The size is the technical controls' answer now.** Picking a preview no
    // longer turns the document portrait, so the orientation is chosen where it
    // lives; the lens is picked too, to prove the two answers coexist.
    await chooseIn(page, CHOOSER_DISPLAY, "9:19.5");
    await chooseIn(page, "[data-yunari-new-document-orientation]", "portrait");
    await chooser.locator("[data-yunari-new-document-create]").click();
    const prompt = page.locator('[role="dialog"]');
    await prompt
      .waitFor({ state: "visible", timeout: 3_000 })
      .then(() =>
        prompt.getByRole("button", { name: "Discard", exact: true }).click(),
      )
      .catch(() => undefined);
    await expect(page.locator("#status-message")).toHaveText("New theme");

    await openMenu(page);
    expect(
      await headings(),
      "a portrait document leads with Portrait, from the one predicate",
    ).toEqual(["Portrait", "Landscape"]);
  });

  test("the menu labels do not move when the tick moves between them", async ({
    page,
  }) => {
    // Measured, because the claim is a pixel one and the CSS that makes it is
    // dead unless Base UI actually keeps the indicator mounted: `keepMounted`
    // defaults to false, so without it the tick exists on the checked item
    // only and every other label sits a gutter-width to the left of it.
    //
    // Choosing a display moves *every* label, including the one the pointer is
    // travelling toward — which is the reason the gutter has to exist.
    await openMenu(page);
    const ticked = await labelOffsets(page);
    // Fit plus the eight previews the default catalogue derives; the two group
    // headings are not menu items and carry no label of their own.
    expect(Object.keys(ticked), "the menu offered its labels").toHaveLength(9);

    await page.getByRole("menuitemradio", { name: "16:9" }).click();
    await openMenu(page);
    const moved = await labelOffsets(page);

    for (const [name, before] of Object.entries(ticked)) {
      expect(
        Math.abs((moved[name] ?? Number.NaN) - before),
        `${name} kept its column when the tick moved to another row`,
      ).toBeLessThan(0.5);
    }

    // Control: the menu really did re-render with a different tick, or the
    // comparison above is measuring a menu that never changed.
    await expect(
      page.getByRole("menuitemradio", { name: "16:9" }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      page.getByRole("menuitemradio", { name: "Fit" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  test("100 % is not reported to the author as Fit", async ({ page }) => {
    // The control asserting a camera state that is not true. `reset` clears the
    // lens and parks the camera at 1:1, and a tick derived from the lens alone
    // then reads that as Fit — the whole stage framed, which it is not.
    await page.locator("[data-yunari-zoom]").click();
    await page.getByRole("menuitem", { name: "100 %" }).click();

    const camera = () =>
      page.evaluate(() => {
        const bridge = (
          window as unknown as {
            yunariEditorBridge: {
              editor: {
                viewport: {
                  zoom(): number;
                  isFitted(): boolean;
                  displayScreenRect(): unknown;
                };
              };
            };
          }
        ).yunariEditorBridge;
        return {
          zoom: bridge.editor.viewport.zoom(),
          fitted: bridge.editor.viewport.isFitted(),
          screen: bridge.editor.viewport.displayScreenRect() !== undefined,
        };
      });

    const after = await camera();
    expect(after.zoom, "the camera is at its own scale").toBe(1);
    expect(after.screen, "and there is no screen drawn around 1:1").toBe(false);
    expect(after.fitted, "which is not a fit").toBe(false);

    await openMenu(page);
    // Nothing ticked at all: the camera is at a framing this menu does not
    // offer, and the honest report of that is silence.
    await expect(
      page.getByRole("menuitemradio", { name: "Fit" }),
    ).toHaveAttribute("aria-checked", "false");

    // And the reverse shape: Fit chosen, then zoomed off it by hand.
    await page.getByRole("menuitemradio", { name: "Fit" }).click();
    await openMenu(page);
    await expect(
      page.getByRole("menuitemradio", { name: "Fit" }),
    ).toHaveAttribute("aria-checked", "true");
    await page.getByRole("menuitem", { name: "100 %" }).click();
    await openMenu(page);
    await expect(
      page.getByRole("menuitemradio", { name: "Fit" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  test("the zoom readout is §5's bare readout, and it is still the trigger", async ({
    page,
  }) => {
    // The vocabulary is closed and this is the entry the 2026-10-12 ruling added
    // rather than an exception to rule 1: a value display that opens a list.
    // What the shape has to hold is that it stays *bare* — no well, no chevron,
    // because §5 draws the chevron on a well and the readout has none — while
    // staying the control, which is what the click at the end says.
    const readout = page.locator("[data-yunari-zoom]");
    const shape = await readout.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        text: node.textContent?.trim() ?? "",
        background: style.backgroundColor,
        edges: [
          style.borderTopWidth,
          style.borderRightWidth,
          style.borderBottomWidth,
          style.borderLeftWidth,
        ],
        glyph: node.querySelector("svg") !== null,
        popup: node.getAttribute("aria-haspopup"),
      };
    });
    expect(shape.text, "the bare readout reports the value it means").toMatch(
      /^\d+%$/,
    );
    expect(shape.background, "and carries no well").toBe("rgba(0, 0, 0, 0)");
    expect(shape.edges, "and no edge").toEqual(["0px", "0px", "0px", "0px"]);
    expect(shape.glyph, "and no chevron").toBe(false);
    expect(shape.popup, "and it declares the list it opens").toBe("menu");

    // The half a computed style cannot state, and the reason this control is in
    // the vocabulary at all: it opens the list rather than only reporting.
    await readout.click();
    await expect(
      page.getByRole("menuitemradio", { name: "Fit" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("choosing a display changes the view and leaves the document alone", async ({
    page,
  }) => {
    // Read through the scene itself, so this compares the document rather than
    // a summary of it. Fabric JSON *is* the document (§134). The clock is
    // already frozen by `beforeEach`, which is what makes this a comparison of
    // the lens rather than of the readings.
    const scene = () =>
      page.evaluate(() => {
        const bridge = (
          window as unknown as {
            yunariEditorBridge: {
              editor: { canvas: { toObject(properties: string[]): unknown } };
            };
          }
        ).yunariEditorBridge;
        return JSON.stringify(
          bridge.editor.canvas.toObject([
            "id",
            "left",
            "top",
            "width",
            "height",
          ]),
        );
      });

    const before = await scene();
    expect(
      before.length,
      "the scene was not empty, so this proves nothing",
    ).toBeGreaterThan(200);

    for (const name of ["9:19.5", "16:9", "19.5:9"]) {
      await chooseDisplay(page, name);
      expect(await scene(), `the document after choosing ${name}`).toBe(before);
    }

    // And the view really did move — a control that changed nothing would leave
    // the scene equal too, so the comparison above needs this to mean anything.
    const fitted = await measure(page);
    await chooseDisplay(page, "9:19.5");
    const portrait = await measure(page);
    expect(
      Math.abs(portrait.board.width - fitted.board.width),
      "the camera really did re-frame",
    ).toBeGreaterThan(1);

    // Control: a comparison that cannot fail proves nothing. An authored move
    // *is* a document change, and it has to show up in the same comparison the
    // lens passed — otherwise "the scene was unchanged" could just mean the
    // scene is not being read.
    await page.evaluate(() => {
      const bridge = (
        window as unknown as {
          yunariEditorBridge: {
            editor: {
              canvas: {
                getObjects(): { set(values: Record<string, unknown>): void }[];
              };
            };
          };
        }
      ).yunariEditorBridge;
      const card = bridge.editor.canvas.getObjects()[0];
      card?.set({ left: 999 });
    });
    expect(await scene(), "a real edit does change it").not.toBe(before);
  });

  /** §7.7's "clusters cannot collide" and "desktop density has a proof, not a
   *  guessed minimum", asserted rather than measured once by hand. This is the
   *  change that made collision possible: before it the stage had one corner
   *  cluster and the view control sat at the bottom-right, so nothing could
   *  meet.
   *
   *  The long name goes in through the document's own field, so the chip is as
   *  wide as the product lets it get and a collision would have the room to
   *  happen. The point between the corners is read as well as the two boxes:
   *  two clusters that do not overlap can still be spanned by a transparent
   *  wrapper that eats the stage's own pan, which is the other half of §7.7. */
  test("the display cluster and the identity chip cannot collide on the stage", async ({
    page,
  }, testInfo) => {
    // **A desktop claim**: at phone width the open pane leaves an 86px stage,
    // narrower than the two clusters' own widths, so the row overflows before
    // any layout can keep them apart. That is the editor's desktop-only frame,
    // not a corner collision, and the desktop project asserts it.
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await page
      .locator('.editor-shell-rail button[aria-label="Document"]')
      .click();
    const field = page.locator("[data-yunari-theme-name]");
    await expect(field).toBeVisible();
    await field.fill(
      "System dashboard — living-room wall panel, bedside and hallway",
    );
    await field.blur();
    await expect(page.locator(".editor-shell-identity-name")).toHaveText(
      /living-room wall panel/,
    );

    const measureCorners = () =>
      page.evaluate(() => {
        const box = (selector: string) => {
          const node = document.querySelector(selector);
          if (node === null) throw new Error(`no ${selector}`);
          const r = node.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        };
        const chip = box(".editor-shell-identity");
        const cluster = box(".editor-shell-zoom");
        const stage = box(".editor-shell-stage");
        const hit = document.elementFromPoint(
          (chip.right + cluster.left) / 2,
          (chip.top + chip.bottom) / 2,
        );
        return {
          chip,
          cluster,
          stage,
          betweenTag: hit === null ? "nothing" : hit.tagName,
          betweenClass:
            hit !== null && typeof hit.className === "string"
              ? hit.className
              : "",
        };
      });

    const assertNoCollision = (
      measured: Awaited<ReturnType<typeof measureCorners>>,
    ) => {
      expect(
        measured.chip.right,
        "the identity chip stops before the view cluster",
      ).toBeLessThan(measured.cluster.left);
      expect(
        measured.stage.right - measured.cluster.right,
        "and the cluster clears the stage's edge by §7.5's inset",
      ).toBeGreaterThanOrEqual(14);
      expect(
        measured.betweenClass,
        "the band between the corners is not a wrapper's",
      ).not.toContain("editor-shell-stage-top");
      expect(
        measured.betweenTag,
        "it is the canvas that is there, so a drag in the band still pans",
      ).toBe("CANVAS");
    };

    assertNoCollision(await measureCorners());

    // The same contract at 200% browser zoom, which is a 640×360 CSS viewport
    // and the width at which the chip has least room: `min-width: 0` lets the
    // chip shrink below its own non-shrinkable children, so "Unsaved changes"
    // used to paint 18px past the chip's edge and into the cluster. The stage
    // also drops its inspector here, which is why the chip is measured again
    // rather than scaled from the reading above.
    await page.setViewportSize({ width: 640, height: 360 });
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            document
              .querySelector(".editor-shell-stage")
              ?.getBoundingClientRect().width ?? 0,
        ),
      )
      .toBeLessThan(400);
    assertNoCollision(await measureCorners());
  });

  /** §5 rule 6, on the one glyph-only control this task adds: hover *acquires*
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

  test("settings add, remove and reset ratios", async ({ page }) => {
    await openSettings(page, uiCopy.settings.previews);
    await addRatio(page, "21:9");
    // `21:9` enters as `7:3`, whose portrait twin is `3:7`. One row, one token.
    expect(await ratioRows(page)).toContain("7:3");
    await closeSettings(page);
    const added = await displayMenuItems(page);
    expect(added).toContain("7:3");
    expect(added).toContain("3:7");

    await openSettings(page, uiCopy.settings.previews);
    await removeRatio(page, "7:3");
    expect(
      await ratioRows(page),
      "removing the row removes its token once",
    ).not.toContain("7:3");
    await addRatio(page, "21:9");
    await resetRatios(page);
    expect(await ratioRows(page)).toEqual([
      "16:9",
      "19.5:9",
      "4:3",
      "1:1",
      "Circle",
    ]);
    await closeSettings(page);

    const reset = await displayMenuItems(page);
    for (const label of [
      "16:9",
      "19.5:9",
      "4:3",
      "1:1",
      "Circle",
      "9:16",
      "9:19.5",
      "3:4",
    ]) {
      expect(reset).toContain(label);
    }
    expect(reset).not.toContain("7:3");
  });

  test("an empty catalogue leaves Fit as the only menu entry", async ({
    page,
  }) => {
    await openSettings(page, uiCopy.settings.previews);
    await resetRatios(page);
    for (const row of await ratioRows(page)) await removeRatio(page, row);
    await closeSettings(page);

    expect(await displayMenuItems(page)).toEqual([uiCopy.display.fit]);
    await expect(
      page.locator(SCREEN),
      "there is no screen to draw around a display nobody offers",
    ).toBeHidden();
  });

  test("the chooser does not resize when a preview is picked", async ({
    page,
  }) => {
    const size = await openNewDocument(page);
    await pickPreview(page, "19.5:9");
    expect(await chooserSize(page)).toBe(size);
    await page.keyboard.press("Escape");
  });
});
