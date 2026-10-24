/**
 * Drives a tray view from host state: one refresh builds the menu and tooltip,
 * a poll keeps them current, and clicks dispatch through `act`.
 *
 * The view is opened before the controller resolves so the first refresh writes
 * into a live menu, and the poll only re-sends what actually changed so an open
 * menu is not rebuilt underneath the pointer.
 */

import type { ActionResult } from "./external-apps.js";
import {
  buildTrayMenu,
  type TrayAction,
  type TraySnapshot,
  type TrayView,
  trayTooltip,
} from "./menu.js";

export interface TrayController {
  refresh(): Promise<void>;
  stop(): void;
}

export interface TrayControllerOptions {
  readonly readSnapshot: () => Promise<TraySnapshot>;
  readonly act: (action: TrayAction) => Promise<ActionResult>;
  readonly openView: (
    onAction: (action: TrayAction) => void,
    onLost: (reason: string) => void,
  ) => Promise<TrayView>;
  readonly onLost: (reason: string) => void;
  /** Called after Exit closes the view. The controller owns only the view; the
   *  host owns the process, so stopping it is the caller's job. */
  readonly onExit?: () => void;
  readonly pollMs?: number;
  readonly noticeMs?: number;
  /** Accepted for the plan's interface; notice expiry is timer-driven. */
  readonly now?: () => number;
}

const DEFAULT_POLL_MS = 5_000;
const DEFAULT_NOTICE_MS = 10_000;

/** Used only if the very first read failed; the notice replaces the status
 *  row, so the port is never rendered. */
const EMPTY_SNAPSHOT: TraySnapshot = { port: 0, lan: false, autostart: false };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function startTrayController(
  options: TrayControllerOptions,
): Promise<TrayController> {
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const noticeMs = options.noticeMs ?? DEFAULT_NOTICE_MS;

  let stopped = false;
  let refreshing = false;
  let view: TrayView | undefined;
  let snapshot: TraySnapshot | undefined;
  let notice: string | undefined;
  let noticeTimer: NodeJS.Timeout | undefined;
  let pollTimer: NodeJS.Timeout | undefined;
  let lastMenu: string | undefined;
  let lastTooltip: string | undefined;

  function clearNoticeTimer(): void {
    if (noticeTimer !== undefined) {
      clearTimeout(noticeTimer);
      noticeTimer = undefined;
    }
  }

  function setNotice(text: string): void {
    notice = text;
    // One timer, replaced: an older deadline must not clear a newer notice.
    clearNoticeTimer();
    noticeTimer = setTimeout(() => {
      noticeTimer = undefined;
      if (stopped) return;
      notice = undefined;
      void run(refresh);
    }, noticeMs);
  }

  function clearNotice(): void {
    notice = undefined;
    clearNoticeTimer();
  }

  /** Fire-and-forget entry: a throwing view write must not become an
   *  unhandled rejection; report it where a surface still exists. */
  async function run(task: () => Promise<void>): Promise<void> {
    try {
      await task();
    } catch (error) {
      if (stopped) return;
      if (view === undefined) options.onLost(messageOf(error));
      else setNotice(messageOf(error));
    }
  }

  async function refresh(): Promise<void> {
    const target = view;
    if (stopped || refreshing || target === undefined) return;
    refreshing = true;
    try {
      let next: TraySnapshot;
      try {
        next = await options.readSnapshot();
        snapshot = next;
      } catch (error) {
        setNotice(messageOf(error));
        next = snapshot ?? EMPTY_SNAPSHOT;
      }
      // `stop` or an action can land while the read is in flight.
      if (stopped) return;
      if (notice !== undefined) next = { ...next, notice };

      const items = buildTrayMenu(next);
      const menuKey = JSON.stringify(items);
      if (menuKey !== lastMenu) {
        target.setMenu(items);
        lastMenu = menuKey;
      }

      const tooltip = trayTooltip(next);
      if (tooltip !== lastTooltip) {
        target.setTooltip(tooltip);
        lastTooltip = tooltip;
      }
    } finally {
      refreshing = false;
    }
  }

  async function handleAction(action: TrayAction): Promise<void> {
    if (stopped) return;
    if (action === "exit") {
      stop();
      options.onExit?.();
      return;
    }
    let result: ActionResult;
    try {
      result = await options.act(action);
    } catch (error) {
      result = { ok: false, message: messageOf(error) };
    }
    if (stopped) return;
    // A failure with nothing to say still clears a stale notice from an
    // earlier action; only a message-bearing failure is worth showing.
    if (!result.ok && result.message !== "") setNotice(result.message);
    else clearNotice();
    await refresh();
  }

  function schedulePoll(): void {
    if (stopped) return;
    pollTimer = setTimeout(() => {
      pollTimer = undefined;
      // A tick that fires during a slow refresh is a no-op, not a queued one.
      void run(refresh).then(schedulePoll);
    }, pollMs);
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    if (pollTimer !== undefined) {
      clearTimeout(pollTimer);
      pollTimer = undefined;
    }
    clearNoticeTimer();
    const target = view;
    view = undefined;
    target?.close();
  }

  view = await options.openView((action) => {
    void run(() => handleAction(action));
  }, options.onLost);

  // Guarded like every later refresh: a throwing first write must not reject
  // this promise after the view (and the host behind it) is already live.
  await run(refresh);
  schedulePoll();

  return { refresh, stop };
}
