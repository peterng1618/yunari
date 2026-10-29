import { expect, type Locator, type Page, test } from "@playwright/test";
import { isDesktopSurface } from "./surface.js";

/**
 * The canvas context menu in a window too short to hold it.
 *
 * It carries the Add pane's whole list — 21 entries in four groups — and that
 * does not fit a short window, and it had no scroll: the entries below the fold
 * were simply gone, with no scrollbar and no keyboard route to them. The editor
 * is desktop-only, but a desktop window can still be short, and the menu is the
 * one surface that has to work at whatever height the author dragged the window
 * to.
 *
 * Geometry, not a class name: the claim is that the last entry can be *reached*,
 * and only a rendered popup answers that. Nothing here writes scene state — the
 * point is found and clicked through the product's own right-click.
 */

const EDITOR = "http://127.0.0.1:4174/";

/**
 * The menu is 470px, so it cannot fit this window however it is placed.
 *
 * A viewport rather than a window height: Playwright sizes the page, and 420px
 * of it is short enough to clip a 470px menu while still being a window a person
 * could have.
 */
const SHORT_WINDOW = { width: 1280, height: 420 };

/**
 * A client point on the upper canvas that holds no object and is not under the
 * floating dock, so a right-click there opens the creation menu rather than an
 * object's own.
 *
 * Read off the product's two own answers rather than a fixed coordinate: Fabric
 * says whether an object is under the pointer and `elementFromPoint` says
 * whether the dock is. A hard-coded point would pass or fail on the starter's
 * layout instead of on the menu, and would go on doing so after the layout
 * changed. Lowest point first, because the lower the click the less room is left
 * below it — the case that clips.
 */
async function emptyCanvasPoint(page: Page): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      "#yunari-fabric-editor canvas.upper-canvas",
    );
    if (canvas === null) throw new Error("The editor's upper canvas is gone.");
    const rect = canvas.getBoundingClientRect();
    // Called as a method: Fabric's `findTarget` reads `this`, and a detached
    // reference would throw on the first point rather than answer.
    const editorCanvas = (
      window as unknown as {
        yunariEditorBridge: {
          editor: {
            canvas: { findTarget(event: unknown): { target?: unknown } };
          };
        };
      }
    ).yunariEditorBridge.editor.canvas;
    for (let fy = 0.95; fy > 0.02; fy -= 0.02) {
      for (let fx = 0.9; fx > 0.02; fx -= 0.02) {
        // Rounded *before* it is tested, and tested at the rounded point: the
        // browser rounds a click's `clientX`/`clientY` to integers, so a
        // fraction returned here is not the point the click lands on — and the
        // miss can be onto an object, whose own menu opens at the same place.
        const x = Math.round(rect.left + rect.width * fx);
        const y = Math.round(rect.top + rect.height * fy);
        if (document.elementFromPoint(x, y) !== canvas) continue;
        if (
          editorCanvas.findTarget({ clientX: x, clientY: y }).target !==
          undefined
        )
          continue;
        return { x, y };
      }
    }
    return null;
  });
  if (point === null)
    throw new Error(
      "No empty canvas point to right-click: the starter covers it.",
    );
  return point;
}

/**
 * A window with the room the anchoring case needs.
 *
 * The menu is 745px tall in this build, so a pointer in the canvas's own top
 * band leaves the whole popup inside a 1000px window and Base UI has no reason
 * to shift or flip it. A shorter window is the *other* case's subject.
 */
const TALL_WINDOW = { width: 1280, height: 1000 };

/**
 * The canvas's top band, as a fraction of its height: high enough that the menu
 * has room below it, tall enough to hold the empty point the case clicks.
 */
const TOP_BAND = 0.15;

/**
 * Tolerances for "the menu landed at the pointer".
 *
 * Both are measured, not chosen: three clicks at different x put the popup's
 * left edge 1.4–1.8px right of the click and its top a constant 5.64px above it
 * (2026-10-12, `chromium`, 1280×1000), which is the popup's own edge rather than
 * a position the pointer did not choose. The bounds admit that rounding; the
 * failures they are here to catch are hundreds of pixels wide — a popup at the
 * window's corner reads left ≈ 0, and one anchored to the canvas or to a trigger
 * does not move between two clicks at all.
 */
const ANCHOR_X_PX = 2;
const ANCHOR_Y_PX = 8;

/**
 * The first empty point scanning from the **top** of the canvas, at or right of
 * `minX` (a client x, so two calls can take two different columns).
 *
 * The anchoring case needs room *below* the pointer: the menu is 745px tall in
 * this build, so a click low in the canvas makes Base UI shift the popup up to
 * fit — correct behaviour, and the opposite of what that case measures. The
 * clipping case above wants the lowest point; this one wants the highest.
 */
async function emptyCanvasPointHigh(
  page: Page,
  minX: number,
): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(
    ([minimumX, topBand]) => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        "#yunari-fabric-editor canvas.upper-canvas",
      );
      if (canvas === null)
        throw new Error("The editor's upper canvas is gone.");
      const rect = canvas.getBoundingClientRect();
      const editorCanvas = (
        window as unknown as {
          yunariEditorBridge: {
            editor: {
              canvas: { findTarget(event: unknown): { target?: unknown } };
            };
          };
        }
      ).yunariEditorBridge.editor.canvas;
      for (let fy = 0.02; fy < topBand; fy += 0.02) {
        for (let fx = 0.02; fx < 0.95; fx += 0.02) {
          // Rounded before it is tested, for the reason `emptyCanvasPoint`
          // gives above: the tested point has to be the clicked one.
          const x = Math.round(rect.left + rect.width * fx);
          if (x < minimumX) continue;
          const y = Math.round(rect.top + rect.height * fy);
          if (document.elementFromPoint(x, y) !== canvas) continue;
          if (
            editorCanvas.findTarget({ clientX: x, clientY: y }).target !==
            undefined
          )
            continue;
          return { x, y };
        }
      }
      return null;
    },
    [minX, TOP_BAND] as const,
  );
  if (point === null)
    throw new Error(
      `No empty canvas point at or right of ${minX}: the starter covers the top.`,
    );
  return point;
}

/** The open canvas menu, with the geometry a clipped menu is missing. */
async function readMenu(page: Page): Promise<{
  readonly itemCount: number;
  readonly viewportHeight: number;
  readonly popupLeft: number;
  readonly popupTop: number;
  readonly popupBottom: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
  readonly scrollTop: number;
  readonly lastLabel: string;
  readonly lastTop: number;
  readonly lastBottom: number;
}> {
  return page.evaluate(() => {
    const popup = Array.from(
      document.querySelectorAll<HTMLElement>(".editor-shell-menu-popup"),
    ).find(
      (element) => element.getAttribute("aria-label") === "Canvas actions",
    );
    if (popup === undefined) throw new Error("The canvas menu did not open.");
    const items = Array.from(
      popup.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    );
    const last = items[items.length - 1];
    if (last === undefined)
      throw new Error("The canvas menu rendered no entries.");
    const rect = popup.getBoundingClientRect();
    const lastRect = last.getBoundingClientRect();
    return {
      itemCount: items.length,
      viewportHeight: window.innerHeight,
      popupLeft: rect.left,
      popupTop: rect.top,
      popupBottom: rect.bottom,
      clientHeight: popup.clientHeight,
      scrollHeight: popup.scrollHeight,
      scrollTop: popup.scrollTop,
      lastLabel: last.getAttribute("aria-label") ?? "",
      lastTop: lastRect.top,
      lastBottom: lastRect.bottom,
    };
  });
}

/**
 * A client point on the upper canvas that *holds* an object, so a right-click
 * there opens that object's own menu.
 *
 * Read off Fabric rather than a fixed coordinate, for the same reason as the
 * empty-point helper below: an object's position is the starter's, and a
 * hard-coded point would assert the starter's layout instead of the menu.
 *
 * **An interior point, on integer coordinates.** The scan steps in fractions of
 * the canvas, and the browser rounds a click's coordinates to integers: the
 * first point whose `findTarget` answers yes is the object's own edge, and a
 * 0.4px round put the pointer just outside it — the click then opened the
 * *creation* menu, and the case below read that as a menu with no `Copy` row
 * (measured 2026-10-15, `chromium` at DPR 1.25, point `410.4` → `410`). So a
 * candidate is taken only when Fabric answers for it and for its neighbours 3px
 * away, and the returned point is already rounded.
 */
async function objectPoint(page: Page): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      "#yunari-fabric-editor canvas.upper-canvas",
    );
    if (canvas === null) throw new Error("The editor's upper canvas is gone.");
    const rect = canvas.getBoundingClientRect();
    const editorCanvas = (
      window as unknown as {
        yunariEditorBridge: {
          editor: {
            canvas: { findTarget(event: unknown): { target?: unknown } };
          };
        };
      }
    ).yunariEditorBridge.editor.canvas;
    const overObject = (x: number, y: number): boolean =>
      editorCanvas.findTarget({ clientX: x, clientY: y }).target !== undefined;
    for (let fy = 0.05; fy < 0.95; fy += 0.01) {
      for (let fx = 0.05; fx < 0.95; fx += 0.01) {
        const x = Math.round(rect.left + rect.width * fx);
        const y = Math.round(rect.top + rect.height * fy);
        if (document.elementFromPoint(x, y) !== canvas) continue;
        if (
          overObject(x, y) &&
          overObject(x - 3, y) &&
          overObject(x + 3, y) &&
          overObject(x, y - 3) &&
          overObject(x, y + 3)
        )
          return { x, y };
      }
    }
    return null;
  });
  if (point === null)
    throw new Error(
      "No object on the canvas to right-click: the starter is empty.",
    );
  return point;
}

/** A row's own label with its chord chip taken out of the text. The Edit menu's
 *  rows carry no `aria-label`, and the chip is *inside* the row's text, so a
 *  naive `textContent` reads `DuplicateCtrl+D`. */
function readLabelWithoutChord(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  for (const chip of Array.from(clone.querySelectorAll("kbd"))) chip.remove();
  return clone.textContent ?? "";
}

/** Every row of one open popup, as `label → the chord it prints`. Read off the
 *  rendered menu, which is the only thing that says what a reader sees.
 *
 *  `allTextContents`, not `textContent`: a row the table binds nothing for has
 *  no chip at all, and `textContent` on a missing locator *waits for one* until
 *  the case times out instead of reading the absent chord this asks about. */
async function menuChords(popup: Locator): Promise<Record<string, string>> {
  const rows: Record<string, string> = {};
  for (const row of await popup.getByRole("menuitem").all()) {
    const label = (
      (await row.getAttribute("aria-label")) ??
      (await row.evaluate(readLabelWithoutChord))
    ).trim();
    rows[label] = (await row.locator("kbd").allTextContents())[0] ?? "";
  }
  return rows;
}

/**
 * Item 14 of the GUI defect list: the canvas context menu drew no chords, while
 * the Edit menu drew one on each of the four rows they share — so the surface a
 * reader meets first, with no menu bar to look at, named no key at all.
 *
 * Compared against the Edit menu *as the same build renders it*, rather than
 * against a chord spelled here: the claim is that the two surfaces read one
 * binding, and a literal would pass on a menu that restated the chord and could
 * not follow a rebind.
 */
test("an object's own menu prints the chords the Edit menu prints", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.setViewportSize(TALL_WINDOW);
  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();

  const point = await objectPoint(page);
  await page.mouse.click(point.x, point.y, { button: "right" });
  const objectWindow = page.getByRole("menu", { name: "Canvas actions" });
  await expect(objectWindow).toBeVisible();
  const objectMenu = await menuChords(objectWindow);
  await page.keyboard.press("Escape");
  await expect(objectWindow).toBeHidden();

  // The Edit menu, through the product's own trigger.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editMenu = await menuChords(
    page.locator('[role="menu"]:visible').first(),
  );
  await page.keyboard.press("Escape");

  const shared = Object.keys(objectMenu).filter((label) => label in editMenu);
  // The four rows the two surfaces share and the chord the defect was filed on.
  // Named rather than counted: an eligible set that carried no bound row would
  // make the loop below vacuous.
  for (const label of ["Copy", "Cut", "Duplicate", "Delete"]) {
    expect(shared, `the object menu has a ${label} row`).toContain(label);
    expect(
      objectMenu[label],
      `the object menu's ${label} prints the Edit menu's chord`,
    ).toBe(editMenu[label]);
    expect(objectMenu[label], `${label} prints a chord`).not.toBe("");
  }

  // And the whole intersection agrees, so a fifth shared row is covered too.
  for (const label of shared) {
    expect(objectMenu[label], `${label} across both menus`).toBe(
      editMenu[label],
    );
  }
});

test("the last entry is reachable in a window too short to hold the menu", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.setViewportSize(SHORT_WINDOW);
  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();

  const point = await emptyCanvasPoint(page);
  await page.mouse.click(point.x, point.y, { button: "right" });
  await expect(
    page.getByRole("menu", { name: "Canvas actions" }),
  ).toBeVisible();

  const opened = await readMenu(page);
  // The whole creation list, so this is the menu that overflows and not an
  // object's own short one. `emptyCanvasPoint` aimed for it; this confirms it.
  expect(opened.itemCount).toBeGreaterThan(10);

  // The claim. A menu taller than the room it was given must scroll rather than
  // run off the bottom, and what is below the fold has to be inside the popup's
  // own box once it has scrolled there.
  expect(
    opened.scrollHeight,
    "the menu is taller than the window and must scroll",
  ).toBeGreaterThan(opened.clientHeight);
  expect(
    opened.popupBottom,
    "the popup must stay inside the window it was opened in",
  ).toBeLessThanOrEqual(opened.viewportHeight);

  // **By the keyboard, which is the route a short window takes away.** With no
  // scroll the `End` key moved the active entry off the screen and left it there;
  // the last two families are the ones an author inserting a chart needs.
  await page.keyboard.press("End");
  // The active entry is scrolled into view by the menu's own key handling, so
  // the geometry settles on the next frame rather than immediately.
  await expect
    .poll(async () => (await readMenu(page)).lastBottom, { timeout: 5_000 })
    .toBeLessThanOrEqual(opened.viewportHeight);
  const reached = await readMenu(page);
  expect(
    reached.lastBottom,
    `${reached.lastLabel} is on screen`,
  ).toBeGreaterThan(0);
  expect(
    reached.scrollTop,
    "the menu scrolled to the last entry",
  ).toBeGreaterThan(0);

  // And it is a working entry rather than a reachable-looking one.
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu", { name: "Canvas actions" })).toBeHidden();
  const inserted = await page.evaluate(() => {
    const objects = (
      window as unknown as {
        yunariEditorBridge: {
          editor: { canvas: { getObjects(): unknown[] } };
        };
      }
    ).yunariEditorBridge.editor.canvas.getObjects();
    return objects.length;
  });
  expect(
    inserted,
    "Enter on the last entry inserted an object",
  ).toBeGreaterThan(0);
});

/**
 * The canvas menu is anchored to the **pointer**, and that is the behaviour the
 * library ruling rests on.
 *
 * The case above proves the menu scrolls and its last entry is reachable in a
 * window too short to hold it — all of which passes on a menu anchored to the
 * wrong corner, which is what `vg-195` recorded: `readMenu` returned `popupTop`
 * and no `expect` consumed it. Pinning the anchor in *that* window would pin the
 * flip rather than the anchor, because Base UI has to move a 745px menu in a
 * 420px window; this is the second case that row asked for, in a window with the
 * room to leave the popup where it was put.
 *
 * Two clicks, because "near the pointer" is not the claim — `Positioner` is
 * being handed a synthetic zero-size rect at the gesture, and a popup anchored
 * to the window's corner or to an element would satisfy no bound that says the
 * pointer chose it, while a popup in the right place would satisfy a bound on
 * either click alone. The second click is what makes the movement the subject.
 */
test("the menu lands where the pointer was, in a window with room to hold it", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.setViewportSize(TALL_WINDOW);
  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();

  const first = await emptyCanvasPointHigh(page, 0);
  const second = await emptyCanvasPointHigh(page, first.x + 200);

  /** Right-click `point`, read where the menu opened, then close it. */
  const openAt = async (point: { readonly x: number; readonly y: number }) => {
    await page.mouse.click(point.x, point.y, { button: "right" });
    await expect(
      page.getByRole("menu", { name: "Canvas actions" }),
    ).toBeVisible();
    const menu = await readMenu(page);
    // The window has the room, so the bounds below are about the library's own
    // rounding and not about a popup Base UI moved to fit.
    expect(
      menu.popupBottom,
      "the window holds the whole menu, unshifted",
    ).toBeLessThanOrEqual(menu.viewportHeight);
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("menu", { name: "Canvas actions" }),
    ).toBeHidden();
    return menu;
  };

  const firstMenu = await openAt(first);
  const secondMenu = await openAt(second);

  for (const [point, menu] of [
    [first, firstMenu],
    [second, secondMenu],
  ] as const) {
    expect(
      Math.abs(menu.popupLeft - point.x),
      "the menu's left edge is the pointer's x",
    ).toBeLessThanOrEqual(ANCHOR_X_PX);
    expect(
      Math.abs(menu.popupTop - point.y),
      "and its top edge is the pointer's y",
    ).toBeLessThanOrEqual(ANCHOR_Y_PX);
  }

  expect(
    Math.abs(secondMenu.popupLeft - firstMenu.popupLeft - (second.x - first.x)),
    "a second click further along moves the menu by the same distance",
  ).toBeLessThanOrEqual(ANCHOR_X_PX);
});
