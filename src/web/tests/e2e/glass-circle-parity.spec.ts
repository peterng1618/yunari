import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { writeThemePackage } from "@yunari/theme-package";
import { frost as FROST } from "../../packages/editor/src/new-fabric-theme-globals.js";
import {
  type Box,
  boxOf,
  decode,
  type Frame,
  frostBox,
  frostWithin,
  luma,
  outlineDifference,
} from "./frame-diff.js";
import { GLASS_BAR, glassStripesPng } from "./glass-fixture.js";
import { openThemeFromStore, storedThemeOfPackage } from "./store-library.js";

/**
 * The editor preview `playwright.config.ts` starts, as `glass.spec.ts` does.
 *
 * **This was `page.goto("/")`, which resolved against `use.baseURL` — the
 * *player* at 4173.** Every step below is an editor affordance: a theme file
 * input, `#status-message`, `canvas.lower-canvas`. On the player, `open()` waited out
 * its 20 s image poll and then sat on the `#status-message` expectation for the rest of
 * the budget, so the test reported a timeout and said nothing whatever about
 * glass. The 240s/300s budgets were never too small; the page was never the
 * editor. A relative URL here names the config, and the config names the player.
 */
const EDITOR = "http://127.0.0.1:4174/";

/**
 * Does a frosted Circle carry the same material as a frosted Rect of the same
 * box?
 *
 * The report was *"the glass blur strength on circle is way stronger than glass
 * on rect at the same value. not that glass isn't working on circle."*
 *
 * Two different things could produce it, and they are not the same finding. A
 * **coverage fault** is the sampled region failing to cover the clipped shape,
 * so part of the disc carries frost with no backdrop behind it — a defect, and
 * `glass-shapes.dom.test.ts` pins it for all five shapes. A **geometric
 * difference** is the region covering the shape, the material being identical,
 * and the disc still reading differently because it has less backdrop behind it
 * than the box around it — not a defect.
 *
 * This answers which of the two it is, in a browser, on both the backdrops the
 * report can be confused by: the reference theme's own photograph, and stripes
 * whose 64 px pitch is past twice the radius so a blur's strength is readable.
 *
 * **Everything except the outline is held constant.** One shape per scene, the
 * same artboard, the same backdrop, the same box, the same radius, the same
 * 30 % fill. Only `type` differs between the two solo captures.
 *
 * Every capture is a **screenshot**, decoded in Node: a readback on the live
 * canvas races Fabric's repaint. The frost is **located by differencing** each
 * capture against its own untreated control rather than by deriving a probe
 * from the page's transform — an earlier version did the latter and put its
 * probe about 70 px from the shape, so every number it printed described a
 * patch of bare photograph and the two shapes agreed because the probe was on
 * neither of them.
 *
 * The file carries a second, separate question below: `vg-516`, whether that
 * differencing instrument reads the same whichever untreated capture is its
 * baseline. The shared frame measure is `./frame-diff.js`.
 */

/** The reference theme's own artboard and backdrop, where the report was seen. */
const PHOTOGRAPH = { width: 1672, height: 941 } as const;
/** Smaller, for the stripes that carry detail a photograph does not. */
const STRIPES = { width: 1200, height: 800 } as const;

/** The reported repro, verbatim: same position, same 260x260 box. */
const BOX = { left: 470, top: 300, size: 260 } as const;
const RADIUS = 24;

// `FROST` is the product's own frost token — a 30 % tint that transmits, whose
// full rationale is on `new-fabric-theme-globals.ts`'s export. A local copy
// would be a second owner of a value the product changes.

type Kind = "Rect" | "Circle";
type Backdrop = "photograph" | "stripes";
/**
 * `stacked` and `reversed` are the two frosted shapes at one position, in each
 * paint order. They are the control that separates a fault in the circle's own
 * composite from the density of two panels sharing one spot.
 *
 * `pair-*` are the **side-by-side** scene at two positions, and they exist for
 * `vg-516`: the two frost-extent methods differ only in which untreated capture
 * is the baseline, and telling that apart from a threshold effect needs both
 * baselines over the same frosted page.
 */
type Scene =
  | Kind
  | "stacked"
  | "reversed"
  | `${Kind}-bare`
  | "pair-rect"
  | "pair-circle"
  | "pair-bare";

/** The circle's own box in the side-by-side scene, clear of the rect's. */
const PAIR_LEFT = 900;

/** The rect of the reported repro; the pair scenes' second object is the circle. */
const PROBE = "probe";
const PAIR_CIRCLE = "pair-circle";

function objectFor(
  kind: Kind,
  frosted: boolean,
  left: number = BOX.left,
  id = PROBE,
): Record<string, unknown> {
  const common = {
    version: "7.4.0" as const,
    originX: "left" as const,
    originY: "top" as const,
    left,
    top: BOX.top,
    yunariPaint: { fill: "palette.frost" },
    fill: FROST,
    ...(frosted ? { yunariGlass: { blurRadius: RADIUS } } : {}),
  };
  if (kind === "Circle")
    return { ...common, id, type: "Circle", radius: BOX.size / 2 };
  return {
    ...common,
    id,
    type: "Rect",
    width: BOX.size,
    height: BOX.size,
    rx: 0,
    ry: 0,
  };
}

function objectsFor(scene: Scene): Record<string, unknown>[] {
  switch (scene) {
    case "Rect":
      return [objectFor("Rect", true)];
    case "Circle":
      return [objectFor("Circle", true)];
    case "stacked":
      return [
        { ...objectFor("Rect", true), id: "probe-under" },
        objectFor("Circle", true),
      ];
    case "reversed":
      return [
        { ...objectFor("Circle", true), id: "probe-under" },
        objectFor("Rect", true),
      ];
    case "Rect-bare":
      return [objectFor("Rect", false)];
    case "Circle-bare":
      return [objectFor("Circle", false)];
    case "pair-rect":
      return [
        objectFor("Rect", true),
        objectFor("Circle", false, PAIR_LEFT, PAIR_CIRCLE),
      ];
    case "pair-circle":
      return [
        objectFor("Rect", false),
        objectFor("Circle", true, PAIR_LEFT, PAIR_CIRCLE),
      ];
    case "pair-bare":
      return [
        objectFor("Rect", false),
        objectFor("Circle", false, PAIR_LEFT, PAIR_CIRCLE),
      ];
  }
}

function packageFor(scene: Scene, backdrop: Backdrop): Uint8Array {
  const photograph = readFileSync(
    fileURLToPath(
      new URL(
        "../../packages/editor/src/starter-backdrop.jpg",
        import.meta.url,
      ),
    ),
  );
  const asset =
    backdrop === "photograph"
      ? {
          id: "backdrop",
          kind: "image" as const,
          path: "assets/backdrop.jpg",
          license: {
            name: "Yunari",
            attribution: "Starter backdrop, shipped with the editor.",
          },
        }
      : {
          id: "stripes",
          kind: "image" as const,
          path: "assets/stripes.png",
          license: { name: "MIT", attribution: "Yunari test fixture." },
        };
  const written = writeThemePackage({
    envelope: {
      schemaVersion: 2 as const,
      fabricVersion: "7.4.0" as const,
      id: `probe-${scene}-${backdrop}`,
      metadata: { name: "Glass shape parity", themeLanguage: "en" },
      artboard: {
        ...(backdrop === "photograph" ? PHOTOGRAPH : STRIPES),
        contentFit: "contain" as const,
      },
      background: {
        color: { ref: "palette.none" as const },
        media: { assetId: asset.id, bounds: "theme" as const },
      },
      globals: {
        palette: {
          none: {
            name: "None",
            value: { kind: "solid" as const, color: "transparent" },
          },
          bar: {
            name: "Bar",
            value: { kind: "solid" as const, color: GLASS_BAR },
          },
          frost: {
            name: "Frost",
            value: { kind: "solid" as const, color: FROST },
          },
        },
      },
      assets: [asset],
      scene: { version: "7.4.0" as const, objects: objectsFor(scene) },
    },
    assets:
      backdrop === "photograph"
        ? { "assets/backdrop.jpg": photograph }
        : { "assets/stripes.png": glassStripesPng() },
  });
  if (!written.ok) throw new Error(written.message);
  return written.bytes;
}

async function open(
  page: Page,
  scene: Scene,
  backdrop: Backdrop,
): Promise<void> {
  await openThemeFromStore(
    page,
    storedThemeOfPackage(packageFor(scene, backdrop)),
  );
  await page.waitForFunction(
    () => {
      const image = document.querySelector<HTMLImageElement>(
        "[data-yunari-background-media] img",
      );
      return image !== null && image.complete && image.naturalWidth > 0;
    },
    null,
    { timeout: 20_000 },
  );
  // The media decodes after the first paint and nothing repaints on decode.
  await page.evaluate(() => {
    const scope = window as unknown as Record<string, unknown>;
    const key = Object.keys(scope).find((c) =>
      c.startsWith("yunari-fabric-editor"),
    );
    (
      scope[key ?? ""] as { canvas: { renderAll(): void } } | undefined
    )?.canvas.renderAll();
  });
  // Two animation frames, so the capture is of a frame the compositor produced.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function shoot(page: Page, scene: Scene, backdrop: Backdrop) {
  await open(page, scene, backdrop);
  return page.locator("canvas.lower-canvas").screenshot();
}

/** A capture's field over a disc, which is what two shapes can be compared on. */
interface Field {
  readonly mean: number;
  readonly range: number;
  /** Mean absolute step between horizontally adjacent pixels. */
  readonly detail: number;
  readonly pixels: number;
}

function overDisc(frame: Frame, cx: number, cy: number, radius: number): Field {
  let sum = 0;
  let count = 0;
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  let detail = 0;
  for (let y = Math.round(cy - radius); y <= cy + radius; y += 1)
    for (let x = Math.round(cx - radius); x <= cx + radius; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > radius * radius) continue;
      if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) continue;
      const value = luma(frame, x, y);
      sum += value;
      count += 1;
      if (value < low) low = value;
      if (value > high) high = value;
      if (x + 1 < frame.width)
        detail += Math.abs(luma(frame, x + 1, y) - value);
    }
  return {
    mean: count === 0 ? Number.NaN : sum / count,
    range: count === 0 ? Number.NaN : high - low,
    detail: count === 0 ? Number.NaN : detail / count,
    pixels: count,
  };
}

/**
 * The disc every capture in a comparison is measured over.
 *
 * A **shared** disc rather than each shape's own: the diff that locates the
 * frost erodes by a fraction of a pixel at the blur's own edge falloff, so two
 * shapes at the same box come out with boxes about a pixel apart, and over the
 * stripes that is 0.56 luma of apparent difference on identical material — the
 * measurement finding its own edge rather than the shape's. The intersection of
 * the boxes, at 90 % of its half-width, is inside every one of them.
 */
function commonDisc(
  boxes: readonly (Box | undefined)[],
): { cx: number; cy: number; radius: number } | undefined {
  const present = boxes.filter((b): b is Box => b !== undefined);
  const first = present[0];
  if (first === undefined) return undefined;
  const left = Math.max(...present.map((b) => b.left));
  const right = Math.min(...present.map((b) => b.right));
  const top = Math.max(...present.map((b) => b.top));
  const bottom = Math.min(...present.map((b) => b.bottom));
  return {
    cx: (left + right) / 2,
    cy: (top + bottom) / 2,
    radius: 0.45 * Math.min(right - left, bottom - top),
  };
}

/**
 * The object's own box in the **capture's** pixels, read from the page rather
 * than from the frost.
 *
 * `vg-516` is a question about the instrument, and a region derived from one
 * method's own reading would be the instrument compared with itself.
 * `getBoundingRect` is in scene units, `viewportTransform` carries them to the
 * canvas element's pixels and the capture's own scale is the PNG's width over
 * that element's backing width.
 */
async function objectBox(
  page: Page,
  id: string,
): Promise<{ box: Box; elementWidth: number }> {
  return page.evaluate((objectId) => {
    const scope = window as unknown as Record<string, unknown>;
    const key =
      Object.keys(scope).find((c) => c.startsWith("yunari-fabric-editor")) ??
      "";
    const canvas = (
      scope[key] as
        | {
            canvas: {
              getObjects(): Array<{
                get(name: string): unknown;
                getBoundingRect(): {
                  left: number;
                  top: number;
                  width: number;
                  height: number;
                };
              }>;
              lowerCanvasEl: HTMLCanvasElement;
              viewportTransform: readonly [
                number,
                number,
                number,
                number,
                number,
                number,
              ];
              getRetinaScaling(): number;
            };
          }
        | undefined
    )?.canvas;
    if (canvas === undefined) throw new Error("no editor canvas is mounted");
    const object = canvas.getObjects().find((o) => o.get("id") === objectId);
    if (object === undefined) throw new Error(`no object "${objectId}"`);
    const bounds = object.getBoundingRect();
    const view = canvas.viewportTransform;
    const retina = canvas.getRetinaScaling();
    const left =
      (bounds.left * view[0] + bounds.top * view[2] + view[4]) * retina;
    const top =
      (bounds.left * view[1] + bounds.top * view[3] + view[5]) * retina;
    return {
      box: {
        left,
        top,
        right: left + bounds.width * view[0] * retina,
        bottom: top + bounds.height * view[3] * retina,
      },
      elementWidth: canvas.lowerCanvasEl.width,
    };
  }, id);
}

/**
 * Edits one object **in the page that is already open** and repaints.
 *
 * `lift` clears the panel's authored treatment, which is the baseline that
 * shares the frosted capture's own rendering: no second page load, so nothing
 * outside the treatment can differ between the two captures. `composite()`
 * re-reads the treatment every frame, so clearing the property is the whole
 * change — no listener to unhook, no cache to invalidate.
 *
 * `uncache` only turns the object's own cache off, which is the state the glass
 * path leaves a panel in (`uncacheChain`, on attach). It separates the
 * treatment's own edge from the cache state the treatment implies, and that is
 * the difference `vg-516`'s rim turns out to be made of.
 */
async function editObject(
  page: Page,
  id: string,
  mode: "lift" | "uncache",
): Promise<void> {
  await page.evaluate(
    (input) => {
      const scope = window as unknown as Record<string, unknown>;
      const key =
        Object.keys(scope).find((c) => c.startsWith("yunari-fabric-editor")) ??
        "";
      const canvas = (
        scope[key] as
          | {
              canvas: {
                getObjects(): Array<{
                  get(name: string): unknown;
                  set(name: string, value: unknown): void;
                }>;
                renderAll(): void;
              };
            }
          | undefined
      )?.canvas;
      if (canvas === undefined) throw new Error("no editor canvas is mounted");
      const object = canvas.getObjects().find((o) => o.get("id") === input.id);
      if (object === undefined) throw new Error(`no object "${input.id}"`);
      if (input.mode === "lift") object.set("yunariGlass", undefined);
      else object.set("objectCaching", false);
      canvas.renderAll();
    },
    { id, mode },
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

test.describe("a frosted circle and a frosted rect of the same box", () => {
  test.setTimeout(240_000);
  for (const backdrop of ["stripes", "photograph"] as const)
    test(`carry the same material over the ${backdrop}`, async ({
      page,
    }, testInfo) => {
      await page.goto(EDITOR);
      const shots = {
        rect: await shoot(page, "Rect", backdrop),
        circle: await shoot(page, "Circle", backdrop),
        stacked: await shoot(page, "stacked", backdrop),
        reversed: await shoot(page, "reversed", backdrop),
        rectBare: await shoot(page, "Rect-bare", backdrop),
        circleBare: await shoot(page, "Circle-bare", backdrop),
      };
      for (const [label, body] of Object.entries(shots)) {
        writeFileSync(
          `test-results/glass-parity-${backdrop}-${label}.png`,
          body,
        );
        await testInfo.attach(`${backdrop}-${label}.png`, {
          body,
          contentType: "image/png",
        });
      }

      // Each frosted capture against the untreated control of the shape that is
      // **underneath** it, so the difference is the extra panel and not a
      // change of backdrop.
      const decoded = {
        rect: await decode(shots.rect),
        circle: await decode(shots.circle),
        stacked: await decode(shots.stacked),
        reversed: await decode(shots.reversed),
        rectBare: await decode(shots.rectBare),
        circleBare: await decode(shots.circleBare),
      };
      const boxes = {
        rect: frostBox(decoded.rect, decoded.rectBare),
        circle: frostBox(decoded.circle, decoded.circleBare),
        stacked: frostBox(decoded.stacked, decoded.rectBare),
        reversed: frostBox(decoded.reversed, decoded.circleBare),
      };
      for (const [label, box] of Object.entries(boxes))
        expect(box, `${label} reached the backdrop at all`).toBeDefined();

      /** Both solo shapes over the one disc they share. */
      const solo = commonDisc([boxes.rect, boxes.circle]);
      /** Both paint orders over the one disc they share. */
      const pair = commonDisc([boxes.stacked, boxes.reversed]);
      if (solo === undefined || pair === undefined) return;

      const fields = {
        rect: overDisc(decoded.rect, solo.cx, solo.cy, solo.radius),
        circle: overDisc(decoded.circle, solo.cx, solo.cy, solo.radius),
        stacked: overDisc(decoded.stacked, pair.cx, pair.cy, pair.radius),
        reversed: overDisc(decoded.reversed, pair.cx, pair.cy, pair.radius),
        rectBare: overDisc(decoded.rectBare, solo.cx, solo.cy, solo.radius),
        circleBare: overDisc(decoded.circleBare, solo.cx, solo.cy, solo.radius),
      };
      console.log(
        `FROST === backdrop ${backdrop} ` +
          `soloDisc r=${solo.radius.toFixed(1)} pairDisc r=${pair.radius.toFixed(1)}`,
      );
      for (const [label, f] of Object.entries(fields))
        console.log(
          `FROST ${label.padEnd(11)} mean=${f.mean.toFixed(2)} ` +
            `range=${f.range.toFixed(2)} detail=${f.detail.toFixed(3)} ` +
            `px=${f.pixels}`,
        );

      // **The same material over the area both shapes carry.**
      //
      // Not over each shape's own footprint: a disc covers less of its box than
      // a rect does, so those areas differ by construction and a mean over them
      // compares the outlines rather than the material. The shared disc is the
      // only region both carry, and it is where "the circle is stronger" would
      // show if the material differed.
      expect(
        Math.abs(fields.rect.mean - fields.circle.mean),
        `a frosted circle carries the rect's material over the area they share (${fields.rect.mean.toFixed(2)} vs ${fields.circle.mean.toFixed(2)})`,
      ).toBeLessThan(0.5);
      expect(
        Math.abs(fields.rect.detail - fields.circle.detail),
        "and diffuses it by the same amount",
      ).toBeLessThan(0.05);

      // **The control.** The two untreated scenes are the same backdrop under
      // the same 30 % tint, so they are what the frosted pair is read against.
      expect(
        Math.abs(fields.rectBare.mean - fields.circleBare.mean),
        "the two untreated scenes measure the same backdrop",
      ).toBeLessThan(1.5);

      // **The stacking control.** Two frosted panels at one position read
      // denser than either alone, because the upper panel's blur samples the
      // lower panel's frost rather than the backdrop. Inverting the paint order
      // reproduces it, which places the extra density in the overlap and not in
      // the outline.
      expect(
        Math.abs(fields.stacked.mean - fields.reversed.mean),
        `two frosted panels read the same whichever is on top (${fields.stacked.mean.toFixed(2)} vs ${fields.reversed.mean.toFixed(2)})`,
      ).toBeLessThan(2.5);
      expect(
        fields.stacked.mean,
        "and both are denser than either shape alone",
      ).toBeLessThan(fields.rect.mean - 10);
    });
});

/**
 * `vg-516`: the instrument's two baselines.
 *
 * The row is that one harness read the rect's frost as 13,228 px and another as
 * 12,766 px, differing at exactly the rect box's outer rim — 462 px, rows
 * 236-239 and 319-320, columns 52-54 and 201-203 — with nothing the per-shape
 * pair found that the cross-page pair did not. The cause was never established
 * and both harnesses are gone from the tree.
 *
 * They are rebuilt here against **one** frosted capture. `pair-rect` (rect
 * frosted, circle bare) is what all four readings difference; only the
 * untreated capture changes:
 *
 *  - `pair-bare`, nothing frosted — the per-shape pair's baseline;
 *  - `pair-circle`, the circle frosted instead — the cross-page pair's baseline,
 *    and the one difference the two lost harnesses actually had;
 *  - the same page's own rect with its treatment lifted — the baseline neither
 *    harness had, and the one carrying no between-page variable at all;
 *  - the bare page's own rect with only its object cache turned off, which is
 *    the state attaching the treatment leaves it in.
 *
 * The last two are what separate "which page was the baseline" from "the
 * treatment's own edge" and from the cache state the treatment brings with it.
 * The region is the rect's own box read from the page rather than from the
 * frost, so the instrument is not compared with itself.
 */
test.describe("the frost-extent instrument", () => {
  test.setTimeout(240_000);
  test("reads the same extent whichever untreated capture is the baseline", async ({
    page,
  }) => {
    await page.goto(EDITOR);
    await open(page, "pair-rect", "stripes");
    const rectFrosted = await page.locator("canvas.lower-canvas").screenshot();
    const measured = await objectBox(page, PROBE);
    await editObject(page, PROBE, "lift");
    const rectLifted = await page.locator("canvas.lower-canvas").screenshot();

    const circleFrosted = await shoot(page, "pair-circle", "stripes");
    const bothBare = await shoot(page, "pair-bare", "stripes");
    // The bare page again with the rect's own cache off, which is the state the
    // frosted page's rect is in. `shoot` leaves this page open.
    await editObject(page, PROBE, "uncache");
    const bareUncached = await page.locator("canvas.lower-canvas").screenshot();

    const frames = {
      rectFrosted: await decode(rectFrosted),
      rectLifted: await decode(rectLifted),
      circleFrosted: await decode(circleFrosted),
      bothBare: await decode(bothBare),
      bareUncached: await decode(bareUncached),
    };
    const frosted = frames.rectFrosted;
    const perCapture = frosted.width / measured.elementWidth;
    // The rect's own box, padded, so the frost's own edge is inside the region
    // rather than on its boundary and the count cannot be clipped by it.
    const PAD = 4;
    const region: Box = {
      left: Math.max(0, Math.floor(measured.box.left * perCapture) - PAD),
      top: Math.max(0, Math.floor(measured.box.top * perCapture) - PAD),
      right: Math.min(
        frosted.width - 1,
        Math.ceil(measured.box.right * perCapture) + PAD,
      ),
      bottom: Math.min(
        frosted.height - 1,
        Math.ceil(measured.box.bottom * perCapture) + PAD,
      ),
    };

    const methods = {
      perShape: frostWithin(frosted, frames.bothBare, region),
      crossPage: frostWithin(frosted, frames.circleFrosted, region),
      samePage: frostWithin(frosted, frames.rectLifted, region),
      uncached: frostWithin(frosted, frames.bareUncached, region),
    };
    const labels: Record<keyof typeof methods, string> = {
      perShape: "per-shape (bare page)",
      crossPage: "cross-page (circle frosted)",
      samePage: "same page (treatment lifted)",
      uncached: "per-shape, cache off too",
    };
    for (const name of Object.keys(methods) as Array<keyof typeof methods>) {
      const box = boxOf(frosted, methods[name]);
      console.log(
        `FROST EXTENT ${labels[name].padEnd(28)} area=${methods[name].size} ` +
          `box=${box === undefined ? "none" : `${box.left},${box.top}-${box.right},${box.bottom}`}`,
      );
      expect(
        methods[name].size,
        `${labels[name]} reached the backdrop at all`,
      ).toBeGreaterThan(0);
    }

    const { perShape, crossPage, samePage, uncached } = methods;
    const perShapeBox = boxOf(frosted, perShape);
    if (perShapeBox === undefined) return;
    /** A pixel of rasteriser drift is not a finding. The row's own defect was
     *  3.6 percent of the area, and this bound is a tenth of one percent. */
    const RIM_TOLERANCE = Math.max(1, Math.round(perShape.size * 0.001));

    // **The claim.** The baseline page's own contents are not part of the
    // reading: the circle's frost is hundreds of pixels from the rect, so a
    // baseline carrying it measures the rect the same as one that does not.
    // These two are the baselines the lost harnesses actually used, and this is
    // what says the row's 462 px was not the choice between them.
    const across = outlineDifference(crossPage, perShape, frosted, perShapeBox);
    console.log(
      `FROST EXTENT cross-page vs per-shape: ${across.only} px differ, ` +
        `deepest ${across.deepest} from the frost's own outline`,
    );
    expect(
      across.only,
      `the rect's extent does not depend on what else the baseline page holds (per-shape ${perShape.size} vs cross-page ${crossPage.size}, ${across.only} px differ)`,
    ).toBeLessThanOrEqual(RIM_TOLERANCE);

    // **What the rim is made of.** The lifted baseline is the one that differs
    // from a bare page in nothing but the treatment — and the treatment is not
    // only a blur: attaching it turns the panel's own object cache off, so the
    // frosted page's rect paints uncached where a bare page's rect paints
    // through its cache. Holding that equal is what says the residual is the
    // cache state the treatment brings and not the blur.
    const cached = outlineDifference(uncached, perShape, frosted, perShapeBox);
    console.log(
      `FROST EXTENT cache-off vs bare page: ${cached.only} px differ, ` +
        `deepest ${cached.deepest} from the frost's own outline`,
    );
    const lifted = outlineDifference(samePage, uncached, frosted, perShapeBox);
    console.log(
      `FROST EXTENT same-page vs cache-off: ${lifted.only} px differ, ` +
        `deepest ${lifted.deepest} from the frost's own outline`,
    );
    expect(
      lifted.only,
      `with the cache held equal, the lifted treatment reads the same as a bare page (lifted ${samePage.size} vs cache-off ${uncached.size}, ${lifted.only} px differ)`,
    ).toBeLessThanOrEqual(RIM_TOLERANCE);

    // Whatever either disagreement is made of, it is the frost's own outline
    // and not its interior: a rim is where the coverage is fractional, so a
    // baseline a luma apart flips those pixels and no others.
    expect(
      Math.max(across.deepest, lifted.deepest),
      `and neither disagreement reaches the frost's interior (deepest ${across.deepest} and ${lifted.deepest})`,
    ).toBeLessThanOrEqual(4);
  });
});
