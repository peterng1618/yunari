/**
 * Linux tray adapter: the staged `systray2` binary is driven over JSON lines
 * on stdin, and clicks come back as `__id` numbers that index the menu this
 * process last sent. Nothing of the menu lives in the child but a rendering.
 */

import { spawn } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";
import type { TrayAction, TrayMenuItem, TrayView } from "./menu.js";
import { TRAY_ICON_PNG_BASE64 } from "./tray-icon.js";

/** The slice of a spawned child this adapter uses. */
export interface LinuxTrayChild {
  readonly stdin: {
    write(chunk: string): boolean;
    on(event: "error", listener: () => void): unknown;
  };
  readonly stdout: {
    on(event: "data", listener: (chunk: Buffer) => void): unknown;
  };
  readonly stderr: {
    on(event: "data", listener: (chunk: Buffer) => void): unknown;
  };
  once(event: "exit", listener: (code: number | null) => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
  unref(): void;
}

export type SpawnLinuxTrayProcess = (
  executable: string,
  args: readonly string[],
  options: { readonly stdio: ["pipe", "pipe", "pipe"] },
) => LinuxTrayChild;

export interface LinuxTrayOptions {
  readonly binary: string;
  readonly onAction: (action: TrayAction) => void;
  readonly onLost: (reason: string) => void;
  readonly spawnProcess?: SpawnLinuxTrayProcess;
  /** How long the tray process may take to report `ready`. */
  readonly readyTimeoutMs?: number;
  readonly exists?: (path: string) => boolean;
  readonly chmod?: (path: string, mode: number) => void;
  readonly arch?: string;
}

export interface LinuxMenuItem {
  readonly title: string;
  readonly enabled: boolean;
  readonly __id: number;
}

export interface LinuxMenuMessage {
  readonly icon: string;
  readonly title: string;
  readonly tooltip: string;
  readonly items: readonly LinuxMenuItem[];
}

export interface LinuxMenu {
  readonly menu: LinuxMenuMessage;
  /** Only rows that carry an action; a click for any other id is ignored. */
  readonly actions: Map<number, TrayAction>;
}

/** `systray2` renders a separator as the item whose title is this marker. */
const SEPARATOR_TITLE = "<SEPARATOR>";

/** Linux has no native check mark; the documented encoding is a suffix. */
const CHECK_SUFFIX = " (√)";

/** How long `exit` keeps the tray informative before the process is killed. */
const KILL_GRACE_MS = 300;

/** Stderr kept for a startup failure message. */
const STDERR_TAIL_MAX = 500;

/** Every item takes its 1-based position so ids stay stable across updates. */
export function linuxMenu(
  items: readonly TrayMenuItem[],
  iconBase64: string,
): LinuxMenu {
  const actions = new Map<number, TrayAction>();
  const wire = items.map((item, index) => {
    const __id = index + 1;
    if (item.action !== undefined) actions.set(__id, item.action);
    if (item.separator === true) {
      return { title: SEPARATOR_TITLE, enabled: false, __id };
    }
    return {
      title:
        item.checked === true ? `${item.title}${CHECK_SUFFIX}` : item.title,
      enabled: item.enabled,
      __id,
    };
  });
  return {
    menu: { icon: iconBase64, title: "", tooltip: "Yunari", items: wire },
    actions,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const defaultExists = (path: string): boolean => existsSync(path);

const defaultChmod = (path: string, mode: number): void => {
  chmodSync(path, mode);
};

const defaultSpawn: SpawnLinuxTrayProcess = (executable, args, options) =>
  spawn(executable, args, options) as unknown as LinuxTrayChild;

interface TrayLine {
  readonly type?: unknown;
  readonly __id?: unknown;
}

export async function startLinuxTray(
  options: LinuxTrayOptions,
): Promise<TrayView> {
  const arch = options.arch ?? process.arch;
  if (arch !== "x64") {
    throw new Error(
      `The Linux tray helper is x86-64 only; this host is on ${arch}.`,
    );
  }

  const exists = options.exists ?? defaultExists;
  if (!exists(options.binary)) {
    throw new Error(
      "The Linux tray helper is not staged. Run npm run vendor:tray -w @yunari/host.",
    );
  }

  const chmod = options.chmod ?? defaultChmod;
  try {
    chmod(options.binary, 0o755);
  } catch (error) {
    throw new Error(
      `could not make the Linux tray helper executable: ${messageOf(error)}`,
    );
  }

  const spawnProcess = options.spawnProcess ?? defaultSpawn;
  const readyTimeoutMs = options.readyTimeoutMs ?? 10_000;
  const onAction = options.onAction;
  const onLost = options.onLost;

  return new Promise<TrayView>((resolve, reject) => {
    let child: LinuxTrayChild;
    try {
      child = spawnProcess(options.binary, [], {
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      reject(new Error(`could not start the tray: ${messageOf(error)}`));
      return;
    }

    let items: readonly TrayMenuItem[] | undefined;
    let actions = new Map<number, TrayAction>();
    let tooltip = "Yunari";
    let started = false;
    let failed = false;
    let closing = false;
    let lost = false;
    let dead = false;
    let stderrTail = "";
    let buffer = "";
    let killTimer: NodeJS.Timeout | undefined;
    let readyTimer: NodeJS.Timeout | undefined;

    function send(line: string): void {
      try {
        child.stdin.write(`${line}\n`);
      } catch {
        // The pipe is gone; exit handling is what reports that.
      }
    }

    function sendMenu(): void {
      if (items === undefined) return;
      const built = linuxMenu(items, TRAY_ICON_PNG_BASE64);
      actions = built.actions;
      send(
        JSON.stringify({
          type: "update-menu",
          menu: { ...built.menu, tooltip },
        }),
      );
    }

    function setMenu(next: readonly TrayMenuItem[]): void {
      if (dead) return;
      items = next;
      sendMenu();
    }

    function setTooltip(text: string): void {
      if (dead) return;
      tooltip = text;
      // `systray2` only carries a tooltip on the menu, so re-sending is the
      // update; before the first menu there is nothing to update yet.
      sendMenu();
    }

    function close(): void {
      if (closing) return;
      closing = true;
      // A post-start error latches `dead` but leaves the process running, so
      // still kill it rather than orphaning the tray at Exit.
      if (!dead) send(JSON.stringify({ type: "exit" }));
      killTimer = setTimeout(() => child.kill(), KILL_GRACE_MS);
      killTimer.unref();
    }

    const view: TrayView = { setMenu, setTooltip, close };

    const quitTimers = (): void => {
      if (readyTimer !== undefined) {
        clearTimeout(readyTimer);
        readyTimer = undefined;
      }
      if (killTimer !== undefined) {
        clearTimeout(killTimer);
        killTimer = undefined;
      }
    };

    const stderrNote = (): string => {
      const tail = stderrTail.replace(/\s+/g, " ").trim();
      return tail === "" ? "" : ` (${tail})`;
    };

    const failStartup = (reason: string): void => {
      if (failed) return;
      failed = true;
      dead = true;
      quitTimers();
      child.kill();
      reject(new Error(`${reason}${stderrNote()}`));
    };

    const reportLost = (reason: string): void => {
      if (lost || closing) return;
      lost = true;
      dead = true;
      quitTimers();
      onLost(reason);
    };

    readyTimer = setTimeout(() => {
      if (started || failed) return;
      failStartup(`the tray did not start within ${readyTimeoutMs} ms`);
    }, readyTimeoutMs);

    function handleLine(line: string): void {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return;
      }
      if (typeof parsed !== "object" || parsed === null) return;
      const message = parsed as TrayLine;

      if (message.type === "ready") {
        if (started || failed) return;
        started = true;
        quitTimers();
        resolve(view);
        return;
      }

      if (message.type === "clicked") {
        if (dead) return;
        const id = message.__id;
        // The binary echoes the id it was given; anything else is not ours.
        if (typeof id !== "number" || !Number.isInteger(id)) return;
        const action = actions.get(id);
        if (action === undefined) return;
        onAction(action);
      }
    }

    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let end = buffer.indexOf("\n");
      while (end !== -1) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (line !== "") handleLine(line);
        end = buffer.indexOf("\n");
      }
    });
    child.stderr.on("data", (chunk) => {
      stderrTail = `${stderrTail}${chunk.toString()}`.slice(-STDERR_TAIL_MAX);
    });
    child.stdin.on("error", () => undefined);

    child.once("exit", (code) => {
      quitTimers();
      const detail = code === null ? "unknown" : String(code);
      if (!started) {
        failStartup(`the tray exited with code ${detail} before it started`);
        return;
      }
      reportLost(`the tray exited with code ${detail}`);
    });

    child.once("error", (error) => {
      quitTimers();
      if (!started) {
        failStartup(`the tray failed to start: ${messageOf(error)}`);
        return;
      }
      reportLost(`the tray failed: ${messageOf(error)}`);
    });
  });
}
