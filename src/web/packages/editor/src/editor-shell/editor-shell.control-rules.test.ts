import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The stylesheet's *rules*, read as text.
 *
 *  `editor-shell.tokens.test.ts` reads the token blocks; this file reads the
 *  two rules `scripts/design-tokens.mjs` is blind to, because it scans literals
 *  and both of these are semantic. A style change is a rendered outcome, and the
 *  rendered half is the browser: this is the half that reddens in `vitest` when
 *  a rule is reverted, so a fix cannot quietly go back.
 *
 *  The regex is anchored at a line start so a selector *list* that merely
 *  contains the name — the dock's glass pair, the palette swatch — does not
 *  answer for the rule itself. */
const css = readFileSync(
  fileURLToPath(new URL("./editor-shell.css", import.meta.url)),
  "utf8",
);

/** Every declaration body written under `selector`, joined in document order.
 *
 *  Joined rather than first-match because a control's shape can be split across
 *  rules: `.editor-shell-dock button` takes its fill in one rule and its 1px
 *  resting border with the 26px square in another. */
function ruleBodies(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bodies = [
    ...css.matchAll(new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, "gm")),
  ].map((match) => match[1] ?? "");
  return bodies.join("\n");
}

/** §5 rule 6's second clause: "On a glyph-only control with no resting border —
 *  the icon button — it is the border it acquires on hover. Nothing moves,
 *  nothing scales." A wash is what the rule forbids here. */
const GLYPH_ONLY = [
  ".editor-shell-rail button",
  ".yunari-layer-row button",
  ".editor-shell-dock button",
  ".editor-shell-view-step",
] as const;

describe("§5 rule 6 on the shell's glyph-only controls", () => {
  for (const selector of GLYPH_ONLY) {
    it(`${selector} acquires --muted on hover and nothing else moves`, () => {
      const resting = ruleBodies(selector);
      expect(resting, `${selector} has no rule`).not.toBe("");
      expect(
        resting,
        `${selector} has no resting 1px transparent border, so acquiring one ` +
          "on hover would move the box",
      ).toContain("border: 1px solid transparent");

      const hover = ruleBodies(`${selector}:hover`);
      expect(hover, `${selector}:hover has no rule`).not.toBe("");
      expect(
        hover,
        `${selector}:hover does not raise the acquired border to --muted`,
      ).toContain("border-color: var(--muted)");
      expect(
        hover,
        `${selector}:hover washes its background where §5 rule 6 asks for the ` +
          "border the control acquires",
      ).not.toContain("background");
    });
  }

  /** "Nothing moves" is not in the two declarations above: it holds because the
   *  acquired 1px border lands *inside* the box. Two of these rules say
   *  `box-sizing: border-box` for themselves; the rail's slot and the layer
   *  row's square rely on the global rule, which nothing else pins — without it
   *  the rail's 36px slot and the 20px square grow by 2px on hover and every case above
   *  stays green. */
  it("puts every box on border-box, so the acquired border does not grow it", () => {
    expect(
      css,
      "the global `*, *::before, *::after` rule no longer sets border-box, so a " +
        "control that acquires its 1px hover border grows by 2px instead",
    ).toMatch(
      /^\*,\s*\n\s*\*::before,\s*\n\s*\*::after\s*\{\s*\n\s*box-sizing:\s*border-box;/m,
    );
  });
});

/** §2 gives list rows `--text-sm`. A dialog is portalled, so a body that
 *  declares no role inherits the host document's base and lands on a §2 step by
 *  accident — `vg-317`: the `?` sheet's rows read `--text-md` because
 *  `index.html` said 13px, not because any rule of the dialog's chose it. */
describe("§2's role on a dialog's own body", () => {
  it("declares the list-row role rather than inheriting the portal's base", () => {
    expect(
      ruleBodies(".editor-shell-dialog"),
      "`.editor-shell-dialog` declares no font-size, so every surface inside it " +
        "that declares none of its own inherits the portalled document's",
    ).toContain("font-size: var(--text-sm)");
  });
});

/** §4's destructive mark, painted by one rule that reaches every surface.
 *
 *  `vg-226`'s complaint was that Delete was `--hot` in the dock and ordinary in
 *  the layer footer and the canvas context menu. The colour is painted by the
 *  shared `data-yunari-destructive` the registry's `destructiveMarker` puts on
 *  each control, and the failure it replaced was a **surface-scoped** rule:
 *  `.editor-shell-dock button[data-yunari-destructive]` cannot reach a popup
 *  Base UI portals to `body`, so the menu's Delete kept its inherited colour.
 *
 *  A text read rather than a rendered one on purpose: jsdom has no cascade, so a
 *  DOM assertion could only ever prove the string it wrote. This is the half that
 *  reddens in `vitest` when the rule is reverted; the rendered half is the
 *  browser. */
/** The stylesheet without its comments, for the reads below that look for a
 *  *declaration*: a comment that explains why a declaration is gone
 *  (`color: inherit`, the removed restatement) is text the same regexes would
 *  otherwise find and accuse. */
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** A declaration whose *property* is `color`, not `border-color`/`background-color`. */
const PAINTS_COLOUR = /(?<![\w-])color\s*:/;

/** §4's mark lands on a `<button>` (the dock, the pane footer) or on a menu item
 *  (a `menuitem`/`menuitemradio` role — the canvas context menu). A selector part
 *  is in that family when it **names** one of them, anywhere and in any form: a
 *  bare substring test for `button` or `menuitem`, case-insensitive.
 *
 *  Substring rather than a subject-compound or token-boundary match, because those
 *  are the shapes that were evaded: `:is(button)`, `:where(button)` and a
 *  single-quoted `[role='menuitem']` each select a markable control, and a
 *  compound-anchored pattern misses all three. A substring test subsumes them and
 *  cannot be evaded by selector syntax not anticipated here. Measured cost none:
 *  all 72 colour-bearing rules in `editor-shell.css` yield the same six parts
 *  under the substring, mention-anywhere and subject-compound filters.
 *
 *  The ceiling this read cannot cross: a rule that paints the marked control
 *  *without* naming a button, a menu role or the marker — a positional or
 *  attribute selector on some other name, or the same name in an **escaped
 *  spelling** (`\62 utton` is `button` with the `b` escaped, and a substring test
 *  sees neither), say — is invisible here, as it is to any selector-text read.
 *  The browser case is the instrument that reads actual
 *  paint, and it covers the three surfaces that exist, not any future one;
 *  `MARKABLE_CONTROL_ALLOWLIST` rests on reachability for the same reason. */
const NAMES_A_MARKABLE_CONTROL = /button|menuitem/i;

/**
 * Every colour-bearing rule whose **selector names** a button or a menu item, as
 * normalised selector parts.
 *
 * The failure message names what to do about a hit, because there are exactly
 * two right answers: move the colour onto the surface's **container** (which the
 * control inherits, and which the mark rule then outranks by applying directly to
 * the control), or add the entry below with a reason.
 */
function colourBearingMarkableControls(): readonly string[] {
  return [
    ...new Set(
      [...cssNoComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(([, , body]) => PAINTS_COLOUR.test(body ?? ""))
        .flatMap(([, selectors]) => (selectors ?? "").split(","))
        .map((part) => part.trim().replace(/\s+/g, " "))
        .filter((part) => NAMES_A_MARKABLE_CONTROL.test(part)),
    ),
  ].sort();
}

/**
 * The colour-bearing rules in that family that are *allowed* to exist, each one a
 * surface that renders no registry action — so no control carrying §4's mark is
 * ever inside it, and its `color:` cannot beat the marker rule.
 *
 * Written out rather than counted, and checked one-directionally — every
 * colour-bearing rule in the family has to appear here, but an entry whose rule
 * stops declaring a colour does not fail, because that is a deletion and this
 * guard is about colours arriving.
 *
 *  - `.editor-shell-menubar button` — the File/Edit menubar's entries.
 *  - `.editor-shell-rail button` — the rail's pane slots.
 *  - `.editor-shell-rail button[aria-pressed="true"]` — the selected slot.
 *  - `.editor-shell-rail button.editor-shell-rail-settings` — the settings gear.
 *  - `.editor-shell-dialog > button` — a dialog's own buttons (`?` sheet, theme
 *    dialog), which are direct children of the dialog and no registry's.
 *  - `.editor-shell-dialog > button:hover` — the same buttons on hover.
 *  - `.editor-shell-mode-switch button` — §7.1's three mode segments. The
 *    switch chooses a shell surface; it renders no registry action, so no
 *    control carrying the mark is ever inside it, and a `<button>` takes its
 *    ink from the UA's own rule rather than by inheritance.
 *  - `.editor-shell-mode-switch button[aria-pressed="true"]` — the chosen
 *    segment, whose lifted ink is the shared chosen treatment.
 *
 * The first six were measured at `d9f81f1f` by parsing every rule body in the
 * stylesheet, which is how that set was reproduced rather than copied; the last
 * two arrived with the mode switch.
 */
const MARKABLE_CONTROL_ALLOWLIST: readonly string[] = [
  ".editor-shell-dialog > button",
  ".editor-shell-dialog > button:hover",
  ".editor-shell-menubar button",
  ".editor-shell-mode-switch button",
  '.editor-shell-mode-switch button[aria-pressed="true"]',
  ".editor-shell-rail button",
  ".editor-shell-rail button.editor-shell-rail-settings",
  '.editor-shell-rail button[aria-pressed="true"]',
];

describe("§4's destructive mark", () => {
  it("paints --hot from the shared marker, and from one rule that no surface scopes", () => {
    // The mark is painted **only where the control can run** (`vg-570`): the
    // footer draws the registry's commands disabled with nothing selected, and
    // an unqualified rule outranks `ControlIconButton`'s own blocked `text-faint`
    // — the "mark present, paint wrong" failure `vg-226` recorded. The rendered
    // half of this is the browser case in `snapping.spec.ts`.
    expect(
      ruleBodies(
        '[data-yunari-destructive]:not([disabled]):not([aria-disabled="true"])',
      ),
      "no rule keys §4's `--hot` on the shared `data-yunari-destructive`, so a " +
        "surface the bare selector cannot be beaten to — the portalled context " +
        "menu — paints its destructive action as ordinary text",
    ).toContain("color: var(--hot)");

    // One rule, not one per surface. A rule whose *selector* mentions the marker
    // is a rule that paints it; two of them is the owner violation `vg-226` was
    // filed for, one level down, whatever colours they name.
    const painters = [
      ...cssNoComments.matchAll(
        /^[^{}\n]*\[data-yunari-destructive\][^{}\n]*\{/gm,
      ),
    ].map((match) => match[0]);
    expect(
      painters,
      "more than one rule paints the destructive mark",
    ).toHaveLength(1);
    expect(
      painters[0],
      "the destructive mark is still painted by a surface-scoped rule, so a " +
        "surface outside that scope — a portalled popup — is left ordinary",
    ).not.toMatch(/\.editor-shell-|\[role=/);

    // And no rule may declare a colour **on a control a mark lands on**. A
    // declaration there applies directly to the element, so it outranks the bare
    // attribute by specificity — the marker's own rule is unlayered, and the
    // stylesheet's one `@layer base` block holds the focus fallback, which
    // declares no `color:` at all. Its `outline: 2px solid var(--shell-accent)`
    // paints the focus ring, a different property, so whatever its specificity it
    // cannot beat the marker's `color`. Both surfaces this fix
    // changed did it once (`color: inherit` on a menu item at (0,2,0);
    // `color: var(--shell-text)` on `.editor-shell-dock button` at (0,1,1)), and
    // the footer — the third surface — was not covered here at all, which is how
    // the same evasion landed green on the re-review's probe. An enumeration that
    // gains one entry per regression is the thing that rots, so this asserts the
    // whole family instead: every colour-bearing rule whose selector can select a
    // `<button>` or a menu item must be written down below with a reason.
    expect(
      colourBearingMarkableControls().filter(
        (part) => !MARKABLE_CONTROL_ALLOWLIST.includes(part),
      ),
      "a rule declares a colour whose selector names a button or a menu item — " +
        "the controls §4's mark lands on. A declaration there applies directly " +
        "to the element, so it outranks the bare marker attribute by specificity " +
        "and the destructive action paints ordinary. The listed selectors are " +
        "the ones not yet allowlisted below: move the colour onto the surface's " +
        "container, or add the entry with a reason.",
    ).toEqual([]);
  });
});

/** Every `@layer <name> { … }` block, brace-matched rather than body-regexed:
 *  a layer's body contains whole rules, so a `[^}]*` body — what the reads above
 *  use — would stop at the first of them. `from`/`to` are offsets into `css`, so
 *  a caller can blank a block without moving another's. */
function layers(): readonly {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly body: string;
}[] {
  return [...css.matchAll(/@layer\s+([a-z-]+)\s*\{/g)].flatMap((match) => {
    const open = (match.index ?? 0) + match[0].length;
    let depth = 1;
    let i = open;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") depth -= 1;
      i += 1;
    }
    return [
      {
        name: match[1] ?? "",
        from: match.index ?? 0,
        to: i,
        body: css.slice(open, i - 1),
      },
    ];
  });
}

/** The stylesheet with every layer's body blanked to spaces — length for length,
 *  so the reads of the text around it keep their offsets. What is left is the
 *  cascade level that outranks every utility whatever its specificity. */
function unlayered(): string {
  let text = css;
  for (const layer of layers()) {
    text =
      text.slice(0, layer.from) +
      text.slice(layer.from, layer.to).replace(/[^\n]/g, " ") +
      text.slice(layer.to);
  }
  return text;
}

/** The declaration bodies of every rule whose selector list names `part`, joined
 *  in document order. The reads above anchor at a line start, which a selector
 *  *list* never satisfies: these rules name two scrollers and one rule. */
function bodiesNaming(part: string): string {
  return [...cssNoComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => (selectors ?? "").includes(part))
    .map(([, , body]) => body ?? "")
    .join("\n");
}

/**
 * `vg-464`: two owners drew one focus boundary. The well `control-well.tsx`
 * draws is the owner — rounded to the control's own radius, §5's halo beside it
 * — so the field inside it says `outline-none` and the shell's fallback has to
 * *lose* to that. Unlayered it beat both whatever their specificity, and every
 * field in a well wore a second, square outline inside the rounded one (the
 * cascade fact `vg-278` measured).
 *
 * A text read, because jsdom resolves no cascade: what a DOM case here could
 * prove is the class strings, and `control.dom.test.tsx` is where those are
 * read. This is the half that reddens in `vitest` when the rule is taken back
 * out of its layer or a second, unlayered one is added beside it. */
describe("the shell's focus fallback", () => {
  it("is layered below the utilities, so a control's own outline wins", () => {
    const base = layers().find((layer) => layer.name === "base")?.body ?? "";

    expect(
      base,
      "the shell's `:focus-visible` fallback is not inside an `@layer` block, " +
        "so it outranks the field's `outline-none` and the well's " +
        "`focus-within:outline-*` and draws the second boundary `vg-464` records",
    ).toContain(":focus-visible {");
    expect(base).toContain("outline: 2px solid var(--shell-accent);");
  });

  it("leaves the fallback out of the unlayered cascade", () => {
    // The selector itself, and not `:focus-visible` — four other rules in this
    // stylesheet carry that pseudo-class (the menu items, the Add pane's tile,
    // the settings tab and its panel), and none of them is the shell-wide
    // fallback this row is about.
    expect(
      unlayered().replace(/\s+/g, " "),
      "the shell's fallback is unlayered again, so it beats every utility and " +
        "the well's own boundary is drawn twice",
    ).not.toContain(".editor-shell :is(");
  });
});

/**
 * `vg-458`: the `--yunari-scrollbar-*` values were declared for the scrollers
 * and read by nothing, so the platform painted them.
 *
 * `vg-480`: two of the four scrollers are portalled out of `.editor-shell`, so
 * the rule names them by name — which is a list that can go stale, and this is
 * the case that holds it.
 *
 * `vg-491`: the `::-webkit-scrollbar*` family that stood beside the standard
 * pair painted nothing. Measured in the Chromium the browser suite runs: either
 * property being non-`auto` disables the family for that scroller, so a 20px
 * webkit gutter beside `scrollbar-width: thin` renders as the thin bar. The
 * family is gone, and with it the thumb's hover colour — `scrollbar-color`
 * states a thumb and a track and no state between them, and the family that had
 * one is inert wherever the pair is declared. So the pair is the whole styling,
 * and both halves of that are asserted below: the pair, and the family's
 * absence.
 */
describe("the scrollers' scrollbar", () => {
  /** The four the rows name: the pane's body and the inspector — the shell's own
   *  two scrollers, the first of which is the body rather than the column around
   *  it (`vg-208`) — and the two surfaces Base UI portals out of
   *  `.editor-shell`. This is the rule's own selector list. */
  const SCROLLERS = [
    ".editor-shell-pane-body",
    ".editor-shell-inspector",
    ".editor-shell-menu-popup",
    ".editor-shell-dialog",
  ] as const;

  it("gives each of the two tokens a consumer", () => {
    for (const token of [
      "--yunari-scrollbar-thumb",
      "--yunari-scrollbar-track",
    ]) {
      expect(
        css,
        `${token} is declared and read by nothing, so the scrollers paint the ` +
          "platform's scrollbar",
      ).toContain(`var(${token})`);
    }
  });

  it("takes the standard pair from the tokens", () => {
    for (const scroller of SCROLLERS) {
      const bodies = bodiesNaming(scroller);
      expect(bodies, `${scroller} takes no scrollbar-width`).toContain(
        "scrollbar-width:",
      );
      expect(
        bodies,
        `${scroller} takes no scrollbar-color, so Firefox paints the platform's`,
      ).toContain(
        "scrollbar-color: var(--yunari-scrollbar-thumb) " +
          "var(--yunari-scrollbar-track);",
      );
    }
  });

  it("styles the scroller from the standard pair alone", () => {
    expect(
      cssNoComments,
      "the `::-webkit-scrollbar*` family is back, and it paints nothing " +
        "beside the standard pair the four scrollers declare",
    ).not.toContain("::-webkit-scrollbar");
  });

  it("paints them from no literal of its own", () => {
    // Filtered on the body rather than the selector: no selector in this
    // stylesheet contains the word any more, so a selector filter would find
    // nothing and the emptiness guard below would hold for the wrong reason.
    // A *property* rather than the token names, which are declared in the
    // control block beside every other literal this file carries.
    const scrollbarRules = [...cssNoComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) => /scrollbar-(width|color)\s*:/.test(body ?? ""))
      .map(([, , body]) => body ?? "")
      .join("\n");

    expect(scrollbarRules).not.toBe("");
    expect(
      scrollbarRules,
      "a scrollbar rule paints a literal beside the two values the shell " +
        "already declares for it",
    ).not.toMatch(/#[0-9a-fA-F]{3,8}(?![\w-])/);
  });
});

/** The layer row's reserve: one arm per control the row can draw, and none past
 *  that count (`vg-492`).
 *
 *  **The row draws at most three controls, so the fourth arm could not match.**
 *  `RowAffordances` renders a visibility control and, where the row is attended,
 *  selected or locked, a lock control; `composition-pane.tsx` adds at most one
 *  entry control beside them. The fourth button the arm was written for was the
 *  rename pen, and `vg-462` removed it — the caret's job moved onto the row
 *  itself — so `padding-right: 126px` has been unreachable since `e572c302`.
 *
 *  **A dead selector moves no pixel, which is why this reads the text.** Nothing
 *  can redden for a rule that cannot match: every rendered reading of the layer
 *  row is identical with the arm present and with it gone, so the instrument has
 *  to be the count. Both directions are read — an arm with no control to match
 *  fails, and so does a control count the stylesheet has no arm for — and the
 *  rendered ceiling this rests on is `row-affordances.dom.test.tsx`'s own case. */
describe("the layer row's control reserve", () => {
  it("has one arm per control the row draws, and no arm past its ceiling", () => {
    const counts = [
      ...cssNoComments.matchAll(
        /^\.yunari-layer-row:has\(\.yunari-layer-state button(?::nth-child\((\d+)\))?\)\s*\{/gm,
      ),
    ].map((match) => match[1] ?? "1");

    expect(
      counts,
      "the arms are not one per control the row draws — the row's ceiling is " +
        "three (the eye and the lock, and at most one entry control beside them)",
    ).toEqual(["1", "2", "3"]);
  });
});
