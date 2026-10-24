import { uiCopy } from "./ui-copy.js";

/**
 * What a surface says, for the copy net's cases.
 *
 * Responsibility: the shared readers only — `spokenIn` for a mounted tree's
 * labels, accessible names, buttons, headings and definition terms, `saidIn`
 * and `paragraphsOf` for the paragraphs `spokenIn` does not read, `spokenText`
 * for one element's own words with its decoration stripped, and `copy` for
 * every string the table can produce. The rules are asserted by the three files
 * that read through them: `ui-copy.test.ts` (the table's own),
 * `ui-copy-panels.test.ts` (the imperative panels and the picker they mount)
 * and `ui-copy-surfaces.test.ts` (the landed React surfaces).
 *
 * **Importing this module also patches the jsdom gaps below.** Every file that
 * reads a mounted surface needs them, because the words are read through Base UI
 * popups — the panels' paint kinds and unit display lists, the shell's menus and
 * the Settings tabs — and jsdom has none of the three browser APIs a popup
 * needs.
 */

// The run editor's unit list is a Base UI select, so opening it needs the three
// browser APIs jsdom has none of — the same three `control.dom.test.tsx` and
// `runs.test-stage.tsx` supply, for the same reason.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as never;
Element.prototype.getAnimations ??= (): never[] => [];
window.PointerEvent ??= MouseEvent as never;
const nativeMatches = Element.prototype.matches;
Element.prototype.matches = Object.assign(function (
  this: Element,
  selector: string,
): boolean {
  if (selector === ":modal" || selector === ":popover-open") return false;
  return nativeMatches.call(this, selector);
}, nativeMatches);
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** A button's or a menu row's own words. A section's disclosure chrome is an
 *  `aria-hidden` `▾`, which is decoration the way a select's chevron is, and a
 *  `kbd` prints a chord the binding table owns — the words beside them are what
 *  this table has to hold, not the glyph or the key they are printed next to. */
export function spokenText(element: Element): string {
  const words = element.cloneNode(true) as Element;
  for (const hidden of words.querySelectorAll('[aria-hidden="true"], kbd'))
    hidden.remove();
  return words.textContent ?? "";
}

/** Everything a surface says: what `spokenIn` reads, and the paragraphs it does
 *  not. The About tab's words are all in one paragraph, so a read without this
 *  would agree with itself by finding nothing. */
export function saidIn(element: Element): string[] {
  return [...spokenIn(element), ...paragraphsOf(element)];
}

/** The words a surface prints in paragraphs of its own, empty ones dropped. */
export function paragraphsOf(element: Element): string[] {
  return Array.from(
    element.querySelectorAll("p"),
    (paragraph) => paragraph.textContent?.trim() ?? "",
  ).filter((text) => text !== "");
}

/**
 * Every string the table can produce, and the limit of that claim.
 *
 * **What the walk covers.** A function entry is called with **one** argument —
 * a count the panels render, or a name — so a function of one argument whose
 * answer does not depend on a key is collected whole, and extra entries only
 * loosen the net, they cannot break it. The empty string is one of them: it
 * collects the sentence a template composes *around* its value, which is the
 * concept `spokenIn` reads in place of a label that ends in a reading.
 *
 * **What it cannot cover.** A function of two or more arguments is called with
 * one, so its later arguments arrive `undefined` and the sentence it composes
 * over a dynamic value is collected by nothing — `panels.artboardOutside` and
 * `draftRecovery.lead` are the two, and a surface printing one goes falsely
 * **red**. Widening the pool cannot close that: a sentence interpolating the
 * theme's own name can never equal a probe's output.
 *
 * `chartFamilyLabels` needs no probe of its own: it is reachable as
 * `uiCopy.chartFamilies`, so the object walk above already collects it.
 */
export function copy(): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") out.push(value);
    else if (typeof value === "function")
      for (const argument of [1, 2, 3, 4, "x", ""]) {
        const produced: unknown = (value as (a: unknown) => unknown)(argument);
        if (typeof produced === "string") out.push(produced);
      }
    else if (Array.isArray(value)) value.forEach(walk);
    else if (typeof value === "object" && value !== null)
      Object.values(value).forEach(walk);
  };
  walk(uiCopy);
  return out;
}

/**
 * Every string the landed React surfaces say: a field's own label, a control's
 * accessible name, a button's words, a heading's words and a definition term's
 * — minus the three whose content is not copy. A section header is excluded
 * because its text is an uppercase eyebrow (§2) and a count, neither a word the
 * table owns; a converted select's trigger is excluded because it prints the
 * chosen value; and a token well is excluded as the panel net excludes it,
 * because it prints the document's own name.
 */
export function spokenIn(element: Element): string[] {
  const out: string[] = [];
  for (const label of element.querySelectorAll("label"))
    out.push(label.textContent?.trim() ?? "");
  for (const named of element.querySelectorAll("[aria-label]")) {
    // A control named by its own `data-testid` (the picker's tracks) is a
    // driver's hook, not a word of copy.
    if (named.getAttribute("aria-label") === named.getAttribute("data-testid"))
      continue;
    // A control that *is* a value — the picker's preset row, whose own
    // `aria-label` is the library's name for that colour — carries
    // `data-yunari-value` itself, the way the button half below excludes it.
    // The attribute, not a value hidden somewhere inside: the picker trigger
    // also contains a value and its accessible name is still copy.
    if (named.hasAttribute("data-yunari-value")) continue;
    // A `kbd`'s label is the chord the binding table prints, not a word.
    if (named.closest("kbd") !== null) continue;
    const name = named.getAttribute("aria-label") ?? "";
    // The camera's readout is the concept and then the reading, the way a
    // select's trigger prints the chosen value. The concept is a word this table
    // must hold, so it is read; the reading is dropped by its own shape — and a
    // reading in a shape this does not know is pushed whole and goes red, so a
    // change to the readout cannot quietly take the concept out of the net.
    out.push(
      named.hasAttribute("data-yunari-zoom")
        ? name.replace(/: \d+(?:\.\d+)?%$/, "")
        : named.hasAttribute("data-yunari-subject-name")
          ? // The heading's label is the rename concept and then the object's
            // own name, which is data of the same kind as a palette's. Only the
            // concept is read, so it still has to be a word the table holds.
            name.startsWith(`${uiCopy.panels.rename} `)
            ? uiCopy.panels.rename
            : name
          : named.hasAttribute("data-yunari-qr")
            ? // The code's label is the concept and then the address it encodes,
              // which is a reading: the address is dropped by its own shape, and
              // what is left is compared against the sentence the table composes
              // around an empty value — so a rename in the table still reaches
              // this label, and the address never has to have an owner.
              name.replace(/\S+$/, "")
            : name,
    );
  }
  for (const button of element.querySelectorAll("button")) {
    if (button.getAttribute("data-yunari-palette-token-row") !== null) continue;
    // A font picker's face and trio rows print the catalogue's own words — a
    // family, a weight, a trio's name — which is data of the same kind as a
    // token's name, and `ui-copy-panels.test.ts` carves the same two rows out
    // of its own button net for the same reason.
    if (
      button.hasAttribute("data-yunari-font-face-row") ||
      button.hasAttribute("data-yunari-font-trio-row")
    )
      continue;
    if (button.querySelector("[data-yunari-value]") !== null) continue;
    if (button.hasAttribute("aria-controls")) continue;
    // A facet option's row prints a value beside the count of themes behind it:
    // the value is the record's own reading for most facets — an author's name,
    // a sensor's `label`, a ratio, a size — and the count is the library's, so
    // neither is a word this table owns. Reading the row would mean a carve-out
    // per facet shape and would make a ratio or a size an ownerless word. What
    // the facet *says* is read: its name from the trigger, and its sentence and
    // its group headings from the popup.
    if (button.hasAttribute("data-yunari-facet-option")) continue;
    // The readout's trigger prints the reading alone, so the button half has no
    // words of its own; the concept above is where its name is read.
    if (button.hasAttribute("data-yunari-zoom")) continue;
    out.push(spokenText(button).trim());
  }
  // A heading and a definition term carry a surface's own words the way a
  // button does, and a surface whose words are only there — the shortcut sheet's
  // heading, its group names and its row labels — is otherwise mounted and read
  // for its close button alone. A section header's heading is the disclosure
  // button's, and the count beside its title is a reading rather than a word, so
  // it is skipped exactly as the button above is.
  for (const heading of element.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    if (heading.querySelector("button[aria-controls]") !== null) continue;
    out.push(spokenText(heading).trim());
  }
  for (const term of element.querySelectorAll("dt"))
    out.push(spokenText(term).trim());
  // An opened menu's rows, which are not buttons and carry no accessible name
  // of their own: their words are their text, minus the chord printed beside.
  for (const item of element.querySelectorAll(
    '[role="menuitem"], [role="menuitemradio"]',
  ))
    out.push(spokenText(item).trim());
  return out.filter((text) => text !== "" && !/^[\d.v-]+$/.test(text));
}
