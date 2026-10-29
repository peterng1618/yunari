import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { shellPalettes } from "./palette.js";

const css = readFileSync(
  fileURLToPath(new URL("./editor-shell.css", import.meta.url)),
  "utf8",
);

/** The `:root { ... }` blocks, each with its body and where it starts.
 *
 *  A whole-CSS parser would be a dependency bought to read a file its author
 *  reads by eye, and nothing here needs more: the token blocks are flat, and a
 *  `[^}]*` body stops at the block's own close. The anchor is a line that holds
 *  nothing but `:root`, so `:root:not(...)` and `.foo :root` — which do not
 *  declare anything unconditionally — do not match. */
function rootBlocks(): readonly { body: string; at: number }[] {
  return [...css.matchAll(/^[ \t]*:root[ \t]*\{([^}]*)\}/gm)].map((match) => ({
    body: match[1] ?? "",
    at: match.index ?? 0,
  }));
}

/** Every custom property the given blocks declare. The capture group is
 *  guaranteed by the pattern, so it is unwrapped rather than defaulted — an
 *  empty string in the set would satisfy the check it feeds. */
function declared(blocks: readonly { body: string }[]): Set<string> {
  return new Set(
    blocks.flatMap((block) =>
      [...block.body.matchAll(/(--[a-z-]+)\s*:/g)].flatMap((match) =>
        match[1] === undefined ? [] : [match[1]],
      ),
    ),
  );
}

/** The body of the `@theme` block, or `""` if there is none.
 *
 *  Tailwind reads this at build time rather than serving it as a rule, so it
 *  never appears in the output the browser sees — which is exactly why a scale
 *  that lives *only* here is invisible to the cascade tests and has to be
 *  checked in the source. */
function themeBody(): string {
  return /^[ \t]*@theme[ \t]+static[ \t]*\{([^}]*)\}/m.exec(css)?.[1] ?? "";
}

/** Where the graphite palette's *declaration block* starts.
 *
 *  `[data-shell-palette="graphite"]` occurs four times — the block and the
 *  three glass selector lists — so `indexOf` on the bare attribute anchored
 *  this on whichever came first in the file, and a comment mentioning it above
 *  the palettes would have moved the anchor without changing a thing. The
 *  trailing `{` is the structural part: only a selector *list* that ends the
 *  palette block is followed by one. */
function graphiteBlockAt(): number {
  return css.indexOf('[data-shell-palette="graphite"] {');
}

/** The declaration block for one palette — its own rule, or the shared baseline
 *  for `editorial`, which has none of its own.
 *
 *  Sliced from the selector to the block's own `}`. A palette with no block of
 *  its own does not get the baseline's *whole* body: it gets what the baseline
 *  declares, which is the same list — see `sourceTokens` below. */
function declarationBlock(palette: string): string {
  const at = css.indexOf(`[data-shell-palette="${palette}"] {`);
  // Editorial has no block of its own: it is the shared baseline, which the
  // swatch chip joins so a chip can render a palette it is not under.
  const from = at === -1 ? css.indexOf(".editor-shell-palette-swatch {") : at;
  return from === -1 ? "" : css.slice(from, css.indexOf("}", from));
}

/** The `--shell-*` tokens a palette block must declare: every *source* a
 *  `--shell-*` role or its §4 alias can name. The eleven colours plus the
 *  primary button's pair.
 *
 *  `--shell-display` is deliberately absent: it is declared once on the
 *  baseline and inherited, it is not a colour, and requiring it per block
 *  would be a declaration for nothing — the state
 *  `design-tokens.gated.json` exists to shrink. */
const SOURCE_TOKENS = [
  "--shell-backdrop",
  "--shell-surface",
  "--shell-surface-strong",
  "--shell-edge",
  "--shell-text",
  "--shell-muted",
  "--shell-accent",
  "--shell-warm",
  "--shell-danger",
  "--shell-primary-bg",
  "--shell-primary-text",
] as const;

describe("shell token stylesheet", () => {
  /** The defect this exists to prevent.
   *
   *  A `var(--yunari-x)` naming a token no declaration in scope provides is
   *  invalid at computed-value time: the declaration using it is dropped whole
   *  rather than falling back. That is invisible in review and in jsdom — jsdom
   *  does not resolve custom properties, so a jsdom assertion would pass
   *  whatever the cascade does. The browser half is
   *  `tests/e2e/shell-appearance.spec.ts`; this half checks only that no
   *  reference can resolve to a single palette's declaration. */
  it("declares every referenced --yunari-* token on :root", () => {
    const onRoot = declared(rootBlocks());
    const referenced = [...css.matchAll(/var\((--yunari-[a-z-]+)/g)].flatMap(
      (match) => (match[1] === undefined ? [] : [match[1]]),
    );

    expect(referenced.length).toBeGreaterThan(0);
    expect(
      [...new Set(referenced)].filter((token) => !onRoot.has(token)),
      "these resolve to nothing under the palettes they are not declared for, " +
        "which drops the whole declaration using them",
    ).toEqual([]);
  });

  /** The palette attribute is on `documentElement` now, so `:root` and
   *  `[data-shell-palette="x"]` are the same node and the cascade picks between
   *  them by source order alone. A base block written *after* a palette block
   *  therefore silently wins — which is what happened the first time:
   *  `--yunari-control-bg` sat below the palettes, so graphite's dark control
   *  surface never applied and the shell stayed editorial cream. */
  it("puts the :root control tokens before the palette blocks overriding them", () => {
    const base = rootBlocks().find((block) =>
      block.body.includes("--yunari-control-bg"),
    );
    expect(base, "no :root block declares --yunari-control-bg").toBeDefined();
    expect(
      base?.at ?? Number.MAX_SAFE_INTEGER,
      "the :root control block must precede the palette blocks, or the base wins",
    ).toBeLessThan(graphiteBlockAt());
  });

  /** Choosing a palette the stylesheet does not name leaves the shell on
   *  whichever block happens to match. */
  it("gives every palette in palette.ts a block", () => {
    for (const palette of shellPalettes) {
      expect(css).toContain(`[data-shell-palette="${palette}"]`);
    }
  });

  /** A chip names a palette it is not necessarily rendering under, so without
   *  a declaration of its own it inherits the live palette's tokens — an ember
   *  chip under graphite painted graphite's dark glass behind an ember ring.
   *  The swatch joins the editorial block so it cannot.
   *
   *  Editorial and **not** bare `:root`, which `vg-351` made the base frame
   *  `systemShellPalette` resolves: a swatch grouped with the base would follow
   *  the OS preference rather than the palette it names — the same defect,
   *  arrived at from the other side. The pattern is anchored at the start of
   *  the selector list so a list that merely *contains* these two still reds,
   *  and a light-named swatch is the one case where that grouping and a palette
   *  block collide at equal specificity: `light`'s block must come after it, or
   *  the swatch paints editorial under a light name. */
  it("scopes the swatch into the editorial baseline", () => {
    const swatchAt = css.search(
      /^\s*\[data-shell-palette="editorial"\],\s*\.editor-shell-palette-swatch\s*\{/m,
    );
    expect(swatchAt).toBeGreaterThan(-1);
    expect(
      css.indexOf('[data-shell-palette="light"] {'),
      "`light`'s block precedes the baseline a light-named swatch shares with " +
        "editorial, so the swatch paints editorial",
    ).toBeGreaterThan(swatchAt);
  });

  /** `vg-351`: the frame before `applyShellPalette` writes the attribute, which
   *  every browser assertion reads *instead of* seeing.
   *
   *  The base is `systemShellPalette`'s answer — `light` on the bare root, and
   *  `graphite` from the dark media query — and `palette.ts` owns that rule
   *  while this mirrors its outcome in CSS. Three ways the mirror can go wrong
   *  with nothing to say so are checked here: either copy drifting from the
   *  palette it mirrors, and either base rule being placed after a palette
   *  block, where at equal specificity the palette block must win. The painted
   *  frame is `shell-appearance.spec.ts`'s. */
  it("paints the pre-attribute base as the palette the OS resolves", () => {
    // Comments carry `:` and `;` — `/* --bg: the drawn ground is flat */` is a
    // declaration as far as a regex is concerned — so they come out first.
    const declarations = (body: string): Record<string, string> =>
      Object.fromEntries(
        [
          ...body
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .matchAll(/(--[a-z-]+)\s*:\s*([^;]+);/g),
        ].flatMap((match) =>
          match[1] === undefined || match[2] === undefined
            ? []
            : [[match[1], match[2].trim()] as const],
        ),
      );

    // Column 0 is what separates the base from the dark base: the one inside
    // the media query is indented.
    const baseAt = css.search(/^:root \{/m);
    const base = /^:root \{([^}]*)\}/m.exec(css)?.[1] ?? "";
    expect(baseAt, "no bare `:root` base block").toBeGreaterThan(-1);

    const darkAt = css.indexOf("@media (prefers-color-scheme: dark)");
    const dark =
      /@media \(prefers-color-scheme: dark\) \{\s*:root \{([^}]*)\}/.exec(
        css,
      )?.[1];
    expect(
      dark,
      "no `prefers-color-scheme: dark` block repaints the bare root, so a " +
        "dark-reporting OS paints the light base until the attribute lands",
    ).toBeDefined();
    expect(
      darkAt,
      "the dark base precedes the base block it overrides, so a dark OS gets " +
        "light until the attribute lands",
    ).toBeGreaterThan(baseAt);

    // Every palette block must come after both, or the palette loses to the
    // base on the document element — `[editorial]` is the first of them.
    const palettesAt = css.indexOf('[data-shell-palette="editorial"],');
    expect(palettesAt, "no palette blocks").toBeGreaterThan(-1);
    expect(
      darkAt,
      "a base rule sits below the palette blocks, which it then outranks at " +
        "equal specificity for every palette",
    ).toBeLessThan(palettesAt);

    // The two `vg-357` gave `light` its own declaration for, so the base
    // frame is still compared to the palette it mirrors *value for value*: a
    // key comparison would let a `--shell-*` colour drift on the bare root while
    // `light`'s block kept its own, which is the drift this case exists to see.
    const companions: ReadonlySet<string> = new Set([
      "--shell-display",
      "--yunari-control-bg",
    ]);
    expect(
      declarations(base),
      "the base has drifted from the `light` palette it mirrors, so a " +
        "light-reporting OS's first frame is not the light palette",
    ).toEqual(
      Object.fromEntries(
        Object.entries(declarations(declarationBlock("light"))).filter(
          ([token]) => !companions.has(token),
        ),
      ),
    );

    // Every token graphite declares, the two beyond its colours included
    // (`vg-357`). A token declared in the dark base wins over the palette
    // blocks below at equal specificity, so carrying graphite's three is only
    // safe while each palette that used to inherit them declares its own — and
    // this reads every palette rather than assuming the four the row named.
    const graphite = declarations(declarationBlock("graphite"));
    expect(
      declarations(dark ?? ""),
      "the dark base has drifted from the `graphite` palette it mirrors",
    ).toEqual(graphite);

    const inheritsNothing = (
      palette: string,
      tokens: readonly string[],
      from: string,
    ): void => {
      const block = declarationBlock(palette);
      for (const token of tokens) {
        expect(
          block,
          `${palette} inherits ${token} from ${from}, so a dark-reporting OS ` +
            "moves its settled value through the dark base",
        ).toContain(token);
      }
    };
    for (const palette of shellPalettes) {
      inheritsNothing(palette, ["--shell-display"], "bare :root");
      // Graphite is the palette the dark base mirrors; the other five paint a
      // control surface of their own, editorial's and light's coming from
      // `:root`'s control block until `vg-357` restated them here.
      inheritsNothing(
        palette,
        ["--yunari-control-bg"],
        ":root's control block",
      );
    }
  });

  /** The scale, on `:root`, silently overrode Tailwind's own theme.
   *
   *  `--text-sm`, `--text-xs` and `--radius-md` are `@theme` names, and
   *  Tailwind emits its defaults into `@layer theme`. An *unlayered* `:root`
   *  beats a layered rule whatever its specificity, so the values shipped by
   *  accident: `text-sm` went 14px → 12px, `rounded-md` 6px → 8px, with no
   *  error anywhere and nothing to read in the browser console. Declaring
   *  them in `@theme` states the same intent in the layer that owns it. */
  it("declares the scale in @theme, where it cannot outrank the utilities it renames", () => {
    const onRoot = [...declared(rootBlocks())];
    for (const token of [
      "--spacing",
      "--radius-sm",
      "--radius-md",
      "--radius-lg",
      "--text-xs",
      "--text-sm",
      "--text-md",
    ]) {
      expect(
        onRoot,
        `${token} is declared on :root, which beats @layer theme whatever its ` +
          "specificity — the scale must be an override in @theme",
      ).not.toContain(token);
    }
    expect(
      themeBody(),
      "the scale is not in a @theme block, so Tailwind is not reading it at all",
    ).not.toBe("");
  });

  /** The values themselves, asserted rather than merely present.
   *
   *  `DESIGN.md` §2–§3 is normative for these, and these
   *  are the values it names. Asserting only that a token exists would let a
   *  change to `text-sm` land as a silent shift — which is how `--radius-md` sat
   *  at 8px against DESIGN.md's 6px with nothing to catch it; asserting the
   *  value makes it an edit somebody has to make here too. The resolved result
   *  is measured in a real browser by `tests/e2e/shell-appearance.spec.ts`;
   *  jsdom resolves nothing. */
  it("pins the scale to the design language", () => {
    const theme = themeBody();
    expect(theme, "no `@theme static` block declares the scale").not.toBe("");

    // Digits are part of the name: `--text-2xs--line-height` was read as
    // `--line-height` by a `[a-z-]+` pattern, so its value was never seen.
    const values = new Map(
      [...theme.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].flatMap((match) =>
        match[1] === undefined || match[2] === undefined
          ? []
          : [[match[1], match[2].trim()]],
      ),
    );
    expect(Object.fromEntries(values)).toMatchObject({
      "--spacing": "0.25rem",
      "--radius-sm": "4px",
      "--radius-md": "6px",
      "--radius-lg": "8px",
      "--text-xs": "11px",
      "--text-sm": "12px",
      "--text-md": "13px",
      // §2's 10, 15 and 19, pinned for
      // the reason the scrim below gives: the `settings modal — lead type` parity
      // row's expected value *is* `--text-lg`, so that row is green for whatever
      // the token holds — a dialog title at `16px` violates §2 with every
      // gate green. These are the assertions that such a change is deliberate.
      "--text-2xs": "10px",
      "--text-lg": "15px",
      "--text-xl": "19px",
      // §3's modal scrim. Pinned by a literal rather than read from `:root`:
      // a comparison that reads the token on both sides is green for whatever
      // value it holds, so this is the assertion that a changed scrim is a
      // deliberate edit.
      "--elev-scrim": "#00000073",
    });

    // Tailwind writes each `--text-*` companion for its own size — `--text-sm`
    // ships `calc(1.25 / .875)`, computed for 14px — so a size changed without
    // its companion inherits a ratio belonging to a size the token no longer
    // has. These are DESIGN.md §2's ratios; every size states its own.
    for (const [size, lineHeight] of [
      ["2xs", "1.2"],
      ["xs", "1.3"],
      ["sm", "1.4"],
      ["md", "1.3"],
      ["lg", "1.3"],
      ["xl", "1.2"],
    ]) {
      expect(
        values.get(`--text-${size}--line-height`),
        `--text-${size} has no line-height of its own, so it inherits a ratio ` +
          "computed for a size it no longer is",
      ).toBe(lineHeight);
    }
  });

  /** The other half of the scale pin: a rule that states a size states that
   *  token's own line-height too.
   *
   *  Tailwind's utility is the only shape that consumes a companion — `.text-sm`
   *  compiles to `var(--tw-leading,var(--text-sm--line-height))` — so a rule
   *  writing `font-size: var(--text-sm)` takes the size alone and leaves the
   *  element on preflight's `1.5`, a ratio nothing in this repo chose. Measured
   *  2026-10-13: 22 rules stated a size, one stated its companion, and the
   *  browser showed the dialog at 18px where §2's `--text-sm` is 16.8px. The
   *  resolved value is asserted in a browser by `shell-appearance.spec.ts`; this
   *  is the source contract that keeps a new rule from reopening the gap. */
  it("pairs every stated size with that token's own line-height", () => {
    // Comments are blanked rather than removed, so a line number stays the
    // line number: this is what a reader following the failure will open.
    const source = css.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
      comment.replace(/[^\n]/g, " "),
    );
    const offenders: string[] = [];
    for (const rule of source.matchAll(/(^[^\n@/][^{}]*)\{([^}]*)\}/gm)) {
      const body = rule[2] ?? "";
      const size = /font-size:\s*var\((--text-[a-z0-9]+)\)/.exec(body)?.[1];
      if (size === undefined) continue;
      if (body.includes(`line-height: var(${size}--line-height)`)) continue;
      const line = source.slice(0, rule.index).split("\n").length;
      offenders.push(
        `line ${line}: ${(rule[1] ?? "").trim().split("\n").at(-1)?.trim()} ` +
          `states ${size} without var(${size}--line-height)`,
      );
    }
    expect(
      offenders,
      "a stated size with no stated line-height inherits preflight's 1.5",
    ).toEqual([]);
  });

  /** `static`, because Tailwind drops a theme variable no utility references.
   *
   *  The unreferenced set moves as the surface grows (`--text-xl` is referenced
   *  by nothing today), so this names the mechanism rather than a list. Without
   *  `static` the unreferenced ones were emitted nowhere — measured in the built
   *  bundle, where only `--spacing`, `--radius-sm|md` and `--text-xs|sm`
   *  survived — which is the same resolves-to-nothing defect the `--yunari-*`
   *  block had, arrived at through the door that was supposed to fix it. */
  it("keeps the unreferenced scale tokens in the bundle", () => {
    expect(css).toMatch(/^[ \t]*@theme[ \t]+static[ \t]*\{/m);
  });

  /** A utility compiled from the palette must resolve at the ELEMENT.
   *
   *  `@theme` compiles `.bg-shell-surface` to `var(--color-shell-surface)`,
   *  which the browser looks up from `:root` — losing the one subtree that
   *  re-declares the token, the swatch that names a palette it is not rendering
   *  under, which `shell-appearance.spec.ts` already holds as a contract.
   *  `inline` compiles it to `var(--shell-surface)` and the lookup happens where
   *  the utility is written. jsdom resolves no custom properties, so this half
   *  can only check that the block is the right KIND; the resolution is
   *  measured in a browser, by `shell-appearance.spec.ts`. */
  it("gives every shell colour token a name in @theme inline", () => {
    const inline =
      /^[ \t]*@theme[ \t]+inline[ \t]*\{([^}]*)\}/m.exec(css)?.[1] ?? "";
    expect(inline, "the palette is not in an @theme inline block").not.toBe("");

    // **One token is not a colour, and a `--color-*` name for it would compile
    // a broken utility** — Tailwind's namespaces are per type, so a font stack
    // belongs in `--font-*`. Measured: the file declares twelve `--shell-*`
    // tokens and eleven of them are colours, which the count below pins so
    // this exclusion cannot quietly grow to swallow one.
    const NOT_A_COLOUR = new Set(["--shell-display"]);
    const declared = [...css.matchAll(/^\s*(--shell-[a-z-]+)\s*:/gm)].map(
      (match) => match[1] ?? "",
    );
    const colours = [...new Set(declared)].filter(
      (token) => !NOT_A_COLOUR.has(token),
    );
    expect(colours, "the exclusion set is hiding a colour").toHaveLength(11);

    for (const token of colours) {
      expect(
        inline,
        `${token} has no utility name, so nothing can read it as a Tailwind colour`,
      ).toContain(
        `${token.replace("--shell-", "--color-shell-")}: var(${token})`,
      );
    }
  });

  /** DESIGN.md §4's role vocabulary is what a *surface* writes, and today only the
   *  `--shell-*` layer exists. An alias is substituted where it is declared, so
   *  a role declared once at `:root` would resolve the root's palette and pin a
   *  subtree that re-declares `--shell-*` — the swatch chip — to it. Every
   *  palette therefore declares all thirteen, and each colour role that can hold
   *  a plain colour gets a utility name so a React surface writes `bg-panel-2`
   *  rather than an arbitrary value; `--bg` and `--stage` cannot, and say why
   *  below.
   *
   *  `--stage`, `--hdr` and `--edge-2` were declared ahead of their consumers
   *  on the user's instruction, reversing the earlier "nothing declared for
   *  nothing" ruling recorded here: §4 names all thirteen roles, and the gap
   *  was the detail pass every later plan composes from. A colour declared for
   *  nothing is still the defect this plan exists to remove — the reversal is
   *  the user's, and the three now have a named consumer path. */
  it("declares every §4 colour role in every palette block", () => {
    const roles = [
      "--bg",
      "--stage",
      "--hdr",
      "--panel",
      "--panel-2",
      "--edge",
      "--edge-2",
      "--text",
      "--muted",
      "--faint",
      "--accent",
      "--warn",
      "--hot",
    ];
    for (const palette of shellPalettes) {
      const body = declarationBlock(palette);
      expect(body, `no declaration block found for ${palette}`).not.toBe("");
      for (const role of roles) {
        expect(
          body,
          `${palette} does not declare ${role}, so it resolves to whatever ` +
            "the root happened to hold where the alias was written",
        ).toContain(`${role}:`);
      }
    }

    const inline =
      /^[ \t]*@theme[ \t]+inline[ \t]*\{([^}]*)\}/m.exec(css)?.[1] ?? "";
    // `--bg` and `--stage` are the two roles with no utility: both alias
    // `--shell-backdrop`, which `light` makes a gradient stack (graphite's
    // retired with plan 7 Task 4), and a colour utility from either would set a
    // colour to that and fail silently.
    // Both roles are still declared and asserted above; only the utility name
    // would be wrong. `--hdr` aliases `--shell-surface`, a plain colour (alpha
    // at most) in all six palettes, so its utility is safe.
    const noUtility = new Set(["--bg", "--stage"]);
    for (const role of roles.filter((role) => !noUtility.has(role))) {
      expect(
        inline,
        `${role} has no utility name, so a surface cannot write it as a class`,
      ).toContain(`--color-${role.slice(2)}: var(${role})`);
    }
    for (const role of noUtility) {
      expect(
        inline,
        `a colour utility from ${role} would set a colour to a gradient stack`,
      ).not.toContain(`--color-${role.slice(2)}:`);
    }
  });

  /** The defect this test exists to prevent, and the reason the one above could
   *  not see it (`vg-307`).
   *
   *  Each palette block writes §4's role *aliases* — `--hot: var(--shell-danger)`,
   *  `--warn: var(--shell-warm)` — and the test above asserts those aliases are
   *  present. An alias is substituted where it is declared, so an alias naming a
   *  `--shell-*` the block does not declare resolves to whatever the baseline
   *  `:root` block held — editorial's value under a palette that is not
   *  editorial — or, where no block declares it, to nothing at all. Four of the
   *  six blocks were missing the primary button's pair and its danger source,
   *  and `light` was missing `--shell-warm` too. The assertion is therefore on
   *  the **source**, not on the alias: a palette that is a member of a derived
   *  system declares every role it can name. */
  it("declares the source of every role alias in every palette block", () => {
    for (const palette of shellPalettes) {
      const body = declarationBlock(palette);
      expect(body, `no declaration block found for ${palette}`).not.toBe("");
      for (const token of SOURCE_TOKENS) {
        expect(
          body,
          `${palette} does not declare ${token}, so an alias naming it ` +
            "resolves to whatever the root happened to hold",
        ).toContain(`${token}:`);
      }
    }
  });

  /** Ruling of 2026-10-10 (plan 7 Task 4): **every palette's primary button is
   *  its own accent**, with a text colour that clears §5's 4.5:1 against it.
   *  That is the derivation rule the five non-source palettes inherit rather
   *  than six hand-picked pairs, and it is stated as `--shell-primary-bg:
   *  var(--shell-accent)` so a palette that moves its accent moves the button
   *  with it.
   *
   *  The ratio is read from the declared values rather than from the browser:
   *  both sides are literals in the palette block, so the arithmetic is the
   *  same arithmetic and it can run beside the stylesheet. */
  it("holds the primary button's text above §5's ratio in every palette", () => {
    /** A `#rgb`/`#rrggbb` literal, which is every value this pair declares. */
    const rgb = (value: string): readonly [number, number, number] => {
      const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
      if (hex === null) return [Number.NaN, Number.NaN, Number.NaN];
      const body = hex[1] ?? "";
      const at = (i: number): number =>
        Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
      return [at(0), at(1), at(2)];
    };
    const luminance = (colour: readonly [number, number, number]): number => {
      const channel = (v: number): number => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return (
        0.2126 * channel(colour[0]) +
        0.7152 * channel(colour[1]) +
        0.0722 * channel(colour[2])
      );
    };
    const contrast = (
      a: readonly [number, number, number],
      b: readonly [number, number, number],
    ): number => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
    };
    const value = (body: string, token: string): string =>
      new RegExp(`${token}\\s*:\\s*([^;]+);`).exec(body)?.[1]?.trim() ?? "";

    for (const palette of shellPalettes) {
      const body = declarationBlock(palette);
      const background = value(body, "--shell-primary-bg");
      const text = value(body, "--shell-primary-text");
      // The fill is the accent, in every palette, by construction.
      expect(
        background,
        `${palette}'s primary button does not take its accent`,
      ).toBe("var(--shell-accent)");
      const ratio = contrast(rgb(value(body, "--shell-accent")), rgb(text));
      expect(
        Number.isFinite(ratio) ? ratio : 0,
        `${palette}'s primary text ${text} is ${ratio}:1 on ${value(body, "--shell-accent")}, below 4.5:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  /** `vg-553`: a name this phase retired can be declared again with every gate
   *  green.
   *
   *  Every surviving guard is one-directional. `shell-palette-tokens.spec.ts`'s
   *  `themeToken()` throws on an *absent* token, so it catches a removal and
   *  never an addition; the value pin above is `toMatchObject`, so an added name
   *  never fails; the not-on-`:root` list is a forbidden list over the type
   *  scale, whose purpose is `:root` beating `@layer theme`. An addition is the
   *  direction a retired name re-enters by, and this is the assertion `vg-261`'s
   *  red proof found missing.
   *
   *  The granularity is a list rather than an exhaustive assertion over a whole
   *  block: `@theme static` also carries the type scale and the `--color-*`
   *  aliases, and the `:root` control block carries the §4 roles, so a
   *  closed-set assertion over either would redden on every legitimate addition.
   *  A name joins this list when it is retired, and the list is the vocabulary
   *  the phase has closed. */
  it("declares no retired token", () => {
    const RETIRED_TOKENS = [
      // Task 20.1, `vg-261`: one elevation ladder survives.
      "--shadow-raised",
      "--shadow-overlay",
      // Task 20.3, `vg-312`: a per-palette flag no `var()` read.
      "--shell-flat",
      // Task 20.7, `vg-552`: the control block's ten unread declarations.
      "--yunari-text",
      "--yunari-panel-bg",
      "--yunari-panel-border",
      "--yunari-control-border",
      "--yunari-input-bg",
      "--yunari-muted",
      "--yunari-selection-bg",
      "--yunari-accent",
      "--yunari-accent-dim",
      "--yunari-guide",
    ] as const;
    // Comments carry `:` and `;`, so a prose mention of a retired name reads as a
    // declaration to the regexes below. They are blanked rather than removed, so
    // a line number in a failure message stays the line number.
    const source = css.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
      comment.replace(/[^\n]/g, " "),
    );
    for (const token of RETIRED_TOKENS) {
      expect(
        source,
        `${token} is declared again, so a name this phase retired is back`,
      ).not.toMatch(new RegExp(`^\\s*${token}\\s*:`, "m"));
      expect(
        source,
        `${token} is read again, so a rule resolves a name this phase retired`,
      ).not.toMatch(new RegExp(`var\\(\\s*${token}\\s*[),]`));
    }
  });
});
