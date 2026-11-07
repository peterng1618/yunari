import { expect, test } from "@playwright/test";
import { uiCopy } from "../../packages/editor/src/ui-copy.js";
import { chooseIn } from "./control-set.js";
import { openDisplayStage } from "./editor-display-entry.js";
import {
  aspect,
  type Bridge,
  chooseDisplay,
  labelOffsets,
  measure,
  openMenu,
  openNewDocument,
  SCREEN,
  STARTER,
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
 *
 * The lens's own drawing — the guide frame, the circle clip and the letterbox
 * paint — is `editor-display-lens.spec.ts`; the catalogue the menu offers is
 * `editor-display-settings.spec.ts`.
 */

test.describe("the stage looks through a display", () => {
  test.beforeEach(async ({ page }) => {
    await openDisplayStage(page);
  });

  test("opens on the display the starter is drawn in, framing it whole", async ({
    page,
  }) => {
    const m = await measure(page);

    // The starter is 1672 × 941 — 1.7768, which is 16:9. The default used to be
    // a 19.5:9 lens on the stated grounds that this was its shape; it is not,
    // and the mismatch cost ~287 px of a 1600 px stage on bars. The lens is now
    // the catalogue entry nearest the artboard's aspect, which is 16:9 here.
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

  test("opens fitted when the catalogue is empty", async ({ page }) => {
    // An empty list is a real author choice — every preview removed in Settings.
    // The camera must then be Fit: the whole board in the window, no display
    // frame drawn around a lens nobody can see.
    await page.addInitScript(() => {
      window.localStorage.setItem("yunari.editor.preview-ratios", "[]");
    });
    await openDisplayStage(page);

    const state = await page.evaluate(() => {
      const bridge = (window as unknown as { yunariEditorBridge: Bridge })
        .yunariEditorBridge;
      return {
        display: bridge.editor.viewport.display(),
        fitted: bridge.editor.viewport.isFitted(),
        screen: bridge.editor.viewport.displayScreenRect(),
      };
    });
    expect(state.display, "no lens to look through").toBeUndefined();
    expect(state.screen, "and no screen to draw").toBeUndefined();
    expect(state.fitted, "so the camera opens at Fit").toBe(true);
    await expect(
      page.locator(SCREEN),
      "the screen element is not drawn either",
    ).toBeHidden();
  });

  test("opens a new theme fitted to the lens nearest its artboard", async ({
    page,
  }) => {
    // #461: the chooser asks only how the document is measured. The camera
    // reads the artboard the answer creates, picks the catalogue's nearest
    // ratio and opens fitted — so a portrait artboard is framed portrait
    // without a second question.
    //
    // Asserted on the **stage frame**, not on a call having been made. A spy
    // proves the mechanism ran; this proves the author sees the fitted frame.
    await page.keyboard.press("Control+n");
    const chooser = page.locator('[role="dialog"]');
    await expect(chooser).toBeVisible();
    await chooseIn(page, "[data-yunari-new-document-orientation]", "portrait");
    await chooseIn(page, "[data-yunari-new-document-ratio]", "19.5:9");
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

    // **The frame first, and the drawn one.** The camera's own `display()`
    // reporting the right lens would be a mechanism reading; a lens that
    // reports correctly while the stage is framed wrongly is the defect this
    // test exists to catch.
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
      "the frame drawn on the stage carries the nearest lens's aspect",
    ).toMatchObject({ aspect: expect.closeTo(1 / (19.5 / 9), 2) });
    expect(
      aspect(after.screen),
      "and the camera's own screen rect agrees with it",
    ).toBeCloseTo(1 / (19.5 / 9), 2);
    expect(
      after.display,
      "the camera reports the lens nearest the answered artboard",
    ).toBe("9:19.5");
    expect(
      await page.evaluate(() =>
        (
          window as unknown as { yunariEditorBridge: Bridge }
        ).yunariEditorBridge.editor.viewport.isFitted(),
      ),
      "and the preview opens fitted rather than at raw identity",
    ).toBe(true);
    // **The preview no longer rewrites the size.** The board is exactly the
    // portrait artboard the chooser answered, seen through the lens nearest it,
    // so it fills the frame rather than leaving bars.
    expect(
      aspect(after.board),
      "the artboard is the portrait shape the chooser answered",
    ).toBeCloseTo(9 / 19.5, 2);
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

    // The artboard is the size the answer carried and nothing else — the lens
    // is derived from it, never written back into it.
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
    ).toEqual({ width: 1080, height: 2340 });
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

    for (const name of ["9:19.5", "16:9"]) {
      // The lenses are one radio group: each frames the same board differently.
      await page.locator("[data-yunari-zoom]").click();
      await page.getByRole("menuitemradio", { name }).click();
      // The lens frames what the author wrote; it never rewrites it (§57).
      expect(await read(), `after choosing ${name}`).toEqual(STARTER);
    }
    await page.locator("[data-yunari-zoom]").click();
    await page
      .getByRole("menuitem", { name: uiCopy.display.actualSize })
      .click();
    expect(await read(), "after Zoom to 100 %").toEqual(STARTER);
  });

  test("each display frames the board to its own shape, and 100 % restores the window", async ({
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

    await page.keyboard.press("Escape");
    await page.locator("[data-yunari-zoom]").click();
    await page
      .getByRole("menuitem", { name: uiCopy.display.actualSize })
      .click();
    // 100 % is one click away and is the whole window again — no screen drawn
    // around a display the author did not choose.
    expect(
      await page.evaluate(() =>
        (
          window as unknown as { yunariEditorBridge: Bridge }
        ).yunariEditorBridge.editor.viewport.displayScreenRect(),
      ),
      "100 % has no screen to draw",
    ).toBeUndefined();
    // The trigger reads the zoom whatever is chosen. That readout predates this
    // task and two browser specs pin it, so a display must not take it over —
    // and the default is a display, so it would have gone on open.
    expect(
      await page.locator("[data-yunari-zoom]").textContent(),
      "and the trigger still reads the camera's scale",
    ).toMatch(/^\d+%$/);
  });

  test("the previews are three labelled groups in a fixed order", async ({
    page,
  }) => {
    // The order is the catalogue's, not the document's: landscape widest
    // first, then 1:1 and Circle, then portrait near square first. A new
    // document must not reorder a menu the author is learning.
    const headings = async () =>
      page.evaluate(() =>
        [...document.querySelectorAll(".editor-shell-menu-label")]
          .map((label) => label.textContent)
          .filter((text): text is string => text !== null),
      );

    await openMenu(page);
    expect(await headings(), "the three groups, in order").toEqual([
      "Landscape",
      "1:1",
      "Portrait",
    ]);
    await page.keyboard.press("Escape");

    await page.keyboard.press("Control+n");
    const chooser = page.locator('[role="dialog"]');
    await expect(chooser).toBeVisible();
    // **The size is the technical controls' answer now.** The chooser no longer
    // asks for a lens: the camera reads the portrait artboard the answer
    // creates and frames it through the matching portrait lens.
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
      "a portrait document keeps the same order",
    ).toEqual(["Landscape", "1:1", "Portrait"]);
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
    // The eight previews the default catalogue derives; the two group
    // headings are not menu items and carry no label of their own.
    expect(Object.keys(ticked), "the menu offered its labels").toHaveLength(8);

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
      page.getByRole("menuitemradio", { name: "4:3" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  test("100 % is not reported to the author as a lens", async ({ page }) => {
    // The control asserting a framing that is not true. `reset` clears the lens
    // and parks the camera at 1:1; a tick derived from the lens alone would then
    // mark one the camera is not looking through.
    await page.locator("[data-yunari-zoom]").click();
    await page
      .getByRole("menuitem", { name: uiCopy.display.actualSize })
      .click();

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
      page.locator('[role="menuitemradio"][aria-checked="true"]'),
    ).toHaveCount(0);

    // And the reverse shape: a lens chosen, then cleared by 100 %.
    await page.getByRole("menuitemradio", { name: "16:9" }).click();
    await openMenu(page);
    await expect(
      page.getByRole("menuitemradio", { name: "16:9" }),
    ).toHaveAttribute("aria-checked", "true");
    await page
      .getByRole("menuitem", { name: uiCopy.display.actualSize })
      .click();
    await openMenu(page);
    await expect(
      page.locator('[role="menuitemradio"][aria-checked="true"]'),
    ).toHaveCount(0);
  });

  test("the zoom readout is the bare readout, and it is still the trigger", async ({
    page,
  }) => {
    // The vocabulary is closed and this is the entry the 2026-10-12 ruling added
    // rather than an exception to rule 1: a value display that opens a list.
    // What the shape has to hold is that it stays *bare* — no well, no chevron,
    // because the control set draws the chevron on a well and the readout has none — while
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
      page.getByRole("menuitem", { name: uiCopy.display.zoomToFit }),
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

  /** The "clusters cannot collide" and "desktop density has a proof, not a
   *  guessed minimum", asserted rather than measured once by hand. This is the
   *  change that made collision possible: before it the stage had one corner
   *  cluster and the view control sat at the bottom-right, so nothing could
   *  meet.
   *
   *  The long name goes in through the document's own field, so the chip is as
   *  wide as the product lets it get and a collision would have the room to
   *  happen. The point between the corners is read as well as the two boxes:
   *  two clusters that do not overlap can still be spanned by a transparent
   *  wrapper that eats the stage's own pan, which is the other half of the overflow rule. */
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
        "and the cluster clears the stage's edge by the inset",
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

  test("the chooser holds no preview control", async ({ page }) => {
    // #461: the lens is read off the artboard the answer creates, so the
    // chooser offers no display question at all. A control here would be the
    // second place a lens could be chosen, and the one that disagrees with the
    // document.
    await openNewDocument(page);
    expect(
      await page.locator("[data-yunari-new-document-display]").count(),
      "no display control in the chooser",
    ).toBe(0);
    expect(
      await page.locator("[data-yunari-new-document-ratio]").count(),
      "but the size controls are still there",
    ).toBe(1);
    await page.keyboard.press("Escape");
  });
});
