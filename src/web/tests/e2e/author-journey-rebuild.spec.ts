import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";
import { chooseIn } from "./control-set.js";
import { openPane } from "./editor-rail.js";
import {
  addCard,
  addChart,
  addColour,
  addText,
  chooseToken,
  fill,
  insert,
  insertTextBox,
  openBlank,
  place,
  readObject,
  readScene,
  selectLayer,
  setName,
} from "./rebuild-driver.js";
import { isDesktopSurface } from "./surface.js";

/**
 * The reference composition, rebuilt from a blank theme by hand.
 *
 * The target is the reference theme target
 * at 1672 × 941. **The image is the reference.** No coordinate or value is taken
 * from the shipped theme: the whole point is to find what the authoring surface
 * cannot express, and copying the answer hides exactly that. Everything below
 * is measured off the picture, the way the original author did it.
 *
 * Every step is a pointer or a keystroke. The driver and the product share no
 * code and the driver writes no scene state — the scene is read through the
 * editor handle, never written — so a pass here is evidence about the surface
 * rather than about the driver.
 */

const SHOT = (name: string) => `test-results/rebuild/${name}.png`;

/**
 * The four device colours the composition is painted with. The blank theme's ten
 * tokens are the minimal set the plan's Product decisions chose — surfaces, a
 * rule and a text, no accents — so an author paints a device-coloured dashboard
 * by adding four tokens through the palette. That is the decision working, not
 * a gap, and these are this rebuild's own choices rather than the reference
 * theme's.
 */
const DEVICE_COLOURS = [
  ["CPU blue", "#3b9dff"],
  ["GPU violet", "#a970ff"],
  ["RAM teal", "#2fd6a8"],
  ["VRAM magenta", "#d24bf0"],
] as const;

test.describe("the reference composition, built from blank", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    // The shared config runs every spec on every project, and the editor is a
    // desktop surface — `surface.ts` says so in its own doc comment, and this is
    // the guard its callers use.
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await page.goto("/");
    await page.waitForSelector("#canvas-host canvas");
  });

  test("a blank theme offers everything the first card needs", async ({
    page,
  }) => {
    // Task 7, step 2: not whether it *works*, but whether an author landing on
    // an empty stage can tell what to do next. That is a finding either way.
    await openBlank(page);

    expect(await readScene(page)).toEqual([]);

    await openPane(page, "Add");
    const pane = page.locator('[data-yunari-panel="add"]');
    // **What the pane offers, not how many buttons that is.** The count was 13
    // written at a moment when the pane held 13 buttons, and every insertion
    // since — shapes, charts, the card library — moved it, so the assertion went
    // red on a suite that had not lost anything. A number here is a claim about
    // today's inventory and nothing else; the groups below are the claim that
    // was actually meant, and they fail if a group disappears rather than if
    // somebody adds a button.
    await expect(pane.getByRole("group", { name: "Shape" })).toBeVisible();
    await expect(pane.getByRole("group", { name: "Chart" })).toBeVisible();
    // And every group offers at least one control, so an empty group cannot
    // satisfy a visibility check.
    for (const group of await pane.getByRole("group").all()) {
      expect(
        await group.getByRole("button").count(),
        "an offered group offers something",
      ).toBeGreaterThan(0);
    }

    // The blank theme's own inventory is read where it is owned: the palette
    // and the presets are the Tokens pane's two lists, and "populated" is
    // measured rather than assumed. **This read the Document pane's resolved
    // references until item 17 removed that section** (`vg-474`): the pane no
    // longer offers a read of what the document references.
    await openPane(page, "Design tokens");
    // The same two sets the removed section resolved — the theme's own palette
    // and its own tokens — read from the lists that own them. A populated
    // palette is the claim; its size is an inventory and moves on its own.
    await expect(
      page.locator("[data-yunari-palette-token-row]").first(),
    ).toBeVisible();
    // Three roles is the starter vocabulary's contract, not today's count.
    await expect(page.locator("[data-yunari-type-preset-row]")).toHaveCount(3);
    await expect(page.locator("[data-yunari-type-presets]")).toHaveCount(1);

    await page.screenshot({ path: SHOT("01-blank") });
  });

  test("the wordmark, the strapline and the clock card", async ({ page }) => {
    await openBlank(page);

    // The blank theme's ten tokens carry no device colours, and the composition
    // is painted with four. The palette owns adding one, so that is the route.
    for (const [name, hex] of [
      ["CPU blue", "#3b9dff"],
      ["GPU violet", "#a970ff"],
      ["RAM teal", "#2fd6a8"],
      ["VRAM magenta", "#d24bf0"],
    ] as const)
      await addColour(page, name, hex);

    await openPane(page, "Add");

    // V I G I L I A — tracked, light, top-left.
    await addText(page, {
      name: "wordmark",
      text: "V I G I L I A",
      x: 120,
      y: 62,
      w: 320,
      h: 46,
      preset: "typeTokens.heading",
      colour: "palette.text",
    });

    // S Y S T E M   I N S I G H T S — smaller, tracked wider still.
    await addText(page, {
      name: "strapline",
      text: "S Y S T E M   I N S I G H T S",
      x: 122,
      y: 112,
      w: 300,
      h: 20,
      preset: "typeTokens.body",
      colour: "palette.dim",
    });

    // The clock card: a frosted panel, outlined, with a generous radius.
    await addCard(page, {
      name: "time-card",
      x: 40,
      y: 182,
      w: 368,
      h: 305,
      radius: 14,
      stroke: "Panel outline",
      blur: 40,
    });

    // 07:24 — the largest type in the composition, and a reading rather than
    // the words. The run editor is where a run stops being prose: choosing an
    // instant key brings a Format and a Zone with it, which is where the
    // clock's own design lives.
    await addText(page, {
      name: "time",
      text: "00:00",
      x: 72,
      y: 244,
      w: 300,
      h: 90,
      preset: "typeTokens.heading",
      colour: "palette.text",
    });
    await selectLayer(page, "time");
    await chooseIn(page, '[data-yunari-run-source="0"]', "time.now");
    await page.locator('[data-yunari-run-format="0"]').fill("HH:mm");
    await page.locator('[data-yunari-run-format="0"]').blur();
    // PM beside it, as its own run — the reason F2.1 was blocking.
    await page.locator("[data-yunari-run-add]").click();
    await fill(page, '[data-yunari-run-text="1"]', "PM");
    await chooseIn(page, '[data-yunari-run-preset="1"]', "typeTokens.body");
    await chooseIn(page, '[data-yunari-run-colour="1"]', "palette.dim");

    // The rule under it. A `Path` takes its data as SVG commands, which is the
    // only way a hairline is drawn at all.
    await insert(page, "Path", "shape");
    await setName(page, "time-rule");
    await place(page, { x: 72, y: 352, w: 306, h: 2 });
    // A rule is a stroke, not a shape. On a path that arrives with no fill the
    // inspector offers **one** paint control and it writes the stroke — see
    // `paintPropertyFor` — so there is no separate Fill picker to clear, and
    // asking for `[data-yunari-panel-fill]` waits for a control this shape
    // deliberately does not render. Which token goes on it is the whole choice.
    await chooseToken(page, "[data-yunari-panel-stroke]", "Rule");
    await fill(page, "[data-yunari-panel-border]", 1);

    await addText(page, {
      name: "date",
      text: "Mon, Jan 1, 2024",
      x: 72,
      y: 372,
      w: 306,
      h: 34,
      preset: "typeTokens.body",
      colour: "palette.dim",
    });
    await selectLayer(page, "date");
    await chooseIn(page, '[data-yunari-run-source="0"]', "date.today");
    await page.locator('[data-yunari-run-format="0"]').fill("ddd, MMM D, YYYY");
    await page.locator('[data-yunari-run-format="0"]').blur();

    await page.screenshot({ path: SHOT("02-clock-region") });

    // The scene, read rather than asserted field by field: the question is
    // whether the objects landed where the picture says they go.
    const scene = await readScene(page);
    expect(scene.map((object) => object.name)).toEqual([
      "wordmark",
      "strapline",
      "time-card",
      "time",
      "time-rule",
      "date",
    ]);
    expect(await readObject(page, "wordmark")).toMatchObject({
      originX: "left",
      left: 120,
    });
    expect(await readObject(page, "time-card")).toMatchObject({
      left: 40,
      top: 182,
      renderedWidth: 368,
      renderedHeight: 305,
    });
  });

  test("a device card: the reading, its unit, and the sparkline beside it", async ({
    page,
  }) => {
    await openBlank(page);
    for (const [name, hex] of [
      ["CPU blue", "#3b9dff"],
      ["GPU violet", "#a970ff"],
      ["RAM teal", "#2fd6a8"],
      ["VRAM magenta", "#d24bf0"],
    ] as const)
      await addColour(page, name, hex);
    await openPane(page, "Add");

    await addCard(page, {
      name: "cpu-card",
      x: 420,
      y: 182,
      w: 280,
      h: 305,
      radius: 14,
      stroke: "Panel outline",
      blur: 40,
    });

    // The chip icon. A `Path` is the only shape that draws a glyph.
    await insert(page, "Path", "shape");
    await setName(page, "cpu-card-icon");
    await place(page, { x: 452, y: 218, w: 28, h: 28 });
    // A path with no fill paints its stroke, so this one control is both.
    await chooseToken(page, "[data-yunari-panel-stroke]", "CPU blue");
    await fill(page, "[data-yunari-panel-border]", 2);

    await addText(page, {
      name: "cpu-card-title",
      text: "CPU",
      x: 494,
      y: 222,
      w: 120,
      h: 22,
      preset: "typeTokens.body",
      colour: "palette.dim",
    });

    // **32** and **%** — a reading and a unit on one object. This is the step
    // F2.1 was blocking: before the fix there was no way to add the second.
    await insertTextBox(page, { x: 448, y: 262, w: 220, h: 60 });
    await setName(page, "cpu-card-value");
    await fill(page, '[data-yunari-run-text="0"]', "32");
    await chooseIn(page, '[data-yunari-run-preset="0"]', "typeTokens.heading");
    await chooseIn(page, '[data-yunari-run-colour="0"]', "palette.text");
    await chooseIn(page, '[data-yunari-run-source="0"]', "cpu.load");
    await page.locator("[data-yunari-run-add]").click();
    await fill(page, '[data-yunari-run-text="1"]', "%");
    await chooseIn(page, '[data-yunari-run-preset="1"]', "typeTokens.body");
    await chooseIn(page, '[data-yunari-run-colour="1"]', "palette.dim");
    await page.waitForTimeout(200);

    // A reading and a unit on one object, and the reading bound to a key.
    expect(await readObject(page, "cpu-card-value")).toMatchObject({
      yunariText: {
        runs: [
          { kind: "value", typeToken: "typeTokens.heading" },
          { kind: "literal", text: "%", typeToken: "typeTokens.body" },
        ],
      },
    });

    // The sparkline, bound to the same key as the reading beside it — the
    // card must not be able to show a percentage and a waveform for two
    // different moments. F2.2 was blocking this.
    await addChart(page, {
      family: "Line",
      name: "cpu-card-sparkline",
      x: 436,
      y: 386,
      w: 248,
      h: 62,
      series: ["cpu.load"],
      paint: ["CPU blue"],
    });
    await selectLayer(page, "cpu-card-value");

    await page.screenshot({ path: SHOT("03-cpu-card") });

    const scene = await readScene(page);
    expect(scene.map((object) => object.name)).toContain("cpu-card");
    expect(scene.map((object) => object.name)).toContain("cpu-card-sparkline");
  });
});

/**
 * The rest of the composition, region by region.
 *
 * Each region starts from its own blank theme, because that is the claim being
 * tested: that the surface can express this from nothing. Icons are drawn as
 * path data through the one control Fabric has for a glyph, which is what an
 * author does; nothing here copies a coordinate or a value out of the shipped
 * theme.
 */

/** A chip or bar glyph, drawn as the path data the Path field takes. */
async function glyph(
  page: Page,
  name: string,
  box: { x: number; y: number; w: number; h: number },
  data: string,
  token: string,
): Promise<void> {
  await insert(page, "Path", "shape");
  await setName(page, name);
  await place(page, box);
  // A path with no fill paints its stroke, so this one control is both.
  await chooseToken(page, "[data-yunari-panel-stroke]", token);
  await fill(page, "[data-yunari-panel-border]", 2);
  await fill(page, "[data-yunari-shape-path]", data);
}

/** A chip: a square with pins on all four sides, as every device icon is. */
function chip(size: number, pins: number): string {
  const edge = size * 0.25;
  const span = size * 0.5;
  const sides = Array.from({ length: pins }, (_, index) => {
    const t = (index + 1) / (pins + 1);
    const x = edge + span * t;
    const y = edge + span * t;
    const pin = size * 0.06;
    return [
      `M ${x - pin} ${edge - size * 0.11} L ${x + pin} ${edge - size * 0.11}`,
      `M ${x - pin} ${edge + span + size * 0.11} L ${x + pin} ${edge + span + size * 0.11}`,
      `M ${edge - size * 0.11} ${y - pin} L ${edge - size * 0.11} ${y + pin}`,
      `M ${edge + span + size * 0.11} ${y - pin} L ${edge + span + size * 0.11} ${y + pin}`,
    ].join(" ");
  });
  return [
    `M ${edge} ${edge} L ${edge + span} ${edge}`,
    `L ${edge + span} ${edge + span} L ${edge} ${edge + span} Z`,
    ...sides,
  ].join(" ");
}

/** The caption a card's reading carries, and the unit that follows it. */
async function reading(
  page: Page,
  name: string,
  box: { x: number; y: number; w: number; h: number },
  key: string,
): Promise<void> {
  await addText(page, {
    name,
    text: "00",
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    preset: "typeTokens.heading",
    colour: "palette.text",
  });
  await selectLayer(page, name);
  // The run editor lives in the selection's own column, which no pane choice
  // affects, so reaching it needs no click at all.
  await chooseIn(page, '[data-yunari-run-source="0"]', key);
  await page.locator("[data-yunari-run-add]").click();
  await fill(page, '[data-yunari-run-text="1"]', "%");
  await chooseIn(page, '[data-yunari-run-preset="1"]', "typeTokens.body");
  await chooseIn(page, '[data-yunari-run-colour="1"]', "palette.dim");
}

test.describe("the rest of the composition", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    await page.goto("/");
    await page.waitForSelector("#canvas-host canvas");
    await openBlank(page);
    for (const [name, hex] of DEVICE_COLOURS) await addColour(page, name, hex);
    await openPane(page, "Add");
  });

  test("the GPU card", async ({ page }) => {
    await addCard(page, {
      name: "gpu-card",
      x: 714,
      y: 182,
      w: 290,
      h: 305,
      radius: 14,
      stroke: "Panel outline",
      blur: 40,
    });
    await glyph(
      page,
      "gpu-card-icon",
      { x: 746, y: 218, w: 28, h: 28 },
      chip(28, 2),
      "GPU violet",
    );
    await addText(page, {
      name: "gpu-card-title",
      text: "GPU",
      x: 788,
      y: 222,
      w: 120,
      h: 22,
      preset: "typeTokens.body",
      colour: "palette.dim",
    });
    await reading(
      page,
      "gpu-card-value",
      {
        x: 740,
        y: 262,
        w: 230,
        h: 60,
      },
      "gpu.load",
    );
    await addText(page, {
      name: "gpu-card-caption",
      text: "NVIDIA GeForce RTX 4080",
      x: 740,
      y: 344,
      w: 240,
      h: 24,
      preset: "typeTokens.body",
      colour: "palette.dim",
    });
    await addChart(page, {
      family: "Line",
      name: "gpu-card-sparkline",
      x: 730,
      y: 386,
      w: 258,
      h: 62,
      series: ["gpu.load"],
      paint: ["GPU violet"],
    });
    // A card sparkline has no axes in the target, and the family offers them.
    await page.locator('[data-yunari-chart-setting="showAxes"]').uncheck();
    await page.screenshot({ path: SHOT("04-gpu-card") });

    // The box the author typed, not the measurement under it — F2.5.
    expect(await readObject(page, "gpu-card-caption")).toMatchObject({
      left: 740,
      renderedWidth: 240,
    });
    expect(await readObject(page, "gpu-card-value")).toMatchObject({
      yunariText: {
        runs: [
          { kind: "value", typeToken: "typeTokens.heading" },
          { kind: "literal", text: "%" },
        ],
      },
    });
  });

  test("the two memory rings: a partial gauge and a full one", async ({
    page,
  }) => {
    await addCard(page, {
      name: "ram-card",
      x: 1018,
      y: 182,
      w: 302,
      h: 305,
      radius: 14,
      stroke: "Panel outline",
      blur: 40,
    });
    await glyph(
      page,
      "ram-card-icon",
      { x: 1050, y: 218, w: 28, h: 28 },
      chip(28, 3),
      "RAM teal",
    );
    await addText(page, {
      name: "ram-card-title",
      text: "RAM",
      x: 1092,
      y: 222,
      w: 120,
      h: 22,
      preset: "typeTokens.body",
      colour: "palette.dim",
    });
    await addChart(page, {
      family: "Gauge",
      name: "ram-gauge",
      x: 1069,
      y: 258,
      w: 200,
      h: 200,
      series: ["ram.used.percent"],
      paint: [undefined, "RAM teal"],
    });
    // 270 degrees open at the bottom, which is the target's RAM ring.
    //
    // `45`, not `405`: the two are the same arc — ECharts reduces both angles
    // mod 360, so 135 → 405 and 135 → 45 each sweep 270° clockwise, measured
    // identical to the pixel. 45 is the spelling the field can hold, and the
    // field is the enforcing control: a value it cannot hold never reaches the
    // chart, so a journey that typed one was asserting a document that cannot
    // exist.
    await fill(page, '[data-yunari-chart-setting="startAngle"]', 135);
    await fill(page, '[data-yunari-chart-setting="endAngle"]', 45);
    await fill(page, '[data-yunari-chart-setting="thickness"]', 14);
    await page.locator('[data-yunari-chart-setting="roundCap"]').check();
    await chooseToken(page, '[data-yunari-chart-paint="track"]', "Chart track");
    await reading(
      page,
      "ram-value",
      { x: 1099, y: 348, w: 140, h: 56 },
      "ram.used.percent",
    );
    await addText(page, {
      name: "ram-capacity",
      text: "13.4 / 32 GB",
      x: 1058,
      y: 400,
      w: 220,
      h: 24,
      preset: "typeTokens.body",
      colour: "palette.dim",
    });

    // VRAM: the same card, a closed ring, a different colour.
    await addCard(page, {
      name: "vram-card",
      x: 1332,
      y: 182,
      w: 302,
      h: 305,
      radius: 14,
      stroke: "Panel outline",
      blur: 40,
    });
    await glyph(
      page,
      "vram-card-icon",
      { x: 1364, y: 218, w: 28, h: 28 },
      chip(28, 3),
      "VRAM magenta",
    );
    await addText(page, {
      name: "vram-card-title",
      text: "VRAM",
      x: 1406,
      y: 222,
      w: 120,
      h: 22,
      preset: "typeTokens.body",
      colour: "palette.dim",
    });
    await addChart(page, {
      family: "Gauge",
      name: "vram-gauge",
      x: 1383,
      y: 258,
      w: 200,
      h: 200,
      series: ["vram.used.percent"],
      paint: [undefined, "VRAM magenta"],
    });
    await fill(page, '[data-yunari-chart-setting="startAngle"]', 90);
    await fill(page, '[data-yunari-chart-setting="endAngle"]', -270);
    await fill(page, '[data-yunari-chart-setting="thickness"]', 14);
    await page.locator('[data-yunari-chart-setting="roundCap"]').check();
    await chooseToken(page, '[data-yunari-chart-paint="track"]', "Chart track");
    await reading(
      page,
      "vram-value",
      { x: 1413, y: 348, w: 140, h: 56 },
      "vram.used.percent",
    );
    await addText(page, {
      name: "vram-capacity",
      text: "10.7 / 16 GB",
      x: 1372,
      y: 400,
      w: 220,
      h: 24,
      preset: "typeTokens.body",
      colour: "palette.dim",
    });
    await page.screenshot({ path: SHOT("05-memory-rings") });

    // Both rings differ only in their angles and their colour, which is the
    // point: the same three settings separate a partial ring from a closed one.
    expect((await readScene(page)).map((object) => object.name)).toEqual([
      "ram-card",
      "ram-card-icon",
      "ram-card-title",
      "ram-gauge",
      "ram-value",
      "ram-capacity",
      "vram-card",
      "vram-card-icon",
      "vram-card-title",
      "vram-gauge",
      "vram-value",
      "vram-capacity",
    ]);
    expect(await readObject(page, "ram-gauge")).toMatchObject({
      settings: { startAngle: 135, endAngle: 45, roundCap: true },
    });
    expect(await readObject(page, "vram-gauge")).toMatchObject({
      settings: { startAngle: 90, endAngle: -270, roundCap: true },
    });
  });

  test("the trends panel", async ({ page }) => {
    await addCard(page, {
      name: "trends-card",
      x: 296,
      y: 505,
      w: 828,
      h: 338,
      radius: 14,
      stroke: "Panel outline",
      blur: 40,
    });
    await glyph(
      page,
      "trends-card-icon",
      { x: 320, y: 536, w: 22, h: 22 },
      "M 0 20 L 6 20 L 6 8 L 12 8 L 12 14 L 18 14 L 18 2 L 22 2",
      "Chart track",
    );
    await addText(page, {
      name: "trends-card-title",
      text: "Performance Trends",
      x: 352,
      y: 534,
      w: 320,
      h: 26,
      preset: "typeTokens.body",
      colour: "palette.text",
    });
    // Three series, three sensors, three tokens — the shape the chart panel
    // could not reach at all before F2.2.
    await addChart(page, {
      family: "Line",
      name: "trends-chart",
      x: 350,
      y: 575,
      w: 740,
      h: 240,
      series: ["cpu.load", "gpu.load", "ram.used.percent"],
      paint: ["CPU blue", "GPU violet", "RAM teal"],
    });
    await page.locator('[data-yunari-chart-setting="showAxes"]').uncheck();
    await page.screenshot({ path: SHOT("06-trends") });

    // The committed key, read off the `data-yunari-value` hook rather than
    // `.value`: the binding control is plan 1's select now — a `button`
    // carrying the hook — and `HTMLButtonElement.value` is always `""`, so the
    // old read answered three empty strings instead of the three series.
    const series = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-yunari-binding]")).map(
        (binding) =>
          binding
            .querySelector("[data-yunari-value]")
            ?.getAttribute("data-yunari-value"),
      ),
    );
    expect(series).toEqual(["cpu.load", "gpu.load", "ram.used.percent"]);
  });

  test("the storage bar", async ({ page }) => {
    await addCard(page, {
      name: "storage-card",
      x: 1138,
      y: 505,
      w: 500,
      h: 168,
      radius: 14,
      stroke: "Panel outline",
      blur: 40,
    });
    await glyph(
      page,
      "storage-card-icon",
      { x: 1166, y: 536, w: 24, h: 24 },
      "M 2 6 L 22 6 L 22 22 L 2 22 Z M 2 11 L 22 11 M 7 17 L 9 17 M 12 17 L 14 17",
      "Chart track",
    );
    await addText(page, {
      name: "storage-card-title",
      text: "Storage",
      x: 1200,
      y: 534,
      w: 180,
      h: 26,
      preset: "typeTokens.body",
      colour: "palette.text",
    });
    await addText(page, {
      name: "storage-card-value",
      text: "56",
      x: 1490,
      y: 528,
      w: 120,
      h: 38,
      preset: "typeTokens.heading",
      colour: "palette.text",
    });
    await selectLayer(page, "storage-card-value");
    await page.locator("[data-yunari-run-add]").click();
    await fill(page, '[data-yunari-run-text="1"]', "%");
    await chooseIn(page, '[data-yunari-run-preset="1"]', "typeTokens.body");
    await chooseIn(page, '[data-yunari-run-colour="1"]', "palette.dim");
    await addChart(page, {
      family: "Bar",
      name: "storage-bar",
      x: 1160,
      y: 586,
      w: 450,
      h: 22,
      series: ["disk.used.percent"],
      paint: ["CPU blue"],
    });
    await page.locator('[data-yunari-chart-setting="showAxes"]').uncheck();
    await addText(page, {
      name: "storage-card-name",
      text: "Games (D:)",
      x: 1166,
      y: 624,
      w: 260,
      h: 24,
      preset: "typeTokens.body",
      colour: "palette.dim",
    });
    await page.screenshot({ path: SHOT("07-storage") });

    expect((await readScene(page)).map((object) => object.name)).toEqual(
      expect.arrayContaining([
        "storage-card",
        "storage-bar",
        "storage-card-name",
      ]),
    );
  });

  test("the network panel", async ({ page }) => {
    await addCard(page, {
      name: "network-card",
      x: 1138,
      y: 688,
      w: 500,
      h: 155,
      radius: 14,
      stroke: "Panel outline",
      blur: 40,
    });
    await addText(page, {
      name: "network-card-title",
      text: "Network",
      x: 1200,
      y: 708,
      w: 180,
      h: 26,
      preset: "typeTokens.body",
      colour: "palette.text",
    });
    await addText(page, {
      name: "network-down",
      text: "72.4 Mbps",
      x: 1300,
      y: 710,
      w: 160,
      h: 22,
      preset: "typeTokens.body",
      colour: "palette.text",
    });
    await addText(page, {
      name: "network-up",
      text: "8.6 Mbps",
      x: 1460,
      y: 710,
      w: 160,
      h: 22,
      preset: "typeTokens.body",
      colour: "palette.dim",
    });
    await addChart(page, {
      family: "Line",
      name: "network-chart",
      x: 1160,
      y: 744,
      w: 450,
      h: 80,
      series: ["network.download", "network.upload"],
      paint: ["CPU blue", "GPU violet"],
    });
    await page.locator('[data-yunari-chart-setting="showAxes"]').uncheck();
    await page.screenshot({ path: SHOT("08-network") });

    expect((await readScene(page)).map((object) => object.name)).toEqual(
      expect.arrayContaining(["network-card", "network-chart"]),
    );
  });
});

/**
 * Task 11's second half: the **persisted envelope**, not the live DOM.
 *
 * Reading the live scene proves the control repainted. Only reading the saved
 * package proves save — which is Review Focus #2, and the one thing this file
 * could not claim from the region tests alone.
 */
test("what the rebuild authored survives the save", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  // Its own document: a top-level test rather than a region, so it navigates
  // for itself instead of inheriting a describe's `beforeEach`.
  await page.goto("/");
  await page.waitForSelector("#canvas-host canvas");
  await openBlank(page);
  for (const [name, hex] of DEVICE_COLOURS) await addColour(page, name, hex);
  await openPane(page, "Add");

  // The CPU card: the richest region. A frosted panel, a stroked path, a
  // two-run reading and a bound sparkline — every kind of authored state the
  // document carries.
  await addCard(page, {
    name: "cpu-card",
    x: 420,
    y: 182,
    w: 280,
    h: 305,
    radius: 14,
    stroke: "Panel outline",
    blur: 40,
  });
  await glyph(
    page,
    "cpu-card-icon",
    { x: 452, y: 218, w: 28, h: 28 },
    chip(28, 3),
    "CPU blue",
  );
  await addText(page, {
    name: "cpu-card-value",
    text: "00",
    x: 448,
    y: 262,
    w: 220,
    h: 60,
    preset: "typeTokens.heading",
    colour: "palette.text",
  });
  await selectLayer(page, "cpu-card-value");
  await chooseIn(page, '[data-yunari-run-source="0"]', "cpu.load");
  await page.locator("[data-yunari-run-add]").click();
  await fill(page, '[data-yunari-run-text="1"]', "%");
  await chooseIn(page, '[data-yunari-run-preset="1"]', "typeTokens.body");
  await chooseIn(page, '[data-yunari-run-colour="1"]', "palette.dim");
  await addChart(page, {
    family: "Line",
    name: "cpu-card-sparkline",
    x: 436,
    y: 386,
    w: 248,
    h: 62,
    series: ["cpu.load"],
    paint: ["CPU blue"],
  });

  // The File menu's own Save row, and the package it writes.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save package" }).click();
  const file = await (await download).path();
  expect(file, "Save package should write a package").not.toBeNull();

  const envelope = JSON.parse(
    execFileSync("unzip", ["-p", file!, "theme.json"], {
      encoding: "utf8",
    }),
  ) as {
    readonly artboard: { readonly width: number; readonly height: number };
    readonly bindings: Readonly<
      Record<string, readonly { semanticKey: string }[]>
    >;
    readonly globals: { readonly palette: Readonly<Record<string, unknown>> };
    readonly scene: {
      readonly objects: readonly {
        readonly id: string;
        readonly name?: string;
        readonly yunariText?: {
          readonly runs: readonly {
            readonly kind: string;
            readonly text?: string;
            readonly bindingId?: string;
            readonly typeToken?: string;
          }[];
          readonly box?: { readonly width: number; readonly height: number };
        };
        readonly yunariPaint?: Readonly<Record<string, string>>;
        readonly yunariGlass?: { readonly blurRadius: number };
        readonly settings?: Readonly<Record<string, unknown>>;
      }[];
    };
  };

  const byName = (name: string) =>
    envelope.scene.objects.find((object) => object.name === name);

  // The artboard the chooser was asked for, not the one the document opened at.
  expect(envelope.artboard).toMatchObject({ width: 1920, height: 1080 });

  // F2.5: the box the author typed, persisted as the box.
  expect(byName("cpu-card-value")?.yunariText?.box).toMatchObject({
    width: 220,
    height: 60,
  });

  // F2.1: two runs, the first a reading and the second its unit.
  expect(byName("cpu-card-value")?.yunariText?.runs).toEqual([
    expect.objectContaining({
      kind: "value",
      typeToken: "typeTokens.heading",
    }),
    expect.objectContaining({
      kind: "literal",
      text: "%",
      typeToken: "typeTokens.body",
    }),
  ]);

  // F2.2: the binding the run names is declared, and the chart's own too.
  const declared = Object.values(envelope.bindings).flat();
  expect(declared.map((binding) => binding.semanticKey)).toEqual(
    expect.arrayContaining(["cpu.load"]),
  );

  // The card's material, the icon's stroke, and the chart's own paint: all
  // references, never literals, or §73 is broken in a document nobody hand-wrote.
  expect(byName("cpu-card")?.yunariGlass?.blurRadius).toBe(40);
  expect(byName("cpu-card")?.yunariPaint?.["fill"]).toMatch(/^palette\./);
  expect(byName("cpu-card-icon")?.yunariPaint?.["stroke"]).toMatch(
    /^palette\./,
  );
  expect(JSON.stringify(byName("cpu-card-sparkline")?.settings)).not.toMatch(
    /#[0-9a-f]{6}/i,
  );
  expect(JSON.stringify(byName("cpu-card-sparkline")?.settings)).toContain(
    "palette.",
  );

  // F1.8: the name an author gave rides beside the id rather than replacing
  // it, so the layer list and the document both read "cpu-card" and the stable
  // key is still what a binding and a schema path address.
  const card = byName("cpu-card");
  expect(card?.name).toBe("cpu-card");
  expect(card?.id).not.toBe("cpu-card");
  expect(envelope.scene.objects.map((object) => object.name)).toEqual([
    "cpu-card",
    "cpu-card-icon",
    "cpu-card-value",
    "cpu-card-sparkline",
  ]);

  await testInfo.attach("rebuild-envelope.json", {
    body: JSON.stringify(envelope, null, 2),
    contentType: "application/json",
  });
});
