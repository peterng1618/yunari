// The page-level Library harness, shared by the page test files beside it: the
// mount, the host routes a page reads, and the fixtures a case varies.

import { cataloguePackageUrl } from "@yunari/renderer-core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { expect, vi } from "vitest";
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

export const THEME_A = "11111111-1111-4111-8111-111111111111";
export const THEME_B = "22222222-2222-4222-8222-222222222222";
export const LOCAL_THEME = "local-theme";
export const PLUGIN_ID = "55555555-5555-4555-8555-555555555555";

let root: Root | undefined;
let host: HTMLDivElement | undefined;

export async function unmount(): Promise<void> {
  const mounted = root;
  root = undefined;
  host?.remove();
  host = undefined;
  if (mounted !== undefined) await act(async () => mounted.unmount());
}

export function must<T extends Element>(found: T | null, what: string): T {
  if (found === null) throw new Error(`the page rendered no ${what}`);
  return found;
}

export const FACETS = {
  author: "mira-k",
  colourMode: "dark",
  sensors: [],
  tags: [],
  orientation: "landscape",
  aspect: "16:9",
  width: 1920,
  height: 1080,
};

export function entry(
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

export function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}

export function indexOf(entries: readonly unknown[]): Response {
  return json({ generatedAt: "2026-10-21T00:00:00.000Z", entries });
}

/** A `fetch` keyed by path prefix; an unmatched path is a 404 so a route a case
 *  forgot is a failed read rather than a plausible empty answer. */
export function answering(
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

export function cells(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll("[data-yunari-store-cell-name]")].map(
    (cell) => cell.textContent ?? "",
  );
}

export async function waitForCells(
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

export async function mountPage(
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
export function commandClient(): {
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

/** The host's own theme listing: one local theme, which is the row a library
 *  action belongs to. A catalogue row shows Install instead. */
export function localThemeServing(): readonly (readonly [
  string,
  () => Response,
])[] {
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

/** The host routes a submission reads, with the bodies it received. The submit
 *  path is matched before `/api/themes`, which is its prefix. */
export function submitServing(): {
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

/** One collection entry with two required includes and the catalogue facts a
 *  plan read needs. */
export function collectionEntry(): unknown {
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
