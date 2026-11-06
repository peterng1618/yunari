import { CAPABILITIES, type Capability } from "./capabilities";

export const MANIFEST_VERSION = 1;
export const PLUGIN_API_MAJOR = 1;
export const PLUGIN_MANIFEST_MEMBER = "yunari-plugin.json";
/** Bounds keep a hostile manifest small enough to validate in one pass. */
export const MAX_CAPABILITIES = 32;
export const MAX_CONTRIBUTIONS = 64;

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
  readonly main?: string;
  readonly ui?: string;
  readonly publisher?: string;
}

export type ManifestResult =
  | { readonly ok: true; readonly manifest: PluginManifest }
  | { readonly ok: false; readonly reason: string };

type Check<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

type ObjectValue = Readonly<Record<string, unknown>>;
type SensorProviderEntry = NonNullable<
  PluginContributions["sensorProviders"]
>[number];
type AssetCategoryEntry = NonNullable<
  PluginContributions["assetCategories"]
>[number];
type PanelFamilyEntry = NonNullable<
  PluginContributions["panelFamilies"]
>[number];
type SettingsPageEntry = NonNullable<
  PluginContributions["settingsPages"]
>[number];

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
  "main",
  "ui",
  "publisher",
] as const;

const CONTRIBUTION_KEYS = [
  "sensorProviders",
  "assetCategories",
  "assetSources",
  "panelFamilies",
  "settingsPages",
  "customSources",
] as const;

const SENSOR_PROVIDER_KEYS = ["id", "label"] as const;
const ASSET_CATEGORY_KEYS = [
  "id",
  "label",
  "icon",
  "resultKind",
  "body",
] as const;
const PANEL_FAMILY_KEYS = [
  "id",
  "label",
  "vendorId",
  "productId",
  "geometry",
  "support",
  "commands",
  "renderModes",
] as const;
const PANEL_SUPPORT_KEYS = [
  "maker",
  "hardwareRevision",
  "supportedFirmware",
  "updatedAt",
] as const;
const SETTINGS_PAGE_KEYS = ["id", "label", "section", "fields", "ui"] as const;

const IDENTIFIER_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
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
const MAX_USB_ID = 0xffff;

const MAX_IDENTIFIER = 64;
const MAX_NAME = 200;
const MAX_DESCRIPTION = 2000;
const MAX_VERSION = 128;
const MAX_ENTRY_PATH = 200;

function refuse(reason: string): {
  readonly ok: false;
  readonly reason: string;
} {
  return { ok: false, reason };
}

function isRecord(value: unknown): value is ObjectValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every object in the manifest is closed: a key this ABI does not know is a
 *  newer contribution or a typo, and loading it would silently drop behaviour. */
function checkKeys(
  value: ObjectValue,
  allowed: readonly string[],
  subject: string,
): string | undefined {
  const known = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !known.has(key));
  if (unknown === undefined) return undefined;
  return subject === ""
    ? `Unknown manifest key ${JSON.stringify(unknown)}.`
    : `${subject} has unknown key ${JSON.stringify(unknown)}.`;
}

function readString(
  value: unknown,
  subject: string,
  max: number,
): Check<string> {
  if (typeof value !== "string") return refuse(`${subject} must be a string.`);
  if (value.trim() === "") return refuse(`${subject} must not be empty.`);
  if (value.length > max)
    return refuse(`${subject} must be at most ${max} characters.`);
  return { ok: true, value };
}

function readIdentifier(
  value: unknown,
  subject: string,
  reservedPrefix: string | undefined,
): Check<string> {
  const string = readString(value, subject, MAX_IDENTIFIER);
  if (!string.ok) return string;
  if (!IDENTIFIER_PATTERN.test(string.value))
    return refuse(
      `${subject} ${JSON.stringify(string.value)} must be kebab-case.`,
    );
  if (reservedPrefix !== undefined && string.value.startsWith(reservedPrefix))
    return refuse(`${subject} ${JSON.stringify(string.value)} is reserved.`);
  return string;
}

function readUsbId(value: unknown, subject: string): Check<number> {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
    return refuse(`${subject} must be a non-negative integer.`);
  if (value > MAX_USB_ID)
    return refuse(`${subject} must be a 16-bit USB id (0-65535).`);
  return { ok: true, value };
}

function readPositiveNumber(value: unknown, subject: string): Check<number> {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    return refuse(`${subject} must be a positive number.`);
  return { ok: true, value };
}

function readRelativePath(value: unknown, subject: string): Check<string> {
  const path = readString(value, subject, MAX_ENTRY_PATH);
  if (!path.ok) return path;
  if (
    path.value.startsWith("/") ||
    path.value.startsWith("\\") ||
    path.value.includes("\\") ||
    /^[A-Za-z]:/.test(path.value)
  )
    return refuse(`${subject} must be a relative package path.`);
  const segments = path.value.split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  )
    return refuse(`${subject} must stay inside the package.`);
  return path;
}

function readStringList(
  value: unknown,
  subject: string,
  maxEntries: number,
): Check<readonly string[]> {
  if (!Array.isArray(value)) return refuse(`${subject} must be an array.`);
  if (value.length > maxEntries)
    return refuse(`${subject} carries at most ${maxEntries} entries.`);
  const strings: string[] = [];
  for (const [index, entry] of value.entries()) {
    const string = readString(entry, `${subject}[${index}]`, MAX_NAME);
    if (!string.ok) return string;
    strings.push(string.value);
  }
  return { ok: true, value: strings };
}

function readList<T>(
  value: unknown,
  subject: string,
  readEntry: (entry: unknown, subject: string) => Check<T>,
): Check<readonly T[]> {
  if (!Array.isArray(value)) return refuse(`${subject} must be an array.`);
  if (value.length > MAX_CONTRIBUTIONS)
    return refuse(`${subject} carries at most ${MAX_CONTRIBUTIONS} entries.`);
  const entries: T[] = [];
  for (const [index, entry] of value.entries()) {
    const read = readEntry(entry, `${subject}[${index}]`);
    if (!read.ok) return read;
    entries.push(read.value);
  }
  return { ok: true, value: entries };
}

function readOptionalList<T>(
  value: unknown,
  subject: string,
  readEntry: (entry: unknown, subject: string) => Check<T>,
): Check<readonly T[] | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  return readList(value, subject, readEntry);
}

function readRecord(value: unknown, subject: string): Check<ObjectValue> {
  if (!isRecord(value)) return refuse(`${subject} must be an object.`);
  return { ok: true, value: { ...value } };
}

function readSensorProvider(
  entry: unknown,
  subject: string,
): Check<SensorProviderEntry> {
  if (!isRecord(entry)) return refuse(`${subject} must be an object.`);
  const unknown = checkKeys(entry, SENSOR_PROVIDER_KEYS, subject);
  if (unknown !== undefined) return refuse(unknown);
  const id = readIdentifier(entry["id"], `${subject}.id`, undefined);
  if (!id.ok) return id;
  const label = readString(entry["label"], `${subject}.label`, MAX_NAME);
  if (!label.ok) return label;
  return { ok: true, value: { id: id.value, label: label.value } };
}

function readAssetCategory(
  entry: unknown,
  subject: string,
): Check<AssetCategoryEntry> {
  if (!isRecord(entry)) return refuse(`${subject} must be an object.`);
  const unknown = checkKeys(entry, ASSET_CATEGORY_KEYS, subject);
  if (unknown !== undefined) return refuse(unknown);
  const id = readIdentifier(entry["id"], `${subject}.id`, undefined);
  if (!id.ok) return id;
  const label = readString(entry["label"], `${subject}.label`, MAX_NAME);
  if (!label.ok) return label;
  const icon = readString(entry["icon"], `${subject}.icon`, MAX_NAME);
  if (!icon.ok) return icon;
  const resultKind = readString(
    entry["resultKind"],
    `${subject}.resultKind`,
    MAX_NAME,
  );
  if (!resultKind.ok) return resultKind;
  if (entry["body"] !== "grid")
    return refuse(`${subject}.body must be "grid".`);
  return {
    ok: true,
    value: {
      id: id.value,
      label: label.value,
      icon: icon.value,
      resultKind: resultKind.value,
      body: "grid",
    },
  };
}

/** A declarative source is an open descriptor. A string `entry` is code, and
 *  code is only admitted through the trusted-worker profile. */
function readAssetSource(
  entry: unknown,
  subject: string,
): Check<Readonly<Record<string, unknown>>> {
  if (!isRecord(entry)) return refuse(`${subject} must be an object.`);
  if (entry["entry"] !== undefined) {
    const path = readRelativePath(entry["entry"], `${subject}.entry`);
    if (!path.ok) return path;
  }
  return { ok: true, value: { ...entry } };
}

function readGeometry(
  value: unknown,
  subject: string,
): Check<{ readonly width: number; readonly height: number }> {
  if (!isRecord(value)) return refuse(`${subject} must be an object.`);
  const unknown = checkKeys(value, ["width", "height"], subject);
  if (unknown !== undefined) return refuse(unknown);
  const width = readPositiveNumber(value["width"], `${subject}.width`);
  if (!width.ok) return width;
  const height = readPositiveNumber(value["height"], `${subject}.height`);
  if (!height.ok) return height;
  return { ok: true, value: { width: width.value, height: height.value } };
}

function readPanelSupport(
  value: unknown,
  subject: string,
): Check<PanelFamilyEntry["support"]> {
  if (!isRecord(value)) return refuse(`${subject} must be an object.`);
  const unknown = checkKeys(value, PANEL_SUPPORT_KEYS, subject);
  if (unknown !== undefined) return refuse(unknown);
  const maker = readString(value["maker"], `${subject}.maker`, MAX_NAME);
  if (!maker.ok) return maker;
  const hardwareRevision = readString(
    value["hardwareRevision"],
    `${subject}.hardwareRevision`,
    MAX_NAME,
  );
  if (!hardwareRevision.ok) return hardwareRevision;
  const supportedFirmware = readStringList(
    value["supportedFirmware"],
    `${subject}.supportedFirmware`,
    MAX_CONTRIBUTIONS,
  );
  if (!supportedFirmware.ok) return supportedFirmware;
  const updatedAt = readString(
    value["updatedAt"],
    `${subject}.updatedAt`,
    MAX_NAME,
  );
  if (!updatedAt.ok) return updatedAt;
  return {
    ok: true,
    value: {
      maker: maker.value,
      hardwareRevision: hardwareRevision.value,
      supportedFirmware: supportedFirmware.value,
      updatedAt: updatedAt.value,
    },
  };
}

function readPanelFamily(
  entry: unknown,
  subject: string,
): Check<PanelFamilyEntry> {
  if (!isRecord(entry)) return refuse(`${subject} must be an object.`);
  const unknown = checkKeys(entry, PANEL_FAMILY_KEYS, subject);
  if (unknown !== undefined) return refuse(unknown);
  const id = readIdentifier(entry["id"], `${subject}.id`, undefined);
  if (!id.ok) return id;
  const label = readString(entry["label"], `${subject}.label`, MAX_NAME);
  if (!label.ok) return label;
  const vendorId = readUsbId(entry["vendorId"], `${subject}.vendorId`);
  if (!vendorId.ok) return vendorId;
  const productId = readUsbId(entry["productId"], `${subject}.productId`);
  if (!productId.ok) return productId;
  const geometry = readGeometry(entry["geometry"], `${subject}.geometry`);
  if (!geometry.ok) return geometry;
  const support = readPanelSupport(entry["support"], `${subject}.support`);
  if (!support.ok) return support;
  const commands = readStringList(
    entry["commands"],
    `${subject}.commands`,
    MAX_CONTRIBUTIONS,
  );
  if (!commands.ok) return commands;
  let renderModes: readonly string[] | undefined;
  if (entry["renderModes"] !== undefined) {
    const read = readStringList(
      entry["renderModes"],
      `${subject}.renderModes`,
      MAX_CONTRIBUTIONS,
    );
    if (!read.ok) return read;
    renderModes = read.value;
  }
  return {
    ok: true,
    value: {
      id: id.value,
      label: label.value,
      vendorId: vendorId.value,
      productId: productId.value,
      geometry: geometry.value,
      support: support.value,
      commands: commands.value,
      ...(renderModes === undefined ? {} : { renderModes }),
    },
  };
}

function readSettingsPage(
  entry: unknown,
  subject: string,
): Check<SettingsPageEntry> {
  if (!isRecord(entry)) return refuse(`${subject} must be an object.`);
  const unknown = checkKeys(entry, SETTINGS_PAGE_KEYS, subject);
  if (unknown !== undefined) return refuse(unknown);
  const id = readIdentifier(entry["id"], `${subject}.id`, undefined);
  if (!id.ok) return id;
  const label = readString(entry["label"], `${subject}.label`, MAX_NAME);
  if (!label.ok) return label;
  let section: string | undefined;
  if (entry["section"] !== undefined) {
    const read = readString(entry["section"], `${subject}.section`, MAX_NAME);
    if (!read.ok) return read;
    section = read.value;
  }
  let fields: readonly Readonly<Record<string, unknown>>[] | undefined;
  if (entry["fields"] !== undefined) {
    const read = readList(entry["fields"], `${subject}.fields`, readRecord);
    if (!read.ok) return read;
    fields = read.value;
  }
  let ui: string | undefined;
  if (entry["ui"] !== undefined) {
    const read = readRelativePath(entry["ui"], `${subject}.ui`);
    if (!read.ok) return read;
    ui = read.value;
  }
  return {
    ok: true,
    value: {
      id: id.value,
      label: label.value,
      ...(section === undefined ? {} : { section }),
      ...(fields === undefined ? {} : { fields }),
      ...(ui === undefined ? {} : { ui }),
    },
  };
}

function readContributions(value: unknown): Check<PluginContributions> {
  if (!isRecord(value)) return refuse('"contributes" must be an object.');
  const unknown = checkKeys(value, CONTRIBUTION_KEYS, "contributes");
  if (unknown !== undefined) return refuse(unknown);
  const sensorProviders = readOptionalList(
    value["sensorProviders"],
    "contributes.sensorProviders",
    readSensorProvider,
  );
  if (!sensorProviders.ok) return sensorProviders;
  const assetCategories = readOptionalList(
    value["assetCategories"],
    "contributes.assetCategories",
    readAssetCategory,
  );
  if (!assetCategories.ok) return assetCategories;
  const assetSources = readOptionalList(
    value["assetSources"],
    "contributes.assetSources",
    readAssetSource,
  );
  if (!assetSources.ok) return assetSources;
  const panelFamilies = readOptionalList(
    value["panelFamilies"],
    "contributes.panelFamilies",
    readPanelFamily,
  );
  if (!panelFamilies.ok) return panelFamilies;
  const settingsPages = readOptionalList(
    value["settingsPages"],
    "contributes.settingsPages",
    readSettingsPage,
  );
  if (!settingsPages.ok) return settingsPages;
  const customSources = readOptionalList(
    value["customSources"],
    "contributes.customSources",
    readRecord,
  );
  if (!customSources.ok) return customSources;
  return {
    ok: true,
    value: {
      ...(sensorProviders.value === undefined
        ? {}
        : { sensorProviders: sensorProviders.value }),
      ...(assetCategories.value === undefined
        ? {}
        : { assetCategories: assetCategories.value }),
      ...(assetSources.value === undefined
        ? {}
        : { assetSources: assetSources.value }),
      ...(panelFamilies.value === undefined
        ? {}
        : { panelFamilies: panelFamilies.value }),
      ...(settingsPages.value === undefined
        ? {}
        : { settingsPages: settingsPages.value }),
      ...(customSources.value === undefined
        ? {}
        : { customSources: customSources.value }),
    },
  };
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
