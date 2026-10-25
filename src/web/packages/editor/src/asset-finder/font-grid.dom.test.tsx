// @vitest-environment jsdom
import type {
  AssetPage,
  AssetResult,
  AssetSourceListing,
  FontCut,
} from "@yunari/renderer-core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { uiCopy } from "../ui-copy.js";
import * as client from "./client.js";
import { FontGrid } from "./font-grid.js";
import { FontsBody } from "./fonts-body.js";
import { SEARCH_DEBOUNCE_MS } from "./modal.js";

vi.mock("./client.js", () => ({
  listSources: vi.fn(),
  searchAssets: vi.fn(),
  assetBytes: vi.fn(),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const listSources = vi.mocked(client.listSources);
const searchAssets = vi.mocked(client.searchAssets);

const curated: AssetSourceListing = {
  id: "curated-fonts",
  label: "Curated fonts",
  category: "font",
  body: "font-picker",
  requires: null,
  configurable: false,
  presetKind: null,
  host: null,
};

const google: AssetSourceListing = {
  id: "google-fonts",
  label: "Google Fonts",
  category: "font",
  body: "font-picker",
  requires: null,
  configurable: false,
  presetKind: null,
  host: "api.fontsource.org",
};

function cut(source: string, family: string, weight: number): FontCut {
  const slug = family.toLowerCase().replace(/\s+/g, "-");
  return {
    id: `cut:${slug}-${weight}`,
    source,
    family,
    weight,
    style: "normal",
    subset: "latin",
    format: "woff2",
    previewUrl: `https://cdn.example/${slug}-${weight}.woff2`,
    licence: "OFL-1.1",
    sourceUrl: `https://cdn.example/${slug}-${weight}.woff2`,
  };
}

function trioResult(
  source: string,
  id: string,
  families: readonly [string, string, string],
): AssetResult {
  const heading = cut(source, families[0], 700);
  const body = cut(source, families[1], 400);
  const mono = cut(source, families[2], 400);
  const name = `${families[0]} — ${families.join(" + ")}`;
  return {
    id: `${source}:trio:${id}`,
    name,
    kind: "font",
    preview: "",
    subtitle: "A description.",
    licence: "OFL-1.1",
    sourceUrl: heading.sourceUrl ?? "",
    font: {
      cuts: [heading, body, mono],
      trio: {
        id,
        name,
        description: "A description.",
        roles: { heading, body, mono },
      },
    },
  };
}

function familyResult(source: string, family: string): AssetResult {
  const cuts = [cut(source, family, 400), cut(source, family, 700)];
  return {
    id: `${source}:${cuts[0]?.id ?? ""}`,
    name: family,
    kind: "font",
    preview: "",
    subtitle: "sans · 2 cuts",
    licence: "OFL-1.1",
    sourceUrl: cuts[0]?.sourceUrl ?? "",
    font: { cuts },
  };
}

function page(
  source: string,
  results: readonly AssetResult[] = [],
  extra: Partial<AssetPage> = {},
): AssetPage {
  return { source, results, totalPages: undefined, failure: undefined, ...extra };
}

const interTrio = trioResult("curated-fonts", "inter-poppins", [
  "Inter",
  "Poppins",
  "Fira Code",
]);
const manrope = familyResult("google-fonts", "Manrope");
const sora = familyResult("google-fonts", "Sora");

let root: HTMLDivElement | undefined;
let container: Root | undefined;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  container?.unmount();
  root?.remove();
  root = undefined;
  container = undefined;
  vi.useRealTimers();
});

function mount(element: React.ReactElement): void {
  root = document.createElement("div");
  document.body.append(root);
  container = createRoot(root);
  act(() => {
    container?.render(element);
  });
}

async function render(props: { readonly client?: client.ClientOptions } = {}) {
  listSources.mockResolvedValue({ ok: true, sources: [curated, google] });
  mount(
    <FontsBody
      onApplyFace={() => {}}
      onApplyTrio={() => {}}
      {...(props.client === undefined ? {} : { client: props.client })}
    />,
  );
  await act(async () => {
    await Promise.resolve();
  });
}

function search(): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>(
    "[data-yunari-font-search]",
  );
  if (found === null) throw new Error("no font search input.");
  return found;
}

async function type(value: string): Promise<void> {
  const field = search();
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let pass = 0; pass < 5; pass += 1) {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 1);
      await Promise.resolve();
      await Promise.resolve();
    }
  });
}

function press(selector: string): void {
  const found = document.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`no ${selector}.`);
  act(() => {
    found.click();
  });
}

function tiles(kind?: "trio" | "family"): readonly HTMLElement[] {
  const rule =
    kind === undefined
      ? "[data-yunari-font-tile]"
      : `[data-yunari-font-tile][data-yunari-font-kind="${kind}"]`;
  return [...document.querySelectorAll<HTMLElement>(rule)];
}

it("asks the font body and draws trios and families in one grid", async () => {
  searchAssets.mockResolvedValue({
    pages: [page("curated-fonts", [interTrio]), page("google-fonts", [manrope])],
  });
  await render();

  await type("Inter");
  await settle();

  expect(searchAssets).toHaveBeenCalledWith(
    {
      query: "Inter",
      enabled: ["curated-fonts", "google-fonts"],
      pages: { "curated-fonts": 1, "google-fonts": 1 },
      body: "font-picker",
    },
    undefined,
  );
  expect(document.querySelector("[data-yunari-font-grid]")).not.toBeNull();
  expect(tiles("trio").map((tile) => tile.getAttribute("data-yunari-font-tile"))).toEqual([
    interTrio.id,
  ]);
  expect(tiles("family").map((tile) => tile.getAttribute("data-yunari-font-tile"))).toEqual([
    manrope.id,
  ]);
  // One badge per tile, named by the host's own label for the source.
  expect(tiles("trio")[0]?.textContent).toContain("Curated fonts");
  expect(tiles("family")[0]?.textContent).toContain("Google Fonts");

  press(`[data-yunari-font-tile="${interTrio.id}"]`);
  expect(tiles("trio")[0]?.getAttribute("aria-selected")).toBe("true");
});

it("asks the next page and appends it", async () => {
  searchAssets.mockResolvedValueOnce({
    pages: [
      page("curated-fonts", [interTrio]),
      page("google-fonts", [manrope], { totalPages: 2 }),
    ],
  });
  await render();
  await type("sans");
  await settle();
  expect(tiles()).toHaveLength(2);

  searchAssets.mockResolvedValueOnce({
    pages: [
      page("curated-fonts", [interTrio]),
      page("google-fonts", [sora], { totalPages: 2 }),
    ],
  });
  press("[data-yunari-font-load-more]");
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  // Only the source that says it has another page is asked; its rows append.
  expect(searchAssets).toHaveBeenLastCalledWith(
    expect.objectContaining({ pages: { "google-fonts": 2 } }),
    undefined,
  );
  expect(tiles()).toHaveLength(3);
  expect(document.querySelector("[data-yunari-font-load-more]")).toBeNull();
});

it("filters to trios or families without re-searching", async () => {
  searchAssets.mockResolvedValue({
    pages: [page("curated-fonts", [interTrio]), page("google-fonts", [manrope])],
  });
  await render();
  await type("Inter");
  await settle();

  const asked = searchAssets.mock.calls.length;
  press('[data-yunari-font-filter="trio"]');
  expect(searchAssets).toHaveBeenCalledTimes(asked);
  expect(tiles("trio")).toHaveLength(1);
  expect(tiles("family")).toHaveLength(0);

  press('[data-yunari-font-filter="family"]');
  expect(searchAssets).toHaveBeenCalledTimes(asked);
  expect(tiles("trio")).toHaveLength(0);
  expect(tiles("family")).toHaveLength(1);

  press('[data-yunari-font-filter="all"]');
  expect(tiles()).toHaveLength(2);
});

it("keeps the previous results when a source fails", async () => {
  searchAssets.mockResolvedValueOnce({
    pages: [page("curated-fonts", [interTrio]), page("google-fonts", [manrope])],
  });
  await render();
  await type("Inter");
  await settle();
  expect(tiles()).toHaveLength(2);

  searchAssets.mockResolvedValueOnce({
    pages: [
      page("curated-fonts", [sora]),
      page("google-fonts", [], {
        failure: { reason: "failed", message: "the registry is down" },
      }),
    ],
  });
  await type("Sora");
  await settle();

  // The failed source keeps the rows already drawn; the live one is redrawn.
  // A–Z across the mixed grid: the live source's Sora follows the kept Manrope.
  expect(tiles().map((tile) => tile.getAttribute("data-yunari-font-tile"))).toEqual([
    manrope.id,
    sora.id,
  ]);
  expect(
    document.querySelector('[data-yunari-font-failure="google-fonts"]')
      ?.textContent,
  ).toContain("Google Fonts failed");
});

it("does not send an empty term", async () => {
  await render();
  await settle();

  expect(searchAssets).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain(uiCopy.assets.fontEmptyQuery);

  await type("   ");
  await settle();
  expect(searchAssets).not.toHaveBeenCalled();
});

it("moves focus with the arrow keys inside the grid", () => {
  const results = [
    interTrio,
    manrope,
    sora,
    familyResult("google-fonts", "Inter Tight"),
  ];
  mount(
    <FontGrid
      results={results}
      selectedId={interTrio.id}
      onSelect={() => {}}
      providers={{ "curated-fonts": "Curated fonts", "google-fonts": "Google Fonts" }}
    />,
  );

  const drawn = [...document.querySelectorAll<HTMLElement>("[data-yunari-font-tile]")];
  drawn[0]?.focus();
  act(() => {
    drawn[0]?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
  });
  expect(document.activeElement).toBe(drawn[1]);

  act(() => {
    drawn[1]?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
  });
  expect(document.activeElement).toBe(drawn[3]);
});
