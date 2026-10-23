import type { Sample, SampleEntry } from "@yunari/renderer-core";
import { describeSemanticKey, semanticId } from "@yunari/renderer-core";
import type { DeviceAssignment } from "./lhm-mapping.js";
import {
  type BlockDeviceLike,
  type DriveLayoutLike as DiskLayoutLike,
  type DriveDevice,
  driveFor,
  drivesFrom,
  nameFor,
  volumesOf,
} from "./library-devices.js";
import type {
  ProviderHealth,
  SensorDescriptor,
  SensorProvider,
} from "./provider.js";
import { descriptorFieldsOf, redactForBrowser } from "./provider.js";

/**
 * Hardware metrics come from `systeminformation` rather than a collector Yunari
 * maintains (§97). The library owns the platform-specific reads; this provider
 * only maps its answers onto the semantic vocabulary and reports honestly when
 * the platform will not say.
 *
 * One device answers a group, and this provider names that same device: the
 * assigned one, or the one the machine reports. Every GPU, VRAM and disk figure
 * and every caption comes out of one selection, so a name can never sit over
 * another device's readings. See `docs/decisions/0004`.
 */

/** Identity text, not measurements: read on demand, never per sample. */
const CPU_NAME_KEYS = ["cpu.manufacturer", "cpu.brand", "cpu.model"];

export const LIBRARY_PROVIDER_ID = "library";

const BYTES_PER_GB = 1024 ** 3;
const MEGABIT_PER_BYTE_PER_SECOND = 8 / 1_000_000;

/** The vocabulary slice this provider can answer on a typical machine. */
const LIBRARY_KEYS = [
  "cpu.load",
  "cpu.clock",
  "cpu.manufacturer",
  "cpu.brand",
  "cpu.model",
  "ram.used",
  "ram.used.percent",
  "ram.total",
  "gpu.load",
  "gpu.temp",
  "gpu.power",
  "gpu.name",
  "vram.used",
  "vram.total",
  "vram.used.percent",
  "disk.used",
  "disk.used.percent",
  "disk.total",
  "disk.name",
  "disk.data.used",
  "disk.data.used.percent",
  "disk.data.total",
  "network.download",
  "network.upload",
] as const;

export const LIBRARY_DESCRIPTORS: readonly SensorDescriptor[] =
  LIBRARY_KEYS.map((key) => {
    const declared = describeSemanticKey(key);

    if (declared === undefined) {
      throw new Error(`${key} is not in the semantic key vocabulary`);
    }

    return {
      sensorId: `${LIBRARY_PROVIDER_ID}:${key}`,
      semanticKey: key,
      label: declared.label,
      ...descriptorFieldsOf(declared),
      tier: declared.expectedTier,
    };
  });

/** One reading per key from the library, `undefined` where it cannot say. */
export interface LibraryReadings {
  readonly cpuLoad?: number;
  readonly cpuClockMhz?: number;
  readonly ramUsedGb?: number;
  readonly ramTotalGb?: number;
  readonly gpuLoad?: number;
  readonly gpuTempC?: number;
  readonly gpuPowerW?: number;
  readonly vramUsedGb?: number;
  readonly vramTotalGb?: number;
  readonly diskUsedGb?: number;
  readonly diskTotalGb?: number;
  /** The second disk slot; only set when a volume is assigned to it. */
  readonly dataDiskUsedGb?: number;
  readonly dataDiskTotalGb?: number;
  readonly download?: number;
  readonly upload?: number;
  /** What the machine calls its own hardware, as display text. */
  readonly cpuManufacturer?: string;
  readonly cpuBrand?: string;
  readonly cpuModel?: string;
  /** The selected card's name; absent when no single card was selected. */
  readonly gpuName?: string;
  /** The selected volume's name; absent when the keys describe them all. */
  readonly diskName?: string;
}

interface MemLike {
  readonly total?: number;
  readonly active?: number;
}

interface NetStatsLike {
  readonly rx_sec?: number | null;
  readonly tx_sec?: number | null;
}

/** The CPU identity fields the library reports, all three of which differ. */
export interface CpuLike {
  readonly manufacturer?: string;
  readonly brand?: string;
  readonly model?: string;
}

export interface FsSizeLike {
  readonly size?: number;
  readonly used?: number;
  /** Mount point or drive letter, used to identify the volume. */
  readonly mount?: string;
  readonly fs?: string;
}

export interface ControllerLike {
  /** GPU model name, used only to identify the device to a consumer. */
  readonly model?: string | null;
  readonly utilizationGpu?: number | null;
  readonly temperatureGpu?: number | null;
  readonly powerDraw?: number | null;
  readonly memoryUsed?: number | null;
  readonly memoryTotal?: number | null;
  readonly vram?: number | null;
}

/** Keeps only finite numbers; a library `null` means "cannot read". */
function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function bytesToGb(value: unknown): number | undefined {
  const bytes = finite(value);
  return bytes === undefined ? undefined : bytes / BYTES_PER_GB;
}

/** Sums disk capacity across mounted filesystems, ignoring pseudo-mounts. */
function diskTotals(
  filesystems: readonly FsSizeLike[],
): { usedGb: number; totalGb: number } | undefined {
  let used = 0;
  let total = 0;
  let found = false;

  for (const fs of filesystems) {
    const size = finite(fs.size);
    const usedBytes = finite(fs.used);

    if (size === undefined || usedBytes === undefined || size <= 0) {
      continue;
    }

    total += size;
    used += usedBytes;
    found = true;
  }

  return found
    ? { usedGb: used / BYTES_PER_GB, totalGb: total / BYTES_PER_GB }
    : undefined;
}

/** The device a controller is, and the name a consumer would recognise it by. */
interface GpuSelection {
  readonly controller: ControllerLike;
  /**
   * Absent when the machine reports the card but does not name it. One field
   * rather than two, because both come from the same reported model and a
   * caption must not be resolvable without the id that names it.
   */
  readonly identity?: { readonly deviceId: string; readonly name: string };
}

/**
 * The one card a theme's unsuffixed `gpu.*`/`vram.*` keys describe.
 *
 * Every figure comes from this single controller, so a caption naming it is
 * never a caption over another card's temperature — the reason a maximum is
 * wrong here where it is not wrong for a network total.
 *
 * A card the machine does not name still answers when it is the only one: its
 * figures are real, and dropping them would be a worse lie than a missing
 * caption. Only the name is absent, and `pushText` reports that as a gap.
 *
 * With no assignment, the first card the machine can name answers, so a machine
 * whose first controller reports no model still gets a caption from the one
 * after it. That is a choice the consumer can change on the settings page, and
 * it is stable frame to frame, which a "busiest" default would not be: the
 * caption would change text every sample as load moved between cards.
 */
function selectGpu(
  controllers: readonly ControllerLike[],
  assigned: string | undefined,
): GpuSelection | undefined {
  const byModel = (controller: ControllerLike): string | undefined =>
    typeof controller.model === "string" && controller.model.length > 0
      ? semanticId(controller.model)
      : undefined;

  // An assigned card must be matchable, so only named cards can satisfy one.
  const chosen =
    assigned === undefined
      ? (controllers.find((controller) => byModel(controller) !== undefined) ??
        controllers[0])
      : controllers.find((controller) => byModel(controller) === assigned);

  if (chosen === undefined) {
    return undefined;
  }

  const deviceId = byModel(chosen);

  return {
    controller: chosen,
    ...(deviceId === undefined || typeof chosen.model !== "string"
      ? {}
      : { identity: { deviceId, name: chosen.model } }),
  };
}

/** Sums per-interface throughput: total host traffic, not one link's. */
function throughput(stats: readonly NetStatsLike[]):
  | {
      download: number;
      upload: number;
    }
  | undefined {
  let rx = 0;
  let tx = 0;
  let found = false;

  for (const stat of stats) {
    const down = finite(stat.rx_sec);
    const up = finite(stat.tx_sec);

    if (down === undefined && up === undefined) {
      continue;
    }

    rx += down ?? 0;
    tx += up ?? 0;
    found = true;
  }

  return found
    ? {
        download: rx * MEGABIT_PER_BYTE_PER_SECOND,
        upload: tx * MEGABIT_PER_BYTE_PER_SECOND,
      }
    : undefined;
}

/** Turns the library's raw answers into vocabulary readings. */
export function readingsFromLibrary(input: {
  readonly load?: { readonly currentLoad?: number } | undefined;
  readonly speed?: { readonly avg?: number } | undefined;
  readonly mem?: MemLike | undefined;
  readonly filesystems?: readonly FsSizeLike[] | undefined;
  readonly network?: readonly NetStatsLike[] | undefined;
  /** The one card answering the GPU keys; absent when none is reported. */
  readonly gpu?: GpuSelection | undefined;
}): LibraryReadings {
  const mem = input.mem;
  const totalGb = bytesToGb(mem?.total);
  // `active` is what the user means by "used"; `used` counts caches.
  const usedGb = bytesToGb(mem?.active);
  const disks =
    input.filesystems === undefined ? undefined : diskTotals(input.filesystems);
  const net =
    input.network === undefined ? undefined : throughput(input.network);
  const card = input.gpu?.controller;
  // The library reports VRAM in MB; the vocabulary declares GB.
  const vramTotalMb = finite(card?.vram ?? card?.memoryTotal ?? undefined);
  const vramUsedMb = finite(card?.memoryUsed);

  return {
    ...(finite(input.load?.currentLoad) === undefined
      ? {}
      : { cpuLoad: finite(input.load?.currentLoad)! }),
    ...(finite(input.speed?.avg) === undefined
      ? {}
      : { cpuClockMhz: finite(input.speed?.avg)! * 1000 }),
    ...(usedGb === undefined ? {} : { ramUsedGb: usedGb }),
    ...(totalGb === undefined ? {} : { ramTotalGb: totalGb }),
    ...(finite(card?.utilizationGpu) === undefined
      ? {}
      : { gpuLoad: finite(card?.utilizationGpu)! }),
    ...(finite(card?.temperatureGpu) === undefined
      ? {}
      : { gpuTempC: finite(card?.temperatureGpu)! }),
    ...(finite(card?.powerDraw) === undefined
      ? {}
      : { gpuPowerW: finite(card?.powerDraw)! }),
    ...(vramUsedMb === undefined ? {} : { vramUsedGb: vramUsedMb / 1024 }),
    ...(vramTotalMb === undefined ? {} : { vramTotalGb: vramTotalMb / 1024 }),
    ...(disks === undefined
      ? {}
      : { diskUsedGb: disks.usedGb, diskTotalGb: disks.totalGb }),
    ...(net === undefined
      ? {}
      : { download: net.download, upload: net.upload }),
  };
}

/** Values that answer a semantic key, in the unit the vocabulary declares. */
export function samplesFromLibrary(
  readings: LibraryReadings,
  semanticKeys: readonly string[],
  nowMs: number,
): readonly SampleEntry[] {
  const timestamp = new Date(nowMs).toISOString();
  const entries: SampleEntry[] = [];

  const push = (semanticKey: string, value: number | undefined): void => {
    if (!semanticKeys.includes(semanticKey)) {
      return;
    }

    const sensorId = `${LIBRARY_PROVIDER_ID}:${semanticKey}`;
    const declared = describeSemanticKey(semanticKey);

    if (value === undefined) {
      entries.push({
        semanticKey,
        sample: {
          sensorId,
          timestamp,
          status: "missing",
          message: "this machine reports no reading for that sensor",
        },
      });
      return;
    }

    const sample: Sample = {
      sensorId,
      timestamp,
      status: "ok",
      value,
      ...(declared?.unit === undefined ? {} : { unit: declared.unit }),
    };
    entries.push({ semanticKey, sample });
  };

  /**
   * A name is a reading like any other: omitted when there is none, and never
   * a placeholder, or a display would show invented text with no gap and no
   * reason.
   *
   * The reason is per key, because the two gaps call for different things: a
   * CPU the library could not read is a hardware question, while an unnamed
   * volume usually means no drive is assigned — and that is answered on the
   * settings page, not by replacing a hard drive.
   */
  const pushText = (
    semanticKey: string,
    text: string | undefined,
    gap: string,
  ): void => {
    if (!semanticKeys.includes(semanticKey)) {
      return;
    }

    const sensorId = `${LIBRARY_PROVIDER_ID}:${semanticKey}`;
    const trimmed = text?.trim();

    if (trimmed === undefined || trimmed.length === 0) {
      entries.push({
        semanticKey,
        sample: { sensorId, timestamp, status: "missing", message: gap },
      });
      return;
    }

    entries.push({
      semanticKey,
      sample: { sensorId, timestamp, status: "ok", textValue: trimmed },
    });
  };

  const ramPercent =
    readings.ramUsedGb !== undefined &&
    readings.ramTotalGb !== undefined &&
    readings.ramTotalGb > 0
      ? (readings.ramUsedGb / readings.ramTotalGb) * 100
      : undefined;
  const vramPercent =
    readings.vramUsedGb !== undefined &&
    readings.vramTotalGb !== undefined &&
    readings.vramTotalGb > 0
      ? (readings.vramUsedGb / readings.vramTotalGb) * 100
      : undefined;
  const diskPercent =
    readings.diskUsedGb !== undefined &&
    readings.diskTotalGb !== undefined &&
    readings.diskTotalGb > 0
      ? (readings.diskUsedGb / readings.diskTotalGb) * 100
      : undefined;

  push("cpu.load", readings.cpuLoad);
  push("cpu.clock", readings.cpuClockMhz);
  push("ram.used", readings.ramUsedGb);
  push("ram.used.percent", ramPercent);
  push("ram.total", readings.ramTotalGb);
  push("gpu.load", readings.gpuLoad);
  push("gpu.temp", readings.gpuTempC);
  push("gpu.power", readings.gpuPowerW);
  push("vram.used", readings.vramUsedGb);
  push("vram.used.percent", vramPercent);
  push("vram.total", readings.vramTotalGb);
  push("disk.used", readings.diskUsedGb);
  push("disk.used.percent", diskPercent);
  push("disk.total", readings.diskTotalGb);
  push("disk.data.used", readings.dataDiskUsedGb);
  push("disk.data.total", readings.dataDiskTotalGb);
  // Derived from the slot's own two figures, so all three agree.
  push(
    "disk.data.used.percent",
    readings.dataDiskUsedGb !== undefined &&
      readings.dataDiskTotalGb !== undefined &&
      readings.dataDiskTotalGb > 0
      ? (readings.dataDiskUsedGb / readings.dataDiskTotalGb) * 100
      : undefined,
  );
  push("network.download", readings.download);
  push("network.upload", readings.upload);
  const cpuGap = "this machine reports no CPU identity for that key";
  pushText("cpu.manufacturer", readings.cpuManufacturer, cpuGap);
  pushText("cpu.brand", readings.cpuBrand, cpuGap);
  pushText("cpu.model", readings.cpuModel, cpuGap);
  pushText(
    "gpu.name",
    readings.gpuName,
    "this machine reports no name for that graphics card",
  );
  pushText(
    "disk.name",
    readings.diskName,
    // Two causes, one message: unassigned, the keys measure every volume and
    // no one drive's name describes that sum; assigned but absent, they measure
    // nothing. Neither is a name.
    "no drive is assigned, so these keys describe every volume at once; " +
      "choose one on the settings page",
  );

  return entries;
}

/** One volume's own figures, or undefined when it reports no capacity. */
function volumeTotals(
  volumes: readonly FsSizeLike[],
): { readonly usedGb: number; readonly totalGb: number } | undefined {
  let used = 0;
  let total = 0;

  for (const volume of volumes) {
    const size = finite(volume.size);
    const usedBytes = finite(volume.used);

    if (size === undefined || usedBytes === undefined || size <= 0) {
      continue;
    }

    total += size;
    used += usedBytes;
  }

  return total > 0
    ? { usedGb: used / BYTES_PER_GB, totalGb: total / BYTES_PER_GB }
    : undefined;
}

/** The CPU identity strings, trimmed; a blank field is a gap, not a name. */
function cpuNames(cpu: CpuLike | undefined): {
  readonly cpuManufacturer?: string;
  readonly cpuBrand?: string;
  readonly cpuModel?: string;
} {
  const text = (value: string | undefined): string | undefined => {
    const trimmed = value?.trim();
    return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
  };
  const manufacturer = text(cpu?.manufacturer);
  const brand = text(cpu?.brand);
  const model = text(cpu?.model);

  return {
    ...(manufacturer === undefined ? {} : { cpuManufacturer: manufacturer }),
    ...(brand === undefined ? {} : { cpuBrand: brand }),
    ...(model === undefined ? {} : { cpuModel: model }),
  };
}

export type LibraryModule = {
  currentLoad(): Promise<{ currentLoad?: number }>;
  cpuCurrentSpeed(): Promise<{ avg?: number }>;
  cpu(): Promise<CpuLike>;
  mem(): Promise<MemLike>;
  fsSize(): Promise<readonly FsSizeLike[]>;
  networkStats(): Promise<readonly NetStatsLike[]>;
  graphics(): Promise<{ controllers?: readonly ControllerLike[] }>;
  diskLayout(): Promise<readonly DiskLayoutLike[]>;
  blockDevices(): Promise<readonly BlockDeviceLike[]>;
};

export class LibrarySensorProvider implements SensorProvider {
  readonly id = LIBRARY_PROVIDER_ID;
  readonly label = "System information (baseline)";

  private failure: string | undefined;
  /**
   * `diskLayout` and `blockDevices` cost seconds and cannot change while the
   * host runs, so the model→volume join is built once and reused. Cleared when
   * the settings page opens and when a read fails, so a transient failure costs
   * one retry rather than the rest of the session.
   * `ponytail:` a drive plugged in mid-session is not seen until one of those;
   * add a miss-triggers-rebuild check when that shows up as a real defect.
   */
  private drives: Promise<readonly DriveDevice[]> | undefined;
  /** Read once like the drive index, but *not* refreshed by `describeDevices`:
   * a CPU's identity cannot change while the host runs. */
  private cpu: Promise<CpuLike> | undefined;

  constructor(private readonly library?: LibraryModule) {}

  /**
   * The GPUs and drives this machine reports, so a consumer can choose which
   * one a theme describes. A drive is named by its model, the same identifier
   * the LHM provider slugs, so a choice made with either provider reaches the
   * same drive.
   */
  async describeDevices(): Promise<{
    readonly gpus: readonly { readonly id: string; readonly name: string }[];
    readonly disks: readonly { readonly id: string; readonly name: string }[];
  }> {
    try {
      const library = await this.module();
      const [graphics, drives] = await Promise.all([
        library.graphics(),
        this.driveIndex(library),
      ]);

      this.drives = undefined;
      const gpus = (graphics.controllers ?? [])
        .map((controller) => controller.model)
        .filter(
          (model): model is string =>
            typeof model === "string" && model.length > 0,
        )
        .map((model) => ({ id: semanticId(model), name: model }));

      return {
        gpus,
        disks: drives.map((drive) => ({
          id: drive.deviceId,
          name: drive.name,
        })),
      };
    } catch {
      return { gpus: [], disks: [] };
    }
  }

  /**
   * The model→volume join, read once and reused across samples.
   *
   * A rejected read is never cached: one transient failure would otherwise
   * poison the field for the life of the host and turn every later sample into
   * a gap. Clearing on the way out costs one retry, and a volume is a gap until
   * it resolves rather than a wrong name.
   */
  private async driveIndex(
    library: LibraryModule,
  ): Promise<readonly DriveDevice[]> {
    this.drives ??= Promise.all([
      library.diskLayout(),
      library.blockDevices(),
    ]).then(([layout, blockDevices]) => drivesFrom(layout, blockDevices));

    try {
      return await this.drives;
    } catch (error) {
      this.drives = undefined;
      throw error;
    }
  }

  /**
   * The CPU's identity strings, read once like the drive index: `si.cpu()`
   * costs ~1.5 s against a 1 s poll, and a CPU's manufacturer, brand and model
   * cannot change while the host runs.
   */
  private cpuIdentity(library: LibraryModule): Promise<CpuLike> {
    this.cpu ??= library.cpu().catch((error: unknown) => {
      this.cpu = undefined;
      throw error;
    });

    return this.cpu;
  }

  /** Loaded lazily so a host that never needs metrics does not pay for it. */
  private async module(): Promise<LibraryModule> {
    if (this.library !== undefined) {
      return this.library;
    }

    const imported = await import("systeminformation");
    return (imported.default ?? imported) as unknown as LibraryModule;
  }

  async describe(): Promise<readonly SensorDescriptor[]> {
    return LIBRARY_DESCRIPTORS;
  }

  async sample(
    semanticKeys: readonly string[],
    nowMs: number,
    assignment: DeviceAssignment = {},
  ): Promise<readonly SampleEntry[]> {
    const owned = semanticKeys.filter((key) =>
      (LIBRARY_KEYS as readonly string[]).includes(key),
    );

    if (owned.length === 0) {
      return [];
    }

    try {
      const library = await this.module();
      const [load, speed, mem, filesystems, network, graphics] =
        await Promise.all([
          library.currentLoad(),
          library.cpuCurrentSpeed(),
          library.mem(),
          library.fsSize(),
          library.networkStats(),
          library.graphics(),
        ]);

      this.failure = undefined;

      // The assignment this sample was given, read once here: one selection
      // answers the figures and the caption, and the two expensive discovery
      // reads that follow are cached, so this is the first sample that pays and
      // not every one.
      const { gpu, systemDisk, dataDisk, names } = assignment;
      // Neither is read for a theme that binds nothing needing it. Both disk
      // slots need the model→volume join, not just the unsuffixed keys:
      // `disk.data.*` answers a drive too.
      const wantsCpuNames = owned.some((key) => CPU_NAME_KEYS.includes(key));
      const wantsVolumes = owned.some((key) => key.startsWith("disk."));
      // Each is contained: a machine whose CPU cannot be read still answers
      // every other key it owns, and a volume is a gap rather than a name that
      // could belong to another drive.
      const [cpu, drives] = await Promise.all([
        wantsCpuNames
          ? this.cpuIdentity(library).catch(() => undefined)
          : undefined,
        wantsVolumes
          ? this.driveIndex(library).catch(() => undefined)
          : undefined,
      ]);

      const card = selectGpu(graphics.controllers ?? [], gpu);
      const systemDrive =
        systemDisk === undefined
          ? undefined
          : driveFor(drives ?? [], systemDisk);
      const dataDrive =
        dataDisk === undefined ? undefined : driveFor(drives ?? [], dataDisk);
      // An assigned drive this PC does not have answers nothing: falling back
      // to every volume would be a different device's figures under the name
      // the consumer chose for the one they removed.
      const systemVolumes =
        systemDisk === undefined
          ? filesystems
          : systemDrive === undefined
            ? []
            : volumesOf(filesystems, systemDrive);
      const dataVolumes =
        dataDrive === undefined ? [] : volumesOf(filesystems, dataDrive);
      const slot = volumeTotals(dataVolumes);

      const readings = readingsFromLibrary({
        load,
        speed,
        mem,
        // The unsuffixed keys describe the assigned drive alone, and every
        // volume at once otherwise — which is why the caption is then a gap.
        filesystems: systemVolumes,
        network,
        gpu: card,
      });

      return samplesFromLibrary(
        {
          ...readings,
          ...cpuNames(cpu),
          ...(card?.identity === undefined
            ? {}
            : {
                gpuName: nameFor(
                  names,
                  card.identity.deviceId,
                  card.identity.name,
                ),
              }),
          ...(systemDrive === undefined || systemDisk === undefined
            ? {}
            : {
                diskName: nameFor(
                  names,
                  systemDrive.deviceId,
                  systemDrive.name,
                ),
              }),
          ...(slot === undefined
            ? {}
            : { dataDiskUsedGb: slot.usedGb, dataDiskTotalGb: slot.totalGb }),
        },
        owned,
        nowMs,
      );
    } catch (error) {
      // `systeminformation` shells out, so its errors quote the command and
      // the machine's own paths. This message reaches every display on the
      // network, so the string is cleaned where it is composed rather than on
      // arrival — the contract at `ProviderHealth` says these are redacted.
      this.failure = redactForBrowser(
        error instanceof Error ? error.message : String(error),
      );
      const timestamp = new Date(nowMs).toISOString();

      return owned.map((semanticKey) => ({
        semanticKey,
        sample: {
          sensorId: `${LIBRARY_PROVIDER_ID}:${semanticKey}`,
          timestamp,
          status: "missing" as const,
          message: `system information is unavailable: ${this.failure}`,
        },
      }));
    }
  }

  health(): ProviderHealth {
    return this.failure === undefined
      ? { available: true }
      : { available: false, message: this.failure };
  }
}
