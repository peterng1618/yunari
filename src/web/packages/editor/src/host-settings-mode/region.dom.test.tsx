// @vitest-environment jsdom
/**
 * The Host mode's region: the four sections `packages/host/public/settings.html`
 * is, rebuilt in the
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
 * **And that the mode's status line is published rather than drawn.** the status-bar rule's
 * strip is the shell's, so this region hands it the two strings and the shell
 * places them; the line the strip shows is asserted in
 * `shell-layout.dom.test.tsx`, and what this file reads is what the region said.
 *
 * **What it deliberately does not measure.** jsdom lays nothing out and paints
 * nothing, so nothing here is a claim about how the region looks. The layout it
 * follows is read by its own gate, not by this file.
 */
import type { AssignableGroup, DisplayShape } from "@yunari/renderer-core";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { fixtureEntry } from "../store-mode/item-fixture.js";
import {
  type ThemedDisplay,
  type ThemeLibraryClient,
} from "../theme-library-client.js";
import { uiCopy } from "../ui-copy.js";
import {
  type DeviceSettings,
  type DisplayPreferences,
  type DisplayPreferencesWrite,
  type HostSettingsClient,
  type PanelHint,
  type ThemeAnswers,
  type WeatherPlace,
  type WeatherRead,
  type WeatherSettings,
} from "./client.js";
import { HostSettingsRegion, type HostStatusLine } from "./region.js";
import {
  type RemovalAnswer,
  type Source,
  SourceRefusedError,
  type SourceRow,
  type SourcesClient,
  type TestResult,
} from "./sources-client.js";

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
  /** The host could not read its display file, so the list is fail-closed. */
  readonly unreadableDisplays?: boolean;
  /** The custom sources the list route answers. */
  readonly sources?: readonly SourceRow[];
  /** The refusal a save answers with, in the route's own `field`/`reason`. */
  readonly sourceRefusal?: { readonly field: string; readonly reason: string };
  /** What the test route answers. */
  readonly sourceTest?: TestResult;
  /** What a delete answers about a credential it no longer sees referenced. */
  readonly sourceRemoval?: RemovalAnswer;
  /** The sentence a presentation write fails with, or `undefined`. */
  readonly refusePresentation?: string;
  /** What the host enumerates as attached panels. Absent is a machine with
   *  none, which is the ordinary case. */
  readonly panels?: readonly PanelHint[];
  /** The sentence an add fails with, or `undefined` for a landed add. */
  readonly refusePanel?: string;
  /** The sentence a delete fails with, or `undefined` for a landed delete. */
  readonly sourceRemoveFailure?: string;
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
  readonly presentation: {
    readonly id: string;
    readonly next: { readonly shape: DisplayShape; readonly rotation: number };
  }[];
  /** The panels an add sent, in order: what the request carried. */
  readonly panels: {
    readonly vendorId: number;
    readonly productId: number;
    readonly serial: string;
  }[];
  /** The displays a reconnect was asked for. */
  readonly reconnects: string[];
  /** The display renames, in order: id and the name sent. */
  readonly names: { readonly id: string; readonly label: string }[];
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
        ...(fixture.unreadableDisplays === true ? { unreadable: true } : {}),
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
    presentation: [],
    panels: [],
    reconnects: [],
    names: [],
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
      updateDisplayPresentation: async (id, next) => {
        wrote.presentation.push({ id, next });
        if (fixture.refusePresentation !== undefined) {
          throw new Error(fixture.refusePresentation);
        }
        // **Deliberately not the request.** The store decides the pair, so an
        // optimistic row would stand on a value the answer never carried and
        // these cases would pass without the replacement being exercised.
        return {
          shape: next.shape,
          rotation: next.shape === "rect" ? 180 : 45,
        };
      },
      // No panel attached is the ordinary machine, so the default fixture
      // answers an empty list rather than inventing one. A case that needs the
      // section sets `fixture.panels`.
      listPanels: async () => fixture.panels ?? [],
      addPanel: async (_label, panel) => {
        wrote.panels.push(panel);
        if (fixture.refusePanel !== undefined) {
          throw new Error(fixture.refusePanel);
        }
        return "lian-li-9-2";
      },
      // The controls section has its own test file; no case here sends a
      // command, so this answers the empty reply a silent panel gives.
      panelCommand: async () => "",
      // The reconnect route answers the status it left the display in; no case
      // here presses it, so the connected default is the host answering.
      reconnectPanel: async (id) => {
        wrote.reconnects.push(id);
        return "connected";
      },
      renameDisplay: async (id, label) => {
        wrote.names.push({ id, label });
        return label;
      },
    },
  };
}

/** Every source write the section made, in the order it made them. */
interface SourceWrites {
  readonly saved: Source[];
  readonly removed: string[];
  readonly tested: string[];
}

/** The host's source routes, with the list a mutable copy so a save is visible
 *  to the read the section makes after it. */
function sourcesClient(fixture: Fixture): {
  readonly client: SourcesClient;
  readonly wrote: SourceWrites;
} {
  const wrote: SourceWrites = { saved: [], removed: [], tested: [] };
  let rows = [...(fixture.sources ?? [])];

  return {
    wrote,
    client: {
      list: async () => rows,
      save: async (source) => {
        wrote.saved.push(source);
        if (fixture.sourceRefusal !== undefined) {
          throw new SourceRefusedError(
            fixture.sourceRefusal.field,
            fixture.sourceRefusal.reason,
          );
        }
        const row: SourceRow = {
          ...source,
          fieldCount: source.fields.length,
          health: "waiting",
          lastError: null,
          lastSuccessAt: null,
        };
        rows = rows.some((entry) => entry.id === source.id)
          ? rows.map((entry) => (entry.id === source.id ? row : entry))
          : [...rows, row];
      },
      remove: async (id) => {
        wrote.removed.push(id);
        if (fixture.sourceRemoveFailure !== undefined) {
          throw new Error(fixture.sourceRemoveFailure);
        }
        rows = rows.filter((entry) => entry.id !== id);
        return fixture.sourceRemoval ?? { unreferencedCredential: null };
      },
      test: async (id) => {
        wrote.tested.push(id);
        return fixture.sourceTest ?? { ok: true, elapsedMs: 5, values: [] };
      },
    },
  };
}

/** Two displays, one of them holding no theme of its own, and the two themes the
 *  library calls them. This PC leads, as the route always answers it first. */
const TWO_DISPLAYS: Fixture = {
  fallback: "kitchen-strip",
  displays: [
    {
      id: "this-pc",
      label: "This PC",
      kind: "local",
      theme: null,
      shape: "rect",
      rotation: 0,
    },
    {
      id: "hallway",
      label: "Hallway panel",
      kind: "paired",
      theme: "hallway-clock",
      shape: "rect",
      rotation: 0,
    },
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
 *  every status line the region handed the shell, in order: the strip is the
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
  readonly sources: SourceWrites;
  readonly published: (HostStatusLine | undefined)[];
}> {
  const settings = hostSettings(fixture, refuse);
  const sources = sourcesClient(fixture);
  const published: (HostStatusLine | undefined)[] = [];
  const container = await mount(
    <HostSettingsRegion
      mode="this-pc"
      client={library(fixture)}
      settings={settings.client}
      sources={sources.client}
      onStatus={(line) => published.push(line)}
    />,
  );
  return {
    container,
    wrote: settings.wrote,
    sources: sources.wrote,
    published,
  };
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

/** One segment of the screen-shape control, by the word it prints. */
function shapeSegment(container: HTMLElement, name: string): HTMLElement {
  const segment = Array.from(
    container.querySelectorAll<HTMLElement>("[data-yunari-host-display-shape]"),
  ).find((candidate) => candidate.textContent === name);
  return must(segment ?? null, `the ${name} shape segment`);
}

async function chooseShape(
  container: HTMLElement,
  name: string,
): Promise<void> {
  await act(async () => shapeSegment(container, name).click());
}

/** The rotation control's value well. */
function rotationWell(container: HTMLElement): HTMLInputElement {
  return must(
    container.querySelector<HTMLInputElement>(
      "[data-yunari-host-display-rotation-well]",
    ),
    "the rotation control's value well",
  );
}

/** What the rotation control's well prints, the degree mark included: the value
 *  alone would read as a bare number and not as an angle. The mark is a sibling
 *  of the input, so an input's `textContent` alone would miss it. */
function rotationMark(container: HTMLElement): string {
  const well = rotationWell(container);
  return `${well.value}${well.parentElement?.textContent ?? ""}`;
}

/** Commits a rotation through the control's own value well, the way a typed
 *  number is committed. */
async function commitRotation(
  container: HTMLElement,
  degrees: number,
): Promise<void> {
  const well = rotationWell(container);
  await type(well, String(degrees));
  await enter(well);
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

/** What a select's well prints as its value — the hook the control itself
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
 * The plan's first case: **a rectangular display's quarter-turn rotation is
 * written with its shape**, and the row is replaced from the host's answer
 * rather than optimistically.
 */
it("writes a rect display's quarter-turn rotation", async () => {
  const { container, wrote } = await mountHost({
    displays: [
      {
        id: "tv",
        label: "TV",
        kind: "paired",
        theme: null,
        shape: "rect",
        rotation: 0,
      },
    ],
  });
  await act(async () => displayRow(container, "tv").click());
  // The snap note belongs to the controls it describes: an editable display
  // reads it, a recordless selection does not (see the this-pc case).
  expect(container.textContent).toContain(
    uiCopy.hostSettings.displays.rotationSnapHint,
  );
  await commitRotation(container, 90);

  expect(wrote.presentation).toEqual([
    { id: "tv", next: { shape: "rect", rotation: 90 } },
  ]);
  // The row shows the host's answer (180), not the request (90): a write is
  // never drawn from what was sent.
  expect(displayRow(container, "tv").getAttribute("data-shape")).toBe("rect");
  expect(displayRow(container, "tv").getAttribute("data-rotation")).toBe("180");
  // The well prints the angle with its degree mark, and the answer's number.
  expect(rotationMark(container)).toBe("180°");
});

/** A circle's free angle is snapped into the rect rule when the shape changes,
 *  in the one write that sends both fields. */
it("snaps a circle angle when the shape becomes rect", async () => {
  const { container, wrote } = await mountHost({
    displays: [
      {
        id: "round",
        label: "Round",
        kind: "paired",
        theme: null,
        shape: "circle",
        rotation: 37,
      },
    ],
  });
  await act(async () => displayRow(container, "round").click());
  // A circle's angle is shown as degrees too, with the degree mark beside it.
  expect(rotationMark(container)).toBe("37°");
  await chooseShape(container, "Rect");

  expect(wrote.presentation).toEqual([
    { id: "round", next: { shape: "rect", rotation: 0 } },
  ]);
  expect(
    displayRow(container, "round").getAttribute("data-rotation"),
    "the row did not take the answer's snapped angle",
  ).toBe("180");
});

/** A refused write leaves the row on the value the host last answered. */
it("renames the chosen display and redraws its row", async () => {
  const { container, wrote } = await mountHost(TWO_DISPLAYS);
  await act(async () => displayRow(container, "hallway").click());

  const field = must(
    container.querySelector<HTMLInputElement>(
      "[data-yunari-host-display-name]",
    ),
    "the display name field",
  );
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(field, "Hallway TV");
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });

  expect(wrote.names).toEqual([{ id: "hallway", label: "Hallway TV" }]);
  // The row is the host's answer, so the list above updates without a reload.
  expect(displayRow(container, "hallway").textContent).toContain("Hallway TV");
});

it("keeps the row's previous presentation when the write is refused", async () => {
  const refusal = "That angle is not a quarter turn.";
  const { container, published } = await mountHost({
    displays: [
      {
        id: "tv",
        label: "TV",
        kind: "paired",
        theme: null,
        shape: "rect",
        rotation: 90,
      },
    ],
    refusePresentation: refusal,
  });
  await act(async () => displayRow(container, "tv").click());
  await commitRotation(container, 0);

  expect(
    displayRow(container, "tv").getAttribute("data-rotation"),
    "a refused write moved the row to the value it sent",
  ).toBe("90");
  expect(statusLine(published).status).toBe(
    uiCopy.hostSettings.status.failed(refusal),
  );
});

/** No row has been read, so no display is the selection: the absence sentence
 *  states a fact about `this-pc` and would be a claim nobody made. */
it("says nothing about presentation while no display has been read", async () => {
  const empty = await mountHost({ displays: [] });
  expect(empty.container.textContent).not.toContain(
    uiCopy.hostSettings.displays.presentationAbsent,
  );

  const failed = await mountHost({ ...TWO_DISPLAYS, refuseDisplays: true });
  expect(failed.container.textContent).not.toContain(
    uiCopy.hostSettings.displays.presentationAbsent,
  );
});

/** An unreadable file and an empty one answer the same list, so the region has
 *  to name the file rather than draw an empty library that looks healthy. */
it("names the display file when the host could not read it", async () => {
  const corrupt = await mountHost({
    ...TWO_DISPLAYS,
    unreadableDisplays: true,
  });
  const alert = must(
    corrupt.container.querySelector("[data-yunari-host-displays-unreadable]"),
    "unreadable display-file alert",
  );
  expect(alert.getAttribute("role")).toBe("alert");
  expect(alert.textContent).toBe(uiCopy.hostSettings.displays.unreadable);

  const healthy = await mountHost(TWO_DISPLAYS);
  expect(
    healthy.container.querySelector("[data-yunari-host-displays-unreadable]"),
  ).toBeNull();
});

/** This PC is the machine, not a paired screen: it has no record to present, so
 *  the section says why rather than drawing a disabled control. */
it("draws no presentation controls for this-pc", async () => {
  const { container } = await mountHost({
    displays: [
      {
        id: "this-pc",
        label: "This PC",
        kind: "local",
        theme: null,
        shape: "rect",
        rotation: 0,
      },
    ],
  });
  expect(
    container.querySelector("[data-yunari-host-display-shape]"),
  ).toBeNull();
  expect(container.textContent).toContain(
    uiCopy.hostSettings.displays.presentationAbsent,
  );
  expect(
    container.textContent,
    "a display with no controls still reads the snap note",
  ).not.toContain(uiCopy.hostSettings.displays.rotationSnapHint);
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
 * **the strip is the shell's, and this region draws none of its own.** The
 * shell puts the host page's status line in the shell's bar, outside the
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

/** A working source, and one the provider could not read. The second has no
 *  chosen name, so its row is named by its id. */
const SOURCE_ROW: SourceRow = {
  id: "fixture",
  name: "Fixture",
  url: "http://127.0.0.1:4291/data",
  intervalMs: 60_000,
  timeoutMs: 5_000,
  auth: { kind: "query", queryName: "apikey", credentialId: "fixture-key" },
  fields: [
    { id: "cpu-load", label: "CPU load", pointer: "/cpu/load", type: "number" },
  ],
  fieldCount: 1,
  health: "ok",
  lastError: null,
  lastSuccessAt: "2026-10-24T10:00:00.000Z",
};

/** A source whose field carries every property the form does not show. An edit
 *  that rebuilt the field from the five shown would drop all five, and the
 *  route replaces the whole entry, so nothing would warn. */
const SCALED_ROW: SourceRow = {
  ...SOURCE_ROW,
  id: "scaled",
  name: "Scaled",
  fields: [
    {
      id: "temperature",
      label: "Temperature",
      pointer: "/temp",
      type: "number",
      family: "thermal",
      unit: "C",
      unitKind: "temperature",
      scale: 0.01,
      offset: 2,
      expectedTier: "extended",
    },
  ],
};

const BROKEN_ROW: SourceRow = {
  id: "broken",
  name: "",
  url: "https://example.test/feed",
  intervalMs: 10_000,
  timeoutMs: 1_000,
  fields: [
    { id: "one", label: "One", pointer: "/one", type: "number" },
    { id: "two", label: "Two", pointer: "/two", type: "text" },
  ],
  fieldCount: 2,
  health: "error",
  lastError: "The source answered 503.",
  lastSuccessAt: null,
};

const SOURCES_COPY = uiCopy.hostSettings.sources;

function sourceRow(container: HTMLElement, id: string): HTMLElement {
  return must(
    container.querySelector<HTMLElement>(`[data-yunari-source-row="${id}"]`),
    `the ${id} source row`,
  );
}

function input(container: HTMLElement, attribute: string): HTMLInputElement {
  return must(
    container.querySelector<HTMLInputElement>(`[${attribute}]`),
    `the ${attribute} field`,
  );
}

/** Submits the source form the way its own button does. */
async function submitSource(container: HTMLElement): Promise<void> {
  const form = must(
    container.querySelector<HTMLFormElement>("[data-yunari-source-form]"),
    "the source form",
  );
  await act(async () =>
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    ),
  );
}

/**
 * **Every source is listed with the four facts the route answers**: its health,
 * when it last read, how many fields it publishes and the host's redacted
 * failure. A row that printed only its name would leave the person unable to
 * tell a working source from one that has never answered.
 */
it("lists each source with health, last success, field count and last error", async () => {
  const { container } = await mountHost({
    ...TWO_DISPLAYS,
    sources: [SOURCE_ROW, BROKEN_ROW],
  });

  const healthy = sourceRow(container, "fixture");
  expect(
    healthy.querySelector(`[data-yunari-source-health="ok"]`)?.textContent,
    "the healthy source did not say it is reading",
  ).toBe(SOURCES_COPY.health.ok);
  expect(healthy.textContent, "the last successful read is missing").toContain(
    SOURCES_COPY.lastSuccess("2026-10-24T10:00:00.000Z"),
  );
  expect(healthy.textContent, "the field count is missing").toContain(
    SOURCES_COPY.fieldCount(1),
  );

  const broken = sourceRow(container, "broken");
  expect(
    broken.querySelector(`[data-yunari-source-health="error"]`)?.textContent,
    "the failing source did not say it is in error",
  ).toBe(SOURCES_COPY.health.error);
  expect(broken.textContent, "the host's reason is missing").toContain(
    "The source answered 503.",
  );
  expect(broken.textContent, "a source that never read says nothing").toContain(
    SOURCES_COPY.neverRead,
  );
  expect(broken.textContent, "the field count is missing").toContain(
    SOURCES_COPY.fieldCount(2),
  );

  // Three rows of "Edit" are three buttons a screen reader cannot tell apart;
  // each one's name carries the source it acts on.
  expect(
    healthy
      .querySelector('[data-yunari-source-edit="fixture"]')
      ?.getAttribute("aria-label"),
    "the edit button does not name its source",
  ).toBe(SOURCES_COPY.editSource("Fixture"));
  expect(
    healthy
      .querySelector('[data-yunari-source-delete="fixture"]')
      ?.getAttribute("aria-label"),
    "the delete button does not name its source",
  ).toBe(SOURCES_COPY.deleteSource("Fixture"));
});

/**
 * **The form refuses the same shapes the route refuses, and passes on the
 * route's own reason when it does not.**
 *
 * The local check is a round trip saved, not the authority: a URL the host
 * would reject is refused in the form, and a host refusal that only the route
 * can see is shown in the host's words rather than replaced by "failed".
 */
it("refuses a bad address locally and shows the route's reason beside the form", async () => {
  const hostReason = 'source "fixture" url must be an http or https URL';
  const { container, sources, published } = await mountHost({
    ...TWO_DISPLAYS,
    sourceRefusal: { field: "fixture", reason: hostReason },
  });

  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>("[data-yunari-source-add]"),
      "the add button",
    ).click(),
  );
  await type(input(container, "data-yunari-source-id"), "fixture");
  await type(input(container, "data-yunari-source-url"), "ftp://nope");
  await submitSource(container);

  expect(sources.saved, "a bad address reached the host").toHaveLength(0);
  expect(container.textContent).toContain(SOURCES_COPY.invalidUrl);

  await type(
    input(container, "data-yunari-source-url"),
    "http://127.0.0.1:4291/data",
  );
  await submitSource(container);

  expect(sources.saved, "a valid address did not reach the host").toHaveLength(
    1,
  );
  expect(
    must(
      container.querySelector("[data-yunari-source-error]"),
      "the host's refusal",
    ).textContent,
    "the refusal is not in the host's own words",
  ).toBe(hostReason);
  // The region's strip is what outlives the form; it must not be left on
  // "Saving…" while the form holds the refusal.
  expect(
    statusLine(published).status,
    "the status line still reads as a write in flight",
  ).toBe(uiCopy.hostSettings.status.failed(hostReason));
});

/**
 * **A test shows what the route answered and stores nothing.** The status, the
 * time and the mapped values are the three readings that tell a person the
 * endpoint is the one they meant; the route writes no file, so neither does the
 * page.
 */
it("shows a test's status, elapsed time and mapped values, and stores nothing", async () => {
  const { container, sources } = await mountHost({
    ...TWO_DISPLAYS,
    sources: [SOURCE_ROW],
    sourceTest: {
      ok: true,
      status: 200,
      elapsedMs: 12,
      values: [{ id: "cpu-load", value: "42.5" }],
    },
  });

  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>(
        '[data-yunari-source-test="fixture"]',
      ),
      "the test button",
    ).click(),
  );

  const result = must(
    container.querySelector('[data-yunari-source-test-result="fixture"]'),
    "the test's answer",
  );
  expect(result.textContent, "the status is missing").toContain("200");
  expect(result.textContent, "the elapsed time is missing").toContain("12 ms");
  expect(result.textContent, "the mapped value is missing").toContain(
    "cpu-load 42.5",
  );
  expect(sources.tested).toEqual(["fixture"]);
  expect(sources.saved, "a test wrote a source").toHaveLength(0);
  expect(sources.removed, "a test deleted a source").toHaveLength(0);
});

/**
 * **Delete asks first, and a credential answer is an offer rather than a
 * deletion.** The route says which credential nothing references any more; the
 * page may offer to clear it, and declining must leave it alone — the key is
 * the owner's, not the page's.
 */
it("confirms a delete, offers the unreferenced credential and leaves it on decline", async () => {
  const fetched = vi.fn();
  vi.stubGlobal("fetch", fetched);
  try {
    const { container, sources } = await mountHost({
      ...TWO_DISPLAYS,
      sources: [SOURCE_ROW],
      sourceRemoval: { unreferencedCredential: "fixture-key" },
    });

    await act(async () =>
      must(
        container.querySelector<HTMLButtonElement>(
          '[data-yunari-source-delete="fixture"]',
        ),
        "the delete button",
      ).click(),
    );
    expect(
      must(
        container.querySelector("[data-yunari-source-confirm]"),
        "the delete confirmation",
      ),
      "delete ran without asking",
    ).not.toBeNull();
    expect(sources.removed, "delete ran before it was confirmed").toHaveLength(
      0,
    );

    await act(async () =>
      must(
        container.querySelector<HTMLButtonElement>(
          '[data-yunari-source-confirm-delete="fixture"]',
        ),
        "the confirm button",
      ).click(),
    );
    expect(sources.removed).toEqual(["fixture"]);

    const offer = must(
      container.querySelector(
        '[data-yunari-source-credential-offer="fixture-key"]',
      ),
      "the credential offer",
    );
    expect(offer.textContent, "the offer does not name the key").toContain(
      "fixture-key",
    );

    await act(async () =>
      must(
        container.querySelector<HTMLButtonElement>(
          "[data-yunari-source-keep-credential]",
        ),
        "the keep button",
      ).click(),
    );
    expect(
      container.querySelector("[data-yunari-source-credential-offer]"),
      "declining did not take the offer away",
    ).toBeNull();
    expect(
      fetched,
      "declining still cleared the credential",
    ).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

/**
 * **The page prints the authored address and never one a key was spelled
 * into.** A credential referenced through `auth` is added by the host at fetch
 * time; if the page composed it, a secret would be on screen and in the DOM.
 */
it("renders the authored address and no credential", async () => {
  const { container } = await mountHost({
    ...TWO_DISPLAYS,
    sources: [SOURCE_ROW],
  });

  const address = must(
    container.querySelector('[data-yunari-source-row-url="fixture"]'),
    "the source's address",
  );
  expect(address.textContent).toBe(SOURCE_ROW.url);
  expect(
    address.textContent,
    "the credential id reached the address",
  ).not.toContain("fixture-key");
  expect(
    address.textContent,
    "the key's query name reached the address",
  ).not.toContain("apikey");
});

/** Opens one row's edit form. */
async function openEdit(container: HTMLElement, id: string): Promise<void> {
  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>(
        `[data-yunari-source-edit="${id}"]`,
      ),
      `the ${id} edit button`,
    ).click(),
  );
}

/**
 * **An edit keeps every field property the form does not show.** The route
 * replaces the whole source, so a field rebuilt from id/label/pointer/type/unit
 * would drop the scale and offset the provider multiplies and adds, and the
 * family and tier the catalogue names — silently, on a name change alone.
 */
it("keeps field properties the form does not show when an edit is saved", async () => {
  const { container, sources } = await mountHost({
    ...TWO_DISPLAYS,
    sources: [SCALED_ROW],
  });

  await openEdit(container, "scaled");
  await type(input(container, "data-yunari-source-name"), "Scaled renamed");
  await submitSource(container);

  expect(sources.saved, "the edit did not reach the host").toHaveLength(1);
  expect(
    sources.saved[0]?.fields[0],
    "an unshown field property was stripped by the edit",
  ).toEqual(SCALED_ROW.fields[0]);
  expect(sources.saved[0]?.name).toBe("Scaled renamed");
});

/**
 * **A source id is immutable once created.** The keys a theme reads embed it
 * (`custom.<id>.<field>`), so the edit form shows it read-only and the write
 * always uses the stored id; a draft that changed it anyway is refused rather
 * than appended as a second source.
 */
it("keeps the stored id while editing and refuses a changed draft id", async () => {
  const { container, sources } = await mountHost({
    ...TWO_DISPLAYS,
    sources: [SOURCE_ROW],
  });

  await openEdit(container, "fixture");
  const idField = input(container, "data-yunari-source-id");
  expect(idField.readOnly, "the id field is editable while editing").toBe(true);
  expect(
    container.textContent,
    "the form does not say why the id is fixed",
  ).toContain(SOURCES_COPY.idFixed);

  await type(input(container, "data-yunari-source-name"), "Renamed");
  await submitSource(container);

  expect(sources.saved, "the edit did not reach the host").toHaveLength(1);
  expect(sources.saved[0]?.id, "the save did not use the stored id").toBe(
    "fixture",
  );

  // The field is read-only; this forces the draft directly to prove the guard
  // behind it, because a rename would otherwise append a second source.
  await openEdit(container, "fixture");
  await type(input(container, "data-yunari-source-id"), "fixture2");
  await submitSource(container);

  expect(sources.saved, "a changed id reached the host").toHaveLength(1);
  expect(
    must(
      container.querySelector("[data-yunari-source-field-reason]"),
      "the id refusal",
    ).textContent,
    "the changed id was not refused in the form's own words",
  ).toBe(SOURCES_COPY.idFixed);
});

/**
 * **The credential offer's accept path clears the key the route named.** The
 * decline case proves nothing is touched; this proves the accept reaches the
 * credential route with the id and reports what happened.
 */
it("clears the credential the delete offer names, when accepted", async () => {
  const calls: { readonly method: string; readonly url: string }[] = [];
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({ method: init?.method ?? "GET", url: String(input) });
      return new Response("{}", { status: 200 });
    },
  );
  vi.stubGlobal("fetch", fetcher);
  try {
    const { container, published } = await mountHost({
      ...TWO_DISPLAYS,
      sources: [SOURCE_ROW],
      sourceRemoval: { unreferencedCredential: "fixture-key" },
    });

    await act(async () =>
      must(
        container.querySelector<HTMLButtonElement>(
          '[data-yunari-source-delete="fixture"]',
        ),
        "the delete button",
      ).click(),
    );
    await act(async () =>
      must(
        container.querySelector<HTMLButtonElement>(
          '[data-yunari-source-confirm-delete="fixture"]',
        ),
        "the confirm button",
      ).click(),
    );
    await act(async () =>
      must(
        container.querySelector<HTMLButtonElement>(
          "[data-yunari-source-remove-credential]",
        ),
        "the remove-credential button",
      ).click(),
    );
    await act(async () => {});

    expect(calls, "the accept did not reach the credential route").toEqual([
      { method: "DELETE", url: "/api/credentials/fixture-key" },
    ]);
    expect(
      container.querySelector("[data-yunari-source-credential-offer]"),
      "the offer stayed after the key was removed",
    ).toBeNull();
    expect(statusLine(published).status).toBe(SOURCES_COPY.credentialRemoved);
  } finally {
    vi.unstubAllGlobals();
  }
});

/**
 * **A failed delete reports itself in the delete's own words.** The save
 * sentence says "Could not save", which is wrong for a delete and was the only
 * sentence the status line had.
 */
it("reports a failed delete with the delete's own sentence", async () => {
  const failure = "The host refused the delete (500).";
  const { container, published } = await mountHost({
    ...TWO_DISPLAYS,
    sources: [SOURCE_ROW],
    sourceRemoveFailure: failure,
  });

  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>(
        '[data-yunari-source-delete="fixture"]',
      ),
      "the delete button",
    ).click(),
  );
  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>(
        '[data-yunari-source-confirm-delete="fixture"]',
      ),
      "the confirm button",
    ).click(),
  );

  expect(statusLine(published).status).toBe(SOURCES_COPY.deleteFailed(failure));
  expect(statusLine(published).status).not.toContain("Could not save");
});

/**
 * A USB panel is **found, not paired**: the host enumerates what is plugged in
 * and the owner adds one. This is the only section of the mode that creates a
 * display, so the cases below are about the offer and the write rather than
 * about a control editing a record that already exists.
 */
const ONE_PANEL: Fixture = {
  fallback: null,
  displays: [
    {
      id: "this-pc",
      label: "This PC",
      kind: "local",
      theme: null,
      shape: "rect",
      rotation: 0,
    },
  ],
  panels: [
    {
      vendorId: 0x1cbe,
      productId: 0xa092,
      serial: "PANEL0001",
      label: 'Lian Li 9.2" LCD',
      held: false,
      commands: [],
    },
  ],
};

it("offers an attached panel and adds it", async () => {
  const { container, wrote } = await mountHost(ONE_PANEL);

  const add = must(
    container.querySelector<HTMLButtonElement>(
      '[data-yunari-panel-add="7358:41106:PANEL0001"]',
    ),
    "the add button for the attached panel",
  );

  await act(async () => add.click());

  // What the request carried: the three fields a record keys on. `model` is
  // deliberately absent — the host writes the model its family table names, so
  // a caller cannot add a record whose driver disagrees with it.
  expect(wrote.panels).toEqual([
    { vendorId: 0x1cbe, productId: 0xa092, serial: "PANEL0001" },
  ]);
});

it("does not offer a panel that is already a display", async () => {
  // The route refuses a second record for one device, so offering it would be
  // a button whose only outcome is a refusal. The host answers `held` because
  // it holds both lists; the client cannot derive it, since the display map
  // carries no hardware.
  const { container } = await mountHost({
    ...ONE_PANEL,
    panels: (ONE_PANEL.panels ?? []).map((panel) => ({
      ...panel,
      held: true,
    })),
  });

  expect(
    container.querySelector("[data-yunari-panel-add]"),
    "an already-added panel is still offered",
  ).toBeNull();
  expect(container.textContent).toContain(uiCopy.hostSettings.panels.allAdded);
});

it("states the chosen panel's hardware record and warns on a firmware mismatch", async () => {
  // The record is the driver's statement about this hardware; a device
  // answering a firmware it does not name is the fact a person needs before
  // wondering why a control does nothing. The row stays even though it is
  // held: the record is a fact about the device, not about being addable.
  const { container } = await mountHost({
    fallback: null,
    displays: [
      {
        id: "panel-1",
        label: 'TURZX 5" Panel',
        kind: "panel",
        theme: null,
        shape: "rect",
        rotation: 0,
      },
    ],
    panels: [
      {
        vendorId: 0x1d6b,
        productId: 0x0106,
        serial: "PANEL0002",
        label: 'TURZX 5" Panel',
        held: true,
        heldId: "panel-1",
        support: {
          maker: "TURZX",
          hardwareRevision: "Rev C",
          supportedFirmware: ["1.88"],
          updatedAt: "2026-10-29",
        },
        firmware: "1.90",
        commands: ["brightness", "screen", "restart", "status", "hello"],
      },
    ],
  });

  const row = must(
    container.querySelector<HTMLElement>(
      '[data-yunari-panel="7531:262:PANEL0002"]',
    ),
    "the held panel's row",
  );
  const copy = uiCopy.hostSettings.panels;

  expect(row.textContent).toContain(copy.maker("TURZX"));
  expect(row.textContent).toContain(copy.revision("Rev C"));
  expect(
    must(
      row.querySelector<HTMLElement>('[data-yunari-panel-held="panel-1"]'),
      "the row naming the display that holds the panel",
    ).textContent,
  ).toContain(copy.heldBy('TURZX 5" Panel'));
  expect(
    row.querySelector("[data-yunari-panel-add]"),
    "a held panel is still offered",
  ).toBeNull();

  const warning = must(
    row.querySelector<HTMLElement>("[data-yunari-panel-mismatch]"),
    "the firmware mismatch warning",
  );
  expect(warning.textContent).toContain("1.90");
  expect(warning.textContent).toContain("1.88");
});

it("leaves the panel addable when the host refuses it", async () => {
  // The flag that disables the button is the handler's own, so a refusal has to
  // release it too: a button left disabled after a refusal is a panel the owner
  // cannot add again without reloading the page.
  const refusal = "A panel display already holds that device.";
  const { container, published } = await mountHost({
    ...ONE_PANEL,
    refusePanel: refusal,
  });

  const add = must(
    container.querySelector<HTMLButtonElement>(
      '[data-yunari-panel-add="7358:41106:PANEL0001"]',
    ),
    "the add button for the attached panel",
  );

  await act(async () => add.click());

  expect(
    statusLine(published).status,
    "the host's refusal did not reach the person",
  ).toBe(uiCopy.hostSettings.status.failed(refusal));
  expect(
    must(
      container.querySelector<HTMLButtonElement>("[data-yunari-panel-add]"),
      "the add button is gone after a refusal",
    ).disabled,
    "the add button stayed disabled after a refusal",
  ).toBe(false);
});

it("says a machine with no panel is a machine with no panel", async () => {
  // Not an error: a desktop with no panel is the ordinary case, and the
  // sentence has to read as a fact rather than as a failure.
  const { container } = await mountHost(TWO_DISPLAYS);

  expect(container.textContent).toContain(uiCopy.hostSettings.panels.none);
  expect(container.querySelector("[data-yunari-panel-add]")).toBeNull();
});

it("draws a panel display's connection and asks the host to reconnect it", async () => {
  const { container, wrote } = await mountHost({
    fallback: null,
    displays: [
      {
        id: "panel-1",
        label: 'TURZX 5" Panel',
        kind: "panel",
        theme: null,
        shape: "rect",
        rotation: 0,
        panel: { status: "disconnected", commands: ["brightness"] },
      },
    ],
  });

  await act(async () => displayRow(container, "panel-1").click());

  // The status is the display record's, not the attached-panel list's: the
  // device is not attached, and that is exactly the state the owner retakes.
  expect(
    must(
      container.querySelector("[data-yunari-panel-status]"),
      "the panel's connection state",
    ).getAttribute("data-yunari-panel-status"),
  ).toBe("disconnected");

  const reconnect = must(
    container.querySelector<HTMLButtonElement>(
      '[data-yunari-panel-reconnect="panel-1"]',
    ),
    "the reconnect button",
  );
  await act(async () => reconnect.click());
  expect(wrote.reconnects).toEqual(["panel-1"]);
});
