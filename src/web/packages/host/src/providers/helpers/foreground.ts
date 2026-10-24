/**
 * The foreground window's owning process, read by one embedded PowerShell
 * script under the 0102 supervisor.
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
}

export const FOREGROUND_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class YunariForegroundWindow {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@
while ($true) {
  $handle = [YunariForegroundWindow]::GetForegroundWindow()
  [uint32]$processId = 0
  if ($handle -ne [IntPtr]::Zero) {
    [void][YunariForegroundWindow]::GetWindowThreadProcessId($handle, [ref]$processId)
  }

  if ($processId -eq 0) {
    [Console]::Out.WriteLine('{"kind":"foreground","pid":0}')
  } else {
    $path = $null
    $name = $null
    try {
      $process = [System.Diagnostics.Process]::GetProcessById([int]$processId)
      $name = $process.ProcessName
      $path = $process.MainModule.FileName
    } catch {
      $path = $null
    }
    $line = [ordered]@{
      kind = 'foreground'
      pid = [int]$processId
      path = $path
      name = $name
    }
    [Console]::Out.WriteLine(($line | ConvertTo-Json -Compress))
  }

  Start-Sleep -Milliseconds 1000
}
`;

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
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

  return {
    pid,
    ...(path === undefined ? {} : { path }),
    ...(name === undefined ? {} : { name }),
  };
}
