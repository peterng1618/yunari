import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Takes a scene to Wallpaper Engine's own `.mpkg` export (decision 0118).
 *
 * The engine hides its editor export behind a debug-only flag, refuses
 * `wallpaperui.exe -project`, and refuses remote-debugging arguments. The one
 * shipped path is right-click → Send to Mobile Device → Export .mpkg, so this
 * module presses exactly those controls over UI Automation, sets "Keep original
 * aspect ratio" and "Original", and leaves the native Save dialog open.
 *
 * Saving is the author's click, deliberately: the Save dialog is a native
 * Explorer window whose child controls are not reliably reachable from a
 * non-interactive process, and a filename typed into it is not worth the
 * fragility. The host watches Documents for the package the author saves.
 */

export type MobileExportFailure =
  | "agreement"
  | "no-window"
  | "no-tile"
  | "no-modal"
  | "no-save"
  | "refused"
  | "failed";

export type MobileExportResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: MobileExportFailure };

/** Runs one script and answers its exit code and stdout. Injected by tests so
 *  no unit test ever starts Wallpaper Engine. */
export type PowerShellRunner = (
  script: string,
  timeoutMs: number,
) => Promise<{
  readonly timedOut: boolean;
  readonly code: number;
  readonly stdout: string;
}>;

export interface MobileExportRequest {
  /** The title the engine shows for the unpacked project. */
  readonly title: string;
  readonly runner?: PowerShellRunner;
  readonly timeoutMs?: number;
}

/** The script's result line. Anything before it is diagnostics. */
const RESULT_PREFIX = "YUNARI_WE:";

const FAILURES: readonly MobileExportFailure[] = [
  "agreement",
  "no-window",
  "no-tile",
  "no-modal",
  "no-save",
  "refused",
];

/** Unpacking, the search and the engine's own checks are the bulk of it; the
 *  script's own deadlines add up to just under this. */
const DEFAULT_TIMEOUT_MS = 200_000;

/** A PowerShell single-quoted literal: the only escape is a doubled quote. */
function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * The only C# the script needs: a click, a wheel turn and a window close. Kept
 * as its own constant so a test can compile it — a syntax error in C# is not
 * visible to the PowerShell parser, and would otherwise surface at export time.
 */
export const CLICK_HELPER = `using System;
using System.Text;
using System.Runtime.InteropServices;
public static class YunariWeClick {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  public static void Left(int x, int y) {
    SetCursorPos(x, y);
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
  }
  public static void Right(int x, int y) {
    SetCursorPos(x, y);
    mouse_event(0x0008, 0, 0, 0, UIntPtr.Zero);
    mouse_event(0x0010, 0, 0, 0, UIntPtr.Zero);
  }
  public static void DoubleLeft(int x, int y) {
    Left(x, y);
    Left(x, y);
  }
  public static void Wheel(int delta) {
    mouse_event(0x0800, 0, 0, (uint)delta, UIntPtr.Zero);
  }
  public static void CloseWindow(IntPtr hWnd) {
    SendMessage(hWnd, 0x0010, IntPtr.Zero, IntPtr.Zero);
  }
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint attach, uint attachTo, bool join);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();

  // A click lands on whatever owns the foreground, and SetForegroundWindow is
  // ignored unless the caller already owns it, so the two input queues are
  // joined for the call and released after it.
  public static void Force(IntPtr hWnd) {
    IntPtr foreground = GetForegroundWindow();
    uint thread = GetWindowThreadProcessId(foreground, IntPtr.Zero);
    uint mine = GetCurrentThreadId();
    AttachThreadInput(mine, thread, true);
    ShowWindow(hWnd, 9);
    BringWindowToTop(hWnd);
    SetForegroundWindow(hWnd);
    AttachThreadInput(mine, thread, false);
  }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowW(string cls, string title);
  public delegate bool EnumProc(IntPtr h, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lp);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

  // A title-only walk, for the day the window class changes: the largest match
  // wins, because every wallpaper's preview host carries the same title.
  public static IntPtr FindByTitle(string title) {
    IntPtr best = IntPtr.Zero;
    long bestArea = 0;
    EnumWindows(delegate(IntPtr h, IntPtr lp) {
      StringBuilder text = new StringBuilder(256);
      GetWindowTextW(h, text, 256);
      if (text.ToString() != title) { return true; }
      RECT r;
      GetWindowRect(h, out r);
      long area = (long)(r.Right - r.Left) * (r.Bottom - r.Top);
      if (area > bestArea) { bestArea = area; best = h; }
      return true;
    }, IntPtr.Zero);
    return best;
  }
}`;

/**
 * The UI Automation sequence. Kept as one string because it is a script, not
 * host logic; it writes no file and emits one `YUNARI_WE:` line.
 *
 * No backticks and no `${` anywhere: both are meaningful to the template literal
 * that wraps this, and neither is needed.
 */
export function mobileExportScript(title: string): string {
  return `$ErrorActionPreference = 'Stop'
$Title = ${literal(title)}

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
${CLICK_HELPER}
"@

$root = [System.Windows.Automation.AutomationElement]::RootElement
$windowHandle = [IntPtr]::Zero
$restoreWindow = $false

function Emit-Result([string]$status, [string]$reason) {
  # The desktop is left as it was found: a window this script maximised is
  # un-maximised on every exit, including the failures.
  if ($restoreWindow -and $windowHandle -ne [IntPtr]::Zero) {
    [YunariWeClick]::ShowWindow($windowHandle, 9) | Out-Null
  }
  if ($status -eq 'ok') {
    Write-Output 'YUNARI_WE:{"ok":true}'
  } else {
    Write-Output ('YUNARI_WE:{"ok":false,"reason":"' + $reason + '"}')
  }
  exit 0
}

function Get-All() {
  return $root.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition
  )
}

function Find-Window([string]$name) {
  $cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::NameProperty, $name
  )
  return $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
}

# The engine starts minimized to the tray when Steam launches it, and a window
# that is not showing is absent from UI Automation's desktop children: the same
# window is still a Win32 top-level window, so it is found there and restored.
# The class is passed explicitly because FindWindow reads a null class as the
# empty string and matches nothing.
function Find-MainWindow() {
  $found = Find-Window 'Wallpaper UI'
  if ($null -ne $found) { return $found }

  $handle = [YunariWeClick]::FindWindowW('WPEUI', 'Wallpaper UI')
  if ($handle -eq [IntPtr]::Zero) {
    $handle = [YunariWeClick]::FindByTitle('Wallpaper UI')
  }
  if ($handle -eq [IntPtr]::Zero) { return $null }

  [YunariWeClick]::ShowWindow($handle, 9) | Out-Null
  [YunariWeClick]::SetForegroundWindow($handle) | Out-Null
  Start-Sleep -Milliseconds 900
  return Find-Window 'Wallpaper UI'
}

function Find-Contains([string]$needle, [string]$type) {
  foreach ($el in (Get-All)) {
    if ($el.Current.Name -notlike ('*' + $needle + '*')) { continue }
    if ($type -ne '' -and $el.Current.ControlType.ProgrammaticName -ne ('ControlType.' + $type)) { continue }
    return $el
  }
  return $null
}

function Find-TextExact([string]$name) {
  foreach ($el in (Get-All)) {
    if ($el.Current.ControlType.ProgrammaticName -ne 'ControlType.Text') { continue }
    if ($el.Current.Name -ne $name) { continue }
    return $el
  }
  return $null
}

function Click-Element($el) {
  $r = $el.Current.BoundingRectangle
  [YunariWeClick]::Left([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2))
}

# A modal can sit behind the app, where a coordinate click lands on whatever is
# on top instead. Invoke asks the control itself and needs no focus.
function Activate-Element($el) {
  try {
    $pattern = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $pattern.Invoke()
    return
  } catch {
    Click-Element $el
  }
}

function Click-Contains([string]$needle, [string]$type) {
  $el = Find-Contains $needle $type
  if ($null -eq $el) { return $false }
  Activate-Element $el
  return $true
}

function Close-Save-As() {
  # A dialog left by an earlier run still swallows every later click, and it is
  # closed through its own handle because a coordinate click would land on
  # whatever the dialog itself covers.
  foreach ($win in (Get-All)) {
    if ($win.Current.ControlType.ProgrammaticName -ne 'ControlType.Window') { continue }
    if ($win.Current.Name -ne 'Save As') { continue }
    [YunariWeClick]::CloseWindow([IntPtr]$win.Current.NativeWindowHandle) | Out-Null
    Start-Sleep -Milliseconds 600
  }
}

# The detail panel repeats the selected item's title on the right; grid tiles are
# left of it, and taking the topmost match follows the grid's own order.
function Find-Tiles([string]$title) {
  $limitX = 100000.0
  $win = Find-Window 'Wallpaper UI'
  if ($null -ne $win) {
    $w = $win.Current.BoundingRectangle
    $limitX = $w.X + ($w.Width * 0.75)
  }
  $found = New-Object System.Collections.ArrayList
  foreach ($el in (Get-All)) {
    if ($el.Current.ControlType.ProgrammaticName -ne 'ControlType.Text') { continue }
    if ($el.Current.Name -ne $title) { continue }
    $r = $el.Current.BoundingRectangle
    if ($r.Width -le 16 -or $r.Width -gt 400 -or $r.Height -lt 8) { continue }
    if ($r.X -gt $limitX -or $r.Y -lt 150) { continue }
    [void]$found.Add($el)
  }
  return @($found | Sort-Object { $_.Current.BoundingRectangle.Y })
}

# Only a project on this PC carries the authoring note; a workshop item with the
# same title does not. Selecting is what fills the detail panel, so the note is
# read after each candidate is clicked.
function Test-LocalSelection() {
  return $null -ne (Find-Contains 'Open this wallpaper in the editor' 'Text')
}

# A project unpacked moments ago is scanned in by the engine, and a full grid
# holds more tiles than fit, so the search waits and then scrolls. The Source
# filter is never touched: it is the author's own state, persisted in the
# engine's config, and an export must leave the library looking as it did.
function Select-Local-Tile([string]$title) {
  $deadline = (Get-Date).AddSeconds(40)
  $scrolled = 0
  while ((Get-Date) -lt $deadline) {
    $tiles = Find-Tiles $title
    if ($tiles.Count -eq 0) {
      if ($scrolled -lt 15) {
        $win = Find-Window 'Wallpaper UI'
        if ($null -ne $win) {
          $r = $win.Current.BoundingRectangle
          [YunariWeClick]::SetCursorPos([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2)) | Out-Null
        }
        [YunariWeClick]::Wheel(-480)
        $scrolled++
      }
      Start-Sleep -Milliseconds 500
      continue
    }
    foreach ($candidate in $tiles) {
      $r = $candidate.Current.BoundingRectangle
      [YunariWeClick]::Left([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2))
      Start-Sleep -Milliseconds 700
      if (Test-LocalSelection) { return $candidate }
    }
    return $null
  }
  return $null
}

$win = Find-MainWindow
if ($null -eq $win) {
  # The editor cannot be launched directly; Steam's own protocol starts the
  # main process, which is the window this script drives.
  Start-Process 'explorer.exe' 'steam://run/431960' | Out-Null
  $deadline = (Get-Date).AddSeconds(60)
  while ($null -eq $win -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 750
    # Steam starts the engine to the tray, so this also restores it.
    $win = Find-MainWindow
  }
}
if ($null -eq $win) { Emit-Result 'fail' 'no-window' }

# A click lands on the foreground window, so the engine is made foreground even
# when the author's browser owns it. Then it is maximised: the engine's web layer
# keeps its old layout until it is resized, and a stale layout reports tile
# coordinates that no longer match what is drawn, so every click would miss.
$windowHandle = [IntPtr]$win.Current.NativeWindowHandle
[YunariWeClick]::Force($windowHandle)
Start-Sleep -Milliseconds 600
if (-not [YunariWeClick]::IsZoomed($windowHandle)) {
  $restoreWindow = $true
  [YunariWeClick]::ShowWindow($windowHandle, 3) | Out-Null
  Start-Sleep -Milliseconds 1200
}

Close-Save-As
if ($null -ne (Find-Contains 'Exporting' 'Text')) {
  [void](Click-Contains 'Cancel' 'Hyperlink')
  Start-Sleep -Milliseconds 800
}
[YunariWeClick]::Force($windowHandle)
Start-Sleep -Milliseconds 400

$tile = Select-Local-Tile $Title

# A project the author has filed in a folder is not in the root grid, and that
# folder is the one this project family is filed under.
if ($null -eq $tile) {
  $folder = Find-TextExact 'yunari-background'
  if ($null -ne $folder) {
    $fr = $folder.Current.BoundingRectangle
    [YunariWeClick]::DoubleLeft([int]($fr.X + $fr.Width / 2), [int]($fr.Y + $fr.Height / 2))
    Start-Sleep -Milliseconds 900
    $tile = Select-Local-Tile $Title
  }
}
if ($null -eq $tile) { Emit-Result 'fail' 'no-tile' }

# Select first, then right-click the same point: the context handler belongs to
# the tile's group, which is the label's parent when the tree nests it.
$target = $tile.Current.BoundingRectangle
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$group = $walker.GetParent($tile)
if ($null -ne $group) {
  $gr = $group.Current.BoundingRectangle
  if ($gr.Width -gt 40 -and $gr.Width -lt 400 -and $gr.Height -gt 40 -and $gr.Height -lt 400) {
    $target = $gr
  }
}
$tx = [int]($target.X + $target.Width / 2)
$ty = [int]($target.Y + $target.Height / 2)
[YunariWeClick]::Left($tx, $ty)
Start-Sleep -Milliseconds 500
[YunariWeClick]::Right($tx, $ty)
Start-Sleep -Milliseconds 900

# A virtualised tile can report a rect that no longer matches where it is drawn,
# and then the menu never opens. The label's own point is the retry before the
# run is called refused.
if ($null -eq (Find-Contains 'Send to Mobile Device' '')) {
  $lr = $tile.Current.BoundingRectangle
  $lx = [int]($lr.X + $lr.Width / 2)
  $ly = [int]($lr.Y + $lr.Height / 2)
  [YunariWeClick]::Left($lx, $ly)
  Start-Sleep -Milliseconds 500
  [YunariWeClick]::Right($lx, $ly)
  Start-Sleep -Milliseconds 900
}

if (-not (Click-Contains 'Send to Mobile Device' '')) { Emit-Result 'fail' 'refused' }
Start-Sleep -Milliseconds 700
if (-not (Click-Contains 'Export .mpkg' 'Hyperlink')) { Emit-Result 'fail' 'refused' }

# The modal appears after the engine's own checks; the agreement refusal is a
# modal too, so it is read before the export controls are expected.
$deadline = (Get-Date).AddSeconds(30)
$modal = $false
while (-not $modal -and (Get-Date) -lt $deadline) {
  if ($null -ne (Find-Contains 'subscriber agreement' 'Text')) { Emit-Result 'fail' 'agreement' }
  if ($null -ne (Find-Contains 'mobile usage permission' 'Text')) { Emit-Result 'fail' 'agreement' }
  if ($null -ne (Find-Contains 'Keep original aspect ratio' 'Button')) { $modal = $true; break }
  if ($null -ne (Find-Contains 'Fit to phone screen' 'Button')) { $modal = $true; break }
  Start-Sleep -Milliseconds 500
}
if (-not $modal) { Emit-Result 'fail' 'no-modal' }

# The modal remembers the last choices. Set both explicitly, and only click when
# the current label is the other one.
if ($null -eq (Find-Contains 'Keep original aspect ratio' 'Button')) {
  [void](Click-Contains 'Fit to phone screen' 'Button')
  Start-Sleep -Milliseconds 400
  [void](Click-Contains 'Keep original aspect ratio' 'Button')
  Start-Sleep -Milliseconds 400
}
if ($null -eq (Find-Contains 'Original' 'Button')) {
  [void](Click-Contains 'Video Preset' 'Text')
  Start-Sleep -Milliseconds 300
  [void](Click-Contains 'Original' 'Button')
  Start-Sleep -Milliseconds 400
}

if (-not (Click-Contains 'OK' 'Button')) { Emit-Result 'fail' 'no-modal' }
Start-Sleep -Milliseconds 1500

# The Save dialog is the author's step: it is left open, named and located by
# the engine's own defaults, and the host watches the folder it writes into.
#
# A dialog that was dismissed still answers UIA as a Window named Save As, so the
# answer is only 'ok' when the window has a handle and that handle is visible —
# otherwise a ghost left by an earlier run would read as this run's success.
$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline) {
  foreach ($el in (Get-All)) {
    if ($el.Current.ControlType.ProgrammaticName -ne 'ControlType.Window') { continue }
    if ($el.Current.Name -ne 'Save As') { continue }
    $handle = [IntPtr]$el.Current.NativeWindowHandle
    if ($handle -eq [IntPtr]::Zero) { continue }
    if (-not [YunariWeClick]::IsWindowVisible($handle)) { continue }
    Emit-Result 'ok' ''
  }
  Start-Sleep -Milliseconds 500
}
Emit-Result 'fail' 'no-save'`;
}

/** The last result line, or nothing for a script that never finished. */
function resultOf(
  stdout: string,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string }
  | undefined {
  const line = stdout
    .split(/\r?\n/)
    .filter((row) => row.startsWith(RESULT_PREFIX))
    .pop();
  if (line === undefined) return undefined;

  try {
    const body = JSON.parse(line.slice(RESULT_PREFIX.length)) as unknown;
    if (typeof body !== "object" || body === null) return undefined;
    const record = body as Record<string, unknown>;
    if (record.ok === true) return { ok: true };
    const reason = typeof record.reason === "string" ? record.reason : "";
    return { ok: false, reason };
  } catch {
    return undefined;
  }
}

/**
 * Runs one script through `powershell.exe -File`.
 *
 * Not `-EncodedCommand`: the script is ~14 KB, which is ~38 KB once UTF-16LE and
 * base64, and Windows refuses a command line over 32,767 characters — the spawn
 * failed at once and every export answered `failed`. A file has no such ceiling,
 * and writes the script verbatim so no caller title is re-parsed by a shell. The
 * file carries a UTF-8 BOM because Windows PowerShell 5.1 reads a BOM-less file
 * as ANSI, which turns a non-Latin title into mojibake.
 */
const runPowerShell: PowerShellRunner = async (script, timeoutMs) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-we-"));
  const file = path.join(directory, "export.ps1");

  try {
    await fs.writeFile(file, `﻿${script}`, "utf8");
    return await new Promise((resolve) => {
      let stdout = "";
      let timedOut = false;
      const child = spawn(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      // stderr is drained so the child never blocks on a full pipe; its text is
      // not part of the answer.
      child.stderr?.on("data", () => undefined);
      child.once("error", () => {
        clearTimeout(timer);
        resolve({ timedOut, code: -1, stdout });
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        resolve({ timedOut, code: code ?? -1, stdout });
      });
    });
  } finally {
    await fs
      .rm(directory, { recursive: true, force: true })
      .catch(() => undefined);
  }
};

/**
 * Opens the engine's export dialog for an unpacked project and confirms the
 * export settings, leaving the native Save dialog for the author.
 */
export async function requestMobileExport(
  request: MobileExportRequest,
): Promise<MobileExportResult> {
  const runner = request.runner ?? runPowerShell;
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let answer: Awaited<ReturnType<PowerShellRunner>>;
  try {
    answer = await runner(mobileExportScript(request.title), timeoutMs);
  } catch {
    return { ok: false, reason: "failed" };
  }

  if (answer.timedOut) return { ok: false, reason: "failed" };

  const result = resultOf(answer.stdout);
  if (result === undefined) return { ok: false, reason: "failed" };
  if (result.ok) return { ok: true };

  return {
    ok: false,
    reason: (FAILURES as readonly string[]).includes(result.reason)
      ? (result.reason as MobileExportFailure)
      : "failed",
  };
}
