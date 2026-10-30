#!/usr/bin/env node

/**
 * The ratchet that keeps the design language consumed.
 *
 * The scales in `editor-shell.css`'s `@theme static` block are the design
 * language; a surface that writes `padding: 7px` or `color: #ff0000` has gone
 * around them, and nothing fails — it just renders slightly wrong. This scans
 * the files listed in `design-tokens.gated.json` — the files already converted —
 * and refuses a literal that should have been a token. The list only grows, so
 * the repo never has to be green all at once.
 *
 * The list alone could say only that a listed file is clean, so a component
 * written with a literal was invisible for ever and "the list only grows" had no
 * finish. `remainderCeiling` answers that (`vg-426`): every run reports how many
 * product source files off the list still hold a literal, and refuses a run
 * where that number grew. The ceiling falls in the commit that converts a file,
 * and the run says so when it can.
 *
 * The set is in two halves. The JSON holds its *source* files, one per line, as
 * each conversion named them. The *test* half is derived on every run from the
 * tree (`selectTestFiles`): everything that renders or drives the shell — every
 * `*.dom.test.tsx` under `src/web`, and every Playwright spec under
 * `src/web/tests/e2e/` that opens the editor preview (`vg-228`, `vg-286`). A
 * membership rule rather than a list, because file-by-file membership meant the
 * list said 'whichever task happened to name it', which a reader cannot tell
 * from an omission. Both halves are needed: a rule that selects nothing is the
 * same vacuous guard as an empty file list, and it fails the same way.
 *
 * A second instrument covered the one large surface that was not on that list —
 * `CEILINGS`, which recorded `editor-shell.css`'s whole residual set. It retired
 * with that file's conversion (`vg-274`): the path is in the list above now, so
 * the file that declares the scales is held to them exactly as the surfaces
 * consuming them are, and one instrument covers it rather than two.
 *
 * This is deliberately the *cheap* ratchet, and its second px tier is coarse in
 * a way that is documented rather than accidental: in a spacing property the
 * design's spacing steps are enforced exactly, because the property is right
 * there to read, and everywhere else only the values DESIGN.md prints are
 * allowed. The real enforcement is the browser assertion in Task 4 — every
 * gated element's computed spacing on DESIGN.md's scale — which is what catches
 * a `26px` in a place this text scan cannot reason about.
 *
 * `node scripts/design-tokens.mjs --self-test` proves every rule still fires.
 * A guard that passes because it looked at nothing is the defect this file
 * exists to remove, so an empty gated list is a failure, not a pass.
 */

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** The design's named steps: the only spacing values a surface may write. */
const SPACING_STEPS = new Set([4, 6, 8, 10, 12, 14, 16, 20, 24, 32]);
/** Always allowed anywhere: `1px` is a hairline border, and `0` is no border at all. */
const ALWAYS_PX = new Set([0, 1]);

/**
 * A px here *is* a spacing decision, so it is held to the steps alone —
 * DESIGN.md's `26px` row rhythm is a density, not a gutter, and 26 is in no step.
 */
const SPACING_PROPERTY =
  /^(?:padding|margin|inset|translate)(?:-|$)|^(?:gap|row-gap|column-gap|top|right|bottom|left)$/;

/**
 * Tailwind's spacing utilities with an arbitrary length — `p-[26px]`,
 * `gap-x-[7px]`, `md:mt-[30px]`, and their negatives `-mt-[26px]`. In a `.tsx`
 * there is no declaration property to read, so the utility name is the signal
 * that the px is a spacing decision; these are held to the steps the way a
 * CSS spacing property is. Scoped to these names on purpose: `h-[26px]`,
 * `size-[24px]`, `translate-x-[10px]` and `min-w-[10rem]` are not spacing
 * properties and stay in tier 2. Longest name first so `px-`/`gap-x-` win over
 * `p-`/`gap-`, and the optional leading `-` covers a negative margin or inset.
 */
const TW_SPACING =
  /(?<![\w-])-?(?:px|py|pt|pb|pl|pr|p|mx|my|mt|mb|ml|mr|m|gap-x|gap-y|gap|space-x|space-y)-\[(\d+(?:\.\d+)?)px\](?![\w-])/g;

/**
 * A block whose whole selector list is one of these *defines* tokens, so its
 * literals are the values rather than a surface going around them. A rule that
 * merely mentions the attribute — `[data-shell-palette="x"] .chip`,
 * `:root:not([data-shell-palette="editorial"]) .editor-glass` — is a treatment
 * rule, and its hexes and px are violations like any other.
 */
const DEFINITION_SELECTOR =
  /^(?::root|\[data-shell-palette="[a-z-]+"\]|\.editor-shell-palette-swatch)$/;

/** Longest alternative first: a 6-digit match on an 8-digit literal would leave two hex digits behind. */
const HEX =
  /(?<![\w#-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![\w-])/g;
const PX = /(?<![\w.])(\d+(?:\.\d+)?)px(?![\w-])/g;

const DEFAULT_GATED = "scripts/design-tokens.gated.json";
const ROOT = resolve(import.meta.dirname, "..");

/**
 * What "a Playwright spec that opens the editor preview" means to a text scan:
 * the preview origin the suite fixes (W1's `4174`), or the shared `openEditor(`
 * helper every editor-driving spec starts from. A spec that names neither never
 * opens the editor, so nothing it writes is the shell's to answer for.
 */
const OPENS_EDITOR = /127\.0\.0\.1:4174|openEditor\(/;

/**
 * Directories the test-file walk never descends into. Build output and installed
 * dependencies are not this repo's source, and a `.dom.test.tsx` inside one is
 * somebody else's file — the same reason the ratchet is not a whole-repo lint.
 */
const UNWALKED = new Set([
  "node_modules",
  "dist",
  "coverage",
  "test-results",
  "playwright-report",
]);

/**
 * Blank a span to spaces, keeping its newlines. A masked span must not move a
 * reported line number, so whitespace is emptied character for character.
 */
function blank(span) {
  return span.replace(/[^\n]/g, " ");
}

/**
 * The text the rules read: comments and `calc()` blanked out. A comment
 * explaining that `7px` was the bug is not that bug, and `calc()` is left alone.
 */
function scannable(source, relPath) {
  let text = source.replace(/\/\*[\s\S]*?\*\//g, blank);
  if (/\.(tsx?|jsx?)$/.test(relPath)) {
    // `(?<!:)` because `https://` is not a comment, and blanking the rest of
    // that line would hide every violation on it.
    text = text.replace(/(?<!:)\/\/[^\n]*/g, blank);
  }
  const opens = /\bcalc\(/g;
  let match = opens.exec(text);
  while (match !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    while (i < text.length && depth > 0) {
      if (text[i] === "(") depth += 1;
      else if (text[i] === ")") depth -= 1;
      i += 1;
    }
    const from = match.index + match[0].length;
    text =
      text.slice(0, from) + blank(text.slice(from, i - 1)) + text.slice(i - 1);
    match = opens.exec(text);
  }
  return text;
}

function isDefinition(prelude) {
  const head = prelude.trim();
  if (head === "") return false;
  if (/^@theme\b/.test(head)) return true;
  return head
    .split(",")
    .every((selector) => DEFINITION_SELECTOR.test(selector.trim()));
}

/** Offsets of every definition block's body: `@theme`, and the palette blocks. */
function definitionSpans(text) {
  const spans = [];
  let prelude = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "{") {
      if (isDefinition(prelude)) {
        let depth = 1;
        let j = i + 1;
        while (j < text.length && depth > 0) {
          if (text[j] === "{") depth += 1;
          else if (text[j] === "}") depth -= 1;
          j += 1;
        }
        spans.push([i + 1, j]);
        i = j;
        prelude = "";
        continue;
      }
      prelude = "";
    } else if (ch === "}" || ch === ";") {
      prelude = "";
    } else {
      prelude += ch;
    }
    i += 1;
  }
  return spans;
}

/** The property name the px at `index` is a value of, or null outside a declaration. */
function declarationProperty(text, index) {
  const start =
    Math.max(
      text.lastIndexOf("{", index),
      text.lastIndexOf("}", index),
      text.lastIndexOf(";", index),
    ) + 1;
  const colon = text.indexOf(":", start);
  if (colon === -1 || colon > index) return null;
  const property = text.slice(start, colon).trim();
  return /^[a-z-]+$/.test(property) ? property : null;
}

/**
 * The prelude of the *smallest block that contains* `index` — its selector, in a
 * `.css`, and the at-rule's own prelude for a literal in one, which is where a
 * media query's px lives (`@media (max-width: 980px)`, not the `[hidden] {` block
 * above it). It is what identifies *where* a declaration is, and a block inserted
 * above it does not move it, which is the reason it is not a line number.
 *
 * The span of a block runs from the end of the previous block or statement (its
 * prelude's first character) to its own `}`, so the innermost containing block is
 * well defined whether the literal is in a body or in a prelude. Walked over the
 * scanned text, so a comment before a selector is already blanked to spaces.
 * `""` for a literal outside every block.
 */
function siteOf(text, index) {
  let from = 0;
  const open = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "{") {
      open.push([from, i]);
      from = i + 1;
    } else if (ch === "}") {
      // Blocks close innermost first, so the first containing span to close *is*
      // the smallest one; an outer block's span also contains the index, and a
      // sibling's has already been passed.
      const span = open.pop();
      if (span !== undefined && index > span[0] && index < i) {
        return text.slice(span[0], span[1]).replace(/\s+/g, " ").trim();
      }
      from = i + 1;
    } else if (ch === ";") {
      from = i + 1;
    }
  }
  return "";
}

function position(text, index) {
  const before = text.slice(0, index);
  return {
    line: before.split("\n").length,
    column: index - before.lastIndexOf("\n"),
  };
}

/**
 * Violations in one file's source. `designLanguagePx` is the tier-2 allowlist: px
 * lengths the design fixes outside its spacing table, whatever the property —
 * the row rhythms, the rail and pane widths, the `2px` accent bar on the rail's
 * inner edge, the `28px` mark slot, the pill and toggle heights, the slider's
 * track and value well, the swatch, and the stroke widths among them. It is the
 * set of values that actually appear, not an enumeration of every number
 * the design prints. What it deliberately does NOT cover is type sizes
 * 13/15/19, because a value here is allowed *anywhere*, so adding them would
 * license `padding: 13px`. The steps and `0`/`1` are allowed without it, so an
 * empty allowlist narrows the rule rather than disabling it. Each violation
 * carries its `rule`, its position, the `site` it sits at — the prelude of the
 * block containing it, which is the enclosing selector for a declaration and the
 * at-rule's own prelude for a literal in one (`siteOf`) — and its `text`: where
 * the value is, and what it says.
 */
export function check(relPath, source, designLanguagePx = []) {
  const path = String(relPath ?? "");
  const named = new Set([...designLanguagePx].map(Number));
  const text = scannable(String(source ?? ""), path);
  const definitions = definitionSpans(text);
  const inDefinition = (index) =>
    definitions.some(([from, to]) => index >= from && index < to);
  const isCss = /\.css$/.test(path);
  const found = [];

  // In a `.tsx` there is no declaration property to read, so a Tailwind
  // spacing utility carrying an arbitrary value is what marks the px as a
  // spacing decision. Computed once, lazily, only for a non-CSS file.
  let twSpans;
  const isTwSpacing = (index) => {
    if (isCss) return false;
    if (twSpans === undefined) {
      twSpans = [...text.matchAll(TW_SPACING)].map((match) => {
        const from = match.index + match[0].indexOf(match[1]);
        return [from, from + match[1].length];
      });
    }
    return twSpans.some(([from, to]) => index >= from && index < to);
  };

  for (const match of text.matchAll(HEX)) {
    if (inDefinition(match.index)) continue;
    found.push({
      rule: "hex-literal",
      ...position(text, match.index),
      site: siteOf(text, match.index),
      text: match[0],
    });
  }

  for (const match of text.matchAll(PX)) {
    if (inDefinition(match.index)) continue;
    const value = Number(match[1]);
    if (ALWAYS_PX.has(value)) continue;
    const property = isCss ? declarationProperty(text, match.index) : null;
    const spacing =
      property !== null
        ? SPACING_PROPERTY.test(property)
        : isTwSpacing(match.index);
    const site = siteOf(text, match.index);
    if (spacing && !SPACING_STEPS.has(value)) {
      found.push({
        rule: "spacing-px",
        ...position(text, match.index),
        site,
        text: `${property}: ${match[0]}`,
      });
    } else if (!spacing && !SPACING_STEPS.has(value) && !named.has(value)) {
      found.push({
        rule: "off-scale-px",
        ...position(text, match.index),
        site,
        text: match[0],
      });
    }
  }

  return found.sort((a, b) => a.line - b.line || a.column - b.column);
}

/**
 * The tier-2 allowlist entries that permit nothing: no source the checker reads
 * *writes* that px value where the checker could see it (`vg-340`, `vg-332`).
 *
 * Two shapes count as no consumer, and both are defects of the list rather than
 * of a file. A value written only inside a definition block is a token's value,
 * not a surface's: nothing would be flagged were the entry dropped. A value
 * written only as a bare number — `strokeWidth={1.7}`, a component prop — is
 * invisible to this text scan, which matches `px` only, so an entry for it can
 * never fire and the DOM assertion is the only instrument that has ever seen it.
 * Either way the entry is dead weight, and the fix is to drop it: removing an
 * allowed value can only tighten the gate, while an entry nothing writes is what
 * this rule exists to forbid.
 *
 * `sources` is `[relPath, source]` pairs — everything the run reads, the gated
 * list and the files the test-file rule selects. A pair whose `source` is not a
 * string is a read that failed, and it makes the union a subset of what the run
 * reads: `46`'s only consumer is `editor-shell.css`, so a transient `ENOENT` on
 * that file would report `46` as an entry with no consumer and the message says
 * to drop it — a deleted load-bearing entry, which is worse than a rule that did
 * not run. Nothing is reported instead; `unread` is returned so the caller
 * prints the rule as *not checked*.
 *
 * Returns `{ unconsumed, unread }`: `unconsumed` is empty whenever `unread` is.
 */
export function unconsumedPx(designLanguagePx, sources) {
  const unread = [];
  const written = new Set();
  for (const [relPath, source] of sources) {
    if (typeof source !== "string") {
      unread.push(String(relPath ?? ""));
      continue;
    }
    const text = scannable(source, String(relPath ?? ""));
    const definitions = definitionSpans(text);
    for (const match of text.matchAll(PX)) {
      if (
        definitions.some(
          ([from, to]) => match.index >= from && match.index < to,
        )
      )
        continue;
      written.add(Number(match[1]));
    }
  }
  if (unread.length > 0) return { unconsumed: [], unread };
  return {
    unconsumed: [...designLanguagePx].filter((value) => !written.has(value)),
    unread,
  };
}

/**
 * Every file under `dir` whose name ends with one of `suffixes`, as absolute
 * paths. A directory that cannot be read — a root with no `src/web` under it —
 * is not an error here: the selection it produces is empty, and an empty
 * selection is refused by the caller rather than reported as a clean run.
 */
async function walkFiles(dir, suffixes, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!UNWALKED.has(entry.name)) await walkFiles(path, suffixes, out);
    } else if (suffixes.some((suffix) => entry.name.endsWith(suffix))) {
      out.push(path);
    }
  }
  return out;
}

/** Windows `relative()` yields backslashes; every path this file emits is posix. */
function posix(path) {
  return path.replaceAll("\\", "/");
}

/**
 * The test half of the gated set, derived from the tree on every run (`vg-228`:
 * the criterion is *everything that renders or drives the shell*). Root-relative
 * and sorted, so the selection a run prints is the same list twice in a row.
 *
 * Exported because the self-test proves the rule over a scratch tree rather than
 * over this repo's own files — a rule that fires only on the tree that happens to
 * be here is the per-file list this replaces.
 */
export async function selectTestFiles(root) {
  const web = resolve(root, "src", "web");
  const selected = await walkFiles(web, [".dom.test.tsx"]);
  for (const path of await walkFiles(resolve(web, "tests", "e2e"), [
    ".spec.ts",
  ])) {
    let source;
    try {
      source = await readFile(path, "utf8");
    } catch {
      continue;
    }
    if (OPENS_EDITOR.test(source)) selected.push(path);
  }
  return [
    ...new Set(selected.map((path) => posix(relative(root, path)))),
  ].sort();
}

/**
 * The remainder (`vg-426`): the files the ratchet *could* gate that still hold a
 * literal, and so the answer to "how much is left" rather than "the list grew".
 *
 * Without it the ratchet can only say that a listed file is clean, so a new
 * component written with a literal is invisible for ever — which is the row's
 * whole finding. A count with a ceiling is the cheapest target that stops the
 * remainder growing, and it takes no position on where a new component's tokens
 * come from, which the row records as a policy call rather than a scanner edit.
 *
 * Only surfaces the design language can reach: the editor's DOM
 * package. A custom property resolves only in a document that loaded
 * `editor-shell.css`, so a canvas context, a Fabric object, a standalone player
 * or host page and a persisted theme value cannot consume it whatever they
 * write. The unreachable paths are excluded by rule and reported every run, so
 * the scope is visible rather than implied; a package the rule does not name
 * is still counted, which is what stops a new UI package escaping unnamed.
 *
 * **Tests and fixtures are out of the count.** A test that asserts `#ff0000` is
 * a test *about* a literal, and a fixture is a document rather than a surface —
 * measuring them would report 81 where the product's own source holds 19, and a
 * measure that mostly counts things nobody intends to convert is a count with no
 * finish, which is the failure this row names. The `.dom.test.tsx` half is gated
 * by the derived rule on its own criterion and is unaffected.
 */
const NOT_PRODUCT_SOURCE = /\.test\.tsx?$|\.spec\.ts$|-fixture\.tsx?$/;

/**
 * Where the design language cannot reach, and the reason beside each rule. A
 * path is excluded only when its surface cannot resolve a custom property; "not
 * converted yet" is not a reason to exclude anything.
 */
const OUTSIDE_DESIGN_LANGUAGE = [
  // No editor stylesheet: the host's standalone pages, the player's own chrome.
  /^src\/web\/packages\/(host|player)\//,
  // Architecture: renderer-core is Fabric/DOM-free; scene-fabric paints a canvas.
  /^src\/web\/packages\/(renderer-core|scene-fabric)\//,
  // Editor surfaces that paint through Fabric or a 2D context, not CSS.
  /^src\/web\/packages\/editor\/src\/(snap-manager|controls-manager|crop-manager)\//,
  // The starter theme's persisted paint is document data, not editor chrome.
  /^src\/web\/packages\/editor\/src\/new-fabric-theme-(globals|objects)\.ts$/,
  // Fixed ink and paper: a themed QR inverts under half the shell palettes.
  /^src\/web\/packages\/editor\/src\/editor-shell\/qr-symbol\.tsx$/,
];

function outsideDesignLanguage(relPath) {
  return OUTSIDE_DESIGN_LANGUAGE.some((rule) => rule.test(relPath));
}

export async function remainderFiles(root, gated, designLanguagePx = []) {
  const packages = resolve(root, "src", "web", "packages");
  let entries;
  try {
    entries = await readdir(packages, { withFileTypes: true });
  } catch {
    return { files: [], excluded: [] };
  }
  const found = [];
  const excluded = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    for (const path of await walkFiles(join(packages, entry.name, "src"), [
      ".ts",
      ".tsx",
    ])) {
      const relPath = posix(relative(root, path));
      if (gated.has(relPath) || NOT_PRODUCT_SOURCE.test(relPath)) continue;
      let source;
      try {
        source = await readFile(path, "utf8");
      } catch {
        continue;
      }
      if (check(relPath, source, designLanguagePx).length === 0) continue;
      (outsideDesignLanguage(relPath) ? excluded : found).push(relPath);
    }
  }
  return { files: found.sort(), excluded: excluded.sort() };
}

/**
 * Proves every rule still fires. Called only from the entry-point gate: an
 * importer in a process whose argv happens to mention `--self-test` must not
 * run it and exit mid-import.
 */
async function selfTest() {
  const cases = [
    // A literal is a violation; a role reference is not.
    ["a hex colour is a violation", "a.css", ".x { color: #ff0000; }", 1],
    ["a role reference is not", "a.css", ".x { color: var(--text); }", 0],

    // Tier 1: a spacing property is held to the steps, and to nothing else.
    [
      "an off-scale px spacing is a violation",
      "a.css",
      ".x { padding: 7px; }",
      1,
    ],
    ["an on-scale px spacing is not", "a.css", ".x { padding: 12px; }", 0],
    [
      "a DESIGN.md row rhythm is not a spacing step",
      "a.css",
      ".x { margin: 26px; }",
      1,
      { designLanguagePx: [26] },
    ],
    [
      "a hairline border is not",
      "a.css",
      ".x { border: 1px solid var(--edge); }",
      0,
    ],
    [
      "a zero and a percentage are not",
      "a.css",
      ".x { margin: 0; opacity: 100%; }",
      0,
    ],

    // Tier 2: outside a spacing property, every value DESIGN.md prints is allowed.
    [
      "a DESIGN.md value outside a spacing property is not",
      "a.css",
      ".x { width: 26px; }",
      0,
      { designLanguagePx: [26] },
    ],
    [
      "the same value is a violation with no allowlist",
      "a.css",
      ".x { width: 26px; }",
      1,
    ],
    ["a rem length is not checked", "a.css", ".x { padding: 1rem; }", 0],
    ["calc() is not checked", "a.css", ".x { width: calc(100% - 7px); }", 0],

    // A definition block holds values; a rule that merely names a palette does not.
    [
      "a palette block keeps its hex",
      "editor-shell.css",
      '[data-shell-palette="graphite"] {\n  --shell-text: #eef9f4;\n}',
      0,
    ],
    [
      "a @theme block defines the scale, so its values are not literals",
      "editor-shell.css",
      "@theme static {\n  --text-xs: 11px;\n  --shadow-raised: 0 12px 28px #0000003d;\n}",
      0,
    ],
    [
      ":root token block is a definition",
      "a.css",
      ":root {\n  --yunari-input-bg: #ffffff;\n}",
      0,
    ],
    [
      "a rule that only names a palette is not a definition",
      "editor-shell.css",
      '[data-shell-palette="graphite"] .chip {\n  color: #ff0000;\n  padding: 7px;\n}',
      2,
    ],
    [
      "a :not() treatment rule is not a definition",
      "editor-shell.css",
      ':root:not([data-shell-palette="editorial"]) .editor-glass {\n  background: #ff0000;\n}',
      1,
    ],
    [
      "the same hex outside a definition block is a violation",
      "a.css",
      ".x { color: #eef9f4; }",
      1,
    ],

    [
      "a comment is not a violation",
      "a.css",
      "/* 12px was the step; 7px was the bug */",
      0,
    ],
    [
      "an eight-digit hex is one violation, not two",
      "a.css",
      ".x { color: #00000059; }",
      1,
    ],
    [
      "an id selector is not a hex colour",
      "a.css",
      "#app { height: 100%; }",
      0,
    ],
    ["a tsx literal is checked", "a.tsx", 'const s = { padding: "7px" };', 1],
    // A Tailwind spacing utility in a `.tsx` is tier 1, even where the value is
    // a DESIGN.md value tier 2 would admit — `26` is allowed here only with the
    // allowlist, so this case fails if the utility rule is removed.
    [
      "a tsx spacing utility is held to the spacing steps even for a design value",
      "a.tsx",
      'const c = "p-[26px]";',
      1,
      { designLanguagePx: [26] },
    ],
    [
      "a tsx gap utility with an off-scale value is a violation",
      "a.tsx",
      'const c = "gap-[7px]";',
      1,
    ],
    [
      "a tsx spacing utility on a step is not",
      "a.tsx",
      'const c = "px-[12px]";',
      0,
    ],
    // A leading `-` is a negative margin/inset, not an exemption: it is held to
    // the spacing scale the same way, so this case fails if negative support is removed.
    [
      "a negative tsx spacing utility is held to the spacing scale",
      "a.tsx",
      'const c = "-mt-[26px]";',
      1,
      { designLanguagePx: [26] },
    ],
    [
      "a negative tsx spacing utility on a step is not",
      "a.tsx",
      'const c = "-mt-[12px]";',
      0,
    ],
    // Scoping: a non-spacing utility keeps the tier-2 allowlist.
    [
      "a tsx non-spacing utility keeps the DESIGN.md allowlist",
      "a.tsx",
      'const c = "h-[26px]";',
      0,
      { designLanguagePx: [26] },
    ],
    ["a tsx comment is not", "a.tsx", "// 7px was the bug\nconst s = {};", 0],
    [
      "a url in a tsx file is not a comment",
      "a.tsx",
      'const u = "https://x"; const s = "7px";',
      1,
    ],
    // A masked comment must not move the line it reports: it did, and a
    // multi-line comment is what shifted every line below it.
    [
      "a violation after a multi-line comment keeps its line",
      "a.css",
      "/* one\n two */\n.x { padding: 7px; }",
      1,
      { line: 3 },
    ],
    // The site is the smallest block *containing* the literal. A px in an at-rule
    // prelude belongs to that at-rule and not to the block above it, and an
    // unrelated block inserted before it must not move the key — the second case
    // is the one the first cannot see, because a key read off the preceding `{`
    // would name `[hidden]` there and `.vg-probe-between` here.
    [
      "a prelude literal's site is its at-rule's prelude",
      "a.css",
      "[hidden] { display: none; }\n@media (max-width: 980px) {\n  .x { color: var(--a); }\n}",
      1,
      { site: "@media (max-width: 980px)" },
    ],
    [
      "a prelude literal's site survives a block inserted above it",
      "a.css",
      "[hidden] { display: none; }\n.vg-probe-between { color: var(--a); }\n@media (max-width: 980px) {\n  .x { color: var(--a); }\n}",
      1,
      { site: "@media (max-width: 980px)" },
    ],
  ];

  let failed = 0;
  const report = (name, ok, detail) => {
    if (!ok) failed += 1;
    console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` (${detail})`}`);
  };

  for (const [name, path, source, expected, options = {}] of cases) {
    const found = check(path, source, options.designLanguagePx ?? []);
    report(
      name,
      found.length === expected &&
        (options.line === undefined || found[0]?.line === options.line) &&
        (options.site === undefined || found[0]?.site === options.site),
      `expected ${expected} violation(s)${options.line === undefined ? "" : ` on line ${options.line}`}${options.site === undefined ? "" : ` at site ${JSON.stringify(options.site)}`}, got ${found.length} on ${found.map((v) => v.line).join(",") || "no line"}${options.site === undefined ? "" : ` at ${JSON.stringify(found[0]?.site)}`}`,
    );
  }

  // The tier-2 allowlist's own guard (`vg-340`, `vg-332`): an entry no source
  // writes permits nothing. Every case is a shape the checker really meets, and
  // the two that matter are `vg-332`'s — a bare number, and a `px` that only a
  // comment holds.
  const allowlistCases = [
    [
      "a px value a source writes is consumed",
      [46],
      [["a.tsx", 'const s = "h-[46px]";']],
      [],
    ],
    [
      "a value no source writes is unconsumed",
      [999],
      [["a.tsx", 'const s = "h-[26px]";']],
      [999],
    ],
    [
      "a bare numeric literal is not a consumer",
      [1.7],
      [["a.tsx", "const w = { strokeWidth: 1.7 };"]],
      [1.7],
    ],
    [
      "a value only a comment holds is unconsumed",
      [1.8],
      [["a.tsx", '// a 1.8px stroke\nconst s = "";']],
      [1.8],
    ],
    [
      "a value only a definition block holds is unconsumed",
      [46],
      [["a.css", "@theme static { --x: 46px; }"]],
      [46],
    ],
    // The rule is about what a file *writes*, not about what the allowlist
    // suppresses: a spacing utility is held to the spacing scale anyway, and its value still
    // counts as written, which is why a scale step in the list is not reported.
    [
      "a spacing utility still writes its value",
      [46],
      [["a.tsx", 'const s = "p-[46px]";']],
      [],
    ],
    // A read that failed truncates the union, so the rule reports nothing and
    // names the unread pair instead: `46`'s only consumer is the file that did
    // not load, and the message below would otherwise say to drop it.
    [
      "a source that could not be read leaves the rule unrun",
      [46],
      [["gone.css", null]],
      [],
      ["gone.css"],
    ],
  ];
  for (const [name, values, sources, expected, unread = []] of allowlistCases) {
    const got = unconsumedPx(values, sources);
    report(
      name,
      got.unconsumed.length === expected.length &&
        got.unconsumed.every((value, at) => value === expected[at]) &&
        got.unread.length === unread.length &&
        got.unread.every((value, at) => value === unread[at]),
      `expected [${expected.join(",")}] unconsumed / [${unread.join(",")}] unread, got [${got.unconsumed.join(",")}] / [${got.unread.join(",")}]`,
    );
  }

  // The test-file rule, over a tree this repo does not own (`vg-228`). The
  // rule's firing is proved on files written here, so it does not depend on
  // which `*.dom.test.tsx` files happen to be in the repo today: a selected file
  // is scanned, an unselected one is not, and a rule that selects nothing fails.
  const scratchTree = async (files) => {
    const dir = await mkdtemp(join(tmpdir(), "design-tokens-selftest-"));
    for (const [relPath, contents] of Object.entries(files)) {
      const path = join(dir, relPath);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, contents);
    }
    return dir;
  };
  const runOver = (dir) =>
    spawnSync(process.execPath, [import.meta.filename, "--root", dir], {
      encoding: "utf8",
    });

  // Every file that must *not* be scanned carries a literal of its own, so the
  // silence about it is a fact about the rule rather than about a clean file.
  const tree = await scratchTree({
    "scripts/design-tokens.gated.json": JSON.stringify({
      gated: ["src/web/packages/editor/src/listed.tsx"],
      designLanguagePx: [],
    }),
    "src/web/packages/editor/src/listed.tsx": "export const listed = 1;",
    "src/web/packages/editor/src/selected.dom.test.tsx":
      'const s = { color: "#ff0000" };',
    "src/web/packages/editor/src/unselected.tsx":
      'const s = { color: "#00ff00" };',
    "src/web/tests/e2e/driving.spec.ts":
      'await page.goto("http://127.0.0.1:4174/");\nconst c = "#0000ff";',
    "src/web/tests/e2e/unopened.spec.ts":
      'await page.goto("https://example.com/");\nconst c = "#ff00ff";',
    "src/web/tests/e2e/helper.ts": 'export const helper = "#ffff00";',
    "src/web/node_modules/pkg/ignored.dom.test.tsx":
      'const s = { color: "#00ffff" };',
  });
  try {
    const selected = await selectTestFiles(tree);
    report(
      "the rule selects a dom test and a driving spec, and nothing else",
      selected.join(",") ===
        "src/web/packages/editor/src/selected.dom.test.tsx,src/web/tests/e2e/driving.spec.ts",
      `expected a dom test and a driving spec, got [${selected.join(",")}]`,
    );
    const run = runOver(tree);
    report(
      "a selected file is scanned",
      run.stderr.includes(
        "src/web/packages/editor/src/selected.dom.test.tsx:1:",
      ) && run.stderr.includes("src/web/tests/e2e/driving.spec.ts:2:"),
      `exit ${run.status}, stderr ${JSON.stringify(run.stderr.slice(0, 300))}`,
    );
    report(
      "a file the rule did not select is not scanned",
      ![
        "unselected.tsx",
        "unopened.spec.ts",
        "helper.ts",
        "ignored.dom.test.tsx",
      ].some((name) => run.stderr.includes(name)),
      `exit ${run.status}, stderr ${JSON.stringify(run.stderr.slice(0, 300))}`,
    );
  } finally {
    await rm(tree, { recursive: true, force: true });
  }

  const bare = await scratchTree({
    "scripts/design-tokens.gated.json": JSON.stringify([
      "src/web/packages/editor/src/listed.tsx",
    ]),
    "src/web/packages/editor/src/listed.tsx": "export const listed = 1;",
  });
  try {
    const run = runOver(bare);
    report(
      "a rule that selects nothing fails rather than passing",
      run.status === 1 && run.stderr.includes("selected no file"),
      `exit ${run.status}, stderr ${JSON.stringify(run.stderr.slice(0, 300))}`,
    );
  } finally {
    await rm(bare, { recursive: true, force: true });
  }

  // The remainder (`vg-426`), both directions, over a tree this repo does not
  // own. Every file that must NOT be counted carries a literal of its own, so a
  // count of two is a fact about the rule rather than about a clean tree, and
  // the out-of-scope files are literal-holding too, so the excluded count is
  // measured rather than implied.
  const remainderTree = await scratchTree({
    "scripts/design-tokens.gated.json": JSON.stringify({
      gated: ["src/web/packages/editor/src/listed.tsx"],
      designLanguagePx: [],
      remainderCeiling: 2,
    }),
    "src/web/packages/editor/src/listed.tsx": "export const listed = 1;",
    "src/web/packages/editor/src/selected.dom.test.tsx":
      "export const selected = 1;",
    "src/web/tests/e2e/driving.spec.ts":
      'await page.goto("http://127.0.0.1:4174/");',
    "src/web/packages/editor/src/unconverted.tsx":
      'const s = { color: "#00ff00" };',
    "src/web/packages/editor/src/fixture-fixture.ts":
      'export const f = "#123456";',
    "src/web/packages/editor/src/thing.test.ts": 'export const t = "#654321";',
    "src/web/packages/fresh-ui/src/chart.ts": 'const s = { color: "#abcdef" };',
    "src/web/packages/player/src/strip.ts": 'const s = { color: "#111111" };',
    "src/web/packages/renderer-core/src/defaults.ts":
      'const s = { color: "#222222" };',
    "src/web/packages/editor/src/snap-manager/guides.ts":
      'const s = { color: "#333333" };',
    "src/web/packages/editor/src/new-fabric-theme-globals.ts":
      'const s = { color: "#444444" };',
    "src/web/packages/editor/src/editor-shell/qr-symbol.tsx":
      'const s = { color: "#555555" };',
  });
  try {
    const atCeiling = runOver(remainderTree);
    report(
      "the remainder counts reachable product source, reports the rest, and stops at its ceiling",
      atCeiling.status === 0 &&
        atCeiling.stdout.includes("the remainder is 2 file(s)") &&
        atCeiling.stdout.includes(
          "5 file(s) outside the design language's reach",
        ) &&
        !atCeiling.stdout.includes("fixture-fixture") &&
        !atCeiling.stdout.includes("thing.test") &&
        !atCeiling.stdout.includes("player/src/strip") &&
        !atCeiling.stdout.includes("renderer-core/src/defaults") &&
        !atCeiling.stdout.includes("snap-manager/guides") &&
        !atCeiling.stdout.includes("new-fabric-theme-globals") &&
        !atCeiling.stdout.includes("qr-symbol"),
      `exit ${atCeiling.status}, stdout ${JSON.stringify(atCeiling.stdout.slice(-420))}`,
    );

    await writeFile(
      join(remainderTree, "scripts/design-tokens.gated.json"),
      JSON.stringify({
        gated: ["src/web/packages/editor/src/listed.tsx"],
        designLanguagePx: [],
        remainderCeiling: 0,
      }),
    );
    const overCeiling = runOver(remainderTree);
    report(
      "a remainder past its ceiling fails and names the reachable file",
      overCeiling.status === 1 &&
        overCeiling.stderr.includes("the remainder grew to 2") &&
        overCeiling.stderr.includes(
          "unconverted: src/web/packages/editor/src/unconverted.tsx",
        ) &&
        overCeiling.stderr.includes(
          "unconverted: src/web/packages/fresh-ui/src/chart.ts",
        ) &&
        !overCeiling.stderr.includes("player/src/strip"),
      `exit ${overCeiling.status}, stderr ${JSON.stringify(overCeiling.stderr.slice(-420))}`,
    );

    await writeFile(
      join(remainderTree, "scripts/design-tokens.gated.json"),
      JSON.stringify({
        gated: ["src/web/packages/editor/src/listed.tsx"],
        designLanguagePx: [],
      }),
    );
    const noCeiling = runOver(remainderTree);
    report(
      "a config with no ceiling fails rather than measuring nothing",
      noCeiling.status === 1 &&
        noCeiling.stderr.includes('needs a "remainderCeiling"'),
      `exit ${noCeiling.status}, stderr ${JSON.stringify(noCeiling.stderr.slice(-200))}`,
    );
  } finally {
    await rm(remainderTree, { recursive: true, force: true });
  }

  // The brief writes its test as `check(...)` calls from an importer. Importing
  // must hand back the function and nothing else — no CLI, no exit, and not the
  // self-test either, whatever the importing process's argv happens to hold.
  const moduleUrl = pathToFileURL(import.meta.filename).href;
  const importer = (extra) =>
    spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const m = await import(${JSON.stringify(moduleUrl)}); console.log("imported", typeof m.check);`,
        ...extra,
      ],
      { encoding: "utf8" },
    );

  const probe = importer([]);
  report(
    "the export is callable without running the CLI",
    probe.status === 0 && probe.stdout.trim() === "imported function",
    `exit ${probe.status}, stdout ${JSON.stringify(probe.stdout.trim())}, stderr ${JSON.stringify(probe.stderr.trim().slice(0, 120))}`,
  );

  const flagged = importer(["--", "--self-test"]);
  report(
    "an importer's argv cannot trigger the self-test",
    flagged.status === 0 && flagged.stdout.trim() === "imported function",
    `exit ${flagged.status}, stdout ${JSON.stringify(flagged.stdout.trim().slice(0, 120))}`,
  );

  if (failed > 0) {
    console.error(`design-tokens self-test: ${failed} case(s) wrong`);
    process.exit(1);
  }
  console.log("design-tokens self-test: all cases behave");
  process.exit(0);
}

function flagValue(name) {
  const at = process.argv.indexOf(name);
  if (at === -1) return null;
  const value = process.argv[at + 1];
  if (value === undefined || value.startsWith("--")) {
    console.error(`design-tokens: ${name} needs a path`);
    process.exit(1);
  }
  return value;
}

/**
 * The CLI — self-test included — runs only when this file is the entry point,
 * so an importer gets `check` and no side effects at all. Both sides are
 * resolved through `realpathSync` so a symlinked invocation still matches
 * rather than silently running nothing; Windows compares case-insensitively,
 * because a drive-letter case difference would do the same.
 */
const isEntryPoint = (() => {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  const real = (path) => {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  };
  const invoked = real(resolve(entry));
  const self = real(import.meta.filename);
  return process.platform === "win32"
    ? invoked.toLowerCase() === self.toLowerCase()
    : invoked === self;
})();

if (isEntryPoint) {
  if (process.argv.includes("--self-test")) await selfTest();

  const gatedArg = flagValue("--gated");
  const rootArg = flagValue("--root");
  // `--root` exists for the self-test and a red proof: both run this whole
  // instrument over a tree the repo does not own.
  const root = rootArg === null ? ROOT : resolve(rootArg);
  const gatedPath =
    gatedArg === null ? resolve(root, DEFAULT_GATED) : resolve(gatedArg);

  let config;
  try {
    config = JSON.parse(await readFile(gatedPath, "utf8"));
  } catch (error) {
    console.error(
      `design-tokens: cannot read the gated list ${gatedPath} (${error.code ?? error.message})`,
    );
    process.exit(1);
  }
  // A bare array is the gated list alone, which is what the plan's own
  // empty-list proof writes into a temp file.
  const gated = Array.isArray(config) ? config : config.gated;
  const designLanguagePx = config.designLanguagePx ?? [];
  if (!Array.isArray(gated)) {
    console.error(
      `design-tokens: ${gatedPath} must hold an array, or an object with a "gated" array`,
    );
    process.exit(1);
  }
  if (
    !Array.isArray(designLanguagePx) ||
    designLanguagePx.some((value) => !Number.isFinite(value))
  ) {
    console.error(
      `design-tokens: ${gatedPath}'s "designLanguagePx" must be an array of numbers`,
    );
    process.exit(1);
  }
  if (gated.length === 0) {
    // The whole point of the ratchet: a list nobody has added to yet proves nothing.
    console.error(
      `design-tokens: the gated list ${gatedPath} is empty; the guard would check nothing`,
    );
    process.exit(1);
  }

  // The derived half, and the same guard for it one level out: a rule that
  // selects nothing reports a clean run over every test file in the repo, which
  // is the defect an empty list has and the reason both halves are checked.
  const derived = await selectTestFiles(root);
  if (derived.length === 0) {
    console.error(
      `design-tokens: the test-file rule selected no file under ${posix(resolve(root, "src", "web"))}; every *.dom.test.tsx and every tests/e2e spec that opens the editor preview must resolve, or the rule checks nothing`,
    );
    process.exit(1);
  }
  // Deduped rather than concatenated: a path both halves name is one file, and
  // the JSON keeps its source files while a source file's test joins by rule.
  const files = [...new Set([...gated.map(String), ...derived])];

  // The selection is stated, not inferred — a membership a reader cannot see is
  // the file-by-file list this replaced (`vg-228`). Printed before the scan
  // rather than among the success notices below, because a red run is exactly
  // when a reader asks what the rule took.
  console.log(
    `design-tokens: the test-file rule selected ${derived.length} file(s) — every *.dom.test.tsx under src/web, and every tests/e2e spec that opens the editor preview`,
  );
  for (const relPath of derived)
    console.log(`design-tokens: by rule: ${relPath}`);

  // Every file the run reads, read once: the gated list and the files the
  // test-file rule selects. The allowlist rule at the end needs the same union,
  // and reading a file twice would let the two rules disagree about which file
  // they looked at. A read that failed is kept as the error, so the caller that
  // reports it reports once.
  const sources = new Map();
  const sourceOf = async (relPath) => {
    if (!sources.has(relPath)) {
      try {
        sources.set(relPath, await readFile(resolve(root, relPath), "utf8"));
      } catch (error) {
        sources.set(relPath, { error });
      }
    }
    return sources.get(relPath);
  };
  // A success sentence beside a failure is how a red run reads green, so both of
  // the run's success lines wait until nothing has failed.
  const notices = [];

  let violations = 0;
  for (const entry of files) {
    const relPath = String(entry);
    const source = await sourceOf(relPath);
    if (typeof source !== "string") {
      console.error(
        `design-tokens: ${relPath} cannot be read (${source.error.code ?? source.error.message})`,
      );
      violations += 1;
      continue;
    }
    for (const violation of check(relPath, source, designLanguagePx)) {
      console.error(
        `${relPath}:${violation.line}:${violation.column} ${violation.rule} ${violation.text}`,
      );
      violations += 1;
    }
  }
  if (violations > 0) {
    console.error(
      `design-tokens: ${violations} violation(s) across ${files.length} gated file(s)`,
    );
    process.exit(1);
  }
  notices.push(`design-tokens: ${files.length} gated file(s) clean`);

  // The tier-2 allowlist's own guard: an entry no file the run reads writes
  // permits nothing. It reads the same union the checker does, and a file the run
  // could not read makes the union a subset, so the rule reports nothing and says
  // so instead of reporting an entry whose only consumer is that file. The failed
  // read has already reddened the run, so the skip cannot pass silently.
  const { unconsumed, unread } = unconsumedPx(designLanguagePx, [...sources]);
  if (unread.length > 0) {
    console.error(
      `design-tokens: the allowlist was NOT checked — ${unread.join(", ")} could not be read, so an entry whose only consumer that file is would report as one with no consumer here`,
    );
  }
  let breached = 0;
  for (const value of unconsumed) {
    console.error(
      `design-tokens: designLanguagePx allows ${value}px, which no file this run reads writes — the entry has no consumer, so drop it`,
    );
    breached += 1;
  }

  if (breached > 0) process.exit(1);

  // The remainder's ceiling is read here rather than with the other config
  // fields, because a bare-array config is the gated list alone and the proofs
  // that use one exit above on a rule that selected nothing.
  const ceiling = config.remainderCeiling;
  if (!Number.isInteger(ceiling) || ceiling < 0) {
    console.error(
      `design-tokens: ${gatedPath} needs a "remainderCeiling" — a whole number, the most files off the gated list that may still hold a literal (vg-426)`,
    );
    process.exit(1);
  }
  const { files: remainder, excluded } = await remainderFiles(
    root,
    new Set(files),
    designLanguagePx,
  );
  notices.push(
    `design-tokens: the remainder is ${remainder.length} file(s) off the gated list that still hold a literal, against a ceiling of ${ceiling}`,
  );
  notices.push(
    `design-tokens: ${excluded.length} file(s) outside the design language's reach are not counted`,
  );
  if (remainder.length > ceiling) {
    console.error(
      `design-tokens: the remainder grew to ${remainder.length}, past its ceiling of ${ceiling} — a file written with a literal should have consumed a token instead`,
    );
    for (const relPath of remainder)
      console.error(`design-tokens: unconverted: ${relPath}`);
    process.exit(1);
  }
  if (remainder.length < ceiling) {
    // A ceiling nobody lowers is a count with no finish, which is the failure
    // this row names. Said as a nudge rather than a refusal: the conversion and
    // the ceiling belong in one commit, and this is the sentence that says so.
    notices.push(
      `design-tokens: the ceiling can be lowered to ${remainder.length} — it is lowered in the commit that converts a file, or the remainder can grow back`,
    );
  }

  for (const notice of notices) console.log(notice);
}
