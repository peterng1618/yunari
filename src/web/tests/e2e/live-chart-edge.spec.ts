import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, type Page, type Request, test } from "@playwright/test";
import { HOST_PORT } from "./host-theme.js";

/**
 * **A probe, not a proof** — the per-frame reader `vg-571` needs before any fix.
 *
 * The report is that a live line chart's right edge corrects itself and its left
 * edge drops points early. Both are claims about *motion*, and no assertion
 * about a single option object can see motion: the axis window, the series'
 * timestamps and the chart's rect all have to be read on the same frame, many
 * frames in a row. This records that series and writes it to a file; the reading
 * is the evidence, and what it shows decides whether there is anything to fix.
 *
 * **The axis edge is the visible edge.** `YunariChart._render` blits the whole
 * ECharts canvas, whose width is the authored box at raster scale; the axis's
 * right end and the visible surface end together. `convertToPixel` is the
 * engine's own mapping, so the pixel column of a timestamp is measured rather
 * than recomputed here.
 *
 * **Opt-in, because it is a measurement and not a check.** It costs about
 * 100 seconds, it asserts nothing about the defect it reads, and nothing in the
 * repository consumes what it writes — so a regression at either edge would
 * leave it green. It is collected only when `YUNARI_EDGE_PROBE` is set (the
 * `phone-host` project in `playwright.config.ts` states the gate), and it writes
 * its readings to `<os temp>/yunari-live-edge/<YUNARI_PROBE_TAG>.json` —
 * `reading.json` when the tag is unset, and the absolute path is named in the
 * run's own output. One run:
 *
 * ```
 * YUNARI_EDGE_PROBE=1 YUNARI_PROBE_TAG=my-run \
 *   npx playwright test --project=phone-host live-chart-edge.spec.ts
 * ```
 *
 * The file name is relative to `testDir`, not to the repository root. And run
 * `@playwright/test`'s own CLI: `@playwright/mcp`'s `playwright` dependency
 * hoists a different minor over `node_modules/.bin/playwright`, and the alpha
 * runner cannot collect a spec that imported the pinned one.
 */

const HOST = `http://127.0.0.1:${HOST_PORT}`;
/** The theme id a save's PUT URL names, which is the document's own id. */
const themeIdOfSave = (request: Request): string =>
  decodeURIComponent(new URL(request.url()).pathname.split("/").at(-1) ?? "");
/** The reference composition's performance chart: three live series, axes on. */
const CHART_NODE_ID = "trends-chart";
/** Long enough for the 61 s window to fill, so the LEFT edge is observable. */
const RUN_MS = 80_000;

/** The readings file, outside the repository. Named per run so a second run
    does not overwrite the first — before and after are two files. */
const OUT = path.join(
  tmpdir(),
  "yunari-live-edge",
  `${process.env["YUNARI_PROBE_TAG"] ?? "reading"}.json`,
);

/**
 * The starter, saved through the host's own library route.
 *
 * Duplicated from `host-player.spec.ts` rather than imported: that file's
 * helper is local, and exporting it would put this spec's needs into a file
 * every other display spec reads.
 */
async function saveStarterThroughTheHost(page: Page): Promise<string> {
  await page.goto(`${HOST}/editor/`);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "New from starter" }).click();
  await expect(page.locator("#status")).toContainText(
    "New theme from the starter",
  );
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
  return themeIdOfSave(await saved);
}

test.describe("the live line chart's edge", () => {
  // The conditional form is only valid inside a describe or a test; at file
  // scope Playwright threw "No tests found" instead of skipping.
  test.skip(
    process.env["YUNARI_EDGE_PROBE"] === undefined,
    "a measurement, not a check: set YUNARI_EDGE_PROBE to collect it",
  );

  test("a per-frame reading of the axis window, the series and the rect", async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    await page.addInitScript(() => {
      const frames: unknown[] = [];
      Reflect.set(window, "__yunariEdge", frames);
      const globals = window as unknown as {
        yunari?: {
          handle?: { canvas?: { getObjects(): unknown[] } };
          live?: { batchCount?: number };
        };
      };

      const read = (object: {
        family?: string;
        option?: Record<string, unknown>;
        width: number;
        height: number;
        renderScale: number;
        getBoundingRect(): {
          left: number;
          top: number;
          width: number;
          height: number;
        };
        _chart?: { convertToPixel(finder: unknown, value: number): number };
        _element?: { width: number };
      }): void => {
        const option = object.option;
        const axis = option?.["xAxis"] as
          | { min: number; max: number }
          | undefined;
        const series = option?.["series"] as
          | readonly { data: readonly (readonly [number, number | null])[] }[]
          | undefined;
        if (axis === undefined || series === undefined) return;

        const engine = object._chart;
        const toPixel = (time: number | undefined): number | null => {
          if (time === undefined || engine === undefined) return null;
          try {
            return engine.convertToPixel({ xAxisIndex: 0 }, time);
          } catch {
            return null;
          }
        };

        const readings = series.map((one) => {
          const times = one.data.map((point) => point[0]);
          const seen = new Map<number, number>();
          for (const time of times) seen.set(time, (seen.get(time) ?? 0) + 1);
          const repeated = [...seen.entries()]
            .filter(([, count]) => count > 1)
            .map(([time, count]) => ({ time, count }));
          return {
            points: times.length,
            first: times[0] ?? null,
            second: times[1] ?? null,
            last: times.at(-1) ?? null,
            distinct: seen.size,
            repeated,
            nulls: one.data.filter((point) => point[1] === null).length,
            tail: times.slice(-4),
          };
        });
        const last = readings[0]?.last ?? undefined;
        const rect = object.getBoundingRect();

        frames.push({
          at: Date.now(),
          family: object.family ?? null,
          batches: globals.yunari?.live?.batchCount ?? null,
          axisMin: axis.min,
          axisMax: axis.max,
          grid: option?.["grid"] as unknown,
          readings,
          width: object.width,
          height: object.height,
          renderScale: object.renderScale,
          canvasWidth: object._element?.width ?? null,
          visibleWidth: object._element?.width ?? null,
          pxMin: toPixel(axis.min),
          pxMax: toPixel(axis.max),
          pxFirst: toPixel(readings[0]?.first ?? undefined),
          pxSecond: toPixel(readings[0]?.second ?? undefined),
          pxLast: toPixel(last ?? undefined),
          rect: {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          },
        });
      };

      const walk = (objects: readonly unknown[]): void => {
        for (const object of objects) {
          try {
            read(object as Parameters<typeof read>[0]);
          } catch {
            /* a chart mid-teardown is not a reading */
          }
          const group = object as { getObjects?: () => unknown[] };
          if (typeof group.getObjects === "function") walk(group.getObjects());
        }
      };

      const tick = (): void => {
        // The reading is one interval long, and a frame loop left running after
        // it holds the renderer at 100% while Playwright tears the context
        // down — measured, a ten-minute hang after the file was written.
        if (
          (window as unknown as { __yunariEdgeStop?: boolean })
            .__yunariEdgeStop === true
        ) {
          return;
        }
        try {
          const canvas = globals.yunari?.handle?.canvas;
          if (canvas !== undefined) walk(canvas.getObjects());
        } catch {
          /* the scene is not mounted yet */
        }
        window.requestAnimationFrame(tick);
      };
      window.requestAnimationFrame(tick);
    });

    const themeId = await saveStarterThroughTheHost(page);
    // `this-pc`: the host refuses to mint a record for this PC, so this is the
    // display the page is served as. The scene cadence is the same 30 fps for
    // every display now (0129), so the rate no longer decides what is measured
    // here — the line's edge does.
    await page.goto(`${HOST}/?theme=${themeId}&data=live`);
    await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (
                window as unknown as {
                  yunari?: { live?: { batchCount?: number } };
                }
              ).yunari?.live?.batchCount ?? 0,
          ),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(2);

    await page.waitForTimeout(RUN_MS);

    const frames = await page.evaluate(() => {
      const probe = window as unknown as {
        __yunariEdge?: unknown[];
        __yunariEdgeStop?: boolean;
      };
      // Stop the beat and release the page's copy: the array crossing the
      // boundary is the only one that needs to exist (see `tick`).
      probe.__yunariEdgeStop = true;
      const captured = (probe.__yunariEdge ?? []).slice();
      if (probe.__yunariEdge !== undefined) probe.__yunariEdge.length = 0;
      return captured;
    });

    mkdirSync(path.dirname(OUT), { recursive: true });
    writeFileSync(
      OUT,
      JSON.stringify(
        {
          origin: HOST,
          viewport: page.viewportSize(),
          chart: CHART_NODE_ID,
          runMs: RUN_MS,
          frames,
        },
        null,
        1,
      ),
    );

    expect(frames.length, `readings written to ${OUT}`).toBeGreaterThan(100);
    expect(testInfo.project.name).toBeTruthy();

    // The canvas is the authored box now, so the axis edge is the visible edge.
    type Frame = {
      at: number;
      family: string | null;
      axisMax: number;
      canvasWidth: number;
      visibleWidth: number;
      pxMax: number;
      readings: { last: number | null; nulls: number }[];
      rect: { left: number; top: number; width: number; height: number };
    };
    const live = (frames as Frame[]).filter(
      (frame) =>
        frame.canvasWidth > 0 &&
        frame.readings.length > 0 &&
        frame.readings[0]?.last !== null,
    );
    expect(live.length, `readings written to ${OUT}`).toBeGreaterThan(100);

    // Counted, not asserted per frame. A `expect` per reading is ~10⁵ matcher
    // constructions on this reading, and that synchronous block outlived the
    // 240 s timeout: the run wrote its file and then hung with no verdict.
    let widths = 0;
    let pixels = 0;
    for (const frame of live) {
      if (frame.canvasWidth !== frame.visibleWidth) widths += 1;
      if (frame.pxMax < 0 || frame.pxMax > frame.canvasWidth) pixels += 1;
    }

    // Each line's axis ends at its newest reading and never moves backwards;
    // nothing may be held past it, and no reading may be dropped as a null
    // (0124).
    const lines = new Map<string, Frame[]>();
    for (const frame of live) {
      if (frame.family !== "line") continue;
      const key = `${frame.rect.left},${frame.rect.top},${frame.rect.width},${frame.rect.height}`;
      lines.set(key, [...(lines.get(key) ?? []), frame]);
    }
    let nulls = 0;
    let edgesOff = 0;
    let backwards = 0;
    for (const framesOfLine of lines.values()) {
      for (let index = 0; index < framesOfLine.length; index += 1) {
        const frame = framesOfLine[index]!;
        for (const reading of frame.readings) {
          nulls += reading.nulls;
          if (reading.last !== null && frame.axisMax !== reading.last) {
            edgesOff += 1;
          }
        }
        if (index === 0) continue;
        const previous = framesOfLine[index - 1]!;
        if (frame.axisMax < previous.axisMax) backwards += 1;
        if (frame.readings[0]!.last! < previous.readings[0]!.last!) {
          backwards += 1;
        }
      }
    }

    expect(lines.size, `readings written to ${OUT}`).toBeGreaterThan(0);
    expect(widths, "every canvas is its authored box").toBe(0);
    expect(pixels, "the axis edge stays on the canvas").toBe(0);
    expect(nulls, "no reading is dropped as a null").toBe(0);
    expect(edgesOff, "every axis ends at its newest reading").toBe(0);
    expect(backwards, "no edge moves backwards").toBe(0);
  });
});
