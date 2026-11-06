import {
  type ConsentRecord,
  type InstalledPlugin,
  isCodeAssetSourceEntry,
  type PluginInstaller,
} from "@yunari/extension-api";
import {
  describeSemanticKey,
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
import { isProviderPlugin } from "./provider-order.js";
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
const UNREADABLE_READINGS =
  "The plugin returned readings this host could not read.";

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
  // The vocabulary owns which keys exist; a descriptor for any other key could
  // never be bound or sampled.
  if (!isKnownSemanticKey(semanticKey)) return undefined;
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

/** The conversion contract's value kind; keys without one are numbers. */
function valueKindOf(semanticKey: string): ValueKind {
  return describeSemanticKey(semanticKey)?.valueKind ?? "number";
}

/** A plugin sample is accepted only when its key is known and its value is the
 *  kind the vocabulary declares. */
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

  const numeric = raw["value"];
  const textValue = raw["textValue"];
  const booleanValue = raw["booleanValue"];

  if (status === "ok") {
    switch (valueKindOf(semanticKey)) {
      case "number":
        if (!(typeof numeric === "number" && Number.isFinite(numeric))) {
          return undefined;
        }
        break;
      case "text":
        if (typeof textValue !== "string") return undefined;
        break;
      case "boolean":
        if (typeof booleanValue !== "boolean") return undefined;
        break;
    }
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
    ...(typeof numeric === "number" && Number.isFinite(numeric)
      ? { value: numeric }
      : {}),
    ...(typeof textValue === "string" ? { textValue } : {}),
    ...(typeof booleanValue === "boolean" ? { booleanValue } : {}),
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

    this.#health =
      invalid.size === 0
        ? { available: true }
        : { available: false, message: UNREADABLE_READINGS };

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

export interface StartPluginSupervisorsOptions {
  readonly installer: PluginInstaller;
  readonly extensions: ExtensionService;
  readonly hostApi: HostApiDispatcher;
  readonly workerEntry?: string;
  /** One line per plugin that could not start; may reach the console. */
  readonly onFailure?: (pluginKey: string, reason: string) => void;
}

export interface CreatePluginProvidersOptions
  extends StartPluginSupervisorsOptions {
  /** The one worker per plugin, already started and owned by the caller. */
  readonly supervisors?: ReadonlyMap<string, PluginSupervisor>;
}

export interface PluginSupervisors {
  readonly supervisors: ReadonlyMap<string, PluginSupervisor>;
  stop(): Promise<void>;
}

/** The one definition of "this plugin needs a forked worker": it contributes
 *  sensor providers, code asset sources or a panel family, and only a trusted
 *  worker runs code. A plugin contributing several still gets one process. */
export function needsCodeWorker(plugin: InstalledPlugin): boolean {
  return (
    plugin.manifest.execution === "trusted-worker" &&
    (isProviderPlugin(plugin) ||
      (plugin.manifest.contributes.assetSources ?? []).some(
        isCodeAssetSourceEntry,
      ) ||
      (plugin.manifest.contributes.panelFamilies?.length ?? 0) > 0)
  );
}

/**
 * Starts one supervisor per loadable plugin that needs code.
 *
 * A plugin that fails to start is reported and left out; the rest keep
 * starting. The map is keyed by the plugin's qualified key, so every adapter a
 * plugin contributes answers through the same child.
 */
export async function startPluginSupervisors(
  options: StartPluginSupervisorsOptions,
): Promise<PluginSupervisors> {
  const supervisors = new Map<string, PluginSupervisor>();

  for (const plugin of await options.installer.list()) {
    if (!needsCodeWorker(plugin)) continue;

    let loadable = false;
    let consent: ConsentRecord | undefined;

    try {
      loadable = await options.extensions.mayLoad(plugin.key);
      if (loadable) {
        consent = await options.extensions.consentRecord(plugin.key);
      }
    } catch {
      // A plugin whose consent cannot be read is not loadable; only this one
      // loses its worker.
      loadable = false;
    }
    if (!loadable || consent === undefined) continue;

    let crashReported = false;
    const supervisor = createPluginSupervisor({
      plugin,
      granted: plugin.manifest.capabilities,
      consent,
      hostApi: options.hostApi,
      onCrash: (reason) => {
        crashReported = true;
        options.onFailure?.(plugin.key, reason);
      },
      ...(options.workerEntry === undefined
        ? {}
        : { workerEntry: options.workerEntry }),
    });

    try {
      await supervisor.start();
    } catch (error) {
      // A crash during startup already reported through onCrash; a refused
      // start (no main entry, mismatched consent) reports here instead.
      if (!crashReported) {
        options.onFailure?.(plugin.key, redactForBrowser(reasonOf(error)));
      }
      // A start that failed may have left a child behind; release it.
      await supervisor.stop().catch(() => undefined);
      continue;
    }

    supervisors.set(plugin.key, supervisor);
  }

  let stopped = false;

  return {
    supervisors,
    async stop() {
      if (stopped) return;
      stopped = true;
      for (const supervisor of supervisors.values()) {
        try {
          await supervisor.stop();
        } catch {
          // One worker that will not stop must not strand the others.
        }
      }
    },
  };
}

/**
 * One provider per loadable provider plugin, adapted from its supervisor.
 *
 * An optional shared map is used instead of starting workers: `main.ts`
 * starts them once so a plugin contributing both providers and asset sources
 * is one process. Without the map this starts and owns its own workers, which
 * is what its standalone callers and tests expect.
 */
export async function createPluginProviders(
  options: CreatePluginProvidersOptions,
): Promise<{
  readonly providers: readonly PluginSensorProvider[];
  stop(): Promise<void>;
}> {
  const runtime =
    options.supervisors === undefined
      ? await startPluginSupervisors(options)
      : undefined;
  const supervisors = options.supervisors ?? runtime?.supervisors;
  const providers: PluginSensorProvider[] = [];

  if (supervisors !== undefined) {
    for (const plugin of await options.installer.list()) {
      if (!isProviderPlugin(plugin)) continue;

      const supervisor = supervisors.get(plugin.key);
      if (supervisor === undefined) continue;

      const contribution = plugin.manifest.contributes.sensorProviders?.[0];
      if (contribution === undefined) continue;

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
      await runtime?.stop();
    },
  };
}
