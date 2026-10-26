#!/usr/bin/env node

/**
 * `THIRD-PARTY-NOTICES.md` is the direct-dependency inventory: every package a
 * `src/web` workspace manifest declares in `dependencies` or `devDependencies`,
 * `@yunari/` excluded. A row that states a version or licence the installed
 * tree no longer has is worse than no row, so this check compares each
 * declaration against the lockfile and the installed package's own
 * `package.json`. Scope stays direct dependencies; the closure is the release
 * rule in `docs/engineering/dependencies.md`, not this check.
 *
 * `node scripts/check-third-party.mjs [--self-test]`
 *
 * Exit: 0 clean, 1 drift (one line per drift), 2 unreadable input.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const WEB = join(ROOT, "src/web");
const NOTICES = join(ROOT, "THIRD-PARTY-NOTICES.md");
const LOCKFILE = join(WEB, "package-lock.json");

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file} cannot be read as JSON: ${error.message}`);
  }
}

/** Cells of a markdown table row, or `[]` when the line is not one. */
function tableCells(line) {
  const text = line.trim();
  if (!text.startsWith("|")) return [];
  return text
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim().replace(/`/g, ""));
}

/** The rows of every table whose header names Package, Version and Licence. */
export function parseNotices(markdown) {
  const lines = markdown.split(/\r?\n/);
  const rows = [];
  for (let i = 0; i < lines.length; i += 1) {
    const header = tableCells(lines[i]);
    if (
      header[0] !== "Package" ||
      header[1] !== "Version" ||
      header[2] !== "Licence"
    ) {
      continue;
    }
    // Skip the header and the `|---|` separator, then read rows to the first
    // line that is not one.
    for (i += 2; i < lines.length; i += 1) {
      const cells = tableCells(lines[i]);
      if (cells.length < 3) break;
      rows.push({ package: cells[0], version: cells[1], licence: cells[2] });
    }
  }
  return rows;
}

/** Every direct dependency of every `src/web` workspace, `@yunari/` excluded. */
export function directDependencies(web) {
  const root = readJson(join(web, "package.json"));
  const workspaces = ["", ...(root.workspaces ?? [])];
  const dependencies = [];
  for (const workspace of workspaces) {
    const manifest = readJson(join(web, workspace, "package.json"));
    for (const field of ["dependencies", "devDependencies"]) {
      for (const name of Object.keys(manifest[field] ?? {})) {
        if (name.startsWith("@yunari/")) continue;
        dependencies.push({ workspace, name });
      }
    }
  }
  return dependencies;
}

/** The lockfile key a declaration resolves to: its workspace's own copy first,
 *  then the hoisted one — npm's lookup order, and what `runtimeDependencies`
 *  reads for the staged manifest. */
export function resolveDependency(packages, workspace, name) {
  const own = `${workspace === "" ? "" : `${workspace}/`}node_modules/${name}`;
  if (packages[own] !== undefined) return own;
  const hoisted = `node_modules/${name}`;
  return packages[hoisted] === undefined ? undefined : hoisted;
}

/** Parentheses and case are the only differences the notices need to tolerate. */
export function normaliseLicence(value) {
  return value
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/**
 * One drift string per disagreement, naming the package and what disagrees.
 * Declarations are deduplicated by resolved package, so a package the editor
 * and renderer-core both declare is checked once.
 */
export function evaluateNotices({ dependencies, packages, rows, licenceOf }) {
  const drifts = [];
  const checked = new Set();
  for (const { workspace, name } of dependencies) {
    const key = resolveDependency(packages, workspace, name);
    if (key === undefined) {
      const id = `${name}@unresolved`;
      if (checked.has(id)) continue;
      checked.add(id);
      drifts.push(
        `missing ${name}: the lockfile resolves no version for it (declared by ${workspace || "src/web"})`,
      );
      continue;
    }
    const version = packages[key].version;
    const id = `${name}@${version}`;
    if (checked.has(id)) continue;
    checked.add(id);

    const named = rows.filter((row) => row.package === name);
    if (named.length === 0) {
      drifts.push(`missing ${name}: no row in THIRD-PARTY-NOTICES.md`);
      continue;
    }
    const row = named.find((row) => row.version === version);
    if (row === undefined) {
      drifts.push(
        `version ${name}: notices states ${named.map((row) => row.version).join(", ")}, lockfile resolves ${version}`,
      );
      continue;
    }
    const installed = licenceOf(key);
    if (installed === undefined) {
      drifts.push(
        `licence ${name} ${version}: the installed package declares no licence`,
      );
      continue;
    }
    if (normaliseLicence(row.licence) !== normaliseLicence(installed)) {
      drifts.push(
        `licence ${name} ${version}: notices states ${row.licence}, installed package.json declares ${installed}`,
      );
    }
  }
  return drifts;
}

/** The installed package's own licence: its manifest field, or — for a package
 *  that ships none (`@google/design.md`) — the text beside it. */
function installedLicence(web, key) {
  const dir = join(web, key);
  let manifest;
  try {
    manifest = readJson(join(dir, "package.json"));
  } catch {
    return undefined;
  }
  if (typeof manifest.license === "string" && manifest.license.trim() !== "") {
    return manifest.license;
  }
  if (Array.isArray(manifest.licenses)) {
    const types = manifest.licenses
      .map((entry) => (typeof entry === "string" ? entry : entry?.type))
      .filter((type) => typeof type === "string");
    if (types.length > 0) return types.join(" OR ");
  }
  for (const file of ["LICENSE", "LICENSE.txt", "LICENSE.md"]) {
    const at = join(dir, file);
    if (!existsSync(at)) continue;
    const text = readFileSync(at, "utf8");
    if (/Apache License\s+Version 2\.0/i.test(text)) return "Apache-2.0";
    if (/MIT License/i.test(text)) return "MIT";
  }
  return undefined;
}

function selfTest() {
  const packages = {
    "node_modules/dep-a": { version: "1.0.0" },
    "packages/worker/node_modules/dep-b": { version: "2.0.0" },
    "node_modules/dep-b": { version: "9.9.9" },
  };
  const dependencies = [
    { workspace: "", name: "dep-a" },
    { workspace: "packages/worker", name: "dep-b" },
  ];
  const licenceOf = () => "MIT";
  const rows = [
    { package: "dep-a", version: "1.0.0", licence: "MIT" },
    { package: "dep-b", version: "2.0.0", licence: "MIT" },
  ];
  const driftsFor = (fixtureRows) =>
    evaluateNotices({ dependencies, packages, rows: fixtureRows, licenceOf });

  const cases = [
    [
      "passes a clean inventory",
      () => driftsFor(rows).length === 0,
    ],
    [
      "names a missing entry",
      () => {
        const drifts = driftsFor(rows.filter((row) => row.package !== "dep-a"));
        return drifts.length === 1 && drifts[0].startsWith("missing dep-a");
      },
    ],
    [
      "names a version the lockfile does not resolve",
      () => {
        const drifts = driftsFor([
          { package: "dep-a", version: "0.9.0", licence: "MIT" },
          rows[1],
        ]);
        return drifts.some(
          (drift) =>
            drift.startsWith("version dep-a") &&
            drift.includes("0.9.0") &&
            drift.includes("1.0.0"),
        );
      },
    ],
    [
      "names a licence the installed package does not declare",
      () => {
        const drifts = driftsFor([
          { package: "dep-a", version: "1.0.0", licence: "Apache-2.0" },
          rows[1],
        ]);
        return drifts.some(
          (drift) =>
            drift.startsWith("licence dep-a") &&
            drift.includes("Apache-2.0") &&
            drift.includes("MIT"),
        );
      },
    ],
    [
      "resolves a workspace's own copy before the hoisted one",
      () =>
        resolveDependency(packages, "packages/worker", "dep-b") ===
        "packages/worker/node_modules/dep-b",
    ],
  ];

  let failed = 0;
  for (const [name, passes] of cases) {
    const ok = passes();
    if (!ok) failed += 1;
    process.stdout.write(`${ok ? "ok  " : "FAIL"} ${name}\n`);
  }
  if (failed > 0) {
    process.stderr.write(
      `third-party self-test: ${failed} case(s) wrong\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `third-party self-test: all ${cases.length} cases behave\n`,
  );
  process.exit(0);
}

function main() {
  if (process.argv.includes("--self-test")) selfTest();

  try {
    const packages = readJson(LOCKFILE).packages ?? {};
    const drifts = evaluateNotices({
      dependencies: directDependencies(WEB),
      packages,
      rows: parseNotices(readFileSync(NOTICES, "utf8")),
      licenceOf: (key) => installedLicence(WEB, key),
    });

    if (drifts.length > 0) {
      for (const drift of drifts) {
        process.stderr.write(`third-party: ${drift}\n`);
      }
      process.stderr.write(`third-party: ${drifts.length} drift(s)\n`);
      process.exit(1);
    }
    process.stdout.write(
      "third-party: every direct dependency matches its notice\n",
    );
    process.exit(0);
  } catch (error) {
    process.stderr.write(`third-party: ${error.message}\n`);
    process.exit(2);
  }
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main();
}
