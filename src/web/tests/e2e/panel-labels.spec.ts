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

/** The Tokens pane's paint controls, in the states that render them all.
 *
 *  The pane is lists-only now: a row press selects the token, and its fields
 *  render in the right column's token inspector. The audit therefore measures
 *  this list with a paint token selected, and the preset list below with a
 *  preset selected — one inspector renders one section at a time. The pane's
 *  old chooser is gone with the field set it browsed, so `[data-yunari-palette-token]`
 *  is not named here: there is no such control to name. */
const PAINT_CONTROLS = [
  // A solid token's one colour control is the picker's trigger in its §5 well;
  // the exact-value field is inside the picker's popover, which the audit does
  // not open — the trigger is what an author meets first.
  "[data-yunari-palette-name]",
  "[data-yunari-palette-kind]",
  "[data-yunari-palette-picker]",
  "[data-yunari-palette-replacement]",
  "[data-yunari-palette-delete]",
  // The gradient branch: one track that is the preview and the manipulator,
  // its two stop marks, the add/remove pair, the selected stop's two wells and
  // the angle. The setup opens this branch because it renders controls a solid
  // token does not.
  '[data-testid="gradient-track"]',
  '[data-testid^="gradient-stop-"]',
  '[data-testid="gradient-add"]',
  '[data-testid="gradient-remove"]',
  '[data-testid="gradient-offset"]',
  '[data-testid="gradient-angle"]',
];

/** The selected token's controls, in the token inspector. The pane is a list
 *  now: one pressable row per token and the add action. The chooser and the
 *  field set that went with it are the token inspector's, so they are measured
 *  there — after a token row press replaces the paint section. The computed
 *  name is a reading rather than a control, so it is not audited here.
 *
 *  The weight is not a control in this scenario: the token the add mints is on
 *  `Segoe UI, sans-serif`, a family the fresh theme declares no faces for, so
 *  the weight renders as a reading. It is asserted below rather than audited
 *  as a control; the weight select's name is covered by
 *  `accessible-names.dom.test.ts`, whose fixture supplies a declared face. */
const PRESET_CONTROLS = [
  "[data-yunari-type-preset-row]",
  "[data-yunari-type-preset-add]",
  // `unbind` renders only for a token bound to a packaged face, and the added
  // token is free, so that selector is audited when a scenario binds one.
  "[data-yunari-token-family]",
  "[data-yunari-token-unbind]",
  // The delete pair renders only for an unroled token, so the audit selects
  // the token the add mints rather than one of the three roles.
  "[data-yunari-token-replacement]",
  "[data-yunari-token-delete]",
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
    // so the audit has to open the same branches an author opens. The pane is
    // lists-only: a row press selects the token, and its fields — the kind
    // switch included — render in the right column's token inspector.
    await page.locator('[data-yunari-palette-token-row="cpu"]').click();
    // The gradient branch renders the track, its marks and its two wells, which
    // a solid token does not, so the audit opens the branch an author opens.
    await chooseIn(page, "[data-yunari-palette-kind]", "gradient");
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
    // not announce. Tokens is open from the setup, with a paint token selected.
    await audit(PAINT_CONTROLS);
    // One inspector renders one section, so the token half is measured after
    // pressing a token row, which replaces the paint section. The add mints an
    // unroled token, which draws the delete pair the role rows do not.
    await page.locator("[data-yunari-type-preset-add]").click();
    const presetRow = page.locator('[data-yunari-type-preset-row="type"]');
    await expect(presetRow).toBeVisible();
    await presetRow.click();
    await audit(PRESET_CONTROLS);
    // The weight is drawn as a reading in this scenario, not skipped: the fresh
    // theme declares no faces for the minted token's family, so the row prints
    // the seeded weight rather than a select (the comment on PRESET_CONTROLS).
    // A silent `count === 0` skip would let the row vanish unmeasured.
    await expect(page.locator("[data-yunari-token-weight]")).toHaveText("300");
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
