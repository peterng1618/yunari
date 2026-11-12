import {
  ASSIGNABLE_GROUPS,
  type AssignableGroup,
  type DisplayRenderMode,
  type DisplayShape,
  isMeasurementSystem,
  isTimeZoneName,
  type MeasurementSystem,
  normalizeUnitPreferences,
  readRenderMode,
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
 * /api/devices`, `GET/PUT /api/display`, `GET/PUT /api/themes/:id/answers`.
 * The shell's Settings mode is the one settings surface: `/settings` forwards
 * to it and the old hand-written host page is deleted, so this adds no route
 * and no host-side read.
 *
 * **It is a separate client from `ThemeLibraryClient` on purpose.** That one is
 * the theme library's — listing, opening, saving, removing, and the display map
 * — and this one is the machine's. Two owners, and the routes do not overlap.
 */

/** The slots a theme's sensors are answered from, owned by `renderer-core` so
 *  the host and the editor cannot drift. */
function isAssignableGroup(value: string): value is AssignableGroup {
  return (ASSIGNABLE_GROUPS as readonly string[]).includes(value);
}

/** One device a provider reported: the id a choice stores, and the name it
 *  reports, which is what a row falls back to when it has no chosen name. */
export interface AvailableDevice {
  readonly id: string;
  readonly name: string;
}

/** The Host's devices and what has been chosen about them. */
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

/** The SignalRGB receiver's own state, carried beside the descriptor it
 *  publishes. A receiver that never bound and one this host never built are the
 *  same absence without this. */
export interface SignalRgbBridgeState {
  readonly listening: boolean;
  /** The port the socket bound, or `null` when nothing listens. */
  readonly port: number | null;
  /** The port the next host start will bind; `null` when this host keeps no
   *  such setting. */
  readonly configuredPort: number | null;
  /** Why the last bind attempt failed, in the host's words. */
  readonly error: string | null;
}

/** One independently addressable run of LEDs. */
export interface SignalRgbChannel {
  readonly name: string;
  readonly leds: number;
}

/** How LEDs are arranged on a device, as the sink declares it. `rings` is
 *  `count` rings of `width`×`height`, laid left to right one cell apart. */
export interface SignalRgbLayout {
  readonly shape: "ring" | "strip" | "rings";
  readonly width: number;
  readonly height: number;
  readonly count?: number;
}

/** One device as `GET /api/devices` describes it to the SignalRGB consumer. */
export interface SignalRgbDevice {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly lighting?: {
    readonly ledCount: number;
    readonly udpPort: number;
    readonly channels: readonly SignalRgbChannel[];
    readonly layout: SignalRgbLayout;
    readonly stats: { readonly received: number; readonly dropped: number };
  };
  readonly controls?: {
    readonly pump: boolean;
    readonly fans: boolean;
    readonly telemetry: boolean;
  };
  readonly display?: {
    readonly kind: "panel";
    readonly width: number;
    readonly height: number;
  };
}

/** The receiver's answer: its state, the devices it publishes, and the frame
 *  counters. A host with no receiver answers no devices rather than an empty
 *  description of one. */
export interface SignalRgbRead {
  readonly bridge: SignalRgbBridgeState;
  readonly devices: readonly SignalRgbDevice[];
  readonly stats?: {
    readonly received: number;
    readonly malformed: number;
    readonly dropped: number;
  };
}

/**
 * One monitor attached to this PC, as `GET /api/displays/monitors` reports it.
 *
 * The geometry is what the host uses to put a window on the screen, and the
 * serial (where the monitor reports one) is the identity a local display stores
 * so it finds the same screen after a reboot.
 */
export interface HostMonitor {
  readonly deviceName: string;
  readonly serial?: string;
  readonly main: boolean;
  readonly positionX: number;
  readonly positionY: number;
  readonly currentResX: number;
  readonly currentResY: number;
}

/** What a local display add sends: the name a person chose and the screen it is
 *  on. The host mints the id and opens the window. */
export interface LocalDisplayDraft {
  readonly label: string;
  readonly monitor: HostMonitor;
}

/** What the sign-in registrar answered. `ok` is the outcome, `message` is the
 *  registrar's own words, and `enabled` is what the OS holds afterwards — the
 *  toggle reads the write's answer rather than assuming the flip landed. */
export interface AutostartAnswer {
  readonly ok: boolean;
  readonly message: string;
  readonly enabled: boolean;
}

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
  /** The SignalRGB receiver's state and the devices it publishes. The same
   *  `GET /api/devices` answer the assignment page reads, parsed for its
   *  descriptor half. */
  readSignalRgbBridge(): Promise<SignalRgbRead>;
  /** Stores the receiver's port and answers what the host stored. The new port
   *  applies on the next host start; there is no live rebind. */
  saveSignalRgbUdpPort(port: number): Promise<number>;
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
  /** Chooses the stream a panel display is fed, and answers the one the host
   *  stored. The host restarts the panel so the new stream takes effect. */
  setDisplayRenderMode(
    id: string,
    next: DisplayRenderMode,
  ): Promise<DisplayRenderMode>;
  /** Keeps a local display's window above other windows, and answers what the
   *  host stored. The host applies it to the window that is already open. */
  setDisplayAlwaysOnTop(id: string, next: boolean): Promise<boolean>;
  /** Renames a paired display and answers the name the host stored. The id does
   *  not move with it: assignments and themes are keyed by the id minted when
   *  the display was created. */
  renameDisplay(id: string, label: string): Promise<string>;
  /** The monitors attached to this PC right now, for the add form to choose one
   *  from. A probe that fails throws rather than answering an empty list:
   *  "nothing is attached" and "the host could not find out" are different
   *  facts. */
  listMonitors(): Promise<readonly HostMonitor[]>;
  /** Adds a local display on one of those monitors and answers the id the host
   *  minted, which is what the row above selects afterwards. */
  createLocalDisplay(next: LocalDisplayDraft): Promise<string>;
  /** Removes one display record. Removing is also revoking: a paired display's
   *  credential goes with it, and so do its theme assignment and answers. */
  removeDisplay(id: string): Promise<void>;
  /** Whether the OS holds this host's start-at-sign-in entry now. A toggle has
   *  to show its state before it is pressed. */
  readAutostart(): Promise<boolean>;
  /** Turns the entry on or off, so every local display comes back after a
   *  reboot. Answers the registrar's own message and what the OS holds
   *  afterwards, which the surface shows verbatim. */
  setAutostart(enabled: boolean): Promise<AutostartAnswer>;
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
  /** Closes the panel's device and keeps it closed until a reconnect or a host
   *  restart. Removing the record stays the permanent answer. */
  disconnectPanel(id: string): Promise<PanelConnectionStatus>;
  /** Has Windows restart the USB device the panel hangs off, which clears a
   *  device that stopped taking data. Prompts for elevation; resolves once the
   *  elevated restart has finished, and the host's retry loop then reopens it. */
  resetPanelDevice(id: string): Promise<void>;
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
  /** The host's state for a present device it cannot drive, when it states one.
   *  A port another process holds is `disconnected`. */
  readonly status?: PanelConnectionStatus;
  /** Why the host cannot drive it, in the host's own words. */
  readonly reason?: string;
  /** The OS instance id, when the host can name one. A device reset acts on
   *  this, so a surface offers the action only when it is present. */
  readonly deviceId?: string;
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

/** One of the host's three panel states, or nothing when the answer is not one. */
function isPanelConnectionStatus(
  value: unknown,
): value is PanelConnectionStatus {
  return (
    value === "connected" || value === "connecting" || value === "disconnected"
  );
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
      readonly status?: unknown;
      readonly reason?: unknown;
      readonly deviceId?: unknown;
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
            ...(isPanelConnectionStatus(panel.status)
              ? { status: panel.status }
              : {}),
            ...(typeof panel.reason === "string"
              ? { reason: panel.reason }
              : {}),
            ...(typeof panel.deviceId === "string"
              ? { deviceId: panel.deviceId }
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

/** A finite number the host reported, or `undefined` where it sent none. */
function finite(input: unknown): number | undefined {
  return typeof input === "number" && Number.isFinite(input)
    ? input
    : undefined;
}

function readSignalRgbLighting(input: unknown): SignalRgbDevice["lighting"] {
  if (typeof input !== "object" || input === null) return undefined;
  const lighting = input as Record<string, unknown>;
  const ledCount = finite(lighting["ledCount"]);
  const udpPort = finite(lighting["udpPort"]);
  const layout = lighting["layout"];
  const stats = lighting["stats"];

  if (
    ledCount === undefined ||
    udpPort === undefined ||
    typeof layout !== "object" ||
    layout === null ||
    typeof stats !== "object" ||
    stats === null
  ) {
    return undefined;
  }

  const shape = (layout as Record<string, unknown>)["shape"];
  const width = finite((layout as Record<string, unknown>)["width"]);
  const height = finite((layout as Record<string, unknown>)["height"]);
  const count = finite((layout as Record<string, unknown>)["count"]);
  const received = finite((stats as Record<string, unknown>)["received"]);
  const dropped = finite((stats as Record<string, unknown>)["dropped"]);
  const channels = Array.isArray(lighting["channels"])
    ? lighting["channels"].flatMap((entry) => {
        const channel = entry as {
          readonly name?: unknown;
          readonly leds?: unknown;
        };
        const leds = finite(channel?.leds);
        return typeof channel?.name === "string" && leds !== undefined
          ? [{ name: channel.name, leds }]
          : [];
      })
    : [];

  if (
    (shape !== "ring" && shape !== "strip" && shape !== "rings") ||
    width === undefined ||
    height === undefined ||
    (shape === "rings" && count === undefined) ||
    received === undefined ||
    dropped === undefined
  ) {
    return undefined;
  }

  return {
    ledCount,
    udpPort,
    channels,
    layout: {
      shape,
      width,
      height,
      ...(shape === "rings" && count !== undefined ? { count } : {}),
    },
    stats: { received, dropped },
  };
}

/** The descriptor half of `GET /api/devices`, kept only where it has the shape
 *  a page can draw. A missing `bridge` is a host that does not answer it, which
 *  reads as not listening. */
function readSignalRgbAnswer(input: unknown): SignalRgbRead {
  const answer = (input ?? {}) as Record<string, unknown>;
  const bridge = answer["bridge"];
  const state =
    typeof bridge === "object" && bridge !== null
      ? (bridge as Record<string, unknown>)
      : {};
  const port = finite(state["port"]);
  const configuredPort = finite(state["configuredPort"]);

  return {
    bridge: {
      listening: state["listening"] === true,
      port: port ?? null,
      configuredPort: configuredPort ?? null,
      error: typeof state["error"] === "string" ? state["error"] : null,
    },
    devices: Array.isArray(answer["devices"])
      ? answer["devices"].flatMap((entry) => {
          const device = entry as Record<string, unknown>;
          if (
            typeof device["id"] !== "string" ||
            typeof device["name"] !== "string" ||
            typeof device["kind"] !== "string"
          ) {
            return [];
          }
          const lighting = readSignalRgbLighting(device["lighting"]);
          return [
            {
              id: device["id"],
              kind: device["kind"],
              name: device["name"],
              ...(lighting === undefined ? {} : { lighting }),
            },
          ];
        })
      : [],
    ...(typeof answer["stats"] === "object" && answer["stats"] !== null
      ? (() => {
          const stats = answer["stats"] as Record<string, unknown>;
          const received = finite(stats["received"]);
          const malformed = finite(stats["malformed"]);
          const dropped = finite(stats["dropped"]);
          return received === undefined ||
            malformed === undefined ||
            dropped === undefined
            ? {}
            : { stats: { received, malformed, dropped } };
        })()
      : {}),
  };
}

/** The monitors a probe reported, kept only where they carry the name and the
 *  geometry a window needs. A partial entry is dropped rather than offered as a
 *  choice the add route would read as no monitor at all. */
function readMonitors(input: unknown): readonly HostMonitor[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((entry) => {
    const monitor = entry as {
      readonly deviceName?: unknown;
      readonly serial?: unknown;
      readonly main?: unknown;
      readonly positionX?: unknown;
      readonly positionY?: unknown;
      readonly currentResX?: unknown;
      readonly currentResY?: unknown;
    };
    const geometry = [
      monitor?.positionX,
      monitor.positionY,
      monitor.currentResX,
      monitor.currentResY,
    ];
    return typeof monitor?.deviceName === "string" &&
      monitor.deviceName.length > 0 &&
      geometry.every(
        (value) => typeof value === "number" && Number.isFinite(value),
      )
      ? [
          {
            deviceName: monitor.deviceName,
            ...(typeof monitor.serial === "string" && monitor.serial !== ""
              ? { serial: monitor.serial }
              : {}),
            main: monitor.main === true,
            positionX: monitor.positionX as number,
            positionY: monitor.positionY as number,
            currentResX: monitor.currentResX as number,
            currentResY: monitor.currentResY as number,
          },
        ]
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
  // The host's own default (`DEFAULT_WEATHER_SETTINGS`): the editor is a
  // browser bundle and cannot import the Node host, so this fallback is the
  // one copy, and it must say what the owner says.
  useWindowsLocation: true,
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
    useWindowsLocation:
      typeof record["useWindowsLocation"] === "boolean"
        ? record["useWindowsLocation"]
        : DEFAULT_WEATHER.useWindowsLocation,
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

    async readSignalRgbBridge(): Promise<SignalRgbRead> {
      const response = await fetcher(`${baseUrl}/api/devices`);
      if (!response.ok) {
        throw await refusal(response, "Could not read the SignalRGB bridge");
      }
      return readSignalRgbAnswer(await response.json());
    },

    async saveSignalRgbUdpPort(port: number): Promise<number> {
      const response = await fetcher(`${baseUrl}/api/signalrgb-bridge`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ udpPort: port }),
      });
      if (!response.ok) {
        throw await refusal(response, "Could not save the bridge port");
      }
      const saved = finite(
        ((await response.json()) as { readonly udpPort?: unknown })?.udpPort,
      );
      if (saved === undefined) {
        throw new Error("The host saved a port it did not answer.");
      }
      return saved;
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

    async setDisplayRenderMode(id, next) {
      const response = await fetcher(
        `${baseUrl}/api/displays/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ renderMode: next }),
        },
      );
      if (!response.ok) {
        throw await refusal(
          response,
          "Could not save the display's rendering mode",
        );
      }
      const body = (await response.json()) as { readonly renderMode?: unknown };
      return readRenderMode(body?.renderMode);
    },

    async setDisplayAlwaysOnTop(id, next) {
      const response = await fetcher(
        `${baseUrl}/api/displays/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ alwaysOnTop: next }),
        },
      );
      if (!response.ok) {
        throw await refusal(
          response,
          "Could not save the display's always-on-top setting",
        );
      }
      const body = (await response.json()) as {
        readonly alwaysOnTop?: unknown;
      };
      return body?.alwaysOnTop === true;
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

    async listMonitors(): Promise<readonly HostMonitor[]> {
      const response = await fetcher(`${baseUrl}/api/displays/monitors`);
      if (!response.ok) {
        throw await refusal(response, "Could not list the monitors");
      }
      const body = (await response.json()) as { readonly monitors?: unknown };
      return readMonitors(body?.monitors);
    },

    async createLocalDisplay(next): Promise<string> {
      const response = await fetcher(`${baseUrl}/api/displays`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The hint, not the probe entry: the record keeps what finds the screen
        // again, and the geometry is read from the OS on every launch.
        body: JSON.stringify({
          label: next.label,
          monitor: {
            deviceName: next.monitor.deviceName,
            ...(next.monitor.serial === undefined
              ? {}
              : { serial: next.monitor.serial }),
          },
        }),
      });
      if (!response.ok) {
        throw await refusal(response, "Could not add that display");
      }
      const body = (await response.json()) as { readonly display?: unknown };
      const added = body?.display as { readonly id?: unknown } | undefined;
      if (typeof added?.id !== "string" || added.id === "") {
        throw new Error("The host did not report the display it added.");
      }
      return added.id;
    },

    async removeDisplay(id): Promise<void> {
      const response = await fetcher(
        `${baseUrl}/api/displays/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        throw await refusal(response, "Could not remove that display");
      }
    },

    async readAutostart(): Promise<boolean> {
      const response = await fetcher(`${baseUrl}/api/displays/autostart`);
      if (!response.ok) {
        throw await refusal(response, "Could not read the sign-in setting");
      }
      const body = (await response.json()) as { readonly enabled?: unknown };
      if (typeof body?.enabled !== "boolean") {
        throw new Error("The host did not report its sign-in setting.");
      }
      return body.enabled;
    },

    async setAutostart(enabled): Promise<AutostartAnswer> {
      const response = await fetcher(`${baseUrl}/api/displays/autostart`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) {
        throw await refusal(response, "Could not change the sign-in setting");
      }
      const body = (await response.json()) as {
        readonly ok?: unknown;
        readonly message?: unknown;
        readonly enabled?: unknown;
      };
      if (
        typeof body?.ok !== "boolean" ||
        typeof body.message !== "string" ||
        typeof body.enabled !== "boolean"
      ) {
        throw new Error("The host did not report the sign-in setting.");
      }
      return { ok: body.ok, message: body.message, enabled: body.enabled };
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
      return isPanelConnectionStatus(body?.status)
        ? body.status
        : "disconnected";
    },

    async disconnectPanel(id) {
      const response = await fetcher(
        `${baseUrl}/api/displays/${encodeURIComponent(id)}/panel/disconnect`,
        { method: "POST" },
      );
      if (!response.ok) {
        throw await refusal(response, "Could not disconnect that panel");
      }
      const body = (await response.json()) as { readonly status?: unknown };
      return isPanelConnectionStatus(body?.status)
        ? body.status
        : "disconnected";
    },

    async resetPanelDevice(id) {
      const response = await fetcher(
        `${baseUrl}/api/displays/${encodeURIComponent(id)}/panel/reset-device`,
        { method: "POST" },
      );
      if (!response.ok) {
        // The host's words carry the USB error or a declined prompt; a generic
        // sentence here would hide the one thing the person has to act on.
        throw await refusal(
          response,
          "Could not restart that panel's USB device",
        );
      }
    },
  };
}
