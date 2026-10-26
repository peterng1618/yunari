#!/usr/bin/env node

/**
 * Supply-chain guard for `.github/workflows/`. Every action is pinned to a
 * commit SHA, and `publish.yml` keeps the privilege split the release path
 * needs: `install` reads contents, `publish` holds `id-token: write` for
 * provenance and `contents: write` for the release upload, and nothing else.
 *
 * `node scripts/check-workflows.mjs`
 *
 * Its cases live in `src/web/tests/scripts/check-workflows.test.ts`.
 *
 * The reader is total over the `jobs:` tree. Every line there is a shape it
 * understands or an exit-2 refusal naming the file and line; it never skips a
 * line it cannot read. Understood: 2-space-indented block mappings and
 * sequences, `run: |` / `>` block scalars, quoted or anchored keys, quoted
 * scalar values, and step `with:`/`env:` maps. Not understood, and therefore
 * refused: flow-style collections (`[` or `{`), any job key outside
 * `JOB_KEYS` (`strategy:`, `concurrency:` and `services:` among them), any step
 * key outside `STEP_KEYS` (`continue-on-error:` among them), a block under a
 * key that is read as a scalar, and a bare list item where a mapping key is
 * expected. A workflow that needs a refused shape upgrades the reader then.
 *
 * `publish.yml`'s `on:` is read too, because the trigger decides whether the
 * workflow's `DRY_RUN` expression can publish: a `push:` run has no dispatch
 * input, so the expression evaluates `false` and the publish path runs without
 * one. Exactly two triggers are accepted — `release: types: [published]` and
 * `workflow_dispatch` with at most its `dry_run` input, typed boolean and
 * defaulting to true so an omitted input stays a dry run. Any other trigger
 * name, shape or extra key is a violation naming it. Other workflows' `on:`
 * blocks are not constrained.
 *
 * The tag guard in `publish.yml` is compared, not parsed: `install`'s first
 * step is the checkout, because the guard is a repository script and the file
 * is not on the runner before it; its second step runs only
 * `node scripts/assert-publish-ref.mjs` and declares nothing but `name` and
 * `run`. The decision itself is a tested function in
 * `scripts/assert-publish-ref.mjs`, so a negation, continuation or heredoc
 * changes the text and is refused, and a sibling key (`if:`, an `env:`
 * overriding `DRY_RUN`, `shell:`, `working-directory:`) is refused even when
 * the command still reads the same.
 *
 * Every other key that can change what the guard sees or whether its exit code
 * survives is constrained the same way. `install`'s `env` is exactly its three
 * staging variables, and its `defaults:`, a shell wrapper over every run, is
 * absent; a workflow-level `defaults:` is refused too. The checkout before the
 * guard declares only `uses` and `with`, and `with` is exactly `fetch-depth: 0`
 * and `persist-credentials: false`: an `if:` there skips the checkout the guard
 * needs, and a missing `fetch-depth` silently misdates the licence gate.
 * Anything else in those places is a refusal naming the key.
 *
 * Exit: 0 clean, 1 rule violation (one line per violation), 2 unreadable input
 * or an unread shape.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const WORKFLOWS = ".github/workflows";
const PINNED = /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/;
const PUBLISH_JOBS = new Set(["install", "publish"]);

const JOB_KEYS = new Set([
  "name",
  "if",
  "runs-on",
  "needs",
  "timeout-minutes",
  "permissions",
  "outputs",
  "env",
  "defaults",
  "steps",
]);

const STEP_KEYS = new Set([
  "name",
  "id",
  "if",
  "uses",
  "run",
  "with",
  "env",
  "working-directory",
  "shell",
]);

/** The three staging variables `install` is allowed to set for its steps. */
const INSTALL_ENV_KEYS = ["STAGE", "ASSETS", "SMOKE"];

/** The checkout before the guard must set exactly these, with these values. */
const CHECKOUT_WITH = new Map([
  ["fetch-depth", "0"],
  ["persist-credentials", "false"],
]);

/** The publish job's two permissions, and the whole privilege split. */
const PUBLISH_PERMISSIONS = [
  ["contents", "write"],
  ["id-token", "write"],
];

/** The one sentence every trigger violation ends with. */
const PUBLISH_TRIGGERS =
  "publish.yml may only run on release: types: [published] and workflow_dispatch with its dry_run input";

/** A key spelling the reader knows is not the shape it has to read. */
class UnreadShape extends Error {
  constructor(line, reason) {
    super(reason);
    this.line = line;
    this.reason = reason;
  }
}

function indentOf(line) {
  return /^ */.exec(line)[0].length;
}

function refuse(token, reason) {
  throw new UnreadShape(token.line, reason);
}

function startsFlow(value) {
  return value.startsWith("[") || value.startsWith("{");
}

function refuseFlow(token, label) {
  refuse(token, `flow-style ${label} is not read; write it as a block mapping`);
}

/** Tabs are not indentation YAML allows; a tab-indented line is unread. */
function hasTabIndent(line) {
  return /^\t/.test(line) || /^ *\t/.test(line);
}

/**
 * A `key: value` pair, with trailing comments removed and the value unquoted.
 * Accepts `key : value`, `"key":` and `'key':`, and an anchor before the key.
 */
function splitKey(text) {
  const match =
    /^(?:&[^\s]+\s+)?(?:"([^"]+)"|'([^']+)'|([^\s:#][^:]*?))\s*:(?:\s+(.*))?$/.exec(
      text,
    );
  if (match === null) return undefined;
  return {
    key: match[1] ?? match[2] ?? match[3],
    value: unquote(stripTrailingComment(match[4] ?? "")),
  };
}

/** A `#` that starts a comment: unquoted and preceded by whitespace. */
function stripTrailingComment(value) {
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "#" && (index === 0 || /\s/.test(value[index - 1]))) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value;
}

function unquote(value) {
  const first = value[0];
  if (
    value.length >= 2 &&
    (first === '"' || first === "'") &&
    value.at(-1) === first
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function isBlockIndicator(value) {
  return /^[|>][+-]?[0-9]?$/.test(value);
}

/**
 * Lines as structural tokens. Blank and comment lines vanish; a block scalar's
 * body is collected into `block` and never read as structure.
 */
function tokenize(text) {
  const tokens = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    if (hasTabIndent(raw)) {
      throw new UnreadShape(
        index + 1,
        "tab indentation is not read; indent with spaces",
      );
    }
    const line = index + 1;
    const indent = indentOf(raw);
    let isItem = false;
    let body = trimmed;
    if (body === "-") {
      tokens.push({ indent, isItem: true, key: undefined, value: "", line });
      continue;
    }
    if (body.startsWith("- ")) {
      isItem = true;
      body = body.slice(2).trim();
    }
    const parsed = splitKey(body);
    if (parsed === undefined) {
      tokens.push({
        indent,
        isItem,
        key: undefined,
        value: unquote(body),
        line,
      });
      continue;
    }
    if (isBlockIndicator(parsed.value)) {
      const collected = [];
      let next = index + 1;
      for (; next < lines.length; next += 1) {
        const inner = lines[next];
        if (inner.trim() === "") {
          collected.push("");
          continue;
        }
        if (indentOf(inner) > indent) {
          collected.push(inner);
          continue;
        }
        break;
      }
      tokens.push({
        indent,
        isItem,
        key: parsed.key,
        value: "",
        block: collected.join("\n"),
        line,
      });
      index = next - 1;
      continue;
    }
    tokens.push({
      indent,
      isItem,
      key: parsed.key,
      value: parsed.value,
      line,
    });
  }
  return tokens;
}

/**
 * A block mapping whose entries are at `ownerIndent + 2`. A key with no value
 * opens a nested mapping; anything else is either a scalar or a refusal.
 */
function parseMapping(tokens, start, ownerIndent, label) {
  const value = new Map();
  let index = start;
  while (index < tokens.length && tokens[index].indent > ownerIndent) {
    const token = tokens[index];
    if (token.indent !== ownerIndent + 2) {
      refuse(token, `${label}: shape is not read at indent ${token.indent}`);
    }
    if (token.isItem) {
      refuse(token, `${label} must be a block mapping, not a sequence`);
    }
    if (token.key === undefined) {
      refuse(token, `${label}: entry is not read`);
    }
    if (token.block !== undefined) {
      value.set(token.key, token.block);
      index += 1;
      continue;
    }
    if (token.value !== "") {
      if (startsFlow(token.value)) refuseFlow(token, `${label} "${token.key}"`);
      value.set(token.key, token.value);
      index += 1;
      continue;
    }
    const nested = parseMapping(tokens, index + 1, token.indent, label);
    value.set(token.key, nested.value);
    index = nested.next;
  }
  return { value, next: index };
}

function applyStepKey(tokens, index, step, token, uses) {
  const key = token.key;
  if (key === undefined) refuse(token, "step key is not read");
  if (!STEP_KEYS.has(key)) refuse(token, `step key "${key}" is not read`);
  step.keys.add(key);
  if (key === "with" || key === "env") {
    if (token.value !== "" || token.block !== undefined) {
      refuseFlow(token, `step ${key}`);
    }
    const parsed = parseMapping(tokens, index + 1, token.indent, `step ${key}`);
    step[key] = parsed.value;
    return parsed.next;
  }
  if (key === "run") {
    if (token.block !== undefined) {
      step.run = token.block;
      return index + 1;
    }
    if (token.value === "") refuse(token, 'step key "run" has no command');
    if (startsFlow(token.value)) refuseFlow(token, "step run");
    step.run = token.value;
    return index + 1;
  }
  if (token.block !== undefined) {
    refuse(token, `step key "${key}" must be a scalar`);
  }
  if (token.value === "") refuse(token, `step key "${key}" has no value`);
  if (startsFlow(token.value)) refuseFlow(token, `step "${key}"`);
  if (key === "uses") uses.push({ line: token.line, value: token.value });
  step[key] = token.value;
  return index + 1;
}

/** `steps:` list: one map per `- ` item, its keys at item indent + 2. */
function parseSteps(tokens, start, job, uses) {
  let index = start;
  while (index < tokens.length && tokens[index].indent > 4) {
    const item = tokens[index];
    if (item.indent !== 6) {
      refuse(item, `step shape is not read at indent ${item.indent}`);
    }
    if (!item.isItem) refuse(item, "steps must be a block sequence");
    const step = {
      line: item.line,
      uses: undefined,
      run: undefined,
      name: undefined,
      with: new Map(),
      env: new Map(),
      keys: new Set(),
    };
    let next;
    if (item.key !== undefined) {
      next = applyStepKey(tokens, index, step, item, uses);
    } else if (item.value !== "") {
      refuse(item, "a bare step value is not read");
    } else {
      next = index + 1;
    }
    while (next < tokens.length && tokens[next].indent === 8) {
      next = applyStepKey(tokens, next, step, tokens[next], uses);
    }
    if (next < tokens.length && tokens[next].indent > 8) {
      refuse(tokens[next], "step shape is not read");
    }
    job.steps.push(step);
    index = next;
  }
  return index;
}

function parseNeeds(tokens, index, token, job) {
  if (token.value !== "") {
    if (startsFlow(token.value)) refuseFlow(token, "needs");
    job.needs.push(token.value);
    return index + 1;
  }
  let next = index + 1;
  while (next < tokens.length && tokens[next].indent === 6) {
    const item = tokens[next];
    if (!item.isItem) refuse(item, "needs must be a block sequence");
    if (item.key !== undefined || item.value === "") {
      refuse(item, "needs item is not read");
    }
    job.needs.push(item.value);
    next += 1;
  }
  if (job.needs.length === 0) refuse(token, "needs must open a block sequence");
  return next;
}

function parseJob(tokens, start, job, uses) {
  let index = start;
  while (index < tokens.length && tokens[index].indent > 2) {
    const token = tokens[index];
    if (token.indent !== 4) {
      refuse(token, `job shape is not read at indent ${token.indent}`);
    }
    if (token.isItem) refuse(token, "a list item is not read at job level");
    if (token.key === undefined) refuse(token, "job key is not read");
    const key = token.key;
    if (!JOB_KEYS.has(key)) refuse(token, `job key "${key}" is not read`);
    job.keys.add(key);

    if (key === "steps") {
      if (token.value !== "" || token.block !== undefined) refuseFlow(token, "steps");
      index = parseSteps(tokens, index + 1, job, uses);
      continue;
    }
    if (key === "permissions") {
      if (token.block !== undefined) {
        refuse(token, 'job key "permissions" must be a block mapping');
      }
      if (token.value !== "") {
        // A scalar such as `read-all` is a refusal, not flow style; the rule
        // that says so names the scalar and the required shape.
        if (startsFlow(token.value)) refuseFlow(token, "permissions");
        job.permissionsScalar = token.value;
        index += 1;
        continue;
      }
      const parsed = parseMapping(tokens, index + 1, 4, "permissions");
      job.permissions = parsed.value;
      index = parsed.next;
      continue;
    }
    if (key === "needs") {
      index = parseNeeds(tokens, index, token, job);
      continue;
    }
    if (key === "outputs" || key === "env" || key === "defaults") {
      if (token.value !== "" || token.block !== undefined) {
        refuseFlow(token, key);
      }
      const parsed = parseMapping(tokens, index + 1, 4, key);
      job[key] = parsed.value;
      index = parsed.next;
      continue;
    }
    if (token.block !== undefined) {
      refuse(token, `job key "${key}" must be a scalar`);
    }
    if (token.value === "") {
      refuse(token, `job key "${key}" has no value`);
    }
    if (startsFlow(token.value)) refuseFlow(token, `job "${key}"`);
    index += 1;
  }
  return index;
}

function parseJobs(tokens, start, jobs, uses) {
  let index = start;
  while (index < tokens.length && tokens[index].indent > 0) {
    const token = tokens[index];
    if (token.indent !== 2) {
      refuse(token, `job list shape is not read at indent ${token.indent}`);
    }
    if (token.isItem) refuse(token, "a list item is not read where a job name goes");
    if (token.key === undefined) refuse(token, "job name is not read");
    if (token.value !== "" || token.block !== undefined) {
      refuse(token, `job "${token.key}" must open a block mapping`);
    }
    if (jobs.has(token.key)) refuse(token, `duplicate job "${token.key}"`);
    const job = {
      name: token.key,
      permissions: null,
      permissionsScalar: undefined,
      needs: [],
      steps: [],
      keys: new Set(),
      line: token.line,
    };
    jobs.set(token.key, job);
    index = parseJob(tokens, index + 1, job, uses);
  }
  return { jobs, uses, next: index };
}

/**
 * `on:` as a tree of block mappings and scalar values. Flow values such as
 * `[published]` are kept as written and judged by `triggerProblems`; only an
 * unreadable indentation or a sequence where a key goes is an exit-2 refusal.
 */
function readTriggerTree(tokens, start, ownerIndent, label) {
  const value = new Map();
  let index = start;
  while (index < tokens.length && tokens[index].indent > ownerIndent) {
    const token = tokens[index];
    if (token.isItem) {
      refuse(token, `${label} must be a block mapping, not a sequence`);
    }
    if (token.indent !== ownerIndent + 2) {
      refuse(token, `${label}: shape is not read at indent ${token.indent}`);
    }
    if (token.key === undefined) refuse(token, `${label}: entry is not read`);
    if (token.block !== undefined) {
      refuse(token, `${label} "${token.key}" must be a scalar or a block mapping`);
    }
    if (token.value !== "") {
      value.set(token.key, token.value);
      index += 1;
      continue;
    }
    const nested = readTriggerTree(tokens, index + 1, token.indent, label);
    value.set(token.key, nested.value);
    index = nested.next;
  }
  return { value, next: index };
}

/** The rule-relevant parts of one workflow; throws `UnreadShape` on anything else. */
function parseWorkflow(text, { publishTriggers = false } = {}) {
  const tokens = tokenize(text);
  const jobs = new Map();
  const uses = [];
  let sawJobs = false;
  let defaultsLine;
  let onLine;
  let on;
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token.indent === 0 && !token.isItem && token.key === "jobs") {
      if (sawJobs) refuse(token, "duplicate jobs: block");
      sawJobs = true;
      if (token.value !== "" || token.block !== undefined) refuseFlow(token, "jobs");
      const parsed = parseJobs(tokens, index + 1, jobs, uses);
      index = parsed.next;
      continue;
    }
    if (
      publishTriggers &&
      token.indent === 0 &&
      !token.isItem &&
      token.key === "on"
    ) {
      if (onLine !== undefined) refuse(token, "duplicate on: block");
      onLine = token.line;
      if (token.block !== undefined) {
        refuse(token, 'on: must be a block mapping, not a block scalar');
      }
      if (token.value !== "") {
        on = { scalar: token.value, line: token.line };
      } else {
        const parsed = readTriggerTree(tokens, index + 1, 0, "on");
        on = { mapping: parsed.value, line: token.line };
        index = parsed.next;
        continue;
      }
    }
    // A workflow-level `defaults:` is not read by any rule, so it is recorded
    // here and refused by the publish rules: its shell wrapper reaches every
    // run, the guard included.
    if (token.indent === 0 && !token.isItem && token.key === "defaults") {
      defaultsLine ??= token.line;
    }
    index += 1;
  }
  return { jobs, uses, defaultsLine, on };
}

/** `permissions:` entries as pairs, or `[]` when absent. */
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

const GUARD_COMMAND = "node scripts/assert-publish-ref.mjs";

/**
 * The guard step must run exactly the one command and declare nothing beside
 * `name` and `run`: a sibling key can stop it refusing while its `run` reads
 * unchanged. A comment-only `run: |` is still reachable, so it is named.
 */
function guardProblem(step) {
  if (step === undefined || step.run === undefined) return "has no run: command";
  const extra = [...step.keys].filter((key) => key !== "name" && key !== "run");
  if (extra.length > 0) {
    return `may only declare "name" and "run" (found ${extra.map((key) => `"${key}"`).join(", ")})`;
  }
  const lines = step.run
    .split("\n")
    .map((line) => stripTrailingComment(line).trim())
    .filter((line) => line !== "");
  if (lines.length === 0) return "is comment-only";
  if (lines.length === 1 && lines[0] === GUARD_COMMAND) return undefined;
  return `must run exactly "${GUARD_COMMAND}" (got "${lines.join(" / ")}")`;
}

/**
 * The checkout's own keys. Anything outside the exact key set or `with` map
 * can change what the guard or the licence date sees — `if:` skips the checkout
 * the guard needs, a missing `fetch-depth` misdates every licence rule — so
 * each offending key is named once.
 */
function checkoutProblems(name, step) {
  const problems = [];
  for (const key of step.keys) {
    if (key !== "uses" && key !== "with") {
      problems.push(
        `${name} job's checkout must declare only "uses" and "with" (found "${key}")`,
      );
    }
  }
  for (const [key, required] of CHECKOUT_WITH) {
    if (!step.with.has(key)) {
      problems.push(
        `${name} job's checkout with is missing "${key}" (required: "${required}")`,
      );
    } else if (step.with.get(key) !== required) {
      problems.push(
        `${name} job's checkout with "${key}" must be "${required}" (got "${step.with.get(key)}")`,
      );
    }
  }
  for (const key of step.with.keys()) {
    if (!CHECKOUT_WITH.has(key)) {
      problems.push(
        `${name} job's checkout with must set only "fetch-depth" and "persist-credentials" (found "${key}")`,
      );
    }
  }
  return problems;
}

/**
 * The install job's own keys around the guard. A job `env` can override
 * DRY_RUN for the guard alone while `publish` keeps the workflow value, and a
 * job `defaults` shell wrapper makes every `run` in the job return 0.
 */
function installProblems(install) {
  const problems = [];
  const env = install.env ?? new Map();
  for (const key of env.keys()) {
    if (!INSTALL_ENV_KEYS.includes(key)) {
      problems.push(
        `install job's env may only define ${INSTALL_ENV_KEYS.join(", ")} (found "${key}")`,
      );
    }
  }
  for (const key of INSTALL_ENV_KEYS) {
    if (!env.has(key)) {
      problems.push(`install job's env is missing "${key}"`);
    }
  }
  if (install.defaults !== undefined) {
    problems.push(
      'install job must not declare "defaults:": its run shell applies to the guard too',
    );
  }
  return problems;
}

/** The `dry_run` input's own keys and values: a non-dry default would publish. */
function dryRunProblems(dryRun, problems) {
  for (const key of dryRun.keys()) {
    if (!["description", "type", "default"].includes(key)) {
      problems.push(
        `on: workflow_dispatch input "dry_run" key "${key}" is not read; it may only declare description, type and default`,
      );
    }
  }
  if (dryRun.get("type") !== "boolean") {
    problems.push(
      'on: workflow_dispatch input "dry_run" must declare "type: boolean"',
    );
  }
  if (dryRun.get("default") !== "true") {
    problems.push(
      'on: workflow_dispatch input "dry_run" must declare "default: true", so a dispatch that omits it stays a dry run',
    );
  }
}

function dispatchProblems(dispatch, problems) {
  for (const key of dispatch.keys()) {
    if (key !== "inputs") {
      problems.push(
        `on: workflow_dispatch key "${key}" is not allowed; a manual dispatch may only name its "dry_run" input`,
      );
    }
  }
  const inputs = dispatch.get("inputs");
  if (inputs === undefined) return;
  if (!isMapping(inputs)) {
    problems.push(
      'on: workflow_dispatch "inputs:" must be a block mapping with at most a "dry_run" entry',
    );
    return;
  }
  for (const name of inputs.keys()) {
    if (name !== "dry_run") {
      problems.push(
        `on: workflow_dispatch input "${name}" is not allowed; only "dry_run" is read`,
      );
    }
  }
  const dryRun = inputs.get("dry_run");
  if (dryRun === undefined) return;
  if (!isMapping(dryRun)) {
    problems.push(
      'on: workflow_dispatch input "dry_run" must declare "type: boolean" and "default: true"',
    );
    return;
  }
  dryRunProblems(dryRun, problems);
}

/**
 * Rule 0: the trigger decides what `DRY_RUN` evaluates to, so a trigger the
 * dispatch guard does not know is a way round it.
 */
function triggerProblems(on) {
  if (on === undefined) {
    return [`on: is missing; ${PUBLISH_TRIGGERS}`];
  }
  if (on.scalar !== undefined) {
    return [
      `on: must be a block mapping, not the scalar "${on.scalar}"; ${PUBLISH_TRIGGERS}`,
    ];
  }
  const problems = [];
  const triggers = on.mapping;
  for (const name of triggers.keys()) {
    if (name !== "release" && name !== "workflow_dispatch") {
      problems.push(
        `on: trigger "${name}" is not allowed; ${PUBLISH_TRIGGERS}`,
      );
    }
  }

  const release = triggers.get("release");
  if (release === undefined) {
    problems.push(`on: is missing "release: types: [published]"`);
  } else if (!isMapping(release)) {
    problems.push(
      `on: "release:" must be a block mapping with "types: [published]", not the scalar "${release}"`,
    );
  } else {
    for (const key of release.keys()) {
      if (key !== "types") {
        problems.push(
          `on: release key "${key}" is not allowed; it may only declare "types: [published]"`,
        );
      }
    }
    const types = release.get("types");
    if (
      typeof types !== "string" ||
      types.replace(/\s+/g, "") !== "[published]"
    ) {
      problems.push(
        `on: release "types:" must be "[published]" (got ${types === undefined ? "nothing" : `"${types}"`})`,
      );
    }
  }

  const dispatch = triggers.get("workflow_dispatch");
  if (dispatch === undefined) {
    problems.push(
      'on: is missing "workflow_dispatch:" for the manual release path',
    );
  } else if (!isMapping(dispatch)) {
    problems.push(
      `on: "workflow_dispatch:" must be a block mapping naming at most its "dry_run" input, not the scalar "${dispatch}"`,
    );
  } else {
    dispatchProblems(dispatch, problems);
  }
  return problems;
}

/** Whether a value is a nested mapping (`Map`) rather than a scalar. */
function isMapping(value) {
  return value instanceof Map;
}

function checkPublish(publish) {
  const violations = [];
  const install = publish.jobs.get("install");
  const publishJob = publish.jobs.get("publish");

  if (install === undefined) violations.push('no "install" job');
  if (publishJob === undefined) violations.push('no "publish" job');

  // Only the two jobs the split defines. A job added later is a change this
  // check must see, not authority it silently grants.
  for (const name of publish.jobs.keys()) {
    if (!PUBLISH_JOBS.has(name)) {
      violations.push(
        `job "${name}" is not allowed; publish.yml may only define install and publish`,
      );
    }
  }

  // Rule 2: install holds read-only contents and nothing else; the job that
  // publishes holds the OIDC token provenance needs.
  if (install !== undefined) {
    const pairs = permissionPairs(install);
    const readOnly =
      pairs.length === 1 && pairs[0][0] === "contents" && pairs[0][1] === "read";
    if (install.permissionsScalar !== undefined) {
      violations.push(
        `install job declares permissions as the scalar "${install.permissionsScalar}"; it must declare exactly "contents: read"`,
      );
    } else if (!readOnly) {
      violations.push(
        `install job must declare exactly "contents: read" (got ${describePermissions(install)})`,
      );
    }
  }
  // The trigger decides `DRY_RUN`; see `triggerProblems`.
  violations.push(...triggerProblems(publish.on));

  // A workflow-level defaults: is a shell wrapper over every run; the guard is
  // one of them.
  if (publish.defaultsLine !== undefined) {
    violations.push(
      'workflow-level "defaults:" is not allowed: its run shell applies to every run, the publish guard included',
    );
  }

  // Rule 3: the checkout declares only what the guard and the licence date
  // depend on, with exactly their values.
  for (const [name, job] of publish.jobs) {
    for (const step of job.steps) {
      if (step.uses?.startsWith("actions/checkout@") === true) {
        violations.push(...checkoutProblems(name, step));
      }
    }
  }

  // Rule 4: install's env and defaults cannot change what the guard sees or
  // whether its exit code survives.
  if (install !== undefined) {
    violations.push(...installProblems(install));
  }

  // Rule 5: the checkout is first — the guard is a repository script, so the
  // file must exist before it runs — and the non-dry manual dispatch off a tag
  // is refused in the step right after it, before any other work, so
  // `needs: install` covers publish too.
  if (install !== undefined) {
    if (install.steps[0]?.uses?.startsWith("actions/checkout@") !== true) {
      violations.push(
        "install job's first step must be actions/checkout, before the publish guard, because the guard is a repository script that has to be checked out first",
      );
    }
    if (install.steps[1] === undefined) {
      violations.push(
        "the step after the checkout must be the publish guard (node scripts/assert-publish-ref.mjs); install job has no step there",
      );
    } else {
      const problem = guardProblem(install.steps[1]);
      if (problem !== undefined) {
        violations.push(
          `the step after the checkout must be the publish guard (node scripts/assert-publish-ref.mjs); install job has a different step there: ${problem}`,
        );
      }
    }
  }

  // Rule 6: publish holds exactly the two permissions the publish path needs —
  // the OIDC token for provenance and the contents write for the release
  // upload — and install holds neither. A third permission on publish is the
  // same widening as an extra one on install.
  if (publishJob !== undefined) {
    if (publishJob.permissionsScalar !== undefined) {
      violations.push(
        `publish job declares permissions as the scalar "${publishJob.permissionsScalar}"; it must declare exactly "contents: write" and "id-token: write"`,
      );
    } else {
      const pairs = permissionPairs(publishJob);
      const exact =
        pairs.length === PUBLISH_PERMISSIONS.length &&
        PUBLISH_PERMISSIONS.every(
          ([key, value]) => publishJob.permissions?.get(key) === value,
        );
      if (!exact) {
        violations.push(
          `publish job must declare exactly "contents: write" and "id-token: write" (got ${describePermissions(publishJob)})`,
        );
      }
    }
  }
  if (install?.permissions?.has("id-token") === true) {
    violations.push('install job must not request "id-token"');
  }

  // Rule 7: publish runs only after a successful install.
  if (publishJob !== undefined && !publishJob.needs.includes("install")) {
    violations.push(
      'publish job must declare "needs: install" so a failed install stops the publish',
    );
  }

  // A job-level condition on publish makes `needs:` non-binding: `if:
  // always()` runs it after a failed install, and the comment claiming
  // otherwise stops being true.
  if (publishJob?.keys.has("if") === true) {
    violations.push(
      'publish job must not declare "if:": a job-level condition makes "needs: install" non-binding',
    );
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

    let workflow;
    try {
      workflow = parseWorkflow(text, {
        publishTriggers: file === "publish.yml",
      });
    } catch (error) {
      if (error instanceof UnreadShape) {
        return {
          exitCode: 2,
          lines: [`workflows: ${file}:${error.line}: ${error.reason}`],
        };
      }
      throw error;
    }

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
