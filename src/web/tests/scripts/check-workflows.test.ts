import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
// The script lives at the repository root, four levels above this file:
// src/web/tests/scripts → ../../../.. = repo root.
import { checkWorkflows } from "../../../../scripts/check-workflows.mjs";

/**
 * The workflow check's own proof: one fixture `.github/workflows/` per case,
 * written under `os.tmpdir()` and removed afterwards. The fixtures are small
 * but keep the real shape — `jobs:` -> job -> `permissions:` block map ->
 * `steps:` list -> `with:` block map, with a `run: |` guard — so the reader is
 * exercised rather than stubbed.
 */

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
      - name: Refuse a non-dry manual dispatch off a tag
        run: |
          if [[ "$GITHUB_EVENT_NAME" == "workflow_dispatch" && "$DRY_RUN" != "true" && "$GITHUB_REF" != refs/tags/v* ]]; then
            exit 1
          fi
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with:
          persist-credentials: false
  publish:
    needs: install
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
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
`,
  "release.yml": `name: Release please
jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7 # v5
`,
  "visual-evidence.yml": `name: Visual evidence
jobs:
  capture:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
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
        "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
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

it("refuses a publish workflow with no tag guard in install's first step", () => {
  withFixture(
    (files) => {
      files["publish.yml"] = files["publish.yml"].replace(
        /      - name: Refuse[\s\S]*?          fi\n/,
        "",
      );
    },
    ({ exitCode, lines }) => {
      expect(exitCode).toBe(1);
      expect(lines.join("\n")).toContain(
        "first step must be the non-dry manual-dispatch tag guard",
      );
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
