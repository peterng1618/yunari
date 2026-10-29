import { execFile } from "node:child_process";
import { powershellPath } from "./supervisor.js";

/**
 * The foreground window's owning process, read by one embedded PowerShell
 * script under the 0102 supervisor, plus a one-shot version-info read of the
 * name a store lookup searches for.
 *
 * `GetForegroundWindow` and `GetWindowThreadProcessId` need no elevation and
 * raise no UAC prompt. `Process.MainModule.FileName` throws for a process this
 * user may not inspect, so a line carries whatever was readable and the caller
 * never treats a missing path as a name it can invent.
 */

export interface ForegroundReading {
  /** The foreground window's process id; zero means no foreground window. */
  readonly pid: number;
  readonly path?: string;
  /** The process name without a path, when the executable path is unreadable. */
  readonly name?: string;
  /**
   * The window class. A packaged app reports its `Windows.UI.Core.CoreWindow`
   * child, not the `ApplicationFrameWindow` its frame host owns.
   */
  readonly class?: string;
  /** The window's rect equals the rect of the monitor nearest to it. */
  readonly fullscreen?: boolean;
  /** `SHQueryUserNotificationState` reported a running D3D fullscreen app. */
  readonly d3dFullscreen?: boolean;
}

/** A version-info read blocks no sample longer than this. */
const PRODUCT_NAME_TIMEOUT_MS = 5_000;

/**
 * Read once per executable path for the process life: a store match turns on
 * this value only when a display binds a game name, and a game started again
 * has not changed its ProductName. The promise is cached so concurrent samples
 * share one PowerShell run.
 */
const productNames = new Map<string, Promise<string | undefined>>();

/** A single-quoted PowerShell literal: the only escape is a doubled quote. */
function powerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function productNameScript(executablePath: string): string {
  return `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$value = (Get-Item -LiteralPath ${powerShellLiteral(executablePath)}).VersionInfo.ProductName
if ($null -ne $value) { [Console]::Out.Write([string]$value) }
`;
}

/**
 * The executable's version-info ProductName, used as the local name a store
 * lookup searches for. An absent PowerShell, a failed run or an
 * empty value is `undefined`; nothing here is ever reported as a failure.
 */
export function readProductName(
  executablePath: string,
): Promise<string | undefined> {
  const key = executablePath.toLowerCase();
  const cached = productNames.get(key);
  if (cached !== undefined) return cached;

  const reading = readProductNameOnce(executablePath);
  productNames.set(key, reading);
  return reading;
}

async function readProductNameOnce(
  executablePath: string,
): Promise<string | undefined> {
  const executable = powershellPath();

  if (executable === undefined) return undefined;

  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    Buffer.from(productNameScript(executablePath), "utf16le").toString(
      "base64",
    ),
  ];

  const output = await new Promise<string | undefined>((resolve) => {
    execFile(
      executable,
      args,
      {
        windowsHide: true,
        timeout: PRODUCT_NAME_TIMEOUT_MS,
        encoding: "utf8",
      },
      (error, stdout) => {
        resolve(error ? undefined : stdout);
      },
    );
  });

  const name = output?.trim();
  return name === undefined || name === "" ? undefined : name;
}

export const FOREGROUND_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class YunariForegroundWindow {
  [StructLayout(LayoutKind.Sequential)]
  public struct Rect {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct MonitorInfo {
    public int cbSize;
    public Rect rcMonitor;
    public Rect rcWork;
    public uint dwFlags;
  }

  private const uint MonitorDefaultToNearest = 2;
  private const int D3DFullScreen = 3;

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr FindWindowEx(IntPtr hWndParent, IntPtr hWndChildAfter, string lpszClass, string lpszWindow);
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out Rect lpRect);
  [DllImport("user32.dll")]
  public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint dwFlags);
  [DllImport("user32.dll")]
  public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MonitorInfo lpmi);
  [DllImport("shell32.dll")]
  public static extern int SHQueryUserNotificationState(out int state);

  public static string ClassNameOf(IntPtr hWnd) {
    var name = new System.Text.StringBuilder(256);
    return GetClassName(hWnd, name, name.Capacity) > 0 ? name.ToString() : "";
  }

  public static bool IsFullscreen(IntPtr hWnd) {
    Rect window;
    if (!GetWindowRect(hWnd, out window)) return false;
    IntPtr monitor = MonitorFromWindow(hWnd, MonitorDefaultToNearest);
    if (monitor == IntPtr.Zero) return false;
    var info = new MonitorInfo();
    info.cbSize = Marshal.SizeOf(typeof(MonitorInfo));
    if (!GetMonitorInfo(monitor, ref info)) return false;
    return window.Left == info.rcMonitor.Left &&
      window.Top == info.rcMonitor.Top &&
      window.Right == info.rcMonitor.Right &&
      window.Bottom == info.rcMonitor.Bottom;
  }

  public static bool IsD3DFullscreen() {
    int state;
    return SHQueryUserNotificationState(out state) == 0 && state == D3DFullScreen;
  }
}
'@
while ($true) {
  $handle = [YunariForegroundWindow]::GetForegroundWindow()
  [uint32]$processId = 0
  $class = ''
  $fullscreen = $false
  $d3dFullscreen = $false

  if ($handle -ne [IntPtr]::Zero) {
    $class = [YunariForegroundWindow]::ClassNameOf($handle)
    if ($class -eq 'ApplicationFrameWindow') {
      $child = [YunariForegroundWindow]::FindWindowEx($handle, [IntPtr]::Zero, 'Windows.UI.Core.CoreWindow', [NullString]::Value)
      if ($child -ne [IntPtr]::Zero) {
        $handle = $child
        $class = [YunariForegroundWindow]::ClassNameOf($handle)
      }
    }
    [void][YunariForegroundWindow]::GetWindowThreadProcessId($handle, [ref]$processId)
    $fullscreen = [YunariForegroundWindow]::IsFullscreen($handle)
  }
  $d3dFullscreen = [YunariForegroundWindow]::IsD3DFullscreen()

  $line = [ordered]@{
    kind = 'foreground'
    pid = [int]$processId
    fullscreen = $fullscreen
    d3dFullscreen = $d3dFullscreen
  }
  if ($class -ne '') { $line['class'] = $class }

  if ($processId -ne 0) {
    $path = $null
    $name = $null
    try {
      $process = [System.Diagnostics.Process]::GetProcessById([int]$processId)
      $name = $process.ProcessName
      $path = $process.MainModule.FileName
    } catch {
      $path = $null
    }
    $line['path'] = $path
    $line['name'] = $name
  }
  [Console]::Out.WriteLine(($line | ConvertTo-Json -Compress))

  Start-Sleep -Milliseconds 1000
}
`;

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** One helper line, or nothing when the line is not a foreground reading. */
export function parseForegroundLine(
  line: string,
): ForegroundReading | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }

  const record = parsed as Record<string, unknown>;
  const pid = record["pid"];

  if (record["kind"] !== "foreground") return undefined;
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid < 0) {
    return undefined;
  }

  const path = optionalText(record["path"]);
  const name = optionalText(record["name"]);
  const windowClass = optionalText(record["class"]);
  const fullscreen = optionalBoolean(record["fullscreen"]);
  const d3dFullscreen = optionalBoolean(record["d3dFullscreen"]);

  return {
    pid,
    ...(path === undefined ? {} : { path }),
    ...(name === undefined ? {} : { name }),
    ...(windowClass === undefined ? {} : { class: windowClass }),
    ...(fullscreen === undefined ? {} : { fullscreen }),
    ...(d3dFullscreen === undefined ? {} : { d3dFullscreen }),
  };
}
