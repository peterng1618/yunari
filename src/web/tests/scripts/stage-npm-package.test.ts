import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
// The script lives at the repository root, four levels above this file:
// src/web/tests/scripts → ../../../.. = repo root.
import {
  RUNTIME_DEPENDENCIES,
  stagePackage,
} from "../../../../scripts/stage-npm-package.mjs";

/**
 * The staged package is the workspace layout, copied outside the repo. These
 * cases prove the copy list, the manifest's version and bin target, and the two
 * refusals a release must make — a version that does not match the tag and a
 * missing host build — through both the pure function and the CLI's exit code.
 */

const REPO = path.resolve(import.meta.dirname, "../../../..");
const SCRIPT = path.join(REPO, "scripts/stage-npm-package.mjs");
const VERSION = "9.9.9";
const DEPENDENCIES = {
  "node-forge": "^1.4.0",
  fflate: "^0.8.3",
};

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0)
    rmSync(temps.pop() as string, { recursive: true, force: true });
});

type Fake = { root: string; source: string; out: string };

/** A source tree shaped like the repository, so the copy list is exercised whole. */
function fakeTree({ main = true } = {}): Fake {
  const root = mkdtempSync(path.join(os.tmpdir(), "yunari-stage-"));
  temps.push(root);
  const source = path.join(root, "source");
  const write = (rel: string, body = "x"): void => {
    const file = path.join(source, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
  };

  write("LICENSE", "license");
  write("THIRD-PARTY-NOTICES.md", "notices");
  write("schema/theme-document.schema.json", "{}");
  write(
    "src/web/package.json",
    JSON.stringify({ name: "yunari-web", version: VERSION }),
  );
  write(
    "src/web/package-lock.json",
    JSON.stringify({
      packages: Object.fromEntries(
        RUNTIME_DEPENDENCIES.map((name, index) => [
          `node_modules/${name}`,
          { version: `1.0.${index}` },
        ]),
      ),
    }),
  );
  write(
    "src/web/packages/host/bin/yunari.js",
    "#!/usr/bin/env node\nimport('../dist/main.js');\n",
  );
  if (main) write("src/web/packages/host/dist/main.js", "export {};\n");
  write("src/web/packages/host/public/index.html", "<!doctype html>");
  write("src/web/packages/player/dist/index.html", "<!doctype html>");
  write("src/web/packages/editor/dist/index.html", "<!doctype html>");

  return { root, source, out: path.join(root, "out") };
}

const stage = (tree: Fake, extra: Record<string, unknown> = {}) =>
  stagePackage({
    source: tree.source,
    out: tree.out,
    version: VERSION,
    dependencies: DEPENDENCIES,
    ...extra,
  });

it("copies every required path into the workspace layout", () => {
  const tree = fakeTree();
  const result = stage(tree);
  expect(result.ok).toBe(true);

  for (const rel of [
    "LICENSE",
    "THIRD-PARTY-NOTICES.md",
    "packages/host/bin/yunari.js",
    "packages/host/dist/main.js",
    "packages/host/public/index.html",
    "packages/player/dist/index.html",
    "packages/editor/dist/index.html",
    "schema/theme-document.schema.json",
  ]) {
    expect(existsSync(path.join(tree.out, rel)), rel).toBe(true);
  }
});

it("writes the source manifest's version and the release manifest fields", () => {
  const tree = fakeTree();
  expect(stage(tree).ok).toBe(true);

  const source = JSON.parse(
    readFileSync(path.join(tree.source, "src/web/package.json"), "utf8"),
  );
  const staged = JSON.parse(
    readFileSync(path.join(tree.out, "package.json"), "utf8"),
  );

  expect(staged.version).toBe(source.version);
  expect(staged.name).toBe("yunari");
  expect(staged.type).toBe("module");
  expect(staged.license).toBe("MIT");
  expect(staged.engines).toEqual({ node: ">=22" });
  expect(staged.dependencies).toEqual(DEPENDENCIES);
});

it("resolves the staged bin target to ../dist/main.js", () => {
  const tree = fakeTree();
  expect(stage(tree).ok).toBe(true);

  const staged = JSON.parse(
    readFileSync(path.join(tree.out, "package.json"), "utf8"),
  );
  const bin = path.join(tree.out, staged.bin.yunari);
  expect(existsSync(bin)).toBe(true);
  expect(existsSync(path.resolve(path.dirname(bin), "../dist/main.js"))).toBe(
    true,
  );
});

it("refuses an --expect-version that does not match the manifest", () => {
  const tree = fakeTree();
  const result = stage(tree, { expectVersion: "0.0.1" });

  expect(result.ok).toBe(false);
  const errors = result.ok ? "" : result.errors.join("\n");
  expect(errors).toContain(VERSION);
  expect(errors).toContain("0.0.1");
});

it("names a missing host build", () => {
  const tree = fakeTree({ main: false });
  const result = stage(tree);

  expect(result.ok).toBe(false);
  const errors = result.ok ? "" : result.errors.join("\n");
  expect(errors).toContain("packages/host/dist/main.js");
});

it("refuses an output directory inside the source tree", () => {
  const tree = fakeTree();
  const result = stage(tree, { out: path.join(tree.source, "staged") });

  expect(result.ok).toBe(false);
  const errors = result.ok ? "" : result.errors.join("\n");
  expect(errors).toMatch(/inside|outside/i);
});

it("exits 0 on the CLI and non-zero for a mismatched version or a missing build", () => {
  const tree = fakeTree();
  const run = (source: string, out: string, expectVersion: string) =>
    spawnSync(
      process.execPath,
      [
        SCRIPT,
        "--source",
        source,
        "--out",
        out,
        "--expect-version",
        expectVersion,
      ],
      { encoding: "utf8" },
    );

  const good = run(tree.source, tree.out, VERSION);
  expect(good.status, good.stderr).toBe(0);

  const mismatch = run(tree.source, path.join(tree.root, "out-2"), "0.0.1");
  expect(mismatch.status).not.toBe(0);
  expect(mismatch.stderr).toContain("0.0.1");

  const broken = fakeTree({ main: false });
  const missing = run(broken.source, broken.out, VERSION);
  expect(missing.status).not.toBe(0);
  expect(missing.stderr).toContain("packages/host/dist/main.js");
});
