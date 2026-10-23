import { expect, type Page, test } from "@playwright/test";
import { shortcutLabel } from "../../packages/editor/src/shortcut-manager/display.js";
import { SHORTCUT_LABELS } from "../../packages/editor/src/shortcut-manager/reference.js";
import { uiCopy } from "../../packages/editor/src/ui-copy.js";
import { chooseIn } from "./control-set.js";
import { captureVisualReview, enterLayer } from "./editor-canvas.js";
import { openPane } from "./editor-rail.js";
import {
  openShell,
  PALETTES,
  SETTINGS_DIALOG,
  SETTINGS_GEAR,
} from "./shell-palette.js";
import { isDesktopSurface } from "./surface.js";

/** The editor URL, declared here rather than imported: every spec in this
 *  directory declares its own and no spec exports one (`editor.spec.ts:37`). */
const EDITOR = "http://127.0.0.1:4174/";

test("the Keyboard tab arms a row into the modal's trap, on a ring that clears contrast on every palette", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await openShell(page);
  const dialog = page.getByRole("dialog", SETTINGS_DIALOG);
  await page.locator(SETTINGS_GEAR).click();
  await expect(dialog).toBeVisible();

  const arm = dialog.locator('[data-yunari-shortcut-arm="publish.surface"]');
  const row = dialog.locator('[data-yunari-shortcut-row="publish.surface"]');
  const readings: string[] = [];
  const failures: string[] = [];
  let trapProved = false;

  for (const palette of PALETTES) {
    // The product's own route to a palette (`0035`): the Appearance tab's radio,
    // so what is measured is a palette the editor can really be in, and the
    // ring is measured where the author would see it.
    await dialog.getByRole("tab", { name: uiCopy.settings.appearance }).click();
    await dialog.getByRole("radio", { name: palette, exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-shell-palette",
      palette,
    );
    await dialog.getByRole("tab", { name: uiCopy.settings.keyboard }).click();

    // Arming the row: the arm control is the button an author presses.
    await arm.click();
    await expect(row).toHaveAttribute("data-armed", "");
    await expect(row).toBeFocused();

    if (!trapProved) {
      trapProved = true;
      // **The trap, in a browser.** jsdom applies no stylesheet and does no real
      // focus navigation, so this is the only place the armed row's focus inside
      // the modal is proved — and a focus that never landed is a capture that
      // would listen to nothing.
      const focused = await page.evaluate(() => {
        const active = document.activeElement;
        return {
          insideDialog: active?.closest('[role="dialog"]') !== null,
          action: active?.getAttribute("data-yunari-shortcut-row") ?? null,
        };
      });
      expect(
        focused.insideDialog,
        "the armed row took focus inside the modal's trap",
      ).toBe(true);
      expect(focused.action).toBe("publish.surface");
    }

    const probe = await row.evaluate((element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return {
        ownBackground: style.backgroundColor,
        outlineStyle: style.outlineStyle,
        outlineWidth: Number.parseFloat(style.outlineWidth),
        outline: style.outlineColor,
        // The ring is `outline-offset: -2px`, so it is the row's outermost two
        // pixels; the surface it is drawn on is the pixel just outside the row.
        // Both are read from one screenshot, so the ratio is the composite the
        // browser really painted — `graphite`'s and `light`'s modal surface is
        // translucent, and the pixel is the only honest reading of it.
        ring: { x: box.x + 1, y: box.y + box.height / 2 },
        surface: { x: box.x - 4, y: box.y + box.height / 2 },
      };
    });
    expect(
      probe.ownBackground,
      "the row paints its own background, so the pixel beside it is not the surface the ring sits on",
    ).toBe("rgba(0, 0, 0, 0)");
    // §5.4's boundary is a solid ring, not the browser's `auto` one.
    expect(probe.outlineStyle, palette).toBe("solid");
    expect(probe.outlineWidth, palette).toBeGreaterThanOrEqual(2);

    const [ring, surface] = await pixelsAt(page, [probe.ring, probe.surface]);
    if (ring === undefined || surface === undefined)
      throw new Error("the pixel reader returned fewer than two samples");
    const measured = round(contrast(ring, surface));
    readings.push(
      `${palette} armed-ring ${measured}:1 (outline ${probe.outline} on the modal surface ${rgba(surface)})`,
    );
    if (measured < BOUNDARY_MIN) {
      failures.push(
        `${palette}: the armed row's ring is ${measured}:1 (${probe.outline} on ${rgba(surface)}), below ${BOUNDARY_MIN}:1`,
      );
    }
  }

  for (const line of readings) {
    // Printed as well as attached: the table is the evidence a reader can check
    // without a trace.
    console.log(`contrast ${line}`);
  }
  expect(failures, "a required contrast minimum is not met").toEqual([]);

  await captureVisualReview(page, testInfo, "keyboard-armed-row");
});

/** §5.4's boundary minimum, the same 3:1 `design-language.spec.ts` gates the
 *  control set's own focus boundaries at. */
const BOUNDARY_MIN = 3;

type Rgba = readonly [number, number, number, number];

function rgba(pixel: Rgba): string {
  return `rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** WCAG 2.x relative luminance, over opaque pixels. */
function luminance(pixel: Rgba): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(pixel[0]) +
    0.7152 * channel(pixel[1]) +
    0.0722 * channel(pixel[2])
  );
}

function contrast(a: Rgba, b: Rgba): number {
  const first = luminance(a);
  const second = luminance(b);
  const [hi, lo] = first > second ? [first, second] : [second, first];
  return (hi + 0.05) / (lo + 0.05);
}

/** The rendered pixels at each point, from one viewport screenshot.
 *
 * The same shape `design-language.spec.ts` measures the control set's rings
 * with: a computed colour cannot answer what a surface with alpha over a
 * backdrop paints, so the pixel is the evidence and the arithmetic is over two
 * of them. The points are viewport CSS pixels from `getBoundingClientRect`, and
 * the screenshot is scaled by its own ratio to the viewport so a device pixel
 * ratio other than 1 cannot silently read the wrong pixel. */
async function pixelsAt(
  page: Page,
  points: readonly { readonly x: number; readonly y: number }[],
): Promise<readonly Rgba[]> {
  const shot = await page.screenshot();
  const b64 = shot.toString("base64");
  const read = await page.evaluate(
    async ({ b64, points }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${b64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (context === null) return null;
      context.drawImage(image, 0, 0);
      const scale = image.width / window.innerWidth;
      return points.map((point) => {
        const data = context.getImageData(
          Math.round(point.x * scale),
          Math.round(point.y * scale),
          1,
          1,
        ).data;
        return [
          data[0] ?? 0,
          data[1] ?? 0,
          data[2] ?? 0,
          data[3] ?? 0,
        ] as const;
      });
    },
    { b64, points: points as { x: number; y: number }[] },
  );
  if (read === null) throw new Error("the viewport could not be captured");
  return read;
}

test("the Keyboard tab's four states, and the sheet's chord mark that did not move", async ({
  page,
}, testInfo) => {
  // Spec §13.1: a screenshot proves one rendered state, not the behaviour behind
  // it, and every surface owner also proves its applicable states. The armed
  // row is the one the `keyboard-armed-row` capture shows (the test above); the
  // four here are **driven**, and the capture is not read as proving any of
  // them. The behaviour under each — what a capture refuses, what a rebind
  // writes — is `settings-keyboard.dom.test.tsx`'s; this is the rendered half.
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await openShell(page);
  const dialog = page.getByRole("dialog", SETTINGS_DIALOG);
  await page.locator(SETTINGS_GEAR).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: uiCopy.settings.keyboard }).click();

  const row = dialog.locator('[data-yunari-shortcut-row="publish.surface"]');
  const chip = row.locator("kbd");
  const arm = dialog.locator('[data-yunari-shortcut-arm="publish.surface"]');
  // The node is present while the row is armed even when it says nothing, so an
  // empty one is the state before a refusal rather than an absent feature.
  const refusal = row.locator('[data-yunari-shortcut-reason][role="alert"]');

  // ── 1. Empty overrides ───────────────────────────────────────────────────
  // Proves the panel renders the drawing's own state: every chord is its
  // default, and the header's return-to-default action is offered with nothing
  // to return. The store is read too, because "no row is rebound" is a claim
  // about what was stored and the marks alone cannot say it.
  const storedShortcuts = await page.evaluate(() =>
    Object.keys(window.localStorage).filter((key) => key.includes("shortcut")),
  );
  expect(
    storedShortcuts,
    "an override is already stored, so this is not the empty state",
  ).toEqual([]);
  await expect(chip).toHaveText(shortcutLabel("publish.surface"));
  await expect(
    dialog.locator("[data-yunari-shortcut-reset-all]"),
  ).toBeVisible();

  // ── 2. An armed row ──────────────────────────────────────────────────────
  // Proves the capture is listening where the press will land: the row takes
  // focus inside the modal's trap, marks itself armed, and its mark stops
  // printing a chord and starts asking for one.
  await arm.click();
  await expect(row).toHaveAttribute("data-armed", "");
  await expect(row).toBeFocused();
  await expect(chip).toHaveText(uiCopy.settings.keyboardPrompt);
  await expect(refusal, "a refusal is rendered before one was made").toHaveText(
    "",
  );

  // ── 3. A refusal in the armed row ────────────────────────────────────────
  // §9's reason and role: the sentence lands in the row that refused, names the
  // action that holds the chord, and the row stays armed so the author can press
  // the chord they meant. Ctrl+O is `file.open`'s default.
  await page.keyboard.press("Control+o");
  await expect(refusal).toHaveText(
    uiCopy.settings.keyboardTaken(SHORTCUT_LABELS["file.open"]),
  );
  await expect(row).toHaveAttribute("data-armed", "");
  await expect(chip).toHaveText(uiCopy.settings.keyboardPrompt);

  // ── The `?` sheet's chord mark, which Step 3 of the task must not move ────
  // The panel's chip is scoped to `.editor-shell-keyboard`, and the sheet
  // renders the shared `.editor-shell-dialog kbd` rule with no drawing behind
  // it. Read as a computed style rather than inspected: the shared rule is what
  // a change made for the modal would have moved by accident.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.keyboard.press("?");
  const sheet = page.getByRole("dialog", { name: uiCopy.shortcuts.reference });
  await expect(sheet).toBeVisible();
  const sheetChip = await sheet
    .locator("kbd")
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        padding: style.padding,
        borderWidth: style.borderTopWidth,
        borderRadius: style.borderRadius,
      };
    });
  expect(
    sheetChip,
    "the sheet's chord mark moved with the modal's chip, and no drawing governs the sheet",
  ).toEqual({ padding: "0px", borderWidth: "0px", borderRadius: "0px" });
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // ── 4. Storage refused (session-only) ────────────────────────────────────
  // The one state the editor cannot reach by clicking: `readStorage` answers
  // `undefined` only where the browser refuses the store, so the refusal is what
  // is planted, and the editor boots into it. What it proves is that the panel
  // states the limit instead of implying a saved preference — and that the
  // rebind still works for the session, which is the branch the unit suite
  // holds and this reading names.
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("the browser refused local storage");
      },
    });
  });
  await openShell(page);
  await page.locator(SETTINGS_GEAR).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: uiCopy.settings.keyboard }).click();
  await expect(dialog.locator(".editor-shell-keyboard-notice")).toHaveText(
    uiCopy.settings.keyboardSessionOnly,
  );
});

test("a chord rebound in the Keyboard tab is the chord the ? sheet prints", async ({
  page,
}, testInfo) => {
  // **`vg-284`'s missing browser assertion.** The `?` sheet's 20 `<kbd>`s are a
  // projection's membership count, so a rebind that reached the Keyboard tab and
  // stopped reaching the sheet left `toHaveCount(20)` green. Two jsdom files
  // redden on that break (`settings-keyboard.dom.test.tsx`,
  // `shortcut-reference.dom.test.tsx`); nothing in a browser did.
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await openShell(page);
  await page.locator(SETTINGS_GEAR).click();
  const dialog = page.getByRole("dialog", SETTINGS_DIALOG);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: uiCopy.settings.keyboard }).click();

  const row = dialog.locator('[data-yunari-shortcut-row="publish.surface"]');
  const chip = row.locator("kbd");
  const fallback = shortcutLabel("publish.surface");
  await expect(chip, "the row starts on its default chord").toHaveText(
    fallback,
  );

  // A free chord on this machine's platform, which is the spelling the tooltip
  // case below pins for `Ctrl+D` as well.
  const rebound = "Ctrl+J";
  await dialog.locator('[data-yunari-shortcut-arm="publish.surface"]').click();
  await expect(row).toHaveAttribute("data-armed", "");
  await page.keyboard.press("Control+j");
  await expect(chip, "the tab recorded the chord that was pressed").toHaveText(
    rebound,
  );
  expect(rebound).not.toBe(fallback);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.keyboard.press("?");
  const sheet = page.getByRole("dialog", { name: uiCopy.shortcuts.reference });
  await expect(sheet).toBeVisible();
  await expect(
    sheet.locator('[data-yunari-reference-row="publish.surface"] kbd'),
    "the sheet prints the effective chord, not the default",
  ).toHaveText(rebound);
});

test("every canvas action's tooltip names the chord that runs it", async ({
  page,
}, testInfo) => {
  // The **rendered** popup, not the registry: Task 2.2's unit test proves the
  // association exists, and this proves it reaches a screen. A `.editor-shell-tooltip`
  // locator here is the same class `editor.spec.ts:1427` names, so the mechanism
  // is the one already contracted.
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();
  // A **top-level** row, so no entry is needed. `cpu-card` is a part inside
  // `group-cpu-card`, and a part's row does not exist until its group is entered
  // or expanded (`bridge.ts:198-227`, and the starter's groups ship shut) — which
  // is why the one spec that clicks that row enters first (`editor.spec.ts:1107`).
  // The group is a selection like any other, so the dock offers its actions.
  await page.locator('[data-yunari-layer="group-cpu-card"]').click();

  const toolbar = page.locator("[data-yunari-canvas-toolbar]");
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole("button", { name: uiCopy.actions.duplicate }).hover();

  const tooltip = page.locator(".editor-shell-tooltip");
  await expect(tooltip).toBeVisible();
  // The chord the platform this browser runs on prints. On this machine that is
  // `Ctrl+D`; the Macintosh spelling is Task 1.2's unit test, because a browser
  // cannot be asked to report somebody else's keyboard.
  await expect(tooltip.locator("kbd")).toHaveText("Ctrl+D");
  // One popup, and not sitting on the control that opened it — the failure
  // `tooltip.ts:20-31` records, which jsdom cannot see because it has no layout.
  await expect(tooltip).toHaveCount(1);
  const [trigger, popup] = await Promise.all([
    toolbar
      .getByRole("button", { name: uiCopy.actions.duplicate })
      .boundingBox(),
    tooltip.boundingBox(),
  ]);
  // The popup's **bottom** clears the trigger's **top**. The weaker
  // `popup.y < trigger.y` passes while the popup still covers its trigger, which
  // is the exact failure this comment names; `editor.spec.ts:1490-1493` is the
  // form the suite already uses.
  expect(
    popup!.y + popup!.height,
    "the popup overlaps its own trigger",
  ).toBeLessThanOrEqual(trigger!.y);

  await captureVisualReview(page, testInfo, "keyboard-tooltip");
});

test("? opens the sheet, and the document behind it does not change", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();
  // Inside a group first, so the Escape assertion has something to lose.
  await enterLayer(page, "group-cpu-card");
  const selected = page.locator('[data-yunari-layer="cpu-card"]');
  await expect(selected).toBeVisible();

  await page.keyboard.press("?");
  // **By role *and* name.** The wrapper renders no `Dialog.Title`, so the sheet's
  // accessible name is its `aria-label`; a migration to a library that wires its
  // own labelling would leave the *attribute* reading back while the name a
  // screen reader announces changed. Asking by name is the assertion that sees
  // the difference (Review Focus 2), and `role` is what the shortcut manager's
  // own modal guard matches on (`shortcut-manager/index.ts:121-123`).
  const sheet = page.getByRole("dialog", {
    name: uiCopy.shortcuts.reference,
  });
  await expect(sheet).toBeVisible();
  // Every action is listed, which is the sheet's whole promise: §7's figure for
  // the table is eighteen, Task 3.3's `?` row makes it nineteen, Task 3.1's
  // `publish.surface` row makes it twenty, and the asset finder's
  // `file.findAssets` row makes it twenty-one. The row count is a property of
  // the projection rather than of this test — one `kbd` per action, joined
  // aliases and all.
  await expect(sheet.locator("kbd")).toHaveCount(21);

  // The capture is taken **here, with the sheet open**, because a shot named
  // for the reference that shows no reference is not evidence of one. Its
  // footer reads `Unsaved changes` — that is `vg-188`, entering a group marking
  // the document dirty, and it happens before this test presses anything.
  await captureVisualReview(page, testInfo, "keyboard-reference");

  // Nothing reaches the document behind it. This is the assertion for Review
  // Focus 2, and it is a *visible* one: if the Delete press landed, the layer
  // the author had selected would stop existing.
  await page.keyboard.press("Delete");
  await page.keyboard.press("Control+z");
  await expect(selected).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  // One press, one effect: the sheet closed and `view.exit-group` did **not**
  // also fire, so the group is still entered and its children's rows are still
  // mounted.
  //
  // **This fails on the built bundle, and that is the finding rather than a
  // flake** — `vg-187`, issue #32. The guard asks the DOM whether a modal is
  // open, but Radix has already unmounted the dialog by the time the manager's
  // window-bubble listener asks: Radix binds Escape on `document` in the
  // *capture* phase, and `Presence` unmounts from a `useLayoutEffect` whenever
  // `getComputedStyle(node).animationName` is `"none"`. jsdom never computes an
  // animation name — it reports `""` — so the unit test passes for a reason that
  // does not exist in a browser. These two lines are the regression proof.
  await expect(selected).toBeVisible();
  await expect(selected).toHaveCount(1);
});

test("the palette picker lands beside its trigger, and its tracks answer the arrow keys", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();
  // The palette panel is the Tokens pane's, so it is in the Tokens pane, and
  // the picker belongs to a **solid** token — a gradient's editor is a different
  // surface, which is why the token is named rather than left at the default.
  await openPane(page, "Tokens");
  await chooseIn(page, "[data-yunari-palette-token]", "background");

  const trigger = page.getByTestId("picker-trigger");
  await expect(trigger).toBeVisible();
  await trigger.click();
  const popover = page.getByTestId("colour-picker");
  await expect(popover).toBeVisible();

  // **Where it landed, which is what the migration could have broken.** The
  // popup moved from Radix's `Content`, which positions itself, to Base UI's
  // `Positioner`; a `Popup` placed straight in the portal renders unpositioned,
  // and the same class of mistake put this control's popover in the top-left
  // corner of the window once before (`panel.dom.test.ts:187-192`). Anchored to
  // a 28px swatch with a 6px offset, so the popup's top is just under it.
  const [swatch, popup] = await Promise.all([
    trigger.boundingBox(),
    popover.boundingBox(),
  ]);
  expect(swatch).not.toBeNull();
  expect(popup).not.toBeNull();
  expect(
    Math.abs(popup!.y - (swatch!.y + swatch!.height + 6)),
    "the popup is anchored to the swatch, not to the window",
  ).toBeLessThanOrEqual(12);

  // `vg-194` in a browser rather than in jsdom: the role promises a range and a
  // keyboard, so both are asked for. **The alpha track, not the hue one** — the
  // token this panel opens on is a near-black with no saturation, so a hue step
  // changes nothing an author could see and only alpha moves the hex.
  const alpha = page.getByTestId("picker-alpha");
  await expect(alpha).toHaveAttribute("aria-valuemin", "0");
  await expect(alpha).toHaveAttribute("aria-valuemax", "100");
  const before = Number(await alpha.getAttribute("aria-valuenow"));
  const readout = popover.locator("p");
  const said = await readout.textContent();

  await alpha.focus();
  await page.keyboard.press("ArrowLeft");

  await expect(alpha).toHaveAttribute("aria-valuenow", String(before - 1));
  // The same key reaches the value the author reads, not just the attribute.
  await expect(readout).not.toHaveText(said ?? "");
});
