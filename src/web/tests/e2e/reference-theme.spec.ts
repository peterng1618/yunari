import { expect, type Page, type TestInfo, test } from "@playwright/test";
import type { FontAssetReference } from "@yunari/renderer-core";
import { readThemePackage, writeThemePackage } from "@yunari/theme-package";
import { strToU8, zipSync } from "fflate";
import { solidOf } from "../../packages/editor/src/new-fabric-theme-globals.js";
import { chooseIn, optionsOf, typeIntoControl } from "./control-set.js";
import {
  type ArtboardRect,
  answerDialogIfShown,
  captureVisualReview,
  chooseAssetFile,
  clientOfScene,
  enterLayer,
} from "./editor-canvas.js";
import { openPane } from "./editor-rail.js";
import { GLASS_ENVELOPE, glassStripesPng } from "./glass-fixture.js";
import { selectLayer } from "./rebuild-driver.js";
import {
  EDGE_OBJECT_FILL,
  REFERENCE_BADGE_SVG,
} from "./reference-theme-fixture.js";
import { openThemeFromStore, storedThemeOfPackage } from "./store-library.js";
import { isDesktopSurface } from "./surface.js";

const EDITOR = "http://127.0.0.1:4174/";

/**
 * The reference composition, driven the way an author drives it.
 *
 * Eleven tasks built this. The files beside this one each prove one operation —
 * a glass control, a snap, a tracked preset, a caption. None of them proves
 * that a *user's* journey holds together, and that is the only thing left to
 * check: one document, authored through the product's own controls, saved,
 * closed, reopened, imported and captured, with the things that are allowed to
 * differ called out by name.
 *
 * Two things this file is careful about, because both produced confident wrong
 * answers elsewhere in this plan:
 *
 *  - **A rendered result is inspected, not inferred from a count.** The glass
 *    and the sharp-text claims are pixel measurements, and the thumbnails are
 *    looked at.
 *  - **A requirement the product does not meet is pinned, not written around.**
 *    `test.fail` marks such a gap, so the suite stays runnable and still
 *    refuses to stay green once the gap closes. Both gaps this file pinned have
 *    closed, and their marks went with their fixes; the round-capped gauge's
 *    missing progress arc lives in `host-player.spec.ts` because only the real
 *    host mounts it. Only a gap that reproduces every time earns a marker: an
 *    intermittent one flaps, and the first version of that marker did.
 */

const STARTER_WIDTH = 1672;
const STARTER_HEIGHT = 941;

/** The cards and marks the reference composition is made of. */
const REFERENCE_IDS = [
  "wordmark",
  "strapline",
  "time-card",
  "time",
  "date",
  "cpu-card",
  "cpu-card-value",
  "gpu-card",
  "ram-card",
  "ram-gauge",
  "vram-card",
  "trends-card",
  "trends-chart",
  "storage-card",
  "network-card",
] as const;

/** Declared as a font asset so its `family` is part of the contract rather than
 * an excess property on a plain `AssetReference`. The bytes are not a font. */
const BROKEN_FONT_ASSET: FontAssetReference = {
  id: "broken",
  kind: "font",
  path: "assets/broken.woff2",
  family: "Broken Test Face",
  weight: 400,
  style: "normal",
  format: "woff2",
  sourceUrl:
    "https://cdn.jsdelivr.net/fontsource/fonts/inter@5.1.1/latin-400-normal.woff2",
  license: {
    name: "SIL Open Font License 1.1",
    url: "https://openfontlicense.org/",
    attribution: "Not a real face; a Yunari test fixture.",
  },
};

const desktop = (testInfo: TestInfo): void => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
};

/**
 * Keys that may never appear in a saved object.
 *
 * Two families, and both are claims the plan makes about persistence. Fabric's
 * own runtime and derived geometry — `ownMatrixCache` and friends — are what
 * `includeDefaultValues = false` exists to drop. The rest is the plan's rule that
 * telemetry, built chart options and resolved surfaces are runtime state: an
 * object carrying a series or a batch count has recorded a run, not a document.
 *
 * Read off the starter's own save rather than guessed: the authored set is
 * geometry, paint, type, the four `yunari*` properties and a chart's `settings`,
 * and nothing below is authored state.
 */
const NEVER_SAVED = [
  "__corner",
  "__aCoords",
  "oCoords",
  "matrix",
  "calcTransformMatrix",
  "ownMatrixCache",
  "dirty",
  "cacheProperties",
  "_cacheCanvas",
  "_cacheContext",
  "_cacheTexture",
  "_set",
  "_width",
  "_height",
  "_objects",
  "_controls",
  "controls",
  "group",
  "zActive",
  "zReverse",
  "isEditing",
  "fontCache",
  "__style",
  "stateProperties",
  "globalCompositeOperation",
  "noScaleCache",
  "perPixelTargetFind",
  "minWidthLimit",
  "crossOrigin",
  "image",
  "src",
  "backgroundImage",
  "paintFirst",
  "skipControlsDrawing",
  "borderScaleFactor",
  "batchCount",
  "latest",
  "samples",
  "sample",
  "series",
  "xAxis",
  "yAxis",
  "tooltip",
  "legend",
  "option",
  "resolved",
  "runtime",
  "readings",
] as const;

interface ObjectFact {
  readonly id: string;
  readonly type: string;
  readonly rect: ArtboardRect;
  readonly glass: unknown;
}

/** Every object on the canvas, groups walked, with its authored box. */
function sceneFacts(page: Page): Promise<readonly ObjectFact[]> {
  return page.evaluate(() => {
    type Obj = {
      get(n: string): unknown;
      getObjects?(): Obj[];
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
          editor: { canvas: { getObjects(): Obj[] } };
        };
      }
    ).yunariEditorBridge;
    const out: Array<{
      id: string;
      type: string;
      rect: { left: number; top: number; width: number; height: number };
      glass: unknown;
    }> = [];
    const walk = (objects: Obj[]): void => {
      for (const object of objects) {
        const id = object.get("id");
        if (typeof id === "string") {
          const r = object.getBoundingRect();
          out.push({
            id,
            type: String(object.get("type")),
            rect: {
              left: Math.round(r.left * 100) / 100,
              top: Math.round(r.top * 100) / 100,
              width: Math.round(r.width * 100) / 100,
              height: Math.round(r.height * 100) / 100,
            },
            glass: object.get("yunariGlass") ?? null,
          });
        }
        const children = object.getObjects?.() ?? [];
        if (children.length > 0) walk(children);
      }
    };
    walk(bridge.editor.canvas.getObjects());
    return out;
  });
}

function idsOf(facts: readonly ObjectFact[]): readonly string[] {
  return facts.map((fact) => fact.id);
}

async function openEditor(page: Page): Promise<void> {
  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();
  await waitForBridge(page);
  // The first envelope is mounted after `loadFontAssets` resolves, so an id
  // list read too early would be the starter's absence rather than the
  // reference composition's.
  await expect
    .poll(async () => (await sceneFacts(page)).length, { timeout: 15_000 })
    .toBeGreaterThan(20);
}

/**
 * The scene bridge, once. The status line is set in the same tick the mount
 * finishes, but the global is published after the previous document's is torn
 * down, so waiting on the status is not waiting on the bridge — measured, not
 * assumed: without this the first `page.evaluate` of the scene reads
 * `undefined`.
 */
async function waitForBridge(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      (
        window as unknown as {
          yunariEditorBridge?: { editor?: { canvas?: unknown } };
        }
      ).yunariEditorBridge?.editor?.canvas !== undefined,
    undefined,
    { timeout: 20_000 },
  );
}

/** The media layer showing decoded pixels, not merely a `complete` image —
 * `complete` is also true of a failed load, which is how an earlier round of
 * this plan measured an empty scratch and blamed the sampler. */
async function waitForMedia(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const element = document.querySelector<
        HTMLImageElement | HTMLVideoElement
      >(
        "[data-yunari-background-media] img, [data-yunari-background-media] video",
      );
      return (
        element !== null &&
        (element instanceof HTMLVideoElement
          ? element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
          : element.complete)
      );
    },
    undefined,
    { timeout: 20_000 },
  );
  await page.evaluate(() => {
    const bridge = (
      window as unknown as {
        yunariEditorBridge?: { editor?: { canvas?: { renderAll(): void } } };
      }
    ).yunariEditorBridge;
    bridge?.editor?.canvas?.renderAll();
  });
}

async function savePackage(page: Page): Promise<{
  readonly bytes: Buffer;
  readonly envelope: Record<string, unknown>;
}> {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save package" }).click();
  // **The download is the save's own signal**, so it is what this waits for:
  // building the package on a loaded CI runner outran the status line's 5 s
  // default, and the assertion failed while the same save was still landing.
  const landed = await download;
  await expect(page.locator("#status-message")).toHaveText(
    "Theme package saved",
    { timeout: 15_000 },
  );
  const stream = await landed.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const parsed = readThemePackage(Buffer.concat(chunks));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.message);
  return {
    bytes: Buffer.concat(chunks),
    envelope: parsed.envelope as unknown as Record<string, unknown>,
  };
}

/** Opens a package the case just exported, through the store's own control. */
async function openPackage(page: Page, bytes: Uint8Array): Promise<void> {
  await openThemeFromStore(page, storedThemeOfPackage(bytes));
}

/**
 * Brings a file in through **File ▸ Import package**, the control an author has.
 *
 * An import is a library write, so a file that is not a package is refused and
 * the open document is left alone — which is the property the case below
 * measures. Driving the row and the chooser it opens, rather than the hidden
 * input, is what makes the control reachable in the test as it is in the
 * product.
 */
async function importFile(
  page: Page,
  name: string,
  buffer: Buffer,
): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Import package" }).click();
  await (await chooser).setFiles({
    name,
    mimeType: "application/octet-stream",
    buffer,
  });
}

function activeId(page: Page): Promise<string | undefined> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          yunariEditorBridge: {
            editor: {
              canvas: { getActiveObject(): { id?: string } | undefined };
            };
          };
        }
      ).yunariEditorBridge.editor.canvas.getActiveObject()?.id,
  );
}

/** Walks a saved envelope and names every authored object that grew a key the
 * persistence rules forbid. Returns names, so a failure says which object. */
function forbiddenKeys(envelope: unknown): readonly string[] {
  const found: string[] = [];
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => walk(entry, `${path}[${index}]`));
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const record = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if ((NEVER_SAVED as readonly string[]).includes(key)) {
        found.push(`${path}.${key}`);
      }
      walk(value, `${path}.${key}`);
    }
  };
  walk(envelope, "envelope");
  return found;
}

/**
 * The document without Fabric's derived per-character `styles` table.
 *
 * `styles` is what `applyAuthoredText` computes from each object's authored
 * `yunariText.runs`; nothing reads it back as authored state, and it is
 * recomputed on every mount. It is stripped here so the comparison is about
 * authored state, and the fact that it is *not* stable across two saves is
 * pinned by its own test rather than hidden by this exclusion.
 */
function authoredOnly(envelope: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(envelope)) as {
    scene?: { objects?: Array<Record<string, unknown>> };
  };
  // **Groups descended, because the table is written on the parts.** Fabric
  // writes `styles` on every `Textbox`, and a card's text runs are parts — so
  // stripping only the top level left the very table this excludes on most of
  // the scene, and two saves of the same unchanged document disagreed on it.
  // The exclusion is the one this function exists to make, so it has to reach
  // the objects the claim is about.
  const strip = (objects: Array<Record<string, unknown>> | undefined): void => {
    for (const object of objects ?? []) {
      delete object["styles"];
      if (Array.isArray(object["objects"])) strip(object["objects"]);
    }
  };
  strip(copy.scene?.objects);
  return copy;
}

function sceneObjectsOf(envelope: unknown): readonly Record<string, unknown>[] {
  const scene = (envelope as { scene?: { objects?: unknown } }).scene;
  const objects = scene?.objects;
  return Array.isArray(objects)
    ? // Elements were validated as a Fabric scene when the package was read.
      (objects as readonly Record<string, unknown>[])
    : [];
}

function objectsOf(envelope: unknown): readonly Record<string, unknown>[] {
  const scene = { objects: sceneObjectsOf(envelope) };
  // **Groups descended.** A card is a group, so a card's parts are not at the
  // top level and a flat read reported `[]` for "every object carrying a derived
  // style table" — the assertion passing vacuously rather than failing, which
  // is the direction that hides the defect it was written to pin.
  const all: Record<string, unknown>[] = [];
  const visit = (objects: ReadonlyArray<Record<string, unknown>>): void => {
    for (const object of objects) {
      all.push(object);
      if (Array.isArray(object["objects"])) visit(object["objects"]);
    }
  };
  visit(scene.objects);
  return all;
}

test.describe("the reference composition, authored", () => {
  test("a fresh document is the reference composition, and New never touches the saved one", async ({
    page,
  }, testInfo) => {
    desktop(testInfo);
    await openEditor(page);

    // **The new default.** The reference's own shape, not an approximation of
    // it: every card and mark, at the reference's artboard.
    const fresh = await sceneFacts(page);
    expect(idsOf(fresh)).toEqual(expect.arrayContaining([...REFERENCE_IDS]));
    // The reference card's own box, in scene coordinates, so the composition is
    // the reference's rather than any arrangement of the right names.
    const clock = fresh.find((fact) => fact.id === "time-card");
    // `getBoundingRect` is the drawn box, so it carries the card's own 2px
    // outline on every side: 367x307 authored, 369x309 drawn.
    expect(clock?.rect).toEqual({
      left: 40,
      top: 187,
      width: 369,
      height: 309,
    });
    expect(
      await page.evaluate(() => {
        const bridge = (
          window as unknown as {
            yunariEditorBridge: {
              editor: { viewport: { artboardScreenRect(): ArtboardRect } };
            };
          }
        ).yunariEditorBridge;
        return bridge.editor.viewport.artboardScreenRect().width;
      }),
    ).toBeGreaterThan(0);

    // **The author's work.** A panel inserted and styled through the product.
    await openPane(page, "Add");
    // The shape that replaced the old "Panel" button. Only "Line" needs the
    // "Shape" group to tell it from the "Line" chart, so a plain name is
    // unambiguous here and stays readable.
    await page
      .locator('[data-yunari-add-group="shape"]')
      .getByRole("button", { name: "Rectangle", exact: true })
      .click();
    const authored = (await activeId(page)) ?? "";
    expect(authored).not.toBe("");
    await typeIntoControl(
      page,
      page.locator("[data-yunari-panel-radius]"),
      "18",
    );
    const radius = page.locator("[data-yunari-panel-radius]");
    await expect(radius).toHaveValue("18");
    const beforeSave = await sceneFacts(page);
    const authoredBefore = beforeSave.find((f) => f.id === authored);
    expect(authoredBefore).toBeDefined();

    const saved = await savePackage(page);
    expect(saved.envelope["artboard"]).toMatchObject({
      width: STARTER_WIDTH,
      height: STARTER_HEIGHT,
    });
    expect(
      objectsOf(saved.envelope).find((object) => object["id"] === authored),
    ).toMatchObject({ rx: 18, ry: 18 });

    // **Close.** A reload is a fresh mount, and a fresh mount is the new
    // default again — nothing about the edited document survives it, which is
    // what makes the next step a real test rather than a formality.
    await page.reload();
    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible();
    await expect
      .poll(async () => (await sceneFacts(page)).length, { timeout: 15_000 })
      .toBeGreaterThan(20);
    const reopened = idsOf(await sceneFacts(page));
    expect(reopened).toEqual(expect.arrayContaining([...REFERENCE_IDS]));
    expect(reopened).not.toContain(authored);

    // **Reopen the saved document.** Its own composition, bounds and all.
    await openPackage(page, saved.bytes);
    const restored = await sceneFacts(page);
    expect(idsOf(restored)).toEqual(expect.arrayContaining([...REFERENCE_IDS]));
    const restoredAuthored = restored.find((fact) => fact.id === authored);
    expect(restoredAuthored?.rect).toEqual(authoredBefore?.rect);

    // **And the new default must not have overwritten it on the way in.** A
    // document-for-document comparison, because "the composition looks right"
    // is also what a document the editor quietly rebuilt would look like.
    // Key order is not compared — JSON property order is not authored state —
    // and neither is Fabric's per-character `styles` table, which
    // `applyAuthoredText` rebuilds from `yunariText.runs` on every mount. That
    // exclusion is a measured defect, not a convenience: two saves of the same
    // unchanged document disagree on it, and the gap is pinned separately as
    // "a save is reproducible".
    const again = await savePackage(page);
    const first = readThemePackage(saved.bytes);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(authoredOnly(again.envelope)).toEqual(
        authoredOnly(first.envelope),
      );
    }

    // **New**, from the reopened document: the reference composition returns,
    // and the file the author saved is still theirs afterwards.
    // The menu's own shortcut, so the gesture is the editor's and not a
    // hand-rolled click sequence.
    //
    // **Both answers are answered, because the editor does not know which one
    // to ask for.** A just-saved document is reported as changed *sometimes*:
    // five "discard?" prompts and one silent New across six save-then-`Ctrl+N`
    // rounds on an unchanged starter. The author answers whichever comes.
    await page.keyboard.press("Control+n");
    // New asks in two steps, and the order is fixed: a size chooser first, then
    // the question about the changes. Looking for "Discard" straight after the
    // chord found the chooser instead, which has no such button, and the test
    // hung there — a timeout that read like a product fault and was not one.
    await answerDialogIfShown(page, "Create");
    await answerDialogIfShown(page, "Discard");
    await expect(page.locator("#status-message")).toHaveText("New theme");
    await expect
      .poll(async () => idsOf(await sceneFacts(page)), { timeout: 15_000 })
      .not.toContain(authored);
    // **New is a blank theme of the chosen size, not the starter.** The File
    // menu says so — "New theme" beside "New from starter" — and this assertion
    // used to require the reference composition back, which is the other
    // command's job. Measured: after Create and Discard the canvas holds 0
    // objects. What matters here is that the author's object is gone and the
    // file they saved is untouched.
    expect(idsOf(await sceneFacts(page))).toEqual([]);
    const afterNew = readThemePackage(saved.bytes);
    expect(afterNew.ok).toBe(true);
    if (afterNew.ok) {
      expect(sceneObjectsOf(afterNew.envelope)).toContainEqual(
        expect.objectContaining({ id: authored, rx: 18 }),
      );
    }

    await captureVisualReview(page, testInfo, "editor-reference-new");
  });

  test("insert, style, glass, bind and text survive save, close and reopen with no runtime state", async ({
    page,
  }, testInfo) => {
    desktop(testInfo);
    // A whole journey — insert, style, glass, bind, save, close, reopen,
    // export — in one document, which is the point of the file. `test.slow`
    // raises the budget rather than the assertions.
    test.slow();
    await openEditor(page);

    // **Insert** — a text object and a chart, from the Add pane.
    await openPane(page, "Add");
    await page
      .locator('[data-yunari-panel="add"]')
      .getByRole("button", { name: "Text", exact: true })
      .click();
    const textId = (await activeId(page)) ?? "";
    await page
      .locator('[data-yunari-add-group="shape"]')
      .getByRole("button", { name: "Rectangle", exact: true })
      .click();
    const panelId = (await activeId(page)) ?? "";
    expect(textId).not.toBe("");
    expect(panelId).not.toBe("");

    // **Style**, by keyboard: a radius, then a glass radius through the
    // checkbox's own Space key.
    await typeIntoControl(
      page,
      page.locator("[data-yunari-panel-radius]"),
      "22",
    );
    const glassToggle = page.locator("[data-yunari-glass-enabled]");
    await glassToggle.focus();
    await page.keyboard.press("Space");
    await expect(glassToggle).toBeChecked();
    await typeIntoControl(page, page.locator("[data-yunari-glass-blur]"), "14");

    // **Bind** — the new chart pointed at a real semantic key, through the
    // binding select the chart panel owns. The select is named
    // `<nodeId>.<bindingId>`, so the node is read back rather than guessed.
    await openPane(page, "Add");
    // The "Line" *chart*, not the "Line" shape that now shares the word. The
    // chart families are their own group, so scoping to it is what tells the
    // two apart — a structural fact, not a DOM position that can move.
    await page
      .locator('[data-yunari-panel="add"]')
      .getByRole("group", { name: "Chart" })
      .getByRole("button", { name: "Line", exact: true })
      .click();
    const chartId = (await activeId(page)) ?? "";
    expect(
      await page.locator("[data-yunari-binding]").count(),
      "a freshly inserted chart arrives unbound",
    ).toBe(0);

    // **Bind** — the starter's own sparkline, pointed at another real key
    // through the select the chart panel owns.
    await openPane(page, "Composition");
    // **A part is selectable only while its owning group is entered.**
    // `bridge.selectLayer` takes `owner ?? target`, which is right for a layer
    // tree: with the card merely *open* a click on the row hands back the card,
    // and the document starts with every group shut — so a row lookup without
    // opening the card waited out its whole 90 s budget on a row that does not
    // exist. Entering is the act that makes the sparkline a row a click
    // selects, and it opens the card on the way. The selection is asserted on
    // the canvas object because that is what the author sees; the entered
    // context is only the mechanism.
    await enterLayer(page, "group-cpu-card");
    await page.locator('[data-yunari-layer="cpu-card-sparkline"]').click();
    await expect.poll(() => activeId(page)).toBe("cpu-card-sparkline");
    // A chart's own fields are in its column with the selection, which is
    // where the binding select lives.
    const bindingSelect = page.locator("[data-yunari-binding]").first();
    await expect(bindingSelect).toBeVisible();
    // Plan 1's select renders no option until it is opened, and each option
    // carries the key it commits as `data-yunari-option`.
    const keys = await optionsOf(page, bindingSelect);
    const key = keys.find((candidate) => candidate.startsWith("gpu."));
    expect(key, "the document offers a real key to bind").toBeDefined();
    await chooseIn(page, bindingSelect, key!);
    const bound = "cpu-card-sparkline";

    const beforeSave = await sceneFacts(page);
    const ids = idsOf(beforeSave);
    expect(new Set(ids).size, "authored ids are unique").toBe(ids.length);
    for (const id of [textId, panelId, chartId]) expect(ids).toContain(id);

    // **Save**, and read what the file actually says.
    const saved = await savePackage(page);
    expect(forbiddenKeys(saved.envelope)).toEqual([]);
    const objects = objectsOf(saved.envelope);
    expect(objects).toContainEqual(
      expect.objectContaining({
        id: panelId,
        yunariGlass: { blurRadius: 14 },
      }),
    );
    // A chart carries its own `LineSettings`, never a built ECharts option.
    const chart = objects.find((object) => object["id"] === chartId);
    expect(chart?.["settings"]).toBeDefined();
    expect(forbiddenKeys(chart?.["settings"])).toEqual([]);
    // And the binding is authored state on the chart's own node.
    expect(
      (
        saved.envelope["bindings"] as Record<
          string,
          Array<{ semanticKey: string }>
        >
      )[bound],
    ).toContainEqual(expect.objectContaining({ semanticKey: key }));
    // And nothing sampled: the value a bound run is painting right now is not
    // in the file.
    const json = JSON.stringify(saved.envelope);
    const painted = await page.evaluate(() => {
      const bridge = (
        window as unknown as {
          yunariEditorBridge: {
            editor: {
              canvas: { getObjects(): Array<{ get(n: string): unknown }> };
            };
          };
        }
      ).yunariEditorBridge;
      return bridge.editor.canvas
        .getObjects()
        .map((object) => String(object.get("text") ?? ""))
        .filter((text) => /^\d+(\.\d+)?%?$/.test(text.trim()));
    });
    for (const reading of painted) {
      expect(json, `"${reading}" was not sampled into the file`).not.toContain(
        `"text":"${reading}"`,
      );
    }

    // **Close and reopen** through the file the author exported.
    await page.reload();
    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible();
    await openPackage(page, saved.bytes);
    await expect
      .poll(async () => idsOf(await sceneFacts(page)), { timeout: 15_000 })
      .toEqual(ids);
    const afterReopen = await sceneFacts(page);
    for (const fact of beforeSave) {
      const again = afterReopen.find((other) => other.id === fact.id);
      // Authored bounds are unchanged, to a hundredth of a scene pixel.
      expect(again?.rect, `${fact.id}'s box`).toEqual(fact.rect);
      expect(again?.glass, `${fact.id}'s treatment`).toEqual(fact.glass);
    }

    // **Export again** and confirm the second export carries the same document.
    const exported = await savePackage(page);
    expect(forbiddenKeys(exported.envelope)).toEqual([]);
    expect(objectsOf(exported.envelope).map((object) => object["id"])).toEqual(
      ids,
    );

    await captureVisualReview(page, testInfo, "editor-reference-journey");
  });

  test("an unreadable package leaves the open document and the author's work alone", async ({
    page,
  }, testInfo) => {
    desktop(testInfo);
    await openEditor(page);

    await openPane(page, "Add");
    await page
      .locator('[data-yunari-add-group="shape"]')
      .getByRole("button", { name: "Rectangle", exact: true })
      .click();
    const panelId = (await activeId(page)) ?? "";
    const before = (await sceneFacts(page)).find((f) => f.id === panelId);
    expect(before).toBeDefined();

    // **Not a package at all.**
    await importFile(
      page,
      "broken.yunari-theme",
      Buffer.from("this is not a zip archive"),
    );
    await expect(page.locator("#status")).toContainText("Could not import:");
    expect(idsOf(await sceneFacts(page))).toContain(panelId);

    // **A package whose envelope the validator refuses.** Written without
    // `writeThemePackage`, so the bytes are a real zip around a bad document.
    await importFile(
      page,
      "invalid.yunari-theme",
      Buffer.from(
        zipSync({
          "manifest.json": strToU8(
            JSON.stringify({
              format: "yunari-theme-package",
              version: 1,
              theme: "theme.json",
            }),
          ),
          "theme.json": strToU8(JSON.stringify({ schemaVersion: 2 })),
        }),
      ),
    );
    await expect(page.locator("#status")).toContainText("Could not import:");

    // **The work is still there, still editable, and still saveable** — the
    // property "errors preserve recoverable work" actually means.
    const after = (await sceneFacts(page)).find((f) => f.id === panelId);
    expect(after?.rect).toEqual(before?.rect);
    await typeIntoControl(
      page,
      page.locator("[data-yunari-panel-radius]"),
      "9",
    );
    await expect(page.locator("[data-yunari-panel-radius]")).toHaveValue("9");
    const saved = await savePackage(page);
    expect(objectsOf(saved.envelope)).toContainEqual(
      expect.objectContaining({ id: panelId, rx: 9 }),
    );
  });

  test("a packaged font that will not load still leaves the document editable", async ({
    page,
  }, testInfo) => {
    desktop(testInfo);

    // A declared face whose bytes are not a font. `writeThemePackage` is the
    // gate and it only checks the declaration matches the archive, so this is a
    // package the host would happily store and a browser cannot load.
    const broken = writeThemePackage({
      envelope: {
        ...GLASS_ENVELOPE,
        id: "e2e-broken-font",
        assets: [...GLASS_ENVELOPE.assets, BROKEN_FONT_ASSET],
      },
      assets: {
        "assets/stripes.png": glassStripesPng(),
        "assets/broken.woff2": new TextEncoder().encode("not a font"),
      },
    });
    if (!broken.ok) throw new Error(`font fixture: ${broken.message}`);
    expect(broken.ok).toBe(true);

    await page.goto(EDITOR);
    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible();
    await waitForBridge(page);
    await openThemeFromStore(page, storedThemeOfPackage(broken.bytes));
    // **The face really was refused.** `loadFontAssets` catches the rejection
    // and the document opens regardless. What is missing is the *report*: the
    // loader writes its message to the status line and the store's own
    // `Opened <name>` overwrites it, so the author is told the theme opened
    // and nothing else. Measured for the report; the observable truth here is
    // that no face was registered.
    const faces = await page.evaluate(() =>
      [...document.fonts].map((face) => face.family),
    );
    expect(faces, "the refused face is not registered").not.toContain(
      "Broken Test Face",
    );

    // **The document is still open and still editable.** A theme is not a font
    // file, and a font the browser refused must not take the scene with it.
    await expect
      .poll(async () => (await sceneFacts(page)).length, { timeout: 15_000 })
      .toBeGreaterThan(0);
    const centre = await clientOfScene(
      page,
      "authoring",
      GLASS_ENVELOPE.artboard.width,
    );
    await page.mouse.click(centre.x, centre.y);
    await expect.poll(() => activeId(page)).toBe("authoring");
    const glassToggle = page.locator("[data-yunari-glass-enabled]");
    await glassToggle.focus();
    await page.keyboard.press("Space");
    await expect(glassToggle).toBeChecked();

    // **And the author's work is recoverable** — the saved document still
    // carries the face, so the author can replace it rather than start again.
    const saved = await savePackage(page);
    expect(forbiddenKeys(saved.envelope)).toEqual([]);
    expect(saved.envelope["assets"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "broken", family: "Broken Test Face" }),
      ]),
    );
    expect(
      objectsOf(saved.envelope).find((object) => object["id"] === "authoring"),
    ).toMatchObject({ yunariGlass: { blurRadius: expect.any(Number) } });
  });

  test("a run naming a binding the object does not declare says so", async ({
    page,
  }, testInfo) => {
    desktop(testInfo);
    // **The author's half of a missing reading.** A run that names a binding
    // the object never declared resolves to nothing at runtime, and the author
    // has to be able to tell that apart from a run whose sensor is merely
    // quiet. The editor states both, distinctly.
    //
    // The *display* half — a declared binding nothing reports — is not
    // measurable here: the editor's preview source samples every key it is
    // asked for, which is what preview mode is for. It is proved against the
    // real host in `host-player.spec.ts`, where the source only reports what a
    // provider reported.
    const envelope = {
      ...GLASS_ENVELOPE,
      id: "e2e-undeclared-run",
      globals: {
        ...GLASS_ENVELOPE.globals,
        typePresets: {
          "40-400": {
            name: "Reading",
            value: { family: "Segoe UI, sans-serif", size: 40, weight: "400" },
          },
        },
      },
      scene: {
        version: "7.4.0",
        objects: [
          ...GLASS_ENVELOPE.scene.objects,
          {
            type: "Textbox",
            version: "7.4.0",
            originX: "left",
            originY: "top",
            left: 320,
            top: 180,
            width: 300,
            height: 60,
            // A run the object declares no binding for. The validator accepts
            // the document; the run simply cannot resolve.
            text: "",
            fontSize: 40,
            fontFamily: "Segoe UI, sans-serif",
            fill: EDGE_OBJECT_FILL,
            id: "orphan",
            yunariPaint: { fill: "palette.edge" },
            yunariText: {
              runs: [
                {
                  kind: "value",
                  bindingId: "not-declared",
                  typePreset: "typePresets.40-400",
                  style: { color: { ref: "palette.edge" } },
                },
              ],
            },
          },
        ],
      },
    };
    const built = writeThemePackage({
      envelope,
      assets: { "assets/stripes.png": glassStripesPng() },
    });
    if (!built.ok) throw new Error(`undeclared fixture: ${built.message}`);

    await page.goto(EDITOR);
    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible();
    await openThemeFromStore(page, storedThemeOfPackage(built.bytes));
    await waitForBridge(page);

    await openPane(page, "Composition");
    await page.locator('[data-yunari-layer="orphan"]').click();
    await expect.poll(() => activeId(page)).toBe("orphan");
    // The run editor states the problem rather than leaving a silent gap, and
    // marks which of the three states this is.
    const note = page.locator('[data-yunari-run-problem="undeclared"]');
    await expect(note).toBeVisible();
    await expect(note).toHaveAttribute(
      "data-yunari-run-binding",
      "not-declared",
    );
    await expect(note).toContainText("resolves to nothing");

    // **And the document is still saveable with the orphan in it**, because a
    // document an author cannot save is not recoverable work.
    const saved = await savePackage(page);
    expect(forbiddenKeys(saved.envelope)).toEqual([]);
    expect(
      objectsOf(saved.envelope).find((object) => object["id"] === "orphan"),
    ).toMatchObject({
      yunariText: { runs: [{ kind: "value", bindingId: "not-declared" }] },
    });
  });
});

/** The starter's own picture, taken the way the product takes one. */
function captureOf(page: Page): Promise<{
  readonly width: number;
  readonly height: number;
  readonly transparent: number;
  readonly png: string;
  readonly zoom: number;
  readonly retina: number;
}> {
  return page.evaluate(async () => {
    const bridge = (
      window as unknown as {
        yunariEditorBridge: {
          capture(): string | undefined;
          editor: {
            canvas: {
              renderAll(): void;
              getRetinaScaling(): number;
              getZoom(): number;
            };
          };
        };
      }
    ).yunariEditorBridge;
    bridge.editor.canvas.renderAll();
    // The product's own call, not a re-derivation of it. This file used to
    // restate `toCanvasElement(min(1, 640 / max(w, h)))` here, which is how
    // a change to the capture path stops being measured at all (0007).
    const png = bridge.capture();
    if (png === undefined) throw new Error("the capture produced no picture");
    const image = new Image();
    image.src = png;
    await image.decode();
    const shot = document.createElement("canvas");
    shot.width = image.naturalWidth;
    shot.height = image.naturalHeight;
    const context = shot.getContext("2d");
    if (context === null) throw new Error("no capture context");
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, shot.width, shot.height).data;
    let transparent = 0;
    for (let i = 3; i < data.length; i += 4)
      if (data[i] === 0) transparent += 1;
    return {
      width: shot.width,
      height: shot.height,
      transparent: transparent / (data.length / 4),
      png,
      zoom: bridge.editor.canvas.getZoom(),
      retina: bridge.editor.canvas.getRetinaScaling(),
    };
  });
}

/**
 * The transparent fraction inside the artboard, in the product's own capture.
 *
 * `toCanvasElement` keeps the camera's zoom and pan and scales both by the
 * export multiplier, so the artboard's corners are mapped the way the capture
 * actually drew them rather than assumed to be its corners.
 *
 * `core` is the same measure over the middle half of the artboard. Since 0075
 * the media layer is `object-fit: cover` on the theme's own box, so it covers
 * the board whole and no fit can leave a letterbox inside it: the middle half
 * is covered exactly when the media reached the capture, which is what makes
 * the core reading the one that can say so. (The split was the letterbox's
 * doing, back when a `contain` fit left a quarter of the board empty.)
 */
function artboardTransparencyOfCapture(
  page: Page,
  [width, height]: readonly [number, number],
): Promise<{
  readonly clear: number;
  readonly coreClear: number;
  readonly w: number;
  readonly h: number;
}> {
  return page.evaluate(
    async ([artboardWidth, artboardHeight]) => {
      const bridge = (
        window as unknown as {
          yunariEditorBridge: {
            capture(): string | undefined;
            editor: {
              canvas: {
                width: number;
                height: number;
                renderAll(): void;
                getZoom(): number;
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
      ).yunariEditorBridge;
      bridge.editor.canvas.renderAll();
      const png = bridge.capture();
      if (png === undefined) throw new Error("the capture produced no picture");
      const image = new Image();
      image.src = png;
      await image.decode();
      const shot = document.createElement("canvas");
      shot.width = image.naturalWidth;
      shot.height = image.naturalHeight;
      const context = shot.getContext("2d");
      if (context === null) throw new Error("no capture context");
      context.drawImage(image, 0, 0);
      const canvas = bridge.editor.canvas;
      const scale = Math.min(1, 640 / Math.max(canvas.width, canvas.height));
      const zoom = canvas.getZoom();
      const vp = canvas.viewportTransform;
      const map = (x: number, y: number): readonly [number, number] => [
        (x * zoom + vp[4]!) * scale,
        (y * zoom + vp[5]!) * scale,
      ];
      const [x0, y0] = map(0, 0);
      const [x1, y1] = map(artboardWidth, artboardHeight);
      const left = Math.max(0, Math.round(x0));
      const top = Math.max(0, Math.round(y0));
      const w = Math.min(shot.width - left, Math.max(1, Math.round(x1 - x0)));
      const h = Math.min(shot.height - top, Math.max(1, Math.round(y1 - y0)));
      const clearOf = (x: number, y: number, cw: number, ch: number) => {
        const data = context.getImageData(x, y, cw, ch).data;
        let clear = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] === 0) clear += 1;
        return clear / (data.length / 4);
      };
      const coreW = Math.max(1, Math.round(w * 0.5));
      const coreH = Math.max(1, Math.round(h * 0.5));
      return {
        clear: clearOf(left, top, w, h),
        coreClear: clearOf(
          left + Math.round((w - coreW) / 2),
          top + Math.round((h - coreH) / 2),
          coreW,
          coreH,
        ),
        w,
        h,
      };
    },
    [width, height] as const,
  );
}

const FIXTURE_WITH_MEDIA = {
  ...GLASS_ENVELOPE,
  id: "e2e-capture",
  globals: {
    ...GLASS_ENVELOPE.globals,
    typePresets: {
      "20-400": {
        name: "Caption",
        value: { family: "Segoe UI, sans-serif", size: 20, weight: "400" },
      },
    },
  },
  assets: [
    ...GLASS_ENVELOPE.assets,
    {
      id: "badge",
      kind: "svg" as const,
      path: "assets/badge.svg",
      license: { name: "MIT", attribution: "Yunari test fixture." },
    },
  ],
  scene: {
    version: "7.4.0",
    objects: [
      ...GLASS_ENVELOPE.scene.objects,
      {
        type: "Image",
        version: "7.4.0",
        originX: "left",
        originY: "top",
        left: 40,
        top: 400,
        width: 128,
        height: 40,
        scaleX: 1,
        scaleY: 1,
        id: "badge",
        yunariAsset: { assetId: "badge", kind: "svg" },
      },
      {
        type: "Textbox",
        version: "7.4.0",
        originX: "left",
        originY: "top",
        left: 320,
        top: 180,
        width: 200,
        height: 40,
        text: "FROST",
        fontSize: 40,
        fontFamily: "Segoe UI, sans-serif",
        fill: EDGE_OBJECT_FILL,
        id: "over-glass",
        yunariPaint: { fill: "palette.edge" },
        yunariText: {
          runs: [
            {
              kind: "literal",
              text: "FROST",
              typePreset: "typePresets.20-400",
              style: { color: { ref: "palette.edge" } },
            },
          ],
        },
      },
    ],
  },
};

const BADGE_SVG = REFERENCE_BADGE_SVG;

async function openCaptureFixture(page: Page): Promise<Buffer> {
  const built = writeThemePackage({
    envelope: FIXTURE_WITH_MEDIA,
    assets: {
      "assets/stripes.png": glassStripesPng(),
      "assets/badge.svg": new TextEncoder().encode(BADGE_SVG),
    },
  });
  if (!built.ok) throw new Error(`capture fixture: ${built.message}`);
  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();
  await openThemeFromStore(page, storedThemeOfPackage(built.bytes));
  await waitForBridge(page);
  await page.waitForFunction(
    () => {
      const image = document.querySelector<HTMLImageElement>(
        "[data-yunari-background-media] img",
      );
      return image !== null && image.complete && image.naturalWidth > 0;
    },
    undefined,
    { timeout: 20_000 },
  );
  await page.evaluate(() => {
    const bridge = (
      window as unknown as {
        yunariEditorBridge: { editor: { canvas: { renderAll(): void } } };
      }
    ).yunariEditorBridge;
    bridge.editor.canvas.renderAll();
  });
  return Buffer.from(built.bytes);
}

/** Band statistics inside a scene box, on the live canvas, the way
 * `glass-probe.ts` places them: from the object's own device box, never from
 * hand-picked artboard coordinates. */
function bandStats(
  page: Page,
  id: string,
  inset: { left: number; top: number; width: number; height: number },
  blurRadius?: number,
): Promise<{ peak: number; contrast: number; rows: number }> {
  return page.evaluate(
    ([objectId, box, radius]) => {
      type Obj = {
        get(n: string): unknown;
        set(n: string, v: unknown): void;
        getBoundingRect(): {
          left: number;
          top: number;
          width: number;
          height: number;
        };
      };
      const canvas = (
        window as unknown as {
          yunariEditorBridge: {
            editor: {
              canvas: {
                getObjects(): Obj[];
                lowerCanvasEl: HTMLCanvasElement;
                renderAll(): void;
                getRetinaScaling(): number;
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
      ).yunariEditorBridge.editor.canvas;
      const object = canvas
        .getObjects()
        .find((candidate) => candidate.get("id") === objectId);
      if (object === undefined) throw new Error(`no object ${objectId}`);
      // The blur-off control, the way `panelBand` takes one on the player: the
      // treatment stays present, so the panel still composites, and only the
      // radius differs between the two readings.
      if (typeof radius === "number")
        object.set("yunariGlass", { blurRadius: radius });
      canvas.renderAll();
      const rect = object.getBoundingRect();
      const vp = canvas.viewportTransform;
      const retina = canvas.getRetinaScaling();
      const toDevice = (x: number, y: number): readonly [number, number] => [
        (x * vp[0] + y * vp[2] + vp[4]) * retina,
        (x * vp[1] + y * vp[3] + vp[5]) * retina,
      ];
      const [x0, y0] = toDevice(rect.left + box.left, rect.top + box.top);
      const [x1, y1] = toDevice(
        rect.left + box.left + box.width,
        rect.top + box.top + box.height,
      );
      const left = Math.max(0, Math.round(x0));
      const top = Math.max(0, Math.round(y0));
      const width = Math.max(1, Math.round(x1 - x0));
      const height = Math.max(1, Math.round(y1 - y0));
      const element = canvas.lowerCanvasEl;
      const data = element
        .getContext("2d")!
        .getImageData(left, top, width, height).data;
      const means = new Array<number>(width).fill(0);
      for (let y = 0; y < height; y += 1)
        for (let x = 0; x < width; x += 1) {
          const i = (y * width + x) * 4;
          means[x]! +=
            0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
        }
      for (let x = 0; x < width; x += 1) means[x]! /= height;
      let peak = 0;
      for (let x = 1; x < width; x += 1)
        peak = Math.max(peak, Math.abs(means[x]! - means[x - 1]!));
      return {
        peak: Math.round(peak * 100) / 100,
        contrast:
          Math.round((Math.max(...means) - Math.min(...means)) * 100) / 100,
        rows: height,
      };
    },
    [id, inset, blurRadius] as const,
  );
}

/**
 * The starter's own media layer, decoded.
 *
 * The bytes land after the first paint and the glass samples whatever the
 * `<img>` held at its last repaint, so a reading taken before the decode is a
 * reading of an empty backdrop. `naturalWidth` is read *and* the element is
 * required to be complete, so a broken or absent layer fails here rather than
 * quietly producing a flat band below.
 */
async function waitForStarterBackdrop(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const image = document.querySelector<HTMLImageElement>(
        "[data-yunari-background-media] img",
      );
      return (
        image !== null &&
        image.complete &&
        image.naturalWidth > 0 &&
        image.naturalHeight > 0
      );
    },
    undefined,
    { timeout: 20_000 },
  );
  // One more frame: the decode fires `onFrame`, which repaints the canvas the
  // band is read from.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

test.describe("the reference composition, captured", () => {
  test("the capture path shows the glass and the packaged assets, and changes nothing", async ({
    page,
  }, testInfo) => {
    desktop(testInfo);
    await openCaptureFixture(page);

    const before = await sceneFacts(page);
    const glass = await bandStats(page, "glass", {
      left: 20,
      top: 14,
      width: 200,
      height: 20,
    });
    const badge = await bandStats(page, "badge", {
      left: 0,
      top: 0,
      width: 128,
      height: 40,
    });

    const capture = await captureOf(page);

    // **The glass is in the picture, and it is really blurred.** A flat wash
    // over an empty canvas also scores a low gradient, so the contrast floor
    // is the second half: the panel has to be carrying backdrop detail.
    expect(glass.rows, "the band covers rows").toBeGreaterThan(8);
    expect(glass.contrast, "the panel carries backdrop detail").toBeGreaterThan(
      8,
    );
    expect(
      glass.peak,
      "the backdrop is softened, not merely tinted",
    ).toBeLessThan(40);

    // **The packaged asset is in the picture.** A 64/64 black-white SVG split:
    // anything but a flat fill has a real step in it.
    expect(
      badge.contrast,
      "the packaged SVG has two tones in the capture",
    ).toBeGreaterThan(100);
    expect(capture.transparent, "the capture is a real picture").toBeLessThan(
      1,
    );
    expect(capture.width).toBeGreaterThan(100);

    // **And the capture changed nothing.** A thumbnail is a read of the
    // document, not an edit of it.
    const after = await sceneFacts(page);
    expect(after).toEqual(before);

    // **The picture itself, looked at.** The capture is a data URL rather than
    // a file, so it is shown at 2x on a dark ground — the library card's own
    // conditions — and the screenshot is taken of that. Registered in
    // `docs/evidence/screenshots/README.md` and inspected before it is kept.
    expect(capture.png.length).toBeGreaterThan(1000);
    // **The paint is read before it is written into CSS** (`vg-451`). A palette
    // entry that is renamed or absent would interpolate as `undefined`, which
    // the browser drops as an invalid declaration — the page falls back to
    // white and every assertion below still passes, because the screenshot is a
    // review rather than a golden file. `shell-tokens.ts`'s `themeToken` throws
    // on the same vacuity where the value comes from a stylesheet; this is the
    // one place it comes from a product module, so the guard sits here.
    const backdrop = solidOf.background;
    expect(backdrop, "the palette names a solid background").toMatch(/^\S+$/);
    await page.setContent(
      `<body style="margin:0;background:${backdrop};display:flex;align-items:center;justify-content:center;height:100vh">` +
        `<img src="${capture.png}" style="image-rendering:pixelated;transform:scale(2);transform-origin:center">` +
        `</body>`,
    );
    await expect(page.locator("img")).toBeVisible();
    await captureVisualReview(page, testInfo, "editor-reference-capture");
  });

  test("the capture carries a theme's background media", async ({
    page,
  }, testInfo) => {
    desktop(testInfo);
    // **The gap this pins is closed** (`thumbnail-capture.ts` composites the
    // media through `BackdropMedia.paint`, 0007), so the marker is gone and the
    // requirement is asserted. Background media is still a DOM sibling below
    // the canvas; the capture now draws it underneath the scene it re-renders,
    // rather than relying on Fabric to see it.
    await openCaptureFixture(page);
    const layer = await page.evaluate(() => {
      const element = document.querySelector<HTMLImageElement>(
        "[data-yunari-background-media] img",
      );
      return element === null
        ? null
        : { width: element.naturalWidth, height: element.naturalHeight };
    });
    expect(layer, "the media layer has pixels").not.toBeNull();
    // **Measured where it matters, on the product's own capture.** The
    // whole-canvas fraction is too blunt: the panels already cover most of the
    // ink, so a threshold loose enough to be about the media also passes
    // without it. This counts only the pixels *inside the artboard*, and then
    // only its middle half, which the backdrop covers whenever it reached the
    // capture — `object-fit: cover` on the theme's own box covers the board
    // whole, so nothing here is a letterbox. Measured: 0.81 of the artboard
    // empty before the capture composited the media, and 0.24 after.
    const inside = await artboardTransparencyOfCapture(page, [
      GLASS_ENVELOPE.artboard.width,
      GLASS_ENVELOPE.artboard.height,
    ]);
    expect(inside.w, "the artboard is inside the capture").toBeGreaterThan(50);
    expect(inside.coreClear, "the media is in the capture").toBeLessThan(0.02);
  });

  test("text above a glass panel stays sharp through a real mount", async ({
    page,
  }, testInfo) => {
    desktop(testInfo);
    await openCaptureFixture(page);

    // **The inherited half of Task 4.** Its container had no usable font, so
    // "FROST" rendered as a placeholder dash and the claim could not be
    // measured. It can now: `Segoe UI` resolves to a real face (measured
    // widths differ per family in this Chromium), and the text below is a
    // 40px run that occupies real columns.
    //
    // The measure is **the width of the glyph's own edge**, in device pixels.
    // The control is the same text in the same place over the same media with
    // the blur set to zero.
    //
    // **It is a width and not a magnitude because the subtraction does not
    // cancel the backdrop**, which this file claimed it did until `vg-151` was
    // chased down. The text is composited *over* the panel, so the difference
    // between the two frames retains a term in the panel's own pixels — measured
    // directly: across a glyph edge the difference row *rises* in step with the
    // backdrop darkening under it. An amplitude therefore reads the panel as
    // much as the glyph, and a width does not: a hard edge crosses 10%-to-90% in
    // about a pixel whatever the backdrop is doing behind it.
    const reading = await page.evaluate(() => {
      type Obj = {
        get(n: string): unknown;
        set(n: string, v: unknown): void;
        getBoundingRect(): {
          left: number;
          top: number;
          width: number;
          height: number;
        };
      };
      const canvas = (
        window as unknown as {
          yunariEditorBridge: {
            editor: {
              canvas: {
                getObjects(): Obj[];
                lowerCanvasEl: HTMLCanvasElement;
                renderAll(): void;
                getRetinaScaling(): number;
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
      ).yunariEditorBridge.editor.canvas;
      const objects = canvas.getObjects();
      const find = (id: string): Obj | undefined =>
        objects.find((object) => object.get("id") === id);
      const glass = find("glass");
      const text = find("over-glass");
      if (glass === undefined || text === undefined)
        throw new Error("the fixture lost its panel or its text");
      const element = canvas.lowerCanvasEl;
      const vp = canvas.viewportTransform;
      const retina = canvas.getRetinaScaling();
      const rect = text.getBoundingRect();
      const left = Math.round(
        (rect.left * vp[0] + rect.top * vp[2] + vp[4]) * retina,
      );
      const top = Math.round(
        (rect.left * vp[1] + rect.top * vp[3] + vp[5]) * retina,
      );
      const width = Math.max(1, Math.round(rect.width * vp[0] * retina));
      const height = Math.max(1, Math.round(rect.height * vp[0] * retina));
      const context = element.getContext("2d")!;

      // **How wide the glyph's own edge is, in device pixels**, taken as the
      // median over the rows the glyph occupies of that row's sharpest 10%-to-90%
      // transition. It replaces a `max adjacent step / row range` score, which
      // was a single-pixel extremum: one anomalous pixel moved it 20%, and
      // `vg-151` spent two months reading that as the panel softening the text.
      //
      // Device pixels are the right unit and a scene unit would not be. An
      // antialiased edge occupies about one device pixel whatever the zoom, so
      // "the edge is ~1 pixel wide" is a camera-independent claim about the
      // render, while the same statement in scene units would move with the fit
      // zoom — which is the class `vg-136` named.
      const glyphEdgeWidth = (): number => {
        const grab = (): Uint8ClampedArray =>
          context.getImageData(left, top, width, height).data.slice();
        canvas.renderAll();
        const withText = grab();
        const visible = text.get("visible");
        text.set("visible", false);
        canvas.renderAll();
        const without = grab();
        text.set("visible", visible);
        canvas.renderAll();
        const luma = (d: Uint8ClampedArray, i: number): number =>
          0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
        const widths: number[] = [];
        for (let y = 0; y < height; y += 1) {
          const diff = new Array<number>(width);
          for (let x = 0; x < width; x += 1) {
            const i = (y * width + x) * 4;
            diff[x] = luma(withText, i) - luma(without, i);
          }
          const min = Math.min(...diff);
          const range = Math.max(...diff) - min;
          // A row the glyph does not cross has no edge to measure.
          if (range < 40) continue;
          const n = diff.map((value) => (value - min) / range);
          let low = -1;
          let shortest = Number.POSITIVE_INFINITY;
          for (let x = 0; x < width; x += 1) {
            const value = n[x]!;
            // Track the last pixel at or below 10%, then measure to the first at
            // or above 90%. A hard edge crosses both in one step; a blurred one
            // walks there over as many pixels as the radius.
            if (value <= 0.1) low = x;
            else if (value >= 0.9 && low >= 0) {
              shortest = Math.min(shortest, x - low);
              low = -1;
            }
          }
          if (shortest !== Number.POSITIVE_INFINITY) widths.push(shortest);
        }
        if (widths.length === 0) return Number.POSITIVE_INFINITY;
        widths.sort((a, b) => a - b);
        return widths[Math.floor(widths.length / 2)]!;
      };

      glass.set("yunariGlass", { blurRadius: 16 });
      const blurred = glyphEdgeWidth();
      glass.set("yunariGlass", { blurRadius: 0 });
      const control = glyphEdgeWidth();
      glass.set("yunariGlass", { blurRadius: 16 });
      const occupied = context
        .getImageData(left, top, width, height)
        .data.some((_, index) => index % 4 === 3 && _ > 0);
      return {
        blurred,
        control,
        width,
        height,
        occupied,
        sceneWidth: rect.width,
        sceneHeight: rect.height,
        scale: vp[0] * retina,
      };
    });

    // Non-vacuous: the band really is a text run and not an empty box.
    //
    // **In scene units, not device rows.** `width` and `height` are the band as
    // the canvas is currently scaled, so a floor written in them is a floor on
    // the camera: 20 rows was a 40px run at Fit's 0.78 and the same run is 14
    // rows at the display lens's 0.48, which is a stale constant reading as a
    // product failure. Whether the band is a text run is a fact about the
    // document, so it is asserted there; and the device band is then held to
    // the transform, which is what makes the pixel read mean this run.
    expect(reading.sceneWidth).toBeGreaterThan(100);
    expect(reading.sceneHeight).toBeGreaterThan(20);
    expect(
      Math.abs(reading.width - reading.sceneWidth * reading.scale),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(reading.height - reading.sceneHeight * reading.scale),
    ).toBeLessThanOrEqual(1);
    expect(reading.occupied).toBe(true);
    // **Measured, not chosen.** Over the blurred panel the edge is 2 device
    // pixels wide and over the sharp one it is also 2, at this fixture's 0.71
    // scale — the glyph is untouched by the panel's blur. 3 is a ceiling on
    // "about a pixel", not a tuned tolerance.
    //
    // **And the instrument is not blind**, which is the only thing that makes
    // reading 2 mean anything: giving `over-glass` a `ctx.filter` blur of its
    // own takes this same measure to 30 at `blur(1px)` and past the row floor
    // above that, so a genuinely diffused glyph fails here by a factor of ten.
    // Probed by hand when this metric landed rather than left in the test —
    // a permanent sabotage would be a second copy of the fixture's own job.
    expect(
      reading.blurred,
      "the glyph's own edge is a pixel-scale transition, not a diffused one",
    ).toBeLessThanOrEqual(3);
    expect(
      reading.control,
      "the control's edge is measured the same way",
    ).toBeLessThanOrEqual(3);
    // And the panel's own blur is real in the same frame, so the blurred side
    // is not vacuously sharp because nothing was blurred.
    const band = await bandStats(page, "glass", {
      left: 20,
      top: 14,
      width: 200,
      height: 20,
    });
    expect(band.peak, "the backdrop under the panel is softened").toBeLessThan(
      40,
    );
    // The claim the test is named for, and the one `vg-151` was filed against:
    // the panel's blur does not widen the glyph's edge. One device pixel of
    // slack, because the transition is quantised to whole pixels and a
    // half-pixel of antialiasing either way is not a softness.
    expect(
      Math.abs(reading.blurred - reading.control),
      "text over the blurred panel is as sharp as text over the sharp one",
    ).toBeLessThanOrEqual(1);
  });
  test("the starter's frosted card reads a real backdrop, and the canvas is untainted", async ({
    page,
  }, testInfo) => {
    desktop(testInfo);
    await openEditor(page);
    await waitForStarterBackdrop(page);

    // **The claim the default capture never made.** Every frosted panel in the
    // starter used to sit over a three-stop vertical gradient, whose mean luma
    // step between adjacent columns measures 0.00 — a blur had nothing to
    // reveal, so the panel was an even fill however wide the radius was. The
    // starter now carries a packaged photograph, and this measures the change
    // in the mounted editor rather than in the source file.
    //
    // Measured on this machine, at this mount's 0.3744 camera, and quoted in
    // every threshold below. Re-measured 2026-10-04 with the card's parent
    // group kept out of the probe's hide; every figure below is from that run,
    // and the two before it are from the run that read the panel while it was
    // not on the canvas at all:
    //   the photograph itself, read with no product code in the path
    //                                              contrast 7.65, mean luma 111.8
    //   the same backdrop under a clear fill       contrast 7.43 sharp / 1.50 blurred
    //   as authored, over `palette.frost`            contrast 1.07
    //
    // **`getImageData` is the right surface here and the backdrop is in it.**
    // The media is a DOM sibling *below* the canvas, so a bare canvas read
    // cannot see it — but the glass panel composites it into the canvas itself
    // (`glass.ts` paints the media into its own scratch surface and draws that
    // back through the panel's clip), so a band *inside the panel* reads the
    // photograph through `getImageData` exactly as the screen shows it. Both
    // routes were measured side by side against a Playwright screenshot of the
    // canvas element — which composites the DOM layer for us — and they agree to
    // the second decimal: 7.43 / 1.50 / 1.07 on both. The screenshot route was
    // not adopted; it costs ~300 ms a reading and buys nothing here.
    //
    // What *did* read 7.58 with no panel involved was the probe hiding
    // `group-cpu-card` along with the card's own parts — see `starterBackdropBands`.
    const reading = await starterBackdropBands(page);

    // **The panel blurs the photograph, at this mount's scale.** The band is
    // a rectangle in artboard units and `object-fit: cover` puts the whole
    // file over the artboard, so the band addresses one rectangle of the
    // photograph — and the backdrop under the panel must measure what that
    // rectangle measures. This is the assertion 0012 exists for: before the
    // fix the sampler took a pixel-for-pixel crop of the middle of the file
    // sized by the device rect, which at a 0.3744 camera is the middle 26.9 %
    // of the photograph where the element shows all of it, and this read
    // **16.54** against the 7.45 below.
    expect(
      reading.photo,
      "the photograph was read as a control",
    ).not.toBeNull();
    expect(
      Math.abs(reading.clearSharp.contrast - reading.photo!.contrast),
      `the panel's backdrop is the photograph (panel ${reading.clearSharp.contrast} vs photo ${reading.photo!.contrast})`,
    ).toBeLessThan(reading.photo!.contrast * 0.15);
    // And the level, not only the range: a band from the right part of the
    // file at the wrong zoom can match a range by accident; the mean luma is
    // the second, independent reading of "where in the photograph".
    expect(
      Math.abs(reading.clearSharp.meanLuma - reading.photo!.meanLuma),
      "and it is the same part of the photograph, not merely a similar range",
    ).toBeLessThan(reading.photo!.meanLuma * 0.08);

    // **The material reads.** The panel's contrast is the fraction of the
    // blurred backdrop its own fill leaves through: the authored fill is
    // `#0815234d`, 30 % opaque, so 1.50 x 0.71 = 1.07 — which is what it
    // measures, to the second decimal.
    //
    // **What this floor does and does not separate.** The gradient the
    // photograph replaced measures **0.00**, so it cannot pass at any scale —
    // that is the discrimination being claimed.
    expect(reading.blurred.rows, "the band covers rows").toBeGreaterThan(20);

    // **The material under the panel is the photograph, diffused hard.** With
    // the card's 40 artboard units — a 15 px kernel at this mount's 0.3744
    // camera — the backdrop's range falls 7.43 -> 1.50, a **5.0x** drop, and
    // its column-to-column step 0.74 -> 0.23. Both are read on the range and
    // the step rather than on either alone, because a kernel that wide
    // flattens high frequencies for any backdrop and keeps the low ones.
    expect(
      reading.clearSharp.contrast / reading.clearBlurred.contrast,
      `the sampled backdrop is genuinely diffused (${reading.clearSharp.contrast} sharp against ${reading.clearBlurred.contrast} blurred)`,
    ).toBeGreaterThan(3);
    // And it is diffusion, not erasure: a fifth of the range survives, where a
    // panel that merely tinted its backdrop would leave all of it.
    expect(
      reading.clearBlurred.contrast,
      "the blur diffuses the backdrop rather than erasing it",
    ).toBeGreaterThan(reading.clearSharp.contrast * 0.15);

    // **The authored panel is that backdrop through a 30 % tint**, so it reads
    // 1.07 against the 1.50 the clear fill leaves — the photograph is still
    // *visible through the glass*, which is the whole claim. The even gradient
    // this replaced measures 0.00 at every radius, so 0.6 is a floor with margin
    // and is unreachable by a fill.
    expect(
      reading.blurred.contrast,
      "the frosted panel carries backdrop structure, not an even fill",
    ).toBeGreaterThan(0.6);

    // **Text and the chart's stroke stay sharp above the glass.** The measure
    // is the glyph band alone: the frame with the object minus the frame
    // without it, whose best one-pixel-transition-over-range ratio is near 1
    // for a sharp edge and near 1/16 for one spread across the blur. The
    // starter's one frosted panel carries a line chart rather than a gauge, so
    // the gauge-stroke half of this claim is the fixture's test above; what is
    // new here is that the foreground has to survive a *photographic* backdrop.
    expect(
      reading.glyphs.blurred,
      "the card's title keeps one-pixel edges over the blurred panel",
    ).toBeGreaterThan(0.6);
    expect(
      reading.glyphs.blurred,
      "and is as sharp as the same title over the unblurred one",
    ).toBeGreaterThan(reading.glyphs.control * 0.85);
    expect(
      reading.glyphs.stroke,
      "the sparkline's stroke stays sharp above the blurred panel",
    ).toBeGreaterThan(0.6);

    // **Taint, stated rather than implied.** `drawImage` tolerates a tainted
    // canvas, so a composite that looks right proves nothing about the two
    // paths that read pixels back: `getImageData` and `toDataURL` both throw a
    // `SecurityError` on one, and both are load-bearing — the glass budget,
    // this very probe, and the thumbnail. A cross-origin backdrop would pass
    // every assertion above and fail both of these.
    expect(reading.taint.read, "the canvas is not tainted").toBe("pixels");
    expect(reading.dataUrl, "and the capture path encodes it").toBeGreaterThan(
      10_000,
    );

    // **And the reading on the frosted card is still a reading.** The card
    // transmits now, so its field is a photograph through a 30 % tint rather
    // than a near black panel — which is the point, and which is also what put
    // the muted grey token below AA. `underCpu` is the WCAG relative luminance
    // of that field with the caption hidden; `#ecf5ff` is 0.904, and 4.5:1
    // needs the field at or under 0.162. It measures 0.135 here — 5.1:1 —
    // and the tint is what puts it there: at 18 % the same field reads 0.1874
    // and the caption falls to 4.02:1.
    const whiteOn = (field: number): number => (0.904 + 0.05) / (field + 0.05);
    expect(
      whiteOn(reading.underCpu),
      `the frosted card's caption reads at AA (field ${reading.underCpu})`,
    ).toBeGreaterThan(4.5);
    // The opaque card beside it is unchanged by any of this, and is the control
    // that says the frosted one is the outlier rather than the rule: a glass
    // that has to tint itself dark to carry white text is a panel, not glass.
    expect(
      whiteOn(reading.underGpu),
      "and the opaque card is no worse",
    ).toBeGreaterThan(whiteOn(reading.underCpu));

    // The picture itself, looked at. Registered in
    // `docs/evidence/screenshots/README.md` and inspected before it is kept.
    await captureVisualReview(page, testInfo, "editor-starter-backdrop");
  });
});

/**
 * The starter's one frosted card, read twice, with its own contents taken out
 * of the picture.
 *
 * **Why the contents are hidden.** `cpu-card` has no empty region: the icon,
 * the title, the 90px reading, the caption and the sparkline cover it, and a
 * band that crosses a glyph edge measures that edge — identically in both
 * readings, which is exactly the failure the first version of this probe hit
 * (peak 27.82 -> 27.82 with a 56.06 contrast: real backdrop, and a hard number
 * belonging to the title). Hiding them is the same subtraction the sharp-text
 * probe makes, and the difference is only the backdrop and the panel's own
 * tint.
 *
 * **The control is the blur, not the card.** `blurRadius: 0` leaves the
 * treatment present, so the panel still composites and only the radius differs.
 * Both readings are taken here, in one call, so the second cannot inherit the
 * first's radius by accident — which is how the first version read the same
 * number twice.
 */
function starterBackdropBands(page: Page): Promise<{
  blurred: { peak: number; contrast: number; rows: number; meanLuma: number };
  sharp: { peak: number; contrast: number; rows: number; meanLuma: number };
  clearBlurred: {
    peak: number;
    contrast: number;
    rows: number;
    meanLuma: number;
  };
  clearSharp: {
    peak: number;
    contrast: number;
    rows: number;
    meanLuma: number;
  };
  photo: {
    columns: number;
    peak: number;
    contrast: number;
    meanLuma: number;
  } | null;
  glyphs: { blurred: number; control: number; stroke: number };
  taint: { read: string };
  dataUrl: number;
  underCpu: number;
  underGpu: number;
}> {
  return page.evaluate(() => {
    type Obj = {
      get(n: string): unknown;
      set(n: string, v: unknown): void;
      getObjects?(): Obj[];
      getBoundingRect(): {
        left: number;
        top: number;
        width: number;
        height: number;
      };
    };
    const canvas = (
      window as unknown as {
        yunariEditorBridge: {
          editor: {
            canvas: {
              getObjects(): Obj[];
              lowerCanvasEl: HTMLCanvasElement;
              renderAll(): void;
              getRetinaScaling(): number;
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
    ).yunariEditorBridge.editor.canvas;
    // Groups descended: the frosted panel is a part of the CPU card, and a
    // search of the root list said the starter had lost it.
    const find = (objects: readonly Obj[]): Obj | undefined => {
      for (const candidate of objects) {
        if (candidate.get("id") === "cpu-card") return candidate;
        const found = find(candidate.getObjects?.() ?? []);
        if (found !== undefined) return found;
      }
      return undefined;
    };
    const card = find(canvas.getObjects());
    if (card === undefined)
      throw new Error("the starter lost its frosted card");
    const box = card.getBoundingRect();
    const centreInside = (object: Obj): boolean => {
      const rect = object.getBoundingRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      return (
        cx > box.left &&
        cx < box.left + box.width &&
        cy > box.top &&
        cy < box.top + box.height
      );
    };
    // The card's own parts are hidden along with it, so this walks the whole
    // document rather than the root list the previous `objects` held.
    const every: { object: Obj; parents: readonly Obj[] }[] = [];
    const collect = (
      list: ReadonlyArray<Obj & { getObjects?: () => readonly Obj[] }>,
      parents: readonly Obj[],
    ): void => {
      for (const entry of list) {
        every.push({ object: entry, parents });
        collect(entry.getObjects?.() ?? [], [...parents, entry]);
      }
    };
    collect(canvas.getObjects(), []);
    // **`cpu-card` is a part of `group-cpu-card`, and the group is not one of
    // its contents.** Hiding what the filter called "inside the card" therefore
    // hid the card's own parent, which took the panel off the canvas with it —
    // and a band over a card that is not there reads the photograph *behind* it
    // unblurred and untinted, whatever radius and fill were authored. Measured:
    // `clearSharp` and `clearBlurred` read identically at 7.58 and the authored
    // fill moved nothing, which is the shape of a measurement whose subject was
    // never on screen. With the ancestor kept, the same three readings are
    // 7.43 / 1.50 / 1.07 — the numbers this file's header has always quoted. An
    // ancestor is excluded by identity, because the only other test — a box
    // test — admits the card itself.
    const ancestors = new Set<Obj>();
    for (const entry of every)
      if (entry.object === card)
        for (const parent of entry.parents) ancestors.add(parent);
    const hidden = every
      .filter(
        (entry) =>
          entry.object !== card &&
          !ancestors.has(entry.object) &&
          centreInside(entry.object),
      )
      .map((entry) => entry.object);
    const restore = hidden.map(
      (object) => [object, object.get("visible")] as const,
    );

    const vp = canvas.viewportTransform;
    const retina = canvas.getRetinaScaling();
    const toDevice = (x: number, y: number): readonly [number, number] => [
      (x * vp[0]! + y * vp[2]! + vp[4]!) * retina,
      (x * vp[1]! + y * vp[3]! + vp[5]!) * retina,
    ];
    // A quarter of the shorter side in, so the band clears the rounded corners.
    const inset = Math.round(Math.min(box.width, box.height) / 4);
    const [x0, y0] = toDevice(box.left + inset, box.top + inset);
    const [x1, y1] = toDevice(
      box.left + box.width - inset,
      box.top + box.height - inset,
    );
    const left = Math.max(0, Math.round(x0));
    const top = Math.max(0, Math.round(y0));
    const width = Math.max(1, Math.round(x1 - x0));
    const height = Math.max(1, Math.round(y1 - y0));

    const measure = (): {
      peak: number;
      contrast: number;
      rows: number;
      meanLuma: number;
    } => {
      canvas.renderAll();
      const data = canvas.lowerCanvasEl
        .getContext("2d")!
        .getImageData(left, top, width, height).data;
      const means = new Array<number>(width).fill(0);
      for (let y = 0; y < height; y += 1)
        for (let x = 0; x < width; x += 1) {
          const i = (y * width + x) * 4;
          means[x]! +=
            0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
        }
      for (let x = 0; x < width; x += 1) means[x]! /= height;
      let peak = 0;
      for (let x = 1; x < width; x += 1)
        peak = Math.max(peak, Math.abs(means[x]! - means[x - 1]!));
      return {
        peak: Math.round(peak * 100) / 100,
        contrast:
          Math.round((Math.max(...means) - Math.min(...means)) * 100) / 100,
        rows: height,
        meanLuma:
          Math.round((means.reduce((a, b) => a + b, 0) / width) * 100) / 100,
      };
    };

    for (const object of hidden) object.set("visible", false);
    const authored = card.get("yunariGlass") as { blurRadius: number };
    const authoredFill = card.get("fill") as string;
    card.set("yunariGlass", authored);
    const blurred = measure();
    card.set("yunariGlass", { blurRadius: 0 });
    const sharp = measure();
    card.set("yunariGlass", authored);
    card.set("fill", "rgba(8, 21, 35, 0)");
    card.set("yunariGlass", authored);
    const clearBlurred = measure();
    card.set("yunariGlass", { blurRadius: 0 });
    const clearSharp = measure();
    card.set("fill", authoredFill);
    card.set("yunariGlass", authored);
    for (const [object, visible] of restore) object.set("visible", visible);

    // **Sharpness of what sits above the glass.** The object's own coverage:
    // the frame with it minus the frame without it, which cancels the backdrop
    // however photographic that backdrop is. Best step-over-range over the rows
    // that carry any coverage — near 1 for a one-pixel edge, near 1/16 for one
    // spread across a 16px blur.
    const sharpness = (id: string, radius: number): number => {
      const object = every
        .map((entry) => entry.object)
        .find((candidate) => candidate.get("id") === id);
      if (object === undefined) throw new Error(`the starter lost ${id}`);
      card.set("yunariGlass", { blurRadius: radius });
      const rect = object.getBoundingRect();
      const [gx, gy] = toDevice(rect.left + 6, rect.top + 6);
      const w = Math.max(
        1,
        Math.min(
          canvas.lowerCanvasEl.width,
          Math.round((rect.width - 12) * vp[0]! * retina),
        ),
      );
      const h = Math.max(
        1,
        Math.min(
          canvas.lowerCanvasEl.height,
          Math.round((rect.height - 12) * vp[3]! * retina),
        ),
      );
      const px = Math.max(0, Math.round(gx));
      const py = Math.max(0, Math.round(gy));
      const context = canvas.lowerCanvasEl.getContext("2d")!;
      const grab = (): Uint8ClampedArray =>
        context.getImageData(px, py, w, h).data.slice();
      canvas.renderAll();
      const withObject = grab();
      const was = object.get("visible");
      object.set("visible", false);
      canvas.renderAll();
      const without = grab();
      object.set("visible", was);
      canvas.renderAll();
      const luma = (d: Uint8ClampedArray, i: number): number =>
        0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
      let best = 0;
      for (let y = 0; y < h; y += 1) {
        const diff = new Array<number>(w);
        for (let x = 0; x < w; x += 1) {
          const i = (y * w + x) * 4;
          diff[x] = luma(withObject, i) - luma(without, i);
        }
        const range = Math.max(...diff) - Math.min(...diff);
        // A row with no coverage in it has no edge to measure; 40 is the floor
        // the existing sharp-text probe uses, and a glyph row clears it widely.
        if (range < 40) continue;
        let step = 0;
        for (let x = 1; x < w; x += 1)
          step = Math.max(step, Math.abs(diff[x]! - diff[x - 1]!));
        best = Math.max(best, step / range);
      }
      return Math.round(best * 1000) / 1000;
    };
    const titleBlurred = sharpness("cpu-card-title", authored.blurRadius);
    const titleControl = sharpness("cpu-card-title", 0);
    const stroke = sharpness("cpu-card-sparkline", authored.blurRadius);
    card.set("yunariGlass", authored);
    canvas.renderAll();

    // Text legibility: the field under a label's own box, with the label
    // hidden, on the frosted card and on an opaque one beside it. Read as WCAG
    // **relative luminance** rather than a weighted sRGB mean, because a
    // contrast ratio is defined on the linearised value and averaging first
    // would put the number in the wrong space to divide by.
    const lumaUnder = (id: string): number => {
      const label = every
        .map((entry) => entry.object)
        .find((object) => object.get("id") === id);
      if (label === undefined) throw new Error(`no ${id}`);
      const rect = label.getBoundingRect();
      const [lx, ly] = toDevice(rect.left + 4, rect.top + rect.height / 2 - 2);
      const w = Math.max(1, Math.round((rect.width - 8) * vp[0]! * retina));
      const h = Math.max(1, Math.round(4 * vp[3]! * retina));
      const was = label.get("visible");
      label.set("visible", false);
      canvas.renderAll();
      const data = canvas.lowerCanvasEl
        .getContext("2d")!
        .getImageData(
          Math.max(0, Math.round(lx)),
          Math.max(0, Math.round(ly)),
          w,
          h,
        ).data;
      label.set("visible", was);
      canvas.renderAll();
      const channel = (value: number): number => {
        const s = value / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      let sum = 0;
      for (let i = 0; i < data.length; i += 4)
        sum +=
          0.2126 * channel(data[i]!) +
          0.7152 * channel(data[i + 1]!) +
          0.0722 * channel(data[i + 2]!);
      return Math.round((sum / (data.length / 4)) * 10_000) / 10_000;
    };
    const underCpu = lumaUnder("cpu-card-caption");
    const underGpu = lumaUnder("gpu-card-caption");
    canvas.renderAll();

    // **The photograph itself, with no product code in the path.** The band is
    // a rectangle in *artboard* units, and `object-fit: cover` puts the whole
    // file over the artboard, so the band's source rectangle is its own scene
    // fraction of the file. Read at this mount's own column count, because the
    // count is what decides how much of the file each column averages.
    //
    // This is the control that makes the rest of the reading mean something:
    // it says what is *behind the panel*, independently of anything Yunari
    // does. Before 0012 the sampler took a pixel-for-pixel crop of the middle
    // of the file sized by the device rect, so at this mount's 0.3744 camera
    // it showed the middle 26.9 % of the photograph where the element showed
    // all of it, and read 16.54 of contrast against this 7.45.
    const photo = (() => {
      const image = document.querySelector<HTMLImageElement>(
        "[data-yunari-background-media] img",
      );
      if (image === null || !image.complete || image.naturalWidth === 0) {
        return null;
      }
      // The artboard's own size, from the media element's cover box, which is
      // what `setBounds` laid the layer over.
      const artboardWidth = 1672;
      const artboardHeight = 941;
      const u0 = (box.left + inset) / artboardWidth;
      const u1 = (box.left + box.width - inset) / artboardWidth;
      const v0 = (box.top + inset) / artboardHeight;
      const v1 = (box.top + box.height - inset) / artboardHeight;
      const columns = width;
      const rows = Math.max(
        2,
        Math.round(
          (columns * ((v1 - v0) * artboardHeight)) /
            ((u1 - u0) * artboardWidth),
        ),
      );
      const probe = document.createElement("canvas");
      probe.width = columns;
      probe.height = rows;
      const context = probe.getContext("2d");
      if (context === null) return null;
      context.drawImage(
        image,
        u0 * image.naturalWidth,
        v0 * image.naturalHeight,
        (u1 - u0) * image.naturalWidth,
        (v1 - v0) * image.naturalHeight,
        0,
        0,
        columns,
        rows,
      );
      const data = context.getImageData(0, 0, columns, rows).data;
      const means = new Array<number>(columns).fill(0);
      for (let y = 0; y < rows; y += 1)
        for (let x = 0; x < columns; x += 1) {
          const i = (y * columns + x) * 4;
          means[x]! +=
            0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
        }
      for (let x = 0; x < columns; x += 1) means[x]! /= rows;
      let peak = 0;
      for (let x = 1; x < columns; x += 1)
        peak = Math.max(peak, Math.abs(means[x]! - means[x - 1]!));
      return {
        columns,
        peak: Math.round(peak * 100) / 100,
        contrast:
          Math.round((Math.max(...means) - Math.min(...means)) * 100) / 100,
        meanLuma:
          Math.round((means.reduce((a, b) => a + b, 0) / columns) * 100) / 100,
      };
    })();

    // **Taint, stated rather than implied.** `drawImage` tolerates a tainted
    // canvas, so a composite that looks right proves nothing about the two
    // paths that read pixels back: `getImageData` and `toDataURL` both throw a
    // `SecurityError` on one, and both are load-bearing — the glass budget,
    // this very probe, and the thumbnail.
    let read = "pixels";
    let dataUrl = 0;
    try {
      canvas.lowerCanvasEl.getContext("2d")!.getImageData(left, top, 1, 1);
      dataUrl = canvas.lowerCanvasEl.toDataURL().length;
    } catch (error) {
      read = `threw: ${String(error)}`;
    }
    return {
      blurred,
      sharp,
      clearBlurred,
      clearSharp,
      photo,
      glyphs: { blurred: titleBlurred, control: titleControl, stroke },
      taint: { read },
      dataUrl,
      underCpu,
      underGpu,
    };
  });
}

test.describe("the reference composition, at the sizes it is read at", () => {
  test("the fitted, reference-size and DPR views render the same composition", async ({
    page,
  }, testInfo) => {
    desktop(testInfo);
    await openCaptureFixture(page);

    /** Every object on the canvas, in scene coordinates. */
    const fitted = await sceneFacts(page);
    const zoom = page.locator("[data-yunari-zoom]");
    await expect(zoom).toHaveText(/^\d+%$/);
    expect(fitted.length).toBeGreaterThan(3);

    // **Reference size.** 100% is the artboard's own scale, and this fixture's
    // artboard is 640 wide, so it fits the stage whole.
    await zoom.click();
    await page.getByRole("menuitem", { name: "100 %" }).click();
    await expect(zoom).toHaveText("100%");
    const atReference = await sceneFacts(page);
    // Scene geometry does not move with the camera: the same boxes, rendered
    // at a different scale.
    expect(idsOf(atReference)).toEqual(idsOf(fitted));
    for (const fact of fitted) {
      const again = atReference.find((other) => other.id === fact.id);
      expect(again?.rect, `${fact.id} is the same box at 100%`).toEqual(
        fact.rect,
      );
    }
    // Ink landed: a camera that had lost the scene would still pass the id list.
    const drawn = await page.evaluate(() => {
      const bridge = (
        window as unknown as {
          yunariEditorBridge: {
            editor: {
              canvas: { lowerCanvasEl: HTMLCanvasElement; renderAll(): void };
            };
          };
        }
      ).yunariEditorBridge;
      bridge.editor.canvas.renderAll();
      const element = bridge.editor.canvas.lowerCanvasEl;
      const data = element
        .getContext("2d")!
        .getImageData(0, 0, element.width, element.height).data;
      let ink = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i]! > 8) ink += 1;
      return ink / (data.length / 4);
    });
    expect(drawn, "the artboard is painted at reference size").toBeGreaterThan(
      0.01,
    );

    // **A device-pixel view.** A real DPR change through the browser's own
    // emulation, so `devicePixelRatio` and the canvas's retina scaling move
    // together — which is what makes text sharp rather than merely larger.
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 900,
      deviceScaleFactor: 2,
      mobile: false,
    });
    await page.waitForTimeout(500);
    const dpr = await page.evaluate(() => {
      const bridge = (
        window as unknown as {
          yunariEditorBridge: {
            editor: {
              canvas: {
                lowerCanvasEl: HTMLCanvasElement;
                renderAll(): void;
                getRetinaScaling(): number;
              };
            };
          };
        }
      ).yunariEditorBridge;
      bridge.editor.canvas.renderAll();
      const element = bridge.editor.canvas.lowerCanvasEl;
      return {
        ratio: window.devicePixelRatio,
        retina: bridge.editor.canvas.getRetinaScaling(),
        backing: element.width,
        css: element.getBoundingClientRect().width,
      };
    });
    expect(dpr.ratio, "the browser really is at two device pixels").toBe(2);
    // The editor's Fabric canvas is *not* device-scaled: `retina` stays 1 and
    // the backing store tracks the CSS box. Recorded rather than required,
    // because the display surface is the player and this file does not own that
    // decision; the numbers are here so the report can state it rather than
    // guess it.
    // The same document, at a different resolution, and still painted.
    expect(idsOf(await sceneFacts(page))).toEqual(idsOf(fitted));
    const stillPainted = await page.evaluate(() => {
      const bridge = (
        window as unknown as {
          yunariEditorBridge: {
            editor: {
              canvas: { lowerCanvasEl: HTMLCanvasElement; renderAll(): void };
            };
          };
        }
      ).yunariEditorBridge;
      bridge.editor.canvas.renderAll();
      const element = bridge.editor.canvas.lowerCanvasEl;
      const data = element
        .getContext("2d")!
        .getImageData(0, 0, element.width, element.height).data;
      let ink = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i]! > 8) ink += 1;
      return ink / (data.length / 4);
    });
    expect(
      stillPainted,
      "the artboard is painted at two device pixels",
    ).toBeGreaterThan(0.01);
    await captureVisualReview(page, testInfo, "editor-reference-dpr2");
    await session.send("Emulation.clearDeviceMetricsOverride");
  });

  test("rotated and overlapping panels both keep compositing", async ({
    page,
  }, testInfo) => {
    desktop(testInfo);
    await openCaptureFixture(page);

    // **Rotated.** A treatment is a property, not a promise that the panel is
    // axis-aligned. A band placed from the panel's own unrotated box would miss
    // it after a 30° turn, so the box itself is asserted first: had the angle
    // not taken, the rest of this test would quietly measure an upright panel.
    await setAngle(page, "glass", 30);
    const turned = (await sceneFacts(page)).find((f) => f.id === "glass");
    expect(turned?.rect.width).toBeGreaterThan(FIXTURE_GLASS_BOX.width);
    expect(turned?.rect.height).toBeGreaterThan(FIXTURE_GLASS_BOX.height);
    // The treatment survived the turn.
    expect(turned?.glass).toEqual({ blurRadius: 16 });
    await setAngle(page, "glass", 0);

    // **Overlapping.** A second treated panel on top of the first, authored
    // through the product's own control rather than placed by the test.
    const centre = await clientOfScene(
      page,
      "authoring",
      GLASS_ENVELOPE.artboard.width,
    );
    await page.mouse.click(centre.x, centre.y);
    await expect.poll(() => activeId(page)).toBe("authoring");
    const toggle = page.locator("[data-yunari-glass-enabled]");
    await toggle.focus();
    await page.keyboard.press("Space");
    await expect(toggle).toBeChecked();
    await typeIntoControl(page, page.locator("[data-yunari-glass-blur]"), "12");

    const treated = (await sceneFacts(page))
      .filter((fact) => fact.glass !== null)
      .map((fact) => fact.id)
      .sort();
    expect(treated, "two panels now carry a treatment").toEqual([
      "authoring",
      "glass",
    ]);
    // And the panel behind the new one is still compositing, not overwritten.
    const behind = await bandStats(page, "glass", {
      left: 20,
      top: 14,
      width: 200,
      height: 20,
    });
    expect(behind.rows).toBeGreaterThan(8);
    expect(behind.peak, "the panel behind still composites").toBeLessThan(40);

    await captureVisualReview(page, testInfo, "editor-reference-overlap");
  });
});

/** The fixture's own glass panel box, so a turn reads as a turn and not a
 * resize. Measured on the built bundle, not copied from the fixture. */
const FIXTURE_GLASS_BOX = { width: 242, height: 162 } as const;

async function setAngle(page: Page, id: string, angle: number): Promise<void> {
  await page.evaluate(
    ([objectId, degrees]) => {
      const bridge = (
        window as unknown as {
          yunariEditorBridge: {
            editor: {
              canvas: {
                getObjects(): Array<{
                  get(n: string): unknown;
                  set(n: string, v: unknown): void;
                }>;
                renderAll(): void;
              };
            };
          };
        }
      ).yunariEditorBridge;
      bridge.editor.canvas
        .getObjects()
        .find((object) => object.get("id") === objectId)
        ?.set("angle", degrees);
      bridge.editor.canvas.renderAll();
    },
    [id, angle] as const,
  );
}

/** A real 16x16 PNG: the same bytes the editor's own suite imports, so this
 * fixture does not have to be right about PNG. */
const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAABmJLR0QA/wD/AP+gvaeTAAAAIklEQVQ4jWNk2HHzPwMVARM1DRs1cNTAUQNHDRw1cCgZCAC1HQK4IWYK+QAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("background media", () => {
  test("a new background image is imported, and the artboard is repointed at it", async ({
    page,
  }, testInfo) => {
    desktop(testInfo);
    // **What the product actually offers, named.** The Add pane's file section
    // *Replace* acts on the chosen declaration, not necessarily the asset the
    // artboard names, so there is no control that swaps a background's bytes in
    // place without first choosing that declaration. What an author does
    // instead is import the new image and repoint the artboard at it, and that
    // is the path proved here. Finding for the report: no replace-bytes control
    // aimed at a background asset; the id allocator also suffixes a repeated
    // filename, so the old declaration cannot be reused.
    await openEditor(page);

    await openPane(page, "Add");
    await chooseAssetFile(page, "import", {
      name: "hero.png",
      mimeType: "image/png",
      buffer: PIXEL_PNG,
    });
    // The picture is the background layer's, so the control is in the selection
    // inspector, which renders while that layer is selected. The Add pane was
    // showing, so selecting the layer is a real pane swap.
    await selectLayer(page, "Background");
    await chooseIn(page, "[data-yunari-background-asset]", "hero");
    await expect(
      page.locator("[data-yunari-background-asset] [data-yunari-value]"),
    ).toHaveAttribute("data-yunari-value", "hero");
    await waitForMedia(page);
    const first = await mediaSrc(page);
    expect(
      first,
      "the media layer is showing the imported image",
    ).not.toBeNull();

    // **A second image under the same name.** A repeated filename is suffixed,
    // so it lands beside the first rather than on top of it.
    await openPane(page, "Add");
    await chooseAssetFile(page, "import", {
      name: "hero.png",
      mimeType: "image/png",
      buffer: PIXEL_PNG,
    });
    // The declared ids, read from the media control's own opened list: it is
    // plan 1's select, so it has no `option` elements to evaluate.
    //
    // **The control is mounted while the background is selected, and the import
    // just took the selection.** An imported image is placed on the canvas and
    // arrives selected, so the layer is chosen again before its control is
    // read; a read taken with the image selected would wait until the case
    // times out.
    await selectLayer(page, "Background");
    const ids = await optionsOf(page, "[data-yunari-background-asset]");
    expect(ids).toEqual(expect.arrayContaining(["hero", "hero-2"]));
    expect(ids.filter((id) => id.startsWith("hero"))).toHaveLength(2);

    // **Repoint.** The artboard names the new one, and the layer follows it.
    await chooseIn(page, "[data-yunari-background-asset]", "hero-2");
    await waitForMedia(page);
    const second = await mediaSrc(page);
    expect(second).not.toBe(first);
    expect(await page.evaluate(() => window.devicePixelRatio)).toBe(1);

    const saved = await savePackage(page);
    const background = (
      saved.envelope["background"] as
        | { media?: { assetId: string } }
        | undefined
    )?.media;
    expect(background?.assetId).toBe("hero-2");
    // Whatever the artboard names is a declared asset, and the layer is
    // showing that one — the reference, not a count.
    expect(saved.envelope["assets"]).toContainEqual(
      expect.objectContaining({ id: "hero-2" }),
    );
  });

  test("a video asset becomes a video in the media layer", async ({
    page,
  }, testInfo) => {
    desktop(testInfo);
    // **Wiring only, and said so.** These bytes are not a decodable video, so
    // no frame is claimed: what this proves is that a declared video asset
    // reaches the media layer as a `<video>`. Fabric cannot see a DOM sibling,
    // so a decoded frame is the media owner's business, not this file's.
    await openEditor(page);
    await openPane(page, "Add");
    await chooseAssetFile(page, "import", {
      name: "loop.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from("not a decodable video"),
    });
    // The picture is the background layer's, so it is chosen where that layer
    // is selected.
    await selectLayer(page, "Background");
    await chooseIn(page, "[data-yunari-background-asset]", "loop");
    await expect(
      page.locator("[data-yunari-background-asset] [data-yunari-value]"),
    ).toHaveAttribute("data-yunari-value", "loop");
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              document.querySelector("[data-yunari-background-media] video")
                ?.tagName ?? null,
          ),
        { timeout: 15_000 },
      )
      .toBe("VIDEO");
    // The saved document says `video`, not `image`. The starter declares a
    // backdrop of its own, so the video is asserted to be *among* the
    // declarations rather than to be the only one.
    const saved = await savePackage(page);
    expect(saved.envelope["assets"]).toContainEqual(
      expect.objectContaining({ id: "loop", kind: "video" }),
    );
    expect(
      (
        saved.envelope["background"] as
          | { media?: { assetId: string } }
          | undefined
      )?.media?.assetId,
    ).toBe("loop");
  });
});

function mediaSrc(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const element = document.querySelector<HTMLImageElement | HTMLVideoElement>(
      "[data-yunari-background-media] img, [data-yunari-background-media] video",
    );
    return element?.currentSrc || element?.src || null;
  });
}

/**
 * The two gaps this file once pinned rather than wrote around.
 *
 * Each carried a `test.fail` that turned red the moment the gap closed, and
 * both have. The marks went with their fixes: a `test.fail` that starts passing
 * is a failure, so a mark left after its fix is a suite red for the wrong
 * reason. What the block asserts is unchanged.
 */
test.describe("known gaps, pinned", () => {
  test("a saved object carries no derived per-character style table", async ({
    page,
  }, testInfo) => {
    desktop(testInfo);
    // **Measured, and pinned on the cause rather than the symptom.** Fabric
    // writes a per-character `styles` table on every `Textbox`, and
    // `serialiseScene` — which passes `SCENE_PERSISTED_PROPERTIES` and sets
    // `includeDefaultValues = false` — carried it into the package anyway,
    // because `styles` is a set property rather than a Fabric default. The
    // authored equivalent is `yunariText.runs`; nothing reads `styles` back.
    // `removeDerivedTextStyles` is the strip that closed it, and this asserts
    // the absence of the table on a real save — descended into, because the
    // table is written on a card's text parts rather than on the card.
    await openEditor(page);
    const saved = await savePackage(page);
    const styled = objectsOf(saved.envelope).filter(
      (object) => object["styles"] !== undefined,
    );
    expect(
      styled.map((object) => object["id"]),
      "objects carrying a derived style table",
    ).toEqual([]);
  });

  test("a packaged image object saves no runtime object URL", async ({
    page,
  }, testInfo) => {
    desktop(testInfo);
    // **Measured.** Importing an image through the Add pane's file section
    // inserts a Fabric `Image` whose `src` was the `blob:` URL the editor minted
    // for it and whose `crossOrigin` was whatever that decode asked the network
    // for. `serialiseScene` sets `includeDefaultValues = false` and passes
    // `SCENE_PERSISTED_PROPERTIES`, but both are set properties rather than
    // Fabric defaults, so they survived into the exported package. The
    // asset-reference fix took `src` off an image that names its asset; the
    // measured residual of the run that closed this was
    // `envelope.scene.objects[10].crossOrigin`, which `removeImageCrossOrigin`
    // now strips.
    //
    // It is unrevivable state in a shareable artifact: a network policy that
    // meant something only to the tab that saved it. The round trip still
    // works — the object is re-resolved from `yunariAsset.assetId` — so this
    // is a leak, not a break.
    await openEditor(page);
    await openPane(page, "Add");
    await chooseAssetFile(page, "import", {
      name: "logo.png",
      mimeType: "image/png",
      buffer: PIXEL_PNG,
    });
    const saved = await savePackage(page);
    expect(forbiddenKeys(saved.envelope)).toEqual([]);
  });
});
