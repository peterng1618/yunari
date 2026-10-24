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
 * lookup searches for (decision 0109). An absent PowerShell, a failed run or an
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
