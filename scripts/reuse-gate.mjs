#!/usr/bin/env node
// Presence gate only: review judges whether the note's evidence is sufficient.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DECISIONS = join(ROOT, "docs", "decisions");

// Invisible integration failures belong here; ordinary layout, copy and tests do not.
const WATCHLIST = [
  "src/web/packages/scene-fabric/src/glass.ts",
  "src/web/packages/scene-fabric/src/background-media.ts",
  "src/web/packages/scene-fabric/src/scene.ts",
  "src/web/packages/scene-fabric/src/adapter.ts",
  "src/web/packages/scene-fabric/src/persist.ts",
  "src/web/packages/scene-fabric/src/chart-object.ts",
  "src/web/packages/scene-fabric/src/object-asset.ts",
  "src/web/packages/renderer-core/src/theme/",
  "src/web/packages/renderer-core/src/charts/",
  "src/web/packages/renderer-core/src/data/protocol.ts",
  "src/web/packages/host/src/providers/",
  "src/web/packages/host/src/panels/",
  "src/web/packages/host/src/serve/static-path.ts",
  "src/web/packages/host/src/server.ts",
  "src/web/packages/editor/src/editor-shell/bridge.ts",
  "src/web/packages/editor/src/editor-shell/layer-tree.ts",
  "src/web/packages/editor/src/editor-shell/shell-layout.tsx",
  "src/web/packages/editor/src/editor-session.ts",
  "src/web/packages/editor/src/components/ui/",
  "src/web/packages/editor/src/selection-inspector/view.ts",
  "scripts/",
];

const posix = (path) => path.replaceAll("\\", "/");
const absolute = (path) => resolve(ROOT, path);
const repoPath = (path) => posix(relative(ROOT, absolute(path)));

function trackedPaths() {
  return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

function matchesDirectory(entry, path) {
  const base = entry.replace(/\/$/, "");
  return base.includes("/")
    ? path === base || path.startsWith(`${base}/`)
    : path.split("/").includes(base);
}

function isWatched(path) {
  const rel = repoPath(path);
  if (rel.startsWith("..") || /\.(test|dom\.test)\.[cm]?[jt]sx?$/.test(rel))
    return false;
  return WATCHLIST.some((entry) =>
    entry.endsWith("/") ? matchesDirectory(entry, rel) : rel === entry,
  );
}

function entryExists(entry) {
  const base = entry.replace(/\/$/, "");
  return base.includes("/")
    ? existsSync(absolute(base))
    : trackedPaths().some((path) => path.split("/").includes(base));
}

function claimedPaths() {
  let files;
  try {
    files = readdirSync(DECISIONS).filter((file) => file.endsWith(".md"));
  } catch {
    return [];
  }
  const claimed = [];
  for (const file of files) {
    const rows = readFileSync(join(DECISIONS, file), "utf8")
      .replaceAll("\r\n", "\n")
      .split("\n");
    for (const [index, row] of rows.entries()) {
      if (!/^- \*\*Paths:\*\*/.test(row)) continue;
      const field = [row];
      for (const next of rows.slice(index + 1)) {
        if (!/^[ \t]+\S/.test(next)) break;
        field.push(next);
      }
      for (const match of field
        .join("\n")
        .matchAll(/`(src\/[^`]+|scripts\/[^`]+)`/g)) {
        claimed.push(match[1]);
      }
    }
  }
  return claimed;
}

// Exact files only: a directory claim would silently license future mechanisms.
function decide(path, claimed) {
  if (typeof path !== "string" || path === "" || !isWatched(path)) return 0;
  return claimed.includes(repoPath(path)) ? 0 : 2;
}

if (process.argv.includes("--self-test")) {
  const abs = (path) => `${ROOT}/${path}`;
  const cases = [
    ["allows a claimed boundary file", "scripts/reuse-gate.mjs", 0],
    ["refuses an unclaimed script", "scripts/anything.mjs", 2],
    ["refuses an unclaimed nested script", "src/web/scripts/anything.mjs", 2],
    [
      "refuses an unclaimed panel driver",
      "src/web/packages/host/src/panels/new-panel.ts",
      2,
    ],
    [
      "allows an ordinary editor file",
      "src/web/packages/editor/src/ui-copy.ts",
      0,
    ],
    [
      "allows a boundary test",
      "src/web/packages/host/src/providers/lhm.test.ts",
      0,
    ],
    [
      "refuses despite a directory claim",
      "src/web/packages/renderer-core/src/charts/grid.ts",
      2,
    ],
    ["allows an empty path", "", 0],
  ];
  const claimed = [
    "scripts/reuse-gate.mjs",
    "src/web/packages/renderer-core/src/charts/",
  ];
  let failed = 0;
  for (const [name, path, expected] of cases) {
    const actual = decide(abs(path), claimed);
    const ok = actual === expected;
    if (!ok) failed += 1;
    console.log(
      `${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` (expected ${expected}, got ${actual})`}`,
    );
  }
  const deadEntries = WATCHLIST.filter((entry) => !entryExists(entry));
  const integrityOk = deadEntries.length === 0;
  if (!integrityOk) failed += 1;
  console.log(
    `${integrityOk ? "ok  " : "FAIL"} every watchlist entry exists${integrityOk ? "" : `: ${deadEntries.join(", ")}`}`,
  );
  const liveOk = claimedPaths().includes("scripts/reuse-gate.mjs");
  if (!liveOk) failed += 1;
  console.log(`${liveOk ? "ok  " : "FAIL"} reads this change's decision claim`);
  if (failed > 0) {
    console.error(`reuse-gate self-test: ${failed} case(s) wrong`);
    process.exit(1);
  }
  console.log("reuse-gate self-test: all cases behave");
  process.exit(0);
}

try {
  if (process.env.YUNARI_SKIP_REUSE_GATE === "1") process.exit(0);
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  const path = input.tool_input?.file_path ?? input.tool_input?.path ?? "";
  if (decide(path, claimedPaths()) === 0) process.exit(0);
  process.stderr.write(
    [
      "",
      "REUSE GATE — refused.",
      "",
      `  ${repoPath(path)}`,
      "",
      "  Work all seven rungs in AGENTS.md, then record current evidence in",
      "  docs/decisions/NNNN-<slug>.md with an exact `- **Paths:**` claim.",
      "  Template: docs/decisions/README.md.",
      "",
      "  Internal and public searches are both required. A library or native",
      "  API existing does not settle integration fitness.",
      "",
      "  If evidence is genuinely recorded elsewhere, set",
      "  YUNARI_SKIP_REUSE_GATE=1 and say where it is recorded.",
      "",
    ].join("\n"),
  );
  process.exit(2);
} catch {
  // Malformed tool input must not block every edit; hook startup failures block in settings.
  process.exit(0);
}
