import {
  type HelperHandle,
  type KillTree,
  type SpawnProcess,
  startJsonLineHelper,
} from "./supervisor.js";

/**
 * One Windows location fix, asked for only when no manual place is set.
 *
 * The WinRT `Geolocator` is reached through PowerShell because no Node API
 * covers it and a native addon would need a build toolchain this host does not
 * ship. The script is an embedded constant: nothing user-supplied can reach
 * it, and there is no loose `.ps1` to resolve or edit.
 */

export interface GeoPosition {
  readonly latitude: number;
  readonly longitude: number;
}

export const LOCATION_DENIED_REASON = "Windows location was denied";
export const LOCATION_TIMEOUT_REASON =
  "Windows location did not answer in time";
export const LOCATION_UNAVAILABLE_REASON =
  "PowerShell was not found, so Windows location is unavailable.";
/** The script ran but Windows refused or could not produce a fix. */
export const LOCATION_SCRIPT_FAILED_REASON =
  "Windows location is unavailable on this PC.";
const LOCATION_FAILED_REASON = "Windows location could not be read.";

/** Windows may show a permission prompt, so this has to outlast a person. */
const LOCATION_TIMEOUT_MS = 30_000;

export const LOCATION_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
try {
  [void][Windows.Devices.Geolocation.Geolocator,Windows.Devices.Geolocation,ContentType=WindowsRuntime]
  $accessOperation = [Windows.Devices.Geolocation.Geolocator]::RequestAccessAsync()
  $access = [System.WindowsRuntimeSystemExtensions]::AsTask($accessOperation).GetAwaiter().GetResult()
  if ($access.ToString() -ne 'Allowed') {
    [Console]::Out.WriteLine('{"error":"denied"}')
    exit 0
  }
  $locator = [Windows.Devices.Geolocation.Geolocator]::new()
  $positionOperation = $locator.GetGeopositionAsync()
  $fix = [System.WindowsRuntimeSystemExtensions]::AsTask($positionOperation).GetAwaiter().GetResult()
  $point = $fix.Coordinate.Point.Position
  $json = ConvertTo-Json -Compress -InputObject ([ordered]@{
    latitude = $point.Latitude
    longitude = $point.Longitude
  })
  [Console]::Out.WriteLine($json)
} catch {
  [Console]::Out.WriteLine('{"error":"unavailable"}')
}
`;

export type LocationLine =
  | {
      readonly kind: "position";
      readonly latitude: number;
      readonly longitude: number;
    }
  | { readonly kind: "error"; readonly code: "denied" | "unavailable" };

/** One line from the helper; malformed JSON is not a position and not a place. */
export function parseLocationLine(line: string): LocationLine | undefined {
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

  if (record["error"] === "denied") return { kind: "error", code: "denied" };
  if (record["error"] === "unavailable") {
    return { kind: "error", code: "unavailable" };
  }

  const latitude = record["latitude"];
  const longitude = record["longitude"];

  if (
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90
  ) {
    return undefined;
  }

  if (
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return undefined;
  }

  return { kind: "position", latitude, longitude };
}

export interface LocationOptions {
  readonly onPosition: (position: GeoPosition) => void;
  readonly onError: (reason: string) => void;
  readonly spawnProcess?: SpawnProcess;
  readonly killTree?: KillTree;
  readonly pathExists?: (file: string) => boolean;
  readonly timeoutMs?: number;
}

/**
 * Starts one location read. Exactly one of `onPosition` or `onError` fires,
 * and a denial or timeout is a reason rather than silence; neither is ever
 * turned into a guessed place.
 */
export function readLocation(options: LocationOptions): HelperHandle {
  let handle: HelperHandle | undefined;
  let settled = false;
  let stopRequested = false;

  const stop = (): void => {
    if (handle === undefined) {
      stopRequested = true;
      return;
    }
    handle.stop();
  };

  const fail = (reason: string): void => {
    if (settled) return;
    settled = true;
    stop();
    options.onError(reason);
  };

  handle = startJsonLineHelper({
    id: "location",
    script: LOCATION_SCRIPT,
    timeoutMs: options.timeoutMs ?? LOCATION_TIMEOUT_MS,
    ...(options.spawnProcess === undefined
      ? {}
      : { spawnProcess: options.spawnProcess }),
    ...(options.killTree === undefined ? {} : { killTree: options.killTree }),
    ...(options.pathExists === undefined
      ? {}
      : { pathExists: options.pathExists }),
    onLine: (line) => {
      const parsed = parseLocationLine(line);
      if (parsed === undefined || settled) return;

      settled = true;
      stop();

      if (parsed.kind === "position") {
        options.onPosition({
          latitude: parsed.latitude,
          longitude: parsed.longitude,
        });
      } else {
        options.onError(
          parsed.code === "denied"
            ? LOCATION_DENIED_REASON
            : LOCATION_SCRIPT_FAILED_REASON,
        );
      }
    },
    onExit: (_reason, kind) => {
      // A caller that stops the helper early is not a location failure.
      if (kind === "stopped") return;
      if (kind === "timed out") {
        fail(LOCATION_TIMEOUT_REASON);
      } else if (kind === "unavailable") {
        fail(LOCATION_UNAVAILABLE_REASON);
      } else {
        fail(LOCATION_FAILED_REASON);
      }
    },
    onProblem: () => fail(LOCATION_FAILED_REASON),
  });

  // The helper may have reported before it returned (missing PowerShell, or a
  // fake stream that answers synchronously), so the stop lands here.
  if (stopRequested) handle.stop();

  return handle;
}

/** A promise around one read, for a provider's poll. */
export function requestWindowsPosition(
  options: Omit<LocationOptions, "onPosition" | "onError"> = {},
): Promise<GeoPosition> {
  return new Promise((resolve, reject) => {
    readLocation({
      ...options,
      onPosition: resolve,
      onError: (reason) => reject(new Error(reason)),
    });
  });
}
