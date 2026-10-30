#!/usr/bin/env node
/**
 * Enforces the §47 display-only bundle budget.
 *
 * The design document requires proving that the shared renderer ships in a small
 * player bundle "without downloading editor controls or inspectors", and §124
 * requires a tested compatibility floor on real low-end phones. A number in a
 * document does not enforce itself, so this runs in CI and fails the build.
 *
 * The budget below is a PLACEHOLDER. §157 requires Gate 0 to establish real
 * budgets on named reference hardware; replace these once those numbers exist,
 * and record any approved policy change beside the budget.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

/** Gzipped budget in kilobytes for all JS in the player bundle. */
const JS_GZIP_BUDGET_KB = 400;

/** Gzipped budget in kilobytes for all CSS. */
const CSS_GZIP_BUDGET_KB = 40;

// fileURLToPath, not URL.pathname: on Windows the latter yields "/D:/..." with a
// leading slash, which every fs call then fails to resolve.
const DIST = fileURLToPath(new URL("../dist/", import.meta.url));

/** Recursively lists files under a directory. */
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
    } else {
      files.push(full);
    }
  }

  return files;
}

async function gzippedKb(files) {
  let total = 0;

  for (const file of files) {
    const contents = await readFile(file);
    total += gzipSync(contents).byteLength;
  }

  return total / 1024;
}

async function main() {
  try {
    await stat(DIST);
  } catch {
    console.error(
      "No dist/ directory. Run `npm run build -w @yunari/player` first.",
    );
    process.exit(2);
  }

  const files = await walk(DIST);
  const js = files.filter((f) => extname(f) === ".js");
  const css = files.filter((f) => extname(f) === ".css");

  const jsKb = await gzippedKb(js);
  const cssKb = await gzippedKb(css);

  const rows = [
    { what: "JS (gzip)", actual: jsKb, budget: JS_GZIP_BUDGET_KB },
    { what: "CSS (gzip)", actual: cssKb, budget: CSS_GZIP_BUDGET_KB },
  ];

  let failed = false;

  for (const row of rows) {
    const ok = row.actual <= row.budget;
    failed ||= !ok;
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${row.what.padEnd(12)} ${row.actual.toFixed(1).padStart(7)} KB  ` +
        `(budget ${row.budget} KB)`,
    );
  }

  if (failed) {
    console.error(
      "\nPlayer bundle exceeds its budget. Before raising the budget, check whether an " +
        "editor-only dependency has leaked into @yunari/renderer-core or @yunari/player — " +
        "that is the failure §47 is guarding against.",
    );
    process.exit(1);
  }
}

await main();
