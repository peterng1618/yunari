import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * The host's own start-at-sign-in entry, and the one "Auto start" toggle behind
 * it.
 *
 * A hidden entry rather than a scheduled task: the owner asked for a tray host,
 * so a console window at every login is the thing they did not ask for. Windows
 * starts the same command through a VBS launcher whose `Run` call hides it;
 * Linux uses the desktop entry every desktop already honours. Either entry starts
 * *this* host, so every local monitor comes back with it.
 *
 * The task `display-launcher.ts` used to register is still read and removed: an
 * install that approved it has a `YunariHost` task, and leaving it would start a
 * second host at sign-in.
 */

/** The command a sign-in entry starts. */
export interface AutostartCommand {
  readonly file: string;
  readonly args: readonly string[];
}

export interface AutostartResult {
  readonly ok: boolean;
  readonly message: string;
  /** Whether an entry exists after this call, so a toggle reads its own answer. */
  readonly enabled: boolean;
}

export interface HostAutostart {
  state(): boolean;
  enable(command: AutostartCommand): Promise<AutostartResult>;
  disable(): Promise<AutostartResult>;
  toggle(command: AutostartCommand): Promise<AutostartResult>;
}

/** Node's callback `execFile`, narrowed to the shape this owner needs. */
export type ExecFileImpl = (
  file: string,
  args: readonly string[],
  options: { readonly timeout: number; readonly windowsHide: boolean },
  callback: (error: Error | null, stdout?: string, stderr?: string) => void,
) => void;

export interface HostAutostartOptions {
  readonly platform?: NodeJS.Platform;
  readonly home?: string;
  readonly appData?: string;
  readonly configHome?: string;
  readonly systemRoot?: string;
  readonly exists?: (file: string) => boolean;
  readonly execFileImpl?: ExecFileImpl;
}

/** The task the previous owner registered. Removed so it cannot start a second
 *  host beside this entry. */
const LEGACY_TASK_NAME = "YunariHost";

const STARTED = "Yunari will start hidden at sign-in.";
const STOPPED = "Yunari will not start at sign-in.";

const defaultExecFile: ExecFileImpl = (file, args, options, callback) => {
  execFile(file, [...args], options, callback);
};

function unsupported(platform: NodeJS.Platform): string {
  return (
    "Yunari registers start-at-sign-in on Windows and Linux only; " +
    `this host is on ${platform}.`
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A folder from the environment or a test seam. Windows treats an empty value
 *  as unset and the XDG spec says the same of `XDG_CONFIG_HOME`; keeping `""`
 *  would make the entry path relative to whatever directory the host started in. */
function configuredFolder(value: string | undefined): string | undefined {
  return value === undefined || value.trim().length === 0 ? undefined : value;
}

/**
 * The host this run is, ready to start again at sign-in: this interpreter, the
 * shim it was started through, and the flags this run was given, so the host
 * that comes back is the same host with the same app folder.
 *
 * `--tray` is what makes it a tray host rather than a console one, and `-n`
 * because a host that starts at sign-in is bringing back the displays; a
 * dashboard tab in the default browser at every login is not part of that.
 */
export function hostEntry(
  argv: readonly string[],
  here: string,
  execPath: string = process.execPath,
): AutostartCommand {
  return {
    file: execPath,
    args: [path.join(here, "..", "bin", "yunari.js"), ...argv, "--tray", "-n"],
  };
}

/** A token as Windows' own parser would read it back. */
function windowsToken(part: string): string {
  if (part.length === 0) return '""';
  if (!/\s/.test(part)) return part;

  // CommandLineToArgvW reads the run of backslashes before a closing quote as
  // escaping that quote; undoubled, a trailing `\` would swallow the flags the
  // entry appends to the command.
  return `"${part.replace(/(\\+)$/, "$1$1")}"`;
}

/**
 * The VBS launcher: `WshShell.Run` with a window style of 0, which is what makes
 * the sign-in entry hidden. Every double quote in the command is doubled for the
 * VBS string it sits in.
 *
 * A token with a quote or a line break is refused rather than escaped: there is
 * no command that needs one, and a launcher that parses into a different command
 * than the one asked for is worse than a refused registration.
 */
export function windowsVbs(command: AutostartCommand): string {
  const tokens = [command.file, ...command.args];

  for (const token of tokens) {
    if (/["\r\n]/.test(token)) {
      throw new Error(
        `refusing to register a command whose path or argument contains a quote or a line break: ${JSON.stringify(token)}`,
      );
    }
  }

  const line = tokens.map(windowsToken).join(" ");

  return [
    'Set WshShell = CreateObject("WScript.Shell")',
    `WshShell.Run "${line.replace(/"/g, '""')}", 0, False`,
    "",
  ].join("\r\n");
}

/** A token as the desktop entry's `Exec` grammar reads it back. */
function linuxToken(part: string): string {
  return `"${part
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/%/g, "%%")}"`;
}

/** The XDG autostart entry. `Terminal=false` is the hidden half; the GNOME key
 *  says the same thing on a desktop that only reads that. */
export function linuxDesktopEntry(command: AutostartCommand): string {
  const tokens = [command.file, ...command.args];

  for (const token of tokens) {
    if (/[\r\n]/.test(token)) {
      throw new Error(
        `refusing to register a command whose path or argument contains a line break: ${JSON.stringify(token)}`,
      );
    }
  }

  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Yunari",
    `Exec=${tokens.map(linuxToken).join(" ")}`,
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

export function createHostAutostart(
  options: HostAutostartOptions = {},
): HostAutostart {
  const platform = options.platform ?? process.platform;
  const home = configuredFolder(options.home ?? os.homedir());
  const appData = configuredFolder(options.appData ?? process.env["APPDATA"]);
  const configHome = configuredFolder(
    options.configHome ?? process.env["XDG_CONFIG_HOME"],
  );
  const systemRoot = configuredFolder(
    options.systemRoot ?? process.env["SystemRoot"],
  );
  const exists = options.exists ?? existsSync;
  const execFileImpl = options.execFileImpl ?? defaultExecFile;

  // A folder this owner was given no path to cannot hold an entry; that is a
  // fact about the machine, not an error to throw from a state read.
  const windowsFile =
    appData === undefined
      ? undefined
      : path.join(
          appData,
          "Microsoft",
          "Windows",
          "Start Menu",
          "Programs",
          "Startup",
          "Yunari.vbs",
        );
  const legacyTask =
    systemRoot === undefined
      ? undefined
      : path.join(systemRoot, "System32", "Tasks", LEGACY_TASK_NAME);
  const linuxFile =
    configHome !== undefined
      ? path.join(configHome, "autostart", "yunari.desktop")
      : home === undefined
        ? undefined
        : path.join(home, ".config", "autostart", "yunari.desktop");

  const state = (): boolean => {
    if (platform === "win32") {
      const legacy = legacyTask !== undefined && exists(legacyTask);
      const own = windowsFile !== undefined && exists(windowsFile);

      return legacy || own;
    }

    if (platform === "linux") {
      return linuxFile !== undefined && exists(linuxFile);
    }

    return false;
  };

  /** Resolves the failure text, or `undefined` when the task is gone. */
  const removeLegacyTask = (): Promise<string | undefined> =>
    new Promise((resolve) => {
      execFileImpl(
        "schtasks",
        ["/Delete", "/TN", LEGACY_TASK_NAME, "/F"],
        { timeout: 60_000, windowsHide: true },
        (error, _stdout, stderr) => {
          resolve(error === null ? undefined : stderr?.trim() || error.message);
        },
      );
    });

  const enable = async (
    command: AutostartCommand,
  ): Promise<AutostartResult> => {
    if (platform !== "win32" && platform !== "linux") {
      return { ok: false, message: unsupported(platform), enabled: false };
    }

    if (platform === "win32") {
      if (windowsFile === undefined) {
        return {
          ok: false,
          message:
            "Yunari cannot register start-at-sign-in here: APPDATA is not set.",
          enabled: state(),
        };
      }

      try {
        // Built before anything is deleted, so a command this owner refuses
        // leaves the machine exactly as it was.
        const body = windowsVbs(command);

        if (legacyTask !== undefined && exists(legacyTask)) {
          const failure = await removeLegacyTask();
          if (failure !== undefined) {
            return {
              ok: false,
              message: `could not remove the old sign-in task: ${failure}`,
              enabled: state(),
            };
          }
        }

        await mkdir(path.dirname(windowsFile), { recursive: true });
        // WSH reads a BOM-less script as ANSI, so a non-ASCII path would be
        // mojibake and the entry would silently start nothing. UTF-16LE with a
        // BOM is the encoding it reads back correctly.
        await writeFile(windowsFile, `﻿${body}`, "utf16le");

        return { ok: true, message: STARTED, enabled: true };
      } catch (error) {
        return {
          ok: false,
          message: `could not register the sign-in entry: ${messageOf(error)}`,
          enabled: state(),
        };
      }
    }

    if (linuxFile === undefined) {
      return {
        ok: false,
        message:
          "Yunari cannot register start-at-sign-in here: HOME and XDG_CONFIG_HOME are not set.",
        enabled: state(),
      };
    }

    try {
      const body = linuxDesktopEntry(command);

      await mkdir(path.dirname(linuxFile), { recursive: true });
      await writeFile(linuxFile, body, "utf8");

      return { ok: true, message: STARTED, enabled: true };
    } catch (error) {
      return {
        ok: false,
        message: `could not register the sign-in entry: ${messageOf(error)}`,
        enabled: state(),
      };
    }
  };

  const disable = async (): Promise<AutostartResult> => {
    if (platform !== "win32" && platform !== "linux") {
      return { ok: false, message: unsupported(platform), enabled: false };
    }

    const file = platform === "win32" ? windowsFile : linuxFile;

    if (file === undefined) {
      return {
        ok: false,
        message:
          platform === "win32"
            ? "Yunari cannot remove a start-at-sign-in entry here: APPDATA is not set."
            : "Yunari cannot remove a start-at-sign-in entry here: HOME and XDG_CONFIG_HOME are not set.",
        enabled: state(),
      };
    }

    try {
      if (
        platform === "win32" &&
        legacyTask !== undefined &&
        exists(legacyTask)
      ) {
        const failure = await removeLegacyTask();
        if (failure !== undefined) {
          return {
            ok: false,
            message: `could not remove the old sign-in task: ${failure}`,
            enabled: state(),
          };
        }
      }

      await rm(file, { force: true });

      return { ok: true, message: STOPPED, enabled: false };
    } catch (error) {
      return {
        ok: false,
        message: `could not remove the sign-in entry: ${messageOf(error)}`,
        enabled: state(),
      };
    }
  };

  return {
    state,
    enable,
    disable,
    // Enable-if-off, disable-if-on, read from the same state the menu shows.
    toggle: (command) => (state() ? disable() : enable(command)),
  };
}
