/** The installer's choices, parsed from flags or filled in by the wizard. */

export interface InstallChoices {
  readonly agents: readonly string[];
  readonly scope: "global" | "local";
  readonly skill: boolean;
  readonly autoApprove: boolean;
  readonly url?: string;
  /** The directory a local-scope install writes into. */
  readonly cwd: string;
}

/** Every choice the wizard can ask for; `cwd` is never a question. */
export type PartialChoices = Partial<Omit<InstallChoices, "cwd">>;

export const DEFAULT_CHOICES: Omit<InstallChoices, "cwd"> = {
  agents: ["claude-code"],
  scope: "global",
  skill: true,
  autoApprove: true,
};

export type ParsedInstallArgs =
  | {
      readonly kind: "choices";
      readonly choices: PartialChoices;
      readonly yes: boolean;
      readonly json: boolean;
    }
  | { readonly kind: "error"; readonly message: string };

function isCommand(token: string): boolean {
  return token === "install" || token === "uninstall";
}

/**
 * Parses the flags after `install` or `uninstall`. A repeated `--agent` builds
 * the list; every other flag appears at most once. Unknown flags are errors, so
 * a typo cannot silently fall back to a default the user did not choose.
 */
export function parseInstallArgs(argv: readonly string[]): ParsedInstallArgs {
  const choices: {
    agents?: string[];
    scope?: InstallChoices["scope"];
    skill?: boolean;
    autoApprove?: boolean;
    url?: string;
  } = {};
  let yes = false;
  let json = false;

  const takeValue = (index: number, flag: string): string | undefined => {
    const value = argv[index + 1];
    return value === undefined || value.startsWith("-") ? undefined : value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === undefined) continue;
    if (index === 0 && isCommand(flag)) continue;

    switch (flag) {
      case "--agent": {
        const value = takeValue(index, flag);
        if (value === undefined) {
          return { kind: "error", message: "--agent needs an id" };
        }
        choices.agents = [...(choices.agents ?? []), value];
        index += 1;
        break;
      }
      case "--scope": {
        const value = takeValue(index, flag);
        if (value !== "global" && value !== "local") {
          return {
            kind: "error",
            message: "--scope must be global or local",
          };
        }
        choices.scope = value;
        index += 1;
        break;
      }
      case "--skill":
        choices.skill = true;
        break;
      case "--no-skill":
        choices.skill = false;
        break;
      case "--auto-approve": {
        const value = takeValue(index, flag);
        if (value !== "all" && value !== "none") {
          return {
            kind: "error",
            message: "--auto-approve must be all or none",
          };
        }
        choices.autoApprove = value === "all";
        index += 1;
        break;
      }
      case "--url": {
        const value = takeValue(index, flag);
        if (value === undefined) {
          return { kind: "error", message: "--url needs a URL" };
        }
        choices.url = value;
        index += 1;
        break;
      }
      case "--yes":
        yes = true;
        break;
      case "--json":
        json = true;
        break;
      case "--help":
        return { kind: "error", message: "help" };
      default:
        return { kind: "error", message: `unknown option: ${flag}` };
    }
  }

  return {
    kind: "choices",
    choices: {
      ...(choices.agents === undefined ? {} : { agents: choices.agents }),
      ...(choices.scope === undefined ? {} : { scope: choices.scope }),
      ...(choices.skill === undefined ? {} : { skill: choices.skill }),
      ...(choices.autoApprove === undefined
        ? {}
        : { autoApprove: choices.autoApprove }),
      ...(choices.url === undefined ? {} : { url: choices.url }),
    },
    yes,
    json,
  };
}

/** Fills every unspecified choice from the default, so `--yes` is total. */
export function resolveChoices(
  partial: PartialChoices,
  cwd: string,
): InstallChoices {
  const agents = partial.agents ?? DEFAULT_CHOICES.agents;
  return {
    agents: agents.length === 0 ? DEFAULT_CHOICES.agents : agents,
    scope: partial.scope ?? DEFAULT_CHOICES.scope,
    skill: partial.skill ?? DEFAULT_CHOICES.skill,
    autoApprove: partial.autoApprove ?? DEFAULT_CHOICES.autoApprove,
    ...(partial.url === undefined ? {} : { url: partial.url }),
    cwd,
  };
}
