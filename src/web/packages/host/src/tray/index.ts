/**
 * Platform selector for the tray: refuses a host it cannot serve, then hands
 * both callbacks to the Windows or Linux adapter through the controller.
 */

import {
  startTrayController,
  type TrayController,
  type TrayControllerOptions,
} from "./controller.js";
import type { ActionResult } from "./external-apps.js";
import { type SpawnLinuxTrayProcess, startLinuxTray } from "./linux.js";
import type { TrayAction, TraySnapshot } from "./menu.js";
import { type SpawnTrayProcess, startWindowsTray } from "./windows.js";

/** Both adapters take a `spawnProcess`; this is the caller's single seam. */
export type TraySpawnProcess = SpawnTrayProcess & SpawnLinuxTrayProcess;

export interface StartTrayOptions {
  readonly linuxBinary: string;
  readonly readSnapshot: () => Promise<TraySnapshot>;
  readonly act: (action: TrayAction) => Promise<ActionResult>;
  readonly onLost: (reason: string) => void;
  /** Called when Exit closes the tray; the host stops itself. */
  readonly onExit?: () => void;
  readonly platform?: NodeJS.Platform;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly spawnProcess?: TraySpawnProcess;
}

export async function startTray(
  options: StartTrayOptions,
): Promise<TrayController> {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32" && platform !== "linux") {
    throw new Error(
      `The tray runs on Windows and Linux only; this host is on ${platform}.`,
    );
  }

  const env = options.env ?? process.env;
  if (platform === "linux" && !env["DISPLAY"] && !env["WAYLAND_DISPLAY"]) {
    throw new Error(
      "The tray needs a graphical session (DISPLAY or WAYLAND_DISPLAY); none is set.",
    );
  }

  const spawnProcess = options.spawnProcess;
  const openView: TrayControllerOptions["openView"] = (onAction, onLost) => {
    if (platform === "win32") {
      return startWindowsTray({
        onAction,
        onLost,
        ...(spawnProcess === undefined ? {} : { spawnProcess }),
      });
    }
    return startLinuxTray({
      binary: options.linuxBinary,
      onAction,
      onLost,
      ...(spawnProcess === undefined ? {} : { spawnProcess }),
    });
  };

  return startTrayController({
    readSnapshot: options.readSnapshot,
    act: options.act,
    openView,
    onLost: options.onLost,
    ...(options.onExit === undefined ? {} : { onExit: options.onExit }),
  });
}
