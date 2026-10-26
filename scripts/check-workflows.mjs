#!/usr/bin/env node

/**
 * Supply-chain guard for `.github/workflows/`. Every action is pinned to a
 * commit SHA, and `publish.yml` keeps the privilege split the release path
 * needs: `install` reads contents, `publish` holds `id-token: write` for
 * provenance and `contents: write` for the release upload.
 *
 * `node scripts/check-workflows.mjs`
 *
 * Its cases live in `src/web/tests/scripts/check-workflows.test.ts`.
 *
 * Reading ceiling. This is not a YAML parser; it reads the block-map shape
 * these workflows use. Supported: `jobs:` -> job -> `permissions:` block map ->
 * `steps:` list -> step keys -> `with:` block map, and `run: |` block scalars
 * (their contents are skipped, so a `uses:` inside one is not seen). Not
 * supported: anchors, flow-style maps, a permission written inline, or a job
 * with no `steps:` list. If a workflow needs one of those, upgrade the reader
 * then.
 *
 * Exit: 0 clean, 1 rule violation (one line per violation), 2 unreadable input.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const WORKFLOWS = ".github/workflows";
const PINNED = /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/;

/** The guard literals rule 4 requires in `install`'s first step. */
const GUARD_LITERALS = [
  "GITHUB_EVENT_NAME",
  "workflow_dispatch",
  "DRY_RUN",
  "GITHUB_REF",
  "refs/tags/v*",
  "exit 1",
];

function indentOf(line) {
  return /^ */.exec(line)[0].length;
}

/** A `key: value` line, with a trailing `# comment` removed from the value. */
function keyValue(body) {
  const match = /^([\w-]+):\s*(.*)$/.exec(body);
  if (match === null) return undefined;
  return { key: match[1], value: match[2].replace(/\s+#.*$/, "").trim() };
}

/**
 * The parts of a workflow the rules ask about. Steps keep their `uses`, `run`
 * text and `with` map; jobs keep their permission map and steps.
 */
function parseWorkflow(text) {
  const jobs = new Map();
  const uses = [];
  const lines = text.split(/\r?\n/);
  let inJobs = false;
  let job = null;
  let step = null;
  let permissions = null;
  let withBlock = null;
  let block = null;

  const close = (indent) => {
    if (permissions !== null && indent <= permissions.indent) permissions = null;
    if (withBlock !== null && indent <= withBlock.indent) withBlock = null;
    if (step !== null && indent <= 4) step = null;
  };

  const applyStepLine = (target, body, at, line) => {
    const parsed = keyValue(body);
    if (parsed === undefined) return;
    if (parsed.key === "with") {
      withBlock = { indent: at, entries: target.with };
      return;
    }
    if (parsed.key === "uses") {
      target.uses = parsed.value;
      uses.push({ line, value: parsed.value });
      return;
    }
    if (parsed.key === "run") {
      target.run = parsed.value;
      if (/^[|>][+-]?$/.test(parsed.value)) {
        block = {
          indent: at,
          append: (text) => {
            target.run += `\n${text}`;
          },
        };
      }
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();

    if (block !== null) {
      if (trimmed === "") {
        block.append("");
        continue;
      }
      if (indentOf(raw) > block.indent) {
        block.append(raw);
        continue;
      }
      block = null;
    }

    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const indent = indentOf(raw);
    close(indent);

    let isItem = false;
    let body = trimmed;
    if (body.startsWith("- ")) {
      isItem = true;
      body = body.slice(2).trim();
    }

    if (indent === 0) {
      inJobs = body === "jobs:";
      if (body.startsWith("permissions:")) {
        permissions = { indent: 0, entries: new Map() };
      }
      continue;
    }

    if (indent === 2) {
      if (permissions !== null && permissions.indent === 0) {
        const parsed = keyValue(body);
        if (parsed !== undefined) permissions.entries.set(parsed.key, parsed.value);
        continue;
      }
      if (inJobs) {
        const match = /^([\w-]+):\s*$/.exec(body);
        if (match !== null) {
          job = { name: match[1], permissions: null, steps: [] };
          jobs.set(match[1], job);
        }
      }
      continue;
    }

    if (job === null) continue;

    if (indent === 4) {
      if (body === "steps:") {
        job.steps = [];
        step = null;
        continue;
      }
      if (body.startsWith("permissions:")) {
        permissions = { indent: 4, entries: new Map() };
        job.permissions = permissions.entries;
        continue;
      }
      const parsed = keyValue(body);
      if (parsed !== undefined && parsed.key === "uses") {
        uses.push({ line: index + 1, value: parsed.value });
      }
      continue;
    }

    if (indent === 6) {
      if (isItem) {
        step = { uses: undefined, run: "", with: new Map() };
        job.steps.push(step);
        applyStepLine(step, body, 8, index + 1);
        continue;
      }
      if (permissions !== null && permissions.indent === 4) {
        const parsed = keyValue(body);
        if (parsed !== undefined) permissions.entries.set(parsed.key, parsed.value);
        continue;
      }
      continue;
    }

    if (indent === 8) {
      if (step !== null) applyStepLine(step, body, 8, index + 1);
      continue;
    }

    if (indent >= 10 && withBlock !== null && indent === withBlock.indent + 2) {
      const parsed = keyValue(body);
      if (parsed !== undefined) withBlock.entries.set(parsed.key, parsed.value);
    }
  }

  return { jobs, uses };
}

/** `permissions:` entries as `key: value` pairs, or `[]` when absent. */
function permissionPairs(job) {
  return job?.permissions === null || job?.permissions === undefined
    ? []
    : [...job.permissions];
}

function describePermissions(job) {
  const pairs = permissionPairs(job);
  return pairs.length === 0
    ? "no permissions declared"
    : pairs.map(([key, value]) => `${key}: ${value}`).join(", ");
}

function checkPublish(publish) {
  const violations = [];
  const install = publish.jobs.get("install");
  const write = publish.jobs.get("publish");

  if (install === undefined) violations.push('no "install" job');
  if (write === undefined) violations.push('no "publish" job');

  // Rule 2: install holds read-only contents and nothing else; the job that
  // publishes holds the OIDC token provenance needs.
  if (install !== undefined) {
    const pairs = permissionPairs(install);
    const readOnly =
      pairs.length === 1 && pairs[0][0] === "contents" && pairs[0][1] === "read";
    if (!readOnly) {
      violations.push(
        `install job must declare exactly "contents: read" (got ${describePermissions(install)})`,
      );
    }
  }
  if (write !== undefined && write.permissions?.get("id-token") !== "write") {
    violations.push('publish job lacks "id-token: write"');
  }

  // Rule 3: a checkout keeps no credential in the tree.
  for (const [name, job] of publish.jobs) {
    for (const step of job.steps) {
      if (
        step.uses?.startsWith("actions/checkout@") === true &&
        step.with.get("persist-credentials") !== "false"
      ) {
        violations.push(
          `${name} job's checkout must set persist-credentials: false`,
        );
      }
    }
  }

  // Rule 4: the non-dry manual dispatch off a tag is refused before any work,
  // in install's first step, so `needs: install` covers publish too.
  if (install !== undefined) {
    const guard = install.steps[0]?.run ?? "";
    const missing = GUARD_LITERALS.filter((literal) => !guard.includes(literal));
    if (missing.length > 0) {
      violations.push(
        `install job's first step must be the non-dry manual-dispatch tag guard (missing ${missing.join(", ")})`,
      );
    }
  }

  // Rule 5: only publish may write contents, and only publish may take the
  // OIDC token.
  if (write !== undefined && write.permissions?.get("contents") !== "write") {
    violations.push('publish job lacks "contents: write"');
  }
  if (install?.permissions?.has("id-token") === true) {
    violations.push('install job must not request "id-token"');
  }

  return violations;
}

/**
 * Every rule against the tree rooted at `root`. Returns the exit code and the
 * lines to print, so its tests can assert on both without the process exiting.
 */
export function checkWorkflows(root) {
  const dir = join(root, WORKFLOWS);
  let files;
  try {
    files = readdirSync(dir)
      .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
      .sort();
  } catch (error) {
    return { exitCode: 2, lines: [`workflows: cannot read ${dir}: ${error.message}`] };
  }

  // A directory this check cannot read is reported above; an empty one would
  // let every rule pass without seeing a workflow.
  if (files.length === 0) {
    return {
      exitCode: 1,
      lines: [`workflows: no workflow files under ${WORKFLOWS}`],
    };
  }

  const parsed = new Map();
  const violations = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(join(dir, file), "utf8");
    } catch (error) {
      return {
        exitCode: 2,
        lines: [`workflows: cannot read ${file}: ${error.message}`],
      };
    }
    const workflow = parseWorkflow(text);
    parsed.set(file, workflow);
    for (const use of workflow.uses) {
      if (!PINNED.test(use.value)) {
        violations.push(
          `${file}:${use.line}: uses must be owner/repo@<40 lowercase hex>, got "${use.value}"`,
        );
      }
    }
  }

  const publish = parsed.get("publish.yml");
  if (publish === undefined) {
    violations.push("publish.yml: missing; the publish rules cannot be checked");
  } else {
    for (const violation of checkPublish(publish)) {
      violations.push(`publish.yml: ${violation}`);
    }
  }

  if (violations.length > 0) {
    return {
      exitCode: 1,
      lines: [
        ...violations.map((violation) => `workflows: ${violation}`),
        `workflows: ${violations.length} violation(s)`,
      ],
    };
  }
  return {
    exitCode: 0,
    lines: [
      `workflows: ${files.length} workflow(s) SHA-pinned; publish permissions least-privilege`,
    ],
  };
}

/** Runs the check against the repository this script lives in. */
function main() {
  const { exitCode, lines } = checkWorkflows(ROOT);
  const stream = exitCode === 0 ? process.stdout : process.stderr;
  for (const line of lines) stream.write(`${line}\n`);
  return exitCode;
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  process.exit(main());
}
