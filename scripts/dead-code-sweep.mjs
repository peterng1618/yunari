#!/usr/bin/env node
/**
 * Dead-code sweep: build the importer graph, and report what nothing reaches.
 *
 * Four rounds of refactoring across the editor, player and host leave surfaces
 * that no product code mounts but that stay green because their own test file
 * imports them. That class is invisible to both obvious questions — it is not
 * "no importer" (a test imports it) and not "no file" (the file is right there)
 * — and it is the class this repo actually produces: `font-picker.tsx` was kept
 * alive by a 984-line test and no mount for long enough to be filed twice as
 * `vg-268` and `vg-283`, until Phase 19's Task 19.1 mounted it and both closed.
 * `ui-copy-readers.ts` is the same class today, and permanently so — a test
 * reader is supposed to have no production importer.
 *
 * What this is NOT: a verdict. Every hit is a candidate, printed with the search
 * that found it, and a human or an agent has to say whether the code is dead.
 * The false-positive engine in this repo is *string-resolved vocabulary* —
 * `data-yunari-*` attributes, `--yunari-*`/`--shell-*` custom properties,
 * `KIND_*` registries, Fabric JSON keys and classes composed by template
 * literal — all of which are live with no importer anywhere. None of it is
 * visible to this graph, and a literal search that comes back empty is not
 * proof of death. The same goes for a file's *content*: `design-md.mjs`,
 * `design-tokens.mjs` and `dead-selectors.mjs` read the source tree as data, so
 * a constant nothing imports can still redden a gate.
 *
 * Six candidate kinds, and each one records the search that found it:
 *
 *   - `test-only-consumer` — a module every importer of which is a test file.
 *   - `no-importer-file`   — a module nothing imports, once entry points and
 *                            the files vitest/Playwright discover by glob are
 *                            set aside. Miss the glob and this reports the
 *                            entire 244-file suite as dead.
 *   - `dead-export`        — a top-level export no production file imports *and*
 *                            which its own module never uses either. The symbol
 *                            is dead. A test import is not a consumer.
 *   - `redundant-export`   — the same, except its own declaring file does use it.
 *                            **The symbol is live and only the `export` keyword
 *                            is unnecessary** — which is the opposite remedy to
 *                            the kind above, and the reason they are two kinds
 *                            rather than one. Reporting them together as "unused
 *                            exports" invites a phase that deletes a symbol that
 *                            is in use, or claims a reduction that never lands.
 *   - `barrel-only-export` — an export whose only *production* importer is its
 *                            own package's `index.ts`, and which no production
 *                            file then takes from it. A test importer is
 *                            disclosed in the row and does not hide the export.
 *   - `unreachable-branch` — a member of a closed string-literal union whose
 *                            literal appears nowhere else in production code.
 *                            Literal-text only: a discriminant composed at
 *                            runtime is invisible here, which is the known
 *                            false positive of this kind.
 *
 * Usage:  node scripts/dead-code-sweep.mjs [--json <path>] [--root <dir>] [--self-test]
 *
 *   --json <path>  the CANDIDATE report, written in every mode, `--self-test`
 *                  included. The self-test result never goes to this path: its
 *                  own destination is fixed at
 *                  `src/web/test-results/dead-code-sweep-self-test.json`, so a
 *                  run that asks for both cannot silently overwrite the counts
 *                  a later phase is budgeting against.
 *   --root <dir>   scan this directory instead of the repository this script
 *                  lives in. The self-test's fixture run is the only caller: it
 *                  writes a small tree to a temp directory and runs this script
 *                  again against it, so the kind-fires checks name a file the
 *                  test owns rather than one the product may legitimately change.
 *   --self-test    run the checks below and exit non-zero on any failure. Both
 *                  this file and the `--json` one are overwritten with an
 *                  incomplete marker before the run starts (see below), and the
 *                  self-test's own file is written twice at the end — an
 *                  in-progress document, then the result — so moving any of
 *                  those writes is a change to the crash story, not a tidy-up.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const jsonAt = argv.indexOf("--json");
const jsonPath = jsonAt === -1 ? null : argv[jsonAt + 1];
const rootAt = argv.indexOf("--root");
const SELF_TEST = argv.includes("--self-test");

/**
 * The tree to scan. `--root` exists for the self-test's fixture run and is the
 * whole of its fixture mechanism: the checks that a kind fires
 * are asserted against a tree the test owns, and that tree is analysed by *this
 * program run again* rather than by a second classifier that could drift from it.
 */
if (rootAt !== -1 && argv[rootAt + 1] === undefined) {
  process.stderr.write("--root needs a directory\n");
  process.exit(2);
}
const ROOT = rootAt === -1 ? resolve(fileURLToPath(new URL("..", import.meta.url))) : resolve(argv[rootAt + 1]);
const WEB = join(ROOT, "src/web");

// ---------------------------------------------------------------------------
// A crash must not read as a pass
// ---------------------------------------------------------------------------

/**
 * Both reports are written once, at the end of the run, so a crash anywhere
 * before that leaves the *previous* run's file in place: the process exits
 * non-zero while the artefact still reads green. A TypeError thrown during
 * classification produced exactly that — exit 1, and `20/20, failed: []` on
 * disk from a run that never finished.
 *
 * That is not tidiness. Phases of this plan are told to read the report rather
 * than the exit code, so a stale green is an instruction to trust the wrong
 * thing. Each destination is therefore overwritten with an explicit "did not
 * finish" marker the moment the run starts, and only completion replaces it. A
 * reader sees this run's result or an explicit incomplete state — never a
 * previous run's pass wearing this run's clothes.
 *
 * The marker does the work, not the clock: no timestamp or run id, which would
 * invite comparing two runs instead of asking whether this one finished.
 *
 * The self-test needs a second write as well as the start-up marker, because it
 * collects its checks in one array and reads them back off disk: between its
 * first write and its last, a file that already read `incomplete: false` would
 * be a pass sitting beside a non-zero exit — the same shape the marker exists to
 * remove, one write later. So the first write carries `incomplete: true` in an
 * explicit in-progress document, and only the completion write carries `false`.
 * Collapsing the two into one end-of-run write is the obvious wrong fix: the
 * guardian below proves the incomplete document really landed by reading it off
 * disk, and the `--json` intactness check must run after the self-test has
 * written — one write leaves both reading the previous run's artifact.
 */
const SELFTEST_JSON = join(WEB, "test-results", "dead-code-sweep-self-test.json");

/**
 * The start-of-run marker, written before any check runs.
 *
 * Failure-shaped on purpose, not merely `incomplete: true`: `failed` is
 * non-empty and `checks` is not an empty array, so the plausible reader
 * predicates that are *not* `isCompletePass` — `doc.failed.length === 0` and
 * `doc.checks.length === 0` — cannot read a crash as success either. `total: 0`
 * is what blocks the `passed === total` vacuous pass.
 */
const incompleteSelfTestResult = () => ({
  incomplete: true,
  selfTest: true,
  stage: "start-up",
  passed: 0,
  total: 0,
  failed: ["this run did not finish — the process ended before the checks completed"],
  checks: [{ name: "the checks never ran: this document is the start-of-run marker, not a result", ok: false }],
  note: "This run did not finish — the process ended before the checks completed, so this file holds no result for it. It is not a pass.",
});

/**
 * The one predicate a reader should apply to the self-test file. The marker
 * fails it by construction — `total > 0` is why a `0/0` marker cannot be read as
 * a vacuous pass, and the self-test asserts both halves so the predicate cannot
 * be loosened without failing the gate.
 */
const isCompletePass = (doc) => doc.incomplete === false && doc.total > 0 && doc.passed === doc.total;

/**
 * The candidate report's start-of-run marker — failure-shaped, the way the
 * self-test's marker is, and against the same argument: a reader asking "is this
 * a clean sweep?" does not necessarily ask it with `isCompletePass`.
 *
 * `!doc.candidates` is one phrasing, and for four rounds it was the only one
 * this document had to defeat — a marker with no `candidates` key *passes* it.
 * Every plausible phrasing must answer no instead:
 *
 *   !doc.candidates            -> candidates is a truthy object
 *   doc.candidates.length === 0 -> it has no `length` to be zero
 *   Array.isArray(candidates)   -> it is not an array
 *   doc.incomplete === false    -> incomplete is true
 *   doc.failed.length === 0     -> failed names the reason
 *   doc.passed === doc.total    -> 0 of 1, never equal (undefined === undefined
 *                                  is the trap here: a marker with neither field
 *                                  satisfies the comparison)
 *
 * `candidates: []` is the trap the object avoids: an empty list moves the false
 * pass from `!doc.candidates` to `candidates.length === 0` rather than removing
 * it. `total: 1` with one failing row is the self-test marker's shape, so the two
 * documents stay one convention rather than two.
 */
const incompleteCandidateReport = () => ({
  incomplete: true,
  stage: "start-up",
  passed: 0,
  total: 1,
  failed: ["this run did not finish — the scan did not complete, so there is no candidate list for it"],
  checks: [{ name: "the scan did not complete: this document is the start-of-run marker, not a result", ok: false }],
  candidates: { note: "no candidate list — this run did not finish; this is not a clean sweep and not a previous run's list" },
  note: "This run did not finish — the scan did not complete, so there is no candidate list for it. This is not a clean sweep and not a previous run's list.",
});

/**
 * Every phrasing of "this is a clean sweep" a reader might apply to the
 * candidate report. The marker has to make all of them false; asserting the
 * first alone is how the marker read as success for four rounds. Kept as a
 * helper so the self-test asserts the list rather than a hand-picked clause.
 */
const cleanSweepReadings = (doc) => [
  !doc.candidates,
  doc.candidates?.length === 0,
  Array.isArray(doc.candidates),
  doc.incomplete === false,
  doc.failed?.length === 0,
  doc.passed === doc.total,
];

/**
 * Write a document so that no reader can observe *half* of one.
 *
 * `writeFileSync` in place truncates first, so an interrupted write — the
 * completion write replacing the candidate marker, most of all — leaves a
 * partial file, and a partial file parses as nothing, which is the same false
 * pass the marker exists to remove. A sibling temporary renamed over the
 * destination cannot do that: an interrupted completion write leaves the marker
 * in place. Measured here, not assumed, with a reader polling a 50 KB document
 * through 400 replacements (40,701 reads): the rename exposed **0** partial and
 * 0 empty documents, where the in-place write exposed 100 of its 949 reads.
 *
 * The measurement also refuses the POSIX claim. This is not an atomic replace:
 * 290 of those 40,701 reads found the destination briefly absent (a control run
 * with the destination untouched saw none), so a reader can still hit "no file"
 * and has to treat that as no result rather than as a clean sweep. The window is
 * a missing name, never a half-written document — which is the improvement, and
 * the reason the *marker*, not the write, stays what a reader keys on.
 *
 * The fallback is the plain in-place write this function used before the rename.
 * `renameSync` fails `EPERM` while another handle is open on the destination
 * (no delete-sharing on Windows), and a sustained reader blocks it indefinitely
 * — 444 of 500 renames gave up after ten immediate retries, so a retry loop is
 * not a fix. Falling back keeps a scan that produced a valid document from
 * dying; the failure-shaped markers above are what keep the degraded case
 * readable.
 */
const writeJson = (path, doc) => {
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  const body = `${JSON.stringify(doc, null, 2)}\n`;
  const temp = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, body, "utf8");
    renameSync(temp, target);
  } catch {
    rmSync(temp, { force: true });
    writeFileSync(target, body, "utf8");
  }
};

/** The document at a path, or null when it is missing or is not JSON. */
const readJsonDoc = (path) => {
  try {
    return JSON.parse(readFileSync(resolve(path), "utf8"));
  } catch {
    return null;
  }
};

/**
 * The self-test's in-progress document: written once its checks are collected
 * but before the run is finished, so a crash before the completion write leaves
 * this on disk instead of a pass. See `SELFTEST_JSON` above for why two writes
 * are required rather than one.
 *
 * Distinct from the start-up marker by `stage`, so the guardian can tell "in
 * progress" from "never started" — otherwise a silent in-progress write would
 * leave the marker behind and the guardian would pass vacuously.
 *
 * Failure-shaped the same way the marker is: `failed` names the reason, `checks`
 * is not an empty array, and `total: 0` blocks the `passed === total` vacuous
 * pass. The collected checks are deliberately *not* carried here — a list of
 * `ok: true` rows reads as a pass to a reader counting `failed`, which is the
 * shape problem the marker was fixed for.
 */
const inProgressSelfTestResult = (collected) => ({
  incomplete: true,
  selfTest: true,
  stage: "in-progress",
  passed: 0,
  total: 0,
  failed: [
    `this run has not finished — ${collected} of its checks are collected and the completion write has not run, so this document is a snapshot and not a result`,
  ],
  checks: [{ name: "the checks are collected but not yet a result", ok: false }],
  note: "Written before the run finishes. The completion write replaces it; if this is still on disk, the process ended early and there is no result here.",
});

if (SELF_TEST) writeJson(SELFTEST_JSON, incompleteSelfTestResult());
if (jsonPath !== null && jsonPath !== undefined) writeJson(jsonPath, incompleteCandidateReport());

/** Windows `relative()` yields backslashes; every path here is posix. */
const posix = (p) => p.replaceAll("\\", "/");
const key = (full) => posix(relative(ROOT, full));

// ---------------------------------------------------------------------------
// Walk
// ---------------------------------------------------------------------------

const SCANNED_EXT = /\.(ts|tsx|mjs)$/;

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SCANNED_EXT.test(entry)) out.push(key(full));
  }
  return out;
}

function sourceFiles() {
  const files = [];
  const packages = join(WEB, "packages");
  let names = [];
  try {
    names = readdirSync(packages);
  } catch {
    names = [];
  }
  for (const name of names) {
    const src = join(packages, name, "src");
    try {
      if (statSync(src).isDirectory()) walk(src, files);
    } catch {
      // A package without `src` contributes nothing.
    }
  }
  walk(join(WEB, "tests"), files);
  walk(join(WEB, "scripts"), files);
  walk(join(ROOT, "scripts"), files);
  return [...new Set(files)].sort();
}

// ---------------------------------------------------------------------------
// Classify: which files are tests, which are entry points
// ---------------------------------------------------------------------------

/**
 * Every test file is an entry point. Vitest globs `*.test.ts(x)` under each
 * package's `src` and under `tests/e2e` and `tests/scripts`; Playwright globs
 * `*.spec.ts` under `tests/e2e`. Nothing imports a test, so a scanner that
 * misses this edge reports the whole suite as dead.
 */
const isTestFile = (file) =>
  /\.(test|spec)\.tsx?$/.test(file) || file.startsWith("src/web/tests/");

/**
 * Entry points are reached without an import: a package manifest's `main` /
 * `types` / `exports`, an `index.html` `src=`, a config, or a runner's own
 * file. They are excluded as *candidates*; their imports still count, so a
 * module only the boot path reaches is still live.
 *
 * `exports: { ".": "./src/index.ts" }` is why every package barrel is an entry
 * point and not "a module nothing imports".
 */
function entryPoints(files) {
  const points = new Set([
    "src/web/packages/player/src/main.ts",
    "src/web/packages/host/src/main.ts",
    "src/web/packages/host/bin/yunari.js",
  ]);
  const packagesDir = join(WEB, "packages");
  let names = [];
  try {
    names = readdirSync(packagesDir);
  } catch {
    names = [];
  }
  for (const name of names) {
    const pkgDir = join(packagesDir, name);
    try {
      const manifest = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
      for (const field of [manifest.main, manifest.module, manifest.types]) {
        const path = typeof field === "string" ? `src/web/packages/${name}/${field.replace(/^\.\//, "")}` : null;
        if (path !== null && files.has(path)) points.add(path);
      }
      for (const target of Object.values(manifest.exports ?? {})) {
        const path = typeof target === "string" ? `src/web/packages/${name}/${target.replace(/^\.\//, "")}` : null;
        if (path !== null && files.has(path)) points.add(path);
      }
    } catch {
      // No manifest, or unreadable: the conventions below still apply.
    }
    for (const entry of readdirSync(pkgDir)) {
      if (!entry.endsWith(".html")) continue;
      const html = readFileSync(join(pkgDir, entry), "utf8");
      for (const m of html.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/g)) {
        const path = `src/web/packages/${name}${m[1].startsWith("/") ? m[1] : `/${m[1]}`}`;
        if (files.has(path)) points.add(path);
      }
    }
  }
  return points;
}

const isScriptOrConfig = (file) =>
  /^src\/web\/packages\/[^/]+\/(vite|playwright|vitest)\.config[^/]*\.ts$/.test(file) ||
  /^src\/web\/(vite|playwright|vitest)\.config[^/]*\.ts$/.test(file) ||
  /^scripts\/[^/]+\.mjs$/.test(file) ||
  /^src\/web\/scripts\/[^/]+\.mjs$/.test(file) ||
  /^src\/web\/packages\/[^/]+\/scripts\/[^/]+\.mjs$/.test(file);

/**
 * An ambient declaration file is reached by the compiler's `include`, not by an
 * import, so "nothing imports it" is its normal state rather than a finding.
 */
const isAmbientTypes = (file) => file.endsWith(".d.ts");

// ---------------------------------------------------------------------------
// Parse: specifiers, imported names, exported names
// ---------------------------------------------------------------------------

const NAMES = /^[A-Za-z_$][\w$]*$/;

/** `import { a as b, type C } from "x"` imports `a` and `C`, not `b`. */
function namesFromList(list) {
  return list
    .split(",")
    .map((cell) => cell.trim().replace(/^type\s+/, ""))
    .map((cell) => cell.split(/\s+as\s+/)[0].trim())
    .filter((name) => NAMES.test(name));
}

const IMPORT_BRACED = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
const IMPORT_NS = /import\s+\*\s+as\s+[\w$]+\s*from\s*["']([^"']+)["']/g;
const IMPORT_DEFAULT =
  /import\s+(?:type\s+)?([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\}\s*)?from\s*["']([^"']+)["']/g;
const IMPORT_SIDE_EFFECT = /import\s*["']([^"']+)["']/g;
const IMPORT_DYNAMIC = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
const VI_MOCK = /\bvi\.(?:do)?mock\s*\(\s*["']([^"']+)["']/g;
const EXPORT_FROM = /export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
const EXPORT_STAR = /export\s+\*\s*(?:as\s+[\w$]+\s*)?from\s*["']([^"']+)["']/g;

const EXPORT_FN = /^export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm;
const EXPORT_CLASS = /^export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_VAR = /^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_TYPE = /^export\s+(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_DEFAULT = /^export\s+default\b/gm;
const EXPORT_LIST = /^export\s*\{([^}]*)\}(\s*from\s*["'][^"']*["'])?/gm;

/**
 * Specifiers a file reads, with the names taken from each (null = whole module).
 *
 * `reExport` separates `export { x } from "./y"` from a plain `import`: only the
 * first forwards `y`'s name to this file's own consumers, and treating an import
 * as a forward makes a consumer's consumer look like a consumer of the name.
 */
function readSpecifiers(source) {
  const edges = [];
  const push = (spec, names, reExport = false) => edges.push({ spec, names, reExport });

  for (const m of source.matchAll(IMPORT_BRACED)) push(m[2], namesFromList(m[1]));
  for (const m of source.matchAll(IMPORT_NS)) push(m[1], null);
  for (const m of source.matchAll(IMPORT_DEFAULT)) push(m[2], ["default"]);
  for (const m of source.matchAll(IMPORT_SIDE_EFFECT)) push(m[1], null);
  for (const m of source.matchAll(IMPORT_DYNAMIC)) push(m[1], null);
  for (const m of source.matchAll(VI_MOCK)) push(m[1], null);
  for (const m of source.matchAll(EXPORT_FROM)) push(m[2], namesFromList(m[1]), true);
  for (const m of source.matchAll(EXPORT_STAR)) push(m[1], null, true);
  return edges;
}

/** Top-level exported names declared by a file itself. */
function declaredExports(source) {
  const found = new Set();
  for (const re of [EXPORT_FN, EXPORT_CLASS, EXPORT_VAR, EXPORT_TYPE]) {
    for (const m of source.matchAll(re)) found.add(m[1]);
  }
  for (const m of source.matchAll(EXPORT_DEFAULT)) found.add("default");
  for (const m of source.matchAll(EXPORT_LIST)) {
    if (m[2] !== undefined) continue; // `export { x } from "./y"` re-exports y's name
    for (const cell of m[1].split(",")) {
      const name = cell.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim();
      if (name !== undefined && NAMES.test(name)) found.add(name);
    }
  }
  return [...found].sort();
}

// ---------------------------------------------------------------------------
// Resolve specifiers to scanned files
// ---------------------------------------------------------------------------

const EXTS = ["", ".ts", ".tsx", ".mjs", "/index.ts", "/index.tsx"];

function resolveSpecifier(from, spec, files) {
  let base;
  if (spec.startsWith(".")) {
    base = posix(join(dirname(from), spec));
  } else {
    const yunari = /^@yunari\/([^/]+)(\/.*)?$/.exec(spec);
    if (yunari !== null) {
      base = `src/web/packages/${yunari[1]}/src${yunari[2] ?? ""}`;
    } else if (spec.startsWith("@/")) {
      base = `src/web/packages/editor/src/${spec.slice(2)}`;
    } else {
      return null; // a bare specifier: react, node:fs, vitest, systeminformation
    }
  }
  for (const ext of EXTS) if (files.has(base + ext)) return base + ext;
  if (/\.js$/.test(base)) {
    const stem = base.replace(/\.js$/, "");
    for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
      if (files.has(stem + ext)) return stem + ext;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The graph
// ---------------------------------------------------------------------------

const all = sourceFiles();
const files = new Set(all);
const ENTRY = entryPoints(files);
const isEntryPoint = (file) => ENTRY.has(file) || isScriptOrConfig(file);

/**
 * A commented-out import is not an import, and a doc example must not become an
 * edge — this repository documents modules inside comments, and a phantom
 * importer *hides* a real candidate. A double slash counts as a comment only
 * when whitespace precedes it, which spares `https://` and a path in a string.
 */
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

const source = new Map(
  all.map((file) => [file, stripComments(readFileSync(join(ROOT, file), "utf8"))]),
);

/**
 * A second view of each file, with quoted strings blanked, used only to decide
 * whether a module *uses* one of its own exports. A name inside a string is
 * vocabulary, not a call — `data-yunari-*` and the `KIND_*` registries are
 * exactly the trap this repository sets — so it must not count as a use.
 *
 * Not handled: backticks and regex literals — a symbol named only as static text
 * inside a template literal still counts as a use, which would tier a dead export
 * `redundant-export`, and a latent wrong tier is invisible in the report. No row
 * is affected today; the only backtick hits are real `${…}` interpolations.
 */
const stripStrings = (text) =>
  text.replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/'(?:[^'\\\n]|\\.)*'/g, "''");

const selfUse = new Map(all.map((file) => [file, stripStrings(source.get(file))]));
const escapeRe = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const usesIn = (text, name) =>
  (text.match(new RegExp(`\\b${escapeRe(name)}\\b`, "g")) ?? []).length;

/**
 * A declaration is not a use (`vg-382`). These are the shapes
 * that NAME a symbol without reaching it: its own declaration site, a specifier
 * in an import or an export list — `declaredExports` reads `export { x }` as a
 * declared export, so counting that line made a re-export evidence that the name
 * it forwards is live — and an object key, which names a property of the object
 * rather than the binding.
 *
 * Every rule here is one that cannot match a read, and that is the test rather
 * than a judgement about likelihood: the two tiers take opposite remedies, so an
 * exclusion that fires on a read moves a live symbol onto the removal list. The
 * key rule's `:` is the whole guard — without it, `case name:` and
 * `cond ? name : x` would be swallowed. A member access (`obj.name`) reaches a
 * property rather than the binding and is deliberately NOT excluded, because the
 * ruling names two shapes and a third exclusion is a decision it did not make.
 */
const DECLARATION_SITE =
  /(?:^|[\s;({,])(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum|namespace)\s*\*?\s*$/;

/** True when the occurrence of a name at this position declares rather than reads it. */
function declares(before, after) {
  if (DECLARATION_SITE.test(before)) return true;
  if (/^\s*:/.test(after)) {
    const line = before.slice(before.lastIndexOf("\n") + 1);
    if (/^\s*$/.test(line) || /[{,]\s*$/.test(before)) return true;
  }
  const open = before.lastIndexOf("{");
  if (
    open > before.lastIndexOf("}") &&
    /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?$/.test(before.slice(0, open))
  ) {
    return true;
  }
  if (/(?:^|[\s;])import\s+\*\s+as\s*$/.test(before)) return true;
  return (
    /(?:^|[\s;])import\s+(?:type\s+)?$/.test(before) &&
    /^\s*(?:,\s*\{[^}]*\})?\s*from\s*["']/.test(after)
  );
}

/**
 * Occurrences of `name` in its own file that read it rather than declare it. This
 * is the tier's liveness test AND the number its evidence sentence reports, so
 * the number means what the sentence says: `instantiateCard` is declared once and
 * called once, and a row reporting 2 sends a Phase 2 reader hunting a second call
 * site that does not exist.
 */
function readsOutsideDeclaration(text, name) {
  let reads = 0;
  for (const m of text.matchAll(new RegExp(`\\b${escapeRe(name)}\\b`, "g"))) {
    if (!declares(text.slice(0, m.index), text.slice(m.index + name.length))) reads += 1;
  }
  return reads;
}

/** consumedBy[target] = [{ from, names }] where names === null is the whole module. */
const consumedBy = new Map(all.map((file) => [file, []]));
/** reExports[barrel] = [{ target, names }] — how a barrel forwards another file's names. */
const reExports = new Map();
const unresolved = [];

for (const file of all) {
  for (const edge of readSpecifiers(source.get(file))) {
    const target = resolveSpecifier(file, edge.spec, files);
    if (target === null) {
      // Only a relative or aliased specifier was supposed to land on a file.
      if (edge.spec.startsWith(".") || edge.spec.startsWith("@/")) {
        unresolved.push({ from: file, spec: edge.spec });
      }
      continue;
    }
    consumedBy.get(target).push({ from: file, names: edge.names });
    if (edge.reExport) {
      if (!reExports.has(file)) reExports.set(file, []);
      reExports.get(file).push({ target, names: edge.names });
    }
  }
}

/** Barrels a file's names can be reached through, transitively. */
function barrelRoutes(target) {
  const routes = new Map(); // barrel -> Set<name> | null (whole module)
  const seen = new Set();
  const queue = [target];
  while (queue.length > 0) {
    const current = queue.pop();
    for (const [from, edges] of reExports) {
      if (from === target || seen.has(from)) continue;
      for (const edge of edges) {
        if (edge.target !== current) continue;
        const forwarded = edge.names === null ? null : edge.names;
        if (forwarded === null) routes.set(from, null);
        else routes.set(from, new Set([...(routes.get(from) ?? []), ...forwarded]));
        seen.add(from);
        queue.push(from);
      }
    }
  }
  return routes;
}

const packageOf = (file) => /^src\/web\/packages\/([^/]+)\//.exec(file)?.[1] ?? null;
const ownBarrel = (file) => {
  const pkg = packageOf(file);
  return pkg === null ? null : `src/web/packages/${pkg}/src/index.ts`;
};

// ---------------------------------------------------------------------------
// Closed string-literal unions — the `unreachable-branch` kind
// ---------------------------------------------------------------------------

const LITERAL = /"[^"\n]{0,60}"/g;
/** Literals joined by `|`, at the head of a run: the body of a union. */
const RUN_BODY = /^\s*\|?\s*"[^"\n]{0,60}"(?:\s*\|\s*"[^"\n]{0,60}")*/;

/**
 * Only a *declaration* is a closed union, and only two shapes are mechanical:
 * a `type X = …` alias and a `name: …` property annotation. A `Pick<T, "a" | "b">`
 * argument list, a ternary, or any other run of quoted literals is a selection
 * the graph cannot judge — those are the false positives that made an earlier
 * draft of this kind report 45 hits, and they are filtered out here rather than
 * left for a human to wade through.
 */
const TYPE_ALIAS = /(?:^|\n)[ \t]*(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/g;
const PROPERTY_UNION =
  /(?:^|\n)[ \t]*(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*:\s*"[^"\n]{0,60}"(?:\s*\|\s*"[^"\n]{0,60}")+/g;

/** Every declaration-shaped run of quoted literals in a file. */
function unionRunsIn(text) {
  const runs = [];
  for (const m of text.matchAll(TYPE_ALIAS)) {
    const run = RUN_BODY.exec(text.slice(m.index + m[0].length));
    if (run !== null) runs.push([...run[0].matchAll(LITERAL)].map((x) => x[0]));
  }
  for (const m of text.matchAll(PROPERTY_UNION)) {
    runs.push([...m[0].matchAll(LITERAL)].map((x) => x[0]));
  }
  return runs.filter((members) => members.length >= 2);
}

const unions = [];
const unionLiterals = new Map(); // literal -> occurrences inside a union
const literalCounts = new Map(); // literal -> occurrences anywhere in the scanned tree

for (const file of all) {
  const text = source.get(file);
  for (const m of text.matchAll(LITERAL)) {
    literalCounts.set(m[0], (literalCounts.get(m[0]) ?? 0) + 1);
  }
  for (const members of unionRunsIn(text)) {
    unions.push({ file, members });
    for (const member of members) {
      unionLiterals.set(member, (unionLiterals.get(member) ?? 0) + 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Classify
// ---------------------------------------------------------------------------

const IMPORTERS = "importer graph over every .ts/.tsx/.mjs under src/web/packages/*/src, src/web/tests, src/web/scripts and scripts/ (dist/ and node_modules/ excluded), resolving relative, @yunari/* and @/* specifiers";

const candidates = [];
const list = (paths) => (paths.length === 0 ? "none" : paths.join(", "));

function productionImporters(file) {
  return consumedBy.get(file).filter((edge) => !isTestFile(edge.from));
}

function testImporters(file) {
  return consumedBy.get(file).filter((edge) => isTestFile(edge.from)).map((e) => e.from);
}

for (const file of all) {
  if (isEntryPoint(file)) continue;
  if (isAmbientTypes(file)) continue; // reached by tsconfig `include`, not an import
  if (isTestFile(file)) continue; // discovered by a glob, not by an import

  const edges = consumedBy.get(file);
  const prod = productionImporters(file);
  const tests = testImporters(file);

  if (edges.length === 0) {
    candidates.push({
      kind: "no-importer-file",
      file,
      evidence: `0 importers. Search: ${IMPORTERS}; this file is not an entry point (index.html src, build target, config, script) and no vitest/Playwright glob names it. A module kept live only by string-resolved vocabulary is invisible here.`,
    });
    continue;
  }

  if (prod.length === 0) {
    candidates.push({
      kind: "test-only-consumer",
      file,
      evidence: `every importer is a test file (${edges.length}): ${list(tests)}. Search: ${IMPORTERS}, then each importer classified test vs production by *.test.ts(x) / *.spec.ts and the tests/ tree. No production module in any package reaches this file; a name it exports may still be live as string-resolved vocabulary.`,
    });
    continue;
  }

  const barrel = ownBarrel(file);
  const routes = barrelRoutes(file);
  const exportsDeclared = declaredExports(source.get(file));

  for (const name of exportsDeclared) {
    const direct = consumedBy.get(file).filter((e) => e.names === null || e.names.includes(name));
    const through = [];
    for (const [barrelFile, names] of routes) {
      for (const edge of consumedBy.get(barrelFile)) {
        if (names !== null && !names.has(name)) continue;
        if (edge.names === null || edge.names.includes(name)) through.push(edge.from);
      }
    }
    const consumers = [...new Set([...direct.map((e) => e.from), ...through])];
    // The file's own barrel is the one production consumer this tier looks
    // past — a barrel is a door a name is reached through, not a consumer — and
    // counting it skipped every input the tier exists to report.
    const prodConsumers = consumers.filter((file_) => !isTestFile(file_) && file_ !== barrel);
    if (prodConsumers.length > 0) continue;

    const testConsumers = consumers.filter(isTestFile);
    if (consumers.includes(barrel)) {
      candidates.push({
        kind: "barrel-only-export",
        file,
        symbol: name,
        evidence: `imported only by its own package barrel ${barrel}, and no production file takes "${name}" from that barrel. Search: importer graph (${IMPORTERS}) plus named-import tracking through re-export chains. Test importers: ${list(testConsumers)}.`,
      });
      continue;
    }

    const importerSearch = `0 production importers; ${direct.length + through.length} importer(s), all tests: ${list(testConsumers)}. Search: ${IMPORTERS}, then for every file that imports this one the imported name list was read from the clause; a namespace import, a dynamic import(), a side-effect import or a vi.mock factory consumes every name and would have hidden this. Consumers reached through a re-exporting barrel are followed. String-resolved vocabulary is invisible to this search.`;

    // `default` has no name to search for, so it is forced to 0 and always lands
    // in the dead tier — an `export default function foo()` whose `foo` is used in
    // its own module would be tiered dead-export. No default row exists at HEAD.
    // The two tiers take opposite actions, so they are two kinds, not one.
    const ownReads = name === "default" ? 0 : readsOutsideDeclaration(selfUse.get(file), name);
    if (ownReads > 0) {
      candidates.push({
        kind: "redundant-export",
        file,
        symbol: name,
        evidence: `the symbol is LIVE: its own declaring file reads it (${ownReads} occurrence(s) of the name outside quoted strings, every declaration-shaped occurrence excluded — its own declaration, an object key, an import or an export specifier) and no other production file imports it. Only the "export" keyword is unnecessary — do not delete the symbol. ${importerSearch}`,
      });
    } else {
      candidates.push({
        kind: "dead-export",
        file,
        symbol: name,
        evidence: `the symbol is dead: ${name === "default" ? "a default export carries no name to search for" : "its own declaring file never reads it outside quoted strings (every occurrence of the name is declaration-shaped — its own declaration, an object key, an import or an export specifier)"}, so nothing in its own module reaches it either. ${importerSearch}`,
      });
    }
  }
}

// Unreachable branches: the literal exists only inside its own union.
const unreachableDeclarers = new Map(); // literal -> every file that declares it
for (const union of unions) {
  for (const member of new Set(union.members)) {
    if (!unreachableDeclarers.has(member)) unreachableDeclarers.set(member, new Set());
    unreachableDeclarers.get(member).add(union.file);
  }
}

for (const union of unions) {
  if (isEntryPoint(union.file) || isAmbientTypes(union.file) || isTestFile(union.file)) continue;
  for (const member of new Set(union.members)) {
    const total = literalCounts.get(member) ?? 0;
    const inside = unionLiterals.get(member) ?? 0;
    if (total - inside > 0) continue;
    const declarers = [...unreachableDeclarers.get(member)].sort();
    // One literal can be declared in more than one file, so a row count is not a
    // count of distinct dead branches — say which this is, both here and in the report.
    const elsewhere =
      declarers.length > 1
        ? ` The SAME literal is declared in ${declarers.length} files (${declarers.join(", ")}), so this row is one of ${declarers.length} for a single distinct branch.`
        : " This literal is declared in one file, so this row is one distinct branch.";
    candidates.push({
      kind: "unreachable-branch",
      file: union.file,
      symbol: member,
      evidence: `the literal ${member} appears ${total} time(s) in the scanned tree (tests included) and every one is inside a closed union at ${union.file}; nothing else in the source names it, so nothing in the source produces it and nothing switches on it.${elsewhere} Search: literal-text scan for ${member} minus its occurrences inside union runs, over declaration-shaped unions only (a type alias body or a property annotation; a Pick<T, ...> argument list is not read as a union). Expected false positives: a variant produced or read through a composed string, and a value that arrives from outside the source — a sensor type name or a persisted Fabric JSON property — which is a decision rather than a deletion.`,
    });
  }
}

candidates.sort((a, b) => a.kind.localeCompare(b.kind) || a.file.localeCompare(b.file) || (a.symbol ?? "").localeCompare(b.symbol ?? ""));

/** A candidate outside a package is still counted, under the tree that owns it. */
function bucketOf(file) {
  if (file.startsWith("src/web/tests/")) return "(tests)";
  if (file.startsWith("scripts/") || file.startsWith("src/web/scripts/")) return "(scripts)";
  return "(root)";
}

/**
 * Every kind is printed even at zero: "this kind found nothing at HEAD" is an
 * answer, and a kind that silently disappears reads as one that was never run.
 */
const KINDS = [
  "test-only-consumer",
  "no-importer-file",
  "dead-export",
  "redundant-export",
  "barrel-only-export",
  "unreachable-branch",
];
const countsByKind = Object.fromEntries(KINDS.map((kind) => [kind, 0]));
const countsByPackage = {};
for (const candidate of candidates) {
  countsByKind[candidate.kind] = (countsByKind[candidate.kind] ?? 0) + 1;
  const bucket = packageOf(candidate.file) ?? bucketOf(candidate.file);
  countsByPackage[bucket] = (countsByPackage[bucket] ?? 0) + 1;
}

const report = {
  scanned: {
    files: all.length,
    productionFiles: all.filter((f) => !isTestFile(f)).length,
    testFiles: all.filter(isTestFile).length,
    testOnlyModules: candidates.filter((candidate) => candidate.kind === "test-only-consumer").length,
  },
  candidates,
  countsByKind,
  countsByPackage,
  /**
   * `unreachable-branch` rows are per declaration site, and one literal can be
   * declared in two files — so its row count is not its count of distinct dead
   * branches. This is the number a reader should quote.
   */
  unreachableBranchDistinctLiterals: new Set(
    candidates.filter((c) => c.kind === "unreachable-branch").map((c) => c.symbol),
  ).size,
  unresolvedRelativeSpecifiers: unresolved,
  /** Set false only here; the start-of-run marker writes true to the same path. */
  incomplete: false,
  note:
    "Candidates, not verdicts, and nothing here is deleted. `data-yunari-*` attributes, " +
    "`--yunari-*`/`--shell-*` custom properties, `KIND_*` registries, Fabric JSON keys, " +
    "classes composed by template literal, and any file a gate reads as data are all live " +
    "with no importer — none of that is visible to this graph, and a name with an empty " +
    "search is not a name that is dead.",
};

function renderReport(report) {
  const lines = [];
  lines.push("Dead-code sweep — candidates, not verdicts. Nothing is deleted by this run.");
  lines.push("");
  lines.push(
    `Scanned ${report.scanned.files} files (${report.scanned.productionFiles} production, ${report.scanned.testFiles} test).`,
  );
  lines.push("");
  for (const [kind, count] of Object.entries(report.countsByKind)) {
    const distinct =
      kind === "unreachable-branch" && report.unreachableBranchDistinctLiterals !== count
        ? `  (${report.unreachableBranchDistinctLiterals} distinct literals — one literal declared in two files is two rows, one branch)`
        : "";
    lines.push(`${kind} — ${count}${distinct}`);
    const rows = report.candidates.filter((candidate) => candidate.kind === kind);
    for (const row of rows.slice(0, 25)) {
      lines.push(`  ${row.file}${row.symbol === undefined ? "" : ` :: ${row.symbol}`}`);
    }
    if (rows.length > 25) lines.push(`  … ${rows.length - 25} more (see --json)`);
    lines.push("");
  }
  if (Object.keys(report.countsByKind).length === 0) lines.push("No candidates.");
  lines.push("By package: " + JSON.stringify(report.countsByPackage));
  lines.push("");
  lines.push(report.note);
  if (report.unresolvedRelativeSpecifiers.length > 0) {
    lines.push("");
    lines.push(`Unresolved relative specifiers (${report.unresolvedRelativeSpecifiers.length}) — each one hides a file's importer:`);
    for (const row of report.unresolvedRelativeSpecifiers.slice(0, 20)) {
      lines.push(`  ${row.from} -> ${row.spec}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Read before overwriting: this is where the candidate marker must still be,
 * and the self-test asserts it was. Without that assertion, deleting the
 * start-up write above would leave the mechanism passing its own gate while a
 * crash once again left the previous run's candidate list to be mistaken for
 * this one's. Vacuous without `--json`, like the check that reads it.
 *
 * The whole document is kept, not only its flag: the self-test asserts the
 * marker's failure *shape* against what really landed, and the completion write
 * below replaces it a moment from now.
 */
const candidateMarker = jsonPath === null || jsonPath === undefined ? null : readJsonDoc(jsonPath);
const candidateMarkerOnDisk =
  jsonPath === null || jsonPath === undefined || candidateMarker?.incomplete === true;

if (jsonPath !== null && jsonPath !== undefined) writeJson(jsonPath, report);

if (!SELF_TEST) process.stdout.write(renderReport(report));

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

/**
 * The self-test is the only gate this script has.
 *
 * Biome's `files.includes` covers `src/web/**\/*.{ts,tsx,json,css}` and no
 * tsconfig includes `scripts/`, so nothing else in this repository can fail
 * `.mjs` — not the linter, not the typechecker. A scanner that reports
 * everything, or nothing, has told you nothing, so the checks below assert both
 * directions against cases the register already names, and assert that the test
 * suite itself is not reported (the single likeliest way for the graph to be
 * wrong).
 *
 * The result lands in a file rather than only on stdout: a hook rewrites stdout
 * in this environment, so a count read from the terminal is not evidence. That
 * file has its own fixed path and is never the `--json` path.
 *
 * What these checks establish, and the two halves are separate: the
 * `barrel-only-export` tier is reachable and fires on this tree (the gate
 * excludes the file's own barrel), and a barrel's re-export is followed
 * as a route — so an export consumed through its own package barrel is not
 * reported as unused. The route case proves the following, not the firing.
 */
if (SELF_TEST) {
  /**
   * The kind-fires checks run against a fixture tree this self-test writes, not
   * against live source files (`vg-550`). Two of the four files
   * they used to name were invalidated by work the product wanted:
   * `font-picker.tsx` by the mount that closed `vg-268`/`vg-283`, and
   * `boot-theme.ts`, the *negative* fixture, by an export that reddened the whole
   * of Phase 6. A check naming a live file is a check the product can break by
   * improving, so the fixture is the contract instead.
   *
   * It is analysed by **this script, run again** (`--root`) rather than by a
   * second classifier in this process: the child is the same program over a
   * different root, so there is no second implementation for it to drift from.
   *
   * The shape, and each file earns its place:
   *
   *   live.ts    a module a *production* file imports — the negative case, and
   *              the one file no kind may report.
   *   reader.ts  imported only by a test file — `test-only-consumer`.
   *   field.ts   a production file imports it, so it is not test-only; but
   *              nothing imports `settingsField` and its own file never reads
   *              it — `dead-export`.
   *   card.ts    the same, except its own file calls `instantiateCard` once —
   *              `redundant-export`, and the row whose evidence number must be
   *              1 against 2 raw occurrences.
   *
   * `field.ts` and `card.ts` import each other: that is what gives each a
   * production importer without a third file, which would itself be a candidate
   * and add a row these checks do not name.
   */
  const FIXTURE_PKG = "src/web/packages/sweep-fixture/src";
  /**
   * `import { names } from "<spec>"`. The specifier is passed rather than spelled
   * so this file's own text does not read as four unresolved relative imports:
   * the sweep scans `scripts/`, so the graph these checks exercise is the very
   * one that would report them, and `unresolvedRelativeSpecifiers` is a
   * diagnostic a phase reads.
   */
  const importFrom = (names, spec) => `import { ${names} } from ${JSON.stringify(spec)};\n`;
  const FIXTURE_FILES = {
    [`${FIXTURE_PKG}/live.ts`]: "export const live = 1;\n",
    [`${FIXTURE_PKG}/reader.ts`]: `${importFrom("live", "./live")}export const read = () => live;\n`,
    [`${FIXTURE_PKG}/reader.test.ts`]: `${importFrom("read", "./reader")}read();\n`,
    [`${FIXTURE_PKG}/field.ts`]: `${importFrom("usedCard", "./card")}export const usedField = 1;\nexport function settingsField() {\n  return usedCard + 2;\n}\n`,
    [`${FIXTURE_PKG}/card.ts`]: `${importFrom("usedField", "./field")}export const usedCard = 1;\nexport function instantiateCard() {\n  return usedField + 2;\n}\ninstantiateCard();\n`,
  };

  const fixtureRoot = mkdtempSync(join(tmpdir(), "dead-code-sweep-fixture-"));
  let fixtureExit = null;
  let fixtureCandidates = [];
  try {
    for (const [rel, body] of Object.entries(FIXTURE_FILES)) {
      const full = join(fixtureRoot, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, body, "utf8");
    }
    // The report sits at the fixture root, which the walk never visits: it scans
    // `src/web/packages/*/src`, `src/web/tests`, `src/web/scripts` and `scripts`.
    const fixtureJson = join(fixtureRoot, "fixture-report.json");
    const child = spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.url), "--root", fixtureRoot, "--json", fixtureJson],
      { encoding: "utf8" },
    );
    fixtureExit = child.status;
    const doc = readJsonDoc(fixtureJson);
    fixtureCandidates = Array.isArray(doc?.candidates) ? doc.candidates : [];
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }

  const fixtureAt = (kind, file, symbol) =>
    fixtureCandidates.some(
      (candidate) =>
        candidate.kind === kind &&
        candidate.file === file &&
        (symbol === undefined || candidate.symbol === symbol),
    );

  const checks = [
    ["the walk found the tree", all.length > 400],
    ["the walk found the test suite", all.filter(isTestFile).length > 200],
    [
      // The guard on the fixture run itself: a child that crashed, or one whose
      // report was the start-up marker, would leave `fixtureCandidates` empty and
      // every kind-fires check below red for a reason that is not the sweep's.
      "the fixture tree is analysed (the child run finished and reported candidates)",
      fixtureExit === 0 && fixtureCandidates.length > 0,
    ],
    [
      // A module only a test file imports. The real file this named held it only
      // until the product mounted it, which is `vg-550`'s whole point.
      "test-only-consumer fires on the fixture (a module only a test file imports)",
      fixtureAt("test-only-consumer", `${FIXTURE_PKG}/reader.ts`),
    ],
    [
      "no test file is ever a candidate (discovery is an edge)",
      candidates.every((candidate) => !isTestFile(candidate.file)),
    ],
    [
      "no package barrel is a no-importer-file (exports makes it an entry point)",
      candidates.every(
        (candidate) =>
          candidate.kind !== "no-importer-file" || !/^src\/web\/packages\/[^/]+\/src\/index\.ts$/.test(candidate.file),
      ),
    ],
    ["no ambient .d.ts is a candidate", candidates.every((candidate) => !isAmbientTypes(candidate.file))],
    [
      "dead-export fires on the fixture (its own file never reads the symbol, and no production file imports it)",
      fixtureAt("dead-export", `${FIXTURE_PKG}/field.ts`, "settingsField"),
    ],
    [
      "redundant-export fires on the fixture (its own file calls the symbol)",
      fixtureAt("redundant-export", `${FIXTURE_PKG}/card.ts`, "instantiateCard"),
    ],
    /**
     * The number in a redundant row is evidence a Phase 2 reader acts on, so it
     * must mean what its sentence says. The fixture's `instantiateCard` is
     * declared once and called once: the raw occurrence count is 2, and a row
     * reporting 2 says a second call site exists when it does not. This fails the
     * moment the declaration is counted again — the raw count is read off the
     * fixture body this test wrote, not off the emitter, so the check is not a
     * restatement of it.
     */
    [
      "a redundant row reports uses, not occurrences (the fixture's instantiateCard is declared once and called once, so 1)",
      (() => {
        const row = fixtureCandidates.find(
          (candidate) =>
            candidate.kind === "redundant-export" && candidate.file === `${FIXTURE_PKG}/card.ts`,
        );
        const claimed = /\((\d+) occurrence/.exec(row?.evidence ?? "")?.[1];
        return (
          claimed === "1" &&
          usesIn(stripStrings(FIXTURE_FILES[`${FIXTURE_PKG}/card.ts`]), "instantiateCard") === 2
        );
      })(),
    ],
    /**
     * `vg-382` widened the number this pins: it is a count of *reads*, so it
     * excludes the declaration site, an object key and an import or export
     * specifier. It asserted `claimed === usesIn(…) - 1` before the widening,
     * which is false for any row whose own file names the symbol as a key as
     * well — and that assertion was the wrong one, because `usesIn - 1` counts a
     * declaration-shaped occurrence as a use. `claimed < raw` is the half that
     * does not restate the emitter: no row may claim as many reads as it has
     * occurrences, and no row may claim none.
     */
    [
      "every redundant row's number is its read count, not its occurrence count",
      candidates
        .filter((candidate) => candidate.kind === "redundant-export")
        .every((candidate) => {
          const claimed = Number(/\((\d+) occurrence/.exec(candidate.evidence)?.[1]);
          const raw = usesIn(selfUse.get(candidate.file), candidate.symbol);
          return (
            claimed >= 1 &&
            claimed < raw &&
            claimed === readsOutsideDeclaration(selfUse.get(candidate.file), candidate.symbol)
          );
        }),
    ],
    /**
     * A declaration is not a use (`vg-382`), on fixtures: the repo's own contents
     * change, the shape does not. The first two are the red proof — reverted to
     * the pre-widening `usesIn - 1` they claim 2 and 1 where the answer is 0. The
     * third is the other direction, and the one that matters: an exclusion that
     * swallowed a read would put a live symbol on the removal list.
     */
    [
      "an object key is not a read (a const its own file only names as a key has no reader)",
      readsOutsideDeclaration(
        "export const panel = 1;\nconst a = { panel: 1 };\nconst b = { panel: 2 };\n",
        "panel",
      ) === 0,
    ],
    [
      "a re-export of an imported name is not a read (the file only forwards it)",
      readsOutsideDeclaration('import { countable } from "./x";\nexport { countable };\n', "countable") === 0,
    ],
    [
      "a value beside a key is still a read (an object literal is not excluded wholesale)",
      readsOutsideDeclaration("export const panel = 1;\nconst b = { panel: 2, fill: panel };\n", "panel") === 1,
    ],
    [
      "the two export tiers are disjoint (opposite remedies, one row never both)",
      candidates.every(
        (candidate) =>
          candidate.kind !== "dead-export" && candidate.kind !== "redundant-export"
            ? true
            : candidates.filter((other) => other.file === candidate.file && other.symbol === candidate.symbol).length === 1,
      ),
    ],
    [
      // The fixture's `live.ts` is imported by `reader.ts`, a production file, so
      // it is live and no kind may report it. Its real counterpart held this
      // check until `BootThemeOutcome` was exported from `boot-theme.ts` with no
      // production importer — a *negative* fixture that is a real file is the
      // same defect wearing the opposite sign, and it reddened all of Phase 6.
      "the negative case is absent from every kind (the fixture's live.ts is imported by a production file)",
      fixtureCandidates.every((candidate) => candidate.file !== `${FIXTURE_PKG}/live.ts`),
    ],
    [
      "every candidate carries kind, file and the search that found it",
      candidates.every(
        (candidate) =>
          typeof candidate.kind === "string" &&
          typeof candidate.file === "string" &&
          typeof candidate.evidence === "string" &&
          candidate.evidence.length > 40,
      ),
    ],
    [
      "the run produced candidates (a scanner that reports nothing proved nothing)",
      candidates.length > 0,
    ],
    // The union filter, on fixtures: the repo's own contents change, the shape does not.
    [
      "a type-alias union is read as a closed union",
      unionRunsIn('export type Kind = "none" | "object";')[0]?.length === 2,
    ],
    [
      "a multi-line union is read as a closed union",
      unionRunsIn('export type Key =\n  | "tl"\n  | "tr";')[0]?.length === 2,
    ],
    [
      "a Pick<T, ...> argument list is not read as a union",
      unionRunsIn('function f(options: Pick<O, "flex" | "width"> = {}) {}').length === 0,
    ],
    /**
     * What this establishes and what it does not: it proves a barrel's re-export
     * is *followed* as a route — so an export consumed through its own package
     * barrel is not reported as unused — for the real case of `settingsFieldsFor`
     * through `renderer-core/src/index.ts`. It does NOT exercise the branch that
     * emits a `barrel-only-export` candidate; that branch has its own check, and
     * this one would still pass with the tier switched off.
     */
    [
      "a barrel's re-export is followed as a route (an import is not)",
      barrelRoutes("src/web/packages/renderer-core/src/charts/settings-fields.ts")
        .get("src/web/packages/renderer-core/src/index.ts")
        ?.has("settingsFieldsFor") === true,
    ],
    /**
     * The tier's reachability, asserted directly rather than through a pinned
     * file: before this guard this was zero and could never be anything else, and the
     * only way to reach zero again is to count the file's own barrel as a
     * production consumer. A count rather than a file, so Task 21.8 can move the
     * kind-fires checks to a fixture tree without this one going stale.
     */
    [
      "barrel-only-export fires (the production-consumer gate looks past the file's own barrel)",
      report.countsByKind["barrel-only-export"] > 0,
    ],
    [
      "every kind is reported, including the ones that found nothing",
      KINDS.every((kind) => typeof report.countsByKind[kind] === "number"),
    ],
    /**
     * The candidate marker, against the argument the self-test's own marker
     * gets: a reader may ask "is this a clean sweep?" in several phrasings and
     * every one must answer no. Asserting the list rather than one clause is
     * what makes `candidates: []` — which satisfies `!doc.candidates` exactly
     * as the old marker did — fail here.
     *
     * The on-disk half is vacuous without `--json`, which is the only mode that
     * writes that marker; with it, this reads the document that really landed.
     */
    [
      "the candidate marker fails every clean-sweep reading, and the marker on disk is that shape (the second half is vacuous unless --json was passed)",
      cleanSweepReadings(incompleteCandidateReport()).every((reads) => reads === false) &&
        (candidateMarker === null ||
          (candidateMarker.incomplete === true &&
            cleanSweepReadings(candidateMarker).every((reads) => reads === false))),
    ],
  ];

  const outPath = resolve(SELFTEST_JSON);
  /**
   * The self-test's result, in the shape the completion write serialises.
   * `incomplete` is deliberately absent: only the completion write may claim a
   * finished run, and that flag is what every reader keys on.
   */
  const result = {
    selfTest: true,
    checks: [],
    passed: 0,
    failed: [],
    total: 0,
    note: "A run with fewer than total passes is a failure; the file is written either way so the count can be read without the terminal. `incomplete: false` marks a finished run — the start-of-run marker and the in-progress write both leave `true` here.",
  };

  /** The checks collected so far, in the result document's shape. */
  const collect = () => {
    result.checks = checks.map(([name, ok]) => ({ name, ok }));
    result.passed = checks.filter(([, ok]) => ok).length;
    result.failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
    result.total = checks.length;
  };

  /**
   * Read before the first write — the only moment the start-up marker is on
   * disk, since the in-progress write below replaces it. Its *shape* is read
   * here and asserted in the guardian, not only its `incomplete` flag: a marker
   * whose `failed` is empty reads as a pass to a reader who does not apply
   * `isCompletePass`.
   */
  const startUpMarker = readJsonDoc(SELFTEST_JSON);
  const markerOnDisk = startUpMarker?.incomplete === true;

  // First write: the checks collected so far, in progress. It must be this
  // document rather than the start-up marker, or the guardian below cannot tell
  // that the write happened at all.
  writeJson(SELFTEST_JSON, inProgressSelfTestResult(checks.length));

  /**
   * The regression this guards: the self-test once wrote its result to the same
   * path as `--json`, so `--self-test --json out.json` replaced the candidate
   * report with the checks and exited 0.
   *
   * It has to run AFTER the first write, and that is the whole point: written
   * into the list above, it read `--json` while the candidate report was still
   * intact and passed while the bug was live — a check that cannot fail. Building
   * it here is what makes the red-proof reproduce.
   *
   * Vacuous without `--json`, which is why the usage line names both flags.
   *
   * It asserts a *finished* report — `incomplete: false` and an array — rather
   * than the presence of a `candidates` key. The key alone stopped meaning
   * anything once the start-up marker carried one too: a guard the marker
   * satisfies is a guard that cannot fail, and this check's whole reason to
   * exist is that it fails when the report is clobbered.
   */
  let intact = jsonPath === null || jsonPath === undefined;
  if (!intact) {
    try {
      const doc = JSON.parse(readFileSync(resolve(jsonPath), "utf8"));
      intact = doc.incomplete === false && Array.isArray(doc.candidates);
    } catch {
      intact = false;
    }
  }
  // Pushed unconditionally so the total is a stable number: a check that
  // appears only on some runs is a count nobody can quote.
  checks.push([
    "the report at --json is still a finished candidate report after the self-test ran (vacuous unless --json was passed)",
    intact,
  ]);

  /**
   * The guardian for the mechanism above, pushed after the in-progress write so
   * it reads the artefact a later phase reads rather than the in-memory object.
   *
   * Three properties, and the third is the one three earlier rounds missed by
   * asserting only the first two:
   *
   *   1. the marker writes really landed — `markerOnDisk` and
   *      `candidateMarkerOnDisk`, which the shapes alone cannot show;
   *   2. nothing unfinished satisfies `isCompletePass`. The in-progress document
   *      is on disk *right now*, while this check and the `--json` intactness
   *      check above run, and a throw in either exits non-zero beside it. So
   *      that window is precisely what has to fail the predicate;
   *   3. the completed shape still satisfies it, so a later tightening cannot
   *      make a finished run unreadable.
   *
   * Asserting the file was a *complete* pass here was the bug rather than the
   * guard: it held only while the first write already claimed completion.
   */
  checks.push([
    "an unfinished run cannot read as a pass (the start-up marker and the in-progress write both fail it)",
    (() => {
      const onDisk = readJsonDoc(outPath);
      const startUp = incompleteSelfTestResult();
      return (
        markerOnDisk &&
        candidateMarkerOnDisk &&
        // The in-progress write really landed, and is not the start-up marker.
        onDisk?.stage === "in-progress" &&
        onDisk.incomplete === true &&
        onDisk.total === 0 &&
        onDisk.failed?.length > 0 &&
        onDisk.checks?.length > 0 &&
        !isCompletePass(onDisk) &&
        // Not even a run that collected every check without finishing: the
        // `incomplete` flag, not the counts, is what says the run ended.
        !isCompletePass({ incomplete: true, total: checks.length, passed: checks.length }) &&
        // While a genuinely finished document still passes it.
        isCompletePass({ incomplete: false, total: checks.length, passed: checks.length }) &&
        // And a zero-check document does not, which is what `total > 0` is for:
        // without it, a `0/0` document reads as a vacuous pass.
        !isCompletePass({ incomplete: false, total: 0, passed: 0 }) &&
        // The start-up marker is failure-shaped as well as incomplete.
        startUp.stage === "start-up" &&
        startUp.incomplete === true &&
        startUp.failed.length > 0 &&
        startUp.checks.length > 0 &&
        !isCompletePass(startUp)
      );
    })(),
  ]);

  // Second, and last, write: the only place `incomplete: false` is ever written.
  collect();
  writeJson(SELFTEST_JSON, { ...result, incomplete: false });

  for (const { name, ok } of result.checks) process.stdout.write(`${ok ? "  ok  " : "  FAIL"} ${name}\n`);
  process.stdout.write(`\ndead-code-sweep self-test: ${result.passed}/${result.total} passed -> ${outPath}\n`);
  if (result.failed.length > 0) process.exit(1);
}
