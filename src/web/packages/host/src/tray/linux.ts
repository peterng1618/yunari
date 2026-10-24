/**
 * Linux tray adapter: the staged `systray2` binary is driven over JSON lines
 * on stdin, and clicks come back as `__id` numbers that address the row table
 * the binary built from the first menu it read.
 *
 * The pinned binary speaks a narrower protocol than its npm wrapper's typings:
 * the first line after `ready` is a bare `Menu` (no `type`), later changes are
 * `update-item-and-menu` lines, and a separator is the title `" "`. A row that
 * was not in the first menu cannot be added later, so the row set must stay
 * stable and only the rows the binary knows are ever addressed.
 *
 * Row ids are issued from one monotonic counter and never reused; update lines
 * carry the array index as `seq_id` and the new id as `item.__id`. A bounded
 * history of id→action keeps a click that raced an update pointing at the row
 * the user actually clicked.
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

/** How many issued row ids stay resolvable after later menus replace them. */
const ID_HISTORY_MAX = 200;

/** How long `exit` keeps the tray informative before the process is killed. */
const KILL_GRACE_MS = 300;

/** Stderr kept for a startup failure message. */
const STDERR_TAIL_MAX = 500;

/**
 * Every row takes a fresh id from the view's one monotonic counter: ids are
 * globally unique and never reused, so an update can never overwrite a row it
 * did not mean and a click that raced an update still names the row it saw.
 */
function buildLinuxMenu(
  items: readonly TrayMenuItem[],
  iconBase64: string,
  nextId: () => number,
): LinuxMenu {
  const actions = new Map<number, TrayAction>();
  const wire = items.map((item) => {
    const __id = nextId();
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
  let id = 1;
  return buildLinuxMenu(items, iconBase64, () => id++);
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
    /** One counter for the view: an id is issued once and never reused. */
    let nextId = 1;
    let tooltip = "Yunari";
    /** The rows the binary currently holds, by array index. */
    let sentRows: LinuxMenuItem[] = [];
    /** Set only once the bare first menu was actually written. */
    let sentTooltip: string | undefined;
    /** Every id ever issued with an action, oldest pruned first. */
    const idHistory = new Map<number, TrayAction>();
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

    function remember(actions: Map<number, TrayAction>): void {
      for (const [id, action] of actions) {
        idHistory.set(id, action);
        while (idHistory.size > ID_HISTORY_MAX) {
          const oldest = idHistory.keys().next();
          if (oldest.done === true) break;
          idHistory.delete(oldest.value);
        }
      }
    }

    function sameRow(a: LinuxMenuItem, b: LinuxMenuItem): boolean {
      return (
        a.title === b.title &&
        a.enabled === b.enabled &&
        a.checked === b.checked
      );
    }

    function sendMenu(): void {
      if (items === undefined) return;
      const built = buildLinuxMenu(items, TRAY_ICON_PNG_BASE64, () => nextId++);
      const menu: LinuxMenuMessage = { ...built.menu, tooltip };

      if (sentTooltip === undefined) {
        // An empty menu cannot initialise the binary, so wait for the first
        // real one. Latch only after the write landed: a dropped line leaves
        // the binary uninitialised and the next call must retry this menu.
        if (menu.items.length === 0) return;
        if (!send(JSON.stringify(menu))) return;
        sentRows = [...menu.items];
        sentTooltip = tooltip;
        remember(built.actions);
        return;
      }

      // The binary's row table was built from the first menu and an update
      // cannot append a row, so only those rows are addressable.
      if (menu.items.length !== sentRows.length) {
        if (warnedRowCount !== menu.items.length) {
          warnedRowCount = menu.items.length;
          process.emitWarning(
            `the Linux tray menu has ${menu.items.length} rows but the tray was ` +
              `built with ${sentRows.length}; the systray2 binary cannot add or remove rows.`,
          );
        }
      } else {
        warnedRowCount = undefined;
      }

      const rows = menu.items.slice(0, sentRows.length);
      let wrote = false;
      for (let index = 0; index < rows.length; index += 1) {
        const item = rows[index];
        if (item === undefined) continue;
        const previous = sentRows[index];
        if (previous !== undefined && sameRow(previous, item)) continue;
        // `seq_id` is the array index the binary stores; `__id` is the id a
        // click will echo back. They are different namespaces on purpose.
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
        const action = built.actions.get(item.__id);
        if (action !== undefined) remember(new Map([[item.__id, action]]));
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
          const action = built.actions.get(first.__id);
          if (action !== undefined) remember(new Map([[first.__id, action]]));
          wrote = true;
        }
      }
      if (wrote) sentTooltip = tooltip;
    }

    function setMenu(next: readonly TrayMenuItem[]): void {
      if (dead) return;
      items = next;
      sendMenu();
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
        const id = message.__id;
        // The binary echoes the id it was given; anything else is not ours.
        if (typeof id !== "number" || !Number.isInteger(id)) return;
        const action = idHistory.get(id);
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
