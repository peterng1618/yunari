import { expect, type Page, test } from "@playwright/test";
import { clientOfScene, objectRect, sceneToClient } from "./editor-canvas.js";
import { openPane } from "./editor-rail.js";
import { isDesktopSurface } from "./surface.js";

/**
 * The artboard panel's crop figure while a drag is in progress.
 *
 * **The read is mid-drag, and that is the whole of the case.** Fabric fires
 * `object:moving` per frame during a gesture and `object:modified` only on
 * release, so a panel subscribed to the release alone prints a figure that is
 * stale for the entire drag and correct afterwards — and a case that reads after
 * `mouse.up()` passes on that panel, which is why the read sits before it.
 *
 * The figure is `scene-fabric`'s own count over the scene the panel re-reads, so
 * the assertion is on the number the author sees rather than on the event that
 * produced it: `[data-yunari-artboard-note]`'s text, not a `fire` spy.
 *
 * **The second assertion is the ruling's cost.** The subscription recomputes per
 * frame, which is real work on a gesture that already paints one, so the frame
 * the recompute rides is timed as well. A recompute that stopped fitting a frame
 * would fail here rather than quietly costing the drag its budget.
 */

const EDITOR = "http://127.0.0.1:4174/?mode=editor";

/** A starter card that begins well inside the 1672 × 941 board, so the drag has
 *  a real crossing to make rather than starting already cropped. */
const CARD = "group-ram-card";

/** How far past the board's right edge the card's own right edge must land.
 *  Far enough that no snap line is within `SNAP_THRESHOLD` (5 scene px) of it,
 *  so the gesture's own arithmetic is what the figure reports. */
const PAST_EDGE = 80;

/** One pointer step per frame, so the drag spans frames rather than arriving in
 *  one task — a per-event recompute and a coalesced one look identical
 *  otherwise. */
const STEPS = 24;

/** One 60 Hz frame. The budget the recompute has to fit inside. */
const FRAME_MS = 1000 / 60;

interface DragSample {
  /** The frame each `object:moving` dispatch asked for first: the canvas repaint
   *  the snapping step requests. */
  readonly repaint: readonly number[];
  /** The frame the same dispatch asked for second: the artboard panel's
   *  coalesced recompute. Empty on a panel that does not subscribe, which is
   *  what says this slot is the panel's rather than a second repaint. */
  readonly recompute: readonly number[];
  readonly moves: number;
}

/**
 * Times the frame callbacks a drag registers, with the two apart from each
 * other.
 *
 * **A frame interval would not answer this.** Chromium produces no frame for a
 * page with nothing to paint, so an interval says when a frame happened rather
 * than what it cost. A recompute coalesced onto a frame is a callback, so timing
 * callbacks times it.
 *
 * **The two are told apart at registration.** `canvas.fire` is bracketed for
 * `object:moving`, so a callback registered while the event is being dispatched
 * is one the event asked for. Two listeners register a frame inside that
 * bracket: the snapping step asks for the canvas repaint, and the artboard panel
 * asks for its recompute. The snapping step subscribes before the panel does, so
 * the first frame of a dispatch is the repaint and the second is the panel —
 * which the no-subscription build states directly, by registering a first and
 * no second.
 */
async function startSampling(page: Page): Promise<void> {
  await page.evaluate(() => {
    interface Canvas {
      on(e: string, h: () => void): void;
      off(e: string, h: () => void): void;
      fire(name: string, ...rest: unknown[]): unknown;
    }
    interface Sampler {
      repaint: number[];
      recompute: number[];
      moves: number;
      inDrag: boolean;
      registered: number;
      original: typeof window.requestAnimationFrame;
      originalFire: Canvas["fire"];
      canvas: Canvas;
      handler: (() => void) | undefined;
    }
    const w = window as unknown as { __yunariDrag?: Sampler };
    const original = window.requestAnimationFrame.bind(window);
    const canvas = (
      window as unknown as {
        yunariEditorBridge: { editor: { canvas: Canvas } };
      }
    ).yunariEditorBridge.editor.canvas;
    const sampler: Sampler = {
      repaint: [],
      recompute: [],
      moves: 0,
      inDrag: false,
      registered: 0,
      original,
      originalFire: canvas.fire.bind(canvas),
      canvas,
      handler: undefined,
    };
    sampler.handler = (): void => {
      sampler.moves += 1;
    };
    canvas.on("object:moving", sampler.handler);
    canvas.fire = (name: string, ...rest: unknown[]): unknown => {
      if (name !== "object:moving") return sampler.originalFire(name, ...rest);
      const was = sampler.inDrag;
      sampler.inDrag = true;
      sampler.registered = 0;
      try {
        return sampler.originalFire(name, ...rest);
      } finally {
        sampler.inDrag = was;
      }
    };
    window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      const fromDrag = sampler.inDrag;
      const slot = sampler.registered;
      sampler.registered += 1;
      return original((now) => {
        const started = performance.now();
        callback(now);
        const took = performance.now() - started;
        if (!fromDrag) return;
        (slot === 0 ? sampler.repaint : sampler.recompute).push(took);
      });
    };
    w.__yunariDrag = sampler;
  });
}

async function stopSampling(page: Page): Promise<DragSample> {
  return page.evaluate(() => {
    const sampler = (
      window as unknown as {
        __yunariDrag: {
          repaint: number[];
          recompute: number[];
          moves: number;
          original: typeof window.requestAnimationFrame;
          originalFire: (name: string, ...rest: unknown[]) => unknown;
          canvas: {
            off(e: string, h: () => void): void;
            fire: (name: string, ...rest: unknown[]) => unknown;
          };
          handler: (() => void) | undefined;
        };
      }
    ).__yunariDrag;
    window.requestAnimationFrame = sampler.original;
    sampler.canvas.fire = sampler.originalFire;
    if (sampler.handler !== undefined) {
      sampler.canvas.off("object:moving", sampler.handler);
    }
    return {
      repaint: sampler.repaint,
      recompute: sampler.recompute,
      moves: sampler.moves,
    };
  });
}

function stats(values: readonly number[]): {
  n: number;
  median: number;
  p95: number;
  max: number;
} {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  const round = (value: number): number => Math.round(value * 10) / 10;
  return {
    n: sorted.length,
    median: round(at(0.5)),
    p95: round(at(0.95)),
    max: round(sorted[sorted.length - 1] ?? 0),
  };
}

test.describe("the artboard panel's crop figure", () => {
  test("follows an object over the edge while the drag is still held", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await page.goto(EDITOR);
    await expect(page.locator("#yunari-fabric-editor")).toBeVisible();
    await page.waitForFunction(
      () =>
        (window as unknown as { yunariEditorBridge?: unknown })
          .yunariEditorBridge !== undefined,
    );
    // The starter paints asynchronously; a read before it has finished is a read
    // of an empty canvas.
    await page.waitForTimeout(1500);
    await openPane(page, "Document");

    const note = page.locator("[data-yunari-artboard-note]");
    await expect(note).toBeVisible();
    const boardWidth = Number(
      await page.locator("[data-yunari-artboard-width]").inputValue(),
    );
    expect(boardWidth, "the board is the starter's own width").toBeGreaterThan(
      0,
    );

    // The figure before the drag, so the change below is a change rather than a
    // value that happened to be there.
    const before = (await note.textContent()) ?? "";

    const rect = await objectRect(page, CARD);
    const from = await clientOfScene(page, CARD, boardWidth);
    // The card's right edge lands `PAST_EDGE` beyond the board, while the
    // pointer stays inside the board — the gesture is one an author can make.
    const to = await sceneToClient(
      page,
      boardWidth,
      boardWidth + PAST_EDGE - rect.width / 2,
      rect.top + rect.height / 2,
    );

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await startSampling(page);
    for (let step = 1; step <= STEPS; step += 1) {
      const t = step / STEPS;
      await page.mouse.move(
        from.x + (to.x - from.x) * t,
        from.y + (to.y - from.y) * t,
      );
      await page.waitForTimeout(16);
    }
    // The pointer is still down. A frame's worth of slack for the coalesced
    // recompute, and nothing longer: a case that waits for the figure to appear
    // would pass on a panel that only catches up on release.
    await page.waitForTimeout(120);
    const during = (await note.textContent()) ?? "";
    // Stopped before the release, so the sample is the drag alone: `mouse.up()`
    // runs the release path (`object:modified`), and a frame of that belongs to
    // neither the drag nor the question this measures.
    const drag = await stopSampling(page);
    await page.mouse.up();
    const landed = (await note.textContent()) ?? "";

    const repaint = stats(drag.repaint);
    const recompute = stats(drag.recompute);
    console.log(
      `[crop figure] before=${JSON.stringify(before)} during=${JSON.stringify(during)} after=${JSON.stringify(landed)}`,
    );
    console.log(
      `[crop figure] ${drag.moves} object:moving events; frame ms the canvas repaint n=${repaint.n} median=${repaint.median} p95=${repaint.p95} max=${repaint.max}; the panel recompute n=${recompute.n} median=${recompute.median} p95=${recompute.p95} max=${recompute.max}`,
    );

    expect(before, "the starter fits its board to begin with").not.toContain(
      "are now outside",
    );
    // The row's claim, and the reason the read is here rather than after
    // `mouse.up()`: with the pointer still down the figure already reports the
    // card it has dragged over the edge.
    expect(
      during,
      "the figure moved while the button was still held",
    ).toContain("are now outside");
    expect(landed, "and it still reads so once the drag is released").toContain(
      "are now outside",
    );

    // The ruling's cost-if-wrong: a per-frame recompute is real work, and the
    // answer to one that does not fit is a cheaper recompute. Measured here at
    // ~3 ms against a 16.7 ms frame, so the margin is the check.
    expect(recompute.n, "the drag recomputed while it ran").toBeGreaterThan(0);
    expect(
      recompute.p95,
      `the panel's recompute does not fit a 60 Hz frame (median ${recompute.median} ms, p95 ${recompute.p95} ms, max ${recompute.max} ms)`,
    ).toBeLessThan(FRAME_MS);
  });
});
