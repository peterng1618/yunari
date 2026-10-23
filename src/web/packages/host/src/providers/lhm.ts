import type { Sample, SampleEntry } from "@yunari/renderer-core";
import {
  describeSemanticKey,
  diskDeviceOf,
  semanticId,
} from "@yunari/renderer-core";
import { displayNameFor } from "../settings/devices.js";
import {
  type DeviceAssignment,
  diskDeviceReadings,
  gpuDeviceReadings,
  lhmDeviceName,
  matchLhmSensorsAssigned,
} from "./lhm-mapping.js";
import { flattenLhmSensors } from "./lhm-tree.js";
import type {
  ProviderHealth,
  SensorDescriptor,
  SensorProvider,
} from "./provider.js";
import { descriptorFieldsOf, redactForBrowser } from "./provider.js";

/**
 * LibreHardwareMonitor as an optional external program (§97): Yunari reads the
 * JSON its built-in web server publishes and never links or compiles its .NET
 * library. When LHM is absent or its server is off, `sample` reports `missing`
 * with a reason so the registry can fall back, and `health()` says unavailable.
 */

export const LHM_PROVIDER_ID = "lhm";

/** LHM's web server default; `--lhm-url` overrides it. */
export const DEFAULT_LHM_URL = "http://127.0.0.1:8085";

/** Bounded so a hung LHM cannot stall the host's poll cycle. */
const LHM_TIMEOUT_MS = 2_000;

/** Every key this provider can answer, whether or not a machine has the sensor. */
const LHM_KEYS = [
  // The second disk slot; which drive answers it is a device assignment.
  "disk.data.used",
  "disk.data.used.percent",
  "disk.data.total",
  "cpu.temp",
  "cpu.power",
  "cpu.clock",
  "cpu.fan",
  "gpu.load",
  "gpu.temp",
  "gpu.power",
  "gpu.clock",
  "gpu.fan",
  "gpu.name",
  "vram.used",
  "vram.used.percent",
  "vram.total",
  "disk.used",
  "disk.used.percent",
  "disk.total",
  "disk.name",
  "network.download",
  "network.upload",
] as const;

export const LHM_DESCRIPTORS: readonly SensorDescriptor[] = LHM_KEYS.map(
  (key) => {
    const declared = describeSemanticKey(key);

    if (declared === undefined) {
      throw new Error(`${key} is not in the semantic key vocabulary`);
    }

    return {
      sensorId: `${LHM_PROVIDER_ID}:${key}`,
      semanticKey: key,
      label: declared.label,
      ...descriptorFieldsOf(declared),
      tier: "extended" as const,
    };
  },
);

type Fetcher = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}>;

interface LhmProviderOptions {
  readonly baseUrl?: string;
  readonly fetcher?: Fetcher;
  readonly timeoutMs?: number;
}

/** Wraps the platform fetch with a bounded signal so a stalled LHM cannot hang. */
function boundedFetcher(timeoutMs: number): Fetcher {
  return async (url, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
}

function missing(sensorId: string, timestamp: string, message: string): Sample {
  return { sensorId, timestamp, status: "missing", message };
}

export class LhmSensorProvider implements SensorProvider {
  readonly id = LHM_PROVIDER_ID;
  readonly label = "LibreHardwareMonitor (extended)";

  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private failure: string | undefined;

  constructor(options: LhmProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_LHM_URL).replace(/\/$/, "");
    this.fetcher =
      options.fetcher ?? boundedFetcher(options.timeoutMs ?? LHM_TIMEOUT_MS);
  }

  async describe(): Promise<readonly SensorDescriptor[]> {
    return LHM_DESCRIPTORS;
  }

  /**
   * The GPUs and drives this machine reports, so a consumer can choose which
   * one a theme describes. The discovery read is the same payload sampling
   * uses; a failure yields empty lists rather than an error page.
   */
  async describeDevices(): Promise<{
    readonly gpus: readonly { readonly id: string; readonly name: string }[];
    readonly disks: readonly { readonly id: string; readonly name: string }[];
  }> {
    try {
      const response = await this.fetcher(`${this.baseUrl}/data.json`);
      if (!response.ok) {
        return { gpus: [], disks: [] };
      }

      const sensors = flattenLhmSensors(JSON.parse(await response.text()));
      return {
        gpus: gpuDeviceReadings(sensors).map((device) => ({
          id: device.deviceId,
          name: device.name,
        })),
        disks: diskDeviceReadings(sensors).map((device) => ({
          id: device.deviceId,
          name: device.name,
        })),
      };
    } catch {
      return { gpus: [], disks: [] };
    }
  }

  async sample(
    semanticKeys: readonly string[],
    nowMs: number,
    assignment: DeviceAssignment = {},
  ): Promise<readonly SampleEntry[]> {
    // Per-device keys (disk dot id dot used) are discovered at runtime, so they
    // are accepted by shape rather than by membership in the fixed list.
    const owned = semanticKeys.filter(
      (key) =>
        (LHM_KEYS as readonly string[]).includes(key) ||
        diskDeviceOf(key) !== undefined,
    );

    if (owned.length === 0) {
      return [];
    }

    const timestamp = new Date(nowMs).toISOString();

    let payload: unknown;
    try {
      const response = await this.fetcher(`${this.baseUrl}/data.json`);

      if (!response.ok) {
        throw new Error(`LHM answered ${response.status}`);
      }

      payload = JSON.parse(await response.text());
      this.failure = undefined;
    } catch (error) {
      // Absent LHM is ordinary: the registry falls back and the display sees a
      // gap with a reason, never an invented reading. The reason is redacted
      // where it is composed, because this message reaches every display on
      // the network and the transport address is the host's, not the reader's.
      this.failure = redactForBrowser(
        error instanceof Error ? error.message : String(error),
      );
      return owned.map((semanticKey) => ({
        semanticKey,
        sample: missing(
          `${LHM_PROVIDER_ID}:${semanticKey}`,
          timestamp,
          `LibreHardwareMonitor is not reachable at its configured address: ${this.failure}`,
        ),
      }));
    }

    const sensors = flattenLhmSensors(payload);
    // The assignment this sample was given, which scopes the figures and the
    // captions below to one display's devices.
    const matched = new Map(
      matchLhmSensorsAssigned(sensors, owned, assignment).map((match) => [
        match.semanticKey,
        match.value,
      ]),
    );

    // Per-device disk keys, keyed by the slug of the drive's own name.
    for (const device of diskDeviceReadings(sensors)) {
      matched.set(`disk.${device.deviceId}.used`, device.usedGb);
      matched.set(`disk.${device.deviceId}.total`, device.totalGb);
      matched.set(`disk.${device.deviceId}.used.percent`, device.usedPercent);
    }

    // Captions come from the same selection the figures above were scoped to,
    // so a name can never sit over another device's reading. A name the
    // consumer chose wins over the model, which is what the settings page
    // edits.
    const gpuName = lhmDeviceName(sensors, "gpu", assignment);
    const diskName = lhmDeviceName(sensors, "storage", assignment);
    const names = assignment.names ?? {};
    const named = new Map<string, string>();

    if (gpuName !== undefined) {
      named.set(
        "gpu.name",
        displayNameFor(names, semanticId(gpuName), gpuName),
      );
    }

    if (diskName !== undefined) {
      named.set(
        "disk.name",
        displayNameFor(names, semanticId(diskName), diskName),
      );
    }

    return owned.map((semanticKey) => {
      const value = matched.get(semanticKey);
      const declared = describeSemanticKey(semanticKey);
      const name = named.get(semanticKey);

      if (name !== undefined) {
        return {
          semanticKey,
          sample: {
            sensorId: `${LHM_PROVIDER_ID}:${semanticKey}`,
            timestamp,
            status: "ok" as const,
            textValue: name,
          },
        };
      }

      if (value === undefined) {
        return {
          semanticKey,
          sample: missing(
            `${LHM_PROVIDER_ID}:${semanticKey}`,
            timestamp,
            diskDeviceOf(semanticKey) === undefined
              ? "this machine reports no matching LibreHardwareMonitor sensor"
              : "this machine has no drive with that id",
          ),
        };
      }

      return {
        semanticKey,
        sample: {
          sensorId: `${LHM_PROVIDER_ID}:${semanticKey}`,
          timestamp,
          status: "ok" as const,
          value,
          ...(declared?.unit === undefined ? {} : { unit: declared.unit }),
        },
      };
    });
  }

  health(): ProviderHealth {
    return this.failure === undefined
      ? { available: true }
      : { available: false, message: this.failure };
  }
}
