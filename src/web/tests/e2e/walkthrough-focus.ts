import type { Page } from "@playwright/test";

/**
 * Observing and moving focus: the §13.1 census's own primitives.
 *
 * Split out of `host-walkthrough.spec.ts` under Ruling L, which is the size
 * 800-line stop forces and the responsibility the split is by: this
 * module knows where focus *is* and how a keyboard makes it move, and nothing
 * about the shell's own vocabulary. What a particular control means — a group,
 * a pane, a popup — belongs to `walkthrough-shell.ts`, and the spec holds the
 * tests and nothing else.
 *
 * Nothing here clicks and nothing here calls `focus()`: `Tab` and `Shift+Tab`
 * are the only ways focus moves, which is the whole of §13.1's "by keyboard
 * alone". The single permitted `focus()` is {@link focusDocument}'s, which is
 * the walk's starting point rather than a way to skip one.
 */

/**
 * The shell's regions.
 *
 * **Taken from the shell's own layout, not invented to fit a result.** Its
 * labelled bands are `header · rail · pane · stage · inspector · status bar`.
 * The four here are the body's — the body regions the interactions act in,
 * and the ones that own a focusable surface: the rail chooses a pane, the pane
 * holds the scene tree, the stage holds the canvas and its dock, the inspector
 * holds the selection's own column.
 *
 * **The box is the boundary, and it is why there are four and not six.** These
 * four are exactly `.editor-shell-body`'s children (`shell-layout.tsx`), and
 * The layout puts the header and the status bar outside that box — the
 * `<header>` before it and the `<footer id="status">` after it. A reader
 * counting the shell's bands against this list is off by those two on
 * purpose, and the reason is the box rather than how the bands are used.
 *
 * **The instrument does reach into the header, and a command path is not a
 * region.** §13.1's first and last interactions are commands about a document —
 * `File → New from starter` and `File → Open library` — and the walk performs
 * them through the header's own `File` menu (`walkthrough-shell.ts`'s
 * `chooseFileMenuRow`); the census's own first press lands on that button. That
 * is a route *through* a band to a command, not a band that owns a focusable
 * surface a walk wanders, which is what "each region has a reachable focus
 * target" is read against and what a region earns its place by. The status
 * bar's reachability has never been measured either way, so censusing it would
 * assert something §13.1 was not read against.
 *
 * Each region's selector is the shell's own class or id, the same ones
 * `shell-appearance.spec.ts`, `inspector-sections.spec.ts` and
 * `editor-rail.spec.ts` browse by. A region whose element was renamed would
 * fail here rather than quietly stop being censused.
 *
 * **A second, independent statement of the same four**: `vg-231` in the
 * register calls `.editor-shell-body`'s children "the shell's four body
 * regions", and names them rail, pane, stage and inspector. Two documents
 * agree, which is why this list is a reading rather than a guess.
 */
export const REGIONS = ["rail", "pane", "stage", "inspector"] as const;

export type Region = (typeof REGIONS)[number];

export const REGION_SELECTOR: Record<Region, string> = {
  rail: ".editor-shell-rail",
  pane: ".editor-shell-panel",
  stage: "#stage",
  inspector: ".editor-shell-inspector",
};

/**
 * How far the census will walk before it gives up.
 *
 * The bound exists so a shell that never returns focus to a seen node ends as a
 * reported count rather than a hung run. It is generous on purpose: the count
 * the walk actually took is the evidence, and this only says when the walk
 * stopped being one.
 */
export const TAB_BOUND = 200;

/** The attribute a walk writes on each element it reached, so the stop
 *  condition is "focus came back to something already seen" rather than a
 *  count. A test-owned name: no shell style or selector reads it.
 *
 *  **Per walk, not per page.** It is cleared at the start of every walk
 *  ({@link clearWalkMarks}), because a mark left behind is what a *previous*
 *  walk saw: the next `Tab` from the document body lands on `File`, tagged by
 *  the walk before, and `tabUntil` would throw on its first press. */
const SEEN = "data-walkthrough-seen";
/** The first element reached in each region during the current walk, which is
 *  the one whose name is asserted. Cleared with {@link SEEN}, so the marks left
 *  on the page are always the current walk's. */
export const FIRST = "data-walkthrough-first";

/** What a focused element is, before the census numbers the step. */
interface Landed {
  /** The region the focused element sits in, or `null` for one outside all
   *  four — a header menu, the status bar, the document itself. */
  readonly region: Region | null;
  /** The element's tag, lowercased, so a step is readable in a failure. */
  readonly tag: string;
  /** Its spoken name, approximated — see {@link focusProbe}. */
  readonly name: string;
}

/** One step of the census: where focus landed, and when. */
export interface Focus extends Landed {
  /** The census's own index, in Tab order. */
  readonly press: number;
}

/** The census's probe, serialised into the page by `page.evaluate`.
 *
 * It names no module constant — everything arrives through `args` — because
 * `evaluate` ships the function's own source and a closure over {@link SEEN} or
 * {@link FIRST} would arrive undefined.
 *
 * The name is an **approximation** — `aria-label`, else the text
 * `aria-labelledby` points at, else the element's own text, else `title`. It is
 * the census's running record and the thing a failure prints. The
 * *authoritative* name — the one a screen reader would say — is asserted with
 * Playwright's own `toHaveAccessibleName`. The two mechanisms are deliberately
 * different: an approximation that agreed with itself would prove nothing about
 * what a voice user hears.
 *
 * Answers `null` when there is no element to describe, and `{ repeat: true }`
 * when the element already carries `args.seen` — the census's stop condition. */
function focusProbe(args: {
  readonly selectors: Record<string, string>;
  readonly seenRegions: readonly string[];
  readonly seen: string;
  readonly first: string;
}): Landed | { repeat: true } | null {
  const active: Element | null = document.activeElement;
  if (active === null) return null;
  if (active.hasAttribute(args.seen)) return { repeat: true };
  active.setAttribute(args.seen, "");

  let region: string | null = null;
  for (const [name, selector] of Object.entries(args.selectors)) {
    if (active.closest(selector) !== null) {
      region = name;
      break;
    }
  }
  if (region !== null && !args.seenRegions.includes(region)) {
    active.setAttribute(args.first, region);
  }

  const label = active.getAttribute("aria-label");
  const labelledBy = active.getAttribute("aria-labelledby");
  const byId =
    labelledBy === null
      ? ""
      : labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
          .trim();
  const own = (active.textContent ?? "").replace(/\s+/g, " ").trim();
  const name =
    label !== null && label.trim() !== ""
      ? label.trim()
      : byId !== ""
        ? byId
        : own !== ""
          ? own
          : (active.getAttribute("title") ?? "").trim();

  return {
    region: region as Region | null,
    tag: active.tagName.toLowerCase(),
    name,
  };
}

/**
 * Removes the marks a walk leaves on the page, so the next walk starts from the
 * same place this one did.
 *
 * A walk's marks are its own record of what *it* has seen; keeping them across
 * walks would make the second walk's first press land on an element the first
 * walk had already tagged, which reads as a closed focus cycle when nothing has
 * closed. Every walk therefore opens by clearing both marks — a walk is a
 * question about the shell, and it must not be able to answer it with the
 * previous question's notes.
 */
export async function clearWalkMarks(page: Page): Promise<void> {
  await page.evaluate(
    (marks: readonly string[]) => {
      for (const mark of marks) {
        for (const element of document.querySelectorAll(`[${mark}]`)) {
          element.removeAttribute(mark);
        }
      }
    },
    [SEEN, FIRST],
  );
}

/** Puts focus back at the top of the document, which is where
 *  {@link keyboardReach} claims its walks begin.
 *
 * Clearing the marks is not enough to make two censuses agree, and the way the
 * first attempt at this failed is worth keeping. A walk's *closing* press is
 * the one that lands on an element it has already seen, so the walk ends with
 * focus on that element — `File`, the document's first tab stop. And a blur is
 * not a reset: the browser keeps a **sequential focus navigation starting
 * point**, set to the element that last lost focus, so the next Tab resumes
 * *after* it. Measured on this shell: blur `File` and the next Tab lands on
 * `Edit`; blur `Edit` and it lands on `View`. The second census therefore came
 * back one press short on every step while passing every test of "did it
 * move".
 *
 * Focusing the body instead puts the starting point back at the top, and the
 * body needs a `tabindex` to be focusable at all. The attribute is removed in
 * the same evaluate, so nothing of the page is left changed — the walk wants
 * the document's focus, not a modified document. Nothing here is clicked: a
 * `focus()` is not a pointer action, and the plan's rule is about how focus is
 * *reached*, not about which of the two keyboard-adjacent verbs resets it.
 *
 * Only the census calls this. {@link tabUntil} deliberately does not: a later
 * task opens a popup and then walks *inside* it, and a reset to the document
 * would take focus out of the very surface being proved. */
export async function focusDocument(page: Page): Promise<void> {
  await page.evaluate(() => {
    const body = document.body;
    body.setAttribute("tabindex", "-1");
    body.focus();
    body.removeAttribute("tabindex");
  });
}

/**
 * Tabs from the document's own focus, recording each element focus lands on.
 *
 * Keyboard only: `Tab` is the one thing that moves focus. The walk stops when
 * focus returns to an element already seen — which is what a focus order that
 * has closed its cycle looks like — or at {@link TAB_BOUND} presses, whichever
 * comes first. The returned length is the press count.
 *
 * Re-entrant: it clears the previous walk's marks and returns focus to the
 * document first, so two walks in one test are two whole walks from the same
 * starting point rather than one truncated second one.
 */
export async function keyboardReach(page: Page): Promise<readonly Focus[]> {
  await clearWalkMarks(page);
  await focusDocument(page);
  const reached: Focus[] = [];
  const seenRegions: Region[] = [];

  for (let press = 0; press < TAB_BOUND; press++) {
    await page.keyboard.press("Tab");
    const step = await page.evaluate(focusProbe, {
      selectors: REGION_SELECTOR,
      seenRegions,
      seen: SEEN,
      first: FIRST,
    });
    if (step === null) break;
    if ("repeat" in step) break;
    reached.push({ ...step, press });
    if (step.region !== null && !seenRegions.includes(step.region)) {
      seenRegions.push(step.region);
    }
  }

  return reached;
}

/**
 * Tabs until the focused element satisfies `matches`, and answers with it.
 *
 * The helper later tasks reach a control with. It asks what a control *is*
 * rather than where it sits in an order the shell is free to change, and it
 * fails saying how many presses it spent **and which regions it saw**, so a
 * walk stuck inside one region reads as that rather than as a bare count.
 *
 * Re-entrant for the reason {@link keyboardReach} is: it clears the marks of
 * whatever walk came before it, so a `tabUntil` after a `keyboardReach` — which
 * is how a later task asserts that a region can be left as well as reached — is
 * not tripped by the earlier walk's notes.
 */
export async function tabUntil(
  page: Page,
  matches: (focus: Focus) => boolean,
  limit = TAB_BOUND,
): Promise<Focus> {
  await clearWalkMarks(page);
  const seenRegions: Region[] = [];
  let pressed = 0;
  for (; pressed < limit; pressed++) {
    await page.keyboard.press("Tab");
    const step = await page.evaluate(focusProbe, {
      selectors: REGION_SELECTOR,
      seenRegions,
      seen: SEEN,
      first: FIRST,
    });
    if (step === null) {
      throw new Error(`focus left the document after ${pressed + 1} presses`);
    }
    if ("repeat" in step) {
      throw new Error(
        `focus returned to a seen element after ${pressed + 1} presses`,
      );
    }
    if (step.region !== null && !seenRegions.includes(step.region)) {
      seenRegions.push(step.region);
    }
    const focus: Focus = { ...step, press: pressed };
    if (matches(focus)) return focus;
  }
  // The regions are the half that says how far the walk got: a count alone
  // cannot be told apart from a walk that never left its starting region, which
  // is exactly how the 758-stop font picker read as "nothing matched in 200
  // presses" rather than as a walk stuck in the inspector (`vg-551`).
  throw new Error(
    `nothing matched in ${pressed} presses; regions seen: ${
      seenRegions.length === 0 ? "none" : seenRegions.join(", ")
    }`,
  );
}

/** What a control carries so the walk can reach it by what it *is* rather than
 *  by where it sits.
 *
 *  `attribute` is an attribute the shell already writes for its own reasons —
 *  every mark here is a `data-*` name except `role`, which a primitive sets —
 *  and `value` narrows it when a surface holds several. A mark whose value is
 *  omitted matches any, and it is omitted rather than passed `undefined`:
 *  `exactOptionalPropertyTypes` is on, and the absence is the fact being
 *  stated. */
export interface Mark {
  readonly attribute: string;
  readonly value?: string;
}

/**
 * Tabs until the focused element carries `mark`, and answers that value.
 *
 * {@link tabUntil}'s sibling for the marks a control already carries: a group
 * row's own entry control, a palette card named `graphite`, the arm control of
 * one shortcut row. The predicate is the attribute itself, so nothing here
 * bakes in a Tab count or a position the shell is free to change, and the bound
 * reports how many presses it spent rather than hanging.
 *
 * Re-entrant for the reason {@link tabUntil} is: it clears the marks of
 * whatever walk came before it.
 */
export async function tabToMark(
  page: Page,
  mark: Mark,
  limit = TAB_BOUND,
): Promise<string> {
  await clearWalkMarks(page);
  for (let press = 0; press < limit; press++) {
    const carried = await page.evaluate(
      (args: { readonly attribute: string; readonly value: string | null }) => {
        const value = document.activeElement?.getAttribute(args.attribute);
        if (value === null || value === undefined) return null;
        if (args.value !== null && value !== args.value) return null;
        return value;
      },
      // `null`, not `undefined`, for "any value": an optional field survives
      // the trip into the page as itself, and the sentinel is a value the
      // attribute can never carry.
      { attribute: mark.attribute, value: mark.value ?? null },
    );
    if (carried !== null) return carried;
    await page.keyboard.press("Tab");
  }
  throw new Error(
    mark.value === undefined
      ? `no element carrying ${mark.attribute} took focus in ${limit} presses`
      : `no element carrying ${mark.attribute}="${mark.value}" took focus in ${limit} presses`,
  );
}

/** Whether focus is inside the element `selector` names.
 *
 *  The question Review Focus 3 turns on, asked the only way it can be: a popup
 *  that is visible proves nothing about where the keyboard is, and `closest`
 *  answers for the focused element rather than for a descendant of it. */
export async function focusedWithin(
  page: Page,
  selector: string,
): Promise<boolean> {
  return page.evaluate((scope: string) => {
    const active = document.activeElement;
    return active !== null && active.closest(scope) !== null;
  }, selector);
}
