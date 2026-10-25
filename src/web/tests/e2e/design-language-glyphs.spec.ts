import { expect, test } from "@playwright/test";
import { EDITOR, GLYPH_TIERS, glyphWeight } from "./design-language-readers.js";
import { captureVisualReview } from "./editor-canvas.js";
import { openPane } from "./editor-rail.js";
import { isDesktopSurface } from "./surface.js";

/** Responsibility: §6 glyph weights and tooltip words in the real shell, plus its registered capture. */
/**
 * The glyph and word parity capture (DESIGN.md §6 and §9, mockup
 * `docs/design/mockups/current/shell.html`).
 *
 * Plan 1's mechanism, turned on the surface this plan changed: the built
 * editor is opened in the state the drawing shows — the **Add** slot open,
 * nothing selected — in **graphite**, the ground the drawing is drawn on, and
 * the shell is photographed for the side-by-side. This plan changes no layout,
 * so the comparison is the **glyphs and the words inside** the surfaces plans
 * 2–5 built (the rail's four slot glyphs, the pane's footer, the status bar's
 * readings), never their geometry. The whole-editor and dock captures in
 * `editor.spec.ts` and the pane captures above are the rest of the set.
 *
 * **The mechanical assertion is the rendered DOM, and it is the half
 * `design:check` cannot see.** The token scan reads `px` and hex literals in
 * source; a glyph's weight is a JSX prop — `strokeWidth={glyphStrokeWidth(size)}`
 * or a lucide component's own default — so no source scan can read it. This
 * test reads the built shell instead: every stroke `<svg>` the shell draws is at
 * §6's weight for its own size, sits in §6's tiers, and carries **no descendant
 * `stroke-width`** — a child that overrode its root would be a second weight
 * inside one glyph, and reading only each root is exactly how a heavy arc goes
 * unseen. Then §6's second rule: every icon-only control's rendered tooltip is
 * the same string as its `aria-label`.
 *
 * **It fails if the glyphs are not the new ones**, and the weight reading was
 * reddened two ways. A bundle built from before Task 2 (`b5abe5f0`, the parent of
 * the commit that added `icons.ts`, built in a `git worktree`) fails it on every
 * glyph: each is drawn at stroke-width 1.75, which is not one of §6's tiers.
 * Planting a wrong weight in `glyphStrokeWidth` and rebuilding fails it too, and
 * `design:check` stays green through that break — which is why a rendered reading
 * exists at all. The pairing half has its own plant: appending one space in
 * `useControlTooltip`'s `text` — the exact drift §6 names — fails it on every
 * icon-only control in the state ("Composition: the tooltip reads
 * \"Composition \""), and reverting by `cp` restores the file byte for byte.
 *
 * A `--grep` that matches nothing exits 0 with zero tests, so the run's own
 * summary — "1 test", this file — is the proof it ran at all, not the exit code.
 */
test("captures the shell glyphs and words with the Add pane open", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  // The drawing's own ground. `prefersDark` is the shell's route to graphite
  // (`palette.ts`'s `systemShellPalette`), and a dark OS is the only way to ask
  // for it without opening the settings modal and changing the state the
  // drawing shows.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();
  await expect(
    page.locator("html"),
    "the shell is not on the drawing's ground, so the two pictures would not compare",
  ).toHaveAttribute("data-shell-palette", "graphite");

  // §7.2's five slots, and only a shell that has the rail has them.
  await expect(page.locator(".editor-shell-rail-slot")).toHaveCount(5);
  await openPane(page, "Add");
  await expect(page.locator('[data-yunari-panel="add"]')).toBeVisible();
  // Exactly one of the rail's four panes is out, by the direct-child reading the
  // shell capture above documents.
  await expect(
    page.locator(".editor-shell-panel > [data-yunari-panel]:visible"),
  ).toHaveCount(1);

  // ── 1. Every glyph the shell draws is at §6's weight for its own size ──────
  //
  // Scoped to `#app` (the React root), so the tooltip `tooltip.ts` portals to
  // `document.body` is out of frame. A hidden pane is included on purpose: the
  // shell keeps every pane mounted, and a glyph the author cannot see is still a
  // glyph the vocabulary set. A fill-only picture — a state dot, a QR — computes
  // `stroke: none` and is not a stroke glyph (§6's one-weight set is stroke
  // chrome), so it is skipped rather than asserted against a weight it has none
  // of.
  //
  // Three boundaries, stated rather than left to be inferred. A mark with **no
  // `width` attribute, or a non-numeric one**, is skipped: `Number(width)` is
  // `NaN` for a CSS-sized mark such as `width="100%"`, so this is every
  // width-bearing stroke glyph under the root, not every mark the shell draws. A
  // glyph **portalled outside `#app`** is unreached. And only **this one state**
  // is read — the Add pane open on graphite.
  const glyphs = await page.evaluate(() => {
    const drawn: {
      readonly where: string;
      readonly size: number;
      readonly stroke: number;
      readonly overrides: readonly string[];
    }[] = [];
    for (const svg of document.querySelectorAll("#app svg")) {
      const width = svg.getAttribute("width");
      if (width === null || !Number.isFinite(Number(width))) continue;
      const style = getComputedStyle(svg);
      if (style.stroke === "none") continue;
      const button = svg.closest("button");
      const where =
        button?.getAttribute("aria-label") ??
        String(
          svg.getAttribute("class") ??
            svg.getAttribute("data-yunari-card-diagram") ??
            svg.parentElement?.className ??
            svg.tagName,
        ).slice(0, 40);
      drawn.push({
        where,
        size: Number(width),
        stroke: Number.parseFloat(style.strokeWidth),
        overrides: [...svg.querySelectorAll("[stroke-width]")].map(
          (child) =>
            `${child.tagName.toLowerCase()} stroke-width=${String(child.getAttribute("stroke-width"))}`,
        ),
      });
    }
    return drawn;
  });

  // A guard that asserted over nothing would pass for the wrong reason — the
  // state has to have drawn glyphs before any weight below is a reading.
  expect(
    glyphs.length,
    "the shell drew no stroke glyph to read, so this is not a reading",
  ).toBeGreaterThan(20);

  const wrongWeight: string[] = [];
  const offTier: string[] = [];
  const overridden: string[] = [];
  const sizes: string[] = [];
  for (const glyph of glyphs) {
    sizes.push(String(glyph.size));
    if (!GLYPH_TIERS.includes(glyph.stroke)) {
      offTier.push(
        `${glyph.where} ${glyph.size}px stroke-width=${glyph.stroke}`,
      );
    }
    if (glyph.stroke !== glyphWeight(glyph.size)) {
      wrongWeight.push(
        `${glyph.where}: ${glyph.size}px is drawn at ${glyph.stroke}, and §6's rule for that size is ${glyphWeight(glyph.size)}`,
      );
    }
    for (const override of glyph.overrides) {
      overridden.push(
        `${glyph.where}: a descendant carries its own ${override}`,
      );
    }
  }
  // More than one size in play, so the case is not passing over a single tier by
  // accident — a shell that drew one weight everywhere is the defect §6's tiers
  // replaced.
  expect(
    new Set(sizes).size,
    `every glyph was drawn at one size (${sizes.join(", ")}), so the tiers were not exercised`,
  ).toBeGreaterThan(1);
  expect(offTier, "a glyph's weight is not one of §6's tiers").toEqual([]);
  expect(wrongWeight, "a glyph is not at §6's weight for its own size").toEqual(
    [],
  );
  expect(
    overridden,
    "a glyph's descendant overrides its root's weight, which is a second weight inside one glyph",
  ).toEqual([]);
  testInfo.annotations.push({
    type: "glyph-weights",
    description: `${glyphs.length} glyphs at sizes ${[...new Set(sizes)].sort((a, b) => Number(a) - Number(b)).join(", ")}px`,
  });

  // ── 2. An icon-only control's tooltip is its accessible name (§6) ──────────
  //
  // The **rendered** popup, not the pairing's source: `ControlIconButton` and
  // `useControlTooltip` set both from one `label` by construction, and this
  // proves the string reaches the screen a reader is shown. An icon-only control
  // is read as one — a non-empty `aria-label` on a button that renders no text —
  // so a labelled button (`Publish`) is not swept in. A hidden pane's control
  // cannot be focused, so it is skipped and named in the count.
  //
  // **This population is narrower than the weight scan above, and the boundary
  // is stated for that reason.** It is `<button>` elements with an `aria-label`;
  // an icon-only control that is not a `<button>`, or one named through
  // `aria-labelledby` instead, is not swept in. Neither occurs in this state —
  // the shell has no `role="button"`, and the only `aria-labelledby` holders are
  // the segmented control, the slider's range, `settings.tsx`'s palette group and
  // the dialog, none of them a button — but the weight half is exhaustive over
  // the root and this half is not.
  const iconOnly = await page.evaluate(() => {
    const out: { readonly label: string; readonly index: number }[] = [];
    for (const [index, button] of [
      ...document.querySelectorAll<HTMLElement>("#app button[aria-label]"),
    ].entries()) {
      const label = button.getAttribute("aria-label") ?? "";
      if (label === "") continue;
      if ((button.textContent ?? "").trim() !== "") continue;
      if (button.hasAttribute("disabled")) continue;
      const rect = button.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      out.push({ label, index });
    }
    return out;
  });
  expect(
    iconOnly.length,
    "the shell mounted no icon-only control, so the pairing was not read",
  ).toBeGreaterThan(0);

  const disagreements: string[] = [];
  const popup = page.locator(".editor-shell-tooltip span");
  for (const control of iconOnly) {
    await page.locator("#app button[aria-label]").nth(control.index).focus();
    let text: string;
    try {
      await popup.waitFor({ state: "attached", timeout: 2000 });
      text = (await popup.first().textContent()) ?? "";
    } catch {
      text = "<no tooltip opened>";
    }
    if (text !== control.label) {
      disagreements.push(`${control.label}: the tooltip reads "${text}"`);
    }
  }
  await page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.blur(),
  );
  expect(
    disagreements,
    "an icon-only control's tooltip disagrees with its accessible name",
  ).toEqual([]);
  testInfo.annotations.push({
    type: "tooltip-names",
    description: `${iconOnly.length} icon-only control(s): the tooltip is the aria-label for each`,
  });

  // Park the pointer over the stage before the shot, for the reason the shell
  // capture above gives: `openPane` left it hovering a rail slot, and that
  // slot's tooltip opens over the rail/pane boundary after 220ms.
  const stage = await page.locator(".editor-shell-stage").boundingBox();
  if (stage !== null) {
    await page.mouse.move(
      stage.x + stage.width / 2,
      stage.y + stage.height / 2,
    );
  }

  await captureVisualReview(page, testInfo, "editor-shell-glyphs");
});
