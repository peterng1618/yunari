/**
 * Linux tray adapter: the staged `systray2` binary is driven over JSON lines
 * on stdin, and clicks come back addressed by the row table the binary built
 * from the first menu it read.
 *
 * The pinned binary speaks a narrower protocol than its npm wrapper's typings:
 * the first line after `ready` is a bare `Menu` (no `type`), later changes are
 * `update-item-and-menu` lines, and a separator is the title `" "`. A row that
 * was not in the first menu cannot be added later, so the row set must stay
 * stable and only the rows the binary knows are ever addressed.
 *
 * The binary's slot→id table is built once at init and never rewritten, so a
 * row is identified by its slot: update lines carry the 0-based index as
 * `seq_id` and the init id as `item.__id`, and a click routes by `seq_id`.
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
  readonly checked?: boolean;
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

/** `addMenuItem` in the pinned binary turns the title `" "` into a separator. */
const SEPARATOR_TITLE = " ";

/** Linux has no native check mark; the documented encoding is a suffix. */
const CHECK_SUFFIX = " (√)";

/** How long `exit` keeps the tray informative before the process is killed. */
const KILL_GRACE_MS = 300;

/** Stderr kept for a startup failure message. */
const STDERR_TAIL_MAX = 500;

/**
 * `__id` is the row's 1-based slot in the initial menu. The binary builds its
 * slot→id table once at init and never rewrites it on an update, so an invented
 * later id would never come back in a click.
 */
function buildLinuxMenu(
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
      ...(item.checked === undefined ? {} : { checked: item.checked }),
      __id,
    };
  });
  return {
    menu: { icon: iconBase64, title: "", tooltip: "Yunari", items: wire },
    actions,
  };
}

export function linuxMenu(
  items: readonly TrayMenuItem[],
  iconBase64: string,
): LinuxMenu {
  return buildLinuxMenu(items, iconBase64);
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
  readonly seq_id?: unknown;
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

    /** The rows currently applied, by slot; clicks route through this. */
    let items: readonly TrayMenuItem[] | undefined;
    let tooltip = "Yunari";
    /** The rows the binary currently holds, by the same slot. */
    let sentRows: LinuxMenuItem[] = [];
    /** Set only once the bare first menu was actually written. */
    let sentTooltip: string | undefined;
    let warnedRowCount: number | undefined;
    let started = false;
    let failed = false;
    let closing = false;
    let lost = false;
    let dead = false;
    let stderrTail = "";
    let buffer = "";
    let killTimer: NodeJS.Timeout | undefined;
    let readyTimer: NodeJS.Timeout | undefined;

    function send(line: string): boolean {
      try {
        child.stdin.write(`${line}\n`);
        return true;
      } catch {
        // The pipe is gone; exit handling is what reports that.
        return false;
      }
    }

    function sameRow(a: LinuxMenuItem, b: LinuxMenuItem): boolean {
      return (
        a.title === b.title &&
        a.enabled === b.enabled &&
        a.checked === b.checked
      );
    }

    /**
     * `next` is the menu asked for; `undefined` re-sends the applied rows for
     * a tooltip-only change. A row set that does not match the binary's slots
     * is a mismatch: warn, apply only the rows it can address, and leave the
     * routing rows alone so the visible rows still click correctly.
     */
    function sendMenu(next?: readonly TrayMenuItem[]): void {
      if (sentTooltip === undefined) {
        // An empty menu cannot initialise the binary, so wait for the first
        // real one. Latch only after the write landed: a dropped line leaves
        // the binary uninitialised and the next call must retry this menu.
        if (next === undefined || next.length === 0) return;
        const built = buildLinuxMenu(next, TRAY_ICON_PNG_BASE64);
        const menu: LinuxMenuMessage = { ...built.menu, tooltip };
        if (!send(JSON.stringify(menu))) return;
        items = next;
        sentRows = [...menu.items];
        sentTooltip = tooltip;
        return;
      }

      if (next !== undefined) {
        if (next.length !== sentRows.length) {
          if (warnedRowCount !== next.length) {
            warnedRowCount = next.length;
            process.emitWarning(
              `the Linux tray menu has ${next.length} rows but the tray was ` +
                `built with ${sentRows.length}; the systray2 binary cannot add or remove rows.`,
            );
          }
        } else {
          warnedRowCount = undefined;
          items = next;
        }
      }

      const source = next ?? items ?? [];
      const built = buildLinuxMenu(source, TRAY_ICON_PNG_BASE64);
      const menu: LinuxMenuMessage = { ...built.menu, tooltip };
      const rows = menu.items.slice(0, sentRows.length);
      let wrote = false;
      for (let index = 0; index < rows.length; index += 1) {
        const item = rows[index];
        if (item === undefined) continue;
        const previous = sentRows[index];
        if (previous !== undefined && sameRow(previous, item)) continue;
        // `seq_id` is the 0-based slot the binary updates in place; the item's
        // `__id` stays the slot's init id, which is what a click echoes.
        if (
          !send(
            JSON.stringify({
              type: "update-item-and-menu",
              item,
              menu,
              seq_id: index,
            }),
          )
        ) {
          continue;
        }
        sentRows[index] = item;
        wrote = true;
      }
      // The tooltip travels on the menu, which every update line carries; with
      // no row change, one unchanged row still has to be written.
      const first = rows[0];
      if (!wrote && first !== undefined && tooltip !== sentTooltip) {
        if (
          send(
            JSON.stringify({
              type: "update-item-and-menu",
              item: first,
              menu,
              seq_id: 0,
            }),
          )
        ) {
          sentRows[0] = first;
          wrote = true;
        }
      }
      if (wrote) sentTooltip = tooltip;
    }

    function setMenu(next: readonly TrayMenuItem[]): void {
      if (dead) return;
      sendMenu(next);
    }

    function setTooltip(text: string): void {
      if (dead) return;
      tooltip = text;
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
        const rows = items ?? [];
        // The binary echoes the slot it stored; prefer it over `__id`, which
        // is only the init-slot fallback the binary also sends.
        const seq = message.seq_id;
        if (
          typeof seq === "number" &&
          Number.isInteger(seq) &&
          seq >= 0 &&
          seq < rows.length
        ) {
          const row = rows[seq];
          if (row?.enabled === true && row.action !== undefined) {
            onAction(row.action);
          }
          return;
        }
        const id = message.__id;
        if (
          typeof id === "number" &&
          Number.isInteger(id) &&
          id >= 1 &&
          id <= rows.length
        ) {
          const row = rows[id - 1];
          if (row?.enabled === true && row.action !== undefined) {
            onAction(row.action);
          }
        }
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
