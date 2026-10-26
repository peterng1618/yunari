import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
// The script lives at the repository root, four levels above this file:
// src/web/tests/scripts → ../../../.. = repo root.
import { checkTree } from "../../../../scripts/check-third-party.mjs";

/**
 * The third-party notices check's own proof: one fixture workspace per case,
 * written under `os.tmpdir()` and removed afterwards. The tree is shaped like
 * the real one — a root manifest listing two workspaces, a lockfile with three
 * hoisted packages, and installed manifests — so the check walks a real
 * filesystem path rather than a stubbed one.
 */

const ROWS_HEADER = "| Package | Version | Licence |\n|---|---|---|\n";
const NOTICES_CLEAN =
  `${ROWS_HEADER}` +
  "| `alpha` | 1.0.0 | MIT |\n" +
  "| `beta` | 2.0.0 | MIT |\n" +
  "| `gamma` | 3.0.0 | BSD-3-Clause |\n";

type Fixture = {
  files: Map<string, string | Record<string, unknown>>;
  web: string;
  root: string;
};
type Mutate = (fixture: Fixture) => void;
type Result = { exitCode: number; lines: string[] };

/**
 * `gamma` deliberately declares no licence field and ships a LICENSE whose title
 * is BSD 3-Clause while its body mentions the MIT License.
 */
function writeFixture(root: string, mutate: Mutate = () => {}): void {
  const files: Fixture["files"] = new Map();
  const web = path.join(root, "src/web");
  files.set(path.join(web, "package.json"), {
    name: "fixture",
    private: true,
    workspaces: ["packages/a", "packages/b"],
  });
  files.set(path.join(web, "packages/a/package.json"), {
    name: "@yunari/a",
    version: "0.0.0",
    dependencies: { alpha: "1.0.0", beta: "2.0.0" },
  });
  files.set(path.join(web, "packages/b/package.json"), {
    name: "@yunari/b",
    version: "0.0.0",
    dependencies: { alpha: "1.0.0", gamma: "3.0.0" },
  });
  files.set(path.join(web, "package-lock.json"), {
    lockfileVersion: 3,
    packages: {
      "node_modules/alpha": { version: "1.0.0" },
      "node_modules/beta": { version: "2.0.0" },
      "node_modules/gamma": { version: "3.0.0" },
    },
  });
  files.set(path.join(web, "node_modules/alpha/package.json"), {
    name: "alpha",
    version: "1.0.0",
    license: "MIT",
  });
  files.set(path.join(web, "node_modules/beta/package.json"), {
    name: "beta",
    version: "2.0.0",
    license: "MIT",
  });
  files.set(path.join(web, "node_modules/gamma/package.json"), {
    name: "gamma",
    version: "3.0.0",
  });
  files.set(
    path.join(web, "node_modules/gamma/LICENSE"),
    "BSD 3-Clause License\n\nRedistribution and use is permitted.\nThis product includes software licensed under the MIT License.\n",
  );
  files.set(path.join(root, "THIRD-PARTY-NOTICES.md"), NOTICES_CLEAN);

  mutate({ files, web, root });

  for (const [file, body] of files) {
    mkdirSync(path.join(file, ".."), { recursive: true });
    writeFileSync(
      file,
      typeof body === "string" ? body : `${JSON.stringify(body, null, 2)}\n`,
    );
  }
}

/** Runs one case in its own tree and removes it afterwards. */
function withFixture(
  mutate: Mutate | undefined,
  assert: (r: Result) => void,
): void {
  const root = mkdtempSync(path.join(os.tmpdir(), "third-party-check-"));
  try {
    writeFixture(root, mutate);
    assert(checkTree(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

it("passes a clean tree", () => {
  withFixture(undefined, ({ exitCode, lines }) => {
    expect(exitCode).toBe(0);
    expect(lines.join("\n")).not.toContain("drift");
  });
});

it("names a dependency with no row", () => {
  withFixture(
    ({ files, root }) =>
      files.set(
        path.join(root, "THIRD-PARTY-NOTICES.md"),
        NOTICES_CLEAN.replace(/^\| `alpha` \|.*\n/m, ""),
      ),
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      expect(lines.join("\n")).toContain("missing alpha");
    },
  );
});

it("names a version the lockfile does not resolve", () => {
  withFixture(
    ({ files, root }) =>
      files.set(
        path.join(root, "THIRD-PARTY-NOTICES.md"),
        NOTICES_CLEAN.replace("| `alpha` | 1.0.0 |", "| `alpha` | 0.9.0 |"),
      ),
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      const drift = lines.join("\n");
      expect(drift).toContain("version alpha");
      expect(drift).toContain("0.9.0");
      expect(drift).toContain("1.0.0");
    },
  );
});

it("names a licence the manifest does not declare", () => {
  withFixture(
    ({ files, root }) =>
      files.set(
        path.join(root, "THIRD-PARTY-NOTICES.md"),
        NOTICES_CLEAN.replace(
          "| `beta` | 2.0.0 | MIT |",
          "| `beta` | 2.0.0 | Apache-2.0 |",
        ),
      ),
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      const drift = lines.join("\n");
      expect(drift).toContain("licence beta");
      expect(drift).toContain("Apache-2.0");
      expect(drift).toContain("MIT");
    },
  );
});

it("names an installed version that is not the lockfile's", () => {
  withFixture(
    ({ files, web }) =>
      files.set(path.join(web, "node_modules/alpha/package.json"), {
        name: "alpha",
        version: "9.9.9",
        license: "MIT",
      }),
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      const drift = lines.join("\n");
      expect(drift).toContain("installed alpha");
      expect(drift).toContain("1.0.0");
      expect(drift).toContain("9.9.9");
    },
  );
});

it("refuses an incomplete install as a prerequisite", () => {
  withFixture(
    ({ files, web }) => {
      const beta = path.join(web, "node_modules/beta");
      for (const [file] of files) {
        if (file.startsWith(beta)) files.delete(file);
      }
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(2);
      const drift = lines.join("\n");
      expect(drift).toContain("prerequisite:");
      expect(drift).toContain("beta");
    },
  );
});

it("names a stale row for a package no workspace declares", () => {
  withFixture(
    ({ files, root }) =>
      files.set(
        path.join(root, "THIRD-PARTY-NOTICES.md"),
        `${NOTICES_CLEAN}| \`delta\` | 9.9.9 | MIT |\n`,
      ),
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      expect(lines.join("\n")).toContain("stale delta");
    },
  );
});

it("names a duplicate row", () => {
  withFixture(
    ({ files, root }) =>
      files.set(
        path.join(root, "THIRD-PARTY-NOTICES.md"),
        `${NOTICES_CLEAN}| \`alpha\` | 1.0.0 | MIT |\n`,
      ),
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      expect(lines.join("\n")).toContain("duplicate alpha 1.0.0");
    },
  );
});

it("does not read a licence out of a LICENSE body", () => {
  withFixture(
    ({ files, root }) =>
      files.set(
        path.join(root, "THIRD-PARTY-NOTICES.md"),
        NOTICES_CLEAN.replace(
          "| `gamma` | 3.0.0 | BSD-3-Clause |",
          "| `gamma` | 3.0.0 | MIT |",
        ),
      ),
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      expect(lines.join("\n")).toContain("licence gamma");
    },
  );
});

it("maps the LICENSE title to its licence", () => {
  withFixture(undefined, ({ exitCode }) => expect(exitCode).toBe(0));
});

it("accepts a title with a parenthesised alias", () => {
  withFixture(
    ({ files, web, root }) => {
      files.set(
        path.join(web, "node_modules/gamma/LICENSE"),
        "The MIT License (MIT)\n\nPermission is hereby granted, free of charge.\n",
      );
      files.set(
        path.join(root, "THIRD-PARTY-NOTICES.md"),
        NOTICES_CLEAN.replace(
          "| `gamma` | 3.0.0 | BSD-3-Clause |",
          "| `gamma` | 3.0.0 | MIT |",
        ),
      );
    },
    ({ exitCode }) => expect(exitCode).toBe(0),
  );
});

it("accepts the OSI BSD title with quoted words", () => {
  withFixture(
    ({ files, web }) =>
      files.set(
        path.join(web, "node_modules/gamma/LICENSE"),
        'BSD 3-Clause "New" or "Revised" License\n\nRedistribution and use is permitted.\n',
      ),
    ({ exitCode }) => expect(exitCode).toBe(0),
  );
});

it("reads the file named by SEE LICENSE IN", () => {
  withFixture(
    ({ files, web, root }) => {
      files.set(path.join(web, "node_modules/gamma/package.json"), {
        name: "gamma",
        version: "3.0.0",
        license: "SEE LICENSE IN LICENSE",
      });
      files.set(
        path.join(web, "node_modules/gamma/LICENSE"),
        "MIT License\n\nPermission is hereby granted, free of charge.\n",
      );
      files.set(
        path.join(root, "THIRD-PARTY-NOTICES.md"),
        NOTICES_CLEAN.replace(
          "| `gamma` | 3.0.0 | BSD-3-Clause |",
          "| `gamma` | 3.0.0 | MIT |",
        ),
      );
    },
    ({ exitCode }) => expect(exitCode).toBe(0),
  );
});

it("refuses a SEE LICENSE IN name that is a directory", () => {
  withFixture(
    ({ files, web }) => {
      files.set(path.join(web, "node_modules/gamma/package.json"), {
        name: "gamma",
        version: "3.0.0",
        license: "SEE LICENSE IN docs",
      });
      files.set(path.join(web, "node_modules/gamma/docs/note.txt"), "x");
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      expect(lines.join("\n")).toContain(
        "SEE LICENSE IN docs names a directory, not a file",
      );
    },
  );
});

it("refuses a bare SEE LICENSE IN instead of treating it as a licence", () => {
  withFixture(
    ({ files, web, root }) => {
      files.set(path.join(web, "node_modules/gamma/package.json"), {
        name: "gamma",
        version: "3.0.0",
        license: "SEE LICENSE IN",
      });
      files.set(
        path.join(root, "THIRD-PARTY-NOTICES.md"),
        NOTICES_CLEAN.replace(
          "| `gamma` | 3.0.0 | BSD-3-Clause |",
          "| `gamma` | 3.0.0 | SEE LICENSE IN |",
        ),
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      expect(lines.join("\n")).toContain(
        'its manifest says "SEE LICENSE IN" with no file to read',
      );
    },
  );
});

it("names the SEE LICENSE IN file it could not map", () => {
  withFixture(
    ({ files, web }) => {
      files.set(path.join(web, "node_modules/gamma/package.json"), {
        name: "gamma",
        version: "3.0.0",
        license: "SEE LICENSE IN LEGAL",
      });
      files.set(
        path.join(web, "node_modules/gamma/LEGAL"),
        "Proprietary Terms\n\nAll rights reserved.\n",
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      const drift = lines.join("\n");
      expect(drift).toContain("its manifest points at LEGAL");
      expect(drift).toContain("Proprietary Terms");
    },
  );
});

/** Adds `delta` 4.0.0 as an optional dependency of workspace `a`. */
function withOptionalDelta(fixture: Fixture, installed: boolean): void {
  const { files, web, root } = fixture;
  files.set(path.join(web, "packages/a/package.json"), {
    name: "@yunari/a",
    version: "0.0.0",
    dependencies: { alpha: "1.0.0", beta: "2.0.0" },
    optionalDependencies: { delta: "4.0.0" },
  });
  const lock = files.get(path.join(web, "package-lock.json")) as {
    packages: Record<string, unknown>;
  };
  lock.packages["node_modules/delta"] = { version: "4.0.0" };
  if (installed) {
    files.set(path.join(web, "node_modules/delta/package.json"), {
      name: "delta",
      version: "4.0.0",
      license: "MIT",
    });
  }
  files.set(
    path.join(root, "THIRD-PARTY-NOTICES.md"),
    `${NOTICES_CLEAN}| \`delta\` | 4.0.0 | MIT |\n`,
  );
}

it("compares an optional dependency's licence when it is installed", () => {
  withFixture(
    (fixture) => {
      withOptionalDelta(fixture, true);
      // The installed manifest disagrees with the row, which is the same drift
      // a regular dependency would answer.
      fixture.files.set(
        path.join(fixture.web, "node_modules/delta/package.json"),
        { name: "delta", version: "4.0.0", license: "Apache-2.0" },
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      expect(lines.join("\n")).toContain("licence delta 4.0.0");
    },
  );
});

it("names an optional dependency with no row", () => {
  withFixture(
    (fixture) => {
      withOptionalDelta(fixture, true);
      fixture.files.set(
        path.join(fixture.root, "THIRD-PARTY-NOTICES.md"),
        NOTICES_CLEAN,
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      expect(lines.join("\n")).toContain("missing delta");
    },
  );
});

it("requires an uninstalled optional dependency's row and says its licence was not read", () => {
  withFixture(
    (fixture) => withOptionalDelta(fixture, false),
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(0);
      const output = lines.join("\n");
      expect(output).toContain("delta 4.0.0");
      expect(output).toContain("not read here");
    },
  );
});

it("leaves peerDependencies out of the inventory", () => {
  withFixture(
    ({ files, web }) =>
      files.set(path.join(web, "packages/a/package.json"), {
        name: "@yunari/a",
        version: "0.0.0",
        dependencies: { alpha: "1.0.0", beta: "2.0.0" },
        peerDependencies: { peer: "1.0.0" },
      }),
    ({ exitCode }) => expect(exitCode).toBe(0),
  );
});
