import {
  expect,
  type Locator,
  type Page,
  type TestInfo,
  test,
} from "@playwright/test";
import { type FabricThemeEnvelope, facetRecordOf } from "@yunari/renderer-core";
import { readThemePackage, writeThemePackage } from "@yunari/theme-package";
import { installFixedClock } from "./clock.js";
import {
  choiceOf,
  chooseIn,
  optionPairs,
  optionsOf,
  sectionExpanded,
  typeIntoControl,
} from "./control-set.js";
import {
  type ArtboardRect,
  answerDialogIfShown,
  captureVisualReview,
  chooseAssetFile,
  clearSceneX,
  clientOfScene,
  enterLayer,
  expandLayer,
  objectHandleScenePoint,
  objectRect,
  readSceneObject,
  sceneToClient,
  worldLeftOf,
  worldRightOf,
} from "./editor-canvas.js";
import {
  ACCENT_PAINT,
  ARTBOARD_BACKGROUND_PAINT,
  BACKGROUND_END_PAINT,
  BACKGROUND_PAINT,
  BARS_END_PAINT,
  BARS_START_PAINT,
  INK_PAINT,
  PALETTE_FIELD_PAINT,
  PLATE_PAINT,
} from "./editor-fixture.js";
import { openPane } from "./editor-rail.js";
import { openPosition, selectLayer } from "./rebuild-driver.js";
import { choosePalette } from "./shell-palette.js";
import { openThemeFromStore, storedThemeOfPackage } from "./store-library.js";
import { isDesktopSurface } from "./surface.js";

/** The theme the library stub lists, so the record below is the host's own
 *  derivation rather than a descriptor written by hand: `describeSemanticKey`
 *  produces `{label: "CPU load", family: "cpu"}`, and a hand-written
 *  `{label: "CPU", family: "system"}` is a stub that answers something the host
 *  never would — the trap A.4a's review found in this file. */
const LISTED_THEME: FabricThemeEnvelope = {
  schemaVersion: 2,
  fabricVersion: "7.4.0",
  id: "graphite-desk",
  artboard: { width: 1920, height: 1080 },
  metadata: { name: "Graphite desk", themeLanguage: "en" },
  scene: { version: "7.4.0", objects: [] },
  bindings: { "cpu-label": [{ id: "cpu", semanticKey: "cpu.load" }] },
};

/** The facet record the host derives for every theme it lists (A.4). The store
 *  mode reads it, so a stub that answers a theme without one renders a filter
 *  over nothing — and `route.fulfill({ json })` is untyped, so nothing but this
 *  constant makes that a compile error. */
const LISTED_THEME_FACETS = facetRecordOf(LISTED_THEME);

/** Clicks one primitive in the Add pane's shape group.
 *
 *  Reached through the group's own hook rather than by its heading: the heading
 *  is `uiCopy.panels.shapes`, so a locator read off it moves the day the copy
 *  does (`vg-211`). */
async function insertShape(page: Page, name: string): Promise<void> {
  await page
    .locator('[data-yunari-add-group="shape"]')
    .getByRole("button", { name, exact: true })
    .click();
}

const EDITOR = "http://127.0.0.1:4174/";

/**
 * The starter scene's artboard width. Every helper that turns a scene x into a
 * client point needs it, and a stale 1280 inside a 1672-wide scene puts the
 * pointer somewhere the test never intended — the whole gesture would run
 * against the background and still assert something.
 */
const STARTER_WIDTH = 1672;

/** A scene object as a saved envelope carries it: Fabric JSON, nested. */
type SceneObjectJson = Readonly<Record<string, unknown>>;

/** Shift-clicks two starter labels into an `ActiveSelection`, the product's own
 * multi-selection path. Both centres sit inside their label and outside every
 * card behind it, so each click resolves to the label itself. A drag then moves
 * the composed selection as one unit. */
async function selectTwoLabels(page: Page): Promise<void> {
  // Inside each label's measured run rather than its box: a Textbox hit-tests
  // the glyphs, so the box centre of a wide label lands past the text and the
  // click selects the card behind it.
  const first = await sceneToClient(page, STARTER_WIDTH, 200, 78);
  const second = await sceneToClient(page, STARTER_WIDTH, 180, 114);
  await page.mouse.click(first.x, first.y);
  await page.keyboard.down("Shift");
  await page.mouse.click(second.x, second.y);
  await page.keyboard.up("Shift");
}

/** The active object's authored id. A newly inserted object is given a uuid the
 * test cannot know, so it is read from the object the insertion selected. */
async function activeId(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const bridge = (
      window as unknown as {
        yunariEditorBridge: {
          editor: {
            canvas: { getActiveObject(): { id?: string } | undefined };
          };
        };
      }
    ).yunariEditorBridge;
    return bridge.editor.canvas.getActiveObject()?.id;
  });
}

/** Replaces a field's value: focus, select the contents, type, then Tab to
 *  commit — or, for a slider, a `fill` against its own bound. Clicking alone
 *  would append to whatever the field already showed, and a slider's nested
 *  `input[type=range]` cannot be clicked at all. */
async function typeInto(
  page: Page,
  field: Locator,
  value: string,
): Promise<void> {
  await typeIntoControl(page, field, value);
}

/** The active object's scene geometry through the bridge. `members` counts an
 * `ActiveSelection`'s children and a single object as one, so a test can tell a
 * composed selection from a lone object — the guard's whole subject. */
async function activeGeometry(page: Page): Promise<{
  members: number;
  centre: { x: number; y: number };
  rect: ArtboardRect;
}> {
  return page.evaluate(() => {
    const bridge = (
      window as unknown as {
        yunariEditorBridge: {
          editor: {
            canvas: {
              getActiveObject():
                | {
                    getObjects?(): unknown[];
                    getCenterPoint(): { x: number; y: number };
                    getBoundingRect(): {
                      left: number;
                      top: number;
                      width: number;
                      height: number;
                    };
                  }
                | undefined;
            };
          };
        };
      }
    ).yunariEditorBridge;
    const active = bridge.editor.canvas.getActiveObject();
    if (active === undefined) throw new Error("no active object");
    return {
      members: active.getObjects?.().length ?? 1,
      centre: active.getCenterPoint(),
      rect: active.getBoundingRect(),
    };
  });
}

/** Counts the guide-coloured pixels in the upper canvas' backing store along the
 * vertical scene line `sceneX`, over the artboard's full height plus a small
 * column band (the line is ~1 device px wide and dashed, so a single column
 * misses it on a rounding). Reads the rendered pixels rather than the guide
 * list because the applied guides are not exposed through the bridge — which is
 * exactly why a regression that stops painting them would otherwise pass: the
 * geometry assertions cannot see a missing guide, and captures only run under
 * `YUNARI_CAPTURE`. The colour is `GUIDE_COLOR` (#3D8BF4). */
async function guidePixelsAtSceneX(
  page: Page,
  sceneX: number,
  sceneWidth = STARTER_WIDTH,
): Promise<number> {
  return page.evaluate(
    async ([x, width]) => {
      // The guide is painted in `after:render`, which `requestRenderAll`
      // schedules on an animation frame; sampling before it runs reads a canvas
      // the guide has not reached yet.
      await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
      const bridge = (
        window as unknown as {
          yunariEditorBridge: {
            editor: { viewport: { artboardScreenRect(): ArtboardRect } };
          };
        }
      ).yunariEditorBridge;
      const rect = bridge.editor.viewport.artboardScreenRect();
      const element = document.querySelector<HTMLCanvasElement>(
        "#yunari-fabric-editor canvas.upper-canvas",
      );
      const context = element?.getContext("2d");
      if (element === null || context === null || context === undefined)
        return -1;

      const ratio = element.width / element.getBoundingClientRect().width;
      const centre = (rect.left + x * (rect.width / width)) * ratio;
      const top = Math.max(0, Math.round(rect.top * ratio));
      const height = Math.max(1, Math.round(rect.height * ratio));
      const band = Math.max(1, Math.round(4 * ratio));
      const left = Math.max(0, Math.round(centre) - band);
      const pixels = context.getImageData(left, top, band * 2 + 1, height).data;
      let matching = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (
          (pixels[index + 3] ?? 0) > 0 &&
          Math.abs((pixels[index] ?? 0) - 61) <= 12 &&
          Math.abs((pixels[index + 1] ?? 0) - 139) <= 12 &&
          Math.abs((pixels[index + 2] ?? 0) - 244) <= 12
        )
          matching += 1;
      }
      return matching;
    },
    [sceneX, sceneWidth] as const,
  );
}

/**
 * The rightmost column of a named object's box that carries light ink, in
 * canvas pixels. `-1` when the object or the canvas cannot be read.
 *
 * Samples `lower-canvas`, where Fabric paints objects; `upper-canvas` carries
 * only the selection overlay. Waits two animation frames first, for the reason
 * `guidePixelsAtSceneX` gives: a render scheduled by `requestRenderAll` has not
 * reached the canvas when the `fill` resolves, so reading immediately samples a
 * canvas from before the edit.
 *
 * Brightness rather than alpha, because text over an opaque panel is covered
 * everywhere and only the glyphs are light.
 */
async function inkReachOf(page: Page, id: string): Promise<number> {
  return page.evaluate(
    async ([objectId, artboard]) => {
      await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
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
              canvas: {
                getObjects(): Array<{
                  id?: string;
                  getBoundingRect(): ArtboardRect;
                }>;
              };
            };
          };
        }
      ).yunariEditorBridge;
      const object = bridge.editor.canvas
        .getObjects()
        .find((candidate) => candidate.id === objectId);
      if (object === undefined) return -1;
      const view = bridge.editor.viewport.artboardScreenRect();
      const element = document.querySelector<HTMLCanvasElement>(
        "#yunari-fabric-editor canvas.lower-canvas",
      );
      const context = element?.getContext("2d");
      if (element === null || context === null || context === undefined)
        return -1;

      const rect = object.getBoundingRect();
      const ratio = element.width / element.getBoundingClientRect().width;
      const scale = view.width / artboard;
      const left = Math.round((view.left + rect.left * scale) * ratio);
      const top = Math.round((view.top + rect.top * scale) * ratio);
      const width = Math.max(1, Math.round(rect.width * scale * ratio));
      const height = Math.max(1, Math.round(rect.height * scale * ratio));
      const pixels = context.getImageData(left, top, width, height).data;

      let rightmost = -1;
      for (let column = 0; column < width; column += 1) {
        for (let row = 0; row < height; row += 1) {
          const at = (row * width + column) * 4;
          const luminance =
            0.2126 * (pixels[at] ?? 0) +
            0.7152 * (pixels[at + 1] ?? 0) +
            0.0722 * (pixels[at + 2] ?? 0);
          if (luminance > 140) {
            rightmost = column;
            break;
          }
        }
      }
      return rightmost;
    },
    [id, STARTER_WIDTH] as [string, number],
  );
}

/**
 * The canvas backing-store pixel at a named object's own centre, as
 * `[r, g, b, a]`.
 *
 * **A rendered effect needs a rendered read.** Which objects a rule covers is an
 * object count, and that count is already asserted elsewhere; whether the author
 * can see the difference is only in the paint. The centre rather than the box,
 * so a selection border drawn on the object's own edge is not what is measured.
 *
 * `lower-canvas` is where Fabric paints objects; `upper-canvas` carries only the
 * selection overlay. Two animation frames first, for the reason
 * `guidePixelsAtSceneX` gives. Alpha rather than luminance, because this scene's
 * artboard paint is a DOM sibling *below* the canvas, so the canvas itself reads
 * as ink over nothing and a dim is exactly a smaller alpha.
 */
async function pixelAtObjectCentre(
  page: Page,
  id: string,
  artboard = 320,
): Promise<readonly number[]> {
  return page.evaluate(
    async ([objectId, width]) => {
      await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
      type SceneNode = {
        id?: string;
        getObjects?(): SceneNode[];
        getBoundingRect(): ArtboardRect;
      };
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
              canvas: {
                getObjects(): SceneNode[];
              };
            };
          };
        }
      ).yunariEditorBridge;
      const find = (
        candidates: readonly SceneNode[],
      ): SceneNode | undefined => {
        for (const candidate of candidates) {
          if (candidate.id === objectId) return candidate;
          const found = find(candidate.getObjects?.() ?? []);
          if (found !== undefined) return found;
        }
        return undefined;
      };
      const object = find(bridge.editor.canvas.getObjects());
      if (object === undefined)
        throw new Error(`no object with id ${objectId}`);
      const element = document.querySelector<HTMLCanvasElement>(
        "#yunari-fabric-editor canvas.lower-canvas",
      );
      const context = element?.getContext("2d");
      if (element === null || context === null || context === undefined)
        throw new Error("no lower canvas");

      const rect = object.getBoundingRect();
      const view = bridge.editor.viewport.artboardScreenRect();
      const ratio = element.width / element.getBoundingClientRect().width;
      const scale = view.width / width;
      const x = Math.round(
        (view.left + (rect.left + rect.width / 2) * scale) * ratio,
      );
      const y = Math.round(
        (view.top + (rect.top + rect.height / 2) * scale) * ratio,
      );
      const data = context.getImageData(x, y, 1, 1).data;
      return [data[0] ?? -1, data[1] ?? -1, data[2] ?? -1, data[3] ?? -1];
    },
    [id, artboard] as const,
  );
}

/** Drags a named object's `mr` handle so its raw right edge would land at
 * `toSceneX`, and reports the right edge the resize actually left, plus the
 * guide pixels drawn along that edge while the pointer was still down. The
 * handle is read from the object's own corners, so a quantised client mapping
 * cannot put the grab off the handle. */
async function resizeRightHandleTo(
  page: Page,
  id: string,
  toSceneX: number,
  testInfo: TestInfo | undefined,
  options: { ctrlKey?: boolean; captureName?: string } = {},
): Promise<{ right: number; raw: number; guidePixels: number }> {
  const handle = await objectHandleScenePoint(page, id, "mr");
  const from = await sceneToClient(page, STARTER_WIDTH, handle.x, handle.y);
  const to = await sceneToClient(page, STARTER_WIDTH, toSceneX, handle.y);
  const travelled = await page.evaluate(
    ([fx, fy, tx, ty]) => {
      const c = (
        window as unknown as {
          yunariEditorBridge: {
            editor: {
              canvas: {
                getScenePoint(e: { clientX: number; clientY: number }): {
                  x: number;
                };
              };
            };
          };
        }
      ).yunariEditorBridge.editor.canvas;
      return (
        c.getScenePoint({ clientX: tx!, clientY: ty! }).x -
        c.getScenePoint({ clientX: fx!, clientY: fy! }).x
      );
    },
    [from.x, from.y, to.x, to.y],
  );
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  if (options.ctrlKey === true) await page.keyboard.down("Control");
  await page.mouse.move(to.x, to.y, { steps: 12 });

  if (testInfo)
    await captureVisualReview(
      page,
      testInfo,
      options.captureName ?? "editor-snap-resize",
    );
  // Sampled while the pointer is still down: a snapped guide is drawn at the
  // edge the resize landed on, so the object's own right edge names the column.
  const guidePixels = await guidePixelsAtSceneX(
    page,
    await worldRightOf(page, id),
  );
  if (options.ctrlKey === true) await page.keyboard.up("Control");
  await page.mouse.up();

  return {
    right: await worldRightOf(page, id),
    raw: handle.x + travelled,
    guidePixels,
  };
}

/** Gives the active selection a non-unit scale, which is what the eligibility
 * guard refuses when a `Textbox` child is present. The product cannot reach this
 * state — only a scale gesture leaves one, and that deselects first — so the
 * test sets it directly through the live canvas. `setCoords` is not optional:
 * without it the selection's hit area stays at the old scale, the press misses
 * it, and Fabric clears the selection and drags the card behind instead. */
async function scaleActiveSelection(page: Page, factor: number): Promise<void> {
  await page.evaluate((value) => {
    const bridge = (
      window as unknown as {
        yunariEditorBridge: {
          editor: {
            canvas: {
              getActiveObject():
                | {
                    set(values: Record<string, number>): void;
                    setCoords(): void;
                  }
                | undefined;
              requestRenderAll(): void;
            };
          };
        };
      }
    ).yunariEditorBridge;
    const active = bridge.editor.canvas.getActiveObject();
    if (active === undefined) throw new Error("no active object");
    active.set({ scaleX: value, scaleY: value });
    active.setCoords();
    bridge.editor.canvas.requestRenderAll();
  }, factor);
}

/**
 * One named object's own box and scale, plus the authored box the product
 * stored — the two halves every `yunariText.box` claim compares.
 *
 * Read from the object rather than from a saved document because the question is
 * what the live canvas holds mid-edit; the round-trip half of the case reads the
 * envelope instead, where the stored value is the persisted one.
 */
async function textBoxState(
  page: Page,
  id: string,
): Promise<{
  width: number;
  scaleX: number;
  renderedWidth: number;
  boxWidth: number | undefined;
}> {
  return page.evaluate((objectId) => {
    type Obj = {
      readonly id?: string;
      get(name: string): unknown;
      getObjects?(): readonly Obj[];
      readonly width: number;
      readonly scaleX: number;
      getScaledWidth(): number;
    };
    const objects = (
      window as unknown as {
        yunariEditorBridge: {
          editor: { canvas: { getObjects(): readonly Obj[] } };
        };
      }
    ).yunariEditorBridge.editor.canvas.getObjects();
    const find = (list: readonly Obj[]): Obj | undefined => {
      for (const candidate of list) {
        if (candidate.id === objectId) return candidate;
        const found = find(candidate.getObjects?.() ?? []);
        if (found !== undefined) return found;
      }
      return undefined;
    };
    const object = find(objects);
    if (object === undefined) throw new Error(`no object with id ${objectId}`);
    const authored = object.get("yunariText") as
      | { box?: { width?: number } }
      | undefined;
    return {
      width: object.width,
      scaleX: object.scaleX,
      renderedWidth: object.getScaledWidth(),
      boxWidth: authored?.box?.width,
    };
  }, id);
}

/**
 * Scales a named object by dragging its `br` corner — the product's own route to
 * a non-unit `scaleX`, and the only one: the state is a gesture's result and
 * nothing in the inspector writes it.
 *
 * The grab is the object's own corner and the landing is a point on the diagonal
 * from its centre, so the scale that comes out is Fabric's own arithmetic on a
 * real drag rather than a number this test wrote into the scene.
 *
 * **The object must not be in text editing.** Fabric withdraws the controls and
 * locks movement while a text is being edited (`_setEditingProps`), so a corner
 * dragged on a text that still holds the caret does nothing at all and the
 * gesture goes missing without failing.
 */
async function scaleByCornerHandle(
  page: Page,
  id: string,
  factor: number,
): Promise<void> {
  const corner = await objectHandleScenePoint(page, id, "br");
  const centre = await readSceneObject<{ x: number; y: number }>(
    page,
    id,
    "center",
  );
  const from = await sceneToClient(page, STARTER_WIDTH, corner.x, corner.y);
  const to = await sceneToClient(
    page,
    STARTER_WIDTH,
    centre.x + (corner.x - centre.x) * factor,
    centre.y + (corner.y - centre.y) * factor,
  );
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

/**
 * The client point of a named object's `mtr` control.
 *
 * Read from Fabric's own `oCoords`, which is where the control is drawn and
 * hit-tested — a corner nudged by a literal would be a grab the fixture never
 * promised. `setCoords` first, because `oCoords` is computed from the viewport
 * transform when the object was last asked for its coordinates.
 */
async function rotationHandleClientPoint(
  page: Page,
  id: string,
): Promise<{ x: number; y: number }> {
  return page.evaluate((objectId) => {
    type Obj = {
      readonly id?: string;
      getObjects?(): readonly Obj[];
      setCoords(): void;
      readonly oCoords?: Record<string, { x: number; y: number }>;
    };
    const objects = (
      window as unknown as {
        yunariEditorBridge: {
          editor: { canvas: { getObjects(): readonly Obj[] } };
        };
      }
    ).yunariEditorBridge.editor.canvas.getObjects();
    const find = (list: readonly Obj[]): Obj | undefined => {
      for (const candidate of list) {
        if (candidate.id === objectId) return candidate;
        const found = find(candidate.getObjects?.() ?? []);
        if (found !== undefined) return found;
      }
      return undefined;
    };
    const object = find(objects);
    if (object === undefined) throw new Error(`no object with id ${objectId}`);
    object.setCoords();
    const mtr = object.oCoords?.["mtr"];
    if (mtr === undefined) {
      throw new Error(`${objectId} has no rotation control`);
    }
    const canvas = document.querySelector<HTMLCanvasElement>(
      "#yunari-fabric-editor canvas.upper-canvas",
    );
    if (canvas === null) throw new Error("the upper canvas is missing");
    const box = canvas.getBoundingClientRect();
    return { x: box.left + mtr.x, y: box.top + mtr.y };
  }, id);
}

/** The active object's own angle, which is the number the readout names. */
async function activeAngle(page: Page): Promise<number> {
  return page.evaluate(() => {
    const active = (
      window as unknown as {
        yunariEditorBridge: {
          editor: {
            canvas: {
              getActiveObject(): { angle?: number } | undefined;
            };
          };
        };
      }
    ).yunariEditorBridge.editor.canvas.getActiveObject();
    if (active === undefined) throw new Error("no active object");
    return active.angle ?? 0;
  });
}

/** How far a point is from a box's own rectangle, in CSS pixels: the distance to
 *  the nearest edge, and `0` for every point inside the rectangle — a readout
 *  drawn *under* the cursor scores 0 too, so "beside" rather than "under" is
 *  `boxContains` below, not this. */
function distanceToBox(
  point: { readonly x: number; readonly y: number },
  box: {
    readonly x: number;
    readonly y: number;
    width: number;
    height: number;
  },
): number {
  const dx = Math.max(box.x - point.x, 0, point.x - (box.x + box.width));
  const dy = Math.max(box.y - point.y, 0, point.y - (box.y + box.height));
  return Math.hypot(dx, dy);
}

/** Whether a point lies inside a box's rectangle. `distanceToBox` cannot make
 *  this distinction: it returns 0 for the whole rectangle. */
function boxContains(
  point: { readonly x: number; readonly y: number },
  box: {
    readonly x: number;
    readonly y: number;
    width: number;
    height: number;
  },
): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

/** Drags the active selection by `amount` scene px in one gesture and reports
 * the world left edge it landed on plus the pointer's exact scene travel.
 *
 * Every leg is at least 30px, and `dragToLine` below parks the selection when
 * the target is nearer. That floor is load-bearing: `sceneToClient` quantises to
 * client pixels, so a leg sized only by the distance to a nearby line can round
 * to no pointer movement — the browser sends no `mousemove`, Fabric never fires
 * `object:moving`, and a test built on that leg passes without exercising
 * anything. `travelled` is read through the canvas's own `getScenePoint` at the
 * two client points actually sent, so `startLeft + travelled` is exactly the
 * landing Fabric's drag would leave unsnapped — the baseline a snap correction
 * is measured against. */
async function dragActiveSelection(
  page: Page,
  amount: number,
  options: { ctrlKey?: boolean } = {},
): Promise<{ left: number; travelled: number; guidePixels: number }> {
  const current = await activeGeometry(page);
  const from = await sceneToClient(
    page,
    STARTER_WIDTH,
    current.centre.x,
    current.centre.y,
  );
  const to = await sceneToClient(
    page,
    STARTER_WIDTH,
    current.centre.x + amount,
    current.centre.y,
  );
  const travelled = await page.evaluate(
    ([fx, fy, tx, ty]) => {
      const c = (
        window as unknown as {
          yunariEditorBridge: {
            editor: {
              canvas: {
                getScenePoint(e: { clientX: number; clientY: number }): {
                  x: number;
                  y: number;
                };
              };
            };
          };
        }
      ).yunariEditorBridge.editor.canvas;
      const a = c.getScenePoint({ clientX: fx!, clientY: fy! });
      const b = c.getScenePoint({ clientX: tx!, clientY: ty! });
      return b.x - a.x;
    },
    [from.x, from.y, to.x, to.y],
  );
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  if (options.ctrlKey === true) await page.keyboard.down("Control");
  await page.mouse.move(to.x, to.y, { steps: 12 });
  const left = (await activeGeometry(page)).rect.left;
  const guidePixels = await guidePixelsAtSceneX(page, left);
  if (options.ctrlKey === true) await page.keyboard.up("Control");
  await page.mouse.up();
  return { left, travelled, guidePixels };
}

/** Drags the active selection so its raw landing is `offset` scene px past
 * `line`, and reports that landing alongside the left edge it finally sits on.
 * Parks 80px away first when the selection is already within 30px of the
 * target, so the approach leg is always long enough to move the pointer (see
 * above). */
async function dragToLine(
  page: Page,
  line: number,
  offset: number,
): Promise<{ left: number; raw: number }> {
  let startLeft = (await activeGeometry(page)).rect.left;
  if (Math.abs(line + offset - startLeft) < 30) {
    startLeft = (await dragActiveSelection(page, -80)).left;
  }
  const { left, travelled } = await dragActiveSelection(
    page,
    line + offset - startLeft,
  );
  return { left, raw: startLeft + travelled };
}

/** The inspector's two geometry pairs, measured from the built bundle. jsdom
 * cannot lay out, so a wrapped pair and a same-line pair return the identical
 * row element there; only a browser can tell the two apart.
 *
 * The Position pair is the reference: it fits this column at every width the
 * editor uses, so a Size row taller than it has wrapped. Comparing the two rows
 * rather than a literal height keeps the check honest if the row's own metrics
 * ever change. */
async function geometryPairBoxes(page: Page): Promise<{
  sizeRowHeight: number;
  positionRowHeight: number;
  widthTop: number;
  heightTop: number;
}> {
  await openPosition(page);
  return page.evaluate(() => {
    const input = (key: string): HTMLInputElement => {
      const field = document.querySelector<HTMLInputElement>(
        `[data-yunari-geometry="${key}"]`,
      );
      if (field === null) throw new Error(`no ${key} geometry field`);
      return field;
    };
    const rowOf = (element: Element): HTMLElement => {
      const row = element.closest("[data-yunari-pair]");
      if (row === null) throw new Error("a geometry input has no paired row");
      return row as HTMLElement;
    };
    const width = input("width");
    const height = input("height");
    return {
      sizeRowHeight: rowOf(width).getBoundingClientRect().height,
      positionRowHeight: rowOf(input("left")).getBoundingClientRect().height,
      widthTop: width.getBoundingClientRect().top,
      heightTop: height.getBoundingClientRect().top,
    };
  });
}

test.describe("Fabric editor route", () => {
  test("shows the inspector's Size pair on one line", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    // Selecting through the layer row, not a canvas click: the stage
    // letterboxes the artboard, so a scene coordinate is not a stable page one.
    await page.locator('[data-yunari-layer="wordmark"]').click();
    await openPosition(page);
    await expect(page.locator('[data-yunari-geometry="width"]')).toBeVisible();

    // "One line" is the two inputs sharing a top, not a row-height threshold:
    // a row that wrapped and a row that did not both satisfy a loose height.
    const boxes = await geometryPairBoxes(page);
    expect(Math.round(boxes.widthTop)).toBe(Math.round(boxes.heightTop));
    // ...and the wrap shows up as height, so the Size row must be no taller
    // than the Position row that already fits.
    expect(boxes.sizeRowHeight).toBeLessThanOrEqual(boxes.positionRowHeight);
  });

  test("opens Position on a fresh selection, with the geometry already in it", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await page.locator('[data-yunari-layer="wordmark"]').click();

    const isOpen = (id: string): Promise<boolean> => sectionExpanded(page, id);

    // Position was the one section put away, on the reasoning that geometry is
    // set once and the binding chosen constantly. The author's item 13 reverses
    // it: the section an object is usually selected *for* is not one to hide
    // behind a disclosure, and the default is now the same for every question.
    await expect(
      page.locator('[data-yunari-section="position"]'),
    ).toBeVisible();
    expect(await isOpen("position")).toBe(true);
    // **Two questions, not four, because the wordmark is a text run.** A text
    // object's only Paint row was the glass refusal, and `vg-465` moved that
    // sentence into the lead block above the sections rather than leaving a
    // section standing over one refusal — so `per-kind-column.ts`'s
    // empty-section rule takes the whole section away, and asking for it here
    // would be asking for the surface `vg-006` was reversed to remove. The
    // read-only question is gone outright (item 17).
    for (const id of ["content", "layer"]) {
      expect(await isOpen(id), id).toBe(true);
    }
    await expect(
      page.locator(
        '[data-yunari-section="position"] [data-yunari-section-count]',
      ),
    ).not.toHaveText("0");

    // The geometry it was always made of is inside it, with no click needed to
    // reach it — which is the whole of what item 13 asks for.
    await expect(page.locator('[data-yunari-geometry="left"]')).toBeVisible();
    await expect(page.locator('[data-yunari-geometry="width"]')).toBeVisible();
  });

  test("keeps the drag marquee drawn while the pointer rests", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    // The scene has to be mounted before a gesture means anything: hit-testing
    // an empty canvas finds nothing empty, because nothing is on it yet.
    await expect(page.locator("#status-message")).toHaveText("Editor ready");
    await page.waitForFunction(() => "yunariEditorBridge" in window);

    // Fabric draws the marquee onto the context rather than into the scene, so
    // the only way to see it is to read back the pixels a repaint erases. The
    // upper canvas is where it lands, and it is otherwise blank.
    const marqueeSum = async (): Promise<number> =>
      page.evaluate(() => {
        const canvas = document.querySelector(
          "#yunari-fabric-editor canvas.upper-canvas",
        ) as HTMLCanvasElement | null;
        const context = canvas?.getContext("2d");
        if (canvas === null || context === null || context === undefined) {
          return -1;
        }
        const data = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        let sum = 0;
        for (let i = 0; i < data.length; i += 64) sum += data[i]!;
        return sum;
      });

    // A marquee needs nothing under the pointer where it starts, or the gesture
    // moves an object instead of drawing a box. Which point is empty depends on
    // the window and where the stage letterboxed the artboard, so the start is
    // found by hit-testing rather than guessed.
    const points = await page.evaluate(() => {
      const canvas = document.querySelector(
        "#yunari-fabric-editor canvas.upper-canvas",
      ) as HTMLCanvasElement;
      const box = canvas.getBoundingClientRect();
      const fabric = (
        window as unknown as {
          yunariEditorBridge: {
            editor: {
              canvas: {
                findTarget(e: unknown): { currentTarget?: unknown } | undefined;
              };
            };
          };
        }
      ).yunariEditorBridge.editor.canvas;
      const candidates: { x: number; y: number }[] = [];
      for (let i = 1; i <= 8; i += 1) {
        const step = i / 9;
        candidates.push({ x: box.left + 8, y: box.top + box.height * step });
        candidates.push({
          x: box.left + box.width - 8,
          y: box.top + box.height * step,
        });
        candidates.push({ x: box.left + box.width * step, y: box.top + 8 });
        candidates.push({
          x: box.left + box.width * step,
          y: box.top + box.height - 8,
        });
      }
      // A descriptor with no current target is the canvas saying "nothing here".
      const empty = candidates.find(
        (p) =>
          fabric.findTarget({ clientX: p.x, clientY: p.y })?.currentTarget ===
          undefined,
      );
      return {
        empty,
        box: {
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
        },
      };
    });
    expect(points.empty, "an empty point on the canvas").toBeDefined();

    const from = points.empty!;
    const to = {
      x: points.box.left + points.box.width * 0.55,
      y: points.box.top + points.box.height * 0.3,
    };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    // The control is taken with the pointer already down and the refresh
    // already paused, so the marquee is the only thing that can put ink on that
    // canvas before the second read.
    await page.waitForTimeout(200);
    const control = await marqueeSum();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    // The pause is the whole finding: the marquee used to survive about 33ms,
    // one frame of the 30fps refresh, and be gone by the time anyone looked.
    await page.waitForTimeout(600);
    const during = await marqueeSum();
    await page.mouse.up();

    expect(control).toBeGreaterThanOrEqual(0);
    expect(during).toBeGreaterThan(control);
  });

  test("refuses a palette colour the browser cannot paint", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await expect(page.locator("#status-message")).toHaveText("Editor ready");
    // "Add colour" is the palette panel's control, and the palette is the
    // Tokens pane's.
    await openPane(page, "Tokens");
    await page.getByRole("button", { name: "Add colour" }).click();
    const field = page.locator("[data-yunari-palette-color]");
    // The reason is the control set's own editable-invalid channel now
    // (`vg-263`): the field carries `aria-invalid` and describes itself by the
    // reason, which the pane's bare sibling `<p>` never associated.

    // jsdom has no `CSS` object, so this refusal can only be proven where the
    // predicate actually lives: the browser that will paint the value.
    await field.fill(PALETTE_FIELD_PAINT);
    await field.press("Tab");
    await expect(field).toHaveValue(PALETTE_FIELD_PAINT);
    await expect(field).not.toHaveAttribute("aria-invalid", "true");

    // A value the engine rejects is refused with a message that names it, and
    // `ctx.fillStyle` would have kept the PREVIOUS colour — so accepting it
    // writes a document the renderer cannot honour. The field falls back to the
    // colour the document still holds; the reason sits beside it.
    await field.fill("not-a-colour");
    await field.press("Tab");
    await expect(field).toHaveAttribute("aria-invalid", "true");
    const describedBy = await field.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    await expect(page.locator(`#${describedBy}`)).toHaveText(/not-a-colour/);
    await expect(field).toHaveValue(PALETTE_FIELD_PAINT);

    // The refusal is not sticky: a value the engine can paint clears it.
    await field.fill("rgb(1, 2, 3)");
    await field.press("Tab");
    await expect(field).toHaveValue("rgb(1, 2, 3)");
    await expect(field).not.toHaveAttribute("aria-invalid", "true");
  });

  test("mounts the adopted editor shell on the editor stage", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);

    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible();
    await expect(page.locator("#status-message")).toHaveText("Editor ready");
  });

  test("switches chart refresh between 30 and 1 FPS", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    // The View menu owns chart refresh; the panel select is gone.
    await page.getByRole("button", { name: "View", exact: true }).click();
    await expect(
      page.getByRole("menuitem", { name: /Chart refresh: 30 FPS/ }).first(),
    ).toBeVisible();
    // **Pick the rate, rather than re-opening the menu and hoping.** The View
    // menu's `Chart refresh` entry is a submenu trigger, so clicking it opens
    // the rates and changes nothing. The old body clicked the trigger a second
    // time and asserted the trigger now read `1 FPS` — an assertion that could
    // only pass if something else had changed the rate, and nothing did, so it
    // was red from the day the entry became a submenu.
    await page
      .getByRole("menuitem", { name: /Chart refresh: 30 FPS/ })
      .first()
      .click();
    await page.getByRole("menuitemradio", { name: "1 FPS" }).click();

    // **Read the trigger in the menu that is already open. Do not re-open it.**
    //
    // This was the flake: measured 3 failures in 12 and 3 in 24 on an unmodified
    // tree, every one of them `element(s) not found` waiting for
    // `Chart refresh: 1 FPS`. The re-open was the defect. Picking a radio in
    // this submenu does **not** close the menu — measured after the click, the
    // View trigger is still `aria-expanded="true"` and the menu already lists
    // `Chart refresh: 1 FPS` — so the second `View` click TOGGLED the open menu
    // SHUT, and the assertion then waited out its five seconds looking inside a
    // menu that was no longer there. Whether the label had committed by then was
    // the race, and the re-open is what made it matter.
    //
    // Two earlier attempts are the reason the wait is not simply a longer one.
    // Asserting the popup left the DOM failed 24 of 48, because Base UI keeps a
    // closed popup mounted and only drops `data-open`. Asserting
    // `aria-expanded === "false"` failed 24 of 48 for the same reason in the
    // other direction: the menu never closes, so it never becomes false. Both
    // were fixing a race that was never the problem.
    await expect(
      page.getByRole("menuitem", { name: /Chart refresh: 1 FPS/ }).first(),
    ).toBeVisible();
  });

  test("anchors a menubar menu to its trigger rather than to its centre", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await expect(page.locator("#status-message")).toHaveText("Editor ready");

    const trigger = page.getByRole("button", { name: "View", exact: true });
    await trigger.click();

    // **Base UI centres a positioned popup on its trigger unless it is told
    // otherwise**, which floated the menu over the middle of its own label.
    // Measured on a built bundle with the anchor removed: the popup's left edge
    // sat at 67.2 against a trigger at 162.1 — a 94.9px offset, which is the
    // centring formula to the pixel. A menu belongs at the trigger's start
    // edge, the idiom `components/ui/colour-picker.tsx` already uses. jsdom has
    // no layout, so this is only assertable in the browser that paints it.
    const triggerBox = await trigger.boundingBox();
    const menuBox = await page
      .locator('[role="menu"]:visible')
      .first()
      .boundingBox();
    if (!triggerBox || !menuBox) throw new Error("the View menu did not open");
    expect(Math.abs(menuBox.x - triggerBox.x)).toBeLessThanOrEqual(1);

    // The View menu's settings are submenus and take the same rule: beside the
    // item and lined up with its top, rather than centred on it.
    const submenuTrigger = page
      .getByRole("menuitem", { name: /Chart refresh: 30 FPS/ })
      .first();
    await submenuTrigger.click();
    const submenuBox = await page
      .locator('[role="menu"]:visible')
      .filter({ has: page.getByRole("menuitemradio", { name: "30 FPS" }) })
      .boundingBox();
    const itemBox = await submenuTrigger.boundingBox();
    if (!itemBox || !submenuBox)
      throw new Error("the View submenu did not open");
    expect(Math.abs(submenuBox.y - itemBox.y)).toBeLessThanOrEqual(1);
  });

  test("creates and saves text with derived v2 references", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await openPane(page, "Add");
    await page
      .locator('[data-yunari-panel="add"]')
      .getByRole("button", { name: "Text" })
      .click();

    const envelope = (await saveEnvelope(page)) as {
      scene: {
        objects: Array<{
          yunariPaint?: { fill?: string };
          yunariText?: {
            runs: Array<{
              text?: string;
              typePreset?: string;
              style?: { color?: { ref?: string } };
            }>;
          };
        }>;
      };
    };
    const text = envelope.scene.objects.find(
      (object) => object.yunariText?.runs[0]?.text === "New text",
    );
    // New content takes a token named for content, not the palette's first
    // entry, which is the artboard background and would paint the text
    // invisible.
    expect(text).toMatchObject({
      yunariPaint: { fill: "palette.text" },
      yunariText: {
        runs: [
          {
            // The largest body-role preset, which is what the editor's new-text
            // defaults pick — not the first entry, and not a caption too small
            // to inspect comfortably. At the reference's artboard that is the
            // 32px date face.
            typePreset: "typePresets.32-400",
            style: { color: { ref: "palette.text" } },
          },
        ],
      },
    });
  });

  test("creates a chart with palette-backed settings that save and reopen", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await openPane(page, "Add");
    await page
      .locator('[data-yunari-panel="add"]')
      .getByRole("button", { name: "Gauge" })
      .click();
    await expect(
      page.locator('[data-yunari-chart-setting="thickness"]'),
    ).toBeVisible();
    await captureVisualReview(page, testInfo, "editor-chart-creation");

    const saved = await savePackage(page);
    expect(saved.parsed.ok).toBe(true);
    if (!saved.parsed.ok) return;
    const chart = sceneObjects(saved.parsed.envelope)
      .filter((object) => object["type"] === "YunariChart")
      .at(-1);
    // A chart takes a content token for its data and a surface token for its
    // track; one token cannot serve both.
    expect(chart).toMatchObject({
      family: "gauge",
      settings: {
        track: { ref: "palette.background" },
        progress: { ref: "palette.text" },
      },
    });
    expect(chart).not.toHaveProperty("option");

    await openThemeFromStore(page, storedThemeOfPackage(saved.bytes));
  });

  test("authors a panel from the Add panel, styles it by keyboard and pointer, and reopens it", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await openPane(page, "Add");
    // The Add pane's shapes are a group: "Line" is both a chart family and a
    // primitive, so the legend is what tells the two apart.
    await insertShape(page, "Rectangle");

    // Insertion selects what it inserted, so the controls belong to the new
    // panel without a second click.
    const fill = page.locator("[data-yunari-panel-fill]");
    const stroke = page.locator("[data-yunari-panel-stroke]");
    const border = page.locator("[data-yunari-panel-border]");
    const radius = page.locator("[data-yunari-panel-radius]");
    const shadow = page.locator("[data-yunari-panel-shadow]");
    await expect(fill).toBeVisible();
    await expect(stroke).toBeVisible();
    await expect(border).toBeVisible();
    await expect(radius).toBeVisible();
    await expect(shadow).toBeVisible();

    // Pointer: the canvas, not the panel. Clicking the new panel's own centre
    // must leave the controls bound to *that* object — asserted by the id the
    // bridge reports and by the token the controls show. A starter card behind
    // it would also render the fields, so "the field is visible" proves
    // nothing; the inserted panel's fill is the card token and no card
    // shares it — the starter's are all `frost`.
    const panelId = (await activeId(page)) ?? "";
    const inserted = await clientOfScene(page, panelId, STARTER_WIDTH);
    await page.mouse.click(inserted.x, inserted.y);
    await expect.poll(() => activeId(page)).toBe(panelId);
    // The picker prints the token's name, not its reference: `palette.panel`
    // is the starter token called `Panel`.
    expect(await choiceOf(fill)).toBe("Panel");

    // Keyboard: one arrow step on the fill token. The inserted panel starts on
    // the card token, so a step is a real change the envelope can show. The
    // control shows the label behind the choice, so that is what is compared.
    //
    // **Three keystrokes where the native `<select>` needed one**, and that is
    // the control's shape rather than a defect: a plan-1 select opens on
    // `ArrowDown`, moves the highlight on the next, and commits on `Enter`.
    // Asserting the open state between them keeps the step honest — without it
    // a control that ignored the key entirely would still fail, but a control
    // that closed again between the two would pass this by luck.
    await fill.focus();
    const fillBefore = await choiceOf(fill);
    await page.keyboard.press("ArrowDown");
    await expect(fill).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect.poll(() => choiceOf(fill)).not.toBe(fillBefore);

    // Pointer: the border token.
    await chooseIn(page, "[data-yunari-panel-stroke]", "palette.panelStroke");

    // Keyboard: type a radius, committing with Tab.
    await typeInto(page, radius, "24");

    // A gradient cannot be a shadow colour, so none is offered there. The
    // starter's `sparkArea` token is one. (It used to be `scene`, which the
    // starter no longer carries — its backdrop is packaged media — so naming
    // that one would have made this assertion vacuous rather than true.)
    const shadowValues = await optionsOf(page, shadow);
    expect(shadowValues).toContain("palette.panelStroke");
    expect(shadowValues).not.toContain("palette.sparkArea");
    await chooseIn(page, "[data-yunari-panel-shadow]", "palette.panelStroke");
    await expect(page.locator("[data-yunari-panel-shadow-blur]")).toBeVisible();

    // Keyboard: the last edit, so the undo below is that edit and not the panel.
    await typeInto(page, border, "3");
    // **The chord is pressed with the track still focused, which is `vg-252`'s
    // own reproduction** — click the slider, press Ctrl+Z. `edit.undo` defers
    // only to a target that *consumes the key*: a range consumes its own arrows
    // and no modifier chord, so this undo is the manager's. (It used to blur
    // first, because a focused range counted as a text-entry target.)
    await border.focus();

    await captureVisualReview(page, testInfo, "editor-panel-authoring");

    // Undo steps back one committed edit, not the whole panel.
    await page.keyboard.press("Control+z");
    await expect(border).toHaveValue("1");
    await expect(fill).toBeVisible();

    await typeInto(page, border, "3");
    const saved = await savePackage(page);
    expect(saved.parsed.ok).toBe(true);
    if (!saved.parsed.ok) return;
    const panel = sceneObjects(saved.parsed.envelope).find(
      (object) => object["yunariPaint"] !== undefined && object["rx"] === 24,
    );
    // Every field the author touched survives the save as authored state: the
    // tokens stay references, and the geometry is plain Fabric.
    expect(panel).toMatchObject({
      type: "Rect",
      rx: 24,
      ry: 24,
      strokeWidth: 3,
      yunariPaint: {
        fill: expect.stringMatching(/^palette\./),
        stroke: "palette.panelStroke",
        shadowColor: "palette.panelStroke",
      },
    });
    expect(
      (panel as { shadow?: { blur: number } }).shadow?.blur,
    ).toBeGreaterThan(0);

    await openThemeFromStore(page, storedThemeOfPackage(saved.bytes));
    // Reopened, the panel is still there with the same authored material.
    const reopened = (await saveEnvelope(page)) as {
      scene: { objects: ReadonlyArray<Readonly<Record<string, unknown>>> };
    };
    expect(
      reopened.scene.objects.filter((object) => object["rx"] === 24),
    ).toHaveLength(1);
  });

  test("offers every primitive as a named shape and styles one that is not a rectangle", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await openPane(page, "Add");

    // Eight, which is `SHAPE_KINDS` — rect, ellipse, polygon, polyline, line,
    // path, arc, wedge — spelled out here rather than imported, because the
    // count is the claim being made: the pane offers every primitive and
    // nothing else. The six this used to expect were the list before the swept
    // pair arrived, which is the same count the list had after circle and
    // triangle were folded into their families (vg-078).
    // Reached through the group's own hook, not its heading: the heading is
    // copy, and the pane holds the file path's controls as well (`vg-211`).
    const shapes = page.locator('[data-yunari-add-group="shape"]');
    await expect(shapes.getByRole("button")).toHaveCount(8);
    // Both lists are groups, so neither is orphaned under the other's legend
    // and the two "Line" buttons are told apart by the group they sit in.
    const charts = page
      .locator('[data-yunari-panel="add"]')
      .getByRole("group", { name: "Chart" });
    await expect(charts.getByRole("button")).toHaveCount(4);
    await expect(
      page
        .locator("[data-yunari-add-group]")
        .getByRole("button", { name: "Line", exact: true }),
    ).toHaveCount(2);

    await insertShape(page, "Polygon");

    // A shape that is not a rectangle is still a shape: it carries material,
    // it has no corner radius to show, and it has a side count of its own.
    await expect(page.locator("[data-yunari-panel-fill]")).toBeVisible();
    await expect(page.locator("[data-yunari-panel-radius]")).toHaveCount(0);
    // The side count is geometry, and Position opens with every other question
    // now that item 13 reversed the column's closed default. The call stays
    // because this case does not care about the disclosure either way, and
    // `openPosition` opens a closed section and no-ops on an open one.
    await openPosition(page);
    const sides = page.locator("[data-yunari-shape-sides]");
    await expect(sides).toBeVisible();
    await typeInto(page, sides, "5");
    await expect(sides).toHaveValue("5");

    const envelope = (await saveEnvelope(page)) as {
      scene: { objects: ReadonlyArray<Readonly<Record<string, unknown>>> };
    };
    const polygon = envelope.scene.objects.find(
      (object) => object["type"] === "Polygon",
    );
    expect((polygon?.["points"] as unknown[]).length).toBe(5);
    // The material the author did not touch is still a palette reference, so
    // the document stays reassignable — and it is the card token, because a
    // polygon filled with the scene's own backdrop is not a shape at all.
    expect(polygon?.["yunariPaint"]).toEqual({ fill: "palette.panel" });
  });

  test("reassigns an authored panel's fill, stroke and shadow before deleting a token", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await openPane(page, "Add");
    // The Add pane's shapes are a group: "Line" is both a chart family and a
    // primitive, so the legend is what tells the two apart.
    await insertShape(page, "Rectangle");
    const panelId = (await activeId(page)) ?? "";
    const stroke = page.locator("[data-yunari-panel-stroke]");
    const shadow = page.locator("[data-yunari-panel-shadow]");
    await chooseIn(page, stroke, "palette.text");
    await chooseIn(page, shadow, "palette.text");
    // The picker prints the token's name, so the choice is readable before the
    // save is: without this the case would only fail at the envelope, several
    // steps after the click that went wrong.
    expect(await choiceOf(stroke)).toBe("Text");
    expect(await choiceOf(shadow)).toBe("Text");
    // `text` is the token the new panel's border and shadow now point at. The
    // palette panel is the Tokens pane's, so it is in the Tokens pane.
    await openPane(page, "Tokens");
    // The Tokens pane's choosers are Base UI selects now, so a choice is a
    // click into an opened listbox rather than a native `selectOption`.
    await chooseIn(page, "[data-yunari-palette-token]", "text");
    await chooseIn(page, "[data-yunari-palette-replacement]", "dim");
    await page.locator("[data-yunari-palette-delete]").click();

    const envelope = (await saveEnvelope(page)) as {
      globals: { palette: Record<string, unknown> };
      scene: { objects: ReadonlyArray<Readonly<Record<string, unknown>>> };
    };
    expect(envelope.globals.palette.text).toBeUndefined();
    // A deleted token that reached only the fill would leave a border and a
    // shadow pointing at a token the palette no longer has — and the save
    // would refuse the document rather than persist it.
    const panel = envelope.scene.objects.find(
      (object) => object["id"] === panelId,
    );
    expect(panel).toBeDefined();
    expect(panel?.["yunariPaint"]).toEqual({
      fill: "palette.panel",
      stroke: "palette.dim",
      shadowColor: "palette.dim",
    });
  });

  test("ships the starter's frosted CPU card, reads it live, and round-trips it", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible();

    // The card is a rectangle carrying the treatment, a two-run reading and a
    // line chart — so it is selected and inspected like anything else an
    // author would click, and the control reads back what the document says.
    // **The frosted panel is a part of the card's group**, and a part is
    // selectable only while that group is entered: a click on the card alone
    // selects the card, which carries none of the treatment below. Entering is
    // what makes the panel a row a click can pick.
    await enterLayer(page, "group-cpu-card");
    // The tree's two answers, one gesture apart and both asserted: the entered
    // card's *own* row still selects the card, and the panel's row selects the
    // part. A tree that answered the part for both would put the card beyond
    // reach the moment the author went into it.
    //
    // **Click the row's own body, not its centre.** Once a row is entered and
    // attended it draws its state controls over the right two thirds of itself
    // — on this row `.yunari-layer-state` spans x 155-277 of 58-279 — and the
    // element at the row's centre is the `Leave group-cpu-card` button. A
    // centre click therefore leaves the group instead of selecting the row,
    // and the part row this test needs next is gone. An author aiming at a row
    // aims at its name for the same reason.
    await page
      .locator('[data-yunari-layer="group-cpu-card"]')
      .click({ position: { x: 30, y: 13 } });
    await expect.poll(() => activeId(page)).toBe("group-cpu-card");
    await page.locator('[data-yunari-layer="cpu-card"]').click();
    await expect.poll(() => activeId(page)).toBe("cpu-card");
    const enabled = page.locator("[data-yunari-glass-enabled]");
    const blur = page.locator("[data-yunari-glass-blur]");
    await expect(enabled).toBeChecked();
    // The card's own authored radius, read back through the control: 40 is the
    // value that dissolves the sunset's structure behind the glass, so a
    // control showing anything else would mean the control invented a default.
    await expect(blur).toHaveValue("40");

    // The reading is a **value** run, not authored text. The editor paints
    // the reading by default — a dashboard showing `@cpu.load` where the reader
    // expects a number is not a preview of the thing — and the em-dash
    // placeholder it replaces is gone. Read through the editor bridge, because
    // `canvasProp` addresses the player's handle.
    const painted = () =>
      page.evaluate(() => {
        const bridge = (
          window as unknown as {
            yunariEditorBridge: {
              editor: {
                canvas: {
                  getObjects(): Array<{ get(name: string): unknown }>;
                };
              };
            };
          }
        ).yunariEditorBridge;
        // Groups descended: the reading is painted on a part of the card, and
        // a search of the root list answered `undefined` for an object the
        // editor was visibly rendering a number into.
        const find = (
          objects: ReadonlyArray<{
            get(name: string): unknown;
            getObjects?: () => readonly unknown[];
          }>,
        ): { get(name: string): unknown } | undefined => {
          for (const candidate of objects) {
            if (candidate.get("id") === "cpu-card-value") return candidate;
            const found = find(
              (candidate.getObjects?.() ?? []) as ReadonlyArray<{
                get(name: string): unknown;
              }>,
            );
            if (found !== undefined) return found;
          }
          return undefined;
        };
        return String(
          find(
            bridge.editor.canvas.getObjects() as ReadonlyArray<{
              get(name: string): unknown;
              getObjects?: () => readonly unknown[];
            }>,
          )?.get("text"),
        );
      });

    await expect.poll(painted, { timeout: 15_000 }).toMatch(/^\d+%$/);

    // The token view is the deliberate override, and it is what an author needs
    // to see which binding a run names. Nothing else proves it survives the
    // canvas default moving away from it, so it is switched on and off here.
    // **Pick the mode, rather than re-opening the menu and hoping.** These View
    // entries are submenu triggers labelled with the *current* value, so
    // clicking "Value runs: values" opens the modes and changes nothing — the
    // body below then asserted the token view and the value view against a
    // setting it had never actually touched, which is why it was red at base
    // as well as here.
    // **Matched on the label, not on its current value.** The trigger reads
    // `Value runs: <current>`, so pinning the whole string means the test has to
    // predict which of the two the menu will be showing when it looks — and a
    // wrong guess is a 30s wait on an element that exists under another name.
    // **The menu is opened once.** Picking a radio closes the submenu and
    // leaves the parent open, so re-clicking `View` closed the whole thing and
    // the next lookup waited out the budget on a menu that had been dismissed.
    await page.getByRole("button", { name: "View", exact: true }).click();
    const valueRuns = async (mode: "tokens" | "values"): Promise<void> => {
      await page.getByRole("menuitem", { name: /^Value runs:/ }).click();
      await page.getByRole("menuitemradio", { name: mode }).click();
    };
    await valueRuns("tokens");
    await expect.poll(painted, { timeout: 15_000 }).toContain("cpu.load");
    await valueRuns("values");
    await expect.poll(painted, { timeout: 15_000 }).toMatch(/^\d+%$/);

    await captureVisualReview(page, testInfo, "editor-starter-cpu-card");

    // Save, reopen, and the treatment is still authored state rather than a
    // cache the round trip dropped.
    const saved = await savePackage(page);
    expect(saved.parsed.ok).toBe(true);
    await openThemeFromStore(page, storedThemeOfPackage(saved.bytes));
    const reopened = (await saveEnvelope(page)) as {
      scene: { objects: ReadonlyArray<Readonly<Record<string, unknown>>> };
      bindings?: Record<string, ReadonlyArray<{ semanticKey: string }>>;
    };
    const card = sceneObject(reopened, "cpu-card");
    expect(card?.["yunariGlass"]).toEqual({ blurRadius: 40 });
    // Both halves of the card still read the same key after the round trip.
    expect(reopened.bindings?.["cpu-card-value"]).toEqual([
      expect.objectContaining({ semanticKey: "cpu.load" }),
    ]);
    expect(reopened.bindings?.["cpu-card-sparkline"]).toEqual([
      expect.objectContaining({ semanticKey: "cpu.load" }),
    ]);
  });

  test("captures an arc and a wedge on the canvas for visual review", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    // Task 4 shipped both primitives and **nobody had looked at one**. The
    // geometry assertions say an arc is an open sweep and a wedge a closed
    // quarter-disc; only a picture says whether the thing on the canvas looks
    // like the word. Captured from the Add pane, so what is photographed is
    // what an author gets rather than a hand-placed shape.
    await page.goto(EDITOR);
    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible();

    await openPane(page, "Add");
    await insertShape(page, "Arc");
    await openPane(page, "Add");
    await insertShape(page, "Wedge");

    // Both arrived at the quarter turn the Add pane hands over, and they are
    // not the same shape: an open sweep has no interior to fill, so it is
    // stroked, while the sector is a region and takes the fill. A filled arc
    // closes with a chord and draws a circular segment — refused at revival
    // (ADR-0026) — so this is what makes the two pictures mean different things.
    //
    // Read from the **saved document**, not from the live objects: Fabric gives
    // every shape a runtime default `fill`, so a live read cannot tell an
    // authored fill from the one Fabric supplied, and the first version of this
    // assertion read `true` for an arc the Add pane never filled.
    const envelope = (await saveEnvelope(page)) as {
      scene: { objects: Array<Record<string, unknown>> };
    };
    const shapes = envelope.scene.objects
      .filter((object) => {
        const type = String(object["type"] ?? "").toLowerCase();
        return type === "arc" || type === "wedge";
      })
      .map((object) => ({
        type: String(object["type"] ?? "").toLowerCase(),
        // Zero is Fabric's own default, and the serialiser writes authored
        // deviations only — so an absent `startAngle` **is** a start of 0. The
        // same rule that keeps an object's own `locked: false` out of a saved
        // document.
        startAngle: object["startAngle"] ?? 0,
        endAngle: object["endAngle"],
        // `null` is how Fabric spells "no fill", and the Add pane writes exactly that
        // for an arc — so an absent key and a null one both mean unfilled.
        filled: object["fill"] != null && object["fill"] !== "",
        stroked: object["stroke"] != null && object["stroke"] !== "",
      }));

    const arc = shapes.find((shape) => shape.type === "arc");
    const wedge = shapes.find((shape) => shape.type === "wedge");
    expect(arc, "the Add pane inserted an arc").toBeDefined();
    expect(wedge, "the Add pane inserted a wedge").toBeDefined();
    // The quarter turn is what the primitive is for: a quarter-disc without
    // hand-authoring an SVG path.
    expect([arc?.startAngle, arc?.endAngle]).toEqual([0, 90]);
    expect([wedge?.startAngle, wedge?.endAngle]).toEqual([0, 90]);
    expect(arc?.filled, "an arc has no interior, so it is not filled").toBe(
      false,
    );
    expect(arc?.stroked, "an arc is a curve, so it is stroked").toBe(true);
    expect(wedge?.filled, "a wedge is a region, so it is filled").toBe(true);

    await captureVisualReview(page, testInfo, "editor-arc-and-wedge");
  });

  test("captures the mounted editor for visual review", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible();

    await captureVisualReview(page, testInfo, "editor");
  });

  test("suppresses motion when the user asks for reduced motion", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(EDITOR);
    const duration = await page
      .locator(".editor-shell-panel")
      .evaluate((el) => getComputedStyle(el).animationDuration);
    expect(duration).toBe("0s");

    // The media block suppresses transitions as well as animations, so read a
    // control too: the animation assertion alone cannot see that half.
    const controlTransition = await page
      .locator(".editor-shell button")
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(controlTransition).toBe("0s");

    // With the guard absent the reveal must be a real animation. Duration alone
    // stays 0.16s when the @keyframes block is deleted, so read the effect.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const reveal = await page.locator(".editor-shell-panel").evaluate((el) => {
      // The reveal runs once on mount and leaves getAnimations() when it ends,
      // so restart it before sampling.
      el.style.animation = "none";
      el.getBoundingClientRect();
      el.style.animation = "";
      const effect = el.getAnimations()[0]?.effect;
      return {
        duration: getComputedStyle(el).animationDuration,
        keyframes:
          effect instanceof KeyframeEffect ? effect.getKeyframes().length : 0,
      };
    });
    expect(reveal.duration).not.toBe("0s");
    expect(reveal.keyframes).toBeGreaterThanOrEqual(2);

    // The suppression assertion above reads 0s whether or not the shorthand
    // exists, so pin the shorthand itself: five compositor-owned properties,
    // never a layout one.
    const motion = await page
      .locator(".editor-shell button")
      .first()
      .evaluate((el) => ({
        properties: getComputedStyle(el).transitionProperty,
        duration: getComputedStyle(el).transitionDuration,
      }));
    expect(motion.properties).toBe(
      "background-color, border-color, color, transform, opacity",
    );
    expect(motion.duration).toBe("0.14s, 0.14s, 0.14s, 0.14s, 0.14s");

    const injectedTransition = (locator: Locator) =>
      locator.evaluate((el) => {
        el.style.transition = "opacity 200ms ease";
        return getComputedStyle(el).transitionDuration;
      });

    // Base UI portals the popup to `body`, where `.editor-shell *` cannot reach
    // it, so the media block names the popup's own class. Without the injection
    // this reads 0s either way and would pass with that selector deleted; with
    // it, only the media block can produce the 0s below.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.getByRole("button", { name: "View", exact: true }).click();
    // The zoom readout's popup stays mounted (`keepMounted`), so two popups are
    // in the DOM; only the open View menu's is visible.
    const popup = page.locator(".editor-shell-menu-popup:visible");
    await expect(popup).toBeVisible();
    // Anchored to the View popup's own item, not merely to "a visible popup": the
    // zoom menu also satisfies `:visible`, so a popup-agnostic locator would let
    // the positive control pass while measuring the wrong menu.
    await expect(
      popup.getByRole("menuitem", { name: /Value runs/ }),
    ).toBeVisible();
    await expect.poll(() => injectedTransition(popup)).toBe("0.2s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(() => injectedTransition(popup)).toBe("0s");

    // The menu item is the element a hover transition would land on, and it is
    // outside `.editor-shell`, so the in-shell shorthand
    // `.editor-shell [role="menuitem"]` cannot reach it — the popup's own `*`
    // line is its only suppression. Without this assertion, adding a transition
    // to a menu row and deleting the `*` lines leaves the suite green under
    // `reduce`.
    const menuItem = popup.getByRole("menuitem", { name: /Value runs/ });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect.poll(() => injectedTransition(menuItem)).toBe("0.2s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(() => injectedTransition(menuItem)).toBe("0s");

    // The positioner is a separate portalled element, styled in its own right
    // (`z-index: 60`), and it is NOT covered by the popup's selectors — the popup
    // nests inside it, not the reverse. A popup-position animation lands here.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const positioner = page.locator(".editor-shell-positioner:visible");
    await expect(positioner).toBeVisible();
    await expect.poll(() => injectedTransition(positioner)).toBe("0.2s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(() => injectedTransition(positioner)).toBe("0s");

    // The dock tooltip is portalled under its own class, and its positioner carries
    // no class at all — so `.editor-shell-tooltip` is the whole of its coverage. The
    // dock renders no triggers until something is selected.
    await page.keyboard.press("Escape");
    await expect(popup).toBeHidden();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await selectStarterChart(page);
    const dock = page.locator("[data-yunari-canvas-toolbar]");
    await dock.getByRole("button", { name: "Duplicate" }).hover();
    const tooltip = page.locator(".editor-shell-tooltip");
    await expect(tooltip).toBeVisible();
    await expect.poll(() => injectedTransition(tooltip)).toBe("0.2s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(() => injectedTransition(tooltip)).toBe("0s");
  });

  test("a subject the treatment cannot reach is offered no glass section, and says why in the column", async ({
    page,
  }, testInfo) => {
    /**
     * **Re-pointed twice, and this is the second reversal.** The reason used to
     * reach the row through `tooltip()`, and the browser half of the fix this
     * case proved was placement: an out-of-flow popup measured before it was
     * pinned landed on top of its own trigger, so hover never settled and only
     * focus showed it. DESIGN.md §5.3 moved refusals out of tooltips and into the
     * row — `control-well.tsx`'s `ControlRow` renders the reason as words — so
     * there is no popup left to place, and the flicker it caused cannot recur.
     * Then `vg-465`, the author's own ruling, took the row away with the section
     * for a subject the treatment cannot reach.
     *
     * What survives both is the claim, and it is the one asserted here: the
     * author is **told**, in words they meet without an interaction, on the
     * surface that names the thing the words are about. The control is gone, so
     * there is no longer an `aria-describedby` to follow and no tab stop to
     * argue about — what is read instead is the absence, and the sentence.
     *
     * A `Path` is one of the kinds the treatment cannot reach, and the reason
     * named for it is a full sentence.
     */
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible();
    // By id rather than by Fabric's class tag, and through the card rather than
    // around it: the starter's icons are paths *inside* their cards, so a search
    // of `getObjects()` never saw one and threw "the starter has no Path" for a
    // shape the author can click. Entering the card is also the gesture the spec
    // defines for reaching a part, and it opens the card in the layer tree on
    // the way — so the icon is selected the way an author selects it.
    await enterLayer(page, "group-cpu-card");
    await page.locator('[data-yunari-layer="cpu-card-icon"]').click();
    await expect.poll(() => activeId(page)).toBe("cpu-card-icon");

    const control = page.locator("[data-yunari-glass-enabled]");
    // Withheld, not refused: the control the section carried is absent, so there
    // is no operable-looking switch left to hunt for.
    await expect(control).toHaveCount(0);
    await expect(page.locator("[data-yunari-glass-blur]")).toHaveCount(0);

    // The words the author meets instead, under the subject the column names.
    // Read off the hook the block publishes rather than a spelled control id:
    // the claim is that the reason is on screen and is the one named for this
    // kind, which holds whatever the column mints ids as.
    const reason = page.locator("[data-yunari-glass-refusal]");
    await expect(reason).toBeVisible();
    await expect(reason).toContainText("Path");
  });

  test("captures selected chart binding controls for visual review", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await selectStarterChart(page);
    await chooseIn(
      page,
      '[data-yunari-binding="ram-gauge-percent"]',
      "ram.used",
    );
    const precision = page.locator(
      '[data-yunari-binding-field="ram-gauge-percent.precision"]',
    );
    await precision.fill("2");
    await precision.press("Tab");
    await expect(precision).toHaveValue("2");
    const progressPaint = page.locator('[data-yunari-chart-paint="progress"]');
    await progressPaint.scrollIntoViewIfNeeded();
    await expect(progressPaint).toBeVisible();

    await captureVisualReview(page, testInfo, "editor-chart-binding");
  });

  test("captures the controls that give a text run its reading", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    // The starter theme's clock is authored as a value run, so selecting it
    // shows what an author chooses to read and how it should read. It is a part
    // of the time card, and a part is reached by **entering** its group: with
    // the card merely opened in the tree, a row click still selects the card,
    // which has no run controls.
    await enterLayer(page, "group-time-card");
    await page.locator('[data-yunari-layer="time"]').click();
    const source = page.locator('[data-yunari-run-source="0"]');
    await expect(source).toBeVisible();
    // The run's pickers are plan 1's selects now, so what they show is the label
    // of the choice rather than the value behind it: `time.now` reads `Time`.
    expect(await choiceOf(source)).toBe("Time");
    const format = page.locator('[data-yunari-run-format="0"]');
    await expect(format).toBeVisible();
    // The starter clock's own tokens, so the reading below is one this test can
    // compute rather than one it wrote.
    await expect(format).toHaveValue("hh:mm");

    // A clock pinned to another city is the point of a world clock, so the zone
    // has to change the reading rather than only the envelope: the control is
    // rebuilt from what was written, and the preview follows it. A zone names
    // itself, so its value and its label are the same string.
    const zone = page.locator('[data-yunari-run-zone="0"]');
    expect(await choiceOf(zone)).toBe("Follow the display");
    await chooseIn(page, '[data-yunari-run-zone="0"]', "Asia/Tokyo");
    expect(await choiceOf(zone)).toBe("Asia/Tokyo");
    await expect
      .poll(
        async () => {
          const shown = (
            await page
              .locator('[data-yunari-run-format-preview="0"]')
              .textContent()
          )?.trim();
          const tokyo = await page.evaluate(() => {
            const parts = new Intl.DateTimeFormat("en-GB", {
              timeZone: "Asia/Tokyo",
              hour12: true,
              hour: "2-digit",
              minute: "2-digit",
            }).formatToParts(new Date());
            const part = (type: string): string =>
              parts.find((entry) => entry.type === type)?.value ?? "";
            return `${part("hour")}:${part("minute")}`;
          });
          return shown === tokyo;
        },
        { timeout: 10_000 },
      )
      .toBe(true);

    await zone.scrollIntoViewIfNeeded();

    await captureVisualReview(page, testInfo, "editor-text-reads");
  });

  test("captures semantic layer controls for visual review", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    // The gauge is a part of the RAM card, so the card is opened first.
    await expandLayer(page, "group-ram-card");
    const layer = page.locator('[data-yunari-layer="ram-gauge"]');
    await expect(layer).toBeVisible();
    await layer.click();
    // The **card** is what carries the selection marker, not the row that was
    // clicked: `selectLayer` reaches a child through its owning group, because
    // a bare child has no transform controls of its own. Asserting the marker
    // on the part would pin the opposite of the rule, and the part's own row
    // is still here to be styled and renamed.
    await expect(
      page.locator('[data-yunari-layer="group-ram-card"]'),
    ).toHaveAttribute("aria-selected", "true");
    // One dense line per layer: the row's own controls, not the old six text
    // buttons. The pointer rests on the row, so both are drawn — visibility and
    // lock. It was three until `vg-462` took the rename pen off the row, since
    // double-clicking the name already opens it for typing.
    await expect(layer.locator("button")).toHaveCount(2);
    await expect(layer.locator('[aria-label="Hide"]')).toBeVisible();

    await captureVisualReview(page, testInfo, "editor-layer-arrange");
  });

  test("captures changed artboard controls for visual review", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    // The artboard panel is a document panel, so it is in the Document pane.
    await openPane(page, "Document");
    await page.locator("[data-yunari-artboard-width]").fill("1000");
    await page.locator("[data-yunari-artboard-width]").press("Tab");
    // The board's paint is the background layer's now, so it is written where
    // the layer is selected rather than in the Document pane.
    await selectLayer(page, "Background");
    await chooseIn(page, "[data-yunari-background]", "palette.bars");
    // The committed reference, read off the control's own hook: the paint
    // chooser is plan 1's select now — a button, whose `.value` is always "".
    await expect(
      page.locator("[data-yunari-background] [data-yunari-value]"),
    ).toHaveAttribute("data-yunari-value", "palette.bars");
    // Back to the Document pane for the capture this action is registered for;
    // selecting the background survives the pane swap.
    await openPane(page, "Document");
    await expect(page.locator("[data-yunari-artboard-width]")).toHaveValue(
      "1000",
    );

    await captureVisualReview(page, testInfo, "editor-artboard");
  });

  test("rejects literal artboard paint in a v2 document", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await setUncheckedThemePackage(
      page,
      {
        schemaVersion: 2,
        fabricVersion: "7.4.0",
        id: "literal-bars",
        metadata: { themeLanguage: "en" },
        artboard: {
          width: 1000,
          height: 720,
        },
        background: { color: { value: ARTBOARD_BACKGROUND_PAINT } },
        scene: { version: "7.4.0", objects: [] },
      },
      /Invalid theme/,
    );
    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible();
  });

  test("renders palette gradients on the native Fabric artboard", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await setThemePackage(page, {
      schemaVersion: 2,
      fabricVersion: "7.4.0",
      id: "gradient-artboard",
      metadata: { themeLanguage: "en" },
      artboard: {
        width: 1000,
        height: 720,
      },
      background: { color: { ref: "palette.background" } },
      globals: {
        palette: {
          none: {
            name: "None",
            value: { kind: "solid", color: "transparent" },
          },
          background: {
            name: "Background",
            value: {
              kind: "gradient",
              angle: 0,
              stops: [
                { offset: 0, color: BACKGROUND_PAINT },
                { offset: 1, color: BACKGROUND_END_PAINT },
              ],
            },
          },
          bars: {
            name: "Bars",
            value: {
              kind: "gradient",
              angle: 90,
              stops: [
                { offset: 0, color: BARS_START_PAINT },
                { offset: 1, color: BARS_END_PAINT },
              ],
            },
          },
        },
      },
      scene: { version: "7.4.0", objects: [] },
    });
    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible();

    await captureVisualReview(page, testInfo, "editor-artboard-gradient");
  });

  test("edits an artboard palette token through the property surface", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    // The palette panel is the Tokens pane's, so it is in the Tokens pane.
    await openPane(page, "Tokens");
    await chooseIn(page, "[data-yunari-palette-token]", "background");
    const color = page.locator("[data-yunari-palette-color]");
    await color.fill("rgb(16 32 48)");
    await color.press("Tab");
    await expect(color).toHaveValue("rgb(16 32 48)");

    const envelope = (await saveEnvelope(page)) as {
      globals: { palette: { background: { value: unknown } } };
    };
    expect(envelope.globals.palette.background.value).toEqual({
      kind: "solid",
      color: "rgb(16 32 48)",
    });

    await captureVisualReview(page, testInfo, "editor-palette-solid");
  });

  test("reassigns palette references before deleting a token", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    // The artboard must reference the token before it is deleted, or the
    // reassignment has nothing to reassign and the test passes for the wrong
    // reason. The board's one paint is `background`, so it is pointed at `bars`
    // here where the background layer is selected — the pane that owns it.
    await selectLayer(page, "Background");
    await chooseIn(page, "[data-yunari-background]", "palette.bars");
    // The palette panel is the Tokens pane's, so it is in the Tokens pane.
    await openPane(page, "Tokens");
    await chooseIn(page, "[data-yunari-palette-token]", "bars");
    await chooseIn(page, "[data-yunari-palette-replacement]", "panel");
    await captureVisualReview(page, testInfo, "editor-palette-reassignment");
    await page.locator("[data-yunari-palette-delete]").click();
    // The row is the token's own well in the list, so a deletion takes the
    // whole row with it — the same fact `option[value="bars"]` stated about
    // the native chooser it used to be.
    await expect(
      page.locator('[data-yunari-palette-token-row="bars"]'),
    ).toHaveCount(0);

    const envelope = (await saveEnvelope(page)) as {
      background?: { color?: { ref: string } };
      globals: { palette: Record<string, unknown> };
    };
    expect(envelope.background?.color).toEqual({ ref: "palette.panel" });
    expect(envelope.globals.palette.bars).toBeUndefined();
  });

  test("reassigns chart paint before deleting its palette token", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    // The palette panel is the Tokens pane's, so it is in the Tokens pane.
    await openPane(page, "Tokens");
    await chooseIn(page, "[data-yunari-palette-token]", "chartTrack");
    await chooseIn(page, "[data-yunari-palette-replacement]", "bars");
    await page.locator("[data-yunari-palette-delete]").click();

    const envelope = (await saveEnvelope(page)) as {
      globals: { palette: Record<string, unknown> };
      scene: {
        objects: Array<{
          id?: string;
          settings?: { track?: { ref?: string } };
        }>;
      };
    };
    expect(envelope.globals.palette.chartTrack).toBeUndefined();
    expect(
      (
        sceneObject(envelope, "ram-gauge")?.["settings"] as
          | { track?: unknown }
          | undefined
      )?.track,
    ).toEqual({ ref: "palette.bars" });
  });

  test("edits a global type preset through the property surface", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await page.route("https://cdn.jsdelivr.net/fontsource/fonts/**", (route) =>
      route.fulfill({ body: Buffer.from([0, 1, 2]) }),
    );
    // The type-preset panel is the Tokens pane's, so it is in the Tokens pane.
    await openPane(page, "Tokens");
    await chooseIn(page, "[data-yunari-type-preset]", "36-500");
    // Read the option the panel offers rather than typing an id: the picker's
    // rows come from the generated catalogue, so a literal here pins one
    // revision of it.
    const [faceId] = await optionsOf(page, "[data-yunari-font-face]");
    await chooseIn(page, "[data-yunari-font-face]", faceId!);
    await page.locator("[data-yunari-font-apply]").click();
    const size = page.locator("[data-yunari-type-size]");
    await size.fill("34");
    await size.press("Tab");
    await expect(size).toHaveValue("34");
    const letterSpacing = page.locator("[data-yunari-type-letter-spacing]");
    await letterSpacing.fill("0.25");
    await letterSpacing.press("Tab");

    const saved = await savePackage(page);
    await openThemeFromStore(page, storedThemeOfPackage(saved.bytes));
    // Reopening a package remounts the shell, so the pane is shut again.
    await openPane(page, "Tokens");
    await chooseIn(page, "[data-yunari-type-preset]", "36-500");
    const reopened = (await saveEnvelope(page)) as {
      globals: {
        typePresets: {
          "36-500": {
            value: {
              size: number;
              letterSpacing: number;
              face: { assetId: string };
              trioRole: string;
            };
          };
        };
      };
    };
    expect(reopened.globals.typePresets["36-500"].value).toMatchObject({
      size: 34,
      letterSpacing: 0.25,
      face: { assetId: faceId! },
      trioRole: "heading",
    });
    await page
      .locator("[data-yunari-type-letter-spacing]")
      .scrollIntoViewIfNeeded();
    await captureVisualReview(page, testInfo, "editor-type-preset");
  });

  test("paints a preset's tracking into the rendered wordmark", async ({
    page,
  }, testInfo) => {
    // The one assertion the unit tests cannot make: that ink actually moves.
    // `applyObjectTypePresets` could set `charSpacing` correctly and the canvas
    // could still not show it.
    //
    // Measured as pixels rather than as the object's `width`, because the
    // wordmark is a `Textbox` — its width is the authored box, which tracking
    // does not change. What tracking changes is where the ink lands inside it.
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    // The type-preset panel is the Tokens pane's, so it is in the Tokens pane.
    await openPane(page, "Tokens");
    await chooseIn(page, "[data-yunari-type-preset]", "36-500");
    const tracking = page.locator("[data-yunari-type-letter-spacing]");

    await tracking.fill("0");
    await tracking.press("Tab");
    const untracked = await inkReachOf(page, "wordmark");

    await tracking.fill("6");
    await tracking.press("Tab");
    const tracked = await inkReachOf(page, "wordmark");

    // Six gaps at 6px each is 36px of extra tracking at 36px. The bar is
    // below that, so a resampling artefact cannot produce it — but it has to be
    // real ink, and ink only reaches that far if the tracking propagated.
    expect(untracked).toBeGreaterThan(0);
    expect(tracked - untracked).toBeGreaterThan(8);
  });

  test("captures curated font trio controls for visual review", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    // The type-preset panel is the Tokens pane's, so it is in the Tokens pane.
    await openPane(page, "Tokens");
    await chooseIn(page, "[data-yunari-type-preset]", "36-500");
    const face = page.locator("[data-yunari-font-face]");
    await face.scrollIntoViewIfNeeded();
    await expect(face).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Apply trio" }),
    ).toBeVisible();
    // Nothing was chosen, so the helper's dark OS is what puts this on the
    // shipping default; `ground` is asserted before the shot, not after it, so a
    // late re-render cannot leave a light PNG behind a green assertion.
    await captureVisualReview(
      page,
      testInfo,
      "editor-font-trio",
      undefined,
      "graphite",
    );
    // Two palettes, for the reason the control set pairs them: these choosers
    // are wells with an accent boundary and a popup, and editorial is the light
    // ground the same vocabulary has to hold on as well as graphite.
    await choosePalette(page, "editorial");
    await face.scrollIntoViewIfNeeded();
    await expect(face).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Apply trio" }),
    ).toBeVisible();
    // No `ground` here: `choosePalette` already asserts the attribute, and the
    // stored choice disarms the OS listener, so the helper's emulation cannot
    // repaint it.
    await captureVisualReview(page, testInfo, "editor-font-trio-editorial");
  });

  test("reassigns text type presets before deleting one", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    // The type-preset panel is the Tokens pane's, so it is in the Tokens pane.
    await openPane(page, "Tokens");
    await chooseIn(page, "[data-yunari-type-preset]", "20-400");
    await chooseIn(page, "[data-yunari-type-replacement]", "24-400");
    await page.locator("[data-yunari-type-delete]").scrollIntoViewIfNeeded();
    await captureVisualReview(page, testInfo, "editor-type-reassignment");
    await page.locator("[data-yunari-type-delete]").click();
    // The row is the preset's own resolution line in the list, so a deletion
    // takes the whole row with it — the same fact `option[value="20-400"]`
    // stated about the native chooser it used to be.
    await expect(
      page.locator('[data-yunari-type-preset-row="20-400"]'),
    ).toHaveCount(0);

    const envelope = (await saveEnvelope(page)) as {
      globals: { typePresets: Record<string, unknown> };
      scene: {
        objects: Array<{
          id?: string;
          yunariText?: { runs: Array<{ typePreset?: string }> };
        }>;
      };
    };
    expect(envelope.globals.typePresets["20-400"]).toBeUndefined();
    expect(
      (
        sceneObject(envelope, "cpu-card-title")?.["yunariText"] as
          | { runs: ReadonlyArray<{ typePreset?: string }> }
          | undefined
      )?.runs[0]?.typePreset,
    ).toBe("typePresets.24-400");
  });

  test("captures dirty document replacement confirmation for visual review", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    // **An authoring act, not a canvas write.** The guard asks
    // `persistence.isDirty`, which compares the session's snapshot against what
    // it last saved; setting a Fabric property through the global reaches the
    // canvas and not the snapshot, so a `set("left", 64)` here left the document
    // as saved as it started and New asked nothing. Inserting a shape is the
    // session's own path and is what actually makes the document dirty.
    await openPane(page, "Add");
    await insertShape(page, "Rectangle");

    await page.keyboard.press("Control+n");
    // New asks the size first (`editor-document.ts`'s `newDocument`), then this.
    await expect(
      page.locator('[role="dialog"]', { hasText: "Choose an artboard size" }),
    ).toBeVisible();
    await page.locator("[data-yunari-new-document-create]").click();
    await expect(
      page.locator('[role="dialog"]', {
        hasText: "Save changes before opening another theme?",
      }),
    ).toBeVisible();

    await captureVisualReview(page, testInfo, "editor-dirty-replacement");
  });

  test("captures the new-document chooser's own surface for visual review", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await page.keyboard.press("Control+n");
    // The size chooser is the first of New's two questions, and the surface the
    // conversion rewrote: it was a `<dialog>` of `<select>`s and is a Base UI
    // `Dialog` of `ControlSelect`s now. **This capture is why the row above
    // stayed as it was** — `editor-dirty-replacement` matched this same first
    // dialog before the conversion too, so its image was always the chooser.
    await expect(
      page.locator('[role="dialog"]', { hasText: "Choose an artboard size" }),
    ).toBeVisible();

    await captureVisualReview(page, testInfo, "editor-new-document-chooser");
  });

  test("captures the theme-library chooser over a stubbed library for visual review", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    // **A stubbed library, not the real host.** `openLibrary` awaits
    // `client.list()` before it opens anything (`ThemeLibraryManager.open` in
    // `theme-library-manager/index.ts`), so on the preview server the chooser
    // never appears at all. The stub answers the
    // one request the chooser makes, and the list, the two groups and the delete
    // control that follows a selection are all the real component's.
    await page.route("**/api/themes", (route) =>
      route.fulfill({
        json: {
          themes: [
            {
              id: "graphite-desk",
              name: "Graphite desk",
              updatedAt: "",
              facets: LISTED_THEME_FACETS,
            },
            {
              id: "editorial-wall",
              name: "Editorial wall",
              updatedAt: "",
              facets: LISTED_THEME_FACETS,
            },
          ],
        },
      }),
    );
    await page.goto(EDITOR);
    // Dirty by an authoring act first, for the reason the replacement capture
    // gives. An untouched starter is *not* dirty: File → Open library would ask
    // nothing, and `answerDialogIfShown` would then find the chooser's own
    // dialog and spend its budget waiting inside it for a Discard button.
    await openPane(page, "Add");
    await insertShape(page, "Rectangle");

    await page.getByRole("button", { name: "File", exact: true }).click();
    await page.getByRole("menuitem", { name: "Open library" }).click();
    await answerDialogIfShown(page, "Discard");
    const chooser = page.locator('[role="dialog"]', {
      hasText: "Open a theme",
    });
    await expect(chooser).toBeVisible();

    // The list is opened as well, because the two groups are the chooser's whole
    // design point and the stub is only visible through them: the product's
    // template under `Templates`, the author's own under `Your themes`.
    await chooser.locator("[data-yunari-library-theme]").click();
    await expect(
      page.locator('[role="option"][data-yunari-option="graphite-desk"]'),
    ).toBeVisible();

    await captureVisualReview(page, testInfo, "editor-library-chooser");
  });

  test("selects a chart in the starter theme through the visible Fabric canvas", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    // **The canvas route, deliberately, and the reason this does not call
    // `selectStarterChart`.** That helper reaches the gauge from the layer
    // tree, which is the route the tree grew; this test's *subject* is the
    // other one, where the double-click's first press selects the card and the
    // second enters it, and the manager re-resolves the part under the pointer.
    // Both routes must reach the same chart, and only a test that makes the
    // gesture itself can say so.
    await page.goto(EDITOR);
    const centre = await clientOfStarterGauge(page);
    await page.mouse.dblclick(centre.x, centre.y);
    await expect.poll(() => activeId(page)).toBe("ram-gauge");
    await expect(
      page.locator('[data-yunari-chart-setting="thickness"]'),
    ).toBeVisible();
  });

  test("persists artboard properties without rescaling Fabric objects", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    // The artboard's own size is a document property, so it stays in the
    // Document pane; its paint and its picture's box moved to the inspector
    // when the background became a layer.
    await openPane(page, "Document");
    await page.locator("[data-yunari-artboard-width]").fill("1000");
    await page.locator("[data-yunari-artboard-width]").press("Tab");
    await selectLayer(page, "Background");
    await chooseIn(page, "[data-yunari-background-bounds]", "display");
    await chooseIn(page, "[data-yunari-background]", "palette.bars");
    await page.locator("[data-yunari-background-flip-x]").click();

    const envelope = (await saveEnvelope(page)) as {
      artboard: {
        contentFit?: string;
        width: number;
      };
      background?: {
        color?: { ref: string };
        media?: { bounds: string; flipX?: boolean };
      };
      scene: { objects: Array<{ id?: string; left?: number }> };
    };
    // The background media has no fit to author — it is always cover — so this
    // asserts the box and the mirror that do exist write what they say, and the
    // artboard's own content fit stays a guarantee of the model.
    expect(envelope.background?.media?.bounds).toBe("display");
    expect(envelope.background?.media?.flipX).toBe(true);
    expect(envelope.artboard.contentFit ?? "contain").toBe("contain");
    expect(envelope.artboard.width).toBe(1000);
    expect(envelope.background?.color).toEqual({ ref: "palette.bars" });
    expect(leftFor(envelope, "wordmark")).toBe(118);
  });

  /**
   * The media layer's own size, read where a stylesheet can reach it. Tailwind's
   * preflight — which the editor loads and the player does not — sets
   * `img, video { max-width: 100%; height: auto }`, so the placed rect's width
   * was capped at the layer's while its inline height still grew: the picture
   * stretched to the layer, and an x offset could never widen it. A jsdom test
   * cannot see a cascade, and the player has no preflight, so this can only be
   * caught on the editor's built bundle.
   */
  test("an offset zooms the background picture without distorting it", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await page.goto(EDITOR);
    await openPane(page, "Document");
    await selectLayer(page, "Background");

    const media = page.locator("[data-yunari-background-media] img");
    await expect(media).toHaveCount(1);
    await expect
      .poll(() =>
        media.evaluate((element) => {
          const image = element as HTMLImageElement;
          return image.complete && image.naturalWidth > 0;
        }),
      )
      .toBe(true);

    const read = () =>
      media.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const image = element as HTMLImageElement;
        return {
          width: box.width,
          height: box.height,
          aspect: box.width / box.height,
          naturalAspect: image.naturalWidth / image.naturalHeight,
          maxWidth: getComputedStyle(element).maxWidth,
        };
      });

    const before = await read();
    const x = page.locator("[data-yunari-background-offset-x]");
    await x.fill("50");
    await x.press("Tab");
    // The re-placement is a style write, and the rect is read after layout.
    await expect
      .poll(async () => (await read()).width)
      .toBeGreaterThan(before.width * 1.5);

    const after = await read();
    expect(after.maxWidth, "no preflight cap on the placed rect").toBe("none");
    expect(
      after.aspect,
      "the placed rect carries the source's aspect, not the layer's",
    ).toBeCloseTo(after.naturalAspect, 2);
  });

  test("offers no control for the artboard's own content fit", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    // The user read "Preview fit" as how their picture renders in the preview,
    // because it sat above the background's controls and chose between the same
    // words. It was the artboard content's fit, it is always contain, and no
    // author sets it — so neither owner must offer it, and the background's own
    // position controls (bounds and offsets, now that media is always cover)
    // must still be offered where the background layer is selected.
    await page.goto(EDITOR);
    // The artboard panel is a document panel, so the Document pane shows it.
    await openPane(page, "Document");
    await expect(page.locator("[data-yunari-artboard-fit-mode]")).toHaveCount(
      0,
    );

    await selectLayer(page, "Background");
    const bounds = page.locator("[data-yunari-background-bounds]");
    await expect(bounds).toBeVisible();
    await expect(page.locator("[data-yunari-artboard-fit-mode]")).toHaveCount(
      0,
    );
    await expect(page.locator("[data-yunari-background-fit]")).toHaveCount(0);
    await expect(page.locator("[data-yunari-background-scale]")).toHaveCount(0);
    const settingsPanel = page.locator("section", {
      has: bounds,
    });
    const labels = await settingsPanel.locator("label").allTextContents();
    expect(labels).not.toContain("Preview fit");
    expect(labels).not.toContain("Media fit");
    expect(labels).toContain("Bounds");
    expect(labels).toContain("Flip horizontally");
    // The control that does exist, still named and still choosing. Its value is
    // read off the hook the control commits through rather than `.value`: it is
    // plan 1's select, and a button's `.value` is always "".
    const chosen = bounds.locator("[data-yunari-value]");
    await expect(chosen).toHaveAttribute("data-yunari-value", "theme");
    await chooseIn(page, "[data-yunari-background-bounds]", "display");
    await expect(chosen).toHaveAttribute("data-yunari-value", "display");
  });

  test("persists a selected chart binding", async ({ page }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await selectStarterChart(page);
    await chooseIn(
      page,
      '[data-yunari-binding="ram-gauge-percent"]',
      "ram.used",
    );
    const precision = page.locator(
      '[data-yunari-binding-field="ram-gauge-percent.precision"]',
    );
    await precision.fill("2");
    await precision.press("Tab");

    const envelope = (await saveEnvelope(page)) as {
      bindings: Record<string, Array<{ id: string; semanticKey: string }>>;
    };
    expect(envelope.bindings["ram-gauge"]).toContainEqual({
      id: "ram-gauge-percent",
      semanticKey: "ram.used",
      precision: 2,
    });
  });

  test("still offers the series colour after binding a chart's first series", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    // **Binding a series to a chart emptied its own property panel**, so an
    // author who bound a reading could not then choose the series colour. The
    // paint filter kept only entries whose series survived, so an empty
    // `previous` — the *first* series — kept nothing, and `palette: [null]` is
    // not something the picker can render. Measured before the fix: this
    // selector list went from `[stroke, palette.0]` to `[]`.
    await page.goto(EDITOR);
    await openPane(page, "Add");
    // "Line" is both a chart family and a primitive, so the Chart group is what
    // tells the two apart. A gauge's paints are not per-series, which is why the
    // family has to be the one whose `palette` field repeats with the series.
    await page
      .locator('[data-yunari-panel="add"]')
      .getByRole("group", { name: "Chart" })
      .getByRole("button", { name: "Line", exact: true })
      .click();
    // A chart's paint pickers are in its own column, with its settings.

    // The key carries the index — `palette.0` — which is the token the original
    // DOM read named, `[stroke, palette.0]` before and `[]` after.
    const seriesPaint = page.locator('[data-yunari-chart-paint="palette.0"]');
    await expect
      .poll(() => seriesPaint.count(), {
        message: "a new line chart offers a series colour to choose",
      })
      .toBeGreaterThan(0);

    // And the gesture that emptied it: binding the first series must leave the
    // control in place rather than take it away.
    await chooseIn(page, "[data-yunari-chart-binding-add]", "cpu.load");
    // The paint first, because that is the reported symptom and the binding row
    // is downstream of it: with the bug in place the whole panel content goes,
    // so asserting the row first would report the crash rather than the loss.
    await expect
      .poll(() => seriesPaint.count(), {
        message: "binding a series leaves the chart's series colour offered",
      })
      .toBeGreaterThan(0);
    await expect(page.locator("[data-yunari-binding]")).toHaveCount(1);
  });

  test("persists selected chart paint as a palette reference", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await selectStarterChart(page);
    await chooseIn(
      page,
      '[data-yunari-chart-paint="progress"]',
      "palette.chartTrack",
    );

    const envelope = (await saveEnvelope(page)) as {
      scene: {
        objects: Array<{
          id?: string;
          settings?: { progress?: { ref?: string } };
        }>;
      };
    };
    expect(
      (
        sceneObject(envelope, "ram-gauge")?.["settings"] as
          | { progress?: unknown }
          | undefined
      )?.progress,
    ).toEqual({ ref: "palette.chartTrack" });
  });

  test("refreshes bound text without saving its sampled value", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await setThemePackage(page, {
      schemaVersion: 2,
      fabricVersion: "7.4.0",
      id: "live-text",
      metadata: { themeLanguage: "en" },
      artboard: {
        width: 320,
        height: 180,
      },
      background: { color: { ref: "palette.background" } },
      globals: {
        palette: {
          none: {
            name: "None",
            value: { kind: "solid", color: "transparent" },
          },
          background: {
            name: "Background",
            value: { kind: "solid", color: BACKGROUND_PAINT },
          },
          ink: { name: "Ink", value: { kind: "solid", color: ACCENT_PAINT } },
        },
        typePresets: {
          body: { name: "Body", value: { family: "sans-serif", size: 16 } },
        },
      },
      bindings: {
        "cpu-label": [{ id: "load", semanticKey: "cpu.load", precision: 0 }],
      },
      scene: {
        version: "7.4.0",
        objects: [
          {
            type: "Textbox",
            id: "cpu-label",
            left: 20,
            top: 20,
            width: 200,
            text: "CPU --",
            originX: "left",
            originY: "top",
            fill: ACCENT_PAINT,
            yunariPaint: { fill: "palette.ink" },
            yunariText: {
              runs: [
                {
                  kind: "literal",
                  text: "CPU ",
                  typePreset: "typePresets.body",
                  style: { color: { ref: "palette.ink" } },
                },
                {
                  kind: "value",
                  bindingId: "load",
                  typePreset: "typePresets.body",
                  style: { color: { ref: "palette.ink" } },
                },
              ],
            },
          },
        ],
      },
    });
    // Values are the editor's default, so nothing has to be switched to prove
    // a sampled value reaches the canvas.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const editor = Object.entries(
            window as unknown as Record<string, unknown>,
          ).find(
            ([key, value]) =>
              key.startsWith("yunari-fabric-editor-") &&
              (value as { canvas: { upperCanvasEl?: HTMLCanvasElement } })
                .canvas.upperCanvasEl?.isConnected,
          )?.[1] as
            | {
                canvas: { getObjects(): Array<{ get(name: string): unknown }> };
              }
            | undefined;
          return editor?.canvas
            .getObjects()
            .find((object) => object.get("id") === "cpu-label")
            ?.get("text");
        }),
      )
      .toMatch(/^CPU \d/);
    await expect(
      page.evaluate(() => {
        const editor = Object.entries(
          window as unknown as Record<string, unknown>,
        ).find(
          ([key, value]) =>
            key.startsWith("yunari-fabric-editor-") &&
            (value as { canvas: { upperCanvasEl?: HTMLCanvasElement } }).canvas
              .upperCanvasEl?.isConnected,
        )?.[1] as
          | {
              canvas: { getObjects(): Array<{ get(name: string): unknown }> };
            }
          | undefined;
        const text = editor?.canvas
          .getObjects()
          .find((object) => object.get("id") === "cpu-label");
        return {
          fill: text?.get("fill"),
          height: text?.get("height"),
          opacity: text?.get("opacity"),
          styles: text?.get("styles"),
          visible: text?.get("visible"),
          width: text?.get("width"),
        };
      }),
    ).resolves.toMatchObject({
      fill: ACCENT_PAINT,
      height: expect.any(Number),
      opacity: 1,
      styles: { 0: { 0: { fill: ACCENT_PAINT } } },
      visible: true,
      width: 200,
    });
    await expect(
      page.evaluate(() => {
        const coverage = [
          ...document.querySelectorAll<HTMLCanvasElement>(
            "#yunari-fabric-editor canvas",
          ),
        ].map((canvas) => {
          const pixels = canvas
            .getContext("2d")
            ?.getImageData(0, 0, canvas.width, canvas.height).data;
          let ink = 0;
          for (
            let index = 0;
            pixels !== undefined && index < pixels.length;
            index += 4
          ) {
            if (
              pixels[index]! < 32 &&
              pixels[index + 1]! > 100 &&
              pixels[index + 2]! > 100
            )
              ink += 1;
          }
          return `${canvas.className}:${canvas.width}x${canvas.height}; ink=${ink}`;
        });
        const editor = Object.entries(
          window as unknown as Record<string, unknown>,
        ).find(
          ([key, value]) =>
            key.startsWith("yunari-fabric-editor-") &&
            (value as { canvas: { upperCanvasEl?: HTMLCanvasElement } }).canvas
              .upperCanvasEl?.isConnected,
        )?.[1] as
          | {
              canvas: { getObjects(): Array<{ get(name: string): unknown }> };
            }
          | undefined;
        const text = editor?.canvas
          .getObjects()
          .find((object) => object.get("id") === "cpu-label") as
          | {
              getBoundingRect(): {
                left: number;
                top: number;
                width: number;
                height: number;
              };
            }
          | undefined;
        return { coverage, bounds: text?.getBoundingRect() };
      }),
    ).resolves.toMatchObject({
      coverage: expect.arrayContaining([expect.stringMatching(/ink=[1-9]\d*/)]),
      bounds: expect.objectContaining({
        left: expect.any(Number),
        top: expect.any(Number),
      }),
    });
    await captureVisualReview(page, testInfo, "editor-live-text");

    const envelope = (await saveEnvelope(page)) as {
      scene: {
        objects: Array<{ id?: string; text?: string; yunariText?: unknown }>;
      };
    };
    const text = envelope.scene.objects.find(
      (object) => object.id === "cpu-label",
    );
    expect(text?.text).toBe("CPU —");
    expect(text?.yunariText).toEqual(
      expect.objectContaining({
        runs: expect.arrayContaining([
          expect.objectContaining({ bindingId: "load" }),
        ]),
      }),
    );
  });

  test("opens a v2 theme and keeps the active editor when its Fabric runtime is incompatible", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    const envelope = {
      schemaVersion: 2 as const,
      fabricVersion: "7.4.0",
      id: "opened",
      metadata: { themeLanguage: "en" },
      artboard: { width: 320, height: 180 },
      scene: {
        version: "7.4.0",
        objects: [{ type: "Rect", id: "panel", width: 100, height: 50 }],
      },
    };

    await setThemePackage(page, envelope);
    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible();

    await setThemePackage(
      page,
      { ...envelope, fabricVersion: "7.5.0" },
      /incompatible/,
    );
    await expect(page.locator("#status")).toContainText("incompatible");
    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible();
  });

  test("names an object from the selection inspector and keeps it across save and reopen", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await page.locator('[data-yunari-layer="wordmark"]').click();

    // Driven through the control, not the bridge: reaching into the page would
    // prove the bridge works, not that an author can name anything.
    const name = page.locator("[data-yunari-name]");
    await expect(name).toBeVisible();
    await name.fill("Brand mark");
    await name.press("Tab");

    await expect(page.locator('[data-yunari-layer="wordmark"]')).toContainText(
      "Brand mark",
    );

    const saved = await savePackage(page);
    expect(saved.parsed.ok).toBe(true);
    if (!saved.parsed.ok) return;
    const envelope = saved.parsed.envelope as {
      scene?: { objects?: { id?: string; name?: string }[] };
    };
    // The name is authored state on the object, so it travels in the scene and
    // not in an editor-only side map beside it.
    expect(
      envelope.scene?.objects?.find((object) => object.id === "wordmark")?.name,
    ).toBe("Brand mark");

    await openThemeFromStore(page, storedThemeOfPackage(saved.bytes));

    // The reopened document's own layer list must carry the name, not just the
    // bytes: a reader that never loaded the property would pass the assertion
    // above.
    await expect(page.locator('[data-yunari-layer="wordmark"]')).toContainText(
      "Brand mark",
    );
  });

  test("falls back to the id for an object authored before names existed", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await setThemePackage(page, {
      schemaVersion: 2,
      fabricVersion: "7.4.0",
      id: "unnamed",
      metadata: { themeLanguage: "en" },
      artboard: { width: 320, height: 180 },
      scene: {
        version: "7.4.0",
        objects: [{ type: "Rect", id: "panel", width: 100, height: 50 }],
      },
    });

    // A scene with no name on the object still opens, still shows its id, and
    // still accepts a name typed into the same control.
    await expect(page.locator('[data-yunari-layer="panel"]')).toContainText(
      "panel",
    );
    await page.locator('[data-yunari-layer="panel"]').click();
    await page.locator("[data-yunari-name]").fill("Card");
    await page.locator("[data-yunari-name]").press("Tab");
    await expect(page.locator('[data-yunari-layer="panel"]')).toContainText(
      "Card",
    );
  });

  test("round-trips an opened v2 Fabric scene through the save path", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await setThemePackage(page, {
      schemaVersion: 2,
      fabricVersion: "7.4.0",
      id: "source",
      metadata: { themeLanguage: "en" },
      artboard: { width: 320, height: 180 },
      scene: {
        version: "7.4.0",
        objects: [{ type: "Rect", id: "panel", width: 100, height: 50 }],
      },
    });

    const download = page.waitForEvent("download");
    await page.keyboard.press("Control+s");
    const stream = await (await download).createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const saved = Buffer.concat(chunks);
    const parsed = readThemePackage(saved);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.envelope.id).toBe("source");
    expect(sceneObjects(parsed.envelope)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "panel" })]),
    );

    await openThemeFromStore(page, storedThemeOfPackage(saved));
  });

  test("imports and round-trips packaged images", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await page.goto(EDITOR);
    // **The pane is opened first, because an author opens it first.** The import
    // and replace below go through the buttons the pane renders, and a control
    // behind a closed pane is not one a person can press. Driving the hidden
    // input directly is the route this finding is about: it stays green while
    // the feature is unreachable, so it proves nothing.
    await openPane(page, "Add");
    await expect(page.locator("[data-yunari-asset-import]")).toBeVisible();
    await expect(page.locator("[data-yunari-asset-replace]")).toBeVisible();
    await chooseAssetFile(page, "import", {
      name: "logo.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAABmJLR0QA/wD/AP+gvaeTAAAAIklEQVQ4jWNk2HHzPwMVARM1DRs1cNTAUQNHDRw1cCgZCAC1HQK4IWYK+QAAAABJRU5ErkJggg==",
        "base64",
      ),
    });
    // The list is a plan-1 select: it renders no option until its popup is
    // open, and the import that adds the row is asynchronous, so a read of what
    // it prints opens the popup each turn.
    const listedAssets = (): ReturnType<typeof optionPairs> =>
      optionPairs(page, "[data-yunari-asset-select]");
    const importedCount = async (fragment: string): Promise<number> =>
      (await listedAssets()).filter((option) => option.label.includes(fragment))
        .length;
    // The starter declares a packaged backdrop of its own, so the claim is that
    // this import produced exactly one option named for it — not a bare total,
    // which a starter change would silently move. An option carries the file the
    // author chose, so that is what it is matched on.
    await expect.poll(() => importedCount("logo")).toBe(1);
    // **The asset to replace is named, not assumed.** The select keeps
    // whatever was selected, and a fresh document's first declaration is now
    // the starter's own backdrop — so a bare "replace" here would rewrite that
    // one. Saying which asset is meant keeps the test independent of
    // declaration order.
    await chooseIn(page, "[data-yunari-asset-select]", "logo");
    // **A different extension is refused, and this is now pinned as one.**
    // `replace` keeps the declared path and its bytes in step, so swapping a
    // `.png` for `.svg` would leave the package claiming `.png` over SVG bytes.
    // The old body asserted the opposite — that the replacement arrived as a
    // second `logo-2` declaration — which is the behaviour `replace` was
    // changed away from, so the test had been red since.
    await chooseAssetFile(page, "replace", {
      name: "logo.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="${ACCENT_PAINT}"/></svg>`,
      ),
    });
    await expect(page.locator("#status")).toContainText(
      "could not be imported",
    );
    await expect.poll(() => importedCount("logo")).toBe(1);
    await expect(assetReferences(page)).resolves.toEqual([
      { assetId: "logo", kind: "image" },
    ]);

    // The same extension is the supported replacement: one declaration, new
    // bytes, everything bound to it re-pointed. **Reselected first**, because a
    // refused replace clears the selection and the geometry below reads the
    // active object.
    await chooseIn(page, "[data-yunari-asset-select]", "logo");
    // **A PNG that actually decodes, and that is the whole fix.** The previous
    // fixture was 50 bytes of a truncated PNG — `libpng` rejects it outright —
    // so the *reopened* document had no image object and the tail of this test
    // read that as a broken round trip. It was not one: the saved envelope
    // demonstrably carries `yunariAsset: { assetId: "logo", kind: "image" }`
    // and no `src`, which is exactly right, and Fabric then drops the object
    // because `fromURL` cannot decode bytes that are not an image. Measured on
    // the editor at this revision: with the truncated bytes the reopen holds 60
    // objects and no image; with these, 61 and the image, same id and same
    // reference.
    //
    // **The same 20x20 as the import, and the same reason it matters.** The
    // selection geometry above is read off the object against its own
    // `width * scaleX`, which is Fabric's cached size from the *import* —
    // `replace` swaps bytes and does not re-decode, so a replacement of a
    // different size leaves the cache describing a picture that is no longer
    // there. Same size, different pixels: the bytes differ, which is what
    // "replace" has to prove, and nothing else moves.
    await chooseAssetFile(page, "replace", {
      name: "logo.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAABmJLR0QA/wD/AP+gvaeTAAAANUlEQVQ4jWP8////fwYiwAePAmKUMTARpYoEMGrgqIGDwUDG9+75ROUUYsHg9/KogaMGkgEAOzoIbzncHVkAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    // **One declaration, not two.** `Replace` swaps the chosen asset's bytes and
    // re-points everything bound to it; declaring a second asset and leaving the
    // chosen one holding its old bytes is what it stopped doing, precisely so a
    // package does not grow by one file per press. The count is asserted so a
    // regression that went back to declaring would be caught here.
    await expect.poll(() => importedCount("logo")).toBe(1);
    // **What the select holds afterwards is asserted, because the panel now
    // guarantees it.** Re-rendering rebuilds the options and restores the
    // previous selection, so replacing must not move the author off the asset
    // they were pointing at. The committed id is read off the hook `Select.Value`
    // prints it with — the native element's `.value` in the only place it is.
    await expect(
      page.locator("[data-yunari-asset-select] [data-yunari-value]"),
    ).toHaveAttribute("data-yunari-value", "logo");
    // What the round trip owes is the one declaration, re-pointed at the new
    // file, and the object still bound to it.
    await expect(assetReferences(page)).resolves.toEqual([
      { assetId: "logo", kind: "image" },
    ]);
    await expect(
      page.evaluate(() => {
        type SelectedObject = {
          hasBorders: boolean;
          hasControls: boolean;
          controls: Record<string, { visible?: boolean }>;
          get(name: string): unknown;
          getCoords(): Array<{ x: number; y: number }>;
        };
        const editor = Object.entries(
          window as unknown as Record<string, unknown>,
        ).find(
          ([key, value]) =>
            key.startsWith("yunari-fabric-editor-") &&
            (value as { canvas: { upperCanvasEl?: HTMLCanvasElement } }).canvas
              .upperCanvasEl?.isConnected,
        )?.[1] as {
          canvas: {
            getActiveObject(): SelectedObject | undefined;
            getObjects(): SelectedObject[];
            setActiveObject(object: unknown): void;
          };
        };
        // **Select the image, rather than reading whatever is active.** The
        // round trip above re-opened the package, which clears the selection,
        // and a refused replace clears it too — so this was reading a different
        // object on a different day and calling the difference "no selection
        // geometry". Named by the asset the test imported, so it is the same
        // object the rest of the block is about.
        const image = editor.canvas
          .getObjects()
          .find(
            (object) =>
              (object.get("yunariAsset") as { assetId?: string } | undefined)
                ?.assetId === "logo",
          );
        if (image !== undefined) editor.canvas.setActiveObject(image);
        else return undefined;
        return image === undefined
          ? undefined
          : {
              hasBorders: image.hasBorders,
              hasControls: image.hasControls,
              format: image.get("format"),
              controls: Object.fromEntries(
                Object.entries(image.controls).map(([key, control]) => [
                  key,
                  control.visible,
                ]),
              ),
              // **Against the image's own size, not a magic number.** The
              // claim is that the corners describe the object that is selected,
              // and the fixture here is a 16x16 PNG — so a fixed `> 50` was
              // asserting about a picture size the test stopped using, and it
              // failed on a perfectly ordinary selection.
              hasSelectionGeometry: (() => {
                const [topLeft, topRight, bottomRight] = image.getCoords();
                if (
                  topLeft === undefined ||
                  topRight === undefined ||
                  bottomRight === undefined
                )
                  return false;
                const width =
                  (image.get("width") as number) *
                  (image.get("scaleX") as number);
                const height =
                  (image.get("height") as number) *
                  (image.get("scaleY") as number);
                return (
                  Math.abs(topRight.x - topLeft.x - width) < 0.5 &&
                  Math.abs(bottomRight.y - topRight.y - height) < 0.5
                );
              })(),
            };
      }),
    ).resolves.toMatchObject({
      hasBorders: true,
      hasControls: true,
      format: "png",
      controls: { tl: true, tr: true, bl: true, br: true },
      hasSelectionGeometry: true,
    });
    await openPane(page, "Add");
    // The declared-asset library is the Add pane's foot now, not a pane of its
    // own, so what is scrolled to is the section's own import control.
    await page.locator("[data-yunari-asset-import]").scrollIntoViewIfNeeded();
    await captureVisualReview(page, testInfo, "editor-assets");
    const saved = await savePackage(page);
    expect(saved.parsed.ok).toBe(true);
    if (!saved.parsed.ok) return;
    // One declaration, holding the replacement's bytes — the same extension the
    // import chose, because `replace` refuses a different one.
    expect(saved.parsed.assets["assets/logo.png"]).toBeDefined();
    expect(saved.parsed.envelope.scene.objects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          yunariAsset: { assetId: "logo", kind: "image" },
        }),
      ]),
    );
    await openThemeFromStore(page, storedThemeOfPackage(saved.bytes));
    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible();
    await expect(assetReferences(page)).resolves.toContainEqual({
      assetId: "logo",
      kind: "image",
    });
  });

  test("authors a packaged background image through the inspector", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await page.goto(EDITOR);
    await openPane(page, "Add");
    await chooseAssetFile(page, "import", {
      name: "hero.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAABmJLR0QA/wD/AP+gvaeTAAAAIklEQVQ4jWNk2HHzPwMVARM1DRs1cNTAUQNHDRw1cCgZCAC1HQK4IWYK+QAAAABJRU5ErkJggg==",
        "base64",
      ),
    });
    // The picture and its box are the background layer's properties, so they
    // are written where that layer is selected.
    await selectLayer(page, "Background");
    await chooseIn(page, "[data-yunari-background-asset]", "hero");
    await chooseIn(page, "[data-yunari-background-bounds]", "display");
    // The chosen asset, read off the hook the control commits through: it is a
    // plan-1 select, so there is no `select` element to ask `.value`.
    await expect(
      page.locator("[data-yunari-background-asset] [data-yunari-value]"),
    ).toHaveAttribute("data-yunari-value", "hero");
    await page
      .locator("[data-yunari-background-asset]")
      .scrollIntoViewIfNeeded();
    await captureVisualReview(page, testInfo, "editor-background-media");

    const saved = await savePackage(page);
    expect(saved.parsed.ok).toBe(true);
    if (!saved.parsed.ok) return;
    expect(saved.parsed.envelope.background?.media).toEqual({
      assetId: "hero",
      bounds: "display",
    });
    expect(saved.parsed.assets["assets/hero.png"]).toBeDefined();
  });

  test("persists an ordinary drag and restores it through undo", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await setThemePackage(page, {
      schemaVersion: 2,
      fabricVersion: "7.4.0",
      id: "movable",
      metadata: { themeLanguage: "en" },
      artboard: { width: 320, height: 180 },
      globals: {
        palette: {
          none: {
            name: "None",
            value: { kind: "solid", color: "transparent" },
          },
          accent: {
            name: "Accent",
            value: { kind: "solid", color: ACCENT_PAINT },
          },
        },
      },
      scene: {
        version: "7.4.0",
        objects: [
          {
            type: "Rect",
            id: "panel",
            left: 40,
            top: 50,
            width: 60,
            height: 40,
            scaleX: 1.2,
            scaleY: 0.8,
            angle: 30,
            fill: ACCENT_PAINT,
            yunariPaint: { fill: "palette.accent" },
            originX: "left",
            originY: "top",
          },
        ],
      },
    });

    // Scene points go through the camera (`artboardScreenRect`), never the canvas
    // box: the canvas is host-sized, so its box says nothing about the artboard.
    const center = await sceneToClient(page, 320, 76, 66);
    await page.mouse.dblclick(center.x, center.y);
    expect(await saveEnvelope(page)).toMatchObject({
      scene: {
        objects: [
          expect.objectContaining({
            id: "panel",
            left: 40,
            top: 50,
            scaleX: 1.2,
            scaleY: 0.8,
            angle: 30,
          }),
        ],
      },
    });

    await page.keyboard.press("Control+z");
    expect(leftFor(await saveEnvelope(page), "panel")).toBeCloseTo(40, 3);

    const start = await sceneToClient(page, 320, 70, 70);
    const end = await sceneToClient(page, 320, 150, 70);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y);
    await page.mouse.up();

    const savedAfterDrag = await saveEnvelope(page);
    expect(leftFor(savedAfterDrag, "panel")).toBeGreaterThan(100);

    await page.keyboard.press("Control+z");
    const savedAfterUndo = await saveEnvelope(page);
    expect(leftFor(savedAfterUndo, "panel")).toBeCloseTo(40, 3);
  });

  test("enters a group, steps back out, and survives an undo", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "desktop surface");
    await page.goto(EDITOR);
    await setThemePackage(page, {
      schemaVersion: 2,
      fabricVersion: "7.4.0",
      id: "grouping",
      metadata: { themeLanguage: "en" },
      artboard: { width: 320, height: 180 },
      // The brief's fixture wrote a raw `fill`; this validator rejects one
      // without a palette reference, so the paint is declared the way every
      // other fixture here declares it.
      globals: {
        palette: {
          none: {
            name: "None",
            value: { kind: "solid", color: "transparent" },
          },
          accent: {
            name: "Accent",
            value: { kind: "solid", color: ACCENT_PAINT },
          },
        },
      },
      scene: {
        version: "7.4.0",
        objects: [
          {
            type: "Group",
            id: "grp",
            left: 40,
            top: 40,
            // Without these the group revives 0x0 and its `aCoords` collapse to a
            // point, so the pointer finds no target at all and entry never starts.
            width: 30,
            height: 30,
            objects: [
              {
                type: "Rect",
                id: "child",
                left: 0,
                top: 0,
                width: 30,
                height: 30,
                fill: ACCENT_PAINT,
                yunariPaint: { fill: "palette.accent" },
                originX: "left",
                originY: "top",
              },
            ],
          },
          {
            type: "Rect",
            id: "outside",
            left: 240,
            top: 40,
            width: 30,
            height: 30,
            fill: ACCENT_PAINT,
            yunariPaint: { fill: "palette.accent" },
            originX: "left",
            originY: "top",
          },
        ],
      },
    });

    // Points are derived from the camera, never from the canvas box: the canvas is
    // host-sized, so its box says nothing about where the artboard is.
    const rect = await page.evaluate(() => {
      const b = (
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
      return b.editor.viewport.artboardScreenRect();
    });
    // `rect` is canvas-relative, so the canvas box offset is added here. The
    // local form stays because the call site destructures a tuple; the poll for
    // `active === "child"` below is what stops a click on nothing from passing.
    const canvasBox = (await page
      .locator("#yunari-fabric-editor canvas.upper-canvas")
      .boundingBox())!;
    const at = (x: number, y: number): [number, number] => [
      canvasBox.x + rect.left + (x / 320) * rect.width,
      canvasBox.y + rect.top + (y / 180) * rect.height,
    ];

    const state = (): Promise<{
      active: string | undefined;
      childLeft: number | undefined;
      groupPresent: boolean;
    }> =>
      page.evaluate(() => {
        const b = (
          window as unknown as {
            yunariEditorBridge: {
              editor: {
                canvas: {
                  getActiveObject(): { id?: string } | undefined;
                  getObjects(): Array<{
                    id?: string;
                    getObjects?(): Array<{ id?: string; left?: number }>;
                  }>;
                };
              };
            };
          }
        ).yunariEditorBridge;
        const canvas = b.editor.canvas;
        const group = canvas.getObjects().find((object) => object.id === "grp");
        return {
          active: canvas.getActiveObject()?.id,
          childLeft: group
            ?.getObjects?.()
            .find((object) => object.id === "child")?.left,
          groupPresent: group !== undefined,
        };
      });

    // Double-click inside the child: the pointer's target resolves to the child,
    // which becomes the active object while the group stays in the context.
    const [cx, cy] = at(55, 55);
    await page.mouse.dblclick(cx, cy);
    await expect.poll(async () => (await state()).active).toBe("child");

    // The entered group and its child are reachable; the row outside the context is
    // not. `data-context` is the attribute the stylesheet keys on, and the computed
    // opacity is the only thing that shows the rule matches the row it should.
    const rowStyle = (id: string) =>
      page.locator(`[data-yunari-layer="${id}"]`).evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          context: node.getAttribute("data-context"),
          opacity: style.opacity,
        };
      });

    await expect.poll(async () => (await rowStyle("grp")).context).toBe("true");
    await expect
      .poll(async () => (await rowStyle("child")).context)
      .toBe("true");
    await expect
      .poll(async () => (await rowStyle("outside")).context)
      .toBe("false");
    await expect
      .poll(async () => (await rowStyle("outside")).opacity)
      .toBe("0.45");
    // The positive half of the same rule: the child is inside the context and must
    // not be dimmed. Without this, a rule that dimmed every row would pass.
    await expect.poll(async () => (await rowStyle("child")).opacity).toBe("1");

    const before = (await state()).childLeft;
    // `toBeTypeOf` is Vitest's; Playwright's `expect` has no such matcher.
    expect(typeof before).toBe("number");

    // Nudge (Task 6's binding), then undo it. The undo must not leave the context
    // pointing at a destroyed object.
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => (await state()).childLeft)
      .toBe((before ?? 0) + 1);
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await state()).childLeft).toBe(before);

    // Escape is the assertion that survives the undo — but only if it reads
    // identity rather than id. Every read above is by `id`, and a revived object
    // keeps its `id`: a context still holding the *pre-undo* instance satisfies
    // `active === "grp"` just as well as a re-resolved one, and `groupPresent`
    // reads the revived canvas either way. Neither can tell the two apart.
    const inCanvas = (): Promise<boolean> =>
      page.evaluate(() => {
        const b = (
          window as unknown as {
            yunariEditorBridge: {
              editor: {
                canvas: { getActiveObject(): unknown; getObjects(): unknown[] };
              };
            };
          }
        ).yunariEditorBridge;
        return b.editor.canvas
          .getObjects()
          .includes(b.editor.canvas.getActiveObject());
      });

    await page.keyboard.press("Escape");
    // For a one-object selection Fabric sets `activeObject` to that object, so
    // `setActiveObject(target)` makes `getActiveObject() === target`. Identity is
    // therefore readable here, and is the only thing that separates a live group
    // from the destroyed instance.
    await expect.poll(inCanvas).toBe(true);
    await expect.poll(async () => (await state()).active).toBe("grp");
    expect((await state()).groupPresent).toBe(true);
  });

  test("dims the artboard outside an entered group, and leaves it on exit", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "desktop surface");
    await page.goto(EDITOR);
    // The same two rectangles the case above enters, with nothing else on the
    // canvas: one is the group's own part and one is what entering puts out of
    // reach, so the two pixels below are the whole of what the rule acts on.
    await setThemePackage(page, groupDimEnvelope());

    const untouched = await pixelAtObjectCentre(page, "outside");
    const insideUntouched = await pixelAtObjectCentre(page, "child");
    // Both rectangles are authored opaque, so a full alpha at their centres is
    // the paint rather than a dim, and the reading below has a baseline.
    expect(untouched[3]).toBe(255);
    expect(insideUntouched[3]).toBe(255);

    // Entered the way an author does: a double-click inside the group's part.
    const inside = await sceneToClient(page, 320, 55, 55);
    await page.mouse.dblclick(inside.x, inside.y);

    // **0.45, the layer list's own dim** (`.yunari-layer-row[data-context="false"]`,
    // read on the row in the case above): the two surfaces must not disagree
    // about what the author can reach. The canvas is at DPR 1 under Playwright,
    // so an opaque fill at 0.45 reads as 115 of 255.
    await expect
      .poll(async () => (await pixelAtObjectCentre(page, "outside"))[3])
      .toBe(115);
    // The positive half: the object the author entered the group to work on is
    // untouched, so a rule that dimmed the whole canvas could not pass.
    expect((await pixelAtObjectCentre(page, "child"))[3]).toBe(255);

    // Escape is the keyboard route out — the case above owns that claim.
    await page.keyboard.press("Escape");
    await expect
      .poll(async () => pixelAtObjectCentre(page, "outside"))
      .toEqual(untouched);
  });

  test("keeps the entered-group dim out of the picture a save ships", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "desktop surface");
    await page.goto(EDITOR);
    await setThemePackage(page, groupDimEnvelope());

    // Entered the way an author does: a double-click inside the group's part.
    const inside = await sceneToClient(page, 320, 55, 55);
    await page.mouse.dblclick(inside.x, inside.y);
    // The screen dims — the case above owns that reading in full. This one
    // needs only to know the view state is on before it reads the picture.
    await expect
      .poll(async () => (await pixelAtObjectCentre(page, "outside"))[3])
      .toBe(115);

    // **A capture reads the document, not the screen** (0053, `vg-527`).
    // `bridge.capture` is the product's own capture — the one a theme package's
    // thumbnail and the library card both come from — so this reads the
    // artifact an author would hand somebody rather than the mechanism under
    // it. Both pixels are the same point of the same object: the live canvas
    // one, and that point in the capture.
    const [live, shot] = await page.evaluate(async () => {
      type ProbeObject = {
        id?: string;
        getObjects?(): unknown[];
        getBoundingRect(): {
          left: number;
          top: number;
          width: number;
          height: number;
        };
      };
      const bridge = (
        window as unknown as {
          yunariEditorBridge: {
            capture(): string | undefined;
            editor: {
              canvas: { getObjects(): ProbeObject[] };
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
      const find = (
        candidates: readonly ProbeObject[],
      ): ProbeObject | undefined => {
        for (const candidate of candidates) {
          if (candidate.id === "outside") return candidate;
          const found = find(
            (candidate.getObjects?.() ?? []) as readonly ProbeObject[],
          );
          if (found !== undefined) return found;
        }
        return undefined;
      };
      const object = find(bridge.editor.canvas.getObjects());
      if (object === undefined) throw new Error("no object with id outside");
      const element = document.querySelector<HTMLCanvasElement>(
        "#yunari-fabric-editor canvas.lower-canvas",
      );
      const context = element?.getContext("2d");
      if (element === null || context === null || context === undefined)
        throw new Error("no lower canvas");

      const rect = object.getBoundingRect();
      const view = bridge.editor.viewport.artboardScreenRect();
      const ratio = element.width / element.getBoundingClientRect().width;
      // The artboard the fixture authors, which is what `view.width` frames.
      const scale = view.width / 320;
      const x = Math.round(
        (view.left + (rect.left + rect.width / 2) * scale) * ratio,
      );
      const y = Math.round(
        (view.top + (rect.top + rect.height / 2) * scale) * ratio,
      );
      const read = (data: Uint8ClampedArray): number[] => [
        data[0] ?? -1,
        data[1] ?? -1,
        data[2] ?? -1,
        data[3] ?? -1,
      ];
      const live = read(context.getImageData(x, y, 1, 1).data);

      const url = bridge.capture();
      if (url === undefined) throw new Error("the capture returned nothing");
      const image = new Image();
      image.src = url;
      await image.decode();
      const surface = document.createElement("canvas");
      surface.width = image.naturalWidth;
      surface.height = image.naturalHeight;
      const surfaceContext = surface.getContext("2d");
      if (surfaceContext === null) throw new Error("no capture context");
      surfaceContext.drawImage(image, 0, 0);
      // The capture is the canvas at the export multiplier, so the same point
      // moves with it rather than being assumed to be the same pixel.
      const exported = image.naturalWidth / element.width;
      const shot = read(
        surfaceContext.getImageData(
          Math.round(x * exported),
          Math.round(y * exported),
          1,
          1,
        ).data,
      );
      return [live, shot];
    });

    // The screen is still dimmed, so the two readings cannot both be right for
    // the wrong reason: one of them is the view state and the other is not.
    expect(live[3]).toBe(115);
    // **255 is the object's own authored paint, and 115 would be the dim.**
    expect(shot[3], "the capture shows the document, not the dim").toBe(255);
  });

  test("rehydrates a chart runtime after undo", async ({ page }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await selectStarterChart(page);
    // The grab point comes from the object's own geometry, through the camera.
    // **The gauge's own world box.** Inside an entered group a drag moves the
    // part, and the part's `left` in the saved document is its position inside
    // the card — which a drag does not change. The card's own left edge is no
    // better: the gauge sits inside the card's wider panel, so moving it 80
    // units need not move the card's edge at all. World coordinates on the
    // thing the pointer actually moved is the only read that survives.
    const cardLeft = async (): Promise<number> =>
      (await objectRect(page, "ram-gauge")).left;
    const start = await clientOfStarterGauge(page);
    const left = await cardLeft();
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 80, start.y);
    await page.mouse.up();
    expect(await cardLeft()).toBeGreaterThan(left);

    await page.keyboard.press("Control+z");
    expect(await cardLeft()).toBeCloseTo(left, 3);
    await expect
      .poll(() =>
        page.evaluate(() => {
          type SceneNode = {
            get(name: string): unknown;
            getObjects?(): SceneNode[];
          };
          const editor = Object.entries(
            window as unknown as Record<string, unknown>,
          ).find(
            ([key, value]) =>
              key.startsWith("yunari-fabric-editor-") &&
              (value as { canvas: { upperCanvasEl?: HTMLCanvasElement } })
                .canvas.upperCanvasEl?.isConnected,
          )?.[1] as { canvas: { getObjects(): SceneNode[] } } | undefined;
          const find = (
            objects: readonly SceneNode[],
          ): SceneNode | undefined => {
            for (const candidate of objects) {
              if (candidate.get("id") === "ram-gauge") return candidate;
              const found = find(candidate.getObjects?.() ?? []);
              if (found !== undefined) return found;
            }
            return undefined;
          };
          // The gauge is a part of the RAM card, so a search of the root list
          // found nothing and the poll timed out on a chart that was there.
          const chart = find(editor?.canvas.getObjects() ?? []) as
            | { option?: { series?: unknown[] } }
            | undefined;
          const option = chart?.option;
          return option?.series?.length ?? 0;
        }),
      )
      .toBeGreaterThan(0);
  });

  test("keeps a non-selectable object unselectable after an undo", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    // The reported bug: an object authored `selectable: false` resists a click
    // on first open — but undo revives the scene through serialisation, and
    // Fabric omits `selectable`/`evented` from `toObject`, so it came back an
    // ordinary draggable object. The fix is in
    // `scene-fabric/src/persist.ts`, which lists both in
    // `SCENE_PERSISTED_PROPERTIES`, so the guard is general.
    //
    // **The witness is a fixture, not the starter.** The starter used to author
    // a full-artboard `background` rect and this clicked bare artboard to meet
    // it; its backdrop is packaged media now, so that object is gone and the
    // property is asserted on a plate the test authors itself — which is also
    // the property the fix actually covers. A test aimed at the plate alone
    // would pass while any other non-selectable object stayed draggable.
    await page.goto(EDITOR);
    await setThemePackage(page, {
      schemaVersion: 2,
      fabricVersion: "7.4.0",
      id: "unselectable",
      metadata: { themeLanguage: "en" },
      artboard: {
        width: STARTER_WIDTH,
        height: 941,
      },
      background: { color: { ref: "palette.none" } },
      globals: {
        palette: {
          none: {
            name: "None",
            value: { kind: "solid" as const, color: "transparent" },
          },
          plate: {
            name: "Plate",
            value: { kind: "solid" as const, color: PLATE_PAINT },
          },
          ink: {
            name: "Ink",
            value: { kind: "solid" as const, color: INK_PAINT },
          },
        },
        typePresets: {},
      },
      bindings: {},
      scene: {
        version: "7.4.0" as const,
        objects: [
          {
            type: "Rect" as const,
            id: "background",
            left: 0,
            top: 0,
            width: STARTER_WIDTH,
            height: 941,
            fill: "palette.plate",
            originX: "left" as const,
            originY: "top" as const,
            selectable: false,
            evented: false,
            yunariPaint: { fill: "palette.plate" },
          },
          {
            type: "Rect" as const,
            id: "draggable",
            left: 400,
            top: 400,
            width: 200,
            height: 60,
            fill: "palette.ink",
            originX: "left" as const,
            originY: "top" as const,
            yunariPaint: { fill: "palette.ink" },
          },
        ],
      },
    });

    /** Artboard coordinates to page pixels, through the live camera. */
    const at = (x: number, y: number): Promise<{ x: number; y: number }> =>
      sceneToClient(page, STARTER_WIDTH, x, y);

    /** The authored background object, by id, as the page's own instance. */
    const background = async (): Promise<unknown> =>
      page.evaluate(() => {
        const editor = Object.entries(
          window as unknown as Record<string, unknown>,
        ).find(([key]) => key.startsWith("yunari-fabric-editor-"))?.[1] as
          | { canvas: { getObjects(): Array<{ get(n: string): unknown }> } }
          | undefined;
        const object = editor?.canvas
          .getObjects()
          .find((candidate) => candidate.get("id") === "background");
        return object === undefined
          ? null
          : {
              selectable: object.get("selectable"),
              evented: object.get("evented"),
            };
      });

    /** Whether the background geometrically covers a point, page coordinates. */
    const covers = async (point: { x: number; y: number }): Promise<boolean> =>
      page.evaluate(
        ([clientX, clientY]: readonly [number, number]) => {
          const editor = Object.entries(
            window as unknown as Record<string, unknown>,
          ).find(([key]) => key.startsWith("yunari-fabric-editor-"))?.[1] as
            | {
                canvas: {
                  getScenePoint(e: {
                    clientX: number;
                    clientY: number;
                  }): unknown;
                  getObjects(): Array<{
                    get(n: string): unknown;
                    containsPoint(p: unknown): boolean;
                  }>;
                };
              }
            | undefined;
          const object = editor?.canvas
            .getObjects()
            .find((candidate) => candidate.get("id") === "background");
          if (editor === undefined || object === undefined) return false;
          return object.containsPoint(
            editor.canvas.getScenePoint({ clientX: clientX, clientY: clientY }),
          );
        },
        [point.x, point.y] as const,
      );

    const selected = async (): Promise<unknown> =>
      page.evaluate(() => {
        const editor = Object.entries(
          window as unknown as Record<string, unknown>,
        ).find(([key]) => key.startsWith("yunari-fabric-editor-"))?.[1] as
          | {
              canvas: {
                getActiveObject(): { get(name: string): unknown } | undefined;
              };
            }
          | undefined;
        return editor?.canvas.getActiveObject()?.get("id") ?? null;
      });

    // A point in bare artboard, clear of the fixture's one draggable rect.
    const spot = await at(836, 890);

    // The guard is geometric, not a hit test: `findTarget` skips an object with
    // `evented: false`, so it reports nothing here whether or not the background
    // is still armed — it cannot witness the bug. `containsPoint` asks the
    // object's own bounds, which is true either way, so a pass below means the
    // background declined the click rather than that no object was there.
    expect(await covers(spot)).toBe(true);
    expect(await background()).toEqual({ selectable: false, evented: false });

    await page.mouse.click(spot.x, spot.y);
    expect(await selected()).toBeNull();

    // One authored change, so undo has entries either side of the revive. The
    // drag lands on the fixture's own `draggable` rect.
    const marker = await at(432, 418);
    await page.mouse.move(marker.x, marker.y);
    await page.mouse.down();
    await page.mouse.move(marker.x + 40, marker.y);
    await page.mouse.up();
    await page.waitForTimeout(400);
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(400);

    expect(await covers(spot)).toBe(true);
    expect(await background()).toEqual({ selectable: false, evented: false });

    await page.mouse.click(spot.x, spot.y);
    expect(await selected()).toBeNull();
  });

  test("keeps the active document when Fabric cannot revive a schema-valid scene", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await setUncheckedThemePackage(
      page,
      {
        schemaVersion: 2,
        fabricVersion: "7.4.0",
        id: "unrevivable",
        metadata: { themeLanguage: "en" },
        artboard: { width: 320, height: 180 },
        scene: { version: "7.4.0", objects: [{ type: "UnknownFabricObject" }] },
      },
      /Invalid theme/,
    );

    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible();
  });

  test("asks before Open discards a changed Fabric scene", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await page.evaluate(() => {
      const editor = Object.entries(
        window as unknown as Record<string, unknown>,
      ).find(([key]) => key.startsWith("yunari-fabric-editor-"))?.[1] as
        | {
            canvas: {
              item(
                index: number,
              ): { set(key: string, value: number): void } | undefined;
              requestRenderAll(): void;
            };
          }
        | undefined;
      editor?.canvas.item(1)?.set("left", 64);
      editor?.canvas.requestRenderAll();
    });
    // **The File row, not `Control+o`.** That chord now prints beside, and
    // drives, the *Import package* row — and an import replaces nothing, so it
    // asks no question. The row that still opens a document is this one.
    await page.getByRole("button", { name: "File", exact: true }).click();
    await page.getByRole("menuitem", { name: "Open library" }).click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(
      "Save changes before opening another theme?",
    );
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible();
  });

  test("asks before New discards a changed Fabric scene", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await page.evaluate(() => {
      const editor = Object.entries(
        window as unknown as Record<string, unknown>,
      ).find(([key]) => key.startsWith("yunari-fabric-editor-"))?.[1] as
        | {
            canvas: {
              item(
                index: number,
              ): { set(key: string, value: number): void } | undefined;
              requestRenderAll(): void;
            };
          }
        | undefined;
      editor?.canvas.item(1)?.set("left", 64);
      editor?.canvas.requestRenderAll();
    });
    await page.keyboard.press("Control+n");

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("#status-message")).toHaveText("Editor ready");
  });

  test("Ctrl-resizes near a neighbour without snapping or showing a guide", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible();

    // **The card, not the frosted panel inside it.** A card is a group, and a
    // group is both what a click selects and what carries its own transform
    // controls — a bare panel inside it has no resize handle to grab. The
    // subject is the thing an author drags anyway.
    const card = await objectRect(page, "group-ram-card");
    const select = await sceneToClient(
      page,
      STARTER_WIDTH,
      card.left + (card.width / 2) * 0.6,
      card.top + 10,
    );
    await page.mouse.click(select.x, select.y);
    // **By id, not by member count.** `members` counts an `ActiveSelection`'s
    // children, and a card is a group of six — so the old "one object selected"
    // assertion now read 6 for the card the click correctly selected. The
    // question is *which* object, and only the id answers it.
    expect(await activeId(page)).toBe("group-ram-card");

    const line = (await objectRect(page, "group-vram-card")).left;
    const target = line - 2;
    const ctrl = await resizeRightHandleTo(
      page,
      "group-ram-card",
      target,
      testInfo,
      {
        ctrlKey: true,
        captureName: "editor-snap-resize-ctrl",
      },
    );

    // Ctrl-resize must match Ctrl-drag: preserve raw fractional geometry and
    // suppress guides, even when the raw edge is inside the snap threshold.
    // Client-pixel quantisation shifts the measured edge by less than 3 scene
    // pixels; snapping would move it onto `line` instead of preserving target.
    expect(Math.abs(ctrl.right - ctrl.raw)).toBeLessThan(3);
    expect(ctrl.right % 1).not.toBe(0);
    expect(Math.abs(ctrl.right - line)).toBeGreaterThan(0.5);
    expect(ctrl.guidePixels).toBe(0);

    // Compare same modifier against drag: both gestures must keep raw geometry
    // inside snap threshold rather than joining the neighbour's line.
    await page.goto(EDITOR);
    // The resize above dirtied the document, so this reload is offered its own
    // draft back.
    await answerDialogIfShown(page, "Discard");
    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible();
    const dragCard = await objectRect(page, "ram-card");
    const dragSelect = await sceneToClient(
      page,
      STARTER_WIDTH,
      dragCard.left + (dragCard.width / 2) * 0.6,
      dragCard.top + 10,
    );
    await page.mouse.click(dragSelect.x, dragSelect.y);
    const dragBefore = await activeGeometry(page);
    const dragLine = (await objectRect(page, "vram-card")).left;
    const dragged = await dragActiveSelection(
      page,
      dragLine - 2 - dragBefore.rect.left,
      { ctrlKey: true },
    );
    // The dragged object stays off the neighbour line and paints no guide, the
    // same visible Ctrl escape required from resize.
    expect(Math.abs(dragged.left - dragLine)).toBeGreaterThan(0.5);
    expect(dragged.guidePixels).toBe(0);
  });

  test("snaps a resized object to a neighbour and shows a guide", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible();

    // Select the RAM card by clicking its top strip, above every child. A
    // resize handle is only hit-testable on the active object, so this is not
    // optional: without it the pointerdown below starts a drag, not a scale.
    // The pair matters: the RAM card's right edge (1318) has no other candidate
    // line within the acquire threshold, so the only line the drag can reach is
    // the VRAM card's left edge (1332) — a nearer neighbour would be acquired
    // first and held, and the edge would land there instead. Both cards are
    // frosted like every other panel, and neither carries the one treatment that
    // is not: the frosted CPU card's own mr handle does not track the pointer
    // (recorded as a concern in the Task 7 report), so it cannot be the subject
    // of a resize that has to land on a line.
    // **The card, not the frosted panel inside it.** A card is a group, and a
    // group is both what a click selects and what carries its own transform
    // controls — a bare panel inside it has no resize handle to grab. The
    // subject is the thing an author drags anyway.
    const card = await objectRect(page, "group-ram-card");
    const select = await sceneToClient(
      page,
      STARTER_WIDTH,
      card.left + (card.width / 2) * 0.6,
      card.top + 10,
    );
    await page.mouse.click(select.x, select.y);
    // **By id, not by member count.** `members` counts an `ActiveSelection`'s
    // children, and a card is a group of six — so the old "one object selected"
    // assertion now read 6 for the card the click correctly selected. The
    // question is *which* object, and only the id answers it.
    expect(await activeId(page)).toBe("group-ram-card");

    // The no-snap control first: drag the `mr` handle to the scene x furthest
    // from every candidate line the rest of the scene offers. The edge must stay
    // where the pointer put it — a snap here would be a guide with no line to
    // snap to, which is exactly the mistake Review Focus item 1 names.
    const clear = await clearSceneX(
      page,
      "group-ram-card",
      card.left + card.width + 60,
      STARTER_WIDTH,
      STARTER_WIDTH,
    );
    expect(clear.distance).toBeGreaterThan(5);
    const raw = await resizeRightHandleTo(
      page,
      "group-ram-card",
      clear.x,
      undefined,
    );
    expect(Math.abs(raw.right - raw.raw)).toBeLessThan(3);
    // The user-visible half of "a guide with no snap": nothing was applied, so
    // no guide may be painted. Asserted on the pixels, because the geometry
    // assertions above cannot see a guide and a capture only exists under
    // YUNARI_CAPTURE — a regression that painted unconditionally would pass
    // them all.
    expect(raw.guidePixels).toBe(0);

    // Then the snap, from a fresh page: drag the same handle so the raw right
    // edge lands 2px short of the VRAM card's left edge. That is inside the
    // threshold, so a live resize path pulls the edge onto the line and a dead
    // one leaves it 2px short.
    await page.goto(EDITOR);
    // **The first half edited the document, so this reload is offered its own
    // draft back** (`draft-store.ts` writes on the page-hide, and
    // `editor-main.ts` asks before anything mounts). The reload is the test's,
    // not a crash, so Discard is the only answer that leaves the starter the
    // second half measures. Without it the recovery prompt owns the viewport and
    // the canvas below is not there to be asserted.
    await answerDialogIfShown(page, "Discard");
    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible();
    await page.mouse.click(select.x, select.y);

    const line = (await objectRect(page, "group-vram-card")).left;
    const snapped = await resizeRightHandleTo(
      page,
      "group-ram-card",
      line - 2,
      testInfo,
    );
    expect(Math.abs(snapped.right - line)).toBeLessThan(1.5);
    // The applied guide, asserted where it is drawn: the whole row is sampled
    // for the guide colour along the snapped edge, so "verified guides" is
    // re-checkable by CI rather than only by a regenerated capture.
    expect(snapped.guidePixels).toBeGreaterThan(100);
  });

  test("snaps a two-object selection as a unit", async ({ page }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible();

    await selectTwoLabels(page);
    const before = await activeGeometry(page);
    // Without this the drag below is one object's, and the guard's whole
    // subject — a composed selection — is never exercised.
    expect(before.members).toBe(2);

    // `time-card`'s world left edge is a line near the drag's landing, read
    // rather than restated so the card's half-pixel stroke is included.
    const line = await worldLeftOf(page, "group-time-card");

    // Raw landing 4px past the line: inside the acquire threshold, so an eligible
    // selection is pulled onto a candidate. 4px, not 1px, because the pointer's
    // scene travel can shift by about a pixel.
    const { left } = await dragToLine(page, line, 4);

    // The drag ran: the selection moved well clear of where it started.
    expect(Math.abs(left - before.rect.left)).toBeGreaterThan(30);
    // The composed selection joined the snap and sits on the line. A selection
    // that never entered the gesture lands ~5px past it, so this is the
    // assertion the guard has to fail.
    expect(Math.abs(left - line)).toBeLessThan(0.5);
  });

  test("refuses a snap gesture for a scaled text selection", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible();

    await selectTwoLabels(page);
    expect((await activeGeometry(page)).members).toBe(2);
    // `time-card`'s world left edge is a candidate line near the drag landing.
    const line = await worldLeftOf(page, "group-time-card");

    // Positive control: the SAME gesture on the same objects while still
    // eligible. The raw landing is 4px past a candidate line, inside the acquire
    // threshold, so an eligible selection is pulled onto it — which is what
    // makes the refusal below a difference rather than a drag that missed.
    const snapped = await dragToLine(page, line, 4);
    expect(Math.abs(snapped.left - line)).toBeLessThan(0.5);

    // The refusal: a non-unit scale with a `Textbox` child. This is why the case
    // cannot be a jsdom test — the claim is about Fabric's own drag still running
    // while the snapping path never joins it.
    await scaleActiveSelection(page, 1.5);

    const refused = await dragToLine(page, line, 4);
    // Fabric's drag ran and nothing corrected it: the selection sits on the
    // landing the pointer asked for, 4px past the line, where the eligible
    // control above was pulled onto it. Measured against the landing rather
    // than the line because a refused drag may settle near a *different*
    // candidate; with the guard disabled the snap runs and this deviation is
    // several pixels, which is what the assertion has to catch.
    expect(Math.abs(refused.left - refused.raw)).toBeLessThan(1.5);
  });

  /**
   * The canvas rotation gesture, which no other test performs (`vg-346`).
   *
   * The block this replaces asserted only that the canvas was visible, and it
   * was the one thing driving Fabric's `mtr` handle — so the readout and the
   * control were unit-tested and the gesture was covered by nothing. Both halves
   * of the deleted case's name are asserted here: the gesture, and the readout
   * appearing *beside the pointer* rather than merely existing.
   *
   * The angle is never written into the scene. A shape is inserted through the
   * Add pane (which selects it) and its own rotation handle is swept, so the
   * number the readout shows is the number that sweep produced.
   */
  test("shows the rotation-angle indicator beside the pointer mid-rotation", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible();

    await openPane(page, "Add");
    await insertShape(page, "Rectangle");
    const id = await activeId(page);
    expect(id, "insertion selects the object it inserted").toBeDefined();

    const grab = await rotationHandleClientPoint(page, id!);
    const readout = page.locator(".yunari-angle-indicator");

    /** What the readout says and where it sits, read while the pointer is down
     *  and still — the readout is repainted by `object:rotating` alone. */
    const readoutAt = async (pointer: { x: number; y: number }) => {
      await expect(readout).toBeVisible();
      const text = ((await readout.textContent()) ?? "").trim();
      const box = (await readout.boundingBox()) ?? {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      };
      return { text, box, pointer, angle: await activeAngle(page) };
    };

    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();

    const firstLeg = { x: grab.x + 18, y: grab.y + 18 };
    await page.mouse.move(firstLeg.x, firstLeg.y, { steps: 8 });
    const first = await readoutAt(firstLeg);

    const secondLeg = { x: grab.x + 36, y: grab.y + 36 };
    await page.mouse.move(secondLeg.x, secondLeg.y, { steps: 8 });
    const second = await readoutAt(secondLeg);

    // The sweep rotated the object, and the readout names that angle — the
    // degree value is the product's own, formatted by `formatAngle`. The sweep
    // is a drag of tens of pixels, so the angle stays inside ±180 where
    // `formatAngle`'s normalisation is the identity and this rounding is the
    // same arithmetic.
    expect(second.angle, "the sweep rotated the object").not.toBe(0);
    expect(second.text).toBe(`${Math.round(second.angle)}°`);
    expect(second.text).toMatch(/^-?\d+°$/);

    // Beside the pointer, both legs: within a short reach of the cursor, moving
    // with it, and not under it. A readout pinned to the object or to a corner
    // would pass the text assertion above and fail the movement one; a readout
    // drawn at the cursor would pass the reach check (`distanceToBox` is 0
    // inside the rectangle) and fail the containment one. The product places it
    // 16px right and below the pointer's client point, so "beside" is a claim
    // with a measured answer either way.
    console.log(
      `vg-346 readout ${JSON.stringify({
        legs: [first, second].map((leg) => ({
          pointer: leg.pointer,
          box: leg.box,
          distance: distanceToBox(leg.pointer, leg.box),
          containsPointer: boxContains(leg.pointer, leg.box),
          offset: {
            x: leg.box.x - leg.pointer.x,
            y: leg.box.y - leg.pointer.y,
          },
          text: leg.text,
        })),
      })}`,
    );
    expect(distanceToBox(second.pointer, second.box)).toBeLessThan(40);
    expect(
      boxContains(second.pointer, second.box),
      "the readout is beside the pointer, not under it",
    ).toBe(false);
    expect(second.box.x - first.box.x).toBeGreaterThan(8);

    // And it leaves when the gesture does.
    await page.mouse.up();
    await expect(readout).toBeHidden();
  });

  /**
   * A scaled text resized by a side handle, read back at both ends — the one
   * check `vg-233` and `vg-370` are each waiting on.
   *
   * **`vg-233`** is a units question in `text-manager`'s resize path: it wrote
   * `target.width * scaleX` into `yunariText.box`, while the shared writer's own
   * comment says the scaled value "would grow the box on every pass" and
   * `boxFrom` multiplies by `scaleX` again when it reads. Read together, the
   * stored box and the object's own width agree under either write — `assertBox`
   * copies the box onto `object.width` on the next pass — so the case asserts the
   * one surface the units reach: the edge the author dragged to. Measured both
   * ways on a 240-unit drag at `scaleX` 0.74: 177.6 units landed with the scaled
   * write, 239 with the unscaled one.
   *
   * **`vg-370`** is the box minimum, which lives in two places: the shared
   * writer refuses `value < 1` (`authored-box.ts`) and the inspector's funnel
   * floors at `MIN_DIMENSION = 1`. Whether that refusal fires is measured and
   * reported, not asserted: the row is open on exactly that fact. What the run
   * found is that no sub-unit width is ever produced — the drag asked to put the
   * edge 0.4 units from the left edge and landed it tens of scene units away, so
   * the box was written rather than skipped and the refusal was never reached.
   * That landing-versus-request gap is `vg-393`, and its cause is measured
   * (2026-10-16): the ask is 0.4 scene units, which is 0.17 client px at this
   * zoom, and a whole client px is 2.35 scene units — so the pointer lands at
   * scene 117.0, *left of the object's own left edge at 118*, and Fabric's
   * `changeObjectWidth` refuses a pointer on the far side of the origin
   * (`index.mjs` `changeObjectDimensionGen`). The width left behind is the
   * previous step's, 36.137 for a pointer at scene 145.2. The box the refusal
   * would have floored is therefore unreachable by a pointer here, not skipped.
   */
  test("resizes a scaled text by its side handle, and reopens the box it wrote", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible();

    // The starter's own wordmark, through the canvas click `selectTwoLabels`
    // uses: it is a top-level `Textbox` carrying an authored box, which is what
    // both halves below need — `text-manager`'s resize path writes the box, and
    // a text with no box is returned from before it writes anything.
    const wordmark = await sceneToClient(page, STARTER_WIDTH, 200, 78);
    await page.mouse.click(wordmark.x, wordmark.y);
    const id = await activeId(page);
    expect(id, "a canvas click selects the starter's own text").toBe(
      "wordmark",
    );
    const textId = id!;

    // A non-unit scale, through the product's own corner drag. `vg-233`'s
    // comparison only exists there: at `scaleX` 1 the two candidate writes are
    // the same number, and the run measured their difference as `scaleX` times
    // the drag.
    await scaleByCornerHandle(page, textId, 0.5);
    const scaled = await textBoxState(page, textId);
    expect(
      scaled.scaleX,
      "the corner drag left the text below a unit scale",
    ).toBeGreaterThan(0.2);
    expect(scaled.scaleX).toBeLessThan(0.9);
    expect(
      scaled.boxWidth,
      "the starter's text carries the authored box both halves write",
    ).toBeDefined();

    // ---- vg-370: does the sub-unit resize reach the refusal? ---------------
    // The handle is dragged to a rendered width under one unit. What the run
    // reports — through the test's own stdout in the JSON report — is the box
    // before and after, the width Fabric settled on, and the landing the pointer
    // asked for.
    const left = await worldLeftOf(page, textId);
    const subUnit = await resizeRightHandleTo(
      page,
      textId,
      left + 0.4,
      undefined,
    );
    const afterSubUnit = await textBoxState(page, textId);
    console.log(
      `vg-370 sub-unit resize ${JSON.stringify({
        boxBefore: scaled.boxWidth,
        boxAfter: afterSubUnit.boxWidth,
        fabricWidth: afterSubUnit.width,
        scaleX: afterSubUnit.scaleX,
        renderedWidth: afterSubUnit.renderedWidth,
        askedLanding: subUnit.raw,
        landedRight: subUnit.right,
      })}`,
    );

    // ---- vg-233: where does the resize put the edge it was dragged to? -----
    // Widened rather than narrowed, so the reopened box is not re-measured
    // against a wrapped run: the claim is the box the author dragged, not the
    // text's own width. The left edge is re-read because the probe above moved
    // the box.
    const leftBeforeResize = await worldLeftOf(page, textId);
    const widened = await resizeRightHandleTo(
      page,
      textId,
      leftBeforeResize + 240,
      undefined,
    );
    const resized = await textBoxState(page, textId);
    console.log(
      `vg-233 resize ${JSON.stringify({
        leftBeforeResize,
        askedLanding: widened.raw,
        askedRenderedWidth: widened.raw - leftBeforeResize,
        landedRight: widened.right,
        landedRenderedWidth: widened.right - leftBeforeResize,
        missedBy: widened.raw - widened.right,
        boxBefore: afterSubUnit.boxWidth,
        boxAfter: resized.boxWidth,
        fabricWidth: resized.width,
        scaleX: resized.scaleX,
        renderedWidth: resized.renderedWidth,
        renderedBefore: afterSubUnit.renderedWidth,
      })}`,
    );
    // **The arm this case exists for, and the only one that can see the defect.**
    // `yunariText.box` is the object's size *before* `scaleX`: `assertBox`
    // divides the stored number by the scale to get Fabric's `width`, and
    // `boxFrom` multiplies it back for the clip and the placement. A resize that
    // stores `width * scaleX` therefore hands the next pass a box that many units
    // too large, and the pass writes it straight onto the width — so the object
    // ends `scaleX` times the size the author dragged to.
    //
    // **Why this and not a box-versus-width assertion.** Read together, the
    // stored box and the object's own width agree whatever was written, because
    // `assertBox` makes them the same number: the saved box is copied onto
    // `object.width` on the next pass. Measured in the run, `boxAfter` and
    // `fabricWidth` are one double. The geometry the author ends up with is the
    // only surface the write's units reach, and on this drag the difference is
    // the whole of 62.4 units: 177.6 landed for a 240-unit request with the
    // scaled write, 239 landed with the unscaled one.
    expect(
      Math.abs(widened.right - widened.raw),
      "the resized edge lands where the author dragged it",
    ).toBeLessThan(2);
    expect(
      resized.renderedWidth,
      "the side handle left the text wider than it found it",
    ).toBeGreaterThan(afterSubUnit.renderedWidth);
    expect(resized.boxWidth, "the resize wrote the authored box").not.toBe(
      afterSubUnit.boxWidth,
    );

    const saved = await savePackage(page);
    expect(saved.parsed.ok).toBe(true);
    if (!saved.parsed.ok) throw new Error(saved.parsed.message);
    const persisted = sceneObjects(saved.parsed.envelope).find(
      (object) => object["id"] === textId,
    );
    const persistedBox = (
      persisted?.["yunariText"] as { box?: { width?: number } } | undefined
    )?.box?.width;
    expect(
      persistedBox,
      "the saved document carries the text's box",
    ).toBeDefined();
    // The row's own comparison — the persisted box against the object's own
    // width — asserted rather than only logged. It holds under either write,
    // because `assertBox` makes those two the same number; the landing above is
    // the arm that moves.
    expect(persistedBox, "the saved box is the object's own width").toBeCloseTo(
      resized.width,
      3,
    );

    // The package the editor just wrote, re-imported as bytes. Not
    // `setThemePackage`: that rebuilds a document from the envelope alone and
    // this scene carries a background asset, so the rebuilt one is refused.
    await openThemeFromStore(page, storedThemeOfPackage(saved.bytes));
    const reopened = await textBoxState(page, textId);

    console.log(
      `vg-233 reopen ${JSON.stringify({
        storedBox: persistedBox,
        before: {
          width: resized.width,
          scaleX: resized.scaleX,
          renderedWidth: resized.renderedWidth,
          boxWidth: resized.boxWidth,
        },
        after: {
          width: reopened.width,
          scaleX: reopened.scaleX,
          renderedWidth: reopened.renderedWidth,
          boxWidth: reopened.boxWidth,
        },
      })}`,
    );
    // The author's resize survives the save. **What this arm does, and does not,
    // show:** both sides are the same function of the same object, revived from
    // the box the save wrote, so it is a save/reopen idempotence check, not a
    // units check — the units arm is the landing above, because `assertBox` makes
    // the stored box and the object's width agree whatever was stored.
    expect(
      Math.abs(reopened.renderedWidth - resized.renderedWidth),
      "the reopened text is the width the drag left it",
    ).toBeLessThan(2);
    // The reopened object's own numbers, not only the pre-save pair: the stored
    // box is what the revival feeds `assertBox`, so it is the reopened object's
    // width the claim is about.
    expect(reopened.boxWidth, "the reopened box is the stored box").toBe(
      persistedBox,
    );
    expect(
      Math.abs(reopened.width - resized.width),
      "the reopened object's own width is the width the drag left",
    ).toBeLessThan(2);
  });

  test("captures the canvas dock over a selected object", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    const canvas = page.locator("#yunari-fabric-editor canvas.upper-canvas");
    await expect(canvas).toBeVisible();

    // Select the performance card's title; the dock anchors to the canvas
    // bottom and shows only the actions this selection can run.
    const centre = await sceneToClient(page, STARTER_WIDTH, 200, 545);
    await page.mouse.click(centre.x, centre.y);
    const dock = page.locator("[data-yunari-canvas-toolbar]");
    await expect(dock).toHaveAttribute("data-visible", "true");
    await expect(dock.getByRole("button", { name: "Duplicate" })).toBeVisible();
    // **A group can be ungrouped**, and a click on a card selects the card. The
    // comment this replaces said "a single object cannot be ungrouped", which was
    // true while a click on a card reached one of its parts — so the button was
    // correctly absent for the wrong reason, and the assertion was pinning the
    // harness rather than the dock. What the dock must not show is `Group`,
    // which is what a multi-selection gets and this selection is not.
    await expect(dock.getByRole("button", { name: "Ungroup" })).toBeVisible();

    // **The dock carries no arrange action at all** (`vg-463`): the eight moved
    // to the selection inspector's lead, which is the surface that names the
    // selection they act on, so what this capture shows is the object half
    // alone. The absence is asserted rather than merely left out of the capture,
    // because the failure mode of a move like this is two surfaces answering one
    // question.
    const toolbar = page.locator("[data-yunari-canvas-toolbar]");
    await expect(toolbar).toBeVisible();
    await expect(toolbar.locator("[data-yunari-arrange-action]")).toHaveCount(
      0,
    );

    await captureVisualReview(page, testInfo, "editor-toolbar");
  });

  test("captures the canvas context menu over a selected object", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    const canvas = page.locator("#yunari-fabric-editor canvas.upper-canvas");
    await expect(canvas).toBeVisible();
    await selectStarterChart(page);

    // The one canvas toolbar is the other surface that renders the same
    // registry, so its buttons are the expected entry set without restating the
    // registry here. It is the object half alone now — `vg-463` moved the eight
    // arrange actions to the inspector — so there is nothing to exclude and the
    // comparison is about that set on both surfaces.
    const dockNames = (
      await page
        .locator("[data-yunari-canvas-toolbar] button")
        .evaluateAll((buttons) =>
          buttons.map((button) => button.getAttribute("aria-label") ?? ""),
        )
    ).sort();

    // Off the gauge's centre, which is where its reading sits: a `Textbox`
    // hit-tests its glyphs, and a miss there lands on nothing — and a
    // right-click on nothing opens the *creation* menu, which is a different
    // menu and would make the dock/menu comparison vacuous.
    const gauge = await objectRect(page, "ram-gauge");
    const overGauge = await sceneToClient(
      page,
      STARTER_WIDTH,
      gauge.left + gauge.width / 2,
      gauge.top + 10,
    );
    await page.mouse.click(overGauge.x, overGauge.y, { button: "right" });

    const menu = page.locator('[aria-label="Canvas actions"]');
    await expect(menu).toBeVisible();
    const itemNames = (
      await menu
        .locator('[role="menuitem"]')
        .evaluateAll((items) =>
          items.map((item) => item.getAttribute("aria-label") ?? ""),
        )
    ).sort();

    // A menu that rendered nothing would satisfy a containment check.
    expect(dockNames.length).toBeGreaterThan(0);
    expect(itemNames).toEqual(dockNames);
    // Arrange has no `OBJECT_ACTIONS` id, so it belongs to neither surface's
    // entry set — and since `vg-463` it is not in the toolbar to leak from.
    expect(itemNames).not.toContain("Align left");

    // §4's mark has to **paint**, not merely be present. `vg-226`'s failure was
    // exactly that gap: both surfaces carried `data-yunari-destructive` and only
    // the dock resolved to `--hot`, because the colour came from a rule scoped to
    // the dock and the popup is portalled outside it. No vitest case can settle
    // it — jsdom has no cascade, so it can prove the attribute and never which
    // declaration wins — so two computed colours do. Delete must read the same
    // **on the dock and in the menu**, and differently from an ordinary action
    // sitting beside it in the same popup.
    const colours = await page.evaluate(() => {
      const colourOf = (root: ParentNode, label: string): string | null => {
        const control = root.querySelector<HTMLElement>(
          `[aria-label="${label}"]`,
        );
        return control === null ? null : getComputedStyle(control).color;
      };
      const popup = document.querySelector('[aria-label="Canvas actions"]');
      const dock = document.querySelector("[data-yunari-canvas-toolbar]");
      const footer = document.querySelector("[data-yunari-layer-actions]");
      return {
        menuDelete: popup === null ? null : colourOf(popup, "Delete"),
        menuDuplicate: popup === null ? null : colourOf(popup, "Duplicate"),
        dockDelete: dock === null ? null : colourOf(dock, "Delete"),
        footerDelete: footer === null ? null : colourOf(footer, "Delete"),
      };
    });
    expect(colours.menuDelete, "the menu offers a Delete entry").not.toBeNull();
    expect(colours.dockDelete, "and the dock does too").not.toBeNull();
    expect(
      colours.footerDelete,
      "and the layer footer does too",
    ).not.toBeNull();
    expect(
      colours.menuDelete,
      "Delete is §4's `--hot` in the dock and ordinary in the canvas menu",
    ).toBe(colours.dockDelete);
    expect(
      colours.footerDelete,
      "Delete is `--hot` in the layer footer and ordinary in the canvas menu",
    ).toBe(colours.menuDelete);
    expect(
      colours.menuDelete,
      "and it is the mark that paints it, not the surface's own text colour",
    ).not.toBe(colours.menuDuplicate);

    await captureVisualReview(page, testInfo, "editor-canvas-context-menu");

    // Phase 1 adds a second owner of the arrow keys. Read both axes of the
    // object's own origin point: `nudge-down` moves `top` and leaves `left`
    // alone, so the exact delta below pins the axis as well as the step. A lost
    // selection throws rather than returning nulls, or "did not move" would be
    // true for the wrong reason.
    const activePosition = async (): Promise<{
      left: number;
      top: number;
    }> =>
      page.evaluate(() => {
        const active = (
          window as unknown as {
            yunariEditorBridge: {
              editor: {
                canvas: {
                  getActiveObject():
                    | { left?: number; top?: number }
                    | undefined;
                };
              };
            };
          }
        ).yunariEditorBridge.editor.canvas.getActiveObject();
        if (active?.left === undefined || active.top === undefined) {
          throw new Error(
            "The test needs an active object with an origin point.",
          );
        }
        return { left: active.left, top: active.top };
      });
    const before = await activePosition();
    await page.keyboard.press("ArrowDown");
    await expect(menu.locator('[role="menuitem"]').first()).toBeVisible();
    const after = await activePosition();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    // The requirement this task exists to prove: with the menu open, the arrow
    // reaches no canvas owner, so the selection does not move at all.
    expect(after).toEqual(before);
    // And the control that stops that requirement from being vacuous: the arrow
    // must still nudge once the menu has closed. An exact delta, measured in
    // this browser as `(0, +1)` — `NUDGE_STEP` in `canvas-nudge.ts` — not
    // `not.toEqual(before)`, so a dead nudge and a wrong step both fail here
    // instead of sliding through.
    await page.keyboard.press("ArrowDown");
    const nudged = await activePosition();
    expect(nudged).toEqual({ left: before.left, top: before.top + 1 });
  });

  test("zooms and pans the canvas, and cannot lose the artboard", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    // Read the camera through its own accessor: `viewport.zoom()` is the owner
    // of zoom (Task 1), and `window.yunariEditorBridge` is the page handle
    // Plan B Task 4 established. Reaching into `canvas.getZoom()` through a
    // debug-key scan reads a different owner and breaks when the handle moves.
    const readZoom = () =>
      page.evaluate(() =>
        (
          window as unknown as {
            yunariEditorBridge: {
              editor: { viewport: { zoom(): number } };
            };
          }
        ).yunariEditorBridge.editor.viewport.zoom(),
      );
    // Clamping is the camera's own contract, so the transform is read through
    // the same bridge the zoom is: a debug-key scan would read whichever
    // editor mounted first and could assert a stale canvas entirely.
    const translate = () =>
      page.evaluate(() =>
        (
          window as unknown as {
            yunariEditorBridge: {
              editor: { canvas: { viewportTransform: number[] } };
            };
          }
        ).yunariEditorBridge.editor.canvas.viewportTransform.slice(4, 6),
      );

    const fitted = await readZoom();
    await page
      .locator("#yunari-fabric-editor canvas.upper-canvas")
      .hover({ position: { x: 200, y: 200 } });
    // Control is required: a plain wheel pans (Step 1 pins that), so wheeling
    // without it asserts the opposite of the unit contract and can only pass by
    // breaking it. Hold the modifier, then confirm the assertion fails with it
    // released — that is the teeth check for the modifier branch.
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -400);
    await page.keyboard.up("Control");
    expect(await readZoom()).toBeGreaterThan(fitted);
    // Pan a long way and confirm the artboard is still on screen: the clamped
    // transform keeps its edge inside the viewport.
    await page.keyboard.down("Space");
    await page.mouse.move(400, 400);
    await page.mouse.down();
    await page.mouse.move(4000, 4000, { steps: 20 });
    await page.mouse.up();
    await page.keyboard.up("Space");
    const transform = await page.evaluate(
      () =>
        (
          window as unknown as {
            yunariEditorBridge: {
              editor: { canvas: { viewportTransform: number[] } };
            };
          }
        ).yunariEditorBridge.editor.canvas.viewportTransform,
    );
    // The pan is clamped, so the transform saturates rather than running away.
    // Asserting only finiteness would pass for an unclamped transform — which is
    // exactly the regression this pins. Saturating is sign-agnostic and does not
    // depend on how viewportTransform[4] relates to clampPan's `offset`: drag
    // the same way again and the translate must not move.
    expect(Number.isFinite(transform[4])).toBe(true);
    expect(Number.isFinite(transform[5])).toBe(true);
    const atLimit = await translate();
    expect(atLimit.length).toBe(2);
    await page.keyboard.down("Space");
    await page.mouse.move(400, 400);
    await page.mouse.down();
    await page.mouse.move(4000, 4000, { steps: 20 });
    await page.mouse.up();
    await page.keyboard.up("Space");
    expect(await translate()).toEqual(atLimit);
  });

  test("tracks the camera's zoom in the stage readout", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "desktop surface");

    await page.goto(EDITOR);
    const readout = page.locator("[data-yunari-zoom]");
    await expect(readout).toBeVisible();
    // Read the camera, not the canvas: `ViewportManager` owns zoom, so only the
    // camera can tell a readout that stopped following it from one that works.
    const cameraZoom = () =>
      page.evaluate(() =>
        (
          window as unknown as {
            yunariEditorBridge: {
              editor: { viewport: { zoom(): number } };
            };
          }
        ).yunariEditorBridge.editor.viewport.zoom(),
      );
    const percent = async (): Promise<number> =>
      Number((await readout.textContent())?.replace("%", ""));
    const fitted = await percent();
    expect(fitted).toBe(Math.round((await cameraZoom()) * 100));

    // A pan moves the canvas without changing the zoom: this is what separates a
    // readout that tracks the camera from one rendered once at mount.
    await page.keyboard.down("Space");
    await page.mouse.move(400, 400);
    await page.mouse.down();
    await page.mouse.move(500, 470, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up("Space");
    expect(await percent()).toBe(fitted);

    // A wheel without the modifier pans too — only ctrl-wheel zooms.
    await page
      .locator("#yunari-fabric-editor canvas.upper-canvas")
      .hover({ position: { x: 200, y: 200 } });
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -400);
    await page.keyboard.up("Control");
    expect(await percent()).toBe(Math.round((await cameraZoom()) * 100));
    expect(await percent()).toBeGreaterThan(fitted);

    await captureVisualReview(page, testInfo, "editor-zoom-readout");
  });

  test("a pasteboard drag marquees instead of moving an object", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "desktop surface");
    await page.goto(EDITOR);

    // Scene-space document geometry, NOT object `left`. A marquee press puts the
    // hit objects inside an ActiveSelection, whose `enterGroup` rebases every
    // child's `left` to be relative to the selection — so comparing raw `left`
    // across a selection boundary reports a move for an object that never moved,
    // and cannot tell a marquee from a drag. `getBoundingRect` is the world-space
    // rect either way. `selected` is read as well because "nothing moved" alone
    // is satisfied by a drag that reached nothing at all.
    const read = (): Promise<{
      selected: number;
      rects: Array<[string, number, number]>;
    }> =>
      page.evaluate(() => {
        const bridge = (
          window as unknown as {
            yunariEditorBridge: {
              editor: {
                canvas: {
                  getActiveObject(): { getObjects?(): unknown[] } | undefined;
                  getObjects(): Array<{
                    id?: string;
                    getBoundingRect(): { left: number; top: number };
                  }>;
                };
              };
            };
          }
        ).yunariEditorBridge;
        const active = bridge.editor.canvas.getActiveObject();
        return {
          selected:
            active?.getObjects?.().length ?? (active === undefined ? 0 : 1),
          rects: bridge.editor.canvas
            .getObjects()
            .map((object) => {
              const bounds = object.getBoundingRect();
              return [
                String(object.id),
                Math.round(bounds.left),
                Math.round(bounds.top),
              ] as [string, number, number];
            })
            .sort((a, b) => (a[0] < b[0] ? -1 : 1)),
        };
      });

    // The artboard's rect from the camera, in CANVAS-element coordinates — not the
    // canvas box (the canvas is host-sized and much larger than the artboard now)
    // and not client space either. `vpt[4]`/`vpt[5]` are relative to the canvas
    // element, and the canvas sits at x~357 in the page, so the offset is added
    // below rather than assumed away.
    const rect = await page.evaluate(() => {
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
      return bridge.editor.viewport.artboardScreenRect();
    });
    const canvasBox = (await page
      .locator("#yunari-fabric-editor canvas.upper-canvas")
      .boundingBox())!;
    // Artboard point -> client point. The scale is uniform and derived from the
    // rect, so this mapping is correct whatever the artboard's aspect:
    // `fitScaleFor` is `Math.min(box.w/w, box.h/h)` (`viewport-manager/index.ts`), a
    // contain-fit, so at the measured 626x594 host the 1672x941 artboard draws
    // 626x352 and every point below y=941 in artboard space is BELOW the canvas.
    //
    // The `canvasBox.x/y` terms are the whole difference between this and a
    // vacuous test: without them every point below lands ~357px left and ~72px
    // above where it belongs, off the canvas, where the drag selects nothing and
    // the assertion passes while proving nothing.
    const scale = rect.width / STARTER_WIDTH;
    const at = (x: number, y: number): [number, number] => [
      canvasBox.x + rect.left + x * scale,
      canvasBox.y + rect.top + y * scale,
    ];

    const before = await read();

    // The pasteboard is the vertical band BELOW the artboard, and it is the only
    // one there is. `fitScaleFor` is a contain-fit, so at the 626x594 host the
    // scale is `min(626/1672, 594/941) = 0.374` and the artboard draws 626x352 —
    // full canvas width, centred vertically, leaving 121px bands above and below.
    // An earlier revision of this step claimed "about 240px of pasteboard below
    // the artboard and 350px to its right"; there is no pasteboard to its right,
    // and a pick point that assumed one would land off-canvas and pass vacuously.
    //
    // The press is placed by Y in the pasteboard band, and by X **off the
    // centre**: the canvas toolbar is bottom-centred and draws as soon as a
    // document is open (its arrange half greys before a selection), so a press at
    // the horizontal centre lands on the toolbar and the drag never reaches the
    // canvas. Left of the toolbar's width the band is clear at every X.
    const [sx, sy] = [canvasBox.x + 40, canvasBox.y + canvasBox.height - 16];
    // Both sides in client space: `rect` is canvas-relative, so its client
    // position is `canvasBox` + `rect`. Without the offsets these guards compare a
    // client point against a canvas-space edge and pass on a drag that is nowhere
    // near the pasteboard — the vacuity this test exists to remove, reintroduced
    // in the guard itself. The Y guard is the load-bearing one; the X guard only
    // records that the canvas is wider than the artboard's left edge, which is
    // trivially true and kept to document that X is unconstrained here.
    expect(sy).toBeGreaterThan(canvasBox.y + rect.top + rect.height);
    expect(sy).toBeLessThan(canvasBox.y + canvasBox.height);
    expect(sx).toBeGreaterThan(canvasBox.x + rect.left);
    const [ex, ey] = at(100, 200);

    await page.mouse.move(sx, sy);
    await page.mouse.down();
    // Past Fabric's marquee threshold before releasing: a zero-distance drag would
    // select nothing and pass without exercising the marquee at all.
    await page.mouse.move(ex, ey, { steps: 15 });
    await page.mouse.up();

    // A marquee selects, so the assertion is that no object MOVED — compared in
    // world space, because a selection rebases its members' `left`.
    expect((await read()).rects).toEqual(before.rects);
    // ...and that the marquee did reach the canvas at all: a drag whose press
    // landed off-canvas selects nothing, moves nothing, and would satisfy the
    // call above while exercising nothing.
    expect(before.selected).toBe(0);
    expect((await read()).selected).toBeGreaterThan(0);

    // The vacuity guard: the same gesture started INSIDE an object must move it.
    // Without this, a canvas that ignores pointer input entirely would pass the
    // assertions above.
    // The target is `time-card` (40,187 367x307), deliberately NOT the header:
    // Step 3 offers disarming `header-wash` as a fix, and a guard that drags inside
    // it would stop being interactive the moment that fix is taken,
    // failing for a reason unrelated to the marquee. (70,450) is inside the card
    // and outside every child it contains.
    const [ox, oy] = at(70, 450);
    await page.mouse.move(ox, oy);
    await page.mouse.down();
    await page.mouse.move(ox + 40, oy + 30, { steps: 10 });
    await page.mouse.up();
    expect((await read()).rects).not.toEqual(before.rects);
  });

  test("reorders a layer and moves one out of its group", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "desktop surface");

    await page.goto(EDITOR);
    // A fixture with both shapes the rule distinguishes: two plain siblings, and a
    // group whose child can be moved across the boundary. **It could not be, and
    // that was `vg-461` (item 4)**: the drop slots admitted only the slot the row
    // came from, so entering or leaving a group was refused by construction
    // rather than by a rule. The half below asserts the membership change now.
    // `yunariPaint` and `globals.palette` are not decoration: a literal `fill`
    // with no paint ref is `unresolved-global-ref` and `setThemePackage` asserts
    // `writeThemePackage` returned ok, so a fixture without them fails before the
    // editor opens. Copied from the `movable.yunari-theme` fixture at `:1322`.
    const paint = {
      palette: {
        none: {
          name: "None",
          value: { kind: "solid" as const, color: "transparent" },
        },
        accent: {
          name: "Accent",
          value: { kind: "solid" as const, color: ACCENT_PAINT },
        },
      },
    };
    const rect = (id: string, left: number, top: number) => ({
      type: "Rect",
      id,
      left,
      top,
      width: 40,
      height: 40,
      fill: ACCENT_PAINT,
      yunariPaint: { fill: "palette.accent" },
      originX: "left",
      originY: "top",
    });
    await setThemePackage(page, {
      schemaVersion: 2,
      fabricVersion: "7.4.0",
      id: "reorder",
      metadata: { themeLanguage: "en" },
      artboard: { width: 320, height: 180 },
      globals: paint,
      scene: {
        version: "7.4.0",
        objects: [
          rect("alpha", 20, 20),
          rect("beta", 80, 20),
          {
            type: "Group",
            id: "grp",
            left: 20,
            top: 90,
            objects: [{ ...rect("child", 0, 0), width: 30, height: 30 }],
          },
        ],
      },
    });
    // **`child` is a row only once `grp` is open**, and a group opens the way an
    // author opens it. Without this the drag below waits out its 30 s budget on
    // a row that does not exist — which reads as a broken drag rather than as a
    // shut tree. Expanded before `beforePanel` is read, so both order readings
    // contain the child and the reorder assertion compares like with like.
    await expandLayer(page, "grp");

    const panelOrder = (): Promise<(string | null)[]> =>
      page
        .locator("[data-yunari-layer]")
        .evaluateAll((rows) =>
          rows.map((row) => row.getAttribute("data-yunari-layer")),
        );
    // The panel paints topmost-first, so its row order is the reverse of the
    // serialized paint order. Compare the pair's *relative* order, never an
    // absolute index, so this holds whichever direction the projection uses.
    const idsIn = (envelope: unknown): string[] =>
      (
        envelope as { scene: { objects: Array<{ id?: string }> } }
      ).scene.objects.map((object) => object.id ?? "");
    const pairRelativeTo = (ids: string[]): boolean =>
      ids.indexOf("alpha") < ids.indexOf("beta");

    const beforeIds = idsIn(await saveEnvelope(page));
    const beforePanel = await panelOrder();
    expect(beforeIds).toContain("alpha");
    expect(beforeIds).toContain("beta");

    // Same parent: drop alpha on beta's row.
    await page
      .locator('[data-yunari-layer="alpha"]')
      .dragTo(page.locator('[data-yunari-layer="beta"]'));
    const afterPanel = await panelOrder();
    expect(afterPanel).not.toEqual(beforePanel);

    // Reordering is authored state (Step 4 calls `saveState`), so it must reach
    // the saved envelope — a panel-only change would be a projection bug.
    const afterIds = idsIn(await saveEnvelope(page));
    expect(pairRelativeTo(afterIds)).toBe(!pairRelativeTo(beforeIds));

    // Cross-group: a child dropped on a top-level sibling changes membership,
    // and that is the operation now (`vg-461`, item 4 — it was refused outright
    // when the slots admitted only the row's own). Membership is what this reads,
    // so it is read off the envelope, which is the only place the level exists:
    // **the panel is deliberately not asserted to change**, because a child
    // directly under `grp` paints in the same slot as a child inside it, and the
    // two orders are identical. What the panel is asked is only that the row
    // survived the drop.
    await page
      .locator('[data-yunari-layer="child"]')
      .dragTo(page.locator('[data-yunari-layer="alpha"]'));
    const moved = await saveEnvelope(page);
    // The group's own children, which `idsIn` does not reach: it reads the top
    // level only, and the whole point of this half is the level the child is on.
    const idsInside = (envelope: unknown, group: string): string[] => {
      const objects = (
        envelope as {
          scene: { objects: Array<{ id?: string; objects?: unknown[] }> };
        }
      ).scene.objects;
      const holder = objects.find((object) => object.id === group);
      return (holder?.objects ?? []).map(
        (child) => (child as { id?: string }).id ?? "",
      );
    };
    expect(idsIn(moved), "the child is a top-level object now").toContain(
      "child",
    );
    expect(
      idsInside(moved, "grp"),
      "and the group no longer holds it",
    ).not.toContain("child");
    expect(
      await panelOrder(),
      "and the row is still drawn, at the top level now",
    ).toContain("child");
  });

  test("nudges the selection and records one history entry", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "desktop surface");
    // A stopped clock, so the burst's 300 ms idle window (NUDGE_IDLE_MS) can
    // never fire between two presses. On the wall clock the CDP round trips
    // around the assertions below are enough to exceed it under worker load,
    // which split one burst into two entries and made the undo assertion depend
    // on how fast the machine was.
    await installFixedClock(page);
    await page.goto(EDITOR);
    // Select through the bridge, not the layer row: a focused panel row is a
    // different starting state, and this test is about the nudge binding.
    await page.evaluate(() => {
      (
        window as unknown as {
          yunariEditorBridge: { selectLayer(id: string): void };
        }
      ).yunariEditorBridge.selectLayer("time-rule");
    });
    // **World, not group-local.** `selectLayer` selects the owning group, so the
    // nudge moves the card and `time-rule`'s own `left` — its position inside
    // the card — never changes. Reading that field would report a nudge that
    // did not happen as one that did not either, which is the harder failure to
    // see. `objectRect` descends into the group and composes the transform.
    const left = async (): Promise<number> =>
      (await objectRect(page, "time-rule")).left;
    const before = await left();
    await page.keyboard.press("ArrowRight");
    expect(await left()).toBeCloseTo(before + 1, 5);
    await page.keyboard.press("Shift+ArrowRight");
    expect(await left()).toBeCloseTo(before + 11, 5);

    // Control+z immediately after the burst's last press: the burst's entry is
    // not recorded until it closes, so the undo binding must close it first.
    await page.keyboard.press("Control+z");
    expect(await left()).toBeCloseTo(before, 5);
    // Both presses are one entry, so one redo must restore the *whole* burst. A
    // mechanism that recorded two entries would land at `before + 1` here.
    await page.keyboard.press("Control+y");
    expect(await left()).toBeCloseTo(before + 11, 5);

    const selectedIds = (): Promise<Array<string | undefined>> =>
      page.evaluate(() => {
        const b = (
          window as unknown as {
            yunariEditorBridge: {
              editor: {
                canvas: { getActiveObjects(): Array<{ id?: string }> };
              };
            };
          }
        ).yunariEditorBridge;
        return b.editor.canvas.getActiveObjects().map((object) => object.id);
      });

    // Ctrl+A inside a text field belongs to the field, not to select-all. Focus
    // the layer rename input (Plan B Task 5) and confirm the selection is
    // untouched; without this the binding silently steals the field's own
    // select-all and the author's typed text is never selected.
    //
    // The row is opened from the tree rather than the canvas because a card's
    // parts are shut by default, and `time-rule` is inside one.
    await expandLayer(page, "group-time-card");
    await page.locator('[data-yunari-layer="time-rule"]').dblclick();
    const rename = page.locator('input[aria-label^="Rename"]');
    await expect(rename).toBeFocused();
    await rename.press("Control+a");
    // The row names the part, but `selectLayer` reaches it through its owning
    // group — the same rule the canvas click follows.
    expect(await selectedIds()).toEqual(["group-time-card"]);

    // ...and the same key with focus on the document does select everything.
    // Without this the test only ever proves the binding stays silent.
    await rename.blur();
    await page.keyboard.press("Control+a");
    const ids = await selectedIds();
    expect(ids.length).toBeGreaterThan(1);
    // The theme's full-artboard `background` rect is `selectable: false` but IS
    // returned by `getObjects()`; selecting it would let the next nudge drag the
    // background off the artboard.
    expect(ids).not.toContain("background");
  });

  test("reorders and redoes on the graphic-editor's own chords", async ({
    page,
  }, testInfo) => {
    // **The chords, not the table.** A binding can sit in `PRODUCT_SHORTCUTS` and
    // still never reach the wire — a browser reports the *shifted* character for
    // Ctrl+Shift+[ and Ctrl+Shift+], so a table written against `[` and `]`
    // alone matches nothing. Only pressing the real keys proves the binding.
    test.skip(!isDesktopSurface(testInfo), "desktop surface");
    await installFixedClock(page);
    await page.goto(EDITOR);

    const paintOrder = (): Promise<Array<string | undefined>> =>
      page.evaluate(() => {
        const b = (
          window as unknown as {
            yunariEditorBridge: {
              editor: {
                canvas: {
                  getObjects(): Array<{ id?: string }>;
                  getActiveObject(): { id?: string } | undefined;
                };
              };
            };
          }
        ).yunariEditorBridge;
        return b.editor.canvas.getObjects().map((object) => object.id);
      });
    const selectThroughBridge = (id: string): Promise<void> =>
      page.evaluate((layerId) => {
        (
          window as unknown as {
            yunariEditorBridge: { selectLayer(id: string): void };
          }
        ).yunariEditorBridge.selectLayer(layerId);
      }, id);

    /**
     * Presses a chord **as a physical keyboard delivers it**, over CDP.
     *
     * `page.keyboard.press("Control+Shift+]")` looks like the same gesture and is
     * not: it dispatches `key: "]"`, because Playwright synthesises the key by
     * name and never applies the shift-to-character mapping a real layout does.
     * A US keyboard with Shift held reports `key: "}"`. So the obvious press
     * exercises a *different event* from the one an arriving author generates,
     * and a binding keyed on the shifted character — the correct one — fails
     * under it. Verified by reading `event.key` in the page: `press` gave
     * `key="]" shift=true`, the CDP dispatch below gives `key="}" shift=true`.
     *
     * `page.keyboard.press` is still right for the plain chords below, which
     * produce the same event either way.
     */
    const cdp = await page.context().newCDPSession(page);
    const pressChord = async (
      key: string,
      code: string,
      virtualKey: number,
    ): Promise<void> => {
      await cdp.send("Input.dispatchKeyEvent", {
        type: "rawKeyDown",
        key,
        code,
        windowsVirtualKeyCode: virtualKey,
        // 2 = Ctrl, 8 = Shift.
        modifiers: 10,
      });
    };

    // **The subject is whichever object the starter paints second**, read rather
    // than assumed: the starter's absolute order is the fixture's business, and
    // the full-artboard `background` rect is in `getObjects()` but is not
    // selectable, so a hardcoded "first layer" would be a guess about both.
    const start = await paintOrder();
    const subject = start[1];
    if (subject === undefined)
      throw new Error("starter painted too few objects");
    await selectThroughBridge(subject);

    // **To front, on the standard chord**: Ctrl+Shift+], arriving as `}`.
    await pressChord("}", "BracketRight", 221);
    const afterFront = await paintOrder();
    expect(afterFront.at(-1)).toBe(subject);
    expect(afterFront).not.toEqual(start);

    // **To back, on the standard chord**: Ctrl+Shift+[, arriving as `{`.
    // Sending the *second* object to the back swaps it with the first, so the
    // order is the one-rotation of `start`, not `start` itself — comparing
    // against the full start would be arithmetic about the starter's order
    // rather than evidence about the binding.
    await pressChord("{", "BracketLeft", 219);
    const afterBack = await paintOrder();
    expect(afterBack[0]).toBe(subject);
    expect(afterBack.slice(1)).toEqual(start.filter((id) => id !== subject));

    // **The bare pair still works** — additive, not a replacement. Without this
    // the test only ever proves the new chords fire, and a regression that
    // deleted the old ones would pass.
    await page.keyboard.press("Control+]");
    expect((await paintOrder()).at(-1)).toBe(subject);
    await page.keyboard.press("Control+[");
    expect(await paintOrder()).toEqual(afterBack);

    // **Redo, on the standard chord.** The discriminator: after the redo below
    // the history holds no later entry, so a *second* Ctrl+Shift+Z that was
    // really an undo would step back to `before` and fail this assertion.
    const left = (): Promise<number | undefined> =>
      page.evaluate((id) => {
        const b = (
          window as unknown as {
            yunariEditorBridge: {
              editor: {
                canvas: {
                  getObjects(): Array<{ id?: string; left?: number }>;
                };
              };
            };
          }
        ).yunariEditorBridge;
        return b.editor.canvas.getObjects().find((object) => object.id === id)
          ?.left;
      }, subject);
    const before = await left();
    if (typeof before !== "number")
      throw new Error(`${subject} is missing from the canvas`);
    await page.keyboard.press("ArrowRight");
    expect(await left()).toBe(before + 1);
    await page.keyboard.press("Control+z");
    expect(await left()).toBe(before);

    await page.keyboard.press("Control+Shift+z");
    expect(await left()).toBe(before + 1);
    await page.keyboard.press("Control+Shift+z");
    expect(await left()).toBe(before + 1);

    // **Ctrl+Y is still redo**, which is why the new chord was added beside it
    // rather than in place of it.
    await page.keyboard.press("Control+z");
    expect(await left()).toBe(before);
    await page.keyboard.press("Control+y");
    expect(await left()).toBe(before + 1);
  });
});

async function saveEnvelope(page: Page): Promise<unknown> {
  const { parsed } = await savePackage(page);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.envelope;
}

async function savePackage(page: Page): Promise<{
  readonly parsed: ReturnType<typeof readThemePackage>;
  readonly bytes: Buffer;
}> {
  const download = page.waitForEvent("download");
  // The File menu owns Save; the header's own button is gone, so the row is the
  // one route an author takes.
  await page.getByRole("button", { name: "File", exact: true }).click();
  // **Not `exact`, and the row is why.** A row that prints a chord carries the
  // chord's `aria-label` inside it (`shell-menu-bar.tsx`), and a descendant's
  // `aria-label` joins the ancestor's name-from-content — measured: the three
  // chorded File rows compute a name their own label does not equal, so
  // `exact: true` matched none of them. Which rows print a chord is the markup's
  // business, so demanding the label *be* the whole name makes the locator fail
  // whenever the product adds one.
  await page.getByRole("menuitem", { name: "Save package" }).click();
  // **Contained, not exact.** The status line also carries whatever diagnostic
  // is on screen, and a diagnostic is retired by the next *committed* edit — so
  // a save immediately after a refusal reads as both. The claim here is that
  // the save happened, which is what the contained text states; demanding the
  // line be empty of everything else would be demanding the shell forget a
  // message the author has not yet had an edit to replace it.
  await expect(page.locator("#status")).toContainText("Theme package saved");
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks);
  return { parsed: readThemePackage(bytes), bytes };
}

/**
 * The two-rectangle document both entered-group cases drive: one rectangle
 * inside a group's own part and one outside it, with nothing else on the
 * canvas, so a pixel at either centre is the whole of what entering reaches.
 */
function groupDimEnvelope(): Parameters<
  typeof writeThemePackage
>[0]["envelope"] {
  return {
    schemaVersion: 2,
    fabricVersion: "7.4.0",
    id: "group-dim",
    metadata: { themeLanguage: "en" },
    artboard: { width: 320, height: 180 },
    globals: {
      palette: {
        none: {
          name: "None",
          value: { kind: "solid", color: "transparent" },
        },
        accent: {
          name: "Accent",
          value: { kind: "solid", color: ACCENT_PAINT },
        },
      },
    },
    scene: {
      version: "7.4.0",
      objects: [
        {
          type: "Group",
          id: "grp",
          left: 40,
          top: 40,
          width: 30,
          height: 30,
          objects: [
            {
              type: "Rect",
              id: "child",
              left: 0,
              top: 0,
              width: 30,
              height: 30,
              fill: ACCENT_PAINT,
              yunariPaint: { fill: "palette.accent" },
              originX: "left",
              originY: "top",
            },
          ],
        },
        {
          type: "Rect",
          id: "outside",
          left: 240,
          top: 40,
          width: 30,
          height: 30,
          fill: ACCENT_PAINT,
          yunariPaint: { fill: "palette.accent" },
          originX: "left",
          originY: "top",
        },
      ],
    },
  };
}

/**
 * Opens `envelope` through the store's own **Open in editor** control — the
 * route a document comes through now that the picker is an import. The package
 * is still written, so the fixture is refused here rather than at the editor;
 * the status line reports the *document's* name, which `openThemeFromStore`
 * asserts.
 */
async function setThemePackage(
  page: Page,
  envelope: Parameters<typeof writeThemePackage>[0]["envelope"],
  status?: string | RegExp,
): Promise<void> {
  const result = writeThemePackage({ envelope, assets: {} });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  await openThemeFromStore(page, storedThemeOfPackage(result.bytes), status);
}

/** The same, for a document the package writer would refuse: the stub serves
 *  the envelope as it stands, so the editor's own validator is what is tested. */
async function setUncheckedThemePackage(
  page: Page,
  envelope: unknown,
  status?: string | RegExp,
): Promise<void> {
  await openThemeFromStore(
    page,
    { envelope: envelope as FabricThemeEnvelope },
    status,
  );
}

/**
 * A point inside the starter gauge that is not covered by the reading centred in
 * it. The gauge's own centre is the obvious choice and the wrong one: a text
 * object is selectable in its own right, so a click there selects the label and
 * the chart panel never opens. The gauge's box is opaque, so anywhere inside it
 * off the label's measured run will do.
 */
async function clientOfStarterGauge(
  page: Page,
): Promise<{ x: number; y: number }> {
  return sceneToClient(page, STARTER_WIDTH, 1068, 375);
}

/**
 * Selects the RAM card's gauge, by entering the card and picking its row.
 *
 * **Two gestures, because the spec says they are two** (§3): a click *selects*
 * and gives the card's settings; entering gives the parts. The RAM gauge is a
 * part, so it is reached by entering — `bridge.selectLayer` takes
 * `owner ?? target`, so with the card merely open a click on the gauge's row
 * hands back the card.
 *
 * The single click this used to be asserted `ram-gauge` and now gets
 * `group-ram-card`, which is the correct answer to a different question: the
 * card *is* what a click on it selects. This helper's subject is the chart, so
 * it takes the route that reaches a chart — a canvas double-click until the
 * row grew a control for entering, and the row's own since.
 */
async function selectStarterChart(page: Page): Promise<void> {
  await enterLayer(page, "group-ram-card");
  await page.locator('[data-yunari-layer="ram-gauge"]').click();
  // The precondition this helper never had: a wrong selection used to surface
  // as a confusing timeout in the lookup below, so name the failure here.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              yunariEditorBridge: {
                editor: {
                  canvas: {
                    getActiveObject(): { id?: string } | undefined;
                  };
                };
              };
            }
          ).yunariEditorBridge.editor.canvas.getActiveObject()?.id ?? null,
      ),
    )
    .toBe("ram-gauge");
  // A chart's own fields are in the column with the selection, not another tab.
  await expect(
    page.locator('[data-yunari-chart-setting="thickness"]'),
  ).toBeVisible();
}

/**
 * Opens a group in the layer tree, by its own twisty.
 *
 * A group is shut by default, so a test that wants a row inside one has to open
 * it first — the same two steps an author takes. Driven through the button
 * rather than the bridge so the row that appears is the one the panel painted.
 */
async function assetReferences(page: Page): Promise<unknown[]> {
  return page.evaluate(() => {
    const editor = Object.entries(
      window as unknown as Record<string, unknown>,
    ).find(
      ([key, value]) =>
        key.startsWith("yunari-fabric-editor-") &&
        (value as { canvas: { upperCanvasEl?: HTMLCanvasElement } }).canvas
          .upperCanvasEl?.isConnected,
    )?.[1] as
      | {
          canvas: {
            getObjects(): Array<{
              get(name: string): unknown;
              getObjects?: () => unknown[];
            }>;
          };
        }
      | undefined;
    // **Groups descended**, for the reason `readSceneObject` exists: a card's
    // parts are not in `getObjects()`, so a root-only walk reported `[]` for an
    // image the document demonstrably carried.
    const found: unknown[] = [];
    const visit = (
      objects: readonly {
        get(name: string): unknown;
        getObjects?: () => readonly unknown[];
      }[],
    ): void => {
      for (const object of objects) {
        if (object.get("type") === "image")
          found.push(object.get("yunariAsset"));
        visit(
          (object.getObjects?.() ?? []) as readonly {
            get(name: string): unknown;
            getObjects?: () => readonly unknown[];
          }[],
        );
      }
    };
    visit(editor?.canvas.getObjects() ?? []);
    return found;
  });
}

/**
 * Every object in a saved envelope, groups descended.
 *
 * The same defect as `readSceneObject` had, one layer out: the saved document
 * is Fabric JSON, so a card is a group and its parts live under `objects`. A
 * `.find` over the top level reported `undefined` for `ram-gauge` — a chart
 * the author can see and click — and the assertion failed as a *missing
 * setting* rather than as a search that stopped too early, which is the harder
 * failure to read.
 *
 * Read rather than written per call site so no assertion can quietly keep its
 * own shallower search.
 */
function sceneObjects(envelope: unknown): ReadonlyArray<SceneObjectJson> {
  const root = (
    envelope as {
      scene: { objects: readonly SceneObjectJson[] };
    }
  ).scene.objects;
  const all: SceneObjectJson[] = [];
  const visit = (objects: readonly SceneObjectJson[]): void => {
    for (const object of objects) {
      all.push(object);
      if (Array.isArray(object["objects"])) visit(object["objects"]);
    }
  };
  visit(root);
  return all;
}

/** One object out of a saved envelope, wherever it sits. */
function sceneObject(
  envelope: unknown,
  id: string,
): SceneObjectJson | undefined {
  return sceneObjects(envelope).find((object) => object["id"] === id);
}

function leftFor(envelope: unknown, id: string): number {
  const left = sceneObject(envelope, id)?.["left"];
  expect(left).toEqual(expect.any(Number));
  return left as number;
}
