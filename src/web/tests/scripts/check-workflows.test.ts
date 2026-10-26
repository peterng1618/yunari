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

const GUARD = `      - name: Refuse a non-dry manual dispatch off a tag
        run: |
          if [[ "$GITHUB_EVENT_NAME" == "workflow_dispatch" && "$DRY_RUN" != "true" && "$GITHUB_REF" != refs/tags/v* ]]; then
            exit 1
          fi
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
    steps:
${GUARD}      - uses: actions/checkout@${SHA} # v4
        with:
          persist-credentials: false
  publish:
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

/** A guard step whose run body is the given shell lines. */
function guard(lines: string[]): string {
  return `      - name: Refuse a non-dry manual dispatch off a tag\n        run: |\n${lines
    .map((line) => `          ${line}`)
    .join("\n")}\n`;
}

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

it("refuses a guard neutralised by a leading if false", () => {
  withFixture(
    (files) => {
      files["publish.yml"] = files["publish.yml"].replace(
        GUARD,
        guard([
          "if false; then",
          '  echo "GITHUB_EVENT_NAME workflow_dispatch DRY_RUN true GITHUB_REF refs/tags/v*"',
          "fi",
          'if [[ "$GITHUB_EVENT_NAME" == "workflow_dispatch" && "$DRY_RUN" != "true" && "$GITHUB_REF" != refs/tags/v* ]]; then',
          "  exit 1",
          "fi",
        ]),
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      expect(lines.join("\n")).toContain("neutralised by a leading if false");
    },
  );
});

it("refuses a comment-only guard", () => {
  withFixture(
    (files) => {
      files["publish.yml"] = files["publish.yml"].replace(
        GUARD,
        guard([
          "# GITHUB_EVENT_NAME workflow_dispatch DRY_RUN true GITHUB_REF refs/tags/v* exit 1",
        ]),
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      expect(lines.join("\n")).toContain("comment-only");
    },
  );
});

it("refuses a first step with no run command", () => {
  withFixture(
    (files) => {
      files["publish.yml"] = files["publish.yml"].replace(GUARD, "");
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      expect(lines.join("\n")).toContain("has no run: command");
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
        "        with:\n          persist-credentials: false\n",
        "",
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      expect(lines.join("\n")).toContain("persist-credentials: false");
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
