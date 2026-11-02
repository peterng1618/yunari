import { pathToFileURL } from "node:url";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { InMemoryDraftStore } from "./drafts.js";
import { HttpHostClient } from "./host-client.js";
import {
  createPorts,
  type InstallReport,
  install,
  status,
  uninstall,
} from "./install.js";
import { buildServer } from "./server.js";
import type { ToolContext } from "./types.js";

/** The ports a host started without an explicit URL is probed on, in order. */
export const PROBE_PORTS: readonly number[] = Object.freeze(
  Array.from({ length: 10 }, (_unused, index) => 5227 + index),
);

const USAGE = `Usage:
  yunari-mcp serve [--url <url>]   Start the MCP server over stdio.
  yunari-mcp install               Register the server and install the skill.
  yunari-mcp uninstall             Remove the server entry and the skill.
  yunari-mcp status                Report host, config and skill state.

The host URL comes from --url or YUNARI_URL. Without either, the server probes
http://127.0.0.1:5227 through http://127.0.0.1:5236 and stops at the first
answer that identifies as a Yunari host.`;

export interface ResolveHostOptions {
  /** A URL the user named on the command line. */
  readonly url?: string | undefined;
  /** Defaults to `process.env`; a test injects its own. */
  readonly env?: { readonly YUNARI_URL?: string | undefined } | undefined;
  /** Defaults to the process's `fetch`; a test injects its own. */
  readonly fetchImpl?: typeof fetch | undefined;
  /** Overrides the 5227–5236 range. */
  readonly ports?: readonly number[] | undefined;
}

function trimmed(url: string): string {
  return url.replace(/\/+$/u, "");
}

/**
 * Does this answer identify as a Yunari host? The library listing is the check:
 * an unrelated local service on a probed port does not answer `{themes: []}`.
 */
async function identifiesAsYunari(
  url: string,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(`${url}/api/themes`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { readonly themes?: unknown };
    return Array.isArray(body.themes);
  } catch {
    return false;
  }
}

/**
 * The host URL this run talks to: the one the user named, else the first
 * probed loopback port that answers as a Yunari host.
 */
export async function resolveHostUrl(
  options: ResolveHostOptions = {},
): Promise<string> {
  const named = options.url ?? options.env?.YUNARI_URL;

  if (named !== undefined && named.trim() !== "") {
    let parsed: URL;
    try {
      parsed = new URL(named);
    } catch {
      throw new Error(`"${named}" is not a URL. Pass --url or set YUNARI_URL.`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(
        `"${named}" is not an HTTP URL. Pass --url or set YUNARI_URL.`,
      );
    }
    return trimmed(named);
  }

  const ports = options.ports ?? PROBE_PORTS;
  const fetchImpl = options.fetchImpl ?? fetch;

  for (const port of ports) {
    const url = `http://127.0.0.1:${port}`;
    if (await identifiesAsYunari(url, fetchImpl)) {
      return url;
    }
  }

  throw new Error(
    `No Yunari host answered. Probed ${ports
      .map((port) => `http://127.0.0.1:${port}`)
      .join(", ")}. Start the host, set YUNARI_URL, or pass --url <url>.`,
  );
}

interface ParsedArgs {
  readonly command: string | undefined;
  readonly url: string | undefined;
  readonly help: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let command: string | undefined;
  let url: string | undefined;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";

    if (argument === "--help" || argument === "-h") {
      help = true;
    } else if (argument === "--url") {
      url = argv[index + 1];
      index += 1;
    } else if (argument.startsWith("--url=")) {
      url = argument.slice("--url=".length);
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown option "${argument}".\n\n${USAGE}`);
    } else if (command === undefined) {
      command = argument;
    } else {
      throw new Error(`Unexpected argument "${argument}".\n\n${USAGE}`);
    }
  }

  return { command, url, help };
}

/** Prints an install or uninstall outcome; a partial failure stays visible. */
function printReport(report: InstallReport, done: string): void {
  for (const step of report.steps) {
    console.log(`${step.ok ? "ok" : "failed"} ${step.step}: ${step.detail}`);
  }
  console.log(
    report.ok ? `${done}.` : "Incomplete: see the failed steps above.",
  );
}

/**
 * Resolves the host the same way `serve` does, then asks it for the library.
 * A named URL is checked too: parsing a URL is not evidence a host answers.
 */
async function probeHost(url?: string) {
  let resolved: string | undefined;
  try {
    resolved = await resolveHostUrl({ url });
    const response = await fetch(`${resolved}/api/themes`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) {
      return {
        reachable: false,
        url: resolved,
        error: `${resolved} answered HTTP ${response.status}`,
      };
    }
    const body = (await response.json()) as { readonly themes?: unknown };
    if (!Array.isArray(body.themes)) {
      return {
        reachable: false,
        url: resolved,
        error: `${resolved} did not answer as a Yunari host`,
      };
    }
    return { reachable: true, url: resolved };
  } catch (error) {
    return {
      reachable: false,
      ...(resolved === undefined ? {} : { url: resolved }),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** The CLI. `serve` starts the server; the rest own the agent install. */
export async function run(argv: readonly string[]): Promise<number> {
  let parsed: ParsedArgs;

  try {
    parsed = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  if (parsed.help) {
    console.log(USAGE);
    return 0;
  }

  if (
    parsed.command === "install" ||
    parsed.command === "uninstall" ||
    parsed.command === "status"
  ) {
    const ports = createPorts({ probeHost: () => probeHost(parsed.url) });

    if (parsed.command === "status") {
      const report = await status(ports);
      const at =
        report.host.url === undefined ? "" : ` at ${report.host.url}`;
      console.log(
        report.host.reachable
          ? `host: reachable${at}`
          : `host: unreachable${at}${report.host.error === undefined ? "" : ` — ${report.host.error}`}`,
      );
      console.log(`server: ${report.server.detail}`);
      console.log(
        report.skill.present
          ? `skill: installed at ${report.skill.path}`
          : `skill: missing at ${report.skill.path}`,
      );
      return 0;
    }

    const report =
      parsed.command === "install"
        ? await install(ports)
        : await uninstall(ports);
    printReport(report, parsed.command === "install" ? "Installed" : "Removed");
    return report.ok ? 0 : 1;
  }

  if (parsed.command !== "serve") {
    if (parsed.command !== undefined) {
      console.error(`Unknown command "${parsed.command}".`);
    }
    console.error(USAGE);
    return 1;
  }

  try {
    const url = await resolveHostUrl({ url: parsed.url });
    const context: ToolContext = {
      host: new HttpHostClient(url),
      drafts: new InMemoryDraftStore(),
    };
    serveStdio(() => buildServer(context), {
      onerror: (error) => console.error(error),
    });
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

const invokedAs =
  process.argv[1] === undefined ? "" : pathToFileURL(process.argv[1]).href;

if (
  invokedAs !== "" &&
  (invokedAs === import.meta.url || /\/yunari-mcp\.js$/u.test(invokedAs))
) {
  process.exitCode = await run(process.argv.slice(2));
}
