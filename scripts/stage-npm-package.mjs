#!/usr/bin/env node

/**
 * Assembles the `yunari` npm package outside the repository.
 *
 * The staged tree mirrors the workspace — `packages/host/{bin,dist,public}`,
 * `packages/player/dist`, `packages/editor/dist` and `schema/` — so the bin
 * shim's `../dist/main.js`, the launcher's `packagesDir` and `productVersion()`
 * resolve without a production path change (decision 0111).
 *
 * `node scripts/stage-npm-package.mjs --out <dir> [--expect-version <version>]
 *   [--source <repo>]`
 *
 * The output must be outside the source tree and empty or absent: a release
 * stages into a fresh directory, never over a previous run.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** The five packages the built host bundle imports by bare specifier. The
 *  workspace manifests declare three; `culori` and `fflate` arrive through
 *  renderer-core/theme-package, and the staged manifest must still name them or
 *  an installed host fails with ERR_MODULE_NOT_FOUND (decision 0111, rung 6). */
export const RUNTIME_DEPENDENCIES = [
  "culori",
  "fflate",
  "ffmpeg-static",
  "node-forge",
  "systeminformation",
];

/** Source path → staged path. Directories copy recursively. */
const COPY = [
  ["LICENSE", "LICENSE"],
  ["THIRD-PARTY-NOTICES.md", "THIRD-PARTY-NOTICES.md"],
  ["src/web/packages/host/bin", "packages/host/bin"],
  ["src/web/packages/host/dist", "packages/host/dist"],
  ["src/web/packages/host/public", "packages/host/public"],
  ["src/web/packages/player/dist", "packages/player/dist"],
  ["src/web/packages/editor/dist", "packages/editor/dist"],
  ["schema", "schema"],
];

/** The two entry points whose absence makes the installed package unrunnable. */
const REQUIRED = [
  ["src/web/packages/host/bin/yunari.js", "packages/host/bin/yunari.js"],
  ["src/web/packages/host/dist/main.js", "packages/host/dist/main.js"],
];

const MANIFEST = ["src/web/package.json", "package.json"];

function count(dir) {
  let files = 0;
  let bytes = 0;
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const child = join(current, entry.name);
      if (entry.isDirectory()) walk(child);
      else {
        files += 1;
        bytes += statSync(child).size;
      }
    }
  };
  walk(dir);
  return { files, bytes };
}

function inside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Copies a source tree into a new package directory and writes the release
 * manifest. Returns `{ ok: false, errors }` rather than throwing, so the CLI
 * owns exit codes and the tests drive the decisions directly.
 */
export function stagePackage({ source, out, version, expectVersion, dependencies = {} }) {
  const errors = [];

  if (typeof source !== "string" || typeof out !== "string") {
    return { ok: false, errors: ["source and out are required"] };
  }
  if (typeof version !== "string" || version === "") {
    return { ok: false, errors: ["version is required"] };
  }
  if (inside(source, out)) {
    errors.push(`out ${out} is inside the source tree; stage outside the repository`);
  }
  if (expectVersion !== undefined && expectVersion !== version) {
    errors.push(
      `expected version ${expectVersion} does not match manifest version ${version}`,
    );
  }

  const manifestPath = resolve(source, MANIFEST[0]);
  if (!existsSync(manifestPath)) {
    errors.push(`missing required path: ${MANIFEST[1]} (from ${MANIFEST[0]})`);
  } else {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
      errors.push(`unreadable ${MANIFEST[1]} (from ${MANIFEST[0]}): ${error.message}`);
    }
    if (manifest !== undefined && manifest.version !== version) {
      errors.push(
        `manifest version ${manifest.version} does not match requested version ${version}`,
      );
    }
  }

  const seen = new Set();
  const missing = (staged, from) => {
    if (seen.has(staged)) return;
    seen.add(staged);
    errors.push(
      staged === from
        ? `missing required path: ${staged}`
        : `missing required path: ${staged} (from ${from})`,
    );
  };
  for (const [from, staged] of REQUIRED) {
    if (!existsSync(resolve(source, from))) missing(staged, from);
  }
  for (const [from, staged] of COPY) {
    if (!existsSync(resolve(source, from))) missing(staged, from);
  }

  if (errors.length > 0) return { ok: false, errors };

  if (existsSync(out) && !statSync(out).isDirectory()) {
    return { ok: false, errors: [`out ${out} exists and is not a directory`] };
  }
  if (existsSync(out) && readdirSync(out).length > 0) {
    return { ok: false, errors: [`out ${out} is not empty; stage into a fresh directory`] };
  }

  try {
    mkdirSync(out, { recursive: true });
    for (const [from, staged] of COPY) {
      cpSync(resolve(source, from), join(out, staged), { recursive: true });
    }
    writeFileSync(
      join(out, "package.json"),
      `${JSON.stringify(
        {
          name: "yunari",
          version,
          description: "The Yunari PC dashboard host.",
          license: "MIT",
          type: "module",
          bin: { yunari: "packages/host/bin/yunari.js" },
          engines: { node: ">=22" },
          dependencies,
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    return { ok: false, errors: [`staging failed: ${error.message}`] };
  }

  const { files, bytes } = count(out);
  return { ok: true, version, files, bytes };
}

/** Ranges from the lockfile's resolved versions, so the declaration matches the
 *  tree the bundles were built from rather than a hand-kept copy. */
export function runtimeDependencies(lockfile) {
  const lock = JSON.parse(readFileSync(lockfile, "utf8"));
  const declared = {};
  for (const name of RUNTIME_DEPENDENCIES) {
    const resolved = lock.packages?.[`node_modules/${name}`]?.version;
    if (resolved === undefined) {
      throw new Error(`${name} has no resolved version in ${lockfile}`);
    }
    declared[name] = `^${resolved}`;
  }
  return declared;
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (name, required = false) => {
    const at = argv.indexOf(name);
    if (at < 0) {
      if (required) throw new Error(`${name} is required`);
      return undefined;
    }
    const value = argv[at + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${name} needs a value`);
    }
    return value;
  };

  try {
    const source = resolve(flag("--source") ?? resolve(import.meta.dirname, ".."));
    const out = flag("--out", true);
    const expectVersion = flag("--expect-version");
    const version = JSON.parse(
      readFileSync(resolve(source, MANIFEST[0]), "utf8"),
    ).version;
    const dependencies = runtimeDependencies(
      resolve(source, "src/web/package-lock.json"),
    );
    const result = stagePackage({
      source,
      out: resolve(out),
      version,
      expectVersion,
      dependencies,
    });

    if (!result.ok) {
      for (const error of result.errors) process.stderr.write(`stage: ${error}\n`);
      process.exit(1);
    }
    const mb = (result.bytes / 1024 / 1024).toFixed(1);
    process.stdout.write(
      `staged yunari@${result.version}: ${result.files} files, ${mb} MB in ${resolve(out)}\n`,
    );
  } catch (error) {
    process.stderr.write(`stage: ${error.message}\n`);
    process.exit(2);
  }
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main();
}
