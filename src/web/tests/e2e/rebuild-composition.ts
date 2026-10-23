import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { chooseIn, optionPairs } from "./control-set.js";
// `openPane` has one owner and one guard (`editor-rail.js`); the driver
// imports it from there and does not re-export it, so this reaches the same
// place. It is imported from the driver rather than the owner in the import
// list below only because that list is the driver's.
import { openPane } from "./editor-rail.js";
import {
  addCard,
  addChart,
  addColour,
  addText,
  choose,
  chooseToken,
  fill,
  insert,
  openBlank,
  place,
  selectLayer,
  setName,
} from "./rebuild-driver.js";

/**
 * The reference composition, as the eight steps that build it.
 *
 * **One owner, two proofs.** The region specs assert each region on its own
 * blank theme — that the surface can express this from nothing — while
 * `author-journey-display.spec.ts` runs all eight in *one* document and shows it
 * on a display. The composition is the same in both, and it lives here so the
 * two cannot drift into testing different things.
 *
 * The target is `docs/superpowers/specs/2026-09-26-reference-theme-target.png`.
 * **The image is the reference.** No coordinate or value is taken from the
 * shipped theme: the whole point is to find what the authoring surface cannot
 * express, and copying the answer hides exactly that. Everything here is
 * measured off the picture, the way the original author did it. Every step is a
 * pointer or a keystroke against a delivered control, and nothing writes scene
 * state.
 */

/**
 * The four device colours the composition is painted with. The blank theme's ten
 * tokens are the minimal set the plan's Product decisions chose — surfaces, a
 * rule and a text, no accents — so an author paints a device-coloured dashboard
 * by adding four tokens through the palette. That is the decision working, not
 * a gap, and these are this rebuild's own choices rather than the reference
 * theme's.
 */
export const DEVICE_COLOURS = [
  ["CPU blue", "#3b9dff"],
  ["GPU violet", "#a970ff"],
  ["RAM teal", "#2fd6a8"],
  ["VRAM magenta", "#d24bf0"],
] as const;

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
  // Stroke before fill: an unfilled `Path` keeps one paint field and it writes
  // the stroke, so clearing the fill first leaves no `panel-stroke` to set
  // (`panel.ts:230`). See the rule in `buildWordmarkAndClock`.
  await chooseToken(page, "[data-yunari-panel-stroke]", token);
  await choose(page, "[data-yunari-panel-fill]", "");
  await fill(page, "[data-yunari-panel-border]", 2);
  await fill(page, "[data-yunari-shape-path]", data);
}

/** A chip: a square with pins on all four sides, as every device icon is. */
export function chip(size: number, pins: number): string {
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
    preset: "typePresets.60-600",
    colour: "palette.text",
  });
  await selectLayer(page, name);
  // The run editor lives in the selection's own column, which no pane choice
  // affects, so reaching it needs no click at all.
  //
  // **`choose`, not `selectOption`, for every run picker in this file.** They
  // were native `<select>`s when this journey was written (`084f40cf`) and are
  // plan 1's `ControlSelect` since `aa6f68e9` (`runs.tsx:497-570`), whose ids are
  // the stored references — `palette.<key>`, `typePresets.<key>` — rather than a
  // token's bare key. The journey was red from that commit until this one and
  // nothing ran it, because no npm script drives the display config.
  await choose(page, '[data-yunari-run-source="0"]', key);
  await page.locator("[data-yunari-run-add]").click();
  await fill(page, '[data-yunari-run-text="1"]', "%");
  await choose(page, '[data-yunari-run-preset="1"]', "typePresets.32-400");
  await choose(page, '[data-yunari-run-colour="1"]', "palette.dim");
}

/**
 * A blank document with the composition's own four colours in it, and the Add
 * pane open — the state every region below is built from.
 */
export async function openBlankComposition(page: Page): Promise<void> {
  await openBlank(page);
  for (const [name, hex] of DEVICE_COLOURS) await addColour(page, name, hex);
  await openPane(page, "Add");
}

/** Wordmark, strapline and the clock card. */
export async function buildWordmarkAndClock(page: Page): Promise<void> {
  // V I G I L I A — tracked, light, top-left.
  await addText(page, {
    name: "wordmark",
    text: "V I G I L I A",
    x: 120,
    y: 62,
    w: 320,
    h: 46,
    preset: "typePresets.46-600",
    colour: "palette.text",
  });

  // S Y S T E M   I N S I G H T S — smaller, tracked wider still.
  //
  // The box is **520**, not the 300 first typed here, and the change was found
  // on a display rather than in the editor: the tracked preset sets a glyph
  // advance of about 17.7 units, so 28 characters need roughly 500 and a 300
  // box truncated the line to "S Y S T E M   I N S I G" — the tail silently
  // gone, which no editor assertion would have caught.
  //
  // `text`, not `dim`: this line sits directly on the photograph with no card
  // behind it, and measured there `#a8bed0` reads **2.11:1** against the sky —
  // the same ink-versus-field pricing `0013` did for the frosted cards, on a
  // field the frosted cards were protecting. `text` takes it to 3.53:1, which
  // is the most any token in this palette can do on a saturated mid-cyan and is
  // still short of AA. The remaining gap is the photograph, not the ink.
  await addText(page, {
    name: "strapline",
    text: "S Y S T E M   I N S I G H T S",
    x: 122,
    y: 112,
    w: 520,
    h: 20,
    preset: "typePresets.17-400",
    colour: "palette.text",
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
  // **140, not 90.** A text object's overflow defaults to `"clip"`
  // (`renderer-core/src/scene/plan.ts:369`) and `applyClip` builds the clip at
  // exactly the authored box, so 108 px of type in a 90-unit box keeps the
  // middle of every digit — and a row of digits with their middles kept is a
  // solid bar. It rendered as one on the display, and the editor showed a Height
  // of 90 the whole time, which is the number the author typed rather than a
  // warning. See F2.18 in the plan; the product half is issue #9.
  await addText(page, {
    name: "time",
    text: "00:00",
    x: 72,
    y: 244,
    w: 300,
    h: 140,
    preset: "typePresets.108-300",
    colour: "palette.text",
  });
  await selectLayer(page, "time");
  await choose(page, '[data-yunari-run-source="0"]', "time.now");
  await page.locator('[data-yunari-run-format="0"]').fill("HH:mm");
  await page.locator('[data-yunari-run-format="0"]').blur();
  // PM beside it, as its own run — the reason F2.1 was blocking.
  await page.locator("[data-yunari-run-add]").click();
  await fill(page, '[data-yunari-run-text="1"]', "PM");
  await choose(page, '[data-yunari-run-preset="1"]', "typePresets.24-400");
  await choose(page, '[data-yunari-run-colour="1"]', "palette.dim");

  // The rule under it. A `Path` takes its data as SVG commands, which is the
  // only way a hairline is drawn at all.
  await insert(page, "Path", "shape");
  await setName(page, "time-rule");
  await place(page, { x: 72, y: 352, w: 306, h: 2 });
  // A rule is a stroke, not a shape: a path arrives filled, and the paint
  // picker's own "not set" is the only way to say so.
  //
  // **The stroke first, the fill second.** A `Path` with no fill has one paint
  // field, and it writes the stroke (`panel.ts:230`, `paintPropertyFor`): clear
  // the fill first and there is no `panel-stroke` left to set. The order is the
  // product's rule, not a preference, and it changed under this harness in
  // `5a563a1c` — the ordering below is the one that still authors the same rule.
  await chooseToken(page, "[data-yunari-panel-stroke]", "Rule");
  await choose(page, "[data-yunari-panel-fill]", "");
  await fill(page, "[data-yunari-panel-border]", 1);

  await addText(page, {
    name: "date",
    text: "Mon, Jan 1, 2024",
    x: 72,
    y: 372,
    w: 306,
    h: 34,
    preset: "typePresets.24-400",
    colour: "palette.dim",
  });
  await selectLayer(page, "date");
  await choose(page, '[data-yunari-run-source="0"]', "date.today");
  await page.locator('[data-yunari-run-format="0"]').fill("ddd, MMM D, YYYY");
  await page.locator('[data-yunari-run-format="0"]').blur();
}

/** The CPU card: a frosted panel, an icon, a reading with its unit, a sparkline. */
export async function buildCpuCard(page: Page): Promise<void> {
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
  // Stroke before fill, for the reason the rule above gives.
  await chooseToken(page, "[data-yunari-panel-stroke]", "CPU blue");
  await choose(page, "[data-yunari-panel-fill]", "");
  await fill(page, "[data-yunari-panel-border]", 2);

  await addText(page, {
    name: "cpu-card-title",
    text: "CPU",
    x: 494,
    y: 222,
    w: 120,
    h: 22,
    preset: "typePresets.24-400",
    colour: "palette.dim",
  });

  // **32** and **%** — a reading and a unit on one object. This is the step
  // F2.1 was blocking: before the fix there was no way to add the second.
  await insert(page, "Text", "text");
  await setName(page, "cpu-card-value");
  await place(page, { x: 448, y: 262, w: 220, h: 60 });
  await fill(page, '[data-yunari-run-text="0"]', "32");
  await choose(page, '[data-yunari-run-preset="0"]', "typePresets.60-600");
  await choose(page, '[data-yunari-run-colour="0"]', "palette.text");
  await choose(page, '[data-yunari-run-source="0"]', "cpu.load");
  await page.locator("[data-yunari-run-add]").click();
  await fill(page, '[data-yunari-run-text="1"]', "%");
  await choose(page, '[data-yunari-run-preset="1"]', "typePresets.32-400");
  await choose(page, '[data-yunari-run-colour="1"]', "palette.dim");
  await page.waitForTimeout(200);

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
}

/** The GPU card: the CPU card's shape, a second token and a caption. */
export async function buildGpuCard(page: Page): Promise<void> {
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
    preset: "typePresets.24-400",
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
    preset: "typePresets.20-400",
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
}

/** The two memory rings: a partial gauge and a closed one. */
export async function buildMemoryRings(page: Page): Promise<void> {
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
    preset: "typePresets.24-400",
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
  // 270 degrees open at the bottom, which is the target's RAM ring. `45` and
  // `405` are the same arc — ECharts reduces both mod 360 — and `45` is the one
  // the bounded field accepts, measured identical to the pixel.
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
    preset: "typePresets.20-400",
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
    preset: "typePresets.24-400",
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
    preset: "typePresets.20-400",
    colour: "palette.dim",
  });
}

/** The trends panel: three series, three sensors, three tokens. */
export async function buildTrends(page: Page): Promise<void> {
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
    preset: "typePresets.24-400",
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
}

/** The storage bar: a value, its unit, one bound bar and a caption. */
export async function buildStorage(page: Page): Promise<void> {
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
    preset: "typePresets.24-400",
    colour: "palette.text",
  });
  await addText(page, {
    name: "storage-card-value",
    text: "56",
    x: 1490,
    y: 528,
    w: 120,
    h: 38,
    preset: "typePresets.36-500",
    colour: "palette.text",
  });
  await selectLayer(page, "storage-card-value");
  await page.locator("[data-yunari-run-add]").click();
  await fill(page, '[data-yunari-run-text="1"]', "%");
  await choose(page, '[data-yunari-run-preset="1"]', "typePresets.24-400");
  await choose(page, '[data-yunari-run-colour="1"]', "palette.dim");
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
  await page
    .locator('[data-yunari-chart-setting="showCategoryLabels"]')
    .uncheck();
  await addText(page, {
    name: "storage-card-name",
    text: "Games (D:)",
    x: 1166,
    y: 624,
    w: 260,
    h: 24,
    preset: "typePresets.20-400",
    colour: "palette.dim",
  });
}

/** The network panel: two series, two keys, two tokens. */
export async function buildNetwork(page: Page): Promise<void> {
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
    preset: "typePresets.24-400",
    colour: "palette.text",
  });
  await addText(page, {
    name: "network-down",
    text: "72.4 Mbps",
    x: 1300,
    y: 710,
    w: 160,
    h: 22,
    preset: "typePresets.20-400",
    colour: "palette.text",
  });
  await addText(page, {
    name: "network-up",
    text: "8.6 Mbps",
    x: 1460,
    y: 710,
    w: 160,
    h: 22,
    preset: "typePresets.20-400",
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
}

/**
 * The whole composition, in one document, in the order a reader meets it.
 *
 * The regions do not overlap, so one blank theme carries all eight: the claim
 * this makes is not that each region is expressible alone, which the region
 * specs prove, but that the surface carries the finished thing — which is the
 * only claim a display can check.
 */
export async function buildComposition(page: Page): Promise<void> {
  await buildWordmarkAndClock(page);
  await buildCpuCard(page);
  await buildGpuCard(page);
  await buildMemoryRings(page);
  await buildTrends(page);
  await buildStorage(page);
  await buildNetwork(page);
}

/**
 * The backdrop, through the controls an author has.
 *
 * Two of them, in the order an author would: **Import a file** at the foot of
 * the Add pane's file section (F0.4's control, the visible button that opens
 * the file chooser), then **Background media** in the artboard panel. The file
 * is a test input, not a fixture — nothing here writes a declaration, and the
 * id the package keys the asset by is minted by the editor.
 */
export async function importBackdrop(page: Page, file: string): Promise<void> {
  await openPane(page, "Add");
  const chooser = page.waitForEvent("filechooser");
  await page.locator("[data-yunari-asset-import]").click();
  await (await chooser).setFiles(file);
  // The pane lists the asset by the file the author chose while the package
  // keys it by an id the editor minted: that is the pair F0.4's fix made
  // readable, and the id is what the artboard panel stores. The label is the
  // file's own name, derived here rather than hardcoded — a helper that
  // guessed the name would pass on one photograph and fail on the next.
  const label = path.basename(file);
  // The list is a plan-1 select: it renders no option until its popup is open,
  // and the import that adds the row is asynchronous — so the wait opens the
  // popup each turn and reads the pair, the same shape `optionsOf` reads ids in.
  let assetId: string | undefined;
  await expect
    .poll(async () => {
      const listed = await optionPairs(page, "[data-yunari-asset-select]");
      assetId = listed.find((option) => option.label === label)?.id;
      return assetId;
    })
    .not.toBeUndefined();

  // The picture and its box are the background layer's properties, so they are
  // written where that layer is selected. Selecting it opens Composition, so
  // this is a real swap from the Add pane, not a no-op.
  await selectLayer(page, "Background");
  // Both are plan 1's selects — a button opening a listbox, not a `select` — so
  // they are driven the way an author drives them.
  await chooseIn(page, "[data-yunari-background-asset]", assetId ?? "");
  await chooseIn(page, "[data-yunari-background-bounds]", "theme");
}
