import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
// The script lives at the repository root, four levels above this file:
// src/web/tests/scripts → ../../../.. = repo root.
import { checkWorkflows } from "../../../../scripts/check-workflows.mjs";

/**
 * The workflow check's own proof: one fixture `.github/workflows/` per case,
 * written under `os.tmpdir()` and removed afterwards. The clean fixture keeps
 * the real shape — `jobs:` -> job -> `needs:`/`permissions:` block maps ->
 * `steps:` list -> `with:` block map, with a `run: |` guard — so the reader is
 * exercised rather than stubbed. Every mutation below is a bypass a text
 * parser silently skipped before the reader was made total.
 */

const SHA = "11d5960a326750d5838078e36cf38b85af677262";
const RELEASE_SHA = "45996ed1f6d02564a971a2fa1b5860e934307cf7";
const SETUP_SHA = "49933ea5288caeca8642d1e84afbd3f7d6820020";

const CHECKOUT = `      - uses: actions/checkout@${SHA} # v4
        with:
          fetch-depth: 0
          persist-credentials: false
`;
const SETUP_NODE = `      - uses: actions/setup-node@${SETUP_SHA} # v4
        with:
          node-version: "24"
`;
const GUARD = `      - name: Refuse a non-dry dispatch off a tag
        run: node scripts/assert-publish-ref.mjs
`;
const RUN_STEP = `      - name: Install the workspace
        run: npm ci
`;

const CLEAN: Record<string, string> = {
  "publish.yml": `name: Publish
env:
  DRY_RUN: "false"
jobs:
  install:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    env:
      STAGE: stage
      ASSETS: assets
      SMOKE: smoke
    steps:
${CHECKOUT}${GUARD}${SETUP_NODE}  publish:
    needs: install
    runs-on: ubuntu-latest
    permissions:
      contents: write
      id-token: write
    steps:
      - uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4
`,
  "ci.yml": `name: CI
on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${SHA} # v4
`,
  "release.yml": `name: Release please
jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@${RELEASE_SHA} # v5
`,
  "visual-evidence.yml": `name: Visual evidence
jobs:
  capture:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${SHA} # v4
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
`,
};

type Files = Record<string, string>;
type Mutate = (files: Files) => void;
type Result = { exitCode: number; lines: string[] };

function withFixture(mutate: Mutate | undefined, assert: (r: Result) => void) {
  const root = mkdtempSync(path.join(os.tmpdir(), "workflow-check-"));
  const workflows = path.join(root, ".github", "workflows");
  try {
    const files: Files = { ...CLEAN };
    if (mutate !== undefined) mutate(files);
    mkdirSync(workflows, { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(path.join(workflows, name), body);
    }
    assert(checkWorkflows(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

it("passes a clean tree", () => {
  withFixture(undefined, ({ exitCode, lines }) => {
    expect(exitCode).toBe(0);
    expect(lines.join("\n")).toContain("SHA-pinned");
  });
});

it("refuses a uses that is not a 40-hex commit", () => {
  withFixture(
    (files) => {
      files["ci.yml"] = files["ci.yml"].replace(
        `actions/checkout@${SHA}`,
        "actions/checkout@v4",
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      const out = lines.join("\n");
      expect(out).toContain("ci.yml");
      expect(out).toContain("uses must be owner/repo@<40 lowercase hex>");
    },
  );
});

it("reads a uses key with a space before the colon", () => {
  withFixture(
    (files) => {
      files["ci.yml"] = files["ci.yml"].replace(
        `- uses: actions/checkout@${SHA} # v4`,
        "- uses : actions/checkout@v4",
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      expect(lines.join("\n")).toContain(
        "uses must be owner/repo@<40 lowercase hex>",
      );
    },
  );
});

it("accepts a quoted pinned value", () => {
  withFixture(
    (files) => {
      files["ci.yml"] = files["ci.yml"].replace(
        `actions/checkout@${SHA}`,
        `"actions/checkout@${SHA}"`,
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(0);
      expect(lines.join("\n")).toContain("SHA-pinned");
    },
  );
});

it("reads a quoted uses key", () => {
  withFixture(
    (files) => {
      files["ci.yml"] = files["ci.yml"].replace(
        `- uses: actions/checkout@${SHA}`,
        '- "uses": actions/checkout@v4',
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      expect(lines.join("\n")).toContain(
        "uses must be owner/repo@<40 lowercase hex>",
      );
    },
  );
});

it("refuses flow-style steps", () => {
  withFixture(
    (files) => {
      files["ci.yml"] = `name: CI
jobs:
  build:
    runs-on: ubuntu-latest
    steps: [{ uses: actions/checkout@v4 }]
`;
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(2);
      expect(lines.join("\n")).toContain(
        "flow-style steps is not read; write it as a block mapping",
      );
    },
  );
});

it("refuses flow-style permissions", () => {
  withFixture(
    (files) => {
      files["publish.yml"] = files["publish.yml"].replace(
        "    permissions:\n      contents: read",
        "    permissions: { contents: read }",
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(2);
      expect(lines.join("\n")).toContain(
        "flow-style permissions is not read; write it as a block mapping",
      );
    },
  );
});

it("refuses a third job with publish authority", () => {
  withFixture(
    (files) => {
      files["publish.yml"] += `  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      id-token: write
    steps:
      - run: npm publish
`;
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      expect(lines.join("\n")).toContain(
        'job "release" is not allowed; publish.yml may only define install and publish',
      );
    },
  );
});

it("refuses a publish job without needs: install", () => {
  withFixture(
    (files) => {
      files["publish.yml"] = files["publish.yml"].replace(
        "    needs: install\n",
        "",
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      expect(lines.join("\n")).toContain('must declare "needs: install"');
    },
  );
});

it("refuses uppercase hex in a pin", () => {
  withFixture(
    (files) => {
      files["ci.yml"] = files["ci.yml"].replace(SHA, SHA.toUpperCase());
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      expect(lines.join("\n")).toContain(
        "uses must be owner/repo@<40 lowercase hex>",
      );
    },
  );
});

it("refuses a shortened sha behind a comment", () => {
  withFixture(
    (files) => {
      files["ci.yml"] = files["ci.yml"].replace(
        `actions/checkout@${SHA}`,
        "actions/checkout@11d5960",
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      expect(lines.join("\n")).toContain(
        "uses must be owner/repo@<40 lowercase hex>",
      );
    },
  );
});

it("refuses a permission on the install job beyond contents: read", () => {
  withFixture(
    (files) => {
      files["publish.yml"] = files["publish.yml"].replace(
        "    permissions:\n      contents: read",
        "    permissions:\n      contents: read\n      packages: write",
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      expect(lines.join("\n")).toContain(
        'install job must declare exactly "contents: read"',
      );
    },
  );
});

it("refuses a checkout that persists credentials", () => {
  withFixture(
    (files) => {
      files["publish.yml"] = files["publish.yml"].replace(
        "persist-credentials: false",
        "persist-credentials: true",
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      const out = lines.join("\n");
      expect(out).toContain('"persist-credentials" must be "false"');
      expect(out).toContain('(got "true")');
    },
  );
});

it("refuses a checkout with a shallow fetch depth", () => {
  withFixture(
    (files) => {
      files["publish.yml"] = files["publish.yml"].replace(
        "fetch-depth: 0",
        "fetch-depth: 1",
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      const out = lines.join("\n");
      expect(out).toContain('"fetch-depth" must be "0"');
      expect(out).toContain('(got "1")');
    },
  );
});

it("refuses a checkout with no with: block", () => {
  withFixture(
    (files) => {
      files["publish.yml"] = files["publish.yml"].replace(
        "        with:\n          fetch-depth: 0\n          persist-credentials: false\n",
        "",
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      const out = lines.join("\n");
      expect(out).toContain('with is missing "fetch-depth"');
      expect(out).toContain('with is missing "persist-credentials"');
    },
  );
});

it("refuses an if: on the checkout step", () => {
  withFixture(
    (files) => {
      files["publish.yml"] = files["publish.yml"].replace(
        `- uses: actions/checkout@${SHA} # v4\n`,
        `- uses: actions/checkout@${SHA} # v4\n        if: false\n`,
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      const out = lines.join("\n");
      expect(out).toContain('only "uses" and "with"');
      expect(out).toContain('found "if"');
    },
  );
});

it("refuses an extra key in the checkout's with: map", () => {
  withFixture(
    (files) => {
      files["publish.yml"] = files["publish.yml"].replace(
        "          fetch-depth: 0\n",
        "          fetch-depth: 0\n          cache: npm\n",
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      const out = lines.join("\n");
      expect(out).toContain("checkout with must set only");
      expect(out).toContain('found "cache"');
    },
  );
});

it("refuses a publish job with no contents: write", () => {
  withFixture(
    (files) => {
      files["publish.yml"] = files["publish.yml"].replace(
        "      contents: write\n",
        "",
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      expect(lines.join("\n")).toContain('publish job lacks "contents: write"');
    },
  );
});

it("refuses a guard run with one word added", () => {
  withFixture(
    (files) => {
      files["publish.yml"] = files["publish.yml"].replace(
        "run: node scripts/assert-publish-ref.mjs",
        "run: node scripts/assert-publish-ref.mjs extra",
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      expect(lines.join("\n")).toContain(
        'must run exactly "node scripts/assert-publish-ref.mjs"',
      );
    },
  );
});

it("refuses the guard called from a ; chain", () => {
  withFixture(
    (files) => {
      files["publish.yml"] = files["publish.yml"].replace(
        "run: node scripts/assert-publish-ref.mjs",
        "run: echo unsafe; node scripts/assert-publish-ref.mjs",
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      expect(lines.join("\n")).toContain(
        'must run exactly "node scripts/assert-publish-ref.mjs"',
      );
    },
  );
});

it("refuses the guard last instead of directly after the checkout", () => {
  withFixture(
    (files) => {
      files["publish.yml"] = files["publish.yml"].replace(
        `${CHECKOUT}${GUARD}${SETUP_NODE}`,
        `${CHECKOUT}${SETUP_NODE}${GUARD}`,
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      expect(lines.join("\n")).toContain(
        "the step after the checkout must be the publish guard (node scripts/assert-publish-ref.mjs)",
      );
    },
  );
});

it("refuses the guard at index 2 in a longer job", () => {
  withFixture(
    (files) => {
      files["publish.yml"] = files["publish.yml"].replace(
        `${CHECKOUT}${GUARD}${SETUP_NODE}`,
        `${CHECKOUT}${SETUP_NODE}${GUARD}${RUN_STEP}`,
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      expect(lines.join("\n")).toContain(
        "the step after the checkout must be the publish guard (node scripts/assert-publish-ref.mjs)",
      );
    },
  );
});

it("refuses a legitimate step inserted between the checkout and the guard", () => {
  withFixture(
    (files) => {
      files["publish.yml"] = files["publish.yml"].replace(
        `${CHECKOUT}${GUARD}`,
        `${CHECKOUT}${RUN_STEP}${GUARD}`,
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      const out = lines.join("\n");
      expect(out).toContain(
        "the step after the checkout must be the publish guard (node scripts/assert-publish-ref.mjs)",
      );
      expect(out).not.toContain("has no run: command");
    },
  );
});

it("refuses the guard before the checkout", () => {
  withFixture(
    (files) => {
      files["publish.yml"] = files["publish.yml"].replace(
        `${CHECKOUT}${GUARD}`,
        `${GUARD}${CHECKOUT}`,
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      expect(lines.join("\n")).toContain("first step must be actions/checkout");
    },
  );
});

it("refuses a deleted guard", () => {
  withFixture(
    (files) => {
      files["publish.yml"] = files["publish.yml"].replace(GUARD, "");
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      expect(lines.join("\n")).toContain(
        "the step after the checkout must be the publish guard (node scripts/assert-publish-ref.mjs)",
      );
    },
  );
});

it("refuses a job with no step after the checkout", () => {
  withFixture(
    (files) => {
      files["publish.yml"] = files["publish.yml"].replace(
        `${CHECKOUT}${GUARD}${SETUP_NODE}`,
        CHECKOUT,
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      expect(lines.join("\n")).toContain(
        "the step after the checkout must be the publish guard (node scripts/assert-publish-ref.mjs); install job has no step there",
      );
    },
  );
});

it("refuses a comment-only guard run", () => {
  withFixture(
    (files) => {
      files["publish.yml"] = files["publish.yml"].replace(
        GUARD,
        GUARD.replace(
          "        run: node scripts/assert-publish-ref.mjs",
          "        run: |\n          # nothing to run",
        ),
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      const out = lines.join("\n");
      expect(out).toContain(
        "the step after the checkout must be the publish guard (node scripts/assert-publish-ref.mjs)",
      );
      expect(out).toContain("is comment-only");
    },
  );
});

it("refuses DRY_RUN in the install job's env", () => {
  withFixture(
    (files) => {
      files["publish.yml"] = files["publish.yml"].replace(
        "      SMOKE: smoke\n",
        '      SMOKE: smoke\n      DRY_RUN: "true"\n',
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      const out = lines.join("\n");
      expect(out).toContain(
        "install job's env may only define STAGE, ASSETS, SMOKE",
      );
      expect(out).toContain('found "DRY_RUN"');
    },
  );
});

it("refuses any other name in the install job's env", () => {
  withFixture(
    (files) => {
      files["publish.yml"] = files["publish.yml"].replace(
        "      SMOKE: smoke\n",
        "      SMOKE: smoke\n      EXTRA: value\n",
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      expect(lines.join("\n")).toContain('found "EXTRA"');
    },
  );
});

it("refuses a missing staging variable in the install job's env", () => {
  withFixture(
    (files) => {
      files["publish.yml"] = files["publish.yml"].replace(
        "      STAGE: stage\n",
        "",
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      expect(lines.join("\n")).toContain(
        'install job\'s env is missing "STAGE"',
      );
    },
  );
});

it("refuses defaults: on the install job", () => {
  withFixture(
    (files) => {
      files["publish.yml"] = files["publish.yml"].replace(
        "    steps:\n",
        "    defaults:\n      run:\n        shell: bash\n    steps:\n",
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      const out = lines.join("\n");
      expect(out).toContain('must not declare "defaults:"');
    },
  );
});

it("refuses a workflow-level defaults:", () => {
  withFixture(
    (files) => {
      files["publish.yml"] = files["publish.yml"].replace(
        "jobs:\n",
        "defaults:\n  run:\n    shell: bash\njobs:\n",
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      expect(lines.join("\n")).toContain(
        'workflow-level "defaults:" is not allowed',
      );
    },
  );
});

/** The clean guard step with `extra` declared before its `run`. */
function guardWith(extra: string): string {
  return GUARD.replace("        run:", `${extra}        run:`);
}

for (const [key, extra] of [
  ["if", "        if: false\n"],
  ["shell", "        shell: bash\n"],
  ["working-directory", "        working-directory: src/web\n"],
  ["env", '        env:\n          DRY_RUN: "true"\n'],
] as const) {
  it(`refuses a ${key}: on the guard step`, () => {
    withFixture(
      (files) => {
        files["publish.yml"] = files["publish.yml"].replace(
          GUARD,
          guardWith(extra),
        );
      },
      ({ exitCode, lines }) => {
        expect(exitCode).toBe(1);
        const out = lines.join("\n");
        expect(out).toContain('may only declare "name" and "run"');
        expect(out).toContain(`"${key}"`);
      },
    );
  });
}

it("names permissions: read-all as a scalar and the required shape", () => {
  withFixture(
    (files) => {
      files["publish.yml"] = files["publish.yml"].replace(
        "    permissions:\n      contents: read",
        "    permissions: read-all",
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      expect(lines.join("\n")).toContain(
        'declares permissions as the scalar "read-all"; it must declare exactly "contents: read"',
      );
    },
  );
});
