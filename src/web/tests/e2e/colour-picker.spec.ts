import { expect, type Page, test } from "@playwright/test";
import { readThemePackage } from "@yunari/theme-package";
import { chooseIn, typeIntoControl } from "./control-set.js";
import { captureVisualReview } from "./editor-canvas.js";
import { storedColour } from "./editor-fixture.js";
import { openPane } from "./editor-rail.js";
import { choosePalette, openShell, PALETTES } from "./shell-palette.js";
import { isDesktopSurface } from "./surface.js";

/**
 * The colour picker and the gradient track, in the browser that paints them.
 *
 * The DOM suites beside the components stub pointer capture, rects and
 * `EyeDropper`; what they cannot prove is the settled boundary of a real
 * pointer gesture, the undo entry a drag leaves, the library surviving a
 * reload, or the focus boundary a keyboard author actually sees. Those are
 * this file's four subjects, plus the two captures that register the surfaces
 * as real renders.
 */

const EDITOR = "http://127.0.0.1:4174/";

/** The colours and gradients the editor's own library holds. */
type PaletteEntry = {
  readonly value:
    | { readonly kind: "solid"; readonly color: string }
    | {
        readonly kind: "gradient";
        readonly angle: number;
        readonly stops: readonly {
          readonly offset: number;
          readonly color: string;
        }[];
      };
};

async function openTokens(page: Page): Promise<void> {
  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();
  await openPane(page, "Tokens");
}

/** The picker's one trigger; its popover holds the exact-value field. */
async function openPicker(page: Page): Promise<void> {
  await page.locator("[data-yunari-palette-picker]").click();
  await expect(page.getByTestId("colour-picker")).toBeVisible();
}

async function saveEnvelope(page: Page): Promise<unknown> {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save package" }).click();
  await expect(page.locator("#status")).toContainText("Theme package saved");
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const parsed = readThemePackage(Buffer.concat(chunks));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.envelope;
}

/** The saved palette, read rather than assumed: the document is the evidence. */
function paletteOf(envelope: unknown): Record<string, PaletteEntry> {
  const globals = (envelope as { globals?: { palette?: unknown } }).globals;
  const palette = globals?.palette;
  if (
    palette === undefined ||
    palette === null ||
    typeof palette !== "object"
  ) {
    throw new Error("the saved package carries no palette");
  }
  return palette as Record<string, PaletteEntry>;
}

/**
 * The WCAG contrast ratio, written here rather than imported: the brief asks
 * for a local helper, and this file's subject is a colour surface where the
 * formula is the whole reading.
 */
function luminance(colour: readonly [number, number, number]): number {
  const channel = (value: number): number => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(colour[0]) +
    0.7152 * channel(colour[1]) +
    0.0722 * channel(colour[2])
  );
}

function contrast(
  first: readonly [number, number, number],
  second: readonly [number, number, number],
): number {
  const a = luminance(first);
  const b = luminance(second);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** A computed `rgb()`/`rgba()` colour as its channels, alpha composited away:
 *  the outline is opaque in every palette, and the pixel is already rendered. */
function channelsOf(css: string): [number, number, number] {
  const match = /^rgba?\(([^)]+)\)$/.exec(css);
  if (match === null) throw new Error(`unreadable computed colour: ${css}`);
  const parts = (match[1] ?? "")
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  const [r, g, b] = parts;
  if (r === undefined || g === undefined || b === undefined) {
    throw new Error(`unreadable computed colour: ${css}`);
  }
  return [r, g, b];
}

/** The rendered pixel at one viewport point, decoded through a canvas in the
 *  page. A computed background cannot answer a surface with alpha over a
 *  gradient, so the pixel is the evidence. */
async function pixelAt(
  page: Page,
  point: { readonly x: number; readonly y: number },
): Promise<[number, number, number]> {
  const shot = await page.screenshot();
  const b64 = shot.toString("base64");
  const pixel = await page.evaluate(
    async ({ b64, x, y }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${b64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (context === null) return null;
      context.drawImage(image, 0, 0);
      const data = context.getImageData(
        Math.round(x),
        Math.round(y),
        1,
        1,
      ).data;
      return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0] as const;
    },
    { b64, x: point.x, y: point.y },
  );
  if (pixel === null) throw new Error("the page could not be captured");
  return [pixel[0], pixel[1], pixel[2]];
}

test.describe("the colour picker and the gradient track", () => {
  test("commits one undo entry per colour picker drag", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await openTokens(page);
    await chooseIn(page, "[data-yunari-palette-token]", "background");
    const before = paletteOf(await saveEnvelope(page)).background?.value;

    await openPicker(page);
    const triggerValue = page
      .getByTestId("picker-trigger")
      .locator("[data-yunari-value]");
    const beforeText = await triggerValue.textContent();

    const area = page.getByTestId("picker-area");
    const box = await area.boundingBox();
    if (box === null) throw new Error("the picker area has no box");
    await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.3, {
      steps: 12,
    });
    await page.mouse.up();

    const dragged = paletteOf(await saveEnvelope(page)).background?.value;
    expect(dragged, "the drag wrote a colour into the document").not.toEqual(
      before,
    );

    await page.keyboard.press("Control+z");
    // The undo is asynchronous; the trigger's readout is where the restored
    // palette shows first, so the wait is on a rendered fact.
    await expect(triggerValue).toHaveText(beforeText ?? "");
    expect(paletteOf(await saveEnvelope(page)).background?.value).toEqual(
      before,
    );

    // A second press has no further step to walk: one drag is one entry, so it
    // cannot rewind one pre-drag sample per pointer move. The readout is the
    // rendered fact that settles the key; the save reads the document behind it.
    await page.keyboard.press("Control+z");
    await expect(triggerValue).toHaveText(beforeText ?? "");
    expect(paletteOf(await saveEnvelope(page)).background?.value).toEqual(
      before,
    );
  });

  test("moves a gradient stop by drag and by number, then adds one on the track", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await openTokens(page);
    await chooseIn(page, "[data-yunari-palette-token]", "background");
    await chooseIn(page, "[data-yunari-palette-kind]", "gradient");

    const track = page.getByTestId("gradient-track");
    const trackBox = await track.boundingBox();
    const stop = page.getByTestId("gradient-stop-0");
    const stopBox = await stop.boundingBox();
    if (trackBox === null || stopBox === null) {
      throw new Error("the gradient track or its first stop has no box");
    }
    await page.mouse.move(
      stopBox.x + stopBox.width / 2,
      stopBox.y + stopBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      trackBox.x + trackBox.width * 0.4,
      trackBox.y + trackBox.height / 2,
      { steps: 8 },
    );
    await page.mouse.up();

    const offset = page.getByTestId("gradient-offset");
    const draggedPercent = Number(await offset.inputValue());
    expect(draggedPercent).toBeGreaterThan(10);
    expect(draggedPercent).toBeLessThan(60);

    await typeIntoControl(page, offset, 35);
    await expect(offset).toHaveValue("35");

    const numbered = paletteOf(await saveEnvelope(page)).background?.value;
    if (numbered?.kind !== "gradient") {
      throw new Error("the token is not a gradient");
    }
    // The number the author typed is the number the document stores, and the
    // drag before it never left the two agreeing.
    expect(numbered.stops[0]?.offset).toBeCloseTo(0.35, 6);

    const countBefore = numbered.stops.length;
    await page.mouse.click(
      trackBox.x + trackBox.width * 0.6,
      trackBox.y + trackBox.height / 2,
    );
    const added = paletteOf(await saveEnvelope(page)).background?.value;
    if (added?.kind !== "gradient") {
      throw new Error("the token is not a gradient");
    }
    expect(added.stops).toHaveLength(countBefore + 1);
  });

  test("applies a gradient preset from the library's fifteen seeds", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await openTokens(page);
    await chooseIn(page, "[data-yunari-palette-token]", "background");
    await chooseIn(page, "[data-yunari-palette-kind]", "gradient");

    // The row is the library's, so its size is the evidence that the seeds
    // rendered rather than a fixture this spec invented.
    await expect(page.locator('[data-testid^="gradient-preset-"]')).toHaveCount(
      15,
    );

    await page
      .getByTestId("gradient-preset-default-gradient-vital-ocean")
      .click();
    const value = paletteOf(await saveEnvelope(page)).background?.value;
    expect(value).toEqual({
      kind: "gradient",
      angle: 0,
      stops: [
        { offset: 0, color: storedColour("rgb(28 181 224)") },
        { offset: 1, color: storedColour("rgb(0 8 81)") },
      ],
    });
  });

  test("deletes a colour preset and the deletion survives a reload", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await openTokens(page);
    await chooseIn(page, "[data-yunari-palette-token]", "background");
    await openPicker(page);

    const doomed = page.getByTestId("picker-preset-default-colour-slate-900");
    await expect(doomed).toHaveCount(1);
    await expect(page.locator('[data-testid^="picker-preset-"]')).toHaveCount(
      12,
    );
    await doomed.click({ button: "right" });
    await page.getByTestId("preset-menu-delete").click();
    await expect(doomed).toHaveCount(0);

    // The library is editor-local and stored, so the reload is the proof that
    // the deletion is a write rather than a re-render.
    await page.reload();
    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible();
    await openPane(page, "Tokens");
    await chooseIn(page, "[data-yunari-palette-token]", "background");
    await openPicker(page);

    await expect(
      page.getByTestId("picker-preset-default-colour-slate-900"),
    ).toHaveCount(0);
    await expect(page.locator('[data-testid^="picker-preset-"]')).toHaveCount(
      11,
    );
    await expect(
      page.getByTestId("picker-preset-default-colour-slate-100"),
    ).toHaveCount(1);
  });

  test("clears the picker's focus boundary in every shell palette", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
    test.setTimeout(180_000);

    await openShell(page);
    const ratios: string[] = [];
    const failures: string[] = [];

    for (const palette of PALETTES) {
      await choosePalette(page, palette);
      await openPane(page, "Tokens");
      await chooseIn(page, "[data-yunari-palette-token]", "background");
      await openPicker(page);

      const area = page.getByTestId("picker-area");
      // A press sets the heuristic that makes a programmatic focus match
      // `:focus-visible`, which is the state the boundary is for.
      await page.keyboard.press("Tab");
      await area.focus();
      await expect(area).toBeFocused();

      const reading = await area.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          focusVisible: element.matches(":focus-visible"),
          outline: style.outlineColor,
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
          groundPoint: { x: rect.left - 4, y: rect.top + rect.height / 2 },
          outlinePoint: { x: rect.left - 1, y: rect.top + rect.height / 2 },
        };
      });
      expect(
        reading.focusVisible,
        `${palette}: the focused area does not match :focus-visible`,
      ).toBe(true);
      // A colour alone cannot prove a boundary exists: with no outline rule
      // `outlineColor` falls back to `currentColor` and still clears 3:1.
      expect(
        reading.outlineStyle,
        `${palette}: the focused area has no outline style`,
      ).not.toBe("none");
      expect(
        Number.parseFloat(reading.outlineWidth),
        `${palette}: the focused area's outline has no width`,
      ).toBeGreaterThan(0);

      // The outline is drawn outside the area's border, over the popup's own
      // padding, so the pixel beside it is the colour the boundary has to read
      // against, and the pixel one step out is the boundary itself.
      const pixel = await pixelAt(page, reading.groundPoint);
      const drawn = await pixelAt(page, reading.outlinePoint);
      const outlineChannels = channelsOf(reading.outline);
      expect(
        Math.max(
          ...outlineChannels.map((channel, index) =>
            Math.abs(channel - (drawn[index] ?? 0)),
          ),
        ),
        `${palette}: the pixel beside the area is not the outline colour`,
      ).toBeLessThanOrEqual(32);
      const ratio =
        Math.round(contrast(outlineChannels, pixel) * 100) / 100;
      ratios.push(`${palette} focus-boundary ${ratio}:1 (${reading.outline})`);
      if (ratio < 3) {
        failures.push(
          `${palette}: the picker area's focus boundary is ${ratio}:1, below 3:1 — ${reading.outline} over the popup's ground`,
        );
      }

      await page.keyboard.press("Escape");
      await expect(page.getByTestId("colour-picker")).toBeHidden();
    }

    for (const line of ratios) console.log(`colour-picker ${line}`);
    expect(failures, "a focus boundary is below 3:1").toEqual([]);
    testInfo.annotations.push({
      type: "contrast",
      description: ratios.join(" | "),
    });
  });

  test("picks a palette colour in the picker and commits it through the popover", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await openTokens(page);
    await chooseIn(page, "[data-yunari-palette-token]", "background");
    await openPicker(page);
    await page.getByTestId("picker-preset-default-colour-blue").click();
    const blue = storedColour("rgb(59 130 246)");
    await expect(
      page.getByTestId("picker-trigger").locator("[data-yunari-value]"),
    ).toHaveText(blue);

    const value = paletteOf(await saveEnvelope(page)).background?.value;
    expect(value).toEqual({ kind: "solid", color: blue });

    await openPicker(page);
    await captureVisualReview(page, testInfo, "editor-colour-picker");
  });

  test("builds a gradient with a drag and a number while its preset row is visible", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

    await openTokens(page);
    await chooseIn(page, "[data-yunari-palette-token]", "background");
    await chooseIn(page, "[data-yunari-palette-kind]", "gradient");
    await page
      .getByTestId("gradient-preset-default-gradient-vital-ocean")
      .click();

    // The registered action is a stop edited by drag *and* by number, so the
    // picture has to show both edits rather than only the preset that seeded it.
    const trackBox = await page.getByTestId("gradient-track").boundingBox();
    const stopBox = await page.getByTestId("gradient-stop-0").boundingBox();
    if (trackBox === null || stopBox === null) {
      throw new Error("the gradient track or its first stop has no box");
    }
    await page.mouse.move(
      stopBox.x + stopBox.width / 2,
      stopBox.y + stopBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      trackBox.x + trackBox.width * 0.2,
      trackBox.y + trackBox.height / 2,
      { steps: 8 },
    );
    await page.mouse.up();
    const offset = page.getByTestId("gradient-offset");
    await typeIntoControl(page, offset, 25);
    await expect(offset).toHaveValue("25");

    await expect(page.getByTestId("gradient-track")).toBeVisible();
    await expect(
      page.getByTestId("gradient-preset-default-gradient-vital-ocean"),
    ).toBeVisible();

    // Scoped to the editor: the panel scrolls, and the preset row has to be in
    // the picture rather than below the pane's fold.
    await captureVisualReview(
      page,
      testInfo,
      "editor-gradient-editor",
      page.locator("[data-yunari-palette-gradient]"),
    );
  });
});
