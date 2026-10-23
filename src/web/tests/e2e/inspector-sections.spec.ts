import {
  expect,
  type Locator,
  type Page,
  type TestInfo,
  test,
} from "@playwright/test";
import {
  choiceOf,
  chooseIn,
  optionsOf,
  sectionExpanded,
  typeIntoControl,
} from "./control-set.js";
import {
  answerDialogIfShown,
  captureVisualReview,
  chooseAssetFile,
  enterLayer,
} from "./editor-canvas.js";
import { openPane } from "./editor-rail.js";
import {
  addChart,
  insert,
  openBlank,
  openPosition,
  readScene,
  type SceneObject,
  selectLayer,
} from "./rebuild-driver.js";
import { choosePalette } from "./shell-palette.js";
import { openThemeFromStore, storedThemeOfPackage } from "./store-library.js";
import { isDesktopSurface } from "./surface.js";

/**
 * What an author sees in the per-kind column, in a real browser against the
 * built bundle.
 *
 * Task 10 of the per-kind inspector plan. Every claim here is about a rendered
 * surface, and `AGENTS.md` is explicit that visible behaviour needs browser
 * inspection rather than object counts. The numbers and strings are the
 * assertions; the screenshots are for a human.
 */

const EDITOR = "http://127.0.0.1:4174/";

/**
 * The column element a capture photographs.
 *
 * The viewport shot truncates the column at the fold — its own scroller hides
 * everything past what fits, so the last section never reached the image.
 * Capturing the inspector column puts the whole column in the frame.
 */
const COLUMN = ".editor-shell-inspector";

/**
 * The column, photographed in full.
 *
 * The shell clips the inspector at the fold, so a 1280×720 frame stops at
 * `--bg`'s paint and the sections below it never reach the image. Grow the frame
 * until the scroller has nothing left to hide, then capture the column element
 * itself. Scoped to this spec only: every other caller of
 * `captureVisualReview` still writes a viewport shot.
 */
async function captureColumn(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  const viewport = page.viewportSize();
  const needed = await page.evaluate(() => {
    const scroller = document.querySelector(".editor-shell-inspector");
    const content = document.querySelector('[data-yunari-panel="selection"]');
    const chrome =
      window.innerHeight - (scroller?.clientHeight ?? window.innerHeight);
    // A little slack: the panel's box is measured before the resize reflows,
    // and a row that wraps differently would otherwise lose its last line.
    return Math.ceil(
      (content?.getBoundingClientRect().height ?? 0) + chrome + 32,
    );
  });
  if (viewport !== null && needed > viewport.height) {
    await page.setViewportSize({ width: viewport.width, height: needed });
  }
  await captureVisualReview(page, testInfo, name, page.locator(COLUMN));
}

/** The remainder slice's own ink: the blank document's `palette.chartTrack`,
 * which is what a new pie's `remainderFill` resolves through. */
const REMAINDER_INK = [34, 48, 71] as const;

const EDITOR_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAABmJLR0QA/wD/AP+gvaeTAAAANUlEQVQ4jWP8////fwYiwAePAmKUMTARpYoEMGrgqIGDwUDG9+75ROUUYsHg9/KogaMGkgEAOzoIbzncHVkAAAAASUVORK5CYII=",
  "base64",
);

/** The section ids the column renders, in document order. */
async function sectionIds(page: Page): Promise<string[]> {
  // **Scoped to the column, because `[data-yunari-section]` is not the
  // column's.** The Document pane renders its own sections from the same
  // component (plan 4 Task 8), they are always mounted, and they sit earlier in
  // document order — so an unscoped read answered `theme, artboard, style`
  // first and every case below compared the wrong list.
  return page
    .locator(`${COLUMN} [data-yunari-section]`)
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-yunari-section") ?? ""),
    );
}

async function isOpen(page: Page, id: string): Promise<boolean> {
  // The section is a disclosure whose header is a button carrying
  // `aria-expanded` (DESIGN.md §5), not a native `<details>` with an `.open`.
  return sectionExpanded(page, id);
}

/** Every field control inside a section — the whole column by default, or one
 *  section when a scope is named. The section's own disclosure header is a
 *  button in its `h2`, not a field, so it is excluded rather than counted.
 *  Scoped to the column for the reason `sectionIds` states. */
async function controlCount(
  page: Page,
  scope = `${COLUMN} [data-yunari-section]`,
): Promise<number> {
  return page
    .locator(`${scope} input, ${scope} select, ${scope} button`)
    .evaluateAll(
      (nodes) => nodes.filter((node) => node.closest("h2") === null).length,
    );
}

/**
 * Whether the subject leads the column.
 *
 * The column's host mounts the subject in its first child and the sections in
 * the sibling after it (DESIGN.md §7.4: "The column opens with the subject … not a
 * chrome label"), so "the subject leads" is a document-order fact rather than a
 * presentation class: the subject's host carries copy and the first section
 * follows it. A projection that rendered the sections first, or no subject at
 * all, fails here instead of photographing a column that opens with a field.
 */
async function subjectLeadsColumn(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const panel = document.querySelector('[data-yunari-panel="selection"]');
    const subject = panel?.firstElementChild ?? null;
    const section = panel?.querySelector("[data-yunari-section]") ?? null;
    if (subject === null || section === null) return false;
    const hasCopy = (subject.textContent ?? "").trim().length > 0;
    // DOCUMENT_POSITION_FOLLOWING (4): `section` follows `subject`.
    return hasCopy && (subject.compareDocumentPosition(section) & 4) !== 0;
  });
}

/** The four Position fields as the author reads them. */
async function positionValues(
  page: Page,
): Promise<Record<string, string | undefined>> {
  return page.evaluate(() => {
    const value = (key: string): string | undefined =>
      document.querySelector<HTMLInputElement>(
        `[data-yunari-geometry="${key}"]`,
      )?.value;
    return {
      left: value("left"),
      top: value("top"),
      width: value("width"),
      height: value("height"),
    };
  });
}

/**
 * One property of the named object, read through the editor handle.
 *
 * `readObject` projects a fixed set of fields, and "the edit landed in the
 * document" is a claim about a property that projection does not carry — a
 * missing key reads as `undefined` and compares equal to nothing rather than
 * failing.
 */
/** A control's own id, which is what its refusal paragraph is named after. */
async function idOf(locator: Locator): Promise<string> {
  return (await locator.getAttribute("id")) ?? "";
}

/**
 * The opacity slider's track, as a box the pointer can be driven at.
 *
 * Read from the row's own accessible input rather than by a chain of classes: a
 * drag has to start on the track the author sees, and the control is three
 * nested divs around a visually hidden `input[type="range"]`.
 */
async function opacityTrackBox(
  page: Page,
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>(
      'input[type="range"][data-yunari-opacity]',
    );
    const box = input?.parentElement?.parentElement?.getBoundingClientRect();
    return box === undefined
      ? null
      : { x: box.x, y: box.y, width: box.width, height: box.height };
  });
}

async function propertyOf(
  page: Page,
  name: string,
  key: string,
): Promise<unknown> {
  return page.evaluate(
    ({ wanted, property }) => {
      const handle = Object.values(window).find(
        (value) =>
          value !== null &&
          typeof value === "object" &&
          "canvas" in value &&
          "historyManager" in value,
      ) as
        | { canvas: { getObjects(): { get(name: string): unknown }[] } }
        | undefined;
      const object = handle?.canvas
        .getObjects()
        .find((candidate) => candidate.get("name") === wanted);
      return object?.get(property) ?? null;
    },
    { wanted: name, property: key },
  );
}

/**
 * The option the chart object's own builder produced.
 *
 * `_option` is what `buildChartPlan` handed to `setOption`, before
 * `toEngineOption` and ECharts normalise it — the option builder's own output
 * rather than the settings object or the engine's merged view of it.
 */
async function builtOption(page: Page, name: string): Promise<unknown> {
  return page.evaluate((wanted) => {
    type Chart = {
      get(name: string): unknown;
      getObjects?(): readonly Chart[];
      _option?: unknown;
    };
    const roots = (
      window as unknown as {
        yunariEditorBridge: {
          editor: { canvas: { getObjects(): readonly Chart[] } };
        };
      }
    ).yunariEditorBridge.editor.canvas.getObjects();
    const find = (objects: readonly Chart[]): Chart | undefined => {
      for (const object of objects) {
        if (object.get("name") === wanted) return object;
        const found = find(object.getObjects?.() ?? []);
        if (found !== undefined) return found;
      }
      return undefined;
    };
    return find(roots)?._option ?? null;
  }, name);
}

/** The persisted settings the object carries, for the claim that a write
    landed rather than only that a field kept its text. */
async function chartSettings(page: Page, name: string): Promise<unknown> {
  return page.evaluate((wanted) => {
    type Chart = {
      get(name: string): unknown;
      getObjects?(): readonly Chart[];
      settings?: unknown;
    };
    const roots = (
      window as unknown as {
        yunariEditorBridge: {
          editor: { canvas: { getObjects(): readonly Chart[] } };
        };
      }
    ).yunariEditorBridge.editor.canvas.getObjects();
    const find = (objects: readonly Chart[]): Chart | undefined => {
      for (const object of objects) {
        if (object.get("name") === wanted) return object;
        const found = find(object.getObjects?.() ?? []);
        if (found !== undefined) return found;
      }
      return undefined;
    };
    return find(roots)?.settings ?? null;
  }, name);
}

/**
 * Pixels of one exact colour inside a named object's own screen rect.
 *
 * **Inside the rect, not over the whole canvas.** The editor's stage paints the
 * same `#223047` as the pie's default remainder fill, so a whole-canvas count
 * reports 212,403 of it on a pie with no remainder at all — a measurement that
 * would pass on the wrong scene. The object's world rect is mapped through
 * `artboardScreenRect` and the canvas' own device-pixel ratio, the same
 * projection `sceneToClient` uses for a pointer.
 */
async function colourInsideObject(
  page: Page,
  name: string,
  rgb: readonly [number, number, number],
): Promise<number> {
  return page.evaluate(
    ([objectName, r, g, b]) => {
      type Obj = {
        get(property: string): unknown;
        getObjects?(): readonly Obj[];
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
            editor: {
              canvas: { getObjects(): readonly Obj[] };
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
      const find = (objects: readonly Obj[]): Obj | undefined => {
        for (const object of objects) {
          if (object.get("name") === objectName) return object;
          const found = find(object.getObjects?.() ?? []);
          if (found !== undefined) return found;
        }
        return undefined;
      };
      const object = find(bridge.editor.canvas.getObjects());
      if (object === undefined)
        throw new Error(`no object named ${objectName}`);

      const canvas = document.querySelector<HTMLCanvasElement>(
        "#yunari-fabric-editor canvas.lower-canvas",
      );
      const context = canvas?.getContext("2d");
      if (canvas === null || context === null || context === undefined)
        return -1;

      const ratio = canvas.width / canvas.getBoundingClientRect().width;
      const board = bridge.editor.viewport.artboardScreenRect();
      const scale = board.width / 1672;
      const rect = object.getBoundingRect();
      const left = Math.max(
        0,
        Math.round((board.left + rect.left * scale) * ratio),
      );
      const top = Math.max(
        0,
        Math.round((board.top + rect.top * scale) * ratio),
      );
      const width = Math.min(
        canvas.width - left,
        Math.round(rect.width * scale * ratio),
      );
      const height = Math.min(
        canvas.height - top,
        Math.round(rect.height * scale * ratio),
      );
      if (width <= 0 || height <= 0) return 0;

      const { data } = context.getImageData(left, top, width, height);
      let count = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (data[index] === r && data[index + 1] === g && data[index + 2] === b)
          count += 1;
      }
      return count;
    },
    [name, rgb[0], rgb[1], rgb[2]] as const,
  );
}

/** One object's own geometry, read through the editor handle. */
function geometryOf(scene: readonly SceneObject[], id: string) {
  const object = scene.find((entry) => entry.id === id);
  if (object === undefined) throw new Error(`no object with id ${id}`);
  return object;
}

/** Saves the open document and hands back the package bytes. */
async function savePackage(page: Page): Promise<Buffer> {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save package" }).click();
  await expect(page.locator("#status")).toContainText("Theme package saved");
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function openPackage(page: Page, bytes: Buffer): Promise<void> {
  await openThemeFromStore(page, storedThemeOfPackage(bytes));
}

/**
 * Selects the starter's gauge through the layer tree, the way an author does.
 *
 * A layer row reaches a part *through its owning group*: `bridge.selectLayer`
 * takes `owner ?? target`, so with the RAM card merely open a click on
 * `ram-gauge`'s row hands back the card. Entering is what makes the gauge a row
 * a click selects — the canvas double-click this used to borrow entered the
 * same card, by a gesture the row has since grown a control for.
 */
async function selectStarterGauge(page: Page): Promise<void> {
  await enterLayer(page, "group-ram-card");
  await page.locator('[data-yunari-layer="ram-gauge"]').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              yunariEditorBridge: {
                editor: {
                  canvas: { getActiveObject(): { id?: string } | undefined };
                };
              };
            }
          ).yunariEditorBridge.editor.canvas.getActiveObject()?.id ?? null,
      ),
    )
    .toBe("ram-gauge");
}

test.describe("the per-kind inspector column", () => {
  test("asks the starter card's questions in order, Position open like the rest", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await page.goto(EDITOR);
    await page.waitForFunction(() => "yunariEditorBridge" in window);

    // The starter's own hierarchy, before any panel is touched.
    const rows = await page
      .locator("[data-yunari-layer]")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-yunari-layer")),
      );
    // The starter's ten top-level objects, plus the background's own row.
    expect(rows).toHaveLength(11);

    await page.locator('[data-yunari-layer="group-cpu-card"]').click();
    // **Three, not four: the card is a Group, and a Group has no render boundary
    // for the treatment to reach.** `vg-465` (item 8) withholds the section there
    // and says so in the lead block instead, so it is gone rather than empty.
    expect(await sectionIds(page)).toEqual(["content", "position", "layer"]);

    // Every one of them open, Position included: no section starts closed
    // (item 13), and the author may still close what they are not using.
    for (const id of ["content", "position", "layer"]) {
      expect(await isOpen(page, id), id).toBe(true);
    }

    // The values, not that inputs exist: what the section holds is the card's
    // own geometry, to the unit the fields show.
    await openPosition(page);
    const card = geometryOf(await readScene(page), "group-cpu-card");
    expect(await positionValues(page)).toEqual({
      left: String(card.left),
      top: String(card.top),
      width: String(card.width),
      height: String(card.height),
    });
  });

  test("follows the pointer while the opacity slider is dragged, and lands the value once", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await page.goto(EDITOR);
    await page.waitForFunction(() => "yunariEditorBridge" in window);
    await page.locator('[data-yunari-layer="group-cpu-card"]').click();

    /**
     * The Layer section's slider as the author reads it: the track's box, the
     * value well's text, and the value the accessible input carries.
     *
     * Read from the row rather than from a locator chain because the control is
     * three nested divs around a visually hidden `input[type="range"]`, and a
     * chain that names them by class would pass on a row other than this one.
     *
     * **The well is an input, and its own hook names it.** It was a
     * `span.font-mono` readout until item 10 made it the slider's typed route;
     * a locator still looking for a span finds nothing and reports the readout
     * as `null`, which reads as a missing well rather than a moved one.
     */
    const slider = async () =>
      page.evaluate(() => {
        const input = document.querySelector<HTMLInputElement>(
          'input[type="range"][data-yunari-opacity]',
        );
        const track = input?.parentElement?.parentElement ?? null;
        const row = input?.closest('[role="group"]') ?? null;
        const well =
          row === null
            ? null
            : row.querySelector<HTMLInputElement>(
                "input[data-yunari-opacity-well]",
              );
        const box = track?.getBoundingClientRect();
        return {
          box:
            box === undefined
              ? null
              : { x: box.x, y: box.y, width: box.width, height: box.height },
          readout: well?.value ?? null,
          input: input?.value ?? null,
        };
      });

    const start = await slider();
    expect(
      start.box,
      "the Layer section draws no opacity slider",
    ).not.toBeNull();
    expect(start.readout).toBe("100");
    const box = start.box ?? { x: 0, y: 0, width: 0, height: 0 };
    const y = box.y + box.height / 2;

    // **The button stays down across every read.** A slider rendered only from
    // the committed value reports the same number at all three points and moves
    // once, on release — which is what an author describing it as updating half
    // a second late is seeing (vg-449). Nothing here is timed: the claim is
    // that the number changed while the gesture was still open, and by how much
    // is the pointer's business.
    await page.mouse.move(box.x + box.width * 0.75, y);
    await page.mouse.down();
    const during: (string | null)[] = [];
    for (const fraction of [0.6, 0.45, 0.3]) {
      await page.mouse.move(box.x + box.width * fraction, y);
      during.push((await slider()).readout);
    }
    const held = await slider();
    await page.mouse.up();

    const [first, second, third] = during.map(Number);
    // Three readings, all different: a readout that never moved fails here on
    // its own message rather than on the arithmetic below.
    expect(
      new Set(during).size,
      `the readout did not follow the pointer: ${during.join(", ")}`,
    ).toBe(3);
    expect(first).toBeGreaterThan(second as number);
    expect(second).toBeGreaterThan(third as number);
    // The hidden range input is the element a screen reader reads, so it moves
    // with the well rather than only at the end.
    expect(held.input).toBe(held.readout);

    // One value lands for the gesture, and it is the one the pointer left.
    await expect.poll(async () => (await slider()).readout).toBe(during[2]);
  });

  /**
   * `vg-254`, and the half `vg-449` did not cover.
   *
   * `vg-449` made the moving value the control's *own* state, so the well and
   * the accessible input already follow the pointer. What did not move was the
   * **document**: the canvas repainted only when the button came up, so the
   * author read a number they could not see. This reads the object's own
   * `opacity` between moves with the button still down — a property the control
   * never touches — and then that the whole gesture is *one* undo step, because
   * a preview that recorded history per frame would leave the undo landing on an
   * intermediate number instead of the start.
   */
  test("moves the document while the opacity slider is dragged, and lands one undo step", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await page.goto(EDITOR);
    await page.waitForFunction(() => "yunariEditorBridge" in window);
    await page.locator('[data-yunari-layer="group-cpu-card"]').click();

    const box = await opacityTrackBox(page);
    expect(box, "the Layer section draws no opacity slider").not.toBeNull();
    const track = box ?? { x: 0, y: 0, width: 0, height: 0 };
    const y = track.y + track.height / 2;
    const opacity = async (): Promise<number> =>
      Number(await propertyOf(page, "group-cpu-card", "opacity"));
    await expect.poll(opacity).toBeCloseTo(1, 5);

    await page.mouse.move(track.x + track.width * 0.8, y);
    await page.mouse.down();
    const during: number[] = [];
    for (const fraction of [0.6, 0.45, 0.3]) {
      await page.mouse.move(track.x + track.width * fraction, y);
      during.push(await opacity());
    }
    await page.mouse.up();

    expect(
      new Set(during).size,
      `the document did not follow the pointer: ${during.join(", ")}`,
    ).toBe(3);
    expect(during[0]).toBeGreaterThan(during[1] as number);
    expect(during[1]).toBeGreaterThan(during[2] as number);

    // The release lands the value the pointer left, and the gesture is one
    // entry: one undo puts the whole drag back to full.
    await expect.poll(opacity).toBeCloseTo(during[2] as number, 5);
    await page.keyboard.press("Control+z");
    await expect.poll(opacity).toBeCloseTo(1, 5);
  });

  /**
   * §5's other half: "cancellation restores the start value and adds no
   * history". The gesture is abandoned mid-drag, so the preview has already
   * written the document — what the restore has to reach is the document, not
   * just the control. The typed edit before it is what makes "no entry" tellable
   * from "one entry": the undo behind the abandoned gesture has to step over
   * that edit, not over a frame of the gesture nobody made.
   */
  test("restores the start value when an opacity drag is abandoned, and records nothing", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await page.goto(EDITOR);
    await page.waitForFunction(() => "yunariEditorBridge" in window);
    await page.locator('[data-yunari-layer="group-cpu-card"]').click();

    const well = page.locator("input[data-yunari-opacity-well]");
    await well.fill("40");
    await well.blur();
    const opacity = async (): Promise<number> =>
      Number(await propertyOf(page, "group-cpu-card", "opacity"));
    await expect.poll(opacity).toBeCloseTo(0.4, 5);

    const box = await opacityTrackBox(page);
    const track = box ?? { x: 0, y: 0, width: 0, height: 0 };
    const y = track.y + track.height / 2;
    await page.mouse.move(track.x + track.width * 0.4, y);
    await page.mouse.down();
    await page.mouse.move(track.x + track.width * 0.8, y);
    // The preview reached the document first, or the restore below would be
    // indistinguishable from a gesture that never wrote anything.
    await expect.poll(opacity).not.toBeCloseTo(0.4, 2);

    await page.keyboard.press("Escape");
    await page.mouse.up();

    await expect.poll(opacity).toBeCloseTo(0.4, 5);
    await page.keyboard.press("Control+z");
    await expect.poll(opacity).toBeCloseTo(1, 5);
  });

  test("commits a value typed into the slider's well, and refuses one past its bound", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await page.goto(EDITOR);
    await page.waitForFunction(() => "yunariEditorBridge" in window);
    await page.locator('[data-yunari-layer="group-cpu-card"]').click();

    // The typed route the well owns (item 10). A bound typed past is **kept
    // with its reason rather than coerced** (§5): the field that lands the
    // value the author typed is the one that teaches nothing about the bound,
    // and an invalid `aria-invalid` does not raise `blur`.
    const track = page.locator('input[type="range"][data-yunari-opacity]');
    const well = page.locator("input[data-yunari-opacity-well]");
    await expect(well).toHaveValue("100");
    // The well is named by the row's own label rather than by a label element
    // beside it, so the association is what proves it is this row's field.
    await expect(well).toHaveAttribute("aria-labelledby", /.+/);

    await well.fill("40");
    await well.blur();
    await expect(track).toHaveValue("40");
    await expect(well).toHaveValue("40");
    expect(
      await propertyOf(page, "group-cpu-card", "opacity"),
      "the typed value reached the document",
    ).toBeCloseTo(0.4, 5);

    await well.fill("140");
    await well.blur();
    // The refusal is the field's own, by the id it mints for it: a `getByText`
    // over the whole page also matches the ancestor that contains the message.
    await expect(page.locator(`#${await idOf(well)}-invalid`)).toHaveText(
      "at most 100",
    );
    // Nothing was written, so the field and the document both still hold the
    // last value that committed.
    await expect(track).toHaveValue("40");
    expect(await propertyOf(page, "group-cpu-card", "opacity")).toBeCloseTo(
      0.4,
      5,
    );
  });

  test("moves a slider by its own step on a wheel, and not past its bound", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await page.goto(EDITOR);
    await page.waitForFunction(() => "yunariEditorBridge" in window);
    await openBlank(page);
    await insert(page, "Rectangle", "shape");

    // The wheel's own case (item 11). The step is read off the range input
    // rather than declared beside it, so the gesture and the drag cannot step
    // by different amounts — which is why the two readings below are compared
    // rather than the numbers 1 and 0 being asserted outright.
    const track = page.locator('input[type="range"][data-yunari-panel-border]');
    await expect(track).toHaveAttribute("step", "1");
    const well = page.locator("input[data-yunari-panel-border-well]");
    const step = Number(await track.getAttribute("step"));
    const start = Number(await well.inputValue());
    const box = await track.boundingBox();
    expect(box, "the column draws no border slider").not.toBeNull();
    const at = {
      x: (box?.x ?? 0) + (box?.width ?? 0) / 2,
      y: (box?.y ?? 0) + (box?.height ?? 0) / 2,
    };

    // The pointer is over the control and the wheel goes down: the value rises
    // by the track's own step, and the document takes it.
    await page.mouse.move(at.x, at.y);
    await page.mouse.wheel(0, -120);
    await expect(well).toHaveValue(String(start + step));
    expect(await propertyOf(page, "Rectangle", "strokeWidth")).toBe(
      start + step,
    );

    // Past the ceiling the wheel writes nothing at all, rather than writing the
    // ceiling again or running away above it.
    const max = await track.getAttribute("max");
    if (max === null) throw new Error("the stroke-width track has no max");
    await well.fill(max);
    await well.blur();
    const ceiling = Number(await well.inputValue());
    await page.mouse.move(at.x, at.y);
    await page.mouse.wheel(0, -120);
    await expect(well).toHaveValue(String(ceiling));
    expect(await propertyOf(page, "Rectangle", "strokeWidth")).toBe(ceiling);
  });

  test("gives every bounded number in the column the pair, and leaves the unbounded one typed", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await page.goto(EDITOR);
    await page.waitForFunction(() => "yunariEditorBridge" in window);
    await openBlank(page);
    await insert(page, "Rectangle", "shape");

    // A shadow's blur and offset are only offered while there is a shadow for
    // them to change, so the census asks for one the way an author does: through
    // the picker, on whatever solid token the document offers.
    const tokens = await optionsOf(page, "[data-yunari-panel-shadow]");
    const ink = tokens.find((token) => token !== "");
    expect(
      ink,
      "the document offers no solid token for a shadow",
    ).toBeDefined();
    await chooseIn(page, "[data-yunari-panel-shadow]", ink as string);

    /**
     * The census, read off the rendered column rather than off the projection.
     *
     * `vg-007` owns the rule — a bounded number clamps onto its bound and
     * carries a native slider — and this is its application to every field the
     * column has, which is what item 12 asked for. Each bounded name must be a
     * `input[type=range]` **and** carry a typed well of its own; each unbounded
     * one must be neither.
     */
    const shape = async (
      name: string,
      value?: string,
    ): Promise<{ range: number; well: number; typed: number }> =>
      page.evaluate(
        ({ name, value }) => {
          const scope = document.querySelector(".editor-shell-inspector");
          const count = (selector: string): number =>
            scope === null ? 0 : scope.querySelectorAll(selector).length;
          const hook =
            value === undefined ? `[${name}]` : `[${name}="${value}"]`;
          // The well takes the hook's own name with `-well` appended —
          // `control-slider.tsx` mirrors `data` onto the typed half, because two
          // elements under one name is a locator that cannot say which it means.
          const well =
            value === undefined
              ? `[${name}-well]`
              : `[${name}-well="${value}"]`;
          return {
            range: count(`input[type="range"]${hook}`),
            well: count(`input[type="text"]${well}`),
            typed: count(`input[type="text"]${hook}`),
          };
        },
        { name, value },
      );

    // Bounded, so every one of them carries both halves: the panel's three
    // pixel measures, the Layer section's opacity, and geometry's rotation.
    for (const [name, value] of [
      ["data-yunari-panel-border"],
      ["data-yunari-panel-radius"],
      ["data-yunari-panel-shadow-blur"],
      ["data-yunari-opacity"],
      ["data-yunari-geometry", "angle"],
    ] as const) {
      const field = await shape(name, value);
      expect(field.range, `${name} ${value ?? ""} draws no track`).toBe(1);
      expect(field.well, `${name} ${value ?? ""} has no typed well`).toBe(1);
    }

    // Unbounded, so the rule does not reach them: a text box, no track beside
    // it, and no second well either. The shadow's offset is above the panel as
    // well as below it, and the position pair is the artboard's own extent.
    for (const [name, value] of [
      ["data-yunari-panel-shadow-offset"],
      ["data-yunari-geometry", "left"],
      ["data-yunari-geometry", "width"],
    ] as const) {
      const field = await shape(name, value);
      expect(field.range, `${name} draws a track for an unbounded number`).toBe(
        0,
      );
      expect(field.typed, `${name} ${value ?? ""} is not a typed box`).toBe(1);
    }
  });

  // yunari#51: choosing `fixed` unmounts the shell before the value can be
  // typed, because `isDirty` validates the transiently invalid document.
  // Fixme, not skip, so the reason and the issue stay on the case itself.
  test.fixme("draws a remainder slice for a fixed pie total, measured on the canvas", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await page.goto(EDITOR);
    await page.waitForFunction(() => "yunariEditorBridge" in window);
    await openBlank(page);
    // The stage behind a transparent chart is the same `#223047` as the
    // remainder's own ink, so the artboard is given a different ground first:
    // otherwise "no remainder" measures 6,610 pixels of somebody else's paint.
    // The paint is the background layer's, so it is written where that layer
    // is selected.
    await selectLayer(page, "Background");
    await chooseIn(page, "[data-yunari-background]", "palette.frost");
    await addChart(page, {
      family: "Pie",
      name: "pie",
      x: 60,
      y: 60,
      w: 300,
      h: 300,
      series: ["cpu.load"],
    });

    const data = async (): Promise<{ name: string; value: number }[]> => {
      const option = (await builtOption(page, "pie")) as {
        series: [{ data: { name: string; value: number }[] }];
      };
      return option.series[0].data;
    };

    // Sum of the parts: one slice, no remainder, and none of the remainder's
    // ink anywhere inside the chart.
    expect((await data()).map((entry) => entry.name)).toEqual(["cpu.load"]);
    expect(await colourInsideObject(page, "pie", REMAINDER_INK)).toBe(0);

    await chooseIn(page, '[data-yunari-chart-setting="total"]', "fixed");
    const value = page.locator('[data-yunari-chart-setting="total.value"]');
    await value.fill("400");
    await value.blur();
    await expect(value).toHaveValue("400");
    await expect
      .poll(async () => (await data()).length, { timeout: 10_000 })
      .toBe(2);

    const slices = await data();
    const remainder = slices.find((entry) => entry.name === "remainder");
    const known = slices
      .filter((entry) => entry.name !== "remainder")
      .reduce((sum, entry) => sum + entry.value, 0);
    expect(remainder?.value).toBeCloseTo(400 - known, 6);

    // ...and the slice is on the glass, in the remainder's own ink, where a
    // moment ago there was none of it.
    const drawn = await colourInsideObject(page, "pie", REMAINDER_INK);
    expect(drawn).toBeGreaterThan(1000);

    // Unset again: the remainder goes, and so does its ink.
    await chooseIn(page, '[data-yunari-chart-setting="total"]', "sum");
    await expect.poll(async () => (await data()).length).toBe(1);
    expect(await colourInsideObject(page, "pie", REMAINDER_INK)).toBe(0);
  });

  test("reaches a line chart's animation, and the reopened document keeps it", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await page.goto(EDITOR);
    await page.waitForFunction(() => "yunariEditorBridge" in window);
    await openBlank(page);
    await addChart(page, {
      family: "Line",
      name: "line",
      x: 100,
      y: 100,
      w: 300,
      h: 200,
      series: ["cpu.load"],
    });

    const duration = page.locator(
      '[data-yunari-chart-setting="animation.durationMs"]',
    );
    const easing = page.locator(
      '[data-yunari-chart-setting="animation.easing"]',
    );
    await expect(duration).toBeVisible();
    await expect(easing).toBeVisible();
    // Absence means the defaults apply rather than that the chart is static.
    // The easing is a picker and reads empty until the author writes one — the
    // write materialises the whole block from its owner. The duration is a
    // slider now, and **a track has no empty state**: it shows the value the
    // renderer draws with, read from the animation block's own defaults, and
    // the well's empty draft is how the author returns to absent.
    await expect(duration).toHaveAttribute("type", "range");
    await expect(duration).toHaveAttribute("max", "5000");
    await expect(
      page.locator('[data-yunari-chart-setting-well="animation.durationMs"]'),
    ).toHaveValue("1000");
    await expect(await choiceOf(easing)).toBe("");

    await typeIntoControl(
      page,
      page.locator('[data-yunari-chart-setting-well="animation.durationMs"]'),
      "2500",
    );
    await expect(duration).toHaveValue("2500");
    await chooseIn(
      page,
      '[data-yunari-chart-setting="animation.easing"]',
      "cubicInOut",
    );
    await expect(await choiceOf(easing)).toBe("Cubic in-out");
    expect(await chartSettings(page, "line")).toMatchObject({
      animation: {
        durationMs: 2500,
        easing: "cubicInOut",
        appearMs: 650,
        appearEasing: "cubicOut",
      },
    });

    // **What the editor's own option builder emits, measured rather than
    // assumed.** `chart-manager/index.ts` builds every editor chart with
    // `animate: false`, so `toEngineAnimation` zeroes all four values and the
    // authored animation is not observable in the built option at all — it is
    // identical with the defaults and with 2500. The round trip below is
    // therefore read through the column after a reopen, which is the surface
    // where the author's value is visible; the plan's "read through the option
    // builder" cannot be satisfied on the editor and is reported as a finding.
    expect(await builtOption(page, "line")).toMatchObject({
      animation: false,
      animationDurationUpdate: 0,
      animationEasingUpdate: "linear",
    });

    const bytes = await savePackage(page);
    await openPackage(page, bytes);
    // By the name the author gave it: a reopened document's ids are the
    // document's own, so the tree row is the name the panel paints.
    await selectLayer(page, "line");

    // The reopened document shows the author's values — 2500 and cubicInOut —
    // and not the defaults 1000 and linear.
    await expect(
      page.locator('[data-yunari-chart-setting="animation.durationMs"]'),
    ).toHaveValue("2500");
    // The control shows the easing's label, not its id: the id behind a choice
    // is Base UI's state and never reaches the DOM.
    await expect(
      await choiceOf(
        page.locator('[data-yunari-chart-setting="animation.easing"]'),
      ),
    ).toBe("Cubic in-out");
    expect(await chartSettings(page, "line")).toMatchObject({
      animation: { durationMs: 2500, easing: "cubicInOut" },
    });
  });

  test("gives every bounded number in the chart manager the pair, read rendered", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await page.goto(EDITOR);
    await page.waitForFunction(() => "yunariEditorBridge" in window);
    await openBlank(page);
    await addChart(page, {
      family: "Line",
      name: "line",
      x: 100,
      y: 100,
      w: 300,
      h: 200,
      series: ["cpu.load"],
    });

    /**
     * The census for the **other** surface this task swept.
     *
     * The selection column has had one since item 12; the chart manager had
     * none, and both its suites are jsdom, so a stylesheet regression on a chart
     * track — or a bounded field silently reverting to a typed box — was
     * invisible to every check in the repo. `vg-469`'s check cited a rendered
     * reading on one surface and a jsdom reading on the other, which is the
     * asymmetry this case ends.
     *
     * **Read by form, not from a list.** Every numeric control the manager
     * renders is either the track-and-well pair or a typed box, and the assertion
     * is that relation, so a field that stops being paired fails here rather
     * than passing an enumeration that no longer names it.
     */
    const census = async (
      attribute: string,
    ): Promise<{ key: string; type: string; paired: boolean }[]> =>
      page.evaluate((name) => {
        const rows: { key: string; type: string; paired: boolean }[] = [];
        for (const input of document.querySelectorAll<HTMLInputElement>(
          `input[${name}]`,
        )) {
          const key = input.getAttribute(name) ?? "";
          rows.push({
            key,
            type: input.type,
            paired:
              document.querySelector(`input[${name}-well="${key}"]`) !== null,
          });
        }
        return rows;
      }, attribute);

    const settings = await census("data-yunari-chart-setting");
    // Not vacuous: the surface is mounted and these two rows are its two shapes.
    expect(settings.map((row) => row.key)).toContain("animation.durationMs");
    expect(settings.map((row) => row.key)).toContain("windowSeconds");
    for (const row of settings) {
      expect(
        row.paired,
        `${row.key} is a ${row.type} box with ${
          row.paired ? "" : "no "
        }typed well beside it`,
      ).toBe(row.type === "range");
    }

    // The drawn-box measures are the ones a chart's own size bounds, and the
    // three the ruling leaves typed are the ones a track cannot honour.
    const typeOf = (key: string): string | undefined =>
      settings.find((row) => row.key === key)?.type;
    expect(["lineWidth", "animation.durationMs"].map(typeOf)).toEqual([
      "range",
      "range",
    ]);
    expect(["windowSeconds", "maxPoints"].map(typeOf)).toEqual([
      "text",
      "text",
    ]);

    // And the series rows, which are hand-built JSX rather than descriptor-driven
    // — the shape the first census's enumeration never reached, and the one a
    // bounded `Precision` sat typed-only in. The hook's value is
    // `${binding.id}.${property}` and a binding's id is minted per series, so
    // the row is found by the property half rather than by the key's whole text.
    const series = await census("data-yunari-binding-field");
    const seriesOf = (
      property: string,
    ): { type: string; paired: boolean } | undefined => {
      const row = series.find((entry) => entry.key.endsWith(property));
      return row === undefined
        ? undefined
        : { type: row.type, paired: row.paired };
    };
    for (const row of series) {
      expect(
        row.paired,
        `${row.key} is a ${row.type} box with ${
          row.paired ? "" : "no "
        }typed well beside it`,
      ).toBe(row.type === "range");
    }
    expect(seriesOf(".precision")).toEqual({ type: "range", paired: true });
    expect(seriesOf(".scale")).toEqual({ type: "text", paired: false });
    expect(seriesOf(".offset")).toEqual({ type: "text", paired: false });
  });

  test("gives every kind a column, and shows no kind a property it lacks", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await page.goto(EDITOR);
    await page.waitForFunction(() => "yunariEditorBridge" in window);
    await openBlank(page);

    const report = async (kind: string): Promise<void> => {
      expect(await sectionIds(page), `${kind} sections`).not.toHaveLength(0);
      expect(await controlCount(page), `${kind} controls`).toBeGreaterThan(0);
    };

    // A free shape: its own geometry and ink, at the same density.
    await insert(page, "Rectangle", "shape");
    await report("shape");
    await expect(page.locator("[data-yunari-panel-fill]")).toHaveCount(1);
    await expect(page.locator("[data-yunari-crop]")).toHaveCount(0);

    // A text box: typography, and no crop — it has no pixels to crop.
    await insert(page, "Text", "text");
    await report("text");
    await expect(page.locator("[data-yunari-crop]")).toHaveCount(0);
    await expect(page.locator("[data-yunari-panel-fill]")).toHaveCount(0);

    // An image: the one kind that can crop, and not a panel either.
    await openPane(page, "Add");
    await chooseAssetFile(page, "import", {
      name: "logo.png",
      mimeType: "image/png",
      buffer: EDITOR_PNG,
    });
    await report("image");
    await expect(page.locator("[data-yunari-crop]")).toHaveCount(1);
    await expect(page.locator("[data-yunari-panel-fill]")).toHaveCount(0);

    // A chart: its family's own questions, in the column it belongs to.
    await addChart(page, {
      family: "Gauge",
      name: "gauge",
      x: 400,
      y: 100,
      w: 240,
      h: 240,
      series: ["cpu.load"],
    });
    await report("chart");
    await expect(
      page.locator('[data-yunari-chart-setting="thickness"]'),
    ).toBeVisible();

    // A group: its bounds and its children's effective appearance, never a
    // panel material — a card is not a rectangle.
    await page.goto(EDITOR);
    // The inserts above dirtied the document, so this reload is offered its own
    // draft back.
    await answerDialogIfShown(page, "Discard");
    await page.waitForFunction(() => "yunariEditorBridge" in window);
    await page.locator('[data-yunari-layer="group-cpu-card"]').click();
    await report("group");
    await expect(page.locator("[data-yunari-panel-fill]")).toHaveCount(0);
    await expect(page.locator("[data-yunari-crop]")).toHaveCount(0);
  });

  test("drives the Line-endpoint geometry field, and the non-numeric draft is refused by the control", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await page.goto(EDITOR);
    await page.waitForFunction(() => "yunariEditorBridge" in window);
    await openBlank(page);
    // The Shape group's own Line: the label is a shape and a chart family, and
    // the group the caller names is what says which one was asked for (`vg-537`).
    await insert(page, "Line", "shape");

    // `vg-401`'s reading, taken here rather than inferred. The field is **not**
    // in a refused state — `ControlNumber` renders `readOnly={refused !==
    // undefined}`, and the inspector sets no `refused` on a shape's own
    // geometry — so Playwright's editability wait is not what an earlier probe
    // hit, and a field a browser cannot type into is not what the product does.
    const endpoint = page.locator('[data-yunari-shape-line="x1"]');
    await expect(endpoint).toHaveCount(1);
    await expect(endpoint).toBeEditable();
    expect(
      await endpoint.evaluate((element: HTMLInputElement) => element.readOnly),
    ).toBe(false);
    const start = await endpoint.inputValue();

    // The unreadable draft lands and stays: the control's own parse refuses it
    // and says so, rather than reverting in silence.
    await endpoint.fill("abc");
    await expect(endpoint).toHaveValue("abc");
    await endpoint.blur();
    await expect(endpoint).toHaveAttribute("aria-invalid", "true");
    await expect(
      page.locator(`#${await endpoint.getAttribute("aria-describedby")}`),
    ).toHaveText("not a number");

    // Escape drops the draft, so what is shown is the object's own endpoint
    // again — the unreadable text never reached the write funnel.
    await endpoint.press("Escape");
    await expect(endpoint).toHaveValue(start);
    await expect(endpoint).not.toHaveAttribute("aria-invalid", "true");
  });

  test("the section header takes the drawing's rule, §2's mono count and §4's faint, and the subject name §2's 600", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await page.goto(EDITOR);
    await page.waitForFunction(() => "yunariEditorBridge" in window);
    await openBlank(page);
    await addChart(page, {
      family: "Line",
      name: "line",
      x: 100,
      y: 100,
      w: 300,
      h: 200,
      series: ["cpu.load"],
    });

    // Plan 1's parity census (`vg-390`) re-derived these two from
    // `docs/design/mockups/current/controls.html`: `:30` draws the header's
    // count in `ui-monospace` and `var(--faint)`, and `:24` draws the subject's
    // name at weight 600. §2 gives counts to UI mono (`DESIGN.md:124`) and
    // titles 600 (`:149`); §4 gives `--faint` to counts (`:103`). Both were
    // inherited before this case existed — the count took the heading's sans
    // and `--muted`, the name the shell's 400.
    const count = page.locator("[data-yunari-section-count]").first();
    await expect(count).toBeVisible();
    expect(
      await count.evaluate((el) => getComputedStyle(el).fontFamily),
    ).toMatch(/mono/i);
    // Read against the header's own chevron, which §5 already draws in
    // `--faint`, so this holds in every palette rather than in one. The rule
    // span beside it is `aria-hidden` too, so it is excluded by name.
    const chevron = page
      .locator(
        '[data-yunari-section="position"] span[aria-hidden]:not([data-yunari-section-rule])',
      )
      .first();
    expect(await count.evaluate((el) => getComputedStyle(el).color)).toBe(
      await chevron.evaluate((el) => getComputedStyle(el).color),
    );

    await expect(page.locator("[data-yunari-subject-name]")).toHaveCSS(
      "font-weight",
      "600",
    );

    // The header's trailing rule, which every current drawing draws between the
    // count and the chevron (`controls.html:31` and five siblings). Nothing
    // argued against it, so it is a difference the drawing wins. Its neighbouring
    // case — the read-only rows' omitted dashed divider, where `column.tsx`'s
    // §5.1 note won instead — left with the read-only section (item 17).
    const rule = page.locator(
      '[data-yunari-section="position"] [data-yunari-section-rule]',
    );
    await expect(rule).toHaveCSS("height", "1px");
    expect(
      await rule.evaluate((el) => getComputedStyle(el).backgroundColor),
    ).not.toBe("rgba(0, 0, 0, 0)");
  });

  test("the subject block heads the column with the kind's glyph, and is the one boundary under it", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await page.goto(EDITOR);
    await page.waitForFunction(() => "yunariEditorBridge" in window);
    await openBlank(page);
    await addChart(page, {
      family: "Line",
      name: "line",
      x: 100,
      y: 100,
      w: 300,
      h: 200,
      series: ["cpu.load"],
    });

    // ── `vg-466`'s first half: the kind is a mark, not a word ────────────────
    //
    // What the header draws for the kind before `3328ae33` was the word
    // `KIND_WORD`'s entry for it, joined to the binding key ("Chart ·
    // cpu.load"). The regression is a header that draws that word where the
    // mark goes, so the assertion is on the *rendered sibling* the mark is and
    // the text the block is left with — a class check would pin the shape and
    // not the glyph family.
    const name = page.locator("[data-yunari-subject-name]");
    await expect(name).toBeVisible();
    const block = await name.evaluate((node) => {
      const mark = node.previousElementSibling;
      return {
        markTag: mark?.tagName.toLowerCase() ?? null,
        markClasses: mark?.getAttribute("class") ?? "",
        text: (node.parentElement?.textContent ?? "").trim(),
      };
    });
    expect(block.markTag, "no mark precedes the subject name").toBe("svg");
    expect(
      block.markClasses,
      "the kind's mark is not from the one icon family",
    ).toContain("lucide");
    expect(block.text, "the block still names the kind in words").not.toMatch(
      /chart/i,
    );

    // ── `vg-466`'s second half: one boundary, not two ────────────────────────
    //
    // The subject block's own `border-b` is the column's boundary between the
    // header and the fields, so the first section draws none and every one
    // below it draws its own. **Computed rather than read off the class list**:
    // the whole reason this row exists is that the fix is a rendered boundary,
    // and no jsdom case applies the stylesheet that decides it — a rule that
    // put a border back on `[data-yunari-section]` would leave every one of
    // them green.
    const borders = await page
      .locator(`${COLUMN} [data-yunari-section]`)
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          id: node.getAttribute("data-yunari-section") ?? "",
          top: getComputedStyle(node).borderTopWidth,
        })),
      );
    expect(
      borders.length,
      "the column draws no sections to read a boundary on",
    ).toBeGreaterThan(1);
    expect(
      borders[0]?.top,
      `the first section (${borders[0]?.id}) draws a rule of its own beside the subject block's`,
    ).toBe("0px");
    expect(
      borders.slice(1).every((section) => section.top !== "0px"),
      `a section below the first draws no boundary between them: ${JSON.stringify(borders)}`,
    ).toBe(true);
  });

  test("names where to choose from when nothing is selected", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await page.goto(EDITOR);
    await page.waitForFunction(() => "yunariEditorBridge" in window);
    await openBlank(page);

    // §7.4's requirement is a property of the line, not its spelling: "the
    // column is empty and says where to choose from" (`DESIGN.md:279`). A pin
    // on the literal passes whatever the literal says, so the case named for
    // the clause could not fail while the line named no place — `vg-446`.
    // The string's provenance stays pinned in jsdom, where it is compared
    // against `uiCopy.inspectorFields.nothingSelected` itself
    // (`selection-inspector/index.dom.test.ts`).
    await expect(page.locator("[data-yunari-nothing-selected]")).toHaveText(
      /canvas/i,
    );
    expect(await sectionIds(page)).toEqual([]);
    await expect(page.locator("[data-yunari-geometry]")).toHaveCount(0);
  });

  test("withholds a locked object's writing fields, and stands no section at all", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await page.goto(EDITOR);
    await page.waitForFunction(() => "yunariEditorBridge" in window);

    // Locking through the layer row's own control notifies the column, which
    // follows it with no further selection event — `vg-148`'s fix, asserted here
    // rather than worked around by re-selecting, because a workaround would keep
    // passing after the notify was removed.
    await page.locator('[data-yunari-layer="group-cpu-card"]').click();
    await page
      .locator('[data-yunari-layer="group-cpu-card"] [aria-label="Lock"]')
      .click();

    await expect(page.locator("[data-yunari-locked]")).toBeVisible();

    // Everything that writes is gone, so no question has anything left under it
    // and none of them stands a header over nothing. **An inspector may be
    // empty**: while the read-only section stood it kept one, and §7.4's
    // empty-section rule is what says the column shows nothing rather than a
    // header over a locked object's absent rows. The lead block still names the
    // lock, which is the surface that says why.
    expect(await sectionIds(page)).toEqual([]);
    await expect(page.locator("[data-yunari-name]")).toHaveCount(0);
    await expect(page.locator("[data-yunari-geometry]")).toHaveCount(0);
    await expect(page.locator("[data-yunari-panel-fill]")).toHaveCount(0);
  });

  test("undoes a chart settings edit, in the column and on the canvas", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await page.goto(EDITOR);
    await page.waitForFunction(() => "yunariEditorBridge" in window);
    await selectStarterGauge(page);

    const thickness = page.locator('[data-yunari-chart-setting="thickness"]');
    await expect(thickness).toBeVisible();
    const drawn = async (): Promise<number | undefined> => {
      const option = (await builtOption(page, "ram-gauge")) as {
        series: [{ progress?: { width?: number } }];
      };
      return option.series[0].progress?.width;
    };

    // The starter's own ring, so the numbers are the document's rather than a
    // value this test wrote.
    await expect(thickness).toHaveValue("20");
    expect(await drawn()).toBe(20);

    await thickness.fill("8");
    await thickness.blur();
    await expect(thickness).toHaveValue("8");
    await expect.poll(drawn).toBe(8);

    // One edit, one history entry: the settings write reaches `history.save()`
    // through the chart manager's own announcement, and nothing else does. Both
    // the canvas and the column have to come back.
    await page.keyboard.press("Control+z");
    await expect
      .poll(async () => thickness.inputValue(), { timeout: 10_000 })
      .toBe("20");
    await expect.poll(drawn).toBe(20);
  });

  test("captures the sectioned column a card gets", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await page.goto(EDITOR);
    await page.waitForFunction(() => "yunariEditorBridge" in window);
    await page.locator('[data-yunari-layer="group-cpu-card"]').click();

    // The picture is the rebuilt column, so the column is asserted first. The
    // subject leads, the card's questions render and each of them is open
    // (item 13), and there is no read-only section left to photograph (item 17).
    // A projection that returned no sections would otherwise photograph an empty
    // column and pass.
    // **Three questions, not four, and again because the card is a Group**
    // (`vg-465`, item 8): the treatment section is withheld where there is no
    // render boundary for it to reach, and the refusal is said in the lead block.
    expect(await subjectLeadsColumn(page)).toBe(true);
    expect(await sectionIds(page)).toEqual(["content", "position", "layer"]);
    for (const id of ["content", "position", "layer"]) {
      expect(await isOpen(page, id), id).toBe(true);
    }

    await captureColumn(page, testInfo, "editor-inspector-card");
  });

  /**
   * `vg-268`/`vg-283`: the catalogue browser the font-trio plan shipped is
   * mounted on the field the ruling named as its owner — the selection
   * inspector's face field for a text object — and it is that control rather
   * than a second face picker written beside it.
   *
   * **Reachability is the claim, and it is about a rendered surface.** The field
   * is inside the text object's Content section, it is the catalogue (its rows
   * name real families, and its search narrows them), and a shape — which has no
   * face to change — is offered none. The write a face row makes is pinned in
   * jsdom (`column.dom.test.tsx`) and in the session's own `applyPresetFace`
   * test; applying one here would download the face from a CDN, which is a
   * network the suite does not own.
   */
  test("reaches the font catalogue from a text object's face field, and offers a shape none", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await page.goto(EDITOR);
    await page.waitForFunction(() => "yunariEditorBridge" in window);
    await openBlank(page);
    await insert(page, "Text", "text");

    // Scoped to Content: the field is the text section's, and a field that
    // rendered anywhere in the column would satisfy an unscoped read.
    const field = page.locator(
      '[data-yunari-section="content"] [data-yunari-font-face-field]',
    );
    await expect(field).toBeVisible();

    // **The catalogue is the finder's Fonts body**, not the field: the field
    // names the face and opens the browser that owns the list, so what the
    // press reaches is what this case asserts. The finder asks the host for its
    // sources first; the preview is not a host, and an empty listing is the
    // host answering that it serves none, so route it rather than let the
    // dialog fall back to "the host is not connected" (which hides every tab).
    await page.route("**/api/assets/sources", (route) =>
      route.fulfill({ json: { sources: [] } }),
    );
    await field.locator("[data-yunari-open-font-picker]").click();
    const body = page.locator('[data-yunari-asset-body="font-picker"]');
    await expect(body).toBeVisible();

    // The catalogue itself, not an empty list standing in for one.
    const rows = body.locator("[data-yunari-font-face-row]");
    await expect(rows.first()).toBeVisible();
    expect(
      await rows.first().getAttribute("data-yunari-font-family"),
    ).toBeTruthy();
    // The trio half and the facet choosers belong to the same control, so a
    // body that reached only the face list would be a partial mount.
    await expect(body.locator("[data-yunari-font-trio]")).toHaveCount(1);
    await expect(body.locator("[data-yunari-font-sort]")).toHaveCount(1);

    // Operable, not merely present: the search is bound to the query the rows
    // are drawn from, so a term no family holds empties the window and clearing
    // it fills the window again.
    const search = body.locator('input[type="search"]');
    await search.fill("zzzzzzzz");
    await expect(rows).toHaveCount(0);
    await search.fill("");
    await expect.poll(async () => rows.count()).toBeGreaterThan(0);

    // A shape has no face, so it is offered no field over one.
    await page.keyboard.press("Escape");
    await expect(body).toBeHidden();
    await insert(page, "Rectangle", "shape");
    await expect(page.locator("[data-yunari-font-face-field]")).toHaveCount(0);
  });

  test("captures the sectioned column a shape gets", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await page.goto(EDITOR);
    await page.waitForFunction(() => "yunariEditorBridge" in window);
    await openBlank(page);
    await insert(page, "Rectangle", "shape");
    await expect(
      page.locator("[data-yunari-panel-fill]").first(),
    ).toBeVisible();

    // The same preconditions, to the degree they apply: the subject leads and
    // the questions render, Position open like every other (item 13).
    expect(await subjectLeadsColumn(page)).toBe(true);
    expect(await sectionIds(page)).not.toHaveLength(0);
    expect(await isOpen(page, "position")).toBe(true);

    await captureColumn(page, testInfo, "editor-inspector-shape");
  });

  test("captures the chart's column", async ({ page }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await page.goto(EDITOR);
    await page.waitForFunction(() => "yunariEditorBridge" in window);
    await selectStarterGauge(page);
    await expect(
      page.locator('[data-yunari-chart-setting="thickness"]'),
    ).toBeVisible();

    expect(await subjectLeadsColumn(page)).toBe(true);
    expect(await sectionIds(page)).not.toHaveLength(0);
    expect(await isOpen(page, "position")).toBe(true);

    await captureColumn(page, testInfo, "editor-inspector-chart");
  });

  test("captures the chart's column in the reference palette", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await page.goto(EDITOR);
    await page.waitForFunction(() => "yunariEditorBridge" in window);
    // The dark half of the comparison: `inspector-controls.html` is drawn on
    // graphite, and a capture of one palette cannot show a hard-coded hex. The
    // same real selection — the starter's gauge child — is read in both.
    await choosePalette(page, "graphite");
    await selectStarterGauge(page);
    await expect(
      page.locator('[data-yunari-chart-setting="thickness"]'),
    ).toBeVisible();

    expect(await subjectLeadsColumn(page)).toBe(true);
    expect(await isOpen(page, "position")).toBe(true);

    await captureColumn(page, testInfo, "editor-inspector-chart-graphite");
  });
});
