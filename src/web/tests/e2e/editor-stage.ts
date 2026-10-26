import { expect, type Page } from "@playwright/test";
import { uiCopy } from "../../packages/editor/src/ui-copy.js";
import { chooseIn } from "./control-set.js";
import { openPane } from "./editor-rail.js";

/**
 * The stage: framing, the display screen, the media layer and the pixels the
 * browser actually paints.
 *
 * Shared by `editor-display.spec.ts`, which stays tests. It holds both the
 * actions those tests drive (choosing a lens, importing a picture, opening
 * settings, creating a theme) and the measurements they read back, so a claim
 * about the display is written once.
 */

/** The editor preview every editor spec in this suite drives, named outright.
 *
 *  Relative (`"/"`) would resolve against `baseURL`, which is 4173 — the
 *  *player* — and the whole file would wait for `#yunari-fabric-editor` that
 *  is not there. That is what an exclusion list would have papered over
 *  instead: the spec would stay out of the default gate rather than join it. */
export const EDITOR = "http://127.0.0.1:4174/";

/** The starter's artboard, as the theme declares it. */
export const STARTER = { width: 1672, height: 941 } as const;

export type Bridge = {
  editor: {
    artboard(): { readonly width: number; readonly height: number };
    /** Fabric's canvas, read for the plate's paint and the viewport transform —
     *  the drawing itself rather than a summary of it. */
    canvas: unknown;
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
      panBy(deltaX: number, deltaY: number): void;
    };
  };
  selectLayer(id: string): void;
};

export type Measured = {
  readonly display: string | undefined;
  readonly screen: { left: number; top: number; width: number; height: number };
  readonly board: { left: number; top: number; width: number; height: number };
  /** The lower canvas' own box in page coordinates. */
  readonly stage: { x: number; y: number; width: number; height: number };
};

/** The camera's own geometry, plus the stage it is measured against. */
export async function measure(page: Page): Promise<Measured> {
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

export const aspect = (r: { width: number; height: number }): number =>
  r.width / r.height;

/** The four corners of a box, in the same coordinates it was read in. */
export function corners(r: {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}): { readonly x: number; readonly y: number }[] {
  return [
    { x: r.left, y: r.top },
    { x: r.left + r.width, y: r.top },
    { x: r.left, y: r.top + r.height },
    { x: r.left + r.width, y: r.top + r.height },
  ];
}

/** The Assets pane, where a picture is declared and the background is set. */
export async function openAssets(page: Page): Promise<void> {
  await openPane(page, "Assets");
}

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
export async function freezeClock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const fixed = 1_760_000_000_000;
    Date.now = () => fixed;
  });
}

/** Picks a display through the stage's own control, by its visible name. */
export async function chooseDisplay(page: Page, name: string): Promise<void> {
  await page.locator("[data-yunari-zoom]").click();
  await page.getByRole("menuitemradio", { name }).click();
}

/** The chooser's display control, by the hook the control itself carries. It is
 *  a `ControlSelect` now, so the list is a Base UI popup rather than a native
 *  `<select>` — `chooseIn` scopes to the popup the trigger's own `aria-controls`
 *  names. **Not a bare `[data-yunari-option]` lookup**: the display list and
 *  the ratio list are both keyed by aspect ratio, so an unscoped `9:19.5`
 *  resolves to two rows once either has been opened. */
export const CHOOSER_DISPLAY = "[data-yunari-new-document-display]";

/** Where each menu label sits, in page px, measured on the live menu.
 *
 *  The label is a text node inside the item, so it is measured through a
 *  `Range` rather than a bounding box of its own. */
export async function labelOffsets(
  page: Page,
): Promise<Record<string, number>> {
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
export async function openMenu(page: Page): Promise<void> {
  await page.locator("[data-yunari-zoom]").click();
  await expect(page.getByRole("menu")).toBeVisible();
}

export const STAGE = ".editor-shell-stage";
export const SCREEN = "[data-yunari-display-screen]";
export const MEDIA = "[data-yunari-background-media]";

/** Solid 8×8 PNGs, generated once: a media layer whose painted colour is known
 *  is what turns "the media is on top" into a pixel reading rather than a
 *  stacking-order assertion that the screen could satisfy while painted over. */
export const RED_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAEklEQVR4nGP4z8DwHx9mGBkKAMLXf4EvceABAAAAAElFTkSuQmCC";
export const BLUE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAEUlEQVR4nGNgYPj/Hz8eEQoAQ1d/gZtbdTsAAAAASUVORK5CYII=";

export const solidPng = (name: string, base64: string) => ({
  name,
  mimeType: "image/png",
  buffer: Buffer.from(base64, "base64"),
});

export type Box = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** One element's page box, or a failure naming what was not drawn. */
export async function boxOf(page: Page, selector: string): Promise<Box> {
  const box = await page.locator(selector).boundingBox();
  if (box === null) throw new Error(`${selector} was not drawn`);
  return box;
}

/** The media layer's box, in canvas coordinates beside the camera's zoom. */
export async function mediaGeometry(page: Page): Promise<{
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly zoom: number;
}> {
  return page.evaluate(() => {
    const bridge = (window as unknown as { yunariEditorBridge: Bridge })
      .yunariEditorBridge;
    const layer = document.querySelector("[data-yunari-background-media]");
    const canvas = document.querySelector(
      "#yunari-fabric-editor canvas.lower-canvas",
    );
    if (layer === null || canvas === null)
      throw new Error("the media layer or its canvas was not mounted");
    const media = layer.getBoundingClientRect();
    const host = canvas.getBoundingClientRect();
    return {
      left: media.left - host.left,
      top: media.top - host.top,
      width: media.width,
      height: media.height,
      zoom: bridge.editor.viewport.zoom(),
    };
  });
}

/** Moves the camera the way a drag does, through the camera's own writer. */
export async function panCamera(
  page: Page,
  dx: number,
  dy: number,
): Promise<void> {
  await page.evaluate(
    ([deltaX, deltaY]) => {
      const bridge = (window as unknown as { yunariEditorBridge: Bridge })
        .yunariEditorBridge;
      bridge.editor.viewport.panBy(deltaX ?? 0, deltaY ?? 0);
    },
    [dx, dy] as const,
  );
}

/** The stage's own painted background, as the browser computes it. */
export async function stageBackground(page: Page): Promise<string> {
  return page.locator(STAGE).evaluate((node) => {
    return getComputedStyle(node).backgroundImage;
  });
}

/** Opens Settings on one tab, the way the rail's gear does. */
export async function openSettings(page: Page, tab: string): Promise<void> {
  await page.locator(".editor-shell-rail-settings").click();
  const dialog = page.getByRole("dialog", { name: uiCopy.settings.title });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: tab }).click();
}

export async function closeSettings(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: uiCopy.settings.title }),
  ).toBeHidden();
}

export async function addRatio(page: Page, ratio: string): Promise<void> {
  await page.locator("[data-yunari-preview-ratio-input]").fill(ratio);
  await page.locator("[data-yunari-preview-ratio-add]").click();
}

/** Removes one stored token. The button is keyed by the token, so a row of
 *  `7:3` removes `7:3` once — its `3:7` twin is derived, not a second entry. */
export async function removeRatio(page: Page, token: string): Promise<void> {
  await page.locator(`[data-yunari-preview-ratio-remove="${token}"]`).click();
}

export async function ratioRows(page: Page): Promise<readonly string[]> {
  return page
    .locator("[data-yunari-preview-ratio]")
    .evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-yunari-preview-ratio") ?? ""),
    );
}

/** Reset is a return to the defaults, and at the defaults it is disabled: a
 *  disabled button is already the state this asks for, not a skipped step. */
export async function resetRatios(page: Page): Promise<void> {
  const reset = page.locator("[data-yunari-preview-ratio-reset]");
  await expect(reset).toBeVisible();
  if (await reset.isEnabled()) await reset.click();
}

/** Every radio item in the display menu, by its accessible name, in order. */
export async function displayMenuItems(page: Page): Promise<readonly string[]> {
  await page.locator("[data-yunari-zoom]").click();
  const items = page.getByRole("menuitemradio");
  await expect(items.first()).toBeVisible();
  const labels = await items.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("aria-label") ?? ""),
  );
  await page.keyboard.press("Escape");
  return labels;
}

/** Creates a blank theme — the plate is painted, and no media is declared. */
export async function createBlankTheme(page: Page): Promise<void> {
  await page.keyboard.press("Control+n");
  const chooser = page.locator('[role="dialog"]');
  await expect(chooser).toBeVisible();
  await chooser.locator("[data-yunari-new-document-create]").click();
  const prompt = page.locator('[role="dialog"]');
  await prompt
    .waitFor({ state: "visible", timeout: 3_000 })
    .then(() =>
      prompt.getByRole("button", { name: "Discard", exact: true }).click(),
    )
    .catch(() => undefined);
  await expect(page.locator("#status-message")).toHaveText("New theme");
}

/** Opens the new-theme chooser and returns the size it currently shows. */
export async function openNewDocument(page: Page): Promise<string> {
  await page.keyboard.press("Control+n");
  const chooser = page.locator('[role="dialog"]', {
    hasText: uiCopy.newDocument.chooseSize,
  });
  await expect(chooser).toBeVisible();
  return chooser.locator("[data-yunari-new-document-size]").innerText();
}

export async function pickPreview(page: Page, lens: string): Promise<void> {
  await chooseIn(page, CHOOSER_DISPLAY, lens);
}

export async function chooserSize(page: Page): Promise<string> {
  return page
    .locator('[role="dialog"]')
    .locator("[data-yunari-new-document-size]")
    .innerText();
}

/** Imports a picture through the Assets pane's own background action, which is
 *  the one path that changes the background asset and so remounts the layer. */
export async function importBackground(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  // `count()` first: `getAttribute` on a locator that matches nothing waits for
  // the whole test timeout before it answers, which is how this call spent its
  // 30 s before the first picture existed.
  const images = page.locator(`${MEDIA} img`);
  const before =
    (await images.count()) === 0 ? null : await images.getAttribute("src");
  const chooser = page.waitForEvent("filechooser");
  await page.locator("[data-yunari-asset-import-background]").click();
  await (await chooser).setFiles(file);
  await expect
    .poll(
      () =>
        page
          .locator(`${MEDIA} img`)
          .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("src")))
          .then((sources) => sources[0] ?? null),
      { message: "the background media was replaced" },
    )
    .not.toBe(before);
  await expect
    .poll(() =>
      page.locator(`${MEDIA} img`).evaluateAll((nodes) =>
        nodes.some((node) => {
          const image = node as HTMLImageElement;
          return image.complete && image.naturalWidth > 0;
        }),
      ),
    )
    .toBe(true);
}

/** Selects the background row and asks it to fill the display rather than the
 *  theme — the bounds control the inspector already owns. */
export async function fillDisplayBounds(page: Page): Promise<void> {
  // `$background` is `BACKGROUND_LAYER_ID`; naming it here rather than importing
  // the layer tree keeps Fabric out of the e2e process.
  await page.evaluate(() => {
    const bridge = (window as unknown as { yunariEditorBridge: Bridge })
      .yunariEditorBridge;
    bridge.selectLayer("$background");
  });
  const bounds = page.locator("[data-yunari-background-bounds]");
  await expect(bounds).toBeVisible();
  await chooseIn(page, bounds, "display");
}

/** One rendered pixel, read from a 1×1 screenshot so it is the page's paint
 *  rather than an element's claim about itself. */
export async function pixelAt(
  page: Page,
  x: number,
  y: number,
): Promise<readonly number[]> {
  const shot = await page.screenshot({
    clip: { x: Math.round(x), y: Math.round(y), width: 1, height: 1 },
  });
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(
      new Blob([bytes], { type: "image/png" }),
    );
    const canvas = new OffscreenCanvas(1, 1);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no 2d context for the sample");
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, 1, 1).data;
    return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0];
  }, shot.toString("base64"));
}

/** Whether a sampled pixel is the colour a solid picture was made of. */
export function isColour(
  sample: readonly number[],
  want: readonly [number, number, number],
  tolerance = 24,
): boolean {
  return want.every(
    (channel, index) => Math.abs((sample[index] ?? 0) - channel) <= tolerance,
  );
}

/** The board's page box, read through Fabric's own viewport transform rather
 *  than the camera helper the guide is written from — two paths to one box. */
export async function artboardPageBox(page: Page): Promise<{
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}> {
  return page.evaluate(() => {
    const bridge = (window as unknown as { yunariEditorBridge: Bridge })
      .yunariEditorBridge;
    const canvas = bridge.editor.canvas as unknown as {
      viewportTransform: number[];
      lowerCanvasEl: HTMLCanvasElement;
    };
    const transform = canvas.viewportTransform;
    const host = canvas.lowerCanvasEl.getBoundingClientRect();
    const board = bridge.editor.artboard();
    const scale = transform[0] ?? 1;
    return {
      left: host.left + (transform[4] ?? 0),
      top: host.top + (transform[5] ?? 0),
      width: board.width * scale,
      height: board.height * (transform[3] ?? scale),
    };
  });
}

/** The artboard's rendered extent, from the lower canvas' own pixels.
 *
 *  The canvas clips to the artboard, so its non-transparent bounding box is the
 *  board the browser actually painted — not the camera's opinion of where the
 *  board is. **The canvas element's pixels, not a page screenshot**: the page
 *  composites the lens's letterbox behind the canvas, and the letterbox is
 *  painted from the same theme paint as the plate, so a screenshot's colour
 *  scan would return the display's disc instead of the board. */
export async function canvasInkBox(page: Page): Promise<{
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      "#yunari-fabric-editor canvas.lower-canvas",
    );
    if (canvas === null) throw new Error("no lower canvas in the editor");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) throw new Error("no 2d context for the lower canvas");
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const painted = canvas.getBoundingClientRect();
    const scale = canvas.width / painted.width;
    let left = image.width;
    let top = image.height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const alpha = image.data[(y * image.width + x) * 4 + 3] ?? 0;
        if (alpha === 0) continue;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
    if (right < 0) throw new Error("the lower canvas painted nothing");
    return {
      left: painted.left + left / scale,
      top: painted.top + top / scale,
      width: (right - left + 1) / scale,
      height: (bottom - top + 1) / scale,
    };
  });
}
