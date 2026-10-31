import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { FabricThemeEnvelope } from "@yunari/renderer-core";
import { writeThemePackage } from "@yunari/theme-package";
import { objectHandleScenePoint, sceneToClient } from "./editor-canvas.js";
import { openPane } from "./editor-rail.js";
import { HOST_PORT, HOST_THEMES_DIR } from "./host-theme.js";
import {
  addButton,
  insertTextBox,
  openBlank,
  placeText,
  readObject,
  readScene,
  type SceneObject,
  selectLayer,
} from "./rebuild-driver.js";
import { isDesktopSurface } from "./surface.js";

/**
 * Text and Text box authoring, in the browser the author uses.
 *
 * The class is the width mode: a click places an `IText` that measures its own
 * ink, a drag draws a `Textbox` whose authored box is the rectangle. These cases
 * read the live Fabric objects through the editor handle, the rendered inspector,
 * the saved package and the player, because a class change that only shows up
 * after a save is exactly the defect this phase exists to catch.
 */

const EDITOR = "http://127.0.0.1:4174/";
const HOST = `http://127.0.0.1:${HOST_PORT}`;
const HOST_EDITOR = `${HOST}/editor/`;
/** `openBlank`'s default: 16:9 at 1080p. Scene points are in these units. */
const ARTBOARD_WIDTH = 1920;
const ARTBOARD_HEIGHT = 1080;
/** Wider than the placeholder, so growth is a measurement and not a guess. */
const GROWN_TEXT = "A much wider strapline";
/** Longer than the drawn box is wide, so it must occupy more than one line. */
const WRAPPED_TEXT =
  "A paragraph long enough that a box this wide has to wrap it";
/** Words typed into a placed Text, and the words a reopen must still hold. */
const TYPED_TEXT = "Typed into a placed text";

type TextState = {
  readonly id: string;
  readonly type: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly editing: boolean;
  readonly text: string;
  readonly lines: number;
  readonly editable: boolean;
  readonly controls: readonly string[];
};

/** One object's live Fabric state, read through the editor handle by id. */
async function textState(
  page: Page,
  id: string,
): Promise<TextState | undefined> {
  return page.evaluate((objectId) => {
    type Node = {
      readonly type: string;
      readonly left?: number;
      readonly top?: number;
      readonly width?: number;
      readonly height?: number;
      readonly scaleX?: number;
      readonly scaleY?: number;
      readonly isEditing?: boolean;
      readonly textLines?: readonly unknown[];
      readonly controls?: Readonly<Record<string, unknown>>;
      readonly enterEditing?: unknown;
      get(name: string): unknown;
    };
    const bridge = (
      window as unknown as {
        yunariEditorBridge?: {
          editor: { canvas: { getObjects(): Node[] } };
        };
      }
    ).yunariEditorBridge;
    const object = bridge?.editor.canvas
      .getObjects()
      .find((candidate) => String(candidate.get("id") ?? "") === objectId);
    if (object === undefined) return undefined;
    return {
      id: objectId,
      type: object.type,
      left: Math.round(object.left ?? 0),
      top: Math.round(object.top ?? 0),
      width: Math.round(object.width ?? 0),
      height: Math.round(object.height ?? 0),
      scaleX: object.scaleX ?? 1,
      scaleY: object.scaleY ?? 1,
      editing: object.isEditing === true,
      text: (object as { readonly text?: string }).text ?? "",
      lines: object.textLines?.length ?? 0,
      editable: typeof object.enterEditing === "function",
      controls: Object.keys(object.controls ?? {}),
    };
  }, id);
}

/** The scene's own facts, by id, after a save or a reopen. */
async function factsById(
  page: Page,
): Promise<ReadonlyMap<string, SceneObject>> {
  return new Map((await readScene(page)).map((object) => [object.id, object]));
}

async function cursorOf(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          yunariEditorBridge: {
            editor: { canvas: { defaultCursor?: string } };
          };
        }
      ).yunariEditorBridge.editor.canvas.defaultCursor ?? "",
  );
}

/** Whether Fabric's hidden textarea — the caret — owns focus for this object. */
async function caretIn(page: Page, id: string): Promise<boolean> {
  return page.evaluate((objectId) => {
    const bridge = (
      window as unknown as {
        yunariEditorBridge?: {
          editor: {
            canvas: {
              getObjects(): {
                get(name: string): unknown;
                hiddenTextarea?: HTMLTextAreaElement;
              }[];
            };
          };
        };
      }
    ).yunariEditorBridge;
    const object = bridge?.editor.canvas
      .getObjects()
      .find((candidate) => String(candidate.get("id") ?? "") === objectId);
    return document.activeElement === object?.hiddenTextarea;
  }, id);
}

/**
 * Types into a live text through the canvas and answers the state **while the
 * caret is still in it**.
 *
 * The caret is Fabric's hidden textarea and the placement's `enterEditing` is
 * deferred a frame, so a keystroke sent before focus lands nowhere: it reads as
 * a text that did not grow, which is a timing artefact rather than the surface.
 * The exit handler writes the words into the authored run, so the caller reads
 * the edited display here and the committed model after `exitEditing`.
 */
async function typeInto(
  page: Page,
  id: string,
  text: string,
): Promise<TextState> {
  await expect
    .poll(async () => (await textState(page, id))?.editing)
    .toBe(true);
  await expect.poll(() => caretIn(page, id)).toBe(true);
  await page.keyboard.type(text);
  await expect
    .poll(async () => (await textState(page, id))?.text ?? "")
    .toContain(text.slice(0, 8));
  const state = await textState(page, id);
  if (state === undefined) throw new Error("the typed text is not live");
  return state;
}

/**
 * Waits for the creation's deferred `enterEditing`, presses Escape and waits
 * for the edit to end — the state a resize or an inspector read needs.
 */
async function exitEditing(page: Page, id: string): Promise<void> {
  await expect
    .poll(async () => (await textState(page, id))?.editing)
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => (await textState(page, id))?.editing)
    .toBe(false);
}

/** Drags a handle by scene units: a corner from a Text, a side edge from a Text
 *  box. Both are scene-space deltas, which is what tells the width modes apart. */
async function dragHandle(
  page: Page,
  id: string,
  key: "ml" | "mr" | "br",
  deltaX: number,
  deltaY = 0,
): Promise<void> {
  const handle = await objectHandleScenePoint(page, id, key);
  const from = await sceneToClient(page, ARTBOARD_WIDTH, handle.x, handle.y);
  const to = await sceneToClient(
    page,
    ARTBOARD_WIDTH,
    handle.x + deltaX,
    handle.y + deltaY,
  );
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

/** The authored box a text carries, which only a Text box should have. */
function boxOf(
  authored: Record<string, unknown> | undefined,
): { readonly width?: number; readonly height?: number } | undefined {
  return (
    authored?.["yunariText"] as
      | { readonly box?: { readonly width?: number; readonly height?: number } }
      | undefined
  )?.box;
}

/** The words each authored run carries, in order. */
function runTextsOf(
  authored: Record<string, unknown> | undefined,
): readonly string[] {
  const runs = (
    authored?.["yunariText"] as
      | { readonly runs?: readonly { readonly text?: string }[] }
      | undefined
  )?.runs;
  return (runs ?? []).map((run) => run.text ?? "");
}

type AuthoredRun = {
  readonly kind?: string;
  readonly text?: string;
  readonly bindingId?: string;
};

/** The authored runs themselves, when the shape under test is the run list. */
function runsOf(
  authored: Record<string, unknown> | undefined,
): readonly AuthoredRun[] {
  const runs = (
    authored?.["yunariText"] as
      | { readonly runs?: readonly AuthoredRun[] }
      | undefined
  )?.runs;
  return runs ?? [];
}

/** Saves through File ▸ Save to library and answers the host's own id. */
async function saveToLibrary(page: Page): Promise<string> {
  const saved = page.waitForRequest(
    (request) =>
      request.method() === "PUT" &&
      /^\/api\/themes\/[^/]+$/.test(new URL(request.url()).pathname),
  );
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save to library" }).click();
  await expect(page.locator("#status")).toContainText("Saved to library", {
    timeout: 20_000,
  });
  const id = decodeURIComponent(
    new URL((await saved).url()).pathname.split("/").at(-1) ?? "",
  );
  expect(id, "the save names a theme id").not.toBe("");
  return id;
}

/** Places one Text by click and one Text box by drag, and leaves both edited. */
async function authorBoth(
  page: Page,
): Promise<{ readonly point: SceneObject; readonly box: SceneObject }> {
  await openBlank(page);

  await placeText(page, { x: 300, y: 200 });
  const placedPoint = (await readScene(page)).find(
    (object) => object.type === "i-text",
  );
  if (placedPoint === undefined) throw new Error("the click made no i-text");
  await exitEditing(page, placedPoint.id);

  await insertTextBox(page, { x: 200, y: 420, w: 320, h: 120 });
  const placedBox = (await readScene(page)).find(
    (object) => object.type === "textbox",
  );
  if (placedBox === undefined) throw new Error("the drag made no textbox");
  await exitEditing(page, placedBox.id);

  return { point: placedPoint, box: placedBox };
}

/** What the player's revived scene holds, by class and place. */
async function playerObjects(page: Page): Promise<
  readonly {
    readonly type: string;
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly text: string;
  }[]
> {
  return page.evaluate(() => {
    const handle = (
      window as unknown as {
        yunari?: {
          handle?: {
            canvas: {
              getObjects(): {
                readonly type: string;
                readonly left?: number;
                readonly top?: number;
                readonly width?: number;
                readonly text?: string;
              }[];
            };
          };
        };
      }
    ).yunari?.handle;
    if (handle === undefined) return [];
    return handle.canvas.getObjects().map((object) => ({
      type: object.type,
      left: Math.round(object.left ?? 0),
      top: Math.round(object.top ?? 0),
      width: Math.round(object.width ?? 0),
      text: object.text ?? "",
    }));
  });
}

const LEGACY_THEME_ID = "e2e-text-legacy";
const LEGACY_WRAPPED_TEXT =
  "A legacy text box authored with wrap off still wraps inside its width";

/**
 * A document in the shape an older save leaves: a `Textbox` carrying an authored
 * `wrap: false`, and a display `Text` whose serialised type is `"Text"`. Both
 * must render as they did — only the display text gains editing.
 */
function legacyEnvelope(): FabricThemeEnvelope {
  const literal = (text: string) => [
    {
      kind: "literal" as const,
      text,
      typeToken: "typeTokens.body",
      style: {
        color: { ref: "palette.ink" as const },
        fontSize: { value: 22 },
      },
    },
  ];
  return {
    schemaVersion: "2.0.0",
    fabricVersion: "7.4.0",
    id: LEGACY_THEME_ID,
    metadata: { name: "E2E legacy text", themeLanguage: "en" },
    artboard: { width: 640, height: 360, contentFit: "contain" },
    background: { color: { ref: "palette.bar" } },
    globals: {
      palette: {
        none: {
          name: "None",
          value: { kind: "solid", color: "transparent" },
        },
        bar: {
          name: "Bar",
          value: { kind: "solid", color: "rgb(16, 19, 24)" },
        },
        ink: {
          name: "Ink",
          value: { kind: "solid", color: "rgb(232, 236, 243)" },
        },
      },
      typeTokens: {
        heading: { family: "system-ui, sans-serif", weight: "600" },
        body: { family: "system-ui, sans-serif", weight: "400" },
        mono: { family: "ui-monospace, monospace", weight: "400" },
      },
    },
    assets: [],
    scene: {
      version: "7.4.0",
      objects: [
        {
          type: "Textbox",
          version: "7.4.0",
          originX: "left",
          originY: "top",
          left: 40,
          top: 60,
          width: 160,
          height: 80,
          text: LEGACY_WRAPPED_TEXT,
          fontSize: 22,
          fontFamily: "system-ui, sans-serif",
          fill: "palette.ink",
          id: "legacy-box",
          name: "Legacy box",
          yunariPaint: { fill: "palette.ink" },
          yunariText: {
            wrap: false,
            box: { width: 160, height: 80 },
            runs: literal(LEGACY_WRAPPED_TEXT),
          },
        },
        {
          type: "Text",
          version: "7.4.0",
          originX: "left",
          originY: "top",
          left: 40,
          top: 240,
          width: 240,
          height: 30,
          text: "Legacy display text",
          fontSize: 22,
          fontFamily: "system-ui, sans-serif",
          fill: "palette.ink",
          id: "legacy-point",
          name: "Legacy label",
          yunariPaint: { fill: "palette.ink" },
          yunariText: { runs: literal("Legacy display text") },
        },
      ],
    },
  };
}

function seedLegacyTheme(): void {
  const envelope = legacyEnvelope();
  const result = writeThemePackage({ envelope, assets: {} });
  if (!result.ok) {
    throw new Error(`the legacy fixture is invalid: ${result.message}`);
  }
  const folder = path.join(HOST_THEMES_DIR, LEGACY_THEME_ID);
  mkdirSync(path.join(folder, "assets"), { recursive: true });
  writeFileSync(path.join(folder, "theme.json"), JSON.stringify(envelope));
}

test.describe("text and text box elements", () => {
  test("click places a Text that grows while typing and scales rather than writing a width", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await page.goto(EDITOR);
    await openBlank(page);
    await placeText(page, { x: 400, y: 300 });

    const placed = (await readScene(page)).at(-1);
    if (placed === undefined) throw new Error("the click made nothing");
    expect(placed.type, "a click places an IText").toBe("i-text");
    const before = await textState(page, placed.id);
    if (before === undefined) throw new Error("the placed text is not live");
    const grown = await typeInto(page, placed.id, GROWN_TEXT);

    // Measured ink, not an authored box: the width grows with the words and the
    // line never wraps, because an IText has no wrap measure.
    expect(grown.width).toBeGreaterThan(before.width + 20);
    expect(grown.lines).toBe(1);
    expect(grown.editable).toBe(true);

    await exitEditing(page, placed.id);
    // Leaving the edit writes the words into the authored run and repaints from
    // it, so the measurement it grew to is the one the model now describes.
    const committed = await textState(page, placed.id);
    if (committed === undefined) throw new Error("the text vanished");
    expect(committed.text).toBe(GROWN_TEXT);
    expect(committed.width).toBeCloseTo(grown.width, 0);

    await selectLayer(page, placed.name ?? "Text");
    const authored = await readObject(page, placed.name ?? "Text");
    expect(boxOf(authored), "a point text authors no box").toBeUndefined();

    // Both Size halves are the measurement, so neither is an input.
    for (const key of ["width", "height"] as const) {
      const field = page.locator(`[data-yunari-geometry="${key}"]`);
      await expect(field).toBeVisible();
      expect(
        await field.evaluate(
          (element) => (element as HTMLInputElement).readOnly,
        ),
        `${key} is read-only on a Text`,
      ).toBe(true);
    }
    const widthField = page.locator('[data-yunari-geometry="width"]');
    expect(Number(await widthField.inputValue())).toBeCloseTo(
      committed.width,
      0,
    );

    // A Text hides the box-only controls; Align still applies to its lines.
    await expect(page.locator("[data-yunari-text-wrap]")).toHaveCount(0);
    // Three segmented options, so the align control is a set rather than one node.
    await expect(
      page.locator("[data-yunari-text-align]").first(),
    ).toBeVisible();
    await expect(page.locator("[data-yunari-text-overflow]")).toHaveCount(0);
    await expect(page.locator("[data-yunari-text-vertical-align]")).toHaveCount(
      0,
    );

    // A Text has corners, not edges: the corner drag leaves `width` at the
    // measured ink and puts the change on `scaleX`/`scaleY`, so no authored box
    // is written for it.
    const widthBeforeDrag = committed.width;
    await dragHandle(page, placed.id, "br", 60, 40);
    await expect
      .poll(async () => (await textState(page, placed.id))?.scaleX ?? 0)
      .toBeGreaterThan(1.05);
    const scaled = await textState(page, placed.id);
    if (scaled === undefined)
      throw new Error("the text vanished after scaling");
    expect(scaled.width).toBe(widthBeforeDrag);
    expect(scaled.scaleY).toBeGreaterThan(1.05);
    expect(scaled.width * scaled.scaleX).toBeGreaterThan(widthBeforeDrag + 20);
    const afterScale = await readObject(page, placed.name ?? "Text");
    expect(
      boxOf(afterScale),
      "scaling a Text writes no authored box",
    ).toBeUndefined();
  });

  test("drag draws a Text box at the rectangle, wraps, and its ml/mr controls change the width", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await page.goto(EDITOR);
    await openBlank(page);
    await insertTextBox(page, { x: 200, y: 150, w: 320, h: 120 });

    const placed = (await readScene(page)).at(-1);
    if (placed === undefined) throw new Error("the drag made nothing");
    expect(placed.type, "a drag places a Textbox").toBe("textbox");
    const drawn = await textState(page, placed.id);
    if (drawn === undefined) throw new Error("the drawn box is not live");
    // Scene units land on the drawn rectangle to within a pixel of camera
    // rounding; the gesture does not snap, so this is the rectangle that was
    // drawn rather than a number the product chose.
    expect(Math.abs(drawn.left - 200)).toBeLessThanOrEqual(2);
    expect(Math.abs(drawn.top - 150)).toBeLessThanOrEqual(2);
    expect(Math.abs(drawn.width - 320)).toBeLessThanOrEqual(2);

    const typed = await typeInto(page, placed.id, WRAPPED_TEXT);

    // The drawn rectangle survives typing: the width is the wrap measure and the
    // text reflows inside it instead of widening the object.
    expect(typed.width).toBe(drawn.width);
    expect(typed.left).toBe(drawn.left);
    expect(typed.top).toBe(drawn.top);
    expect(
      typed.lines,
      "the text wraps while it is being typed",
    ).toBeGreaterThan(1);

    await exitEditing(page, placed.id);
    // The words survive the repaint that leaving the edit runs, and the box is
    // still the drawn one rather than being widened by the paragraph.
    const committed = await textState(page, placed.id);
    if (committed === undefined) throw new Error("the box vanished");
    expect(committed.text).toBe(WRAPPED_TEXT);
    expect(committed.width).toBe(drawn.width);
    await expect
      .poll(async () => (await textState(page, placed.id))?.lines ?? 0)
      .toBeGreaterThan(1);

    await selectLayer(page, placed.name ?? "Text box");
    const authored = await readObject(page, placed.name ?? "Text box");
    expect(boxOf(authored)?.width).toBeCloseTo(drawn.width, 0);
    // The height is authored with the width. Without it a box that kept its
    // width and lost its height still wraps, so width alone cannot prove that
    // the drawn rectangle survived.
    expect(
      Math.abs((boxOf(authored)?.height ?? 0) - 120),
      "the authored box keeps the drawn height",
    ).toBeLessThanOrEqual(2);

    // A Text box keeps its editable Size and the controls that mean something
    // only when there is a box to clip and align inside.
    for (const key of ["width", "height"] as const) {
      const field = page.locator(`[data-yunari-geometry="${key}"]`);
      await expect(field).toBeVisible();
      expect(
        await field.evaluate(
          (element) => (element as HTMLInputElement).readOnly,
        ),
        `${key} is editable on a Text box`,
      ).toBe(false);
    }
    await expect(page.locator("[data-yunari-text-wrap]")).toHaveCount(0);
    await expect(
      page.locator("[data-yunari-text-overflow]").first(),
    ).toBeVisible();
    await expect(
      page.locator("[data-yunari-text-vertical-align]").first(),
    ).toBeVisible();

    // Fabric's `changeWidth` on `ml`/`mr`: the box grows and `scaleX` stays 1,
    // and the authored box the next text pass restores carries the new width.
    const widthBeforeDrag = typed.width;
    await dragHandle(page, placed.id, "mr", 60);
    await expect
      .poll(async () => (await textState(page, placed.id))?.width ?? 0)
      .toBeGreaterThan(widthBeforeDrag + 40);
    const widened = await textState(page, placed.id);
    if (widened === undefined)
      throw new Error("the box vanished after resizing");
    expect(widened.scaleX).toBeCloseTo(1, 2);
    expect(widened.width).toBeLessThan(widthBeforeDrag + 80);
    const widenedBox = boxOf(await readObject(page, placed.name ?? "Text box"));
    expect(widenedBox?.width).toBeCloseTo(widened.width, 0);
  });

  test("words typed into a placed Text survive the repaint and a save/reopen", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    test.setTimeout(120_000);

    await page.goto(HOST_EDITOR);
    await openBlank(page);
    await placeText(page, { x: 300, y: 200 });
    const placed = (await readScene(page)).at(-1);
    if (placed === undefined) throw new Error("the click made nothing");

    await typeInto(page, placed.id, TYPED_TEXT);
    await exitEditing(page, placed.id);

    // Leaving the edit repaints from the authored runs, so words the commit did
    // not keep would read back as the placeholder here rather than as typed.
    const edited = await textState(page, placed.id);
    if (edited === undefined)
      throw new Error("the text vanished after the edit");
    expect(edited.type).toBe("i-text");
    expect(edited.text).toBe(TYPED_TEXT);
    const authored = await readObject(page, placed.name ?? "Text");
    expect(runTextsOf(authored)).toEqual([TYPED_TEXT]);

    // Selecting the object drives the authored pass the sample tick drives; the
    // measured width the words grew to is unchanged by the second repaint.
    const measured = edited.width;
    await selectLayer(page, placed.name ?? "Text");
    await expect
      .poll(async () => (await textState(page, placed.id))?.text ?? "")
      .toBe(TYPED_TEXT);
    expect((await textState(page, placed.id))?.width).toBe(measured);

    // A reload half: the words must be in the document, not only on the canvas.
    const id = await saveToLibrary(page);
    await page.goto(`${HOST_EDITOR}?theme=${id}`);
    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible();
    await expect.poll(async () => (await readScene(page)).length).toBe(1);
    const reopened = await textState(page, placed.id);
    if (reopened === undefined)
      throw new Error("the saved text did not reopen");
    expect(reopened.type).toBe("i-text");
    expect(reopened.text).toBe(TYPED_TEXT);
    expect(Math.abs(reopened.width - measured)).toBeLessThanOrEqual(2);
    expect(runTextsOf(await readObject(page, placed.name ?? "Text"))).toEqual([
      TYPED_TEXT,
    ]);
  });

  test("an inline @ inserts a reading run rather than characters", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    test.setTimeout(120_000);

    await page.goto(HOST_EDITOR);
    await openBlank(page);
    await placeText(page, { x: 300, y: 200 });
    const placed = (await readScene(page)).at(-1);
    if (placed === undefined) throw new Error("the click made nothing");

    await typeInto(page, placed.id, "Load ");
    await page.keyboard.type("@");
    const list = page.locator(".editor-shell-text-mentions");
    await expect(list).toBeVisible();
    await page.keyboard.type("ram");
    const first = list.locator("[role='option']").first();
    await expect(first).toBeVisible();

    // Tab takes the highlighted reading; the list closes and the edit ends.
    await page.keyboard.press("Tab");
    await expect(list).toBeHidden();
    await expect
      .poll(async () => (await textState(page, placed.id))?.editing)
      .toBe(false);

    const authored = await readObject(page, placed.name ?? "Text");
    const runs = runsOf(authored);
    // The typed `@ram` is not prose: the reading is a value run beside the
    // words the author typed, and the words are still there.
    expect(runs.map((run) => run.kind)).toEqual(["literal", "value"]);
    expect(runs[0]?.text).toBe("Load ");
    expect(runs[1]?.bindingId).toMatch(/^binding-/);

    // The binding is document state, not a canvas decoration.
    const id = await saveToLibrary(page);
    await page.goto(`${HOST_EDITOR}?theme=${id}`);
    await expect.poll(async () => (await readScene(page)).length).toBe(1);
    expect(
      runsOf(await readObject(page, placed.name ?? "Text")).map(
        (run) => run.kind,
      ),
    ).toEqual(["literal", "value"]);
  });

  test("Escape during placement creates nothing and leaves the history alone", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await page.goto(EDITOR);
    await openBlank(page);

    await openPane(page, "Add");
    await addButton(page, "Text", "text").click();
    expect(await cursorOf(page), "the armed tool paints a crosshair").toBe(
      "crosshair",
    );

    await page.keyboard.press("Escape");
    expect(await cursorOf(page), "Escape disarms the tool").not.toBe(
      "crosshair",
    );

    // The next press is a selection, not a placement: the gesture is one-shot.
    const centre = await sceneToClient(
      page,
      ARTBOARD_WIDTH,
      ARTBOARD_WIDTH / 2,
      ARTBOARD_HEIGHT / 2,
    );
    await page.mouse.click(centre.x, centre.y);
    await expect.poll(async () => (await readScene(page)).length).toBe(0);

    // Nothing was recorded for the cancelled gesture, so undo has nothing to
    // restore and cannot conjure an object the author never placed.
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await readScene(page)).length).toBe(0);
  });

  test("save, reload and reopen preserve both classes and their geometry", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    test.setTimeout(120_000);

    await page.goto(HOST_EDITOR);
    const authored = await authorBoth(page);
    const before = await factsById(page);
    expect(before.get(authored.point.id)?.type).toBe("i-text");
    expect(before.get(authored.box.id)?.type).toBe("textbox");

    const drawnHeight = boxOf(
      await readObject(page, authored.box.name ?? "Text box"),
    )?.height;
    if (drawnHeight === undefined) {
      throw new Error("the dragged box has no authored height");
    }
    expect(
      Math.abs(drawnHeight - 120),
      "the authored box keeps the drawn height",
    ).toBeLessThanOrEqual(2);

    const id = await saveToLibrary(page);

    await page.goto(`${HOST_EDITOR}?theme=${id}`);
    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible();
    await expect.poll(async () => (await readScene(page)).length).toBe(2);
    const after = await factsById(page);

    for (const [label, object] of [
      ["Text", authored.point],
      ["Text box", authored.box],
    ] as const) {
      const saved = before.get(object.id);
      const reopened = after.get(object.id);
      if (saved === undefined || reopened === undefined) {
        throw new Error(`${label} did not survive the round trip`);
      }
      expect(reopened.type, `${label} kept its class`).toBe(saved.type);
      expect(reopened.left, `${label} kept its x`).toBe(saved.left);
      expect(reopened.top, `${label} kept its y`).toBe(saved.top);
      expect(reopened.width, `${label} kept its width`).toBeCloseTo(
        saved.width,
        0,
      );
      expect(reopened.height, `${label} kept its height`).toBeCloseTo(
        saved.height,
        0,
      );
    }

    const reopenedHeight = boxOf(
      await readObject(page, authored.box.name ?? "Text box"),
    )?.height;
    expect(
      reopenedHeight,
      "the saved box kept its authored height",
    ).toBeCloseTo(drawnHeight, 0);
  });

  test("a legacy wrap:false Textbox still wraps and a legacy Text opens as IText", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    test.setTimeout(120_000);

    seedLegacyTheme();
    await page.goto(`${HOST_EDITOR}?theme=${LEGACY_THEME_ID}`);
    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible();
    await expect.poll(async () => (await readScene(page)).length).toBe(2);

    // The authored `wrap: false` is ignored: the class decides, so the box is
    // still a Textbox and still reflows inside the width it was drawn at.
    await expect
      .poll(async () => (await textState(page, "legacy-box"))?.lines ?? 0)
      .toBeGreaterThan(1);
    const box = await textState(page, "legacy-box");
    if (box === undefined) throw new Error("the legacy box did not open");
    expect(box.type).toBe("textbox");
    expect(box.width, "the authored width is the wrap measure").toBeCloseTo(
      160,
      0,
    );

    // The display class normalises to the editable one; geometry and words stay.
    const point = await textState(page, "legacy-point");
    if (point === undefined) throw new Error("the legacy text did not open");
    expect(point.type).toBe("i-text");
    expect(point.editable, "the legacy text can be typed into").toBe(true);
    expect(point.left).toBe(40);
    expect(point.top).toBe(240);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const bridge = (
            window as unknown as {
              yunariEditorBridge: {
                editor: {
                  canvas: {
                    getObjects(): {
                      get(name: string): unknown;
                      text?: string;
                    }[];
                  };
                };
              };
            }
          ).yunariEditorBridge;
          return bridge.editor.canvas
            .getObjects()
            .find((object) => object.get("id") === "legacy-point")?.text;
        }),
      )
      .toBe("Legacy display text");
  });

  test("the player renders both saved objects without changing either class", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    test.setTimeout(120_000);

    await page.goto(HOST_EDITOR);
    const authored = await authorBoth(page);
    const saved = await readScene(page);
    const id = await saveToLibrary(page);

    const player = await page.context().newPage();
    try {
      await player.goto(`${HOST}/?theme=${id}`);
      await expect(
        player.locator("#artboard canvas.lower-canvas"),
      ).toBeVisible();
      await expect
        .poll(async () => (await playerObjects(player)).length)
        .toBe(2);
      const rendered = await playerObjects(player);

      for (const object of saved) {
        const drawn = rendered.find(
          (candidate) => candidate.left === object.left,
        );
        if (drawn === undefined) {
          throw new Error(`the player did not render ${object.type}`);
        }
        // The persisted class is what the player revives; a save that wrote one
        // class and a display that rendered the other is the defect measured.
        expect(drawn.type, `${object.type} rendered as itself`).toBe(
          object.type,
        );
        expect(drawn.top).toBe(object.top);
      }
      expect(rendered.map((object) => object.type).sort()).toEqual([
        "i-text",
        "textbox",
      ]);
      // Both docs are the same words, so a canvas with two objects and neither
      // class is not what is being asserted; the classes above are.
      expect(authored.point.type).toBe("i-text");
      expect(authored.box.type).toBe("textbox");
    } finally {
      await player.close();
    }
  });

  test("a Text exposes corners and rotation only while a Text box keeps all nine handles", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await page.goto(EDITOR);
    await openBlank(page);

    await placeText(page, { x: 300, y: 200 });
    const point = (await readScene(page)).find(
      (object) => object.type === "i-text",
    );
    if (point === undefined) throw new Error("the click made no i-text");
    await exitEditing(page, point.id);

    await insertTextBox(page, { x: 700, y: 200, w: 320, h: 120 });
    const box = (await readScene(page)).find(
      (object) => object.type === "textbox",
    );
    if (box === undefined) throw new Error("the drag made no textbox");
    await exitEditing(page, box.id);

    const pointState = await textState(page, point.id);
    const boxState = await textState(page, box.id);
    if (pointState === undefined || boxState === undefined) {
      throw new Error("an object is missing from the scene");
    }

    // A Text has no authored box, so it has no edge handle that would write one:
    // corners scale and rotation turns it, and the four edges are absent.
    expect([...pointState.controls].sort()).toEqual([
      "bl",
      "br",
      "mtr",
      "tl",
      "tr",
    ]);

    // A Text box keeps the full set: its edges change the authored width and
    // height, and its corners scale.
    expect(boxState.controls).toHaveLength(9);
    expect(boxState.controls).toEqual(
      expect.arrayContaining([
        "ml",
        "mr",
        "mt",
        "mb",
        "tl",
        "tr",
        "bl",
        "br",
        "mtr",
      ]),
    );
  });

  test("three runs show three numbered tabs, one selected run's fields, and + selects the new run", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await page.goto(EDITOR);
    await openBlank(page);

    await placeText(page, { x: 400, y: 300 });
    const placed = (await readScene(page)).at(-1);
    if (placed === undefined) throw new Error("the click made nothing");
    await exitEditing(page, placed.id);
    await selectLayer(page, placed.name ?? "Text");

    await expect(page.locator("[data-yunari-runs]")).toBeVisible();
    const add = page.locator("[data-yunari-run-add]");
    await add.click();
    await add.click();

    const tabs = page.locator("[data-yunari-run-tab]");
    await expect(tabs, "one tab per run").toHaveCount(3);
    for (const position of [1, 2, 3]) {
      const tab = page.getByRole("tab", { name: `Run ${position}` });
      await expect(tab).toBeVisible();
      await expect(tab, "the label is the 1-based number").toHaveText(
        String(position),
      );
    }

    // `+` lands the author in the run they just made.
    await expect(page.getByRole("tab", { name: "Run 3" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator('[data-yunari-run-text="2"]')).toBeVisible();

    // One run at a time: the other runs' fields are not rendered at all.
    await page.getByRole("tab", { name: "Run 1" }).click();
    await expect(page.locator('[data-yunari-run-text="0"]')).toBeVisible();
    await expect(page.locator('[data-yunari-run-text="1"]')).toHaveCount(0);
    await expect(page.locator('[data-yunari-run-text="2"]')).toHaveCount(0);

    await page.getByRole("tab", { name: "Run 2" }).click();
    await expect(page.locator('[data-yunari-run-text="1"]')).toBeVisible();
    await expect(page.locator('[data-yunari-run-text="0"]')).toHaveCount(0);
  });
});
