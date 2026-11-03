import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The skill folder name, which is also its installed directory name. */
export const SKILL_NAME = "yunari-theme-designer";

/**
 * The `skills` CLI agent for each agent this installer registers.
 *
 * A skill directory one agent scans is invisible to another: Claude Code reads
 * `~/.claude/skills` and does not look in `~/.agents/skills`. `codex` is the
 * CLI's universal-selector name for `~/.agents/skills`, which every other
 * runtime here reads, so it is always installed too.
 */
const SKILL_AGENT_FOR: Readonly<Record<string, string>> = {
  "claude-code": "claude-code",
  codex: "codex",
  cursor: "cursor",
  vscode: "github-copilot",
};

/** The universal skill path every runtime reads. */
const UNIVERSAL_SKILL_AGENT = "codex";

/** Every skill directory a chosen agent set needs, in install order. */
export function skillAgentsFor(agents: readonly string[]): readonly string[] {
  const ids = new Set([UNIVERSAL_SKILL_AGENT]);
  for (const agent of agents) {
    const id = SKILL_AGENT_FOR[agent];
    if (id !== undefined) ids.add(id);
  }
  return [...ids];
}

/** Whether the installed skill still matches the copy the package ships. */
export type SkillState = "current" | "drifted" | "not-installed";

/** The canonical installed path named in the design. */
export function skillFilePath(home: string): string {
  return join(home, ".agents", "skills", SKILL_NAME, "SKILL.md");
}

/**
 * The skill this package ships. A staged package carries its own copy, so an
 * installed package never reads the checkout it was built from; a repository
 * run still finds the root `skills/` folder.
 */
export function resolveSkillSourceDir(
  packageDir: string,
  exists: (path: string) => boolean = existsSync,
): string {
  const bundled = join(packageDir, "skills", SKILL_NAME);
  return exists(bundled)
    ? bundled
    : join(packageDir, "..", "..", "..", "..", "skills", SKILL_NAME);
}

/** Every file below `dir`, as relative POSIX paths. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      join(entry.parentPath, entry.name)
        .slice(dir.length + 1)
        .replaceAll("\\", "/"),
    )
    .sort();
}

/**
 * Compares the installed skill with the packaged copy by relative path and
 * bytes. An unreadable packaged copy is reported as drift, never as current.
 */
export function compareSkill(
  installedDir: string | undefined,
  bundledDir: string,
): SkillState {
  if (installedDir === undefined) return "not-installed";
  try {
    const expected = filesUnder(bundledDir);
    const actual = filesUnder(installedDir);
    if (expected.length !== actual.length) return "drifted";
    for (const file of expected) {
      if (
        !readFileSync(join(bundledDir, file)).equals(
          readFileSync(join(installedDir, file)),
        )
      ) {
        return "drifted";
      }
    }
    return "current";
  } catch {
    return "drifted";
  }
}

/**
 * The skill is installed globally, into every chosen agent's own directory plus
 * the shared `~/.agents/skills` path the universal selector names.
 */
export function skillInstallArgs(
  skillSourceDir: string,
  agents: readonly string[] = [],
): readonly string[] {
  return [
    "add",
    skillSourceDir,
    "-g",
    "-a",
    ...skillAgentsFor(agents),
    "--copy",
    "-y",
  ];
}

/** Removal names the skill, not a source path. Every agent link goes. */
export function skillRemoveArgs(): readonly string[] {
  return ["remove", "-g", "-y", SKILL_NAME];
}
