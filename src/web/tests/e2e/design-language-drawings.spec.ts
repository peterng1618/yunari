import { expect, test } from "@playwright/test";
import {
  ANCHOR_FRACTIONAL,
  ANCHOR_NEGATIVE,
  FULL_RADIUS,
  GUTTER_NEGATIVE,
  HALO_INSET,
  HALO_RING,
  OFF_SCALE_BOUNDARY,
  OFF_SCALE_GUTTER,
  OFF_SCALE_RADIUS,
  OFF_SCALE_TYPE,
  OFF_TABLE_SHADOW,
  OFF_TABLE_SHADOW_LIST,
  THICKNESS_MARK,
} from "./design-language-fixture.js";
import { SHELL_DRAWING, SPACING_STEPS } from "./design-language-readers.js";
import {
  currentDrawings,
  MOCKUP_PATH,
  type MockupDeclaration,
  mockupDeclarations,
  readMockup,
  SHELL_ROLES,
} from "./mockup-values.js";
import { themeToken } from "./shell-tokens.js";

/** Responsibility: §2/§3/§5 drawing literal scales and the shell drawing’s single token-table site. */
/**
 * Every literal **every drawing in `docs/design/mockups/current/`** declares, in
 * the three classes §3 and §2 own, held to the scale that owns each: a
 * `border-radius` to §3's closed radius table (`vg-296`), a spacing property to
 * §3's closed step list, and a type size to §2's six-role size scale.
 *
 * **Why this is a gate and not a sweep.** Task 3 (`be54cfc5`) corrected
 * twenty-one off-scale `border-radius` literals in `shell.html` — seventeen dock
 * buttons, three view-cluster buttons and the follow-the-system track — and
 * nothing read them afterwards: putting one `7px` back left this whole suite
 * green (`vg-296`, measured). A file **measured once** is a measurement; a gate
 * is a test that reddens when the property moves, and this one reads the
 * drawings' own declarations every run, so a value that leaves its scale fails
 * here naming its file and line.
 *
 * **Radius was the only arm until plan 8 Task 8, and the narrowness was the
 * class.** Task 7 closed with this row green and **268 off-scale literals in the
 * same six files**: 103 `11.5px` sizes (`font-size` declarations and `font`
 * shorthands between them), 75 `5px` spacing tokens, 21 `2px`, 19 `7px`, 15
 * `9px`, 11 `3px`, 9 `11px`, 4 `13px`, 3 `13.5px`, 3 `18px`, 2 `26px` and one
 * each of `15px`, `72px` and `10.5px`. §2's scale and §3's step list were both
 * closed and neither was read. The same `padding:5px 8px` sat in all six files,
 * green, because a gate holds the property it names and nothing else.
 *
 * **Every drawing, not `MOCKUP_PATH` alone.** The first gate read the shell
 * drawing only, and the class hid in the three it did not read: `settings.html`
 * declared the `3px` swatch and the `7px` toggle track, and both control
 * drawings the identical `7px` track — the same off-scale class corrected in
 * `shell.html`, in files the row never opened. The set is a directory read
 * (`currentDrawings`), so a fifth drawing is read the moment it lands, and each
 * failure names the file it is in.
 *
 * **§3's radius table is closed**:
 * `--radius-sm` 4 / `--radius-md` 6 / `--radius-lg` 8 / `--radius-xl` 10 /
 * full 999. Three values are exempt, each named with why it is not a scale
 * entry — an unnamed exemption set is the list-shaped escape this plan exists
 * to close, so a fourth value entering a file fails this row rather than
 * joining the set silently:
 *
 * - `1px` and `2px` are **marks whose value is their thickness**, not rounded
 *   surfaces: §7.2's 2px accent bar on the rail's inner edge,
 *   the slider track's ends, the layer dropline.
 *   §3's scale answers a question only a surface that is *rounded* asks.
 * - `50%` is **a circle — `full` reached the other way**: the identity dot, the
 *   slider's thumb and the toggle's knob. It is not a second way to spell a
 *   rounded rectangle, so it does not open the scale.
 *
 * **The spacing arm reads the properties whose px *is* a spacing decision** —
 * `scripts/design-tokens.mjs`'s `SPACING_PROPERTY`, transcribed here for the
 * same reason `SPACING_STEPS` above is (a `tests/e2e/` import of a script would
 * arrive untyped and buy coupling rather than safety). `26px` is deliberately
 * off this scale, as that file's own comment says: §3's row rhythm is a density,
 * not a gutter. Four values are exempt, each named with its reason and each
 * exercised by a drawing:
 *
 * - `0` is **no space** — the degenerate *absence* of a gutter, the square
 *   corner's twin. `padding:5px 0` is an ordinary value, not an off-scale one,
 *   and a row that rejected the `0` in it would cry wolf, which is how a gate
 *   gets turned off.
 * - `1px` is **a hairline**, whose value is its thickness: §7.2's rail inset in
 *   the drawing itself (`shell.html:40` `padding:8px 0 8px 1px`, and the
 *   product's `.editor-shell-rail` declares the identical value).
 *   `design-tokens.mjs`'s `ALWAYS_PX` names 1 for the same reason.
 * - a value that is **negative** or **fractional** is **a mark's anchor**, not a
 *   gutter: the rail's accent bar hangs at `right:-6px` across the 6px gutter it
 *   sits in, and the slider's thumb at `top:-3.5px` centres a 10px circle on a
 *   3px track. §3's step table is a table of gutters and insets and has no row
 *   for either, and correcting one would un-centre the mark rather than align
 *   it. `.editor-shell-rail button[aria-pressed="true"]::before` says the same
 *   of the product's own bar.
 * - `auto` and `%` are **not lengths on the base at all** — the slack a flex
 *   line has left (`margin-left:auto`) and a share of the parent's own size
 *   (`left:50%`, which centres the dock alongside its `translateX(-50%)`).
 *
 * **The type arm reads `font-size` and the `font` shorthand.** §2's scale is six
 * roles, and a shorthand writes its size before its
 * line-height (`600 13.5px/1.2 system-ui`), which is the token read here. A
 * shorthand carrying no px length sets no size this row can read, so it is
 * returned whole and fails naming itself rather than passing as the drawing's
 * silence.
 *
 * **Two arms read what no arm read before (`vg-296`'s two remaining clauses).**
 * The **elevation arm** holds every `box-shadow` a drawing declares to §3's
 * elevation table — level 1 `0 8px 20px #00000059`, level 2 `0 18px 44px
 * #00000099`, level 3 `0 24px 60px #000000b3`, or no shadow at all (level 0,
 * spelled by omitting the property or by writing `none`) — and exempts only the
 * two *marks* §5 rule 4 keeps: the spread-only accent-at-18% halo and an `inset`
 * shadow. It reads a shadow **list** part by part, so a halo layered over an
 * off-table shadow is refused rather than admitted by its first part. Without it
 * a cluster shadow off the table is inherited by the product, which is what the
 * three `#0007` shadows in the superseded drawing did. Both arms are **not**
 * per-drawing: a control
 * drawing legitimately draws no shadow (level 0), so the per-arm control below
 * is what refuses an empty read. The **boundary arm** holds every `border` and
 * `border-*` to §5's hairline (`1px`) vocabulary. It is deliberately the width
 * and not the colour: §5 rule 2 admits "a switch row whose label fills the row
 * inside a panel box", and the drawing materialises a derived colour where the
 * product writes `color-mix(…)`, so a colour allow-list would fail a drawing
 * technique §5 has no entry against. **What the boundary arm therefore cannot
 * catch is a bordered *container*** — a declaration cannot tell a container
 * from a control — and that clause of `vg-296` is **dispositioned, not open**:
 * §5 rule 2 admits "a row a surface's own drawing shapes differently — a switch
 * row whose label fills the row inside a panel box … is not a field row and
 * keeps the shape it is drawn with", and a licensing rule that predates the row
 * is a disposition rather than a gate this arm owes. The arm's limit and the
 * row's disposition are the same fact, so neither waits on the other.
 *
 * **What this row cannot read, and does not claim.** `line-height`,
 * `font-weight` and `letter-spacing`: §2 states a line-height and a weight per
 * role, and a size is what a role is chosen by. **`line-height` is the one of
 * the three the drawings now state and this row still does not read** — every
 * text element in all six carries its token's companion (`vg-440`), so the
 * property is present to read and an arm for it is a separate row rather than
 * this one's. The drawings' **page furniture**
 * — each drawing's `<style>` block (`body { margin: 0; … font: 12px … }`)
 * and the token table the outermost element carries — is read like everything
 * else, because `mockupDeclarations` gives no structural split between the page
 * and the drawn surface inside it. That is the reading's own limit, and it is
 * not "nothing furniture-shaped is in a scale property": `margin: 0`, `font:
 * 12px` and the wrapper's `padding:24px` all are. It passes today because every
 * one of those happens to be on the scale already (0 is the collapse reset, 12
 * is `--text-sm`), so a future furniture value off the scale would redden this
 * row and have to be named rather than exempted.
 *
 * The whole-file reading comes from `mockupDeclarations`, not from a selector:
 * the property is bound wherever it is written, and `[style*="…"]` could only
 * ever address the elements a row already knew about.
 *
 * A `--grep` that matches nothing exits 0 with zero tests, so the run's own
 * summary is the proof this ran at all.
 */
test("every literal the checked drawings declare is on §3's scale or §2's", () => {
  const drawings = currentDrawings();
  // The positive control: a reader that found no drawing at all would pass the
  // assertion below, and `vg-296` is exactly a file nothing read.
  expect(
    drawings.length,
    "docs/design/mockups/current/ holds no drawing, so this row read nothing",
  ).toBeGreaterThan(0);

  /** §3's closed radius scale. The four steps are the stylesheet's own
   *  `--radius-*` tokens, read rather than transcribed, so a scale change moves
   *  this row with the product; `full` is DESIGN.md's prose row and is named in
   *  the fixture. */
  const RADIUS = new Set([
    themeToken("--radius-sm"),
    themeToken("--radius-md"),
    themeToken("--radius-lg"),
    themeToken("--radius-xl"),
    FULL_RADIUS,
  ]);
  /** The named degenerate radius marks, each with the reason it is exempt. */
  const RADIUS_DEGENERATE = new Map([
    ["1px", "a hairline mark, whose value is its thickness"],
    [
      THICKNESS_MARK,
      "a thickness mark (§7.2's rail accent bar, the slider track ends)",
    ],
    [
      "50%",
      "a circle — `full` reached the other way (the thumb, the knob, the dot)",
    ],
  ]);
  /** A corner is square when it is **zero**, in either spelling CSS allows for
   *  a radius (`0` and `0px`; `0%` is the same zero). Square is the degenerate
   *  *absence* of rounding, and it arrives in a shorthand — `8px 8px 0 0` is an
   *  ordinary value, not an off-scale one. Without this the row would reject a
   *  legitimate square corner and cry wolf, which is how a gate gets turned
   *  off. A **non-zero** corner is still held to the scale: the regex admits
   *  only a number and an optional `px`/`%`, so `0.0` and `-0px` are zero and
   *  `7px` is not. */
  const isSquare = (corner: string): boolean => {
    const parsed = /^(-?[\d.]+)(?:px|%)?$/.exec(corner);
    return parsed !== null && Number.parseFloat(parsed[1] ?? "NaN") === 0;
  };
  const radiusAllowed = (corner: string): boolean =>
    RADIUS.has(corner) || RADIUS_DEGENERATE.has(corner) || isSquare(corner);

  /** §3's closed step list — the same transcription the fixture rows above
   *  read, so a §3 change moves one list rather than two. */
  const SPACING = new Set(SPACING_STEPS);
  /** The properties whose px **is** a spacing decision, transcribed from
   *  `scripts/design-tokens.mjs`'s `SPACING_PROPERTY`. A px in one of these is
   *  a gutter; a px anywhere else is a size this row does not hold. */
  const SPACING_PROPERTY =
    /^(?:padding|margin|inset|translate)(?:-|$)|^(?:gap|row-gap|column-gap|top|right|bottom|left)$/;
  /** The named degenerate spacing values, each with the reason it is exempt.
   *  `0px` is deliberately absent: `0` is the same value, no drawing writes the
   *  unit form, and a second spelling of one exemption is how a list of escapes
   *  starts. */
  const SPACING_DEGENERATE = new Map([
    ["0", "no space — the degenerate absence of a gutter"],
    [
      "1px",
      "a hairline, whose value is its thickness (§7.2's rail inset; `design-tokens.mjs`'s `ALWAYS_PX` names 1 for the same reason). This one cannot be keyed on the property: the drawing spells its hairlines as `padding`, and a 1px padding that *is* a gutter is indistinguishable from a 1px padding that is a rule, so a 1px gutter would pass here. Named rather than hidden.",
    ],
    [
      "auto",
      "the slack a flex line has left — not a length on the base at all",
    ],
  ]);
  /** The properties whose px is a **mark's anchor** rather than a gutter: a side
   *  offset, where a negative pulls a mark across a gutter it does not own and a
   *  fractional one centres a glyph in a box smaller than itself. §3's step
   *  table is a table of gutters and insets; none of these is one.
   *
   *  Keyed on the **property**, not the value alone — the value cannot tell them
   *  apart: `top:-3.5px` is a slider's thumb on a 3px track, and `padding:-3.5px`
   *  would be a mistake the same test would wave through.
   *
   *  `translate` is listed because `SPACING_PROPERTY` reads it, so leaving it out
   *  would refuse a translated mark's own anchor as off-scale. No drawing uses it
   *  today; the two lists move together so the arms cannot disagree about which
   *  px is a gutter. */
  const ANCHOR_PROPERTY = /^(?:inset|translate|top|right|bottom|left)(?:-|$)/;
  const isAnchor = (value: string, property: string): boolean =>
    ANCHOR_PROPERTY.test(property) &&
    (value.endsWith("%") ||
      (/^-?[\d.]+px$/.test(value) &&
        (value.startsWith("-") || value.includes("."))));
  /** The largest step the table names, which is where a positioning offset
   *  stops being a gutter at all. */
  const LARGEST_STEP = Math.max(...SPACING);
  /** A **positioning offset larger than the table can express** is geometry,
   *  not a gutter. §3's step list stops at 32, so a panel inset inside a fixed
   *  1180×900 drawing (`top:74px;left:170px`) has no legal step to be moved to;
   *  reading it as an off-scale gutter would say the same thing about the same
   *  number spelled `width`, which this row has never read. The bound is the
   *  table's own largest step rather than a number chosen here, and a *small*
   *  off-scale offset (a mis-derived inset) is still refused. */
  const isGeometry = (value: string, property: string): boolean => {
    if (!ANCHOR_PROPERTY.test(property)) return false;
    const parsed = /^(\d+(?:\.\d+)?)px$/.exec(value);
    return (
      parsed !== null && Number.parseFloat(parsed[1] ?? "NaN") > LARGEST_STEP
    );
  };
  const spacingAllowed = (value: string, property: string): boolean => {
    if (SPACING_DEGENERATE.has(value) || isAnchor(value, property)) return true;
    if (isGeometry(value, property)) return true;
    const parsed = /^(\d+(?:\.\d+)?)px$/.exec(value);
    return (
      parsed !== null && SPACING.has(Number.parseFloat(parsed[1] ?? "NaN"))
    );
  };

  /** §2's six sizes. */
  const TYPE = new Set([10, 11, 12, 13, 15, 19]);
  /** The size a type declaration sets, or `null` where it sets none this row
   *  reads: `font-size`'s whole value, or the first px length a `font`
   *  shorthand carries. A shorthand with no px length has no size token, so the
   *  whole value is returned and fails naming itself rather than passing as the
   *  drawing's silence. */
  const typeSize = (declaration: MockupDeclaration): string | null => {
    if (declaration.property === "font-size") return declaration.value;
    if (declaration.property !== "font") return null;
    return (
      /(\d+(?:\.\d+)?px)/.exec(declaration.value)?.[1] ?? declaration.value
    );
  };
  const typeAllowed = (value: string): boolean => {
    const parsed = /^(\d+(?:\.\d+)?)px$/.exec(value);
    return parsed !== null && TYPE.has(Number.parseFloat(parsed[1] ?? "NaN"));
  };

  /** One declaration is several values — `8px 8px 0 0` is four radii and
   *  `padding:4px 6px` two insets — so each token is held on its own: an
   *  off-scale value cannot hide behind a legal neighbour. */
  const tokens = (value: string): readonly string[] =>
    value.split(/[\s/]+/).filter((part) => part !== "");

  /** One named exemption, printed with its reason on a failure so the reader of
   *  a red row sees what the row *does* let through, not only what it refused. */
  const named = (value: string, reason: string): string =>
    `${value} — ${reason}`;
  const SQUARE = "0 / 0px / 0% — a square corner, the absence of rounding";

  /** §3's elevation table, transcribed: level 0 is *no shadow at all*, and the
   *  three shadowed levels have exactly one treatment each (level 3's scrim is
   *  a second declaration, not a shadow).
   *
   *  **The gap this closes (`vg-296`).** The drawings gate held radii, spacing
   *  and type to a scale and read no shadow at all, so a drawing could carry a
   *  cluster shadow off the table and nothing said so — which is how the three
   *  `#0007` cluster shadows reached the current set unnoticed until a task
   *  corrected them by hand. The table is the bible's, so a drawing that
   *  disagrees with it is the stale side (spec §13, `docs/design/mockups/README.md`). */
  const ELEVATION = new Map([
    [themeToken("--elev-1"), "level 1 — floating clusters over the canvas"],
    [themeToken("--elev-2"), "level 2 — menus, popovers, tooltips"],
    [themeToken("--elev-3"), "level 3 — dialogs"],
  ]);
  /** The two shadow *marks* §5 rule 4 keeps beside §3's elevation: the
   *  3px accent halo is decoration ("Keep the 3px accent-at-18% halo as
   *  decoration") and an `inset` shadow is a mark **on** the element — a focus
   *  boundary or a selected row's accent bar — where §3's table is depth
   *  *under* a surface. Both are read by shape so the arm cannot be widened by
   *  adding a colour to an allow-list: a shadow that is neither a mark nor one
   *  of the table's three treatments fails. */
  const ELEVATION_MARK = /^(?:inset\b|0 0 0 \d+(?:\.\d+)?px\b)/;
  /** §3's level 0 is *no shadow*, and a drawing may spell that `none` as readily
   *  as it may omit the property — the scale clause above admits both, so the
   *  arm has to accept the spelling or it is a false red waiting for a drawing
   *  that says it the long way. */
  const NO_SHADOW = new Set(["none"]);
  /** A `box-shadow` is a **list**, and it is read part by part. A drawing that
   *  layers a mark under a surface (`0 0 0 3px …, 0 10px 26px …`) is drawing a
   *  halo *and* a shadow, so reading only the first part would let any off-table
   *  shadow through behind a ring. A comma inside parentheses belongs to a
   *  colour function (`color-mix(in srgb, …)`), not to the list, so the split
   *  tracks depth. */
  const shadowParts = (value: string): string[] => {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let at = 0; at < value.length; at += 1) {
      const char = value[at];
      if (char === "(") depth += 1;
      else if (char === ")") depth = Math.max(0, depth - 1);
      else if (char === "," && depth === 0) {
        parts.push(value.slice(start, at));
        start = at + 1;
      }
    }
    parts.push(value.slice(start));
    return parts.map((part) => part.trim()).filter((part) => part !== "");
  };
  const elevationAllowed = (value: string): boolean => {
    const parts = shadowParts(value);
    return (
      parts.length > 0 &&
      parts.every(
        (part) =>
          NO_SHADOW.has(part) ||
          ELEVATION.has(part) ||
          ELEVATION_MARK.test(part),
      )
    );
  };

  /** §5's boundary vocabulary: every treatment the table admits draws its edge
   *  as a **1px hairline** — the Well is "1px `--edge`", and §3's level 0 is
   *  "1px `--edge` border"; no §5 entry and no §3 level names any other width.
   *  The arm is deliberately the *width* and not the colour: §5 rule 2 admits
   *  "a switch row whose label fills the row inside a panel box", and the
   *  drawing materialises a derived colour where the product writes
   *  `color-mix(...)` (`.editor-shell-primary-key`), so a colour allow-list
   *  would fail a drawing technique §5 has no entry against. **What this arm
   *  therefore does not catch** is the bordered container the row's third
   *  clause names: a declaration cannot tell a container from a control, and
   *  §5 rule 2 licenses that box by name — see the row's line. */
  const boundaryAllowed = (value: string): boolean => {
    const text = value.trim();
    return /^(?:0|1px)\b/.test(text) || text === "none";
  };

  /** Every class, each with what it reads, the values one declaration
   *  spells, the scale those values are held to, and the exemptions a failure
   *  should name. */
  const ARMS: readonly {
    readonly property: string;
    readonly scale: string;
    readonly values: (
      declaration: MockupDeclaration,
    ) => readonly string[] | null;
    readonly allowed: (value: string, property: string) => boolean;
    readonly exempt: readonly string[];
    /** Whether **every** drawing must declare the class. The three scale arms
     *  are per-drawing — a drawing that declares no spacing is the silent read
     *  they exist to catch. The elevation and boundary arms are not: a control
     *  drawing legitimately draws no shadow at all (level 0) and no boundary
     *  that is not 1px, so the per-arm control below is what keeps an empty
     *  read from passing. */
    readonly readPerDrawing?: boolean;
  }[] = [
    {
      property: "border-radius",
      scale: "§3's radius scale (4/6/8/10/999)",
      values: (declaration) =>
        declaration.property === "border-radius"
          ? tokens(declaration.value)
          : null,
      allowed: (value) => radiusAllowed(value),
      exempt: [
        SQUARE,
        ...[...RADIUS_DEGENERATE].map(([value, reason]) =>
          named(value, reason),
        ),
      ],
    },
    {
      property: "spacing",
      scale: "§3's step list (4/6/8/10/12/14/16/20/24/32)",
      values: (declaration) =>
        SPACING_PROPERTY.test(declaration.property)
          ? tokens(declaration.value)
          : null,
      allowed: spacingAllowed,
      exempt: [
        ...[...SPACING_DEGENERATE].map(([value, reason]) =>
          named(value, reason),
        ),
        "a mark's anchor — a negative or fractional px, or a `%`, in `top`/`right`/`bottom`/`left`/`inset`",
      ],
    },
    {
      property: "type",
      scale: "§2's size scale (10/11/12/13/15/19)",
      values: (declaration) => {
        const size = typeSize(declaration);
        return size === null ? null : [size];
      },
      allowed: (value) => typeAllowed(value),
      exempt: ["none — §2's six sizes are the whole scale"],
    },
    {
      property: "box-shadow",
      scale: `§3's elevation table (1 \`${themeToken("--elev-1")}\`, 2 \`${themeToken("--elev-2")}\`, 3 \`${themeToken("--elev-3")}\`, or no shadow at all — \`none\` or the property omitted)`,
      values: (declaration) =>
        declaration.property === "box-shadow" ? [declaration.value] : null,
      allowed: (value) => elevationAllowed(value),
      exempt: [
        "no `box-shadow` at all, or `none` — §3's level 0, which is also every surface in a drawing that floats nothing",
        "`0 0 0 <n>px …` — §5 rule 4's 3px accent-at-18% focus halo, decoration and not a surface",
        "`inset …` — a mark **on** the element (§5 rule 4's focus boundary, §7.2's rail accent bar), where §3's table is depth *under* a surface",
        "each part of a comma list is read on its own, so a halo layered over an off-table shadow is refused rather than admitted by its first part",
      ],
      readPerDrawing: false,
    },
    {
      property: "border",
      scale:
        "§5's boundary vocabulary — a 1px hairline (`1px --edge` in §3's level 0 and in §5's Well), or no boundary",
      values: (declaration) =>
        /^border(?:-(?:top|right|bottom|left))?$/.test(declaration.property)
          ? [declaration.value]
          : null,
      allowed: (value) => boundaryAllowed(value),
      exempt: [
        "`none` / `0` — no boundary at all, which is every region §3 does not draw an edge on",
      ],
      readPerDrawing: false,
    },
  ];

  // An `allowed` nothing exercises is a fix nobody can trust: the two square
  // spellings are unexercised by the drawings today — none writes a radius
  // shorthand — so they are read here, and every named degenerate is read so a
  // gate that names a value it still refuses fails at the naming rather than at
  // the drawing. Each arm's **refusal** is read for the same reason from the
  // other side: an `allowed` that returned true for everything would pass all
  // six drawings below.
  expect(
    ["0", "0px"].filter((corner) => !radiusAllowed(corner)),
    "a square corner is not accepted, so an ordinary radius shorthand would false-positive",
  ).toEqual([]);
  expect(
    [...SPACING_DEGENERATE.keys()].filter(
      (value) => !spacingAllowed(value, ""),
    ),
    "a named degenerate spacing value is not accepted, so this row would fail the drawing it names",
  ).toEqual([]);
  // The anchors are read **on the properties that carry them**, and refused on
  // the properties that do not: an exemption keyed on the value alone would let
  // `padding:-3.5px` through, which is the hole this control closes.
  expect(
    [
      ["left", ANCHOR_FRACTIONAL],
      ["top", ANCHOR_NEGATIVE],
      ["right", "-6px"],
      ["left", "50%"],
    ].filter(
      ([property, value]) => !spacingAllowed(value ?? "", property ?? ""),
    ),
    "a mark's anchor is not accepted on the property that draws it, so this row would fail the drawing it names",
  ).toEqual([]);
  expect(
    [
      ["padding", GUTTER_NEGATIVE],
      ["margin", "-20px"],
      ["gap", "150%"],
    ].filter(([property, value]) =>
      spacingAllowed(value ?? "", property ?? ""),
    ),
    "the anchor exemption is keyed on the value alone, so an off-scale gutter would pass as a mark",
  ).toEqual([]);
  expect(
    (
      [
        ["radius", () => radiusAllowed(OFF_SCALE_RADIUS)],
        ["spacing", () => spacingAllowed(OFF_SCALE_GUTTER, "gap")],
        ["type", () => typeAllowed(OFF_SCALE_TYPE)],
        ["elevation", () => elevationAllowed(OFF_TABLE_SHADOW)],
        ["elevation-list", () => elevationAllowed(OFF_TABLE_SHADOW_LIST)],
        ["boundary", () => boundaryAllowed(OFF_SCALE_BOUNDARY)],
      ] as const
    )
      .filter(([, allowed]) => allowed())
      .map(([name]) => name),
    "an arm accepts an off-scale value, so this row no longer holds that class to a scale",
  ).toEqual([]);
  // The two families the new arms name as exempt are read the same way: a mark
  // the arm still refused would fail the drawing at the naming, and an
  // exemption that swallowed a real treatment would take the arm's teeth out.
  // §3's level 0 is read in **both** of its spellings — the property omitted is
  // read by every drawing that declares no shadow, and `none` is the one the arm
  // used to refuse — and a layered list is read so the part-by-part rule accepts
  // a legitimate halo-over-shadow as readily as it refuses an off-table tail.
  expect(
    [
      themeToken("--elev-1"),
      themeToken("--elev-2"),
      themeToken("--elev-3"),
      "none",
      HALO_INSET,
      HALO_RING,
      `${HALO_RING}, ${themeToken("--elev-1")}`,
    ].filter((value) => !elevationAllowed(value)),
    "an exempt or on-table shadow is refused, so this row would fail the drawing it names",
  ).toEqual([]);
  expect(
    ["1px solid var(--edge)", "1px dashed var(--edge2)", "none", "0"].filter(
      (value) => !boundaryAllowed(value),
    ),
    "a 1px boundary is refused, so this row would fail the drawing it names",
  ).toEqual([]);

  const offScale: string[] = [];
  const read: string[] = [];
  /** How many declarations each arm read across the whole set, so an arm no
   *  drawing feeds reddens here instead of passing over an empty read. */
  const readCount = new Map<string, number>();
  for (const drawing of drawings) {
    const declared = mockupDeclarations(readMockup(drawing.path));
    for (const arm of ARMS) {
      const inClass = declared.filter(
        (declaration) => arm.values(declaration) !== null,
      );
      // The positive control per drawing per class: a file the reader opened
      // but read nothing out of is the shape this gate exists to end, so it
      // reddens here rather than passing as a file with no off-scale value.
      if (arm.readPerDrawing !== false) {
        expect(
          inClass.length,
          `${drawing.name}: the drawing declares no ${arm.property}, so this row read nothing`,
        ).toBeGreaterThan(0);
      }
      readCount.set(
        arm.property,
        (readCount.get(arm.property) ?? 0) + inClass.length,
      );
      read.push(`${drawing.name} ${arm.property} (${inClass.length})`);
      for (const declaration of inClass) {
        for (const value of arm.values(declaration) ?? []) {
          if (arm.allowed(value, declaration.property)) continue;
          offScale.push(
            `${drawing.name}:${declaration.line} ${declaration.property}: ${declaration.value} — \`${value}\` is not on ${arm.scale} and is not one of this class's exemptions (${arm.exempt.join("; ")})`,
          );
        }
      }
    }
  }
  // The per-arm control, for the classes no single drawing has to declare: an
  // arm nothing feeds is an arm that cannot fail, whatever the drawings do.
  for (const arm of ARMS) {
    expect(
      readCount.get(arm.property) ?? 0,
      `no drawing declares a ${arm.property}, so that arm read nothing`,
    ).toBeGreaterThan(0);
  }
  expect(
    offScale,
    `${drawings.length} drawing(s) declare a value their own scale does not contain (read: ${read.join(", ")})`,
  ).toEqual([]);
});

/**
 * The drawing's token table is **one declaration site**, and every site that
 * carries a custom property is read (`vg-309`).
 *
 * **The hole this closes.** `mockupDeclaredProperties` reads the single element
 * `SHELL_TOKEN_SELECTOR` matches (`[style*="width:1180px"]`), and the row that
 * calls itself "the drawing's token table as a set" therefore reads *that
 * element* — so a token declared at `:root`, or on a child of the drawn shell,
 * was invisible to it. A palette role the drawing gained outside its own table
 * would still have been missed, which is how `--hot` first arrived unnoticed
 * under a brief that listed ten tokens.
 *
 * **Per site is the shape this drawing makes exact.** The drawing declares its
 * tokens on the shell's outermost element, and nothing inside that subtree
 * re-declares a `--*`; so "the declared-property set per element" and "the
 * union across the matched element's subtree" are the same set *today*, and
 * they differ exactly when something is wrong. A subtree union would keep the
 * set at eleven when a token moved onto a child and pass; the reading below
 * makes that a **second site** and fails. A token at `:root` is a rule site
 * too, so both cases `vg-309` names are covered by the one reading.
 *
 * The set of eleven is compared to `SHELL_ROLES` rather than to a list written
 * here, so a token the drawing drops and a token it gains both redden.
 *
 * A `--grep` that matches nothing exits 0 with zero tests, so the run's own
 * summary is the proof this ran at all.
 */
test("the shell drawing declares its token table at one site", () => {
  const sites = new Map<string, { line: number; tokens: string[] }>();
  for (const declaration of mockupDeclarations(readMockup(MOCKUP_PATH))) {
    if (!declaration.property.startsWith("--")) continue;
    const key = `${declaration.inline ? "inline" : "rule"}\u0000${declaration.owner}`;
    const site = sites.get(key) ?? { line: declaration.line, tokens: [] };
    site.tokens.push(declaration.property);
    sites.set(key, site);
  }

  const declared = [...sites.values()];
  // The positive control: a reader that found no site read nothing, and this
  // row's whole subject is a table nothing was reading.
  expect(
    declared.length,
    `${SHELL_DRAWING}: no declaration site carries a custom property, so this row read nothing`,
  ).toBeGreaterThan(0);
  expect(
    declared.map(
      (site) =>
        `${SHELL_DRAWING}:${site.line} declares ${site.tokens.join(", ")}`,
    ),
    `${SHELL_DRAWING} carries a custom property somewhere other than its one token table`,
  ).toHaveLength(1);

  expect(
    [...new Set(declared[0]?.tokens ?? [])].sort(),
    `${SHELL_DRAWING}'s token table is no longer the eleven roles the product maps`,
  ).toEqual(SHELL_ROLES.map((role) => role.drawingToken).sort());
});
