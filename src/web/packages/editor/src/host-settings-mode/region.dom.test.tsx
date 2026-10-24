// @vitest-environment jsdom
/**
 * The Host mode's region: the four sections `settings.html` is, rebuilt in the
 * shell's own React — and the two facts about them the plan names, plus the
 * decisions behind the writes.
 *
 * **What this file owns.** That the displays are listed and that a display with
 * no theme of its own is shown the default's name; that only the slots the theme
 * on the chosen display raises are asked, and an answered one leaves; and that
 * each write sends what the route needs — both device fields, both display
 * fields, the whole answer map — with a refusal reaching the person in the
 * host's own words.
 *
 * **And that the mode's status line is published rather than drawn.** §7.6's
 * strip is the shell's, so this region hands it the two strings and the shell
 * places them; the line the strip shows is asserted in
 * `shell-layout.dom.test.tsx`, and what this file reads is what the region said.
 *
 * **What it deliberately does not measure.** jsdom lays nothing out and paints
 * nothing, so nothing here is a claim about how the region looks. The drawing it
 * follows (`docs/design/mockups/current/host-settings.html`) is read by its own
 * gate, not by this file.
 */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it } from "vitest";
import { fixtureEntry } from "../store-mode/item-fixture.js";
import {
  type ThemedDisplay,
  type ThemeLibraryClient,
} from "../theme-library-client.js";
import { uiCopy } from "../ui-copy.js";
import {
  type AssignableGroup,
  type DeviceSettings,
  type DisplayPreferences,
  type DisplayPreferencesWrite,
  type HostSettingsClient,
  type ThemeAnswers,
  type WeatherPlace,
  type WeatherRead,
  type WeatherSettings,
} from "./client.js";
import { HostSettingsRegion, type HostStatusLine } from "./region.js";

// Base UI's popup needs two browser APIs jsdom has none of: floating-ui observes
// its anchor, and the popup waits for its own open transition. Each test file
// that mounts a primitive supplies its own — there is no shared harness here.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as never;
Element.prototype.getAnimations ??= (): never[] => [];
window.PointerEvent ??= MouseEvent as never;

// React only flushes work scheduled inside `act` when it has been told it is in
// a test; without this, `act` warns and the update lands after the assertion.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom's selector engine cannot answer `:modal`/`:popover-open`, and floating-ui
// asks for both on every position — each unanswerable call costs about 0.5s of
// selector parsing, which is what turns one popup into a timeout.
beforeAll(() => {
  const matches = Element.prototype.matches;
  Element.prototype.matches = Object.assign(function (
    this: Element,
    selector: string,
  ): boolean {
    if (selector === ":modal" || selector === ":popover-open") return false;
    return matches.call(this, selector);
  }, matches);
});

let root: Root | undefined;
let host: HTMLDivElement | undefined;

async function unmount(): Promise<void> {
  const mounted = root;
  root = undefined;
  host?.remove();
  host = undefined;
  if (mounted !== undefined) await act(async () => mounted.unmount());
}

afterEach(async () => {
  await unmount();
});

async function mount(element: ReactElement): Promise<HTMLDivElement> {
  await unmount();
  const container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  host = container;
  await act(async () => {
    mounted.render(element);
  });
  return container;
}

/** A missing element is a defect this file names, rather than a `null` a later
 *  assertion reports as a wrong value. */
function must<T extends Element>(found: T | null, what: string): T {
  if (found === null) throw new Error(`the region rendered no ${what}`);
  return found;
}

/** The route's own answers for one run. `questions` is keyed by
 *  `<display>/<theme>`, which is the pair the region asks about. */
interface Fixture {
  readonly displays?: readonly ThemedDisplay[];
  readonly fallback?: string | null;
  readonly themes?: readonly { readonly id: string; readonly name: string }[];
  readonly devices?: DeviceSettings;
  readonly preferences?: {
    readonly settings: DisplayPreferences;
    readonly zones: readonly string[];
  };
  readonly questions?: Readonly<
    Record<
      string,
      {
        readonly required: readonly AssignableGroup[];
        readonly answers: ThemeAnswers;
      }
    >
  >;
  readonly weather?: WeatherRead;
  /** What the geocoder finds for a search, whatever it was asked. */
  readonly places?: readonly WeatherPlace[];
  /** The display map's own refusal: a host that keeps its settings to itself. */
  readonly refuseDisplays?: boolean;
}

/** Every write the region made, in the order it made them. */
interface Written {
  readonly devices: {
    readonly assigned: Readonly<Partial<Record<AssignableGroup, string>>>;
    readonly names: Readonly<Record<string, string>>;
  }[];
  readonly display: DisplayPreferencesWrite[];
  readonly answers: {
    readonly display: string;
    readonly theme: string;
    readonly answers: ThemeAnswers;
  }[];
  readonly asked: { readonly display: string; readonly theme: string }[];
  readonly weather: WeatherSettings[];
  readonly searches: string[];
}

function library(fixture: Fixture): ThemeLibraryClient {
  return {
    list: async () =>
      (fixture.themes ?? []).map((theme) =>
        fixtureEntry({ id: theme.id, name: theme.name }),
      ),
    open: () => Promise.reject(new Error("the Host mode opens no theme")),
    save: () => Promise.reject(new Error("the Host mode saves no theme")),
    assign: () => Promise.reject(new Error("assigning is the store's")),
    listDisplays: async () => {
      if (fixture.refuseDisplays === true) {
        throw new Error("Settings are available on this PC only.");
      }
      return {
        default: fixture.fallback ?? null,
        displays: fixture.displays ?? [],
      };
    },
  };
}

/** The host's settings routes, as the shapes they answer, with every write
 *  recorded. `refuse` is the sentence a write fails with, or `undefined`. */
function hostSettings(
  fixture: Fixture,
  refuse?: {
    readonly devices?: string;
    readonly display?: string;
    readonly answers?: string;
    readonly weather?: string;
  },
): { readonly client: HostSettingsClient; readonly wrote: Written } {
  const wrote: Written = {
    devices: [],
    display: [],
    answers: [],
    asked: [],
    weather: [],
    searches: [],
  };
  const devices: DeviceSettings = fixture.devices ?? {
    available: { gpus: [], disks: [] },
    assigned: {},
    names: {},
  };
  const weather: WeatherRead = fixture.weather ?? {
    provider: "open-meteo",
    label: "",
    latitude: 0,
    longitude: 0,
    useWindowsLocation: false,
    pollIntervalMs: 600000,
  };

  return {
    wrote,
    client: {
      readDevices: async () => devices,
      saveDevices: async (next) => {
        wrote.devices.push(next);
        if (refuse?.devices !== undefined) throw new Error(refuse.devices);
        return next;
      },
      readDisplay: async () =>
        fixture.preferences ?? { settings: {}, zones: [] },
      saveDisplay: async (next) => {
        wrote.display.push(next);
        if (refuse?.display !== undefined) throw new Error(refuse.display);
        return next;
      },
      readQuestions: async (display, theme) => {
        wrote.asked.push({ display, theme });
        return (
          fixture.questions?.[`${display}/${theme}`] ?? {
            required: [],
            answers: {},
          }
        );
      },
      saveQuestions: async (display, theme, answers) => {
        wrote.answers.push({ display, theme, answers });
        if (refuse?.answers !== undefined) throw new Error(refuse.answers);
        return answers;
      },
      readWeather: async () => weather,
      saveWeather: async (next) => {
        wrote.weather.push(next);
        if (refuse?.weather !== undefined) throw new Error(refuse.weather);
        return next;
      },
      searchPlaces: async (query) => {
        wrote.searches.push(query);
        return fixture.places ?? [];
      },
    },
  };
}

/** Two displays, one of them holding no theme of its own, and the two themes the
 *  library calls them. This PC leads, as the route always answers it first. */
const TWO_DISPLAYS: Fixture = {
  fallback: "kitchen-strip",
  displays: [
    { id: "this-pc", label: "This PC", theme: null },
    { id: "hallway", label: "Hallway panel", theme: "hallway-clock" },
  ],
  themes: [
    { id: "kitchen-strip", name: "Kitchen strip" },
    { id: "hallway-clock", name: "Hallway clock" },
  ],
};

/** One card and one drive, with a name chosen for the drive. */
const DEVICES: DeviceSettings = {
  available: {
    gpus: [{ id: "gpu-0", name: "NVIDIA GeForce RTX 4070" }],
    disks: [{ id: "ssd-0", name: "Samsung SSD 990 PRO" }],
  },
  assigned: { gpu: "gpu-0" },
  names: { "ssd-0": "Data drive" },
};

/** The region over one run's answers, with both seams handed in. `published` is
 *  every status line the region handed the shell, in order: §7.6's strip is the
 *  shell's, so this is what the region *says* about the run rather than a bar it
 *  draws. A `undefined` entry is the region withdrawing the line as it leaves. */
async function mountHost(
  fixture: Fixture,
  refuse?: {
    readonly devices?: string;
    readonly display?: string;
    readonly answers?: string;
    readonly weather?: string;
  },
): Promise<{
  readonly container: HTMLDivElement;
  readonly wrote: Written;
  readonly published: (HostStatusLine | undefined)[];
}> {
  const settings = hostSettings(fixture, refuse);
  const published: (HostStatusLine | undefined)[] = [];
  const container = await mount(
    <HostSettingsRegion
      mode="this-pc"
      client={library(fixture)}
      settings={settings.client}
      onStatus={(line) => published.push(line)}
    />,
  );
  return { container, wrote: settings.wrote, published };
}

/** The line the shell's strip is showing: the last one published, or a defect
 *  this file names rather than a `null` a later assertion reports as a value.
 *  A run's own reads happen while the region is mounted, so the last entry
 *  during a case is a line — a withdrawal here means the region left. */
function statusLine(
  published: readonly (HostStatusLine | undefined)[],
): HostStatusLine {
  const last = published.at(-1);
  if (last === undefined) {
    throw new Error("the region published no status line, or withdrew it");
  }
  return last;
}

/** One display row, by the display it names. */
function displayRow(container: HTMLElement, id: string): HTMLElement {
  return must(
    container.querySelector<HTMLElement>(`[data-yunari-host-display="${id}"]`),
    `the row for ${id}`,
  );
}

/** What a row says the display shows. */
function shownOn(row: HTMLElement): string {
  return (
    must(
      row.querySelector<HTMLElement>("[data-yunari-host-display-theme]"),
      "the theme a display shows",
    ).textContent ?? ""
  );
}

/** Whether a row says the display follows this PC rather than holding its own. */
function follows(row: HTMLElement): boolean {
  return row.querySelector("[data-yunari-host-display-follows]") !== null;
}

/** One device's name field. */
function nameField(container: HTMLElement, id: string): HTMLInputElement {
  return must(
    container.querySelector<HTMLInputElement>(
      `[data-yunari-host-name="${id}"]`,
    ),
    `the name row for ${id}`,
  );
}

/** The unit preference rows the display section draws, in the order it draws
 *  them. */
function unitRows(container: HTMLElement): readonly string[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-yunari-host-unit]"),
  ).map((row) => row.getAttribute("data-yunari-host-unit") ?? "");
}

/** The answer rows the questions section draws, by the slot each asks about. */
function answerRows(container: HTMLElement): readonly string[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-yunari-host-answer]"),
  ).map((row) => row.getAttribute("data-yunari-host-answer") ?? "");
}

/** What a §5 select's well prints as its value — the hook the control itself
 *  publishes, rather than the `font-mono` beside it. */
function selectValue(container: HTMLElement, hook: string): string {
  const trigger = must(container.querySelector<HTMLElement>(hook), hook);
  return (
    must(
      trigger.querySelector<HTMLElement>("[data-yunari-value]"),
      `${hook}'s value`,
    ).getAttribute("data-yunari-value") ?? ""
  );
}

/** Opens a select and answers the values it offers, in order. */
async function offered(trigger: HTMLElement): Promise<readonly string[]> {
  await act(async () => trigger.click());
  return Array.from(
    document.body.querySelectorAll<HTMLElement>("[data-yunari-option]"),
  ).map((option) => option.getAttribute("data-yunari-option") ?? "");
}

/** Presses one value inside the select that is open. **Base UI commits a list
 *  item only when the press that precedes the click started on it**, so the
 *  press is part of the interaction rather than a detail of the driver. */
async function choose(value: string): Promise<void> {
  const option = must(
    document.body.querySelector<HTMLElement>(`[data-yunari-option="${value}"]`),
    `the ${value} option`,
  );
  await act(async () =>
    option.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerType: "mouse",
        button: 0,
      }),
    ),
  );
  await act(async () =>
    option.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
    ),
  );
}

/** Types into a field the way a person does. **Assigning `value` directly
 *  leaves React's own tracker believing nothing changed**, so the draft never
 *  moves and the case would read a commit that was never offered one. */
async function type(field: HTMLInputElement, text: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Leaves a field, which is the act that commits a draft. */
async function leave(field: HTMLInputElement): Promise<void> {
  await act(async () => {
    field.focus();
    field.blur();
  });
}

/** Presses Enter in a field, which is the other act that commits a draft. */
async function enter(field: HTMLInputElement): Promise<void> {
  await act(async () => {
    field.focus();
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
}

/** The region is the Host mode's surface and no other's. The shell renders one
 *  `[data-yunari-mode-region]` section for every non-editor mode and mounts
 *  both regions in it, so a region that drew itself in a mode it does not own
 *  would be the second surface in one section. */
it("renders no region for a mode that is not Host", async () => {
  const container = await mount(<HostSettingsRegion mode="themes" />);
  expect(container.querySelector("[data-yunari-host-region]")).toBeNull();
  expect(container.textContent).toBe("");
});

/**
 * The plan's second case: **every display the route answers is listed, and a
 * display holding no theme of its own is shown the default's name** — which is
 * what it actually shows, because the route serves it that.
 *
 * The row says both things: the theme's name, and that the answer came from this
 * PC rather than from that display. A name alone would read as a choice the
 * display made, which is the one act this region does not perform.
 */
it("names each display, and the default for the ones with none", async () => {
  const { container, published } = await mountHost(TWO_DISPLAYS);

  const rows = Array.from(
    container.querySelectorAll<HTMLElement>("[data-yunari-host-display]"),
  );
  expect(
    rows.map((row) => row.textContent?.startsWith("This PC") ?? false),
    "the route's own order is not kept, This PC first",
  ).toEqual([true, false]);

  const own = displayRow(container, "hallway");
  expect(shownOn(own), "a display with its own theme does not name it").toBe(
    "Hallway clock",
  );
  expect(
    follows(own),
    "a display with a theme of its own is said to be following this PC",
  ).toBe(false);

  const local = displayRow(container, "this-pc");
  expect(
    shownOn(local),
    "a display with no theme of its own is not shown the default",
  ).toBe("Kitchen strip");
  expect(
    follows(local),
    "a display with no theme of its own does not say where its theme came from",
  ).toBe(true);

  expect(
    statusLine(published).displays,
    "the line published does not count the displays the route answered",
  ).toBe(uiCopy.hostSettings.status.displays(2));
  expect(
    statusLine(published).status,
    "the line published does not rest on the page's own sentence",
  ).toBe(uiCopy.hostSettings.status.ready);
});

/**
 * The plan's first case, and the one that carries the per-display model: **a
 * theme that binds only `cpu.load` offers no GPU row for that display**.
 *
 * Three facts in one run, because they are one decision. This PC holds no theme
 * of its own, so the region asks about the default's — the fallback reaches the
 * route, which is what makes the questions the answers of a display's use of a
 * theme. That theme raises nothing, so no section is drawn at all. And the
 * hallway's theme raises two slots while only one is unanswered, so the row that
 * is drawn is the unanswered one.
 */
it("asks only the questions the theme on that display raises", async () => {
  const { container, wrote } = await mountHost({
    ...TWO_DISPLAYS,
    questions: {
      "this-pc/kitchen-strip": { required: [], answers: {} },
      "hallway/hallway-clock": {
        required: ["gpu", "data-disk"],
        answers: { gpu: "gpu-0" },
      },
    },
    devices: DEVICES,
  });

  expect(
    wrote.asked,
    "the region did not ask about the theme this display falls back to",
  ).toEqual([{ display: "this-pc", theme: "kitchen-strip" }]);
  expect(
    container.querySelector("[data-yunari-host-section='questions']"),
    "a theme that reads no assignable hardware is asked a question anyway",
  ).toBeNull();

  await act(async () => displayRow(container, "hallway").click());

  expect(
    answerRows(container),
    "the region does not ask exactly the slots this theme leaves unanswered",
  ).toEqual(["data-disk"]);
  expect(
    must(
      container.querySelector<HTMLElement>(
        "[data-yunari-host-section='questions']",
      ),
      "the questions section",
    ).textContent,
    "the section does not name the theme the questions belong to",
  ).toContain(uiCopy.hostSettings.questions.heading("Hallway clock"));
  expect(
    selectValue(container, "[data-yunari-host-answer='data-disk']"),
    "an unanswered slot does not open on following this PC's settings",
  ).toBe("");
});

/** Every device a slot offers, with the automatic choice first: it exists
 *  whatever the count, so the control always shows something and a choice can be
 *  undone. The chosen device is the value the well prints. */
it("offers each slot's devices with the automatic choice first", async () => {
  const { container } = await mountHost({ ...TWO_DISPLAYS, devices: DEVICES });

  expect(
    selectValue(container, "[data-yunari-host-device-group='gpu']"),
    "the slot does not show the device that was chosen for it",
  ).toBe("gpu-0");
  expect(
    selectValue(container, "[data-yunari-host-device-group='system-disk']"),
    "a slot with nothing chosen does not open on the automatic choice",
  ).toBe("");

  expect(
    await offered(
      must(
        container.querySelector<HTMLElement>(
          "[data-yunari-host-device-group='gpu']",
        ),
        "the card slot",
      ),
    ),
    "the card slot does not offer the automatic choice before the devices",
  ).toEqual(["", "gpu-0"]);

  expect(
    must(
      container.querySelector<HTMLInputElement>(
        "[data-yunari-host-name='ssd-0']",
      ),
      "the name row for the drive",
    ).value,
    "a device with a chosen name does not show it",
  ).toBe("Data drive");
});

/**
 * **The route replaces the whole settings object**, so a write that sent only
 * the field it changed would clear the other. The patch is merged into what the
 * region holds, and both fields travel.
 */
it("writes both device fields together, because the route replaces the object", async () => {
  const { container, wrote, published } = await mountHost({
    ...TWO_DISPLAYS,
    devices: DEVICES,
  });

  await type(nameField(container, "gpu-0"), "Graphics card");
  await leave(nameField(container, "gpu-0"));

  expect(
    wrote.devices,
    "a name write did not carry the assignment beside it",
  ).toEqual([
    {
      assigned: { gpu: "gpu-0" },
      names: { "ssd-0": "Data drive", "gpu-0": "Graphics card" },
    },
  ]);
  expect(
    statusLine(published).status,
    "the line published does not report the write",
  ).toBe(uiCopy.hostSettings.status.savedDevices);
});

/**
 * **A keystroke writes a draft, not the setting.** The host rewrites the whole
 * settings file on a write, so committing per character would be one rewrite per
 * letter — the field commits on the way out, which is the moment the page this
 * absorbs commits on.
 */
it("commits a device name on the way out, not on every keystroke", async () => {
  const { container, wrote } = await mountHost({
    ...TWO_DISPLAYS,
    devices: DEVICES,
  });
  await type(nameField(container, "gpu-0"), "Card");
  expect(
    wrote.devices,
    "a keystroke wrote the setting rather than a draft",
  ).toEqual([]);

  await leave(nameField(container, "gpu-0"));
  expect(
    wrote.devices.length,
    "leaving the field did not commit the draft",
  ).toBe(1);

  // A blur that changed nothing is not a write: the file is not rewritten for a
  // field the person looked at.
  await leave(nameField(container, "gpu-0"));
  expect(
    wrote.devices.length,
    "a blur that changed nothing wrote the settings again",
  ).toBe(1);
});

/** The display form sends both fields for the same reason the device form does,
 *  and the units sentence says which screens the change has not reached yet. */
it("writes both display fields together", async () => {
  const { container, wrote } = await mountHost({
    ...TWO_DISPLAYS,
    preferences: {
      settings: { measurement: "imperial" },
      zones: ["UTC", "Europe/Paris"],
    },
  });

  const zone = must(
    container.querySelector<HTMLElement>("[data-yunari-host-time-zone]"),
    "the clock's zone row",
  );
  expect(
    selectValue(container, "[data-yunari-host-time-zone]"),
    "a display with no chosen zone does not open on this PC's own",
  ).toBe("");
  expect(
    await offered(zone),
    "the zone list does not lead with this PC's own zone",
  ).toEqual(["", "UTC", "Europe/Paris"]);
  await choose("Europe/Paris");

  expect(
    wrote.display,
    "a zone write did not carry the units beside it",
  ).toEqual([{ timeZone: "Europe/Paris", measurement: "imperial", units: {} }]);
});

/**
 * **One row per unit preference, and a save carries only the field that
 * changed.** The route replaces the whole settings object, so the unchanged
 * fields travel with the new one — and within `units` the untouched families
 * are kept rather than cleared.
 */
it("renders a row per unit preference and writes only the changed field", async () => {
  const { container, wrote } = await mountHost({
    ...TWO_DISPLAYS,
    preferences: {
      settings: { measurement: "imperial", units: { data: "decimal" } },
      zones: [],
    },
  });

  expect(
    unitRows(container),
    "the display section does not offer every unit preference",
  ).toEqual([
    "clock",
    "data",
    "dataScale",
    "rate",
    "rateScale",
    "fan",
    "windSpeed",
    "pressure",
  ]);
  expect(
    selectValue(container, "[data-yunari-host-unit='clock']"),
    "a family with no stored choice does not open on its own default",
  ).toBe("auto");
  expect(
    selectValue(container, "[data-yunari-host-unit='data']"),
    "a stored unit preference is not shown",
  ).toBe("decimal");

  await offered(
    must(
      container.querySelector<HTMLElement>("[data-yunari-host-unit='clock']"),
      "the clock's unit row",
    ),
  );
  await choose("ghz");

  expect(
    wrote.display,
    "a unit write did not carry the other settings, or cleared the units beside it",
  ).toEqual([
    {
      timeZone: "",
      measurement: "imperial",
      units: { data: "decimal", clock: "ghz" },
    },
  ]);
});

/**
 * **An unknown value is the store's refusal, not a default.** The control
 * offers only values this build displays; a host that still refuses one has
 * said so, and that sentence is what the person reads.
 */
it("shows the store's refusal when a unit preference cannot be stored", async () => {
  const refusal = '"thz" is not a value for the "clock" unit preference.';
  const { container, published } = await mountHost(
    { ...TWO_DISPLAYS, preferences: { settings: {}, zones: [] } },
    { display: refusal },
  );

  await offered(
    must(
      container.querySelector<HTMLElement>("[data-yunari-host-unit='clock']"),
      "the clock's unit row",
    ),
  );
  await choose("ghz");

  expect(
    statusLine(published).status,
    "the store's refusal did not reach the person",
  ).toBe(uiCopy.hostSettings.status.failed(refusal));
});

/** The weather form's own rows, by the hook each publishes. */
function weatherField(container: HTMLElement, hook: string): HTMLInputElement {
  return must(container.querySelector<HTMLInputElement>(hook), hook);
}

const WEATHER: WeatherSettings = {
  provider: "open-meteo",
  label: "Berlin, Berlin, DE",
  latitude: 52.52,
  longitude: 13.41,
  useWindowsLocation: false,
  pollIntervalMs: 600000,
};

/**
 * **The form's own units, and the one write they all travel in.** The interval
 * is set in seconds and stored in milliseconds — the provider polls on a clock,
 * a person sets a cadence — and every control writes the whole settings object,
 * because the route replaces it. A searched place fills the three location
 * fields from geocoding rather than being typed in by hand.
 */
it("saves the weather form in seconds and fills a searched place", async () => {
  const { container, wrote } = await mountHost({
    ...TWO_DISPLAYS,
    weather: WEATHER,
    places: [
      {
        label: "Paris, Ile-de-France, FR",
        latitude: 48.86,
        longitude: 2.35,
      },
    ],
  });

  const interval = weatherField(container, "[data-yunari-weather-interval]");
  expect(
    interval.value,
    "a stored millisecond interval is not drawn in seconds",
  ).toBe("600");
  await type(interval, "120");
  await leave(interval);
  // **Every commit carries the whole object**, because the route replaces it:
  // a client that sent only the changed field would pass a per-field check and
  // silently clear the rest.
  const timed = { ...WEATHER, pollIntervalMs: 120000 };
  expect(
    wrote.weather.at(-1),
    "seconds typed into the form were not stored as milliseconds, or the rest of the object was dropped",
  ).toEqual(timed);

  await offered(
    must(
      container.querySelector<HTMLElement>("[data-yunari-weather-provider]"),
      "the weather provider select",
    ),
  );
  await choose("weatherapi");
  const repointed = { ...timed, provider: "weatherapi" as const };
  expect(wrote.weather.at(-1), "the provider save was not whole").toEqual(
    repointed,
  );

  await act(async () =>
    must(
      container.querySelector<HTMLElement>(
        "[data-yunari-weather-windows-location]",
      ),
      "the Windows location switch",
    ).click(),
  );
  const located = { ...repointed, useWindowsLocation: true };
  expect(
    wrote.weather.at(-1),
    "the Windows location save was not whole",
  ).toEqual(located);

  const search = weatherField(container, "[data-yunari-weather-search]");
  await type(search, "Paris");
  await enter(search);
  expect(wrote.searches).toEqual(["Paris"]);

  const place = must(
    container.querySelector<HTMLElement>(
      '[data-yunari-weather-place="Paris, Ile-de-France, FR"]',
    ),
    "the searched place",
  );
  await act(async () => place.click());

  expect(
    wrote.weather.at(-1),
    "the searched place did not fill the form and save the whole object",
  ).toEqual({
    ...located,
    label: "Paris, Ile-de-France, FR",
    latitude: 48.86,
    longitude: 2.35,
  });
});

/** The credit belongs to the backend the settings name, and its own page is the
 *  link: OpenWeather's terms ask for one, and a text-only credit could not
 *  carry it. */
it.each([
  [
    "open-meteo",
    "Weather data by Open-Meteo.com",
    "https://open-meteo.com/en/licence",
  ],
  ["weatherapi", "Powered by WeatherAPI.com", "https://www.weatherapi.com/"],
  [
    "openweathermap",
    "Weather data provided by OpenWeather",
    "https://openweathermap.org/",
  ],
] as const)(
  "links the %s attribution inside the weather group",
  async (provider, text, url) => {
    const { container } = await mountHost({
      ...TWO_DISPLAYS,
      weather: {
        ...WEATHER,
        provider,
        attribution: { text, url },
      },
    });

    const link = must(
      container.querySelector<HTMLAnchorElement>(
        "[data-yunari-weather-attribution]",
      ),
      "the weather attribution",
    );
    expect(link.textContent).toBe(text);
    expect(link.getAttribute("href")).toBe(url);
    // A screen reader must hear which backend the credit names: an overriding
    // label would replace the visible text rather than add to it.
    const accessibleName =
      link.getAttribute("aria-label") ?? link.textContent ?? "";
    expect(accessibleName).toContain(text);
  },
);

/**
 * **An emptied interval is a refusal, not a zero.** Milliseconds of `0` are
 * below the host's own floor and `NaN` is not JSON, so a cleared field must
 * keep the draft and send nothing — the same rule every number control in the
 * editor follows.
 */
it("does not save an emptied poll interval as zero or NaN", async () => {
  const { container, wrote } = await mountHost({
    ...TWO_DISPLAYS,
    weather: WEATHER,
  });

  const interval = weatherField(container, "[data-yunari-weather-interval]");
  await type(interval, "");
  await leave(interval);

  expect(wrote.weather, "a cleared interval was written as a number").toEqual(
    [],
  );
  expect(
    interval.getAttribute("aria-invalid"),
    "the cleared field did not report itself as refused",
  ).toBe("true");
});

/** A refused write is the host's own words, after the region's own lead: the
 *  reason is what the person acts on, and a silent failure is indistinguishable
 *  from one that worked. */
it("reports the host's own reason when a write is refused", async () => {
  const refusal = "Device settings are available on this PC only.";
  const { container, published } = await mountHost(
    { ...TWO_DISPLAYS, devices: DEVICES },
    { devices: refusal },
  );

  await type(nameField(container, "gpu-0"), "Card");
  await leave(nameField(container, "gpu-0"));

  expect(
    statusLine(published).status,
    "the refusal did not reach the person",
  ).toBe(uiCopy.hostSettings.status.failed(refusal));
});

/**
 * **A display list that could not be read is not a display list of none.** The
 * section draws no row and the status line carries the host's reason, because a
 * fabricated empty answer would say this PC has no displays — a claim about the
 * machine that nothing made.
 */
it("draws no display when the display map cannot be read", async () => {
  const { container, published } = await mountHost({
    ...TWO_DISPLAYS,
    refuseDisplays: true,
  });

  expect(
    container.querySelectorAll("[data-yunari-host-display]"),
    "a failed read was drawn as an empty list",
  ).toHaveLength(0);
  expect(
    statusLine(published).displays,
    "a failed read was counted as no displays",
  ).toBeNull();
  expect(
    statusLine(published).status,
    "the host's reason did not reach the person",
  ).toBe("Settings are available on this PC only.");
});

/**
 * **§7.6's strip is the shell's, and this region draws none of its own.** The
 * drawing puts the host page's status line in the shell's bar, outside the
 * content region and outside it by construction; a strip here was a second bar
 * stacked on the shell's, and a live region inside a mode that unmounts is not
 * the one the person is reading.
 */
it("draws no status strip of its own, and publishes the line instead", async () => {
  const { container, published } = await mountHost(TWO_DISPLAYS);

  expect(
    container.querySelector("[data-yunari-host-status]"),
    "the region drew a status line the shell's strip also draws",
  ).toBeNull();
  expect(
    container.querySelector("[data-yunari-host-display-count]"),
    "the region drew a display count the shell's strip also draws",
  ).toBeNull();
  expect(
    published.length,
    "the region drew no line and published none either",
  ).toBeGreaterThan(0);
});

/**
 * **The clock's answer is its own, not the device save's sentence under a
 * borrowed key.** The page this absorbs spells one sentence for both writes, so
 * the two are indistinguishable by their value — which is exactly what made a
 * single key dangerous: sharpening the device sentence silently changed what a
 * time-zone save said. This makes the device sentence specific for one run and
 * watches the clock's answer stay the page's own.
 */
it("answers a zone write in its own words, not the device save's", async () => {
  const pageSentence = uiCopy.hostSettings.status.savedDevices;
  const sharpened = "Saved. Displays read the new card on their next frame.";
  const copy = uiCopy.hostSettings.status as { savedDevices: string };
  copy.savedDevices = sharpened;
  try {
    const { container, published } = await mountHost({
      ...TWO_DISPLAYS,
      preferences: {
        settings: { measurement: "imperial" },
        zones: ["Europe/Paris"],
      },
    });

    await offered(
      must(
        container.querySelector<HTMLElement>("[data-yunari-host-time-zone]"),
        "the clock's zone row",
      ),
    );
    await choose("Europe/Paris");

    expect(
      statusLine(published).status,
      "the clock reported the device save's sentence",
    ).toBe(pageSentence);
  } finally {
    copy.savedDevices = pageSentence;
  }
});

/**
 * **A line belongs to the visit that published it.** The region exists only
 * while the Host mode is showing, so its unmount *is* the mode moving — and the
 * line goes with it. Left standing in the shell, the next visit's strip would
 * mount already holding this visit's count and sentence: a count no read in that
 * visit answered, and a live region whose text was there before it was.
 */
it("withdraws its line when the region leaves, so the next visit paints none", async () => {
  const { published } = await mountHost(TWO_DISPLAYS);
  expect(
    statusLine(published).displays,
    "the visit published no line to withdraw",
  ).toBe(uiCopy.hostSettings.status.displays(2));

  await unmount();

  expect(
    published.at(-1),
    "the region left its line standing for the next visit",
  ).toBeUndefined();
});
