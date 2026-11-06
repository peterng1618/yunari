// @vitest-environment jsdom
/**
 * The three editor-owned Settings pages: Appearance, Asset sources and About.
 *
 * **What this file owns.** That the palette page writes through the same three
 * steps the old modal did (storage, attribute, shell state); that a preview
 * ratio is added, refused and reset through the page's own controls; that a
 * credential is saved once and the row is refreshed from the host rather than
 * from the draft; and that About prints only facts an owner provides.
 *
 * **What it does not measure.** jsdom lays nothing out, so nothing here claims
 * how the pages look. The shell's navigation, the host pages and the status
 * line are `region.dom.test.tsx`'s; the shortcut table is
 * `settings-keyboard.dom.test.tsx`'s.
 */
import { SUPPORTED_SCHEMA_VERSION } from "@yunari/renderer-core";
import type { PathPresetState } from "@yunari/theme-package";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CredentialRow } from "../asset-finder/credentials-client.js";
import {
  activePreviewRatioTokens,
  DEFAULT_PREVIEW_RATIO_TOKENS,
  PREVIEW_RATIO_STORAGE_KEY,
  setActivePreviewRatios,
} from "../display-lens.js";
import {
  DEFAULT_SHELL_PALETTE,
  prefersDarkAppearance,
  readShellChoice,
  resolveShellPalette,
  type ShellPalette,
  shellPalettes,
} from "../editor-shell/palette.js";
import { PATH_PRESET_IDS } from "../new-object-defaults.js";
import {
  activeRemovedPathPresetIds,
  activeUserPathPresets,
  loadPathPresets,
  REMOVED_PATH_PRESETS_STORAGE_KEY,
  setActiveRemovedPathPresetIds,
  setActiveUserPathPresets,
} from "../path-presets.js";
import { uiCopy } from "../ui-copy.js";
import { AboutPage } from "./pages/about-page.js";
import { AppearancePage } from "./pages/appearance-page.js";
import { AssetSourcesPage } from "./pages/asset-sources-page.js";
import { PathPresetsPage } from "./pages/path-presets-page.js";
import { PreviewsPage } from "./pages/previews-page.js";

const credentials = vi.hoisted(() => ({
  listCredentials: vi.fn(),
  saveCredential: vi.fn(),
  clearCredential: vi.fn(),
  verifyCredential: vi.fn(),
}));
vi.mock("../asset-finder/credentials-client.js", () => credentials);

// Base UI re-dispatches a click through a `PointerEvent`, which jsdom has none
// of; the shim every file that mounts one of its primitives supplies.
window.PointerEvent ??= MouseEvent as never;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

async function mount(element: React.ReactElement): Promise<HTMLDivElement> {
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

async function unmount(): Promise<void> {
  const mounted = root;
  root = undefined;
  host?.remove();
  host = undefined;
  if (mounted !== undefined) await act(async () => mounted.unmount());
}

async function press(target: HTMLElement): Promise<void> {
  await act(async () => target.click());
}

function must<T extends Element>(found: T | null, what: string): T {
  if (found === null) throw new Error(`the page rendered no ${what}`);
  return found;
}

/** The Appearance page with the shell's own state, so a palette choice and the
 *  follow toggle are read back the way the shell would hold them. */
async function mountAppearance(
  storage: Storage | undefined = localStorage,
): Promise<HTMLDivElement> {
  function Harness(): React.JSX.Element {
    const [palette, setPalette] = useState<ShellPalette>(DEFAULT_SHELL_PALETTE);
    const [following, setFollowing] = useState(true);
    return (
      <AppearancePage
        storage={storage}
        palette={palette}
        following={following}
        onPalette={setPalette}
        onFollowing={setFollowing}
      />
    );
  }
  return mount(<Harness />);
}

/** Read a controlled input's value the way a keystroke does. */
async function typeInto(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): Promise<void> {
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Click a control and let the page's host round-trip settle before reading. */
async function pressAndSettle(target: HTMLElement): Promise<void> {
  await act(async () => {
    target.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function jsonAnswer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type PresetRow = {
  readonly id: string;
  readonly label: string;
  readonly data: string;
  readonly paint: "stroke" | "fill";
};

/** A minimal host: the two lists plus the routes this page calls. */
function pathPresetHost(initial: {
  readonly presets: readonly PresetRow[];
  readonly removedBuiltins?: readonly string[];
}): { fetcher: typeof fetch; state: () => PathPresetState } {
  let presets = [...initial.presets];
  let removedBuiltins = [...(initial.removedBuiltins ?? [])];
  const state = (): PathPresetState => ({
    version: 1,
    presets,
    removedBuiltins,
    migrated: true,
  });
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/path-presets" && method === "GET") {
        return jsonAnswer(state());
      }
      if (url === "/api/path-presets" && method === "POST") {
        const body = JSON.parse(String(init?.body)) as {
          label: string;
          data: string;
        };
        const preset: PresetRow = {
          id: `user:${body.label.toLowerCase().replace(/\s+/g, "-")}`,
          label: body.label,
          data: body.data,
          paint: body.data.includes("Z") ? "fill" : "stroke",
        };
        presets = [...presets, preset];
        return jsonAnswer(preset);
      }
      if (url === "/api/path-presets/builtins/restore" && method === "POST") {
        removedBuiltins = [];
        return jsonAnswer({ ok: true });
      }
      const builtin = url.match(
        /^\/api\/path-presets\/builtins\/([^/]+)\/remove$/,
      );
      if (builtin !== null && method === "POST") {
        removedBuiltins = [
          ...removedBuiltins,
          decodeURIComponent(builtin[1] ?? ""),
        ];
        return jsonAnswer({ ok: true });
      }
      const pack = url.match(/^\/api\/path-presets\/packs\/([^/]+)$/);
      if (pack !== null && method === "DELETE") {
        const prefix = `pack:${decodeURIComponent(pack[1] ?? "")}:`;
        presets = presets.filter((preset) => !preset.id.startsWith(prefix));
        return jsonAnswer({ ok: true });
      }
      const remove = url.match(/^\/api\/path-presets\/(.+)$/);
      if (remove !== null && method === "DELETE") {
        const id = decodeURIComponent(remove[1] ?? "");
        presets = presets.filter((preset) => preset.id !== id);
        return jsonAnswer({ ok: true });
      }
      return jsonAnswer({ error: "unexpected request" }, 500);
    },
  );
  return {
    fetcher: fetcher as unknown as typeof fetch,
    state,
  };
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

beforeEach(() => {
  localStorage.clear();
  setActivePreviewRatios(DEFAULT_PREVIEW_RATIO_TOKENS);
  setActiveUserPathPresets([]);
  setActiveRemovedPathPresetIds([]);
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

afterEach(async () => {
  await unmount();
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-shell-palette");
});

it("offers the six palettes as named radios in one labelled group", async () => {
  const container = await mountAppearance();
  const group = must(
    container.querySelector<HTMLElement>('[role="radiogroup"]'),
    "palette radio group",
  );

  expect(
    Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]')).map(
      (radio) => radio.getAttribute("aria-label"),
    ),
    "the page does not offer the palettes the palette module owns",
  ).toEqual([...shellPalettes]);
  expect(
    group
      .querySelector('[role="radio"][aria-checked="true"]')
      ?.getAttribute("aria-label"),
    "the palette in force is not the one marked checked",
  ).toBe(DEFAULT_SHELL_PALETTE);
  expect(
    container.querySelector<HTMLElement>(
      `[aria-labelledby="${group.getAttribute("aria-labelledby") ?? ""}"]`,
    ),
    "the group is not labelled by a heading",
  ).not.toBeNull();
});

it("applies a palette to the store and the attribute, and stops following", async () => {
  const container = await mountAppearance();
  const chosen: ShellPalette = "moss";

  await press(
    must(
      container.querySelector<HTMLElement>(
        `[data-yunari-palette-choice="${chosen}"]`,
      ),
      `"${chosen}" palette choice`,
    ),
  );

  expect(localStorage.getItem("yunari.editor.shell-palette")).toBe(chosen);
  expect(document.documentElement.getAttribute("data-shell-palette")).toBe(
    chosen,
  );
  expect(
    must(
      container.querySelector<HTMLElement>("[data-yunari-follow-system]"),
      "follow toggle",
    ).getAttribute("aria-checked"),
    "choosing a palette did not stop following the system",
  ).toBe("false");
});

it("returns to following the system by deleting the stored choice", async () => {
  const container = await mountAppearance();
  await press(
    must(
      container.querySelector<HTMLElement>(
        '[data-yunari-palette-choice="moss"]',
      ),
      "moss choice",
    ),
  );
  await press(
    must(
      container.querySelector<HTMLElement>("[data-yunari-follow-system]"),
      "follow toggle",
    ),
  );

  expect(
    readShellChoice(localStorage),
    "removing the key is what means no choice",
  ).toBeUndefined();
  expect(document.documentElement.getAttribute("data-shell-palette")).toBe(
    resolveShellPalette(undefined, prefersDarkAppearance()),
  );
});

it("restores a removed ratio without dropping one the author added", async () => {
  const container = await mount(<PreviewsPage storage={localStorage} />);

  await press(
    must(
      container.querySelector<HTMLElement>(
        '[data-yunari-preview-ratio-remove="4:3"]',
      ),
      "Remove control for 4:3",
    ),
  );
  expect(activePreviewRatioTokens()).not.toContain("4:3");

  const field = must(
    container.querySelector<HTMLInputElement>(
      "[data-yunari-preview-ratio-input]",
    ),
    "ratio field",
  );
  await typeInto(field, "7:3");
  await press(
    must(
      container.querySelector<HTMLElement>("[data-yunari-preview-ratio-add]"),
      "Add control",
    ),
  );
  expect(activePreviewRatioTokens()).toContain("7:3");

  await press(
    must(
      container.querySelector<HTMLElement>(
        "[data-yunari-preview-ratio-restore]",
      ),
      "Restore defaults control",
    ),
  );
  // The default comes back; the author's own ratio was never the default's to
  // remove, and clearing the key would have deleted it on the next load.
  expect(activePreviewRatioTokens()).toContain("4:3");
  expect(activePreviewRatioTokens()).toContain("7:3");
  expect(localStorage.getItem(PREVIEW_RATIO_STORAGE_KEY)).toContain("4:3");
  expect(localStorage.getItem(PREVIEW_RATIO_STORAGE_KEY)).toContain("7:3");
});

it("lists the host's stored presets, including a pack row", async () => {
  const host = pathPresetHost({
    presets: [
      {
        id: "user:mine",
        label: "Mine",
        data: "M 0 0 L 10 0",
        paint: "stroke",
      },
      {
        id: "pack:pack-one:star",
        label: "Pack star",
        data: "M 0 0 L 10 0 L 5 10 Z",
        paint: "fill",
      },
    ],
  });
  await loadPathPresets(host.fetcher, localStorage);

  const container = await mount(<PathPresetsPage />);

  expect(
    container.querySelector('[data-yunari-path-preset="user:mine"]')
      ?.textContent,
  ).toContain("Mine");
  expect(
    container.querySelector('[data-yunari-path-preset="pack:pack-one:star"]')
      ?.textContent,
  ).toContain("Pack star");
});

it("adds a custom path preset, draws its own data, and removes it", async () => {
  await loadPathPresets(pathPresetHost({ presets: [] }).fetcher, localStorage);
  const container = await mount(<PathPresetsPage />);
  const name = must(
    container.querySelector<HTMLInputElement>("[data-yunari-path-preset-name]"),
    "preset name field",
  );
  const data = must(
    container.querySelector<HTMLTextAreaElement>(
      "[data-yunari-path-preset-data]",
    ),
    "preset data field",
  );
  const pathData = "M 0 0 L 10 0 L 5 10 Z";

  await typeInto(name, "Star");
  await typeInto(data, pathData);
  await pressAndSettle(
    must(
      container.querySelector<HTMLElement>("[data-yunari-path-preset-add]"),
      "Add control",
    ),
  );

  const row = must(
    container.querySelector<HTMLElement>("[data-yunari-path-preset]"),
    "preset row",
  );
  expect(row.textContent).toContain("Star");
  // The tile draws the preset itself rather than a vocabulary stand-in, which
  // is what lets an authored figure read as the shape it inserts.
  expect(row.querySelector("path")?.getAttribute("d")).toBe(pathData);
  expect(activeUserPathPresets()).toMatchObject([
    { label: "Star", data: pathData, paint: "fill" },
  ]);

  await pressAndSettle(
    must(
      container.querySelector<HTMLElement>("[data-yunari-path-preset-remove]"),
      "Remove control",
    ),
  );
  expect(container.querySelectorAll("[data-yunari-path-preset]")).toHaveLength(
    0,
  );
});

it("lists the shipped custom shapes and gives the add form its examples", async () => {
  const container = await mount(<PathPresetsPage />);

  expect(
    Array.from(
      container.querySelectorAll<HTMLElement>(
        "[data-yunari-path-preset-builtin]",
      ),
    ).map((row) => row.textContent),
    "the shipped presets are Add-pane vocabulary, so the page lists them",
  ).toEqual(PATH_PRESET_IDS.map((id) => uiCopy.pathPresets[id]));
  expect(
    container.querySelector<HTMLInputElement>("[data-yunari-path-preset-name]")
      ?.placeholder,
  ).toBe(uiCopy.settings.pathPresetNamePlaceholder);
  expect(
    container.querySelector<HTMLTextAreaElement>(
      "[data-yunari-path-preset-data]",
    )?.placeholder,
  ).toBe(uiCopy.settings.pathPresetDataPlaceholder);
});

it("removes a shipped shape and restores it without touching the author's", async () => {
  await loadPathPresets(pathPresetHost({ presets: [] }).fetcher, localStorage);
  const container = await mount(<PathPresetsPage />);

  await typeInto(
    must(
      container.querySelector<HTMLInputElement>(
        "[data-yunari-path-preset-name]",
      ),
      "preset name field",
    ),
    "Star",
  );
  await typeInto(
    must(
      container.querySelector<HTMLTextAreaElement>(
        "[data-yunari-path-preset-data]",
      ),
      "preset data field",
    ),
    "M 0 0 L 10 0 L 10 10 Z",
  );
  await pressAndSettle(
    must(
      container.querySelector<HTMLElement>("[data-yunari-path-preset-add]"),
      "Add control",
    ),
  );

  await pressAndSettle(
    must(
      container.querySelector<HTMLElement>(
        '[data-yunari-path-preset-builtin-remove="arc"]',
      ),
      "Remove control for the arc",
    ),
  );
  expect(
    container.querySelector('[data-yunari-path-preset-builtin="arc"]'),
  ).toBeNull();
  expect(activeRemovedPathPresetIds()).toEqual(["arc"]);
  expect(activeUserPathPresets()).toHaveLength(1);

  await pressAndSettle(
    must(
      container.querySelector<HTMLElement>("[data-yunari-path-preset-restore]"),
      "Restore defaults control",
    ),
  );
  expect(
    container.querySelector('[data-yunari-path-preset-builtin="arc"]'),
  ).not.toBeNull();
  expect(activeRemovedPathPresetIds()).toEqual([]);
  expect(localStorage.getItem(REMOVED_PATH_PRESETS_STORAGE_KEY)).toBeNull();
  // Restoring the catalogue is not a reset of the author's own shapes.
  expect(activeUserPathPresets()).toHaveLength(1);
});

it("names what a path preset is missing rather than storing an invisible one", async () => {
  const container = await mount(<PathPresetsPage />);

  await press(
    must(
      container.querySelector<HTMLElement>("[data-yunari-path-preset-add]"),
      "Add control",
    ),
  );

  expect(
    container.querySelector("[data-yunari-path-preset-reason]")?.textContent,
  ).toBe(uiCopy.settings.pathPresetNameRequired);
  expect(activeUserPathPresets()).toEqual([]);
});

it("names an equivalent ratio that is already listed", async () => {
  const container = await mount(<PreviewsPage storage={localStorage} />);
  const field = must(
    container.querySelector<HTMLInputElement>(
      "[data-yunari-preview-ratio-input]",
    ),
    "ratio field",
  );

  await typeInto(field, "7:3");
  await press(
    must(
      container.querySelector<HTMLElement>("[data-yunari-preview-ratio-add]"),
      "Add control",
    ),
  );
  await typeInto(field, "21:9");
  await press(
    must(
      container.querySelector<HTMLElement>("[data-yunari-preview-ratio-add]"),
      "Add control",
    ),
  );

  expect(
    container.querySelector<HTMLElement>("[data-yunari-preview-ratio-reason]")
      ?.textContent,
    "an equivalent shape was added rather than refused in words",
  ).toBe(uiCopy.settings.previewRatioEquivalent("21:9", "7:3"));
});

it("shows a stored credential's hint and never the value", async () => {
  credentials.listCredentials.mockResolvedValue([
    rowOf({ id: "saved", label: "Saved source", set: true, hint: "9f2c" }),
    rowOf({ id: "empty", label: "Empty source" }),
  ]);
  const container = await mount(<AssetSourcesPage />);
  await act(async () => {
    await Promise.resolve();
  });

  const row = (id: string): HTMLElement =>
    must(
      container.querySelector<HTMLElement>(
        `[data-yunari-credential-row="${id}"]`,
      ),
      `${id} credential row`,
    );
  expect(row("saved").textContent).toContain(
    uiCopy.settings.connectionsSaved("9f2c"),
  );
  expect(row("empty").textContent).toContain(uiCopy.settings.connectionsNotSet);
  expect(container.textContent).not.toContain("sk-live-9f2c");
});

it("saves once and refreshes the row from the host", async () => {
  credentials.listCredentials
    .mockResolvedValueOnce([rowOf({ id: "demo", label: "Demo source" })])
    .mockResolvedValueOnce([
      rowOf({ id: "demo", label: "Demo source", set: true, hint: "9f2c" }),
    ]);
  const container = await mount(<AssetSourcesPage />);
  await act(async () => {
    await Promise.resolve();
  });

  const input = must(
    container.querySelector<HTMLInputElement>(
      '[data-yunari-credential-input="demo"]',
    ),
    "credential input",
  );
  await typeInto(input, "sk-live-9f2c");
  await press(
    must(
      container.querySelector<HTMLElement>(
        '[data-yunari-credential-save="demo"]',
      ),
      "Save control",
    ),
  );

  expect(credentials.saveCredential).toHaveBeenCalledWith(
    "demo",
    "sk-live-9f2c",
  );
  expect(
    credentials.listCredentials,
    "the row was refreshed from something other than the host",
  ).toHaveBeenCalledTimes(2);
  expect(
    must(
      container.querySelector<HTMLElement>(
        '[data-yunari-credential-row="demo"]',
      ),
      "refreshed credential row",
    ).textContent,
  ).toContain(uiCopy.settings.connectionsSaved("9f2c"));
});

it("prints the version facts the build owns, and the release only when the document has one", async () => {
  const withoutRelease = await mount(<AboutPage releaseVersion={undefined} />);
  const fact = (container: HTMLElement, id: string): string =>
    must(
      container.querySelector<HTMLElement>(`[data-yunari-about-fact="${id}"]`),
      `${id} fact`,
    ).textContent ?? "";

  expect(fact(withoutRelease, "product-version")).toBe(__YUNARI_VERSION__);
  expect(fact(withoutRelease, "schema-version")).toBe(SUPPORTED_SCHEMA_VERSION);
  expect(
    withoutRelease.querySelector('[data-yunari-about-fact="release-version"]'),
    "a document with no release version was given one anyway",
  ).toBeNull();

  const withRelease = await mount(<AboutPage releaseVersion="2.5.1" />);
  expect(fact(withRelease, "release-version")).toBe("2.5.1");
});
