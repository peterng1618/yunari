import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Driving plan 1's control set, the way an author does.
 *
 * Three controls stopped being native while the inspector was rewritten, and
 * every suite that drove them still drove the native one:
 *
 * - a `<select>` became Base UI's select: a `button[role=combobox]` that opens
 *   a listbox portalled to `body`. `selectOption` reports *"Element is not a
 *   `<select>` element"* and an option that was never rendered cannot be found
 *   by `locator("option")` at all;
 * - a bounded number became a slider whose nested `input[type=range]` is the
 *   focus target and whose well is a `<span>` readout. `click()` on that input
 *   **times out** — Base UI's control div intercepts the pointer — so a
 *   click-then-type helper waits 30 seconds and reports nothing;
 * - a section became a disclosure whose header is a button carrying
 *   `aria-expanded`, not a native `<details>` with an `.open` property.
 *
 * None of the three is a product defect. Each is a locator that no longer names
 * what it names, which is why the suite has to say the new one rather than the
 * product grow the old one back.
 *
 * Every read here is by a `data-yunari-*` hook or by an ARIA attribute the
 * control owns. **Never by a presentation class**: `wellClasses` and the
 * Tailwind utilities beside it are the design language, and a rename would turn
 * an assertion into a thirty-second timeout naming a selector nobody meant.
 */

/**
 * The word a plan-1 select prints for what is chosen.
 *
 * Located by the `data-yunari-value` hook on `Select.Value` and read as text,
 * because that element carries **both**: the words in its content and the id
 * the control committed in the attribute. A driver that must assert the
 * reference rather than the word reads the attribute off the same element;
 * nothing here reaches for the `font-mono` beside it, since a presentation
 * class is the design language's to rename and a locator keyed on one is a
 * timeout naming nothing.
 */
export async function choiceOf(control: Locator): Promise<string> {
  const value = control.locator("[data-yunari-value]").first();
  await expect(value).toHaveCount(1);
  return value.innerText();
}

/**
 * A select's own opened listbox, and the options inside it.
 *
 * **Scoped by the `aria-controls` the trigger already carries** — and that
 * attribute is present *if and only if the popup is open*: Base UI renders it
 * straight from its `open` state, so a read taken before React commits the open
 * comes back `undefined`. Base UI also leaves a closed popup in the document
 * while it animates out, so a bare `[role=option]` lookup finds two
 * `palette.text` rows when one picker is opened straight after another — which
 * is exactly what an author does. The unscoped form does not fail loudly: it
 * resolves to two, a `.first().click()` lands on the stale hidden row, and the
 * case spends its whole budget waiting for an edit that never committed.
 *
 * Both facts are why the wait below is here and why there is **no fallback**.
 * Reading the attribute eagerly and scoping to the whole page when it is
 * missing re-opens the same hazard on the one path nobody watches: the first
 * option on the page is the stale hidden one from the picker that ran before,
 * `toBeVisible()` can then never succeed, and which case reddens depends on
 * which picker went first. A click that did not open a listbox is a fact worth
 * reporting, not a reason to widen the search.
 */
async function openList(
  page: Page,
  control: string | Locator,
): Promise<{ readonly options: Locator; readonly container: Locator }> {
  const trigger =
    typeof control === "string" ? page.locator(control).first() : control;
  if ((await trigger.count()) === 0) {
    throw new Error(`no control matches ${String(control)} on this selection`);
  }
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  const notOpened = `clicking ${String(control)} did not open a listbox (the trigger carries no aria-controls)`;
  await expect(trigger, notOpened).toHaveAttribute("aria-controls", /.+/, {
    timeout: 10_000,
  });
  const list = await trigger.getAttribute("aria-controls");
  if (list === null) throw new Error(notOpened);
  const container = page.locator(`#${list}`).first();
  const options = container.locator('[role="option"]');
  await expect(options.first()).toBeVisible();
  return { options, container };
}

/** The values a plan-1 select offers, read from its opened popup — it renders
 *  none until it is opened. Values, not labels, for the same reason
 *  {@link chooseIn} takes one. */
export async function optionsOf(
  page: Page,
  control: string | Locator,
): Promise<string[]> {
  const { options } = await openList(page, control);
  const values = await options.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-yunari-option") ?? ""),
  );
  await page.keyboard.press("Escape");
  return values;
}

/**
 * The words a plan-1 select prints, with the id each commits.
 *
 * {@link optionsOf} reads the ids alone; a caller that has to match on the
 * *label* needs both, because an imported asset is listed by the file the
 * author chose and keyed by an id the editor minted — the pair F0.4's fix made
 * readable. Same open-and-scope as every other read here, and the popup is
 * closed again so the caller's next open is an open rather than a toggle.
 */
export async function optionPairs(
  page: Page,
  control: string | Locator,
): Promise<{ readonly id: string; readonly label: string }[]> {
  const { options } = await openList(page, control);
  const pairs = await options.evaluateAll((nodes) =>
    nodes.map((node) => ({
      id: node.getAttribute("data-yunari-option") ?? "",
      label: (node.textContent ?? "").trim(),
    })),
  );
  await page.keyboard.press("Escape");
  return pairs;
}

/**
 * Picks the option whose value is `value` — the id the control commits, not the
 * label it prints.
 *
 * **By value, because the label is document data.** A picker's options are the
 * theme's own tokens and presets, named by their author (`palette.text` prints
 * `Text`, `typeTokens.24-400` prints `Card title`); matching on those words
 * would copy the document's glossary into the suite, and the `Text` / `Muted
 * text` pair is a substring collision besides. `control-select.tsx` puts
 * `data-yunari-option` on each `Select.Item` for exactly this, so the string a
 * locator names and the string the control commits are one string — the rule the
 * `data-yunari-*` hooks already keep.
 */
export async function chooseIn(
  page: Page,
  control: string | Locator,
  value: string,
): Promise<void> {
  const { container } = await openList(page, control);
  const option = container.locator(
    `[role="option"][data-yunari-option="${value}"]`,
  );
  await expect(option).toHaveCount(1);
  await option.click();
}

/**
 * Picks the option an author reads, by the words on it.
 *
 * The one caller is `rebuild-driver.chooseToken`, which is handed the *name* a
 * person gave a token and has to commit the reference behind it. It uses this
 * rather than its own `getByRole("option")` for {@link openList}'s reason: an
 * unscoped role lookup is the fabricated failure the popup's exit animation
 * makes, not a locator.
 */
export async function chooseLabelIn(
  page: Page,
  control: string | Locator,
  label: string,
): Promise<void> {
  const { container } = await openList(page, control);
  const option = container.getByRole("option", { name: label, exact: true });
  if ((await option.count()) === 0) {
    throw new Error(
      `no option named ${JSON.stringify(label)} in ${String(control)}`,
    );
  }
  await expect(option).toHaveCount(1);
  await option.click();
}

/**
 * Replaces a field's value: click-and-type for a text or number input, and
 * `fill` for a slider.
 *
 * The slider branch is not a shortcut. Its nested `input[type=range]` sits
 * inside a control `div` that takes the pointer, so `click()` never lands and
 * the whole test spends its budget waiting. `fill` sets the value and fires the
 * `input` the primitive commits on.
 *
 * A value past either end **lands on that end**, read off the control's own
 * bounds: that is the bound the field declares, and it is also what the
 * pre-plan `numberField` did — clamped to the bound it crossed rather than
 * reverting, so the author who types past the ceiling is taught where it is.
 * Playwright refuses an out-of-range `fill` outright ("Malformed value"), so
 * the clamp is also what makes the case expressible at all.
 *
 * **The bounds are read as IDL properties, in the page.** `getAttribute("max")`
 * is `null` on a range that declares no attribute — and a range that declares
 * none still has bounds, the platform's own 0 and 100. `Number(null)` is 0, so
 * the attribute form would clamp *every* value to 0: a helper that silently
 * agrees with whatever it is given, which is the one thing this file is for not
 * being.
 */
export async function typeIntoControl(
  page: Page,
  field: Locator,
  value: string | number,
): Promise<void> {
  await field.scrollIntoViewIfNeeded();
  const range = await field.evaluate((element) => {
    const input = element as HTMLInputElement;
    if (input.type !== "range") return undefined;
    // `HTMLInputElement.min`/`.max` reflect the attribute when it is there and
    // fall back to the range's own defaults when it is not.
    return {
      min: input.min === "" ? 0 : Number(input.min),
      max: input.max === "" ? 100 : Number(input.max),
    };
  });
  if (range !== undefined) {
    const numeric = Number(value);
    const landed = Number.isFinite(numeric)
      ? Math.min(Math.max(numeric, range.min), range.max)
      : numeric;
    await field.fill(String(landed));
    await field.blur();
    return;
  }
  await field.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type(String(value));
  await page.keyboard.press("Tab");
}

/** A section's disclosure header: the button §5 makes it. */
function sectionHeader(page: Page, id: string): Locator {
  return page
    .locator(`[data-yunari-section="${id}"] button[aria-expanded]`)
    .first();
}

/** Whether a section's disclosure is open.
 *
 *  **A missing section throws rather than answering `false`.** `getAttribute`
 *  returns `null` both for a section this selection does not have and for a
 *  selector that no longer matches anything, so "absent" would read as
 *  "collapsed" and a case asserting `false` would pass on a surface that
 *  rendered nothing at all. */
export async function sectionExpanded(
  page: Page,
  id: string,
): Promise<boolean> {
  const header = sectionHeader(page, id);
  await expect(header, `no section "${id}" on this selection`).toHaveCount(1);
  return (await header.getAttribute("aria-expanded")) === "true";
}

/** Opens a section's disclosure if it is closed. */
export async function openSection(page: Page, id: string): Promise<void> {
  const header = sectionHeader(page, id);
  if ((await header.count()) === 0) return;
  if ((await header.getAttribute("aria-expanded")) === "true") return;
  await header.click();
}
