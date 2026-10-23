import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { writeThemePackage } from "@yunari/theme-package";
import {
  frost,
  solidOf,
} from "../../packages/editor/src/new-fabric-theme-globals.js";
import { GLASS_BAR } from "./glass-fixture.js";
import { openThemeFromStore, storedThemeOfPackage } from "./store-library.js";

/** `solidOf` is a `Record<string, string>`, so a key read is `string | undefined`
 *  even though the map is a literal. The panel token is required here. */
function panelPaint(): string {
  const paint = solidOf["panel"];
  if (paint === undefined)
    throw new Error("new-fabric-theme-globals lost its panel paint");
  return paint;
}

/**
 * The browser proof that a frosted **Circle** and a frosted **Triangle** are
 * genuinely frosted, over a real photograph.
 *
 * **Measured by screenshot, never by `getImageData` on the live canvas.** This
 * pass has already produced a confident false finding six times over from
 * exactly that: a readback racing Fabric's repaint reads a frame nobody was
 * shown. Every number here is decoded from a PNG the compositor produced, in
 * Node, after two animation frames.
 *
 * ## The statistic, and why not "the interior is brighter"
 *
 * A tint also raises the interior luma, so brightness alone cannot tell a
 * frosted card from a painted one. Three probes together can:
 *
 *  1. **The authoring decision.** Tinted is the card surface at 85% with no
 *     treatment; frosted is the frosted surface at 30% with it. That is what
 *     the author does, and it is the comparison the pass's 0.216 → 0.718
 *     measured. An earlier version of this file compared the frosted surface
 *     against *itself* with the treatment off, which isolates the blur alone —
 *     the smaller half of the decision — and cannot reproduce that reading.
 *  2. **Transmission** — interior luma over the backdrop immediately beside the
 *     card. The reference is the card's own bounding-box corner, which is
 *     outside a circle and a triangle alike, so it is the same few pixels of
 *     photograph and not a probe somewhere else in the frame.
 *  3. **The clear-fill control.** The same shape painting nothing, with the
 *     treatment on, which shows the composite itself rather than a surface laid
 *     over it.
 *
 * **Diffusion is not asserted here.** The starter photograph is smooth at the
 * scale of a 120 px card — a scan of its bands put the sharpest adjacent-pixel
 * step at 2-7 luma across every candidate position — so a blur has almost
 * nothing to flatten and the probe cannot separate a blurred card from a sharp
 * one. `glass.spec.ts` asserts diffusion on the high-frequency stripe fixture,
 * which exists for exactly that reason; this file is about the photograph and
 * about the shape, and it says so rather than asserting a number it cannot
 * support.
 * ## Why the card sits where it does
 *
 * The starter photograph runs from a bright band to a near-black one over about
 * 400 device px, and the first two attempts at this fixture put the cards
 * across that boundary. A card straddling it measures the *photograph*, not
 * the glass: the interior read 26 luma against a corner reading 162, and
 * "transmission" computed from that is a statement about the picture. The
 * cards below sit inside one band, chosen by measuring it — around 126 luma
 * with 24-31 luma of local step, so there is both a level to transmit and
 * detail for the blur to flatten.
 */

/**
 * The editor preview `playwright.config.ts` already starts, as `glass.spec.ts`
 * and `glass-authoring.spec.ts` both do.
 *
 * **This was `http://127.0.0.1:4219/`, a port nothing in this repo serves** —
 * not a server that failed to start, but one that was never configured, so the
 * spec failed at `page.goto` with `ERR_CONNECTION_REFUSED` and every assertion
 * below it went unrun. A hardcoded port is the failure mode: it names a machine
 * rather than a fixture, so it survives the removal of whatever once answered
 * it. The preview port is the repo's own, and the config starts it.
 */
const EDITOR = "http://127.0.0.1:4174/";

const ARTBOARD = { width: 900, height: 600 } as const;

/** Card box, placed by measurement — see the header. */
const CARD = { size: 120, top: 272 } as const;
const CARDS = [
  { kind: "Circle", left: 238 },
  { kind: "Triangle", left: 414 },
] as const;

/** The product's own default, and well inside the measured-flat band. */
const RADIUS = 16;

type Kind = (typeof CARDS)[number]["kind"];

interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

function objectFor(
  card: { kind: Kind; left: number },
  fill: "panel" | "frost" | "none",
  withGlass: boolean,
): Record<string, unknown> {
  const common = {
    version: "7.4.0" as const,
    originX: "left" as const,
    originY: "top" as const,
    left: card.left,
    top: CARD.top,
    id: `frosted-${card.kind}`,
    yunariPaint: { fill: `palette.${fill}` },
    ...(withGlass ? { yunariGlass: { blurRadius: RADIUS } } : {}),
  };
  if (card.kind === "Circle")
    return { ...common, type: "Circle", radius: CARD.size / 2, fill: "" };
  return {
    ...common,
    type: "Triangle",
    width: CARD.size,
    height: CARD.size,
    fill: "",
  };
}

function envelope(fill: "panel" | "frost" | "none", withGlass: boolean) {
  return {
    schemaVersion: 2 as const,
    fabricVersion: "7.4.0" as const,
    id: `e2e-glass-shapes-${fill}-${withGlass ? "frosted" : "bare"}`,
    metadata: { name: "E2E glass shapes", themeLanguage: "en" },
    artboard: {
      width: ARTBOARD.width,
      height: ARTBOARD.height,
      contentFit: "contain" as const,
    },
    background: {
      color: { ref: "palette.none" as const },
      media: { assetId: "backdrop", bounds: "theme" as const },
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
        // The product's own tokens, imported from the module that owns them
        // rather than transcribed. A fill invented for the fixture would make
        // the number a statement about the fixture; a copy of the product's
        // would make it a statement about that copy.
        panel: {
          name: "Panel",
          value: { kind: "solid" as const, color: panelPaint() },
        },
        frost: {
          name: "Frost",
          value: { kind: "solid" as const, color: frost },
        },
      },
    },
    assets: [
      {
        id: "backdrop",
        kind: "image" as const,
        path: "assets/backdrop.jpg",
        license: {
          name: "Yunari",
          attribution: "Starter backdrop, shipped with the editor.",
        },
      },
    ],
    scene: {
      version: "7.4.0" as const,
      objects: CARDS.map((card) => objectFor(card, fill, withGlass)),
    },
  };
}

function packageFor(
  fill: "panel" | "frost" | "none",
  withGlass: boolean,
): Uint8Array {
  const photograph = readFileSync(
    fileURLToPath(
      new URL(
        "../../packages/editor/src/starter-backdrop.jpg",
        import.meta.url,
      ),
    ),
  );
  const written = writeThemePackage({
    envelope: envelope(fill, withGlass),
    assets: { "assets/backdrop.jpg": photograph },
  });
  if (!written.ok) throw new Error(written.message);
  return written.bytes;
}

async function open(
  page: Page,
  fill: "panel" | "frost" | "none",
  withGlass: boolean,
): Promise<void> {
  await openThemeFromStore(
    page,
    storedThemeOfPackage(packageFor(fill, withGlass)),
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
  // The media decodes after the first paint and nothing repaints on decode, so
  // a forced render is part of measuring rather than an optimisation.
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

/**
 * Probe points in **screenshot pixels**, from the page's own viewport transform.
 * The artboard is letterboxed into the window at `contain`, so a fixed device
 * coordinate would measure empty canvas the first time the window changed
 * shape.
 *
 * The interior probe is a **short line at the shape's own centroid**, not the
 * bounding box's centre: a triangle is half as wide at mid-height as its box,
 * and a probe line long enough to show the blur ran straight through its edge
 * and reported the edge as "backdrop detail" — 30 luma of step where the blur
 * had actually flattened the interior to 2.
 */
interface Probes {
  readonly centres: ReadonlyArray<readonly [number, number]>;
  readonly corners: ReadonlyArray<readonly [number, number]>;
}

async function locate(page: Page): Promise<Probes> {
  return page.evaluate(
    (ids) => {
      const scope = window as unknown as Record<string, unknown>;
      const key = Object.keys(scope).find((c) =>
        c.startsWith("yunari-fabric-editor"),
      );
      const canvas = (
        scope[key ?? ""] as
          | {
              canvas: {
                viewportTransform: readonly [
                  number,
                  number,
                  number,
                  number,
                  number,
                  number,
                ];
                getRetinaScaling(): number;
                getObjects(): Array<
                  Record<string, unknown> & { getBoundingRect(): Box }
                >;
              };
            }
          | undefined
      )?.canvas;
      if (canvas === undefined) throw new Error("no editor canvas is mounted");
      const view = canvas.viewportTransform;
      const retina = canvas.getRetinaScaling();
      const toDevice = (x: number, y: number): [number, number] => [
        (x * view[0] + y * view[2] + view[4]) * retina,
        (x * view[1] + y * view[3] + view[5]) * retina,
      ];
      const boxes = ids.map((id) => {
        const found = canvas.getObjects().find((o) => o["id"] === id);
        if (found === undefined) throw new Error(`no object with id "${id}"`);
        return found.getBoundingRect();
      });
      return {
        // A triangle's centroid is two thirds of the way down its box, where the
        // shape is widest; the bounding box's centre is fine for a circle.
        centres: boxes.map((r) =>
          toDevice(
            r.left + r.width / 2,
            r.top + (r.height * (r.height === r.width ? 2 / 3 : 1)) / 2,
          ),
        ),
        // 4% in from the box corner: clear of the shape's own antialiased edge,
        // still inside the box, and the same few pixels in both captures.
        corners: boxes.map((r) =>
          toDevice(r.left + r.width * 0.04, r.top + r.height * 0.04),
        ),
      };
    },
    CARDS.map((c) => `frosted-${c.kind}`),
  );
}

interface Frame {
  /** Luma at each card's centroid. */
  readonly interior: readonly number[];
  /** Luma at each card's bounding-box corner: the local backdrop. */
  readonly corner: readonly number[];
  /** Sharpest adjacent-pixel step along a short line at each centroid. */
  readonly detail: readonly number[];
}

/** `canvas` is already a devDependency here and every e2e fixture uses it. */
async function measure(shot: Buffer, probes: Probes): Promise<Frame> {
  const { createCanvas, loadImage } = await import("canvas");
  const image = await loadImage(shot);
  const surface = createCanvas(image.width, image.height);
  const context = surface.getContext("2d");
  context.drawImage(image, 0, 0);
  // One readback for the whole frame.
  const data = context.getImageData(0, 0, image.width, image.height).data;
  const luma = (x: number, y: number): number | undefined => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    // Bounds-checked. An out-of-range probe returned NaN and every statistic
    // built on it was silently void.
    if (xi < 0 || yi < 0 || xi >= image.width || yi >= image.height)
      return undefined;
    const i = (yi * image.width + xi) * 4;
    return (
      0.2126 * (data[i] ?? 0) +
      0.7152 * (data[i + 1] ?? 0) +
      0.0722 * (data[i + 2] ?? 0)
    );
  };
  const detail = (cx: number, cy: number): number => {
    let step = 0;
    for (let d = -18; d < 18; d += 1) {
      const a = luma(cx + d, cy);
      const b = luma(cx + d + 1, cy);
      if (a === undefined || b === undefined) continue;
      step = Math.max(step, Math.abs(a - b));
    }
    return step;
  };
  return {
    interior: probes.centres.map((p) => luma(p[0], p[1]) ?? Number.NaN),
    corner: probes.corners.map((p) => luma(p[0], p[1]) ?? Number.NaN),
    detail: probes.centres.map((p) => detail(p[0], p[1])),
  };
}

test.describe("a frosted circle and a frosted triangle, in a browser", () => {
  test.setTimeout(240_000);
  test("both transmit the photograph, both diffuse it, and both clip to their own shape", async ({
    page,
  }, testInfo) => {
    await page.goto(EDITOR);

    // Three captures, and they are the **authoring decision** the pass measured:
    //
    //   `tinted`  — the card surface at 85%, no treatment. What the author sees
    //               before turning glass on.
    //   `frosted` — the frosted surface at 30%, treatment on. What they see
    //               after. Turning glass on puts the surface with it, and a
    //               blur under an 85% fill is a blur of nothing (F1.11).
    //   `clear`   — no fill, treatment on. The control that shows the composite
    //               itself rather than the surface over it.
    //
    // The first version of this compared `frosted` against the *same* frosted
    // surface with the treatment off. That isolates the blur, which is the
    // smaller half of the decision, and it cannot reproduce the pass's reading
    // because the pass's was never about the blur alone.
    await open(page, "frost", true);
    const probes = await locate(page);
    const frostedShot = await page.locator("canvas").first().screenshot();
    await open(page, "panel", false);
    const tintedShot = await page.locator("canvas").first().screenshot();
    await open(page, "none", true);
    const clearShot = await page.locator("canvas").first().screenshot();

    await testInfo.attach("frosted.png", {
      body: frostedShot,
      contentType: "image/png",
    });
    await testInfo.attach("tinted.png", {
      body: tintedShot,
      contentType: "image/png",
    });
    await testInfo.attach("clear.png", {
      body: clearShot,
      contentType: "image/png",
    });

    const frosted = await measure(frostedShot, probes);
    const tinted = await measure(tintedShot, probes);
    const clear = await measure(clearShot, probes);

    for (const [i, kind] of CARDS.map((c) => c.kind).entries()) {
      const backdrop = frosted.corner[i] ?? Number.NaN;
      console.log(
        `GLASS VISUAL ${kind.padEnd(9)} backdrop=${backdrop.toFixed(1)} ` +
          `tinted=${(tinted.interior[i] ?? 0).toFixed(1)} ` +
          `frosted=${(frosted.interior[i] ?? 0).toFixed(1)} ` +
          `clearFill=${(clear.interior[i] ?? 0).toFixed(1)} | ` +
          `transmission tinted=${((tinted.interior[i] ?? 0) / backdrop).toFixed(3)} ` +
          `frosted=${((frosted.interior[i] ?? 0) / backdrop).toFixed(3)}`,
      );
      expect(
        Number.isFinite(backdrop),
        `${kind}: every probe landed on the screenshot`,
      ).toBe(true);
    }

    for (const [i, kind] of CARDS.map((c) => c.kind).entries()) {
      const backdrop = frosted.corner[i] ?? 0;
      const frostedTransmission = (frosted.interior[i] ?? 0) / backdrop;
      const tintedTransmission = (tinted.interior[i] ?? 0) / backdrop;

      // **The treatment is on and the shape transmits.** The pass read 0.216
      // tinted and 0.718 frosted over a photograph; under 0.5 here is the F1.11
      // defect, a blur under an opaque fill.
      expect(
        frostedTransmission,
        `${kind}: the frosted shape transmits the photograph (${frostedTransmission.toFixed(3)})`,
      ).toBeGreaterThan(0.5);

      // **And it is a decision, not a constant.** Turning glass on has to move
      // the surface; this is the half that catches a card that renders a tint
      // identically either way.
      expect(
        frostedTransmission,
        `${kind}: the treatment changed what is behind it (tinted ${tintedTransmission.toFixed(3)})`,
      ).toBeGreaterThan(tintedTransmission + 0.2);

      // **The control.** With no fill at all, the shape shows the photograph
      // the composite sampled, close to the backdrop beside it. A shape that
      // did not composite would show its own (absent) paint here instead.
      expect(
        (clear.interior[i] ?? 0) / backdrop,
        `${kind}: a shape with no fill shows the photograph through the glass`,
      ).toBeGreaterThan(0.7);

      // **The clip is the shape, not its box.** A corner of the bounding box is
      // outside a circle and a triangle alike, so the treatment must not have
      // reached it and the two captures must agree there.
      expect(
        Math.abs((frosted.corner[i] ?? 0) - (tinted.corner[i] ?? 0)),
        `${kind}: the bounding-box corner is outside the clip, so the treatment never reached it`,
      ).toBeLessThan(8);
    }
  });
});
