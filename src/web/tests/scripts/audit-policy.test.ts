import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
// The script lives at the repository root, four levels above this file:
// src/web/tests/scripts → ../../../.. = repo root.
import { evaluateAuditReport } from "../../../../scripts/audit-policy.mjs";

/**
 * The audit policy's own proof. `--self-test` covers the same rules offline, but
 * these cases drive the exported decision directly and the CLI's exit codes
 * through a real spawn — a self-test that passed by reading its own fixture list
 * would be the defect the gate exists to remove.
 */

type Via = string | { readonly name: string; readonly url?: string };

const GHSA = {
  name: "node-forge",
  url: "https://github.com/advisories/GHSA-86w9-cpqp-85rv",
  severity: "high",
  range: "<=1.4.0",
};

const reportOf = (vulnerabilities: Record<string, readonly Via[]>) => ({
  auditReportVersion: 2,
  vulnerabilities: Object.fromEntries(
    Object.entries(vulnerabilities).map(([name, via]) => [
      name,
      { name, severity: "high", via },
    ]),
  ),
  metadata: { vulnerabilities: { high: 1, total: 1 } },
});

const entry = (pkg: string, advisory: string, reviewed = "2026-10-25") => ({
  package: pkg,
  advisory,
  reason: "fixture",
  reviewed,
});

const SCRIPT = path.resolve(
  import.meta.dirname,
  "../../../../scripts/audit-policy.mjs",
);

/** Run the CLI over fixtures written outside the repo. */
function cli(
  report: unknown | "missing" | "malformed",
  allowlist: unknown | "missing",
): number {
  const dir = mkdtempSync(path.join(os.tmpdir(), "yunari-audit-policy-"));
  try {
    const reportFile = path.join(dir, "report.json");
    const allowlistFile = path.join(dir, "allowlist.json");
    if (report !== "missing") {
      writeFileSync(
        reportFile,
        report === "malformed" ? "{not json" : JSON.stringify(report),
      );
    }
    if (allowlist !== "missing") {
      writeFileSync(allowlistFile, JSON.stringify(allowlist));
    }
    const run = spawnSync(
      process.execPath,
      [
        SCRIPT,
        "--report",
        report === "missing" ? path.join(dir, "absent.json") : reportFile,
        "--allowlist",
        allowlist === "missing" ? path.join(dir, "absent.json") : allowlistFile,
      ],
      { encoding: "utf8" },
    );
    return run.status ?? -1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

it("fails a finding no allowlist entry covers", () => {
  const result = evaluateAuditReport(reportOf({ "node-forge": [GHSA] }), []);
  expect(result.ok).toBe(false);
  expect(result.unmatched).toEqual([
    { package: "node-forge", advisory: "GHSA-86w9-cpqp-85rv" },
  ]);
  expect(result.stale).toEqual([]);
});

it("passes a finding whose package and advisory are allowlisted", () => {
  const result = evaluateAuditReport(reportOf({ "node-forge": [GHSA] }), [
    entry("node-forge", "GHSA-86w9-cpqp-85rv"),
  ]);
  expect(result).toEqual({ ok: true, unmatched: [], stale: [] });
});

it("reports an allowlist entry that matches nothing as stale and fails", () => {
  const result = evaluateAuditReport(reportOf({}), [
    entry("node-forge", "GHSA-86w9-cpqp-85rv"),
  ]);
  expect(result.ok).toBe(false);
  expect(result.stale).toEqual([entry("node-forge", "GHSA-86w9-cpqp-85rv")]);
});

it("matches a string via against the dependency it names", () => {
  const result = evaluateAuditReport(
    reportOf({ "@google/design.md": ["zod"] }),
    [entry("@google/design.md", "zod")],
  );
  expect(result.ok).toBe(true);
});

it("matches every advisory of one package with a wildcard", () => {
  const result = evaluateAuditReport(
    reportOf({ "@google/design.md": ["zod", GHSA] }),
    [entry("@google/design.md", "*"), entry("@google/design.md", "*")],
  );
  expect(result.ok).toBe(true);
});

it("spends an allowlist entry once, so a second finding cannot hide behind it", () => {
  const twoRows = evaluateAuditReport(reportOf({ "node-forge": [GHSA] }), [
    entry("node-forge", "*"),
    entry("node-forge", "*"),
  ]);
  expect(twoRows.ok).toBe(false);
  expect(twoRows.stale).toEqual([entry("node-forge", "*")]);

  const twice = evaluateAuditReport(
    {
      vulnerabilities: {
        "node-forge": { name: "node-forge", via: [GHSA, GHSA] },
      },
    },
    [entry("node-forge", "*")],
  );
  expect(twice.ok).toBe(false);
  expect(twice.unmatched).toHaveLength(1);
});

it("prefers an exact row before spending a wildcard", () => {
  const other = {
    name: "node-forge",
    url: "https://github.com/advisories/GHSA-dddd-eeee-ffff",
  };
  const result = evaluateAuditReport(
    {
      vulnerabilities: {
        "node-forge": { name: "node-forge", via: [GHSA, other] },
      },
    },
    // The wildcard is written first; a first-fit would spend it on GHSA and
    // leave both the exact row and the second advisory uncovered.
    [entry("node-forge", "*"), entry("node-forge", "GHSA-86w9-cpqp-85rv")],
  );
  expect(result).toEqual({ ok: true, unmatched: [], stale: [] });
});

it("exits 2 when the report file is absent", () => {
  expect(cli("missing", [])).toBe(2);
});

it("exits 2 when the report is malformed JSON", () => {
  expect(cli("malformed", [])).toBe(2);
});

it("exits 2 when the allowlist cannot be read", () => {
  expect(cli({}, "missing")).toBe(2);
});

it("exits 1 when a finding is unallowlisted, and 0 when it is covered", () => {
  expect(cli(reportOf({ "node-forge": [GHSA] }), [])).toBe(1);
  expect(
    cli(reportOf({ "node-forge": [GHSA] }), [
      entry("node-forge", "GHSA-86w9-cpqp-85rv"),
    ]),
  ).toBe(0);
});

it("prints a summary and exits 0 for --self-test", () => {
  const run = spawnSync(process.execPath, [SCRIPT, "--self-test"], {
    encoding: "utf8",
  });
  expect(run.status).toBe(0);
  expect(run.stdout).toMatch(/self-test.*cases behave/);
});
