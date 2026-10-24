import { expect, type Page } from "@playwright/test";
import { HOST_PORT, HOST_THEME_ID } from "./host-theme.js";
import {
  focusedWithin,
  REGION_SELECTOR,
  TAB_BOUND,
  tabToMark,
  tabUntil,
} from "./walkthrough-focus.js";

/**
 * The shell's own keyboard vocabulary: the gestures §13.1's order is made of,
 * and the projecting reads they are asserted against.
 *
 * Split out of `host-walkthrough.spec.ts` under Ruling L. Where a control is and
 * how focus reaches it is `walkthrough-focus.ts`'s; what a control *means* —
 * a document, a rail pane, a selected row, a field — is this module's, and the
 * spec holds the tests and nothing else. The settings modal's own vocabulary
 * (§4's palette, the shortcut capture) is `walkthrough-settings.ts`'s, split out
 * of here when it passed AGENTS.md's 800-line stop.
 */

const HOST = `http://127.0.0.1:${HOST_PORT}`;

/** Opens the editor on the real host and waits for the shell to be complete.
 *
 * The wait is for the stage's zoom cluster, not for `.editor-shell`: the shell
 * element exists before its hosts do, and a census taken then would be a census
 * of a half-built focus order. The cluster is a stage control that only renders
 * once the bridge is set, which is the same fact as "the shell is wired".
 *
 * **`?theme=` names the document rather than letting the boot choose one.** A
 * bare `/editor/` resumes the author's most recent save (`boot-theme.ts`), and
 * with the host fixture's ten themes written in one pass several of them share
 * an mtime — compared at millisecond precision, so a tie is ordinary rather
 * than exotic. Two runs of this very test opened `E2E missing` and then
 * `E2E deliberate bleed`: one object in the tree against three, and a census
 * whose press count moved from 18 to 26 for a reason that is not the finder's.
 * The fixture that is seeded for it, `HOST_THEME_ID`, is the one the settings
 * spec works against, and naming it makes the tree, the dock and the count the
 * same on every run. That a bare mount resumes arbitrarily among themes with
 * equal mtimes is `vg-363`, filed rather than repaired here. */
export async function openWalkthrough(page: Page): Promise<void> {
  await page.goto(`${HOST}/editor/?theme=${HOST_THEME_ID}`);
  await expect(page.locator(".editor-shell-zoom")).toBeVisible();
}

/**
 * Selects a layer with the keyboard alone, so the inspector has content.
 *
 * The census's fourth region is the inspector, and §13.1's requirement is a
 * region **with content** — the user's ruling of 2026-10-12, which is what
 * `vg-362` was filed to settle. While nothing is selected the column renders one
 * paragraph and legitimately contributes no tab stop; the populated walk
 * therefore needs a selection first, and it is made the way an author makes it,
 * with no pointer.
 *
 * **Space selects; Enter renames.** A composition row gives `Enter` and `F2` to
 * its rename field and selection takes `Space` (`composition-pane.tsx`), the key
 * a list has always used for it. A helper pressing Enter would open a rename
 * input and leave the inspector empty — indistinguishable, from the census's
 * side, from the defect this walk exists to disprove.
 *
 * Waits on the column having a control rather than on the bridge, because the
 * region the next walk has to reach is a DOM fact and `bridge.selectLayer` is
 * not on this mount's window.
 */
export async function selectInPaneByKeyboard(page: Page): Promise<void> {
  await tabUntil(page, (focus) => focus.region === "pane");
  await focusLayerRow(page, undefined);
  await page.keyboard.press(" ");
  await expect(
    page.locator(
      ".editor-shell-inspector input, .editor-shell-inspector button",
    ),
    "the inspector has no control after a keyboard selection",
  ).not.toHaveCount(0);
}

/**
 * Tabs inside the pane until focus is on a layer row, and answers its id.
 *
 * `name` is the row's own `.yunari-layer-name`; `undefined` accepts the first
 * row focus reaches, which is what {@link selectInPaneByKeyboard} — the
 * census's unnamed selection — asks for. The search is by **name, not by a Tab
 * count**, so nothing here bakes in a position the shell is free to change, and
 * the bound reports how many presses it spent rather than hanging.
 */
export async function focusLayerRow(
  page: Page,
  name: string | undefined,
): Promise<string> {
  for (let press = 0; press < TAB_BOUND; press++) {
    const id = await page.evaluate((wanted: string | undefined) => {
      const active = document.activeElement;
      const row = active?.getAttribute("data-yunari-layer");
      if (row === null || row === undefined) return null;
      if (wanted === undefined) return row;
      const shown = active?.querySelector(".yunari-layer-name")?.textContent;
      return (shown ?? "") === wanted ? row : null;
    }, name);
    if (id !== null) return id;
    await page.keyboard.press("Tab");
  }
  throw new Error(
    name === undefined
      ? `no layer row took focus in ${TAB_BOUND} presses`
      : `no layer row named ${name} took focus in ${TAB_BOUND} presses`,
  );
}

/**
 * Selects a named layer through the Composition pane, with no pointer.
 *
 * The pane is named first, because "through Composition" is part of the claim:
 * the row is the one that pane draws, and a run that had left another pane
 * showing would be selecting through something else. `Space` selects — a
 * composition row gives `Enter` and `F2` to its rename field
 * (`composition-pane.tsx`) — and the row's own `aria-selected` is the shell's
 * statement that the selection landed rather than a claim made here.
 *
 * Answers the row's object id, which is what addresses that row afterwards.
 */
export async function selectInComposition(
  page: Page,
  name: string,
): Promise<string> {
  await expect(
    page.locator('[data-yunari-panel="layers"]'),
    "the Composition pane the row is selected through",
  ).toBeVisible();
  await tabUntil(page, (focus) => focus.region === "pane");
  const id = await focusLayerRow(page, name);
  await page.keyboard.press(" ");
  await expect(
    page.locator(`[data-yunari-layer="${id}"]`),
    `the row named ${name} after Space`,
  ).toHaveAttribute("aria-selected", "true");
  return id;
}

/** Copy a spec names as literals — the File menu, the row this walk creates its
 *  document with, and the name that document gives itself. A renamed row or an
 *  upgraded starter reddens here rather than quietly stopping to be about the
 *  document. `STARTER_DOCUMENT_NAME` is the starter's own metadata name, which
 *  is what tells the created document apart from the fixture (`?theme=`). */
const FILE_MENU_NAME = "File";
const NEW_FROM_STARTER_ROW = "New from starter";
export const STARTER_DOCUMENT_NAME = "System dashboard";
/** Bounds for the two searches — the File menu's rows and the rail's slots —
 *  which report a count rather than hang.
 *
 *  **The rail's is the shell's whole tab order, not a handful of presses.** A
 *  walk that is already on one slot and wants one earlier in the rail crosses
 *  the pane, the stage, the inspector, the status bar and the header first,
 *  because Tab goes forwards and the rail is the first region in the body —
 *  which is the shell's order and not a detour around it. Measured on the
 *  assembled walk: from the Tokens slot to the Composition slot is 53 presses,
 *  so this takes the census's own whole-walk bound rather than a shorter one
 *  that would read a real route as a missing pane. */
const FILE_MENU_BOUND = 12;
const RAIL_BOUND = TAB_BOUND;

/** The Composition row this task's walk selects. It is the starter's own
 *  `wordmark` — a top-level text object — so the walk selects something that
 *  sits inside no group; a row whose group had to be entered first is a
 *  different interaction, and Task 4's. */
export const WALKTHROUGH_LAYER_NAME = "wordmark";

/** The draft a cancelled edit is given. Any string but the authored one leaves
 *  the field having really held it, which is what makes the cancel mean
 *  something: a field that never took the text would revert to the same value
 *  while proving nothing. */
export const FIELD_DRAFT = "walkthrough draft";

/** The heading that carries the selection's name (`selection-inspector/
 *  inspector.tsx`). Double-clicking it — or Enter while it has focus — opens
 *  the rename field. */
export const HEADING_HOOK = "[data-yunari-subject-name]";

/** The rename field the heading opens, on the focus target rather than a
 *  wrapper. It exists only while the name is being edited. */
const FIELD_HOOK = "[data-yunari-name]";

/** That field **inside the inspector**, which is what the three places that
 *  reach for it mean. Scoped because the hook is the inspector's own convention
 *  and nothing stops a second surface from carrying it: an unscoped match would
 *  find the other one and report a confusing mismatch rather than a clean
 *  failure. */
export const FIELD_SELECTOR = `${REGION_SELECTOR.inspector} ${FIELD_HOOK}`;

/** The canvas event `EditorHistory.save()` fires at the one place an entry is
 *  appended to the history (`history-manager/index.ts`) and nowhere else.
 *
 *  **There is no history length to read from the browser.** `#entries` is a
 *  private field and `EditorShellBridge` publishes no accessor — only
 *  `saveState`, `resetHistory`, `undo`, `redo` and `suspend` cross it — so this
 *  event is the application's own statement that an entry landed, which is the
 *  strongest thing actually observable rather than a count this file invents. */
const EDIT_COMMITTED = "editor:edit-committed";

/** Where the count lives on the page while the listener is attached. A
 *  test-owned name: no shell style or script reads it. */
const WALKTHROUGH_COMMITS = "__yunariWalkthroughEditCommits";

/** The canvas the listener above attached to, kept so {@link editCommits} can
 *  tell a live attach from one the editor has outlived. */
const WALKTHROUGH_CANVAS = "__yunariWalkthroughCanvas";

/** Opens the File menu and presses the row whose own text names `row`, with no
 *  pointer.
 *
 * The route is the menu's own keyboard model, not an invented order: Tab reaches
 * the `File` trigger (the census's own first press), `ArrowDown` opens a menu on
 * its first row the way a menu button does, `ArrowDown` moves between rows and
 * `Enter` activates the row it is on. Which row is answered by its own name, so
 * no press count is baked in, and the bound reports one rather than hanging.
 *
 * Shared by the two File-menu routes the walk makes — creating its document and
 * returning to the one it booted on — because they differ in the row they name
 * and in nothing else. */
async function chooseFileMenuRow(page: Page, row: string): Promise<void> {
  await tabUntil(
    page,
    (focus) => focus.tag === "button" && focus.name === FILE_MENU_NAME,
  );
  await page.keyboard.press("ArrowDown");
  for (let press = 0; press < FILE_MENU_BOUND; press++) {
    const onRow = await page.evaluate(
      (wanted: string) =>
        (document.activeElement?.textContent ?? "").includes(wanted),
      row,
    );
    if (onRow) {
      await page.keyboard.press("Enter");
      return;
    }
    await page.keyboard.press("ArrowDown");
  }
  throw new Error(`no menu row naming ${row} in ${FILE_MENU_BOUND} presses`);
}

/** Creates a document through the shell's own File menu, with no pointer.
 *
 * **"Create or open" is discharged by creating**, on the row that creates a
 * document **with content**: `New theme` is blank, and a blank document is a
 * different walkthrough — the Composition pane it lands on has nothing to
 * select, and selection is §13.1's next interaction.
 *
 * It ends on the document naming itself, which is what makes it safe to call
 * before the next step: the create remounts the shell, and the identity chip can
 * only say the created name once the new shell is wired. */
export async function openDocumentByKeyboard(page: Page): Promise<void> {
  await chooseFileMenuRow(page, NEW_FROM_STARTER_ROW);
  await expect(
    page.locator(".editor-shell-identity-name"),
    "the created document's own name",
  ).toHaveText(STARTER_DOCUMENT_NAME);
}

/** The File menu's own row for the library (`uiCopy.file.openLibrary`), and the
 *  chooser's own pieces (`theme-library-dialog.tsx` / `control-select.tsx`). */
const OPEN_LIBRARY_ROW = "Open library";
/** The chooser's theme picker, on its trigger — where the value it commits is
 *  also read (`data-yunari-value`). */
const LIBRARY_THEME_FIELD = "data-yunari-library-theme";
/** The chooser's own Open button. */
const LIBRARY_OPEN = "data-yunari-library-open";
/** The value behind one option of a plan-1 select. The picker renders labels,
 *  and a label here is the theme's own metadata name, which is document data
 *  rather than an id a test may match on. */
const LIBRARY_OPTION = "data-yunari-option";
/** How many presses the option search spends before it reports a count. The
 *  fixture's theme is one row below the product's own template. */
const LIBRARY_BOUND = 40;

/** Opens a stored theme through the library dialog, with no pointer.
 *
 * **This is §13.1's return trip.** Under the walkthrough's own ruling the
 * "original document" is the host fixture the walk booted on (`?theme=`), and
 * the editor has no route back to it that is not the library: `File`'s
 * `uiCopy.file.openLibrary` row opens the chooser, the chooser lists the host's
 * own themes beside the product's template, and `Open` replaces the document —
 * all of it reached with Tab, the arrows and Enter.
 *
 * The picker is a plan-1 `ControlSelect` (Base UI's select), so the keyboard
 * model is the primitive's own: `ArrowDown` on the trigger opens the list and
 * focuses a row, the arrows move between rows, and `Enter` commits. The walk
 * moves **downwards only**, because the rows are the product's template first
 * and the author's own themes under it (measured: the trigger opens with the
 * template focused), so a stored theme is always below where the list opens.
 * Which row carries focus is read from the row itself — the primitive moves DOM
 * focus onto the option, it does not point at it with `aria-activedescendant` —
 * and the row is named by `data-yunari-option`, so the id this helper is given
 * and the id the control commits are one string.
 *
 * `id` is asserted as committed before `Open` is pressed, so a walk that
 * committed the wrong theme fails here rather than reporting the fixture's
 * content as unchanged. */
export async function openThemeFromLibrary(
  page: Page,
  id: string,
): Promise<void> {
  await chooseFileMenuRow(page, OPEN_LIBRARY_ROW);
  await expect(
    page.locator(`[${LIBRARY_THEME_FIELD}]`),
    "the library chooser's theme field",
  ).toBeVisible();

  await tabToMark(page, { attribute: LIBRARY_THEME_FIELD });
  await page.keyboard.press("ArrowDown");
  for (let press = 0; press < LIBRARY_BOUND; press++) {
    const on = await page.evaluate(
      (attribute: string) =>
        document.activeElement?.getAttribute(attribute) ?? "",
      LIBRARY_OPTION,
    );
    if (on === id) break;
    if (press === LIBRARY_BOUND - 1) {
      throw new Error(
        `the library offered no theme ${id} in ${LIBRARY_BOUND} presses`,
      );
    }
    await page.keyboard.press("ArrowDown");
  }
  await page.keyboard.press("Enter");
  await expect(
    page.locator(`[${LIBRARY_THEME_FIELD}] [data-yunari-value]`),
    `the theme the chooser committed rather than ${id}`,
  ).toHaveAttribute("data-yunari-value", id);

  await tabToMark(page, { attribute: LIBRARY_OPEN });
  await page.keyboard.press("Enter");
}

/** The open document as the product serializes it for persistence and publish
 *  (`session.publishableDocument()`, which is the same envelope `savePackage`
 *  writes). The strongest available reading of "the document", and the one the
 *  round trip compares: a projection or a row count would answer a narrower
 *  question than "the same document came back".
 *
 *  Throws rather than answering `undefined` for a document that has no stored
 *  theme — a `New theme` or a starter has no envelope to compare, and an
 *  `undefined` compared against an `undefined` is the silent green this walk
 *  must not carry. */
export async function serializedDocument(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const bridge = (
      window as unknown as {
        yunariEditorBridge?: {
          session?: {
            publishableDocument(): { envelope: unknown } | undefined;
          };
        };
      }
    ).yunariEditorBridge;
    if (bridge?.session === undefined) {
      throw new Error("no editor bridge on this mount");
    }
    const published = bridge.session.publishableDocument();
    if (published === undefined) {
      throw new Error(
        "this document has no stored theme, so it has no serialized state to compare",
      );
    }
    return published.envelope;
  });
}

/** Chooses a rail pane by its spoken name, with no pointer.
 *
 * Tab reaches the rail's slot button of that name — the census's own region, in
 * the shell's own tab order — and `Enter` presses it. The claim it makes for
 * itself is that the shell took the choice (`aria-pressed`), because a press
 * that did nothing would leave the next step measuring the pane the walk was
 * already on. Which pane is now *showing* is the caller's: the slot's label and
 * the pane's DOM name are two vocabularies and the shell owns the mapping. */
export async function chooseRailPane(page: Page, name: string): Promise<void> {
  await tabUntil(
    page,
    (focus) =>
      focus.region === "rail" && focus.tag === "button" && focus.name === name,
    RAIL_BOUND,
  );
  const slot = await page.evaluate(() =>
    document.activeElement?.getAttribute("data-rail-slot"),
  );
  if (slot === null || slot === undefined) {
    throw new Error(`the rail button named ${name} carries no slot`);
  }
  await page.keyboard.press("Enter");
  await expect(
    page.locator(`button[data-rail-slot="${slot}"]`),
    `the rail slot ${name} after Enter`,
  ).toHaveAttribute("aria-pressed", "true");
}

/**
 * Opens the selection's name field, drafts a value into it, and cancels it.
 *
 * The field is reached the way a keyboard user reaches one — by Tab, from
 * wherever the walk left focus — never by `focus()`. So the edit is the
 * interaction §13.1 names, not a call to the control behind it.
 *
 * **Escape is the cancel and the value coming back is the assertion.**
 * `ControlText` keeps the draft in its own state and commits on Enter or blur,
 * so a cancelled edit writes nothing: the field shows the authored value again.
 * The draft is asserted to have landed *first* (`not.toHaveValue`), or a field
 * that never took the text would pass while proving nothing.
 *
 * Answers the value the field went back to, which is what the caller can then
 * assert about the document without re-deriving it from a second surface.
 */
export async function editFieldThenCancel(page: Page): Promise<string> {
  const field = page.locator(FIELD_SELECTOR);
  await tabUntil(page, (focus) => focus.region === "inspector");
  // The name is the heading's now: tab to the heading, then Enter opens its
  // field. Reaching it by keyboard is what keeps this a control and not a
  // pointer-only affordance.
  for (let press = 0; press < TAB_BOUND; press++) {
    const onHeading = await page.evaluate(
      (sel: { readonly hook: string; readonly scope: string }) => {
        const active = document.activeElement;
        return (
          active !== null &&
          active.matches(sel.hook) &&
          active.closest(sel.scope) !== null
        );
      },
      { hook: HEADING_HOOK, scope: REGION_SELECTOR.inspector },
    );
    if (onHeading) break;
    await page.keyboard.press("Tab");
    if (press === TAB_BOUND - 1) {
      throw new Error(
        `no ${HEADING_HOOK} heading took focus in ${TAB_BOUND} presses`,
      );
    }
  }
  await page.keyboard.press("Enter");
  await expect(field).toBeVisible();

  const original = await field.inputValue();
  await page.keyboard.press("End");
  await page.keyboard.type(FIELD_DRAFT);
  await expect(field, "the draft before it is cancelled").not.toHaveValue(
    original,
  );
  await page.keyboard.press("Escape");
  await expect(field, "the field after Escape").toHaveValue(original);
  return original;
}

/** The document as the application projects it: the very rows the Composition
 *  pane renders, read back from the bridge. Selection is part of the
 *  projection, so a row that lost its selection moves this as well as a row
 *  that lost its name.
 *
 *  Comparing this before and after is what "the document is unchanged" means
 *  for a cancelled edit **from the state the document was created in** — the
 *  walk's own baseline, not the fixture it booted on. */
export async function layerTree(page: Page): Promise<readonly unknown[]> {
  return page.evaluate(() => {
    const bridge = (
      window as unknown as {
        yunariEditorBridge?: { layers(): readonly unknown[] };
      }
    ).yunariEditorBridge;
    if (bridge === undefined) {
      throw new Error("no editor bridge on this mount");
    }
    return bridge.layers();
  });
}

/** Attaches the history-commit listener, or fails saying it could not.
 *
 *  A mount with no canvas would leave the count at its sentinel and a "no
 *  entries were added" assertion would pass having observed nothing — so the
 *  attach answers whether it happened and this throws when it did not. The
 *  other half of that liveness is {@link editCommits}: an attach that happened
 *  and then went stale reads 0 forever. */
export async function watchEditCommits(page: Page): Promise<void> {
  const attached = await page.evaluate(
    (names: {
      readonly event: string;
      readonly key: string;
      readonly canvasKey: string;
    }) => {
      const scope = window as unknown as Record<string, unknown> & {
        yunariEditorBridge?: {
          readonly editor?: {
            readonly canvas?: {
              on(name: string, listener: () => void): void;
            };
          };
        };
      };
      const canvas = scope.yunariEditorBridge?.editor?.canvas;
      if (canvas === undefined) return false;
      scope[names.key] = 0;
      // The instance itself, so the reader can tell a live attach from a stale
      // one rather than trusting that a listener it cannot see still fires.
      scope[names.canvasKey] = canvas;
      canvas.on(names.event, () => {
        scope[names.key] = ((scope[names.key] as number | undefined) ?? 0) + 1;
      });
      return true;
    },
    {
      event: EDIT_COMMITTED,
      key: WALKTHROUGH_COMMITS,
      canvasKey: WALKTHROUGH_CANVAS,
    },
  );
  if (!attached) {
    throw new Error(
      "no editor canvas on this mount: a cancelled edit's history cannot be observed",
    );
  }
}

/** How many history entries the application has recorded since
 *  {@link watchEditCommits}. `-1` when nothing was ever attached, which no
 *  assertion here reads as zero.
 *
 *  **Reading throws when the watched canvas is no longer the published one.** A
 *  listener attached to a canvas the editor has since replaced would count 0
 *  forever, and "no history entry was added" would pass having observed
 *  nothing — the same silent green the attach guard exists to prevent, one step
 *  later. The bridge is re-published on every remount, so the comparison is
 *  cheap and the failure is the honest one. */
export async function editCommits(page: Page): Promise<number> {
  return page.evaluate(
    (names: { readonly key: string; readonly canvasKey: string }) => {
      const scope = window as unknown as Record<string, unknown> & {
        yunariEditorBridge?: {
          readonly editor?: { readonly canvas?: unknown };
        };
      };
      const count = scope[names.key];
      if (count === undefined) return -1;
      if (scope[names.canvasKey] !== scope.yunariEditorBridge?.editor?.canvas) {
        throw new Error(
          "the watched canvas is no longer the one the editor publishes: a cancelled edit's history cannot be observed",
        );
      }
      return count as number;
    },
    { key: WALKTHROUGH_COMMITS, canvasKey: WALKTHROUGH_CANVAS },
  );
}

/** What a cancelled Escape must have left open, as one object, so three
 *  moments — before the edit, after the first Escape, after the second — can be
 *  compared for being the same rather than asserted one line at a time.
 *
 *  The four are the field's own surroundings and nothing else: the Composition
 *  pane the selection was made through, the selection itself, the document the
 *  shell names, and the field the draft lived in. */
export async function surroundingState(
  page: Page,
  id: string,
): Promise<{
  readonly pane: boolean;
  readonly selected: string | null;
  readonly document: string | null;
  readonly field: boolean;
}> {
  const chip = page.locator(".editor-shell-identity-name");
  return {
    pane: await page.locator('[data-yunari-panel="layers"]').isVisible(),
    selected: await page
      .locator(`[data-yunari-layer="${id}"]`)
      .getAttribute("aria-selected"),
    // Visibility is part of the reading, not a separate assertion: a hidden
    // chip still answers `textContent()`, so the leg would hold while the shell
    // said nothing where a reader can see it. The other three legs read state
    // the same way, and `null` is what a hidden one contributes.
    document: (await chip.isVisible()) ? await chip.textContent() : null,
    field: await page.locator(FIELD_SELECTOR).isVisible(),
  };
}

/** Marks the four interactions after Task 3 reach their controls by. Every one
 *  is an attribute the shell already writes for its own reasons, so a renamed
 *  class or a moved control reddens here rather than quietly reaching nothing. */
/** The Composition row's own entry control, whose value says which way it goes
 *  (`composition-pane.tsx`): `enter` into the group, `leave` back out of it. */
const LAYER_ENTRY = "data-yunari-layer-entry";
/** A row itself, addressed by the object id the projection gives it. */
export const LAYER_ROW = "data-yunari-layer";
/** The stage's display-and-zoom readout, which is a popup's trigger
 *  (`display-switch.tsx`). Marked rather than named: its accessible name
 *  carries the readout's own percentage, which moves with the camera. */
const DISPLAY_TRIGGER = "data-yunari-zoom";
/** Bounds smaller than {@link TAB_BOUND}, for the one search whose answer is a
 *  handful of presses away: the controls inside a row, ahead of the row itself.
 *  It reports a count rather than hanging. */
const ROW_BOUND = 4;

/** The entered group's ids, as the bridge publishes them — never Fabric
 *  objects, which is what makes this readable from a test at all
 *  (`bridge.ts`'s `groupContext`). */
export async function groupContext(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const bridge = (
      window as unknown as {
        yunariEditorBridge?: { groupContext(): readonly string[] };
      }
    ).yunariEditorBridge;
    if (bridge === undefined) {
      throw new Error("no editor bridge on this mount");
    }
    return bridge.groupContext();
  });
}

/** The layer row the focused element sits in, which is what addresses that row
 *  afterwards — the same identity {@link focusLayerRow} answers with. */
async function focusedLayerId(page: Page): Promise<string> {
  const id = await page.evaluate(() => {
    const active = document.activeElement;
    if (active === null) return null;
    return (
      active.getAttribute("data-yunari-layer") ??
      active.closest("[data-yunari-layer]")?.getAttribute("data-yunari-layer")
    );
  });
  if (id === null || id === undefined) {
    throw new Error("the focused element is not inside a layer row");
  }
  return id;
}

/**
 * Enters the first group the Composition pane offers, with no pointer.
 *
 * **The pane's own control is the route**, not a canvas gesture: a group row
 * that has focus draws an entry control (`composition-pane.tsx`), `Enter`
 * presses it, and the control then names the *other* direction — which is the
 * panel's own statement that the context changed rather than a claim made here.
 * {@link groupContext} is the bridge's statement of the same fact, and the two
 * are asserted together because they are the two halves of "the group was
 * entered": what the tree draws, and what the canvas has.
 *
 * **Entering a group expands it in the layer panel, and that is the answer
 * plan 3 named and did not settle.** The projection's expanded set is the
 * author's own openings *plus the entered group's ancestor path*
 * (`bridge.ts`'s `expansionFor`), so the row's twisty goes from shut to open —
 * and the walk asserts the shut state first, so the expansion is the entry's
 * doing rather than something the panel was already showing. The reason it
 * expands rather than merely dimming is in the same place: a nested entry whose
 * parent stayed shut would expand a row the panel never draws.
 *
 * Answers the group's id, which is what addresses that row afterwards.
 */
export async function enterGroup(page: Page): Promise<string> {
  await tabUntil(page, (focus) => focus.region === "pane");
  await tabToMark(page, { attribute: LAYER_ENTRY, value: "enter" });
  const id = await focusedLayerId(page);
  const twisty = page.locator(`[${LAYER_ROW}="${id}"] button[aria-expanded]`);
  expect(
    await twisty.getAttribute("aria-expanded"),
    `the group ${id} before it was entered`,
  ).toBe("false");

  await page.keyboard.press("Enter");

  const entry = page.locator(`[${LAYER_ROW}="${id}"] [${LAYER_ENTRY}]`);
  await expect(
    entry,
    `the row ${id} after Enter on its entry control`,
  ).toHaveAttribute(LAYER_ENTRY, "leave");
  expect(
    await groupContext(page),
    `the entered context after entering ${id}`,
  ).toEqual([id]);
  await expect(
    twisty,
    `the entered group ${id} in the layer panel`,
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    entry,
    "the control the interaction left focus on",
  ).toBeFocused();
  return id;
}

/**
 * Leaves the entered group through the pane's own control, with no pointer.
 *
 * Not `Escape`: that key is `view.exit-group`, and the deferral that binding
 * takes inside a text field is the thing
 * `host-walkthrough.spec.ts` drives separately. This is the deliberate gesture,
 * and it asserts what leaving means — an empty context, the row's control
 * naming the other direction again, and focus still on it.
 *
 * Answers the id of the group that was left.
 */
export async function exitGroup(page: Page): Promise<string> {
  await tabToMark(page, { attribute: LAYER_ENTRY, value: "leave" });
  const id = await focusedLayerId(page);
  await page.keyboard.press("Enter");

  const entry = page.locator(`[${LAYER_ROW}="${id}"] [${LAYER_ENTRY}]`);
  await expect(
    entry,
    `the row ${id} after Enter on its leave control`,
  ).toHaveAttribute(LAYER_ENTRY, "enter");
  expect(
    await groupContext(page),
    `the entered context after leaving ${id}`,
  ).toEqual([]);
  await expect(
    entry,
    "the control the interaction left focus on",
  ).toBeFocused();
  return id;
}

/**
 * Opens the rename field on the row the walk is on, with no pointer.
 *
 * `Enter` and `F2` are the row's own keys for it (`composition-pane.tsx`), and
 * the field does not exist until one of them is pressed — so this presses
 * `Enter` on the row rather than reaching for a field. The row is reached by
 * `Shift+Tab` from wherever the walk left focus, which is the index's own
 * control when {@link enterGroup} has just run.
 *
 * It exists because a text entry is what makes `view.exit-group`'s deferral
 * observable: the binding is deferred while the target consumes the key
 * (`consumesKey`, true for every key a text field owns), and with nothing
 * entered an Escape that reached it and one that did not look the same —
 * `exitGroup()` on an empty context is a no-op.
 */
export async function openLayerRenameField(page: Page): Promise<void> {
  for (let press = 0; press < ROW_BOUND; press++) {
    const onRow = await page.evaluate(
      () => document.activeElement?.hasAttribute("data-yunari-layer") === true,
    );
    if (onRow) {
      await page.keyboard.press("Enter");
      return;
    }
    await page.keyboard.press("Shift+Tab");
  }
  throw new Error(`no layer row took focus in ${ROW_BOUND} presses`);
}

/**
 * Opens the stage's display-and-zoom popup with no pointer, and asserts where
 * focus went.
 *
 * **Review Focus 3 is the whole assertion.** That the popup is visible is not
 * the claim — a popup that opened with focus left behind on its trigger is
 * visible too, and its first Tab walks the page instead of the popup — so the
 * assertion is on the focused element: it is inside `[role="menu"]`, and it is
 * not the trigger.
 *
 * The trigger is the stage's zoom readout (`display-switch.tsx`), and
 * `ArrowDown` is the menu button's own key for opening itself on its first row,
 * the same gesture `openDocumentByKeyboard` uses on the File menu.
 */
export async function openPopup(page: Page): Promise<void> {
  await tabToMark(page, { attribute: DISPLAY_TRIGGER });
  const trigger = page.locator(`[${DISPLAY_TRIGGER}]`);
  await page.keyboard.press("ArrowDown");

  await expect(
    page.getByRole("menu"),
    "the popup the trigger opened",
  ).toBeVisible();
  expect(
    await focusedWithin(page, '[role="menu"]'),
    "the popup opened with focus inside it rather than left on its trigger",
  ).toBe(true);
  await expect(
    trigger,
    "the trigger focus was left behind on",
  ).not.toBeFocused();
}

/** Closes the popup the walk opened, with no pointer, and asserts the contract
 *  DESIGN.md gives every popup: it goes, and focus comes back to the trigger
 *  that opened it. */
export async function closePopup(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu"), "the popup after Escape").toBeHidden();
  await expect(
    page.locator(`[${DISPLAY_TRIGGER}]`),
    "the trigger focus came back to",
  ).toBeFocused();
}
