#!/usr/bin/env node

/**
 * Assembles the `yunari` npm package outside the repository.
 *
 * The staged tree mirrors the workspace — `packages/host/{bin,dist,public}`,
 * `packages/player/dist`, `packages/editor/dist` and `schema/` — so the bin
 * shim's `../dist/main.js`, the launcher's `packagesDir` and `productVersion()`
 * resolve without a production path change.
 *
 * `node scripts/stage-npm-package.mjs --out <dir> [--mcp-out <dir>]
 *   [--expect-version <version>] [--source <repo>]`
 *
 * `--mcp-out` stages the standalone `yunari-mcp` package from the same build.
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
 *  an installed host fails with ERR_MODULE_NOT_FOUND (rung 6). */
export const RUNTIME_DEPENDENCIES = [
  "culori",
  "fflate",
  "ffmpeg-static",
  "node-forge",
  "systeminformation",
];

/** The MCP server's bare imports, which its SSR build leaves external. */
export const MCP_DEPENDENCIES = [
  "@modelcontextprotocol/server",
  "add-mcp",
  "culori",
  "skills",
  "zod",
];

/** Source path → staged path. Directories copy recursively. */
const COPY = [
  ["LICENSE", "LICENSE"],
  ["THIRD-PARTY-NOTICES.md", "THIRD-PARTY-NOTICES.md"],
  ["src/web/packages/host/bin", "packages/host/bin"],
  ["src/web/packages/host/dist", "packages/host/dist"],
  ["src/web/packages/host/public", "packages/host/public"],
  // The host resolves `<dist>/../vendor/weather-icons` at run time (server.ts),
  // so the icons are runtime bytes, not optional binaries. Copy that directory
  // by name, not `vendor/`: the rest of it is ignored, and a local
  // `vendor:lhm` run would otherwise publish those binaries from a dev box.
  [
    "src/web/packages/host/vendor/weather-icons",
    "packages/host/vendor/weather-icons",
  ],
  ["src/web/packages/player/dist", "packages/player/dist"],
  ["src/web/packages/editor/dist", "packages/editor/dist"],
  ["src/web/packages/mcp/bin", "packages/mcp/bin"],
  ["src/web/packages/mcp/dist", "packages/mcp/dist"],
  [
    "skills/yunari-theme-designer",
    "packages/mcp/skills/yunari-theme-designer",
  ],
  ["schema", "schema"],
];

/** The two entry points whose absence makes the installed package unrunnable. */
const REQUIRED = [
  ["src/web/packages/host/bin/yunari.js", "packages/host/bin/yunari.js"],
  ["src/web/packages/host/dist/main.js", "packages/host/dist/main.js"],
  ["src/web/packages/mcp/bin/yunari-mcp.js", "packages/mcp/bin/yunari-mcp.js"],
  ["src/web/packages/mcp/dist/main.js", "packages/mcp/dist/main.js"],
  ["skills/yunari-theme-designer/SKILL.md", "packages/mcp/skills/yunari-theme-designer/SKILL.md"],
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
export function stagePackage({
  source,
  out,
  version,
  expectVersion,
  dependencies = {},
}) {
  const errors = [];

  if (typeof source !== "string" || typeof out !== "string") {
    return { ok: false, errors: ["source and out are required"] };
  }
  if (typeof version !== "string" || version === "") {
    return { ok: false, errors: ["version is required"] };
  }
  if (inside(source, out)) {
    errors.push(
      `out ${out} is inside the source tree; stage outside the repository`,
    );
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
      errors.push(
        `unreadable ${MANIFEST[1]} (from ${MANIFEST[0]}): ${error.message}`,
      );
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
    return {
      ok: false,
      errors: [`out ${out} is not empty; stage into a fresh directory`],
    };
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
          bin: {
            yunari: "packages/host/bin/yunari.js",
            "yunari-mcp": "packages/mcp/bin/yunari-mcp.js",
          },
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

/** Source path → staged path for the standalone MCP package. */
const MCP_COPY = [
  ["LICENSE", "LICENSE"],
  ["THIRD-PARTY-NOTICES.md", "THIRD-PARTY-NOTICES.md"],
  ["src/web/packages/mcp/bin", "bin"],
  ["src/web/packages/mcp/dist", "dist"],
  ["skills/yunari-theme-designer", "skills/yunari-theme-designer"],
];

const MCP_REQUIRED = [
  ["src/web/packages/mcp/bin/yunari-mcp.js", "bin/yunari-mcp.js"],
  ["src/web/packages/mcp/dist/main.js", "dist/main.js"],
  [
    "skills/yunari-theme-designer/SKILL.md",
    "skills/yunari-theme-designer/SKILL.md",
  ],
];

/**
 * Stages the standalone `yunari-mcp` package: the same build and skill the
 * bundle carries, with its own name, bin and dependency list. The two packages
 * share a version, so one tag publishes a matching pair.
 */
export function stageMcpPackage({
  source,
  out,
  version,
  expectVersion,
  dependencies = {},
}) {
  const errors = [];

  if (typeof source !== "string" || typeof out !== "string") {
    return { ok: false, errors: ["source and out are required"] };
  }
  if (typeof version !== "string" || version === "") {
    return { ok: false, errors: ["version is required"] };
  }
  if (inside(source, out)) {
    errors.push(
      `out ${out} is inside the source tree; stage outside the repository`,
    );
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
      errors.push(
        `unreadable ${MANIFEST[1]} (from ${MANIFEST[0]}): ${error.message}`,
      );
    }
    if (manifest !== undefined && manifest.version !== version) {
      errors.push(
        `manifest version ${manifest.version} does not match requested version ${version}`,
      );
    }
  }

  for (const [from, staged] of MCP_REQUIRED) {
    if (!existsSync(resolve(source, from))) {
      errors.push(`missing required path: ${staged} (from ${from})`);
    }
  }

  if (existsSync(out) && !statSync(out).isDirectory()) {
    errors.push(`out ${out} exists and is not a directory`);
  } else if (existsSync(out) && readdirSync(out).length > 0) {
    errors.push(`out ${out} is not empty; stage into a fresh directory`);
  }
  if (errors.length > 0) return { ok: false, errors };

  try {
    mkdirSync(out, { recursive: true });
    for (const [from, staged] of MCP_COPY) {
      cpSync(resolve(source, from), join(out, staged), { recursive: true });
    }
    writeFileSync(
      join(out, "package.json"),
      `${JSON.stringify(
        {
          name: "yunari-mcp",
          version,
          description:
            "stdio MCP server that designs Yunari themes against a loopback host.",
          license: "MIT",
          type: "module",
          bin: { "yunari-mcp": "bin/yunari-mcp.js" },
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

/** Exact versions from the lockfile's resolved entries, so the staged manifest
 *  names the tree the bundles were built from. A range would let a consumer
 *  install a version this repository never tested. */
export function runtimeDependencies(lockfile, names = RUNTIME_DEPENDENCIES) {
  const lock = JSON.parse(readFileSync(lockfile, "utf8"));
  const declared = {};
  for (const name of names) {
    const resolved = lock.packages?.[`node_modules/${name}`]?.version;
    if (resolved === undefined) {
      throw new Error(`${name} has no resolved version in ${lockfile}`);
    }
    declared[name] = resolved;
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
    const source = resolve(
      flag("--source") ?? resolve(import.meta.dirname, ".."),
    );
    const out = flag("--out", true);
    const mcpOut = flag("--mcp-out");
    const expectVersion = flag("--expect-version");
    const version = JSON.parse(
      readFileSync(resolve(source, MANIFEST[0]), "utf8"),
    ).version;
    const lockfile = resolve(source, "src/web/package-lock.json");
    const dependencies = runtimeDependencies(lockfile);
    if (mcpOut !== undefined && resolve(mcpOut) === resolve(out)) {
      throw new Error("--mcp-out must differ from --out");
    }
    const result = stagePackage({
      source,
      out: resolve(out),
      version,
      expectVersion,
      dependencies: {
        ...dependencies,
        ...runtimeDependencies(lockfile, MCP_DEPENDENCIES),
      },
    });

    if (!result.ok) {
      for (const error of result.errors)
        process.stderr.write(`stage: ${error}\n`);
      process.exit(1);
    }
    const mb = (result.bytes / 1024 / 1024).toFixed(1);
    process.stdout.write(
      `staged yunari@${result.version}: ${result.files} files, ${mb} MB in ${resolve(out)}\n`,
    );

    if (mcpOut !== undefined) {
      const mcp = stageMcpPackage({
        source,
        out: resolve(mcpOut),
        version,
        expectVersion,
        dependencies: runtimeDependencies(lockfile, MCP_DEPENDENCIES),
      });
      if (!mcp.ok) {
        for (const error of mcp.errors)
          process.stderr.write(`stage: ${error}\n`);
        process.exit(1);
      }
      const mcpMb = (mcp.bytes / 1024 / 1024).toFixed(1);
      process.stdout.write(
        `staged yunari-mcp@${mcp.version}: ${mcp.files} files, ${mcpMb} MB in ${resolve(mcpOut)}\n`,
      );
    }
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
