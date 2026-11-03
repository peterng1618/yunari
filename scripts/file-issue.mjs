#!/usr/bin/env node

/**
 * Files a user's off-task report as a GitHub issue, so an agent can record it
 * without assembling `gh` flags, labels and a body.
 *
 * `node scripts/file-issue.mjs --kind bug --title "<symptom>" --recap-file <path>`
 * `node scripts/file-issue.mjs --kind request --title "<what>" --recap "<text>"`
 * `node scripts/file-issue.mjs --kind bug --title "<symptom>" --body-file <path>`
 *
 * `--recap` is the agent's own paraphrase of the report — never the user's
 * words, which may carry personal detail and must not reach a public issue.
 * Machine-specific detail is refused too: a local absolute path, the computer
 * or account name, a private address, a serial number or a token is generalized
 * to what a repro needs ("the authoring PC", "<repo>/src/web/..."). The body is
 * the recap under the issue form's `What` heading, its source (a user report or
 * the agent's own finding) and provenance; optional `--journey`/`--done`
 * answers are included only when supplied, and nothing is invented for the
 * rest. `--body`/`--body-file` posts a finished body unchanged. With neither, a
 * piped stdin is read as the recap.
 *
 * `--attach` passes a file the reporter sent, such as a screenshot, to the
 * issue. The repository is resolved from `origin`, not from `GH_REPO`, because
 * `GH_REPO` can point at another repository and would send the issue there
 * silently. `--repo` overrides both. `--dry-run` prints the assembled issue as
 * JSON and touches no network.
 *
 * Its cases live in `src/web/tests/scripts/file-issue.test.ts`.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs as parseNodeArgs } from "node:util";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_REPO = "peterng1618/yunari";
const MAX_TITLE = 256;
/** GitHub's body limit is 65536; leave room for the generated provenance. */
const MAX_BODY = 60_000;

export const KIND_LABELS = {
  bug: ["bug", "needs-triage"],
  request: ["needs-triage"],
};

/**
 * Shapes a recap can avoid mechanically. A computer name, serial number or
 * token has no reliable shape, so the help text bans those by name and the
 * local machine's own host/account names are checked separately.
 */
const MACHINE_PATTERNS = [
  {
    name: "a Windows user-profile path",
    pattern: /[A-Za-z]:[\\/]+Users[\\/]+(?!<|%|\{)[^\\/\s]+/i,
    advice: "write <repo>/... or describe the settings directory",
  },
  {
    name: "a macOS user-profile path",
    pattern: /\/Users\/(?!<|%|\{)[^/\s]+/,
    advice: "write <repo>/... or describe the settings directory",
  },
  {
    name: "a Linux home path",
    pattern: /\/home\/(?!<|%|\{)[^/\s]+/,
    advice: "write <repo>/... or describe the settings directory",
  },
  {
    name: "a UNC path naming a machine",
    pattern: /\\\\[A-Za-z0-9_.-]+\\/,
    advice: "describe the share, not the machine",
  },
  {
    name: "a private network address",
    pattern:
      /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/,
    advice: 'say "the local network"',
  },
  {
    name: "a MAC address",
    pattern: /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/,
    advice: "drop it; it identifies one adapter",
  },
];

const USAGE = `Usage:
  node scripts/file-issue.mjs --kind bug|request --title <title> \\
    (--recap <text> | --recap-file <path> | --body <markdown> | --body-file <path>)
    [--evidence <text>] [--source user|agent] [--journey <text>] [--done <text>]
    [--attach <file>]... [--label <name>]... [--repo <owner/name>] [--dry-run]

  A piped stdin is the recap when no body or recap flag is given.
  Recap the report in your own words; never paste the user's message.
  Generalize local absolute paths, computer or account names, hostnames,
  IP/MAC addresses, serial numbers and tokens.

Examples:
  node scripts/file-issue.mjs --kind bug --title "Delete does nothing on a grouped child" \\
    --recap-file recap.txt
  node scripts/file-issue.mjs --kind request --title "Gauge label should show its binding" \\
    --recap "A bound run shows '-' and does not name the binding."
`;

function fail(message) {
  throw new Error(message);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function localMachineNames() {
  try {
    return [hostname(), userInfo().username].filter(
      (name) => typeof name === "string" && name.length >= 3,
    );
  } catch {
    return [];
  }
}

/**
 * Why `text` is not safe to publish as written; empty when it is. `names`
 * defaults to this machine's host and account names, which no pattern can
 * recognise, so they are compared literally.
 */
export function machineDetails(text, names = localMachineNames()) {
  if (typeof text !== "string" || text === "") return [];
  const found = [];
  for (const detail of MACHINE_PATTERNS) {
    if (detail.pattern.test(text)) {
      found.push(`${detail.name}; ${detail.advice}`);
    }
  }
  for (const name of names) {
    if (
      typeof name === "string" &&
      name.length >= 3 &&
      new RegExp(`\\b${escapeRegExp(name)}\\b`, "i").test(text)
    ) {
      found.push(
        'this machine or account name; replace it with a role such as "the authoring PC"',
      );
      break;
    }
  }
  return found;
}

function assertGeneralized(text) {
  const found = machineDetails(text);
  if (found.length > 0) {
    fail(`generalize before filing — ${found.join("; ")}`);
  }
}

/** `git@github.com:owner/repo.git` and `https://github.com/owner/repo` alike. */
export function repoFromRemote(url) {
  if (typeof url !== "string") return undefined;
  const match = url
    .trim()
    .replace(/\.git$/, "")
    .match(/github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  return match === null ? undefined : `${match[1]}/${match[2]}`;
}

export function resolveRepo({ explicit, remote }) {
  if (explicit !== undefined) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(explicit)) {
      fail(`--repo must be owner/name, got "${explicit}"`);
    }
    return explicit;
  }
  return repoFromRemote(remote) ?? DEFAULT_REPO;
}

function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

/** Branch and short commit, so an issue filed mid-task says where it came from. */
export function worktreeContext() {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const sha = git(["rev-parse", "--short", "HEAD"]);
  return branch === undefined || sha === undefined
    ? undefined
    : { branch, sha };
}

export function validateTitle(value) {
  const title = typeof value === "string" ? value.trim() : "";
  if (title === "") fail("--title is required");
  if (/[\u0000-\u001f\u007f]/.test(title)) {
    fail("--title must be one line without control characters");
  }
  if (title.length > MAX_TITLE) {
    fail(`--title must be at most ${MAX_TITLE} characters`);
  }
  return title;
}

export function normalizeLabels(kind, extras = []) {
  if (KIND_LABELS[kind] === undefined) {
    fail(`--kind must be bug or request, got "${kind}"`);
  }
  const labels = [...KIND_LABELS[kind]];
  for (const label of extras) {
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/.test(label)) {
      fail(`--label "${label}" is not a plain label name`);
    }
    if (!labels.includes(label)) labels.push(label);
  }
  return labels;
}

/**
 * The report itself, plus whichever optional sections the agent could answer.
 * Nothing is invented for the rest: the next agent can work out the journey,
 * the cause or the fix from the recap.
 */
export function buildReportBody({
  kind,
  recap,
  evidence,
  context,
  journey,
  done,
  source = "user",
}) {
  const text = typeof recap === "string" ? recap.trim() : "";
  if (text === "") fail("the recap is empty");
  if (source !== "user" && source !== "agent") {
    fail(`--source must be user or agent, got "${source}"`);
  }
  const evidenceParts = [];
  if (typeof evidence === "string" && evidence.trim() !== "") {
    evidenceParts.push(evidence.trim());
  }
  if (context !== undefined) {
    evidenceParts.push(
      `Filed while working on \`${context.branch}\` at \`${context.sha}\`.`,
    );
  }
  const optional = (value) =>
    typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
  const journeyText = optional(journey);
  const doneText = optional(done);

  const sections = [
    [kind === "bug" ? "What happens" : "What", text],
    [
      "Source",
      source === "user" ? "Reported by a user." : "Found by the agent.",
    ],
  ];
  if (kind !== "bug" && journeyText !== undefined) {
    sections.push(["Which journey it breaks or improves", journeyText]);
  }
  if (evidenceParts.length > 0) {
    sections.push(["Evidence", evidenceParts.join("\n\n")]);
  }
  if (kind !== "bug" && doneText !== undefined) {
    sections.push(['What "done" would look like', doneText]);
  }

  return `${sections.map(([heading, body]) => `**${heading}**\n\n${body}`).join("\n\n")}\n`;
}

/** A finished body or a generated one, either way with its labels. */
export function buildIssue({
  kind = "bug",
  title,
  recap,
  evidence,
  context,
  journey,
  done,
  source = "user",
  body,
  labels = [],
}) {
  const answer = validateTitle(title);
  assertGeneralized(answer);
  const issueBody =
    body === undefined
      ? buildReportBody({
          kind,
          recap,
          evidence,
          context,
          journey,
          done,
          source,
        })
      : body.trim();
  if (issueBody === "") fail("the issue body is empty");
  if (issueBody.length > MAX_BODY) {
    fail(`the issue body must be at most ${MAX_BODY} characters`);
  }
  assertGeneralized(issueBody);
  return {
    title: answer,
    body: issueBody.endsWith("\n") ? issueBody : `${issueBody}\n`,
    labels: normalizeLabels(kind, labels),
  };
}

/** The CLI surface, delegated to Node; `--report` exists only to refuse it. */
export function parseArgs(argv) {
  const { values } = parseNodeArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      help: { type: "boolean", short: "h" },
      "dry-run": { type: "boolean" },
      kind: { type: "string", default: "bug" },
      title: { type: "string" },
      recap: { type: "string" },
      "recap-file": { type: "string" },
      body: { type: "string" },
      "body-file": { type: "string" },
      evidence: { type: "string" },
      source: { type: "string", default: "user" },
      journey: { type: "string" },
      done: { type: "string" },
      attach: { type: "string", multiple: true, default: [] },
      label: { type: "string", multiple: true, default: [] },
      repo: { type: "string" },
      report: { type: "string" },
      "report-file": { type: "string" },
    },
  });

  if (values.report !== undefined || values["report-file"] !== undefined) {
    fail(
      "raw user text is not filed; recap the report in your own words with --recap",
    );
  }
  return {
    help: values.help === true,
    dryRun: values["dry-run"] === true,
    kind: values.kind,
    title: values.title,
    recap: values.recap,
    recapFile: values["recap-file"],
    body: values.body,
    bodyFile: values["body-file"],
    evidence: values.evidence,
    source: values.source,
    journey: values.journey,
    done: values.done,
    attachments: values.attach,
    labels: values.label,
    repo: values.repo,
  };
}

function readInput(options) {
  const fullBody = [options.body, options.bodyFile];
  if (fullBody.filter((value) => value !== undefined).length > 1) {
    fail("use only one of --body and --body-file");
  }

  const recapFlags = [options.recap, options.recapFile];
  if (recapFlags.filter((value) => value !== undefined).length > 1) {
    fail("use only one of --recap and --recap-file");
  }
  if (
    fullBody.some((value) => value !== undefined) &&
    recapFlags.some((value) => value !== undefined)
  ) {
    fail("a finished body and a recap are alternatives");
  }
  if (options.body !== undefined) return { body: options.body };
  if (options.bodyFile !== undefined) {
    return { body: readFileSync(resolve(options.bodyFile), "utf8") };
  }
  if (options.recapFile !== undefined) {
    return { recap: readFileSync(resolve(options.recapFile), "utf8") };
  }
  if (options.recap !== undefined) return { recap: options.recap };
  if (process.stdin.isTTY !== true) {
    return { recap: readFileSync(0, "utf8") };
  }
  fail("provide --recap, --recap-file, --body-file, or pipe a recap on stdin");
}

function resolveAttachments(paths) {
  return paths.map((path) => {
    if (!existsSync(path)) fail(`attachment not found: ${path}`);
    return resolve(path);
  });
}

function createIssue({ repo, title, body, labels, attachments }) {
  const dir = mkdtempSync(join(tmpdir(), "yunari-issue-"));
  try {
    const bodyFile = join(dir, "body.md");
    writeFileSync(bodyFile, body, "utf8");
    const args = [
      "issue",
      "create",
      "--repo",
      repo,
      "--title",
      title,
      "--body-file",
      bodyFile,
    ];
    for (const label of labels) args.push("--label", label);
    for (const attachment of attachments) args.push("--attach", attachment);
    const result = spawnSync("gh", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error !== undefined) {
      process.stderr.write(`cannot run gh: ${result.error.message}\n`);
      return 1;
    }
    if (result.status !== 0) {
      process.stderr.write(result.stderr || "gh issue create failed\n");
      return result.status ?? 1;
    }
    process.stdout.write(result.stdout);
    return 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (options.help === true) {
    process.stdout.write(USAGE);
    return 0;
  }

  try {
    const input = readInput(options);
    const repo = resolveRepo({
      explicit: options.repo,
      remote: git(["remote", "get-url", "origin"]),
    });
    const issue = buildIssue({
      kind: options.kind,
      title: options.title,
      recap: input.recap,
      evidence: options.evidence,
      source: options.source,
      journey: options.journey,
      done: options.done,
      context: input.recap === undefined ? undefined : worktreeContext(),
      body: input.body,
      labels: options.labels,
    });
    const attachments = resolveAttachments(options.attachments);

    if (options.dryRun === true) {
      process.stdout.write(
        `${JSON.stringify({ repo, ...issue, attachments }, null, 2)}\n`,
      );
      return 0;
    }
    return createIssue({ repo, ...issue, attachments });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  process.exit(main(process.argv.slice(2)));
}
