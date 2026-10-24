/**
 * The tray's opening rows: what each opens, and whether it did. A failure is
 * returned rather than swallowed because in tray mode the notice row is the
 * only surface a failed open can reach.
 */

import path from "node:path";
import { type OpenTargetOptions, openBrowser, openTarget } from "../cli/net.js";
import type { ActionResult } from "./external-apps.js";
import type { TrayAction } from "./menu.js";

export type TrayOpenAction = Extract<
  TrayAction,
  "pair" | "editor" | "themes" | "settings" | "folder"
>;

export interface OpenActionContext {
  /** This run's plain address, such as `http://localhost:5227`. */
  readonly localPlain: string;
  /** `<app-dir>/settings`; the folder row opens its parent. */
  readonly settingsDir: string;
}

export interface OpenRequest {
  readonly target: string;
  /** Composed into "Opening …" and "Could not open …". */
  readonly label: string;
  readonly options: OpenTargetOptions;
}

/** What an opening row opens. */
export function openRequest(
  action: TrayOpenAction,
  context: OpenActionContext,
): OpenRequest {
  switch (action) {
    case "pair":
      return {
        target: `${context.localPlain}/editor?publish=1`,
        label: "Pair display",
        options: {},
      };
    case "editor":
      return {
        target: `${context.localPlain}/editor?mode=editor`,
        label: "Theme Editor",
        options: {},
      };
    case "themes":
      return {
        target: `${context.localPlain}/editor?mode=themes`,
        label: "Theme Store",
        options: {},
      };
    case "settings":
      return {
        target: `${context.localPlain}/editor?mode=this-pc`,
        label: "Host Settings",
        options: {},
      };
    case "folder":
      // The directory branch is what makes Windows use `explorer.exe`; without
      // it the folder goes through rundll32's URL protocol handler.
      return {
        target: path.dirname(context.settingsDir),
        label: "the Yunari folder",
        options: { directory: true },
      };
  }
}

export interface OpenSeam {
  readonly browser: (url: string) => boolean;
  readonly target: (target: string, options?: OpenTargetOptions) => boolean;
}

/** Opens one row and says whether it worked. */
export function openTrayAction(
  action: TrayOpenAction,
  context: OpenActionContext,
  open: OpenSeam = { browser: openBrowser, target: openTarget },
): ActionResult {
  const request = openRequest(action, context);
  const opened =
    action === "folder"
      ? open.target(request.target, request.options)
      : open.browser(request.target);

  return opened
    ? { ok: true, message: `Opening ${request.label}.` }
    : { ok: false, message: `Could not open ${request.label}.` };
}
