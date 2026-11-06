import {
  canonicalSerialPath,
  isSerialPath,
  PANEL_COMMAND_KINDS,
  PANEL_TRANSPORTS,
  type PanelCommand,
  type PanelTransport,
} from "./device";
import type { PluginContributions } from "./manifest";
import {
  type Check,
  checkKeys,
  isRecord,
  MAX_CONTRIBUTIONS,
  MAX_ENTRY_PATH,
  MAX_NAME,
  readIdentifier,
  readList,
  readOptionalList,
  readPositiveNumber,
  readRecord,
  readRelativePath,
  readString,
  readStringList,
  readUsbId,
  refuse,
} from "./manifest-values";

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

const CONTRIBUTION_KEYS = [
  "sensorProviders",
  "assetCategories",
  "assetSources",
  "panelFamilies",
  "settingsPages",
  "customSources",
] as const;

/** A family's stream choice is a short menu, not a catalogue. */
const MAX_RENDER_MODES = 8;

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
  "transports",
  "serialPath",
] as const;
const PANEL_SUPPORT_KEYS = [
  "maker",
  "hardwareRevision",
  "supportedFirmware",
  "updatedAt",
] as const;
const SETTINGS_PAGE_KEYS = ["id", "label", "section", "fields", "ui"] as const;

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

/** A family reaches its device on one or more of the three buses. The order is
 *  the declaration's; a repeat is a typo, not a second reach. */
function readPanelTransports(
  value: unknown,
  subject: string,
): Check<readonly PanelTransport[]> {
  if (value === undefined) return refuse(`${subject} is required.`);
  if (!Array.isArray(value)) return refuse(`${subject} must be an array.`);
  if (value.length === 0)
    return refuse(`${subject} must declare at least one transport.`);
  if (value.length > PANEL_TRANSPORTS.size)
    return refuse(
      `${subject} carries at most ${PANEL_TRANSPORTS.size} entries.`,
    );
  const seen = new Set<string>();
  const transports: PanelTransport[] = [];
  for (const [index, entry] of value.entries()) {
    if (
      typeof entry !== "string" ||
      !PANEL_TRANSPORTS.has(entry as PanelTransport)
    )
      return refuse(`${subject}[${index}] must be "usb", "hid" or "serial".`);
    if (seen.has(entry))
      return refuse(`${subject} lists ${JSON.stringify(entry)} twice.`);
    seen.add(entry);
    transports.push(entry as PanelTransport);
  }
  return { ok: true, value: transports };
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
  const unknownCommand = commands.value.findIndex(
    (kind) => !PANEL_COMMAND_KINDS.has(kind as PanelCommand["kind"]),
  );
  if (unknownCommand !== -1)
    return refuse(
      `${subject}.commands[${unknownCommand}] is not a panel command.`,
    );
  let renderModes: readonly string[] | undefined;
  if (entry["renderModes"] !== undefined) {
    const read = readStringList(
      entry["renderModes"],
      `${subject}.renderModes`,
      MAX_CONTRIBUTIONS,
    );
    if (!read.ok) return read;
    // One stream has one row in a surface's choice; a repeat is not a second
    // mode. Dedupe first, so a repeated list is measured by its distinct
    // entries.
    renderModes = [...new Set(read.value)];
    if (renderModes.length > MAX_RENDER_MODES)
      return refuse(
        `${subject}.renderModes carries at most ${MAX_RENDER_MODES} entries.`,
      );
  }
  const transports = readPanelTransports(
    entry["transports"],
    `${subject}.transports`,
  );
  if (!transports.ok) return transports;
  let serialPath: string | undefined;
  if (entry["serialPath"] !== undefined) {
    const read = readString(
      entry["serialPath"],
      `${subject}.serialPath`,
      MAX_ENTRY_PATH,
    );
    if (!read.ok) return read;
    if (!isSerialPath(read.value))
      return refuse(
        `${subject}.serialPath must be a COM port or an absolute POSIX path.`,
      );
    serialPath = canonicalSerialPath(read.value);
  }
  const declaresSerial = transports.value.includes("serial");
  if (declaresSerial && serialPath === undefined)
    return refuse(
      `${subject}.serialPath is required for the "serial" transport.`,
    );
  if (!declaresSerial && serialPath !== undefined)
    return refuse(`${subject}.serialPath requires the "serial" transport.`);
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
      transports: transports.value,
      ...(serialPath === undefined ? {} : { serialPath }),
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

export function readContributions(value: unknown): Check<PluginContributions> {
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
