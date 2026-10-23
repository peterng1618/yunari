import { expect, test } from "@playwright/test";
import {
  clearStyle,
  EDITOR,
  FREEZE,
  freeze,
  movingElements,
  prepareControls,
  setPalette,
} from "./design-language-readers.js";
import { captureVisualReview } from "./editor-canvas.js";
import { openPane, paneBody } from "./editor-rail.js";
import { SETTINGS_DIALOG, SETTINGS_GEAR } from "./shell-palette.js";
import { isDesktopSurface } from "./surface.js";

/** Responsibility: §7 control layout and zoom, reduced motion and registered control, shell, rail-pane and settings captures. */
test("control layout holds at desktop sizes and 200% zoom (§7)", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  test.setTimeout(180_000);
  await prepareControls(page);
  await setPalette(page, "light");
  await page.keyboard.press("Tab");
  await page.locator("[data-fixture='icon-focus'] button").focus();
  await expect(
    page.locator("[data-fixture='icon-focus'] button"),
  ).toBeFocused();
  // ── 6. Layout at both desktop sizes, and at 200% zoom ─────────────────────
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>("[data-fixture-root]");
      if (root === null) return null;
      const box = root.getBoundingClientRect();
      const escaped: string[] = [];
      for (const element of document.querySelectorAll(
        "[data-fixture-root] *",
      )) {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0) continue;
        if (rect.right > box.right + 1 || rect.left < box.left - 1) {
          escaped.push(
            `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 24)}`,
          );
        }
      }
      return {
        pageScroll: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
        escaped,
      };
    });
    expect(layout, "the fixture is not mounted").not.toBeNull();
    if (layout === null) continue;
    // The long Unicode name is the case: §7.7 lets it ellipsize, never widen a
    // pane or push a control out of one.
    expect(
      layout.escaped,
      `at ${viewport.width}×${viewport.height} an element escapes the fixture: ${layout.escaped.join(", ")}`,
    ).toEqual([]);
    expect(
      layout.pageScroll,
      `at ${viewport.width}×${viewport.height} the page scrolls sideways`,
    ).toBeLessThanOrEqual(layout.viewport);
  }

  // 200% browser zoom, which CSS `zoom` on the root approximates: the pane
  // halves in CSS pixels, so the wrap that keeps a long name inside a pane is
  // the thing under test.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  const zoomed = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("[data-fixture-root]");
    if (root === null) return null;
    return {
      scroll: root.scrollWidth,
      client: root.clientWidth,
      pageScroll: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    };
  });
  expect(zoomed, "the fixture is not mounted").not.toBeNull();
  if (zoomed !== null) {
    expect(
      zoomed.pageScroll,
      `at 200% zoom the fixture overflows the page: ${JSON.stringify(zoomed)}`,
    ).toBeLessThanOrEqual(zoomed.viewport);
    expect(
      zoomed.scroll,
      `at 200% zoom the fixture overflows its own box: ${JSON.stringify(zoomed)}`,
    ).toBeLessThanOrEqual(zoomed.client + 1);
  }
  await page.evaluate(() => {
    document.documentElement.style.zoom = "";
  });
});

test("reduced motion leaves no control animating (§5)", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  test.setTimeout(180_000);
  await prepareControls(page);
  await setPalette(page, "light");
  await page.keyboard.press("Tab");
  await page.locator("[data-fixture='icon-focus'] button").focus();
  await expect(
    page.locator("[data-fixture='icon-focus'] button"),
  ).toBeFocused();
  // ── 7. Reduced motion leaves nothing animating ────────────────────────────
  //
  // The freeze comes off first, and that is load-bearing: it sets
  // `transition: none !important` on the same scope this section reads, so while
  // it is applied every duration is `0s` and the assertion below holds whatever
  // the stylesheet does. It was applied here for a whole round and the check was
  // therefore vacuous.
  //
  // The positive control is what stops that recurring: with motion *allowed*,
  // something in the fixture must be animating — the shell transitions its
  // colours and the toggle's thumb its transform — or this section is reading a
  // page that cannot move and proves nothing by finding no movement. Then the
  // same probe under `reduce` must come back empty.
  await clearStyle(page, FREEZE);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const allowed = await movingElements(page);
  expect(
    allowed,
    "nothing animates with motion allowed, so this check cannot observe motion at all",
  ).not.toEqual([]);

  await page.emulateMedia({ reducedMotion: "reduce" });
  const moving = await movingElements(page);
  expect(
    moving,
    `an element still animates under prefers-reduced-motion: ${moving.join(", ")}`,
  ).toEqual([]);
  await page.emulateMedia({ reducedMotion: null });
});

test("captures the control set on both registered grounds", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  test.setTimeout(180_000);
  await prepareControls(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.keyboard.press("Tab");
  await page.locator("[data-fixture='icon-focus'] button").focus();
  await expect(
    page.locator("[data-fixture='icon-focus'] button"),
  ).toBeFocused();
  // ── 8. The captures the parity gate compares ──────────────────────────────
  //
  // Blurred first: focusing the icon button opened its tooltip, and a popup
  // left over its neighbour is an artefact of how the states were driven rather
  // than part of the control set. Two palettes, because the stress set asks for
  // graphite and editorial: graphite is the one the mockup is drawn on
  // (`docs/design/mockups/current/controls.html`: `#0b0e12` paper, `#171c23`
  // wells, `#72e0c0` accent) and so the two pictures are comparable, and
  // editorial is the light ground the same vocabulary has to hold on.
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await freeze(page);
  await setPalette(page, "graphite");
  await captureVisualReview(page, testInfo, "control-set");
  await setPalette(page, "editorial");
  // `setPalette` sets the attribute with no stored choice in storage, so unlike
  // the Appearance-tab route nothing holds this ground across a re-render. The
  // helper asserts it before the shot rather than assuming it: ruling 3's
  // light/dark pair must not be a picture the pin repainted to graphite.
  await captureVisualReview(
    page,
    testInfo,
    "control-set-editorial",
    undefined,
    "editorial",
  );
  // The freeze stays on *through* the captures on purpose: the shell transitions
  // colour over 140ms, and a palette change captured mid-fade is a picture of
  // neither palette — the first editorial capture here showed teal toggles and
  // invisible labels for exactly that reason. It comes off afterwards because it
  // is a measuring device, not part of the fixture.
  await clearStyle(page, FREEZE);
});

/**
 * The shell parity capture (DESIGN.md §7.1–§7.3, mockup
 * `docs/design/mockups/current/shell.html`).
 *
 * Plan 1's mechanism, turned on the rebuilt shell: the built editor is opened
 * in the state the mockup draws — the **Add** slot showing, nothing selected —
 * and photographed for Task 10's side-by-side. The whole-editor and dock
 * captures in `editor.spec.ts` are the other two of the comparison set.
 *
 * **It fails if the shell is not the new one**, which is the point: an old
 * shell photographed happily is a comparison against the wrong thing. Two
 * facts are asserted before the picture is written — the rail carries DESIGN.md
 * §7.2's four slots (the pre-rail shell had an Insert menu and no rail, so the
 * count is 0) and exactly one of the rail's panes is showing (the shell keeps
 * every pane mounted and hides the others, so a leftover second pane in the
 * column shows as two).
 *
 * A `--grep` that matches nothing exits 0 with zero tests, so the run's own
 * summary — "1 test", this file — is the proof it ran at all, not the exit code.
 */
test("captures the shell with the Add pane open and nothing selected", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();

  // §7.2's four slots, and only a shell that has the rail has them.
  await expect(page.locator(".editor-shell-rail-slot")).toHaveCount(4);

  await openPane(page, "Add");
  await expect(page.locator('[data-yunari-panel="add"]')).toBeVisible();
  // Exactly one of the rail's four panes is out. Scoped to the rail's own
  // column (`.editor-shell-panel`) because the inspector is built from the same
  // `Pane` component and carries `style` and `selection` panels of its own — a
  // bare `[data-yunari-panel]` count of six panes is not "one pane showing".
  // `:visible`, not a bare count: every pane stays mounted and the ones that
  // are not showing carry `hidden` (`display: none`), which is not showing.
  // **A direct child of the rail's column**, because the document carries more
  // panes than the rail's four: the inspector's `style` and `selection` panels
  // are `Pane`s of their own, and a bare `[data-yunari-panel]` count of six is
  // not "one pane showing". The Document pane's own References section was the
  // one sub-panel that named itself `data-yunari-panel="references"`, and it
  // went with item 17 (`vg-474`).
  await expect(
    page.locator(".editor-shell-panel > [data-yunari-panel]:visible"),
  ).toHaveCount(1);

  // Park the pointer over the stage before the shot. `openPane` clicked the Add
  // slot, leaving the pointer hovering it: after 220ms the slot's tooltip
  // bubble opens and paints over the rail/pane boundary — a difference the
  // mockup does not draw, in the one image this plan calls the primary
  // comparison.
  const stage = await page.locator(".editor-shell-stage").boundingBox();
  if (stage !== null) {
    await page.mouse.move(
      stage.x + stage.width / 2,
      stage.y + stage.height / 2,
    );
  }

  await captureVisualReview(page, testInfo, "editor-shell-add");
});
/**
 * The panes' parity capture (DESIGN.md §7.3, mockup
 * `docs/design/mockups/current/shell.html`).
 *
 * The same mechanism as the shell capture above, turned on the four rebuilt
 * panes: the built editor is opened with one rail pane showing at a time, and
 * each pane's own chrome and body is photographed for Task 12's comparison.
 * The mockup draws a specimen of **Add** only, so the other three are compared
 * against DESIGN.md and this plan's field inventories rather than a drawing —
 * which is why the image is the pane itself and not the whole shell: the field
 * inventory is what has to be readable in it.
 *
 * **Each capture fails if the pane is not the new one**, which is the point: an
 * old pane photographed happily is a comparison against the wrong thing. Three
 * facts are asserted before a picture is written, and the third is the failure
 * this capture exists to catch:
 *
 * - the pane's own `[data-yunari-panel]` handle is showing, and it is the only
 *   pane the rail's column has out (the shell keeps every pane mounted and
 *   hides the others, so a leftover second pane shows as two);
 * - the handle is the **host's** — `editor-shell/pane.tsx` writes it, so it
 *   names which pane is mounted rather than what the pane rendered;
 * - the pane holds no native `<select>` and no `input[type=range]`. The four
 *   panes are React on the control set (a well that opens a list is a
 *   `ControlSelect`, a range is a `ControlSlider`), and a native control
 *   reappearing is exactly what a screenshot would still show as "a pane".
 *   The only hit left under `panes/` is the prose that says so
 *   (`tokens/preset-list.tsx:29`).
 *
 * A `--grep` that matches nothing exits 0 with zero tests, so the run's own
 * summary — "1 test", this file — is the proof it ran at all, not the exit code.
 */
test("captures each pane of the four-slot rail in the design language", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();

  // §7.2's four slots, one pane each.
  await expect(page.locator(".editor-shell-rail-slot")).toHaveCount(4);

  /** The rail's slot word, and the DOM handle that slot's pane is mounted
   *  under. The two differ for Composition only: `layers` is the name the
   *  panel CSS and the older specs already browse by, and the pane's visible
   *  title is the slot's own word (`shell-layout.tsx` states the ruling). */
  const panes = [
    { slot: "Composition", panel: "layers" },
    { slot: "Add", panel: "add" },
    { slot: "Tokens", panel: "tokens" },
    { slot: "Document", panel: "document" },
  ] as const;

  for (const { slot, panel } of panes) {
    await openPane(page, slot);

    // The pane's surface is the rail's own column, not the `section` inside it.
    // The column is the box the author sees — 246×636 against a viewport of
    // 1280×720 — and it clips whatever the pane draws, the pane's own body
    // included; the body is what scrolls (§7.7, `vg-208`), and the column is
    // what says how much of it is on screen. Photographing the inner `section`
    // instead captures the pane's whole *layout* box with that clip ignored —
    // measured, the Tokens pane is 220×2166, so its image was 1800px of blank
    // page and the status bar, none of which an author ever sees.
    const column = page.locator(".editor-shell-panel");
    const pane = page.locator(`[data-yunari-panel="${panel}"]`);
    await expect(pane, `${slot}: its pane is not showing`).toBeVisible();
    // One pane out, read as a **direct child** of the rail's column: the
    // inspector's `style` and `selection` panels are `Pane`s of their own, so
    // the rail's column is what says which of the four is showing. The
    // Document pane's own References section was the one sub-panel that named
    // itself `data-yunari-panel="references"`, making a descendant match read
    // 2 — measured, `["document", "references"]` — until item 17 removed it
    // (`vg-474`). A visible `pane` plus one visible direct child is what says
    // it is the one the rail has out.
    await expect(
      page.locator(".editor-shell-panel > [data-yunari-panel]:visible"),
      `${slot} is not the pane the rail has out`,
    ).toHaveCount(1);

    await expect(
      pane.locator("select"),
      `${slot}: a native <select> is in the pane`,
    ).toHaveCount(0);
    await expect(
      pane.locator('input[type="range"]'),
      `${slot}: a native range input is in the pane`,
    ).toHaveCount(0);

    // **The removed read-only section has to be shown gone, not just absent
    // from an assertion nobody reads.** Its own suite died with it, so this file
    // is the only reader left for the Document half of "neither read-only
    // section renders anywhere", and the frame below is the reader an author
    // trusts. The pane holds two regions now; the third named itself twice — its
    // own `data-yunari-panel="references"` handle and its "This document"
    // heading — so both are read here, at the moment the frame is written.
    if (panel === "document") {
      const regions = pane.locator("[data-yunari-section]");
      await expect(regions, "the Document pane's own regions").toHaveCount(2);
      expect(
        await regions.evaluateAll((elements) =>
          elements.map((element) =>
            element.getAttribute("data-yunari-section"),
          ),
        ),
        "the Document pane is Theme settings and the artboard, and nothing else",
      ).toEqual(["theme", "artboard"]);
      await expect(
        pane.locator('[data-yunari-panel="references"]'),
        "the document's own references sub-panel is back",
      ).toHaveCount(0);
      // The section rendered *last* in the pane — `editor-session.ts` appended
      // its host under `panelHosts.document` after the pane's own React root —
      // so it lived below the 636px fold and the top-of-pane frame this capture
      // used to take showed the same pixels with it and without it. Scrolled to
      // the end, the frame lands on where it was: the artboard's tail now, the
      // collapsed "This document" header before item 17.
      // The scroll belongs to the pane's **body** since `vg-208`: the column
      // clips, so setting its `scrollTop` is a no-op and the frame would land on
      // the pane's top rather than its tail.
      await paneBody(page).evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
    }

    // Park the pointer over the stage before the shot, for the reason the
    // shell capture gives: `openPane` left it hovering a rail slot, and that
    // slot's tooltip opens over the rail/pane boundary after 220ms.
    const stage = await page.locator(".editor-shell-stage").boundingBox();
    if (stage !== null) {
      await page.mouse.move(
        stage.x + stage.width / 2,
        stage.y + stage.height / 2,
      );
    }

    await captureVisualReview(
      page,
      testInfo,
      `pane-${slot.toLowerCase()}`,
      column,
    );
  }
});

/**
 * The Settings surface's parity capture (spec §7, §13, mockup
 * `docs/design/mockups/current/settings.html`).
 *
 * Plan 1's mechanism, turned on the modal the rail's gear opens: the built
 * editor is opened, the gear pressed, and each of §7's three tabs photographed
 * beside the mockup's settings surface. Two palettes, because the mockup draws one
 * ground and a hard-coded hex is invisible in a single one — graphite is the
 * paper the mockup is drawn on, editorial the light ground the same vocabulary
 * has to hold on.
 *
 * **It fails if the surface is not the new one**, which is the point: a picture
 * written over the old shell is a comparison against the wrong thing. Four
 * facts are asserted before any image is written — the header carries no
 * palette control (§7 moved the chip into this modal), the gear is on the rail
 * and is there, the modal holds §7's three tabs by name, and exactly one panel
 * is showing (every panel stays mounted, so a leftover second one shows as two).
 *
 * The About tab's release row renders only where the open document carries a
 * `metadata.version` (`settings.tsx`'s `versionFacts`). No document this suite
 * can load has one — the starter and blank-theme builders write metadata
 * without it (`new-fabric-theme.ts`), and no fixture or library stub supplies
 * one — so the row is absent from this image and the run says so in its own
 * annotation rather than inventing a version to sit in the picture.
 *
 * A `--grep` that matches nothing exits 0 with zero tests, so the run's own
 * summary — "1 test", this file — is the proof it ran at all.
 */
test("captures the settings modal's four tabs in the design language", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  test.setTimeout(120_000);

  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();

  // §7 moved the palette chip out of the header; a chip or a choice row still
  // there means this is the old header and the frame would be of the wrong thing.
  await expect(
    page.locator(
      ".editor-shell-header .editor-shell-palette-swatch, .editor-shell-header [data-yunari-palette-choice]",
    ),
  ).toHaveCount(0);

  const gear = page.locator(SETTINGS_GEAR);
  await expect(gear).toHaveCount(1);
  await gear.click();
  const dialog = page.getByRole("dialog", SETTINGS_DIALOG);
  await expect(dialog).toBeVisible();

  // §7's four tabs, by the words the modal prints, and one panel out.
  await expect(dialog.getByRole("tab")).toHaveCount(4);
  for (const name of ["Appearance", "Keyboard", "Connections", "About"]) {
    await expect(dialog.getByRole("tab", { name })).toBeVisible();
  }
  await expect(dialog.locator('[role="tabpanel"]:visible')).toHaveCount(1);

  /** One tab, shown. `data-active` is the hook the stylesheet paints the active
   *  tab's accent border from, so a tab that did not take fails here rather than
   *  being photographed under a picture named for it. */
  const show = async (name: string): Promise<void> => {
    const tab = dialog.getByRole("tab", { name });
    await tab.click();
    await expect(tab).toHaveAttribute("data-active", "");
    await expect(dialog.locator('[role="tabpanel"]:visible')).toHaveCount(1);
  };

  // The About tab's facts, read from the surface rather than assumed: the schema
  // version is the build's own and is always there.
  await show("About");
  await expect(
    dialog.locator('[data-yunari-about-fact="schema-version"]'),
  ).toHaveText(/\S/);
  // The product version is the workspace manifest's, injected by Vite's `define`
  // at build time, so a bundle built without that step shows no version at all —
  // asserted as a version shape rather than as "some text", which `undefined`
  // would satisfy (`vg-279`).
  await expect(
    dialog.locator('[data-yunari-about-fact="product-version"]'),
  ).toHaveText(/^\d+\.\d+\.\d+/);
  // **The release row must be absent, and this assertion is what says so.** It
  // renders only where the open document carries `metadata.version`
  // (`settings.tsx`'s `versionFacts`), and no document this suite can load has
  // one — so this frame is the absent case and the six pictures below are of
  // *that* modal. `vg-288`: the day a loadable document carries a version, this
  // reddens and the capture is re-taken, rather than a changed modal being
  // photographed while a non-assertion records it.
  await expect(
    dialog.locator('[data-yunari-about-fact="release-version"]'),
  ).toHaveCount(0);
  testInfo.annotations.push({
    type: "about",
    description:
      "release version row absent, asserted: no document this suite loads carries a metadata.version",
  });

  // Graphite first: the mockup is drawn on it, so the two pictures compare.
  await show("Appearance");
  await dialog.getByRole("radio", { name: "graphite", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-shell-palette",
    "graphite",
  );

  /** One tab, shown and photographed. The pointer is parked on the dialog's own
   *  top-left corner — the lead heading, no control — because the click left it
   *  on a tab, and a hover state in the frame is an artefact of how the picture
   *  was driven rather than part of the surface. */
  const capture = async (tab: string, suffix: string): Promise<void> => {
    await show(tab);
    const box = await dialog.boundingBox();
    if (box !== null) await page.mouse.move(box.x + 2, box.y + 2);
    await captureVisualReview(
      page,
      testInfo,
      `settings-${tab.toLowerCase()}${suffix}`,
      dialog,
    );
  };

  for (const tab of ["Appearance", "Keyboard", "About"]) {
    await capture(tab, "");
  }

  await show("Appearance");
  await dialog.getByRole("radio", { name: "editorial", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-shell-palette",
    "editorial",
  );
  for (const tab of ["Appearance", "Keyboard", "About"]) {
    await capture(tab, "-editorial");
  }
});
