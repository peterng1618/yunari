import { expect, type Locator, test } from "@playwright/test";
import { chooseIn } from "./control-set.js";
import { openPane } from "./editor-rail.js";
import { selectLayer } from "./rebuild-driver.js";
import { openAppearance } from "./shell-palette.js";
import { compactViewportMaxPx } from "./shell-tokens.js";
import { isDesktopSurface } from "./surface.js";

/**
 * Every control the theme-settings, palette and type-preset panels render has
 * the name a screen reader reads, measured by a real accessibility tree.
 *
 * The unit test beside these panels asks the DOM what it can answer. This asks
 * Chromium, which is the only thing that settles whether a control is *named*:
 * a label element that exists, is visible and is associated with nothing
 * satisfies every DOM assertion and announces nothing at all.
 *
 * The panels are audited together for the reason F1.19 was filed: the defect was
 * in all three, and a per-panel test would let the next unnamed control be a new
 * finding rather than a red run.
 */

const EDITOR = "http://127.0.0.1:4174/";

const PANELS = ["Theme settings", "Palette", "Type presets"];

/** The Tokens pane's controls, in the states that render them all. */
const TOKENS_CONTROLS = [
  // Palette
  "[data-yunari-palette-token]",
  "[data-yunari-palette-name]",
  "[data-yunari-palette-kind]",
  "[data-yunari-palette-color]",
  "[data-yunari-palette-angle]",
  "[data-yunari-palette-stop-offset]",
  "[data-yunari-palette-stop-color]",
  "[data-yunari-palette-replacement]",
  "[data-yunari-palette-delete]",
  // Type presets
  "[data-yunari-type-preset]",
  "[data-yunari-type-name]",
  "[data-yunari-type-family]",
  "[data-yunari-type-size]",
  "[data-yunari-type-weight]",
  "[data-yunari-type-line-height]",
  "[data-yunari-type-letter-spacing]",
  "[data-yunari-font-face]",
  "[data-yunari-font-trio]",
  "[data-yunari-type-replacement]",
  "[data-yunari-type-delete]",
];

/** The Document pane's controls: the artboard panel's theme settings. */
const DOCUMENT_CONTROLS = [
  "[data-yunari-theme-name]",
  "[data-yunari-theme-author]",
  "[data-yunari-theme-description]",
  "[data-yunari-theme-language]",
  "[data-yunari-theme-language-sample]",
  "[data-yunari-theme-version]",
  "[data-yunari-artboard-ratio]",
  "[data-yunari-artboard-orientation]",
  "[data-yunari-artboard-resolution]",
  "[data-yunari-artboard-width]",
  "[data-yunari-artboard-height]",
];

/** The selected background layer's controls, in the selection inspector. The
 *  background's paint, picture and geometry left the Document pane when the
 *  background became a layer, so their names are audited where they live. The
 *  media is always cover, so the geometry is the bounds, the offset pair and the
 *  two mirrors. */
const BACKGROUND_CONTROLS = [
  "[data-yunari-background]",
  "[data-yunari-background-asset]",
  "[data-yunari-background-bounds]",
  "[data-yunari-background-offset-x]",
  "[data-yunari-background-offset-y]",
  "[data-yunari-background-flip-x]",
  "[data-yunari-background-flip-y]",
];

/** §7's Appearance tab, which is not one of the three panels either.
 *
 *  This entry is the audit following a control rather than widening its
 *  contract. It was the header's palette chip, which lost its name when the
 *  `<select aria-label="Shell palette">` became a menu — the trigger announced
 *  its own content, and its content was the current value. The chip has since
 *  left the header for the modal, and the six choice rows are what replaced it:
 *  the surface still exists and still has to be named, so the entry moves to it
 *  rather than being retired over a control nobody can find any more. The
 *  follow-the-system toggle came with it, because one surface moved and the
 *  other arrived beside it; nothing else on the modal is added here.
 *
 *  A choice row's accessible name is carried by its text content as well as its
 *  `aria-label` (`control-choice-row.tsx:43,56` — the label is both), so the
 *  audit measures the name Chromium *computes* for each of the six rows rather
 *  than the presence of one attribute: a check on `aria-label` alone would go
 *  green on a row whose name had moved, and the row only loses its name when
 *  both are gone, which is a row that announces nothing. */
const APPEARANCE_CONTROLS = [
  "[data-yunari-palette-choice]",
  "[data-yunari-follow-system]",
];

/** The name Chromium computes for a control, or "" when it computes none.
    `ariaSnapshot` renders Playwright's own accessible-name engine, whose
    output is `- <role> "<name>": <value>`. */
async function accessibleName(locator: Locator): Promise<string> {
  const snapshot = (await locator.ariaSnapshot()).trim();
  return (
    /^-\s*[a-z]+\s*"([^"]*)"/i.exec(snapshot)?.[1] ??
    // A name containing ": " makes the YAML emitter quote the whole node, so
    // it arrives as `- 'button "<name>"': <value>` and the anchored form above
    // reads nothing. Still a role and still a quoted name inside the quotes,
    // so a quoted *value* on an unnamed control is not mistaken for a name.
    /^-\s*'[a-z]+\s*"([^"]*)"'/i.exec(snapshot)?.[1] ??
    ""
  );
}

test.describe("the settings panels name every control", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    // The panels live in the inspector, which the shell's own CSS drops below
    // its compact breakpoint, so on a phone these controls have no box to be
    // pressed at and the audit would be reporting on a panel no author can
    // reach. Measured: the panel opens at 240px wide and the select inside it
    // is 0x0. The breakpoint is the stylesheet's own `@media` value, read
    // rather than restated.
    test.skip(
      !isDesktopSurface(testInfo),
      `the settings panels are hidden below ${compactViewportMaxPx()}px`,
    );
    await page.goto(EDITOR);
    await page.waitForSelector("[data-yunari-panel]");
    // The palette and type-preset panels are the Tokens pane's; the theme
    // settings (artboard, metadata, background) are the Document pane's. Both
    // live in the left column, hidden until their slot is asked for — not
    // behind a tab in the inspector. This opens the pane most cases read; a
    // case that needs the Document pane opens it itself.
    await openPane(page, "Tokens");
    // The gradient and delete branches render controls a solid token does not,
    // so the audit has to open the same branches an author opens. A token with
    // other tokens to reassign to is what puts the delete row on screen.
    await chooseIn(page, "[data-yunari-palette-token]", "cpu");
    // The preset chooser is a plan-1 select too, so it is opened and chosen the
    // way the palette's is rather than by `selectOption`.
    await chooseIn(page, "[data-yunari-type-preset]", "20-500");
  });

  test("no control is unnamed", async ({ page }) => {
    const unnamed: string[] = [];
    const measured: string[] = [];
    const audit = async (selectors: readonly string[]): Promise<void> => {
      for (const selector of selectors) {
        const matches = page.locator(selector);
        const count = await matches.count();
        if (count === 0) continue;
        // Every match, not just the first. A selector that names a *set* — the
        // six palette choices are six controls — is six names that each have to
        // be measured, and `.first()` audited one and called the set covered. A
        // single-match selector is unaffected: its count is 1.
        for (let index = 0; index < count; index += 1) {
          const label = count === 1 ? selector : `${selector}[${index}]`;
          measured.push(label);
          if ((await accessibleName(matches.nth(index))) === "")
            unnamed.push(label);
        }
      }
    };

    // The three panels span two panes now: the palette and type presets in
    // Tokens, the theme settings in Document. Each is measured with its own
    // pane open, because a control inside a hidden pane is out of the
    // accessibility tree and measuring it there would report a name it does
    // not announce. Tokens is open from the setup.
    await audit(TOKENS_CONTROLS);
    await openPane(page, "Document");
    await audit(DOCUMENT_CONTROLS);
    // The background's controls are the selection inspector's, which renders
    // while the background layer is selected; selecting it opens Composition,
    // so this audit comes last of the panes.
    await selectLayer(page, "Background");
    await audit(BACKGROUND_CONTROLS);
    // Last, because an open modal is modal: the controls behind it are inert
    // and the panes' own audit above measures them as an author reaches them.
    const dialog = await openAppearance(page);
    await audit(APPEARANCE_CONTROLS);
    // The palette entry is a *set* of six rows, and the audit now reaches all
    // six: this count is what fails if the set shrinks under the audit's feet,
    // so "the six choice rows" stays true of what was measured and not only of
    // the comment above it.
    await expect(page.locator("[data-yunari-palette-choice]")).toHaveCount(6);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // The gradient, the delete controls and every field really rendered: a
    // short list would mean the audit passed by not looking.
    expect(measured.length).toBeGreaterThanOrEqual(30);
    expect(unnamed).toEqual([]);
  });

  test("the release version is a named status, not a label naming nothing", async ({
    page,
  }) => {
    // The version control is the artboard panel's, so it is in Document.
    await openPane(page, "Document");
    // An `output` is a status region, not a form control: nothing an author
    // types ever reaches it, so it is named rather than wrapped in a field.
    // The role is asserted with it because a name on the wrong role would
    // still be read, and the role is what says it is a value, not a field.
    const snapshot = await page
      .locator("[data-yunari-theme-version]")
      .ariaSnapshot();
    expect(snapshot.trim()).toMatch(/^- status "Release version"/);
  });

  test("each panel's chooser says what it lists", async ({ page }) => {
    // Both choosers are the Tokens pane's, open from the setup.
    expect(
      await accessibleName(page.locator("[data-yunari-palette-token]")),
    ).toBe("Colour token");
    expect(
      await accessibleName(page.locator("[data-yunari-type-preset]")),
    ).toBe("Type preset");
  });

  test("the three panels are the ones the audit claims to cover", async ({
    page,
  }) => {
    const headings = await page.locator("section h2").allTextContents();
    // The set, not the order: the theme settings and the tokens now live in
    // different panes' hosts, so their DOM order is the hosts' and not the
    // list's.
    expect(
      headings.filter((text) => PANELS.includes(text.trim())).sort(),
    ).toEqual([...PANELS].sort());
  });
});
