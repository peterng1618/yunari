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
 * `JOB_KEYS`, any step key outside `STEP_KEYS`, a block under a key that is
 * read as a scalar, and a bare list item where a mapping key is expected. A
 * workflow that needs a refused shape upgrades the reader then.
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

    if (key === "steps") {
      if (token.value !== "" || token.block !== undefined) refuseFlow(token, "steps");
      index = parseSteps(tokens, index + 1, job, uses);
      continue;
    }
    if (key === "permissions") {
      if (token.value !== "" || token.block !== undefined) {
        refuseFlow(token, "permissions");
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
      needs: [],
      steps: [],
      line: token.line,
    };
    jobs.set(token.key, job);
    index = parseJob(tokens, index + 1, job, uses);
  }
  return { jobs, uses, next: index };
}

/** The rule-relevant parts of one workflow; throws `UnreadShape` on anything else. */
function parseWorkflow(text) {
  const tokens = tokenize(text);
  const jobs = new Map();
  const uses = [];
  let sawJobs = false;
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
    index += 1;
  }
  return { jobs, uses };
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

function stripShellComments(text) {
  return text
    .split("\n")
    .map((line) => {
      let quote = null;
      for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (quote !== null) {
          if (character === quote) quote = null;
          continue;
        }
        if (character === '"' || character === "'") {
          quote = character;
          continue;
        }
        if (character === "#") return line.slice(0, index);
      }
      return line;
    })
    .join("\n");
}

/**
 * The tag guard is a condition, not a set of words. Returns why the first
 * step does not refuse a non-dry manual dispatch off a tag, or `undefined`.
 */
function guardProblem(run) {
  if (run === undefined) return "has no run: command";
  const joined = stripShellComments(run)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join("\n");
  if (joined === "") return "is comment-only";

  if (/^if\s+false\b/m.test(joined)) {
    return "is neutralised by a leading if false";
  }
  if (/^false\s*(?:;|&&|\|\||$)/m.test(joined)) {
    return "is neutralised by a bare false";
  }
  if (/\|\|\s*true\b/.test(joined)) {
    return "is neutralised by a trailing || true";
  }
  if (/&&\s*false\b/.test(joined)) {
    return "is neutralised by an && false";
  }

  const condition =
    /^\s*if\s+\[\[(.*?)\]\]\s*;\s*then\b/m.exec(joined) ??
    /^\s*if\s+\[(.*?)\]\s*;\s*then\b/m.exec(joined);
  if (condition === null) return "has no if/then condition";
  const test = condition[1];
  const reference = (name) => `\\$\\{?${name}\\}?"?`;
  const tests = (name, operator, value) =>
    new RegExp(`${reference(name)}\\s*${operator}\\s*"?${value}"?`).test(test);

  if (!tests("GITHUB_EVENT_NAME", "==?", "workflow_dispatch")) {
    return "does not test GITHUB_EVENT_NAME against workflow_dispatch";
  }
  if (!tests("DRY_RUN", "!=?", "true")) {
    return "does not test DRY_RUN against true";
  }
  if (!tests("GITHUB_REF", "!=?", "refs/tags/v\\*")) {
    return "does not test GITHUB_REF against refs/tags/v*";
  }
  if (!/^\s*exit\s+[1-9]\d*\s*$/m.test(joined)) {
    return "does not exit non-zero";
  }
  return undefined;
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
    if (!readOnly) {
      violations.push(
        `install job must declare exactly "contents: read" (got ${describePermissions(install)})`,
      );
    }
  }
  if (publishJob !== undefined && publishJob.permissions?.get("id-token") !== "write") {
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
    const problem = guardProblem(install.steps[0]?.run);
    if (problem !== undefined) {
      violations.push(`install job's first step ${problem}`);
    }
  }

  // Rule 5: only publish may write contents, and only publish may take the
  // OIDC token.
  if (
    publishJob !== undefined &&
    publishJob.permissions?.get("contents") !== "write"
  ) {
    violations.push('publish job lacks "contents: write"');
  }
  if (install?.permissions?.has("id-token") === true) {
    violations.push('install job must not request "id-token"');
  }

  // Rule 6: publish runs only after a successful install.
  if (publishJob !== undefined && !publishJob.needs.includes("install")) {
    violations.push(
      'publish job must declare "needs: install" so a failed install stops the publish',
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
      workflow = parseWorkflow(text);
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
