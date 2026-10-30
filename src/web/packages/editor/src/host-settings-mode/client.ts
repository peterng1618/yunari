import {
  type DisplayShape,
  isMeasurementSystem,
  isTimeZoneName,
  type MeasurementSystem,
  normalizeUnitPreferences,
  type UnitPreferences,
} from "@yunari/renderer-core";
import {
  type PanelConnectionStatus,
  readDisplayPresentation,
} from "../theme-library-client.js";

/**
 * The editor's seam to the host's own settings: which hardware this PC reports,
 * how its readings are displayed, and the hardware one theme on one display
 * reads.
 *
 * **Every call below is a route the host already serves** — `GET/PUT
 * /api/devices`, `GET/PUT /api/display`, `GET/PUT /api/themes/:id/answers` — and
 * these are the three routes `packages/host/public/settings.html` reads. The
 * shell's Host mode is that page rebuilt in React, so this adds no route and no
 * host-side read.
 *
 * **It is a separate client from `ThemeLibraryClient` on purpose.** That one is
 * the theme library's — listing, opening, saving, removing, and the display map
 * — and this one is the machine's. Two owners, and the routes do not overlap.
 */

/** The slots a theme's sensors are answered from. Spelled here rather than
 *  imported: the editor has no dependency on the host package. The three are
 *  the host's own `ASSIGNABLE_GROUPS`, and the routes filter to them on both
 *  sides, so a fourth would arrive at neither. */
export type AssignableGroup = "gpu" | "system-disk" | "data-disk";

const ASSIGNABLE_GROUPS: readonly AssignableGroup[] = [
  "gpu",
  "system-disk",
  "data-disk",
];

function isAssignableGroup(value: string): value is AssignableGroup {
  return (ASSIGNABLE_GROUPS as readonly string[]).includes(value);
}

/** One device a provider reported: the id a choice stores, and the name it
 *  reports, which is what a row falls back to when it has no chosen name. */
export interface AvailableDevice {
  readonly id: string;
  readonly name: string;
}

/** This PC's devices and what has been chosen about them. */
export interface DeviceSettings {
  readonly available: {
    readonly gpus: readonly AvailableDevice[];
    readonly disks: readonly AvailableDevice[];
  };
  /** The chosen device per slot. An absent slot is the automatic choice, which
   *  is the absence of a choice rather than a device of that name. */
  readonly assigned: Readonly<Partial<Record<AssignableGroup, string>>>;
  /** Names by device id. A device with no entry uses the name it reports. */
  readonly names: Readonly<Record<string, string>>;
}

/** What a display sends to answer one theme's questions: a device per slot, and
 *  the slot absent where the theme follows this PC's own device settings. */
export type ThemeAnswers = Readonly<Partial<Record<AssignableGroup, string>>>;

export interface DisplayPreferences {
  /** The zone the reading is shown in. Absent is this PC's own zone — the
   *  absence of a choice, which the route also writes from `""`. */
  readonly timeZone?: string;
  readonly measurement?: MeasurementSystem;
  /** The per-family display units this build can display. */
  readonly units?: UnitPreferences;
}

/** What the display form sends: every field always, because the route replaces
 *  the whole object and saving one field would clear the others. */
export interface DisplayPreferencesWrite {
  readonly timeZone: string;
  readonly measurement: MeasurementSystem;
  readonly units?: UnitPreferences;
}

/** The weather backends the host knows. Spelled here rather than imported: the
 *  editor has no dependency on the host package. */
export type WeatherProviderId = "open-meteo" | "weatherapi" | "openweathermap";

export const WEATHER_PROVIDERS: readonly WeatherProviderId[] = [
  "open-meteo",
  "weatherapi",
  "openweathermap",
];

export function isWeatherProvider(value: unknown): value is WeatherProviderId {
  return (WEATHER_PROVIDERS as readonly unknown[]).includes(value);
}

/** Where this PC's weather comes from, and the place it is for. `label` is
 *  empty when no manual place has been chosen. */
export interface WeatherSettings {
  readonly provider: WeatherProviderId;
  readonly label: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly useWindowsLocation: boolean;
  readonly pollIntervalMs: number;
}

/** The credit a weather backend asks for, with the page it links to. */
export interface WeatherAttribution {
  readonly text: string;
  readonly url: string;
}

/** The settings plus the selected backend's credit, when the host sent one. */
export interface WeatherRead extends WeatherSettings {
  readonly attribution?: WeatherAttribution;
}

/** One place the geocoder found. */
export interface WeatherPlace {
  readonly label: string;
  readonly latitude: number;
  readonly longitude: number;
}

export interface HostSettingsClient {
  readDevices(): Promise<DeviceSettings>;
  /** Writes the whole object, because the route replaces it: a caller merges
   *  its own change in and sends both fields. Answers what was written, which
   *  is the settings file's own reading of it rather than the caller's. */
  saveDevices(next: {
    readonly assigned: Readonly<Partial<Record<AssignableGroup, string>>>;
    readonly names: Readonly<Record<string, string>>;
  }): Promise<{
    readonly assigned: Readonly<Partial<Record<AssignableGroup, string>>>;
    readonly names: Readonly<Record<string, string>>;
  }>;
  readDisplay(): Promise<{
    readonly settings: DisplayPreferences;
    readonly zones: readonly string[];
  }>;
  saveDisplay(next: DisplayPreferencesWrite): Promise<DisplayPreferences>;
  readWeather(): Promise<WeatherRead>;
  /** Writes the whole object: the route replaces it. A blank label is omitted,
   *  because an absent one is no manual place while an empty one is refused. */
  saveWeather(next: WeatherSettings): Promise<WeatherRead>;
  /** The places a search finds, from the host's keyless geocoder. */
  searchPlaces(query: string): Promise<readonly WeatherPlace[]>;
  /** Which slots the theme on that display reads, and the answers it already
   *  has. The `required` list is the host's own `requiredDeviceGroups` run
   *  against the theme's document — derived, never authored here. */
  readQuestions(
    display: string,
    theme: string,
  ): Promise<{
    readonly required: readonly AssignableGroup[];
    readonly answers: ThemeAnswers;
  }>;
  saveQuestions(
    display: string,
    theme: string,
    answers: ThemeAnswers,
  ): Promise<ThemeAnswers>;
  /** Writes a paired display's glass and mounting angle, and answers the
   *  record's own reading of them. Both fields travel: a shape change decides
   *  the rule the angle has to satisfy, so the store decides the pair together. */
  updateDisplayPresentation(
    id: string,
    next: { readonly shape: DisplayShape; readonly rotation: number },
  ): Promise<{ readonly shape: DisplayShape; readonly rotation: number }>;
  /** Renames a paired display and answers the name the host stored. The id does
   *  not move with it: assignments and themes are keyed by the id minted when
   *  the display was created. */
  renameDisplay(id: string, label: string): Promise<string>;
  /** The USB panels attached to this PC right now, as the hardware reports
   *  them. A panel is *found* rather than admitted, so this is a list to choose
   *  from and implies no record. */
  listPanels(): Promise<readonly PanelHint[]>;
  /** Adds the chosen panel as a display and starts driving it. Answers the id
   *  the host minted, which is what the row above selects afterwards. */
  addPanel(label: string, panel: PanelHardware): Promise<string>;
  /** Sends one control command over a panel's control channel and answers the
   *  panel's own reply text; empty when the device said nothing, which is every
   *  write-only command. A refusal is thrown in the host's words, which is the
   *  only way a stopped or closed port reaches the person. */
  panelCommand(id: string, command: EditorPanelCommand): Promise<string>;
  /** Stops and opens the panel's device again. Answers the state the host
   *  reached, so a caller can say what happened without waiting for a poll. */
  reconnectPanel(id: string): Promise<PanelConnectionStatus>;
}

/** One command the editor can send a panel, spelled as the host's route takes
 *  it: the body is the command itself rather than a wrapper around it. */
export type EditorPanelCommand =
  | { readonly kind: "brightness"; readonly level: number }
  | { readonly kind: "screen"; readonly on: boolean }
  | {
      readonly kind: "panel-settings";
      readonly startMode: 0 | 1 | 2;
      readonly flip: boolean;
      readonly sleepDelay: number;
    }
  | { readonly kind: "restart" }
  | { readonly kind: "status" }
  | { readonly kind: "hello" };

/** The commands a panel's control channel accepts. Spelled here rather than
 *  imported: the editor has no dependency on the host package, the same reason
 *  `PanelHardware` is a second declaration. */
export type PanelCommandKind =
  | "brightness"
  | "screen"
  | "panel-settings"
  | "restart"
  | "status"
  | "hello";

const PANEL_COMMAND_KINDS: readonly PanelCommandKind[] = [
  "brightness",
  "screen",
  "panel-settings",
  "restart",
  "status",
  "hello",
];

/** What the host's family table records about a panel it drives. */
export interface PanelSupport {
  readonly maker: string;
  readonly hardwareRevision: string;
  readonly supportedFirmware: readonly string[];
  /** ISO date, `YYYY-MM-DD`: the last day the driver met this hardware. */
  readonly updatedAt: string;
}

/** One attached panel, as the host enumerates it. `vendorId`/`productId` are
 *  what the record stores, so they travel back on the add. */
export interface PanelHint {
  readonly vendorId: number;
  readonly productId: number;
  readonly serial: string;
  readonly label: string;
  /** True when a record already drives this device. The host answers it because
   *  it holds both lists; a client cannot derive it, since the display map
   *  carries no hardware. */
  readonly held: boolean;
  /** The record driving this device, when one does: the display whose row this
   *  device's hardware record belongs to. */
  readonly heldId?: string;
  /** The support record this host's driver states, when a driver claims it. */
  readonly support?: PanelSupport;
  /** The model string the firmware reports, when it reports one. */
  readonly model?: string;
  /** The firmware version the device answers, when it answers one. */
  readonly firmware?: string;
  /** The commands this host can send it; empty for a picture-only panel. */
  readonly commands: readonly PanelCommandKind[];
}

/** The device fields a record holds. `model` is deliberately absent: the host
 *  writes the model its own family table names, so a caller cannot add a record
 *  whose model disagrees with the driver that claims it. */
export interface PanelHardware {
  readonly vendorId: number;
  readonly productId: number;
  readonly serial: string;
}

/** The support record this build can print, or nothing when the host's answer
 *  is not that shape: a half-read record would state a hardware fact the host
 *  never made. */
function readSupport(input: unknown): PanelSupport | undefined {
  if (typeof input !== "object" || input === null) return undefined;

  const record = input as {
    readonly maker?: unknown;
    readonly hardwareRevision?: unknown;
    readonly supportedFirmware?: unknown;
    readonly updatedAt?: unknown;
  };
  const { maker, hardwareRevision, supportedFirmware, updatedAt } = record;

  if (
    typeof maker !== "string" ||
    typeof hardwareRevision !== "string" ||
    typeof updatedAt !== "string" ||
    !Array.isArray(supportedFirmware) ||
    !supportedFirmware.every((version) => typeof version === "string")
  ) {
    return undefined;
  }

  return {
    maker,
    hardwareRevision,
    supportedFirmware: supportedFirmware as readonly string[],
    updatedAt,
  };
}

function isPanelCommandKind(value: unknown): value is PanelCommandKind {
  return (PANEL_COMMAND_KINDS as readonly unknown[]).includes(value);
}

/** The attached panels worth offering. An entry is kept only where it carries
 *  the ids a record needs — a row the add route would refuse is not a choice. */
function readPanelHints(input: unknown): readonly PanelHint[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((entry) => {
    const panel = entry as {
      readonly vendorId?: unknown;
      readonly productId?: unknown;
      readonly serial?: unknown;
      readonly label?: unknown;
      readonly held?: unknown;
      readonly heldId?: unknown;
      readonly support?: unknown;
      readonly model?: unknown;
      readonly firmware?: unknown;
      readonly commands?: unknown;
    };

    const support = readSupport(panel?.support);

    return typeof panel?.vendorId === "number" &&
      typeof panel.productId === "number" &&
      typeof panel.serial === "string"
      ? [
          {
            vendorId: panel.vendorId,
            productId: panel.productId,
            serial: panel.serial,
            label:
              typeof panel.label === "string" && panel.label.length > 0
                ? panel.label
                : `${panel.vendorId.toString(16)}:${panel.productId.toString(16)}`,
            // A host that does not answer `held` is one before this field: read
            // it as not held so the offer still appears, which the route's own
            // 409 can still refuse honestly.
            held: panel.held === true,
            ...(typeof panel.heldId === "string"
              ? { heldId: panel.heldId }
              : {}),
            ...(support === undefined ? {} : { support }),
            ...(typeof panel.model === "string" ? { model: panel.model } : {}),
            ...(typeof panel.firmware === "string"
              ? { firmware: panel.firmware }
              : {}),
            // An older host names no commands: read it as a picture-only panel,
            // which is what the host before the field could drive.
            commands: Array.isArray(panel.commands)
              ? panel.commands.filter(isPanelCommandKind)
              : [],
          },
        ]
      : [];
  });
}

/** A device a provider reported, kept only where it has the shape one reads. */
function readDevices(input: unknown): readonly AvailableDevice[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((entry) => {
    const device = entry as { readonly id?: unknown; readonly name?: unknown };
    return typeof device?.id === "string" && typeof device.name === "string"
      ? [{ id: device.id, name: device.name }]
      : [];
  });
}

/** The stored settings, keeping only the slots this build knows: a group a
 *  newer host named is one no control here could offer, and inventing a row for
 *  it would be a question with no answer. */
function readAssigned(
  input: unknown,
): Partial<Record<AssignableGroup, string>> {
  if (typeof input !== "object" || input === null) return {};
  const assigned: Partial<Record<AssignableGroup, string>> = {};
  for (const [group, device] of Object.entries(
    input as Record<string, unknown>,
  )) {
    if (typeof device === "string" && isAssignableGroup(group)) {
      assigned[group] = device;
    }
  }
  return assigned;
}

function readNames(input: unknown): Record<string, string> {
  if (typeof input !== "object" || input === null) return {};
  const names: Record<string, string> = {};
  for (const [id, name] of Object.entries(input as Record<string, unknown>)) {
    if (typeof name === "string" && name.length > 0) names[id] = name;
  }
  return names;
}

/** The unit preferences this build can display. A stored value it cannot is
 *  dropped rather than printed, the same refusal the zone gets: the control
 *  would otherwise show a value it cannot offer. */
function readUnits(input: unknown): UnitPreferences {
  try {
    return normalizeUnitPreferences(input ?? {});
  } catch {
    return {};
  }
}

/** The credit the selected backend names, or nothing when the host's answer is
 *  not the shape this build can link: an anchor here must never carry a value
 *  no backend asked to be shown. */
function readAttribution(input: unknown): WeatherAttribution | undefined {
  if (typeof input !== "object" || input === null) return undefined;

  const record = input as { readonly text?: unknown; readonly url?: unknown };
  const { text, url } = record;

  if (typeof text !== "string" || text === "") return undefined;
  if (typeof url !== "string") return undefined;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return undefined;
    }
  } catch {
    return undefined;
  }

  return { text, url };
}

/** The weather settings a host is expected to answer, keeping only the fields
 *  this build can draw. The host normalizes its own file, so a value outside
 *  these ranges is a shape this build did not expect rather than a person's
 *  choice, and the defaults are safer than printing it. */
const DEFAULT_WEATHER: WeatherSettings = {
  provider: "open-meteo",
  label: "",
  latitude: 0,
  longitude: 0,
  useWindowsLocation: false,
  pollIntervalMs: 600_000,
};

function numberInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
    ? value
    : fallback;
}

function readWeatherSettings(input: unknown): WeatherSettings {
  const record = (
    typeof input === "object" && input !== null ? input : {}
  ) as Record<string, unknown>;

  return {
    provider: isWeatherProvider(record["provider"])
      ? record["provider"]
      : DEFAULT_WEATHER.provider,
    label: typeof record["label"] === "string" ? record["label"] : "",
    latitude: numberInRange(record["latitude"], 0, -90, 90),
    longitude: numberInRange(record["longitude"], 0, -180, 180),
    useWindowsLocation: record["useWindowsLocation"] === true,
    pollIntervalMs: numberInRange(
      record["pollIntervalMs"],
      DEFAULT_WEATHER.pollIntervalMs,
      60_000,
      86_400_000,
    ),
  };
}

function readWeather(input: unknown, attribution: unknown): WeatherRead {
  const credit = readAttribution(attribution);

  return {
    ...readWeatherSettings(input),
    ...(credit === undefined ? {} : { attribution: credit }),
  };
}

function readPlaces(input: unknown): readonly WeatherPlace[] {
  if (!Array.isArray(input)) return [];

  return input.flatMap((entry) => {
    const record = (entry ?? {}) as {
      readonly label?: unknown;
      readonly latitude?: unknown;
      readonly longitude?: unknown;
    };

    return typeof record.label === "string" &&
      typeof record.latitude === "number" &&
      Number.isFinite(record.latitude) &&
      typeof record.longitude === "number" &&
      Number.isFinite(record.longitude)
      ? [
          {
            label: record.label,
            latitude: record.latitude,
            longitude: record.longitude,
          },
        ]
      : [];
  });
}

/** A refusal is the host's own words where it sent any, so the person reads the
 *  reason rather than a status code. */
async function refusal(response: Response, what: string): Promise<Error> {
  const text = await response.text().catch(() => "");
  return new Error(text.trim() === "" ? `${what} (${response.status}).` : text);
}

export function createHostSettingsClient(options?: {
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
}): HostSettingsClient {
  const fetcher = options?.fetch ?? globalThis.fetch.bind(globalThis);
  const baseUrl = options?.baseUrl ?? "";

  const readDeviceSettings = (body: unknown): DeviceSettings => {
    const answer = body as {
      readonly available?: {
        readonly gpus?: unknown;
        readonly disks?: unknown;
      };
      readonly assigned?: {
        readonly assigned?: unknown;
        readonly names?: unknown;
      };
    };
    return {
      available: {
        gpus: readDevices(answer?.available?.gpus),
        disks: readDevices(answer?.available?.disks),
      },
      assigned: readAssigned(answer?.assigned?.assigned),
      names: readNames(answer?.assigned?.names),
    };
  };

  return {
    async readDevices(): Promise<DeviceSettings> {
      const response = await fetcher(`${baseUrl}/api/devices`);
      if (!response.ok) {
        throw await refusal(response, "Could not read the devices");
      }
      return readDeviceSettings(await response.json());
    },

    async saveDevices(next) {
      const response = await fetcher(`${baseUrl}/api/devices`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assigned: next.assigned, names: next.names }),
      });
      if (!response.ok) {
        throw await refusal(response, "Could not save the devices");
      }
      // Only what was written. The route answers no availability on a write, and
      // a device list invented here would be a list of no devices.
      const saved = readDeviceSettings(await response.json());
      return { assigned: saved.assigned, names: saved.names };
    },

    async readDisplay() {
      const response = await fetcher(`${baseUrl}/api/display`);
      if (!response.ok) {
        throw await refusal(response, "Could not read the display settings");
      }
      const body = (await response.json()) as {
        readonly settings?: {
          readonly timeZone?: unknown;
          readonly measurement?: unknown;
          readonly units?: unknown;
        };
        readonly zones?: unknown;
      };
      const zone = body?.settings?.timeZone;
      const measurement = body?.settings?.measurement;
      const units = readUnits(body?.settings?.units);
      return {
        // A stored value this runtime can no longer resolve is refused rather
        // than printed: the control would otherwise show a zone it cannot
        // offer, and the person could not tell it from a choice.
        settings: {
          ...(typeof zone === "string" && isTimeZoneName(zone)
            ? { timeZone: zone }
            : {}),
          ...(isMeasurementSystem(measurement) ? { measurement } : {}),
          ...(Object.keys(units).length > 0 ? { units } : {}),
        },
        zones: Array.isArray(body?.zones)
          ? body.zones.filter(
              (name): name is string => typeof name === "string",
            )
          : [],
      };
    },

    async saveDisplay(next): Promise<DisplayPreferences> {
      const response = await fetcher(`${baseUrl}/api/display`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        // Every field travels: the route replaces the whole object, so a save
        // of one would clear the others.
        body: JSON.stringify({
          timeZone: next.timeZone,
          measurement: next.measurement,
          units: next.units ?? {},
        }),
      });
      if (!response.ok) {
        throw await refusal(response, "Could not save the display settings");
      }
      const body = (await response.json()) as {
        readonly settings?: {
          readonly timeZone?: unknown;
          readonly measurement?: unknown;
          readonly units?: unknown;
        };
      };
      const zone = body?.settings?.timeZone;
      const measurement = body?.settings?.measurement;
      const units = readUnits(body?.settings?.units);
      return {
        ...(typeof zone === "string" && isTimeZoneName(zone)
          ? { timeZone: zone }
          : {}),
        ...(isMeasurementSystem(measurement) ? { measurement } : {}),
        ...(Object.keys(units).length > 0 ? { units } : {}),
      };
    },

    async readWeather(): Promise<WeatherRead> {
      const response = await fetcher(`${baseUrl}/api/weather/settings`);
      if (!response.ok) {
        throw await refusal(response, "Could not read the weather settings");
      }
      const body = (await response.json()) as {
        readonly settings?: unknown;
        readonly attribution?: unknown;
      };
      return readWeather(body?.settings, body?.attribution);
    },

    async saveWeather(next): Promise<WeatherRead> {
      const response = await fetcher(`${baseUrl}/api/weather/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        // The route replaces the whole object. A blank label is left out
        // rather than sent: an absent one is no manual place, while an empty
        // one is the refusal of a place that has no name.
        body: JSON.stringify({
          provider: next.provider,
          ...(next.label === "" ? {} : { label: next.label }),
          latitude: next.latitude,
          longitude: next.longitude,
          useWindowsLocation: next.useWindowsLocation,
          pollIntervalMs: next.pollIntervalMs,
        }),
      });
      if (!response.ok) {
        throw await refusal(response, "Could not save the weather settings");
      }
      const body = (await response.json()) as {
        readonly settings?: unknown;
        readonly attribution?: unknown;
      };
      return readWeather(body?.settings, body?.attribution);
    },

    async searchPlaces(query): Promise<readonly WeatherPlace[]> {
      const response = await fetcher(
        `${baseUrl}/api/weather/places?q=${encodeURIComponent(query)}`,
      );
      if (!response.ok) {
        throw await refusal(response, "Could not search for a place");
      }
      const body = (await response.json()) as { readonly places?: unknown };
      return readPlaces(body?.places);
    },

    async readQuestions(display, theme) {
      const response = await fetcher(
        `${baseUrl}/api/themes/${encodeURIComponent(theme)}/answers` +
          `?display=${encodeURIComponent(display)}`,
      );
      if (!response.ok) {
        throw await refusal(response, "Could not read this theme's questions");
      }
      const body = (await response.json()) as {
        readonly required?: unknown;
        readonly answers?: unknown;
      };
      return {
        required: Array.isArray(body?.required)
          ? body.required.filter(
              (group): group is AssignableGroup =>
                typeof group === "string" && isAssignableGroup(group),
            )
          : [],
        answers: readAssigned(body?.answers),
      };
    },

    async saveQuestions(display, theme, answers): Promise<ThemeAnswers> {
      const response = await fetcher(
        `${baseUrl}/api/themes/${encodeURIComponent(theme)}/answers` +
          `?display=${encodeURIComponent(display)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(answers),
        },
      );
      if (!response.ok) {
        throw await refusal(response, "Could not save the answer");
      }
      const body = (await response.json()) as { readonly answers?: unknown };
      return readAssigned(body?.answers);
    },

    async updateDisplayPresentation(id, next) {
      const response = await fetcher(
        `${baseUrl}/api/displays/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ shape: next.shape, rotation: next.rotation }),
        },
      );
      if (!response.ok) {
        throw await refusal(response, "Could not save the display's shape");
      }
      const body = (await response.json()) as {
        readonly shape?: unknown;
        readonly rotation?: unknown;
      };
      return readDisplayPresentation(body?.shape, body?.rotation);
    },

    async renameDisplay(id, label) {
      const response = await fetcher(
        `${baseUrl}/api/displays/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ label }),
        },
      );
      if (!response.ok) {
        throw await refusal(response, "Could not save the display's name");
      }
      const body = (await response.json()) as { readonly label?: unknown };
      if (typeof body?.label !== "string") {
        throw new Error("The host did not report the display's name.");
      }
      return body.label;
    },

    async listPanels() {
      const response = await fetcher(`${baseUrl}/api/displays/panels`);
      if (!response.ok) {
        throw await refusal(response, "Could not list the attached panels");
      }
      const body = (await response.json()) as { readonly panels?: unknown };
      return readPanelHints(body?.panels);
    },

    async addPanel(label, panel) {
      const response = await fetcher(`${baseUrl}/api/displays/panels`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label, panel }),
      });
      if (!response.ok) {
        throw await refusal(response, "Could not add that panel");
      }
      const body = (await response.json()) as { readonly display?: unknown };
      const added = body?.display as { readonly id?: unknown } | undefined;
      return typeof added?.id === "string" ? added.id : "";
    },

    async panelCommand(id, command) {
      const response = await fetcher(
        `${baseUrl}/api/displays/${encodeURIComponent(id)}/panel/command`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(command),
        },
      );
      if (!response.ok) {
        // Every failure is a plain-text body, and `refusal` already throws its
        // words: a 409's "port is closing" must reach the person verbatim.
        throw await refusal(response, "Could not send the panel command");
      }
      const body = (await response.json()) as { readonly reply?: unknown };
      return typeof body?.reply === "string" ? body.reply : "";
    },

    async reconnectPanel(id) {
      const response = await fetcher(
        `${baseUrl}/api/displays/${encodeURIComponent(id)}/panel/reconnect`,
        { method: "POST" },
      );
      if (!response.ok) {
        throw await refusal(response, "Could not reconnect that panel");
      }
      const body = (await response.json()) as { readonly status?: unknown };
      // An answer this build cannot read is the state it just failed to enter;
      // the caller re-reads the map anyway, so nothing is invented here.
      return body?.status === "connected" ||
        body?.status === "connecting" ||
        body?.status === "disconnected"
        ? body.status
        : "disconnected";
    },
  };
}
