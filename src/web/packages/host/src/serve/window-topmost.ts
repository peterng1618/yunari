import { execFile } from "node:child_process";
import {
  powerShellLiteral,
  powershellPath,
} from "../providers/helpers/supervisor.js";

/**
 * Keeps a local display's window above other windows, or lets it fall back.
 *
 * Chromium has no switch for this, so the window is found through the process
 * set that carries the display's own `--user-data-dir` — the launcher's profile
 * path, which no other window shares — and `SetWindowPos` changes only the
 * extended style: `SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE`. A title lookup is
 * deliberately not used; the page's title is product copy, not an identity.
 *
 * The window is created some time after the browser starts, so a launch waits
 * for it while a live toggle does not. Every answer is what the native call
 * reported: `false` is a window that was not found or a call that was refused,
 * never an assumed success.
 */

/** How long a freshly spawned browser gets to put a window up. */
export const LAUNCH_WAIT_MS = 15_000;

/** A live toggle acts on a window that already exists. */
export const LIVE_WAIT_MS = 2_000;

/** Marks the window topmost (`HWND_TOPMOST`). */
const HWND_TOPMOST = -1;

/** Restores the window's ordinary order (`HWND_NOTOPMOST`). */
const HWND_NOTOPMOST = -2;

/** NOMOVE | NOSIZE | NOACTIVATE: style only, no geometry change, no focus. */
const STYLE_ONLY = "0x0002u | 0x0001u | 0x0010u";

/**
 * The script: the process set, then the windows those processes own.
 *
 * Expansion to the descendants matters because a Chromium window is not always
 * created by the process the host spawned; it is always in that process's tree.
 * The set is recomputed inside the wait because a browser that has not reported
 * its command line yet is a set with no roots.
 */
export function topmostScript(
  profileDir: string,
  topmost: boolean,
  waitMs: number,
): string {
  const after = topmost ? HWND_TOPMOST : HWND_NOTOPMOST;

  return `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class YunariTopmost {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);

  public static int Apply(int[] pids, long after) {
    var owners = new HashSet<int>(pids);
    int changed = 0;
    EnumWindows((handle, state) => {
      uint owner;
      GetWindowThreadProcessId(handle, out owner);
      if (owners.Contains((int)owner) && IsWindowVisible(handle)) {
        if (SetWindowPos(handle, new IntPtr(after), 0, 0, 0, 0, ${STYLE_ONLY})) changed += 1;
      }
      return true;
    }, IntPtr.Zero);
    return changed;
  }
}
'@
$yunariProfile = ${powerShellLiteral(profileDir)}
$deadline = (Get-Date).AddMilliseconds(${String(waitMs)})
while ($true) {
  $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  $roots = @($processes | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($yunariProfile) } | ForEach-Object { [int]$_.ProcessId })
  $tree = New-Object System.Collections.Generic.HashSet[int]
  foreach ($root in $roots) { [void]$tree.Add($root) }
  $grew = $true
  while ($grew) {
    $grew = $false
    foreach ($process in $processes) {
      if ($tree.Contains([int]$process.ParentProcessId) -and $tree.Add([int]$process.ProcessId)) { $grew = $true }
    }
  }
  if ($tree.Count -gt 0) {
    $changed = [YunariTopmost]::Apply([int[]]@($tree), ${String(after)})
    if ($changed -gt 0) { [Console]::Out.Write([string]$changed); exit 0 }
  }
  if ((Get-Date) -ge $deadline) { [Console]::Out.Write('0'); exit 0 }
  Start-Sleep -Milliseconds 250
}
`;
}

/** How the native call is run; injected so a case does not need Windows. */
export type TopmostRunner = (
  script: string,
  timeoutMs: number,
) => Promise<string | undefined>;

function runPowerShell(
  script: string,
  timeoutMs: number,
): Promise<string | undefined> {
  const executable = powershellPath();

  if (executable === undefined) return Promise.resolve(undefined);

  return new Promise((resolve) => {
    execFile(
      executable,
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      { windowsHide: true, timeout: timeoutMs, encoding: "utf8" },
      (error, stdout) => {
        resolve(error ? undefined : stdout);
      },
    );
  });
}

/**
 * Keeps one display's window topmost, or restores it.
 *
 * `true` means at least one of the display's windows was changed by this call.
 * Anything else — another platform, no PowerShell, no window within the wait, a
 * refused native call — is `false`.
 */
export async function setWindowTopmost(
  profileDir: string,
  topmost: boolean,
  options: {
    readonly waitMs?: number;
    readonly platform?: NodeJS.Platform;
    readonly run?: TopmostRunner;
  } = {},
): Promise<boolean> {
  const platform = options.platform ?? process.platform;

  if (platform !== "win32") return false;

  const waitMs = options.waitMs ?? LIVE_WAIT_MS;
  const run = options.run ?? runPowerShell;
  const output = await run(
    topmostScript(profileDir, topmost, waitMs),
    waitMs + 5_000,
  );
  const changed = Number(output?.trim() ?? "0");

  return Number.isInteger(changed) && changed > 0;
}
