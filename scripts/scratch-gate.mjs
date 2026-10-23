#!/usr/bin/env node
/**
 * One root for agent scratch, and a refusal anywhere else (0081).
 *
 * The question this answers, in the user's words: *"How do we prevent agents
 * from saving scratch files & folders from all over the places?"* — asked after a
 * cleanup found 264 MB of probe trees at the root of `D:\` and 560 MB under
 * `C:\tmp`, beside in-tree residue that `git` had been told to ignore.
 *
 * Three modes, one policy:
 *
 *   (default)    the `PreToolUse` hook: reads the tool call on stdin and refuses
 *                a write that lands in scratch, exit 2 with a message.
 *   --sweep      the gate step: walks the repository and fails on
 *                ignored-but-present entries that are not a documented store.
 *   --self-test  proves both halves can fail.
 *
 * **The refusal is deliberately blunt and fails open.** It judges a path and a
 * short list of output shapes; anything it cannot read is allowed through to the
 * sweep, which is the half that walks the filesystem. A gate that refuses work it
 * does not understand is worse than one that misses a case.
 *
 * Escape hatch, for scratch that genuinely belongs somewhere else: set
 * `YUNARI_ALLOW_SCRATCH=1` for the invocation, so using it is visible.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

/**
 * Where scratch is allowed to go. `C:\tmp` is the habit this repo's own ADRs
 * cite (`C:\tmp\glass-proof`), and `os.tmpdir()` is the OS answer; `~/.claude` is
 * the harness's own territory rather than scratch, and blocking it would stop a
 * session writing its memory or its settings.
 */
const SANCTIONED = [tmpdir(), "C:\\tmp", join(homedir(), ".claude")];

/**
 * A path segment that marks scratch **anywhere it appears**. Deliberately short:
 * these are the names the debris actually used, plus the stores a build writes.
 * `-scratch` is matched as a suffix, because the debris spelled it four ways
 * (`scratch/`, `.agent-scratch/`, `.task252-scratch/`, `yunari-scratch/`).
 */
const SCRATCH_SEGMENTS = new Set([
  "tmp",
  ".tmp",
  ".playwright-mcp",
  "test-results",
  "playwright-report",
  ".vitest",
  "coverage",
  "logs",
]);

function isScratchSegment(segment) {
  const lower = segment.toLowerCase();
  return SCRATCH_SEGMENTS.has(lower) || /(^|[.\-_])scratch$/.test(lower);
}

/** Scratch by file name, for the residue that is one file rather than a folder. */
const SCRATCH_NAMES = [
  /\.log$/i,
  /\.bak$/i,
  /-report\.json$/i,
  /^tmp[-_.]/i,
  /^vitest.*\.json$/i,
  /(^|[-_.])(before|after)\.png$/i,
];

/**
 * Ignored entries that are **stores**, not residue: a tool's own state, an
 * install, a build output, a harness cache. Matched per segment, because git's
 * own bare patterns match at any depth — a package's own dist is as legitimate
 * as the root one, and a list of full paths would have to name every package.
 *
 * Everything ignored that is *not* here is a finding, which is what keeps this
 * list from growing quietly: adding a store is a deliberate edit to a documented
 * set.
 */
const ALLOWED_SEGMENTS = new Set([
  ".claude",
  ".codegraph",
  ".superpowers",
  "node_modules",
  "dist",
  "vendor",
  "test-results",
  ".vitest",
  ".e2e-host-app",
  ".e2e-display-app",
  ".e2e-publish-app",
  ".e2e-font-cache",
  "playwright-report",
]);

function isStore(entry) {
  const rel = posix(entry);
  if (rel.endsWith(".tsbuildinfo")) return true;
  return rel
    .split("/")
    .filter((segment) => segment !== "")
    .some((segment) => ALLOWED_SEGMENTS.has(segment));
}

/** Windows yields backslashes and compares case-insensitively. */
function posix(p) {
  return p.replaceAll("\\", "/");
}

function under(path, root) {
  const p = posix(path).toLowerCase().replace(/\/$/, "");
  const r = posix(root).toLowerCase().replace(/\/$/, "");
  return p === r || p.startsWith(`${r}/`);
}

/**
 * A Windows path is judged with Windows rules on every host. A session on the
 * runner or on a POSIX machine still reads hooks written for `D:\`, and the
 * host `path` module would otherwise resolve `D:\foo` as a *relative* segment
 * of the repository.
 */
const WINDOWS_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\)/;

function absolute(path) {
  return WINDOWS_ABSOLUTE.test(path) ? path : resolve(ROOT, path);
}

/**
 * The one policy. Returns `undefined` when the write is fine, or the reason it is
 * not — a string, because every refusal is read by whoever is about to write.
 */
function refuse(path) {
  if (typeof path !== "string" || path.trim() === "") return undefined;
  const target = absolute(path);

  if (!under(target, ROOT)) {
    if (SANCTIONED.some((root) => under(target, root))) return undefined;
    return [
      `scratch outside the repository belongs under one of:`,
      ...SANCTIONED.map((root) => `    ${root}`),
      "",
      "  Note that `/tmp` is NOT `/tmp` here: Node resolves a leading slash",
      "  against the current drive, so a session working on `D:` writes to",
      "  `D:\\tmp`. That is how the drive root filled up. Give an absolute path",
      "  under a root above.",
    ].join("\n");
  }

  const rel = posix(target.slice(ROOT.length + 1));
  const segments = rel.split("/");
  const scratchSegment = segments.find(isScratchSegment);
  const name = segments[segments.length - 1] ?? "";
  if (scratchSegment !== undefined) {
    return `"${scratchSegment}" is a scratch segment. Deliverables live under docs/, src/, scripts/, schema/ or tests/; scratch goes outside the tree.`;
  }
  if (SCRATCH_NAMES.some((pattern) => pattern.test(name))) {
    return `"${name}" is a scratch-shaped file name. If it is evidence, it belongs in docs/evidence/ or in the SDD workspace, not in the working tree.`;
  }
  return undefined;
}

/** The paths a shell command is about to write, as far as they can be read. */
function shellTargets(command) {
  const targets = [];
  const push = (value) => {
    const cleaned = value?.replace(/^["']|["']$/g, "").trim();
    if (cleaned === undefined || cleaned === "") return;
    if (["/dev/null", "NUL", "$null", "nul"].includes(cleaned)) return;
    targets.push(cleaned);
  };
  const redirect = /(?:^|[\s;&|])\d?>>?\s*("[^"]+"|'[^']+'|[^\s;&|]+)/g;
  for (const match of command.matchAll(redirect)) push(match[1]);
  const flags =
    /(?:--outputFile|--outfile|--out|--log-file|--logFile)[=\s]+("[^"]+"|'[^']+'|\S+)/g;
  for (const match of command.matchAll(flags)) push(match[1]);
  const tee = /(?:^|[\s;&|])(?:tee|Out-File|Set-Content|Add-Content)\s+(?:-\S+\s+)*("[^"]+"|'[^']+'|\S+)/g;
  for (const match of command.matchAll(tee)) push(match[1]);
  return targets;
}

/** What the hook decides for one tool call. */
function decide(input) {
  const tool = input.tool_name ?? "";
  const fields = input.tool_input ?? {};
  if (tool === "Bash" || typeof fields.command === "string") {
    for (const target of shellTargets(fields.command ?? "")) {
      const reason = refuse(target);
      if (reason !== undefined) return { target, reason };
    }
    return undefined;
  }
  const path = fields.file_path ?? fields.path ?? fields.notebook_path ?? "";
  const reason = refuse(path);
  return reason === undefined ? undefined : { target: path, reason };
}

/**
 * The sweep: every ignored entry in the tree that is not a documented store, any
 * tracked file that is scratch-shaped by name, and any directory under
 * `.claude/worktrees/` that git does not name as a live worktree. This is the
 * half that walks the filesystem — the refusal above cannot see what a *tool*
 * wrote, which is how `.playwright-mcp/` and 22 worktree skeletons survived.
 *
 * The worktree check is separate from the store list on purpose: `.claude/` is a
 * legitimate store, so the segment rule allows the whole subtree and would never
 * see the skeletons inside it. `git worktree list` is the registry that tells a
 * live seat from its leftovers, and the leftovers are the git-shaped cleanup's
 * own signature (0081).
 */
function sweep() {
  const ignored = git([
    "ls-files",
    "--others",
    "--ignored",
    "--exclude-standard",
    "--directory",
  ])
    .split("\n")
    .filter((line) => line !== "");
  const stray = ignored.filter((entry) => !isStore(entry));
  const tracked = git(["ls-files"])
    .split("\n")
    .filter((line) => line !== "")
    .filter((rel) => {
      const name = posix(rel).split("/").pop() ?? "";
      return SCRATCH_NAMES.some((pattern) => pattern.test(name));
    });
  return { stray, tracked, deadWorktrees: deadWorktrees() };
}

/** Directories under the harness's worktree root that git no longer registers. */
function deadWorktrees() {
  const root = join(ROOT, ".claude", "worktrees");
  if (!existsSync(root)) return [];
  const live = new Set(
    git(["worktree", "list", "--porcelain"])
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => posix(resolve(line.slice("worktree ".length))).toLowerCase()),
  );
  return readdirSync(root)
    .filter((name) => statSync(join(root, name)).isDirectory())
    .filter((name) => !live.has(posix(join(root, name)).toLowerCase()))
    .map((name) => `.claude/worktrees/${name}`);
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

function selfTest() {
  const cases = [
    // [path, expected to be refused]
    ["src/web/packages/player/src/chrome.ts", false],
    ["docs/evidence/screenshots/README.md", false],
    ["src/web/vitest-080.json", true],
    ["src/web/.agent-scratch/p1-repro.mjs", true],
    [".claude/worktrees/agent-abc/notes.md", false],
    [".claude/worktrees/.task252-scratch/probe.mjs", true],
    ["docs/tmp/probe.md", true],
    ["gate.log", true],
    ["src/web/coverage/index.html", true],
    ["D:\\yunari-tester\\aspect.mjs", true],
    ["D:\\scratch\\fontpicker-mut\\mutate.mjs", true],
    ["C:\\tmp\\yunari\\probe.mjs", false],
    [join(tmpdir(), "claude", "x", "probe.mjs"), false],
    [join(homedir(), ".claude", "projects", "x", "memory", "note.md"), false],
    ["C:\\Users\\peter\\Documents\\probe.mjs", true],
  ];
  let failed = 0;
  for (const [path, expected] of cases) {
    const refused = refuse(path) !== undefined;
    const ok = refused === expected;
    if (!ok) failed += 1;
    console.log(
      `${ok ? "ok  " : "FAIL"} ${expected ? "refuses" : "allows "} ${path}${ok ? "" : ` (refused: ${refused})`}`,
    );
  }

  const command = (line, expected) => {
    const got = decide({ tool_name: "Bash", tool_input: { command: line } });
    const ok = (got !== undefined) === expected;
    if (!ok) failed += 1;
    console.log(
      `${ok ? "ok  " : "FAIL"} ${expected ? "refuses" : "allows "} ${line}${ok ? "" : ` (got: ${JSON.stringify(got)})`}`,
    );
  };
  command("npm run gate > C:\\tmp\\gate.log 2>&1", false);
  command("npx vitest run > /dev/null 2>&1", false);
  command("git diff > D:\\yunari-pass\\diff.txt", true);
  // `/tmp` is sanctioned on both platforms (drive-root `C:\tmp` on Windows,
  // `os.tmpdir()` on Unix), so it cannot prove a refusal. `/var/tmp` is nobody's
  // store: `<drive>:\var\tmp` on Windows, `/var/tmp` on Unix.
  command("npx vitest run --outputFile=/var/tmp/full.json", true);
  command("npm run build 2>&1 | tee C:\\tmp\\build.log", false);

  // Integrity: the store list is matched per segment, so an entry holding a
  // slash would silently never match — a list that has stopped describing the
  // tree it is meant to describe.
  const withSlash = [...ALLOWED_SEGMENTS].filter((segment) =>
    /[/\\]/.test(segment),
  );
  const ok = withSlash.length === 0;
  if (!ok) failed += 1;
  console.log(
    `${ok ? "ok  " : "FAIL"} every allowed store is a bare segment${ok ? "" : ` (${withSlash.join(", ")})`}`,
  );

  // The sweep can fail: a synthetic tree with residue, stores, and a dead seat.
  const probe = [
    "node_modules/",
    ".superpowers/",
    "src/web/packages/player/dist/",
    "src/web/packages/player/tsconfig.tsbuildinfo",
    ".playwright-mcp/",
    "src/web/.agent-scratch/",
  ];
  const flagged = probe.filter((entry) => !isStore(entry));
  const expected = [".playwright-mcp/", "src/web/.agent-scratch/"];
  const sweepOk = JSON.stringify(flagged) === JSON.stringify(expected);
  if (!sweepOk) failed += 1;
  console.log(
    `${sweepOk ? "ok  " : "FAIL"} the sweep flags residue and not stores${sweepOk ? "" : ` (got ${flagged.join(", ")})`}`,
  );

  // And the tree it actually walks is readable at all.
  const real = sweep();
  const readable =
    Array.isArray(real.stray) &&
    Array.isArray(real.tracked) &&
    Array.isArray(real.deadWorktrees);
  if (!readable) failed += 1;
  console.log(
    `${readable ? "ok  " : "FAIL"} the sweep reads this tree (${real.stray.length} stray, ${real.tracked.length} tracked, ${real.deadWorktrees.length} dead worktree(s))`,
  );

  if (failed > 0) {
    console.error(`scratch-gate self-test: ${failed} case(s) wrong`);
    process.exit(1);
  }
  console.log("scratch-gate self-test: all cases behave");
}

// ---------------------------------------------------------------------------

try {
  if (process.argv.includes("--self-test")) {
    selfTest();
    process.exit(0);
  }

  if (process.argv.includes("--sweep")) {
    const { stray, tracked, deadWorktrees } = sweep();
    if (stray.length === 0 && tracked.length === 0 && deadWorktrees.length === 0) {
      console.log(
        "scratch-gate: no ignored residue and no scratch-shaped tracked file",
      );
      process.exit(0);
    }
    process.stderr.write(
      [
        "",
        "SCRATCH GATE — the tree holds scratch (0081).",
        "",
        ...stray.map((entry) => `  ignored, not a store:  ${entry}`),
        ...tracked.map((entry) => `  tracked, scratch-shaped: ${entry}`),
        ...deadWorktrees.map(
          (entry) => `  worktree git does not register: ${entry}`,
        ),
        "",
        "  A gitignored directory is invisible to git and to nothing else: every",
        "  filesystem walk, census and sweep still counts it, and that is what",
        "  vg-368 cost. Delete it, or move it outside the tree — a store that",
        "  genuinely belongs here is a deliberate entry in this script's",
        "  ALLOWED_SEGMENTS, with a reason.",
        "",
        "  A dead worktree is a seat's checkout that git no longer lists. Its",
        "  junctions must be removed as links (`rmdir`, not a recursive delete,",
        "  which follows them into the checkout), and the store it sits in means",
        "  no ignore rule will ever sweep it.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  if (process.env.YUNARI_ALLOW_SCRATCH === "1") process.exit(0);
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  const verdict = decide(input);
  if (verdict === undefined) process.exit(0);

  process.stderr.write(
    [
      "",
      "SCRATCH GATE — refused (0081).",
      "",
      `  ${verdict.target}`,
      "",
      `  ${verdict.reason}`,
      "",
      "  The repository tree is reviewable content: a scratch file in it is a",
      "  file a reviewer or a walk will pick up as if it were evidence, and",
      "  gitignoring it hides it from git and from nothing else.",
      "",
      "  If this is genuinely not scratch, set YUNARI_ALLOW_SCRATCH=1 and say",
      "  why in the commit.",
      "",
    ].join("\n"),
  );
  process.exit(2);
} catch {
  // A gate that fails loudly is worse than one that does nothing.
  process.exit(0);
}
