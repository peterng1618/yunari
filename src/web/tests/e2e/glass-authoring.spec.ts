import { expect, type Page, test } from "@playwright/test";
import { readThemePackage, writeThemePackage } from "@yunari/theme-package";
import { typeIntoControl } from "./control-set.js";
import { captureVisualReview, clientOfScene } from "./editor-canvas.js";
import { storedColour } from "./editor-fixture.js";
import { openPane } from "./editor-rail.js";
import {
  AUTHORING_PANEL_ID,
  GLASS_ARTBOARD,
  GLASS_ENVELOPE,
  glassStripesPng,
} from "./glass-fixture.js";
import { assertBlur, readGlass } from "./glass-probe.js";
import { openThemeFromStore, storedThemeOfPackage } from "./store-library.js";

const EDITOR = "http://127.0.0.1:4174/";

/**
 * The glass control, driven in the real editor over a real backdrop.
 *
 * The unit suite can prove that the control writes a property; only a browser
 * can prove the pixels that property produces. This is the editor mount, the
 * one whose background media loads, so the blur is measurable here — the
 * player's media 404s (issue #3), which is why the player's evidence is the
 * starter's own scene rather than this backdrop.
 *
 * The panel is selected, styled and grouped through the product's own paths —
 * pointer for the canvas, keyboard for the controls — and a **grouped** panel is
 * measured as well as an ordinary one, because a control that only works while
 * its object is alone is not an authoring operation.
 */

/** The band, in artboard x, that sits inside the authoring panel. */
const BAND = { left: 80, width: 80 } as const;

const desktop = (name: string): void => {
  test.skip(name !== "desktop-chromium", "the editor is a desktop surface");
};

async function openFixture(page: Page): Promise<void> {
  const fixture = writeThemePackage({
    envelope: GLASS_ENVELOPE,
    assets: { "assets/stripes.png": glassStripesPng() },
  });
  if (!fixture.ok)
    throw new Error(`the glass fixture is invalid: ${fixture.message}`);

  await page.goto(EDITOR);
  await openThemeFromStore(page, storedThemeOfPackage(fixture.bytes));
}

function activeId(page: Page): Promise<string | undefined> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          yunariEditorBridge: {
            editor: {
              canvas: { getActiveObject(): { id?: string } | undefined };
            };
          };
        }
      ).yunariEditorBridge.editor.canvas.getActiveObject()?.id,
  );
}

/** Selects the authoring panel by clicking the canvas, through the camera.
 *
 *  The selection's fields are in the right column, which no pane choice reaches,
 *  so the click is the whole gesture. */
async function selectAuthoringPanel(page: Page): Promise<void> {
  const centre = await clientOfScene(
    page,
    AUTHORING_PANEL_ID,
    GLASS_ARTBOARD.width,
  );
  await page.mouse.click(centre.x, centre.y);
  await expect.poll(() => activeId(page)).toBe(AUTHORING_PANEL_ID);
}

/** Screen distance a click must keep from a selected object's handles.
 *
 * Fabric draws the top-middle and rotation handles around the selected
 * object, and the rotation handle sits directly above the top-middle, so a
 * panel stacked above a selected one has its centre under them. */
const HANDLE_CLEARANCE_PX = 24;

/**
 * A point on `id` that a shift-click will reach, rather than one of the
 * currently selected object's handles.
 *
 * **The neighbour's centre is not a safe click point, and whether it is safe
 * depends on the camera.** A selected object owns the area around its bounds,
 * so a click there grabs a handle instead of extending the selection:
 * Fabric reports the mouse down and up and no selection change at all, and a
 * test waiting for the two-object selection waits out its whole budget. The
 * handles are a *screen*-space size while the gap between two panels is a
 * *scene*-space distance, so lowering the camera walks the neighbour's centre
 * into them — measured on this fixture, the centre is clear at zoom 0.98 and
 * covered at the display lens's 0.60, which is why the lens turned a passing
 * test into a 30s timeout.
 *
 * So the offset is a screen distance, taken in the space the handles are sized
 * in, and clamped to the object's own half-width so a camera zoomed far enough
 * out to make the object narrower than the clearance still lands on it.
 */
async function clearOfHandles(
  page: Page,
  id: string,
): Promise<{
  x: number;
  y: number;
}> {
  const centre = await clientOfScene(page, id, GLASS_ARTBOARD.width);
  const halfWidth = await page.evaluate(
    ([objectId]) => {
      type SceneLike = {
        get(name: string): unknown;
        getBoundingRect(): { width: number };
        getObjects?(): SceneLike[];
      };
      const find = (objects: readonly SceneLike[]): SceneLike | undefined => {
        for (const candidate of objects) {
          if (candidate.get("id") === objectId) return candidate;
          const found = find(candidate.getObjects?.() ?? []);
          if (found !== undefined) return found;
        }
        return undefined;
      };
      const bridge = (
        window as unknown as {
          yunariEditorBridge: {
            editor: {
              canvas: {
                getObjects(): SceneLike[];
                getZoom?(): number;
                viewportTransform: readonly [
                  number,
                  number,
                  number,
                  number,
                  number,
                  number,
                ];
              };
            };
          };
        }
      ).yunariEditorBridge;
      const object = find(bridge.editor.canvas.getObjects());
      if (object === undefined)
        throw new Error(`no object with id ${objectId}`);
      const zoom =
        bridge.editor.canvas.getZoom?.() ??
        bridge.editor.canvas.viewportTransform[0];
      return (object.getBoundingRect().width * zoom) / 2 - 2;
    },
    [id] as [string],
  );
  return {
    x: centre.x + Math.min(HANDLE_CLEARANCE_PX, halfWidth),
    y: centre.y,
  };
}

async function saveEnvelope(page: Page): Promise<unknown> {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save package" }).click();
  // **Contains**, not equals. The footer is a status line *and* a diagnostic
  // surface (F1.15): a test whose own action raised a refusal — the radius case
  // below types a value the product correctly refuses — leaves the refusal on
  // screen beside the save status, and an exact match would call that a
  // failure. Each caller asserts its own diagnostic; this one only needs to know
  // the save happened.
  await expect(page.locator("#status")).toContainText("Theme package saved");
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const parsed = readThemePackage(Buffer.concat(chunks));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.envelope;
}

function treatmentOf(page: Page, id: string): unknown {
  return (
    saveEnvelope(page) as Promise<{
      scene: { objects: ReadonlyArray<Record<string, unknown>> };
    }>
  ).then(
    (envelope) =>
      envelope.scene.objects.find((object) => object["id"] === id)?.[
        "yunariGlass"
      ],
  );
}

test.describe("authoring frosted glass through the inspector", () => {
  test("gives an ordinary panel a real, measured backdrop blur, and undoes it", async ({
    page,
  }, testInfo) => {
    desktop(testInfo.project.name);
    await openFixture(page);
    await selectAuthoringPanel(page);

    const enabled = page.locator("[data-yunari-glass-enabled]");
    const blur = page.locator("[data-yunari-glass-blur]");
    await expect(enabled).toBeVisible();
    // Off to start: the panel carries no treatment, so there is no radius to
    // change and no box that would accept an edit and apply none.
    expect(await enabled.isChecked()).toBe(false);
    await expect(blur).toHaveCount(0);

    // Keyboard: focus the checkbox and press Space, the platform's own key for
    // it. Nothing here needs a bespoke key handler.
    await enabled.focus();
    await page.keyboard.press("Space");
    await expect(enabled).toBeChecked();
    await expect(blur).toBeVisible();
    const onEnable = Number(await blur.inputValue());
    expect(onEnable).toBeGreaterThan(0);

    // Keyboard: the radius, committed with Tab.
    await typeIntoControl(page, blur, "24");
    await expect(blur).toHaveValue("24");

    // The pixels, which is the only thing the unit suite cannot reach.
    assertBlur(
      await readGlass(page, { id: AUTHORING_PANEL_ID, band: BAND }),
      "editor, authored through the control",
    );

    await captureVisualReview(page, testInfo, "editor-glass-authoring");

    // The saved document carries the treatment as authored state.
    expect(await treatmentOf(page, AUTHORING_PANEL_ID)).toEqual({
      blurRadius: 24,
    });

    // Undo steps back the radius edit, then the enable, and the panel itself
    // survives both.
    await page.keyboard.press("Control+z");
    await expect(blur).toHaveValue(String(onEnable));
    await page.keyboard.press("Control+z");
    await expect(enabled).not.toBeChecked();
    await expect(blur).toHaveCount(0);
  });

  test("lands a radius past the published bound on it, and offers a slider", async ({
    page,
  }, testInfo) => {
    desktop(testInfo.project.name);
    await openFixture(page);
    await selectAuthoringPanel(page);

    const enabled = page.locator("[data-yunari-glass-enabled]");
    await enabled.focus();
    await page.keyboard.press("Space");
    const blur = page.locator("[data-yunari-glass-blur]");

    // The slider only exists when the field is bounded at both ends, so its
    // presence is what proves the ceiling reached the field rather than the
    // capability existing somewhere else. **The hook rides the range input
    // itself** (`control-slider.tsx:72-80` mirrors `data` onto the focus
    // target, which is the nested `input[type=range]`), so the field *is* the
    // slider — the sibling lookup this used to do resolved to nothing.
    await expect(blur).toHaveAttribute("type", "range");
    await expect(blur).toHaveAttribute("max", "48");
    await expect(blur).toHaveAttribute("min", "0");

    await typeIntoControl(page, blur, "60");

    // The finding was "took me a while to figure out blur only accepts 48
    // maximum": a box reverted to its old value teaches nothing about where the
    // maximum is, and the radius the author typed is the one they meant. The
    // slider's own `max` is where a past-the-ceiling value lands.
    await expect(blur).toHaveValue("48");
    expect(await treatmentOf(page, AUTHORING_PANEL_ID)).toEqual({
      blurRadius: 48,
    });
  });

  test("keeps a radius typed past the ceiling out of the document", async ({
    page,
  }, testInfo) => {
    /**
     * **Rewritten with the well.** This case was "offers no empty radius to
     * read, so no draft can coerce to no blur": a slider's well was a
     * `span.font-mono` readout, so `Number("")` — the coercion it guarded — had
     * no input to arise in. Item 10 made the well the slider's typed route, so
     * the draft exists again and the guard that replaces it is `ControlNumber`'s
     * own: a draft past the bound is kept with its reason and writes nothing,
     * and a cleared box with no `onClear` is refused rather than read as zero.
     */
    desktop(testInfo.project.name);
    await openFixture(page);
    await selectAuthoringPanel(page);

    const enabled = page.locator("[data-yunari-glass-enabled]");
    await enabled.focus();
    await page.keyboard.press("Space");
    const blur = page.locator("[data-yunari-glass-blur]");
    await expect(blur).toHaveAttribute("type", "range");

    // The well beside the track: the one place a value is shown, and the one
    // place a draft lives. It is named by the track's own hook with `-well`
    // appended — two elements under one name would be a locator that cannot say
    // which one it means.
    const well = page.locator("[data-yunari-glass-blur-well]");
    await expect(well).toBeVisible();
    // **The number the enable wrote, not whatever the field happens to show**:
    // `glass.ts`'s `DEFAULT_GLASS_BLUR_RADIUS` is 16, and an assertion that
    // compares the document to the control passes when the field, the track and
    // the document agree on a wrong value.
    await expect(blur).toHaveValue("16");
    await expect(well).toHaveValue("16");

    // The refusal is the field's own, by the id it mints for it: a `getByText`
    // over the page also matches the ancestor that contains the message.
    const refusal = page.locator(`#${await well.getAttribute("id")}-invalid`);

    // Past the ceiling: the field says why and the document does not move.
    await well.fill("60");
    await well.blur();
    await expect(refusal).toHaveText("at most 48");
    expect(await treatmentOf(page, AUTHORING_PANEL_ID)).toEqual({
      blurRadius: 16,
    });

    // Empty is not zero: a radius is required, and the coercion the old case
    // guarded would have written no blur from a box the author cleared.
    await well.fill("");
    await well.blur();
    await expect(refusal).toHaveText("a value is required");
    expect(await treatmentOf(page, AUTHORING_PANEL_ID)).toEqual({
      blurRadius: 16,
    });

    // And a value written through the well is a real radius in the document.
    await well.fill("24");
    await well.blur();
    await expect(blur).toHaveValue("24");
    expect(await treatmentOf(page, AUTHORING_PANEL_ID)).toEqual({
      blurRadius: 24,
    });
  });

  test("carries the treatment through redo, duplicate and a token change", async ({
    page,
  }, testInfo) => {
    desktop(testInfo.project.name);
    await openFixture(page);
    await selectAuthoringPanel(page);
    await page.locator("[data-yunari-glass-enabled]").focus();
    await page.keyboard.press("Space");
    await typeIntoControl(page, page.locator("[data-yunari-glass-blur]"), "24");

    // **Redo.** An edit an author can undo and get back is an edit the document
    // actually holds; a control whose history is one-way is a different promise.
    //
    // Focus leaves the number box first, because `edit.undo` and `edit.redo` are
    // deliberately deferred to a focused text field — Ctrl+Z in a number input is
    // that input's own undo, not the scene's. The radius box is the last control
    // in the panel, so Tab leaves focus on it, and the undo has to be aimed
    // somewhere real.
    await page.locator("[data-yunari-glass-enabled]").focus();
    // Two entries, so two steps: the enable wrote one and the radius another.
    await page.keyboard.press("Control+z");
    await expect(page.locator("[data-yunari-glass-blur]")).toHaveValue("16");
    expect(await treatmentOf(page, AUTHORING_PANEL_ID)).toEqual({
      blurRadius: 16,
    });
    await page.keyboard.press("Control+z");
    await expect(page.locator("[data-yunari-glass-enabled]")).not.toBeChecked();
    expect(await treatmentOf(page, AUTHORING_PANEL_ID)).toBeUndefined();
    await page.keyboard.press("Control+y");
    await page.keyboard.press("Control+y");
    await expect(page.locator("[data-yunari-glass-enabled]")).toBeChecked();
    await expect(page.locator("[data-yunari-glass-blur]")).toHaveValue("24");
    expect(await treatmentOf(page, AUTHORING_PANEL_ID)).toEqual({
      blurRadius: 24,
    });

    // **A token change through the UI.** The treatment is not a colour, so a
    // palette edit must not disturb it — and the panel must stay attached and
    // keep compositing, which is what the pixels show.
    const centre = await clientOfScene(
      page,
      AUTHORING_PANEL_ID,
      GLASS_ARTBOARD.width,
    );
    await page.mouse.click(centre.x, centre.y);
    // The **stroke** token, not the fill: replacing the panel's own tint with
    // an opaque colour would legitimately hide the glass and the blur would
    // then have nothing to show. Changing the outline is a palette edit the
    // treatment has to survive, with the backdrop still visible behind it. The
    // palette panel is the Tokens pane's, so it is in the Tokens pane.
    await openPane(page, "Design tokens");
    await page.locator('[data-yunari-palette-token-row="edge"]').click();
    // The pane has one trigger and the exact-value field lives in its popover.
    await page.locator("[data-yunari-palette-picker]").click();
    const colour = page.locator("[data-yunari-palette-color]");
    await colour.fill("rgb(200 220 255)");
    await colour.press("Tab");
    await expect(colour).toHaveValue(storedColour("rgb(200 220 255)"));

    expect((await treatmentOf(page, AUTHORING_PANEL_ID)) as unknown).toEqual({
      blurRadius: 24,
    });
    assertBlur(
      await readGlass(page, { id: AUTHORING_PANEL_ID, band: BAND }),
      "editor, after a token change",
    );

    // **Duplicate.** The clipboard carries `SCENE_PERSISTED_PROPERTIES`, which
    // includes the treatment; a copy without it would silently lose the blur.
    const before = (await saveEnvelope(page)) as {
      scene: { objects: ReadonlyArray<Record<string, unknown>> };
    };
    // History restores drop Fabric's selection, so the panel is clicked again
    // before the dock is asked to act — which is what an author does too.
    await selectAuthoringPanel(page);
    const dock = page.locator("[data-yunari-canvas-toolbar]");
    await dock.getByRole("button", { name: "Duplicate" }).click();
    const after = (await saveEnvelope(page)) as {
      scene: { objects: ReadonlyArray<Record<string, unknown>> };
    };
    // Counted by the radius this panel carries, because the fixture ships one
    // already-frosted panel of its own and a bare "has a treatment" count would
    // include it.
    const at = (envelope: {
      scene: { objects: ReadonlyArray<Record<string, unknown>> };
    }): number =>
      envelope.scene.objects.filter(
        (object) =>
          (object["yunariGlass"] as { blurRadius?: number } | undefined)
            ?.blurRadius === 24,
      ).length;
    expect(at(before)).toBe(1);
    expect(at(after)).toBe(2);
    // And the copy is a distinct object, not the original counted twice.
    expect(
      new Set(after.scene.objects.map((object) => object["id"])).size,
    ).toBe(after.scene.objects.length);
  });

  test("keeps a grouped panel's blur, so grouping is not a way to lose it", async ({
    page,
  }, testInfo) => {
    desktop(testInfo.project.name);
    await openFixture(page);
    await selectAuthoringPanel(page);

    const enabled = page.locator("[data-yunari-glass-enabled]");
    await enabled.focus();
    await page.keyboard.press("Space");
    await typeIntoControl(page, page.locator("[data-yunari-glass-blur]"), "24");
    assertBlur(
      await readGlass(page, { id: AUTHORING_PANEL_ID, band: BAND }),
      "editor, before grouping",
    );

    // Group it with the ordinary panel beside it, through the dock's own action.
    const neighbour = await clearOfHandles(page, "plain");
    await page.keyboard.down("Shift");
    await page.mouse.click(neighbour.x, neighbour.y);
    await page.keyboard.up("Shift");
    const dock = page.locator("[data-yunari-canvas-toolbar]");
    await dock.getByRole("button", { name: "Group", exact: true }).click();

    // The grouping itself is asserted, because "the blur still reads" would
    // also be true of a test whose grouping quietly did nothing — and the probe
    // walks into groups, so a panel that never left the top level would be found
    // and measured just as happily.
    const placement = await page.evaluate((id) => {
      const canvas = (
        window as unknown as {
          yunariEditorBridge: {
            editor: {
              canvas: {
                getObjects(): Array<{
                  get(name: string): unknown;
                  getObjects?(): Array<{ get(name: string): unknown }>;
                }>;
              };
            };
          };
        }
      ).yunariEditorBridge.editor.canvas;
      const top = canvas.getObjects().filter((o) => o.get("id") === id).length;
      let inGroup = false;
      for (const object of canvas.getObjects()) {
        for (const child of object.getObjects?.() ?? []) {
          if (child.get("id") === id) inGroup = true;
        }
      }
      return { top, inGroup };
    }, AUTHORING_PANEL_ID);
    expect(placement).toEqual({ top: 0, inGroup: true });

    // And the panel keeps compositing once it is inside one.
    assertBlur(
      await readGlass(page, { id: AUTHORING_PANEL_ID, band: BAND }),
      "editor, grouped",
    );
  });
});
