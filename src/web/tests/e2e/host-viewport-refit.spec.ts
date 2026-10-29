import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  HOST_OVERHANG_THEME_ID,
  HOST_PORT,
  HOST_THEMES_DIR,
} from "./host-theme.js";

/**
 * **A probe, not a proof** — the per-frame reader `vg-572` needs before any fix.
 *
 * The report is that a phone player's composition slides left. The leading
 * candidate is the phone's own browser chrome: hiding or showing it changes the
 * viewport height, `player/src/main.ts`'s `ResizeObserver` sees a host box change
 * and `handle.resize()` re-fits, recomputing both the scale and the centring
 * offset. Whether that re-fit is a defect, or is exactly what a viewport change
 * should do, is not answerable by reading `main.ts`: it is answerable by driving
 * the height and watching what moves.
 *
 * **Why the pixels are read as well as the transform.** The transform says what
 * the fit computed; the pixels say what a reader saw. It is the scene handle's
 * `transform()`, not the canvas's `viewportTransform` read back — the two agree
 * because the player never pans, and the handle is the one carrying the fit the
 * renderer decided. `vg-028`'s own record is why the pixel half is a *sum of
 * absolute differences over a window* and not a count of ink: the card is opaque
 * and the sampled rect includes the dark backdrop, so counting ink reported every
 * column as drawn and every column as dark. The window is ±48 profile indices at
 * `STEP = 2`, so **±96 canvas px**; the centroid beside it is converted to CSS
 * px, so the two readings coincide only at DPR 1.
 *
 * **A lag frame is not a slide, and both pixel readings say otherwise on one.**
 * Every drive produces two frames: the host box moves, and the re-fit lands
 * 15–18 ms later. In between, the canvas is still the old size, so the picture is
 * CSS-stretched inside a stale backing store and SAD and the centroid both report
 * that stretch rather than a move — up to ±50 px of SAD and −45.3/+10.8 px of
 * centroid across the runs taken here. The **steady state on either side** is the
 * reading: there the SAD shift is 0 and the centroid delta is 0 on every slice
 * with contrast, and it is the lag frames alone that are not.
 *
 * **SAD models translation, so a second pixel reading is taken beside it.** A
 * height change on a *height-limited* artboard does not translate the
 * composition: it scales it about the centre, which no single shift describes.
 * Each slice therefore also reports the x centroid of its bright ink — a
 * position, not a count, so it moves when the picture contracts and it is the
 * number a slide is measured in.
 *
 * **Why the slices follow the composition rather than a fixed `y`.** A height
 * change on a width-limited artboard moves the composition *vertically* by half
 * the delta without changing its scale at all. A fixed `y` would then compare
 * two different rows and report a horizontal slide that is really a vertical
 * one. Each slice is therefore read at the same *fraction* of the painted
 * artboard's own box, which maps to the same artboard content at every viewport
 * size, and a positive `dx` is content that moved right.
 *
 * **Opt-in, because it is a measurement and not a check.** It costs about two
 * minutes, it asserts nothing about the defect it reads, and nothing in the
 * repository consumes what it writes — so a regression would leave it green. It
 * is collected only when `YUNARI_VIEWPORT_PROBE` is set, and it writes its
 * readings to
 * `<os temp>/yunari-viewport-refit/<YUNARI_PROBE_TAG>-<project>-<recording>.json`
 * — `reading-…` when the tag is unset, and the absolute path is named in the
 * run's own output. One run:
 *
 * ```
 * YUNARI_VIEWPORT_PROBE=1 YUNARI_PROBE_TAG=my-run npx playwright test \
 *   --project=desktop-chromium --workers=1 tests/e2e/host-viewport-refit.spec.ts
 * ```
 *
 * It names a project because `playwright.config.ts`'s host projects select by
 * file name and this file is not one of them, so a bare invocation would run it
 * once per preview project. It still starts the real host either way: the
 * `webServer` list is the config's, not a project's.
 *
 * **What it read, on `e2e-bleed` (640×360) served by the real host, one 54 s
 * recording per viewport** — the theme is now `e2e-overhang`, the same
 * composition with the deliberate bleed mark removed,
 * so a later run is comparable frame for frame with the numbers below. In the
 * steady state on either side of each drive a
 * driven height change re-fits and returns exactly, and the re-fit lands 15–18 ms
 * (one frame) after the box moves.
 * *Landscape 844×390*, where the artboard is height-limited: the host box goes
 * 844×361.203 → 844×301.203 and the fit goes scale 1.002778 → 0.836111 with
 * offsetX 101.1111 → 154.4444, so the composition contracts about its centre —
 * `stray-quarter` 40.9444 → 104.2778 px, `bleeding-quarter` 522.2778 → 505.6111,
 * `open-arc` 201.3889 → 238.0556 — and 100 px of bar moves the outermost object
 * 105.56 px. *Portrait 390×844*, where it is width-limited: scale stays 0.609375
 * and offsetX stays 0, and only offsetY moves, by exactly half the delta
 * (289.3125 → 259.3125 for 60 px, → 239.3125 for 100), so nothing moves
 * horizontally at all. Both return to the baseline transform and to the same
 * object rects to the last recorded decimal, and at rest nothing flaps: 16.2 s
 * and 16.7 s uninterrupted with zero layout changes. The transport notice leaving
 * at t=396 ms changed no box and no transform, which is the control that a notice
 * is distinguishable from a viewport change rather than assumed absent.
 *
 * **What it refutes, and what it does not.** These readings refute the viewport
 * as the *mechanism* behind a left slide on a portrait phone — a height change
 * there cannot move the composition horizontally at all. They do not explain the
 * user's observation and **do not close `vg-572`**. What the same recording did
 * still show moving the composition was permanent chrome: on the landscape run the
 * crop strip taking its room at mount moved `stray-quarter` +30.6111 px,
 * `bleeding-quarter` −8.0556 px and `open-arc` +17.7222 px at t=102, the frame
 * before the fit at t=116 and long before the baseline at t≈9068 — which is
 * exactly why the reading above excluded it.
 *
 * **The strip is gone, and the mount frames are what the next run reads.**
 * Task 25.7 removed the crop notice (`vg-578`), so the
 * frames before the baseline are the reading `vg-572` waits on: the composition
 * must hold still where a strip used to take room. The instrument is unchanged,
 * which is what makes the two runs comparable — the frames, the slices and the
 * object rects are recorded the same way, and only the display's chrome differs.
 *
 * **The reading, taken 2026-10-18 on `e2e-overhang` (`task-25.7`), against the
 * same probe on `e2e-bleed` before the removal.** Portrait: 539 frames between
 * the first mount frame (t=261) and the baseline, and every one of them carries
 * one value of `tr.oy` (312.3125), one painted height (219.375) and one `sy` per
 * object — nothing moved. Landscape: 537 mounted frames from t=94, likewise one
 * value each (scale 1.0833333333333333, ox 75.33333333333337, painted 390). The
 * pre-removal run on the same probe had **two** values of each over the same
 * window — portrait `tr.oy` 289.3125 → 312.3125 with every object's `sy` moving
 * 23 px (394.46875 → 371.46875), landscape painted 361 → 390 with scale and ox
 * both changing — and its first mount frame carried a `yunari-crop` strip of
 * height 45.59375 taking that room. Across the whole new run no frame carries a
 * `yunari-crop` strip at all, where both old runs carried one in 3249 frames.
 * The transport notice is still there in the new run (h=28.796875 at the first
 * mount frame) and moves nothing, which is the control that a notice taking no
 * room is what the reading is about rather than a quiet display.
 */

const HOST = `http://127.0.0.1:${HOST_PORT}`;

/** The readings file, outside the repository. Named per run and per project so
    a second run does not overwrite the first, and so two projects collecting
    the same recording cannot write one file — before and after are two files. */
function outFile(recording: string, project: string): string {
  return path.join(
    tmpdir(),
    "yunari-viewport-refit",
    `${process.env["YUNARI_PROBE_TAG"] ?? "reading"}-${project}-${recording}.json`,
  );
}

test.skip(
  process.env["YUNARI_VIEWPORT_PROBE"] === undefined,
  "a measurement, not a check: set YUNARI_VIEWPORT_PROBE to collect it",
);

/**
 * The artboard a fixture declares, read from the package the host serves.
 *
 * The reader needs it to know where the painted composition is: the transform
 * gives the scale and the offsets, and the artboard's own size is what turns
 * them into a box. Read from disk rather than from `/api/themes` so the spec
 * measures the same bytes the host does.
 */
function artboardOf(themeId: string): { width: number; height: number } {
  const file = path.join(HOST_THEMES_DIR, themeId, "theme.json");
  const envelope = JSON.parse(readFileSync(file, "utf8")) as {
    artboard: { width: number; height: number };
  };
  return { width: envelope.artboard.width, height: envelope.artboard.height };
}

/** The built player's own file names, so a reading names the bundle it read.
    Vite's asset names carry a content hash, which is the build's identity. */
function playerBundle(): readonly string[] {
  try {
    return readdirSync(
      path.join(process.cwd(), "packages", "player", "dist", "assets"),
    );
  } catch {
    return [];
  }
}

interface Drive {
  readonly label: string;
  /** The height the viewport is moved *to*, before it is moved back. */
  readonly to: number;
}

/**
 * The per-frame reader, installed before any page script runs.
 *
 * Geometry is read every animation frame; the pixels are read every fourth one,
 * because a full-canvas `getImageData` is a GPU readback and doing it 60 times a
 * second would perturb the very frame rate it is measuring. The achieved frame
 * count is reported, so an instrument that slowed the page down says so.
 */
async function installReader(
  page: Page,
  artboard: { width: number; height: number },
): Promise<void> {
  await page.addInitScript((size) => {
    /** Fractions of the painted artboard's height, so a slice always lands on
        the same authored content whatever the viewport is doing. */
    const SLICES = [0.2, 0.32, 0.44, 0.56, 0.68, 0.8];
    /** Profile indices, not pixels: at `STEP = 2` the SAD window is ±96 canvas
        px, which is what a shift reading is in. */
    const MAX_SHIFT = 48;
    const STEP = 2;
    const PIXEL_EVERY = 4;

    interface Point {
      readonly scale: number;
      readonly offsetX: number;
      readonly offsetY: number;
    }
    interface Box {
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
    }

    interface Slice {
      readonly profile: Float64Array;
      /** Where the bright ink sits in this row, in CSS px, or null on a row
          with no contrast to find it in. */
      readonly centroid: number | null;
    }

    const state = {
      frames: [] as unknown[],
      marks: [] as { label: string; at: number }[],
      baseline: null as Slice[] | null,
      baselineCentroids: [] as (number | null)[],
      pixelSamples: 0,
    };
    Reflect.set(window, "__yunariRefit", state);
    Reflect.set(window, "__yunariRefitMark", (label: string) => {
      state.marks.push({ label, at: performance.now() });
    });
    Reflect.set(window, "__yunariRefitCapture", () => {
      state.baseline = slices();
      state.baselineCentroids = state.baseline.map((one) => one.centroid);
    });

    const host = (): HTMLElement | null =>
      document.querySelector<HTMLElement>("#artboard");
    const canvasEl = (): HTMLCanvasElement | null =>
      document.querySelector<HTMLCanvasElement>(
        "#artboard canvas.lower-canvas",
      );

    function transform(): Point | null {
      const handle = (
        window as unknown as {
          yunari?: { handle?: { transform(): Point } };
        }
      ).yunari?.handle;
      if (handle === undefined) return null;
      try {
        return handle.transform();
      } catch {
        return null;
      }
    }

    function rect(element: Element): Box {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, w: box.width, h: box.height };
    }

    /** The painted artboard, in CSS px relative to the canvas element. */
    function painted(point: Point): Box {
      return {
        x: point.offsetX,
        y: point.offsetY,
        w: size.width * point.scale,
        h: size.height * point.scale,
      };
    }

    /** One luminance profile per slice, all taken from a single readback. */
    function slices(): Slice[] {
      const element = canvasEl();
      const point = transform();
      if (element === null || point === null) return [];
      const context = element.getContext("2d");
      if (context === null) return [];

      const width = element.width;
      const height = element.height;
      if (width === 0 || height === 0) return [];

      const hostBox = host()?.getBoundingClientRect();
      const scaleY =
        hostBox === undefined || hostBox.height === 0
          ? 1
          : height / hostBox.height;

      let pixels: Uint8ClampedArray;
      try {
        pixels = context.getImageData(0, 0, width, height).data;
      } catch {
        // A tainted surface is not readable; the geometry half still is.
        return [];
      }

      const box = painted(point);
      const toCss =
        hostBox === undefined || width === 0 ? 1 : 1 / (width / hostBox.width);
      const out: Slice[] = [];
      for (const fraction of SLICES) {
        const y = Math.round((box.y + fraction * box.h) * scaleY);
        const profile = new Float64Array(Math.ceil(width / STEP));
        let low = Number.POSITIVE_INFINITY;
        let high = Number.NEGATIVE_INFINITY;
        for (let x = 0; x < width; x += STEP) {
          let sum = 0;
          let n = 0;
          for (let dy = -1; dy <= 1; dy++) {
            const row = y + dy;
            if (row < 0 || row >= height) continue;
            const at = (row * width + x) * 4;
            sum +=
              0.2126 * (pixels[at] ?? 0) +
              0.7152 * (pixels[at + 1] ?? 0) +
              0.0722 * (pixels[at + 2] ?? 0);
            n += 1;
          }
          const value = n === 0 ? 0 : sum / n;
          profile[x / STEP] = value;
          if (value < low) low = value;
          if (value > high) high = value;
        }

        // The bright ink's centre of mass, which is a position rather than a
        // count: a picture that contracted has a different one, and a row with
        // no contrast at all reports null instead of inventing a position.
        let weighted = 0;
        let weight = 0;
        const threshold = (low + high) / 2;
        if (high - low > 8) {
          for (let x = 0; x < width; x += STEP) {
            const value = (profile[x / STEP] ?? 0) - threshold;
            if (value <= 0) continue;
            weighted += value * x;
            weight += value;
          }
        }
        out.push({
          profile,
          centroid: weight === 0 ? null : weighted / weight / toCss,
        });
      }
      state.pixelSamples += 1;
      return out;
    }

    /** How far right the current profile's content has moved, in CSS px, by
        sum of absolute differences over a +/- MAX_SHIFT window. Positive is
        right: content now at `i` was at `i - d` before, so the displacement is
        `-d * STEP`. */
    function shiftOf(current: Float64Array, base: Float64Array): number {
      let best = 0;
      let bestCost = Number.POSITIVE_INFINITY;
      for (let d = -MAX_SHIFT; d <= MAX_SHIFT; d++) {
        let sum = 0;
        let n = 0;
        for (let i = 0; i < current.length; i++) {
          const j = i + d;
          if (j < 0 || j >= base.length) continue;
          sum += Math.abs((current[i] ?? 0) - (base[j] ?? 0));
          n += 1;
        }
        if (n === 0) continue;
        const cost = sum / n;
        if (cost < bestCost) {
          bestCost = cost;
          best = d;
        }
      }
      return -best * STEP;
    }

    function objects(point: Point | null, hostBox: Box | null): unknown[] {
      const canvas = (
        window as unknown as {
          yunari?: {
            handle?: {
              canvas?: {
                getObjects(): readonly {
                  get(key: string): unknown;
                  getBoundingRect(): {
                    left: number;
                    top: number;
                    width: number;
                    height: number;
                  };
                  getObjects?(): readonly unknown[];
                }[];
              };
            };
          };
        }
      ).yunari?.handle?.canvas;
      if (canvas === undefined) return [];

      const seen: unknown[] = [];
      const walk = (list: readonly unknown[], depth: number): void => {
        for (const entry of list) {
          const object = entry as {
            get(key: string): unknown;
            getBoundingRect(): {
              left: number;
              top: number;
              width: number;
              height: number;
            };
            getObjects?(): readonly unknown[];
          };
          try {
            const id = object.get("id");
            const box = object.getBoundingRect();
            const scene = {
              id: typeof id === "string" ? id : null,
              l: box.left,
              t: box.top,
              w: box.width,
              h: box.height,
            };
            seen.push(
              point === null || hostBox === null || depth > 0
                ? scene
                : {
                    ...scene,
                    // The same box as a reader sees it: scene units through the
                    // canvas's own transform, plus the host's own offset.
                    sx: hostBox.x + point.offsetX + box.left * point.scale,
                    sy: hostBox.y + point.offsetY + box.top * point.scale,
                  },
            );
          } catch {
            /* an object mid-teardown is not a reading */
          }
          if (typeof object.getObjects === "function" && depth < 1) {
            walk(object.getObjects(), depth + 1);
          }
        }
      };
      walk(canvas.getObjects(), 0);
      return seen;
    }

    let counter = 0;
    const tick = (): void => {
      counter += 1;
      try {
        const hostEl = host();
        const element = canvasEl();
        const point = transform();
        const hostBox = hostEl === null ? null : rect(hostEl);

        let shifts: (number | null)[] = [];
        let centroids: (number | null)[] = [];
        if (counter % PIXEL_EVERY === 0) {
          const current = slices();
          const base = state.baseline;
          centroids = current.map((one) => one.centroid);
          if (base !== null && current.length === base.length) {
            shifts = current.map((one, index) =>
              shiftOf(one.profile, base[index]?.profile ?? new Float64Array()),
            );
          }
        }

        state.frames.push({
          t: Math.round(performance.now()),
          vw: window.innerWidth,
          vh: window.innerHeight,
          vvh: window.visualViewport?.height ?? null,
          host: hostBox,
          cw: element?.width ?? null,
          ch: element?.height ?? null,
          tr:
            point === null
              ? null
              : {
                  scale: point.scale,
                  ox: point.offsetX,
                  oy: point.offsetY,
                },
          painted: point === null ? null : painted(point),
          objects: objects(point, hostBox),
          strips: [
            ...document.querySelectorAll<HTMLElement>('[id^="yunari-"]'),
          ].map((strip) => ({ id: strip.id, ...rect(strip) })),
          shifts,
          centroids,
        });
      } catch {
        /* the scene is not mounted yet */
      }
      window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
  }, artboard);
}

const RECORDINGS = [
  { name: "portrait", viewport: { width: 390, height: 844 } },
  { name: "landscape", viewport: { width: 844, height: 390 } },
] as const;

for (const recording of RECORDINGS) {
  test(`the re-fit when a ${recording.name} phone's viewport height changes`, async ({
    context,
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    const artboard = artboardOf(HOST_OVERHANG_THEME_ID);
    const height = recording.viewport.height;

    await page.setViewportSize(recording.viewport);
    await installReader(page, artboard);

    const mark = (label: string): Promise<void> =>
      page.evaluate(
        (value) =>
          (
            window as unknown as {
              __yunariRefitMark?: (label: string) => void;
            }
          ).__yunariRefitMark?.(value),
        label,
      );

    await page.goto(`${HOST}/?theme=${HOST_OVERHANG_THEME_ID}&data=live`);
    await expect(page.locator("#artboard canvas.lower-canvas")).toBeVisible();
    // The stream must be live before the baseline: a strip arriving later is a
    // different mechanism, and this run is about the viewport.
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

    // Long enough for the mount to have settled — the frames before this are
    // the mount reading, and the baseline is the display at rest.
    await page.waitForTimeout(6_000);
    await page.evaluate(() =>
      (
        window as unknown as { __yunariRefitCapture?: () => void }
      ).__yunariRefitCapture?.(),
    );
    await mark("baseline");
    await page.waitForTimeout(8_000);
    await mark("rest");

    // The magnitudes a phone's URL bar actually moves: roughly 50-100 CSS px.
    const drives: readonly Drive[] = [
      { label: "urlbar-60", to: height - 60 },
      { label: "urlbar-100", to: height - 100 },
      { label: "urlbar-60-again", to: height - 60 },
    ];
    for (const drive of drives) {
      await mark(`${drive.label}:start`);
      await page.setViewportSize({
        width: recording.viewport.width,
        height: drive.to,
      });
      await page.waitForTimeout(2_500);
      await mark(`${drive.label}:short`);
      await page.setViewportSize({
        width: recording.viewport.width,
        height,
      });
      await page.waitForTimeout(2_500);
      await mark(`${drive.label}:restored`);
    }

    // The other recurring trigger the row names, driven as a control: a
    // reconnect raises a notice, and a notice must be distinguishable from a
    // viewport change rather than assumed absent.
    //
    // The network is taken away rather than the request intercepted. A live
    // `EventSource` is already open, so `page.route` sees no request to abort
    // and the display never notices — the first attempt at this drove nothing
    // and reported a quiet window it had not earned.
    await mark("reconnect:start");
    await context.setOffline(true);
    await page.waitForTimeout(6_000);
    await mark("reconnect:offline");
    await context.setOffline(false);
    await page.waitForTimeout(10_000);
    await mark("reconnect:restored");

    await page.waitForTimeout(6_000);
    await mark("rest2");

    const reading = await page.evaluate(() => {
      const state = (
        window as unknown as {
          __yunariRefit?: {
            frames: unknown[];
            marks: { label: string; at: number }[];
            baselineCentroids: (number | null)[];
            pixelSamples: number;
          };
        }
      ).__yunariRefit;
      return {
        frames: state?.frames ?? [],
        marks: state?.marks ?? [],
        baselineCentroids: state?.baselineCentroids ?? [],
        pixelSamples: state?.pixelSamples ?? 0,
      };
    });

    const out = outFile(recording.name, testInfo.project.name);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(
      out,
      JSON.stringify(
        {
          origin: HOST,
          theme: HOST_OVERHANG_THEME_ID,
          artboard,
          recording: recording.name,
          viewport: recording.viewport,
          playerBundle: playerBundle(),
          pixelSamples: reading.pixelSamples,
          baselineCentroids: reading.baselineCentroids,
          marks: reading.marks,
          frames: reading.frames,
        },
        null,
        1,
      ),
    );

    expect(reading.frames.length, `readings written to ${out}`).toBeGreaterThan(
      600,
    );
    expect(reading.pixelSamples).toBeGreaterThan(60);
  });
}
