/**
 * The host's own monitors: what is attached to this PC, and how to put a window
 * on one.
 *
 * A local display needs no credential, but it does need an identity to point at
 * and the geometry a fullscreen browser must be told — both read from the OS
 * rather than stored, because a resolution change is not an identity change.
 */

import { type MonitorHint, reportedSerial } from "./displays.js";

/** A monitor as the settings surface needs it. */
export interface Monitor {
  readonly deviceName: string;
  readonly serial?: string;
  readonly main: boolean;
  readonly positionX: number;
  readonly positionY: number;
  readonly currentResX: number;
  readonly currentResY: number;
}

/**
 * One entry of the probe's answer, as `systeminformation` 5.33.13 really shapes
 * it: `serial` and the current geometry are nullable, and the reader's fallback
 * entry carries no `deviceName`. Every field is optional here because the
 * mapping must refuse what it cannot read, not carry an `undefined` typed as a
 * `number`.
 */
interface ProbeDisplay {
  readonly deviceName?: string | null;
  readonly serial?: string | null;
  readonly main?: boolean;
  readonly positionX?: number;
  readonly positionY?: number;
  readonly currentResX?: number | null;
  readonly currentResY?: number | null;
}

/**
 * A probe entry as a `Monitor`, or nothing when it carries too little to point a
 * display at: an unnamed screen cannot be hinted at, and one with no usable
 * geometry has nowhere to put a window.
 */
function monitorFrom(entry: ProbeDisplay): Monitor | undefined {
  const deviceName = entry.deviceName;

  if (typeof deviceName !== "string" || deviceName.length === 0) {
    return undefined;
  }

  const { positionX, positionY, currentResX, currentResY } = entry;

  if (
    typeof positionX !== "number" ||
    typeof positionY !== "number" ||
    typeof currentResX !== "number" ||
    typeof currentResY !== "number"
  ) {
    return undefined;
  }

  const serial = reportedSerial(entry.serial ?? undefined);

  return {
    deviceName,
    ...(serial === undefined ? {} : { serial }),
    main: entry.main === true,
    positionX,
    positionY,
    currentResX,
    currentResY,
  };
}

/**
 * What is attached now, from `systeminformation`'s `graphics()`.
 *
 * A probe that fails throws rather than answering `[]`: "nothing is attached"
 * and "the host could not find out" are different facts, and the route turns
 * the first into an empty list and the second into a 500. An answer with no list
 * in it is the second fact, not the first — `[]` is the empty answer and only
 * `[]` is.
 */
export async function listMonitors(): Promise<readonly Monitor[]> {
  // Loaded lazily, as this package's other `systeminformation` readers do: a
  // host that never enumerates monitors does not pay for the module.
  const imported = await import("systeminformation");
  const si = (imported.default ?? imported) as {
    graphics(): Promise<{ displays?: readonly ProbeDisplay[] }>;
  };
  const { displays } = await si.graphics();

  if (!Array.isArray(displays)) {
    throw new Error("The graphics probe answered no display list.");
  }

  const monitors: Monitor[] = [];

  for (const entry of displays) {
    const monitor = monitorFrom(entry);
    if (monitor !== undefined) monitors.push(monitor);
  }

  return monitors;
}

/**
 * The hint a record stores: the serial when the monitor reports one, because a
 * device name moves when cables do, and the device name otherwise.
 */
export function hintFor(monitor: Monitor): MonitorHint {
  const serial = reportedSerial(monitor.serial);

  return {
    ...(serial === undefined ? {} : { serial }),
    deviceName: monitor.deviceName,
  };
}

/**
 * Whether a stored hint still matches something attached. The serial is the
 * identity when both ends have one; the device name is all either end has
 * otherwise.
 */
export function isAttached(
  hint: MonitorHint,
  monitors: readonly Monitor[],
): boolean {
  const serial = reportedSerial(hint.serial);

  return monitors.some((monitor) =>
    serial === undefined
      ? monitor.deviceName === hint.deviceName
      : reportedSerial(monitor.serial) === serial,
  );
}

/**
 * The URL to open on that monitor, and where on the desktop its window goes.
 *
 * The browser, its flags and the per-display profile are the launcher's (Task
 * 1.8), which composes them with this URL and geometry rather than being handed
 * a command line it would have to parse back (R33).
 *
 * Plain `http` on loopback is deliberate, not an oversight about TLS. A loopback
 * origin is a secure context by the platform's own rule, so this display keeps
 * `wakeLock` and `serviceWorker` with no certificate to install — where the
 * https origin this host also serves would cost a
 * per-device CA root for nothing.
 */
export function launchFor(
  monitor: Monitor,
  port: number,
  displayId: string,
): {
  readonly url: string;
  readonly position: readonly [number, number];
  readonly size: readonly [number, number];
} {
  // Loopback rather than the LAN address: this display is on this PC, and
  // `127.0.0.1` is the one address a router's lease cannot move.
  const url = `http://127.0.0.1:${port}/?display=${displayId}`;

  return {
    url,
    position: [monitor.positionX, monitor.positionY],
    size: [monitor.currentResX, monitor.currentResY],
  };
}
