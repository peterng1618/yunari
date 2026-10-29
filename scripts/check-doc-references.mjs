#!/usr/bin/env node

/**
 * Every reference into `docs/superpowers/plans/` resolves, or this refuses.
 *
 * `archive/` exists so a moved plan stays readable. Nothing resolved a reference
 * to one, so a reference pointing at the right name in the wrong place made a
 * reader conclude the document was deleted — and the next six-plan move
 * re-broke the same references silently. `vg-434` is this check; decision `0048`
 * is why it is a script rather than a dependency.
 *
 * Three parts a generic link checker does not carry, and they are the whole
 * rule: the reference may sit in a code span or in prose rather than in a link;
 * a bare filename may resolve in `plans/` **or** in `plans/archive/`; and the
 * referencing files are any tracked text file, not only markdown.
 *
 * `doc-ref-ok: <reason>` on the line, or on the line above, accepts one
 * occurrence that legitimately has no target — a plan that was never migrated, a
 * fixture a self-test must feed this check. The escape is per occurrence and
 * carries its reason, so the next reader sees a decision rather than an
 * oversight.
 *
 * `node scripts/check-doc-references.mjs --self-test` proves both directions.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PLANS = join(ROOT, "docs/superpowers/plans");

const SCANNED = /\.(md|ts|tsx|mjs|js|cjs|json|css|html|ya?ml)$/;

/**
 * `.jsonl` is deliberately absent: whether a `plan` field on a backlog line is a
 * live pointer or a historical label is not this check's ruling to take, so it
 * refuses to answer it by failing on it.
 */
const EXCLUDED = /\.jsonl$/;

const TOKEN = /[A-Za-z0-9_./-]*plans\/[A-Za-z0-9_./-]*\.md/g;
/** The reason must start with a word character, so a bare `<!-- doc-ref-ok: -->` is not an escape. */
const ESCAPE = /doc-ref-ok:\s*\w/;

/**
 * Does this token name a plan that exists?
 *
 * A token carrying a directory resolves under `plans/` as written; a bare
 * filename may resolve in `plans/` or in `plans/archive/`, which is the
 * fallback that makes a moved plan still findable by name.
 */
export function resolves(token, exists) {
  const at = token.lastIndexOf("plans/");
  if (at < 0) return false;
  const name = token.slice(at + "plans/".length);
  if (name === "" || name.includes("..")) return false;
  return exists(name);
}

/** The references in one file's text that resolve to nothing. */
export function brokenIn(text, exists) {
  const found = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const m of line.matchAll(TOKEN)) {
      if (resolves(m[0], exists)) continue;
      // The escape may sit on this line or the one above it.
      if (ESCAPE.test(line) || ESCAPE.test(lines[i - 1] ?? "")) continue;
      found.push({ line: i + 1, token: m[0] });
    }
  });
  return found;
}

/**
 * This file, which holds the fixtures the self-test must refuse. Excluded rather
 * than escaped, because the fixtures *are* its subject.
 */
const SELF = "scripts/check-doc-references.mjs";

/**
 * Tracked files **and** untracked-but-not-ignored ones.
 *
 * `--cached` alone was the first cut and it was wrong: a file lands untracked,
 * so the check could not see the document being written — proved by breaking a
 * reference in a new decision note and watching this report green.
 */
const scannedFiles = () =>
  execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: ROOT,
    maxBuffer: 1 << 28,
  })
    .toString()
    .split("\n")
    .filter((f) => f !== "" && f !== SELF && SCANNED.test(f) && !EXCLUDED.test(f));

const planExists = (name) =>
  existsSync(join(PLANS, name)) ||
  (!name.includes("/") && existsSync(join(PLANS, "archive", name)));

if (process.argv.includes("--self-test")) {
  const fixtures = [
    ["accepts a resolving path", "see `docs/superpowers/plans/live.md`", true],
    ["accepts a bare name found in archive", "moved to plans/moved.md", true],
    ["accepts an archive path", "see plans/archive/old.md", true],
    ["refuses a bare name in neither place", "see plans/gone.md", false],
    ["refuses a path that does not resolve", "see docs/superpowers/plans/gone.md", false],
    ["refuses a code span, not only a link", "`plans/gone.md`", false],
    ["refuses prose, not only a code span", "the plan at plans/gone.md was moved", false],
    ["accepts one escaped by its own line", "see plans/gone.md <!-- doc-ref-ok: fixture -->", true],
    ["accepts one escaped by the line above", "<!-- doc-ref-ok: fixture -->\nsee plans/gone.md", true],
    ["refuses an escape with no reason", "see plans/gone.md <!-- doc-ref-ok: -->", false],
    ["ignores a reference to something that is not a plan", "see plans/notes.txt", true],
  ];
  const exists = (name) => name === "live.md" || name === "moved.md" || name === "archive/old.md";
  let failed = 0;
  for (const [name, text, expected] of fixtures) {
    const found = brokenIn(text, exists);
    const ok = found.length === 0 === expected;
    if (!ok) failed += 1;
    process.stdout.write(`${ok ? "ok  " : "FAIL"} ${name}\n`);
  }
  if (failed > 0) {
    process.stderr.write(`check-doc-references self-test: ${failed} case(s) wrong\n`);
    process.exit(1);
  }
  process.stdout.write("check-doc-references self-test: all cases behave\n");
  process.exit(0);
}

let broken = 0;
let scanned = 0;
for (const file of scannedFiles()) {
  // `git ls-files --cached` lists a tracked path the worktree no longer holds — a file deleted and
  // not yet staged, which is the normal state mid-refactor and was `Task 15.4`'s first gate run.
  // It carries no reference to check, and reading it threw ENOENT out of this loop.
  if (!existsSync(join(ROOT, file))) continue;
  scanned += 1;
  for (const { line, token } of brokenIn(readFileSync(join(ROOT, file), "utf8"), planExists)) {
    process.stderr.write(`${file}:${line}  ${token} resolves to nothing\n`);
    broken += 1;
  }
}
if (broken > 0) {
  process.stderr.write(
    `check-doc-references: ${broken} reference(s) resolve to nothing across ${scanned} file(s)\n`,
  );
  process.exit(1);
}
process.stdout.write(`check-doc-references: every plans/ reference resolves (${scanned} files)\n`);
