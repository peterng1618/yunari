#!/usr/bin/env node

/**
 * The self-test for `check-third-party.mjs`: a fixture workspace and the cases
 * that pin what the checker reports for it. Run through that script's
 * `--self-test` flag, so the gate keeps a single entry point.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkTree } from "./check-third-party.mjs";

const ROWS_HEADER = "| Package | Version | Licence |\n|---|---|---|\n";
const NOTICES_CLEAN =
  `${ROWS_HEADER}` +
  "| `alpha` | 1.0.0 | MIT |\n" +
  "| `beta` | 2.0.0 | MIT |\n" +
  "| `gamma` | 3.0.0 | BSD-3-Clause |\n";

/**
 * A workspace tree small enough to read, shaped like the real one: a root
 * manifest listing two workspaces, a lockfile with three hoisted packages, and
 * installed manifests. `gamma` deliberately declares no licence field and ships
 * a LICENSE whose title is BSD 3-Clause while its body mentions the MIT License.
 */
function writeFixture(root, mutate = () => {}) {
  const files = new Map();
  const web = join(root, "src/web");
  files.set(join(web, "package.json"), {
    name: "fixture",
    private: true,
    workspaces: ["packages/a", "packages/b"],
  });
  files.set(join(web, "packages/a/package.json"), {
    name: "@yunari/a",
    version: "0.0.0",
    dependencies: { alpha: "1.0.0", beta: "2.0.0" },
  });
  files.set(join(web, "packages/b/package.json"), {
    name: "@yunari/b",
    version: "0.0.0",
    dependencies: { alpha: "1.0.0", gamma: "3.0.0" },
  });
  files.set(join(web, "package-lock.json"), {
    lockfileVersion: 3,
    packages: {
      "node_modules/alpha": { version: "1.0.0" },
      "node_modules/beta": { version: "2.0.0" },
      "node_modules/gamma": { version: "3.0.0" },
    },
  });
  files.set(join(web, "node_modules/alpha/package.json"), {
    name: "alpha",
    version: "1.0.0",
    license: "MIT",
  });
  files.set(join(web, "node_modules/beta/package.json"), {
    name: "beta",
    version: "2.0.0",
    license: "MIT",
  });
  files.set(join(web, "node_modules/gamma/package.json"), {
    name: "gamma",
    version: "3.0.0",
  });
  files.set(
    join(web, "node_modules/gamma/LICENSE"),
    "BSD 3-Clause License\n\nRedistribution and use is permitted.\nThis product includes software licensed under the MIT License.\n",
  );
  files.set(join(root, "THIRD-PARTY-NOTICES.md"), NOTICES_CLEAN);

  mutate({ files, web, root });

  for (const [file, body] of files) {
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, typeof body === "string" ? body : `${JSON.stringify(body, null, 2)}\n`);
  }
}

/** Runs one fixture case in its own tree and removes it afterwards. */
function withFixture(mutate, assert) {
  const root = mkdtempSync(join(tmpdir(), "third-party-self-test-"));
  try {
    writeFixture(root, mutate);
    const result = checkTree(root);
    return assert(result);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Runs every case, printing one line each; returns the number that failed. */
export function selfTest() {
  const cases = [
    [
      "passes a clean tree",
      () =>
        withFixture(undefined, ({ exitCode, lines }) => {
          return (
            exitCode === 0 &&
            lines.every((line) => !line.includes("drift"))
          );
        }),
    ],
    [
      "names a dependency with no row",
      () =>
        withFixture(
          ({ files, root }) =>
            files.set(
              join(root, "THIRD-PARTY-NOTICES.md"),
              NOTICES_CLEAN.replace(/^\| `alpha` \|.*\n/m, ""),
            ),
          ({ exitCode, lines }) =>
            exitCode === 1 && lines.some((line) => line.includes("missing alpha")),
        ),
    ],
    [
      "names a version the lockfile does not resolve",
      () =>
        withFixture(
          ({ files, root }) =>
            files.set(
              join(root, "THIRD-PARTY-NOTICES.md"),
              NOTICES_CLEAN.replace("| `alpha` | 1.0.0 |", "| `alpha` | 0.9.0 |"),
            ),
          ({ exitCode, lines }) =>
            exitCode === 1 &&
            lines.some(
              (line) =>
                line.includes("version alpha") &&
                line.includes("0.9.0") &&
                line.includes("1.0.0"),
            ),
        ),
    ],
    [
      "names a licence the manifest does not declare",
      () =>
        withFixture(
          ({ files, root }) =>
            files.set(
              join(root, "THIRD-PARTY-NOTICES.md"),
              NOTICES_CLEAN.replace("| `beta` | 2.0.0 | MIT |", "| `beta` | 2.0.0 | Apache-2.0 |"),
            ),
          ({ exitCode, lines }) =>
            exitCode === 1 &&
            lines.some(
              (line) =>
                line.includes("licence beta") &&
                line.includes("Apache-2.0") &&
                line.includes("MIT"),
            ),
        ),
    ],
    [
      "names an installed version that is not the lockfile's",
      () =>
        withFixture(
          ({ files, web }) =>
            files.set(join(web, "node_modules/alpha/package.json"), {
              name: "alpha",
              version: "9.9.9",
              license: "MIT",
            }),
          ({ exitCode, lines }) =>
            exitCode === 1 &&
            lines.some(
              (line) =>
                line.includes("installed alpha") &&
                line.includes("1.0.0") &&
                line.includes("9.9.9"),
            ),
        ),
    ],
    [
      "refuses an incomplete install as a prerequisite",
      () =>
        withFixture(
          ({ files, web }) => {
            const beta = join(web, "node_modules/beta");
            for (const [file] of files) {
              if (file.startsWith(beta)) files.delete(file);
            }
          },
          ({ exitCode, lines }) =>
            exitCode === 2 &&
            lines.some(
              (line) => line.includes("prerequisite:") && line.includes("beta"),
            ),
        ),
    ],
    [
      "names a stale row for a package no workspace declares",
      () =>
        withFixture(
          ({ files, root }) =>
            files.set(
              join(root, "THIRD-PARTY-NOTICES.md"),
              `${NOTICES_CLEAN}| \`delta\` | 9.9.9 | MIT |\n`,
            ),
          ({ exitCode, lines }) =>
            exitCode === 1 && lines.some((line) => line.includes("stale delta")),
        ),
    ],
    [
      "names a duplicate row",
      () =>
        withFixture(
          ({ files, root }) =>
            files.set(
              join(root, "THIRD-PARTY-NOTICES.md"),
              `${NOTICES_CLEAN}| \`alpha\` | 1.0.0 | MIT |\n`,
            ),
          ({ exitCode, lines }) =>
            exitCode === 1 &&
            lines.some((line) => line.includes("duplicate alpha 1.0.0")),
        ),
    ],
    [
      "does not read a licence out of a LICENSE body",
      () =>
        withFixture(
          ({ files, root }) =>
            files.set(
              join(root, "THIRD-PARTY-NOTICES.md"),
              NOTICES_CLEAN.replace("| `gamma` | 3.0.0 | BSD-3-Clause |", "| `gamma` | 3.0.0 | MIT |"),
            ),
          ({ exitCode, lines }) =>
            exitCode === 1 && lines.some((line) => line.includes("licence gamma")),
        ),
    ],
    [
      "maps the LICENSE title to its licence",
      () =>
        withFixture(undefined, ({ exitCode }) => exitCode === 0),
    ],
    [
      "accepts a title with a parenthesised alias",
      () =>
        withFixture(
          ({ files, web, root }) => {
            files.set(
              join(web, "node_modules/gamma/LICENSE"),
              "The MIT License (MIT)\n\nPermission is hereby granted, free of charge.\n",
            );
            files.set(
              join(root, "THIRD-PARTY-NOTICES.md"),
              NOTICES_CLEAN.replace(
                "| `gamma` | 3.0.0 | BSD-3-Clause |",
                "| `gamma` | 3.0.0 | MIT |",
              ),
            );
          },
          ({ exitCode }) => exitCode === 0,
        ),
    ],
    [
      "accepts the OSI BSD title with quoted words",
      () =>
        withFixture(
          ({ files, web }) =>
            files.set(
              join(web, "node_modules/gamma/LICENSE"),
              'BSD 3-Clause "New" or "Revised" License\n\nRedistribution and use is permitted.\n',
            ),
          ({ exitCode }) => exitCode === 0,
        ),
    ],
    [
      "reads the file named by SEE LICENSE IN",
      () =>
        withFixture(
          ({ files, web, root }) => {
            files.set(join(web, "node_modules/gamma/package.json"), {
              name: "gamma",
              version: "3.0.0",
              license: "SEE LICENSE IN LICENSE",
            });
            files.set(
              join(web, "node_modules/gamma/LICENSE"),
              "MIT License\n\nPermission is hereby granted, free of charge.\n",
            );
            files.set(
              join(root, "THIRD-PARTY-NOTICES.md"),
              NOTICES_CLEAN.replace(
                "| `gamma` | 3.0.0 | BSD-3-Clause |",
                "| `gamma` | 3.0.0 | MIT |",
              ),
            );
          },
          ({ exitCode }) => exitCode === 0,
        ),
    ],
    [
      "refuses a SEE LICENSE IN name that is a directory",
      () =>
        withFixture(
          ({ files, web }) => {
            files.set(join(web, "node_modules/gamma/package.json"), {
              name: "gamma",
              version: "3.0.0",
              license: "SEE LICENSE IN docs",
            });
            files.set(join(web, "node_modules/gamma/docs/note.txt"), "x");
          },
          ({ exitCode, lines }) =>
            exitCode === 1 &&
            lines.some((line) =>
              line.includes("SEE LICENSE IN docs names a directory, not a file"),
            ),
        ),
    ],
    [
      "refuses a bare SEE LICENSE IN instead of treating it as a licence",
      () =>
        withFixture(
          ({ files, web, root }) => {
            files.set(join(web, "node_modules/gamma/package.json"), {
              name: "gamma",
              version: "3.0.0",
              license: "SEE LICENSE IN",
            });
            files.set(
              join(root, "THIRD-PARTY-NOTICES.md"),
              NOTICES_CLEAN.replace(
                "| `gamma` | 3.0.0 | BSD-3-Clause |",
                "| `gamma` | 3.0.0 | SEE LICENSE IN |",
              ),
            );
          },
          ({ exitCode, lines }) =>
            exitCode === 1 &&
            lines.some((line) =>
              line.includes(
                'its manifest says "SEE LICENSE IN" with no file to read',
              ),
            ),
        ),
    ],
    [
      "names the SEE LICENSE IN file it could not map",
      () =>
        withFixture(
          ({ files, web }) => {
            files.set(join(web, "node_modules/gamma/package.json"), {
              name: "gamma",
              version: "3.0.0",
              license: "SEE LICENSE IN LEGAL",
            });
            files.set(
              join(web, "node_modules/gamma/LEGAL"),
              "Proprietary Terms\n\nAll rights reserved.\n",
            );
          },
          ({ exitCode, lines }) =>
            exitCode === 1 &&
            lines.some(
              (line) =>
                line.includes("its manifest points at LEGAL") &&
                line.includes("Proprietary Terms"),
            ),
        ),
    ],
  ];

  let failed = 0;
  for (const [name, run] of cases) {
    const ok = run();
    if (!ok) failed += 1;
    process.stdout.write(`${ok ? "ok  " : "FAIL"} ${name}\n`);
  }
  if (failed > 0) {
    process.stderr.write(`third-party self-test: ${failed} case(s) wrong\n`);
    return 1;
  }
  process.stdout.write(
    `third-party self-test: all ${cases.length} cases behave\n`,
  );
  return 0;
}