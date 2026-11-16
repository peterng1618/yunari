import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  CATALOGUE_ORIGIN,
  type CatalogueOrigin,
  DASHBOARD_THEME_KIND,
  type FabricThemeEnvelope,
  facetRecordOf,
} from "@yunari/renderer-core";
import { writeThemePackage } from "@yunari/theme-package";
import { DARK_GROUND } from "../../packages/editor/src/store-mode/item-fixture.js";
import { uiCopy } from "../../packages/editor/src/ui-copy.js";
import { answerDialogIfShown, captureVisualReview } from "./editor-canvas.js";
import { openEveryGroup, openPane, paneBody } from "./editor-rail.js";
import { selectLayer } from "./rebuild-driver.js";
import { openThemeFromStore, storedThemeOfPackage } from "./store-library.js";
import { isDesktopSurface } from "./surface.js";
import { withRoleTokens } from "./theme-fixture.js";
import { stubWidgetPacks } from "./widget-packs-fixture.js";

/**
 * The contract of the shared `openPane` helper, against the real editor.
 *
 * The rail is a toggle, so the helper this suite hands to its call sites is
 * only correct if it reads the state first. When it did not, every call site
 * that asked for the pane already showing closed it instead, and the failure
 * landed as a timeout in an unrelated assertion rather than as anything naming
 * the helper. These two cases are the whole contract: asking twice is still
 * open, and asking for a pane that is shut is still open.
 */

const EDITOR = "http://127.0.0.1:4174/?mode=editor";

/** The design's rail accent bar, in px. A bare number rather than a `px`
 *  string so the one value is written once and the assertion's message spells
 *  it from here — the step table has no entry for it. */
const RAIL_ACCENT_BAR_PX = 2;

/** The header strip, in px, for the same reason: `--header-height` is a
 *  density rather than one of the steps, so the one value is written here and
 *  the mode-switch case spells its message from this. */
const HEADER_STRIP_PX = 42;

/**
 * **No case in this spec may reach the catalogue's public URL.**
 *
 * A page starts its online read when it mounts
 * (`library-mode/sources.ts`), and the installed half is read beside it, so every case
 * that opens the Library mode would otherwise ask `yunari-store.workers.dev`
 * for a catalogue that does not exist until phase E. The answer would be
 * whatever the network says that day, not what the case is measuring.
 *
 * The default is the honest state — "there is no catalogue here" — and a 404
 * keeps it distinguishable from an empty catalogue, which
 * must not be drawn when the read failed.
 *
 * A case that needs a catalogue registers `**\/index.json` itself in its body.
 * Playwright runs the most recently registered matching handler first, so that
 * fixture answers and this default never sees the request.
 */
test.beforeEach(async ({ page }) => {
  await page.route("**/index.json", (route) =>
    route.fulfill({
      status: 404,
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  // The preview serves no host routes, and the editor reads its installed
  // widget units from the host at boot. Without an answer the read fails, the
  // Widgets pane is empty and the status strip carries the warning.
  await stubWidgetPacks(page);
});

test("asking for the pane already showing leaves it showing", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();

  await openPane(page, "Add");
  await expect(page.locator('[data-yunari-panel="add"]')).toBeVisible();

  // The second ask is the whole test. An unconditional click closes the pane
  // the first one opened, and the caller is left waiting for a control that has
  // left the accessibility tree.
  await openPane(page, "Add");

  await expect(page.locator('[data-yunari-panel="add"]')).toBeVisible();
  await expect(page.locator(".editor-shell-panel")).toBeVisible();
});

test("asking for a shut pane opens it, and asking again does not close it", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();

  // Shut first, by the product's own route: clicking the slot for the pane
  // showing. A helper that skipped its click when the pane was open must still
  // click when it is shut, or "open" would be a no-op that happened to pass.
  await page
    .locator(".editor-shell-rail")
    .getByRole("button", { name: "Layers", exact: true })
    .click();
  await expect(page.locator('[data-yunari-panel="layers"]')).toBeHidden();

  await openPane(page, "Add");
  await expect(page.locator('[data-yunari-panel="add"]')).toBeVisible();
  await expect(page.locator(".editor-shell-panel")).toBeVisible();

  await openPane(page, "Add");
  await expect(page.locator('[data-yunari-panel="add"]')).toBeVisible();
  await expect(page.locator(".editor-shell-panel")).toBeVisible();
});

test("shows the theme's own panel in the left column, and swaps away from it", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();

  // The artboard panel's width field stands for the document host: the artboard
  // and the document-references panels append into that one node, so a control
  // of either being reachable is the host having moved into the pane rather
  // than into the inspector's tab.
  await openPane(page, "Theme settings");
  await expect(page.locator("[data-yunari-artboard-width]")).toBeVisible();

  // Swapping the slot hides the whole host rather than unmounting it, and
  // coming back must not have left it behind — the pane is the slot's, not a
  // tab's.
  await openPane(page, "Add");
  await expect(page.locator("[data-yunari-artboard-width]")).toBeHidden();

  await openPane(page, "Theme settings");
  await expect(page.locator("[data-yunari-artboard-width]")).toBeVisible();
});

/** The "Chrome stays still", and the ruling `vg-208` carries, on a real box.
 *
 *  The rule the row is about put the pane's one `overflow: auto` on the *column*,
 *  so the column scrolled the title bar and the footer along with the list. The
 *  ruling settles the other way: the **body** owns the scroll and the title bar
 *  and the footer sit outside it. Only a rendered box can say which element that
 *  is — jsdom has no layout, so `shell-layout-scroll.dom.test.ts` pins the offset
 *  surviving a swap and nothing about who scrolls.
 *
 *  The measurement is the report's evidence and it reads three things rather
 *  than assuming any of them: which box the list overflows, whether setting that
 *  box's `scrollTop` moves it, and where the chrome is before and after. Both
 *  boxes are scrolled in the one reading, so the numbers say which of the two is
 *  the scroll owner instead of the case saying it.
 */
test("a pane's title bar and footer stay put while its body scrolls", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();
  await openEveryGroup(page);
  // The pane's footer is the object-command strip, and the strip is drawn only
  // while there is a subject: an empty document or no selection leaves the
  // pane with no footer to measure.
  await selectLayer(page, "group-cpu-card");

  const measured = await page.evaluate(() => {
    const column = document.querySelector<HTMLElement>(".editor-shell-panel");
    const pane = column?.querySelector<HTMLElement>(
      ".editor-shell-pane:not([hidden])",
    );
    const body = pane?.querySelector<HTMLElement>(".editor-shell-pane-body");
    const title = pane?.querySelector<HTMLElement>(".editor-shell-pane-title");
    const footer = pane?.querySelector<HTMLElement>(
      ".editor-shell-pane-actions",
    );
    if (
      column === null ||
      pane === undefined ||
      body === null ||
      body === undefined ||
      title === null ||
      title === undefined ||
      footer === null ||
      footer === undefined
    ) {
      throw new Error("no pane column, body, title bar or footer");
    }
    const chrome = () => ({
      title: Math.round(title.getBoundingClientRect().top),
      footer: Math.round(footer.getBoundingClientRect().top),
    });
    // The expand clicks above scroll the column to reach each twisty, so the
    // reading starts by putting it back at the top — the position the chrome is
    // asked to hold.
    column.scrollTop = 0;
    const atTop = chrome();
    column.scrollTop = 300;
    const columnScrolled = { offset: column.scrollTop, ...chrome() };
    column.scrollTop = 0;
    body.scrollTop = 300;
    const bodyScrolled = { offset: body.scrollTop, ...chrome() };
    body.scrollTop = 0;
    const box = (node: HTMLElement) => ({
      overflow: node.scrollHeight - node.clientHeight,
      client: node.clientHeight,
      bottom: Math.round(node.getBoundingClientRect().bottom),
    });
    return {
      atTop,
      columnScrolled,
      bodyScrolled,
      column: box(column),
      body: box(body),
    };
  });
  const report = JSON.stringify(measured);
  console.log(`pane-chrome ${report}`);
  testInfo.annotations.push({ type: "pane-chrome", description: report });

  expect(
    measured.body.overflow,
    "the list overflows the pane's column, not its body",
  ).toBeGreaterThan(0);
  expect(
    measured.columnScrolled.offset,
    "the pane's column is still a scroller, so the rule is still on the wrong box",
  ).toBe(0);
  expect(
    measured.bodyScrolled.offset,
    "the pane's body is not the scroller",
  ).toBeGreaterThan(0);
  expect(
    measured.bodyScrolled.title,
    "the title bar scrolled with the body",
  ).toBe(measured.atTop.title);
  expect(
    measured.bodyScrolled.footer,
    "the footer scrolled with the body",
  ).toBe(measured.atTop.footer);
  // At rest the footer is the pane's bottom edge, not the end of the list: the
  // property the row is about is that the toolbar stays put while the list
  // scrolls beneath it.
  expect(
    measured.atTop.footer,
    `the footer is drawn outside the pane's box (${report})`,
  ).toBeLessThan(measured.column.bottom);
});

test("a collapse between two swaps does not lose the list's scroll", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  // The browser pin for the collapse-and-restore bug, and the only one that
  // can catch it: jsdom has no layout, so its `scrollTop` round-trips a value
  // written while the element is `hidden`, where a browser answers 0. Read the
  // offset back off the element rather than assuming the write landed, so a
  // list that is not scrollable fails here instead of passing vacuously.
  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();

  // **The premise, not the guard, is what grouping invalidated.** The guard —
  // read the offset back rather than assuming the write landed, so a list that
  // cannot scroll fails here instead of passing vacuously — is the point of the
  // test and is untouched. What changed is the fixture: ten collapsed cards
  // genuinely no longer overflow a 721px panel, so the guard was being asked
  // about a document the starter stopped being. Opening every group restores a
  // tree long enough to scroll *and* keeps the guard's teeth: a panel that
  // stopped laying out rows at all still fails this.
  await openEveryGroup(page);

  // The offset lives on the showing pane's **body** (the overflow rule, `vg-208`), so the
  // scroll is taken there. The column is what goes `hidden` on a collapse and
  // the body is hidden with it, which is what makes the restore below the pin
  // it is: a real browser discards a `display: none` box's scroll position, so
  // only the shell's own write can bring it back.
  const list = paneBody(page);
  const offset = await list.evaluate((node) => {
    node.scrollTop = 300;
    return node.scrollTop;
  });
  expect(offset, "the layer list is long enough to scroll").toBeGreaterThan(0);

  // Close the pane the product's own way, then look at Add and come back.
  await page
    .locator(".editor-shell-rail")
    .getByRole("button", { name: "Layers", exact: true })
    .click();
  await expect(list).toBeHidden();

  await openPane(page, "Add");
  await expect(page.locator('[data-yunari-panel="add"]')).toBeVisible();
  await openPane(page, "Layers");
  await expect(page.locator('[data-yunari-panel="layers"]')).toBeVisible();

  await expect.poll(() => list.evaluate((node) => node.scrollTop)).toBe(offset);
});

/** The per-pane offsets, on every pane that can hold one. The rule is one
 *  sentence — "preserve per-pane offsets and disclosure state across routine
 *  updates" — and `choosePane` implements it once, over a map keyed by the
 *  rail's slot. The case above pins it for the Composition pane; a proof of one
 *  pane is a proof of that pane's luck, so this walks the panes long enough to
 *  scroll and asserts each one comes back where it was left.
 *
 *  **A pane that cannot scroll proves nothing**, so each slot's offset is read
 *  back off the element after it is written: a pane whose body fits fails here
 *  with the slot named rather than passing on a `0` that survived a swap.
 *  Composition is opened to its full length first for the reason the case above
 *  gives — a collapsed starter does not overflow the panel. Design tokens and
 *  Theme settings overflow at rest. The archived bullet this case descends from
 *  named the asset-library surface and the document pane; the library is the
 *  Assets pane now, and
 *  Assets is excluded because at rest it declares the starter's one backdrop — a
 *  single card that fits, so it cannot hold an offset. Add is not walked any more
 *  either: the file section that gave it a long tail is the Assets pane's, and
 *  what is left — shapes, text and the card library — fits the panel. The slot
 *  list is hand-written, so a starter that later made either pane overflow would
 *  not re-enter this walk by itself. Their overflow heights are deliberately not
 *  stated — measured twice at this viewport they differed by tens of px, because
 *  they move with font loading — and the guard above is the load-bearing claim,
 *  not the sizes.
 *
 *  The offset lives on the showing pane's **body** (the overflow rule, `vg-208`), and a
 *  browser discards a `display: none` box's scroll position — the swap hides
 *  the pane it leaves — so what the read-back finds after the return is the
 *  shell's own restore and not the box remembering.
 */
test("each pane long enough to scroll comes back to the offset it was left at", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();
  await openEveryGroup(page);

  const measured: Record<string, number> = {};
  for (const slot of ["Layers", "Design tokens", "Theme settings"]) {
    await openPane(page, slot);
    const body = paneBody(page);
    await expect(body, `${slot} is the pane showing`).toHaveCount(1);

    const offset = await body.evaluate((node) => {
      node.scrollTop = 300;
      return node.scrollTop;
    });
    // The guard, not the assertion: a pane that fits its box cannot be left at
    // an offset, so a swap that "restored" 0 would pass without proving
    // anything.
    expect(offset, `${slot}'s body is long enough to scroll`).toBeGreaterThan(
      0,
    );

    // Away and back. The partner is whichever slot this one is not, so the
    // swap always leaves the pane it is about.
    await openPane(page, slot === "Layers" ? "Add" : "Layers");
    await openPane(page, slot);

    const returned = await body.evaluate((node) => node.scrollTop);
    measured[slot] = returned;
    expect(
      returned,
      `${slot} came back to ${returned} rather than the ${offset} it was left at`,
    ).toBe(offset);
  }

  const report = JSON.stringify(measured);
  console.log(`pane-offsets ${report}`);
  testInfo.annotations.push({ type: "pane-offsets", description: report });
});

/** The desktop-density proof, for the one cluster the rail's column can
 *  starve. **Reachability, not visibility.**
 *
 *  The dock is a fixed 639px row of every object and arrange action, centred on
 *  the stage. The rail's 46px column is taken off the stage's width, so the row
 *  no longer fitted: `.editor-shell-stage`'s `overflow: hidden` clipped its ends
 *  and `elementFromPoint` at `Duplicate`'s centre answered the layer panel next
 *  door. Playwright reported that as a 30-second hover timeout three specs away
 *  from the cause, which is why the assertion here is the hit test rather than
 *  a bounding box: a control drawn outside its stage is `visible` to Playwright
 *  and unclickable to an author.
 *
 *  The three configurations are its own. The third is a viewport rather than
 *  a root `zoom`, because 200% browser zoom halves the CSS viewport — that is
 *  what the shell's media queries answer, and a `zoom` on the root leaves the
 *  layout viewport at 1280 while the fixed 46/246/280 columns stop adapting. */
test("every dock control stays reachable with the rail's column in place", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  test.setTimeout(120_000);

  for (const view of [
    { name: "1280×720", width: 1280, height: 720 },
    { name: "1440×900", width: 1440, height: 900 },
    {
      name: "640×360, the CSS viewport 200% zoom gives",
      width: 640,
      height: 360,
    },
  ]) {
    await page.setViewportSize({ width: view.width, height: view.height });
    await page.goto(EDITOR);
    await expect(
      page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    ).toBeVisible();

    // A group rather than a card: the object half of the dock is a filtered
    // registry, and a group carries the most actions, so this is the widest the
    // row gets.
    await selectLayer(page, "group-cpu-card");
    const dock = page.locator("[data-yunari-canvas-toolbar]");
    await expect(dock).toBeVisible();

    const unreachable = await dock.evaluate((node) =>
      [...node.querySelectorAll("button")].flatMap((button) => {
        const box = button.getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
        // Containment, not equality: the point lands on the button's own glyph,
        // and a `<path>` inside the control is still the control.
        if (hit !== null && (button === hit || button.contains(hit))) return [];
        return [
          `${button.getAttribute("aria-label")} is under ${hit?.tagName ?? "nothing"}`,
        ];
      }),
    );
    expect(
      unreachable,
      `${view.name}: a dock control is drawn where nothing can click it`,
    ).toEqual([]);

    // And the cluster sits inside the stage at all: the 14px is the least a
    // cluster clears its stage's edges by, and the overrun this pinned is what
    // put the row outside them.
    const insets = await page.evaluate(() => {
      const stage = document.querySelector(".editor-shell-stage");
      const box = document.querySelector(".editor-shell-dock");
      if (stage === null || box === null) throw new Error("no dock");
      const outer = stage.getBoundingClientRect();
      const inner = box.getBoundingClientRect();
      return {
        left: Math.round(inner.left - outer.left),
        right: Math.round(outer.right - inner.right),
      };
    });
    expect(
      Math.min(insets.left, insets.right),
      `${view.name}: the dock overruns its stage`,
    ).toBeGreaterThanOrEqual(14);
  }
});

/**
 * The panes' chrome starts at one offset, whichever slot is showing.
 *
 * `editor-shell.css` drops a 12px `margin-top` on the sections inside a pane,
 * and a pane is excluded from that rule. When the exclusion was keyed on the
 * *absence* of `data-yunari-panel` and the attribute was written conditionally,
 * three of the four panes were not excluded: their title bar, body and footer
 * sat 12px lower than the Composition pane's. No gate can see it — jsdom has no
 * layout, so the defect exists only in a rendered box — which is why this is a
 * browser case and why it measures a position rather than counting elements.
 *
 * The panes are measured one at a time because only the chosen slot's pane is
 * laid out; the others are `hidden`.
 */
test("every pane's title bar sits at the same top offset", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();

  const tops: [string, number][] = [];
  for (const slot of ["Layers", "Add", "Design tokens", "Theme settings"]) {
    await openPane(page, slot);
    const title = page.locator(
      ".editor-shell-pane:not([hidden]) > .editor-shell-pane-title",
    );
    await expect(title, `${slot} is the pane showing`).toHaveCount(1);
    const box = await title.boundingBox();
    expect(box, `${slot} draws a title bar`).not.toBeNull();
    tops.push([slot, Math.round(box?.y ?? Number.NaN)]);
  }

  const baseline = tops[0]?.[1];
  expect(
    tops.map(([, y]) => y),
    `title-bar tops: ${tops.map(([slot, y]) => `${slot} ${y}`).join(", ")}`,
  ).toEqual(tops.map(() => baseline));
});

/**
 * A pane does not scroll sideways — `vg-270`, and the reading that closed it.
 *
 * The row measured the Tokens pane's column at `scrollWidth` 449 against a
 * `clientWidth` of 244, a 205px sideways scroll, and named the cause as a flex
 * item with `white-space: nowrap` and no `min-w-0`: the min-content width of
 * "Yaldevi Libre Franklin — Yaldevi + Libre" became the pane's own width. The
 * reading on 2026-10-12 found the overflow gone and `min-w-0` present on that
 * row. Nothing watched for its return, which is what this case is: a box that
 * scrolls sideways clips whatever the author cannot scroll to, and the capture
 * cannot show it because the column image is the scroll origin.
 *
 * **The box read is the pane's body**, which is what scrolls since `vg-208`
 * moved the scroll off the column. Reading the column would now pass whatever
 * the pane drew: it clips, so its own `scrollWidth` stops at its `clientWidth`.
 *
 * The panes are read one at a time for the reason the case above gives — only
 * the chosen slot's pane is laid out.
 */
test("no pane's column scrolls sideways", async ({ page }, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();

  const overflow: [string, number][] = [];
  for (const slot of ["Layers", "Add", "Design tokens", "Theme settings"]) {
    await openPane(page, slot);
    const body = paneBody(page);
    await expect(body, `${slot}'s body is showing`).toHaveCount(1);
    const scroll = await body.evaluate((element) =>
      Math.round(element.scrollWidth - element.clientWidth),
    );
    // The measurement names the pane it belongs to: a bare number in the
    // failure would not say which slot to open.
    if (scroll > 0) overflow.push([slot, scroll]);
  }

  expect(overflow, "panes whose body scrolls sideways").toEqual([]);
});

/**
 * The status bar's box, which no other gate in this plan can see.
 *
 * The strip **is** the deliverable, and its geometry is a rendered fact: a
 * full-width bar flush to the window's right and bottom edges. jsdom has no
 * layout, so `shell-layout.dom.test.tsx` can prove the footer's children and
 * nothing can prove its box — the same blindness that failed Task 2 with a
 * rendered offset.
 *
 * The last two assertions are F2's invariant. `min-height`, not `height`, is
 * what the overflow rule requires — a refusal may not be ellipsized, so a long diagnostic
 * wraps and the strip grows a line rather than cutting the message or spilling
 * over the stage. **No refusal reachable at this width is long enough to wrap**:
 * the editor's own refusals are short fixed strings, and the one long message,
 * `ARC_FILL_REFUSED` (~200 characters), needs a hand-authored theme carrying a
 * filled arc — a filled arc the editor cannot make (its arcs are stroked). So
 * the wrapping state is left to the declaration, and the guard asserted here is
 * the invariant at rest: the content never exceeds the box it defines.
 */
test("the status bar is the window's full-width bottom edge", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();

  const box = await page.locator("#status").evaluate((node) => {
    const rect = node.getBoundingClientRect();
    // The window's own box, scrollbar excluded: `rect.right` against
    // `innerWidth` would pass or fail on whether a scrollbar happens to be drawn.
    const window_ = document.documentElement;
    return {
      width: Math.round(rect.width),
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom),
      height: Math.round(rect.height),
      windowWidth: window_.clientWidth,
      windowHeight: window_.clientHeight,
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
      hasDiagnostic:
        node.querySelector(".editor-shell-diagnostic svg") !== null,
    };
  });

  // The measurement is the report's evidence, so it is printed as well as
  // asserted — the number the assertion checks is printed as evidence.
  const measured = JSON.stringify(box);
  console.log(`status-bar ${measured}`);
  testInfo.annotations.push({ type: "status-bar", description: measured });

  expect(box.right, "the strip is flush with the window's right edge").toBe(
    box.windowWidth,
  );
  expect(box.bottom, "the strip is flush with the window's bottom edge").toBe(
    box.windowHeight,
  );
  expect(box.width, "the strip is the window's full width").toBe(
    box.windowWidth,
  );
  // Nothing has refused yet, so the strip sits at its resting height.
  expect(box.hasDiagnostic, "no diagnostic is showing at rest").toBe(false);
  expect(box.height, "the strip's resting height is 26px").toBe(26);
  expect(
    box.scrollHeight,
    "the strip's content overflows its own box",
  ).toBeLessThanOrEqual(box.clientHeight);
  expect(
    box.scrollWidth,
    "the strip's content overruns its width",
  ).toBeLessThanOrEqual(box.clientWidth);
});

/**
 * The left readouts, as the strip draws them, and the report beside them.
 *
 * The counts are the strip's *resting* content: nothing has to happen for them
 * to be there. What they read is the scene's own — compared against the
 * bridge's snapshot rather than against a number this test remembers — so a
 * strip that kept its own tally would fail here the moment the two drifted.
 * That they are on the **left** is a rendered fact, so it is measured: the
 * footer's first content begins at its own left padding, and both counts come
 * before the message that follows them.
 *
 * The message is a distinct element now, so it is read where it is written.
 * `#status`'s own text is the footer's: the counts, the message, the diagnostic
 * and the save state together, and a whole-text assertion on it would say
 * nothing about which of them a reader meant.
 */
test("the status bar reads the scene's counts, and still carries its message", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();
  await page.waitForFunction(() => "yunariEditorBridge" in window);

  const objects = page.locator("[data-yunari-status-objects]");
  const selected = page.locator("[data-yunari-status-selected]");
  await expect(
    objects,
    "the object count is on the left at rest",
  ).toBeVisible();
  await expect(selected).toBeVisible();
  await expect(selected).toHaveText("0 selected");
  await expect(page.locator("#status-message")).toHaveText("Editor ready");

  // On the left, measured rather than assumed: the first thing in the strip is
  // the counts, and they begin at the footer's own left padding. A readout that
  // drifted to the right half would still be visible and still read the scene,
  // and would fail here.
  const lefts = await page.evaluate(() => {
    const footer = document.querySelector("#status") as HTMLElement;
    const at = (selector: string): number =>
      (document.querySelector(selector) as HTMLElement).getBoundingClientRect()
        .left;
    return {
      footer: footer.getBoundingClientRect().left,
      padding: Number.parseFloat(getComputedStyle(footer).paddingLeft),
      objects: at("[data-yunari-status-objects]"),
      selected: at("[data-yunari-status-selected]"),
      message: at("#status-message"),
    };
  });
  expect(
    lefts.objects,
    "the counts are the strip's first content, at its own left padding",
  ).toBeCloseTo(lefts.footer + lefts.padding, 0);
  expect(
    lefts.selected,
    "the selection count sits beside the object count, and to its right",
  ).toBeGreaterThan(lefts.objects);
  expect(
    lefts.message,
    "the message comes after both counts, so neither was moved to the right half",
  ).toBeGreaterThan(lefts.selected);

  // The reading is the scene's, not a tally the strip keeps. The starter is the
  // document this route boots, so it holds something.
  const total = await page.evaluate(
    () =>
      (
        window as unknown as {
          readonly yunariEditorBridge: {
            snapshot(): { readonly objectCount: number };
          };
        }
      ).yunariEditorBridge.snapshot().objectCount,
  );
  expect(total, "the booted document holds objects").toBeGreaterThan(0);
  await expect(objects).toHaveText(`${total} objects`);

  // A selection moves the reading, and the message keeps its own element while
  // it does.
  await selectLayer(page, "group-cpu-card");
  await expect(selected).toHaveText("1 selected");
  await expect(page.locator("#status-message")).toHaveText("Editor ready");
});

/**
 * The count, in each pane's title bar, read where an author reads it.
 *
 * The row ruled it per pane, so this walks the panes that hold a list and reads
 * each title bar against **the list that pane draws** rather than against a
 * number this test remembers: the Widgets pane's count is the tiles under it,
 * and the Composition pane's is
 * the scene's own total, which is also what the strip prints — the duplication
 * the row accepted and named, asserted here as one string in two surfaces so a
 * pane that drifted to a different number fails.
 *
 * **A pane with no single list has no count, and the absence is the
 * assertion.** Theme settings' body is two sections of fields; Design tokens is
 * two libraries, each counting its own rows under its own heading; Add is
 * primitives. A count on any of them would be a number the product does not
 * have. A dom case can show the span is absent from the tree; only a rendered
 * pane shows that it is absent from the surface the author opens.
 */
test("a list pane's title bar carries its own count, and the others carry none", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();
  await page.waitForFunction(() => "yunariEditorBridge" in window);

  const titleCount = (pane: string) =>
    page.locator(`[data-yunari-panel="${pane}"] .editor-shell-pane-count`);

  // Composition is the slot the shell opens on.
  const objects = await page.evaluate(
    () =>
      (
        window as unknown as {
          readonly yunariEditorBridge: {
            snapshot(): { readonly objectCount: number };
          };
        }
      ).yunariEditorBridge.snapshot().objectCount,
  );
  expect(objects, "the booted document holds objects").toBeGreaterThan(0);
  await expect(titleCount("layers")).toHaveText(`${objects} objects`);
  // The strip and the pane print one number. Two chrome surfaces, one fact.
  await expect(page.locator("[data-yunari-status-objects]")).toHaveText(
    `${objects} objects`,
  );

  // Widgets: the card library's own entry count, which is the tiles it draws.
  await openPane(page, "Widgets");
  const cards = await page
    .locator('[data-yunari-panel="widgets"] [data-yunari-panel-card]')
    .count();
  expect(cards, "the booted library holds units").toBeGreaterThan(0);
  await expect(titleCount("widgets")).toHaveText(`${cards} units`);

  // Add holds the primitives rather than a list, so its title bar prints none.
  await openPane(page, "Add");
  await expect(
    page.locator('[data-yunari-panel="add"] .editor-shell-pane-count'),
    "the Add pane holds primitives, not a list",
  ).toHaveCount(0);

  // Tokens: two libraries with their own headings and their own counts, so the
  // pane's title bar prints no total over both.
  await openPane(page, "Design tokens");
  const tokens = await page
    .locator('[data-yunari-panel="tokens"] [data-yunari-palette-token-row]')
    .count();
  expect(tokens, "the booted theme declares tokens").toBeGreaterThan(0);
  await expect(
    titleCount("tokens"),
    "the Tokens pane counts each library under its own heading",
  ).toHaveCount(0);

  // Theme settings: no list, so no count.
  await openPane(page, "Theme settings");
  await expect(page.locator('[data-yunari-panel="document"]')).toBeVisible();
  await expect(
    page.locator('[data-yunari-panel="document"] .editor-shell-pane-count'),
    "the Theme settings pane holds no list, so its title bar prints no count",
  ).toHaveCount(0);
});

/**
 * The selected slot's accent bar is on the rail's **inner** edge,
 * and only a rendered box can show which edge that is.
 *
 * jsdom has no layout and no cascade, so a `*.dom.test.tsx` case cannot see a
 * rendered side — the bar lived at `left: -8px`, painting outside the rail's
 * outer edge (the window's left edge), with a comment eight lines above it
 * stating the rule it broke. A parity gate could not catch it either: both
 * sides drew the same bar in the same wrong place, so the two agreed. This is
 * the assertion that can see it — the bar's own edges measured against the
 * rail's — and the measurement is printed as the report's evidence.
 *
 * The rail is a 46px column and the slot a centred 36px button, so a 5px gutter
 * sits on each side. The bar belongs to the rail, so its outer edge is flush
 * with the rail's inner (right) edge, not past it: the mirror `right: -8px`
 * lands 2px out in the rail-to-pane gap and fails `barRight` below.
 */
test("the selected slot's accent bar sits on the rail's inner edge", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();

  const measured = await page.evaluate(() => {
    const rail = document.querySelector(".editor-shell-rail");
    const slot = document.querySelector(
      '.editor-shell-rail-slot[aria-pressed="true"]',
    );
    if (rail === null || slot === null) throw new Error("no selected slot");
    const railBox = rail.getBoundingClientRect();
    const slotBox = slot.getBoundingClientRect();
    // The `::before` has no `getBoundingClientRect` of its own, so its box is
    // composed from the slot's rect and the pseudo's resolved anchor.
    const bar = getComputedStyle(slot, "::before");
    const slotStyle = getComputedStyle(slot);
    const width = Number.parseFloat(bar.width);
    // **The padding box, not the border box.** An absolutely positioned child
    // resolves against its containing block's padding box, and this Chromium
    // hands back the *used* `left`, so composing it against the slot's
    // border-box rect counts the slot's border a second time. The slot carries
    // the 1px transparent resting border, which is exactly that 1px.
    const borderLeft = Number.parseFloat(slotStyle.borderLeftWidth) || 0;
    const borderRight = Number.parseFloat(slotStyle.borderRightWidth) || 0;
    const left =
      bar.left !== "auto"
        ? slotBox.left + borderLeft + Number.parseFloat(bar.left)
        : slotBox.right - borderRight - Number.parseFloat(bar.right) - width;
    return {
      railLeft: railBox.left,
      railRight: railBox.right,
      slotLeft: slotBox.left,
      slotRight: slotBox.right,
      barLeft: left,
      barRight: left + width,
      barWidth: width,
      anchor: bar.left !== "auto" ? `left ${bar.left}` : `right ${bar.right}`,
    };
  });
  const report = JSON.stringify(measured);
  console.log(`accent-bar ${report}`);
  testInfo.annotations.push({ type: "accent-bar", description: report });

  // The rail slot, which is the size the bar's offset is derived from: at 34px
  // the same `-6px` lands the bar's outer edge 1px short of the rail. Read here
  // rather than by a geometry case of its own, because the two numbers are one
  // decision — `vg-227` moved the slot and the bar together.
  expect(
    measured.slotRight - measured.slotLeft,
    "the slot is the 36px rail slot",
  ).toBe(36);
  expect(
    measured.barWidth,
    `the bar is DESIGN.md's ${RAIL_ACCENT_BAR_PX}px`,
  ).toBe(RAIL_ACCENT_BAR_PX);
  expect(
    measured.barLeft,
    "the bar starts inside the rail's outer edge",
  ).toBeGreaterThanOrEqual(measured.railLeft);
  expect(
    measured.barRight,
    "the bar's outer edge is the rail's inner edge",
  ).toBeCloseTo(measured.railRight, 5);
});

/**
 * The gear's ink, which the cascade decides and no unit test can see.
 *
 * `editor-shell.css` set the gear `--muted` on a bare class while
 * `.editor-shell-rail button` set `--faint`; specificity (0,1,1) beat (0,1,0),
 * so the gear painted `--faint` — 68 % of `--muted`, the closed-slot shade —
 * and read as a slot that is merely unchosen, contradicting the decision
 * written above the rule. jsdom applies no stylesheet to a computed style, so
 * the resolved colour exists only in a browser; this compares the gear's ink to
 * a closed slot's and fails while the two are the same.
 */
test("the settings gear paints a lighter ink than a closed slot", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();

  const ink = await page.evaluate(() => {
    const gear = document.querySelector(".editor-shell-rail-settings");
    // A slot that is not the chosen one: `--faint` is the closed slot's ink,
    // and the gear must not match it.
    const slot = document.querySelector(
      '.editor-shell-rail-slot:not([aria-pressed="true"])',
    );
    if (gear === null || slot === null) throw new Error("no gear or slot");
    return {
      gear: getComputedStyle(gear).color,
      slot: getComputedStyle(slot).color,
    };
  });
  const measured = JSON.stringify(ink);
  console.log(`gear-ink ${measured}`);
  testInfo.annotations.push({ type: "gear-ink", description: measured });

  expect(ink.gear, "the gear is invisible or paints no ink").not.toBe("");
  expect(
    ink.gear,
    `the gear paints the closed slot's --faint, not its own --muted (${measured})`,
  ).not.toBe(ink.slot);
});

/**
 * The keyboard route into Settings, and its page at 200% zoom.
 *
 * A mode has no dialog to trap focus in: the header's gear selects Settings,
 * the region moves focus to the active navigation row, and the page beside the
 * column scrolls rather than clipping. Both are browser facts — jsdom performs
 * no sequential focus navigation and lays nothing out — so this walks them with
 * real keys and real viewport sizes.
 */
test("the gear opens Settings, and every page stays reachable at 200% zoom", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();

  // Open with the keyboard, not a click: the gear is reachable and Enter
  // selects Settings.
  const gear = page.locator(".editor-shell-rail-settings");
  await gear.focus();
  await expect(gear).toBeFocused();
  await page.keyboard.press("Enter");

  const region = page.locator("[data-yunari-settings-region]");
  await expect(region).toBeVisible();
  // Entering the mode hands focus to the page already chosen, so a keyboard
  // author is in the surface they just opened rather than back on the rail.
  await expect(
    region.locator('[data-yunari-settings-nav-item][aria-selected="true"]'),
  ).toBeFocused();

  // ── the constrained proof ───────────────────────────────────────────────
  //
  // 200% zoom is modelled as the CSS-pixel viewport it produces — 640×360 —
  // exactly as a browser zoom halves the layout viewport.
  await page.setViewportSize({ width: 640, height: 360 });

  // (1) Every destination is reachable through its row, and selecting one
  //     marks it active and shows its page.
  for (const name of [
    uiCopy.settings.pages.displays,
    uiCopy.settings.pages.hardware,
    uiCopy.settings.pages.units,
    uiCopy.settings.pages.readings,
    uiCopy.settings.pages.appearance,
    uiCopy.settings.pages.keyboard,
    uiCopy.settings.pages.assetSources,
    uiCopy.settings.pages.about,
  ]) {
    const tab = region.getByRole("tab", { name });
    await tab.scrollIntoViewIfNeeded();
    await tab.click();
    await expect(tab).toHaveAttribute("data-active", "");
  }

  // (2) The page scrolls rather than clipping. Read on the Keyboard page, which
  //     holds the twenty-row table.
  await region
    .getByRole("tab", { name: uiCopy.settings.pages.keyboard })
    .click();
  const scroller = await region
    .locator(".settings-mode-content")
    .evaluate((element) => ({
      overflowY: getComputedStyle(element).overflowY,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }));
  expect(
    scroller.overflowY,
    `the page is not the scroller at 200% zoom: ${JSON.stringify(scroller)}`,
  ).toBe("auto");
  expect(
    scroller.scrollHeight,
    `the Keyboard table is clipped rather than scrolled at 200% zoom: ${JSON.stringify(scroller)}`,
  ).toBeGreaterThan(scroller.clientHeight);

  // (3) The header's mode switch is still the way back, and the editor the
  //     author left is painted rather than blank.
  await page.locator("#yunari-shell-modes-editor").click();
  await expect(region).toBeHidden();
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();
});

/**
 * The mode switch, as a rendered box and as the guard in front of it.
 *
 * Two facts live only in a browser. The first is the switch's geometry: it is
 * the header's own control, so it has to fit the 42px strip rather than grow it,
 * and the chosen segment's *paint* — the shared chosen treatment, a lifted
 * ground and `--text`, **never the accent** — is a resolved cascade, which jsdom
 * does not apply. The accent is read as a resolved colour rather than compared
 * with the token, because the token is a `var()` chain and a comparison of two
 * unresolved strings passes a segment painted any colour at all.
 *
 * The second is the round trip: the case drives a real document dirty through
 * the product's own route (duplicate a layer), answers the guard both ways, and
 * reads that the canvas is still **painted** after the editor comes back. The
 * body is `display:none` while another mode shows, so an assertion on the
 * element alone would pass over a surface that never painted again.
 *
 * The header measurement is the report's evidence as well as an assertion, so a
 * run that changes the strip's height says so rather than failing obscurely.
 */
test("the header's mode switch moves the shell, and asks before it leaves a dirty document", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();

  const header = page.locator(".editor-shell-header");
  const group = header.locator(".editor-shell-mode-switch");
  await expect(group, "the mode switch is not in the header").toBeVisible();
  const segment = (name: string) =>
    group.getByRole("button", { name, exact: true });

  await expect(group.getByRole("button")).toHaveCount(3);
  // The words come from `uiCopy`, which is what the header draws them from: a
  // literal here is how a label the user did not choose gets frozen into a test.
  await expect(segment(uiCopy.modes.editor)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(segment(uiCopy.modes.library)).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(segment(uiCopy.modes.settings)).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  const paint = await group.evaluate((node) => {
    const segments = [...node.querySelectorAll("button")];
    const chosen = segments.find(
      (button) => button.getAttribute("aria-pressed") === "true",
    );
    const rest = segments.find(
      (button) => button.getAttribute("aria-pressed") === "false",
    );
    const strip = node.closest(".editor-shell-header");
    if (chosen === undefined || rest === undefined || strip === null) {
      throw new Error("no chosen segment, unchosen segment or header");
    }
    // The **whole background**, not `backgroundColor`: `--stage` resolves to the
    // shell's backdrop, which is a gradient in most palettes, and a gradient is
    // `background-image` — reading the colour alone would report both segments
    // as transparent and pass a switch that paints nothing.
    const paintOf = (element: Element) => {
      const style = getComputedStyle(element);
      return `${style.backgroundColor} ${style.backgroundImage}`;
    };
    // The accent as the browser resolved it. A probe element inside the strip
    // reads the same cascade the segment does, and reports `rgb(...)` — the form
    // the segment's own computed colour is in, so the two are comparable.
    const probe = document.createElement("span");
    probe.style.color = "var(--accent)";
    strip.append(probe);
    const accent = getComputedStyle(probe).color;
    // The 14% wash, resolved by the same cascade rather than restated: the
    // chosen segment's background is this colour, and the probe is how the test
    // compares two computed colours instead of guessing the serialisation.
    probe.style.color = "";
    probe.style.background =
      "color-mix(in srgb, var(--accent) 14%, transparent)";
    const wash = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return {
      well: Math.round(node.getBoundingClientRect().height),
      header: Math.round(strip.getBoundingClientRect().height),
      chosenFill: paintOf(chosen),
      restFill: paintOf(rest),
      chosenInk: getComputedStyle(chosen).color,
      restInk: getComputedStyle(rest).color,
      accent,
      wash,
    };
  });
  const report = JSON.stringify(paint);
  console.log(`mode-switch ${report}`);
  testInfo.annotations.push({ type: "mode-switch", description: report });

  expect(
    paint.header,
    `the switch grew the header's ${HEADER_STRIP_PX}px strip`,
  ).toBe(HEADER_STRIP_PX);
  expect(
    paint.well,
    `the switch overflows the header (${report})`,
  ).toBeLessThan(paint.header);
  // The chosen treatment, measured rather than assumed: the rail slots'
  // selected state — the accent ink over the accent's 14% wash — and it differs
  // from an unchosen segment's ground and ink. It is not the header's accent
  // *fill*; that stays the publish button's.
  expect(
    paint.chosenFill,
    `the chosen segment paints the same ground as an unchosen one (${report})`,
  ).not.toBe(paint.restFill);
  expect(
    paint.chosenInk,
    `the chosen segment paints the same ink as an unchosen one (${report})`,
  ).not.toBe(paint.restInk);
  expect(
    paint.chosenFill.includes(paint.wash),
    `the chosen segment is not washed with the accent (${report})`,
  ).toBe(true);
  expect(
    paint.chosenInk,
    `the chosen segment is not inked with the accent (${report})`,
  ).toBe(paint.accent);

  // ── The round trip, on a document the product dirtied ─────────────────────
  const identity = page.locator(".editor-shell-identity");
  await expect(identity).toHaveAttribute("data-dirty", "false");
  await selectLayer(page, "group-cpu-card");
  await page
    .locator("[data-yunari-canvas-toolbar] [aria-label='Duplicate']")
    .click();
  await expect(
    identity,
    "the product did not mark the document dirty, so the guard is untested",
  ).toHaveAttribute("data-dirty", "true");

  // What the document is painted as, before it is hidden: the count of painted
  // pixels on the canvas Fabric draws objects on (`lower-canvas`; the upper one
  // carries only the selection layer). Read as coverage rather than as an exact
  // image because the starter's bindings tick — a live pass repaints a little of
  // the surface while the shell is elsewhere, and an exact match would call a
  // perfectly healthy document a failure.
  const coverage = async (): Promise<number> =>
    page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        "#yunari-fabric-editor canvas.lower-canvas",
      );
      const pixels = canvas
        ?.getContext("2d")
        ?.getImageData(0, 0, canvas.width, canvas.height).data;
      if (pixels === undefined) throw new Error("no lower canvas to read");
      let painted = 0;
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] !== 0) painted += 1;
      }
      return painted;
    });

  const drawnBefore = await coverage();
  expect(
    drawnBefore,
    "the editor painted nothing before the switch, so the round trip is untested",
  ).toBeGreaterThan(0);

  // A mode switch hides the editor's body rather than unmounting it, so it
  // keeps the dirty document and asks nothing. The replacement prompt belongs
  // to New/Open, which do replace the document.
  await segment(uiCopy.modes.library).click();
  await expect(
    page.getByRole("dialog"),
    "leaving a dirty document asked a question it cannot lose the answer to",
  ).toHaveCount(0);
  await expect(segment(uiCopy.modes.library)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.locator(".editor-shell-body"),
    "the editor's body was unmounted rather than hidden",
  ).toBeHidden();
  await expect(
    page.locator("[data-yunari-mode-region]"),
    "the Library renders no region",
  ).toHaveAttribute("data-yunari-mode-region", "library");
  await expect(group, "the switch left the header").toBeVisible();
  await expect(
    header.locator("[data-yunari-theme-toolbar]"),
    "Library mode still draws the editor's toolbar",
  ).toHaveCount(0);

  await segment(uiCopy.modes.settings).click();
  await expect(
    page.locator("[data-yunari-mode-region]"),
    "the settings mode renders no region",
  ).toHaveAttribute("data-yunari-mode-region", "settings");
  await expect(
    header.locator("[data-yunari-theme-toolbar]"),
    "settings mode still draws the editor's toolbar",
  ).toHaveCount(0);

  // And back: the editor is the document's surface, and the switch returns it
  // without a reload and without a second question.
  await segment(uiCopy.modes.editor).click();
  await expect(segment(uiCopy.modes.editor)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".editor-shell-body")).toBeVisible();
  await expect(page.locator("[data-yunari-mode-region]")).toHaveCount(0);
  await expect(
    header.locator("[data-yunari-theme-toolbar]"),
    "the editor's toolbar did not come back",
  ).toHaveCount(1);
  await expect(
    identity,
    "the document did not survive the round trip",
  ).toHaveAttribute("data-dirty", "true");

  const drawnAfter = await coverage();
  expect(
    drawnAfter,
    `the canvas came back blank (painted ${drawnBefore} before, ${drawnAfter} after)`,
  ).toBeGreaterThan(0);
  expect(
    Math.abs(drawnAfter - drawnBefore) / drawnBefore,
    `the canvas came back painted as something else (${drawnBefore} before, ${drawnAfter} after)`,
  ).toBeLessThan(0.1);
});

/**
 * **The online half, on a real browser** (A.8): the catalogue's items, the three
 * install answers the library's join produces, what a kind this build does not
 * ship is called, and the item's own surface.
 *
 * **The index is routed, never fetched.** `page.route("**\/index.json", …)`
 * intercepts before the browser's cache, so what the half reads is this document
 * and not whatever the origin answers — and the real catalogue is empty until
 * phase E, so a case that reached it would assert nothing. The CDN the pictures
 * come from is routed to a stand-in for the same reason: this case claims no
 * picture, and the network is not what it is measuring.
 *
 * The three readable entries carry one fact each: `cat-skyline` is held at the
 * catalogue's own version, `cat-tide` at an older one, and `cat-ember` not at
 * all — the three install answers. `ambient` is a tag exactly one item declares.
 * The fourth entry is of a kind this build does not ship.
 */
const ONLINE_FACETS = {
  author: "mira-k",
  colourMode: "dark",
  sensors: [],
  orientation: "landscape",
  aspect: "16:9",
  width: 1920,
  height: 1080,
} as const;

/** One `index.json` entry, in the wire shape `parseCatalogueIndex` reads. */
function onlineEntry(input: {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly updatedAt: string;
  readonly downloads: number;
  readonly favorites: number;
  readonly tags: readonly string[];
  readonly kind?: string;
  readonly remixOf?: {
    readonly catalogueId: string;
    readonly name: string;
    readonly version: string;
  };
}): Record<string, unknown> {
  return {
    id: input.id,
    kind: input.kind ?? "dashboard-theme",
    name: input.name,
    version: input.version,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: input.updatedAt,
    downloads: input.downloads,
    favorites: input.favorites,
    packageUrl: `https://catalogue.test/${input.id}.zip`,
    thumbnail: `${input.id}/thumbnail.png`,
    // The wire requires the key on every entry. A dashboard theme is one
    // member; any other kind here has nothing to browse.
    members:
      (input.kind ?? "dashboard-theme") === "dashboard-theme"
        ? [{ id: input.id, kind: "dashboard-theme", name: input.name }]
        : [],
    facets: { ...ONLINE_FACETS, tags: [...input.tags] },
    ...(input.remixOf === undefined ? {} : { remixOf: input.remixOf }),
  };
}

const ONLINE_CATALOGUE = {
  generatedAt: "2026-10-21T00:00:00.000Z",
  entries: [
    onlineEntry({
      id: "cat-skyline",
      name: "Skyline",
      version: "1.4.0",
      updatedAt: "2026-10-18T00:00:00.000Z",
      downloads: 1_204,
      favorites: 86,
      tags: ["ambient", "dashboard"],
    }),
    onlineEntry({
      id: "cat-tide",
      name: "Tide",
      version: "1.4.0",
      updatedAt: "2026-10-17T00:00:00.000Z",
      downloads: 42,
      favorites: 9,
      tags: ["dashboard"],
    }),
    onlineEntry({
      id: "cat-ember",
      name: "Ember",
      version: "2.0.0",
      updatedAt: "2026-10-16T00:00:00.000Z",
      downloads: 17,
      favorites: 3,
      tags: ["minimal"],
    }),
    onlineEntry({
      id: "cat-sketch",
      name: "Sketch",
      version: "1.0.0",
      updatedAt: "2026-10-15T00:00:00.000Z",
      downloads: 0,
      favorites: 0,
      tags: [],
      kind: "widget-preset",
    }),
  ],
};

/** A catalogue whose ids are UUIDs, as the catalogue boundary now requires, and
 *  which carries one remix whose parent is listed and one whose parent is not. */
const REMIX_PARENT = "8f14e45f-ea0a-4e1c-9a2b-3f6c1d2e4a5b";
const REMIX_CHILD = "3f2a1c9e-8b7d-4c6a-9e0f-1a2b3c4d5e6f";
const REMIX_ORPHAN = "d4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f70";
const REMIX_CATALOGUE = {
  generatedAt: "2026-10-21T00:00:00.000Z",
  entries: [
    onlineEntry({
      id: REMIX_PARENT,
      name: "System dashboard",
      version: "1.4.0",
      updatedAt: "2026-10-18T00:00:00.000Z",
      downloads: 240,
      favorites: 12,
      tags: ["dashboard"],
    }),
    onlineEntry({
      id: REMIX_CHILD,
      name: "System dashboard (remix)",
      version: "1.2.0",
      updatedAt: "2026-10-19T00:00:00.000Z",
      downloads: 31,
      favorites: 4,
      tags: ["dashboard"],
      remixOf: {
        catalogueId: REMIX_PARENT,
        name: "System dashboard",
        version: "1.4.0",
      },
    }),
    onlineEntry({
      id: REMIX_ORPHAN,
      name: "Vanished lineage",
      version: "1.0.0",
      updatedAt: "2026-10-20T00:00:00.000Z",
      downloads: 3,
      favorites: 0,
      tags: ["dashboard"],
      remixOf: {
        catalogueId: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
        name: "Vanished theme",
        version: "1.0.0",
      },
    }),
  ],
};

/**
 * The library the online half joins against: two copies, each carrying the
 * origin record the host keeps — the catalogue item and the version it was
 * installed from. `cat-ember` is absent, which is the third answer.
 */
const ONLINE_LIBRARY = [
  {
    id: "library-skyline",
    name: "Skyline",
    author: "mira-k",
    version: "1.4.0",
    updatedAt: "2026-10-18T00:00:00.000Z",
    ground: DARK_GROUND,
    origin: {
      catalogueId: "cat-skyline",
      version: "1.4.0",
      installedAt: "2026-10-19T00:00:00.000Z",
    },
    facets: { ...ONLINE_FACETS, tags: [] },
  },
  {
    id: "library-tide",
    name: "Tide",
    author: "mira-k",
    version: "1.4.0",
    updatedAt: "2026-10-17T00:00:00.000Z",
    ground: DARK_GROUND,
    origin: {
      catalogueId: "cat-tide",
      version: "1.3.0",
      installedAt: "2026-10-05T00:00:00.000Z",
    },
    facets: { ...ONLINE_FACETS, tags: [] },
  },
];

/** The library copy a successful install of `cat-ember` leaves behind: the
 *  host's own write, listed at the catalogue's version, which is what makes the
 *  cell read Installed on the re-list. */
const INSTALLED_EMBER = {
  id: "library-ember",
  name: "Ember",
  author: ONLINE_FACETS.author,
  version: "2.0.0",
  updatedAt: "2026-10-16T00:00:00.000Z",
  ground: DARK_GROUND,
  origin: {
    catalogueId: "cat-ember",
    version: "2.0.0",
    installedAt: "2026-10-21T00:00:00.000Z",
  },
  facets: { ...ONLINE_FACETS, tags: [] },
};

/** The copy a successful update of `cat-tide` leaves behind: the same library
 *  theme, with its origin moved to the catalogue's version. */
const UPDATED_TIDE = {
  id: "library-tide",
  name: "Tide",
  author: ONLINE_FACETS.author,
  version: "1.4.0",
  updatedAt: "2026-10-17T00:00:00.000Z",
  ground: DARK_GROUND,
  origin: {
    catalogueId: "cat-tide",
    version: "1.4.0",
    installedAt: "2026-10-05T00:00:00.000Z",
  },
  facets: { ...ONLINE_FACETS, tags: [] },
};

/**
 * The host's two answers for a case that presses an install: the install
 * itself, and the library listing the surface re-reads after it.
 *
 * **`library` is read on every request rather than captured once.** A
 * successful install is the host's own write, so the re-list is how the cell
 * learns what the host wrote — and `onInstall` runs before the answer, so a
 * host that accepts has already listed the copy the re-list reads.
 */
async function routeInstallingHost(
  page: Page,
  options: {
    readonly library: () => readonly unknown[];
    readonly onInstall?: () => void;
    readonly refusal?: string;
  },
): Promise<void> {
  await page.route("**/api/store/install", (route) => {
    options.onInstall?.();
    return options.refusal === undefined
      ? route.fulfill({ json: { ok: true, id: "installed" } })
      : route.fulfill({ status: 400, body: options.refusal });
  });
  await page.route("**/api/themes", (route) =>
    route.fulfill({ json: { themes: options.library() } }),
  );
}

/** A transparent 1×1 PNG, for a picture a fixture does not serve: an empty box
 *  showing the surface's own ground rather than the browser's broken-image
 *  mark, which would read as a defect in the surface. */
const EMPTY_PICTURE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAANSURBVBhXY2BgYGAAAAAFAAGKM+MAAAAAAElFTkSuQmCC",
  "base64",
);

/**
 * The dashboard themes page: the catalogue and the library both routed, the
 * region mounted on the shell's default "All" state, and the joined rows
 * listed. The two library rows name catalogue items the listing carries, so
 * the join draws the three catalogue rows and no separate library rows.
 */
async function showOnlineStore(
  page: Page,
  catalogue: {
    readonly generatedAt: string;
    readonly entries: readonly Record<string, unknown>[];
  } = ONLINE_CATALOGUE,
  /** The joined rows the page draws. The default catalogue's library rows name
   *  its items, so they merge; a catalogue the library does not name draws its
   *  own rows beside the two library-only ones. */
  expectedCells = 3,
): Promise<Locator> {
  await page.route("**/index.json", (route) =>
    route.fulfill({
      // A fulfilled response still passes the browser's CORS check, and the
      // origin this stands in for answers with the header.
      headers: { "access-control-allow-origin": "*" },
      json: catalogue,
    }),
  );
  await page.route("**/api/themes", (route) =>
    route.fulfill({ json: { themes: ONLINE_LIBRARY } }),
  );
  // The pictures come from the store's own origin — the one `thumbnail` paths
  // resolve against (`catalogue-location.ts`) — and the real catalogue always
  // holds one: a 1×1 PNG stands in, so no cell and no stage draws the browser's
  // broken-image mark, which would read as a defect in the surface rather than
  // as a fixture that left the network alone. The pixel is the panel ground, so
  // the stand-in reads as an empty picture box.
  const catalogueHostname = new URL(CATALOGUE_ORIGIN).hostname;
  await page.route(
    // The path matters as well as the host: a host-only matcher is registered
    // after `**/index.json` and would answer the catalogue itself with a PNG.
    (url) =>
      url.hostname === catalogueHostname &&
      url.pathname.endsWith("/thumbnail.png"),
    (route) =>
      route.fulfill({
        contentType: "image/png",
        body: EMPTY_PICTURE_PNG,
      }),
  );

  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();
  await page
    .locator(".editor-shell-mode-switch")
    .getByRole("button", { name: uiCopy.modes.library, exact: true })
    .click();

  const region = page.locator("[data-yunari-mode-region='library']");
  await expect(region, "the Library renders no region").toBeVisible();
  // The shell opens the Library on "All", which is the state that draws the
  // catalogue's rows joined with this PC's copies.
  await expect(
    region.locator("[data-yunari-store-cell]"),
    "the page does not list the catalogue's readable items",
  ).toHaveCount(expectedCells);
  return region;
}

test("the online half lists the catalogue, its kind badge and a thousands-separated count", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  const region = await showOnlineStore(page);
  await expect(
    region.locator("[data-yunari-store-cell-name]"),
    "the online half does not list the catalogue's items",
  ).toHaveText(["Skyline", "Tide", "Ember"]);

  const cell = region.locator("[data-yunari-store-cell='cat-skyline']");
  // **The literal, not `uiCopy.store.cell.memberKinds`**: the badge's whole
  // value is that a renamed word fails here, the rule the origin badge's case
  // states for its own word.
  await expect(
    cell.locator("[data-yunari-store-cell-kind]"),
    "the catalogue cell's kind badge does not read Theme",
  ).toHaveText("Theme");
  // `1,204` and not `1204`: the separator is the claim, and `Intl` is what
  // draws it.
  await expect(
    cell.locator("[data-yunari-store-cell-downloads]"),
    "the download count is not drawn with a thousands separator",
  ).toHaveText("1,204 downloads");

  await captureVisualReview(page, testInfo, "store-online-catalogue", region);
});

test("the online half draws an installed theme's commands, and Update or Install for the other two", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  const region = await showOnlineStore(page);
  const actionOf = (id: string, state: string): Locator =>
    region.locator(
      `[data-yunari-store-cell='${id}'] [data-yunari-store-cell-install='${state}']`,
    );

  // Held at the catalogue's own version: there is nothing to install, so the
  // cell draws the four commands the join's `installedId` enables against the
  // library copy — **the commands are the installed state**, and the install
  // press is gone. A catalogue cell this PC never installed draws Install
  // instead (`cat-ember` below), which is what makes this cell's reading a
  // fact of the join rather than of the card's own choices.
  const installed = region.locator("[data-yunari-store-cell='cat-skyline']");
  await expect(
    installed.locator("[data-yunari-store-cell-install]"),
    "an item held at the same version still offers an install press",
  ).toHaveCount(0);
  for (const action of ["assign", "open", "export", "delete"]) {
    await expect(
      installed.locator(`[data-yunari-store-cell-action='${action}']`),
      `an item held at the same version does not draw its ${action} command`,
    ).toBeEnabled();
  }

  // Held at an older version: Update, live, because the press installs it.
  const update = actionOf("cat-tide", "update");
  await expect(
    update,
    "an item held at an older version does not read Update",
  ).toBeVisible();
  await expect(update, "Update's word is not Update").toHaveText("Update");
  await expect(update, "Update is drawn as a live control").toBeEnabled();

  // Not held at all: Install, live for the same reason.
  const install = actionOf("cat-ember", "install");
  await expect(
    install,
    "an item the library does not hold does not read Install",
  ).toBeVisible();
  await expect(install, "Install's word is not Install").toHaveText("Install");
  await expect(install, "Install is drawn as a live control").toBeEnabled();

  await captureVisualReview(
    page,
    testInfo,
    "store-online-install-states",
    region,
  );
});

test("pressing Install on an online cell draws the item's commands once the host answers ok", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  const region = await showOnlineStore(page);
  let library: readonly unknown[] = ONLINE_LIBRARY;
  await routeInstallingHost(page, {
    library: () => library,
    onInstall: () => {
      library = [...ONLINE_LIBRARY, INSTALLED_EMBER];
    },
  });

  const cell = region.locator("[data-yunari-store-cell='cat-ember']");
  const install = cell.locator("[data-yunari-store-cell-install='install']");
  await expect(
    install,
    "an item the library does not hold does not offer Install",
  ).toHaveText("Install");
  await cell.hover();
  await install.click();

  // **The re-list is the evidence**: the host answered `ok`, the surface read
  // the library back, and the join drew what the host wrote. The four commands
  // are drawn only for a catalogue row the joined library named as installed,
  // so a word set on the press could not produce them if the re-list never
  // happened.
  await expect(
    cell.locator("[data-yunari-store-cell-install]"),
    "the cell the host installed still offers an install press",
  ).toHaveCount(0);
  await expect(
    cell.locator("[data-yunari-store-cell-action='open']"),
    "the cell the host installed does not draw the commands its copy allows",
  ).toBeEnabled();
  await expect(
    cell.locator("[data-yunari-store-cell-action='delete']"),
    "the installed cell does not draw the delete command its copy allows",
  ).toBeEnabled();

  await captureVisualReview(
    page,
    testInfo,
    "store-online-install-installed",
    region,
  );
});

test("an item the library holds at an older version reads Update before the press and draws its commands after", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  const region = await showOnlineStore(page);
  const cell = region.locator("[data-yunari-store-cell='cat-tide']");
  // The origin says `1.3.0` was installed and the catalogue holds `1.4.0`.
  const update = cell.locator("[data-yunari-store-cell-install='update']");
  await expect(
    update,
    "an item held at an older version does not read Update",
  ).toHaveText("Update");
  await expect(update, "Update is drawn as a live control").toBeEnabled();

  let library: readonly unknown[] = ONLINE_LIBRARY;
  await routeInstallingHost(page, {
    library: () => library,
    onInstall: () => {
      library = ONLINE_LIBRARY.map((item) =>
        item.origin.catalogueId === "cat-tide" ? UPDATED_TIDE : item,
      );
    },
  });
  await cell.hover();
  await update.click();

  // The re-listed copy is at the catalogue's version, so the join draws the
  // installed commands rather than an Update press.
  await expect(
    cell.locator("[data-yunari-store-cell-install='update']"),
    "the updated item still offers the update press",
  ).toHaveCount(0);
  await expect(
    cell.locator("[data-yunari-store-cell-action='open']"),
    "the updated item does not draw the commands its copy now allows",
  ).toBeEnabled();

  await captureVisualReview(
    page,
    testInfo,
    "store-online-install-updated",
    region,
  );
});

test("a refused install leaves the cell as it was and states the host's reason", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  const region = await showOnlineStore(page);
  const reason = "That package is not a theme.";
  await routeInstallingHost(page, {
    library: () => ONLINE_LIBRARY,
    refusal: reason,
  });

  const cell = region.locator("[data-yunari-store-cell='cat-ember']");
  const install = cell.locator("[data-yunari-store-cell-install='install']");
  await expect(
    install,
    "the cell before the press does not read Install",
  ).toHaveText("Install");
  await cell.hover();
  await install.click();

  // **The host's sentence, verbatim** — a reason composed on this side would
  // hide which part of the install the host refused.
  await expect(
    cell.locator("[data-yunari-store-cell-install-refusal]"),
    "the refused install is not stated beside its cell",
  ).toHaveText(reason);
  const after = cell.locator("[data-yunari-store-cell-install='install']");
  await expect(after, "a refused install moved the cell's state").toHaveText(
    "Install",
  );
  await expect(after, "a refused install left the control dead").toBeEnabled();

  await captureVisualReview(
    page,
    testInfo,
    "store-online-install-refused",
    region,
  );
});

test("the online item's own surface shows its counts and its install action", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  const region = await showOnlineStore(page);
  await region
    .locator(
      "[data-yunari-store-cell='cat-ember'] [data-yunari-store-cell-surface]",
    )
    .click();
  const modal = page.locator("[data-yunari-store-item]");
  await expect(modal, "a cell opens no item's surface").toBeVisible();
  await expect(modal.locator("[data-yunari-store-item-name]")).toHaveText(
    "Ember",
  );

  // Both counts, each with the noun it is counted with, on the caption line.
  const stamp = modal.locator("[data-yunari-store-item-date]");
  await expect(
    stamp,
    "the item's surface does not print its download count",
  ).toContainText("17 downloads");
  await expect(
    stamp,
    "the item's surface does not print its favourite count",
  ).toContainText("3 favorites");

  const install = modal.locator("[data-yunari-store-item-install='install']");
  await expect(
    install,
    "the item's surface draws no install action",
  ).toBeVisible();
  await expect(install, "the install action does not read Install").toHaveText(
    "Install",
  );
  await expect(
    install,
    "the install action is drawn as a live control",
  ).toBeEnabled();

  await captureVisualReview(page, testInfo, "store-online-modal");
});

/**
 * Four themes, each carrying one fact the submission cases turn on: an origin
 * record, no tags, a tag pair, and a 19.5:9 artboard. **No `updatedAt`**, so the
 * editor boots on its starter and opens nothing before a case's own open.
 */
function boundaryEnvelope(input: {
  readonly id: string;
  readonly name: string;
  readonly tags: readonly string[];
  readonly width: number;
  readonly height: number;
}): FabricThemeEnvelope {
  return {
    schemaVersion: "3.0.0",
    fabricVersion: "7.4.0",
    id: input.id,
    artboard: {
      width: input.width,
      height: input.height,
    },
    background: { color: { value: DARK_GROUND } },
    metadata: {
      name: input.name,
      themeLanguage: "en",
      author: "huyng",
      tags: [...input.tags],
    },
    scene: { version: "7.4.0", objects: [] },
  };
}

/** Where one copy came from, in the host's own record shape
 *  (`settings/catalogue-origins.ts`). */
const BOUNDARY_ORIGIN: CatalogueOrigin = {
  kind: DASHBOARD_THEME_KIND,
  catalogueId: "cat-office-wall",
  version: "1.2.0",
  installedAt: "2026-10-10T09:00:00.000Z",
};

/**
 * Four themes, each carrying one fact the case turns on: a copy installed from
 * the catalogue, a theme the author made here, a theme whose tag no other theme
 * and no seed holds, and an artboard at `19.5:9` (`2340×1080`).
 *
 * **`dusk-cafe` is on two themes and `warm-lantern` on one**, which is the pair
 * the modal's two pills are read from: the first is settled by the other theme's
 * use, the second by nothing at all.
 *
 * **No `updatedAt`**, so the editor boots on the starter it always opened on and
 * no theme opens before this case's own open — the same shape `store-library.ts`
 * seeds.
 */
const BOUNDARY_LIBRARY = (
  [
    {
      envelope: boundaryEnvelope({
        id: "boundary-origin",
        name: "Boundary origin",
        tags: ["futuristic", "dusk-cafe"],
        width: 1920,
        height: 1080,
      }),
      origin: BOUNDARY_ORIGIN,
    },
    {
      envelope: boundaryEnvelope({
        id: "boundary-plain",
        name: "Boundary plain",
        tags: [],
        width: 1920,
        height: 1080,
      }),
      origin: undefined,
    },
    {
      envelope: boundaryEnvelope({
        id: "boundary-proposed",
        name: "Boundary proposed",
        tags: ["dusk-cafe", "warm-lantern"],
        width: 1920,
        height: 1080,
      }),
      origin: undefined,
    },
    {
      envelope: boundaryEnvelope({
        id: "boundary-wide",
        name: "Boundary wide",
        tags: [],
        width: 2340,
        height: 1080,
      }),
      origin: undefined,
    },
  ] as const satisfies readonly {
    readonly envelope: FabricThemeEnvelope;
    readonly origin: CatalogueOrigin | undefined;
  }[]
).map(({ envelope, origin }) => ({
  id: envelope.id,
  name: envelope.metadata?.name,
  author: envelope.metadata?.author,
  version: "1.4.0",
  ground: DARK_GROUND,
  // Absent rather than `undefined`: the record is consumer state the host keeps
  // beside the library, so a theme the author made here has no key at all.
  ...(origin === undefined ? {} : { origin }),
  facets: facetRecordOf(envelope),
}));

/**
 * The library half with one theme's own surface open — **the only half whose
 * surface offers Submit**: an online item draws its install answer instead
 * (`item-modal.tsx`).
 *
 * The library is `BOUNDARY_LIBRARY`, which carries no `updatedAt`, so the
 * editor boots on its starter and opens nothing before this case's own open.
 * The submission routes are the caller's, registered after this returns and
 * before the press, because only the press asks them anything.
 */
async function openLibraryItem(page: Page, id: string): Promise<Locator> {
  await page.route("**/api/themes", (route) =>
    route.fulfill({ json: { themes: BOUNDARY_LIBRARY } }),
  );
  // The client composes `/api/themes/<id>/thumbnail` for every entry, so an
  // unrouted thumbnail draws the browser's broken-image mark in each capture.
  await page.route("**/api/themes/*/thumbnail", (route) =>
    route.fulfill({ contentType: "image/png", body: EMPTY_PICTURE_PNG }),
  );
  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();
  await page
    .locator(".editor-shell-mode-switch")
    .getByRole("button", { name: uiCopy.modes.library, exact: true })
    .click();

  const region = page.locator("[data-yunari-mode-region='library']");
  await expect(region, "the Library renders no region").toBeVisible();
  await region
    .locator(
      `[data-yunari-store-cell='${id}'] [data-yunari-store-cell-surface]`,
    )
    .click();
  const modal = page.locator("[data-yunari-store-item]");
  await expect(modal, "a library cell opens no item's surface").toBeVisible();
  return modal;
}

/** The host's answer for the device flow these three cases stand in for. */
/** The address the host's own sign-in window is opened at. */
const SIGN_IN_URL = "https://store.test/auth/start?provider=github";

test("a missing identity opens the host's sign-in window and names the author's part", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  const modal = await openLibraryItem(page, "boundary-plain");
  // The submission's preparation step opens the stored theme to bake its crops,
  // and the preview has no host: without this answer the step refuses the
  // submission before the 401 below is ever asked for.
  await page.route("**/api/themes/boundary-plain", (route) =>
    route.fulfill({
      json: {
        envelope: boundaryEnvelope({
          id: "boundary-plain",
          name: "Boundary plain",
          tags: [],
          width: 1920,
          height: 1080,
        }),
        assets: {},
      },
    }),
  );
  // **A `401` is the one status that starts a sign-in**, and the poll waits:
  // this claim is about what the author is told while it does.
  await page.route("**/api/themes/submit", (route) =>
    route.fulfill({ status: 401, body: "" }),
  );
  let starts = 0;
  await page.route("**/api/store/auth/start", (route) => {
    starts += 1;
    return route.fulfill({ json: { url: SIGN_IN_URL } });
  });
  await page.route("**/api/store/session", (route) =>
    route.fulfill({ json: { signedIn: false } }),
  );

  const submit = modal.locator("[data-yunari-store-item-submit]");
  await expect(
    submit,
    "the library item's surface offers no submission",
  ).toHaveText("Publish to theme store");
  await submit.click();

  await expect(
    submit,
    "the control does not enter the sign-in state",
  ).toHaveAttribute("data-yunari-store-item-submit", "authorising");
  await expect(
    submit,
    "the control is live while the flow waits",
  ).toBeDisabled();
  // **The host owns the conversation**: its window holds the code and the
  // link, so the surface prints neither and states only the author's part.
  await expect(
    submit,
    "the control does not state the author's part while the window is open",
  ).toHaveText("Waiting for you to sign in…");
  expect(starts, "the surface did not ask the host to start a sign-in").toBe(1);

  await captureVisualReview(page, testInfo, "store-submit-code", modal);
});

test("a submitted theme states the store's status word and the control no longer offers Submit", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  const modal = await openLibraryItem(page, "boundary-plain");
  // The submission's preparation step opens the stored theme to bake its crops.
  // The listing stub is enough for the card, but the open is a second read, and
  // without an answer the step refuses the submission before the 401 below.
  const plain = boundaryEnvelope({
    id: "boundary-plain",
    name: "Boundary plain",
    tags: [],
    width: 1920,
    height: 1080,
  });
  await page.route("**/api/themes/boundary-plain", (route) =>
    route.fulfill({ json: { envelope: plain, assets: {} } }),
  );
  // The host answers the first press with no identity and the retry with the
  // store's own status and version; the session poll authorises once.
  let submits = 0;
  await page.route("**/api/themes/submit", (route) => {
    submits += 1;
    return submits === 1
      ? route.fulfill({ status: 401, body: "" })
      : route.fulfill({
          json: {
            ok: true,
            status: "pending",
            version: { from: "1.4.0", to: "1.4.1", level: "patch" },
          },
        });
  });
  await page.route("**/api/store/auth/start", (route) =>
    route.fulfill({ json: { url: SIGN_IN_URL } }),
  );
  let polls = 0;
  await page.route("**/api/store/session", (route) => {
    polls += 1;
    return route.fulfill({
      json: polls === 1 ? { signedIn: false } : { signedIn: true },
    });
  });

  const submit = modal.locator("[data-yunari-store-item-submit]");
  await submit.click();

  const submitted = modal.locator(
    "[data-yunari-store-item-submit='submitted']",
  );
  await expect(
    submitted,
    "the retried submission never reaches the submitted state",
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    submitted,
    "a submitted theme's control still offers another submission",
  ).toBeDisabled();
  // The store's own word for what happens next, beside the version the host
  // published: a new author's first item waits for the owner.
  await expect(
    modal.locator("[data-yunari-store-item-submit-status]"),
    "the footer does not state the state the store landed",
  ).toHaveText("Pending");
  await expect(
    modal,
    "the surface does not say what happens to a new author's item",
  ).toContainText(
    "Submitted. The owner reviews new authors' items before they are listed.",
  );

  await captureVisualReview(page, testInfo, "store-submit-submitted", modal);
});

test("a refused submission states the host's own sentence", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  const modal = await openLibraryItem(page, "boundary-plain");
  // The preparation step opens the stored theme to bake its crops; the preview
  // serves no host, so this answer keeps the press reaching the 503 below.
  await page.route("**/api/themes/boundary-plain", (route) =>
    route.fulfill({
      json: {
        envelope: boundaryEnvelope({
          id: "boundary-plain",
          name: "Boundary plain",
          tags: [],
          width: 1920,
          height: 1080,
        }),
        assets: {},
      },
    }),
  );
  // A sentence only the host could write: a local composer that paraphrased it
  // would pass a test that asserted its own copy instead.
  const reason = "This host has no GitHub token to open a pull request.";
  let starts = 0;
  await page.route("**/api/themes/submit", (route) =>
    route.fulfill({ status: 503, body: reason }),
  );
  await page.route("**/api/store/auth/start", (route) => {
    starts += 1;
    return route.fulfill({ json: { url: SIGN_IN_URL } });
  });

  const submit = modal.locator("[data-yunari-store-item-submit]");
  await submit.click();

  await expect(
    modal.locator("[data-yunari-store-item-submit-refusal]"),
    "the refused submission is not stated beside the control",
  ).toHaveText(reason);
  const after = modal.locator("[data-yunari-store-item-submit='refused']");
  await expect(
    after,
    "a refused submission left the control in another state",
  ).toBeVisible();
  await expect(
    after,
    "a refused submission left the control dead",
  ).toBeEnabled();
  expect(starts, "a refusal that is not a 401 started a sign-in").toBe(0);

  await captureVisualReview(page, testInfo, "store-submit-refused", modal);
});

test("a submitted theme states the version it published, and the caption reads it back", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  const modal = await openLibraryItem(page, "boundary-plain");
  // The preparation step opens the stored theme to bake its crops; without this
  // answer the preview's HTML refusal ends the press before it is submitted.
  await page.route("**/api/themes/boundary-plain", (route) =>
    route.fulfill({
      json: {
        envelope: boundaryEnvelope({
          id: "boundary-plain",
          name: "Boundary plain",
          tags: [],
          width: 1920,
          height: 1080,
        }),
        assets: {},
      },
    }),
  );
  // The host wrote `1.5.0` into the document and the surface re-read the
  // library after the submission, so every later listing is the new version.
  await page.route("**/api/themes", (route) =>
    route.fulfill({
      json: {
        themes: BOUNDARY_LIBRARY.map((theme) =>
          theme.id === "boundary-plain"
            ? { ...theme, version: "1.5.0" }
            : theme,
        ),
      },
    }),
  );
  await page.route("**/api/themes/submit", (route) =>
    route.fulfill({
      json: {
        ok: true,
        status: "published",
        version: { from: "1.4.0", to: "1.5.0", level: "minor" },
      },
    }),
  );

  await modal.locator("[data-yunari-store-item-submit]").click();
  const submitted = modal.locator(
    "[data-yunari-store-item-submit='submitted']",
  );
  await expect(
    submitted,
    "the submission never reaches the submitted state",
  ).toBeVisible({ timeout: 15_000 });
  // The literal sentence, not `uiCopy.store.submit.version`: the claim is what
  // the author reads, and a rewritten copy fails here.
  await expect(
    modal.locator("[data-yunari-store-item-submit-version]"),
    "the submitted surface does not state the version it published",
  ).toHaveText("1.4.0 → 1.5.0 · minor");
  // The re-list is the host's write read back, not the answer echoed: the
  // caption prints the version the listing now carries.
  await expect(
    modal.locator("[data-yunari-store-item-date]"),
    "the caption does not read the version the submission wrote",
  ).toContainText("1.5.0");

  await captureVisualReview(page, testInfo, "store-submit-version", modal);
});

test("a remix credits its parent, linking it when listed and naming it when not", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  const region = await showOnlineStore(page, REMIX_CATALOGUE, 5);
  const open = async (id: string): Promise<Locator> => {
    await region
      .locator(
        `[data-yunari-store-cell='${id}'] [data-yunari-store-cell-surface]`,
      )
      .click();
    const modal = page.locator("[data-yunari-store-item]");
    await expect(modal, "a cell opens no item's surface").toBeVisible();
    return modal;
  };

  const modal = await open(REMIX_CHILD);
  const credit = modal.locator("[data-yunari-store-item-remix]");
  await expect(credit, "the remix does not credit its parent").toHaveText(
    "Remixed from System dashboard",
  );
  await expect(
    credit,
    "the credit is not the control an item in the index gives",
  ).toHaveRole("button");

  await captureVisualReview(page, testInfo, "store-remix-credit", modal);

  await credit.click();
  await expect(
    modal.locator("[data-yunari-store-item-name]"),
    "the credit does not open the parent item",
  ).toHaveText("System dashboard");

  await modal.locator("[data-yunari-store-item-close]").click();
  await expect(modal, "the parent's surface does not close").toBeHidden();

  const orphan = await open(REMIX_ORPHAN);
  const text = orphan.locator("[data-yunari-store-item-remix]");
  await expect(
    text,
    "a remix whose parent the index lacks does not name it as text",
  ).toHaveText("Remixed from Vanished theme");
  expect(
    await text.evaluate((element) => element.tagName),
    "an absent parent's credit is drawn as a dead link",
  ).toBe("SPAN");
});

/**
 * **The camera, read off the surface it draws on** (A.7d).
 *
 * The canvas element's own client box beside the artboard's rect inside it,
 * both in canvas px — the same pair `sceneToClient` converts a scene point
 * through, and the pair the nine cases this defect turned red depend on. A
 * `isFitted()` flag on its own would answer "the camera thinks it is fitted";
 * the box beside it answers what is on the canvas.
 */
async function boardOnCanvas(page: Page): Promise<{
  readonly canvas: { readonly width: number; readonly height: number };
  readonly board: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
  readonly fitted: boolean;
}> {
  return page.evaluate(() => {
    const bridge = (
      window as unknown as {
        yunariEditorBridge: {
          editor: {
            viewport: {
              artboardScreenRect(): {
                left: number;
                top: number;
                width: number;
                height: number;
              };
              isFitted(): boolean;
            };
          };
        };
      }
    ).yunariEditorBridge;
    const canvas = document.querySelector<HTMLCanvasElement>(
      "#yunari-fabric-editor canvas.upper-canvas",
    );
    const box = canvas?.getBoundingClientRect();
    return {
      canvas: { width: box?.width ?? 0, height: box?.height ?? 0 },
      board: bridge.editor.viewport.artboardScreenRect(),
      fitted: bridge.editor.viewport.isFitted(),
    };
  });
}

/** Whether the whole artboard is inside the canvas, in the reading above. Half
 *  a px of slack for the rounding a contain fit lands on. */
function boardIsInside(
  read: Awaited<ReturnType<typeof boardOnCanvas>>,
): boolean {
  const slack = 0.5;
  return (
    read.board.left >= -slack &&
    read.board.top >= -slack &&
    read.board.left + read.board.width <= read.canvas.width + slack &&
    read.board.top + read.board.height <= read.canvas.height + slack
  );
}

/** Waits for a camera the mode change moved to have landed: a read taken before
 *  the resize the newly-visible body triggers is a read of the old box. */
async function settled(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}

/**
 * **The store's `open` action loads a library theme as the editor's document**
 * (R134), from the cell and from the item's own footer alike — the label the
 * store gives it is *Open in editor* — while **the cell's own surface is what
 * opens the item's**, so a cell opens a modal.
 *
 * **Nothing serves `/api/themes` at the editor preview**, so both routes are
 * stubbed here: the case proves the route the store takes, not the host's store,
 * whose own read is `theme-library-client`'s and is proved where a host is real.
 * Two themes rather than one, because the second open has to be *seen* to
 * happen: an open that replaced the document with the same document would read
 * the same either way.
 *
 * **What the base reading here shows is that *a* base exists, not which one.**
 * `publishableDocument` answers with the document envelope's own id and only
 * for a document the library holds, so it is `undefined` over the template the
 * editor boots with and names the theme once that theme is open. A base moved
 * onto another stored id would read the same; which base travels is proved
 * where it is set, in `theme-library-manager/index.test.ts`, by the `opened.base`
 * handed to `onOpenTheme`. What this case adds is the one browser-visible
 * consequence: a save with no base is ungated (`vg-642`), and no readout of the
 * document's own identity would show that.
 */
test("the store opens a library theme as the document, from the cell and its footer", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  const CELL_NAME = "Cell theme";
  const FOOTER_NAME = "Footer theme";
  const themeOf = (id: string, name: string): FabricThemeEnvelope =>
    withRoleTokens({
      schemaVersion: "3.0.0",
      fabricVersion: "7.4.0",
      id,
      // No artboard paint: a theme's background is a palette token or nothing
      // (`fabric-envelope-validate.ts`), and a local literal here would be a
      // document the editor refuses to open — which is what this case's own first
      // run proved, by failing at the canvas with the validator's sentence.
      artboard: { width: 1920, height: 1080 },
      metadata: { name, themeLanguage: "en", author: "huyng" },
      scene: { version: "7.4.0", objects: [] },
    });
  const fromCell = themeOf("store-from-cell", CELL_NAME);
  const fromFooter = themeOf("store-from-footer", FOOTER_NAME);
  // A fourth listing entry, never opened. No entry carries an updated time, so
  // the library's newest-first order leaves the listing's own order alone and
  // this one stays last: the three before it fill one row and it is the short
  // tail, which is the only way the ragged end is read in a browser.
  const beside = themeOf("store-beside", "Zed theme");
  // A third listing entry, never opened: the card layout packs it beside the two
  // above, and its 32:9 artboard is what makes it a two-column card.
  const wide = {
    ...themeOf("store-wide", "Wide theme"),
    artboard: { width: 3840, height: 1080 },
  };

  // **No `updatedAt`, and that is load-bearing.** With no `?theme=` in the URL
  // the editor boots on the author's most recent save, which it picks by that
  // field (`boot-theme.ts`): a listing that carried one would open a theme
  // before this case's first open, and the base's own reading below would start
  // out true rather than false — proving nothing about the open that moved it.
  // An entry with no time is a shape the wire really has (a template is not a
  // stored file and has none), and the cells leave the date line empty.
  await page.route("**/api/themes", (route) =>
    route.fulfill({
      json: {
        themes: [fromCell, fromFooter, wide, beside].map((envelope) => ({
          id: envelope.id,
          name: envelope.metadata?.name,
          author: "huyng",
          version: "1.4.0",
          ground: DARK_GROUND,
          facets: facetRecordOf(envelope),
        })),
      },
    }),
  );
  for (const envelope of [fromCell, fromFooter]) {
    await page.route(`**/api/themes/${envelope.id}`, (route) =>
      route.fulfill({
        json: { envelope, assets: {}, base: `base-${envelope.id}` },
      }),
    );
  }

  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();

  /** The open document's own name, read off the bridge the editor publishes:
   *  `documentNameOf` falls back to the id, so a nameless document is still
   *  identified rather than read as none. */
  const documentName = async (): Promise<string | undefined> =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            yunariEditorBridge?: {
              snapshot(): { readonly documentName: string | undefined };
            };
          }
        ).yunariEditorBridge?.snapshot().documentName,
    );
  /** The id a display would fetch this document's assets from, or `undefined`
   *  where the document descends from nothing the library holds. */
  const publishedId = async (): Promise<string | undefined> =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            yunariEditorBridge?: {
              session: {
                publishableDocument(): { readonly id: string } | undefined;
              };
            };
          }
        ).yunariEditorBridge?.session.publishableDocument()?.id,
    );

  // The template the editor boots with descends from nothing: this is the
  // reading the opens below have to move, and the base's own proof.
  expect(
    await documentName(),
    "the editor did not boot on a document at all",
  ).toBeDefined();
  expect(
    await documentName(),
    "the editor boots on the theme this case means to open",
  ).not.toBe(CELL_NAME);
  expect(
    await publishedId(),
    "the document the editor boots with already claims a stored base",
  ).toBeUndefined();

  await page
    .locator(".editor-shell-mode-switch")
    .getByRole("button", { name: uiCopy.modes.library, exact: true })
    .click();
  const region = page.locator("[data-yunari-mode-region='library']");
  await expect(region, "the Library renders no region").toBeVisible();
  await expect(
    region.locator("[data-yunari-store-cell]"),
    "the store does not list the stubbed library",
  ).toHaveCount(4);

  // ── The cards pack as justified rows, at each theme's own ratio ────────────
  // **A row is one grid of ratio-weighted tracks.** The tracks fill the pane's
  // width, so every full row meets both edges and every card in it shares one
  // picture height; the 32:9 theme takes a wide track rather than a thin strip.
  // A final row the packing kept at the target height carries its own maximum
  // width and stops short on the right.
  const gallery = region.locator("[data-yunari-store-gallery]");
  await expect(gallery, "the store draws no gallery").toHaveCount(1);
  const pack = await gallery.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      display: style.display,
      rowGap: Number.parseFloat(style.rowGap),
      width: node.clientWidth,
      left: node.getBoundingClientRect().left,
      rows: Array.from(
        node.querySelectorAll<HTMLElement>("[data-yunari-store-row]"),
        (row) => ({
          tracks: row.style.gridTemplateColumns.split(" ").length,
          gap: Number.parseFloat(getComputedStyle(row).columnGap),
          maxWidth: row.style.maxWidth,
          right: row.getBoundingClientRect().right,
          cells: Array.from(
            row.querySelectorAll<HTMLElement>("[data-yunari-store-cell]"),
            (cell) => ({
              id: cell.getAttribute("data-yunari-store-cell"),
              width: cell.getBoundingClientRect().width,
              pictureHeight:
                cell
                  .querySelector("[data-yunari-store-picture]")
                  ?.getBoundingClientRect().height ?? 0,
            }),
          ),
        }),
      ),
    };
  });
  const packReading = `store gallery ${JSON.stringify(pack)}`;
  console.log(packReading);
  testInfo.annotations.push({
    type: "store-gallery",
    description: packReading,
  });
  expect(
    pack.display,
    `the gallery is not a column of rows (${packReading})`,
  ).toBe("flex");
  expect(
    pack.rowGap,
    `the gallery's row gap is not 12px (${packReading})`,
  ).toBe(12);
  expect(
    pack.rows.length,
    `the cards drew one row (${packReading})`,
  ).toBeGreaterThan(1);
  for (const row of pack.rows) {
    expect(
      row.tracks,
      `a row does not hold one track per card (${packReading})`,
    ).toBe(row.cells.length);
    expect(row.gap, `a row's gutter is not 12px (${packReading})`).toBe(12);
    // A full row fills the pane; the short tail is the one row allowed to stop
    // before the right edge.
    if (row.maxWidth === "") {
      expect(
        Math.round(row.right - pack.left),
        `a full row does not meet the pane's right edge (${packReading})`,
      ).toBe(pack.width);
    }
    for (const cell of row.cells) {
      // The tracks are fractions of the row and each picture derives its height
      // from its own track, so the shared height lands on a sub-pixel of
      // difference; a whole pixel apart would be a row drawn unevenly.
      expect(
        Math.abs(cell.pictureHeight - (row.cells[0]?.pictureHeight ?? 0)),
        `${cell.id}'s picture is not the row's height (${packReading})`,
      ).toBeLessThanOrEqual(1);
    }
  }
  const wideCard = pack.rows
    .flatMap((row) => row.cells)
    .find((cell) => cell.id === "store-wide");
  expect(
    wideCard?.width ?? 0,
    `the 32:9 theme is not a wide card (${packReading})`,
  ).toBeGreaterThan(600);

  const modal = page.locator("[data-yunari-store-item]");
  const cellOf = (id: string) =>
    region.locator(`[data-yunari-store-cell='${id}']`);
  const surfaceOf = (id: string) =>
    cellOf(id).locator("[data-yunari-store-cell-surface]");

  // **The card's foot is one row, and this is the reading that says so.** The
  // name is semibold at the left; the updated day sits at the right of the same
  // row, and the card's four controls fade in over that day while the card is
  // attended. The spacing is arithmetic a later edit can move: the row's 8px
  // above the name and 10px below it, the cell's 10px inset, which the spacing
  // scale's step table owns as `--space-8` and `--space-10`. A plain library
  // theme — no catalogue, no origin — draws no facts band beneath the row at
  // all, so the day is not repeated on a second line.
  //
  // **Each reading is the box the air sits outside of.** A span's own rect
  // includes its padding, so two padded bands abut however much air the padding
  // puts between their text, and measuring the rects would report 0 for every
  // gap — passing with the cell's spacing deleted. The content box (the rect
  // inside the border and the padding) is where the line really sits, so the
  // padding is the gap again; and since every box here abuts the next, the
  // arithmetic is the whole of it: a margin a later edit added would move a gap
  // off its step and fail here.
  const bands = await cellOf(fromCell.id).evaluate((cell) => {
    const contentBox = (
      element: Element | null | undefined,
    ): { readonly top: number; readonly bottom: number } | undefined => {
      if (element === null || element === undefined) return undefined;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        top:
          rect.top +
          Number.parseFloat(style.borderTopWidth) +
          Number.parseFloat(style.paddingTop),
        bottom:
          rect.bottom -
          Number.parseFloat(style.borderBottomWidth) -
          Number.parseFloat(style.paddingBottom),
      };
    };
    const name = contentBox(
      cell.querySelector("[data-yunari-store-cell-name]"),
    );
    const bylineNode = cell.querySelector<HTMLElement>(
      "[data-yunari-store-cell-byline]",
    );
    const byline = contentBox(bylineNode);
    const actions = cell.querySelector("[data-yunari-store-cell-actions]");
    const picture = cell
      .querySelector("[data-yunari-store-picture]")
      ?.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    return {
      // The cell's own 1px edge is inside its box, so the 10px the cell puts
      // below the name row is measured from the border's inner edge.
      cellInnerRight:
        cellRect.right -
        Number.parseFloat(getComputedStyle(cell).borderRightWidth),
      cellInnerBottom:
        cellRect.bottom -
        Number.parseFloat(getComputedStyle(cell).borderBottomWidth),
      pictureBottom: picture?.bottom ?? null,
      nameTop: name?.top ?? null,
      nameBottom: name?.bottom ?? null,
      bylineTop: byline?.top ?? null,
      bylineBottom: byline?.bottom ?? null,
      bylineRight: bylineNode?.getBoundingClientRect().right ?? null,
      actionsRight: actions?.getBoundingClientRect().right ?? null,
      bylineInNameRow:
        bylineNode?.parentElement?.querySelector(
          "[data-yunari-store-cell-name]",
        ) != null,
      factsBand: cell.querySelector("[data-yunari-store-cell-band]") !== null,
    };
  });
  const bandReading = `store-cell bands ${JSON.stringify(bands)}`;
  console.log(bandReading);
  testInfo.annotations.push({ type: "store-cell", description: bandReading });
  const gapOf = (
    above: number | null,
    below: number | null,
    what: string,
  ): number => {
    if (above === null || below === null) {
      throw new Error(`the cell drew no ${what} (${bandReading})`);
    }
    // Each end is rounded to the pixel grid the eye sees before the gap is
    // taken: a card's height is a fraction of a row's track, so a line box can
    // sit half a pixel off a whole step without any spacing having moved.
    return Math.round(below) - Math.round(above);
  };
  expect(
    gapOf(bands.pictureBottom, bands.nameTop, "name under the picture"),
    `the name is not 8px under the picture (${bandReading})`,
  ).toBe(8);
  expect(
    gapOf(bands.nameBottom, bands.cellInnerBottom, "name row's foot"),
    `the name row does not sit 10px above the cell's edge (${bandReading})`,
  ).toBe(10);
  expect(
    bands.factsBand,
    `a library theme with no catalogue or origin record drew a facts band (${bandReading})`,
  ).toBe(false);
  expect(
    bands.bylineInNameRow,
    `the updated day is not in the name's row (${bandReading})`,
  ).toBe(true);
  expect(
    Math.round(bands.cellInnerRight - 10 - (bands.bylineRight ?? Number.NaN)),
    `the updated day is not inset 10px from the card's right edge (${bandReading})`,
  ).toBe(0);
  expect(
    bands.bylineTop === null ||
      bands.bylineBottom === null ||
      bands.nameTop === null ||
      bands.nameBottom === null
      ? null
      : Math.abs(
          Math.round(
            (bands.bylineTop + bands.bylineBottom) / 2 -
              (bands.nameTop + bands.nameBottom) / 2,
          ),
        ),
    `the updated day is not centred on the name's line (${bandReading})`,
  ).toBeLessThanOrEqual(1);
  expect(
    Math.round(bands.cellInnerRight - 10 - (bands.actionsRight ?? Number.NaN)),
    `the controls are not inset 10px from the card's right edge (${bandReading})`,
  ).toBe(0);

  // **The author is a chip over the picture, hidden until the card is
  // attended.** Its words stay in the tree at rest, which is why the reading
  // asks for the computed opacity rather than the text. **The day and the four
  // controls share the name row the other way round**: the day is the resting
  // reading, and attending the card fades it out as the controls fade in.
  const authorChip = cellOf(fromCell.id).locator(
    "[data-yunari-store-cell-author]",
  );
  const byline = cellOf(fromCell.id).locator("[data-yunari-store-cell-byline]");
  const cellActions = cellOf(fromCell.id).locator(
    "[data-yunari-store-cell-actions]",
  );
  await expect(authorChip).toHaveText("© huyng");
  await expect(authorChip).toHaveCSS("opacity", "0");
  await expect(byline).toHaveCSS("opacity", "1");
  await expect(cellActions).toHaveCSS("opacity", "0");
  await cellOf(fromCell.id).hover();
  await expect(authorChip).toHaveCSS("opacity", "1");
  await expect(byline).toHaveCSS("opacity", "0");
  await expect(cellActions).toHaveCSS("opacity", "1");

  // **The cell's own surface opens the item's**, and the open control below is
  // read from the surface the same gesture reaches.
  await surfaceOf(fromCell.id).click();
  await expect(
    modal,
    "the cell's own surface opens no item's surface",
  ).toBeVisible();
  await expect(
    page.locator("[data-yunari-store-item-action='open']"),
    "the item's own surface does not print the short word the store gives the open action",
  ).toHaveText(uiCopy.store.item.actions.open);
  await page.locator("[data-yunari-store-item-close]").click();
  await expect(modal, "the item's own surface does not close").toBeHidden();
  expect(
    await documentName(),
    "closing the item's own surface opened a document",
  ).not.toBe(CELL_NAME);

  // From the cell's own action.
  await cellOf(fromCell.id)
    .locator("[data-yunari-store-cell-action='open']")
    .click();
  await expect(
    page.locator("#status"),
    "the cell's open action did not report the document it opened",
  ).toContainText(CELL_NAME);
  expect(
    await documentName(),
    "the cell's open action did not make that theme the document",
  ).toBe(CELL_NAME);
  expect(
    await publishedId(),
    "the opened document claims no stored base, so its next save is ungated",
  ).toBe(fromCell.id);

  // **The control's own promise is a surface, not an object** (A.7d). This
  // reading used to be the document's id alone, and a document mounted behind
  // the store's own mode satisfied it: the editor's body is `hidden` in every
  // other mode, so the theme was measured into a zero-sized host, its own fit
  // wrote nothing, and the camera stayed at 1:1 — which on a phone-sized
  // window puts most of the artboard off the canvas. *Open in editor* means
  // the editor is what the author is looking at, with the theme fitted into
  // it.
  await expect(
    page.locator(".editor-shell-body"),
    "Open in editor left the shell showing the store",
  ).toBeVisible();
  await expect(
    page.locator("[data-yunari-mode-region='library']"),
    "the store's own region is still the surface showing",
  ).toBeHidden();
  await settled(page);
  const opened = await boardOnCanvas(page);
  const openedReading = `store open on the desktop ${JSON.stringify(opened)}`;
  console.log(openedReading);
  testInfo.annotations.push({ type: "store-open", description: openedReading });
  expect(
    opened.fitted,
    `the opened theme is not fitted to the canvas: ${openedReading}`,
  ).toBe(true);
  expect(
    boardIsInside(opened),
    `the opened theme hangs off the canvas: ${openedReading}`,
  ).toBe(true);

  // And from the item's own footer, which draws the same four actions — on a
  // surface the open above has just left, so the store is asked for again.
  await page
    .locator(".editor-shell-mode-switch")
    .getByRole("button", { name: uiCopy.modes.library, exact: true })
    .click();
  await answerDialogIfShown(page, "Discard", 1_000);
  await expect(
    region,
    "the store does not come back after the open left the editor",
  ).toBeVisible();
  await surfaceOf(fromFooter.id).click();
  await expect(modal, "the second cell opens no item's surface").toBeVisible();
  await page.locator("[data-yunari-store-item-action='open']").click();
  await expect(
    page.locator("#status"),
    "the item's own open action did not report the document it opened",
  ).toContainText(FOOTER_NAME);
  expect(
    await documentName(),
    "the item's own open action did not make that theme the document",
  ).toBe(FOOTER_NAME);
  expect(
    await publishedId(),
    "the second opened document claims no stored base",
  ).toBe(fromFooter.id);
});

/**
 * **The same open, on the viewport where the defect is not cosmetic** (A.7d).
 *
 * The phone's editor canvas is 86px wide, so a 640x480 theme left at 1:1 has
 * most of its artboard off the canvas — and that camera is what six of the nine
 * cases this defect turned red convert their scene coordinates through before
 * they click or sample. This case asserts the reading they depend on, directly:
 * the shell is on the editor, and the whole artboard is inside the canvas.
 *
 * The library is `store-library.ts`'s stub, so this case and the nine it stands
 * for reach their document through one route rather than two.
 */
test("opening a library theme fits it to the phone's own canvas", async ({
  page,
}, testInfo) => {
  test.skip(
    isDesktopSurface(testInfo),
    "the phone's canvas is what this measures",
  );

  const written = writeThemePackage({
    // The validator requires the three role tokens, and this fixture is written
    // whole rather than derived from the starter.
    envelope: withRoleTokens({
      schemaVersion: "3.0.0",
      fabricVersion: "7.4.0",
      id: "store-open-phone",
      artboard: { width: 640, height: 480 },
      metadata: { name: "Phone theme", themeLanguage: "en" },
      scene: { version: "7.4.0", objects: [] },
    }),
    assets: {},
  });
  if (!written.ok) throw new Error(written.message);

  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
    "the editor did not mount",
  ).toBeVisible();

  await openThemeFromStore(page, storedThemeOfPackage(written.bytes));

  await expect(
    page.locator(".editor-shell-body"),
    "Open in editor left the shell showing the store",
  ).toBeVisible();
  await settled(page);
  const opened = await boardOnCanvas(page);
  const openedReading = `store open on the phone ${JSON.stringify(opened)}`;
  console.log(openedReading);
  testInfo.annotations.push({ type: "store-open", description: openedReading });
  expect(
    opened.fitted,
    `the opened theme is not fitted to the canvas: ${openedReading}`,
  ).toBe(true);
  expect(
    boardIsInside(opened),
    `the opened theme hangs off the canvas: ${openedReading}`,
  ).toBe(true);
});
