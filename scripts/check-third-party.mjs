#!/usr/bin/env node

/**
 * `THIRD-PARTY-NOTICES.md` is the direct-dependency inventory: every package a
 * `src/web` workspace manifest declares in `dependencies`, `devDependencies` or
 * `optionalDependencies`, `@yunari/` excluded. `peerDependencies` stays out: a
 * peer is a requirement this project states about someone else's dependency
 * tree, not a package this project installs and ships. A row that states a
 * version or licence the installed tree no longer has is worse than no row, so
 * this check compares each declaration against the lockfile and the installed
 * package's own manifest, and rejects a row no declaration consumes. A
 * platform-optional package is installed on its own platform only: its row and
 * lockfile version are still required, and its licence is compared where it is
 * installed, with the check saying in its output when it could not be read
 * here. Scope stays direct dependencies; the closure is the release rule.
 *
 * `node scripts/check-third-party.mjs`
 *
 * Its cases live in `src/web/tests/scripts/check-third-party.test.ts`.
 *
 * Exit: 0 clean, 1 drift (one line per drift), 2 unreadable input or an
 * incomplete install.
 */

import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");

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
function parseNotices(markdown) {
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
function directDependencies(web) {
  const root = readJson(join(web, "package.json"));
  const workspaces = ["", ...(root.workspaces ?? [])];
  const dependencies = [];
  for (const workspace of workspaces) {
    const manifest = readJson(join(web, workspace, "package.json"));
    for (const field of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
    ]) {
      for (const name of Object.keys(manifest[field] ?? {})) {
        if (name.startsWith("@yunari/")) continue;
        dependencies.push({
          workspace,
          name,
          optional: field === "optionalDependencies",
        });
      }
    }
  }
  return dependencies;
}

/** The lockfile key a declaration resolves to: its workspace's own copy first,
 *  then the hoisted one — npm's lookup order. The staged manifest reads only
 *  the hoisted copy, so a nested dependency is checked here but not staged. */
function resolveDependency(packages, workspace, name) {
  const own = `${workspace === "" ? "" : `${workspace}/`}node_modules/${name}`;
  if (packages[own] !== undefined) return own;
  const hoisted = `node_modules/${name}`;
  return packages[hoisted] === undefined ? undefined : hoisted;
}

/** Parentheses and case are the only differences the notices need to tolerate. */
function normaliseLicence(value) {
  return value
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/**
 * Title lines a `LICENSE` may begin with, mapped exactly. A title the table does
 * not name is a drift: guessing from the body would let a file that merely
 * mentions another licence pass as that licence.
 */
const LICENCE_TITLES = new Map([
  ["apache license version 2.0", "Apache-2.0"],
  ["apache 2.0", "Apache-2.0"],
  ["apache-2.0", "Apache-2.0"],
  ["mit", "MIT"],
  ["isc", "ISC"],
  ["bsd 3-clause", "BSD-3-Clause"],
  ["bsd-3-clause", "BSD-3-Clause"],
  ["modified bsd", "BSD-3-Clause"],
  ["bsd 2-clause", "BSD-2-Clause"],
  ["bsd-2-clause", "BSD-2-Clause"],
  ["simplified bsd", "BSD-2-Clause"],
  ["bsd 3-clause new or revised", "BSD-3-Clause"],
]);

/**
 * The title with only its decoration and aliases removed, lower-cased. Nothing
 * is matched partially: the result is looked up in the exact table above.
 */
function normaliseTitle(line) {
  return line
    .trim()
    .replace(/^[#*_\s]+/, "")
    .replace(/[#*_\s]+$/, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/^The\s+/i, "")
    .replace(/["“”]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/,\s*(?=version\b)/i, " ")
    .replace(/\s+licen[cs]e\s*[.:;!?]?\s*$/i, "")
    .replace(/[.:;!?,]+$/, "")
    .trim()
    .toLowerCase();
}

/** The licence a title line names, or `undefined` when the table cannot map it. */
function titleLicence(line) {
  return LICENCE_TITLES.get(normaliseTitle(line));
}

/** Non-empty lines of a LICENSE file, trimmed, in order. */
function nonEmptyLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/**
 * The licence the file's title block names. The title may wrap — Apache's file
 * starts `Apache License` and continues `Version 2.0, January 2004` — so the
 * second line is read only as part of the title, never as body text.
 */
function licenceFromTitle(text) {
  const lines = nonEmptyLines(text);
  if (lines.length === 0) return undefined;
  const first = titleLicence(lines[0]);
  if (first !== undefined) return first;
  if (lines.length < 2) return undefined;
  return titleLicence(`${lines[0]} ${lines[1].replace(/,\s*.*$/, "")}`);
}

/**
 * The text of a candidate licence file, or `undefined` when it is absent or is
 * not a regular file. A directory named `LICENSE` is a shape, not an error.
 */
function licenceFileText(file) {
  try {
    if (!statSync(file).isFile()) return undefined;
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * What is installed at a lockfile key. A missing manifest is the caller's
 * prerequisite failure; a manifest with no licence field falls back to the
 * title of its own `LICENSE` file.
 */
function installedFacts(dir) {
  let manifest;
  try {
    manifest = readJson(join(dir, "package.json"));
  } catch {
    return { missing: true };
  }

  let licence;
  let namedFile;
  let problem;
  if (typeof manifest.license === "string" && manifest.license.trim() !== "") {
    const declared = manifest.license.trim();
    // npm stores `SEE LICENSE IN <file>` in the licence field; the file's own
    // title is the evidence, and the name must stay inside the package.
    const seeIn = /^SEE LICEN[CS]E IN\b(.*)$/i.exec(declared);
    if (seeIn === null) {
      licence = declared;
    } else {
      namedFile = seeIn[1].trim();
      if (namedFile === "") {
        problem = 'its manifest says "SEE LICENSE IN" with no file to read';
        namedFile = undefined;
      } else if (namedFile.includes("..") || /[\\/]/.test(namedFile)) {
        problem = `its license field names "${namedFile}", which is not a file inside the package`;
        namedFile = undefined;
      }
    }
  } else if (Array.isArray(manifest.licenses)) {
    const types = manifest.licenses
      .map((entry) => (typeof entry === "string" ? entry : entry?.type))
      .filter((type) => typeof type === "string");
    if (types.length > 0) licence = types.join(" OR ");
  }

  if (licence === undefined && problem === undefined) {
    if (namedFile !== undefined) {
      const at = join(dir, namedFile);
      const text = licenceFileText(at);
      if (text === undefined) {
        let directory = false;
        try {
          directory = statSync(at).isDirectory();
        } catch {
          directory = false;
        }
        problem = directory
          ? `SEE LICENSE IN ${namedFile} names a directory, not a file`
          : `its license field names "${namedFile}", but the package has no such file`;
      } else {
        licence = licenceFromTitle(text);
        if (licence === undefined) {
          problem = `its manifest points at ${namedFile}, whose first line "${nonEmptyLines(text)[0] ?? ""}" the check cannot map`;
        }
      }
    } else {
      const text = ["LICENSE", "LICENSE.txt", "LICENSE.md"]
        .map((name) => licenceFileText(join(dir, name)))
        .find((candidate) => candidate !== undefined);
      if (text === undefined) {
        problem = "no declared licence field and no LICENSE file";
      } else {
        licence = licenceFromTitle(text);
        if (licence === undefined) {
          problem = `no declared licence field, and its LICENSE begins "${nonEmptyLines(text)[0] ?? ""}", which the check cannot map`;
        }
      }
    }
  }

  return { version: manifest.version, licence, problem };
}

/**
 * Every check the gate runs, against the tree rooted at `root`. Returns the
 * exit code and the lines to print, so its tests can assert on both without
 * the process exiting.
 */
export function checkTree(root) {
  const web = join(root, "src/web");
  const lockfile = join(web, "package-lock.json");
  const noticesFile = join(root, "THIRD-PARTY-NOTICES.md");

  let packages;
  let rows;
  let dependencies;
  try {
    packages = readJson(lockfile).packages ?? {};
    rows = parseNotices(readFileSync(noticesFile, "utf8"));
    dependencies = directDependencies(web);
  } catch (error) {
    return { exitCode: 2, lines: [`third-party: ${error.message}`] };
  }

  const declarations = dependencies.map((dependency) => ({
    ...dependency,
    key: resolveDependency(packages, dependency.workspace, dependency.name),
  }));

  // An incomplete install is a prerequisite, not a drift: the check cannot
  // judge a package it cannot read. A platform-optional package is expected to
  // be absent on another platform, so it is only unreadable, never fatal —
  // unless the same key is also a required declaration somewhere.
  const optionalByKey = new Map();
  for (const { key, optional } of declarations) {
    if (key === undefined) continue;
    optionalByKey.set(key, (optionalByKey.get(key) ?? true) && optional);
  }
  const installed = new Map();
  for (const { name, key } of declarations) {
    if (key === undefined || installed.has(key)) continue;
    const facts = installedFacts(join(web, key));
    if (facts.missing) {
      if (optionalByKey.get(key) === true) {
        installed.set(key, facts);
        continue;
      }
      return {
        exitCode: 2,
        lines: [
          `third-party: prerequisite: ${name} is not installed at ${key}; run npm install`,
        ],
      };
    }
    installed.set(key, facts);
  }

  const drifts = [];
  /** Optional packages installed on another platform: row checked, licence not. */
  const unreadable = [];

  // Every row must be consumed by exactly one resolved declaration; a row that
  // no workspace resolves is stale, and a second row for the same id is a
  // duplicate.
  const resolved = declarations.filter(({ key }) => key !== undefined);
  const resolvedIds = new Set(
    resolved.map(({ name, key }) => `${name}@${packages[key].version}`),
  );
  const resolvedNames = new Set(resolved.map(({ name }) => name));
  const seen = new Set();
  for (const row of rows) {
    const id = `${row.package}@${row.version}`;
    if (seen.has(id)) {
      drifts.push(`duplicate ${row.package} ${row.version}`);
      continue;
    }
    seen.add(id);
    if (resolvedIds.has(id)) continue;
    if (resolvedNames.has(row.package)) {
      drifts.push(
        `stale ${row.package} ${row.version}: THIRD-PARTY-NOTICES.md has a row, but no workspace resolves that version`,
      );
    } else {
      drifts.push(
        `stale ${row.package}: THIRD-PARTY-NOTICES.md has a row, but no workspace declares it`,
      );
    }
  }

  const checked = new Set();
  for (const { workspace, name, key } of declarations) {
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

    const facts = installed.get(key);

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
    if (facts.missing) {
      // The row and the lockfile version are all this platform can check: the
      // package is the optional binding for another OS.
      unreadable.push(`${name} ${version}`);
      continue;
    }
    if (facts.version !== version) {
      drifts.push(
        `installed ${name}: lockfile resolves ${version}, node_modules holds ${facts.version}`,
      );
    }
    if (facts.problem !== undefined) {
      drifts.push(`licence ${name} ${version}: ${facts.problem}`);
      continue;
    }
    if (normaliseLicence(row.licence) !== normaliseLicence(facts.licence)) {
      drifts.push(
        `licence ${name} ${version}: notices states ${row.licence}, installed package declares ${facts.licence}`,
      );
    }
  }

  if (drifts.length > 0) {
    return {
      exitCode: 1,
      lines: [
        ...drifts.map((drift) => `third-party: ${drift}`),
        `third-party: ${drifts.length} drift(s)`,
      ],
    };
  }
  return {
    exitCode: 0,
    lines: [
      "third-party: every direct dependency matches its notice",
      ...(unreadable.length === 0
        ? []
        : [
            `third-party: licence not read here for ${unreadable.join(", ")} (optional package for another platform)`,
          ]),
    ],
  };
}

/** Runs the check against the repository this script lives in. */
function main() {
  const { exitCode, lines } = checkTree(ROOT);
  const stream = exitCode === 0 ? process.stdout : process.stderr;
  for (const line of lines) stream.write(`${line}\n`);
  return exitCode;
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  process.exit(main());
}
