#!/usr/bin/env node
/**
 * Two reachability questions over the two stylesheets the product ships:
 * whether a selector one of them declares is applied by anything, and whether a
 * class the production source writes is declared by them. `vg-380`'s ruling:
 * the reverse direction is in scope, and the instrument reads `className` and
 * `classList` writes alongside `class=` literals.
 *
 * A **write** is a literal the production source puts on an element —
 * `className="a b"`, `className={cond ? "a" : "b"}`, `className: "a"`,
 * `class="a"`, `classList.add("a")`, `setAttribute("class", "a")`. A spelling in
 * prose is not one, which is what makes the PRODUCT column independent of
 * whether a name happens to appear in a comment.
 *
 * Exit 0 = no finding. Exit 1 = findings. Exit 2 = a stylesheet this cannot read,
 * which is a finding rather than a silent pass. Anything else is fail-open: this
 * is a report, and an instrument that blocks on its own breakage is worse than
 * one that says so.
 *
 * ponytail: whole string literals and one level of brace nesting, not a parse.
 * Upgrade to a parser or to Tailwind's `__unstable__loadDesignSystem` when a
 * false finding or a miss is observed, not before.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const STYLESHEETS = [
  "src/web/packages/editor/src/editor-shell/editor-shell.css",
  "src/web/packages/host/public/yunari-page.css",
];
const SKIP_DIRS = new Set([
  "node_modules", "dist", ".git", ".vite", "coverage", "test-results",
  "playwright-report", ".agent-scratch", ".superpowers", ".codegraph",
  "build", ".cache", ".turbo", ".e2e-host-app",
]);
const WORKSPACE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".html", ".htm", ".css",
  ".md", ".json", ".jsonl", ".svg", ".txt",
]);
const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".html", ".htm"]);
/** A namespace is a leading segment the stylesheets use on more than one class. */
const NAMESPACE_FLOOR = 2;

class StylesheetError extends Error {}

/** Block comments only: a class named in a comment is not a class the product applies. */
function stripBlockComments(text) {
  let out = "";
  let i = 0;
  for (;;) {
    const open = text.indexOf("/*", i);
    if (open < 0) return out + text.slice(i);
    out += text.slice(i, open);
    const close = text.indexOf("*/", open + 2);
    i = close < 0 ? text.length : close + 2;
  }
}

function readStylesheets(root) {
  const files = [];
  for (const rel of STYLESHEETS) {
    const path = join(root, rel);
    let text;
    try {
      text = readFileSync(path, "utf8");
    } catch (error) {
      throw new StylesheetError(`${rel}: ${error.code ?? error.message}`);
    }
    const stripped = stripBlockComments(text);
    files.push({
      rel,
      path: normalize(path),
      classes: new Set([...stripped.matchAll(/[.]([A-Za-z_-][A-Za-z0-9_-]*)/g)].map((m) => m[1])),
      attrs: new Set([...stripped.matchAll(/\[(data-[A-Za-z0-9_-]+)/g)].map((m) => m[1])),
    });
  }
  return files;
}

function workspaceFiles(root) {
  const out = [];
  (function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (WORKSPACE_EXTS.has(extname(entry.name).toLowerCase())) out.push(path);
    }
  })(root);
  return out;
}

const posix = (root, path) => relative(root, path).split(sep).join("/");
const isTest = (rel) =>
  rel.includes("/tests/") ||
  rel.includes(".test.") ||
  rel.includes(".spec.") ||
  rel.includes("test-stage") ||
  rel.toLowerCase().includes("fixture");

/**
 * PRODUCT is a source file the product ships that is not a test, a spec, a test
 * stage or a fixture. `.css` and `.svg` are STYLE — another stylesheet, or an
 * asset, naming a class does not prove the product applies it — and `.html` is
 * PRODUCT, because a host page writing `class="hint"` *is* the product applying
 * it.
 */
function bucket(rel) {
  if (rel.startsWith("docs/") || rel.includes("/docs/")) return "DOC";
  if (isTest(rel)) return "TEST";
  if (rel.startsWith("scripts/")) return "SCRIPT";
  if (rel.endsWith(".css") || rel.endsWith(".svg")) return "STYLE";
  return "PRODUCT";
}

const STRING = String.raw`["'\`]([^"'\`]*)["'\`]`;
const WRITE_PATTERNS = [
  new RegExp(String.raw`className\s*=\s*` + STRING, "g"),
  new RegExp(String.raw`className\s*:\s*` + STRING, "g"),
  new RegExp(String.raw`\bclass\s*=\s*` + STRING, "g"),
  new RegExp(String.raw`setAttribute\s*\(\s*["'\`]class["'\`]\s*,\s*` + STRING, "g"),
];
const CLASS_LIST_CALL = /classList\s*\.\s*(?:add|remove|toggle)\s*\(([^)]*)\)/g;
const STRING_ARG = new RegExp(STRING, "g");
const CLASS_NAME_EXPRESSION = /className\s*=\s*\{/g;

/**
 * The literals inside a `className={…}` expression. JSX `className` is an
 * expression as often as a literal, and the literal is what this can read: a
 * name assembled at run time is invisible here and the report says so.
 */
function expressionLiterals(text, openBrace) {
  const out = [];
  let depth = 1;
  let i = openBrace;
  while (i < text.length && depth > 0) {
    const ch = text[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    else if (ch === '"' || ch === "'" || ch === "`") {
      const end = text.indexOf(ch, i + 1);
      if (end < 0) break;
      out.push(text.slice(i + 1, end));
      i = end;
    }
    i += 1;
  }
  return out;
}

/**
 * class -> Set of the production files that write it, for every whole literal.
 * Only PRODUCT: a test, a script or a drawing writing a class is not the product
 * applying it, and reading them makes this script's own fixtures findings.
 */
function classWrites(root, files) {
  const index = new Map();
  for (const path of files) {
    if (!SOURCE_EXTS.has(extname(path).toLowerCase())) continue;
    const rel = posix(root, path);
    if (bucket(rel) !== "PRODUCT") continue;
    const text = stripBlockComments(readFileSync(path, "utf8"));
    const record = (name) => {
      if (name === "" || /[\s{}<>$()]/.test(name)) return;
      let entry = index.get(name);
      if (entry === undefined) {
        entry = new Set();
        index.set(name, entry);
      }
      entry.add(rel);
    };
    for (const pattern of WRITE_PATTERNS) {
      for (const match of text.matchAll(pattern)) for (const name of match[1].split(/\s+/)) record(name);
    }
    for (const match of text.matchAll(CLASS_LIST_CALL)) {
      for (const arg of match[1].matchAll(STRING_ARG)) record(arg[1]);
    }
    for (const match of text.matchAll(CLASS_NAME_EXPRESSION)) {
      for (const literal of expressionLiterals(text, match.index + match[0].length - 1)) {
        for (const name of literal.split(/\s+/)) record(name);
      }
    }
  }
  return index;
}

/** The leading segments the stylesheets themselves use on more than one class. */
function stylesheetNamespaces(classes) {
  const counts = new Map();
  for (const name of classes) {
    const segments = name.split("-");
    if (segments.length < 2) continue;
    counts.set(segments[0], (counts.get(segments[0]) ?? 0) + 1);
  }
  return [...counts]
    .filter(([, count]) => count >= NAMESPACE_FLOOR)
    .map(([segment]) => `${segment}-`);
}

function forward(root, sheets, files, writes) {
  const items = [];
  for (const sheet of sheets) {
    for (const name of sheet.classes) items.push({ name, kind: "class", sheet });
    for (const name of sheet.attrs) items.push({ name, kind: "attr", sheet });
  }
  const bodies = files.map((path) => [path, readFileSync(path, "utf8")]);
  const findings = [];
  for (const item of items) {
    const pattern = new RegExp(`${item.name}(?![A-Za-z0-9_-])`);
    const where = { PRODUCT: 0, TEST: 0, SCRIPT: 0, DOC: 0, STYLE: 0 };
    for (const [path, text] of bodies) {
      if (normalize(path) === item.sheet.path) continue;
      if (pattern.test(text)) where[bucket(posix(root, path))] += 1;
    }
    // A class is applied when the product writes it; a spelling in a comment is
    // not an application. The attribute half keeps the spelling reading: an
    // attribute is written through `dataset`'s camelCase form as often as through
    // its kebab spelling, so a write reading needs its own design.
    const applied = item.kind === "class" ? writes.has(item.name) : where.PRODUCT > 0;
    if (!applied) findings.push({ ...item, where });
  }
  return { items, findings };
}

function reverse(sheets, writes) {
  const defined = new Set();
  for (const sheet of sheets) for (const name of sheet.classes) defined.add(name);
  const namespaces = stylesheetNamespaces(defined);
  const findings = [];
  let outside = 0;
  for (const [name, entry] of writes) {
    if (defined.has(name)) continue;
    if (!namespaces.some((prefix) => name.startsWith(prefix))) {
      outside += 1;
      continue;
    }
    findings.push({ name, entry });
  }
  findings.sort((a, b) => (a.name < b.name ? -1 : 1));
  return { writes, defined, namespaces, findings, outside };
}

const counts = (where) =>
  `test=${where.TEST ?? 0} script=${where.SCRIPT ?? 0} doc=${where.DOC ?? 0} style=${where.STYLE ?? 0}`;

function report(root, sheets, files) {
  const writes = classWrites(root, files);
  const fwd = forward(root, sheets, files, writes);
  const rev = reverse(sheets, writes);
  const shape = sheets
    .map((sheet) => `${sheet.rel.split("/").pop()} classes=${sheet.classes.size} dataAttrs=${sheet.attrs.size}`)
    .join("  ");
  console.log(`dead-selectors: ${shape}  tokens=${fwd.items.length}`);

  console.log("\nFORWARD — a selector in either stylesheet that no production source applies");
  for (const finding of fwd.findings) {
    console.log(`  ${finding.name}  (${finding.kind}, ${finding.sheet.rel.split("/").pop()})  ${counts(finding.where)}`);
  }
  console.log(`  forward: ${fwd.findings.length} of ${fwd.items.length} token(s) unapplied`);

  console.log("\nREVERSE — a class production source writes that neither stylesheet defines");
  for (const { name, entry } of rev.findings) {
    console.log(`  ${name}  ${[...entry].slice(0, 3).join(" ")}`);
  }
  console.log(
    `  reverse: ${rev.writes.size} class(es) written by production source, ${rev.defined.size} defined by the two stylesheets, ` +
      `${rev.writes.size - rev.defined.size} not — ${rev.findings.length} in a stylesheet namespace (named above), ` +
      `${rev.outside} outside every namespace (${rev.namespaces.join(" ")}), which is Tailwind's vocabulary or a third party's`,
  );
  console.log(
    `\ndead-selectors: ${fwd.findings.length + rev.findings.length} finding(s)`,
  );
  return fwd.findings.length + rev.findings.length;
}

function main(argv) {
  const at = argv.indexOf("--root");
  const root = resolve(at === -1 ? ROOT : argv[at + 1]);
  let sheets;
  try {
    sheets = readStylesheets(root);
  } catch (error) {
    if (!(error instanceof StylesheetError)) throw error;
    console.error(`dead-selectors: STYLESHEET — ${error.message}`);
    process.exit(2);
  }
  const findings = report(root, sheets, workspaceFiles(root));
  process.exit(findings > 0 ? 1 : 0);
}

// --- self-test: a synthetic tree, so no case pins a live file ---------------

const SHEET = {
  "src/web/packages/editor/src/editor-shell/editor-shell.css":
    ".yunari-field { color: red }\n.yunari-layer { color: blue }\n.theme-list { color: green }\n.theme-row { color: black }\n",
  "src/web/packages/host/public/yunari-page.css": ".hint { color: grey }\n",
};

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "yunari-dead-selectors-"));
  for (const [rel, text] of Object.entries({ ...SHEET, ...files })) {
    if (text === null) continue;
    const path = join(dir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return dir;
}

function run(root) {
  try {
    const stdout = execFileSync(
      process.execPath,
      [fileURLToPath(import.meta.url), "--root", root],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { code: 0, out: stdout };
  } catch (error) {
    return { code: error.status ?? 1, out: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

function selfTest() {
  const editor = "src/web/packages/editor/src/panes";
  const cases = [
    [
      "reports a class production writes that no stylesheet defines",
      { [`${editor}/pane.tsx`]: 'const el = <p className="yunari-field-hint" />;\n' },
      1,
      "yunari-field-hint",
    ],
    [
      "counts a spelling in a comment as no application, and a write as one",
      {
        "src/web/packages/editor/src/editor-shell/editor-shell.css":
          ".yunari-field { color: red }\n.yunari-layer { color: blue }\n",
        "src/web/packages/host/public/yunari-page.css": "",
        [`${editor}/pane.tsx`]:
          '// the .yunari-layer rule is dead\nconst el = <p className="yunari-field" />;\n',
      },
      1,
      "forward: 1 of 2",
    ],
    [
      "reads a classList write",
      { [`${editor}/pane.ts`]: 'el.classList.add("yunari-gone");\n' },
      1,
      "yunari-gone",
    ],
    [
      "reads the literals inside a conditional className expression",
      { [`${editor}/pane.tsx`]: 'const el = <p className={a ? "yunari-one" : "yunari-two"} />;\n' },
      1,
      "yunari-two",
    ],
    [
      "counts a host page's own class write as the product applying it",
      {
        "src/web/packages/editor/src/editor-shell/editor-shell.css": ".theme-list { color: green }\n",
        "src/web/packages/host/public/yunari-page.css": "",
        "src/web/packages/host/public/settings.html":
          '<html><body><ul class="theme-list"></ul></body></html>\n',
      },
      0,
      "forward: 0 of",
    ],
    [
      "reports a data-* attribute nothing spells",
      {
        "src/web/packages/editor/src/editor-shell/editor-shell.css":
          ".yunari-field { color: red }\n.yunari-layer { color: blue }\n[data-yunari-gone] { color: pink }\n",
        "src/web/packages/host/public/yunari-page.css": "",
      },
      1,
      "data-yunari-gone",
    ],
    [
      "refuses a stylesheet it cannot read",
      { "src/web/packages/host/public/yunari-page.css": null },
      2,
      "STYLESHEET",
    ],
  ];
  let failed = 0;
  for (const [name, files, expected, needle] of cases) {
    const dir = fixture(files);
    try {
      const { code, out } = run(dir);
      const ok = code === expected && out.includes(needle);
      if (!ok) failed += 1;
      console.log(
        `${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` (expected exit ${expected} and "${needle}", got exit ${code}: ${out.trim().split("\n").at(-1)})`}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  if (failed > 0) {
    console.error(`dead-selectors self-test: ${failed} case(s) wrong`);
    process.exit(1);
  }
  console.log(`dead-selectors self-test: all ${cases.length} cases behave`);
  process.exit(0);
}

try {
  if (process.argv.includes("--self-test")) selfTest();
  else main(process.argv.slice(2));
} catch (error) {
  console.error(`dead-selectors: not run — ${error.message}`);
  process.exit(0);
}
