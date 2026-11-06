import {
  canonicalSerialPath,
  isSerialPath,
  PANEL_COMMAND_KINDS,
  PANEL_TRANSPORTS,
  type PanelCommand,
  type PanelTransport,
} from "./device";
import type { PluginContributions, SettingsField } from "./manifest";
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

/** A panel raster is a bounded size. The largest shipping panels are under
 *  4K; 16K leaves room and keeps a manifest from asking for an unbounded
 *  frame buffer the host would have to allocate. */
const MAX_PANEL_DIMENSION = 16_384;

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
  "interfaceNumber",
] as const;
const PANEL_SUPPORT_KEYS = [
  "maker",
  "hardwareRevision",
  "supportedFirmware",
  "updatedAt",
] as const;
const SETTINGS_PAGE_KEYS = ["id", "label", "section", "fields", "ui"] as const;

/** The field key becomes a settings object key and a secret's name, so it is
 *  a dotted lower-case identifier with a bounded length. */
const FIELD_KEY_PATTERN = /^[a-z][a-zA-Z0-9.]{0,63}$/;
const MAX_FIELD_LENGTH = 100_000;

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

/** A panel dimension is a whole number of pixels in a bounded range: a
 *  fractional or unbounded value is not a raster the host can render into. */
function readPanelDimension(value: unknown, subject: string): Check<number> {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_PANEL_DIMENSION
  )
    return refuse(
      `${subject} must be a whole number between 1 and ${MAX_PANEL_DIMENSION}.`,
    );
  return { ok: true, value };
}

function readGeometry(
  value: unknown,
  subject: string,
): Check<{ readonly width: number; readonly height: number }> {
  if (!isRecord(value)) return refuse(`${subject} must be an object.`);
  const unknown = checkKeys(value, ["width", "height"], subject);
  if (unknown !== undefined) return refuse(unknown);
  const width = readPanelDimension(value["width"], `${subject}.width`);
  if (!width.ok) return width;
  const height = readPanelDimension(value["height"], `${subject}.height`);
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

/** A USB interface is one byte on the wire. It is refused when the family
 *  declares no bus that has interfaces: a serial port has none. */
function readInterfaceNumber(value: unknown, subject: string): Check<number> {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 0xff
  )
    return refuse(`${subject} must be a whole number between 0 and 255.`);
  return { ok: true, value };
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
  let interfaceNumber: number | undefined;
  if (entry["interfaceNumber"] !== undefined) {
    const read = readInterfaceNumber(
      entry["interfaceNumber"],
      `${subject}.interfaceNumber`,
    );
    if (!read.ok) return read;
    if (!transports.value.some((transport) => transport !== "serial"))
      return refuse(
        `${subject}.interfaceNumber requires the "usb" or "hid" transport.`,
      );
    interfaceNumber = read.value;
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
      ...(interfaceNumber === undefined ? {} : { interfaceNumber }),
    },
  };
}

function readFinite(value: unknown, subject: string): Check<number> {
  if (typeof value !== "number" || !Number.isFinite(value))
    return refuse(`${subject} must be a finite number.`);
  return { ok: true, value };
}

function readSettingsField(
  entry: unknown,
  subject: string,
): Check<SettingsField> {
  if (!isRecord(entry)) return refuse(`${subject} must be an object.`);
  const key = entry["key"];
  if (typeof key !== "string" || !FIELD_KEY_PATTERN.test(key))
    return refuse(`${subject}.key must be a lower-case dotted key.`);
  const label = readString(entry["label"], `${subject}.label`, MAX_NAME);
  if (!label.ok) return label;
  const type = entry["type"];

  if (type === "text") {
    const unknown = checkKeys(
      entry,
      ["key", "label", "type", "default", "maxLength"],
      subject,
    );
    if (unknown !== undefined) return refuse(unknown);
    let defaultValue: string | undefined;
    if (entry["default"] !== undefined) {
      const read = entry["default"];
      if (typeof read !== "string")
        return refuse(`${subject}.default must be a string.`);
      if (read.length > MAX_FIELD_LENGTH)
        return refuse(
          `${subject}.default must be at most ${MAX_FIELD_LENGTH} characters.`,
        );
      defaultValue = read;
    }
    let maxLength: number | undefined;
    if (entry["maxLength"] !== undefined) {
      const read = entry["maxLength"];
      if (
        typeof read !== "number" ||
        !Number.isInteger(read) ||
        read < 1 ||
        read > MAX_FIELD_LENGTH
      )
        return refuse(`${subject}.maxLength must be a positive integer.`);
      maxLength = read;
    }
    if (
      defaultValue !== undefined &&
      maxLength !== undefined &&
      defaultValue.length > maxLength
    )
      return refuse(
        `The field ${JSON.stringify(key)} has a default longer than its maxLength.`,
      );
    return {
      ok: true,
      value: {
        key,
        label: label.value,
        type: "text",
        ...(defaultValue === undefined ? {} : { default: defaultValue }),
        ...(maxLength === undefined ? {} : { maxLength }),
      },
    };
  }

  if (type === "number") {
    const unknown = checkKeys(
      entry,
      ["key", "label", "type", "default", "min", "max"],
      subject,
    );
    if (unknown !== undefined) return refuse(unknown);
    let min: number | undefined;
    let max: number | undefined;
    if (entry["min"] !== undefined) {
      const read = readFinite(entry["min"], `${subject}.min`);
      if (!read.ok) return read;
      min = read.value;
    }
    if (entry["max"] !== undefined) {
      const read = readFinite(entry["max"], `${subject}.max`);
      if (!read.ok) return read;
      max = read.value;
    }
    if (min !== undefined && max !== undefined && min > max)
      return refuse(
        `The field ${JSON.stringify(key)} has a minimum above its maximum.`,
      );
    let defaultValue: number | undefined;
    if (entry["default"] !== undefined) {
      const read = readFinite(entry["default"], `${subject}.default`);
      if (!read.ok) return read;
      if (
        (min !== undefined && read.value < min) ||
        (max !== undefined && read.value > max)
      )
        return refuse(
          `The field ${JSON.stringify(key)} has a default outside its bounds.`,
        );
      defaultValue = read.value;
    }
    return {
      ok: true,
      value: {
        key,
        label: label.value,
        type: "number",
        ...(defaultValue === undefined ? {} : { default: defaultValue }),
        ...(min === undefined ? {} : { min }),
        ...(max === undefined ? {} : { max }),
      },
    };
  }

  if (type === "boolean") {
    const unknown = checkKeys(
      entry,
      ["key", "label", "type", "default"],
      subject,
    );
    if (unknown !== undefined) return refuse(unknown);
    const defaultValue = entry["default"];
    if (defaultValue !== undefined && typeof defaultValue !== "boolean")
      return refuse(`${subject}.default must be a boolean.`);
    return {
      ok: true,
      value: {
        key,
        label: label.value,
        type: "boolean",
        ...(defaultValue === undefined
          ? {}
          : { default: defaultValue as boolean }),
      },
    };
  }

  if (type === "select") {
    const unknown = checkKeys(
      entry,
      ["key", "label", "type", "options", "default"],
      subject,
    );
    if (unknown !== undefined) return refuse(unknown);
    const options = readList(
      entry["options"],
      `${subject}.options`,
      (option, optionSubject) => {
        if (!isRecord(option))
          return refuse(`${optionSubject} must be an object.`);
        const optionUnknown = checkKeys(
          option,
          ["value", "label"],
          optionSubject,
        );
        if (optionUnknown !== undefined) return refuse(optionUnknown);
        const value = readString(
          option["value"],
          `${optionSubject}.value`,
          MAX_NAME,
        );
        if (!value.ok) return value;
        const optionLabel = readString(
          option["label"],
          `${optionSubject}.label`,
          MAX_NAME,
        );
        if (!optionLabel.ok) return optionLabel;
        return {
          ok: true,
          value: { value: value.value, label: optionLabel.value },
        };
      },
    );
    if (!options.ok) return options;
    if (options.value.length === 0)
      return refuse(`${subject}.options must offer at least one option.`);
    const values = new Set<string>();
    for (const option of options.value) {
      if (values.has(option.value))
        return refuse(
          `The field ${JSON.stringify(key)} lists the option ${JSON.stringify(option.value)} twice.`,
        );
      values.add(option.value);
    }
    const defaultValue = entry["default"];
    if (defaultValue !== undefined) {
      if (typeof defaultValue !== "string")
        return refuse(`${subject}.default must be a string.`);
      if (!values.has(defaultValue))
        return refuse(
          `The field ${JSON.stringify(key)} has a default that is not one of its options.`,
        );
    }
    return {
      ok: true,
      value: {
        key,
        label: label.value,
        type: "select",
        options: options.value,
        ...(defaultValue === undefined ? {} : { default: defaultValue }),
      },
    };
  }

  if (type === "secret") {
    // `default` is not an allowed key: a secret has no authored initial value,
    // and handing one to the editor would write it in the page's own state.
    const unknown = checkKeys(entry, ["key", "label", "type"], subject);
    if (unknown !== undefined) return refuse(unknown);
    return {
      ok: true,
      value: { key, label: label.value, type: "secret" },
    };
  }

  return refuse(`${subject}.type is unknown.`);
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

  const hasFields = entry["fields"] !== undefined;
  const hasUi = entry["ui"] !== undefined;
  if (hasFields && hasUi)
    return refuse(
      `The settings page ${JSON.stringify(id.value)} declares both "fields" and "ui".`,
    );
  if (!hasFields && !hasUi)
    return refuse(
      `The settings page ${JSON.stringify(id.value)} needs "fields" or "ui".`,
    );

  if (hasFields) {
    const fields = readList(
      entry["fields"],
      `${subject}.fields`,
      readSettingsField,
    );
    if (!fields.ok) return fields;
    const seen = new Set<string>();
    for (const field of fields.value) {
      if (seen.has(field.key))
        return refuse(
          `The settings page ${JSON.stringify(id.value)} declares the field ${JSON.stringify(field.key)} twice.`,
        );
      seen.add(field.key);
    }
    return {
      ok: true,
      value: {
        id: id.value,
        label: label.value,
        ...(section === undefined ? {} : { section }),
        fields: fields.value,
      },
    };
  }

  const ui = readRelativePath(entry["ui"], `${subject}.ui`);
  if (!ui.ok) return ui;
  return {
    ok: true,
    value: {
      id: id.value,
      label: label.value,
      ...(section === undefined ? {} : { section }),
      ui: ui.value,
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
