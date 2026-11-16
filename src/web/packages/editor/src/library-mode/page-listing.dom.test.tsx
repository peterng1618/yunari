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
      "/api/themes",
      () =>
        json({
          themes: [{ id: LOCAL_THEME, name: "Local theme", facets: FACETS }],
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

it("deletes a Dashboard theme only after the confirmation", async () => {
  vi.stubGlobal("fetch", answering(localThemeServing()));
  const commands = commandClient();
  const container = await mountPage("dashboard-themes", "all", commands.client);
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
  await vi.waitFor(() =>
    expect(cells(container), "the deleted theme is still drawn").toEqual([]),
  );
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
