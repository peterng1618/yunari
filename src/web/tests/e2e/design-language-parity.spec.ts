import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  comparatorName,
  comparatorReading,
  comparatorUnit,
  DRAWING_NAMES,
  renderedDialogs,
} from "./design-language-readers.js";
import { PARITY } from "./mockup-parity.js";
import {
  currentDrawings,
  drawingTexts,
  MOCKUP_PATH,
  mockupDeclarations,
  mockupDeclared,
  mockupDeclaredOrNull,
  type ParityRegion,
  readMockup,
  rowDrawing,
  SETTINGS_DIALOG_SELECTOR,
  SETTINGS_MOCKUP_PATH,
} from "./mockup-values.js";
import { openShell, SETTINGS_DIALOG, SETTINGS_GEAR } from "./shell-palette.js";
import { isDesktopSurface } from "./surface.js";

/** Responsibility: §3/§7 shell and settings parity against their own drawings, including product declarations and surface inventory. */
/**
 * The shell's parity with the drawing (spec §13 as amended 2026-10-10, DESIGN.md §3,
 * §7, reference `docs/design/mockups/current/shell.html`; the settings surface is
 * its own file, `current/settings.html`, and is read here too).
 *
 * **What this is.** The drawing is the acceptance instrument: its own inline
 * stylesheet is parsed (`mockup-values.ts`) and each of `PARITY`'s rows asserts
 * the product's computed value equals what the row's comparator declares. A value
 * transcribed out of the drawing into this file — which is what the previous
 * passes did, as prose — is a second owner of it, and a copy is what lets the
 * two drift while every check stays green.
 *
 * **Silence is a reading.** The four body regions are the case: the drawing
 * draws them **flush** and **square**, so it declares no `padding`, no `gap` and
 * no `border-radius` for them, and *that* — not a missing check — is why the
 * rows below require `0` of the product (the 8px inset and the 12px radius they
 * read before Tasks 2 and 3 are gone). Where the drawing declares nothing the row
 * reads `0`, and `mockupDeclaredOrNull` still throws when a row's selector
 * addresses nothing at all, so a stale selector cannot pass as a region the
 * drawing draws flush.
 *
 * **The drawing is not every row's source.** A region the drawing draws as part
 * of a *window* has no counterpart in a product that **is** the window, so the
 * shell's own frame is not in this table at all (the census records it
 * `no-counterpart`). The two dialogs' frames are here but `scaleToken` owns them,
 * not a drawing selector: DESIGN.md §3's radius table is closed and gives 10px to
 * floating clusters over the canvas, which a modal is not. The expected value is
 * read from the product's own `:root` declaration (`--radius-lg`), so this file
 * cannot drift from the token.
 *
 * **A `licensed` row is recorded, not asserted — and the licence is policed.**
 * `licensed` carries a *predating* rule — a DESIGN.md §N, an ADR, a spec section
 * — that positively requires the product's treatment. Its absence is what makes
 * a difference a defect; two rows carry one today, each the narrow case and
 * never "DESIGN.md does not forbid it": the stage ground (§7.5, which names that
 * property and permits both variants) and the settings modal's frame inset (§3,
 * whose spacing table positively requires `20–24` for "dialog padding" — the
 * value `.editor-shell-dialog` renders where the drawing insets its children).
 *
 * **The licence is what is left of that row's gate, so it is a rule rather than
 * free text.** This test cannot read one — it has no DESIGN.md and no git — so
 * `mockup-values.test.ts` does, through `licenceFindings`: a licence names a
 * source from spec §13's set, quotes that source's own words, and was not
 * written by the same commit as the rule it cites (`vg-292`). A row that passes
 * here has already passed there.
 *
 * **The header row is the control.** The drawing and the product agree that the
 * header is 42px, so it passed from the start and still does. Its job is to keep
 * a reader that stopped reading visible: a row that measured nothing lands in
 * `unresolved` and fails rather than reporting a shell that came right by
 * reading nothing. It is in the table, rather than left out as redundant, for
 * that reason.
 *
 * **The shell's rows pass; three of the settings modal's six do not, on
 * purpose.** The shell's ten were re-run by plan 7 Task 7 against the shipped
 * build — Task 3 closed the last six the table named (the four region radii,
 * drawn flush and square, and both dialog frames at `--radius-lg`) — and the
 * capture beside the drawing (`docs/design/mockups/current/shell-capture-*.png`)
 * is that task's evidence that the build they pass on is the one that ships.
 * Plan 8 Task 1 then added six rows for the modal's regions, read against
 * `current/settings.html`, **each red on the build it landed on**; Task 2 turned
 * the navigation's axis and the lead's type green (a `150px` vertical column and
 * §2's `--text-lg` title), leaving the scrim (Task 3) and the palette group's
 * count, card radius and swatch height (Task 5) red by design. The census
 * (`.superpowers/sdd/2026-10-11-settings-parity/adjudication.md`) names each
 * row's task. A row loosened or skipped to reach green would be the defect this
 * whole instrument exists to end, so none is.
 *
 * A `--grep` that matches nothing exits 0 with zero tests, so the run's own
 * summary — "1 test", this file — is the proof it ran at all.
 */
test("the shell and the settings modal are what the drawings draw", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await openShell(page);

  // ── The product side of the drawing comparison (`vg-325`) ──────────────────
  //
  // Every row below runs the comparison **one way**: the drawings are parsed and
  // the product is pulled to them. **An ungated stylesheet is what this block
  // exists to catch**: a value a drawing moves leaves the product behind and no
  // row says so — which is how the four residuals `vg-325` names arrived.
  // `editor-shell.css` is no longer one of those files: it joined
  // `design-tokens.gated.json` with the source ratchet (`vg-274`). That ratchet
  // reads a file's own literals against §3's scale and says nothing about
  // whether the product still agrees with the drawing that owns a value, which
  // is this block's job. This is the **inverse read**: the product's own
  // declarations are parsed the same way a drawing's are, and each of the four
  // is held to the value the drawing that owns it declares. A drawing-side
  // sweep cannot see them, because none is a rendered element of a `PARITY` row
  // (the two asset-button groups are product-only DOM, and the dialog's button
  // and the rail are read here as *declarations*, not as rendered boxes).
  const productPath =
    "src/web/packages/editor/src/editor-shell/editor-shell.css";
  const productCss = readFileSync(
    new URL(
      "../../packages/editor/src/editor-shell/editor-shell.css",
      import.meta.url,
    ),
    "utf8",
  );
  const productDeclarations = mockupDeclarations(
    `<style>${productCss}</style>`,
  );
  const drawingValue = (
    path: string,
    selector: string,
    property: string,
  ): string => mockupDeclared(readMockup(path), selector, property);
  const controlsPath = currentDrawings().find((drawing) =>
    drawing.name.endsWith("/controls.html"),
  )?.path;
  expect(
    controlsPath,
    "the product-side comparison has no controls drawing to read",
  ).toBeDefined();
  const productRows = [
    {
      // `settings.html:96` draws the Close row at `margin-top:16px`.
      selector: ".editor-shell-dialog > button",
      property: "margin-top",
      expected: drawingValue(
        SETTINGS_MOCKUP_PATH,
        '[style*="margin-top:16px;display:flex;justify-content:flex-end"]',
        "margin-top",
      ),
    },
    {
      // `shell.html:40` draws the rail's `gap:4px`.
      selector: ".editor-shell-rail",
      property: "gap",
      expected: drawingValue(MOCKUP_PATH, '[style*="width:46px"]', "gap"),
    },
    ...[
      ".editor-shell-panel [data-yunari-asset-import]",
      ".editor-shell-inspector [data-yunari-run-add]",
    ].map((selector) => ({
      selector,
      property: "padding",
      // `controls.html:112` draws the plain-DOM button box both groups render.
      expected: drawingValue(
        controlsPath ?? "",
        '[style*="flex:1;text-align:center;border:1px solid var(--well-edge);border-radius:6px;background:var(--well);padding:4px 8px"]',
        "padding",
      ),
    })),
  ];
  const productFailures: string[] = [];
  for (const row of productRows) {
    const declarations = productDeclarations.filter(
      (declaration) =>
        declaration.owner === row.selector &&
        declaration.property === row.property,
    );
    // The empty-read control: a selector the product no longer declares is a
    // broken row, not a row that agrees.
    expect(
      declarations.length,
      `${productPath}: no \`${row.selector}\` \`${row.property}\` was read, so this row proves nothing`,
    ).toBeGreaterThan(0);
    const declaration = declarations.at(-1);
    if (declaration?.value !== row.expected) {
      productFailures.push(
        `${productPath}:${declaration?.line} \`${row.selector}\` ${row.property}: ${declaration?.value}; the drawing declares ${row.expected} (§3)`,
      );
    }
  }
  expect(
    productFailures,
    "the product's own declarations contradict the drawings that own them",
  ).toEqual([]);

  // ── The surface inventory (`vg-314`) ───────────────────────────────────────
  //
  // A surface the product renders that no drawing draws is one **no row can
  // address**: the parity table holds a *value* of an element both sides carry,
  // so an element the drawing omits has nothing to be read against. The Assets
  // pane's asset preview was that surface (`vg-314`): its contract is a **bound**
  // (`max-height:120px` with `object-fit:contain`) rather than a size, and the
  // pane is `display:none` while Document is open, so it cannot be a `PARITY`
  // row even when a drawing names it.
  //
  // **What it reads is a NAME, on three sides, and the row is `open` because of
  // it.** The drawing side is the one currently failing: no checked drawing under
  // `docs/design/mockups/current` names `yunari-asset-preview`. The shell
  // drawing's `<!-- asset preview (.yunari-asset-preview) … -->` comment was
  // removed in `775e2f54` (logged `vg-731`), so this row is red on that side
  // until a drawing names the surface again; the entry stays in place rather than
  // being deleted to reach green. The list below is **hand-written and one entry
  // long**, so a *new* product surface reddens nothing until someone adds it here
  // — which is the class of defect the row exists for. Deriving the list from the
  // product was measured and does not construct: the panes render **73** distinct
  // `data-yunari-*` hooks, **5** of them named anywhere in `editor-shell.css`, and
  // **no checked drawing names any of them** — the drawings are hand-authored HTML
  // that names a product surface by its *class*, in prose beside the box, never by
  // a hook on a drawn element (measured 2026-10-12 by walking
  // `packages/editor/src/panes/**/*.tsx` and testing each hook against the
  // stylesheet and the six checked drawings). So the check reads all three sides
  // — the component that renders it, the stylesheet that treats it, and the
  // drawing that owns the region it sits in — and cannot prove an unlisted one is
  // anywhere. **What it also does not check** is the drawn treatment's *values*
  // (the drawn box's height against the stylesheet's bound); that is a comparator
  // the drawn bound does not yet have.
  const SURFACES: readonly {
    readonly surface: string;
    readonly component: string;
    readonly componentUrl: URL;
    readonly drawing: string;
    readonly drawingName: string;
  }[] = [
    {
      surface: "yunari-asset-preview",
      component: "src/web/packages/editor/src/panes/assets/assets-pane.tsx",
      componentUrl: new URL(
        "../../packages/editor/src/panes/assets/assets-pane.tsx",
        import.meta.url,
      ),
      // The Assets pane is the shell drawing's, not a settings panel's.
      drawing: MOCKUP_PATH,
      drawingName: DRAWING_NAMES.get(MOCKUP_PATH) ?? MOCKUP_PATH,
    },
  ];
  expect(
    SURFACES.length,
    "the surface inventory is empty, so it can prove nothing",
  ).toBeGreaterThan(0);
  const inventoryFailures: string[] = [];
  for (const entry of SURFACES) {
    const sides = [
      { name: entry.component, text: readFileSync(entry.componentUrl, "utf8") },
      { name: productPath, text: productCss },
      { name: entry.drawingName, text: readMockup(entry.drawing) },
    ];
    for (const side of sides) {
      // The empty-read control, per side: a file the reader opened but read
      // nothing out of is not a side that agrees.
      expect(
        side.text.length,
        `${side.name} was read as empty, so this inventory proves nothing about it`,
      ).toBeGreaterThan(0);
      if (!side.text.includes(entry.surface)) {
        inventoryFailures.push(
          `\`${entry.surface}\` is not named by ${side.name}, so the surface it stands for is one a row cannot address`,
        );
      }
    }
  }
  expect(
    inventoryFailures,
    "a surface the product renders is missing from its drawing, the stylesheet or its component",
  ).toEqual([]);

  // The comparators the rows below run every rendered value through are pure
  // decisions and are proved in `mockup-values.test.ts`, where `vitest run` holds
  // them. `lengthInPx` was asserted here first, and this test is skipped off a
  // desktop surface, so a revert to reading the first token of a shorthand left
  // the fast suite green; the count and colour comparators plan 8 Task 1 added
  // are held there from the start, for the same reason.
  expect(
    PARITY.length,
    "the parity table is empty, so this test can prove nothing",
  ).toBeGreaterThan(0);
  /** Rows are read with the surface they belong to open, because both dialogs
   *  render the one `.editor-shell-dialog` rule and only the route tells them
   *  apart — a value read with the wrong one open is a reading of the wrong
   *  element. Two rows also share a selector without sharing a surface, so the
   *  key carries both. */
  const key = (row: ParityRegion): string =>
    `${row.surface ?? "shell"}|${row.productSelector}|${row.mockupProperty}`;

  const readRows = async (rows: readonly ParityRegion[]) =>
    page.evaluate(
      (wanted) => {
        const out: Record<string, string | null> = {};
        for (const row of wanted) {
          // The **rendered** match, not the first in document order: one dialog
          // is in the DOM at a time today, so this picks the only one — and if
          // a second ever appears (a `keepMounted` flip leaves the closed modal
          // mounted), it reads the open dialog rather than whichever the
          // document happens to list first.
          const element =
            [...document.querySelectorAll(row.productSelector)].find(
              (candidate) => candidate.getClientRects().length > 0,
            ) ?? null;
          out[row.key] =
            element === null
              ? null
              : getComputedStyle(element).getPropertyValue(row.mockupProperty);
        }
        return out;
      },
      rows.map((row) => ({
        key: key(row),
        productSelector: row.productSelector,
        mockupProperty: row.mockupProperty,
      })),
    );

  const product: Record<string, string | null> = await readRows(
    PARITY.filter((row) => row.surface === undefined),
  );

  await page.locator(SETTINGS_GEAR).click();
  await expect(page.getByRole("dialog", SETTINGS_DIALOG)).toBeVisible();
  await expect(
    await renderedDialogs(page),
    "the settings modal is not the only dialog rendered, so its row cannot say which dialog it measured",
  ).toBe(1);
  Object.assign(
    product,
    await readRows(PARITY.filter((row) => row.surface === "settings")),
  );
  /** The modal's other two panels, each read with its own tab showing. Base UI
   *  keeps an inactive panel out of the DOM — `shell-palette.ts`'s
   *  `openAppearance` says the same — so a Keyboard row read on the Appearance
   *  tab would measure no element and report a region that is drawn and rendered
   *  as one that measured nothing, which is not what happened. */
  const modal = page.getByRole("dialog", SETTINGS_DIALOG);
  for (const [surface, tab] of [
    ["settings-keyboard", "Keyboard"],
    ["settings-about", "About"],
  ] as const) {
    await modal.getByRole("tab", { name: tab }).click();
    Object.assign(
      product,
      await readRows(PARITY.filter((row) => row.surface === surface)),
    );
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", SETTINGS_DIALOG)).toBeHidden();

  // `?` is the session's own dispatcher, so this is the gesture an author makes
  // rather than a click on a control the sheet does not have.
  await page.keyboard.press("?");
  const sheet = page.locator(".editor-shell-dialog");
  await expect(sheet).toBeVisible();
  await expect(
    await renderedDialogs(page),
    "the `?` sheet is not the only dialog rendered, so its row cannot say which dialog it measured",
  ).toBe(1);
  Object.assign(
    product,
    await readRows(PARITY.filter((row) => row.surface === "sheet")),
  );

  /** The closed scale the product declares for itself, read from `:root` so a
   *  row expecting `--radius-lg` cannot drift from the token it names. */
  const tokens = [
    ...new Set(
      PARITY.map((row) => row.scaleToken).filter(
        (token): token is string => token !== undefined,
      ),
    ),
  ];
  const scale: Record<string, string> = await page.evaluate((names) => {
    const root = getComputedStyle(document.documentElement);
    return Object.fromEntries(
      names.map((name) => [name, root.getPropertyValue(name).trim()]),
    );
  }, tokens);

  // The settings drawing is read, not merely shipped. The modal's own rows name
  // its selectors now (plan 8 Task 1), and this assertion is kept as the row that
  // says the file is reached at all: a drawing that nothing reads is a drawing
  // that rots, and a selector that stopped resolving has to red here rather than
  // go unnoticed.
  expect(
    mockupDeclared(
      readMockup(SETTINGS_MOCKUP_PATH),
      SETTINGS_DIALOG_SELECTOR,
      "border-radius",
    ),
    "the settings drawing's dialog frame is not drawn at the closed scale's panel radius",
  ).toBe(scale["--radius-lg"]);

  // Rows on another surface are that surface's test to read: this one opens the
  // shell, and a `[data-fixture="…"]` selector matches nothing here. Leaving
  // them in would report "no element matches" for a row that is read — just not
  // by this test. Only the fixture is foreign today, and saying so keeps a row
  // whose surface is a typo from being skipped by both tests and read by
  // neither.
  const mismatchedSurfaces = PARITY.filter(
    (row) =>
      row.surface !== undefined &&
      row.surface !== "settings" &&
      row.surface !== "settings-keyboard" &&
      row.surface !== "settings-about" &&
      row.surface !== "sheet" &&
      row.surface !== "fixture",
  );
  expect(
    mismatchedSurfaces.map((row) => `${row.region} on ${row.surface}`),
    "a parity row names a surface neither this test nor the fixture test reads",
  ).toEqual([]);

  const unresolved: string[] = [];
  const failures: string[] = [];
  const table: string[] = [];
  /** A row's own drawing, read once per path, and **a path the reader was not
   *  given throws** (`rowDrawing`): the shell's unless the row names another file,
   *  so a surface drawn on its own (`current/settings.html`) is compared against
   *  the file it was drawn in rather than against whichever one this test opened
   *  first — which is how plan 8 Task 1's settings rows read a drawing the shell
   *  test had never opened. */
  const drawings = drawingTexts();
  const sourceOf = (row: ParityRegion): string =>
    rowDrawing(row.mockupPath, drawings);
  /** What a failure calls the row's drawing: a person has to be able to open it.
   *  Read from the enumeration rather than named here, because the settings
   *  modal is three drawings now (plan 8 Task 4) and a failure that named
   *  `settings.html` for a Keyboard row would send that person to the wrong
   *  file. */
  const nameOf = (row: ParityRegion): string =>
    row.mockupPath === undefined || row.mockupPath === MOCKUP_PATH
      ? "the drawing's"
      : `\`${DRAWING_NAMES.get(row.mockupPath) ?? row.mockupPath}\`'s`;
  for (const row of PARITY) {
    if (row.surface === "fixture") continue;
    const rendered = product[key(row)];
    // `undefined` is its own reading under `noUncheckedIndexedAccess`: the key
    // was never filled because the row was in no `readRows` call, which is the
    // same verdict as "nothing matched" — the row measured nothing — and must
    // not reach `lengthInPx` and throw there instead.
    if (rendered === undefined || rendered === null) {
      unresolved.push(
        `${row.region}: no element matches \`${row.productSelector}\`, so the row measured nothing`,
      );
      continue;
    }
    if (row.licensed !== undefined) {
      table.push(`${row.region}: recorded, licensed — ${row.licensed}`);
      continue;
    }
    /** The comparator, the product's value, and the words a failure uses. */
    const comparator = row.comparator;
    const unit = comparatorUnit(comparator);
    const kind = comparatorName(comparator);
    let expected: string | null;
    let actual: string | null;
    let from: string;
    if (row.scaleToken !== undefined) {
      // The scale owns this row, not the drawing: see the row's own comment.
      const declared = scale[row.scaleToken];
      // `""` is what a custom property resolves to when nothing declares it, and
      // `--elev-scrim` is a token Task 3 has not declared yet. Reported as the
      // region's own failure rather than as `unresolved`, which means "measured no
      // element" and is not what happened here: the overlay was measured, and the
      // comparator it names is absent.
      if (declared === undefined || declared === "") {
        failures.push(
          `${row.region}: the product declares no \`${row.scaleToken}\`, so the row has no comparator`,
        );
        continue;
      }
      expected = comparatorReading(comparator, declared);
      actual = comparatorReading(comparator, rendered);
      from = `\`${row.scaleToken}\` (${declared})`;
    } else {
      // Throws when the selector addresses nothing in the drawing: a row whose
      // selector went stale must fail here rather than read as a flush region.
      const declared = mockupDeclaredOrNull(
        sourceOf(row),
        row.mockupSelector ?? "",
        row.mockupProperty,
      );
      // **Silence is a zero only for a length.** A drawing that draws a region
      // flush declares no inset, and `0` is that reading; a drawing that draws no
      // grid declares no track count, so a count row has no answer here rather
      // than zero tracks. Coercing either non-px comparator to `0` is exactly the
      // inversion plan 7 caught, one comparator over.
      const silent = comparator === undefined || comparator === "length";
      expected =
        declared === null
          ? silent
            ? comparatorReading(comparator, "0")
            : null
          : comparatorReading(comparator, declared);
      actual = comparatorReading(comparator, rendered);
      from = `${nameOf(row)} \`${row.mockupSelector}\` (${
        declared ??
        (silent ? "nothing — drawn flush, so 0px" : "nothing declared")
      })`;
    }
    table.push(
      `${row.region}: ${from} → ${expected}, product \`${row.productSelector}\` = ${rendered} → ${actual}`,
    );
    if (expected === null) {
      failures.push(
        `${row.region}: ${from} is not a ${kind} this table can compare`,
      );
      continue;
    }
    if (actual !== expected) {
      failures.push(
        `${row.region}: ${from} requires ${expected}${unit}; the product renders "${rendered}" on \`${row.productSelector}\`.`,
      );
    }
  }

  for (const line of table) console.log(`parity ${line}`);
  testInfo.annotations.push({ type: "parity", description: table.join(" | ") });

  // ── Task 3 Step 4: the two dialogs against each other, not only the scale ──
  //
  // Both dialogs render the one `.editor-shell-dialog` rule, and each row above
  // compares its computed frame against `--radius-lg` on its own. That pair
  // cannot see *relative* equality: a change scoped to one dialog (a rule the
  // settings surface alone matched, say) would pass both rows only if its value
  // also happened to equal `--radius-lg`. Reading the two frames side by side is
  // what makes a change made for the settings modal and missed on the `?` sheet
  // fail a row rather than pass quietly.
  const dialogFrame = (surface: "settings" | "sheet"): string | null =>
    product[`${surface}|.editor-shell-dialog|border-radius`] ?? null;
  expect(
    dialogFrame("settings"),
    "the settings modal's frame was not read, so the two dialogs cannot be compared",
  ).not.toBeNull();
  expect(
    dialogFrame("sheet"),
    "the `?` sheet's frame was not read, so the two dialogs cannot be compared",
  ).not.toBeNull();
  expect(
    dialogFrame("sheet"),
    `the two dialogs' frames differ — settings ${dialogFrame("settings")}, \`?\` sheet ${dialogFrame("sheet")}`,
  ).toBe(dialogFrame("settings"));

  expect(
    unresolved,
    "a parity row measured no element, so its reading is not a reading",
  ).toEqual([]);
  expect(
    failures,
    "a region is not what its comparator requires of it",
  ).toEqual([]);
});
