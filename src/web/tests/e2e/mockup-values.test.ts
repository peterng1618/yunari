import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import {
  CITE_NUMBERS,
  checkCitations,
  sectionTexts,
} from "../../../../scripts/design-md.mjs";
import { colourValue, lengthInPx, trackCount } from "./mockup-comparators.js";
import {
  COPIED_ELEMENTS,
  copiedElementDrift,
} from "./mockup-copied-elements.js";
import {
  LICENCE_SPEC,
  LICENCE_SPEC_ALIASES,
  type LicenceLedger,
  licenceFindings,
  licenceSources,
} from "./mockup-licence.js";
import { PARITY } from "./mockup-parity.js";
import {
  assertParityRowProperty,
  CONTROLS_LIGHT_MOCKUP_PATH,
  CONTROLS_MOCKUP_PATH,
  currentDrawings,
  drawingTexts,
  MOCKUP_PATH,
  mockupDeclared,
  mockupDeclaredOrNull,
  mockupDeclaredProperties,
  ORIGINAL_MOCKUP_PATH,
  readMockup,
  rowDrawing,
  SETTINGS_MOCKUP_PATH,
  SHELL_ROLES,
  SHELL_TOKEN_SELECTOR,
} from "./mockup-values.js";

/**
 * The reader's own proof, and the reason it is a unit test rather than an
 * assertion in the browser spec.
 *
 * A parity gate that compares a *copy* of the drawing's value passes whatever
 * the drawing does, which is the contradiction Task 1 exists to remove. So the
 * reader is proved against the drawing's text directly — including against a
 * mutated copy of it, which is the one check a reader returning a constant
 * cannot survive.
 *
 * Run: `cd src/web && npm run test -- tests/e2e/mockup-values`
 * (the brief's `…/tests/e2e/mockup-values.ts` filter matches no file — vitest
 * matches a CLI filter as a **path substring**, and the test is
 * `mockup-values.test.ts`).
 */

const drawing = readMockup();
const settings = readMockup(SETTINGS_MOCKUP_PATH);

/** The modal's regions, as `current/settings.html` is addressed — the same
 *  selectors `PARITY`'s settings rows name, so a row whose address moved fails
 *  here as well as in the browser run. */
const NAV = '[style*="width:150px"]';
const GRID = '[style*="display:grid"]';
const CARD =
  '[style*="border:1px solid var(--edge);border-radius:8px;padding:8px;background:var(--panel2)"]';
const SWATCH_BAR =
  '[style*="flex:1;height:16px;border-radius:4px;background-color:#f5f1e8"]';

test("the drawing is the checked-in file, read from disk", () => {
  expect(existsSync(MOCKUP_PATH)).toBe(true);
  expect(existsSync(SETTINGS_MOCKUP_PATH)).toBe(true);
  expect(existsSync(CONTROLS_MOCKUP_PATH)).toBe(true);
  expect(existsSync(CONTROLS_LIGHT_MOCKUP_PATH)).toBe(true);
  // Normalised, because a Windows path separates with `\` and this is the one
  // assertion that says the reader's target is the checked-in drawing.
  expect(MOCKUP_PATH.replace(/\\/g, "/")).toContain(
    "docs/design/mockups/current/shell.html",
  );
  expect(SETTINGS_MOCKUP_PATH.replace(/\\/g, "/")).toContain(
    "docs/design/mockups/current/settings.html",
  );
  expect(CONTROLS_MOCKUP_PATH.replace(/\\/g, "/")).toContain(
    "docs/design/mockups/current/controls.html",
  );
  expect(CONTROLS_LIGHT_MOCKUP_PATH.replace(/\\/g, "/")).toContain(
    "docs/design/mockups/current/controls-editorial.html",
  );
  // The frozen originals are provenance, and the target is never one of them:
  // reading one to decide a value is the drift this plan exists to end.
  for (const path of [CONTROLS_MOCKUP_PATH, CONTROLS_LIGHT_MOCKUP_PATH]) {
    expect(path.replace(/\\/g, "/")).toContain("/current/");
  }
});

test("the two control drawings declare the one field row a row reads", () => {
  // The label column, addressed by the one label that settles which element is
  // meant: the eleven short labels carry the same declaration and the twelfth —
  // the long-copy label — carries it plus `padding-top:4px`, so every shorter
  // substring matches twelve elements and the reader refuses to choose. The
  // twelfth declares the same `width:74px;flex:0 0 auto`.
  const LABELS =
    '[style*="width:74px;flex:0 0 auto;color:var(--muted);font-size:11px;padding-top:4px"]';
  // The other half of the same row: the value cell the drawing stretches. Two
  // elements carry it and their `style` attributes are identical, which is one
  // element form to this reader — the narrower prefix also matches the
  // multi-line well and would address two different elements.
  const CELL =
    '[style*="flex:1;display:flex;align-items:center;gap:6px;background:var(--well)"]';
  for (const path of [CONTROLS_MOCKUP_PATH, CONTROLS_LIGHT_MOCKUP_PATH]) {
    const html = readMockup(path);
    expect(html).not.toBe(drawing);
    expect(mockupDeclared(html, LABELS, "width")).toBe("74px");
    expect(mockupDeclared(html, LABELS, "flex")).toBe("0 0 auto");
    expect(mockupDeclared(html, CELL, "flex")).toBe("1");
    // Reading one file for the other would pass every assertion above, so the
    // two are told apart by what each declares and the other does not.
    expect(mockupDeclared(html, "body", "background")).toBe(
      path === CONTROLS_MOCKUP_PATH ? "#0b0e12" : "#fffdf7",
    );
  }
});

test("the shape the field row is not is read from the drawing that draws it", () => {
  // The settings modal's switch row, addressed by the box it is: the label at
  // `flex:1` inside a `--panel-2` panel at `--radius-lg`, with no label column.
  // That absence is the reading — a row that took the field row's 74px column
  // wrapped "Follow the system" onto a second line.
  //
  // **The inset in this address is Task 6's `8px`, not the `9px` it was
  // written with.** The drawing's `9px` was off §3's scale and the drawing was
  // the stale side (`vg-303`), so the declaration changed under the address
  // while the row's own subject — the radius and the gap below — did not.
  const BOXED_ROW =
    '[style*="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--panel2);border:1px solid var(--edge);border-radius:8px"]';
  expect(mockupDeclared(settings, BOXED_ROW, "border-radius")).toBe("8px");
  expect(mockupDeclared(settings, BOXED_ROW, "gap")).toBe("10px");

  // The Add pane's asset trigger. The drawing used to carry this declaration
  // twice — the picker's element was a shorter form of it — which is why this
  // row names the shared form and the reader threw on the bare suffix. The
  // assets rework moved that trigger to its own pane and redrew this one, so the
  // suffix now addresses exactly one element; asserted rather than left implicit,
  // because a second form returning is what would make the row read whichever
  // element the document lists last.
  const ASSET_TRIGGER =
    '[style*="flex:1;display:flex;align-items:center;gap:6px;background:var(--panel2);border:1px solid var(--edge);border-radius:6px;padding:4px 8px"]';
  expect(mockupDeclared(drawing, ASSET_TRIGGER, "border-radius")).toBe("6px");
  expect(mockupDeclared(drawing, ASSET_TRIGGER, "gap")).toBe("6px");
  expect(
    mockupDeclared(
      drawing,
      '[style*="display:flex;align-items:center;gap:6px;background:var(--panel2);border:1px solid var(--edge);border-radius:6px;padding:4px 8px"]',
      "border-radius",
    ),
  ).toBe("6px");
});

test("the settings drawing declares the modal's regions, each read by the row that names it", () => {
  // The four settings-surface rows that read this drawing rather than the scale:
  // the nav column, the palette grid's tracks, the card and the swatch bar. Plan
  // 7 left this file's rows scale-owned; plan 8 Task 1 gives it rows of its own,
  // and these are their addresses.
  expect(mockupDeclared(settings, NAV, "width")).toBe("150px");
  expect(
    trackCount(mockupDeclared(settings, GRID, "grid-template-columns")),
  ).toBe(3);
  expect(mockupDeclared(settings, CARD, "border-radius")).toBe("8px");
  expect(mockupDeclared(settings, CARD, "padding")).toBe("8px");
  expect(mockupDeclared(settings, SWATCH_BAR, "height")).toBe("16px");

  // Five of the six cards carry this declaration byte for byte and the sixth is
  // the chosen card, told apart by its accent border — so a selector naming the
  // shared form addresses **one** element form to this reader rather than five
  // elements, which is the rule that lets the row read it at all.
  expect(mockupDeclared(settings, CARD, "background")).toBe("var(--panel2)");
  expect(
    mockupDeclared(
      settings,
      '[style*="border:1px solid var(--accent);border-radius:8px;padding:8px;background:var(--panel2)"]',
      "background",
    ),
    "the chosen card is not drawn where the row's address would read it",
  ).toBe("var(--panel2)");
  // The negative half: the shorter address the row must **not** take, because
  // twelve bars carry it and the reader refuses to pick one.
  expect(() =>
    mockupDeclared(
      settings,
      '[style*="flex:1;height:16px;border-radius:4px"]',
      "height",
    ),
  ).toThrow(/addresses 12 elements/);
});

test("a row is read from the drawing it names, and a path the reader was not given fails loudly", () => {
  // **The silent default.** `undefined` means the shell drawing — every plan 7
  // row — and must keep meaning it; a row that names a file must read *that* file;
  // and a row naming a file the reader was not given is a broken row, not a shell
  // reading. Without the throw, a settings row that lost its `mockupPath` would
  // read `current/shell.html` and could pass on a value the shell declares where
  // `current/settings.html` declares something else — the "a real value on the
  // wrong element reads as a pass" failure this module exists to end, one level
  // up. (The other half of that pair is proved above: the settings nav's
  // `width:150px` selector addresses nothing in the shell drawing and throws.)
  const known = drawingTexts();
  expect(known.size).toBe(currentDrawings().length);
  expect(rowDrawing(undefined, known)).toBe(drawing);
  expect(rowDrawing(SETTINGS_MOCKUP_PATH, known)).toBe(settings);
  expect(rowDrawing(CONTROLS_MOCKUP_PATH, known)).toBe(
    readMockup(CONTROLS_MOCKUP_PATH),
  );

  // The exact case the fallback hid: a map holding the shell drawing and not the
  // settings one. A fallback would answer the shell's text and the row would
  // compare against the wrong file.
  expect(() =>
    rowDrawing(SETTINGS_MOCKUP_PATH, new Map([[MOCKUP_PATH, drawing]])),
  ).toThrow(/was not given/);
  expect(() => rowDrawing("/nowhere/missing.html", known)).toThrow(
    /was not given/,
  );

  // And every row in the table resolves, so a `mockupPath` typo reddens here in
  // the fast suite rather than reading another file in the browser run.
  for (const row of PARITY) {
    expect(
      () => rowDrawing(row.mockupPath, known),
      `${row.region}: the reader was not given the drawing this row names`,
    ).not.toThrow();
  }
});

test("the drawing's own token table is read, and all eleven tokens with it", () => {
  // The drawing declares its shell tokens on the outermost element rather than
  // in a `:root` rule, so this is a reading of an inline `style` attribute —
  // `docs/design/mockups/current/shell.html:17-18`.
  expect(SHELL_ROLES).toHaveLength(11);
  for (const role of SHELL_ROLES) {
    expect(
      mockupDeclared(drawing, SHELL_TOKEN_SELECTOR, role.drawingToken),
      `${role.drawingToken} is not declared by the drawing's token table`,
    ).toMatch(/^#[0-9a-f]{6}$/);
  }
  // The two the brief's list of ten omitted and the drawing's own spellings.
  expect(mockupDeclared(drawing, SHELL_TOKEN_SELECTOR, "--hot")).toBe(
    "#ff7e6e",
  );
  expect(mockupDeclared(drawing, SHELL_TOKEN_SELECTOR, "--panel2")).toBe(
    "#171c23",
  );
  expect(mockupDeclared(drawing, SHELL_TOKEN_SELECTOR, "--edge2")).toBe(
    "#1b212a",
  );

  // The check the three above cannot make: a reader answering a constant would
  // pass them all. A token moved in the file must come back moved.
  const changed = drawing.replace("--hot:#ff7e6e", "--hot:#012345");
  expect(changed).not.toBe(drawing);
  expect(mockupDeclared(changed, SHELL_TOKEN_SELECTOR, "--hot")).toBe(
    "#012345",
  );

  // A token the table does not declare is a broken row, not a silence.
  expect(() => mockupDeclared(drawing, SHELL_TOKEN_SELECTOR, "--nope")).toThrow(
    /declares no `--nope`/,
  );
});

test("the drawing's token table declares the eleven mapped tokens and no twelfth", () => {
  // Every assertion above reads the table **row by row**, and that is the shape
  // `--hot` walked through: the brief scoped this task against a table of ten,
  // the drawing had carried eleven, and nothing reddened, because a token nobody
  // maps is a token nobody asks for. So the *set* is asserted too — a twelfth
  // added to `current/shell.html:17-18` fails here and has to be given an owner
  // deliberately.
  //
  // The element carries its layout declarations (`width`, `display`, …) as well
  // as its tokens, so the reading is filtered to custom properties rather than
  // the reader knowing what a token is.
  const tokens = (html: string): string[] =>
    mockupDeclaredProperties(html, SHELL_TOKEN_SELECTOR)
      .filter((property) => property.startsWith("--"))
      .sort();

  expect(tokens(drawing)).toEqual(
    [...new Set(SHELL_ROLES.map((role) => role.drawingToken))].sort(),
  );

  // The check the line above cannot make: a reader answering a constant set
  // passes it. A twelfth token in the file must come back as one.
  const twelfth = drawing.replace(
    "--hot:#ff7e6e;",
    "--hot:#ff7e6e;--new:#123456;",
  );
  expect(twelfth).not.toBe(drawing);
  expect(tokens(twelfth)).toHaveLength(SHELL_ROLES.length + 1);
  expect(tokens(twelfth)).toContain("--new");

  // And the eleven are named, not merely counted: a token renamed in the table
  // with a row left behind is a different set, not the same size.
  const renamed = drawing.replace("--panel2:#171c23;", "--panel-2:#171c23;");
  expect(renamed).not.toBe(drawing);
  expect(tokens(renamed)).not.toEqual(tokens(drawing));
});

test("the page rule is read out of the drawing's own stylesheet", () => {
  // `current/shell.html` draws the editor as the window, so its `<style>` block
  // is a page reset rather than a card: `body` is the rule the reader reaches.
  expect(mockupDeclared(drawing, "body", "background")).toBe("#0b0e12");
});

test("the shell's inline regions are read too, by their style attributes", () => {
  // The shell the drawing draws is built from anonymous inline-styled divs — no
  // class to name them by, which is why the reader addresses inline declarations
  // as well as `<style>` rules. `height:42px` is the header, and the row PARITY
  // measures.
  expect(mockupDeclared(drawing, '[style*="height:42px"]', "height")).toBe(
    "42px",
  );
});

test("a property the rule does not declare throws, naming both", () => {
  expect(() => mockupDeclared(drawing, "body", "padding")).toThrow(
    /declares no `padding` for `body`/,
  );
});

test("a selector the drawing addresses nothing with throws", () => {
  expect(() =>
    mockupDeclared(drawing, ".editor-shell-frame", "border-radius"),
  ).toThrow(/addresses nothing with `\.editor-shell-frame`/);
});

test("an inline selector that matches twice throws rather than picking one", () => {
  // `[style*="…"]` matches every element carrying the substring, so a second
  // match is a different element, not a later rule for the same one. Picking the
  // last in document order would be silent, and — because a real value on the
  // wrong element reads as `8px`, not `null` — it can read as a **pass**.
  const twice = `${drawing}<div style="width:46px"></div>`;
  expect(() =>
    mockupDeclared(twice, '[style*="width:46px"]', "background"),
  ).toThrow(/addresses 2 elements/);
  // One match still reads: the guard is for ambiguity, not for attribute
  // selectors as a form.
  expect(mockupDeclared(drawing, '[style*="width:46px"]', "background")).toBe(
    "#0e1217",
  );
});

test("silence is null, and a broken selector still throws", () => {
  // The two are different readings and must stay different: the body row the
  // drawing draws flush declares no padding, but a selector that matches no
  // declaration is a typo in a row, not a flush region.
  expect(
    mockupDeclaredOrNull(
      drawing,
      '[style*="flex:1;min-height:0"]',
      "padding-top",
    ),
  ).toBeNull();
  expect(() =>
    mockupDeclaredOrNull(drawing, ".does-not-exist", "border-radius"),
  ).toThrow(/addresses nothing/);
});

test("a shorthand for a property a row reads fails loudly rather than reading as silence", () => {
  // The third reading, and the one that inverted a row: `lookup` matches
  // property names exactly, so a shorthand is invisible to a row reading its
  // longhand — and a body row reads the drawing's silence as `0`. The body
  // element the row addresses declares no `padding`, and that silence is its
  // value; `padding:8px` on it is a declaration the row cannot see, so the
  // reader refuses rather than reporting the drawing as flush.
  const BODY = '[style*="flex:1;min-height:0"]';
  const BODY_STYLE = 'style="display:flex;flex:1;min-height:0"';
  const padded = drawing.replace(
    BODY_STYLE,
    'style="display:flex;flex:1;min-height:0;padding:8px"',
  );
  expect(padded).not.toBe(drawing);
  expect(() => mockupDeclaredOrNull(padded, BODY, "padding-top")).toThrow(
    /shorthand that sets `padding-top`/,
  );
  // The other half of the same row: `gap` sets `column-gap`.
  const gapped = drawing.replace(
    BODY_STYLE,
    'style="display:flex;flex:1;min-height:0;gap:8px"',
  );
  expect(gapped).not.toBe(drawing);
  expect(() => mockupDeclaredOrNull(gapped, BODY, "column-gap")).toThrow(
    /shorthand that sets `column-gap`/,
  );
  // The silence the map must not touch: the unmutated drawing still reads null,
  // because it declares neither a shorthand nor the longhand.
  expect(mockupDeclaredOrNull(drawing, BODY, "padding-top")).toBeNull();
  expect(mockupDeclaredOrNull(drawing, BODY, "column-gap")).toBeNull();

  // **And the shorthand that went unlisted, which is `vg-442`'s type half.** The
  // controls drawing states the plain-DOM button box's type as
  // `font:400 12px/1.4 system-ui` (`current/controls.html`), and the map named no
  // font longhand — so a row naming `font-size` read the drawing's **silence**
  // (`null`, which the parity table reads as `0`) where the drawing drew a size.
  // The refusal now covers `font`'s longhands. **What it still refuses is the
  // comparison, not the reading**: the drawing writes the shorthand and the
  // product writes a scale token (`var(--text-sm)`), so no row can put the two
  // sides in one string, and the drawing's type is a declaration the instrument
  // says it does not compare rather than one it silently reports as absent.
  const BOX =
    '[style*="flex:1;text-align:center;border:1px solid var(--well-edge);border-radius:6px;background:var(--well);padding:4px 8px"]';
  const controls = readMockup(CONTROLS_MOCKUP_PATH);
  // The shorthand itself is still a readable property: the refusal is about a row
  // asking for a longhand of it, not about the declaration being invisible.
  expect(mockupDeclaredOrNull(controls, BOX, "font")).toBe(
    "400 12px/1.4 system-ui",
  );
  expect(() => mockupDeclaredOrNull(controls, BOX, "font-size")).toThrow(
    /shorthand that sets `font-size`/,
  );
  expect(() => mockupDeclaredOrNull(controls, BOX, "line-height")).toThrow(
    /shorthand that sets `line-height`/,
  );
});

test("the current set is enumerated by directory, and every drawing in it reads", () => {
  // The radii gate reads every drawing in `docs/design/mockups/current/` from
  // this enumeration, so a directory read that stopped seeing one of the four
  // has dropped a drawing the suite claims to check.
  const drawings = currentDrawings();
  const names = drawings.map((drawing) => drawing.name);
  for (const known of [
    "docs/design/mockups/current/shell.html",
    "docs/design/mockups/current/settings.html",
    "docs/design/mockups/current/controls.html",
    "docs/design/mockups/current/controls-editorial.html",
  ]) {
    expect(
      names,
      `${known} is not enumerated by the current-set reading`,
    ).toContain(known);
  }
  // The negative half: a reader that returned four names and read nothing from
  // disk passes the loop above, so each path is opened and read.
  for (const drawing of drawings) {
    expect(
      readMockup(drawing.path),
      `${drawing.name} did not read back as a drawing`,
    ).toContain("<!doctype html>");
  }
});

test("the reader returns what the text says, not a constant", () => {
  // The check the three above cannot make. A reader that answered "#0b0e12"
  // unconditionally passes every one of them; it cannot pass this.
  const changed = drawing.replace("background: #0b0e12", "background: #101418");
  expect(changed).not.toBe(drawing);
  expect(mockupDeclared(changed, "body", "background")).toBe("#101418");
  // And a different declaration site, so one lucky literal is not the whole
  // mechanism.
  const restyled = drawing.replace("width:46px", "width:52px");
  expect(mockupDeclared(restyled, '[style*="width:52px"]', "background")).toBe(
    "#0e1217",
  );
  expect(() =>
    mockupDeclared(restyled, '[style*="width:46px"]', "background"),
  ).toThrow(/addresses nothing/);
});

test("the reader reads the path it is given", () => {
  // Two drawings, one reader. A `readMockup` that closed over `MOCKUP_PATH`
  // would read the shell for the settings rows and pass anything; a selector
  // that resolves in one file and addresses nothing in the other is what tells
  // the two apart without printing either.
  const settings = readMockup(SETTINGS_MOCKUP_PATH);
  expect(settings).not.toBe(drawing);
  expect(mockupDeclared(settings, '[style*="width:150px"]', "background")).toBe(
    "#0e1217",
  );
  expect(() =>
    mockupDeclared(drawing, '[style*="width:150px"]', "background"),
  ).toThrow(/addresses nothing/);
});

test("the last declaration in document order wins", () => {
  // A later `<style>` block, or a later rule for the same selector, overrides:
  // the reading a person gets from opening the file, and the cascade's rule for
  // equal specificity. Specificity is not weighed — this reader has no cascade.
  const twice = `${drawing}<style>body { border-radius: 3px; }</style>`;
  expect(mockupDeclared(twice, "body", "border-radius")).toBe("3px");
});

test("the comparator holds every token of a value, and reads one value as one length", () => {
  // The regression this pins, in the comparator's own words: reading only the
  // first token made `border-radius: 8px 8px 0 0` on `.editor-shell-dialog`
  // read as `8`, so a square-bottomed modal passed both dialog rows. A
  // non-uniform value has no single length it means, so it is `null` — a loud
  // failure — and never the first corner.
  expect(lengthInPx("8px 8px 0 0")).toBeNull();
  expect(lengthInPx("8px 10px")).toBeNull();
  expect(lengthInPx("6px/8px")).toBeNull();
  // The spellings that must keep meaning their own length, or the fix would
  // have traded a false pass for a false failure on every row it guards.
  expect(lengthInPx("8px")).toBe(8);
  expect(lengthInPx("8px 8px 8px 8px")).toBe(8);
  // A bare `0` is the one length CSS lets a drawing write without a unit, so a
  // flush row that says `padding-top: 0` reads as flush rather than as a value
  // this table cannot read — the false failure the `px`-only read would give it.
  expect(lengthInPx("0")).toBe(0);
  expect(lengthInPx("0px")).toBe(0);
  // A unitless non-zero is not a length, and must not be read as one.
  expect(lengthInPx("5")).toBeNull();
  expect(lengthInPx("1.5px")).toBe(1.5);
  // `gap`'s own word for no gap, and the values this table cannot read at all.
  expect(lengthInPx("normal")).toBe(0);
  expect(lengthInPx("")).toBeNull();
  expect(lengthInPx("50%")).toBeNull();
  expect(lengthInPx("auto")).toBeNull();
});

test("every row names a comparator, and each row's drawing value is one it reads", () => {
  expect(PARITY.length).toBeGreaterThan(0);
  /** A length, or `normal` — `gap`'s word for no gap. */
  const isLength = (value: string): boolean => {
    const first = value.trim().split(/[\s/]+/)[0] ?? "";
    return first === "normal" || /^-?[\d.]+px$/.test(first);
  };
  for (const row of PARITY) {
    // Every row names at least one source, and a row that names none is a row
    // with nothing to compare it against — the shape the shell's own frame had,
    // and the reason it left the table (the census records it `no-counterpart`).
    const owners = [
      row.licensed !== undefined,
      row.scaleToken !== undefined,
      row.mockupSelector !== undefined,
    ].filter(Boolean).length;
    expect(
      owners,
      `${row.region}: the row names no licence, no scale token and no drawing selector, so nothing governs it`,
    ).toBeGreaterThan(0);
    // A licence and a scale token are two different answers to "what governs
    // this", and a row cannot be owned by both. A `licensed` row *may* also name
    // the drawing's selector — that is the declaration the licence is about.
    expect(
      row.licensed === undefined || row.scaleToken === undefined,
      `${row.region}: a row names both a licence and a scale token`,
    ).toBe(true);
    // A scale-owned row must not also carry a drawing selector: the selector it
    // would name is a window's wrapper, which is what withdrew the comparator.
    // A **colour** row is the one kind whose scale token is read as a colour:
    // `--elev-scrim` is `#00000073`, which no length reading has an answer for.
    if (row.scaleToken !== undefined) {
      expect(
        row.mockupSelector,
        `${row.region}: a scale-owned row must not name a drawing selector`,
      ).toBeUndefined();
      continue;
    }
    // The row's own drawing: the shell's unless the row names another, so a
    // surface drawn on its own file is read from that file rather than from
    // whichever one this loop happened to open first.
    const source =
      row.mockupPath === undefined ? drawing : readMockup(row.mockupPath);
    // A licensed row is recorded, not asserted, so its declared value need not
    // be a length this file could compare — the stage ground is a gradient. The
    // **value** is still read, though: a licence quotes a declaration, and one
    // nobody reads licenses whatever is there now, including a region the drawing
    // stopped drawing. `mockupDeclaredOrNull` throws when the selector addresses
    // nothing, so reaching the assertion is itself the proof that the licence's
    // region is still drawn; the value only has to be one the drawing still
    // declares. (The stage ground's licence is additionally about its *texture* —
    // that reading lives in the row's own licence text, not in a substring every
    // full-time licensed row would have to share.)
    if (row.licensed !== undefined) {
      const declared = mockupDeclaredOrNull(
        source,
        row.mockupSelector ?? "",
        row.mockupProperty,
      );
      expect(
        declared,
        `${row.region}: the licensed row's selector reads nothing, so its licence quotes a region the drawing no longer draws`,
      ).not.toBeNull();
      continue;
    }
    // Throws when the selector addresses nothing, which is the failure this
    // loop is for: a row whose selector went stale must red here, not read as a
    // region the drawing draws flush.
    const declared = mockupDeclaredOrNull(
      source,
      row.mockupSelector ?? "",
      row.mockupProperty,
    );
    // `null` is a legitimate reading — the four body regions are exactly the
    // rows the drawing is silent about, and the spec reads that silence as `0`.
    if (declared === null) continue;
    // **Read through the row's own comparator, not through `lengthInPx`.** The
    // palette grid's declared value is `repeat(3,1fr)` and the drawing declares no
    // colour any row reads, so a length-only check here would red on the count
    // row's own drawing — and, worse, would let a count row be *given* a px value
    // and pass.
    const reads =
      row.comparator === "count"
        ? trackCount(declared) !== null
        : row.comparator === "colour"
          ? colourValue(declared) !== null
          : isLength(declared);
    expect(
      reads,
      `${row.region}: the drawing declares \`${declared}\`, which is not a ${row.comparator ?? "length"} this table can compare`,
    ).toBe(true);
  }
});

test("a track count is read, and a value that is not one is null", () => {
  // The count comparator, and the reason it is not `lengthInPx`: the drawing's
  // declared value and the product's computed one are the *same property* in two
  // forms, `repeat(3,1fr)` and a serialised track list, and a px reading answers
  // `null` for both.
  expect(trackCount("repeat(3,1fr)")).toBe(3);
  expect(trackCount("repeat( 2 , 1fr )")).toBe(2);
  expect(trackCount("146px 146px")).toBe(2);
  expect(trackCount("146px 146.5px 146px")).toBe(3);
  // A track that carries its own whitespace is one track, not two, and a line
  // name is not a track at all.
  expect(trackCount("minmax(0px, 1fr) 1fr 1fr")).toBe(3);
  expect(trackCount("[full-start] 1fr [full-end]")).toBe(1);
  expect(trackCount("[a] 1fr [b] 2fr [c]")).toBe(2);
  // The values this comparator has no count for — and `repeat(auto-fill, …)` is
  // the one that matters: it is a bound, not a count, so it must not be read as
  // the drawing's number.
  expect(trackCount("none")).toBeNull();
  expect(trackCount("subgrid")).toBeNull();
  expect(trackCount("")).toBeNull();
  expect(trackCount("repeat(auto-fill, minmax(80px, 1fr))")).toBeNull();
  // The check the assertions above cannot make: a comparator answering a
  // constant passes them. A drawing moved to three columns must come back as
  // three.
  const three = settings.replace("repeat(3,1fr)", "repeat(4,1fr)");
  expect(three).not.toBe(settings);
  expect(trackCount(mockupDeclared(three, GRID, "grid-template-columns"))).toBe(
    4,
  );
  expect(
    trackCount(mockupDeclared(settings, GRID, "grid-template-columns")),
  ).toBe(3);
});

test("a colour is read as a resolved value, so one colour's spellings are equal", () => {
  // The colour comparator, and the reason it is not a string comparison: the
  // DESIGN.md writes the modal's scrim `#00000073` and a browser computes the same
  // colour as `rgba(0, 0, 0, 0.451)`, so the two sides of a colour row are never
  // the same text.
  expect(colourValue("#00000073")).toBe("rgba(0, 0, 0, 115)");
  expect(colourValue("rgba(0, 0, 0, 0.451)")).toBe(colourValue("#00000073"));
  expect(colourValue("rgb(0 0 0 / 45.1%)")).toBe(colourValue("#00000073"));
  expect(colourValue("#0009")).toBe("rgba(0, 0, 0, 153)");
  expect(colourValue("rgba(0, 0, 0, 0.6)")).toBe(colourValue("#0009"));
  expect(colourValue("#fff")).toBe("rgba(255, 255, 255, 255)");
  expect(colourValue("#12161c")).toBe("rgba(18, 22, 28, 255)");
  expect(colourValue("transparent")).toBe("rgba(0, 0, 0, 0)");
  expect(colourValue("rgba(0,0,0,0)")).toBe(colourValue("transparent"));
  // **The difference the row is for.** 60% black is not 45% black, and a
  // comparator that answered `true` here would pass the product's `#0009` row.
  expect(colourValue("#0009")).not.toBe(colourValue("#00000073"));
  expect(colourValue("#0b1419a8")).not.toBe(colourValue("#12161c"));
  // The values this comparator has no colour for. `color-mix(…)` is the one that
  // matters: `--edge-2` and `--faint` are written that way, so a row that named
  // one is `null` rather than a guess at the mix.
  expect(colourValue("color-mix(in srgb, red, blue)")).toBeNull();
  expect(colourValue("linear-gradient(145deg,#101923,#071116)")).toBeNull();
  expect(colourValue("")).toBeNull();
  expect(colourValue("rgba(0, 0)")).toBeNull();
  expect(colourValue("#12345")).toBeNull();
});

/** The row or copied element a case names, or a throw — both tables are data,
 *  and a case that silently found nothing would assert nothing. */
function named<T extends { readonly region: string }>(
  list: readonly T[],
  region: string,
): T {
  const found = list.find((one) => one.region === region);
  if (found === undefined) {
    throw new Error(
      `no entry named \`${region}\`: the case names a row the table does not carry`,
    );
  }
  return found;
}

test("a parity row names a property its drawing's selector declares, or says its value is the drawing's silence", () => {
  // **The reading this closes is silence mistaken for a value (`vg-304`).**
  // `mockupDeclaredOrNull` answers `null` for a region the drawing draws flush —
  // the four body regions and the four panel radii — and it answers `null` for a
  // property the row *misspelt* too. Nothing related a row's `mockupProperty` to
  // the set its `mockupSelector` declares, so a row could compare nothing and
  // pass. The table now says which of the two it means: a row reads what its
  // element declares, unless it marks the silence as its value.
  const failures: string[] = [];
  for (const row of PARITY) {
    // A scale-owned row names no drawing selector — the table's own case below
    // asserts that contract — so it has no declared set to be checked against.
    if (row.mockupSelector === undefined) continue;
    const source =
      row.mockupPath === undefined ? drawing : readMockup(row.mockupPath);
    try {
      assertParityRowProperty(source, row);
    } catch (error) {
      failures.push(`${row.region}: ${(error as Error).message}`);
    }
  }
  expect(failures).toEqual([]);

  // The row the rule is for: one naming a property its element does not carry.
  // The header's element declares `height`, `flex`, `gap`, `padding` and more,
  // and declares no `border-radius` — a row naming it compared the drawing's
  // silence, and nothing reddened for that before this.
  expect(() =>
    assertParityRowProperty(drawing, {
      ...named(PARITY, "header — height"),
      region: "header — a property the header does not declare",
      mockupProperty: "border-radius",
    }),
  ).toThrow(/does not declare/);

  // And the marker read the other way. The body row's element declares no
  // `padding-top`, so its silence is the row's value — but the same element
  // *does* declare `display`, and a marker there claims a silence the drawing
  // stopped drawing, which is a stale claim rather than a licence.
  expect(() =>
    assertParityRowProperty(drawing, {
      ...named(PARITY, "body — inset"),
      region: "body — a silence the drawing does not draw",
      mockupProperty: "display",
      mockupSilence: true,
    }),
  ).toThrow(/the marker is stale/);

  // And a shorthand is not silence. The header's element declares `padding`,
  // which sets `padding-top`: a value row reading that longhand throws naming the
  // shorthand, so a marked row may not call it the drawing's silence. The two
  // readings answer the same question and must not disagree.
  expect(() =>
    assertParityRowProperty(drawing, {
      ...named(PARITY, "header — height"),
      region: "header — a longhand its element sets by shorthand",
      mockupProperty: "padding-top",
      mockupSilence: true,
    }),
  ).toThrow(/shorthand that sets/);
});

test("every element a drawing copies from the original declares the original's treatment", () => {
  // **The value §3 cannot be asked about (`vg-320`).** The drawings gate asks
  // whether a value is one §3 has — and `4px` is, which is how the keyboard
  // drawing shipped a `4px` row container where the original draws `6px` with
  // every gate green. This reads the pair the doctrine makes (README: the
  // treatment "is copied from the original drawings" and "is never redrawn from
  // the product") over a named list, because a whole-file diff would report the
  // current set's own density and its scale normalisation as drift.
  const original = readMockup(ORIGINAL_MOCKUP_PATH);
  const failures: string[] = [];
  for (const entry of COPIED_ELEMENTS) {
    const drift = copiedElementDrift(
      readMockup(entry.drawing),
      original,
      entry,
    );
    if (drift.length > 0) failures.push(`${entry.region}: ${drift.join("; ")}`);
  }
  expect(failures).toEqual([]);

  // The check the loop above cannot make: a comparator answering `[]` passes it.
  // The row's own instance, put back — all twenty containers at the 4px only a
  // reviewer's eye caught — must come back as a difference.
  const row = named(COPIED_ELEMENTS, "keyboard — the shortcut row container");
  const current = readMockup(row.drawing);
  const drifted = current.replaceAll(
    "gap:16px;padding:4px 6px;border-radius:6px",
    "gap:16px;padding:4px 6px;border-radius:4px",
  );
  expect(drifted).not.toBe(current);
  expect(copiedElementDrift(drifted, original, row)).toEqual([
    "border-radius: the drawing declares `4px`, the original `6px`",
  ]);

  // And the half a single-row drift would otherwise hide: the address does not
  // carry the compared value, so one drifted container leaves nineteen still
  // carrying it and the reader refuses to settle between two forms rather than
  // answering with the ones that did not move.
  const one = current.replace(
    "gap:16px;padding:4px 6px;border-radius:6px",
    "gap:16px;padding:4px 6px;border-radius:4px",
  );
  expect(one).not.toBe(current);
  expect(() => copiedElementDrift(one, original, row)).toThrow(
    /does not settle which one it means/,
  );

  // And what the list deliberately leaves out: the same element's `gap` is the
  // current set's own density against the original's, so the pair is not held to
  // it. Both sides are read, so the ceiling is a measurement and not a claim.
  expect(mockupDeclared(current, row.selector, "gap")).toBe("16px");
  expect(mockupDeclared(original, row.originalSelector, "gap")).toBe("10px");
});

/* ── The licence policy (`vg-292`) ──────────────────────────────────────────
 *
 * **Why this is a test of its own.** A `licensed` row is *recorded*, not
 * compared (`design-language-parity.spec.ts`), so the licence is the whole of
 * that row's gate — and before `licenceFindings` existed, any string discharged it.
 * Spec §13's amendment of 2026-10-10 states the policy; these are its refusals,
 * each pinned with a fixture *and*, for the licences the table carries, run over
 * the real tree. A fixture proves a refusal fires; a real licence proves it does
 * not fire on a reason that is genuinely licensed — without one, a predicate
 * returning a constant would pass every case here.
 *
 * **The dates come from this repository, and the repository is not always
 * complete.** Everything here derives from `git log` / `git blame`, and in a
 * shallow clone the boundary commit is diffed against the empty tree, so *every*
 * query answers the boundary: both table licences would read as written by their
 * own citing commit and be refused for a reason that is not about any licence. A
 * false refusal is worse than no check — it is how a gate gets switched off — so
 * the ledger refuses a shallow tree outright, naming the cause, and
 * `.github/workflows/ci.yml` asks its checkout for the history rather than
 * letting a depth-1 clone quietly answer every question wrongly.
 */

const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
const DESIGN_TEXT = readFileSync(resolve(REPO_ROOT, "DESIGN.md"), "utf8");
/** Where the `licensed` text is searched for, as a pathspec. **The directory,
 *  not the file that holds it today**: a `licensed` string moved between the
 *  readers beside it leaves the directory's own occurrence count unchanged, so
 *  `introducedBy` still answers the commit that *wrote* the licence rather than
 *  the one that moved it — a move must not re-date a licence forward past the
 *  rule it quotes. */
const LICENCE_PATHSPEC = "src/web/tests/e2e/";
/** Where a `licensed` string is written, named for the citation checker: it
 *  claims a marker only from a declared source, and a licence quotes DESIGN.md
 *  from this reader (`docs/decisions/0060`). */
const LICENCE_SOURCE = "src/web/tests/e2e/mockup-parity.ts";
/** The commit that added §5's "Bare readout" row and left `<!-- §5 -->` alone —
 *  the real amendment the predating limb exists for. Named, not inferred: the
 *  assertion below is that the rule's own line blames to *this* commit where the
 *  marker blames to an older one. */
const BARE_READOUT_COMMIT = "61d7435bddd5c205019cf97a2849740a06e0713f";

/** Ask git one question and read its answer, or throw naming `what` — a query
 *  that fails is a failure here, not an empty read that refuses a licence for a
 *  reason unrelated to it. */
function git(args: readonly string[], what: string): string {
  try {
    return execFileSync("git", args, { cwd: REPO_ROOT }).toString();
  } catch (error) {
    throw new Error(
      `${what}: \`git ${args.join(" ")}\` failed (${(error as Error).message})`,
    );
  }
}

/** The refusal a `--is-shallow-repository` answer earns, or `null` for a full
 *  tree. Pure, so the `true` case is pinned without cloning this repository at
 *  depth 1 from inside its own suite. */
function shallowRefusal(answer: string): string | null {
  return answer.trim() === "true"
    ? "this checkout is shallow, so `git log` and `git blame` answer every question with the boundary commit and the licence dates are meaningless: fetch the full history (`fetch-depth: 0`, which `.github/workflows/ci.yml` sets) before running the parity gate"
    : null;
}

/** The repository's history, or a refusal naming why it cannot be read. */
function requireFullHistory(): void {
  const refusal = shallowRefusal(
    git(
      ["rev-parse", "--is-shallow-repository"],
      "the licence dates were not read",
    ),
  );
  if (refusal !== null) throw new Error(refusal);
}

/** The commit whose diff first changed `needle`'s occurrence count in `path` —
 *  where the licence text itself appeared. `git log` is newest-first. */
function introducedBy(needle: string, path: string): string | null {
  const shas = git(
    ["log", "--format=%H", `-S${needle}`, "--", path],
    "the licence's own commit was not read",
  )
    .trim()
    .split("\n")
    .filter((line) => line !== "");
  return shas[shas.length - 1] ?? null;
}

/** Where in `text` the whitespace-collapsed `flatQuote` begins, as a raw offset,
 *  or `-1`. */
function rawOffsetOf(text: string, flatQuote: string): number {
  const offsets: number[] = [];
  let flat = "";
  let spaced = true;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? "";
    if (/\s/.test(character)) {
      if (spaced) continue;
      spaced = true;
    } else {
      spaced = false;
    }
    flat += spaced ? " " : character;
    offsets.push(index);
  }
  const at = flat.indexOf(flatQuote);
  return at < 0 ? -1 : (offsets[at] ?? -1);
}

/** The commit the quotation entered `path` in — the rule's own introduction.
 *
 *  **The line the quotation stands on, blamed, rather than `git log -S<quote>`.**
 *  A rule the file wraps across lines matches no `-S` needle: §7.5's sentence
 *  spans three lines of DESIGN.md and, measured in this repository,
 *  `git log -S'<the whole quotation>' -- DESIGN.md` returns *nothing* — which
 *  would refuse the table's own §7.5 licence as quoting nothing. Blaming the
 *  quotation's first line dates the text as written, wrap and all, and it
 *  catches what a marker's sha cannot: `61d7435b` amended §5's table without
 *  touching `<!-- §5 -->`, so a marker-dated check reads §5's birth and lets a
 *  licence landing with that amendment through. */
function ruleCommit(path: string, quote: string): string | null {
  const text = readFileSync(resolve(REPO_ROOT, path), "utf8");
  const offset = rawOffsetOf(text, quote.replace(/\s+/g, " ").trim());
  if (offset < 0) return null;
  const line = text.slice(0, offset).split("\n").length;
  const blamed = git(
    ["blame", "--porcelain", "-L", `${line},${line}`, "--", path],
    `the rule \`${quote.slice(0, 40)}…\` could not be dated`,
  );
  return blamed.slice(0, 40) || null;
}

/** The commit that introduced a `<!-- §N -->` marker — the *older* reading this
 *  limb moved off. Kept so the test can show the two disagree for the case that
 *  matters. */
function markerCommit(number: string): string | null {
  return introducedBy(`<!-- §${number} -->`, "DESIGN.md");
}

/** Every note an `ADR-NNNN` or a path may name: the ADRs and the decision
 *  notes, read from the tracked list rather than from a directory walk. */
const NOTES = new Map(
  git(
    ["ls-files", "docs/adr", "docs/decisions"],
    "the decision notes were not read",
  )
    .split("\n")
    .filter((line) => line.endsWith(".md") && !line.endsWith("README.md"))
    .map(
      (path) => [path, readFileSync(resolve(REPO_ROOT, path), "utf8")] as const,
    ),
);

const SECTIONS = sectionTexts(DESIGN_TEXT);

/** The ledger a licence is judged against, dated by git. `licensedAt` is the
 *  commit that introduced the licence text — the row's own record of the
 *  divergence it keeps — and each quotation is dated from the line it stands on
 *  in the file the licence names. */
function licenceLedger(licensed: string): LicenceLedger {
  requireFullHistory();
  return {
    sections: SECTIONS,
    notes: NOTES,
    spec: {
      path: LICENCE_SPEC,
      aliases: LICENCE_SPEC_ALIASES,
      text: readFileSync(resolve(REPO_ROOT, LICENCE_SPEC), "utf8"),
    },
    canonicalNumbers: [...CITE_NUMBERS],
    licensedAt: introducedBy(licensed, LICENCE_PATHSPEC),
    introducedAt: ruleCommit,
  };
}

/** The licence a named row carries, so a test reads the text the table actually
 *  holds rather than a restatement of it. */
function rowLicence(region: string): string {
  const row = PARITY.find((candidate) => candidate.region === region);
  expect(
    row?.licensed,
    `no parity row named \`${region}\` carries a licence`,
  ).toBeTruthy();
  return row?.licensed ?? "";
}

/** §5's "Bare readout" row, as DESIGN.md writes it. Read from the section rather
 *  than transcribed, so the case cannot drift from the rule it names. */
const BARE_READOUT = (SECTIONS.get("5") ?? "")
  .split("\n")
  .find((line: string) => line.includes("Bare readout"))
  ?.trim();

test("every licence names a resolvable rule, quotes it, and predates its row", () => {
  const licensed = PARITY.filter((row) => row.licensed !== undefined);
  // The positive control: a predicate that read nothing would pass an empty
  // table, and a table carrying no licence is the state the policy is
  // unexercised in.
  expect(
    licensed.length,
    "no parity row carries a licence, so this test reads nothing",
  ).toBeGreaterThan(0);
  for (const row of licensed) {
    const text = row.licensed ?? "";
    expect(
      licenceFindings(text, licenceLedger(text)),
      `${row.region}: the licence does not discharge spec §13`,
    ).toEqual([]);
    // The half `licenceFindings` delegates to `design-md --cite`: every
    // canonical number this licence names must have a marker DESIGN.md carries,
    // which is that checker's own rules 1 and 2. Its range is narrowed to the
    // numbers in the licence and its "marker no citation claims" rule silenced,
    // so a finding about some *other* marker cannot be read as a verdict here.
    const numbers = [...text.matchAll(/§(\d+(?:\.\d+)?)/g)]
      .map((match) => match[1] ?? "")
      .filter((number) => CITE_NUMBERS.includes(number));
    expect(
      checkCitations(
        { design: DESIGN_TEXT, citations: [{ path: LICENCE_SOURCE, text }] },
        { numbers, uncitedOk: [...CITE_NUMBERS] },
      ).map((finding) => `${finding.what}: ${finding.why}`),
      `${row.region}: the licence names a section that does not resolve`,
    ).toEqual([]);
  }
});

test("a licence naming no normative source is refused", () => {
  const why = (text: string) =>
    licenceFindings(text, licenceLedger(text)).join("; ");
  // Plan 5's Task 6 shape: eleven differences, ten reasons, each citing what a
  // section does *not* say — reasons with no source in them at all.
  expect(why("the drawing's texture is a composition choice")).toContain(
    "names no normative source",
  );
  // A number outside the canonical range names another document's section, not a
  // DESIGN.md one: the redesign spec's own `§N` shares the glyph (vg-352).
  expect(why("§75 permits it")).toContain("names no normative source");
  // A note the tree does not hold is no rule, and reads as a finding rather than
  // as a crash.
  expect(why("docs/decisions/9999-nothing.md requires it")).toContain(
    "which the tree does not hold",
  );
  expect(why("ADR-9999 requires it")).toContain("which the tree does not hold");
});

test("a licence that quotes nothing of its source is refused", () => {
  const why = (text: string) =>
    licenceFindings(text, licenceLedger(text)).join("; ");
  // The decisive case: `§7` fixes the three tabs and says nothing about their
  // axis, so there is no rule to quote — the reason plan 5 recorded as
  // deliberate, and the one this limb has to kill.
  expect(
    why("§7 fixes the three tabs and what each holds, not their axis"),
  ).toContain("without quoting its rule");
  // A quotation has to be that source's: these words are DESIGN.md's, but they
  // are not §7.5's, so naming §7.5 and quoting them quotes nothing of it.
  expect(
    why('§7.5: "| 20–24 | Between regions; dialog padding |" permits it.'),
  ).toContain("without quoting its rule");
  // The other direction, so the two are not one refusal: the modal's licence
  // quotes its own §3 table row verbatim, which is what the rule admits.
  const real = rowLicence(
    "settings modal — the frame's inset (the dialog's padding)",
  );
  expect(licenceFindings(real, licenceLedger(real))).toEqual([]);
});

test("a quotation scoped to the wrong place, or cut to a fragment, is refused", () => {
  const why = (text: string) =>
    licenceFindings(text, licenceLedger(text)).join("; ");
  // A term is in every section of a document about layout and quotes no rule.
  expect(why('§3: "padding"')).toContain("quotes a fragment of");
  // DESIGN.md's front matter is not §9's rule: the *section*, not the file, is
  // what a `§N` licence's quotation is read against.
  expect(why('§9: "system-ui, sans-serif"')).toContain(
    "without quoting its rule",
  );
  // And the cross-section case a whole-document reading admits: §7.5's own
  // sentence, quoted under §3's number.
  expect(
    why(
      '§3: "Subtle palette-derived stage texture is permitted when it stays behind the artwork and does not obscure controls; neither texture nor a flat ground is mandatory."',
    ),
  ).toContain("without quoting its rule");
  // The positive control for the same limb: a whole line of §5 is a rule, and §5
  // is where it is written.
  expect(BARE_READOUT).toBeTruthy();
  const text = `§5: "${BARE_READOUT ?? ""}" requires the readout`;
  expect(licenceFindings(text, licenceLedger(text))).toEqual([]);
});

test("a licence citing a rule amended by its own commit is refused, on real dates", () => {
  // `61d7435b` added a row to §5's vocabulary table and did not touch
  // `<!-- §5 -->`, so a marker-dated check reads §5's birth and lets the case
  // through. Every date below is this repository's own.
  expect(BARE_READOUT).toBeTruthy();
  const text = `§5: "${BARE_READOUT ?? ""}" requires the readout`;
  const rule = ruleCommit("DESIGN.md", BARE_READOUT ?? "");
  expect(rule, "§5's bare-readout row could not be dated").toBe(
    BARE_READOUT_COMMIT,
  );
  expect(
    markerCommit("5"),
    "the marker and the amended row blame to one commit, so this case no longer distinguishes them",
  ).not.toBe(rule);
  // A licence that landed with the amendment is refused...
  expect(
    licenceFindings(text, { ...licenceLedger(text), licensedAt: rule }).join(
      "; ",
    ),
  ).toContain("entered in the same commit");
  // ...and the same licence citing the same rule, read a commit later, is not —
  // so the finding above is the date, not the wording.
  expect(
    licenceFindings(text, {
      ...licenceLedger(text),
      licensedAt: "0".repeat(40),
    }),
  ).toEqual([]);
});

test("a shallow checkout refuses rather than answering every licence wrongly", () => {
  // A depth-1 clone answers *every* history query with the boundary commit, so
  // both table licences would read as written by their own citing commit. The
  // decision is pinned here; the real tree is the control, and a real `--depth
  // 1` clone is the red-proof run outside the suite.
  expect(shallowRefusal("true")).toContain("shallow");
  expect(shallowRefusal("true\n")).toContain("fetch-depth: 0");
  expect(shallowRefusal("false")).toBeNull();
  expect(() => requireFullHistory()).not.toThrow();
});

test("the licence the table carries today passes, over the real tree", () => {
  // The control the fixtures cannot be: the real licence, the real DESIGN.md,
  // and git doing the dating. A predicate that refused everything would pass
  // every test above and fail this one.
  const text = rowLicence("stage ground — texture");
  expect(licenceFindings(text, licenceLedger(text))).toEqual([]);
  expect(
    licenceSources(text, licenceLedger(text)).map((source) => source.label),
  ).toEqual(["§7.5"]);
  // The wiring, not only the predicate: the licence's own commit and the quoted
  // text's are both real commits and they differ, so the predating arm is
  // reading history rather than answering a constant.
  const dated = licenceLedger(text);
  expect(dated.licensedAt).toMatch(/^[0-9a-f]{40}$/);
  const quote =
    "Subtle palette-derived stage texture is permitted when it stays behind the artwork and does not obscure controls; neither texture nor a flat ground is mandatory.";
  expect(ruleCommit("DESIGN.md", quote)).toMatch(/^[0-9a-f]{40}$/);
  expect(ruleCommit("DESIGN.md", quote)).not.toBe(dated.licensedAt);
  // §7.5's sentence is wrapped across three lines of DESIGN.md, so the blame
  // path — not `-S` — is what can date it. Asserted both ways, because a reader
  // that stopped reading the wrapped form would refuse the table's own licence.
  expect(DESIGN_TEXT).toMatch(/Subtle\s+palette-derived stage texture/);
  expect(DESIGN_TEXT).not.toContain(quote);
  expect(text).toContain(quote);
});
