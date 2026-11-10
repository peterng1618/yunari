import type {
  AssignableGroup,
  DisplayRenderMode,
  UnitPreferences,
} from "@yunari/renderer-core";
import { useEffect, useRef, useState } from "react";
import {
  createThemeLibraryClient,
  DEFAULT_DISPLAY_KEY,
  type ThemedDisplay,
  type ThemeLibraryClient,
  type ThemeLibraryEntry,
} from "../theme-library-client.js";
import { uiCopy } from "../ui-copy.js";
import {
  type AvailableDevice,
  createHostSettingsClient,
  type DeviceSettings,
  type DisplayPreferences,
  type HostMonitor,
  type HostSettingsClient,
  type PanelHint,
  type ThemeAnswers,
} from "./client.js";
import { shownTheme } from "./displays-section.js";
import { createSourcesClient, type SourcesClient } from "./sources-client.js";

/** The slots a theme raises that nothing has answered yet, in the order the
 *  route named them. An answered slot leaves the list, which is what makes
 *  answering a question the thing that removes it. */
export function unanswered(
  required: readonly AssignableGroup[],
  answers: ThemeAnswers,
): readonly AssignableGroup[] {
  return required.filter((group) => answers[group] === undefined);
}

/** The devices one slot offers, in the order the provider reported them. */
export function devicesFor(
  settings: DeviceSettings,
  group: AssignableGroup,
): readonly AvailableDevice[] {
  return group === "gpu" ? settings.available.gpus : settings.available.disks;
}

/** Whether a slot is a question at all.
 *
 *  **One device answers itself**: the host's automatic choice is the first
 *  device of the group, so with exactly one there is nothing a dropdown could
 *  change and nothing a theme answer could add. Both surfaces ask this one
 *  question rather than repeating the count — the Hardware page states the
 *  device instead of offering it, and a theme's raised slot is not asked. */
export function asksWhichDevice(
  settings: DeviceSettings,
  group: AssignableGroup,
): boolean {
  return devicesFor(settings, group).length > 1;
}

/** Every device this PC reported, the two lists in the order the pages draw
 *  them: the cards first, then the drives. */
export function everyDevice(
  settings: DeviceSettings,
): readonly AvailableDevice[] {
  return [...settings.available.gpus, ...settings.available.disks];
}

/** The unit families the display form offers, in its order. `measurement` is
 *  not among them: temperatures have their own row, whose systems read as names
 *  rather than unit marks. */
export const UNIT_FIELDS = [
  "clock",
  "data",
  "dataScale",
  "rate",
  "rateScale",
  "windSpeed",
  "pressure",
] as const;

export type UnitField = (typeof UNIT_FIELDS)[number];

/** What a device is called: the name chosen for it, else the one it reports. */
export function nameOfDevice(
  settings: DeviceSettings,
  device: AvailableDevice,
): string {
  return settings.names[device.id] ?? device.name;
}

/** What a slot's row is labelled, which is its own question where the count of
 *  devices cannot answer it. */
export function groupQuestion(
  settings: DeviceSettings,
  group: AssignableGroup,
): string {
  const options = devicesFor(settings, group);
  const only = options[0];
  return (
    uiCopy.hostSettings.devices.asked[group] ??
    // One device is not a question, so the label answers it rather than leaving
    // the answer in a dropdown above a fallback that names no device at all.
    (options.length === 1 && only !== undefined
      ? uiCopy.hostSettings.devices.onlyOne(nameOfDevice(settings, only))
      : uiCopy.hostSettings.devices.question)
  );
}

/** A message a person can act on: the host's own words where it sent any. */
function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Everything the Settings host pages read and write, in one controller.
 *
 *  **Nothing here is persisted**: leaving the mode and coming back reads the
 *  host again, which is what makes the surface the host's answer rather than a
 *  copy of it. The controller is mounted for the whole life of the Settings
 *  region; the pages are its consumers. */
export interface HostState {
  readonly displays: readonly ThemedDisplay[];
  readonly selected: string | undefined;
  readonly selectedRow: ThemedDisplay | undefined;
  readonly fallback: string | null;
  readonly showing: string | null;
  readonly selectedPanel: PanelHint | undefined;
  readonly hasPanelDisplay: boolean;
  readonly mapUnreadable: boolean;
  readonly themes: readonly ThemeLibraryEntry[];
  readonly devices: DeviceSettings | undefined;
  readonly preferences:
    | {
        readonly settings: DisplayPreferences;
        readonly zones: readonly string[];
      }
    | undefined;
  readonly questions:
    | {
        readonly required: readonly AssignableGroup[];
        readonly answers: ThemeAnswers;
      }
    | undefined;
  readonly asked: readonly AssignableGroup[];
  readonly panels: readonly PanelHint[] | undefined;
  readonly addingPanel: boolean;
  readonly status: string | undefined;
  /** The display count line, or `null` before a read answered. */
  readonly displayCount: string | null;
  readonly sourcesClient: SourcesClient;
  readonly settingsClient: HostSettingsClient;
  readonly nameOfTheme: (id: string) => string;
  readonly chooseDisplay: (id: string) => void;
  /** One write, one status line. Exposed because a page's section owns its own
   *  write affordance and the status sentence is this controller's. */
  readonly write: (run: () => Promise<string>) => void;
  readonly saveDevices: (patch: {
    readonly assigned?: Partial<Record<AssignableGroup, string>>;
    readonly names?: Readonly<Record<string, string>>;
  }) => void;
  readonly saveDisplay: (
    next: {
      readonly timeZone: string;
      readonly measurement: string;
      readonly units: UnitPreferences;
    },
    saved: string,
  ) => void;
  readonly saveUnit: (field: UnitField, value: string) => void;
  readonly answer: (group: AssignableGroup, device: string) => void;
  readonly replaceName: (id: string, label: string) => void;
  readonly replacePresentation: (
    id: string,
    saved: {
      readonly shape: ThemedDisplay["shape"];
      readonly rotation: number;
    },
  ) => void;
  /** Writes the stream a panel display is fed into the row the host answered,
   *  so the toggle stands on what was stored rather than on the click. */
  readonly replaceRenderMode: (id: string, saved: DisplayRenderMode) => void;
  readonly reconnectPanel: (id: string) => Promise<void>;
  readonly disconnectPanel: (id: string) => Promise<void>;
  readonly addPanel: (panel: PanelHint) => void;
  readonly addDisplay: (
    label: string,
    monitor: HostMonitor,
  ) => Promise<boolean>;
  readonly removeDisplay: (display: ThemedDisplay) => Promise<boolean>;
  readonly report: (status: string) => void;
}

export function useHostSettings(props: {
  readonly client?: ThemeLibraryClient | undefined;
  readonly settings?: HostSettingsClient | undefined;
  readonly sources?: SourcesClient | undefined;
}): HostState {
  const [client] = useState(() => props.client ?? createThemeLibraryClient());
  const [settings] = useState(
    () => props.settings ?? createHostSettingsClient(),
  );
  const [sourcesClient] = useState(
    () => props.sources ?? createSourcesClient(),
  );

  const [map, setMap] = useState<
    | {
        readonly default: string | null;
        readonly displays: readonly ThemedDisplay[];
        readonly unreadable?: boolean;
      }
    | undefined
  >(undefined);
  const [themes, setThemes] = useState<readonly ThemeLibraryEntry[]>([]);
  const [devices, setDevices] = useState<DeviceSettings | undefined>(undefined);
  const [preferences, setPreferences] = useState<
    | {
        readonly settings: DisplayPreferences;
        readonly zones: readonly string[];
      }
    | undefined
  >(undefined);
  const [questions, setQuestions] = useState<
    | {
        readonly required: readonly AssignableGroup[];
        readonly answers: ThemeAnswers;
      }
    | undefined
  >(undefined);
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [panels, setPanels] = useState<readonly PanelHint[] | undefined>(
    undefined,
  );
  const [addingPanel, setAddingPanel] = useState(false);
  const [status, setStatus] = useState<string | undefined>(undefined);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    client.listDisplays().then(
      (answer) => {
        if (live) setMap(answer);
      },
      (error: unknown) => {
        if (live) setStatus(reason(error));
      },
    );
    client.list().then(
      (listed) => {
        if (live) setThemes(listed);
      },
      () => {
        // The ids are printable, so a missing name is not a failure worth a
        // sentence.
      },
    );
    settings.listPanels().then(
      (attached) => {
        if (live) setPanels(attached);
      },
      () => {
        // A host that cannot enumerate says so through the section being
        // absent. A sentence here would report a probe failure as the machine
        // having no panel, which are different facts.
      },
    );
    settings.readDevices().then(
      (read) => {
        if (live) setDevices(read);
      },
      (error: unknown) => {
        if (live) setStatus(reason(error));
      },
    );
    settings.readDisplay().then(
      (read) => {
        if (live) setPreferences(read);
      },
      (error: unknown) => {
        if (live) setStatus(reason(error));
      },
    );
    return () => {
      live = false;
    };
  }, [client, settings]);

  // The default is the answer's fallback field, not a row: this is the one
  // place it becomes the row an author assigns a theme to, so the list, the
  // selection and the theme's questions all speak about it the same way. It
  // leads, because it is what a display with no choice of its own is served and
  // so the row a person opens the page on. A failed read adds no row: the
  // fallback is unknown rather than null.
  const displays: readonly ThemedDisplay[] =
    map === undefined
      ? []
      : [
          {
            id: DEFAULT_DISPLAY_KEY,
            label: uiCopy.hostSettings.displays.defaultDisplay,
            kind: "default",
            theme: map.default,
            shape: "rect",
            rotation: 0,
          },
          ...map.displays,
        ];
  const selected = chosen ?? displays[0]?.id;
  const selectedRow = displays.find((display) => display.id === selected);
  const fallback = map?.default ?? null;
  const showing = shownTheme(selectedRow, fallback);
  const selectedPanel =
    selected === undefined
      ? undefined
      : panels?.find((panel) => panel.heldId === selected);
  const hasPanelDisplay = displays.some((display) => display.kind === "panel");

  /** The status and reconnect read the map, so a panel the retry loop brings
   *  back must reach the surface without a reload. Only a mode with a panel
   *  display pays for the poll. */
  useEffect(() => {
    if (!hasPanelDisplay) return;

    let live = true;
    const timer = setInterval(() => {
      client.listDisplays().then(
        (answer) => {
          if (live) setMap(answer);
        },
        () => {
          // A failed poll is not a state change: the last answer stands, and
          // the next attempt asks again.
        },
      );
    }, 3_000);

    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [client, hasPanelDisplay]);

  const reconnectPanel = async (id: string): Promise<void> => {
    await settings.reconnectPanel(id);
    await client.listDisplays().then(
      (answer) => {
        if (mounted.current) setMap(answer);
      },
      () => {
        // The reconnect itself succeeded; the poll above will re-read.
      },
    );
  };

  const disconnectPanel = async (id: string): Promise<void> => {
    await settings.disconnectPanel(id);
    await client.listDisplays().then(
      (answer) => {
        if (mounted.current) setMap(answer);
      },
      () => {
        // The disconnect itself succeeded; the poll above will re-read.
      },
    );
  };

  // **The questions belong to the display the surface is showing for, and to
  // the theme that display has** — its own, or the default's. A read that fails
  // leaves the section out rather than asking questions about the last display
  // read.
  useEffect(() => {
    if (selected === undefined || showing === null) {
      setQuestions(undefined);
      return;
    }
    let live = true;
    settings.readQuestions(selected, showing).then(
      (answer) => {
        if (live) setQuestions(answer);
      },
      () => {
        if (live) setQuestions(undefined);
      },
    );
    return () => {
      live = false;
    };
  }, [settings, selected, showing]);

  const nameOfTheme = (id: string): string =>
    themes.find((entry) => entry.id === id)?.name ?? id;

  const write = (run: () => Promise<string>): void => {
    setStatus(uiCopy.hostSettings.status.saving);
    void run().then(
      (sentence) => {
        if (mounted.current) setStatus(sentence);
      },
      (error: unknown) => {
        if (mounted.current) {
          setStatus(uiCopy.hostSettings.status.failed(reason(error)));
        }
      },
    );
  };

  const saveDevices = (patch: {
    readonly assigned?: Partial<Record<AssignableGroup, string>>;
    readonly names?: Readonly<Record<string, string>>;
  }): void => {
    if (devices === undefined) return;
    const next = {
      assigned: { ...devices.assigned, ...patch.assigned },
      names: { ...devices.names, ...patch.names },
    };
    write(async () => {
      const saved = await settings.saveDevices(next);
      if (mounted.current) {
        setDevices((current) =>
          current === undefined
            ? current
            : { ...current, assigned: saved.assigned, names: saved.names },
        );
      }
      return uiCopy.hostSettings.status.savedDevices;
    });
  };

  const saveDisplay = (
    next: {
      readonly timeZone: string;
      readonly measurement: string;
      readonly units: UnitPreferences;
    },
    saved: string,
  ): void => {
    const measurement = next.measurement;
    // A value neither system names is refused rather than written: the control
    // offers two, and a third would reach the host as a value it rejects.
    if (measurement !== "metric" && measurement !== "imperial") return;
    write(async () => {
      const written = await settings.saveDisplay({
        timeZone: next.timeZone,
        measurement,
        units: next.units,
      });
      if (mounted.current) {
        setPreferences((current) =>
          current === undefined ? current : { ...current, settings: written },
        );
      }
      return saved;
    });
  };

  const saveUnit = (field: UnitField, value: string): void => {
    if (preferences === undefined) return;
    saveDisplay(
      {
        timeZone: preferences.settings.timeZone ?? "",
        measurement: preferences.settings.measurement ?? "metric",
        units: {
          ...preferences.settings.units,
          [field]: value,
        } as UnitPreferences,
      },
      uiCopy.hostSettings.status.savedUnits,
    );
  };

  const answer = (group: AssignableGroup, device: string): void => {
    if (questions === undefined || selected === undefined || showing === null)
      return;
    const answers: Record<string, string> = { ...questions.answers };
    // An emptied field is the theme going back to this PC's own device
    // settings, which is the absence of an answer rather than an answer of `""`.
    if (device === "") delete answers[group];
    else answers[group] = device;
    write(async () => {
      const saved = await settings.saveQuestions(selected, showing, answers);
      if (mounted.current) {
        setQuestions({ required: questions.required, answers: saved });
      }
      return uiCopy.hostSettings.status.savedAnswers;
    });
  };

  const replaceName = (id: string, label: string): void => {
    if (!mounted.current) return;
    setMap((current) =>
      current === undefined
        ? current
        : {
            ...current,
            displays: current.displays.map((row) =>
              row.id === id ? { ...row, label } : row,
            ),
          },
    );
  };

  const replacePresentation = (
    id: string,
    saved: {
      readonly shape: ThemedDisplay["shape"];
      readonly rotation: number;
    },
  ): void => {
    if (!mounted.current) return;
    setMap((current) =>
      current === undefined
        ? current
        : {
            ...current,
            displays: current.displays.map((row) =>
              row.id === id
                ? { ...row, shape: saved.shape, rotation: saved.rotation }
                : row,
            ),
          },
    );
  };

  const replaceRenderMode = (id: string, saved: DisplayRenderMode): void => {
    if (!mounted.current) return;
    setMap((current) =>
      current === undefined
        ? current
        : {
            ...current,
            displays: current.displays.map((row) =>
              row.id === id && row.panel !== undefined
                ? { ...row, panel: { ...row.panel, renderMode: saved } }
                : row,
            ),
          },
    );
  };

  const addPanel = (panel: PanelHint): void => {
    if (addingPanel) return;
    setAddingPanel(true);
    write(async () => {
      try {
        const id = await settings.addPanel(panel.label, {
          vendorId: panel.vendorId,
          productId: panel.productId,
          serial: panel.serial,
        });
        const refreshed = await client.listDisplays();
        if (mounted.current) {
          setMap(refreshed);
          setChosen(id);
          setPanels((current) =>
            (current ?? []).map((entry) =>
              entry.vendorId === panel.vendorId &&
              entry.productId === panel.productId &&
              entry.serial === panel.serial
                ? { ...entry, held: true, heldId: id }
                : entry,
            ),
          );
        }
        return uiCopy.hostSettings.panels.added;
      } finally {
        if (mounted.current) setAddingPanel(false);
      }
    });
  };

  const addDisplay = async (
    label: string,
    monitor: HostMonitor,
  ): Promise<boolean> => {
    setStatus(uiCopy.hostSettings.status.saving);
    try {
      const id = await settings.createLocalDisplay({ label, monitor });
      try {
        const refreshed = await client.listDisplays();
        if (mounted.current) setMap(refreshed);
      } catch {
        if (mounted.current) {
          setMap((current) =>
            current === undefined
              ? current
              : {
                  ...current,
                  displays: [
                    ...current.displays,
                    {
                      id,
                      label,
                      kind: "local",
                      theme: null,
                      shape: "rect",
                      rotation: 0,
                    },
                  ],
                },
          );
        }
      }
      if (mounted.current) {
        setChosen(id);
        setStatus(uiCopy.hostSettings.displays.added(label));
      }
      return true;
    } catch (error: unknown) {
      if (mounted.current) {
        setStatus(uiCopy.hostSettings.status.failed(reason(error)));
      }
      return false;
    }
  };

  const removeDisplay = async (display: ThemedDisplay): Promise<boolean> => {
    setStatus(uiCopy.hostSettings.status.saving);
    try {
      await settings.removeDisplay(display.id);
      try {
        const refreshed = await client.listDisplays();
        if (mounted.current) setMap(refreshed);
      } catch {
        if (mounted.current) {
          setMap((current) =>
            current === undefined
              ? current
              : {
                  ...current,
                  displays: current.displays.filter(
                    (row) => row.id !== display.id,
                  ),
                },
          );
        }
      }
      if (mounted.current) {
        setChosen((current) => (current === display.id ? undefined : current));
        setStatus(uiCopy.hostSettings.displays.removed(display.label));
      }
      return true;
    } catch (error: unknown) {
      if (mounted.current) {
        setStatus(uiCopy.hostSettings.status.failed(reason(error)));
      }
      return false;
    }
  };

  // A theme's slot is only asked where the device count leaves a choice. The
  // devices are read separately, so the row disappears when the read lands
  // rather than being answered with a guess.
  const asked = unanswered(
    questions?.required ?? [],
    questions?.answers ?? {},
  ).filter((group) => devices === undefined || asksWhichDevice(devices, group));

  return {
    displays,
    selected,
    selectedRow,
    fallback,
    showing,
    selectedPanel,
    hasPanelDisplay,
    mapUnreadable: map?.unreadable === true,
    themes,
    devices,
    preferences,
    questions,
    asked,
    panels,
    addingPanel,
    status,
    displayCount:
      map === undefined
        ? null
        : uiCopy.hostSettings.status.displays(map.displays.length),
    sourcesClient,
    settingsClient: settings,
    nameOfTheme,
    chooseDisplay: setChosen,
    write,
    saveDevices,
    saveDisplay,
    saveUnit,
    answer,
    replaceName,
    replacePresentation,
    replaceRenderMode,
    reconnectPanel,
    disconnectPanel,
    addPanel,
    addDisplay,
    removeDisplay,
    report: setStatus,
  };
}
