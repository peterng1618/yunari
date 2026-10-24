import { semanticId } from "@yunari/renderer-core";
import { displayNameFor } from "../settings/devices.js";

/**
 * Which physical drive a volume lives on, and what the machine calls it.
 *
 * The library reports a volume's mount and capacity in one list, and a drive's
 * model in another, with no field in common: `fsSize()` knows `C:`, `diskLayout()`
 * knows `\\.\PHYSICALDRIVE1` and the model. Only `blockDevices()` carries both,
 * so resolving a drive model back to a volume is a three-way join. That is why
 * the volume is identified by its model — it is the one name both providers
 * agree on, so a consumer's choice reaches the same drive whichever provider
 * they chose it with.
 *
 * `serialNum` is deliberately absent from these shapes: a serial identifies an
 * instance on this PC, and a theme must not carry one.
 */

export interface VolumeLike {
  /**
   * Drive letter or mount point, e.g. `C:` or `/` — the one name `fsSize`
   * and `blockDevices` agree on, so it is what the join compares. `fsSize`'s
   * `fs` is the device path (`/dev/sda1`), which no other provider spells the
   * same way, so it identifies nothing here.
   */
  readonly mount?: string;
  readonly size?: number;
  readonly used?: number;
}

export interface DriveLayoutLike {
  readonly name?: string;
  readonly device?: string;
}

export interface BlockDeviceLike {
  readonly mount?: string;
  readonly device?: string;
  /** The filesystem label ("Data"); not the drive's identity. */
  readonly label?: string;
}

/** A drive, and the volumes a consumer can reach it through. */
export interface DriveDevice {
  readonly deviceId: string;
  readonly name: string;
  /** Its volumes' mount points as `mountKey` spells them. */
  readonly mounts: readonly string[];
}

function named(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * The one form a mount point is compared in, on both sides of the join.
 *
 * A trailing slash is not a different mount, but the root is: stripping `/`
 * leaves `""`, and no root volume then belongs to any drive. Not
 * `path.normalize` — these are provider-supplied mount strings, not paths
 * being opened, and it would resolve `.` and `..` into mounts that do not
 * exist.
 */
function mountKey(mount: string): string {
  const stripped = mount.replace(/\/+$/, "");
  return stripped === "" ? mount : stripped;
}

/**
 * The drives this machine reports, each with the volumes it holds.
 *
 * A drive with several partitions appears once with several mounts, so a
 * consumer chooses a *drive* and every partition of it answers.
 */
export function drivesFrom(
  layout: readonly DriveLayoutLike[],
  volumes: readonly BlockDeviceLike[],
): readonly DriveDevice[] {
  const mountsOf = new Map<string, string[]>();

  for (const volume of volumes) {
    if (!named(volume.device) || !named(volume.mount)) {
      continue;
    }

    const key = mountKey(volume.mount);
    const existing = mountsOf.get(volume.device);
    if (existing === undefined) {
      mountsOf.set(volume.device, [key]);
    } else if (!existing.includes(key)) {
      existing.push(key);
    }
  }

  const seen = new Set<string>();
  const drives: DriveDevice[] = [];

  for (const entry of layout) {
    if (!named(entry.name) || !named(entry.device)) {
      continue;
    }

    const deviceId = semanticId(entry.name);
    if (seen.has(deviceId)) {
      continue;
    }

    seen.add(deviceId);
    drives.push({
      deviceId,
      name: entry.name,
      mounts: mountsOf.get(entry.device) ?? [],
    });
  }

  return drives;
}

/** The drive a device id names, or undefined when this PC does not have it. */
export function driveFor(
  drives: readonly DriveDevice[],
  deviceId: string,
): DriveDevice | undefined {
  return drives.find((drive) => drive.deviceId === deviceId);
}

/** The volumes of one drive, in the order the machine lists them. */
export function volumesOf(
  filesystems: readonly VolumeLike[],
  drive: DriveDevice,
): readonly VolumeLike[] {
  return filesystems.filter(
    (entry) =>
      named(entry.mount) && drive.mounts.includes(mountKey(entry.mount)),
  );
}

/** What the display calls a device: the consumer's choice, else its model. */
export function nameFor(
  names: Readonly<Record<string, string>> | undefined,
  deviceId: string,
  detectedName: string,
): string {
  return displayNameFor(names ?? {}, deviceId, detectedName);
}
