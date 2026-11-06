import {
  type InstalledPlugin,
  type PluginInstaller,
} from "@yunari/extension-api";
import {
  isKnownSemanticKey,
  type Sample,
  type SampleEntry,
  type SensorTier,
  UNIT_KINDS,
  type UnitKind,
  type ValueKind,
} from "@yunari/renderer-core";
import {
  type ProviderHealth,
  redactForBrowser,
  type SampleContext,
  type SensorDescriptor,
  type SensorProvider,
} from "../providers/provider.js";
import {
  createPluginSupervisor,
  type HostApiDispatcher,
  type PluginSupervisor,
} from "./runtime/supervisor.js";
import type { ExtensionService } from "./service.js";

/**
 * A plugin's sensor provider, answering through its forked worker.
 *
 * The host owns scheduling: `sample` forwards this cycle's keys and maps the
 * plugin's entries back onto them. `health` is a cache read, refreshed by the
 * last request, so a display poll never costs a second round trip.
 */

const STATUSES: ReadonlySet<string> = new Set([
  "ok",
  "missing",
  "stale",
  "error",
  "unavailable",
]);
const UNIT_KIND_SET: ReadonlySet<string> = new Set(UNIT_KINDS);
const VALUE_KINDS: ReadonlySet<string> = new Set(["number", "text", "boolean"]);
const TIERS: ReadonlySet<string> = new Set(["baseline", "extended"]);

const WAITING_MESSAGE = "Waiting for the first reading.";
const INVALID_MESSAGE = "The plugin returned an unreadable reading.";
const UNREADABLE_RESPONSE = "The plugin returned an unreadable response.";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A refreshed reason, bounded and stripped of machine addresses. */
function failureOf(error: unknown): ProviderHealth {
  return { available: false, message: redactForBrowser(reasonOf(error)) };
}

/** A plugin descriptor is accepted only when every required field is usable. */
function readDescriptor(value: unknown): SensorDescriptor | undefined {
  if (!isRecord(value)) return undefined;

  const sensorId = value["sensorId"];
  const semanticKey = value["semanticKey"];
  const label = value["label"];
  const tier = value["tier"];

  if (!nonEmpty(sensorId) || !nonEmpty(semanticKey) || !nonEmpty(label)) {
    return undefined;
  }
  if (typeof tier !== "string" || !TIERS.has(tier)) return undefined;

  const unitKind = value["unitKind"];
  if (
    unitKind !== undefined &&
    (typeof unitKind !== "string" || !UNIT_KIND_SET.has(unitKind))
  ) {
    return undefined;
  }

  const valueKind = value["valueKind"];
  const displayUnits = value["displayUnits"];

  return {
    sensorId,
    semanticKey,
    label,
    tier: tier as SensorTier,
    ...(typeof value["unit"] === "string" ? { unit: value["unit"] } : {}),
    ...(typeof value["family"] === "string" ? { family: value["family"] } : {}),
    ...(unitKind === undefined ? {} : { unitKind: unitKind as UnitKind }),
    ...(Array.isArray(displayUnits) &&
    displayUnits.every((unit) => typeof unit === "string")
      ? { displayUnits: displayUnits as string[] }
      : {}),
    ...(typeof valueKind === "string" && VALUE_KINDS.has(valueKind)
      ? { valueKind: valueKind as ValueKind }
      : {}),
    ...(value["mediaKind"] === "image" ? { mediaKind: "image" as const } : {}),
  };
}

/** A plugin sample is accepted only when its key is known and its value usable. */
function readEntry(
  value: unknown,
  nowMs: number,
  fallbackSensorId: string,
): SampleEntry | undefined {
  if (!isRecord(value)) return undefined;

  const semanticKey = value["semanticKey"];
  if (!nonEmpty(semanticKey) || !isKnownSemanticKey(semanticKey)) {
    return undefined;
  }

  const raw = value["sample"];
  if (!isRecord(raw)) return undefined;

  const status = raw["status"];
  if (typeof status !== "string" || !STATUSES.has(status)) return undefined;

  const value_ = raw["value"];
  if (
    status === "ok" &&
    !(typeof value_ === "number" && Number.isFinite(value_))
  ) {
    return undefined;
  }

  const sensorId = nonEmpty(raw["sensorId"])
    ? raw["sensorId"]
    : fallbackSensorId;
  const timestamp = nonEmpty(raw["timestamp"])
    ? raw["timestamp"]
    : new Date(nowMs).toISOString();
  const message = raw["message"];

  const sample: Sample = {
    sensorId,
    timestamp,
    status: status as Sample["status"],
    ...(typeof value_ === "number" && Number.isFinite(value_)
      ? { value: value_ }
      : {}),
    ...(typeof raw["textValue"] === "string"
      ? { textValue: raw["textValue"] }
      : {}),
    ...(typeof raw["booleanValue"] === "boolean"
      ? { booleanValue: raw["booleanValue"] }
      : {}),
    ...(typeof raw["unit"] === "string" ? { unit: raw["unit"] } : {}),
    ...(typeof message === "string"
      ? { message: redactForBrowser(message) }
      : {}),
  };

  return { semanticKey, sample };
}

export class PluginSensorProvider implements SensorProvider {
  readonly id: string;
  readonly label: string;
  /** The installed plugin whose worker answers, keyed for provider ordering. */
  readonly pluginKey: string;

  readonly #supervisor: PluginSupervisor;
  #health: ProviderHealth = { available: true };
  #descriptors: readonly SensorDescriptor[] | undefined;

  constructor(options: {
    readonly plugin: InstalledPlugin;
    readonly supervisor: PluginSupervisor;
    readonly contribution: { readonly id: string; readonly label: string };
  }) {
    this.id = options.contribution.id;
    this.label = options.contribution.label;
    this.pluginKey = options.plugin.key;
    this.#supervisor = options.supervisor;
  }

  health(): ProviderHealth {
    return this.#health;
  }

  async describe(): Promise<readonly SensorDescriptor[]> {
    let answer: unknown;

    try {
      answer = await this.#supervisor.request<unknown>("describe", {});
    } catch (error) {
      this.#health = failureOf(error);
      throw new Error(this.#health.message);
    }

    if (!Array.isArray(answer)) {
      this.#health = { available: false, message: UNREADABLE_RESPONSE };
      throw new Error(UNREADABLE_RESPONSE);
    }

    const descriptors: SensorDescriptor[] = [];
    let dropped = 0;

    for (const value of answer) {
      const descriptor = readDescriptor(value);
      if (descriptor === undefined) dropped += 1;
      else descriptors.push(descriptor);
    }

    this.#descriptors = descriptors;
    this.#health =
      dropped === 0
        ? { available: true }
        : {
            available: true,
            message: `The plugin returned ${dropped} unreadable sensor descriptor${dropped === 1 ? "" : "s"}.`,
          };

    return descriptors;
  }

  async sample(
    semanticKeys: readonly string[],
    nowMs: number,
    context?: SampleContext,
  ): Promise<readonly SampleEntry[]> {
    const owned = await this.#ownedKeys();
    const wanted = semanticKeys.filter((key) => owned.has(key));
    if (wanted.length === 0) return [];

    let answer: unknown;

    try {
      answer = await this.#supervisor.request<unknown>("sample", {
        semanticKeys: wanted,
        nowMs,
        context,
      });
    } catch (error) {
      this.#health = failureOf(error);
      throw new Error(this.#health.message);
    }

    if (!Array.isArray(answer)) {
      this.#health = { available: false, message: UNREADABLE_RESPONSE };
      throw new Error(UNREADABLE_RESPONSE);
    }

    const answered = new Map<string, SampleEntry>();
    const invalid = new Set<string>();

    for (const value of answer) {
      const entry = readEntry(value, nowMs, this.id);
      if (entry === undefined) {
        const key = isRecord(value) ? value["semanticKey"] : undefined;
        if (nonEmpty(key) && wanted.includes(key)) invalid.add(key);
        continue;
      }
      if (!wanted.includes(entry.semanticKey)) continue;
      if (!answered.has(entry.semanticKey)) {
        answered.set(entry.semanticKey, entry);
      }
    }

    this.#health = { available: true };

    return wanted.map(
      (key): SampleEntry =>
        answered.get(key) ?? {
          semanticKey: key,
          sample: {
            sensorId: `${this.id}:${key}`,
            timestamp: new Date(nowMs).toISOString(),
            status: invalid.has(key) ? "unavailable" : "missing",
            message: invalid.has(key) ? INVALID_MESSAGE : WAITING_MESSAGE,
          },
        },
    );
  }

  /** Descriptors are the owner of "which keys this provider answers". A sample
   *  can arrive before the catalogue read, so it fetches them once and keeps
   *  them; a failed fetch rejects this cycle rather than inventing keys. */
  async #ownedKeys(): Promise<ReadonlySet<string>> {
    if (this.#descriptors === undefined) await this.describe();
    return new Set((this.#descriptors ?? []).map((d) => d.semanticKey));
  }
}

/** A plugin is a provider plugin when it runs a worker and names contributions. */
function contributesProviders(plugin: InstalledPlugin): boolean {
  return (
    plugin.manifest.execution === "trusted-worker" &&
    (plugin.manifest.contributes.sensorProviders?.length ?? 0) > 0
  );
}

export interface CreatePluginProvidersOptions {
  readonly installer: PluginInstaller;
  readonly extensions: ExtensionService;
  readonly hostApi: HostApiDispatcher;
  readonly workerEntry?: string;
  /** One line per plugin that could not start; may reach the console. */
  readonly onFailure?: (pluginKey: string, reason: string) => void;
}

/**
 * Starts one worker per loadable provider plugin and adapts each contribution.
 * A plugin that fails to start is reported and contributes nothing; the rest
 * keep starting.
 */
export async function createPluginProviders(
  options: CreatePluginProvidersOptions,
): Promise<{
  readonly providers: readonly PluginSensorProvider[];
  stop(): Promise<void>;
}> {
  const providers: PluginSensorProvider[] = [];
  const supervisors: PluginSupervisor[] = [];

  for (const plugin of await options.installer.list()) {
    if (!contributesProviders(plugin)) continue;

    let loadable = false;
    try {
      loadable = await options.extensions.mayLoad(plugin.key);
    } catch {
      loadable = false;
    }
    if (!loadable) continue;

    const consent = await options.extensions.consentRecord(plugin.key);
    if (consent === undefined) continue;

    const supervisor = createPluginSupervisor({
      plugin,
      granted: plugin.manifest.capabilities,
      consent,
      hostApi: options.hostApi,
      ...(options.workerEntry === undefined
        ? {}
        : { workerEntry: options.workerEntry }),
    });

    try {
      await supervisor.start();
    } catch (error) {
      options.onFailure?.(plugin.key, redactForBrowser(reasonOf(error)));
      // A start that failed may have left a child behind; release it.
      await supervisor.stop().catch(() => undefined);
      continue;
    }

    supervisors.push(supervisor);
    for (const contribution of plugin.manifest.contributes.sensorProviders ??
      []) {
      providers.push(
        new PluginSensorProvider({ plugin, supervisor, contribution }),
      );
    }
  }

  let stopped = false;

  return {
    providers,
    async stop() {
      if (stopped) return;
      stopped = true;
      for (const supervisor of supervisors) {
        try {
          await supervisor.stop();
        } catch {
          // One worker that will not stop must not strand the others.
        }
      }
    },
  };
}
