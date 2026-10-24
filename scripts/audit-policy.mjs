#!/usr/bin/env node

/**
 * The dependency audit fails closed: a finding that no allowlist entry covers,
 * or an allowlist entry that no finding covers, is a failure.
 *
 * `npm audit` is a network read and its exit code is 1 whenever findings exist,
 * so the gate must not inherit either. The policy parses the JSON and returns
 * its own code — 0 clean, 1 finding, 2 unreadable input — and `--self-test`
 * proves the rules offline inside `npm run gate` (plan 2026-10-25, D5; decision
 * 0111).
 *
 * Matching is per vulnerability entry in the report: the report's package name
 * plus each of its `via` entries. A `via` object contributes the GHSA id in its
 * `url`; a string contributes the package name it names. An allowlist row
 * covers one finding, so a second finding cannot hide behind one row, and an
 * advisory row of `"*"` covers every advisory of that package.
 *
 * `node scripts/audit-policy.mjs [--report <file>] [--allowlist <file>]`
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DEFAULT_ALLOWLIST = resolve(ROOT, "docs/engineering/audit-allowlist.json");
const GHSA = /GHSA(-[0-9a-z]{4}){3}/i;
const REQUIRED = ["package", "advisory", "reason", "reviewed"];

/** The advisory a `via` entry names, as the allowlist spells it. */
function advisoryOf(via, packageName) {
  if (typeof via === "string") return GHSA.exec(via)?.[0] ?? via;
  if (via !== null && typeof via === "object") {
    const url = typeof via.url === "string" ? via.url : "";
    return (
      GHSA.exec(url)?.[0] ??
      (url !== "" ? url : (via.name ?? packageName))
    );
  }
  return packageName;
}

/**
 * The decision, isolated from files and process exit so its own test can drive
 * it. `ok` is true only when every finding is covered and no row is stale.
 */
export function evaluateAuditReport(report, allowlist) {
  const findings = [];
  for (const [packageName, vulnerability] of Object.entries(
    report.vulnerabilities,
  )) {
    for (const via of vulnerability.via ?? []) {
      findings.push({
        package: packageName,
        advisory: advisoryOf(via, packageName),
      });
    }
  }

  const used = new Set();
  const unmatched = [];
  for (const finding of findings) {
    // Exact rows first, so a wildcard cannot consume an advisory that has its
    // own row and leave that row stale while the wildcard's advisory fails.
    const matches = (entry, index) =>
      !used.has(index) &&
      entry.package === finding.package &&
      entry.advisory === finding.advisory;
    let at = allowlist.findIndex(matches);
    if (at < 0) {
      at = allowlist.findIndex(
        (entry, index) =>
          !used.has(index) &&
          entry.package === finding.package &&
          entry.advisory === "*",
      );
    }
    if (at < 0) unmatched.push(finding);
    else used.add(at);
  }
  const stale = allowlist.filter((_, index) => !used.has(index));
  return { ok: unmatched.length === 0 && stale.length === 0, unmatched, stale };
}

function readJson(file, what) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(`${what} ${file} cannot be read: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${what} ${file} is not JSON: ${error.message}`);
  }
}

function parseAllowlist(value) {
  if (!Array.isArray(value)) {
    throw new Error("allowlist must be a JSON array of entries");
  }
  return value.map((entry, index) => {
    for (const key of REQUIRED) {
      if (typeof entry?.[key] !== "string" || entry[key] === "") {
        throw new Error(`allowlist entry ${index} needs a non-empty "${key}"`);
      }
    }
    return {
      package: entry.package,
      advisory: entry.advisory,
      reason: entry.reason,
      reviewed: entry.reviewed,
    };
  });
}

function parseReport(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("audit report is not a JSON object");
  }
  if (value.error !== undefined) {
    throw new Error(
      `audit report carries an error: ${JSON.stringify(value.error)}`,
    );
  }
  if (
    value.vulnerabilities === null ||
    typeof value.vulnerabilities !== "object" ||
    Array.isArray(value.vulnerabilities)
  ) {
    throw new Error("audit report carries no vulnerabilities object");
  }
  return value;
}

/**
 * `npm audit --json` exits 1 when findings exist, so its status is not the
 * answer. A spawn failure or empty stdout is unreadable input.
 */
function auditJson() {
  // Windows resolves `npm` to a .cmd shim, which Node refuses to spawn without
  // a shell; the command is a constant and carries no arguments either way.
  const windows = process.platform === "win32";
  const run = spawnSync(
    windows ? "npm audit --json" : "npm",
    windows ? [] : ["audit", "--json"],
    {
      // The lockfile lives at src/web, so the documented root invocation must
      // still audit that workspace rather than whatever cwd it was called from.
      cwd: resolve(ROOT, "src/web"),
      encoding: "utf8",
      maxBuffer: 1 << 28,
      shell: windows,
    },
  );
  if (run.error) {
    throw new Error(`npm audit could not run: ${run.error.message}`);
  }
  if (!run.stdout) {
    throw new Error(
      `npm audit produced no JSON (exit ${run.status}): ${run.stderr ?? ""}`.trim(),
    );
  }
  try {
    return JSON.parse(run.stdout);
  } catch (error) {
    throw new Error(`npm audit output is not JSON: ${error.message}`);
  }
}

function selfTest() {
  const report = (vulnerabilities) => ({ vulnerabilities });
  const objectVia = (name, ghsa) => ({
    name,
    url: `https://github.com/advisories/${ghsa}`,
  });
  const row = (packageName, advisory) => ({
    package: packageName,
    advisory,
    reason: "fixture",
    reviewed: "2026-10-25",
  });
  const cases = [
    [
      "fails a finding no row covers",
      () =>
        evaluateAuditReport(
          report({ "node-forge": { via: [objectVia("node-forge", "GHSA-aaaa-bbbb-cccc")] } }),
          [],
        ).ok === false,
    ],
    [
      "passes a covered finding",
      () =>
        evaluateAuditReport(
          report({ "node-forge": { via: [objectVia("node-forge", "GHSA-aaaa-bbbb-cccc")] } }),
          [row("node-forge", "GHSA-aaaa-bbbb-cccc")],
        ).ok === true,
    ],
    [
      "fails a stale row",
      () =>
        evaluateAuditReport(report({}), [row("node-forge", "GHSA-aaaa-bbbb-cccc")])
          .stale.length === 1,
    ],
    [
      "matches a string via against the named dependency",
      () =>
        evaluateAuditReport(
          report({ "@google/design.md": { via: ["zod"] } }),
          [row("@google/design.md", "zod")],
        ).ok === true,
    ],
    [
      "spends a wildcard row once",
      () =>
        evaluateAuditReport(
          report({ pkg: { via: ["dep", "dep"] } }),
          [row("pkg", "*")],
        ).unmatched.length === 1,
    ],
    [
      "prefers an exact row before a wildcard",
      () =>
        evaluateAuditReport(report({ pkg: { via: ["dep", "other"] } }), [
          row("pkg", "*"),
          row("pkg", "dep"),
        ]).ok === true,
    ],
  ];
  let failed = 0;
  for (const [name, passes] of cases) {
    const ok = passes();
    if (!ok) failed += 1;
    process.stdout.write(`${ok ? "ok  " : "FAIL"} ${name}\n`);
  }
  if (failed > 0) {
    process.stderr.write(`audit-policy self-test: ${failed} case(s) wrong\n`);
    process.exit(1);
  }
  process.stdout.write(
    `audit-policy self-test: all ${cases.length} cases behave\n`,
  );
  process.exit(0);
}

function flagValue(argv, flag) {
  const at = argv.indexOf(flag);
  if (at < 0) return undefined;
  const value = argv[at + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} needs a file`);
  }
  return value;
}

if (process.argv.includes("--self-test")) selfTest();

try {
  const argv = process.argv.slice(2);
  const reportArg = flagValue(argv, "--report");
  const allowlistArg = flagValue(argv, "--allowlist");
  const allowlist = parseAllowlist(
    readJson(
      allowlistArg === undefined ? DEFAULT_ALLOWLIST : resolve(allowlistArg),
      "allowlist",
    ),
  );
  const report = parseReport(
    reportArg === undefined ? auditJson() : readJson(resolve(reportArg), "audit report"),
  );
  const { ok, unmatched, stale } = evaluateAuditReport(report, allowlist);

  for (const finding of unmatched) {
    process.stderr.write(
      `audit-policy: ${finding.package} ${finding.advisory} is not allowlisted\n`,
    );
  }
  for (const entry of stale) {
    process.stderr.write(
      `audit-policy: allowlist entry ${entry.package} ${entry.advisory} (reviewed ${entry.reviewed}) matches no finding\n`,
    );
  }
  if (!ok) {
    process.stderr.write(
      `audit-policy: ${unmatched.length} unallowlisted finding(s), ${stale.length} stale row(s)\n`,
    );
    process.exit(1);
  }
  process.stdout.write("audit-policy: every finding is allowlisted, no stale rows\n");
} catch (error) {
  process.stderr.write(`audit-policy: ${error.message}\n`);
  process.exit(2);
}
