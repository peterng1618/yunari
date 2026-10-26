import { spawn } from "node:child_process";

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

function Emit-Result([string]$status, [string]$reason) {
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

# The filter panel draws a checked box as one private-use glyph and an
# unchecked one as another; each row carries the state glyph left of its label.
function Test-Source-Checked([string]$label) {
  $labelEl = Find-TextExact $label
  if ($null -eq $labelEl) { return $false }
  $labelRect = $labelEl.Current.BoundingRectangle
  foreach ($el in (Get-All)) {
    if ($el.Current.ControlType.ProgrammaticName -ne 'ControlType.Text') { continue }
    $r = $el.Current.BoundingRectangle
    if ([math]::Abs($r.Y - $labelRect.Y) -gt 12) { continue }
    if ($r.X -lt ($labelRect.X - 40) -or $r.X -ge ($labelRect.X - 5)) { continue }
    if ($el.Current.Name -eq [string][char]0xF14A) { return $true }
  }
  return $false
}

# A workshop item and the local project unpacked from it can carry the same
# title, and exporting the workshop one raises the subscriber-agreement modal.
# "My Wallpapers" is this PC's projects/myprojects, the one we wrote.
function Set-Local-Source() {
  if ($null -eq (Find-TextExact 'My Wallpapers')) {
    if (-not (Click-Contains 'Filter results' 'Hyperlink')) { return }
    Start-Sleep -Milliseconds 900
  }
  if ($null -eq (Find-TextExact 'My Wallpapers')) { return }
  foreach ($label in @('Official', 'Workshop')) {
    if ((Test-Source-Checked $label) -and (Click-Contains $label 'Text')) {
      Start-Sleep -Milliseconds 700
    }
  }
  if (-not (Test-Source-Checked 'My Wallpapers')) {
    [void](Click-Contains 'My Wallpapers' 'Text')
    Start-Sleep -Milliseconds 700
  }
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
# left of it. Taking the top-left match selects and then targets the same tile.
function Find-Tile([string]$title) {
  $limitX = 100000.0
  $win = Find-Window 'Wallpaper UI'
  if ($null -ne $win) {
    $w = $win.Current.BoundingRectangle
    $limitX = $w.X + ($w.Width * 0.75)
  }
  $best = $null
  foreach ($el in (Get-All)) {
    if ($el.Current.ControlType.ProgrammaticName -ne 'ControlType.Text') { continue }
    if ($el.Current.Name -ne $title) { continue }
    $r = $el.Current.BoundingRectangle
    if ($r.Width -le 16 -or $r.Width -gt 400 -or $r.Height -lt 8) { continue }
    if ($r.X -gt $limitX -or $r.Y -lt 150) { continue }
    if ($null -eq $best -or $r.Y -lt $best.Current.BoundingRectangle.Y) { $best = $el }
  }
  return $best
}

# A project unpacked moments ago is scanned in by the engine, and a full grid
# holds more tiles than fit, so the search waits and then scrolls.
function Search-Tile([string]$title) {
  $found = $null
  $deadline = (Get-Date).AddSeconds(30)
  while ($null -eq $found -and (Get-Date) -lt $deadline) {
    $found = Find-Tile $title
    if ($null -eq $found) { Start-Sleep -Milliseconds 500 }
  }
  if ($null -ne $found) { return $found }

  $scrollWin = Find-Window 'Wallpaper UI'
  if ($null -ne $scrollWin) {
    $r = $scrollWin.Current.BoundingRectangle
    [YunariWeClick]::SetCursorPos([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2)) | Out-Null
  }
  for ($i = 0; $i -lt 15 -and $null -eq $found; $i++) {
    [YunariWeClick]::Wheel(-480)
    Start-Sleep -Milliseconds 350
    $found = Find-Tile $title
  }
  return $found
}

$win = Find-Window 'Wallpaper UI'
if ($null -eq $win) {
  # The editor cannot be launched directly; Steam's own protocol starts the
  # main process, which is the window this script drives.
  Start-Process 'explorer.exe' 'steam://run/431960' | Out-Null
  $deadline = (Get-Date).AddSeconds(60)
  while ($null -eq $win -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 750
    $win = Find-Window 'Wallpaper UI'
  }
}
if ($null -eq $win) { Emit-Result 'fail' 'no-window' }

[YunariWeClick]::SetForegroundWindow([IntPtr]$win.Current.NativeWindowHandle) | Out-Null
Start-Sleep -Milliseconds 600

Close-Save-As
if ($null -ne (Find-Contains 'Exporting' 'Text')) {
  [void](Click-Contains 'Cancel' 'Hyperlink')
  Start-Sleep -Milliseconds 800
}
[YunariWeClick]::SetForegroundWindow([IntPtr]$win.Current.NativeWindowHandle) | Out-Null
Start-Sleep -Milliseconds 400

# Filter to this PC's own projects before searching: a workshop item can carry
# the same title, and exporting that one raises the agreement modal instead.
Set-Local-Source
Start-Sleep -Milliseconds 900

# A project unpacked moments ago is scanned in by the engine; give it a moment.
$tile = Search-Tile $Title

# A project the author has filed in a folder is not in the root grid, and that
# folder is the one this project family is filed under.
if ($null -eq $tile) {
  $folder = Find-TextExact 'yunari-background'
  if ($null -ne $folder) {
    $fr = $folder.Current.BoundingRectangle
    [YunariWeClick]::DoubleLeft([int]($fr.X + $fr.Width / 2), [int]($fr.Y + $fr.Height / 2))
    Start-Sleep -Milliseconds 900
    $tile = Search-Tile $Title
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
Start-Sleep -Milliseconds 700

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

/** `powershell.exe`, with the script as UTF-16LE base64 so no caller title,
 *  quote or backslash is ever re-parsed by a shell. */
const runPowerShell: PowerShellRunner = (script, timeoutMs) =>
  new Promise((resolve) => {
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    let stdout = "";
    let timedOut = false;
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
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
