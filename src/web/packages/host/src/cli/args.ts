import os from "node:os";
import path from "node:path";
import { DEFAULT_LHM_URL } from "../providers/lhm.js";

/** Pure command-line parsing. */

export interface HostOptions {
  readonly port: number;
  readonly host: string;
  /** True when `--host` was passed. A run that names an address obeys it for
   *  that run; one that does not obeys the stored hosting preference. */
  readonly hostGiven: boolean;
  readonly openBrowser: boolean;
  /** Run hidden with a tray icon instead of a browser window. */
  readonly tray: boolean;
  readonly themesDir: string;
  /** Where the host's own state lives; beside the themes, never among them. */
  readonly settingsDir: string;
  /** Endpoint of a LibreHardwareMonitor web server, if the owner runs one. */
  readonly lhmUrl: string;
  /** Path to `LibreHardwareMonitor.exe`; set to launch it with the host. */
  readonly lhmExecutable?: string;
  /** Path to `RTSS.exe`; set to report and start that install. */
  readonly rtssExecutable?: string;
  /** Register the elevated startup task for LHM, then exit. */
  readonly registerLhmTask?: boolean;
}

export const DEFAULT_PORT = 5227;

/** Loopback by default; LAN exposure must be explicit. */
export const DEFAULT_HOST = "127.0.0.1";

/** Stable Yunari data location across platforms; the app folder. */
const DEFAULT_APP_DIR = path.join(os.homedir(), ".yunari");

/** One directory per theme, read and written in place. */
export const DEFAULT_THEMES_DIR = path.join(DEFAULT_APP_DIR, "themes");

/** Host state, kept out of the library so a theme folder is only ever a theme. */
export const DEFAULT_SETTINGS_DIR = path.join(DEFAULT_APP_DIR, "settings");

/** Bounded upward port fallback. */
export const MAX_PORT_ATTEMPTS = 10;

export type ArgsResult =
  | { readonly kind: "run"; readonly options: HostOptions }
  | { readonly kind: "message"; readonly text: string }
  | { readonly kind: "error"; readonly message: string };

export const HELP_TEXT = `Usage: yunari [options]

Options:
  -p, --port <port>       Port to listen on (default: ${DEFAULT_PORT})
  -H, --host <addr>       Address to bind (default: ${DEFAULT_HOST}, loopback only)
  -n, --no-browser        Do not open a browser
      --tray              Run from the system tray, with no browser window
      --app-dir <dir>     App folder; themes/ and settings/ live inside it
                          (default ${DEFAULT_APP_DIR})
      --themes-dir <dir>  Directory for the theme library (default: the app folder's themes/)
      --lhm-url <url>     LibreHardwareMonitor web server (default ${DEFAULT_LHM_URL})
      --lhm-exe <path>    Launch LibreHardwareMonitor.exe with the host
      --rtss-exe <path>   RivaTuner Statistics Server install; the tray can start it
      --register-lhm-task Register LHM to start elevated at sign-in (one prompt)
  -v, --version           Print the version
  -h, --help              Print this help

Extended sensors (temperatures, fans, power) come from LibreHardwareMonitor
when it is running; Yunari reads its web server and never controls its
hardware support. Everything else is read through systeminformation.

The host serves https beside http on the same port, from a certificate it
issues itself, and prints the root certificate to install. A display holds the
screen awake and installs as an app only at the https origin, and only once
that root is installed on it — this PC included.

LAN access is off by default. Passing --host 0.0.0.0 serves your hardware
telemetry to every device on the network; plain http there has no
confidentiality, so use it on trusted networks only, never the internet.`;

/** Flags whose value is a path the parser resolves against its cwd. */
const PATH_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--app-dir",
  "--themes-dir",
  "--lhm-exe",
  "--rtss-exe",
]);

/**
 * Resolves those flags' values against this process's cwd, for argv that will
 * be replayed later. A sign-in launcher starts in Explorer's or the home
 * directory, so an unresolved relative path would name a different folder.
 */
export function resolvePathFlags(argv: readonly string[]): string[] {
  const resolved = [...argv];

  for (let index = 0; index < resolved.length; index += 1) {
    const flag = resolved[index];

    if (flag === undefined || !PATH_VALUE_FLAGS.has(flag)) continue;

    const value = resolved[index + 1];

    // A missing or flag-shaped value is the parser's error to report.
    if (value === undefined || value.startsWith("-")) continue;

    resolved[index + 1] = path.resolve(value);
    index += 1;
  }

  return resolved;
}

/** True only for addresses restricted to this machine. */
export function isLoopbackHost(host: string): boolean {
  const normalized = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");

  return (
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1"
  );
}

/** Strictly parses usable TCP ports; rejects partial numeric strings. */
function parsePort(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^\d+$/.test(raw)) {
    return undefined;
  }

  const value = Number(raw);

  return value >= 1 && value <= 65_535 ? value : undefined;
}

/** Parses argv without `node` and the script path. */
export function parseArgs(
  argv: readonly string[],
  version: string,
): ArgsResult {
  let port = DEFAULT_PORT;
  let host = DEFAULT_HOST;
  let hostGiven = false;
  let openBrowser = true;
  let tray = false;
  let themesDir: string | undefined;
  // A relocated app folder takes the library and the settings with it, so one
  // flag gives a private install rather than a library that writes into the
  // real settings. `--themes-dir` overrides the library on its own.
  let settingsDir: string | undefined;
  let lhmUrl = DEFAULT_LHM_URL;
  let lhmExecutable: string | undefined;
  let rtssExecutable: string | undefined;
  let registerLhmTask = false;
  let appDirOverride: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--help":
      case "-h":
        return { kind: "message", text: HELP_TEXT };

      case "--version":
      case "-v":
        return { kind: "message", text: version };

      case "--no-browser":
      case "-n":
        openBrowser = false;
        break;

      case "--tray":
        tray = true;
        openBrowser = false;
        break;

      case "--port":
      case "-p": {
        const parsed = parsePort(argv[index + 1]);

        if (parsed === undefined) {
          return {
            kind: "error",
            message: `${arg} needs a port between 1 and 65535, not ${argv[index + 1] ?? "(nothing)"}.`,
          };
        }

        port = parsed;
        index += 1;
        break;
      }

      case "--host":
      case "-H": {
        const value = argv[index + 1];

        if (value === undefined || value.startsWith("-")) {
          return {
            kind: "error",
            message: `${arg} needs an address, such as 0.0.0.0.`,
          };
        }

        host = value;
        hostGiven = true;
        index += 1;
        break;
      }

      case "--register-lhm-task":
        registerLhmTask = true;
        break;

      case "--lhm-url": {
        const value = argv[index + 1];

        if (value === undefined || value.startsWith("-")) {
          return { kind: "error", message: `${arg} needs a URL.` };
        }

        lhmUrl = value.replace(/\/$/, "");
        index += 1;
        break;
      }

      case "--lhm-exe": {
        const value = argv[index + 1];

        if (value === undefined || value.startsWith("-")) {
          return {
            kind: "error",
            message: `${arg} needs a path to LibreHardwareMonitor.exe.`,
          };
        }

        lhmExecutable = path.resolve(value);
        index += 1;
        break;
      }

      case "--rtss-exe": {
        const value = argv[index + 1];

        if (value === undefined || value.startsWith("-")) {
          return {
            kind: "error",
            message: `${arg} needs a path to RTSS.exe.`,
          };
        }

        rtssExecutable = path.resolve(value);
        index += 1;
        break;
      }

      case "--themes-dir": {
        const value = argv[index + 1];

        if (value === undefined || value.startsWith("-")) {
          return { kind: "error", message: `${arg} needs a directory path.` };
        }

        themesDir = path.resolve(value);
        index += 1;
        break;
      }

      case "--app-dir": {
        const value = argv[index + 1];

        if (value === undefined || value.startsWith("-")) {
          return { kind: "error", message: `${arg} needs a directory path.` };
        }

        const appDir = path.resolve(value);

        settingsDir = path.join(appDir, "settings");
        appDirOverride = appDir;
        index += 1;
        break;
      }

      default:
        return {
          kind: "error",
          message: `Unknown option ${arg ?? ""}. Try --help.`,
        };
    }
  }

  return {
    kind: "run",
    options: {
      port,
      host,
      hostGiven,
      // --tray clears this when it is parsed; nothing sets it back.
      openBrowser,
      tray,
      themesDir:
        themesDir ?? path.join(appDirOverride ?? DEFAULT_APP_DIR, "themes"),
      settingsDir: settingsDir ?? DEFAULT_SETTINGS_DIR,
      lhmUrl,
      ...(lhmExecutable === undefined ? {} : { lhmExecutable }),
      ...(rtssExecutable === undefined ? {} : { rtssExecutable }),
      ...(registerLhmTask ? { registerLhmTask } : {}),
    },
  };
}
