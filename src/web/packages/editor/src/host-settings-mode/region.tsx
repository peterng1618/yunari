import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import {
  DEFAULT_UNIT_PREFERENCES,
  type UnitPreferences,
} from "@yunari/renderer-core";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import {
  type ControlOption,
  ControlSelect,
} from "../components/ui/control-select.js";
import type { ShellMode } from "../editor-shell/shell-layout.js";
import {
  createThemeLibraryClient,
  type ThemedDisplay,
  type ThemeLibraryClient,
  type ThemeLibraryEntry,
} from "../theme-library-client.js";
import { uiCopy } from "../ui-copy.js";
import {
  type AssignableGroup,
  type AvailableDevice,
  createHostSettingsClient,
  type DeviceSettings,
  type DisplayPreferences,
  type HostSettingsClient,
  type ThemeAnswers,
} from "./client.js";
import { DeviceNameRow } from "./device-name-row.js";
import {
  type DisplayPresentation,
  DisplayPresentationSection,
} from "./display-presentation-section.js";
import { Group } from "./section-group.js";
import { createSourcesClient, type SourcesClient } from "./sources-client.js";
import { SourcesSection } from "./sources-section.js";
import { WeatherSection } from "./weather-section.js";

/**
 * The Host mode's region — the third surface the shell's mode switch reaches,
 * which is **this PC**: the displays and the theme each shows, the devices and
 * their names, the display settings, and the hardware the theme on the chosen
 * display reads.
 *
 * **It absorbs `packages/host/public/settings.html`, rebuilt in the shell's own
 * React** rather than an iframe over that page — its four sections, its words
 * and its status line, in §5's controls. The one section it does not take is
 * that page's Themes list: the store mode's local half owns listing, opening,
 * activating and removing a theme now, and A.9 puts the assignment on a theme's
 * own row. **So this region shows which theme a display has and never chooses
 * it** — a second way to assign is exactly what that task exists to avoid.
 *
 * The page itself is not deleted: it is served from the host's own bundle and is
 * the only surface a phone, or a browser with no editor open, can reach.
 */

/** The theme a display shows: its own choice, else the default's. Spelled once
 *  because the fallback is the feature's core, and a second copy of it is one
 *  more place to get it wrong. `null` means neither — a display showing nothing,
 *  which is not the same as showing a theme named "nothing". */
function shownTheme(
  display: ThemedDisplay | undefined,
  fallback: string | null,
): string | null {
  return display?.theme ?? fallback;
}

/**
 * The slots a theme raises that nothing has answered yet, in the order the
 * route named them.
 *
 * **An answered slot leaves the list**, which is what makes answering a
 * question the thing that removes it: the theme asks once, and the answer is
 * remembered against this display's use of it.
 */
function unanswered(
  required: readonly AssignableGroup[],
  answers: ThemeAnswers,
): readonly AssignableGroup[] {
  return required.filter((group) => answers[group] === undefined);
}

/** The devices one slot offers, in the order the provider reported them. */
function devicesFor(
  settings: DeviceSettings,
  group: AssignableGroup,
): readonly AvailableDevice[] {
  return group === "gpu" ? settings.available.gpus : settings.available.disks;
}

/** Every device this PC reported, the two lists in the order the page draws
 *  them: the cards first, then the drives. */
function everyDevice(settings: DeviceSettings): readonly AvailableDevice[] {
  return [...settings.available.gpus, ...settings.available.disks];
}

/** The unit families the display form offers, in its order. `measurement` is
 *  not among them: temperatures have their own row above, whose systems read
 *  as names rather than unit marks. */
const UNIT_FIELDS = [
  "clock",
  "data",
  "dataScale",
  "rate",
  "rateScale",
  "windSpeed",
  "pressure",
] as const;

type UnitField = (typeof UNIT_FIELDS)[number];

/** What a device is called: the name chosen for it, else the one it reports. */
function nameOfDevice(
  settings: DeviceSettings,
  device: AvailableDevice,
): string {
  return settings.names[device.id] ?? device.name;
}

/** What a slot's row is labelled, which is its own question where the count of
 *  devices cannot answer it. */
function groupQuestion(
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

/**
 * The two halves of §7.6's strip while the Host mode is showing, already spelled:
 * the display count on the left, the last write's answer on the right.
 *
 * **The region owns the content and the shell owns the placement.** The strip is
 * a sibling of every mode's region and is one strip in all three modes, so the
 * region publishes these strings rather than drawing a second bar — and the
 * shell draws them rather than re-reading the host, which would be a second
 * owner of the same fetch.
 *
 * **A line belongs to the visit that published it**, so `undefined` is what the
 * region hands back when it leaves: the shell's state is the region's answer and
 * has no life of its own, and a line left standing would be painted by the next
 * visit's strip — a live region mounted already holding the last visit's
 * sentence, and a count no read in that visit answered.
 */
export interface HostStatusLine {
  /** How many displays the host holds, or `null` when no read answered. A
   *  failed read is never a fabricated zero, and never an empty list. */
  readonly displays: string | null;
  /** The last write's answer, or the page's resting sentence. */
  readonly status: string;
}

/**
 * The Host mode's region, and nothing in any other mode.
 *
 * **The mode is a prop rather than state read here**, exactly as
 * `StoreModeRegion` takes it: the shell renders one `[data-yunari-mode-region]`
 * section for every non-editor mode and hands each region the mode it is in, so
 * a region that drew itself in a mode it does not own would be the second
 * surface in one section.
 *
 * `client` and `settings` are for a test and for a surface that already has
 * one. The shell mounts this with neither and the region builds both.
 * `onStatus` is the shell's own strip asking for the line this mode says there.
 */
export function HostSettingsRegion(props: {
  readonly mode: ShellMode;
  readonly client?: ThemeLibraryClient | undefined;
  readonly settings?: HostSettingsClient | undefined;
  /** The custom sources seam. The shell mounts this with none and the section
   *  builds its own; a test that does not exercise the page hands a fake in so
   *  no case reaches a host it never started. */
  readonly sources?: SourcesClient | undefined;
  readonly onStatus?: ((line: HostStatusLine | undefined) => void) | undefined;
}): React.JSX.Element | null {
  return props.mode === "this-pc" ? (
    <HostSettings
      client={props.client}
      settings={props.settings}
      sources={props.sources}
      onStatus={props.onStatus}
    />
  ) : null;
}

/** The region's own state, in its own component so a mode that is not Host
 *  holds none of it. Nothing here is persisted: leaving the mode and coming
 *  back reads the host again, which is what makes the region the host's answer
 *  rather than a copy of it. */
function HostSettings(props: {
  readonly client?: ThemeLibraryClient | undefined;
  readonly settings?: HostSettingsClient | undefined;
  readonly sources?: SourcesClient | undefined;
  readonly onStatus?: ((line: HostStatusLine | undefined) => void) | undefined;
}): React.JSX.Element {
  // One client of each for the life of the region: a client built per render
  // would be a new one every time, and a write would reach a host the read never
  // talked to.
  const [client] = useState(() => props.client ?? createThemeLibraryClient());
  const [settings] = useState(
    () => props.settings ?? createHostSettingsClient(),
  );
  const [sources] = useState(() => props.sources ?? createSourcesClient());

  /** The display map, or `undefined` until it arrives. **Nothing draws the
   *  first-run state before then**: a region that said "no displays" for a frame
   *  would be reporting a host answer it had not been given. */
  const [map, setMap] = useState<
    | {
        readonly default: string | null;
        readonly displays: readonly ThemedDisplay[];
      }
    | undefined
  >(undefined);
  /** The library's names, so a display's theme is read as the name the author
   *  gave it. A failed listing leaves this empty and the ids are printed. */
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
  /** The display the questions below speak for. The route always answers This PC
   *  first, so the region opens on it rather than on nothing. */
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  /** The last thing that happened, or `undefined` for the resting sentence. */
  const [status, setStatus] = useState<string | undefined>(undefined);

  /** The flag every continuation below checks before it sets state — the reads
   *  keep their own in the scope of the effect that can cancel them, and a write
   *  starts in an event handler, so it needs the same flag where no effect can
   *  reach it. */
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
      // **A failed read is not a fact about the displays**, so nothing is drawn
      // for it and no empty list stands in. The reason has a surface of its own
      // below.
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

  const displays = map?.displays ?? [];
  const selected = chosen ?? displays[0]?.id;
  const selectedRow = displays.find((display) => display.id === selected);
  const fallback = map?.default ?? null;
  const showing = shownTheme(selectedRow, fallback);

  /** **The mode's status line is published, not drawn**: §7.6's strip is the
   *  shell's and is the same strip in every mode, so the region hands it the two
   *  strings and the shell places them. A count no read answered is `null`
   *  rather than `0`, which is the same refusal the rows above make. */
  const publish = props.onStatus;
  const countLine =
    map === undefined
      ? null
      : uiCopy.hostSettings.status.displays(map.displays.length);
  useEffect(() => {
    publish?.({
      displays: countLine,
      status: status ?? uiCopy.hostSettings.status.ready,
    });
  }, [publish, countLine, status]);

  /** **Leaving the mode takes the line with it.** The region exists only while
   *  the Host mode is showing, so its unmount *is* the mode moving: withdrawing
   *  here is the same reset the shell would have to watch `mode` for, done by
   *  the owner of the line rather than by a second reader of the mode. Without
   *  it the shell holds the last visit's strings, and the next visit's strip —
   *  a freshly mounted live region — paints them before the region answers. */
  useEffect(() => () => publish?.(undefined), [publish]);

  // **The questions belong to the display the region is showing for, and to the
  // theme that display has** — which is its own, or the default's. A read that
  // fails leaves the section out rather than asking questions about the last
  // display read.
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

  /** The name a theme is read by, or its id where the library did not answer. */
  const nameOfTheme = (id: string): string =>
    themes.find((entry) => entry.id === id)?.name ?? id;

  /** One write, one status line: the run answers the sentence for a success and
   *  a refusal is the host's own words after the region's own lead. **Every
   *  continuation checks the flag first**, as the reads do — a save in flight
   *  when the mode changes would otherwise set state on a tree that is gone. */
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
    // **Both fields travel, merged here**, because the route replaces the whole
    // object: a save that sent only the field it changed would clear the other.
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

  /** One unit family's change, merged into the bag that travels whole: the
   *  route replaces the settings object, so sending only the changed family
   *  would clear the rest. */
  const saveUnit = (field: UnitField, value: string): void => {
    if (preferences === undefined) return;
    saveDisplay(
      {
        timeZone: preferences.settings.timeZone ?? "",
        measurement: preferences.settings.measurement ?? "metric",
        // The control offers only the values the family names, so the merge is
        // a full preference set at the surface.
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
    // An emptied field is the theme going back to this PC's own device settings,
    // which is the absence of an answer rather than an answer of `""`.
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

  const asked = unanswered(questions?.required ?? [], questions?.answers ?? {});

  /** **The row is replaced from the host's answer**, never optimistically: the
   *  store decides the pair together, and a snapped angle it refused must not
   *  stand on the row as though it had been stored. */
  const replacePresentation = (
    id: string,
    saved: DisplayPresentation,
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

  return (
    // **No status strip of its own.** §7.6's bar is the shell's, drawn once as a
    // sibling of every mode's region, and this mode's line reaches it through
    // `onStatus` rather than through a second bar stacked on top of it.
    <div data-yunari-host-region="" className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-[var(--space-24)] overflow-y-auto p-[var(--space-24)]">
        <div className="flex max-w-[var(--host-settings-measure)] flex-col gap-[var(--space-24)]">
          <Group
            testId="displays"
            name={uiCopy.hostSettings.displays.heading}
            hint={uiCopy.hostSettings.displays.hint}
          >
            {/* **The rows are a choice, and the choice is which display the
                questions below speak for** — never which theme it shows. §5's
                Segmented is the control for one of a small set, composed in its
                bare form as the header's mode switch and the store's halves
                are, and each row is dressed as the drawing's card rather than
                as a segment. */}
            {displays.length === 0 ? null : (
              <ToggleGroup
                value={[selected ?? ""]}
                aria-label={uiCopy.hostSettings.displays.label}
                onValueChange={(next) => {
                  const picked = next[0];
                  if (picked !== undefined) setChosen(picked);
                }}
                className="flex flex-col gap-[var(--space-6)]"
              >
                {displays.map((display) => {
                  const own = display.theme;
                  const shown = shownTheme(display, fallback);
                  return (
                    <Toggle
                      key={display.id}
                      value={display.id}
                      data-yunari-host-display={display.id}
                      data-shape={display.shape}
                      data-rotation={display.rotation}
                      className="flex items-center gap-[var(--space-12)] rounded-lg border border-edge bg-panel-2 px-[var(--space-10)] py-[var(--space-8)] text-left data-[pressed]:border-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      <span className="min-w-0 flex-1 text-xs text-text">
                        {display.label}
                      </span>
                      <span
                        data-yunari-host-display-theme=""
                        className={`flex-none text-xs ${own === null ? "text-faint" : "text-muted"}`}
                      >
                        {shown === null
                          ? uiCopy.hostSettings.displays.nothing
                          : nameOfTheme(shown)}
                      </span>
                      {/* A display with no theme of its own is served the
                          default, so the row names the theme it shows *and*
                          says where that answer came from: a name alone would
                          read as a choice this display made. */}
                      {own === null && shown !== null ? (
                        <span
                          data-yunari-host-display-follows=""
                          className="flex-none text-2xs text-faint"
                        >
                          {uiCopy.hostSettings.displays.follows}
                        </span>
                      ) : null}
                    </Toggle>
                  );
                })}
              </ToggleGroup>
            )}
          </Group>

          <DisplayPresentationSection
            display={selectedRow}
            write={write}
            save={settings.updateDisplayPresentation}
            onSaved={replacePresentation}
          />

          <Group
            testId="devices"
            name={uiCopy.hostSettings.devices.heading}
            hint={uiCopy.hostSettings.devices.hint}
          >
            {devices === undefined ? null : everyDevice(devices).length ===
              0 ? (
              // **The empty sentence is the page's own, and it is not a
              // fabricated zero**: no provider reported a device, so there is
              // nothing to choose between and the sentence says what to do.
              <p className="text-xs text-muted">
                {uiCopy.hostSettings.devices.empty}
              </p>
            ) : (
              <>
                {(["gpu", "system-disk", "data-disk"] as const).map((group) => {
                  const options = devicesFor(devices, group);
                  // A slot with nothing behind it is not a question: the page
                  // draws no row rather than an empty dropdown.
                  if (options.length === 0) return null;
                  const choices: readonly ControlOption[] = [
                    // The default exists whatever the count, so the control
                    // always shows something and a choice can be undone.
                    {
                      id: "",
                      name: uiCopy.hostSettings.devices.automatic[group],
                    },
                    ...options.map((device) => ({
                      id: device.id,
                      name: nameOfDevice(devices, device),
                    })),
                  ];
                  return (
                    <ControlSelect
                      key={group}
                      id={`yunari-host-device-${group}`}
                      label={groupQuestion(devices, group)}
                      data={{ "data-yunari-host-device-group": group }}
                      value={devices.assigned[group] ?? ""}
                      options={choices}
                      onChange={(id) =>
                        saveDevices({ assigned: { [group]: id } })
                      }
                    />
                  );
                })}
                <h3 className="m-0 pt-[var(--space-6)] text-2xs font-semibold tracking-[0.11em] text-muted uppercase">
                  {uiCopy.hostSettings.devices.namesHeading}
                </h3>
                <p className="text-xs text-muted">
                  {uiCopy.hostSettings.devices.namesHint}
                </p>
                {everyDevice(devices).map((device) => (
                  <DeviceNameRow
                    key={device.id}
                    device={device}
                    value={devices.names[device.id] ?? ""}
                    onCommit={(name) =>
                      saveDevices({ names: { [device.id]: name } })
                    }
                  />
                ))}
              </>
            )}
          </Group>

          <Group
            testId="display"
            name={uiCopy.hostSettings.display.heading}
            hint={uiCopy.hostSettings.display.hint}
          >
            {preferences === undefined ? null : (
              <>
                <ControlSelect
                  id="yunari-host-time-zone"
                  label={uiCopy.hostSettings.display.timeZone}
                  data={{ "data-yunari-host-time-zone": "" }}
                  value={preferences.settings.timeZone ?? ""}
                  // This PC's own zone is the default and the most common
                  // answer, so it comes first and is the empty value the route
                  // reads as the absence of a choice.
                  options={[
                    { id: "", name: uiCopy.hostSettings.display.ownZone },
                    ...preferences.zones.map((zone) => ({
                      id: zone,
                      name: zone,
                    })),
                  ]}
                  onChange={(zone) =>
                    saveDisplay(
                      {
                        timeZone: zone,
                        measurement:
                          preferences.settings.measurement ?? "metric",
                        units: preferences.settings.units ?? {},
                      },
                      uiCopy.hostSettings.status.savedZone,
                    )
                  }
                />
                <ControlSelect
                  id="yunari-host-measurement"
                  label={uiCopy.hostSettings.display.measurement}
                  data={{ "data-yunari-host-measurement": "" }}
                  value={preferences.settings.measurement ?? "metric"}
                  options={[
                    { id: "metric", name: uiCopy.hostSettings.display.metric },
                    {
                      id: "imperial",
                      name: uiCopy.hostSettings.display.imperial,
                    },
                  ]}
                  onChange={(measurement) =>
                    saveDisplay(
                      {
                        timeZone: preferences.settings.timeZone ?? "",
                        measurement,
                        units: preferences.settings.units ?? {},
                      },
                      uiCopy.hostSettings.status.savedUnits,
                    )
                  }
                />
                {UNIT_FIELDS.map((field) => {
                  const copy = uiCopy.hostSettings.display.units[field];
                  return (
                    <ControlSelect
                      key={field}
                      id={`yunari-host-unit-${field}`}
                      label={copy.label}
                      data={{ "data-yunari-host-unit": field }}
                      // An unchosen family shows the value it is already
                      // reading in, so the control prints the effective answer
                      // rather than an empty third state.
                      value={
                        preferences.settings.units?.[field] ??
                        DEFAULT_UNIT_PREFERENCES[field]
                      }
                      options={Object.entries(copy.values).map(
                        ([id, name]) => ({ id, name }),
                      )}
                      onChange={(value) => saveUnit(field, value)}
                    />
                  );
                })}
              </>
            )}
          </Group>

          <WeatherSection settings={settings} report={setStatus} />

          <SourcesSection sources={sources} report={setStatus} />

          {/* **Only the questions the theme on this display raises are drawn**,
              and only the ones nothing has answered: the route derives `required`
              from the theme's own bindings, so a theme that reads `cpu.load`
              raises no GPU row here. A display showing no theme raises none. */}
          {asked.length === 0 ||
          questions === undefined ||
          showing === null ||
          // **The rows offer this PC's devices, so the device read is what makes
          // them drawable.** Before it lands a question would offer the inherit
          // answer alone, which is a claim about the hardware that nothing made.
          devices === undefined ? null : (
            <Group
              testId="questions"
              name={uiCopy.hostSettings.questions.heading(nameOfTheme(showing))}
              hint={uiCopy.hostSettings.questions.hint}
            >
              {asked.map((group) => (
                <ControlSelect
                  key={group}
                  id={`yunari-host-answer-${group}`}
                  label={uiCopy.hostSettings.devices.groups[group]}
                  data={{ "data-yunari-host-answer": group }}
                  value={questions.answers[group] ?? ""}
                  options={[
                    // This PC's own choice is the default, so most themes need
                    // no answer at all.
                    { id: "", name: uiCopy.hostSettings.questions.inherit },
                    ...devicesFor(devices, group).map((device) => ({
                      id: device.id,
                      name: nameOfDevice(devices, device),
                    })),
                  ]}
                  onChange={(device) => answer(group, device)}
                />
              ))}
            </Group>
          )}
        </div>
      </div>
    </div>
  );
}
