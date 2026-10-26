import { expect, type Page, test } from "@playwright/test";
import { writeThemePackage } from "@yunari/theme-package";
import {
  clearSceneX,
  clientOfScene,
  objectHandleScenePoint,
  objectRect as sceneObjectRect,
  sceneToClient,
  worldLeftOf,
  worldRightOf,
} from "./editor-canvas.js";
import { SNAPPING_ACCENT } from "./snapping-fixture.js";
import { openThemeFromStore, storedThemeOfPackage } from "./store-library.js";
import { isDesktopSurface } from "./surface.js";

// Built editor E2E host, started by Playwright config.
const EDITOR = "http://127.0.0.1:4174/";
const ARTBOARD_WIDTH = 800;
/** Wider than `ARTBOARD_WIDTH`, because the part-level fixture puts two cards
 *  side by side with a third object between them. */
const NESTED_ARTBOARD = 1200;

type Kind = "shape" | "text" | "group";
type Rect = { left: number; top: number; width: number; height: number };

const kindTop: Record<Kind, number> = { shape: 70, text: 250, group: 430 };

function paint(): Record<string, unknown> {
  return {
    palette: {
      none: { name: "None", value: { kind: "solid", color: "transparent" } },
      accent: {
        name: "Accent",
        value: { kind: "solid", color: SNAPPING_ACCENT },
      },
    },
    typeTokens: {
      body: {
        name: "Body",
        value: { family: "Segoe UI, sans-serif", size: 32 },
      },
    },
  };
}

function rect(
  id: string,
  left: number,
  top: number,
  width = 80,
): Record<string, unknown> {
  return {
    type: "Rect",
    id,
    left,
    top,
    width,
    height: 80,
    fill: SNAPPING_ACCENT,
    yunariPaint: { fill: "palette.accent" },
    originX: "left",
    originY: "top",
  };
}

function source(
  kind: Kind,
  id: string,
  left: number,
  top: number,
): Record<string, unknown> {
  if (kind === "shape") return rect(id, left, top);
  if (kind === "text") {
    return {
      type: "Textbox",
      id,
      left,
      top,
      width: 80,
      text: "TEXT",
      fontSize: 32,
      fill: SNAPPING_ACCENT,
      yunariPaint: { fill: "palette.accent" },
      yunariText: {
        runs: [
          {
            kind: "literal",
            text: "TEXT",
            typeToken: "typeTokens.body",
            style: { color: { ref: "palette.accent" } },
          },
        ],
      },
      originX: "left",
      originY: "top",
    };
  }
  return {
    type: "Group",
    id,
    left,
    top,
    width: 80,
    height: 80,
    originX: "left",
    originY: "top",
    objects: [rect(`${id}-child`, 0, 0)],
  };
}

async function openFixture(
  page: Page,
  kind: Kind,
  mode = "single",
): Promise<void> {
  await page.goto(EDITOR);
  const top = kindTop[kind];
  const objects: Record<string, unknown>[] = [source(kind, "mover", 100, top)];
  if (mode === "spacing") {
    objects.push(
      source(kind, "left-source", 280, top),
      source(kind, "right-source", 520, top),
    );
  } else if (mode === "steps") {
    objects.push(source(kind, "first-source", 450, top));
  } else {
    objects.push(source(kind, "source", 500, top));
  }
  const result = writeThemePackage({
    envelope: {
      schemaVersion: "2.0.0",
      fabricVersion: "7.4.0",
      id: `snapping-${kind}-${mode}`,
      metadata: { themeLanguage: "en" },
      artboard: { width: ARTBOARD_WIDTH, height: 600 },
      globals: paint(),
      scene: { version: "7.4.0", objects },
    },
    assets: {},
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  await openThemeFromStore(page, storedThemeOfPackage(result.bytes));
}

/** The id of whatever the canvas currently has selected. */
async function activeObjectId(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const bridge = (
      window as unknown as {
        yunariEditorBridge: {
          editor: {
            canvas: {
              getActiveObject(): { get(name: string): unknown } | undefined;
            };
          };
        };
      }
    ).yunariEditorBridge;
    return bridge.editor.canvas.getActiveObject()?.get("id");
  });
}

async function expectActiveTarget(page: Page): Promise<void> {
  await expect.poll(() => activeObjectId(page)).toBe("mover");
}

async function objectRect(page: Page, id: string): Promise<Rect> {
  return page.evaluate((objectId) => {
    const editor = Object.entries(
      window as unknown as Record<string, unknown>,
    ).find(([key]) => key.startsWith("yunari-fabric-editor-"))?.[1] as
      | {
          canvas: {
            getObjects(): Array<{
              get(name: string): unknown;
              getBoundingRect(): Rect;
            }>;
          };
        }
      | undefined;
    const object = editor?.canvas
      .getObjects()
      .find((candidate) => candidate.get("id") === objectId);
    if (object === undefined) throw new Error(`no object with id ${objectId}`);
    return object.getBoundingRect();
  }, id);
}

/** Device rows along the vertical scene line `sceneX` that carry a guide
 * colour, over the artboard's height plus a column band (the line is ~1 device
 * px wide and dashed, so a single column misses it on a rounding). Counting
 * *rows* rather than pixels is what separates the two guide orientations: a
 * vertical guide paints the whole column band for the artboard's height, while
 * a horizontal guide the same gesture may legitimately publish crosses it for
 * only its own two or three rows. A pixel count cannot tell those apart. Reads
 * the rendered pixels because the applied guides are not exposed through the
 * bridge. The colour is `GUIDE_COLOR` (#3D8BF4). */
async function guideRowsAtSceneX(
  page: Page,
  sceneX: number,
  sceneWidth = ARTBOARD_WIDTH,
): Promise<number> {
  return page.evaluate(
    async ([x, sceneWidth]) => {
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const bridge = (
        window as unknown as {
          yunariEditorBridge: {
            editor: {
              viewport: {
                artboardScreenRect(): {
                  left: number;
                  top: number;
                  width: number;
                  height: number;
                };
              };
            };
          };
        }
      ).yunariEditorBridge;
      const rect = bridge.editor.viewport.artboardScreenRect();
      const canvas = document.querySelector<HTMLCanvasElement>(
        "#yunari-fabric-editor canvas.upper-canvas",
      );
      const context = canvas?.getContext("2d");
      if (
        canvas === null ||
        canvas === undefined ||
        context === null ||
        context === undefined
      )
        return -1;
      const ratio = canvas.width / canvas.getBoundingClientRect().width;
      const centre = (rect.left + x * (rect.width / sceneWidth)) * ratio;
      const top = Math.max(0, Math.round(rect.top * ratio));
      const height = Math.max(1, Math.round(rect.height * ratio));
      const band = Math.max(1, Math.round(4 * ratio));
      const width = Math.min(
        band * 2 + 1,
        canvas.width - Math.max(0, Math.round(centre) - band),
      );
      const data = context.getImageData(
        Math.max(0, Math.round(centre) - band),
        top,
        width,
        height,
      ).data;
      let rows = 0;
      for (let row = 0; row < height; row += 1) {
        for (let column = 0; column < width; column += 1) {
          const index = (row * width + column) * 4;
          if (
            (data[index + 3] ?? 0) > 0 &&
            Math.abs((data[index] ?? 0) - 61) <= 12 &&
            Math.abs((data[index + 1] ?? 0) - 139) <= 12 &&
            Math.abs((data[index + 2] ?? 0) - 244) <= 12
          ) {
            rows += 1;
            break;
          }
        }
      }
      return rows;
    },
    [sceneX, sceneWidth] as const,
  );
}

/** The fixture's artboard, in scene px. `guideRowsAtSceneX` samples the artboard's
 * live screen rect, so the rows it counts are this height **times the camera's
 * zoom times the device pixel ratio** — which is why both bounds below are
 * derived from it rather than written as row counts. */
const ARTBOARD_HEIGHT = 600;

/** Device rows a vertical guide must paint for this fixture to count as drawn.
 *
 * A guide spans the artboard's height, so at the present camera that is
 * `ARTBOARD_HEIGHT * zoom * dpr` device rows; a horizontal crossing covers a few
 * regardless, because it is one edge of the same shape. So the two are compared
 * as **fractions of the artboard's current device height**: a vertical guide
 * covers all of it and a crossing covers a sliver of it, and the ratio between
 * them holds at every zoom.
 *
 * The old literals — 50 and 20 — were floors on the camera in the same way
 * `RAW_TOLERANCE` was: at Fit's zoom a real guide covers hundreds of rows and
 * passes, and at the portrait lens's it covers fewer than 50 and fails with the
 * guide plainly drawn. Derived, the same assertion holds at both. */
const GUIDE_ROWS_PRESENT = 0.25;
/** Upper bound for "no vertical guide here": above a horizontal crossing's few
 * rows, far below a drawn one's. A fraction for the same reason. */
const GUIDE_ROWS_ABSENT = 0.08;

/** How many device rows the artboard is tall at the present camera. */
async function artboardDeviceRows(page: Page): Promise<number> {
  const zoom = await liveZoom(page);
  const dpr = await page.evaluate(() => window.devicePixelRatio ?? 1);
  return ARTBOARD_HEIGHT * zoom * dpr;
}

/** `SNAP_THRESHOLD`, restated because it is a *screen* distance and every
 * scene-space comparison in this file has to divide it by the zoom. Read from
 * `snap-manager/constants.ts` rather than invented; a test that restates it is
 * the thing that broke when the default camera changed. */
const SNAP_THRESHOLD_SCREEN_PX = 5;

/** Landing tolerance for a gesture that should have snapped onto a line, in scene
 * units at the present zoom.
 *
 * The old constant was a bare `1`, and it was a **screen** distance written as
 * though the scene were the screen — one client px is one scene px only at zoom
 * 1, so the bound only held at the zoom it was written for. This file uses it
 * in opposite directions, and both need it to travel with the camera: a snapped
 * gesture is `toBeLessThan` it, a Ctrl-refused one `toBeGreaterThan` it.
 *
 * **The two directions do not want the same number, and that is the whole
 * subtlety.** A refused snap lands where the gesture was aimed, 1.3–3.4 scene
 * units from the line at the default lens — so its bound has to sit under that,
 * which is about one client pixel of conversion drift. A landed snap is compared
 * with the same constant and needs it *above* the rounding, which `RAW_CLIENT_PX`
 * gives. Split into two names for the two claims rather than one number asked to
 * be both. */
async function snappedTolerance(page: Page): Promise<number> {
  return 1 / (await liveZoom(page));
}

/** The floor for "Ctrl refused this snap": under where a refused gesture lands,
 * over the half pixel a client-coordinate rounding leaves behind.
 *
 * `HALF_CLIENT_PX` rather than a full one, and deliberately smaller than
 * `snappedTolerance`'s 1/zoom at the default lens, because a refused snap lands
 * about a client pixel from where it was aimed — measured 1.28, 2.40 and 3.35
 * scene units across the three fixtures — so a bound above that stops being a
 * statement about Ctrl and becomes a statement about how far the fixture
 * happened to aim. */
async function refusedSnapTolerance(page: Page): Promise<number> {
  return HALF_CLIENT_PX / (await liveZoom(page));
}

/** Client-pixel drift a raw landing may carry: the pointer position Chromium
 * delivers, and the inverse conversion Fabric applies to it. */
const RAW_CLIENT_PX = 2;
/** Half that, which is all the rounding a single client coordinate leaves. The
 * floor a "nothing moved it" bound has to clear. */
const HALF_CLIENT_PX = 0.5;

/** The camera's zoom right now. Every scene distance below is measured against
 * it, because the two constants above are screen distances and the scene is
 * not: at zoom 0.78 the 5px threshold spans 6.4 scene units and at the
 * display lens's 0.48 it spans 10.4. */
async function liveZoom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const editor = (
      window as unknown as {
        yunariEditorBridge: {
          editor: {
            canvas: {
              getZoom?(): number;
              viewportTransform: readonly [
                number,
                number,
                number,
                number,
                number,
                number,
              ];
            };
          };
        };
      }
    ).yunariEditorBridge.editor;
    return editor.canvas.getZoom?.() ?? editor.canvas.viewportTransform[0];
  });
}

/** How far a gesture may land from the raw intent, in scene units at the
 * present zoom. A literal here is only true at one zoom — 3.5 was the answer
 * at Fit's 0.78, and the display lens's 0.48 wants 4.2. */
async function rawTolerance(page: Page): Promise<number> {
  return RAW_CLIENT_PX / (await liveZoom(page));
}

/** The acquire threshold in scene units: how far from a line a gesture has to
 * be for snapping not to reach it. */
async function snapAcquire(page: Page): Promise<number> {
  return SNAP_THRESHOLD_SCREEN_PX / (await liveZoom(page));
}

async function sceneTravel(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<number> {
  return page.evaluate(
    ([start, end]: readonly [
      { x: number; y: number },
      { x: number; y: number },
    ]) => {
      const canvas = (
        window as unknown as {
          yunariEditorBridge: {
            editor: {
              canvas: {
                getScenePoint(event: { clientX: number; clientY: number }): {
                  x: number;
                };
              };
            };
          };
        }
      ).yunariEditorBridge.editor.canvas;
      return (
        canvas.getScenePoint({ clientX: end.x, clientY: end.y }).x -
        canvas.getScenePoint({ clientX: start.x, clientY: start.y }).x
      );
    },
    [from, to] as const,
  );
}

async function moveTo(
  page: Page,
  rawLeft: number,
  options: { ctrl?: boolean; release?: boolean } = {},
): Promise<{ left: number; raw: number; guideRows: number }> {
  const before = await objectRect(page, "mover");
  const from = await clientOfScene(page, "mover", ARTBOARD_WIDTH);
  const target = await sceneToClient(
    page,
    ARTBOARD_WIDTH,
    rawLeft + before.width / 2,
    before.top + before.height / 2,
  );
  const travelled = await sceneTravel(page, from, target);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  if (options.ctrl) await page.keyboard.down("Control");
  await page.mouse.move(target.x, target.y, { steps: 12 });
  const left = (await objectRect(page, "mover")).left;
  const guideRows = await guideRowsAtSceneX(page, left);
  if (options.ctrl) await page.keyboard.up("Control");
  if (options.release !== false) await page.mouse.up();
  return { left, raw: before.left + travelled, guideRows };
}

/** Drags the mover's `br` corner horizontally so its right edge lands unsnapped
 * at `rawRight`, and reports that landing next to the edge it finished on.
 *
 * The corner is the one handle all three target kinds share as a *scale*
 * action: a Textbox's side handle changes `width` instead, which is a different
 * Fabric action the scale snapping path does not claim.
 *
 * Shift is held for the whole drag. The editor canvas keeps Fabric's
 * `uniformScaling` on, so a plain corner drag scales both axes at once: the
 * pointer has to travel twice as far as the edge does, and every vertical edge
 * candidate travels with it — at a right edge of 260 the bottom edge lands 2
 * units from the neighbour's bottom and a different edge takes the snap. Shift
 * is the mode toggle, so the drag becomes a free scale and the horizontal edge
 * is the only one that moves. `release: false` leaves Shift held with the
 * button, so a caller that continues the gesture owns releasing it. */
async function resizeTo(
  page: Page,
  rawRight: number,
  options: { ctrl?: boolean; release?: boolean } = {},
): Promise<{ right: number; raw: number; guideRows: number }> {
  const before = await objectRect(page, "mover");
  const select = await clientOfScene(page, "mover", ARTBOARD_WIDTH);
  await page.mouse.click(select.x, select.y);
  const corner = await objectHandleScenePoint(page, "mover", "br");
  const from = await sceneToClient(page, ARTBOARD_WIDTH, corner.x, corner.y);
  const target = await sceneToClient(page, ARTBOARD_WIDTH, rawRight, corner.y);
  const travelled = await sceneTravel(page, from, target);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.keyboard.down("Shift");
  if (options.ctrl) await page.keyboard.down("Control");
  await page.mouse.move(target.x, target.y, { steps: 12 });
  const rect = await objectRect(page, "mover");
  const right = rect.left + rect.width;
  const guideRows = await guideRowsAtSceneX(page, right);
  if (options.ctrl) await page.keyboard.up("Control");
  if (options.release !== false) {
    await page.mouse.up();
    await page.keyboard.up("Shift");
  }
  return { right, raw: before.left + before.width + travelled, guideRows };
}

async function moveSteps(
  page: Page,
  first: number,
  second: number,
): Promise<{ first: number; second: number; rows: number }> {
  const before = await objectRect(page, "mover");
  const from = await clientOfScene(page, "mover", ARTBOARD_WIDTH);
  const at = (left: number) =>
    sceneToClient(
      page,
      ARTBOARD_WIDTH,
      left + before.width / 2,
      before.top + before.height / 2,
    );
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const firstPoint = await at(first);
  await page.mouse.move(firstPoint.x, firstPoint.y, { steps: 8 });
  const firstLeft = (await objectRect(page, "mover")).left;
  const secondPoint = await at(second);
  await page.mouse.move(secondPoint.x, secondPoint.y);
  const secondLeft = (await objectRect(page, "mover")).left;
  const rows = await guideRowsAtSceneX(page, secondLeft);
  await page.mouse.up();
  return { first: firstLeft, second: secondLeft, rows };
}

async function resizeSteps(
  page: Page,
  first: number,
  second: number,
): Promise<{ first: number; second: number; rows: number }> {
  const centre = await clientOfScene(page, "mover", ARTBOARD_WIDTH);
  await page.mouse.click(centre.x, centre.y);
  const corner = await objectHandleScenePoint(page, "mover", "br");
  const from = await sceneToClient(page, ARTBOARD_WIDTH, corner.x, corner.y);
  const at = (right: number) =>
    sceneToClient(page, ARTBOARD_WIDTH, right, corner.y);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.keyboard.down("Shift");
  const firstPoint = await at(first);
  await page.mouse.move(firstPoint.x, firstPoint.y, { steps: 8 });
  const firstRect = await objectRect(page, "mover");
  const secondPoint = await at(second);
  await page.mouse.move(secondPoint.x, secondPoint.y);
  const secondRect = await objectRect(page, "mover");
  const rows = await guideRowsAtSceneX(
    page,
    secondRect.left + secondRect.width,
  );
  await page.mouse.up();
  await page.keyboard.up("Shift");
  return {
    first: firstRect.left + firstRect.width,
    second: secondRect.left + secondRect.width,
    rows,
  };
}

test("layer-panel object actions match canvas dock", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  await openFixture(page, "shape");
  const panel = page.locator('[data-yunari-panel="layers"]');
  const footer = panel.locator("[data-yunari-layer-actions]");
  const dock = page.locator("[data-yunari-canvas-toolbar]");
  await expect(panel).toBeVisible();
  await expect(footer).toBeVisible();
  await expect(dock).toBeVisible();

  // Nothing is selected yet, and the footer is a row anyway: the registry's own
  // commands, every one of them disabled (`vg-570`, ruled 2026-10-17). `vg-460`'s
  // ask was that the toolbar always be *visible*; the Add pane's constructions
  // built to answer it were never asked for, so what the no-selection footer
  // carries is the commands and no constructions. A footer that emptied itself
  // reddens on the count, and one that went back to the constructions reddens on
  // the comparison with the dock below.
  const idle = await footer.getByRole("button").evaluateAll((buttons) =>
    buttons.map((button) => ({
      label: button.getAttribute("aria-label") ?? "",
      disabled: (button as HTMLButtonElement).disabled,
      destructive: button.hasAttribute("data-yunari-destructive"),
      // The **paint**, not the attribute. `vg-226`'s failure class is the mark
      // present and the paint wrong, and it is invisible to a `disabled` read:
      // `[data-yunari-destructive]` is unlayered and outranks the `text-faint`
      // a blocked control computes, so a dead Delete painted `--hot` while the
      // other eleven painted `--faint`. Nothing but a computed colour sees it.
      colour: getComputedStyle(button).color,
    })),
  );
  console.log(`IDLE_FOOTER=${JSON.stringify(idle)}`);
  expect(idle.length).toBeGreaterThan(0);
  expect(idle.every((button) => button.disabled)).toBe(true);
  // Delete is in the row, so the comparison below is about the mark and not
  // about a footer that happened to draw no destructive action at all.
  expect(idle.some((button) => button.destructive)).toBe(true);
  expect(
    [...new Set(idle.map((button) => button.colour))],
    "a blocked control keeps the tone the control computed, whatever mark it " +
      "carries: one colour across the idle footer, and it is not Delete's --hot",
  ).toHaveLength(1);

  const centre = await clientOfScene(page, "mover", ARTBOARD_WIDTH);
  await page.mouse.click(centre.x, centre.y);
  await expectActiveTarget(page);
  expect(
    await footer.evaluate(
      (element) => element.closest("[data-yunari-layer]") === null,
    ),
  ).toBe(true);
  const panelBox = (await panel.boundingBox())!;
  const footerBox = (await footer.boundingBox())!;
  const treeBox = (await panel.getByRole("tree").boundingBox())!;
  const lastRowBox = (await panel.getByRole("treeitem").last().boundingBox())!;
  expect(footerBox.y).toBeGreaterThanOrEqual(treeBox.y + treeBox.height);
  expect(footerBox.y).toBeGreaterThanOrEqual(lastRowBox.y + lastRowBox.height);
  expect(footerBox.x).toBeGreaterThanOrEqual(panelBox.x);
  expect(footerBox.x + footerBox.width).toBeLessThanOrEqual(
    panelBox.x + panelBox.width,
  );
  expect(footerBox.y + footerBox.height).toBeLessThanOrEqual(
    panelBox.y + panelBox.height,
  );
  const entries = (buttons: Element[]) =>
    buttons.map((button) => button.getAttribute("aria-label") ?? "").sort();
  const footerEntries = await footer.getByRole("button").evaluateAll(entries);
  expect(footerEntries).not.toEqual([]);
  // With a selection the two surfaces are the same set: both render
  // `objectActionsFor`, the registry's own filter, and nothing else. `vg-463`
  // moved the eight arrange actions out of the toolbar and into the inspector, so
  // the command halves are comparable directly — and a construction appearing in
  // the footer again would put the Add pane's primitives on this side alone.
  expect(footerEntries).toEqual(
    await dock.locator("button").evaluateAll(entries),
  );
});

for (const kind of ["shape", "text", "group"] as const) {
  test.describe(`active ${kind}`, () => {
    test.beforeEach(async ({}, testInfo) => {
      test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    });

    for (const gesture of ["moving", "resizing"] as const) {
      const perform = gesture === "moving" ? moveTo : resizeTo;
      const steps = gesture === "moving" ? moveSteps : resizeSteps;
      const edge = (result: { left?: number; right?: number }) =>
        (gesture === "moving" ? result.left : result.right)!;

      test(`${gesture} geometry snaps to a guide`, async ({ page }) => {
        await openFixture(page, kind);
        const line = (await objectRect(page, "source")).left;
        const result = await perform(page, line - 2);
        await expectActiveTarget(page);
        expect(Math.abs(edge(result) - line)).toBeLessThan(
          await snappedTolerance(page),
        );
        expect(result.guideRows).toBeGreaterThan(
          GUIDE_ROWS_PRESENT * (await artboardDeviceRows(page)),
        );
      });

      test(`${gesture} hold re-plans every pointer step`, async ({ page }) => {
        await openFixture(page, kind, "steps");
        const line = (await objectRect(page, "first-source")).left;
        const width = (await objectRect(page, "mover")).width;
        const acquire = await snapAcquire(page);

        // **The first leg has to be clear of every candidate, and how much room
        // that takes is a function of the camera.** The threshold is 5 *screen*
        // pixels, so it spans 6.4 scene units at Fit's zoom and 10.4 at the
        // display lens's. The old first leg aimed 140 short of the line and
        // called that "nowhere near", but it put the mover's trailing edge
        // within 9 units of the artboard's centre line — clear at one zoom and
        // inside the threshold at the other, so the leg snapped and the raw
        // landing this test is about never happened. Every x in this window
        // keeps all three of the mover's edges at least `acquire` from every
        // candidate, and `clearSceneX` picks the roomiest of them.
        const clear = await clearSceneX(
          page,
          "mover",
          width + acquire,
          ARTBOARD_WIDTH / 2 - width - acquire,
          ARTBOARD_WIDTH,
        );
        expect(
          clear.distance,
          "the first leg is clear of every snap line at this zoom",
        ).toBeGreaterThan(acquire);

        // The second leg lands inside the threshold, so it must snap. Half the
        // threshold, rather than the 3 this used to name: 3 is inside the
        // threshold only while the threshold is wider than 6 scene units.
        const result = await steps(page, clear.x, line - acquire / 2);
        await expectActiveTarget(page);
        expect(Math.abs(result.first - clear.x)).toBeLessThan(
          await rawTolerance(page),
        );
        expect(Math.abs(result.second - line)).toBeLessThan(
          await snappedTolerance(page),
        );
        expect(result.rows).toBeGreaterThan(
          GUIDE_ROWS_PRESENT * (await artboardDeviceRows(page)),
        );
      });

      test(`${gesture} hold releases past the guide threshold`, async ({
        page,
      }) => {
        await openFixture(page, kind);
        const line = (await objectRect(page, "source")).left;
        const held = await perform(page, line - 2, { release: false });
        expect(Math.abs(edge(held) - line)).toBeLessThan(
          await snappedTolerance(page),
        );
        expect(held.guideRows).toBeGreaterThan(
          GUIDE_ROWS_PRESENT * (await artboardDeviceRows(page)),
        );
        const before = await objectRect(page, "mover");
        const point = await sceneToClient(
          page,
          ARTBOARD_WIDTH,
          line + 30 + (gesture === "moving" ? before.width / 2 : 0),
          before.top + before.height / 2,
        );
        await page.mouse.move(point.x, point.y, { steps: 8 });
        const released = await objectRect(page, "mover");
        const position =
          released.left + (gesture === "resizing" ? released.width : 0);
        expect(position).toBeGreaterThan(line + 10);
        expect(await guideRowsAtSceneX(page, line)).toBeLessThan(
          GUIDE_ROWS_ABSENT * (await artboardDeviceRows(page)),
        );
        // A held resize leaves Shift down with the button; this gesture ends here.
        await page.mouse.up();
        if (gesture === "resizing") await page.keyboard.up("Shift");
        await expectActiveTarget(page);
      });

      test(`${gesture} lifecycle leaves no guide far from a source`, async ({
        page,
      }) => {
        await openFixture(page, kind);
        const result = await perform(page, gesture === "moving" ? 300 : 260);
        await expectActiveTarget(page);
        expect(Math.abs(edge(result) - result.raw)).toBeLessThan(
          await rawTolerance(page),
        );
        expect(result.guideRows).toBeLessThan(
          GUIDE_ROWS_ABSENT * (await artboardDeviceRows(page)),
        );
      });

      test(`${gesture} Ctrl keeps raw geometry near a guide`, async ({
        page,
      }) => {
        await openFixture(page, kind);
        const line = (await objectRect(page, "source")).left;
        const result = await perform(page, line - 2, { ctrl: true });
        await expectActiveTarget(page);
        expect(Math.abs(edge(result) - result.raw)).toBeLessThan(
          await rawTolerance(page),
        );
        expect(Math.abs(edge(result) - line)).toBeGreaterThan(
          await refusedSnapTolerance(page),
        );
        expect(result.guideRows).toBeLessThan(
          GUIDE_ROWS_ABSENT * (await artboardDeviceRows(page)),
        );
      });
    }

    test("moving spacing reaches equal gaps", async ({ page }) => {
      await openFixture(page, kind, "spacing");
      const left = await objectRect(page, "left-source");
      const right = await objectRect(page, "right-source");
      const mover = await objectRect(page, "mover");
      const midpoint = (left.left + left.width + right.left - mover.width) / 2;
      const result = await moveTo(page, midpoint - 2);
      await expectActiveTarget(page);
      expect(Math.abs(result.left - midpoint)).toBeLessThan(
        await snappedTolerance(page),
      );
      expect(
        Math.abs(
          result.left -
            (left.left + left.width) -
            (right.left - (result.left + mover.width)),
        ),
      ).toBeLessThan(await snappedTolerance(page));
      expect(result.guideRows).toBeGreaterThan(
        GUIDE_ROWS_PRESENT * (await artboardDeviceRows(page)),
      );
    });
  });
}

/**
 * Drags a Textbox's `mr` handle. Fabric gives a text box `changeWidth` side
 * controls, so this gesture arrives as `object:resizing` on a canonical width
 * rather than as a scale — which is why it needs no Shift to defeat
 * `uniformScaling`, and why the `br` cases above never exercised it.
 */
async function resizeTextSideTo(
  page: Page,
  rawRight: number,
  options: { ctrl?: boolean } = {},
): Promise<{ right: number; guideRows: number }> {
  const select = await clientOfScene(page, "mover", ARTBOARD_WIDTH);
  await page.mouse.click(select.x, select.y);
  const handle = await objectHandleScenePoint(page, "mover", "mr");
  const from = await sceneToClient(page, ARTBOARD_WIDTH, handle.x, handle.y);
  const target = await sceneToClient(page, ARTBOARD_WIDTH, rawRight, handle.y);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  if (options.ctrl) await page.keyboard.down("Control");
  await page.mouse.move(target.x, target.y, { steps: 12 });
  const rect = await objectRect(page, "mover");
  const right = rect.left + rect.width;
  const guideRows = await guideRowsAtSceneX(page, right);
  if (options.ctrl) await page.keyboard.up("Control");
  await page.mouse.up();
  return { right, guideRows };
}

/**
 * `vg-123`: what a card's *parts* snap to.
 *
 * **RULED 2026-10-14: PARTS SNAP TO PARTS.** Inner guides are offered once
 * selection can enter a group, so a card's inner part can be aligned against a
 * neighbouring card's — which is what this row was told to wait for.
 *
 * **The instrument landed as a resize and this block keeps it as one**, because
 * a gesture *inside* the group reaches no candidate at all: both paths refuse a
 * group child before the candidate set is consulted. A resize is refused by the
 * scale path's `isSupportedScaleTarget`.
 *
 * **A drag is refused too, and the reason is Fabric's, not the planes'.** The
 * movement path's `assertRawIntentMatchesBaseline` requires the object's world
 * box to be its gesture-start box translated by the change in its own `left`/
 * `top`, and a drag *inside* a group is not that translation: Fabric re-fits the
 * group around the dragged child as it goes. Measured on the nested fixture's
 * `left-card-part`, whose group is identity (`scaleX` 1, `angle` 0): over one
 * drag the child's own `left` went 60 → −30.5 while its world box went
 * 360 → 893.33, and the card's own box collapsed from 400×200 onto the part. So
 * the two deltas differ, every step throws "Movement raw intent must be a
 * translation of the gesture baseline", and the guard in `createSnapManager`
 * swallows it — the drag lands raw. **An identity group is not enough**, which
 * is why the plane story this comment used to tell was the wrong one: measured,
 * the plane is not what moves.
 *
 * So the reading the instrument records — landed short of the part line, no
 * guide — is about those refusals rather than about which objects are
 * candidates.
 *
 * The case below asks the row's own question through the gesture that can reach
 * the candidates today: **a card snapping to a part inside the neighbouring
 * card**, which is the row's title and also the ruling's first half.
 *
 * The control is the same gesture between two loose shapes, which is what
 * proves the widening widened only the nested path.
 */
test.describe("a part inside a card", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  });

  test("records which objects a part's edge aligns to", async ({
    page,
  }, testInfo) => {
    await openNestedFixture(page);
    const partLine = await worldLeftOf(page, "right-card-part");
    const cardLine = await worldLeftOf(page, "right-card");
    const before = await sceneObjectRect(page, "left-card-part");

    // The two lines are far enough apart that no tolerance can confuse them,
    // and the drag aims at `partLine` alone.
    expect(Math.abs(partLine - cardLine)).toBeGreaterThan(40);
    expect(partLine).toBeGreaterThan(before.left + before.width + 100);
    // **The part really is inside its card**, which is the premise the whole
    // reading rests on. Fabric lays a group out from its children's own bounds,
    // so a fixture that sets the group's `left` without setting the child's
    // position inside it would put the part somewhere else entirely and the
    // measurement would be about nothing.
    const cardBox = await sceneObjectRect(page, "right-card");
    const target = await sceneObjectRect(page, "right-card-part");
    expect(target.left).toBeGreaterThan(cardBox.left);
    expect(target.left + target.width).toBeLessThan(
      cardBox.left + cardBox.width,
    );

    const result = await resizePartInsideCardTo(page, partLine - 2);
    const landed = result.right;

    // Recorded rather than asserted, and the reason is now known: `landed` is
    // the raw aim, because a resize of a group child is refused before the
    // candidates are ever consulted. Asserting `part` here would be asserting a
    // fix this path does not have; `vg-123`'s ruling is asserted one case down.
    const snappedTo =
      Math.abs(landed - partLine) < (await snappedTolerance(page))
        ? "part"
        : Math.abs(landed - cardLine) < (await snappedTolerance(page))
          ? "card"
          : "none";
    testInfo.annotations.push({
      type: "vg-123",
      description:
        `a resized part aligned to the ${snappedTo} line: ${landed} ` +
        `(part ${partLine}, card ${cardLine}, guides ${result.guideRows} rows)`,
    });

    // The part resized and kept a positive width — a drag that did nothing, or
    // that flipped the object, is not the measurement.
    const after = await sceneObjectRect(page, "left-card-part");
    expect(after.width).toBeGreaterThan(0);
    expect(
      Math.abs(landed - result.raw),
      "the gesture moved the edge rather than being refused",
    ).toBeLessThan(await rawTolerance(page));
  });

  test("a dragged card's edge aligns to a part inside the other card", async ({
    page,
  }) => {
    await openNestedFixture(page);
    const partEdge = await worldRightOf(page, "left-card-part");
    const before = await sceneObjectRect(page, "right-card");

    // **The premise: that line belongs to no object at the root.** The drag
    // aims the card's left edge two units short of the neighbouring card's
    // part, and every line the root objects and the artboard offer is further
    // than the acquire threshold can reach — which is exactly the candidate set
    // this gesture had before the widening. Without it a landing on the part
    // could be explained by the card line beside it.
    for (const { left, width } of await Promise.all(
      ["left-card", "mover", "loose-source"].map((id) =>
        sceneObjectRect(page, id),
      ),
    )) {
      for (const line of [left, left + width / 2, left + width]) {
        expect(Math.abs(line - partEdge)).toBeGreaterThan(
          await snapAcquire(page),
        );
      }
    }
    expect(Math.abs(partEdge - (before.left + before.width))).toBeGreaterThan(
      100,
    );

    // Inside the acquire threshold, so it must snap, and far enough outside the
    // landing tolerance that a landing short of the part edge is not a rounding.
    const result = await dragCardTo(
      page,
      partEdge - (await snapAcquire(page)) / 2,
    );

    expect(
      Math.abs(result.left - partEdge),
      `landed ${result.left} against the part edge ${partEdge}`,
    ).toBeLessThan(await snappedTolerance(page));
    // A snap an author cannot see is not the behaviour §175 asks for.
    expect(result.guideRows).toBeGreaterThan(
      GUIDE_ROWS_PRESENT * (await artboardDeviceRows(page)),
    );
  });

  test("the same gesture snaps between two loose shapes", async ({ page }) => {
    await openNestedFixture(page);
    const line = await worldLeftOf(page, "loose-source");
    const result = await resizeLooseShapeTo(page, line - 2);
    expect(Math.abs(result.right - line)).toBeLessThan(
      await snappedTolerance(page),
    );
    expect(result.guideRows).toBeGreaterThan(
      GUIDE_ROWS_PRESENT * (await artboardDeviceRows(page)),
    );
  });
});

/** Two cards with a part inside each, plus a loose mover and a loose source. */
async function openNestedFixture(page: Page): Promise<void> {
  await page.goto(EDITOR);
  const card = (id: string, left: number) => ({
    type: "Group",
    id,
    left,
    top: 300,
    width: 400,
    height: 200,
    originX: "left",
    originY: "top",
    objects: [rect(`${id}-part`, 60, 40, 60)],
  });
  const result = writeThemePackage({
    envelope: {
      schemaVersion: "2.0.0",
      fabricVersion: "7.4.0",
      id: "snapping-part-level",
      metadata: { themeLanguage: "en" },
      artboard: { width: NESTED_ARTBOARD, height: 800 },
      globals: paint(),
      scene: {
        version: "7.4.0",
        objects: [
          card("left-card", 100),
          card("right-card", 700),
          rect("mover", 300, 560),
          rect("loose-source", 900, 560),
        ],
      },
    },
    assets: {},
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  await openThemeFromStore(page, storedThemeOfPackage(result.bytes));
}

/**
 * Enters `left-card` and drags its part's `br` handle so the right edge lands
 * unsnapped at `rawRight`.
 *
 * Entering is the double-click the layer tree's own entry uses, because
 * `bridge.selectLayer` selects the owning group: a single click on the part
 * hands back the card, and the drag would then be the card's. `objectRect`
 * reads world space, so the measurement stays comparable across the entry.
 */
async function resizePartInsideCardTo(
  page: Page,
  rawRight: number,
): Promise<{ right: number; raw: number; guideRows: number }> {
  await enterPart(page, "left-card-part");
  // **`objectRect` from `editor-canvas.js`, not this file's local one.** The
  // local reader searches the root list, and a card's part is not in it — it is
  // inside its group — so it answered `no object with id left-card-part` for
  // the very object this is about.
  const before = await sceneObjectRect(page, "left-card-part");
  const corner = await objectHandleScenePoint(page, "left-card-part", "br");
  const from = await sceneToClient(page, NESTED_ARTBOARD, corner.x, corner.y);
  const target = await sceneToClient(page, NESTED_ARTBOARD, rawRight, corner.y);
  const travelled = await sceneTravel(page, from, target);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.keyboard.down("Shift");
  await page.mouse.move(target.x, target.y, { steps: 12 });
  const rect = await sceneObjectRect(page, "left-card-part");
  const guideRows = await guideRowsAtSceneX(
    page,
    rect.left + rect.width,
    NESTED_ARTBOARD,
  );
  await page.mouse.up();
  await page.keyboard.up("Shift");
  return {
    right: rect.left + rect.width,
    raw: before.left + before.width + travelled,
    guideRows,
  };
}

/**
 * Drags `right-card` so its left edge lands unsnapped at `rawLeft`.
 *
 * A card is a root object, so its Fabric position and its world bounds are the
 * same plane and the movement path's own consistency check holds — unlike a
 * part's, which lives in its group's plane.
 */
async function dragCardTo(
  page: Page,
  rawLeft: number,
): Promise<{ left: number; guideRows: number }> {
  await page.locator('[data-yunari-layer="right-card"]').click();
  const before = await sceneObjectRect(page, "right-card");
  const from = await sceneToClient(
    page,
    NESTED_ARTBOARD,
    before.left + before.width / 2,
    before.top + before.height / 2,
  );
  const target = await sceneToClient(
    page,
    NESTED_ARTBOARD,
    rawLeft + before.width / 2,
    before.top + before.height / 2,
  );
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  const rect = await sceneObjectRect(page, "right-card");
  const guideRows = await guideRowsAtSceneX(page, rect.left, NESTED_ARTBOARD);
  await page.mouse.up();
  return { left: rect.left, guideRows };
}

/** The same drag between two loose shapes, which is the control for the above. */
async function resizeLooseShapeTo(
  page: Page,
  rawRight: number,
): Promise<{ right: number; guideRows: number }> {
  await page.locator('[data-yunari-layer="mover"]').click();
  const corner = await objectHandleScenePoint(page, "mover", "br");
  const from = await sceneToClient(page, NESTED_ARTBOARD, corner.x, corner.y);
  const target = await sceneToClient(page, NESTED_ARTBOARD, rawRight, corner.y);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.keyboard.down("Shift");
  await page.mouse.move(target.x, target.y, { steps: 12 });
  const rect = await sceneObjectRect(page, "mover");
  const right = rect.left + rect.width;
  const guideRows = await guideRowsAtSceneX(page, right, NESTED_ARTBOARD);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  return { right, guideRows };
}

/** Double-click a part on the canvas, which enters its owning group. */
async function enterPart(page: Page, id: string): Promise<void> {
  const centre = await clientOfScene(page, id, NESTED_ARTBOARD);
  await page.mouse.dblclick(centre.x, centre.y);
  await expect.poll(() => activeObjectId(page)).toBe(id);
}

test.describe("text side handle", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  });

  test("resizing geometry snaps a side handle onto a guide", async ({
    page,
  }) => {
    await openFixture(page, "text");
    const line = (await objectRect(page, "source")).left;
    const result = await resizeTextSideTo(page, line - 3);
    await expectActiveTarget(page);
    expect(Math.abs(result.right - line)).toBeLessThan(
      await snappedTolerance(page),
    );
    expect(result.guideRows).toBeGreaterThan(
      GUIDE_ROWS_PRESENT * (await artboardDeviceRows(page)),
    );
  });

  test("resizing a side handle keeps raw geometry under Ctrl", async ({
    page,
  }) => {
    await openFixture(page, "text");
    const line = (await objectRect(page, "source")).left;
    const result = await resizeTextSideTo(page, line - 3, { ctrl: true });
    await expectActiveTarget(page);
    expect(Math.abs(result.right - line)).toBeGreaterThan(
      await refusedSnapTolerance(page),
    );
    expect(result.guideRows).toBeLessThan(
      GUIDE_ROWS_ABSENT * (await artboardDeviceRows(page)),
    );
  });
});
