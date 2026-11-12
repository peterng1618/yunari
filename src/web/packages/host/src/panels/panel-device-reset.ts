import { execFile } from "node:child_process";
import {
  powerShellLiteral,
  powershellPath,
} from "../providers/helpers/supervisor.js";

/**
 * Restarts the USB node a wedged panel hangs off.
 *
 * A TURZX panel whose endpoint stops consuming data is not absent and not held
 * by another program: only a USB restart clears it. Restarting the COM child
 * device does not (measured, decision 0132), while restarting its **parent**
 * composite device does. Both `pnputil` and that restart need elevation, so the
 * action is a prompt the owner sees and can decline — the host holds no
 * standing privilege.
 *
 * The instance id comes from the port listing, never from a request: this
 * module is the last step before a privileged OS call, so it accepts only the
 * USB instance-id shape and refuses everything else before running a script.
 */

/** What one script run answered. A killed, refused or crashed run is non-zero. */
export interface ScriptResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** How a script is run; injected so a case does not need Windows. */
export type ScriptRunner = (
  script: string,
  timeoutMs: number,
) => Promise<ScriptResult>;

const LOOKUP_TIMEOUT_MS = 15_000;
/** The restart waits on a UAC prompt, so it is bounded by a person, not the OS. */
const RESTART_TIMEOUT_MS = 120_000;
const MAX_DETAIL = 300;

/**
 * `USB\VID_1D6B&PID_0106[&MI_00]\6&E9576A&5&0000` — interface or composite.
 *
 * Deliberately strict: no quote, whitespace or separator outside the set a
 * Windows instance id actually uses, so nothing from a request can become
 * script text even before {@link powerShellLiteral} quotes it.
 */
const USB_INSTANCE_ID =
  /^USB\\VID_[0-9A-F]{4}&PID_[0-9A-F]{4}(?:&MI_[0-9A-F]{2})?\\[A-Za-z0-9_&+.-]{1,64}$/i;

/** The first line of a failure, trimmed to something a surface can show. */
function detailOf(result: ScriptResult): string {
  const line = result.stderr.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (line !== "") return `: ${line.slice(0, MAX_DETAIL)}`;
  return result.code === 0 ? "" : ` (exit ${result.code})`;
}

function runPowerShell(
  script: string,
  timeoutMs: number,
): Promise<ScriptResult> {
  const executable = powershellPath();
  if (executable === undefined) {
    return Promise.resolve({
      code: 1,
      stdout: "",
      stderr: "PowerShell is not installed.",
    });
  }

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
      {
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 64 * 1024,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        resolve({
          code:
            error === null
              ? 0
              : typeof error.code === "number"
                ? error.code
                : 1,
          stdout,
          stderr,
        });
      },
    );
  });
}

/**
 * The parent composite device's instance id, as Windows reports it.
 *
 * The parent, not the COM interface: the interface restart leaves the wedge.
 */
function lookupScript(instanceId: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    "(Get-PnpDeviceProperty -InstanceId " +
      `${powerShellLiteral(instanceId)} ` +
      "-KeyName 'DEVPKEY_Device_Parent').Data",
  ].join("\n");
}

/**
 * `pnputil /restart-device <parent>` behind a UAC prompt.
 *
 * `Start-Process -Verb RunAs` re-launches elevated; its stderr is not connected
 * to this shell, so only a refusal to start (a declined prompt, no pnputil)
 * produces text here. The exit code is the elevated process's own.
 */
function restartScript(parent: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    "try {",
    "  $child = Start-Process -FilePath 'pnputil.exe' " +
      `-ArgumentList @('/restart-device', ${powerShellLiteral(parent)}) ` +
      "-Verb RunAs -WindowStyle Hidden -Wait -PassThru",
    "  exit $child.ExitCode",
    "} catch {",
    "  [Console]::Error.Write($_.Exception.Message)",
    "  exit 1",
    "}",
  ].join("\n");
}

/**
 * Restarts the USB device `deviceId` hangs off, prompting for elevation.
 *
 * Resolves once the elevated restart has finished; the panel manager's retry
 * loop reopens the device on its own. Throws with the reason it did not run.
 */
export async function resetPanelDevice(
  deviceId: string,
  options: {
    readonly run?: ScriptRunner;
    readonly platform?: NodeJS.Platform;
  } = {},
): Promise<void> {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    throw new Error("Restarting a USB device is a Windows action.");
  }

  const instanceId = deviceId.trim();
  if (!USB_INSTANCE_ID.test(instanceId)) {
    throw new Error(
      "Refusing to restart a device that is not a USB instance id.",
    );
  }

  const run = options.run ?? runPowerShell;

  const lookup = await run(lookupScript(instanceId), LOOKUP_TIMEOUT_MS);
  const parent = lookup.stdout.trim();
  if (lookup.code !== 0 || parent === "") {
    throw new Error(
      `Windows could not name the USB device to restart${detailOf(lookup)}.`,
    );
  }

  // The reply is Windows' word, not the caller's, but it is still the argument
  // of a privileged command: the same shape check decides whether it is used.
  if (!USB_INSTANCE_ID.test(parent)) {
    throw new Error("Windows named a parent that is not a USB device.");
  }

  const restart = await run(restartScript(parent), RESTART_TIMEOUT_MS);
  if (restart.code !== 0) {
    throw new Error(`Windows refused the restart${detailOf(restart)}.`);
  }
}
