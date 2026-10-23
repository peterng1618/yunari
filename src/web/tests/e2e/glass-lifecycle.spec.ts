import { expect, test } from "@playwright/test";
import { writeThemePackage } from "@yunari/theme-package";
import { GLASS_ENVELOPE, glassStripesPng } from "./glass-fixture.js";
import { openThemeFromStore, storedThemeOfPackage } from "./store-library.js";

const EDITOR = "http://127.0.0.1:4174/";

/**
 * The lifecycle property, measured on the real editor and the real fixture.
 *
 * **Not** "zero repaints in 1000 ms". Task 1 measured that on a bare
 * `StaticCanvas`; the editor runs a refresh loop of its own, so an idle editor
 * repaints whatever glass is doing. That loop no longer repaints every frame:
 * `LiveRuntime.tick` paints text on its data's cadence (4 Hz sample pass, 1 Hz
 * authored heartbeat) and asks for a render only when it painted, so a scene
 * with no charts repaints a handful of times a second rather than twenty-two
 * (`38cbfe3e`). Asserting zero here would assert a fact about a loop this task
 * does not own, and it would fail for a reason unrelated to glass.
 *
 * The property that *is* this task's is the **delta**: a glass panel must not
 * add a repaint of its own. That is measured by comparing the same scene with
 * and without the panel, so the editor's own refresh cancels out, and by
 * counting composites at the panel - one per editor frame means the owner is
 * riding frames someone else asked for rather than making or missing any.
 */
test.describe("glass lifecycle in the real editor", () => {
  test("a glass panel adds no repaint of its own", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-chromium",
      "the editor is a desktop surface",
    );
    const fixture = writeThemePackage({
      envelope: GLASS_ENVELOPE,
      assets: { "assets/stripes.png": glassStripesPng() },
    });
    if (!fixture.ok) throw new Error(fixture.message);

    await page.goto(EDITOR);
    await openThemeFromStore(page, storedThemeOfPackage(fixture.bytes));
    // The media must have real pixels, or a panel has no backdrop to blur and
    // the comparison below would be measuring an empty scene.
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

    const measurement = await page.evaluate(async () => {
      const scope = window as unknown as Record<string, unknown>;
      const canvas = (
        Object.entries(scope).find(
          ([name, value]) =>
            name.startsWith("yunari-fabric-editor") &&
            (value as { canvas?: { upperCanvasEl?: HTMLCanvasElement } }).canvas
              ?.upperCanvasEl?.isConnected,
        )?.[1] as
          | {
              canvas: {
                getObjects(): Array<Record<string, unknown>>;
                add(...objects: unknown[]): void;
                remove(...objects: unknown[]): void;
                renderAll(): void;
                getContext(): CanvasRenderingContext2D;
              };
            }
          | undefined
      )?.canvas;
      if (canvas === undefined) throw new Error("no editor canvas is mounted");
      // **Connected, not merely present.** Opening a package mounts a second
      // editor and the first is left on `window`; taking the first key found
      // measured the *previous* document, where this fixture's panel does not
      // exist, and the test failed as "the fixture has no glass panel" — a
      // complaint about the fixture made by a search that never looked at it.
      const panel = canvas
        .getObjects()
        .find((object) => object["yunariGlass"] !== undefined);
      if (panel === undefined)
        throw new Error("the fixture has no glass panel");

      const originalRender = canvas.renderAll.bind(canvas);
      let renders = 0;
      canvas.renderAll = () => {
        renders += 1;
        originalRender();
      };

      // **Composites are counted at the surface, not at the panel.** A
      // `before:render` listener fires whether or not `composite` runs,
      // succeeds, or bails, so it cannot tell "glass worked" from "glass was
      // deleted". The composite is the panel's own five-argument `drawImage` -
      // the filtered backdrop draw - which nothing else in the scene makes:
      // Fabric blits cached objects with the two-argument form.
      const compositeCount = (): number => {
        const context = canvas.getContext();
        const original = context.drawImage.bind(context);
        let composites = 0;
        context.drawImage = ((...args: unknown[]) => {
          if (args.length === 5) composites += 1;
          return (original as (...a: unknown[]) => unknown)(...args);
        }) as typeof context.drawImage;
        try {
          canvas.renderAll();
        } finally {
          context.drawImage = original;
        }
        return composites;
      };

      // Several alternating rounds rather than one pair: a single 1000 ms
      // window of a 30 Hz loop moves by more than one frame when the machine
      // is also running other specs, and a property that cannot be measured
      // under load is not a property. The **minimum** of each side is the
      // right statistic - the editor's loop sets a floor, and a panel can only
      // ever add repaints above it, so a floor comparison is the conservative
      // one: if glass added even one frame per round, the with-panel minimum
      // would rise above the without-panel one.
      //
      // **What this narrowing costs.** A min is less *sensitive*, not less
      // correct, for the property it states: a regression present in all three
      // rounds is caught, and an intermittent one - one that fires in some
      // rounds and not others - can hide behind a good round. The test bounds
      // the systematic case; it does not bound a flaky one. The per-round
      // counts are the thing to read if this ever fails intermittently.
      let withPanelMin = Number.POSITIVE_INFINITY;
      let withoutPanelMin = Number.POSITIVE_INFINITY;
      let withPanelMax = 0;
      let withoutPanelMax = 0;
      for (let round = 0; round < 3; round += 1) {
        renders = 0;
        await new Promise((resolve) => setTimeout(resolve, 1000));
        withPanelMin = Math.min(withPanelMin, renders);
        withPanelMax = Math.max(withPanelMax, renders);

        canvas.remove(panel);
        renders = 0;
        await new Promise((resolve) => setTimeout(resolve, 1000));
        withoutPanelMin = Math.min(withoutPanelMin, renders);
        withoutPanelMax = Math.max(withoutPanelMax, renders);
        canvas.add(panel);
      }

      // Match set: the panel is really compositing, and stops being when it is
      // gone. Without this the delta below would also be satisfied by a
      // `createGlass` that never ran.
      const compositesInOneFrame = compositeCount();
      canvas.remove(panel);
      const compositesWithoutPanel = compositeCount();
      canvas.add(panel);

      canvas.renderAll = originalRender;
      return {
        withPanelMin,
        withoutPanelMin,
        withPanelMax,
        withoutPanelMax,
        compositesInOneFrame,
        compositesWithoutPanel,
      };
    });

    // Match set: the editor's own refresh really is running in both windows,
    // so a zero here would mean the scene was static rather than that glass
    // is free. Read from the best round, not the worst: the loop renders only
    // when a pass painted, so its idle floor moves with the data's cadence and
    // the alive-at-all claim is answered by any window that rendered.
    expect(
      measurement.withPanelMax,
      "the editor is repainting at all",
    ).toBeGreaterThan(0);
    expect(
      measurement.withoutPanelMax,
      "and keeps repainting with the panel removed",
    ).toBeGreaterThan(0);
    // Match set: the panel is really compositing, and stops being when it is
    // gone. Without this the delta below would also be satisfied by a
    // `createGlass` that never ran.
    expect(
      measurement.compositesInOneFrame,
      "the panel composites its backdrop in a frame",
    ).toBeGreaterThan(0);
    expect(
      measurement.compositesWithoutPanel,
      "and does not once it is removed",
    ).toBe(0);
    // The property. Two separate 1000 ms samples of a live 30 Hz loop, so they
    // differ by the loop's own jitter. `±1` is that jitter at 30 Hz - 60 ms -
    // and bounds the panel to at most one extra repaint a second, where `+3`
    // would have let a repaint every 333 ms through.
    expect(
      measurement.withPanelMin,
      "a glass panel adds no repaint of its own",
    ).toBeLessThanOrEqual(measurement.withoutPanelMin + 1);
  });
});
