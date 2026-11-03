import type { InstallChoices } from "./choices.js";

/** The four clients the prompt names; any other add-mcp id can be typed. */
export const COMMON_AGENTS = [
  "claude-code",
  "codex",
  "cursor",
  "vscode",
] as const;

/** The text I/O the wizard needs; main supplies readline, tests a queue. */
export interface WizardIo {
  ask(question: string): Promise<string>;
  write(text: string): void;
  /** Releases the input stream the CLI opened; tests leave it out. */
  close?(): void;
}

/**
 * What a non-interactive run prints instead of blocking on stdin. Every
 * question has a flag, so a script has a complete alternative.
 */
export function refusal(): string {
  return [
    "No terminal to ask the installer's questions.",
    "Pass --yes for defaults, or choose explicitly:",
    "  --agent <id> (repeatable)  --scope global|local  --skill|--no-skill",
    "  --auto-approve all|none    --url <url>            --json",
  ].join("\n");
}

function chosenAgents(answer: string): string[] {
  const tokens = answer
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token !== "");
  if (tokens.length === 0) return ["claude-code"];
  return tokens.map((token) => {
    const index = Number(token);
    return Number.isInteger(index) &&
      index >= 1 &&
      index <= COMMON_AGENTS.length
      ? (COMMON_AGENTS[index - 1] as string)
      : token;
  });
}

/**
 * Asks every choice. `detected` is unused for selection (any id is accepted)
 * but is shown so a person sees which clients this machine already has.
 */
export async function runWizard(
  io: WizardIo,
  cwd: string,
  detected: readonly string[],
  probe: () => Promise<string | undefined>,
): Promise<InstallChoices> {
  io.write(
    `Agents: ${COMMON_AGENTS.map(
      (agent, index) =>
        `${index + 1}) ${agent}${detected.includes(agent) ? " (detected)" : ""}`,
    ).join("  ")}\n`,
  );
  const agents = chosenAgents(
    await io.ask("Agents, numbers or ids separated by commas [1]: "),
  );

  const scopeAnswer = await io.ask("Scope: 1) global 2) project [1]: ");
  const scope = scopeAnswer.trim() === "2" ? "local" : "global";

  const skill = !/^n/i.test(
    (await io.ask("Install the theme-designer skill? [Y/n]: ")).trim(),
  );

  const approve = !/^2/.test(
    (await io.ask("Auto-approve: 1) all tools 2) none [1]: ")).trim(),
  );

  const found = await probe();
  const hint =
    found === undefined
      ? "Host URL (blank probes at each session): "
      : `Host ${found} — Enter pins it, a URL replaces it, "none" leaves it unpinned: `;
  const answer = (await io.ask(hint)).trim();
  const url =
    answer === ""
      ? found
      : answer.toLowerCase() === "none"
        ? undefined
        : answer;

  return {
    agents,
    scope,
    skill,
    autoApprove: approve,
    ...(url === undefined ? {} : { url }),
    cwd,
  };
}
