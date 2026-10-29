// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SUPPORTED_SCHEMA_VERSION } from "@yunari/renderer-core";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CredentialRow } from "../asset-finder/credentials-client.js";
import {
  activePreviewRatioTokens,
  DEFAULT_PREVIEW_RATIO_TOKENS,
  PREVIEW_RATIO_STORAGE_KEY,
  setActivePreviewRatios,
} from "../display-lens.js";
import {
  readShortcutOverrides,
  resolveShortcuts,
  type ShortcutOverrides,
  setActiveShortcuts,
} from "../shortcut-manager/bindings.js";
import {
  PRODUCT_SHORTCUTS,
  ShortcutManager,
} from "../shortcut-manager/index.js";
import { uiCopy } from "../ui-copy.js";
import { createEditorShellBridge } from "./bridge.js";
import {
  DEFAULT_SHELL_PALETTE,
  prefersDarkAppearance,
  readShellChoice,
  resolveShellPalette,
  type ShellPalette,
  shellPalettes,
} from "./palette.js";
import { RAIL_SLOTS, Rail, type RailSlot } from "./rail.js";
import { Settings, type SettingsTab, versionFacts } from "./settings.js";
import { createShellLayout } from "./shell-layout.js";

// The host's half, mocked so the tab's own wiring is what these cases read.
// The mock is hoisted above the imports, so the panel and the assertions see
// the same functions.
const credentials = vi.hoisted(() => ({
  listCredentials: vi.fn(),
  saveCredential: vi.fn(),
  clearCredential: vi.fn(),
  verifyCredential: vi.fn(),
}));
vi.mock("../asset-finder/credentials-client.js", () => credentials);

// jsdom has never had a `PointerEvent`, and Base UI re-dispatches a click
// through one to carry modifier state — the shim `control.dom.test.tsx` supplies
// for the same reason.
window.PointerEvent ??= MouseEvent as never;

// React only flushes work scheduled inside `act` when it has been told it is in
// a test; without this, `act` warns and the update lands after the assertion.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** The gear, by the class only it carries: it is the rail's one non-slot. */
function gear(host: HTMLElement): HTMLButtonElement {
  const found = host.querySelector<HTMLButtonElement>(
    ".editor-shell-rail-settings",
  );
  if (found === null) throw new Error("No settings gear.");
  return found;
}

/** The role anywhere in the document, because the dialog is portalled to
 *  `body` rather than rendered inside the harness's own subtree. */
function role(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[role="${name}"]`);
}

/** The three tab words, in the strip's order, as an author reads them. */
function tabLabels(): readonly string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).map(
    (tab) => tab.textContent?.trim() ?? "",
  );
}

/** The rail's slots, by the attribute that marks a slot — the gear is a button
 *  on the rail too and carries none. */
function railSlotIds(host: HTMLElement): readonly (string | null)[] {
  return Array.from(
    host.querySelectorAll<HTMLElement>(".editor-shell-rail [data-rail-slot]"),
  ).map((slot) => slot.getAttribute("data-rail-slot"));
}

/** One palette row of the Appearance tab, by the hook the control carries
 *  rather than by its text: the name and the value are the same word, so a
 *  selector on the text would pass for a row that had lost its hook. */
function paletteChoice(palette: ShellPalette): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(
    `[data-yunari-palette-choice="${palette}"]`,
  );
  if (found === null) throw new Error(`no "${palette}" choice in the tab.`);
  return found;
}

/** The Appearance tab's group, which is what the six rows are radios in. */
function paletteGroup(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[role="radiogroup"]');
  if (found === null) throw new Error("No palette radiogroup.");
  return found;
}

/** Follow-the-system, the toggle beneath the six. */
function followToggle(): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(
    "[data-yunari-follow-system]",
  );
  if (found === null) throw new Error("No follow-the-system toggle.");
  return found;
}

/** The labelled close Base UI's modal contract requires inside the popup. */
function closeControl(): HTMLElement {
  const found = document.querySelector<HTMLElement>(
    ".editor-shell-dialog-close",
  );
  if (found === null) throw new Error("No close control.");
  return found;
}

/** The product stylesheet, injected by the two cases below because jsdom applies
 *  a `<style>` element's rules and nothing in this harness loads the app's CSS.
 *  Tailwind's own `@import` is dropped: jsdom cannot resolve it and raises on
 *  it, and none of these reads comes from it.
 *
 *  The path is joined from the test file's own URL rather than built as a second
 *  URL: under this file's jsdom environment `URL` is jsdom's, and Node's
 *  `fileURLToPath` refuses an instance it did not make.
 *
 *  jsdom resolves no custom property (`editor-shell.tokens.test.ts` records the
 *  same), so a value a rule states as a token comes back as the token's name;
 *  `token()` turns that back into the value §2 declares, and `resolved()` is
 *  the substitution. */
const shellCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "editor-shell.css"),
  "utf8",
).replace(/^\s*@import[^;]*;\s*$/gm, "");

function token(name: string): string {
  const declared = new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m").exec(
    shellCss,
  )?.[1];
  if (declared === undefined) throw new Error(`${name} is declared nowhere`);
  return declared.trim();
}

function resolved(value: string): string {
  return value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => token(name));
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;

/** The shell's settings route in miniature: the rail's gear sets the state the
 *  modal reads, exactly as `Shell` holds `settingsOpen`, and the palette state
 *  the shell holds is held here. Nothing else is mirrored — the tab writes
 *  storage and the attribute itself, so what these cases exercise is the
 *  component and not a copy of it.
 *
 *  `storage` is the prop the shell passes through, and `undefined` is a state
 *  the product reaches: `readStorage` answers `undefined` when the browser
 *  refuses it (`readStorage` in `shell-layout.tsx`), so a mounting with no store is the same
 *  run a private window gets, not a harness fiction. */
function Harness({
  storage,
  releaseVersion,
  initialTab,
}: {
  readonly storage: Storage | undefined;
  readonly initialTab?: SettingsTab | undefined;
  /** The open document's release version, as the shell reads it from the
   *  bridge snapshot and hands it down. `undefined` models a document that
   *  carries none — a new or unsaved theme — which is the About tab's absent
   *  case. */
  readonly releaseVersion: string | undefined;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  /** Mirrors `Shell`: a surface asks for a tab and opens the modal; closing
   *  forgets the ask, so the gear returns to the author's own last choice. */
  const [settingsTab, setSettingsTab] = useState<SettingsTab | undefined>(
    initialTab,
  );
  const [slot, setSlot] = useState<RailSlot>("composition");
  const [palette, setPalette] = useState<ShellPalette>(DEFAULT_SHELL_PALETTE);
  const [following, setFollowing] = useState(true);
  const [overrides, setOverrides] = useState<ShortcutOverrides>(() =>
    storage === undefined ? {} : readShortcutOverrides(storage),
  );
  /** The shell's own wiring for a binding change: the live table first, then
   *  the state the tab reads. A tab that wrote storage and not the table would
   *  print a chord that runs something else, which is what the tab's own test
   *  file covers. */
  const applyOverrides = (next: ShortcutOverrides): void => {
    setOverrides(next);
    setActiveShortcuts(resolveShortcuts(next));
  };
  return (
    <>
      <Rail
        slot={slot}
        collapsed={false}
        onChoose={setSlot}
        onOpenSettings={() => {
          setSettingsTab(undefined);
          setOpen(true);
        }}
      />
      <button
        type="button"
        data-yunari-ask-connections=""
        onClick={() => {
          setSettingsTab("connections");
          setOpen(true);
        }}
      >
        {uiCopy.settings.connections}
      </button>
      <Settings
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setSettingsTab(undefined);
        }}
        storage={storage}
        palette={palette}
        following={following}
        onPalette={setPalette}
        onFollowing={setFollowing}
        overrides={overrides}
        onOverrides={applyOverrides}
        releaseVersion={releaseVersion}
        initialTab={settingsTab}
      />
    </>
  );
}

/** The mounting, with the store the shell hands it. `localStorage` is the
 *  working-browser default; a case calls `mountWith(undefined)` to model a
 *  browser that refuses it — a plain default parameter would swallow that
 *  `undefined`, which is why the two are separate functions. */
function mountWith(
  storage: Storage | undefined,
  releaseVersion: string | undefined = undefined,
  initialTab: SettingsTab | undefined = undefined,
): HTMLElement {
  const mount = document.createElement("div");
  document.body.append(mount);
  const reactRoot = createRoot(mount);
  root = reactRoot;
  host = mount;
  act(() =>
    reactRoot.render(
      <Harness
        storage={storage}
        releaseVersion={releaseVersion}
        initialTab={initialTab}
      />,
    ),
  );
  return mount;
}

/** The mounting with a release version the document carries, for the About tab
 *  cases: the version is a value the shell reads, not one the tab invents. */
function mount(releaseVersion: string | undefined = undefined): HTMLElement {
  return mountWith(localStorage, releaseVersion);
}

async function press(target: HTMLElement): Promise<void> {
  await act(async () => {
    target.click();
  });
}

async function pressEscape(): Promise<void> {
  await act(async () => {
    role("dialog")?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
}

/** Escape pressed on one element inside the modal, as the focused row receives
 *  it: it bubbles, which is how both the Dialog's own dismissal and the row's
 *  capture see the same press. */
async function pressEscapeOn(target: Element): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
}

/** A tab of the modal, by the word it prints. */
async function openTab(label: string): Promise<void> {
  const tab = Array.from(
    document.querySelectorAll<HTMLElement>('[role="tab"]'),
  ).find((element) => element.textContent?.trim() === label);
  if (tab === undefined) throw new Error(`no ${label} tab.`);
  await press(tab);
}

/** One About fact's value, by the id the tab renders it under — the reading,
 *  not its position, so a reordered or dropped row is a failed lookup rather
 *  than a silently different fact. `null` where the fact is absent, which is
 *  what the tab renders where the document carries no version. */
function aboutField(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-yunari-about-fact="${id}"]`,
  );
}

/** The About tab's whole text, as an author reads it. The dialog is portalled
 *  to `body`, so the read is the document's, not the harness's. */
function aboutText(): string {
  return (
    document.querySelector<HTMLElement>("[data-yunari-about]")?.textContent ??
    ""
  );
}

/** The Connections tab, after its first list has settled. */
async function openConnections(): Promise<void> {
  await openTab(uiCopy.settings.connections);
  await act(async () => {
    await Promise.resolve();
  });
}

/** The Previews tab, opened by the word it prints. */
async function openPreviews(): Promise<HTMLElement> {
  await openTab(uiCopy.settings.previews);
  const found = document.querySelector<HTMLElement>("[data-yunari-previews]");
  if (found === null) throw new Error("no Previews tab.");
  return found;
}

/** The tab's ratio rows, in the order they draw. */
function rows(tab: HTMLElement): readonly HTMLElement[] {
  return Array.from(
    tab.querySelectorAll<HTMLElement>("[data-yunari-preview-ratio]"),
  );
}

/** The shape segment, by the word it prints — the control's labels are the
 *  options and the group's name is separate. */
async function chooseShape(
  tab: HTMLElement,
  shape: "Rect" | "Circle",
): Promise<void> {
  const segment = Array.from(
    tab.querySelectorAll<HTMLElement>('[role="group"] button'),
  ).find((button) => button.textContent?.trim() === shape);
  if (segment === undefined) throw new Error(`no ${shape} segment.`);
  await press(segment);
}

async function typeRatio(tab: HTMLElement, value: string): Promise<void> {
  const input = tab.querySelector<HTMLInputElement>(
    "[data-yunari-preview-ratio-input]",
  );
  if (input === null) throw new Error("no ratio field.");
  await typeInto(input, value);
}

async function pressAdd(tab: HTMLElement): Promise<void> {
  const button = tab.querySelector<HTMLButtonElement>(
    "[data-yunari-preview-ratio-add]",
  );
  if (button === null) throw new Error("no Add control.");
  await press(button);
}

async function pressReset(tab: HTMLElement): Promise<void> {
  const button = tab.querySelector<HTMLButtonElement>(
    "[data-yunari-preview-ratio-reset]",
  );
  if (button === null) throw new Error("no Reset control.");
  await press(button);
}

/** The reason the last Add did not happen, as the row renders it. */
function reason(tab: HTMLElement): string {
  return (
    tab.querySelector<HTMLElement>("[data-yunari-preview-ratio-reason]")
      ?.textContent ?? ""
  );
}

/** Boots the real shell into `body`, so the catalogue is loaded by the code a
 *  reload runs rather than by a harness that copies it. */
function bootShell(): () => void {
  const root = document.createElement("div");
  document.body.append(root);
  const layout = createShellLayout(root);
  return () => layout.destroy();
}

/** One row's Remove control. */
async function remove(row: HTMLElement): Promise<void> {
  const button = row.querySelector<HTMLButtonElement>(
    "[data-yunari-preview-ratio-remove]",
  );
  if (button === null) throw new Error("no Remove control in the row.");
  await press(button);
}

/** One credential row, by the id it renders under. */
function credentialRow(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(
    `[data-yunari-credential-row="${id}"]`,
  );
  if (found === null) throw new Error(`no ${id} credential row.`);
  return found;
}

const rowOf = (
  overrides: Partial<CredentialRow> & Pick<CredentialRow, "id" | "label">,
): CredentialRow => ({
  set: false,
  hint: "",
  verify: false,
  helpText: null,
  helpUrl: null,
  ...overrides,
});

/** A controlled input's value, set the way a keystroke sets it: React reads
 *  the native setter's result rather than the property's old value. */
async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  localStorage.clear();
  // The catalogue is module state, and the tab reads it: a case that added a
  // ratio must not hand its list to the next one.
  setActivePreviewRatios(DEFAULT_PREVIEW_RATIO_TOKENS);
  document.documentElement.removeAttribute("data-shell-palette");
  credentials.listCredentials.mockReset();
  credentials.saveCredential.mockReset();
  credentials.clearCredential.mockReset();
  credentials.verifyCredential.mockReset();
  credentials.listCredentials.mockResolvedValue([]);
  credentials.saveCredential.mockResolvedValue({ ok: true });
  credentials.clearCredential.mockResolvedValue({ ok: true });
  credentials.verifyCredential.mockResolvedValue({ ok: true });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-shell-palette");
  // The live binding table is module state, and the harness writes it on mount:
  // put it back so no later case in this file inherits a table it did not set.
  setActiveShortcuts(PRODUCT_SHORTCUTS);
});

describe("Settings", () => {
  it("opens the settings modal from the gear, and offers exactly the five tabs", async () => {
    const host = mount();
    await press(gear(host));

    expect(role("dialog")).not.toBeNull();
    expect(tabLabels()).toEqual([
      uiCopy.settings.appearance,
      uiCopy.settings.previews,
      uiCopy.settings.keyboard,
      uiCopy.settings.connections,
      uiCopy.settings.about,
    ]);
    // A pane, or a fifth rail slot, fails here and only here: the rail still
    // holds the four DESIGN.md names, and the gear is not one of them.
    expect(railSlotIds(host)).toEqual([...RAIL_SLOTS]);
  });

  it("closes on Escape while a capture is armed, and binds nothing", async () => {
    // Escape is always a way out of the modal. An earlier cut declined Base
    // UI's dismissal for every `false` while a row was armed, so a capture's
    // Escape cancelled the row and the modal stayed — and if the armed row's
    // `focus()` ever failed, nothing else cleared `armed`, so Escape could not
    // close the modal at all. The intent of the press is the modal, not the row.
    const host = mount();
    await press(gear(host));
    await openTab(uiCopy.settings.keyboard);

    const arm = document.querySelector<HTMLButtonElement>(
      '[data-yunari-shortcut-arm="publish.surface"]',
    );
    if (arm === null) throw new Error("no arm control in the Keyboard tab.");
    await press(arm);
    const row = document.querySelector<HTMLElement>(
      '[data-yunari-shortcut-row="publish.surface"]',
    );
    if (row === null) throw new Error("no row to record into.");
    expect(row.hasAttribute("data-armed")).toBe(true);

    await pressEscapeOn(row);

    expect(role("dialog"), "Escape closes the modal").toBeNull();
    expect(readShortcutOverrides(localStorage)).toEqual({});
  });

  it("closes on Escape while a row is armed even when the arm took no focus", async () => {
    // The trap the branch closes: `armed` set with no row holding focus, so the
    // row's own Escape handler never runs. Nothing in the modal may depend on
    // that handler having run for the way out to work.
    const host = mount();
    await press(gear(host));
    await openTab(uiCopy.settings.keyboard);

    const arm = document.querySelector<HTMLButtonElement>(
      '[data-yunari-shortcut-arm="edit.undo"]',
    );
    if (arm === null) throw new Error("no arm control in the Keyboard tab.");
    await press(arm);
    // Focus moved off the row, as an author clicking a tab strip line would.
    (document.activeElement as HTMLElement | null)?.blur();

    await pressEscape();

    expect(role("dialog")).toBeNull();
  });

  it("returns focus to the gear when it closes, and Escape is one press with one effect", async () => {
    const host = mount();
    await press(gear(host));

    await pressEscape();

    expect(role("dialog")).toBeNull();
    expect(document.activeElement).toBe(gear(host));
  });

  it("renders a labelled close control a touch screen reader can reach", async () => {
    // Base UI's own contract: a modal dialog renders `Dialog.Close` inside the
    // popup so a touch screen reader — which has no Escape key — can leave it.
    const host = mount();
    await press(gear(host));
    expect(closeControl().getAttribute("aria-label")?.trim()).not.toBe("");
  });

  it("keeps the document behind it silent to the editor's own chords", async () => {
    // Review Focus 5. The guard samples `[role='dialog']` at the start of the
    // dispatch, so while the modal is open the window-level manager must not
    // run `Ctrl+Z` or `Delete` against the document underneath.
    const manager = new ShortcutManager();
    const undo = vi.fn();
    const remove = vi.fn();
    manager.register("edit.undo", undo);
    manager.register("edit.delete", remove);

    const host = mount();
    await press(gear(host));
    expect(
      role("dialog"),
      "the modal is what makes the guard fire",
    ).not.toBeNull();

    await act(async () => {
      for (const event of [
        new KeyboardEvent("keydown", {
          key: "z",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
        new KeyboardEvent("keydown", {
          key: "Delete",
          bubbles: true,
          cancelable: true,
        }),
      ]) {
        document.body.dispatchEvent(event);
      }
    });
    expect(undo).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();

    // And the guard is the reason, not a chord that never matched: with the
    // modal shut, the same two presses reach the document.
    await pressEscape();
    await act(async () => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Delete",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);

    manager.destroy();
  });

  it("offers the six palettes as named radios in one labelled group", async () => {
    const host = mount();
    await press(gear(host));

    const radios = Array.from(
      paletteGroup().querySelectorAll<HTMLElement>('[role="radio"]'),
    );
    // Read from `shellPalettes` rather than restated: `palette.ts` is the owner,
    // and a list typed here is a second one that can fall behind it.
    expect(radios.map((radio) => radio.getAttribute("aria-label"))).toEqual([
      ...shellPalettes,
    ]);
    // And the chosen one says so in a way no colour carries: `aria-checked` is
    // the selected state, so a reader who cannot see the lift still has it.
    expect(
      radios.map((radio) => radio.getAttribute("aria-checked")),
      "the palette in force is the one marked checked",
    ).toEqual(
      shellPalettes.map((entry) => `${entry === DEFAULT_SHELL_PALETTE}`),
    );
    expect(paletteGroup().getAttribute("aria-labelledby")).not.toBeNull();
    expect(
      document.getElementById(
        paletteGroup().getAttribute("aria-labelledby") ?? "",
      )?.textContent,
    ).toBe(uiCopy.settings.palette);
  });

  it("applies the palette where the chip applied it — the attribute, and the storage", async () => {
    // The defect this exists to prevent is a palette applied to React state
    // alone, which leaves every portalled popup painting the old one.
    // A palette other than the one already in force: picking the current value
    // is a no-op the primitive does not report, so it could not fail.
    const chosen: ShellPalette = "moss";
    const host = mount();
    await press(gear(host));
    await press(paletteChoice(chosen));

    expect(localStorage.getItem("yunari.editor.shell-palette")).toBe(chosen);
    expect(document.documentElement.getAttribute("data-shell-palette")).toBe(
      chosen,
    );
    // The written key is the whole of what a choice touches here: a palette
    // colours the editor and never the authored theme, and not one other store
    // entry appears beside it.
    expect(localStorage.length, "a second store entry is a second owner").toBe(
      1,
    );
    expect(localStorage.key(0)).toBe("yunari.editor.shell-palette");
    // And the toggle it turned off says so.
    expect(followToggle().getAttribute("aria-checked")).toBe("false");
  });

  it("returns to following the OS when follow-the-system is turned back on", async () => {
    const host = mount();
    await press(gear(host));
    await press(paletteChoice("moss"));
    await press(followToggle());

    expect(
      readShellChoice(localStorage),
      "removing the key is what means no choice",
    ).toBeUndefined();
    expect(document.documentElement.getAttribute("data-shell-palette")).toBe(
      resolveShellPalette(undefined, prefersDarkAppearance()),
    );
    expect(followToggle().getAttribute("aria-checked")).toBe("true");
  });

  it("pins the palette in force when follow-the-system is turned off", async () => {
    // The other arrow of the toggle, and the brief names this direction too:
    // turning following OFF writes the resolved palette to storage, so a reload
    // keeps what the author was looking at rather than handing the choice back
    // to the OS. Delete the write (`settings.tsx` `follow`'s last line) and
    // nothing reddens without this case.
    const host = mount();
    await press(gear(host));

    // Walk to the state the line is about: choosing stops following, turning it
    // back on clears the key, and turning it off again is what has to pin.
    await press(paletteChoice("moss"));
    await press(followToggle());
    expect(
      readShellChoice(localStorage),
      "following the OS leaves no stored choice",
    ).toBeUndefined();

    await press(followToggle());

    const pinned = resolveShellPalette(undefined, prefersDarkAppearance());
    expect(
      readShellChoice(localStorage),
      "turning following off writes the palette in force, so a reload keeps it",
    ).toBe(pinned);
    expect(
      document.documentElement.getAttribute("data-shell-palette"),
      "and the palette it pinned is the one that was in force",
    ).toBe(pinned);
  });

  it("keeps the choice for the session, and says so, where the browser kept no store", async () => {
    // No storage is a state the product reaches — `readStorage` answers
    // `undefined` in a browser that refuses it — and the brief requires it
    // tested. Both storage branches have to hold: a choice still applies for
    // the session, and the tab says it will not outlive a reload rather than
    // refusing to make it.
    const host = mountWith(undefined);
    await press(gear(host));

    // The copy that carries the promise, on the storage-less branch only.
    expect(document.body.textContent).toContain(
      uiCopy.settings.followSystemSessionOnly,
    );

    const chosen: ShellPalette = "moss";
    await press(paletteChoice(chosen));
    // Still applied: the attribute reaches every portalled surface, store or no
    // store. A `writeShellChoice(undefined, …)` here would throw and fail this
    // case, which is the guard.
    expect(document.documentElement.getAttribute("data-shell-palette")).toBe(
      chosen,
    );
    expect(
      localStorage.length,
      "a session-only choice writes no store entry",
    ).toBe(0);

    // The toggle is the other storage branch: turning following back on must
    // not throw with no store to clear, and still resolves the OS.
    await press(followToggle());
    expect(document.documentElement.getAttribute("data-shell-palette")).toBe(
      resolveShellPalette(undefined, prefersDarkAppearance()),
    );
  });
});

/** The Connections tab. The contract that matters is that a value goes one way:
 *  the row shows a four-character hint and never the value, and Verify is
 *  offered only where the host has a check to run. */
describe("Connections", () => {
  const unset = rowOf({ id: "demo", label: "Demo source" });
  const stored = rowOf({
    id: "demo",
    label: "Demo source",
    set: true,
    hint: "9f2c",
  });

  it("opens on Connections when a surface asks, even after an earlier open", async () => {
    // The finder's needs-key state offers this tab; landing on Appearance
    // leaves the author hunting for the very thing the link promised. The
    // first open is the gear's, so the tab's own last choice is Appearance.
    const host = mount();
    await press(gear(host));
    expect(
      document.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
    ).toContain(uiCopy.settings.appearance);
    await pressEscape();

    const ask = host.querySelector<HTMLButtonElement>(
      "[data-yunari-ask-connections]",
    );
    if (ask === null) throw new Error("no connections ask.");
    await press(ask);

    const selected = document.querySelector<HTMLElement>(
      '[role="tab"][aria-selected="true"]',
    );
    expect(selected?.textContent).toContain(uiCopy.settings.connections);
  });

  it("says no source needs a key when the host knows none", async () => {
    const host = mount();
    await press(gear(host));
    await openConnections();

    expect(
      document.querySelector<HTMLElement>("[data-yunari-connections]")
        ?.textContent,
    ).toContain(uiCopy.settings.connectionsEmpty);
  });

  it("shows the hint for a stored credential and Not set for one without", async () => {
    credentials.listCredentials.mockResolvedValue([
      rowOf({ id: "saved", label: "Saved source", set: true, hint: "9f2c" }),
      rowOf({ id: "empty", label: "Empty source" }),
    ]);
    const host = mount();
    await press(gear(host));
    await openConnections();

    expect(credentialRow("saved").textContent).toContain("Saved ····9f2c");
    expect(credentialRow("empty").textContent).toContain(
      uiCopy.settings.connectionsNotSet,
    );
    // The value itself has no way into the page: not in the row, not anywhere.
    expect(document.body.textContent).not.toContain("sk-live-9f2c");
  });

  it("disables Verify when the credential has no verifier", async () => {
    credentials.listCredentials.mockResolvedValue([
      rowOf({ id: "no-check", label: "No check", set: true, hint: "9f2c" }),
      rowOf({
        id: "has-check",
        label: "Has check",
        set: true,
        hint: "9f2c",
        verify: true,
      }),
    ]);
    const host = mount();
    await press(gear(host));
    await openConnections();

    const verify = (id: string) =>
      document.querySelector<HTMLButtonElement>(
        `[data-yunari-credential-verify="${id}"]`,
      );
    expect(verify("no-check")?.disabled).toBe(true);
    expect(verify("has-check")?.disabled).toBe(false);
  });

  it("points a row at where its key is created, and adds nothing for a row without help", async () => {
    credentials.listCredentials.mockResolvedValue([
      rowOf({
        id: "keyed",
        label: "Keyed source",
        helpText: "Create an app and copy its access key.",
        helpUrl: "https://example.test/keys",
      }),
      rowOf({ id: "plain", label: "Plain source" }),
    ]);
    const host = mount();
    await press(gear(host));
    await openConnections();

    const help = credentialRow("keyed").querySelector<HTMLElement>(
      '[data-yunari-credential-help="keyed"]',
    );
    expect(help?.textContent).toContain("Create an app");
    expect(
      credentialRow("keyed").querySelector<HTMLAnchorElement>("a")?.href,
    ).toBe("https://example.test/keys");
    expect(
      credentialRow("keyed").querySelector<HTMLAnchorElement>("a")?.textContent,
    ).toBe(uiCopy.settings.connectionsWhereToGetKey);
    expect(
      credentialRow("plain").querySelector("[data-yunari-credential-help]"),
    ).toBeNull();
  });

  it("saves once and refreshes the row from the host", async () => {
    credentials.listCredentials
      .mockResolvedValueOnce([unset])
      .mockResolvedValueOnce([stored]);
    const host = mount();
    await press(gear(host));
    await openConnections();

    const input = document.querySelector<HTMLInputElement>(
      '[data-yunari-credential-input="demo"]',
    );
    if (input === null) throw new Error("no credential input.");
    await typeInto(input, "sk-live-9f2c");

    const save = document.querySelector<HTMLButtonElement>(
      '[data-yunari-credential-save="demo"]',
    );
    if (save === null) throw new Error("no save control.");
    await press(save);

    expect(credentials.saveCredential).toHaveBeenCalledTimes(1);
    expect(credentials.saveCredential).toHaveBeenCalledWith(
      "demo",
      "sk-live-9f2c",
    );
    // The row is the host's answer, not the draft: gone unset before, set after.
    expect(credentials.listCredentials).toHaveBeenCalledTimes(2);
    expect(credentialRow("demo").textContent).toContain("Saved ····9f2c");
  });
});

/** §7's About tab. The rule that matters is that every string is traceable to
 *  an owner — the product version to the workspace manifest's `version`, the
 *  schema version to `SUPPORTED_SCHEMA_VERSION`, the release version to the open
 *  document — and the tab invents none. The harness drives the prop the shell
 *  fills from its snapshot, so what is proven here is the tab's rendering, not a
 *  copy of the bridge. */
describe("About", () => {
  it("shows the version facts the build owns, and invents none", async () => {
    // A version a hand-typed literal would not produce, so a literal in the tab
    // reddens this case rather than passing by coincidence.
    const released = "2.5.1";
    const host = mount(released);
    await press(gear(host));
    await openTab(uiCopy.settings.about);

    expect(versionFacts(released)).toEqual([
      { id: "product-version", value: __YUNARI_VERSION__ },
      { id: "schema-version", value: SUPPORTED_SCHEMA_VERSION },
      { id: "release-version", value: released },
    ]);
    // And what the tab renders is those facts, each string on its own owner.
    expect(aboutField("product-version")?.textContent).toBe(__YUNARI_VERSION__);
    expect(aboutField("schema-version")?.textContent).toBe(
      String(SUPPORTED_SCHEMA_VERSION),
    );
    expect(aboutField("release-version")?.textContent).toBe(released);
  });

  it("names what the editor is", async () => {
    const host = mount("2.5.1");
    await press(gear(host));
    await openTab(uiCopy.settings.about);

    expect(aboutText()).toContain(uiCopy.settings.aboutProvenance);
  });

  it("renders nothing rather than a placeholder where a fact is absent", async () => {
    const host = mount(undefined);
    await press(gear(host));
    await openTab(uiCopy.settings.about);

    // The product and schema versions are this build's own facts and are always
    // shown.
    expect(aboutField("product-version")?.textContent).toBe(__YUNARI_VERSION__);
    expect(aboutField("schema-version")?.textContent).toBe(
      String(SUPPORTED_SCHEMA_VERSION),
    );
    // The release version is absent, and absence is a gap stated by rendering
    // nothing — never `panels.notSet`, never a dash that could read as data.
    expect(versionFacts(undefined)).toEqual([
      { id: "product-version", value: __YUNARI_VERSION__ },
      { id: "schema-version", value: SUPPORTED_SCHEMA_VERSION },
    ]);
    expect(aboutField("release-version")).toBeNull();
    expect(aboutText()).not.toContain(uiCopy.panels.notSet);
    expect(aboutText()).not.toContain("undefined");
  });

  it("renders the release row from a document's own metadata.version (vg-288)", async () => {
    // vg-288: the starter and blank-theme builders write no `metadata.version`,
    // so every loadable document left this row absent and only an absence
    // assertion could be made. This fixture carries one, and the version the row
    // shows is the real bridge's projection of it — the same wire `editor-main.ts`
    // runs — not a string a case passed in beside the document.
    const document = {
      metadata: { name: "Living Room", version: "2.5.1", themeLanguage: "en" },
    };
    const bridge = createEditorShellBridge({
      editor: {
        canvas: {
          on: vi.fn(),
          off: vi.fn(),
          getActiveObject: () => undefined,
          getObjects: () => [],
          requestRenderAll: vi.fn(),
        },
        groupingManager: { groupContext: () => [] },
        historyManager: { attachGlobals: () => {}, saveState: vi.fn() },
      },
      session: { subscribeDocumentChange: () => () => undefined },
      capture: () => undefined,
      documentIdentity: () => ({
        name: document.metadata.name,
        id: "theme-id",
        version: document.metadata.version,
      }),
    } as never);

    const host = mount(bridge.snapshot().releaseVersion);
    await press(gear(host));
    await openTab(uiCopy.settings.about);

    expect(aboutField("release-version")?.textContent).toBe(
      document.metadata.version,
    );
    bridge.destroy();
  });
});

/** §7's Previews tab. The catalogue is the author's, and the tab is the only
 *  surface that edits it: the list it prints is the derived lens ids, one row
 *  per stored token, so a twin is offered by the row that owns it rather than
 *  becoming a second, independently removable ratio. */
describe("Previews", () => {
  it("adds a rect ratio and offers both orientations", async () => {
    const host = mount();
    await press(gear(host));
    const tab = await openPreviews();

    await chooseShape(tab, "Rect");
    await typeRatio(tab, "21:9");
    await pressAdd(tab);

    expect(rows(tab).map((row) => row.textContent)).toEqual([
      "16:9 9:16",
      "19.5:9 9:19.5",
      "4:3 3:4",
      "1:1",
      "Circle",
      // `21:9` is normalised by the parser's GCD, so the row prints the ids
      // the display menu will offer rather than the spelling that was typed.
      "7:3 3:7",
    ]);
    // The stored token is the parser's normalised id, not the typed spelling.
    expect(localStorage.getItem(PREVIEW_RATIO_STORAGE_KEY)).toBe(
      JSON.stringify([...DEFAULT_PREVIEW_RATIO_TOKENS, "7:3"]),
    );
  });

  it("refuses a duplicate with a worded reason", async () => {
    const host = mount();
    await press(gear(host));
    const tab = await openPreviews();

    await typeRatio(tab, "16:9");
    await pressAdd(tab);

    expect(reason(tab)).toBe(uiCopy.settings.previewRatioDuplicate);
    // A refusal a screen reader never hears is a refusal not stated (§9).
    expect(
      tab
        .querySelector("[data-yunari-preview-ratio-reason]")
        ?.getAttribute("role"),
    ).toBe("alert");
    expect(rows(tab)).toHaveLength(5);
    expect(localStorage.getItem(PREVIEW_RATIO_STORAGE_KEY)).toBeNull();
  });

  it("refuses a ratio whose derived lens the catalogue already frames", async () => {
    // `16:9` derives `9:16` beside it, so typing `9:16` would add no lens the
    // menu can offer. The duplicate test is the derived ids, not the typed id.
    const host = mount();
    await press(gear(host));
    const tab = await openPreviews();

    await typeRatio(tab, "9:16");
    await pressAdd(tab);

    expect(reason(tab)).toBe(uiCopy.settings.previewRatioDuplicate);
    expect(rows(tab)).toHaveLength(5);
  });

  it("refuses input that is not a ratio with a worded reason", async () => {
    const host = mount();
    await press(gear(host));
    const tab = await openPreviews();

    await typeRatio(tab, "wide");
    await pressAdd(tab);

    expect(reason(tab)).toBe(uiCopy.settings.previewRatioInvalid);
    expect(rows(tab)).toHaveLength(5);
  });

  it("refuses the literal Circle in the Rect field", async () => {
    // The shape control is the only way to choose a disc: a typed `Circle`
    // under Rect would store a token the author did not choose there.
    const host = mount();
    await press(gear(host));
    const tab = await openPreviews();

    await typeRatio(tab, "Circle");
    await pressAdd(tab);

    expect(reason(tab)).toBe(uiCopy.settings.previewRatioInvalid);
    expect(rows(tab)).toHaveLength(5);
  });

  it("gives every Remove control a name that includes what it removes", async () => {
    const host = mount();
    await press(gear(host));
    const tab = await openPreviews();

    const names = rows(tab).map(
      (row) =>
        row
          .querySelector("[data-yunari-preview-ratio-remove]")
          ?.getAttribute("aria-label") ?? "",
    );
    expect(names).toEqual(
      rows(tab).map(
        (row) => `${uiCopy.settings.previewRatioRemove} ${row.textContent}`,
      ),
    );
    expect(new Set(names).size, "no two rows share a name").toBe(
      rows(tab).length,
    );
  });

  it("removes the last ratio and says Fit remains", async () => {
    const host = mount();
    await press(gear(host));
    const tab = await openPreviews();

    for (const row of rows(tab)) await remove(row);

    expect(rows(tab)).toHaveLength(0);
    expect(tab.textContent).toContain(uiCopy.settings.previewRatiosEmpty);
    expect(localStorage.getItem(PREVIEW_RATIO_STORAGE_KEY)).toBe(
      JSON.stringify([]),
    );
  });

  it("resets by removing the key, and is disabled until there is something to reset", async () => {
    const host = mount();
    await press(gear(host));
    const tab = await openPreviews();

    const reset = (): HTMLButtonElement => {
      const button = tab.querySelector<HTMLButtonElement>(
        "[data-yunari-preview-ratio-reset]",
      );
      if (button === null) throw new Error("no Reset control.");
      return button;
    };
    expect(reset().disabled, "the defaults are already the list").toBe(true);

    await typeRatio(tab, "21:9");
    await pressAdd(tab);
    expect(reset().disabled).toBe(false);

    await pressReset(tab);

    expect(localStorage.getItem(PREVIEW_RATIO_STORAGE_KEY)).toBeNull();
    expect(rows(tab)).toHaveLength(5);
    expect(reset().disabled).toBe(true);
  });

  it("keeps the list for the session, and says so, where the browser kept no store", async () => {
    const host = mountWith(undefined);
    await press(gear(host));
    const tab = await openPreviews();

    expect(tab.textContent).toContain(uiCopy.settings.previewRatiosSessionOnly);

    await typeRatio(tab, "21:9");
    await pressAdd(tab);
    expect(rows(tab)).toHaveLength(6);
    expect(rows(tab)[5]?.textContent).toBe("7:3 3:7");

    // Reset is the other storage branch: with no key to remove it must not
    // throw, and the session list still returns to the defaults.
    await pressReset(tab);
    expect(rows(tab)).toHaveLength(5);
    expect(localStorage.length).toBe(0);
  });

  it("adds a circle without asking for a ratio", async () => {
    const host = mount();
    await press(gear(host));
    const tab = await openPreviews();

    await chooseShape(tab, "Circle");
    expect(
      tab.querySelector("[data-yunari-preview-ratio-input]"),
      "a circle is 1:1 by construction, so the field is absent",
    ).toBeNull();
    // The defaults already carry a circle, so that add is the duplicate case.
    await pressAdd(tab);
    expect(reason(tab)).toBe(uiCopy.settings.previewRatioDuplicate);

    const circle = rows(tab).find(
      (row) => row.getAttribute("data-yunari-preview-ratio") === "Circle",
    );
    if (circle === undefined) throw new Error("no Circle row.");
    await remove(circle);
    expect(rows(tab)).toHaveLength(4);

    await pressAdd(tab);
    expect(rows(tab)[4]?.textContent).toBe("Circle");
    // And adding it back twice is a duplicate again.
    await pressAdd(tab);
    expect(reason(tab)).toBe(uiCopy.settings.previewRatioDuplicate);
  });

  it("boots on the authored list a reload reads from storage", () => {
    // Not a harness copy of the load: `createShellLayout` is the code a reload
    // runs, and the stored list is what it must frame the camera with.
    const authored = ["16:9", "4:3", "Circle"];
    localStorage.setItem(PREVIEW_RATIO_STORAGE_KEY, JSON.stringify(authored));

    const destroy = bootShell();
    try {
      expect(activePreviewRatioTokens()).toEqual(authored);
    } finally {
      destroy();
    }
  });

  it("boots to the defaults where nothing was ever stored", () => {
    // A stale module list from this session must not outlive a boot: the
    // absent key is "the defaults", not "whatever was last active".
    setActivePreviewRatios(["4:3"]);

    const destroy = bootShell();
    try {
      expect(activePreviewRatioTokens()).toEqual([
        ...DEFAULT_PREVIEW_RATIO_TOKENS,
      ]);
    } finally {
      destroy();
    }
  });

  it("returns to the defaults through Reset after a reload, and removes the key", async () => {
    localStorage.setItem(
      PREVIEW_RATIO_STORAGE_KEY,
      JSON.stringify(["16:9", "4:3", "Circle"]),
    );
    const destroy = bootShell();
    try {
      expect(activePreviewRatioTokens()).toEqual(["16:9", "4:3", "Circle"]);

      const gearButton = document.querySelector<HTMLButtonElement>(
        ".editor-shell-rail-settings",
      );
      if (gearButton === null)
        throw new Error("no settings gear in the shell.");
      await press(gearButton);
      const tab = await openPreviews();
      await pressReset(tab);

      expect(localStorage.getItem(PREVIEW_RATIO_STORAGE_KEY)).toBeNull();
      expect(activePreviewRatioTokens()).toEqual([
        ...DEFAULT_PREVIEW_RATIO_TOKENS,
      ]);
    } finally {
      destroy();
    }
  });
});

/** §2's eyebrow and §5 rule 2's read-only row, read off the rendered modal
 *  rather than off the sheet: a value a rule states is a rendered outcome, and
 *  this is the half that reddens in `vitest` when the rule is reverted. */
describe("the modal's own language", () => {
  let injected: HTMLStyleElement;

  beforeEach(() => {
    injected = document.createElement("style");
    injected.textContent = shellCss;
    document.head.append(injected);
  });

  afterEach(() => {
    injected.remove();
  });

  it("takes §2's eyebrow for the group heading — --text-2xs, 600, .11em", async () => {
    const host = mount();
    await press(gear(host));

    const heading = document.querySelector<HTMLElement>(
      ".editor-shell-dialog h3",
    );
    if (heading === null) throw new Error("no group heading in the modal.");
    const style = getComputedStyle(heading);

    expect(resolved(style.fontSize), "§2's --text-2xs is 10px").toBe("10px");
    expect(style.fontWeight).toBe("600");
    expect(style.letterSpacing).toBe("0.11em");
  });

  it("gives the About row §5 rule 2's 74px label column and right-aligned value", async () => {
    const host = mount("2.5.1");
    await press(gear(host));
    await openTab(uiCopy.settings.about);

    const row = document.querySelector<HTMLElement>(
      "[data-yunari-about] dl > div",
    );
    if (row === null) throw new Error("no read-only row in the About tab.");
    const tracks = getComputedStyle(row).gridTemplateColumns.split(/\s+/);
    expect(tracks[0], "the label column is the rule's 74px").toBe("74px");
    expect(tracks, "and one value cell beside it").toHaveLength(2);

    const value = row.querySelector<HTMLElement>("dd");
    if (value === null) throw new Error("no value cell in the row.");
    expect(getComputedStyle(value).textAlign).toBe("right");
  });

  it("leaves the Keyboard tab's rebind row the flex row its drawing draws", async () => {
    // §5 rule 2's escape clause: this row's `dd` carries a rebind and a Reset
    // button, so it is not read-only and the 74px column is not its track.
    // `display` is the declaration the grid would take, because the row's own
    // rule declares none of its own.
    const host = mount();
    await press(gear(host));
    await openTab(uiCopy.settings.keyboard);

    const row = document.querySelector<HTMLElement>(
      '[data-yunari-shortcut-row="publish.surface"]',
    );
    if (row === null) throw new Error("no rebind row in the Keyboard tab.");
    const style = getComputedStyle(row);

    expect(style.display).toBe("flex");
    expect(style.gridTemplateColumns, "no 74px track reached it").toBe("");
  });
});
