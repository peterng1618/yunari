import { expect, test } from "@playwright/test";
import { HOST_THEME_ID } from "./host-theme.js";
import {
  FIRST,
  keyboardReach,
  REGIONS,
  type Region,
  tabUntil,
} from "./walkthrough-focus.js";
import {
  cancelShortcutCapture,
  choosePalette,
  paletteNotInForce,
  SETTINGS_MODAL_CLASS,
} from "./walkthrough-settings.js";
import {
  chooseRailPane,
  closePopup,
  editCommits,
  editFieldThenCancel,
  enterGroup,
  exitGroup,
  FIELD_DRAFT,
  FIELD_SELECTOR,
  groupContext,
  LAYER_ROW,
  layerTree,
  openDocumentByKeyboard,
  openLayerRenameField,
  openPopup,
  openThemeFromLibrary,
  openWalkthrough,
  STARTER_DOCUMENT_NAME,
  selectInComposition,
  selectInPaneByKeyboard,
  serializedDocument,
  surroundingState,
  WALKTHROUGH_LAYER_NAME,
  watchEditCommits,
} from "./walkthrough-shell.js";

/**
 * §13.1's keyboard-only walkthrough, on the real host.
 *
 * The editor is driven through the host's own `/editor/` mount, never a preview
 * server: the walkthrough's own round trip ends by asking whether the document
 * came back unchanged, and the document is the host's file. `desktop-host`
 * boots that host through its `webServer`.
 *
 * **This file is a host spec for the reason the others are**, and
 * `playwright.config.ts`'s `HOST_SPECS` admits it by name for the same reason.
 *
 * **What this file holds is §13.1's whole instrument**: the census (§13.1's
 * "each region has a reachable focus target", asked in the two states the user's
 * ruling puts it in), a test for each interaction proved on its own page state,
 * and the **assembled walk** at the end — the nine interactions in §13.1's own
 * order, ending at the round trip, with both of §13.1's other invariants swept in
 * the state the walk leaves. That last test is what the Acceptance item for
 * keyboard and contrast is read from.
 *
 * **The census was red, and the red was its result — not a broken test.** The
 * walk reached the rail, the pane and the stage and never the inspector, because
 * with nothing selected the column renders one paragraph and a paragraph is not
 * a focus target. That is `vg-362`.
 *
 * **The user ruled on 2026-10-12 that §13.1's "each region has a reachable focus
 * target" means a region that has CONTENT.** The empty inspector therefore
 * contributes no tab stop legitimately, no product change is owed, and what
 * changed is this census: it walks the shell as it opens, makes a selection with
 * the keyboard alone, and walks it a second time, reporting both walks. `REGIONS`
 * is still the same four — trimming it to the regions an opening-state walk
 * reaches remains the forbidden move, and a green here does not license it.
 *
 * **The primitives are `walkthrough-focus.ts`'s, the shell's vocabulary is
 * `walkthrough-shell.ts`'s and the settings modal's is
 * `walkthrough-settings.ts`'s** (Ruling L): the split is by responsibility
 * because the file had passed the 800-line stop, and the second split is
 * the same rule applied again when Task 4's helpers took the shell module past
 * it. What is left here is the tests, which is what the walkthrough's acceptance
 * is read from.
 */

/** The host fixture's own metadata name, which is what the identity chip reads
 *  on the mount `?theme=` boots (`host-theme.ts`'s
 *  `envelopeFor(HOST_THEME_ID, "E2E hosted", …)`). A literal for the same
 *  reason `STARTER_DOCUMENT_NAME` is one: renaming the fixture reddens here
 *  rather than quietly leaving the round trip unasserted. */
const FIXTURE_DOCUMENT_NAME = "E2E hosted";

test.describe("the shell, reached by keyboard alone", () => {
  /**
   * **Two walks, and the union is what the region list is read against.**
   *
   * §13.1's sentence — "Each region has a reachable focus target" — does not
   * itself fix *when*, and the census found the difference: walked as the shell
   * opens, three of the four regions take focus and the inspector never does,
   * because it renders one paragraph while nothing is selected and a paragraph
   * is not a focus target. That was `vg-362`, filed as a rule question rather
   * than repaired.
   *
   * **The user ruled on 2026-10-12 that the requirement means a region with
   * content**, so an empty inspector legitimately contributes no tab stop and
   * no product change is owed. The census is what changes: it takes the opening
   * walk, makes a keyboard selection, and takes a second walk over the shell
   * where each region now has content. `REGIONS` is unchanged at four — a red
   * here still means the census ran and found what it found, and trimming the
   * list to the regions that pass is still the forbidden move. What changed is
   * *which walk* the fourth region is asserted in.
   *
   * **Both walks are reported and only their union is asserted**, because which
   * regions the opening state reaches is evidence about the shell that a merged
   * list cannot answer, and a failure should print both.
   *
   * The name half is proved to have teeth: with the region list reduced to the
   * three reached ones and the name assertion pointed at an element with no
   * accessible name, the run gets past the reachability assertion and fails on
   * the name — so neither half is vacuous.
   */
  test("the shell's regions each have a reachable, named focus target", async ({
    page,
  }) => {
    await openWalkthrough(page);
    const opening = await keyboardReach(page);
    // The inspector has content from here on, which is the state §13.1's
    // requirement is read in.
    await selectInPaneByKeyboard(page);
    const populated = await keyboardReach(page);

    const regionsReached = [
      ...new Set(
        [...opening, ...populated]
          .map((step) => step.region)
          .filter((region): region is Region => region !== null),
      ),
    ];

    expect(
      regionsReached,
      `the census, in Tab order:\nopening:\n${JSON.stringify(opening, null, 2)}\n` +
        `populated:\n${JSON.stringify(populated, null, 2)}`,
    ).toEqual(expect.arrayContaining([...REGIONS]));

    // **The second walk is the one that carries the fourth region.** Stated
    // separately so the union above cannot pass on the opening walk alone: the
    // opening state reaches three regions, and this is the claim the §13.1
    // ruling turns on — a populated inspector has a tab stop and an empty one
    // need not.
    expect(
      [...new Set(populated.map((step) => step.region))],
      `the populated walk should reach the inspector:\n${JSON.stringify(populated, null, 2)}`,
    ).toContain("inspector");

    // Reachable is not reachable if nothing can say its name (Review Focus 4),
    // so the first target in each region is asked what it is called.
    for (const region of REGIONS) {
      await expect(
        page.locator(`[${FIRST}="${region}"]`),
        `the first ${region} focus target`,
      ).toHaveAccessibleName(/\S/);
    }
  });

  /**
   * Two walks in one test, both of them whole.
   *
   * A walk marks every element it lands on and stops when it meets a mark, so a
   * mark left on the page makes the *next* walk stop on its first press — and
   * `tabUntil` throws on it rather than returning nothing. Every later task
   * runs more than one walk in a test (reach a region, then assert it can be
   * left), so the harness has to answer the same question twice on one page and
   * get the same answer.
   *
   * The regression is the second walk: with the marks not cleared between
   * walks, `keyboardReach` returns an empty record and this fails on the length
   * rather than on the agreement. It is asserted as an equality and not just as
   * "not empty", because a walk that skipped its first elements would also be
   * non-empty.
   */
  test("a second walk on the same page is a whole walk too", async ({
    page,
  }) => {
    await openWalkthrough(page);
    const first = await keyboardReach(page);
    const second = await keyboardReach(page);

    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });

  /**
   * A `tabUntil` after a `keyboardReach`, which is the shape every later task
   * has: census where focus can go, then go somewhere on purpose.
   *
   * This is the case the defect was reported against — `tabUntil` *throws* on a
   * mark rather than returning an empty record, so without the clear it dies on
   * its first press with "focus returned to a seen element after 1 presses".
   *
   * The destination is the pane, and that is the only claim here: the predicate
   * accepts the pane whenever it arrives, so nothing is asserted about what
   * sits between the rail and it. The rail-then-pane route happens to be what
   * the census walks; that it *is* the next region is not this test's business.
   */
  test("a tabUntil can follow a walk on the same page", async ({ page }) => {
    await openWalkthrough(page);
    const walk = await keyboardReach(page);
    // `tabUntil` answers only a focus its own predicate accepted, so asking
    // afterwards that the landing region *is* the pane would restate the
    // argument rather than test it. Reaching the pane is this call's own claim:
    // it throws otherwise.
    await tabUntil(page, (focus) => focus.region === "pane");

    expect(walk.some((step) => step.region === "pane")).toBe(true);
  });

  /**
   * §13.1's first two interactions, and both halves of Review Focus 1.
   *
   * A document is created and a rail pane is chosen, after which the pane is
   * asked the two questions a keyboard user needs answered: **can focus get
   * in**, and **can it get out**. Reached is not enough — a pane that traps Tab
   * is reachable and useless, and a trap is what a focus-order bug produces — so
   * one continuous walk looks for a *later* region (the stage) after the pane.
   * Arriving somewhere later is what "left" means; a second walk would prove
   * nothing about the order.
   *
   * The name half is Review Focus 4: the first pane element the walk reached is
   * asked for its accessible name by Playwright's own `toHaveAccessibleName`,
   * since a target nobody can name is not a target a voice user has.
   *
   * **Tokens is a deliberate pane.** It is not the one the shell opens on, so
   * the walk cannot pass on the opening state, and it holds controls of its own
   * whatever is selected. `layers` is asserted hidden beside it, because "the
   * pane I asked for is showing" is half an answer without "and the one I left
   * is not".
   */
  test("a document is created and a rail pane is chosen with no pointer", async ({
    page,
  }) => {
    await openWalkthrough(page);
    await openDocumentByKeyboard(page);
    await chooseRailPane(page, "Design tokens");

    await expect(
      page.locator('[data-yunari-panel="tokens"]'),
      "the Tokens pane after the rail choice",
    ).toBeVisible();
    await expect(
      page.locator('[data-yunari-panel="layers"]'),
      "the Composition pane after the rail choice",
    ).toBeHidden();

    const walk = await keyboardReach(page);
    const paneAt = walk.findIndex((step) => step.region === "pane");
    expect(
      paneAt,
      `the walk never reached the pane:\n${JSON.stringify(walk, null, 2)}`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      walk.slice(paneAt + 1).some((step) => step.region === "stage"),
      `focus did not leave the pane:\n${JSON.stringify(walk, null, 2)}`,
    ).toBe(true);

    await expect(
      page.locator(`[${FIRST}="pane"]`),
      "the first pane focus target",
    ).toHaveAccessibleName(/\S/);
  });

  /**
   * §13.1's third and fourth interactions: select through Composition, and edit
   * and cancel a field. Both halves of Review Focus 5 live here, because "the
   * document is unchanged" is the whole claim a cancelled edit makes — a field
   * that reverted while the document moved is a cancel that did not happen.
   *
   * The walk's document is the one the step before it created from the starter,
   * so the state it is unchanged from is that document's own, read once the
   * selection is in place: the field's surroundings and the layer projection the
   * Composition pane renders.
   *
   * **Review Focus 2 is the second claim, and it is not the same one.** §13.1
   * says Escape affects one innermost owner, so what this test asks after the
   * first Escape is not "did the field revert" — the helper answers that — but
   * what is still open: the field sits inside the inspector, inside the shell,
   * beside the pane the selection was made through, and all four are still
   * there. The second Escape is the other half: a cancel that needed two would
   * fail the first comparison, and one that reached a further owner on the way
   * out would fail the second.
   */
  test("a field is edited and cancelled, and the document is unchanged", async ({
    page,
  }) => {
    await openWalkthrough(page);
    await openDocumentByKeyboard(page);
    const id = await selectInComposition(page, WALKTHROUGH_LAYER_NAME);

    const before = await layerTree(page);
    // An empty projection would make "unchanged" mean nothing, so the state the
    // cancelled edit must leave alone is asserted to have something in it.
    expect(
      before.length,
      "the projection the Composition pane renders",
    ).toBeGreaterThan(0);
    const opened = await surroundingState(page, id);
    expect(opened, "the field's surroundings before it is edited").toEqual({
      pane: true,
      selected: "true",
      document: STARTER_DOCUMENT_NAME,
      field: true,
    });

    await watchEditCommits(page);
    const original = await editFieldThenCancel(page);

    expect(
      await editCommits(page),
      "history entries the cancelled edit recorded",
    ).toBe(0);
    expect(
      await layerTree(page),
      "the document after the cancelled edit",
    ).toEqual(before);
    await expect(
      page.locator(`[${LAYER_ROW}="${id}"] .yunari-layer-name`),
      "the row still reads the name the cancelled edit did not take",
    ).toHaveText(original);

    // One Escape, and exactly one owner closed: the field's draft.
    expect(
      await surroundingState(page, id),
      "Escape closed something above the field",
    ).toEqual(opened);
    expect(
      await page.locator(FIELD_SELECTOR),
      "the field focus stayed in",
    ).toBeFocused();

    // A second Escape is not needed, and reaches nothing further.
    await page.keyboard.press("Escape");
    expect(
      await surroundingState(page, id),
      "a second Escape changed something",
    ).toEqual(opened);
    expect(await editCommits(page), "history after a second Escape").toBe(0);
    expect(await layerTree(page), "the document after a second Escape").toEqual(
      before,
    );
  });

  /**
   * §13.1's fifth to eighth interactions, and the two questions Task 3 could not
   * ask.
   *
   * **The deferral, which needed a group to be entered to be observable.** Task
   * 3's review found the one outer owner Escape can reach from a text field:
   * the window-level `view.exit-group` binding, deferred while the target
   * consumes the key. With nothing entered `exitGroup()` is a no-op, so
   * no assertion could tell a deferred Escape from one that ran. Here a group is
   * entered first, so the Escape from the row's own rename field is the case
   * that distinguishes them: the field's draft goes and the context does not.
   *
   * **Entering a group expands it in the layer panel, and that is asserted
   * rather than assumed.** Plan 3 named the question and did not settle it; the
   * bridge answers it in code — the projection's expanded set is the author's
   * own openings *plus the entered group's ancestor path* (`bridge.ts`,
   * `expansionFor`) — so the row goes from shut to open. The assertion is in
   * `enterGroup`, which reads the twisty before it presses anything.
   *
   * **A popup opens with focus inside it** (Review Focus 3). Visibility is not
   * the claim: the popup this walk opens is the stage's display-and-zoom menu,
   * and what is asserted is where focus landed — a popup that opened with focus
   * left behind on its trigger fails here.
   *
   * The palette is DESIGN.md §4's shell palette, chosen in Settings, and it is
   * a choice rather than a re-press: `paletteNotInForce` owns that decision,
   * including why the palette already in force would assert nothing.
   *
   * The shortcut capture is cancelled with Escape and then proved not to have
   * taken a chord, which is what a cancel means: nothing was recorded. The
   * count and the last assertion of the walk are the helper's.
   */
  test("groups, a popup, a palette and a shortcut capture, by keyboard alone", async ({
    page,
  }) => {
    // The four interactions reach their controls the same way the assembled walk
    // does — a whole traverse of the shell per control — and the budget is
    // stated rather than inherited for the same reason. Playwright's 30 s
    // default was crossed twice in this close-out round (31.1 s) against 18.4 s
    // and 21.9 s measured earlier, and 23.1 s on these bytes with the box to
    // itself. 60 s is ~2× the slowest sample: room for a shared box, still close
    // enough that a genuine hang reports as a timeout rather than as a "flake".
    test.setTimeout(60_000);
    await openWalkthrough(page);
    // The walk's document is the one the step before created from the starter
    // (Ruling K) — eight groups, a palette and thirteen type presets — not the
    // host fixture `openWalkthrough` booted on.
    await openDocumentByKeyboard(page);

    // **The `field` leg of `surroundingState`, in its other value.** Every
    // other reading of that leg in this instrument is taken with something
    // selected, where it reads `true` — so a leg hard-coded to `true` would
    // satisfy the assembled walk's Escape sweep. Here the walk has just created
    // a document and chosen nothing, so the inspector has no name field on it.
    // The reading moves nothing, so the walk's order is untouched.
    const firstRow = await page
      .locator(`[${LAYER_ROW}]`)
      .first()
      .getAttribute(LAYER_ROW);
    if (firstRow === null) {
      throw new Error("the created document draws no layer row");
    }
    expect(
      (await surroundingState(page, firstRow)).field,
      "the inspector's name field before anything is selected",
    ).toBe(false);

    // 1. Into a group. The helper asserts the panel's own statement, the
    //    context the bridge publishes, and where focus is.
    const group = await enterGroup(page);

    // 2. Escape from a text field, with the group entered: the field's draft is
    //    cancelled and the group is **not** left. `view.exit-group` is bound on
    //    exactly this key.
    const row = page.locator(`[${LAYER_ROW}="${group}"]`);
    const name = (await row.locator(".yunari-layer-name").textContent()) ?? "";
    await openLayerRenameField(page);
    const rename = row.locator(".yunari-layer-rename");
    await expect(rename, "the row's own rename field").toBeFocused();
    await page.keyboard.type(FIELD_DRAFT);
    await expect(rename, "the draft before it is cancelled").not.toHaveValue(
      name,
    );
    // **The Escape that closes the field leaves focus on `document.body`**
    // (measured: `PROBE-AFTER-ESCAPE BODY|`), so every press after this point
    // restarts from the document root rather than resuming on the row. That is
    // `vg-389`, and it is out of this plan's scope — new focus management is its
    // own change with its own spec. The walk below is written not to depend on
    // it either way.
    await page.keyboard.press("Escape");
    await expect(rename, "the rename field after Escape").toHaveCount(0);
    expect(
      await groupContext(page),
      "the entered context after Escape from a text field",
    ).toEqual([group]);
    await expect(
      row.locator(".yunari-layer-name"),
      "the row's name after the cancelled rename",
    ).toHaveText(name);

    // 3. Out of the group, on its own control.
    expect(await exitGroup(page), "the group the deliberate exit left").toBe(
      group,
    );

    // 4. A popup, opened and closed.
    await openPopup(page);
    await closePopup(page);

    // 5. A palette, chosen rather than the one already in force.
    await choosePalette(page, await paletteNotInForce(page));

    // 6. A shortcut capture, armed and cancelled.
    const cancelled = await cancelShortcutCapture(page);
    await expect(
      page.locator(`[data-yunari-shortcut-arm="${cancelled}"]`),
      "the control the walk ended on",
    ).toBeFocused();
  });

  /**
   * **§13.1's acceptance instrument, and this plan's reason for existing.**
   *
   * The four tests above prove one interaction each, on their own page state.
   * This is the assembly: the nine interactions §13.1 names, in §13.1's own
   * order, as one continuous walk on the real host, ending at the round trip —
   * *"return to the original document without unintended history"*. A walk whose
   * steps each hold in isolation and stop holding in sequence is the failure
   * assembling them exists to find, which is why this test re-derives so little:
   * every helper asserts what its own interaction means, and what is added here
   * is the *order*, the two invariants §13.1 states swept in the state the walk
   * leaves, and the ending claim no individual test could make.
   *
   * **Two rail choices, and the second is not a repeat.** §13.1 puts "choose a
   * rail pane" before "select through Composition", and the walk is a change
   * rather than a re-press only if the pane it chooses is not the one already
   * showing: the shell opens on Composition, so `Tokens` is chosen first (the
   * pane Task 2 proved holds controls whatever is selected) and Composition is
   * chosen again because the next interaction's own claim is that selection goes
   * *through Composition* — `selectInComposition` asserts that pane is showing.
   * **The second rail choice costs 53 presses**, because Tab goes forwards and
   * Composition is the rail's first slot: the walk crosses the pane, the stage,
   * the inspector, the status bar and the header to come round to it, which is
   * the shell's own order rather than a detour — and it is why `RAIL_BOUND` is
   * the census's whole-walk bound and why this test declares itself slow.
   *
   * **The return trip is the library.** Under the walkthrough's own ruling the
   * original document is the `e2e-hosted` fixture `openWalkthrough` boots on, and
   * `File → Open library` is the editor's only keyboard route back to a stored
   * theme (`openThemeFromLibrary`, and the fixture is listed there as the host
   * wrote it). The library's own listing is what makes this a route rather than a
   * hope: the chooser reads `/api/themes`, which is the host's library folder,
   * and the fixture is one of its rows.
   *
   * **No press here positions focus by anything but Tab and the arrows.** The
   * walk never opens a layer rename, which is the one gesture whose Escape leaves
   * focus on `document.body` (`vg-389`, Task 4's measurement and this plan's
   * out-of-scope): the rename is Task 4's interaction, and what the walk does
   * with a field is Task 3's cancel, which leaves focus where it was. So nothing
   * below depends on focus surviving an Escape, and `vg-389` is not on this path.
   *
   * **History is read before the round trip leaves, not after.** The counter
   * watches the canvas the bridge publishes, and opening a theme remounts the
   * shell — so a read after the return would be a read of a canvas nobody edited,
   * which is why `editCommits` throws on exactly that. The claim is made while
   * the walk's own document is still the published one.
   */
  test("§13.1's nine interactions in order, on the real host, and the original document comes back", async ({
    page,
  }) => {
    // Nine interactions, each reaching its own control by pressing Tab: the two
    // rail choices alone spend 5 and 53 presses. The default budget fails it on
    // the clock rather than on the shell.
    //
    // **The budget is stated rather than inherited.** `test.slow()` would give
    // 3× the 30 s default — 90 s — with nothing in this file saying so, and the
    // walk measures **63.2 s** on an idle box (67.8 s for the file that holds it)
    // against **91.3 s, 92.2 s, 94.8 s and 96.1 s** in the runs taken while this
    // close-out shared the machine, every one of them past that inherited budget.
    // 120 s is ~1.9× the clean measurement and ~1.25× the worst sample: room for
    // a loaded run, still close enough that a genuine hang reports as a timeout
    // rather than arriving as a "flake".
    test.setTimeout(120_000);
    await openWalkthrough(page);
    // The state the round trip is measured against, read before anything moves.
    const opening = await serializedDocument(page);

    // 1. Create or open a document. Create, and from the starter: the fixture
    //    carries no group, and §13.1's own list requires entering one.
    await openDocumentByKeyboard(page);
    // History is watched from here, because the create remounts the shell and a
    // listener attached before it would be watching a canvas that is gone.
    await watchEditCommits(page);

    // 2. Choose a rail pane, and leave the walk on the one step 3 goes through.
    await chooseRailPane(page, "Design tokens");
    await expect(
      page.locator('[data-yunari-panel="tokens"]'),
      "the Tokens pane after the rail choice",
    ).toBeVisible();
    await expect(
      page.locator('[data-yunari-panel="layers"]'),
      "the Composition pane after the Tokens choice",
    ).toBeHidden();
    await chooseRailPane(page, "Composition");

    // 3. Select through Composition.
    const id = await selectInComposition(page, WALKTHROUGH_LAYER_NAME);

    // 4. Edit and cancel a field. The helper asserts the field went back to the
    //    authored value; this is the same claim one surface further out, on the
    //    row that would have moved had the cancel not happened.
    const authored = await editFieldThenCancel(page);
    await expect(
      page.locator(`[${LAYER_ROW}="${id}"] .yunari-layer-name`),
      "the row after the cancelled edit",
    ).toHaveText(authored);

    // 5. Enter a group and leave it again — §13.1's "enter/exit a group".
    const group = await enterGroup(page);
    expect(await exitGroup(page), "the group the deliberate exit left").toBe(
      group,
    );

    // 6. Open the stage's popup and close it — §13.1's "open and close a popup".
    //    `openPopup` asserts focus landed inside it rather than on its trigger;
    //    `closePopup` asserts focus came back where it belongs.
    await openPopup(page);
    await closePopup(page);

    // 7. Choose a palette, rather than the one already in force.
    await choosePalette(page, await paletteNotInForce(page));

    // 8. Cancel a shortcut capture — armed, cancelled, and proved not to have
    //    recorded anything.
    await cancelShortcutCapture(page);

    // **The first of the two invariants §13.1 states, swept.** The modal open
    // here is not the capture's: `cancelShortcutCapture`'s own Escape *was* the
    // cancel, dismissing the modal, and it reopened it on the Keyboard tab to
    // prove the chord came back unchanged — so this Escape is the walk's, and
    // the modal it dismisses is the reopened one. §13.1's sentence is that
    // Escape affects one innermost owner: the modal goes, and everything the
    // shell was carrying behind it is still there. The four readings are the
    // shell's own state — the pane the walk chose, the row it selected, the
    // document it named and the field it edited — so an Escape that reached a
    // second owner fails here rather than passing on the modal's disappearance.
    const covered = await surroundingState(page, id);
    // **And the sweep can tell one row from another**, which is the whole of
    // its non-vacuity: three of `surroundingState`'s four legs read the shell's
    // surface rather than the row, so a `surroundingState` that ignored its id
    // would hand back the same object whatever it was given — the shape of
    // assertion this plan exists to refuse. A row the walk did not cover must
    // therefore read differently from `covered`. The `pane`, `document` and
    // `field` legs do not vary with the id, so the difference is the `selected`
    // leg — the only one the sweep's claim actually turns on.
    const other = await page.evaluate(
      (args: { readonly ridden: string; readonly row: string }) =>
        [...document.querySelectorAll(`[${args.row}]`)]
          .map((row) => row.getAttribute(args.row))
          .find(
            (candidate) => candidate !== null && candidate !== args.ridden,
          ) ?? null,
      // The attribute arrives as an argument, not as a closure: `evaluate`
      // ships this function's own source, so a module constant named inside it
      // would arrive undefined.
      { ridden: id, row: LAYER_ROW },
    );
    if (other === null) {
      throw new Error("the walk's document holds only the row it covered");
    }
    expect(
      await surroundingState(page, other),
      "the sweep reads the row it is handed rather than the covered one",
    ).not.toEqual(covered);
    await page.keyboard.press("Escape");
    await expect(
      page.locator(SETTINGS_MODAL_CLASS),
      "the settings modal after Escape",
    ).toBeHidden();
    expect(
      await surroundingState(page, id),
      "the shell behind the settings modal's Escape",
    ).toEqual(covered);

    // **The second invariant, swept in the walk's own state.** §13.1's "each
    // region has a reachable focus target" is Task 1's census in detail —
    // opening state and populated state — and this is the same question asked of
    // the shell the walk itself leaves behind: a created document, a selection, a
    // pane chosen by the walk, a palette just applied. A walk ending somewhere its
    // own regions can no longer be reached is a failure the census cannot see,
    // because the census never takes the walk first.
    const after = await keyboardReach(page);
    expect(
      [
        ...new Set(
          after
            .map((step) => step.region)
            .filter((region): region is Region => region !== null),
        ),
      ],
      `the regions after the walk:\n${JSON.stringify(after, null, 2)}`,
    ).toEqual(expect.arrayContaining([...REGIONS]));

    // **No history entry landed across the interactions this watcher spans** —
    // the second through the eighth, from after the create to before the return
    // trip — which is §13.1's "without unintended history" measured as far as
    // the application states it (there is no history length to read:
    // `EditorShellBridge` publishes none).
    expect(
      await editCommits(page),
      "history entries the whole walk recorded",
    ).toBe(0);

    // 9. Return to the original document — §13.1's last interaction.
    await openThemeFromLibrary(page, HOST_THEME_ID);
    await expect(
      page.locator(".editor-shell-identity-name"),
      "the document the round trip returned to",
    ).toHaveText(FIXTURE_DOCUMENT_NAME);
    expect(
      await serializedDocument(page),
      "the document after the round trip",
    ).toEqual(opening);
  });
});
