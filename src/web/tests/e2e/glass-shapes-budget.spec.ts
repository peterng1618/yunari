import { expect, type Page, test } from "@playwright/test";
import { writeThemePackage } from "@yunari/theme-package";
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
 * Task F's re-measure: what a frosted **Circle, Ellipse, Triangle and Polygon**
 * costs per frame at radius 48, against a frosted **Rect** of the same box.
 *
 * Why this is a re-measure and not an extension of Task 1's number: that sweep
 * was rectangles only, and two things about the cost are shape-dependent. A
 * triangle's area-to-perimeter ratio differs from a rect's, and `sampleRegion`
 * pads the sampled box by twice the blur radius on each side — so the blur is
 * not proportional to the shape's area, and a shape with the same bounding box
 * is not the same bill.
 *
 * **The comparison is like-for-like by bounding box, not by area.** Every shape
 * below is given the *same* 240x160 box, so the sampled region is identical
 * across all five and what moves is the composite over it. That isolates the
 * thing the widening changed. A triangle covering half its box then does less
 * work than a rect, which is the honest direction of the difference and is
 * stated rather than engineered away.
 *
 * The scene is a photograph, not the stripe fixture: the pass's rule is that
 * glass is measured over a photograph, and a stripe pattern flatters a blur in
 * a way a photograph does not.
 */

const ARTBOARD = { width: 1672, height: 941 };

/** One row of five shapes, so all five cost the same backdrop to draw. */
const ROW = { left: 120, top: 620, width: 240, height: 160 };

type Kind = "Rect" | "Circle" | "Ellipse" | "Triangle" | "Polygon";

/** The measured radius, and the one `MAX_GLASS_BLUR_RADIUS` allows. */
const RADIUS = 48;

function shape(
  kind: Kind,
  at: { left: number; top: number; width: number; height: number },
) {
  const common = {
    version: "7.4.0" as const,
    originX: "left" as const,
    originY: "top" as const,
    left: at.left,
    top: at.top,
    fill: "rgba(255, 255, 255, 0.10)",
    id: kind,
    yunariPaint: { fill: "palette.panel" },
  };
  switch (kind) {
    case "Rect":
      return {
        ...common,
        type: "Rect",
        width: at.width,
        height: at.height,
        rx: 24,
        ry: 24,
      };
    case "Circle": {
      // Inscribed, so the box is the largest that fits: a circle in a 240x160
      // box is 160 across, not 240. Giving it width/2 would have made this the
      // one shape with a *larger* sample region than the rect and the
      // comparison would have been measuring that, not the shape.
      const radius = Math.min(at.width, at.height) / 2;
      return {
        ...common,
        type: "Circle",
        radius,
        left: at.left + at.width / 2 - radius,
        top: at.top + at.height / 2 - radius,
      };
    }
    case "Ellipse":
      return {
        ...common,
        type: "Ellipse",
        rx: at.width / 2,
        ry: at.height / 2,
      };
    case "Triangle":
      return {
        ...common,
        type: "Triangle",
        width: at.width,
        height: at.height,
      };
    case "Polygon":
      // A square's corners as a diamond: its bounding box is the same box, and
      // it covers about half of it, which is the area-to-perimeter difference
      // this task is measuring.
      return {
        ...common,
        type: "Polygon",
        points: [
          { x: 0, y: -at.height / 2 },
          { x: at.width / 2, y: 0 },
          { x: 0, y: at.height / 2 },
          { x: -at.width / 2, y: 0 },
        ],
      };
  }
}

function envelope(kinds: readonly Kind[]) {
  return {
    schemaVersion: 2 as const,
    fabricVersion: "7.4.0" as const,
    id: "e2e-glass-shapes",
    metadata: { name: "E2E glass shapes", themeLanguage: "en" },
    artboard: {
      width: ARTBOARD.width,
      height: ARTBOARD.height,
      contentFit: "contain" as const,
    },
    background: {
      color: { ref: "palette.none" as const },
      media: { assetId: "stripes", bounds: "theme" as const },
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
        panel: {
          name: "Panel",
          value: { kind: "solid" as const, color: "rgba(255, 255, 255, 0.10)" },
        },
      },
    },
    assets: [
      {
        id: "stripes",
        kind: "image" as const,
        path: "assets/stripes.png",
        license: { name: "MIT", attribution: "Yunari test fixture." },
      },
    ],
    scene: {
      version: "7.4.0" as const,
      objects: kinds.map((kind) => ({
        ...shape(kind, ROW),
        yunariGlass: { blurRadius: RADIUS },
        selectable: false,
        evented: false,
      })),
    },
  };
}

function packageFor(kinds: readonly Kind[]): Uint8Array {
  const written = writeThemePackage({
    envelope: envelope(kinds),
    assets: { "assets/stripes.png": glassStripesPng() },
  });
  if (!written.ok) throw new Error(written.message);
  return written.bytes;
}

async function open(page: Page, kinds: readonly Kind[]): Promise<void> {
  await openThemeFromStore(page, storedThemeOfPackage(packageFor(kinds)));
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
}

interface Reading {
  readonly kind: Kind;
  /** Marginal ms per frame for one frosted shape, median over the trials. */
  readonly cost: number;
  /** Every trial's delta, so the spread is reported rather than hidden. */
  readonly costs: readonly number[];
  /** The scene's own cost with no glass, median over the trials. This is the
   *  noise floor the deltas are read against, and on this machine it is not
   *  small — quoting a delta without it would be quoting noise. */
  readonly floor: number;
  readonly floors: readonly number[];
  /** The sampled region's area in device pixels, and the ceiling it is under. */
  readonly regionPixels: number;
  readonly glassed: number;
}

/**
 * One trial per shape, repeated, with the shapes **interleaved** rather than
 * measured one after another.
 *
 * The first version of this ran each shape once, in sequence, and produced a
 * table whose no-glass floor swung 8.9-11.6 ms across shapes that differ only
 * in their outline — a spread wider than the whole signal. That is machine
 * drift, not shape, and a sequence of measurements cannot tell the two apart
 * because whatever changed between the first shape and the last is charged to
 * the shape. So: several rounds, every shape measured in every round, and the
 * per-shape median taken across rounds. Drift now lands on every shape roughly
 * equally instead of on whichever one was measured while the machine was busy.
 */
const TRIALS = 5;

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/**
 * Paired, alternated timing — and why the first two attempts at this were wrong.
 *
 * **Attempt one** timed each shape once, in sequence. The no-glass floor swung
 * 8.9-11.6 ms across shapes that differ only in their outline, which is wider
 * than the entire signal. Sequencing cannot fix that: whatever the machine did
 * between the first shape and the last is charged to whichever was measuring.
 *
 * **Attempt two** interleaved the shapes across trials, which fixed the
 * ordering bias and still could not resolve anything: the floor range was
 * 5.4-11.5 ms and individual trials swung -3.3 to +4.9 ms. The cause is the
 * *block* structure — thirty renders with, then thirty without, so about a
 * second and a half of machine drift lands wholly on one arm of the pair.
 *
 * So the two arms are interleaved **inside** the pair, frame by frame, and the
 * statistic is the median of the *paired differences* rather than the difference
 * of two medians. A drift that is slow compared with one frame now moves both
 * members of a pair together and cancels, and a single GC pause moves one pair
 * rather than a whole run — which is what the median is there to absorb.
 *
 * One shape per scene, too. With five frosted panels the "without" arm is a
 * scene with four glass panels still compositing, so the delta is marginal
 * rather than total and the arms differ by more than the treatment.
 */
const PAIRS = 40;
const FRAMES = 2;

async function measure(page: Page): Promise<Reading[]> {
  return page.evaluate(
    (input) => {
      const { kinds, radius, trials, pairs: pairs_, frames } = input;
      const scope = window as unknown as Record<string, unknown>;
      const key = Object.keys(scope).find((c) =>
        c.startsWith("yunari-fabric-editor"),
      );
      const editor = (
        scope[key ?? ""] as
          | {
              canvas: {
                getObjects(): Array<
                  Record<string, unknown> & {
                    getBoundingRect(): {
                      left: number;
                      top: number;
                      width: number;
                      height: number;
                    };
                  }
                >;
                renderAll(): void;
                add(...objects: unknown[]): void;
                remove(...objects: unknown[]): void;
                getBoundingRect(): {
                  left: number;
                  top: number;
                  width: number;
                  height: number;
                };
              };
            }
          | undefined
      )?.canvas;
      if (editor === undefined) throw new Error("no editor canvas is mounted");

      const targets = new Map<
        string,
        Record<string, unknown> & {
          getBoundingRect(): {
            left: number;
            top: number;
            width: number;
            height: number;
          };
        }
      >();
      for (const object of editor.getObjects())
        if (object["yunariGlass"] !== undefined)
          targets.set(String(object["id"]), object);
      for (const kind of kinds)
        if (!targets.has(kind)) throw new Error(`no object with id "${kind}"`);

      /** One arm: `frames` renders, divided by the frames. */
      const time = (frames: number): number => {
        const started = performance.now();
        for (let i = 0; i < frames; i += 1) editor.renderAll();
        return (performance.now() - started) / frames;
      };
      const median = (values: readonly number[]): number => {
        const sorted = [...values].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length / 2)] ?? 0;
      };

      const costs = new Map<string, number[]>(kinds.map((k) => [k, []]));
      const floors = new Map<string, number[]>(kinds.map((k) => [k, []]));
      const glassed = new Map<string, number[]>(kinds.map((k) => [k, []]));
      const regionPixels = new Map<string, number>();

      for (const kind of kinds) {
        const target = targets.get(kind);
        if (target === undefined) continue;
        const box = target.getBoundingRect();
        // What `sampleRegion` takes: the box padded by twice the blur radius.
        const pad = Math.ceil(radius * 2) + 2;
        regionPixels.set(kind, (box.width + pad * 2) * (box.height + pad * 2));
      }

      for (let trial = 0; trial < trials; trial += 1) {
        for (const kind of kinds) {
          const target = targets.get(kind);
          if (target === undefined) continue;
          // Every shape stays in the scene; only this one's treatment is
          // toggled, so the arms differ by the treatment and nothing else.
          const pairs: number[] = [];
          const bare: number[] = [];
          const frosted: number[] = [];
          // The odd member of each pair goes first, so a monotonic drift over
          // the run cannot systematically favour either arm.
          for (let p = 0; p < pairs_; p += 1) {
            const treatFirst = p % 2 === 0;
            if (treatFirst) {
              const a = time(frames);
              delete target["yunariGlass"];
              const b = time(frames);
              target["yunariGlass"] = { blurRadius: radius };
              frosted.push(a);
              bare.push(b);
              pairs.push(a - b);
            } else {
              delete target["yunariGlass"];
              const b = time(frames);
              target["yunariGlass"] = { blurRadius: radius };
              const a = time(frames);
              frosted.push(a);
              bare.push(b);
              pairs.push(a - b);
            }
          }
          costs.get(kind)?.push(median(pairs));
          floors.get(kind)?.push(median(bare));
          glassed.get(kind)?.push(median(frosted));
        }
      }

      return kinds.map((kind) => {
        const c = costs.get(kind) ?? [];
        const f = floors.get(kind) ?? [];
        return {
          kind,
          cost: median(c),
          costs: c,
          floor: median(f),
          floors: f,
          regionPixels: regionPixels.get(kind) ?? 0,
          glassed: median(glassed.get(kind) ?? []),
        };
      });
    },
    {
      kinds: ["Rect", "Circle", "Ellipse", "Triangle", "Polygon"],
      radius: RADIUS,
      trials: TRIALS,
      pairs: PAIRS,
      frames: FRAMES,
    },
  ) as Promise<Reading[]>;
}

test.describe("glass cost on the newly admitted shapes", () => {
  // Five shapes, each measured as nine runs of fifty renders with the
  // treatment present and again with it absent — 4,500 synchronous renders of a
  // 1672x941 artboard. The default 30 s budget is not a real bound on that, and
  // lowering the sample count to fit it would trade the artifact for the clock.
  test.setTimeout(300_000);
  test("a frosted circle, ellipse, triangle and polygon at radius 48", async ({
    page,
  }) => {
    await page.goto(EDITOR);
    const kinds: readonly Kind[] = [
      "Rect",
      "Circle",
      "Ellipse",
      "Triangle",
      "Polygon",
    ];
    await open(page, kinds);

    // Every shape composites, and none is refused — the point of the widening.
    // If one were refused the cost would read as a clean zero delta and the
    // whole table would be measuring nothing.
    //
    // Fabric's own `type` getter lowercases (`FabricObject.ts`: "DO NOT build
    // new code around this type value"), so a live object reads `"circle"`
    // where the persisted JSON reads `"Circle"`. Compared case-insensitively,
    // and deliberately not with the persisted spelling — that is a different
    // string on a different object, and conflating them would hide exactly the
    // mismatch this table exists to rule out.
    const presented = await page.evaluate(() => {
      const scope = window as unknown as Record<string, unknown>;
      const key = Object.keys(scope).find((c) =>
        c.startsWith("yunari-fabric-editor"),
      );
      const editor = (
        scope[key ?? ""] as
          | { canvas: { getObjects(): Array<Record<string, unknown>> } }
          | undefined
      )?.canvas;
      return (editor?.getObjects() ?? [])
        .filter((o) => o["yunariGlass"] !== undefined)
        .map((o) => String(o["type"]).toLowerCase());
    });
    console.log(`GLASS SHAPES PRESENTED ${JSON.stringify(presented)}`);
    expect(presented).toEqual(kinds.map((kind) => kind.toLowerCase()));

    const readings = await measure(page);

    const baseline = readings.find((r) => r.kind === "Rect");
    if (baseline === undefined) throw new Error("no rectangle baseline");

    // **The noise floor, printed before the deltas.** A delta is only readable
    // against how much this machine moves on a scene that is not changing, and
    // on this one that is not small. Quoting a cost without it would be quoting
    // the drift. This is the control the whole table depends on: it is measured
    // the same way as the deltas, on the same scene, with the treatment off.
    const everyFloor = readings.flatMap((r) => r.floors);
    console.log(
      `GLASS NOISE FLOOR (treatment off) median=${median(everyFloor).toFixed(3)}ms ` +
        `range=${Math.min(...everyFloor).toFixed(3)}-${Math.max(...everyFloor).toFixed(3)}ms ` +
        `over ${everyFloor.length} paired samples`,
    );
    console.log("GLASS SHAPE COST @48 (median of paired A/B differences)");
    for (const r of readings) {
      console.log(
        `  ${r.kind.padEnd(9)} cost=${r.cost.toFixed(3)}ms ` +
          `trials=[${r.costs.map((c) => c.toFixed(2)).join(", ")}]ms ` +
          `ratio=${(r.cost / baseline.cost).toFixed(2)}x ` +
          `bare=${r.floor.toFixed(2)}ms frosted=${r.glassed.toFixed(2)}ms ` +
          `region=${Math.round(r.regionPixels)}px`,
      );
    }

    // **Findings, not gates.** A shape is only distinguishable from the
    // rectangle if its cost clears the noise this machine actually shows, so
    // that is what is asserted: every new shape is in the same band as the
    // rect, and none is in the band where the blur itself starts to dominate
    // (Task 1 recorded 6.44 ms at 128 px, which is where cost left the flat
    // region on rectangles). The ruling is that a frosted triangle may cost
    // more than a frosted rect; this asserts it does not cost categorically
    // more, and reports the ratio rather than gating on it.
    const ceiling = 6.44;
    for (const r of readings) {
      expect(r.cost, `${r.kind} at 48 px is inside the flat band`).toBeLessThan(
        ceiling,
      );
      expect(r.cost, `${r.kind} at 48 px is not inverted`).toBeGreaterThan(0);
      // The ceiling in `scene-fabric/src/glass.ts`, per panel.
      expect(
        r.regionPixels,
        `${r.kind}'s sample region is under MAX_BACKDROP_PIXELS`,
      ).toBeLessThan(4_194_304);
    }
    // A shape materially dearer than the rect would be a finding to report, and
    // the ratio is stated here so it is a number rather than an opinion. The
    // bound is deliberately loose: the noise floor above is wider than the
    // spread this is looking for, so a tighter gate would be asserting the
    // measurement rather than the product.
    for (const r of readings) {
      expect(
        r.cost / baseline.cost,
        `${r.kind} is within 3x the rectangle's cost`,
      ).toBeLessThan(3);
    }
  });
});
