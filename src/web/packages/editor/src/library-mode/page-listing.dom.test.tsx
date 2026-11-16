// @vitest-environment jsdom
/**
 * The Library's Dashboard themes page: the state filter over catalogue and
 * local rows, the listing toolbar, the catalogue's refusals, and the three
 * stored-theme actions.
 *
 * The retired store region owned Assign, Export and Delete, and the page that
 * replaced it must keep them: these cases press the cell's own controls and
 * read the host call each one makes, so a page that drew the controls but
 * wired none of them fails here.
 */
import { cataloguePackageUrl } from "@yunari/renderer-core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { uiCopy } from "../ui-copy.js";
import { LibraryRegion } from "./region.js";
import type { LibraryPage, LibraryState } from "./sources.js";
import { LIBRARY_FACETS_KEY } from "./view-preferences.js";

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as never;
Element.prototype.getAnimations ??= (): never[] => [];
window.PointerEvent ??= MouseEvent as never;
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const THEME_A = "11111111-1111-4111-8111-111111111111";
const THEME_B = "22222222-2222-4222-8222-222222222222";
const LOCAL_THEME = "local-theme";
const PLUGIN_ID = "55555555-5555-4555-8555-555555555555";

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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

function must<T extends Element>(found: T | null, what: string): T {
  if (found === null) throw new Error(`the page rendered no ${what}`);
  return found;
}

const FACETS = {
  author: "mira-k",
  colourMode: "dark",
  sensors: [],
  tags: [],
  orientation: "landscape",
  aspect: "16:9",
  width: 1920,
  height: 1080,
};

function entry(
  id: string,
  name: string,
  extra: Readonly<Record<string, unknown>> = {},
): unknown {
  return {
    id,
    kind: "dashboard-theme",
    name,
    version: "1.0.0",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-14T00:00:00.000Z",
    downloads: 0,
    favorites: 0,
    packageUrl: cataloguePackageUrl(id, "1.0.0"),
    thumbnail: `catalogue/${id}/thumbnail.png`,
    members: [{ id, kind: "dashboard-theme", name }],
    facets: FACETS,
    ...extra,
  };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}

function indexOf(entries: readonly unknown[]): Response {
  return json({ generatedAt: "2026-10-21T00:00:00.000Z", entries });
}

/** A `fetch` keyed by path prefix; an unmatched path is a 404 so a route a case
 *  forgot is a failed read rather than a plausible empty answer. */
function answering(
  routes: readonly (readonly [string, () => Response])[],
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [prefix, answer] of routes) {
      if (url.includes(prefix)) return answer();
    }
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
}

function cells(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll("[data-yunari-store-cell-name]")].map(
    (cell) => cell.textContent ?? "",
  );
}

async function waitForCells(
  container: HTMLElement,
  expected: readonly string[],
): Promise<void> {
  await vi.waitFor(() =>
    expect(
      cells(container),
      "the grid did not draw the expected cells",
    ).toEqual(expected),
  );
}

async function mountPage(
  page: LibraryPage,
  state: LibraryState,
  client?: unknown,
  onThemeRemoved?: (id: string) => void,
): Promise<HTMLDivElement> {
  await unmount();
  const container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  host = container;
  await act(async () =>
    mounted.render(
      <LibraryRegion
        page={page}
        onPage={() => undefined}
        state={state}
        onState={() => undefined}
        {...(client === undefined ? {} : { client: client as never })}
        {...(onThemeRemoved === undefined ? {} : { onThemeRemoved })}
      />,
    ),
  );
  return container;
}

/** A client answering the three commands, and the spy each one records on. */
function commandClient(): {
  readonly client: unknown;
  readonly remove: ReturnType<typeof vi.fn>;
  readonly open: ReturnType<typeof vi.fn>;
  readonly listDisplays: ReturnType<typeof vi.fn>;
} {
  const remove = vi.fn(async () => undefined);
  const open = vi.fn(async () => ({
    envelope: {
      schemaVersion: "3.0.0",
      fabricVersion: "7.4.0",
      id: THEME_A,
      artboard: { width: 1920, height: 1080 },
      metadata: { name: "Mira's wall", themeLanguage: "en" },
      globals: {
        typeTokens: {
          heading: { family: "system-ui, sans-serif", weight: "600" },
          body: { family: "system-ui, sans-serif", weight: "400" },
          mono: { family: "monospace", weight: "400" },
        },
      },
      scene: { version: "7.4.0", objects: [] },
    },
    assets: {},
  }));
  const listDisplays = vi.fn(async () => ({
    default: null,
    displays: [],
  }));
  return {
    client: {
      list: async () => [
        { id: LOCAL_THEME, name: "Local theme", facets: FACETS },
      ],
      open,
      save: async () => THEME_A,
      remove,
      assign: async () => undefined,
      listDisplays,
    },
    remove,
    open,
    listDisplays,
  };
}

it("filters the Dashboard themes page by the state", async () => {
  vi.stubGlobal(
    "fetch",
    answering([
      [
        "/index.json",
        () =>
          indexOf([
            entry(THEME_A, "Catalogue theme"),
            entry(THEME_B, "Other theme"),
          ]),
      ],
      [
        "/api/themes",
        () =>
          json({
            themes: [
              {
                id: "installed-copy",
                name: "Installed copy",
                origin: {
                  kind: "dashboard-theme",
                  catalogueId: THEME_A,
                  version: "1.0.0",
                  installedAt: "2026-10-01T00:00:00.000Z",
                },
                facets: FACETS,
              },
              { id: LOCAL_THEME, name: "Local theme", facets: FACETS },
            ],
          }),
      ],
    ]),
  );

  const all = await mountPage("dashboard-themes", "all");
  await waitForCells(all, ["Catalogue theme", "Other theme", "Local theme"]);

  const installed = await mountPage("dashboard-themes", "on-this-pc");
  await waitForCells(installed, ["Catalogue theme", "Local theme"]);

  const available = await mountPage("dashboard-themes", "not-installed");
  await waitForCells(available, ["Other theme"]);
});

/** The host's own theme listing: one local theme, which is the row a library
 *  action belongs to. A catalogue row shows Install instead. */
function localThemeServing(): readonly (readonly [string, () => Response])[] {
  return [
    ["/index.json", () => indexOf([])],
    [
      "/api/editor-themes",
      () => json([{ id: "editor-theme", name: "Office" }]),
    ],
    [
      "/api/themes",
      () =>
        json({
          themes: [{ id: LOCAL_THEME, name: "Local theme", facets: FACETS }],
        }),
    ],
    [
      "/api/extensions",
      () =>
        json({
          extensions: [
            {
              key: "acme/panels",
              name: "Acme panels",
              publisher: "acme",
              version: "1.0.0",
              execution: "trusted-worker",
              capabilities: [],
              devices: [],
              contributions: {
                panelFamilies: [{ id: "z-series", label: "Z series" }],
              },
            },
          ],
        }),
    ],
  ];
}

it("assigns a Dashboard theme from its cell", async () => {
  vi.stubGlobal("fetch", answering(localThemeServing()));
  const commands = commandClient();
  const container = await mountPage("dashboard-themes", "all", commands.client);
  await waitForCells(container, ["Local theme"]);

  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>(
        "[data-yunari-store-cell-action='assign']",
      ),
      "assign action",
    ).click(),
  );

  // The choice is the host's list, read when the dialog opens: the dialog is
  // the owner the retired region used, and it is the one that writes.
  await vi.waitFor(() =>
    expect(
      document.body.querySelector("[data-yunari-store-assign-form]"),
      "the assign press opened no display choice",
    ).not.toBeNull(),
  );
  expect(commands.listDisplays).toHaveBeenCalled();
});

it("exports a Dashboard theme through the host's own package writer", async () => {
  vi.stubGlobal("fetch", answering(localThemeServing()));
  const createObjectURL = vi.fn(() => "blob:theme");
  const revokeObjectURL = vi.fn();
  Object.assign(URL, { createObjectURL, revokeObjectURL });
  const downloaded = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => undefined);
  const commands = commandClient();
  const container = await mountPage("dashboard-themes", "all", commands.client);
  await waitForCells(container, ["Local theme"]);

  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>(
        "[data-yunari-store-cell-action='export']",
      ),
      "export action",
    ).click(),
  );

  await vi.waitFor(() =>
    expect(commands.open).toHaveBeenCalledWith(LOCAL_THEME),
  );
  await vi.waitFor(() => expect(downloaded).toHaveBeenCalledTimes(1));
  expect(
    (downloaded.mock.instances[0] as unknown as HTMLAnchorElement).download,
    "the export did not name the package after the theme",
  ).toMatch(/\.yunari-theme$/);
});

/** The host routes a submission reads, with the bodies it received. The submit
 *  path is matched before `/api/themes`, which is its prefix. */
function submitServing(): {
  readonly fetcher: typeof fetch;
  readonly submits: Record<string, unknown>[];
} {
  const submits: Record<string, unknown>[] = [];
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/themes/submit")) {
        submits.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return json({
          version: { from: null, to: "1.0.0", level: "initial" },
          status: "published",
        });
      }
      if (url.includes("/index.json")) return indexOf([]);
      if (url.includes("/api/themes")) {
        return json({
          themes: [{ id: LOCAL_THEME, name: "Local theme", facets: FACETS }],
        });
      }
      return new Response("", { status: 404 });
    },
  );
  return { fetcher: fetcher as unknown as typeof fetch, submits };
}

it("publishes from the gallery's own Publish press", async () => {
  const serving = submitServing();
  vi.stubGlobal("fetch", serving.fetcher);
  const commands = commandClient();
  const container = await mountPage("dashboard-themes", "all", commands.client);
  await waitForCells(container, ["Local theme"]);

  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>(
        "[data-yunari-store-cell-action='publish']",
      ),
      "publish action",
    ).click(),
  );

  await vi.waitFor(() =>
    expect(serving.submits, "the Publish press posted no submission").toEqual([
      { id: LOCAL_THEME },
    ]),
  );
});

it("announces a landed submission in the page's live region", async () => {
  const serving = submitServing();
  vi.stubGlobal("fetch", serving.fetcher);
  const commands = commandClient();
  const container = await mountPage("dashboard-themes", "all", commands.client);
  await waitForCells(container, ["Local theme"]);

  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>(
        "[data-yunari-store-cell-action='publish']",
      ),
      "publish action",
    ).click(),
  );

  await vi.waitFor(() =>
    expect(
      must(
        container.querySelector("[data-yunari-library-install-announcement]"),
        "install announcement live region",
      ).textContent,
      "the landed submission never reached the live region",
    ).toContain("Local theme: Submitted and listed."),
  );
});

it("deletes a Dashboard theme only after the confirmation", async () => {
  vi.stubGlobal("fetch", answering(localThemeServing()));
  const commands = commandClient();
  const themeRemoved = vi.fn();
  const container = await mountPage(
    "dashboard-themes",
    "all",
    commands.client,
    themeRemoved,
  );
  await waitForCells(container, ["Local theme"]);

  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>(
        "[data-yunari-store-cell-action='delete']",
      ),
      "delete action",
    ).click(),
  );
  const confirm = await vi.waitFor(() =>
    must(
      document.body.querySelector<HTMLButtonElement>(
        "[data-yunari-library-delete-confirm]",
      ),
      "delete confirmation",
    ),
  );
  expect(commands.remove).not.toHaveBeenCalled();

  await act(async () => confirm.click());

  await vi.waitFor(() =>
    expect(commands.remove).toHaveBeenCalledWith(LOCAL_THEME),
  );
  // The session hears it, so the open document's stored base is cleared and the
  // next save does not trust a folder the host trashed.
  expect(
    themeRemoved,
    "the removal did not reach the session",
  ).toHaveBeenCalledWith(LOCAL_THEME);
  await vi.waitFor(() =>
    expect(cells(container), "the deleted theme is still drawn").toEqual([]),
  );
});

/** **R27: a control with no route is drawn disabled and says why.** App themes
 *  live at `/api/editor-themes/:id` and a panel driver is not a theme at all, so
 *  neither may reach the dashboard-theme client — and neither may present a
 *  live button that falls to a notice. */
it("disables a kind's unrouted commands with a stated reason", async () => {
  const commands = commandClient();
  vi.stubGlobal("fetch", answering(localThemeServing()));
  const appThemes = await mountPage("app-themes", "all", commands.client);
  await waitForCells(appThemes, ["Office"]);

  for (const action of ["export", "delete"] as const) {
    const control = must(
      appThemes.querySelector<HTMLButtonElement>(
        `[data-yunari-store-cell-action='${action}']`,
      ),
      `${action} action`,
    );
    expect(
      control.disabled,
      `an app theme's ${action} is live, though the host has no route for it`,
    ).toBe(true);
    expect(
      document.body.querySelector(`#${control.id}-reason`)?.textContent?.trim(),
      `an app theme's ${action} states no reason`,
    ).not.toBe("");
  }
  expect(
    appThemes.querySelector(
      "[data-yunari-store-cell-action='open'], [data-yunari-store-cell-action='assign']",
    ),
    "an app theme draws an action its kind's table does not offer",
  ).toBeNull();
  expect(
    commands.open,
    "an editor theme's export called the dashboard-theme client",
  ).not.toHaveBeenCalled();
  expect(
    commands.remove,
    "an editor theme's delete called the dashboard-theme client",
  ).not.toHaveBeenCalled();
  expect(
    document.body.querySelector("[data-yunari-library-delete-dialog]"),
    "an editor theme's delete opened the dashboard-theme removal",
  ).toBeNull();

  // A panel driver is equipment, not a theme: it draws none of the four theme
  // commands, so Assign cannot reach the display register from its cell.
  const drivers = await mountPage("panel-drivers", "all");
  await waitForCells(drivers, ["Acme panels"]);
  expect(
    drivers.querySelector("[data-yunari-store-cell-action='assign']"),
    "a panel driver's cell draws a theme Assign",
  ).toBeNull();
  expect(
    commands.listDisplays,
    "a panel driver's cell read the display register",
  ).not.toHaveBeenCalled();
});

it("states the catalogue's refusals, one line per refused kind", async () => {
  vi.stubGlobal(
    "fetch",
    answering([
      [
        "/index.json",
        () =>
          indexOf([
            entry(THEME_A, "Catalogue theme"),
            { id: THEME_B, kind: "future-thing", name: "Future" },
          ]),
      ],
    ]),
  );
  const container = await mountPage("dashboard-themes", "all");

  await vi.waitFor(() =>
    expect(
      [...container.querySelectorAll("[data-yunari-library-refusal]")].map(
        (line) => line.textContent?.trim(),
      ),
      "the page did not state the kind it could not read",
    ).toEqual([uiCopy.store.catalogueRefused("future-thing", 1)]),
  );
});

it("filters the listing by a facet chosen in the toolbar", async () => {
  vi.stubGlobal(
    "fetch",
    answering([
      [
        "/index.json",
        () =>
          indexOf([
            entry(THEME_A, "Catalogue theme"),
            entry(THEME_B, "Other theme", {
              facets: { ...FACETS, author: "someone-else" },
            }),
          ]),
      ],
    ]),
  );
  const container = await mountPage("dashboard-themes", "all");
  await waitForCells(container, ["Catalogue theme", "Other theme"]);

  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>(
        "[data-yunari-facet='author']",
      ),
      "author facet",
    ).click(),
  );
  const option = await vi.waitFor(() =>
    must(
      document.body.querySelector<HTMLButtonElement>(
        "[data-yunari-facet-option='mira-k']",
      ),
      "author option",
    ),
  );
  await act(async () => option.click());

  await waitForCells(container, ["Catalogue theme"]);
});

it("remembers the density the toolbar chose", async () => {
  vi.stubGlobal(
    "fetch",
    answering([
      ["/index.json", () => indexOf([entry(THEME_A, "Catalogue theme")])],
    ]),
  );
  const container = await mountPage("dashboard-themes", "all");
  await waitForCells(container, ["Catalogue theme"]);

  const track = must(
    container.querySelector<HTMLInputElement>(
      "[data-yunari-store-density-track]",
    ),
    "density track",
  );
  expect(track.value, "the toolbar did not open on the default density").toBe(
    "2",
  );
  await act(async () => {
    // React reads a controlled input's change through its own value tracker, so
    // the value goes through the prototype setter the tracker wraps.
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(track, "4");
    track.dispatchEvent(new Event("input", { bubbles: true }));
  });

  expect(
    window.localStorage.getItem("yunari.editor.store-density"),
    "the chosen density was not remembered",
  ).toBe("spacious");
});

/** Type into a controlled search field through React's own value tracker. */
async function typeSearch(container: HTMLElement, text: string): Promise<void> {
  const field = must(
    container.querySelector<HTMLInputElement>("[data-yunari-library-search]"),
    "search field",
  );
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setValue?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("narrows the listing by the toolbar's search, and keeps it across a re-render", async () => {
  vi.stubGlobal(
    "fetch",
    answering([
      [
        "/index.json",
        () =>
          indexOf([
            entry(THEME_A, "Catalogue theme"),
            entry(THEME_B, "Other theme", {
              facets: { ...FACETS, author: "someone-else" },
            }),
          ]),
      ],
    ]),
  );
  const container = await mountPage("dashboard-themes", "all");
  await waitForCells(container, ["Catalogue theme", "Other theme"]);

  await typeSearch(container, "catalogue");
  await waitForCells(container, ["Catalogue theme"]);

  // A facet choice re-renders the page; the query is the page's state and the
  // field keeps what the person typed.
  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>(
        "[data-yunari-facet='author']",
      ),
      "author facet",
    ).click(),
  );
  const option = await vi.waitFor(() =>
    must(
      document.body.querySelector<HTMLButtonElement>(
        "[data-yunari-facet-option='mira-k']",
      ),
      "author option",
    ),
  );
  await act(async () => option.click());

  await waitForCells(container, ["Catalogue theme"]);
  expect(
    must(
      container.querySelector<HTMLInputElement>("[data-yunari-library-search]"),
      "search field",
    ).value,
    "the page forgot the search on a re-render",
  ).toBe("catalogue");
});

/** One collection entry with two required includes and the catalogue facts a
 *  plan read needs. */
function collectionEntry(): unknown {
  return entry("33333333-3333-4333-8333-333333333333", "Ops kit", {
    kind: "collection",
    members: [],
    includes: [
      { id: THEME_A, optional: false },
      { id: THEME_B, optional: false },
    ],
    sha256: "a".repeat(64),
    bytes: 4096,
  });
}

function planMember(id: string, name: string): Record<string, unknown> {
  return {
    id,
    kind: "dashboard-theme",
    name,
    version: "1.0.0",
    bytes: 10,
    publisher: "mira-k",
    optional: false,
  };
}

it("opens a collection's sheet from its card instead of installing it", async () => {
  const installs: unknown[] = [];
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/index.json")) return indexOf([collectionEntry()]);
      if (url.includes("/api/store/origins")) return json({ origins: [] });
      if (url.includes("/api/store/collection/plan")) {
        return json({
          plan: {
            members: [
              planMember(THEME_A, "Catalogue theme"),
              planMember(THEME_B, "Other theme"),
            ],
            missing: [],
            totalBytes: 20,
          },
        });
      }
      if (url.includes("/api/store/install")) {
        installs.push(JSON.parse(String(init?.body)));
        return json({ ok: true, members: [] });
      }
      if (url.includes("/api/themes")) return json({ themes: [] });
      return new Response("", { status: 404 });
    },
  );
  vi.stubGlobal("fetch", fetcher);

  const container = await mountPage("collections", "all");
  await waitForCells(container, ["Ops kit"]);
  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>(
        "[data-yunari-store-cell-install='install']",
      ),
      "collection install press",
    ).click(),
  );

  // The card asks for the sheet; it never posts an install with no choices.
  expect(installs, "the collection card installed without the sheet").toEqual(
    [],
  );
  const sheet = await vi.waitFor(() =>
    must(
      document.body.querySelector<HTMLElement>(
        "[data-yunari-collection-sheet]",
      ),
      "collection sheet",
    ),
  );
  expect(
    shallMemberCount(sheet),
    "the sheet does not list the collection's members",
  ).toBe(2);

  await act(async () =>
    must(
      document.body.querySelector<HTMLButtonElement>(
        "[data-yunari-collection-sheet-install]",
      ),
      "sheet install press",
    ).click(),
  );

  await vi.waitFor(() => expect(installs).toHaveLength(1));
  expect(
    (installs[0] as { readonly items?: readonly string[] }).items,
    "the sheet posted no chosen ids",
  ).toEqual([THEME_A, THEME_B]);
});

function shallMemberCount(sheet: HTMLElement): number {
  return sheet.querySelectorAll("[data-yunari-collection-member]").length;
}

/** **A held update is not a silent no-op.** The host answers the press with
 *  409 and the growth it held the update for; the page draws that answer, the
 *  approval press re-posts the same item with `approveUpdate`, and a dismissal
 *  leaves the notice standing on nothing. */
it("draws a held update, approves it, and dismisses it", async () => {
  const posts: Record<string, unknown>[] = [];
  const held = {
    key: "acme/panels",
    name: "Acme panels",
    publisher: "acme",
    reasons: ["adds the sensor-provider capability"],
  };
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/index.json")) {
        return indexOf([
          entry(PLUGIN_ID, "Acme panels", {
            kind: "plugin",
            members: [
              { id: "acme-panel", kind: "panel-driver", name: "Acme panel" },
            ],
            facets: { ...FACETS, author: "acme" },
          }),
        ]);
      }
      if (url.includes("/api/extensions")) return json({ extensions: [] });
      if (url.includes("/api/store/install")) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        posts.push(body);
        if (body["approveUpdate"] !== true) {
          return new Response(JSON.stringify({ ok: false, held }), {
            status: 409,
          });
        }
        return json({ ok: true });
      }
      return new Response("", { status: 404 });
    },
  );
  vi.stubGlobal("fetch", fetcher);

  const container = await mountPage("panel-drivers", "all");
  await waitForCells(container, ["Acme panels"]);

  const press = (): void =>
    must(
      container.querySelector<HTMLButtonElement>(
        "[data-yunari-store-cell-install='install']",
      ),
      "plugin install press",
    ).click();
  const notice = (): Element | null =>
    container.querySelector("[data-yunari-held-update]");

  await act(async () => press());
  await vi.waitFor(() =>
    expect(notice(), "a held update drew no notice").not.toBeNull(),
  );
  expect(
    notice()?.textContent,
    "the notice does not name the growth that held the update",
  ).toContain("sensor-provider capability");
  expect(
    posts[0]?.["approveUpdate"],
    "the first press already asked for approval",
  ).toBeUndefined();

  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>("[data-yunari-held-dismiss]"),
      "held dismiss",
    ).click(),
  );
  expect(notice(), "dismissing the notice left it standing").toBeNull();

  await act(async () => press());
  await vi.waitFor(() => expect(notice()).not.toBeNull());
  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>("[data-yunari-held-approve]"),
      "held approve",
    ).click(),
  );

  await vi.waitFor(() => expect(posts).toHaveLength(3));
  expect(
    posts[2]?.["approveUpdate"],
    "the approval press did not ask the host to approve",
  ).toBe(true);
  await vi.waitFor(() =>
    expect(notice(), "the notice stayed after the update landed").toBeNull(),
  );
});

it("keeps the four theme commands on an installed catalogue theme", async () => {
  vi.stubGlobal(
    "fetch",
    answering([
      ["/index.json", () => indexOf([entry(THEME_A, "Catalogue theme")])],
      [
        "/api/themes",
        () =>
          json({
            themes: [
              {
                id: "installed-copy",
                name: "Installed copy",
                origin: {
                  kind: "dashboard-theme",
                  catalogueId: THEME_A,
                  version: "1.0.0",
                  installedAt: "2026-10-01T00:00:00.000Z",
                },
                facets: FACETS,
              },
            ],
          }),
      ],
    ]),
  );
  const container = await mountPage("dashboard-themes", "all");
  await waitForCells(container, ["Catalogue theme"]);

  for (const action of ["open", "assign", "export", "delete"] as const) {
    expect(
      container.querySelector(
        `[data-yunari-store-cell='${THEME_A}'] [data-yunari-store-cell-action='${action}']`,
      ),
      `an installed catalogue theme lost its ${action} command`,
    ).not.toBeNull();
  }
});

/** An `IntersectionObserver` a case fires by hand: jsdom has none, and the
 *  grid's sentinel is the only observer on this surface. */
let observe: (() => void) | undefined;
class FakeObserver {
  constructor(callback: IntersectionObserverCallback) {
    observe = () => {
      callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        this as never,
      );
    };
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

it("draws another batch when the sentinel reaches the end", async () => {
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  observe = undefined;
  const entries = Array.from({ length: 30 }, (_, index) =>
    entry(
      `${String(index).padStart(2, "0")}111111-1111-4111-8111-111111111111`,
      `Theme ${String(index).padStart(2, "0")}`,
    ),
  );
  vi.stubGlobal("fetch", answering([["/index.json", () => indexOf(entries)]]));
  const container = await mountPage("dashboard-themes", "all");
  await vi.waitFor(() =>
    expect(
      cells(container).length,
      "the first render drew more than one batch",
    ).toBe(24),
  );
  if (observe === undefined) throw new Error("the grid observed no sentinel");

  await act(async () => observe?.());

  await vi.waitFor(() =>
    expect(cells(container).length, "the second batch never loaded").toBe(30),
  );
});

it("states the refusals a re-listing answered instead of clearing them", async () => {
  let indexReads = 0;
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/index.json")) {
      indexReads += 1;
      return indexReads === 1
        ? indexOf([entry(THEME_A, "Catalogue theme")])
        : indexOf([
            entry(THEME_A, "Catalogue theme"),
            { id: THEME_B, kind: "future-thing", name: "Future" },
          ]);
    }
    if (url.includes("/api/store/install")) return json({ ok: true });
    if (url.includes("/api/themes")) return json({ themes: [] });
    return new Response("", { status: 404 });
  });
  vi.stubGlobal("fetch", fetcher);

  const container = await mountPage("dashboard-themes", "all");
  await waitForCells(container, ["Catalogue theme"]);
  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>(
        "[data-yunari-store-cell-install='install']",
      ),
      "install press",
    ).click(),
  );

  await vi.waitFor(() =>
    expect(
      [...container.querySelectorAll("[data-yunari-library-refusal]")].map(
        (line) => line.textContent?.trim(),
      ),
      "the re-listing's refusal was cleared with the old rows",
    ).toEqual([uiCopy.store.catalogueRefused("future-thing", 1)]),
  );
});

it("redraws an open modal's foot once an install lands", async () => {
  let themeReads = 0;
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/index.json")) {
      return indexOf([entry(THEME_A, "Catalogue theme")]);
    }
    if (url.includes("/api/store/install")) return json({ ok: true });
    if (url.includes("/api/themes")) {
      themeReads += 1;
      return themeReads === 1
        ? json({ themes: [] })
        : json({
            themes: [
              {
                id: "installed-copy",
                name: "Installed copy",
                origin: {
                  kind: "dashboard-theme",
                  catalogueId: THEME_A,
                  version: "1.0.0",
                  installedAt: "2026-10-01T00:00:00.000Z",
                },
                facets: FACETS,
              },
            ],
          });
    }
    return new Response("", { status: 404 });
  });
  vi.stubGlobal("fetch", fetcher);

  const container = await mountPage("dashboard-themes", "all");
  await waitForCells(container, ["Catalogue theme"]);
  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>(
        "[data-yunari-store-cell-name-press]",
      ),
      "card press",
    ).click(),
  );
  await vi.waitFor(() =>
    must(
      document.body.querySelector<HTMLButtonElement>(
        "#yunari-store-item-install",
      ),
      "modal install press",
    ),
  );
  await act(async () =>
    must(
      document.body.querySelector<HTMLButtonElement>(
        "#yunari-store-item-install",
      ),
      "modal install press",
    ).click(),
  );

  await vi.waitFor(() =>
    expect(
      document.body
        .querySelector("[data-yunari-store-item-install]")
        ?.getAttribute("data-yunari-store-item-install"),
      "the open modal still reads Install after the install landed",
    ).toBe("installed"),
  );
  expect(
    document.body.querySelector("#yunari-store-item-install"),
    "the modal kept a live Install control, so a second press could write again",
  ).toBeNull();
});

/** **A restored facet choice is the person's, not the first render's.** It is
 *  pruned only after a listing answers: pruning the empty first render erased
 *  the choice before it could filter anything, and pruning again after every
 *  render ate the facet they had just chosen. */
it("keeps a restored facet until the listing answers, then prunes once", async () => {
  window.sessionStorage.setItem(
    LIBRARY_FACETS_KEY,
    JSON.stringify({ author: ["mira-k"] }),
  );
  vi.stubGlobal(
    "fetch",
    answering([
      ["/index.json", () => indexOf([entry(THEME_A, "Catalogue theme")])],
    ]),
  );
  const kept = await mountPage("dashboard-themes", "all");
  await waitForCells(kept, ["Catalogue theme"]);

  expect(
    JSON.parse(window.sessionStorage.getItem(LIBRARY_FACETS_KEY) ?? "null"),
    "the first render pruned the restored choice before the listing answered",
  ).toEqual({ author: ["mira-k"] });

  // Another listing no longer offers that author: the choice is dropped, once.
  vi.stubGlobal(
    "fetch",
    answering([
      [
        "/index.json",
        () =>
          indexOf([
            entry(THEME_B, "Other theme", {
              facets: { ...FACETS, author: "someone-else" },
            }),
          ]),
      ],
    ]),
  );
  const pruned = await mountPage("dashboard-themes", "all");
  await waitForCells(pruned, ["Other theme"]);

  expect(
    JSON.parse(window.sessionStorage.getItem(LIBRARY_FACETS_KEY) ?? "null"),
    "a facet the listing no longer offers was kept",
  ).toEqual({});
});

/** **The register is re-read on every detail open.** A collection reached from
 *  another page is classified against it, and an install made since the last
 *  open would otherwise leave the old count on screen. */
it("re-reads the origin register on every detail open", async () => {
  let originReads = 0;
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/index.json")) return indexOf([]);
    if (url.includes("/api/store/origins")) {
      originReads += 1;
      return json({ origins: [] });
    }
    if (url.includes("/api/themes")) {
      return json({
        themes: [{ id: LOCAL_THEME, name: "Local theme", facets: FACETS }],
      });
    }
    return new Response("", { status: 404 });
  });
  vi.stubGlobal("fetch", fetcher);

  const container = await mountPage("dashboard-themes", "all");
  await waitForCells(container, ["Local theme"]);

  for (let open = 1; open <= 2; open += 1) {
    await act(async () =>
      must(
        container.querySelector<HTMLButtonElement>(
          "[data-yunari-store-cell-name-press]",
        ),
        "card press",
      ).click(),
    );
    await vi.waitFor(() =>
      expect(
        document.body.querySelector("[data-yunari-store-item]"),
      ).not.toBeNull(),
    );
    await act(async () =>
      must(
        document.body.querySelector<HTMLButtonElement>(
          "[data-yunari-store-item-close]",
        ),
        "close control",
      ).click(),
    );
    await vi.waitFor(() =>
      expect(
        document.body.querySelector("[data-yunari-store-item]"),
      ).toBeNull(),
    );
  }

  expect(
    originReads,
    "a second detail open reused the stale register",
  ).toBeGreaterThanOrEqual(2);
});

/** **R27: a live per-kind command runs through its route.** A code member's
 *  Remove is the host's extension DELETE, named by the installed copy's own
 *  key; the press re-lists so the row leaves because the host no longer serves
 *  it. */
it("removes an installed extension through the route its kind owns", async () => {
  const calls: { readonly url: string; readonly method: string }[] = [];
  const base = answering(localThemeServing());
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
      });
      if (init?.method === "DELETE") return json({ ok: true });
      return base(input, init);
    },
  );
  vi.stubGlobal("fetch", fetcher as unknown as typeof fetch);

  const container = await mountPage("panel-drivers", "all");
  await waitForCells(container, ["Acme panels"]);
  await act(async () =>
    must(
      container.querySelector<HTMLButtonElement>(
        "[data-yunari-store-cell-name-press]",
      ),
      "card press",
    ).click(),
  );

  // The member's own kind decides the commands: Assign and Device status have
  // no route this build runs, so only Remove is live.
  await act(async () =>
    must(
      document.body.querySelector<HTMLButtonElement>(
        '[data-yunari-store-item-action="remove"]',
      ),
      "footer Remove",
    ).click(),
  );

  await vi.waitFor(() =>
    expect(
      calls.find((call) => call.method === "DELETE")?.url,
      "Remove did not reach the host's extension route",
    ).toBe("/api/extensions/acme%2Fpanels"),
  );
});

/** **A collection is neither side until the register answers.** Its state is
 *  counted over `/api/store/origins`, so an unread register must not draw an
 *  installed collection as "Not installed" or hide it from "On this PC". */
it("leaves collections out of the state filters until the register answers", async () => {
  vi.stubGlobal(
    "fetch",
    answering([["/index.json", () => indexOf([collectionEntry()])]]),
  );

  const notInstalled = await mountPage("collections", "not-installed");
  await vi.waitFor(() =>
    expect(
      cells(notInstalled),
      "an unread register classified a collection as not installed",
    ).toEqual([]),
  );

  const onThisPc = await mountPage("collections", "on-this-pc");
  await vi.waitFor(() =>
    expect(
      cells(onThisPc),
      "an unread register drew a collection as installed",
    ).toEqual([]),
  );
});
