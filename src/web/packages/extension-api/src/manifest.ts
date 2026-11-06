import { CAPABILITIES, type Capability } from "./capabilities";
import { readContributions } from "./manifest-contributions";
import {
  type Check,
  checkKeys,
  isRecord,
  MAX_CAPABILITIES,
  MAX_DESCRIPTION,
  MAX_NAME,
  MAX_NETWORK_HOSTS,
  MAX_VERSION,
  type ObjectValue,
  readIdentifier,
  readRelativePath,
  readString,
  refuse,
} from "./manifest-values";

export { MAX_CAPABILITIES, MAX_CONTRIBUTIONS } from "./manifest-values";

export const MANIFEST_VERSION = 1;
export const PLUGIN_API_MAJOR = 1;
export const PLUGIN_MANIFEST_MEMBER = "yunari-plugin.json";

export type ExecutionProfile =
  | "data"
  | "declarative"
  | "sandboxed-ui"
  | "trusted-worker";

export interface PluginContributions {
  readonly sensorProviders?: readonly {
    readonly id: string;
    readonly label: string;
  }[];
  readonly assetCategories?: readonly {
    readonly id: string;
    readonly label: string;
    readonly icon: string;
    readonly resultKind: string;
    readonly body: "grid";
  }[];
  readonly assetSources?: readonly Readonly<Record<string, unknown>>[];
  readonly panelFamilies?: readonly {
    readonly id: string;
    readonly label: string;
    readonly vendorId: number;
    readonly productId: number;
    readonly geometry: { readonly width: number; readonly height: number };
    readonly support: {
      readonly maker: string;
      readonly hardwareRevision: string;
      readonly supportedFirmware: readonly string[];
      readonly updatedAt: string;
    };
    readonly commands: readonly string[];
    readonly renderModes?: readonly string[];
  }[];
  readonly settingsPages?: readonly {
    readonly id: string;
    readonly label: string;
    readonly section?: string;
    readonly fields?: readonly Readonly<Record<string, unknown>>[];
    readonly ui?: string;
  }[];
  readonly customSources?: readonly Readonly<Record<string, unknown>>[];
}

export interface PluginManifest {
  readonly manifestVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly engines: { readonly yunari: string };
  readonly pluginApi: 1;
  readonly execution: ExecutionProfile;
  readonly capabilities: readonly Capability[];
  readonly contributes: PluginContributions;
  readonly networkHosts?: readonly string[];
  readonly main?: string;
  readonly ui?: string;
  readonly publisher?: string;
}

export type ManifestResult =
  | { readonly ok: true; readonly manifest: PluginManifest }
  | { readonly ok: false; readonly reason: string };

const EXECUTION_PROFILES: readonly ExecutionProfile[] = [
  "data",
  "declarative",
  "sandboxed-ui",
  "trusted-worker",
];

const EXECUTION_RANK: Readonly<Record<ExecutionProfile, number>> = {
  data: 0,
  declarative: 1,
  "sandboxed-ui": 2,
  "trusted-worker": 3,
};

const MANIFEST_KEYS = [
  "manifestVersion",
  "id",
  "name",
  "version",
  "description",
  "engines",
  "pluginApi",
  "execution",
  "capabilities",
  "contributes",
  "networkHosts",
  "main",
  "ui",
  "publisher",
] as const;

/** Semver's prerelease identifiers are dot-separated; a numeric one has no
 *  leading zero, and an alphanumeric one carries a letter or hyphen. Build
 *  metadata is looser and may repeat a numeric identifier with a zero. */
const SEMVER_IDENTIFIER = "(?:0|[1-9]\\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)";
const VERSION_PATTERN = new RegExp(
  `^(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)(?:-${SEMVER_IDENTIFIER}(?:\\.${SEMVER_IDENTIFIER})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`,
);
const ENGINE_RANGE_PATTERN = /^>=(\d+)\.(\d+)\.(\d+)$/;
/** The bodies the editor renders itself. Any other body is plugin UI and needs
 *  the sandboxed profile; an `entry` is code and needs the trusted one. */
const BUILT_IN_ASSET_BODIES: ReadonlySet<string> = new Set([
  "grid",
  "font-picker",
  "wallpaper-engine",
]);

/** A host is a DNS label sequence or an IPv4 literal: no scheme, path, port,
 *  wildcard or trailing dot, and no uppercase (the URL layer lowercases too,
 *  but the declaration must be canonical before consent fingerprints it). */
const MAX_HOST_LENGTH = 63;
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const IPV4_ADDRESS =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

function isNetworkHost(host: string): boolean {
  if (host.length > MAX_HOST_LENGTH) return false;
  if (IPV4_ADDRESS.test(host)) return true;
  return host.split(".").every((label) => DNS_LABEL.test(label));
}

function readNetworkHosts(
  value: unknown,
): Check<readonly string[] | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(value)) return refuse('"networkHosts" must be an array.');
  if (value.length > MAX_NETWORK_HOSTS)
    return refuse(
      `A plugin declares at most ${MAX_NETWORK_HOSTS} network hosts.`,
    );
  const seen = new Set<string>();
  const hosts: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !isNetworkHost(entry))
      return refuse(
        `The network host ${JSON.stringify(entry)} must be a bare DNS name.`,
      );
    if (seen.has(entry))
      return refuse(`Network host ${JSON.stringify(entry)} is listed twice.`);
    seen.add(entry);
    hosts.push(entry);
  }
  return { ok: true, value: hosts };
}

function readExecution(value: unknown): Check<ExecutionProfile> {
  if (
    typeof value !== "string" ||
    !EXECUTION_PROFILES.includes(value as ExecutionProfile)
  )
    return refuse(`Unknown execution profile ${JSON.stringify(value)}.`);
  return { ok: true, value: value as ExecutionProfile };
}

function readCapabilities(value: unknown): Check<readonly Capability[]> {
  if (!Array.isArray(value)) return refuse('"capabilities" must be an array.');
  if (value.length > MAX_CAPABILITIES)
    return refuse(
      `A plugin declares at most ${MAX_CAPABILITIES} capabilities.`,
    );
  const seen = new Set<string>();
  const capabilities: Capability[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !CAPABILITIES.has(entry as Capability))
      return refuse(`Unknown capability ${JSON.stringify(entry)}.`);
    if (seen.has(entry))
      return refuse(`Capability "${entry}" is listed twice.`);
    seen.add(entry);
    capabilities.push(entry as Capability);
  }
  return { ok: true, value: capabilities };
}

function missingCapability(
  capabilities: readonly Capability[],
  contributes: PluginContributions,
): string | undefined {
  const required: readonly [keyof PluginContributions, Capability][] = [
    ["sensorProviders", "sensor:provide"],
    ["assetCategories", "asset:provide"],
    ["assetSources", "asset:provide"],
    ["panelFamilies", "panel:drive"],
    ["settingsPages", "settings:own"],
  ];
  for (const [contribution, capability] of required) {
    if (
      contributes[contribution] !== undefined &&
      !capabilities.includes(capability)
    )
      return `The ${contribution} contribution needs the ${JSON.stringify(capability)} capability.`;
  }
  return undefined;
}

/**
 * The structural half of manifest admission: shape, bounds, closed keys and
 * the entries' own presence. The profile-versus-contribution half is
 * `validateManifestExecution`, so a caller can report the mismatch by name.
 */
export function readPluginManifest(value: unknown): ManifestResult {
  if (!isRecord(value)) return refuse("A plugin manifest must be an object.");
  const unknownKey = checkKeys(value, MANIFEST_KEYS, "");
  if (unknownKey !== undefined) return refuse(unknownKey);

  if (value["manifestVersion"] !== MANIFEST_VERSION)
    return refuse(
      `Unsupported manifest version ${JSON.stringify(value["manifestVersion"])}.`,
    );
  if (value["pluginApi"] !== PLUGIN_API_MAJOR)
    return refuse(
      `Unsupported plugin API ${JSON.stringify(value["pluginApi"])}.`,
    );

  const id = readIdentifier(value["id"], "Plugin id", "yunari-");
  if (!id.ok) return refuse(id.reason);
  const name = readString(value["name"], "Plugin name", MAX_NAME);
  if (!name.ok) return refuse(name.reason);
  const version = readString(value["version"], "Plugin version", MAX_VERSION);
  if (!version.ok) return refuse(version.reason);
  if (!VERSION_PATTERN.test(version.value))
    return refuse('Plugin version must be semver "x.y.z".');
  const description = readString(
    value["description"],
    "Plugin description",
    MAX_DESCRIPTION,
  );
  if (!description.ok) return refuse(description.reason);

  const engines = value["engines"];
  if (!isRecord(engines)) return refuse('"engines" must be an object.');
  const unknownEngine = checkKeys(engines, ["yunari"], "engines");
  if (unknownEngine !== undefined) return refuse(unknownEngine);
  const yunari = readString(engines["yunari"], "engines.yunari", MAX_VERSION);
  if (!yunari.ok) return refuse(yunari.reason);
  if (!ENGINE_RANGE_PATTERN.test(yunari.value))
    return refuse('engines.yunari must be ">=x.y.z".');

  const execution = readExecution(value["execution"]);
  if (!execution.ok) return refuse(execution.reason);
  if (value["capabilities"] === undefined)
    return refuse('A plugin manifest needs "capabilities".');
  const capabilities = readCapabilities(value["capabilities"]);
  if (!capabilities.ok) return refuse(capabilities.reason);
  if (value["contributes"] === undefined)
    return refuse('A plugin manifest needs "contributes".');
  const contributes = readContributions(value["contributes"]);
  if (!contributes.ok) return refuse(contributes.reason);

  let main: string | undefined;
  if (value["main"] !== undefined) {
    const read = readRelativePath(value["main"], "main");
    if (!read.ok) return refuse(read.reason);
    main = read.value;
  }
  let ui: string | undefined;
  if (value["ui"] !== undefined) {
    const read = readRelativePath(value["ui"], "ui");
    if (!read.ok) return refuse(read.reason);
    ui = read.value;
  }
  if (execution.value === "trusted-worker" && main === undefined)
    return refuse('A trusted-worker plugin needs "main".');
  if (execution.value === "sandboxed-ui" && ui === undefined)
    return refuse('A sandboxed-ui plugin needs "ui".');

  const missing = missingCapability(capabilities.value, contributes.value);
  if (missing !== undefined) return refuse(missing);

  let publisher: string | undefined;
  if (value["publisher"] !== undefined) {
    const read = readIdentifier(value["publisher"], "Publisher", undefined);
    if (!read.ok) return refuse(read.reason);
    if (isReservedPublisher(read.value))
      return refuse(`Publisher ${JSON.stringify(read.value)} is reserved.`);
    publisher = read.value;
  }

  const networkHosts = readNetworkHosts(value["networkHosts"]);
  if (!networkHosts.ok) return refuse(networkHosts.reason);

  return {
    ok: true,
    manifest: {
      manifestVersion: MANIFEST_VERSION,
      id: id.value,
      name: name.value,
      version: version.value,
      description: description.value,
      engines: { yunari: yunari.value },
      pluginApi: PLUGIN_API_MAJOR,
      execution: execution.value,
      capabilities: capabilities.value,
      contributes: contributes.value,
      ...(networkHosts.value === undefined
        ? {}
        : { networkHosts: networkHosts.value }),
      ...(main === undefined ? {} : { main }),
      ...(ui === undefined ? {} : { ui }),
      ...(publisher === undefined ? {} : { publisher }),
    },
  };
}

interface Requirement {
  readonly contribution: keyof PluginContributions;
  readonly profile: ExecutionProfile;
}

function assetSourceProfile(source: ObjectValue): ExecutionProfile {
  if (typeof source["entry"] === "string") return "trusted-worker";
  if (
    typeof source["body"] === "string" &&
    !BUILT_IN_ASSET_BODIES.has(source["body"])
  )
    return "sandboxed-ui";
  return "declarative";
}

function contributionRequirements(
  contributes: PluginContributions,
): readonly Requirement[] {
  const requirements: Requirement[] = [];
  if (contributes.sensorProviders !== undefined)
    requirements.push({
      contribution: "sensorProviders",
      profile: "trusted-worker",
    });
  if (contributes.assetCategories !== undefined)
    requirements.push({
      contribution: "assetCategories",
      profile: "declarative",
    });
  if (contributes.assetSources !== undefined) {
    let profile: ExecutionProfile = "declarative";
    for (const source of contributes.assetSources) {
      const required = assetSourceProfile(source);
      if (EXECUTION_RANK[required] > EXECUTION_RANK[profile])
        profile = required;
    }
    requirements.push({ contribution: "assetSources", profile });
  }
  if (contributes.panelFamilies !== undefined)
    requirements.push({
      contribution: "panelFamilies",
      profile: "trusted-worker",
    });
  if (contributes.settingsPages !== undefined)
    requirements.push({
      contribution: "settingsPages",
      profile: contributes.settingsPages.some(
        (page) => typeof page["ui"] === "string",
      )
        ? "sandboxed-ui"
        : "declarative",
    });
  if (contributes.customSources !== undefined)
    requirements.push({
      contribution: "customSources",
      profile: "declarative",
    });
  return requirements;
}

/** The highest profile any contribution, entry point or frame requires. A
 *  manifest may declare a higher profile than this; it may not declare less. */
export function requiredExecution(manifest: PluginManifest): ExecutionProfile {
  let required: ExecutionProfile = "data";
  const raise = (profile: ExecutionProfile): void => {
    if (EXECUTION_RANK[profile] > EXECUTION_RANK[required]) required = profile;
  };
  for (const requirement of contributionRequirements(manifest.contributes))
    raise(requirement.profile);
  if (manifest.main !== undefined) raise("trusted-worker");
  if (manifest.ui !== undefined) raise("sandboxed-ui");
  return required;
}

/**
 * The profile half of admission. The refusing message names the contribution
 * whose authority the declared profile cannot carry, so consent and support can
 * point at the exact entry rather than a rank.
 */
export function validateManifestExecution(
  manifest: PluginManifest,
): ManifestResult {
  const declared = manifest.execution;
  for (const requirement of contributionRequirements(manifest.contributes)) {
    if (EXECUTION_RANK[declared] < EXECUTION_RANK[requirement.profile])
      return refuse(
        `The ${requirement.contribution} contribution requires ${JSON.stringify(requirement.profile)}, but the manifest declares ${JSON.stringify(declared)}.`,
      );
  }
  if (
    manifest.main !== undefined &&
    EXECUTION_RANK[declared] < EXECUTION_RANK["trusted-worker"]
  )
    return refuse(
      `The "main" entry requires "trusted-worker", but the manifest declares ${JSON.stringify(declared)}.`,
    );
  if (
    manifest.ui !== undefined &&
    EXECUTION_RANK[declared] < EXECUTION_RANK["sandboxed-ui"]
  )
    return refuse(
      `The "ui" entry requires "sandboxed-ui", but the manifest declares ${JSON.stringify(declared)}.`,
    );
  return { ok: true, manifest };
}

/** Consent and the kill list key on the publisher as well as the id, so two
 *  publishers cannot collide on one id. Local installs use `local`. */
export function qualifiedPluginKey(publisher: string, id: string): string {
  return `${publisher}/${id}`;
}

/**
 * The publisher segment of a qualified key, or `undefined` when the key is not
 * `publisher/id`: exactly one separator with a non-empty segment on each side.
 * Consent is never keyed by a bare id, so an unqualified key has no publisher
 * to name rather than an empty one.
 */
export function publisherOf(pluginKey: string): string | undefined {
  const separator = pluginKey.indexOf("/");
  if (
    separator <= 0 ||
    separator !== pluginKey.lastIndexOf("/") ||
    separator === pluginKey.length - 1
  )
    return undefined;
  return pluginKey.slice(0, separator);
}

/** First-party names cannot be claimed by a published plugin. A `yunari`
 *  prefix is reserved in full, not only the exact name. */
export function isReservedPublisher(publisher: string): boolean {
  const normalized = publisher.toLowerCase();
  return normalized === "official" || normalized.startsWith("yunari");
}
