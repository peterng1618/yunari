import { expect, type Page, test } from "@playwright/test";
import { chooseIn } from "./control-set.js";
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

/** The editor preview every editor spec in this suite drives, named outright.
 *
 *  Relative (`"/"`) would resolve against `baseURL`, which is 4173 — the
 *  *player* — and the whole file would wait for `#yunari-fabric-editor` that
 *  is not there. That is what an exclusion list would have papered over
 *  instead: the spec would stay out of the default gate rather than join it. */
const EDITOR = "http://127.0.0.1:4174/";

/** The starter's artboard, as the theme declares it. */
const STARTER = { width: 1672, height: 941 } as const;

type Bridge = {
  editor: {
    artboard(): { readonly width: number; readonly height: number };
    viewport: {
      zoom(): number;
      display(): string | undefined;
      displayScreenRect():
        | {
            left: number;
            top: number;
            width: number;
            height: number;
          }
        | undefined;
      artboardScreenRect(): {
        left: number;
        top: number;
        width: number;
        height: number;
      };
    };
  };
};

type Measured = {
  readonly display: string | undefined;
  readonly screen: { left: number; top: number; width: number; height: number };
  readonly board: { left: number; top: number; width: number; height: number };
  /** The lower canvas' own box in page coordinates. */
  readonly stage: { x: number; y: number; width: number; height: number };
};

/** The camera's own geometry, plus the stage it is measured against. */
async function measure(page: Page): Promise<Measured> {
  return page.evaluate(() => {
    const bridge = (window as unknown as { yunariEditorBridge: Bridge })
      .yunariEditorBridge;
    const screen = bridge.editor.viewport.displayScreenRect();
    if (screen === undefined) {
      throw new Error(
        "no display screen: the stage is showing the bare window",
      );
    }
    const canvas = document.querySelector<HTMLCanvasElement>(
      "#yunari-fabric-editor canvas.lower-canvas",
    );
    if (canvas === null) throw new Error("no lower canvas in the editor");
    const box = canvas.getBoundingClientRect();
    return {
      display: bridge.editor.viewport.display(),
      screen,
      board: bridge.editor.viewport.artboardScreenRect(),
      stage: { x: box.x, y: box.y, width: box.width, height: box.height },
    };
  });
}

const aspect = (r: { width: number; height: number }): number =>
  r.width / r.height;

/** Pins `Date.now` for the page, so the starter's live readings stop moving.
 *
 *  The editor samples a waveform at wall-clock time, so two scene reads a
 *  second apart differ in the *text* of every card — measured here: `51%`
 *  became `64%` with nothing but time between them. Anything comparing a
 *  document across reads has to remove that, or it measures the clock.
 *
 *  `addInitScript` only reaches documents loaded *after* it is registered, so
 *  this is called before `goto` in `beforeEach` rather than inside the test
 *  that needs it — registering it later left the page already loaded, and the
 *  first version of this file failed on the very readings it was meant to
 *  remove. */
async function freezeClock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const fixed = 1_760_000_000_000;
    Date.now = () => fixed;
  });
}

/** Picks a display through the stage's own control, by its visible name. */
async function chooseDisplay(page: Page, name: string): Promise<void> {
  await page.locator("[data-yunari-zoom]").click();
  await page.getByRole("menuitemradio", { name }).click();
}

/** The chooser's display control, by the hook the control itself carries. It is
 *  a `ControlSelect` now, so the list is a Base UI popup rather than a native
 *  `<select>` — `chooseIn` scopes to the popup the trigger's own `aria-controls`
 *  names. **Not a bare `[data-yunari-option]` lookup**: the display list and
 *  the ratio list are both keyed by aspect ratio, so an unscoped `9:19.5`
 *  resolves to two rows once either has been opened. */
const CHOOSER_DISPLAY = "[data-yunari-new-document-display]";

/** Where each menu label sits, in page px, measured on the live menu.
 *
 *  The label is a text node inside the item, so it is measured through a
 *  `Range` rather than a bounding box of its own. */
async function labelOffsets(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const offsets: Record<string, number> = {};
    for (const item of document.querySelectorAll('[role="menuitemradio"]')) {
      const name = item.getAttribute("aria-label") ?? "";
      const label = [...item.childNodes].find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
      );
      if (label === undefined) continue;
      const range = document.createRange();
      range.selectNodeContents(label);
      offsets[name] = range.getBoundingClientRect().left;
    }
    return offsets;
  });
}

/** Opens the display menu on the trigger, leaving the current choice ticked. */
async function openMenu(page: Page): Promise<void> {
  await page.locator("[data-yunari-zoom]").click();
  await expect(page.getByRole("menu")).toBeVisible();
}

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
    // read out of the default artboard shape rather than typed beside it.
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
    // The artboard the answer derived: portrait, so the two agree.
    // The artboard the answer derived: portrait, so the two agree — and 19.5:9
    // portrait is *exactly* the lens's aspect, so a correctly framed board fills
    // this frame edge to edge. Containment here is "not cropped, not spilling",
    // not "leaves bars": the bars case is the 16:9 starter under a 19.5:9
    // lens, asserted in the display test above.
    expect(
      aspect(after.board),
      "a portrait artboard is presented at its own aspect",
    ).toBeCloseTo(1080 / 2340, 2);
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
        // bar colours, and this is about the shape the display derived.
        return { width: artboard.width, height: artboard.height };
      }),
      "the artboard is the size the display derives, not the stage's",
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
    await chooseIn(page, CHOOSER_DISPLAY, "9:19.5");
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
    // Fit plus six previews; the two group headings are not menu items and
    // carry no label of their own.
    expect(Object.keys(ticked), "the menu offered its labels").toHaveLength(7);

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
});
