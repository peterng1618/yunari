// The Library region's DOM harness, shared by the test files beside it: the
// mount, the routes a page reads, and the cell reader.

import { cataloguePackageUrl } from "@yunari/renderer-core";
import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { expect, vi } from "vitest";
import { LibraryRegion, type LibraryState } from "./region.js";
import type { LibraryPage } from "./sources.js";

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

/** jsdom has no modal or popover matching, and the library's surfaces ask. */
const matches = Element.prototype.matches;
Element.prototype.matches = Object.assign(function (
  this: Element,
  selector: string,
): boolean {
  if (selector === ":modal" || selector === ":popover-open") return false;
  return matches.call(this, selector);
}, matches);

let root: Root | undefined;
let host: HTMLDivElement | undefined;

export async function unmount(): Promise<void> {
  const mounted = root;
  root = undefined;
  host?.remove();
  host = undefined;
  if (mounted !== undefined) await act(async () => mounted.unmount());
}

export async function mount(element: ReactElement): Promise<HTMLDivElement> {
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

export function must<T extends Element>(found: T | null, what: string): T {
  if (found === null) throw new Error(`the region rendered no ${what}`);
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

export function entry(
  kind: string,
  id: string,
  name: string,
  members: readonly { id: string; kind: string; name: string }[],
  extra: Readonly<Record<string, unknown>> = {},
): unknown {
  return {
    id,
    kind,
    name,
    version: "1.0.0",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-14T00:00:00.000Z",
    downloads: 0,
    favorites: 0,
    packageUrl: cataloguePackageUrl(id, "1.0.0"),
    thumbnail: `catalogue/${id}/thumbnail.png`,
    members,
    facets: FACETS,
    ...extra,
  };
}

export function indexOf(entries: readonly unknown[]): Response {
  return new Response(
    JSON.stringify({ generatedAt: "2026-10-21T00:00:00.000Z", entries }),
    { status: 200 },
  );
}

export function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}

/** A `fetch` answering the routes a page reads, keyed by path prefix. An
 *  unmatched path is a 404 rather than a plausible empty body, so a route this
 *  case forgot is a failed read it can see. */
export function answering(
  routes: readonly (readonly [string, () => Response])[],
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [prefix, answer] of routes) {
      if (url.startsWith(prefix)) return answer();
    }
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
}

export const CATALOGUE = "https://yunari-store.workers.dev/index.json";

/** The cell names the grid drew, in reading order. */
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

/** A controlled mount, so a case changes the page or the state the way the
 *  shell does — through the props the region is handed. */
function Harness(props: {
  readonly page: LibraryPage;
  readonly state: LibraryState;
  readonly onPage: ((page: LibraryPage) => void) | undefined;
  readonly onStatus: ((count: number | undefined) => void) | undefined;
}): React.JSX.Element {
  const [page, setPage] = useState(props.page);
  const [state, setState] = useState(props.state);
  return (
    <LibraryRegion
      page={page}
      onPage={(next) => {
        setPage(next);
        props.onPage?.(next);
      }}
      state={state}
      onState={setState}
      onStatus={props.onStatus}
    />
  );
}

export async function mountHarness(
  page: LibraryPage,
  state: LibraryState = "all",
  onPage?: (page: LibraryPage) => void,
  onStatus?: (count: number | undefined) => void,
): Promise<HTMLDivElement> {
  return mount(
    <Harness page={page} state={state} onPage={onPage} onStatus={onStatus} />,
  );
}
