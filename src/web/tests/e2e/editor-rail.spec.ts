import { expect, type Locator, type Page, test } from "@playwright/test";
import { type FabricThemeEnvelope, facetRecordOf } from "@yunari/renderer-core";
import { readThemePackage, writeThemePackage } from "@yunari/theme-package";
import { DARK_GROUND } from "../../packages/editor/src/store-mode/item-fixture.js";
import type { ThemeOrigin } from "../../packages/editor/src/theme-library-client.js";
import { uiCopy } from "../../packages/editor/src/ui-copy.js";
import { chooseIn } from "./control-set.js";
import {
  answerDialogIfShown,
  captureVisualReview,
  chooseAssetFile,
} from "./editor-canvas.js";
import { openEveryGroup, openPane, paneBody } from "./editor-rail.js";
import { selectLayer } from "./rebuild-driver.js";
import { openThemeFromStore, storedThemeOfPackage } from "./store-library.js";
import { isDesktopSurface } from "./surface.js";

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

const EDITOR = "http://127.0.0.1:4174/";

/** DESIGN.md §7.2's rail accent bar, in px. A bare number rather than a `px`
 *  string so the one value is written once and the assertion's message spells
 *  it from here — §3's step table has no entry for it. */
const RAIL_ACCENT_BAR_PX = 2;

/** §7.1's header strip, in px, for the same reason: `--header-height` is a
 *  density rather than one of §3's steps, so the one value is written here and
 *  the mode-switch case spells its message from this. */
const HEADER_STRIP_PX = 42;

/**
 * **No case in this spec may reach the catalogue's public URL.**
 *
 * The store region starts its online read when it mounts
 * (`online-listing.ts`), and that is true of the Local half too, so every case
 * that opens the themes mode would otherwise ask `yunari-store.workers.dev`
 * for a catalogue that does not exist until phase E. The answer would be
 * whatever the network says that day, not what the case is measuring.
 *
 * The default is the honest state — "there is no catalogue here" — and a 404
 * keeps it distinguishable from an empty catalogue, which decision 0088 says
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
    .getByRole("button", { name: "Composition", exact: true })
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
  await openPane(page, "Document");
  await expect(page.locator("[data-yunari-artboard-width]")).toBeVisible();

  // Swapping the slot hides the whole host rather than unmounting it, and
  // coming back must not have left it behind — the pane is the slot's, not a
  // tab's.
  await openPane(page, "Add");
  await expect(page.locator("[data-yunari-artboard-width]")).toBeHidden();

  await openPane(page, "Document");
  await expect(page.locator("[data-yunari-artboard-width]")).toBeVisible();
});

/** §7.7's "Chrome stays still", and the ruling `vg-208` carries, on a real box.
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
    "the pane's column is still a scroller, so §7.7's rule is still on the wrong box",
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

  // The offset lives on the showing pane's **body** (§7.7, `vg-208`), so the
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
    .getByRole("button", { name: "Composition", exact: true })
    .click();
  await expect(list).toBeHidden();

  await openPane(page, "Add");
  await expect(page.locator("[data-yunari-asset-import]")).toBeVisible();
  await openPane(page, "Composition");
  await expect(page.locator('[data-yunari-panel="layers"]')).toBeVisible();

  await expect.poll(() => list.evaluate((node) => node.scrollTop)).toBe(offset);
});

/** §7.7's per-pane offsets, on every pane and not only the layer list.
 *
 *  The rule is one sentence — "preserve per-pane offsets and disclosure state
 *  across routine updates" — and `choosePane` implements it once, over a map
 *  keyed by the rail's slot. The case above pins it for the Composition pane;
 *  a proof of one pane is a proof of that pane's luck, so this walks all four
 *  and asserts each one comes back where it was left.
 *
 *  **A pane that cannot scroll proves nothing**, so each slot's offset is read
 *  back off the element after it is written: a pane whose body fits fails here
 *  with the slot named rather than passing on a `0` that survived a swap.
 *  Composition is opened to its full length first for the reason the case above
 *  gives — a collapsed starter does not overflow the panel. Add, Tokens and
 *  Document overflow at rest, and two of them are the surfaces the archived
 *  bullet named: the declared-asset library renders inside the Add pane's body,
 *  so Add is where the Assets pane that bullet named survives, and Document is
 *  the other. Their overflow heights are deliberately not stated — measured
 *  twice at this viewport they differed by tens of px, because they move with
 *  font loading — and the guard above is the load-bearing claim, not the sizes.
 *
 *  The offset lives on the showing pane's **body** (§7.7, `vg-208`), and a
 *  browser discards a `display: none` box's scroll position — the swap hides
 *  the pane it leaves — so what the read-back finds after the return is the
 *  shell's own restore and not the box remembering.
 */
test("each pane comes back to the offset it was left at", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();
  await openEveryGroup(page);

  const measured: Record<string, number> = {};
  for (const slot of ["Composition", "Add", "Tokens", "Document"]) {
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
    await openPane(page, slot === "Composition" ? "Add" : "Composition");
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

/** §7.7's desktop-density proof, for the one cluster the rail's column can
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
 *  The three configurations are §7.7's own. The third is a viewport rather than
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

    // And the cluster sits inside the stage at all: §7.5's 14px is the least a
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
  for (const slot of ["Composition", "Add", "Tokens", "Document"]) {
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
  for (const slot of ["Composition", "Add", "Tokens", "Document"]) {
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
 * what §7.7 requires — a refusal may not be ellipsized, so a long diagnostic
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
  // asserted — the fixture-read pattern `design-language.spec.ts` uses.
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
 * §7.6's left readouts, as the strip draws them, and the report beside them.
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
 * §7.3's count, in each pane's title bar, read where an author reads it.
 *
 * The row ruled it per pane, so this walks all four slots and reads each title
 * bar against **the list that pane draws** rather than against a number this
 * test remembers: the Add pane's count is the tiles under it, the Tokens pane's
 * is the token rows under it, and the Composition pane's is the scene's own
 * total, which is also what §7.6's strip prints — the duplication the row
 * accepted and named, asserted here as one string in two surfaces so a pane
 * that drifted to a different number fails.
 *
 * **The Document pane is the one with no count, and the absence is the
 * assertion.** Its body is two sections of fields and it holds no list of its
 * own, so a count there would be a number the product does not have. A dom case
 * can show the span is absent from the tree; only a rendered pane shows that it
 * is absent from the surface the author opens.
 */
test("every pane's title bar carries the count of its own list, and Document carries none", async ({
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

  // Add: the card library's own entry count, which is the tiles it draws —
  // not `insertGroups()`'s objects, which add primitives and a text object to
  // the library.
  await openPane(page, "Add");
  const cards = await page
    .locator('[data-yunari-panel="add"] [data-yunari-panel-card]')
    .count();
  expect(cards, "the booted library holds units").toBeGreaterThan(0);
  await expect(titleCount("add")).toHaveText(`${cards} units`);

  // Tokens: the theme's paints, which is the rows the pane draws.
  await openPane(page, "Tokens");
  const tokens = await page
    .locator('[data-yunari-panel="tokens"] [data-yunari-palette-token-row]')
    .count();
  expect(tokens, "the booted theme declares tokens").toBeGreaterThan(0);
  await expect(titleCount("tokens")).toHaveText(`${tokens} tokens`);

  // Document: no list, so no count.
  await openPane(page, "Document");
  await expect(page.locator('[data-yunari-panel="document"]')).toBeVisible();
  await expect(
    page.locator('[data-yunari-panel="document"] .editor-shell-pane-count'),
    "the Document pane holds no list, so its title bar prints no count",
  ).toHaveCount(0);
});

/**
 * The selected slot's accent bar is on the rail's **inner** edge (DESIGN.md §7.2),
 * and only a rendered box can show which edge that is.
 *
 * jsdom has no layout and no cascade, so a `*.dom.test.tsx` case cannot see a
 * rendered side — the bar lived at `left: -8px`, painting outside the rail's
 * outer edge (the window's left edge), with a comment eight lines above it
 * stating the rule it broke. The parity gate could not catch it either: the
 * mockup drew the same bar in the same wrong place, so the two agreed. This is
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
    // §5 rule 6's 1px transparent resting border, which is exactly that 1px.
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

  // §5's rail slot, which is the size the bar's offset is derived from: at 34px
  // the same `-6px` lands the bar's outer edge 1px short of the rail. Read here
  // rather than by a geometry case of its own, because the two numbers are one
  // decision — `vg-227` moved the slot and the bar together.
  expect(
    measured.slotRight - measured.slotLeft,
    "the slot is §5's 36px rail slot",
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
 * The keyboard route through the gear's modal: open with the keyboard, Tab and
 * Shift+Tab, Escape, and where focus ends.
 *
 * The brief demands the whole sequence and a browser is the only place it can
 * be observed. jsdom performs **no** sequential focus navigation — a Tab
 * keypress moves nothing — and Base UI's `FloatingFocusManager` deliberately
 * does not handle Tab when tabbable content exists; it relies on the browser
 * walking focus onto its focus-guard spans, whose `onFocus` redirects it to the
 * first or last tabbable. So the trap is a rendered fact with nothing to press
 * in jsdom, and this presses real keys: Tab from the last control wraps to the
 * first, Shift+Tab from the first wraps back, and Escape returns focus to the
 * gear it was opened from.
 */
test("Tab and Shift+Tab stay inside the settings modal, and Escape returns focus to the gear", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();

  // Open with the keyboard, not a click: the gear is reachable and Enter
  // activates it.
  const gear = page.locator(".editor-shell-rail-settings");
  await gear.focus();
  await expect(gear).toBeFocused();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: uiCopy.settings.title });
  await expect(dialog).toBeVisible();
  // The two ends of the popup's tab order: the selected tab leads, the labelled
  // close is last. The panels sit between them and are not named here.
  const first = dialog.getByRole("tab", { name: uiCopy.settings.appearance });
  const last = dialog.locator(".editor-shell-dialog-close");

  // Tab from the last control wraps forward to the first.
  await last.focus();
  await expect(last).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();

  // Shift+Tab from the first wraps back to the last.
  await page.keyboard.press("Shift+Tab");
  await expect(last).toBeFocused();

  // Escape is one press, one effect, and it hands focus back to the gear.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(gear).toBeFocused();

  // ── §7.7's constrained proof, in this same procedure ───────────────────────
  //
  // DESIGN.md asks for "the full shell at 1280×720 and 1440×900 CSS pixels,
  // then at 200% browser zoom", with every control reachable through scrolling
  // or compact composition. The two sizes are `design-language.spec.ts`'s loop;
  // what was never taken is the modal under the zoom.
  //
  // **200% zoom is modelled as the CSS-pixel viewport it produces** — 640×360,
  // which is what a browser zoom does: it halves the layout viewport in CSS
  // pixels, and `80vh` and every other length in §7's modal then resolve
  // against the halved box, exactly as they do at a real 200%. CSS `zoom` on the
  // root, which `design-language.spec.ts` uses for its own width assertions, is
  // *not* faithful here and measurably so: it scales a `vh`-capped fixed dialog
  // to twice its computed height while the window stays 720 device pixels, so
  // the modal runs off the screen at a size a real browser zoom never gives it.
  // What this still does not reproduce is the device scale factor, so text
  // rasterisation is not what it proves; the four claims below are all layout
  // and focus, which it does.
  await page.setViewportSize({ width: 640, height: 360 });

  await gear.click();
  await expect(dialog).toBeVisible();

  // (1) All three tabs are reachable, and each one mounts its panel.
  for (const name of [
    uiCopy.settings.appearance,
    uiCopy.settings.keyboard,
    uiCopy.settings.about,
  ]) {
    const tab = dialog.getByRole("tab", { name });
    await tab.scrollIntoViewIfNeeded();
    await tab.click();
    await expect(tab).toHaveAttribute("data-active", "");
  }

  // (2) The panel scrolls rather than clipping. Read on the Keyboard tab, which
  // holds the twenty-row table: this is the case §7.7's sentence is about, and
  // it is the tab left selected for (3).
  await dialog.getByRole("tab", { name: uiCopy.settings.keyboard }).click();
  const scroller = await dialog.evaluate((element) => ({
    overflowY: getComputedStyle(element).overflowY,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  expect(
    scroller.overflowY,
    `the modal is not the scroller at 200% zoom: ${JSON.stringify(scroller)}`,
  ).toBe("auto");
  expect(
    scroller.scrollHeight,
    `the Keyboard table is clipped rather than scrolled at 200% zoom: ${JSON.stringify(scroller)}`,
  ).toBeGreaterThan(scroller.clientHeight);

  // (3) The trap still holds at this size: Tab from the last control wraps to
  // the first tabbable, which is the selected tab.
  const close = dialog.locator(".editor-shell-dialog-close");
  await close.scrollIntoViewIfNeeded();
  await close.focus();
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("tab", { name: uiCopy.settings.keyboard }),
  ).toBeFocused();

  // (4) And Close is reachable — scrolled to, visible and operable — rather
  // than merely present at the end of an overflow.
  await expect(close).toBeVisible();
  await close.click();
  await expect(dialog).toBeHidden();
});

/**
 * §7.1's mode switch, as a rendered box and as the guard in front of it.
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
  await expect(segment(uiCopy.modes.themes)).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(segment(uiCopy.modes.thisPc)).toHaveAttribute(
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
    probe.remove();
    return {
      well: Math.round(node.getBoundingClientRect().height),
      header: Math.round(strip.getBoundingClientRect().height),
      chosenFill: paintOf(chosen),
      restFill: paintOf(rest),
      chosenInk: getComputedStyle(chosen).color,
      restInk: getComputedStyle(rest).color,
      accent,
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
  // The chosen treatment, measured rather than assumed: a lifted ground and
  // `--text` that differ from an unchosen segment's — and neither is the
  // region's accent, because §4 spends the header's one accent-filled control
  // on the publish button.
  expect(
    paint.chosenFill,
    `the chosen segment paints the same ground as an unchosen one (${report})`,
  ).not.toBe(paint.restFill);
  expect(
    paint.chosenInk,
    `the chosen segment paints the same ink as an unchosen one (${report})`,
  ).not.toBe(paint.restInk);
  expect(
    paint.chosenFill.includes(paint.accent),
    `the chosen segment is filled with the accent (${report})`,
  ).toBe(false);
  expect(
    paint.chosenInk,
    `the chosen segment is inked with the accent (${report})`,
  ).not.toBe(paint.accent);

  // ── The guard, on a document the product dirtied ──────────────────────────
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

  // The question, refused. The instrument is the editor's own replacement
  // prompt, so it is answered in the DOM rather than through `page.on("dialog")`.
  const prompt = page.getByRole("dialog");
  await segment(uiCopy.modes.themes).click();
  await expect(prompt, "leaving a dirty document asked nothing").toBeVisible();
  await expect(prompt).toHaveAttribute("aria-label", uiCopy.modes.unsaved);
  // Save is offered, which is the whole reason the instrument is the editor's
  // own prompt and not a browser dialog. It is not *pressed* here: a real save
  // downloads a package, and the dom case covers that path instead.
  await expect(
    prompt.getByRole("button", {
      name: uiCopy.replaceDocument.save,
      exact: true,
    }),
  ).toBeVisible();
  await prompt
    .getByRole("button", { name: uiCopy.replaceDocument.cancel, exact: true })
    .click();
  await expect(prompt).toHaveCount(0);
  await expect(
    segment(uiCopy.modes.editor),
    "the mode moved while the guard was refused",
  ).toHaveAttribute("aria-pressed", "true");

  // The question, discarded: the mode moves, and the editor's own header actions
  // do not follow it — §7.1's right-hand region is per-mode.
  await segment(uiCopy.modes.themes).click();
  await prompt
    .getByRole("button", { name: uiCopy.replaceDocument.discard, exact: true })
    .click();
  await expect(segment(uiCopy.modes.themes)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.locator(".editor-shell-body"),
    "the editor's body was unmounted rather than hidden",
  ).toBeHidden();
  await expect(
    page.locator("[data-yunari-mode-region]"),
    "the themes mode renders no region",
  ).toHaveAttribute("data-yunari-mode-region", "themes");
  await expect(group, "the switch left the header").toBeVisible();
  await expect(
    header.locator(".editor-shell-menubar"),
    "themes mode still draws the editor's menus",
  ).toHaveCount(0);

  await segment(uiCopy.modes.thisPc).click();
  await expect(
    page.locator("[data-yunari-mode-region]"),
    "the host mode renders no region",
  ).toHaveAttribute("data-yunari-mode-region", "this-pc");
  await expect(
    header.locator(".editor-shell-menubar"),
    "host mode still draws the editor's menus",
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
    header.locator(".editor-shell-menubar"),
    "the editor's menus did not come back",
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
 * The store mode's own header row, as a rendered row.
 *
 * §7.2 forbids a second bar under the header, so what the store draws is the
 * *region's* first row rather than a strip between the header and the content.
 * This case reads the row really drawn — both halves, the search well, five
 * facet buttons and the sort well, all inside the region — and reads the
 * editor's own body as hidden from the other side of A.1's invariant.
 *
 * **The narrow pass is the wrap.** jsdom lays nothing out, so the dom case can
 * only say that no facet is conditional; this says that a window too narrow for
 * the row takes a second line rather than losing a control — every facet is
 * still drawn, still inside the row's own box, and the row is taller than the
 * one line it draws at 1280. A row that stayed one line tall while a button fell
 * outside it would pass a drawn/not-drawn reading alone, which is why both are
 * read.
 *
 * **The asserted narrow width is 720, not the width that forces the facet row
 * itself to wrap.** That width is about 380px, which is not an arrangement this
 * shell is a desktop surface in; at 720 the row takes its second line and every
 * facet is still drawn inside it. The facet row's own wrap is read structurally
 * in `region.dom.test.tsx`, where the row's declaration is what is asserted,
 * and was measured once at 380 while this case was written: the fifth facet
 * moved to the next line and none was lost.
 */
test("the themes mode draws the store's own header row, and no width drops a facet", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();
  await page
    .locator(".editor-shell-mode-switch")
    .getByRole("button", { name: uiCopy.modes.themes, exact: true })
    .click();

  const region = page.locator("[data-yunari-mode-region='themes']");
  await expect(region, "the themes mode renders no region").toBeVisible();
  await expect(
    page.locator(".editor-shell-body"),
    "the editor's body was not hidden",
  ).toBeHidden();

  const header = region.locator("[data-yunari-store-header]");
  await expect(header, "the region draws no header row").toBeVisible();

  // The two halves, named and opening on Local — §5's Segmented, which is what
  // the region's own header row carries rather than a second mode switch.
  const halves = header.locator("[data-yunari-store-halves] button");
  await expect(halves).toHaveCount(2);
  await expect(halves.nth(0)).toHaveText(uiCopy.store.halves.local);
  await expect(halves.nth(1)).toHaveText(uiCopy.store.halves.online);
  await expect(halves.nth(0)).toHaveAttribute("aria-pressed", "true");

  await expect(
    header.locator("[data-yunari-store-search]"),
    "the region draws no search well",
  ).toBeVisible();
  const facets = header.locator("[data-yunari-facet]");
  await expect(facets, "the region does not draw the five facets").toHaveCount(
    5,
  );
  await expect(
    header.locator("[data-yunari-store-sort]"),
    "the region draws no sort well",
  ).toBeVisible();

  // Nothing sits above the region's own first row: the header row is the
  // region element's first child, which is what makes it the region's row
  // rather than a bar the switch was moved into.
  expect(
    await header.evaluate(
      (node) => node === node.parentElement?.firstElementChild,
    ),
    "something sits above the region's own header row",
  ).toBe(true);

  // ── The narrow pass ───────────────────────────────────────────────────────
  /** The row and the five facets, as rendered boxes. */
  const measure = async (): Promise<{
    readonly row: { left: number; right: number; height: number };
    readonly boxes: readonly {
      left: number;
      right: number;
      width: number;
      height: number;
    }[];
  }> => ({
    row: await header.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        height: Math.round(rect.height),
      };
    }),
    boxes: await facets.evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      }),
    ),
  });

  const wide = await measure();
  await page.setViewportSize({ width: 720, height: 720 });
  const narrow = await measure();
  const report = JSON.stringify({ wide, narrow });
  console.log(`store-facets ${report}`);
  testInfo.annotations.push({ type: "store-facets", description: report });

  expect(
    narrow.boxes.every((box) => box.width > 0 && box.height > 0),
    `a facet is not drawn at a narrow width (${report})`,
  ).toBe(true);
  expect(
    narrow.boxes.every(
      (box) =>
        box.left >= narrow.row.left - 1 && box.right <= narrow.row.right + 1,
    ),
    `a facet falls outside the row at a narrow width (${report})`,
  ).toBe(true);
  expect(
    narrow.row.height,
    `the row did not wrap, so a control is out of reach (${report})`,
  ).toBeGreaterThan(wide.row.height);
  expect(
    narrow.row.right,
    `the row overflows the window it is drawn in (${report})`,
  ).toBeLessThanOrEqual(720);
});

/**
 * A stubbed library of thirty themes, as the host would answer `/api/themes`.
 *
 * **Thirty is what makes the pager real**: twelve to a page is three of them, so
 * this case can move to a page that is neither the first nor the last. One of
 * them is portrait and on page one, so a landscape item can be held against it
 * in the same surface, and a second portrait item sits on the last page.
 *
 * The record is `facetRecordOf`'s own derivation of an envelope rather than a
 * hand-written one, which is the trap A.4a's review found: a descriptor written
 * by hand answers something the host never would.
 */
const STORE_LIBRARY = Array.from({ length: 30 }, (_unused, at) => {
  const index = at + 1;
  const label = String(index).padStart(2, "0");
  const name = `Store theme ${label}`;
  const portrait = index === 2 || index === 25;
  // **Two authors, so the Author facet has two rows to space** (A.6's fix round
  // 2, G1). A facet whose values are alternatives draws them as one ungrouped
  // run, and a run of one row cannot show whether its rows are spaced at all.
  const author = index % 3 === 0 ? "mei" : "huyng";
  const envelope: FabricThemeEnvelope = {
    schemaVersion: 2,
    fabricVersion: "7.4.0",
    id: `store-${label}`,
    artboard: {
      width: portrait ? 1080 : 1920,
      height: portrait ? 1920 : 1080,
    },
    background: { color: { value: DARK_GROUND } },
    metadata: { name, themeLanguage: "en", author },
    scene: { version: "7.4.0", objects: [] },
  };
  return {
    id: envelope.id,
    name,
    author,
    version: "1.4.0",
    updatedAt: "2026-10-14T00:00:00.000Z",
    ground: DARK_GROUND,
    facets: facetRecordOf(envelope),
  };
});

/** The item's own surface, reached from the portalled popup rather than the
 *  region: Base UI portals it to `body`. */
const STORE_ITEM_STAGE = "[data-yunari-store-item-stage]";
const STORE_ITEM_PICTURE = "[data-yunari-store-item-picture]";

/**
 * The store's body, as a rendered surface: the gallery, the pager and an item's
 * own surface, against a stubbed library.
 *
 * **Nothing mounted any of these before A.6** — the region's body was empty — so
 * what this case proves is the wiring rather than any one part: a listing the
 * host answers reaches cells, a cell opens the item's own surface, and closing
 * it comes back to the page, filter and sort it was opened from.
 *
 * **The stage's one height is measured here because jsdom cannot measure it.**
 * The dom case reads the declarations that make it true; this reads the two
 * boxes, one landscape and one portrait, and the theme's own ratio inside them.
 *
 * **The pager bar's reading is here** because it is a measurement and not a
 * claim: `pager.tsx` says where the `Per page` label falls, and only a browser
 * can say whether the bar reads as a labelled row or as a break.
 */
test("the store lists a library, opens an item, and comes back to the same page", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  // **A stub, not the real host.** The editor preview serves no `/api/themes` at
  // all, and the local half lists through that route (`theme-library-client.ts`);
  // `editor.spec.ts` stubs the same one for the library chooser.
  await page.route("**/api/themes", (route) =>
    route.fulfill({ json: { themes: STORE_LIBRARY } }),
  );
  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();
  // A page size another case left behind would make this case read that case's
  // pages rather than the shell's own default.
  await page.evaluate(() =>
    window.localStorage.removeItem("yunari.editor.store-page-size"),
  );
  await page
    .locator(".editor-shell-mode-switch")
    .getByRole("button", { name: uiCopy.modes.themes, exact: true })
    .click();

  const region = page.locator("[data-yunari-mode-region='themes']");
  await expect(region, "the themes mode renders no region").toBeVisible();

  const cells = region.locator("[data-yunari-store-cell]");
  const pager = region.locator("[data-yunari-store-pager]");
  const search = region.locator("[data-yunari-store-search]");
  /** The page in force, read off the numeral the pager marks as current. */
  const currentPage = async (): Promise<string | null> =>
    region
      .locator("[data-yunari-store-page][aria-current='page']")
      .getAttribute("data-yunari-store-page");

  // **The gallery, which nothing mounted before A.6**: one page of a thirty-item
  // library, and the pager says which page.
  await expect(
    cells,
    "the region does not list the library's first page",
  ).toHaveCount(12);
  await expect(pager, "the store draws no pager").toBeVisible();
  expect(await currentPage(), "the pager does not open on page one").toBe("1");

  /**
   * The stage's height, the modal box and the caption's stamp for one item,
   * opened from its cell and closed again — so every reading is taken the same
   * way and the surface is not left open for the next one.
   *
   * **The boxes are measured because the numbers are design language now**:
   * `DESIGN.md` fixes the modal at 960 and its stage at 420, and a case that
   * asserted only that two stages were equal would pass a 100px stage.
   */
  const drawn = async (
    id: string,
  ): Promise<{
    readonly stage: number;
    readonly box: number;
    readonly stamp: string;
    readonly picture: { readonly width: number; readonly height: number };
  }> => {
    // **The cell's own surface, not its `open` action**: the action names the
    // library operation its label prints and loads a document, and the cell is
    // what opens the item's own surface (A.7b).
    await region
      .locator(`[data-yunari-store-cell='${id}']`)
      .locator("[data-yunari-store-cell-surface]")
      .click();
    const stage = page.locator(STORE_ITEM_STAGE);
    await expect(stage, "a cell opens no item surface").toBeVisible();
    const box = await stage.boundingBox();
    const modal = await page.locator("[data-yunari-store-item]").boundingBox();
    const picture = await page.locator(STORE_ITEM_PICTURE).boundingBox();
    const stamp =
      (await page.locator("[data-yunari-store-item-date]").textContent()) ?? "";
    await page.locator("[data-yunari-store-item-close]").click();
    await expect(stage, "the item's surface does not close").toBeHidden();
    if (box === null || picture === null || modal === null) {
      throw new Error(`the item's surface drew no box for ${id}`);
    }
    return {
      stage: box.height,
      box: modal.width,
      stamp: stamp.trim(),
      picture: { width: picture.width, height: picture.height },
    };
  };

  // **The stage is one height for two different shapes**, and the theme is drawn
  // at its own ratio inside that height: a viewer must not have the box move as
  // a person steps between items, and a portrait board must still be seen
  // uncropped.
  const landscape = await drawn("store-01");
  const portrait = await drawn("store-02");
  const itemReading = `store-item box ${landscape.box}px stage landscape ${landscape.stage} portrait ${portrait.stage}; picture ${landscape.picture.width}x${landscape.picture.height} and ${portrait.picture.width}x${portrait.picture.height}; stamp "${landscape.stamp}"`;
  console.log(itemReading);
  testInfo.annotations.push({ type: "store-item", description: itemReading });
  expect(
    portrait.stage,
    `the stage follows the item instead of holding one height (${itemReading})`,
  ).toBe(landscape.stage);
  expect(
    landscape.stage,
    `the stage is not the 420px DESIGN.md fixes (${itemReading})`,
  ).toBe(420);
  expect(
    landscape.box,
    `the modal is not the 960px DESIGN.md fixes (${itemReading})`,
  ).toBe(960);
  expect(
    landscape.stamp,
    `the caption does not pair the version with the date (${itemReading})`,
  ).toBe(`1.4.0${uiCopy.store.readingSeparator}2026-10-14`);
  expect(
    Math.abs(landscape.picture.width / landscape.picture.height - 16 / 9),
    `the landscape theme is not drawn at its own ratio (${itemReading})`,
  ).toBeLessThan(0.02);
  expect(
    Math.abs(portrait.picture.width / portrait.picture.height - 9 / 16),
    `the portrait theme is not drawn at its own ratio (${itemReading})`,
  ).toBeLessThan(0.02);
  expect(
    portrait.picture.height,
    `the picture is not contained in the stage's height (${itemReading})`,
  ).toBeLessThan(portrait.stage);

  // **A page that is neither the first nor the last**, and an item opened from
  // it: closing the surface comes back to the page it was opened from.
  await region.locator("[data-yunari-store-page='3']").click();
  await expect(
    cells,
    "the last page is not the six items left over",
  ).toHaveCount(6);
  await drawn("store-25");
  expect(
    await currentPage(),
    "closing an item moved the page it was opened from",
  ).toBe("3");

  // **A changed filter returns to page one** (R123): a narrower result would
  // otherwise leave the viewer on a page that no longer exists.
  await search.fill("Store theme 2");
  await expect(cells, "the search does not narrow the listing").toHaveCount(10);
  expect(
    await currentPage(),
    "a changed filter left the viewer on the page it was on",
  ).toBe("1");

  // **The filter's empty state is its own sentence**, not the first-run one: a
  // person with thirty themes is told that their filter matched nothing.
  await search.fill("no theme is called this");
  await expect(cells, "an empty result still draws cells").toHaveCount(0);
  await expect(
    region.locator("[data-yunari-store-empty]"),
    "an empty result says nothing at all",
  ).toHaveText(uiCopy.store.empty.filter);
  await search.fill("");
  await expect(
    cells,
    "clearing the search does not restore the listing",
  ).toHaveCount(12);

  // **The pager bar's own reading**, which is the item A.5 carried.
  const bar = await pager.evaluate((node) => {
    const label = node.querySelector("label")?.getBoundingClientRect();
    const well = node
      .querySelector("[data-yunari-store-page-size]")
      ?.getBoundingClientRect();
    const row = node
      .querySelector("[data-yunari-store-page-row]")
      ?.getBoundingClientRect();
    return {
      barHeight: node.getBoundingClientRect().height,
      rowWidth: row?.width ?? null,
      label:
        label === undefined
          ? null
          : {
              top: label.top,
              bottom: label.bottom,
              left: label.left,
              width: label.width,
            },
      well:
        well === undefined
          ? null
          : {
              top: well.top,
              bottom: well.bottom,
              left: well.left,
              width: well.width,
            },
    };
  });
  const barReading = `store-pager bar ${bar.barHeight}px row ${bar.rowWidth}px label ${JSON.stringify(bar.label)} well ${JSON.stringify(bar.well)}`;
  console.log(barReading);
  testInfo.annotations.push({ type: "store-pager", description: barReading });
  if (bar.label === null || bar.well === null) {
    throw new Error(`the pager draws no labelled size well (${barReading})`);
  }
  expect(
    bar.rowWidth,
    `the per-page row is not the 158px its label and well need (${barReading})`,
  ).toBe(158);
  // **The label and the well are one line**, which is what the drawing draws and
  // what the row's own width buys: a row given only the well's 76px wraps the
  // well to a second line, and the bar grows from the drawing's 43px to 61. The
  // two boxes are read against each other rather than against a `top`, because
  // one line means the label's own middle falls inside the well's box — the well
  // is 27px tall and the label 14, so their tops differ by 6 with nothing wrong.
  const labelMiddle = (bar.label.top + bar.label.bottom) / 2;
  expect(
    labelMiddle,
    `the Per page label is not on the well's own line (${barReading})`,
  ).toBeGreaterThan(bar.well.top);
  expect(
    labelMiddle,
    `the Per page label is not on the well's own line (${barReading})`,
  ).toBeLessThan(bar.well.bottom);
  expect(
    bar.well.left,
    `the well overlaps the label it belongs to (${barReading})`,
  ).toBeGreaterThanOrEqual(bar.label.left + bar.label.width);

  // **An ungrouped popover's rows are spaced, which no class assertion can
  // show** (A.6's fix round 2, G1): F5 gave the grouped branch the gap and left
  // the flat one without, so Author, Colour mode and Style drew flush. The two
  // rows are read as boxes because the regression was a zero between them, and
  // the gap is asserted non-zero rather than equal to a number so a token
  // change is not this case's business.
  await region.locator("[data-yunari-facet='author']").click();
  const authorPopup = page.locator(
    `[aria-label='${uiCopy.store.facets.author}']`,
  );
  await expect(authorPopup, "the Author facet opens no popover").toBeVisible();
  const rows = await authorPopup
    .locator("[data-yunari-facet-option]")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return {
          top: box.top,
          bottom: box.bottom,
          left: box.left,
          right: box.right,
        };
      }),
    );
  const gapReading = `store-facet-rows ${JSON.stringify(rows)}`;
  console.log(gapReading);
  testInfo.annotations.push({
    type: "store-facet-rows",
    description: gapReading,
  });
  expect(
    rows.length,
    `the Author facet offers fewer than two rows (${gapReading})`,
  ).toBeGreaterThan(1);
  const first = rows[0];
  const second = rows[1];
  if (first === undefined || second === undefined) {
    throw new Error(`the Author facet drew no second row (${gapReading})`);
  }
  expect(
    second.left,
    `the two Author rows are not stacked (${gapReading})`,
  ).toBe(first.left);
  expect(
    second.top - first.bottom,
    `an ungrouped facet's rows are drawn flush (${gapReading})`,
  ).toBeGreaterThan(0);
  await page.keyboard.press("Escape");

  // **The Shape popover's groups, as a rendered popover** (R115). The three
  // headings are the drawing's, the sentence above them is the one that says why
  // they matter, and the values are the items' own readings — none of which a
  // flat list would show.
  await region.locator("[data-yunari-facet='shape']").click();
  const popup = page.locator(`[aria-label='${uiCopy.store.facets.shape}']`);
  await expect(popup, "the Shape facet opens no popover").toBeVisible();
  const groups = await popup.evaluate((node) => ({
    hint: node.querySelector("[data-yunari-facet-hint]")?.textContent?.trim(),
    headings: Array.from(
      node.querySelectorAll("[data-yunari-facet-group]"),
    ).map((group) => group.getAttribute("data-yunari-facet-group")),
    values: Array.from(
      node.querySelectorAll("[data-yunari-facet-option-name]"),
    ).map((value) => value.textContent?.trim()),
  }));
  const groupReading = `store-facets hint "${groups.hint}" headings ${JSON.stringify(groups.headings)} values ${JSON.stringify(groups.values)}`;
  console.log(groupReading);
  testInfo.annotations.push({
    type: "store-facets",
    description: groupReading,
  });
  expect(
    groups.hint,
    `the Shape popover does not carry the drawing's sentence (${groupReading})`,
  ).toBe(uiCopy.store.facets.shapeHint);
  const headings = uiCopy.store.facets.shapeGroups;
  expect(
    groups.headings,
    `the Shape popover does not draw the drawing's three labelled groups (${groupReading})`,
  ).toEqual([headings.orientation, headings.aspect, headings.size]);
  expect(
    groups.values,
    `the Shape values are not the items' own readings (${groupReading})`,
  ).toEqual([
    // Both orientations, because two of the thirty themes are portrait: an
    // option is offered for what the listing holds and not for what a drawing
    // imagines.
    uiCopy.store.orientations.landscape,
    uiCopy.store.orientations.portrait,
    "16:9",
    // Two sizes, because each is declared by more than one theme — the rule that
    // keeps a size exactly one theme declares out of the facet.
    uiCopy.store.size(1920, 1080),
    uiCopy.store.size(1080, 1920),
  ]);
});

/**
 * The provenance and style work, read on the surfaces it lands on.
 *
 * **Every half of it was proved in jsdom, and jsdom lays nothing out.** What a
 * browser adds is the *drawn* reading — a computed edge, a grid that really
 * narrowed, a badge really inside the facts band — and two joins no unit case
 * can see:
 *
 * 1. **The badge's word is asserted as a literal, and that is the point.** The
 *    badge and the modal's provenance line are plain spans, and the copy walk
 *    reads labels, buttons, headings and paragraphs, so **this case is the only
 *    check of that word in the repo** (`vg-685`). Asserting it from
 *    `uiCopy.store.fromStore` would make the case green through the rename it
 *    exists to catch, which is how *Installed* shipped here twice: the drawing
 *    badges every local cell *From the store* (`store-themes.html`) and
 *    *Installed* is the **online** half's own footer verb (`store-detail.html`).
 * 2. **The region's vocabulary reaches the modal.** `settledTags` is built by
 *    the region and handed to `ItemModal`; replacing that prop with `[]` leaves
 *    every jsdom case green, because each hands the modal its own set. The pill
 *    read here is settled by *another theme's* use rather than by the shipped
 *    seed, so the listing half of the vocabulary is what the case turns on.
 *
 * **The library is its own fixture, and `STORE_LIBRARY` is untouched.**
 * Thirty is load-bearing for the pager case's three pages, so these four are a
 * second fixture: envelopes through `facetRecordOf`, which is the host's own
 * derivation rather than a hand-written record — the trap A.4a's review found.
 */
function boundaryEnvelope(input: {
  readonly id: string;
  readonly name: string;
  readonly tags: readonly string[];
  readonly width: number;
  readonly height: number;
}): FabricThemeEnvelope {
  return {
    schemaVersion: 2,
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
 *  (`settings/theme-origins.ts`). */
const BOUNDARY_ORIGIN: ThemeOrigin = {
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
    readonly origin: ThemeOrigin | undefined;
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

test("the store draws the origin badge, narrows by style and shape, and marks a proposed tag", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await page.route("**/api/themes", (route) =>
    route.fulfill({ json: { themes: BOUNDARY_LIBRARY } }),
  );
  await page.goto(EDITOR);
  await expect(
    page.locator("#yunari-fabric-editor canvas.upper-canvas"),
  ).toBeVisible();
  // A page size another case left behind would page this listing differently.
  await page.evaluate(() =>
    window.localStorage.removeItem("yunari.editor.store-page-size"),
  );
  await page
    .locator(".editor-shell-mode-switch")
    .getByRole("button", { name: uiCopy.modes.themes, exact: true })
    .click();

  const region = page.locator("[data-yunari-mode-region='themes']");
  await expect(region, "the themes mode renders no region").toBeVisible();

  const cells = region.locator("[data-yunari-store-cell]");
  await expect(
    cells,
    "the store does not list the whole boundary library",
  ).toHaveCount(4);

  const cellOf = (id: string) =>
    region.locator(`[data-yunari-store-cell='${id}']`);
  const badgeOf = (id: string) =>
    cellOf(id).locator("[data-yunari-store-cell-origin]");
  /** A reading worth keeping in the run's output, as the other store cases do. */
  const record = (type: string, reading: string): void => {
    console.log(`${type} ${reading}`);
    testInfo.annotations.push({ type, description: reading });
  };

  // ── The origin badge, and its absence ──────────────────────────────────────
  // **The literal, not `uiCopy.store.fromStore`** — see this case's own header:
  // the whole value of the assertion is that a renamed word fails it.
  const badgeWord = "From the store";
  await expect(
    badgeOf("boundary-origin"),
    "a theme the host holds an origin record for draws no badge",
  ).toHaveText(badgeWord);
  record("store-origin-badge", `badge "${badgeWord}"`);

  // **What the badge sits in is the claim** (`gallery.tsx`): the drawing puts it
  // in the facts band rather than beside the name, so a badge that moved would
  // change the grid while a bare existence check stayed green.
  expect(
    await badgeOf("boundary-origin").evaluate(
      (node) =>
        node.parentElement?.hasAttribute("data-yunari-store-cell-band") ===
        true,
    ),
    "the origin badge is not drawn in the cell's own facts band",
  ).toBe(true);

  // **A theme the host holds no record of came from nowhere.** Drawing the
  // badge for it is a fact no record carries, which is what this reading is for.
  await expect(
    badgeOf("boundary-plain"),
    "a theme with no origin record draws an origin badge",
  ).toHaveCount(0);

  // ── The item's Style group, with a proposed tag ────────────────────────────
  // Opened from the region's own cell, which is what joins the two halves: the
  // vocabulary this pill is read against is the region's, not the modal's.
  await cellOf("boundary-proposed")
    .locator("[data-yunari-store-cell-surface]")
    .click();
  const modal = page.locator("[data-yunari-store-item]");
  await expect(modal, "a cell opens no item's surface").toBeVisible();

  const styleGroup = modal.locator("[data-yunari-store-item-group='style']");
  await expect(
    styleGroup,
    "the item's own surface draws no Style group",
  ).toBeVisible();
  await expect(
    styleGroup.locator("[data-yunari-store-item-group-name]"),
    "the Style group sits under no eyebrow",
  ).toHaveText(uiCopy.store.pillGroups.style);

  const pillOf = (tag: string) =>
    styleGroup.locator(`[data-yunari-store-item-pill='${tag}']`);
  // The drawing's own words for a word the vocabulary does not hold yet, as a
  // literal for the reason the badge's word is one (`store-detail.html`).
  await expect(
    pillOf("warm-lantern"),
    "the tag no other theme and no seed holds is not marked as proposed",
  ).toHaveText("warm-lantern · proposed");
  await expect(
    pillOf("dusk-cafe"),
    "a tag the listing's other themes settle is drawn with a proposed mark",
  ).toHaveText("dusk-cafe");

  // **The mark is a computed edge, not a class name.** The jsdom case reads the
  // class string; only the browser says the box really draws dashed — and the
  // two pills are read against each other, so a palette change that made them
  // the same ink is caught without this case owning a colour.
  const pills = await styleGroup.evaluate((group) => {
    const read = (tag: string) => {
      const node = group.querySelector(
        `[data-yunari-store-item-pill='${tag}']`,
      );
      if (node === null) return null;
      const style = getComputedStyle(node);
      return {
        edge: style.borderTopStyle,
        width: style.borderTopWidth,
        ink: style.color,
      };
    };
    return { settled: read("dusk-cafe"), proposed: read("warm-lantern") };
  });
  const pillReading = `store-item pills ${JSON.stringify(pills)}`;
  record("store-item-pills", pillReading);
  if (pills.settled === null || pills.proposed === null) {
    throw new Error(`the Style group drew no pill (${pillReading})`);
  }
  expect(
    pills.proposed.edge,
    `the proposed pill is not drawn on the drawing's dashed edge (${pillReading})`,
  ).toBe("dashed");
  expect(
    pills.settled.edge,
    `the settled pill is drawn on a dashed edge (${pillReading})`,
  ).toBe("solid");
  expect(
    pills.proposed.ink,
    `a proposed pill and a settled one are the same ink (${pillReading})`,
  ).not.toBe(pills.settled.ink);

  await page.locator("[data-yunari-store-item-close]").click();
  await expect(modal, "the item's surface does not close").toBeHidden();

  // ── The Style facet narrows the grid ───────────────────────────────────────
  const styleFacet = region.locator("[data-yunari-facet='style']");
  await expect(styleFacet, "the region draws no Style facet").toBeVisible();
  await styleFacet.click();
  const stylePopup = page.locator(
    `[aria-label='${uiCopy.store.facets.style}']`,
  );
  await expect(stylePopup, "the Style facet opens no popover").toBeVisible();

  // **The facet's values are the tags the listing carries, however few themes
  // hold one** — the opposite of the size facet's rule, and the reason
  // `warm-lantern` is here at all: a tag one theme declares is still a value,
  // where a size one theme declares is not.
  const styleOptions = stylePopup.locator("[data-yunari-facet-option-name]");
  await expect(
    styleOptions,
    "the Style facet does not offer the listing's own tags",
  ).toHaveText(["dusk-cafe", "futuristic", "warm-lantern"]);

  await stylePopup.locator("[data-yunari-facet-option='warm-lantern']").click();
  const narrowed = await cells.count();
  await expect(
    cells,
    `choosing a style tag does not narrow the grid (${narrowed} cells)`,
  ).toHaveCount(1);
  await expect(
    cells.first(),
    "the style filter kept a theme that does not carry the tag",
  ).toHaveAttribute("data-yunari-store-cell", "boundary-proposed");
  record("store-style-filter", `warm-lantern kept ${narrowed} of 4 cells`);
  await page.keyboard.press("Escape");

  // Back to the whole library, so the shape facet below is read on its own.
  await styleFacet.click();
  await expect(stylePopup, "the Style facet reopens no popover").toBeVisible();
  await stylePopup.locator("[data-yunari-facet-option='warm-lantern']").click();
  await expect(
    cells,
    "unchoosing a style tag does not restore the listing",
  ).toHaveCount(4);
  await page.keyboard.press("Escape");

  // ── The Shape popover offers the 19.5:9 bucket ─────────────────────────────
  // Task 1 proved the bucket at record and matcher level; this is the rendered
  // half — a 2340×1080 artboard, the bucket offered by the popover, and the
  // grid narrowing to the one theme that is that shape.
  await region.locator("[data-yunari-facet='shape']").click();
  const shapePopup = page.locator(
    `[aria-label='${uiCopy.store.facets.shape}']`,
  );
  await expect(shapePopup, "the Shape facet opens no popover").toBeVisible();
  const shapeValues = shapePopup.locator("[data-yunari-facet-option-name]");
  await expect(
    shapeValues,
    "the Shape popover does not offer the 19.5:9 bucket the library holds",
  ).toHaveText([
    uiCopy.store.orientations.landscape,
    "16:9",
    "19.5:9",
    // The size facet's own rule beside it: 1920×1080 is declared by three
    // themes and is offered, and the 2340×1080 only one theme declares is not.
    uiCopy.store.size(1920, 1080),
  ]);

  await shapePopup.locator("[data-yunari-facet-option='19.5:9']").click();
  const shaped = await cells.count();
  await expect(
    cells,
    `choosing the 19.5:9 bucket does not narrow the grid (${shaped} cells)`,
  ).toHaveCount(1);
  await expect(
    cells.first(),
    "the shape filter kept a theme that is not that shape",
  ).toHaveAttribute("data-yunari-store-cell", "boundary-wide");
  record("store-shape-filter", `19.5:9 kept ${shaped} of 4 cells`);
  await page.keyboard.press("Escape");
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
  await page.route("**/api/themes/install", (route) => {
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
 * The store, on its online half: the catalogue and the library both routed, the
 * region mounted and its Store segment chosen, and the readable entries listed.
 */
async function showOnlineStore(
  page: Page,
  catalogue: {
    readonly generatedAt: string;
    readonly entries: readonly Record<string, unknown>[];
  } = ONLINE_CATALOGUE,
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
  // The pictures come from a CDN this case claims nothing about, and the real
  // catalogue always holds one: a 1×1 PNG stands in, so no cell and no stage
  // draws the browser's broken-image mark, which would read as a defect in the
  // surface rather than as a fixture that left the network alone. The pixel is
  // the panel ground, so the stand-in reads as an empty picture box.
  await page.route(
    (url) => url.hostname === "cdn.jsdelivr.net",
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
  // A page size another case left behind would page this listing differently.
  await page.evaluate(() =>
    window.localStorage.removeItem("yunari.editor.store-page-size"),
  );
  await page
    .locator(".editor-shell-mode-switch")
    .getByRole("button", { name: uiCopy.modes.themes, exact: true })
    .click();

  const region = page.locator("[data-yunari-mode-region='themes']");
  await expect(region, "the themes mode renders no region").toBeVisible();
  const halves = region.locator("[data-yunari-store-halves] button");
  await expect(halves, "the region draws no halves").toHaveCount(2);
  await halves.nth(1).click();
  await expect(
    halves.nth(1),
    "the Store half is not the one chosen",
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    region.locator("[data-yunari-store-cell]"),
    "the online half does not list the catalogue's readable items",
  ).toHaveCount(3);
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
  // **The literal, not `uiCopy.store.cell.kinds`**: the badge's whole value is
  // that a renamed word fails here, the rule the origin badge's case states for
  // its own word.
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

test("the Style facet narrows the online grid, and the tag one item holds is still offered", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  const region = await showOnlineStore(page);
  const styleFacet = region.locator("[data-yunari-facet='style']");
  await styleFacet.click();
  const popup = page.locator(`[aria-label='${uiCopy.store.facets.style}']`);
  await expect(popup, "the Style facet opens no popover").toBeVisible();
  // `ambient` is declared by exactly one item, and is a value all the same: a
  // tag is what a facet exists to find, where a size one item declares is not.
  // The values are most-carried first, then by name, so `dashboard` heads the
  // row and the single-holder tag sits among the rest.
  await expect(
    popup.locator("[data-yunari-facet-option-name]"),
    "the Style facet does not offer every tag the listing carries",
  ).toHaveText(["dashboard", "ambient", "minimal"]);

  await popup.locator("[data-yunari-facet-option='ambient']").click();
  const cells = region.locator("[data-yunari-store-cell]");
  await expect(
    cells,
    "choosing a tag does not narrow the online grid",
  ).toHaveCount(1);
  await expect(
    cells.first(),
    "the tag filter kept a theme that does not hold it",
  ).toHaveAttribute("data-yunari-store-cell", "cat-skyline");

  // The popover stays open for the frame, so the image reads both halves of the
  // claim: the tags offered, and the grid they narrowed.
  await captureVisualReview(page, testInfo, "store-online-facet", region);
  await page.keyboard.press("Escape");
});

test("the online half draws Installed, Update and Install for the library's three cases", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  const region = await showOnlineStore(page);
  const actionOf = (id: string, state: string): Locator =>
    region.locator(
      `[data-yunari-store-cell='${id}'] [data-yunari-store-cell-install='${state}']`,
    );

  // Held at the catalogue's own version: a mark, because there is nothing to do.
  const installed = actionOf("cat-skyline", "installed");
  await expect(
    installed,
    "an item held at the same version is not marked Installed",
  ).toBeVisible();
  await expect(
    installed,
    "the Installed mark does not read Installed",
  ).toHaveText("Installed");
  expect(
    await installed.evaluate((node) => node.tagName),
    "Installed is drawn as a control rather than a mark",
  ).toBe("SPAN");

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

test("pressing Install on an online cell draws the item as Installed once the host answers ok", async ({
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
  await install.click();

  // **The re-list is the evidence**: the host answered `ok`, the surface read
  // the library back, and the join drew what the host wrote. A word set on the
  // press would still read Installed if the re-list never happened.
  const installed = cell.locator(
    "[data-yunari-store-cell-install='installed']",
  );
  await expect(
    installed,
    "the cell the host installed is not drawn as Installed",
  ).toBeVisible();
  await expect(
    installed,
    "the installed cell does not read Installed",
  ).toHaveText("Installed");
  expect(
    await installed.evaluate((node) => node.tagName),
    "Installed is drawn as a control rather than a mark",
  ).toBe("SPAN");

  await captureVisualReview(
    page,
    testInfo,
    "store-online-install-installed",
    region,
  );
});

test("an item the library holds at an older version reads Update before the press and Installed after", async ({
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
  await update.click();

  const installed = cell.locator(
    "[data-yunari-store-cell-install='installed']",
  );
  await expect(
    installed,
    "the updated item is not drawn as Installed",
  ).toBeVisible();
  await expect(
    installed,
    "the updated cell does not read Installed",
  ).toHaveText("Installed");

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

test("the line for a skipped kind names the identifier the catalogue declared", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  const region = await showOnlineStore(page);
  const line = region.locator("[data-yunari-store-refusal]");
  await expect(
    line,
    "what the catalogue read left out is not named",
  ).toHaveCount(1);
  // **The identifier, as a literal** — `widget-preset` is a kind this build has
  // no word for, and a display word invented here would be a name nothing
  // declared (§9). The rest of the sentence is the surface's own.
  await expect(
    line,
    "the skipped-kind line does not name the wire identifier",
  ).toHaveText("1 entry of kind widget-preset could not be read.");
  await expect(
    region.locator("[data-yunari-store-cell]"),
    "a skipped entry is drawn or a readable one is missing",
  ).toHaveCount(3);

  await captureVisualReview(page, testInfo, "store-online-refusal", region);
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
  // A page size another case left behind would page this listing differently.
  await page.evaluate(() =>
    window.localStorage.removeItem("yunari.editor.store-page-size"),
  );
  await page
    .locator(".editor-shell-mode-switch")
    .getByRole("button", { name: uiCopy.modes.themes, exact: true })
    .click();

  const region = page.locator("[data-yunari-mode-region='themes']");
  await expect(region, "the themes mode renders no region").toBeVisible();
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
  ).toHaveText("Submit to the store");
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

  const region = await showOnlineStore(page, REMIX_CATALOGUE);
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
 * drawing gives it is *Open in editor* — while **the cell's own surface is what
 * opens the item's** (spec, "The item's own surface": *so a cell opens a
 * modal*).
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
  const themeOf = (id: string, name: string): FabricThemeEnvelope => ({
    schemaVersion: 2,
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

  // **No `updatedAt`, and that is load-bearing.** With no `?theme=` in the URL
  // the editor boots on the author's most recent save, which it picks by that
  // field (`boot-theme.ts`): a listing that carried one would open a theme
  // before this case's first open, and the base's own reading below would start
  // out true rather than false — proving nothing about the open that moved it.
  // An entry with no time is a shape the wire really has (a template is not a
  // stored file and has none), and the cells draw the byline without a date.
  await page.route("**/api/themes", (route) =>
    route.fulfill({
      json: {
        themes: [fromCell, fromFooter].map((envelope) => ({
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
    .getByRole("button", { name: uiCopy.modes.themes, exact: true })
    .click();
  const region = page.locator("[data-yunari-mode-region='themes']");
  await expect(region, "the themes mode renders no region").toBeVisible();
  await expect(
    region.locator("[data-yunari-store-cell]"),
    "the store does not list the stubbed library",
  ).toHaveCount(2);

  const modal = page.locator("[data-yunari-store-item]");
  const cellOf = (id: string) =>
    region.locator(`[data-yunari-store-cell='${id}']`);
  const surfaceOf = (id: string) =>
    cellOf(id).locator("[data-yunari-store-cell-surface]");

  // **The cell's own bands are where the drawing puts them, and this is the
  // reading that says so** (A.7b). The surface, the byline and the facts band
  // are three elements now where they were one padded column, so the spacing
  // between them is arithmetic a later edit can move without anything failing:
  // the drawing's 10px inside the cell and 6px between the bands, which §3's
  // step table owns as `--space-10` and `--space-6`. The 26px band is the third
  // band's own height and is read here too, because it is what the drawing
  // fixes and a wrapper that padded it would squash it.
  //
  // **Each reading is the box the air sits outside of.** A span's own rect
  // includes its padding, so two padded bands abut however much air the padding
  // puts between their text, and measuring the rects would report 0 for every
  // gap — passing with the drawing's spacing deleted. The content box (the rect
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
    const byline = contentBox(
      cell.querySelector("[data-yunari-store-cell-byline]"),
    );
    // The 26px band itself, not the wrapper that pads it and not one action
    // inside it: the four controls are centred in the band, so a shorter one
    // would read as a band that is shorter than the 26px the drawing fixes.
    const band = cell
      .querySelector("[data-yunari-store-cell-action]")
      ?.parentElement?.getBoundingClientRect();
    const picture = cell
      .querySelector("[data-yunari-store-picture]")
      ?.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    return {
      // The cell's own 1px edge is inside its box, so the 10px the drawing puts
      // above it is measured from the border's inner edge.
      cellInnerBottom:
        cellRect.bottom -
        Number.parseFloat(getComputedStyle(cell).borderBottomWidth),
      pictureBottom: picture?.bottom ?? null,
      nameTop: name?.top ?? null,
      nameBottom: name?.bottom ?? null,
      bylineTop: byline?.top ?? null,
      bylineBottom: byline?.bottom ?? null,
      bandTop: band?.top ?? null,
      bandBottom: band?.bottom ?? null,
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
    return Math.round(below - above);
  };
  expect(
    gapOf(bands.pictureBottom, bands.nameTop, "name under the picture"),
    `the name is not the drawing's 10px under the picture (${bandReading})`,
  ).toBe(10);
  expect(
    gapOf(bands.nameBottom, bands.bylineTop, "byline"),
    `the byline is not the drawing's 6px under the name (${bandReading})`,
  ).toBe(6);
  expect(
    gapOf(bands.bylineBottom, bands.bandTop, "facts band"),
    `the facts band is not the drawing's 6px under the byline (${bandReading})`,
  ).toBe(6);
  expect(
    gapOf(bands.bandBottom, bands.cellInnerBottom, "band's own foot"),
    `the facts band does not sit the drawing's 10px above the cell's edge (${bandReading})`,
  ).toBe(10);
  expect(
    gapOf(bands.bandTop, bands.bandBottom, "band"),
    `the facts band is not the 26px the drawing fixes (${bandReading})`,
  ).toBe(26);

  // **The cell's own surface opens the item's**, and the open control below is
  // read from the surface the same gesture reaches.
  await surfaceOf(fromCell.id).click();
  await expect(
    modal,
    "the cell's own surface opens no item's surface",
  ).toBeVisible();
  await expect(
    page.locator("[data-yunari-store-item-action='open']"),
    "the item's own surface does not print the open action's own word",
  ).toHaveText(uiCopy.store.cell.actions.open);
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
    page.locator("[data-yunari-mode-region='themes']"),
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
    .getByRole("button", { name: uiCopy.modes.themes, exact: true })
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
    envelope: {
      schemaVersion: 2,
      fabricVersion: "7.4.0",
      id: "store-open-phone",
      artboard: { width: 640, height: 480 },
      metadata: { name: "Phone theme", themeLanguage: "en" },
      scene: { version: "7.4.0", objects: [] },
    },
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

/**
 * **A declared video is normalized in place, and never silently.**
 *
 * The host owns the encoder and the envelope rules (`POST
 * /api/themes/normalize-video`), so the route is stubbed: this case is about
 * what the author sees and presses, not about ffmpeg. Three claims, in the
 * order the author meets them: the controls exist for a video and for nothing
 * else; a refusal is the host's own sentence beside the control, with the
 * master untouched; and the copy the host answers with is held until the second
 * press, which writes it in place and re-renders the artboard bound to it.
 *
 * The artboard is bound to the clip first, because a video has no picture in
 * the asset pane — its only render in the editor is the background media
 * layer, and that is what "the preview re-renders" can mean here.
 */
test("normalizes a declared video without replacing its master", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  await page.goto(EDITOR);
  await openPane(page, "Add");
  await chooseAssetFile(page, "import", {
    name: "clip.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("mp4-source"),
  });

  // The artboard's background media is the one surface that renders a video,
  // and it is the background layer's, so it is chosen where that layer is
  // selected; the Add pane was showing, so the selection is a real pane swap.
  await selectLayer(page, "Background");
  await chooseIn(page, "[data-yunari-background-asset]", "clip");
  await openPane(page, "Add");
  await chooseIn(page, "[data-yunari-asset-select]", "clip");

  const normalize = page.locator("[data-yunari-asset-normalize]");
  const useCopy = page.locator("[data-yunari-asset-use-normalized]");
  const alert = page.locator('[data-yunari-panel="add"] [role="alert"]');
  // One action, keeping the whole frame: the layer crops at render time (0095).
  await expect(normalize).toBeVisible();

  const posted: unknown[] = [];
  let answer: Record<string, unknown> = {
    ok: false,
    message: "That video is not an H.264 MP4.",
  };
  await page.route("**/api/themes/normalize-video", async (route) => {
    posted.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(answer),
    });
  });

  await normalize.click();
  // The host's sentence, not one composed by the pane.
  await expect(alert).toHaveText("That video is not an H.264 MP4.");
  await expect(useCopy).toHaveCount(0);
  // A refusal is an answer, not a broken run: the control stays pressable.
  await expect(normalize).toBeEnabled();
  // The section is the pane's foot, so a capture of the pane has to be told to
  // bring the refusal into frame rather than cropping it below the fold.
  await alert.scrollIntoViewIfNeeded();
  await captureVisualReview(
    page,
    testInfo,
    "editor-video-normalize",
    page.locator('[data-yunari-panel="add"]'),
  );

  const background = page.locator("[data-yunari-background-media] video");
  await expect(background).toHaveCount(1);
  const before = await background.getAttribute("src");
  expect(before, "the bound clip has no rendered source").toMatch(/^blob:/);

  // The same file, normalized: the answer the second press writes.
  const normalized = Buffer.from("mp4-normalized");
  answer = {
    ok: true,
    bytesBase64: normalized.toString("base64"),
    reencoded: true,
  };
  await normalize.click();
  await expect(useCopy).toHaveText(uiCopy.panels.useNormalizedVideo);
  // Held, not applied: the master still carries the imported bytes.
  await expect(background).toHaveAttribute("src", before ?? "");

  await useCopy.click();
  await expect(useCopy).toHaveCount(0);
  // The artboard's media is remounted from the manager's new bytes.
  await expect
    .poll(() =>
      page.locator("[data-yunari-background-media] video").getAttribute("src"),
    )
    .not.toBe(before);

  // One declaration, holding the answer's bytes: the press swapped rather than
  // declared a second asset.
  const saved = await savePackage(page);
  expect(saved.parsed.ok).toBe(true);
  if (!saved.parsed.ok) return;
  expect(
    saved.parsed.envelope.assets?.filter((asset) => asset.id === "clip"),
  ).toMatchObject([{ id: "clip", kind: "video", path: "assets/clip.mp4" }]);
  expect(saved.parsed.assets["assets/clip.mp4"]).toEqual(normalized);
  // The press asked for no crop, so the host keeps the source's own shape.
  expect(posted[0]).not.toHaveProperty("fit");
});

/** Saves the open document through the File menu, as the author does. */
async function savePackage(page: Page): Promise<{
  readonly parsed: ReturnType<typeof readThemePackage>;
  readonly bytes: Buffer;
}> {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save package" }).click();
  await expect(page.locator("#status")).toContainText("Theme package saved");
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks);
  return { parsed: readThemePackage(bytes), bytes };
}
