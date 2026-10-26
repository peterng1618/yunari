// @vitest-environment jsdom

import type {
  AssetPage,
  AssetResult,
  AssetSearchAnswer,
  AssetSourceListing,
} from "@yunari/renderer-core";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uiCopy } from "../ui-copy.js";
import * as client from "./client.js";
import { AssetFinder, SEARCH_DEBOUNCE_MS } from "./modal.js";

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

const lucide: AssetSourceListing = {
  id: "lucide",
  label: "Lucide",
  category: "icon",
  body: "grid",
  requires: null,
  configurable: true,
  presetKind: null,
  host: null,
};

const fontAwesome: AssetSourceListing = {
  id: "fontawesome-free",
  label: "Font Awesome Free",
  category: "icon",
  body: "grid",
  requires: null,
  configurable: true,
  presetKind: null,
  host: null,
};

const unsplash: AssetSourceListing = {
  id: "unsplash",
  label: "Unsplash",
  category: "image",
  body: "grid",
  requires: "unsplash",
  configurable: true,
  presetKind: null,
  host: "api.unsplash.com",
};

const colorhunt: AssetSourceListing = {
  id: "colorhunt",
  label: "Color Hunt",
  category: "colour",
  body: "grid",
  requires: null,
  configurable: true,
  presetKind: "palette",
  host: "colorhunt.co",
};

const colorswoop: AssetSourceListing = {
  id: "colorswoop",
  label: "ColorSwoop",
  category: "colour",
  body: "grid",
  requires: null,
  configurable: true,
  presetKind: "palette",
  host: "colorswoop.com",
};

const uigradients: AssetSourceListing = {
  id: "uigradients",
  label: "UI Gradients",
  category: "colour",
  body: "grid",
  requires: null,
  configurable: true,
  presetKind: "gradient",
  host: "raw.githubusercontent.com",
};

const webgradients: AssetSourceListing = {
  id: "webgradients",
  label: "Web Gradients",
  category: "colour",
  body: "grid",
  requires: null,
  configurable: true,
  presetKind: "gradient",
  host: "raw.githubusercontent.com",
};

const curatedFonts: AssetSourceListing = {
  id: "curated-fonts",
  label: "Curated fonts",
  category: "font",
  body: "font-picker",
  requires: null,
  configurable: true,
  presetKind: null,
  host: null,
};

const wallpaperEngine: AssetSourceListing = {
  id: "wallpaper-engine",
  label: "Wallpaper Engine",
  category: "local",
  body: "wallpaper-engine",
  requires: null,
  configurable: false,
  presetKind: null,
  host: null,
};

const result = (id: string): AssetResult => ({
  id,
  name: id,
  kind: "icon",
  preview: "",
  subtitle: undefined,
  licence: "ISC",
  sourceUrl: "",
});

const page = (
  source: string,
  results: readonly AssetResult[] = [],
  extra: Partial<AssetPage> = {},
): AssetPage => ({
  source,
  results,
  totalPages: undefined,
  failure: undefined,
  ...extra,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

let root: HTMLDivElement | undefined;
let container: Root | undefined;

async function settle(): Promise<void> {
  await act(async () => {
    for (let pass = 0; pass < 5; pass += 1) {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 1);
      await Promise.resolve();
      await Promise.resolve();
    }
  });
}

async function render(
  sources: readonly AssetSourceListing[],
  props: Partial<Parameters<typeof AssetFinder>[0]> = {},
  listing: Awaited<ReturnType<typeof client.listSources>> = {
    ok: true,
    sources,
  },
): Promise<void> {
  listSources.mockResolvedValue(listing);
  root = document.createElement("div");
  document.body.append(root);
  container = createRoot(root);

  await act(async () => {
    container?.render(finder(props));
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => {
    for (let pass = 0; pass < 3; pass += 1) {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    }
  });
}

/** The same instance with new props, so a case can close and reopen it. */
async function rerender(
  props: Partial<Parameters<typeof AssetFinder>[0]>,
): Promise<void> {
  await act(async () => {
    container?.render(finder(props));
    await Promise.resolve();
  });
  await act(async () => {
    for (let pass = 0; pass < 3; pass += 1) {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    }
  });
}

function finder(
  props: Partial<Parameters<typeof AssetFinder>[0]>,
): ReactElement {
  return (
    <AssetFinder
      open
      onOpenChange={() => {}}
      bodies={{
        "font-picker": <p data-yunari-asset-body="font-picker">faces</p>,
        "wallpaper-engine": (
          <p data-yunari-asset-body="wallpaper-engine">scenes</p>
        ),
      }}
      onAction={async () => ({ ok: true })}
      {...props}
    />
  );
}

function tab(value: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(
    `[data-yunari-asset-tab="${value}"]`,
  );
  if (found === null) throw new Error(`no ${value} tab.`);
  return found;
}

function input(): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>(
    "[data-yunari-asset-search]",
  );
  if (found === null) throw new Error("no search input.");
  return found;
}

async function type(value: string): Promise<void> {
  const field = input();
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function rowIds(): string[] {
  return [...document.querySelectorAll("[data-yunari-asset-row]")].map(
    (row) => row.getAttribute("data-yunari-asset-row") ?? "",
  );
}

function footerAction(): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(
    "[data-yunari-asset-action]",
  );
  if (found === null) throw new Error("no footer action.");
  return found;
}

function pageButton(page: number): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(
    `[data-yunari-asset-page="${page}"]`,
  );
  if (found === null) throw new Error(`no page ${page}.`);
  return found;
}

function kindButton(kind: string): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(
    `[data-yunari-asset-kind="${kind}"]`,
  );
  if (found === null) throw new Error(`no ${kind} kind.`);
  return found;
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  listSources.mockReset();
  searchAssets.mockReset();
  searchAssets.mockResolvedValue({ pages: [] });
});

afterEach(async () => {
  await act(async () => container?.unmount());
  root?.remove();
  root = undefined;
  container = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AssetFinder tabs", () => {
  it("derives one tab per category, in registry order", async () => {
    await render([lucide, curatedFonts, wallpaperEngine]);
    await settle();

    const tabs = [...document.querySelectorAll("[data-yunari-asset-tab]")].map(
      (element) => element.getAttribute("data-yunari-asset-tab"),
    );
    expect(tabs).toEqual(["icon", "font", "local"]);
    expect(tab("icon").textContent).toContain(uiCopy.assets.category.icon);
    expect(tab("local").textContent).toContain(uiCopy.assets.category.local);
  });

  it("opens on the category a caller asked for", async () => {
    // The font field's button opens the finder on Fonts, so the modal honours
    // `initialCategory` over the listing's own first entry.
    await render([lucide, curatedFonts], { initialCategory: "font" });
    await settle();

    expect(tab("font").getAttribute("aria-selected")).toBe("true");
    expect(
      document.querySelector('[data-yunari-asset-body="font-picker"]'),
    ).not.toBeNull();
  });

  it("reopens on the category a caller asks for, after an earlier open", async () => {
    // The font field's button must land on Fonts even when the finder has been
    // opened before: the selection is kept for a plain reopen, not over a
    // caller that names a category.
    await render([lucide, curatedFonts]);
    await settle();
    expect(tab("icon").getAttribute("aria-selected")).toBe("true");

    await rerender({ open: false });
    await rerender({ open: true, initialCategory: "font" });

    expect(tab("font").getAttribute("aria-selected")).toBe("true");
  });

  it("says the host is absent rather than drawing a blank dialog", async () => {
    await render([], {}, { ok: false });

    expect(
      document.querySelector("[data-yunari-asset-host-failure]")?.textContent,
    ).toContain(uiCopy.assets.hostUnavailable);
  });

  it("renders a body-only category's body and no chips", async () => {
    await render([curatedFonts]);
    await settle();

    expect(
      document.querySelector('[data-yunari-asset-body="font-picker"]'),
    ).not.toBeNull();
    expect(document.querySelector("[data-yunari-asset-chip]")).toBeNull();
    expect(searchAssets).not.toHaveBeenCalled();
  });
});

describe("AssetFinder chips", () => {
  it("draws no chip row for one source", async () => {
    await render([lucide]);
    await settle();

    expect(document.querySelector("[data-yunari-asset-chip]")).toBeNull();
  });

  it("still switches a chip where the browser refuses storage", async () => {
    // A private window's store can throw on write; the chip is the author's
    // choice for this session either way, and an unhandled throw in an effect
    // would take the modal with it.
    const deny = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("storage denied");
      });

    await render([lucide, fontAwesome]);
    await settle();

    const chip = document.querySelector<HTMLButtonElement>(
      '[data-yunari-asset-chip="lucide"]',
    );
    if (chip === null) throw new Error("no Lucide chip.");
    await act(async () => chip.click());
    await settle();

    expect(chip.getAttribute("aria-pressed")).toBe("false");
    deny.mockRestore();
  });

  it("searches without a source whose chip is switched off", async () => {
    await render([lucide, fontAwesome]);
    await settle();
    searchAssets.mockClear();

    const chip = document.querySelector<HTMLButtonElement>(
      '[data-yunari-asset-chip="fontawesome-free"]',
    );
    if (chip === null) throw new Error("no Font Awesome chip.");
    await act(async () => chip.click());
    await settle();

    expect(searchAssets).toHaveBeenCalledTimes(1);
    expect(searchAssets.mock.calls[0]?.[0]).toMatchObject({
      enabled: ["lucide"],
    });
  });
});

describe("AssetFinder's Colours tab", () => {
  it("draws the Colours tab and asks only the kind's sources", async () => {
    await render([colorhunt, colorswoop, uigradients, webgradients]);
    await settle();

    await act(async () => tab("colour").click());
    searchAssets.mockClear();
    await act(async () => kindButton("palette").click());
    await settle();

    expect(searchAssets.mock.calls.at(-1)?.[0]?.enabled).toEqual([
      "colorhunt",
      "colorswoop",
    ]);
  });

  it("keeps a switched-off source off when the kind filter returns to all", async () => {
    await render([colorhunt, colorswoop, uigradients, webgradients]);
    await settle();

    const chip = document.querySelector<HTMLButtonElement>(
      '[data-yunari-asset-chip="colorswoop"]',
    );
    if (chip === null) throw new Error("no ColorSwoop chip.");
    await act(async () => chip.click());
    await settle();

    await act(async () => kindButton("gradient").click());
    await settle();
    await act(async () => kindButton("all").click());
    await settle();

    // The chip's persisted choice is intersected with the filter, never
    // rewritten by it.
    expect(searchAssets.mock.calls.at(-1)?.[0]?.enabled).toEqual([
      "colorhunt",
      "uigradients",
      "webgradients",
    ]);
  });

  it("says a kind's sources are all switched off rather than no results", async () => {
    await render([colorhunt, colorswoop, uigradients, webgradients]);
    await settle();

    for (const id of ["uigradients", "webgradients"]) {
      const chip = document.querySelector<HTMLButtonElement>(
        `[data-yunari-asset-chip="${id}"]`,
      );
      if (chip === null) throw new Error(`no ${id} chip.`);
      await act(async () => chip.click());
      await settle();
    }

    // The kind-off state has no question to ask: choosing it must not issue an
    // empty search and then blame the author's query.
    searchAssets.mockClear();
    await act(async () => kindButton("gradient").click());
    await settle();

    expect(searchAssets).not.toHaveBeenCalled();
    expect(
      document.querySelector("[data-yunari-asset-kind-off]")?.textContent,
    ).toContain(uiCopy.assets.kindSourcesOff);
    expect(document.querySelector("[data-yunari-asset-grid]")).toBeNull();
    expect(document.querySelector("[data-yunari-asset-empty]")).toBeNull();
  });

  it("advances a lone palette source to the page the feed says exists", async () => {
    // Color Hunt cannot say how many pages there are, but a full page does prove
    // the next one exists; without a second source the pager is still the way
    // there.
    searchAssets.mockResolvedValue({
      pages: [
        page(
          "colorhunt",
          Array.from({ length: 40 }, (_, at) => result(`colorhunt:${at}`)),
          { totalPages: 2 },
        ),
      ],
    });

    await render([colorhunt]);
    await settle();

    expect(
      document.querySelector("[data-yunari-asset-page-next]"),
    ).not.toBeNull();
    await act(async () => pageButton(2).click());
    await settle();

    expect(searchAssets.mock.calls.at(-1)?.[0]?.pages).toEqual({
      colorhunt: 2,
    });
  });

  it("draws no palette chip while the Gradients filter is active", async () => {
    await render([colorhunt, colorswoop, uigradients, webgradients]);
    await settle();

    await act(async () => kindButton("gradient").click());
    await settle();

    expect(
      document.querySelector('[data-yunari-asset-chip="colorhunt"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-yunari-asset-chip="colorswoop"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-yunari-asset-chip="uigradients"]'),
    ).not.toBeNull();
  });

  it("shows a preset's licence and hides an icon's", async () => {
    const palette: AssetResult = {
      ...result("colorhunt:abc"),
      kind: "palette",
      subtitle: "50 likes",
      licence: "unknown",
      preset: {
        kind: "palette",
        colours: ["rgb(17, 34, 51)", "rgb(68, 85, 102)"],
      },
    };
    searchAssets.mockResolvedValue({
      pages: [
        page("colorhunt", [palette]),
        page("lucide", [result("lucide:house")]),
      ],
    });

    await render([colorhunt, lucide]);
    await settle();

    const licence = document.querySelector(
      '[data-yunari-asset-row="colorhunt:abc"] [data-yunari-asset-licence]',
    );
    expect(licence?.textContent).toBe("unknown");
    expect(
      document.querySelector('[data-yunari-asset-row="colorhunt:abc"]')
        ?.textContent,
    ).toContain("50 likes · unknown");

    await act(async () => tab("icon").click());
    await settle();

    expect(
      document.querySelector(
        '[data-yunari-asset-row="lucide:house"] [data-yunari-asset-licence]',
      ),
    ).toBeNull();
    expect(
      document.querySelector('[data-yunari-asset-row="lucide:house"]')
        ?.textContent,
    ).not.toContain("ISC");
  });

  it("clears a success sentence when the question changes", async () => {
    const palette: AssetResult = {
      ...result("colorhunt:abc"),
      kind: "palette",
      licence: "unknown",
      preset: {
        kind: "palette",
        colours: ["rgb(17, 34, 51)", "rgb(68, 85, 102)"],
      },
    };
    searchAssets.mockResolvedValue({
      pages: [page("colorhunt", [palette])],
    });
    const onAction = vi.fn(
      async () => ({ ok: true, message: "Added 2 colours" }) as const,
    );

    await render([colorhunt], { onAction });
    await settle();

    const row = document.querySelector<HTMLElement>(
      '[data-yunari-asset-row="colorhunt:abc"]',
    );
    await act(async () => row?.click());
    await act(async () => footerAction().click());
    await settle();

    expect(
      document.querySelector("[data-yunari-asset-message]")?.textContent,
    ).toBe("Added 2 colours");

    await type("blue");
    await settle();

    // The sentence answered the palette just added; a new question has not
    // been answered yet, so it cannot sit beside its count.
    expect(document.querySelector("[data-yunari-asset-message]")).toBeNull();
  });

  it("returns the kind filter to all when the tab changes", async () => {
    await render([colorhunt, uigradients, unsplash]);
    await settle();

    await act(async () => kindButton("gradient").click());
    await settle();
    expect(kindButton("gradient").getAttribute("aria-pressed")).toBe("true");

    await act(async () => tab("image").click());
    await settle();
    await act(async () => tab("colour").click());
    await settle();

    expect(kindButton("all").getAttribute("aria-pressed")).toBe("true");
    expect(kindButton("gradient").getAttribute("aria-pressed")).toBe("false");
  });

  it("draws a palette as swatches and a gradient as a strip", async () => {
    const palette: AssetResult = {
      id: "colorhunt:aabbccddeeff112233445566",
      name: "Color Hunt AABBCC",
      kind: "palette",
      preview: "",
      subtitle: undefined,
      licence: "unknown",
      sourceUrl: "https://colorhunt.co/palette/aabbccddeeff112233445566",
      preset: {
        kind: "palette",
        colours: [
          "rgb(170, 187, 204)",
          "rgb(221, 238, 255)",
          "rgb(17, 34, 51)",
          "rgb(68, 85, 102)",
        ],
      },
    };
    const fiveColourPalette: AssetResult = {
      id: "colorhunt:112233445566778899aabbcc",
      name: "Color Hunt 112233",
      kind: "palette",
      preview: "",
      subtitle: undefined,
      licence: "unknown",
      sourceUrl: "https://colorhunt.co/palette/112233445566778899aabbcc",
      preset: {
        kind: "palette",
        colours: [
          "rgb(17, 17, 17)",
          "rgb(34, 34, 34)",
          "rgb(51, 51, 51)",
          "rgb(68, 68, 68)",
          "rgb(85, 85, 85)",
        ],
      },
    };
    const gradient: AssetResult = {
      id: "uigradients:3",
      name: "Mango",
      kind: "gradient",
      preview: "",
      subtitle: undefined,
      licence: "MIT",
      sourceUrl: "https://github.com/ghosh/uiGradients",
      preset: {
        kind: "gradient",
        angle: 30,
        stops: [
          { offset: 0, color: "rgb(0, 0, 0)" },
          { offset: 1, color: "rgb(255, 255, 255)" },
        ],
      },
    };
    searchAssets.mockResolvedValue({
      pages: [
        page("colorhunt", [palette, fiveColourPalette]),
        page("uigradients", [gradient]),
      ],
    });

    await render([colorhunt, uigradients]);
    await settle();

    const paletteRow = document.querySelector(
      '[data-yunari-asset-row="colorhunt:aabbccddeeff112233445566"]',
    );
    expect(paletteRow?.querySelectorAll("[data-yunari-swatch]")).toHaveLength(
      4,
    );
    // A fifth colour is stored with the preset but not drawn: the preview is
    // always the same 2×2 block.
    const fiveColourRow = document.querySelector(
      '[data-yunari-asset-row="colorhunt:112233445566778899aabbcc"]',
    );
    expect(
      fiveColourRow?.querySelectorAll("[data-yunari-swatch]"),
    ).toHaveLength(4);

    const strip = document.querySelector<HTMLElement>(
      '[data-yunari-asset-row="uigradients:3"] [data-yunari-asset-preview="gradient"]',
    );
    expect(strip).not.toBeNull();
    // jsdom may keep the shorthand as an attribute rather than a parsed
    // `background-image`, so both readings are the same evidence.
    expect(
      strip?.style.backgroundImage || strip?.getAttribute("style") || "",
    ).toContain("linear-gradient(60deg");
    expect(strip?.getAttribute("style") ?? "").toContain("rgb(0, 0, 0) 0%");
  });
});

describe("AssetFinder search", () => {
  it("issues one search for a burst of keystrokes", async () => {
    await render([lucide]);
    await settle();
    searchAssets.mockClear();

    await type("ho");
    await type("hou");
    await settle();

    expect(searchAssets).toHaveBeenCalledTimes(1);
    expect(searchAssets.mock.calls[0]?.[0]?.query).toBe("hou");
  });

  it("renders the newer query when answers arrive in reverse", async () => {
    const older = deferred<AssetSearchAnswer>();
    const newer = deferred<AssetSearchAnswer>();
    searchAssets
      .mockResolvedValueOnce({ pages: [] })
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);

    await render([lucide]);
    await settle();

    await type("a");
    await settle();
    await type("b");
    await settle();

    await act(async () => {
      void newer.resolve({ pages: [page("lucide", [result("lucide:newer")])] });
      await Promise.resolve();
    });
    await act(async () => {
      void older.resolve({ pages: [page("lucide", [result("lucide:older")])] });
      await Promise.resolve();
    });

    expect(rowIds()).toEqual(["lucide:newer"]);
  });

  it("names every source's failure and never reads as no results", async () => {
    searchAssets.mockResolvedValue({
      pages: [
        page("lucide", [], {
          failure: { reason: "failed", message: "Lucide answered 500." },
        }),
        page("fontawesome-free", [], {
          failure: { reason: "failed", message: "Font Awesome answered 502." },
        }),
      ],
    });

    await render([lucide, fontAwesome]);
    await settle();

    const sentences = [
      ...document.querySelectorAll("[data-yunari-asset-failure]"),
    ].map((node) => node.textContent ?? "");
    expect(sentences.join(" ")).toContain("Lucide answered 500.");
    expect(sentences.join(" ")).toContain("Font Awesome answered 502.");
    expect(document.querySelector("[data-yunari-asset-empty]")).toBeNull();
  });

  it("names the host on the first search that reaches one, not before", async () => {
    // A search that contacted no host is not the disclosure: a person is told
    // before their term leaves, which is the Images tab's first search.
    searchAssets.mockResolvedValue({ pages: [] });

    await render([lucide, unsplash]);
    await settle();
    expect(
      document.querySelector("[data-yunari-asset-host-notice]"),
    ).toBeNull();

    await act(async () => tab("image").click());
    await settle();

    expect(
      document.querySelector("[data-yunari-asset-host-notice]")?.textContent,
    ).toContain("api.unsplash.com");
  });

  it("asks every enabled source for the page the pager shows", async () => {
    searchAssets
      .mockResolvedValueOnce({
        pages: [
          page("lucide", [result("lucide:a")], { totalPages: 2 }),
          page("fontawesome-free", [result("fontawesome-free:b")], {
            totalPages: 2,
          }),
        ],
      })
      .mockResolvedValueOnce({
        pages: [
          page("lucide", [result("lucide:c")], { totalPages: 2 }),
          page("fontawesome-free", [result("fontawesome-free:d")], {
            totalPages: 2,
          }),
        ],
      });

    await render([lucide, fontAwesome]);
    await settle();

    expect(searchAssets.mock.calls[0]?.[0]?.pages).toEqual({
      lucide: 1,
      "fontawesome-free": 1,
    });

    await act(async () => pageButton(2).click());
    await settle();

    expect(searchAssets.mock.calls[1]?.[0]?.pages).toEqual({
      lucide: 2,
      "fontawesome-free": 2,
    });
    // A page replaces the one before it: the grid never shows two pages at once.
    expect(rowIds()).toEqual(["lucide:c", "fontawesome-free:d"]);
  });

  it("returns to the first page when the question changes", async () => {
    searchAssets.mockResolvedValue({
      pages: [page("lucide", [result("lucide:a")], { totalPages: 3 })],
    });

    await render([lucide]);
    await settle();
    await act(async () => pageButton(3).click());
    await settle();

    expect(document.querySelector("[aria-current='page']")?.textContent).toBe(
      "3",
    );

    await type("house");
    await settle();

    expect(searchAssets.mock.calls.at(-1)?.[0]?.pages).toEqual({ lucide: 1 });
  });

  it("prints the result's own second word, which distinguishes a style or an author", async () => {
    searchAssets.mockResolvedValue({
      pages: [
        page("fontawesome-free", [
          { ...result("fontawesome-free:house"), subtitle: "solid" },
        ]),
      ],
    });

    await render([fontAwesome]);
    await settle();

    expect(
      document.querySelector("[data-yunari-asset-row]")?.textContent,
    ).toContain("solid");
  });

  it("draws a failed page's sentence and keeps the other source's rows", async () => {
    searchAssets.mockResolvedValue({
      pages: [
        page("lucide", [], {
          failure: { reason: "failed", message: "Lucide answered 500." },
        }),
        page("fontawesome-free", [result("fontawesome-free:house")]),
      ],
    });

    await render([lucide, fontAwesome]);
    await settle();

    expect(
      document.querySelector("[data-yunari-asset-failure]")?.textContent,
    ).toContain("Lucide answered 500.");
    expect(rowIds()).toEqual(["fontawesome-free:house"]);
  });

  it("offers Connections instead of rows when a source needs a key", async () => {
    searchAssets.mockResolvedValue({
      pages: [
        page("unsplash", [], {
          failure: { reason: "needs-credential", credential: "unsplash" },
        }),
      ],
    });
    const onOpenConnections = vi.fn();

    await render([unsplash], { onOpenConnections });
    await settle();

    expect(rowIds()).toEqual([]);
    const link = document.querySelector<HTMLButtonElement>(
      "[data-yunari-asset-connections]",
    );
    if (link === null) throw new Error("no Connections link.");
    expect(link.textContent).toContain(uiCopy.assets.connectionsAction);
    await act(async () => link.click());
    expect(onOpenConnections).toHaveBeenCalledTimes(1);
  });

  it("draws no-results with a control that clears the query", async () => {
    await render([lucide]);
    await settle();
    await type("zzz");
    await settle();
    searchAssets.mockClear();

    expect(
      document.querySelector("[data-yunari-asset-empty]")?.textContent,
    ).toContain(uiCopy.assets.noResults);

    const clear = document.querySelector<HTMLButtonElement>(
      "[data-yunari-asset-clear-query]",
    );
    if (clear === null) throw new Error("no clear control.");
    await act(async () => clear.click());

    expect(input().value).toBe("");
    await settle();
    expect(searchAssets.mock.calls.at(-1)?.[0]?.query).toBe("");
  });
});

describe("AssetFinder's mixed grid", () => {
  it("alternates two sources' first pages, each row naming its source", async () => {
    searchAssets.mockResolvedValue({
      pages: [
        page("lucide", [result("lucide:a"), result("lucide:c")]),
        page("fontawesome-free", [result("fontawesome-free:b")]),
      ],
    });

    await render([lucide, fontAwesome]);
    await settle();

    expect(rowIds()).toEqual(["lucide:a", "fontawesome-free:b", "lucide:c"]);
    // The source is a mark, named for a screen reader and never a licence word.
    expect(
      document
        .querySelector('[data-yunari-asset-row="fontawesome-free:b"]')
        ?.querySelector('[data-yunari-asset-source="fontawesome-free"]')
        ?.getAttribute("aria-label"),
    ).toBe("Font Awesome Free");
    expect(document.body.textContent).not.toContain("ISC");
  });

  it("keeps two sources' identical ids apart", async () => {
    searchAssets.mockResolvedValue({
      pages: [
        page("lucide", [result("lucide:x")]),
        page("fontawesome-free", [result("fontawesome-free:x")]),
      ],
    });

    await render([lucide, fontAwesome]);
    await settle();

    expect(rowIds()).toEqual(["lucide:x", "fontawesome-free:x"]);
  });

  it("clamps a page the answer no longer reaches", async () => {
    // Page one says there are two pages; page two's own answer says one. Rather
    // than leave an empty grid under a numeral nothing reaches, the pager lands
    // on the last page the answer has.
    searchAssets.mockImplementation(async (request) =>
      request.pages["lucide"] === 2
        ? {
            pages: [page("lucide", [result("lucide:only")], { totalPages: 1 })],
          }
        : { pages: [page("lucide", [result("lucide:a")], { totalPages: 2 })] },
    );

    await render([lucide]);
    await settle();
    await act(async () => pageButton(2).click());
    await settle();
    // The clamp's own answer is a second request, after React flushes the page
    // it moved to.
    await settle();

    // It lands back on page one and asks for it, rather than sitting on a page
    // no answer has.
    expect(document.querySelector("[aria-current='page']")?.textContent).toBe(
      "1",
    );
    expect(rowIds()).toEqual(["lucide:a"]);
    expect(searchAssets.mock.calls.at(-1)?.[0]?.pages).toEqual({ lucide: 1 });
  });

  it("names the host once, on the first search only", async () => {
    searchAssets.mockResolvedValue({
      pages: [page("unsplash", [result("unsplash:one")])],
    });

    await render([unsplash]);
    await settle();

    expect(
      document.querySelector("[data-yunari-asset-host-notice]")?.textContent,
    ).toContain("api.unsplash.com");

    await type("x");
    await settle();

    expect(
      document.querySelector("[data-yunari-asset-host-notice]"),
    ).toBeNull();
  });

  it("discards a source disabled mid-flight", async () => {
    const late = deferred<AssetSearchAnswer>();

    await render([lucide, fontAwesome]);
    await settle();

    searchAssets.mockReturnValueOnce(late.promise);
    await type("a");
    await settle();

    const chip = document.querySelector<HTMLButtonElement>(
      '[data-yunari-asset-chip="fontawesome-free"]',
    );
    if (chip === null) throw new Error("no chip.");
    await act(async () => chip.click());

    await act(async () => {
      void late.resolve({
        pages: [
          page("lucide", [result("lucide:a")]),
          page("fontawesome-free", [result("fontawesome-free:x")]),
        ],
      });
      await Promise.resolve();
    });

    expect(rowIds()).not.toContain("fontawesome-free:x");
  });
});

describe("AssetFinder footer", () => {
  it("names the action the active category offers, never a bare Import", async () => {
    await render([lucide, unsplash]);
    await settle();

    expect(footerAction().textContent).toBe(uiCopy.assets.action.icon);
    expect(footerAction().textContent).not.toBe("Import");

    await act(async () => tab("image").click());
    await settle();

    expect(footerAction().textContent).toBe(uiCopy.assets.action.image);
  });

  it("offers an image a second action that places it on the canvas", async () => {
    const onAction = vi.fn(async () => ({ ok: true }) as const);
    searchAssets.mockResolvedValue({
      pages: [
        page("unsplash", [
          {
            ...result("unsplash:photo"),
            kind: "image",
            preview: "https://images.unsplash.com/photo-small",
          },
        ]),
      ],
    });

    await render([unsplash], { onAction, initialCategory: "image" });
    await settle();

    const row = document.querySelector<HTMLElement>(
      '[data-yunari-asset-row="unsplash:photo"]',
    );
    await act(async () => row?.click());

    const place = document.querySelector<HTMLButtonElement>(
      "[data-yunari-asset-place]",
    );
    expect(place?.textContent).toBe(uiCopy.assets.placeOnCanvas);

    await act(async () => place?.click());
    await settle();

    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ source: "unsplash" }),
      expect.objectContaining({ id: "unsplash:photo" }),
      "place",
    );
  });
});

describe("AssetFinder's own controls", () => {
  it("offers a way out for a screen with no Escape key", async () => {
    const onOpenChange = vi.fn();
    await render([lucide], { onOpenChange });
    await settle();

    const close = document.querySelector<HTMLButtonElement>(
      `button[aria-label="${uiCopy.assets.close}"]`,
    );
    expect(close).not.toBeNull();
    // It is a mark, not the word: the window has no title bar to put one in.
    expect(close?.textContent).toBe("");
    await act(async () => close?.click());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("marks the chosen row, not only the press that chose it", async () => {
    await render([lucide]);
    searchAssets.mockResolvedValue({
      pages: [page("lucide", [result("lucide:house"), result("lucide:cat")])],
    });
    await settle();

    const house = document.querySelector<HTMLElement>(
      '[data-yunari-asset-row="lucide:house"]',
    );
    const cat = document.querySelector<HTMLElement>(
      '[data-yunari-asset-row="lucide:cat"]',
    );
    expect(house?.className).not.toContain("border-accent");

    await act(async () => house?.click());

    expect(house?.getAttribute("aria-pressed")).toBe("true");
    expect(house?.className).toContain("border-accent");
    expect(cat?.className).not.toContain("border-accent");
  });

  it("draws the grid skeleton while the source listing is out, and none once it answers", async () => {
    const listing = deferred<Awaited<ReturnType<typeof client.listSources>>>();
    listSources.mockReturnValueOnce(listing.promise);
    await render([lucide]);

    expect(
      document.querySelector("[data-yunari-skeleton-grid]"),
    ).not.toBeNull();
    expect(document.querySelector("[data-yunari-asset-grid]")).toBeNull();

    await act(async () => {
      void listing.resolve({ ok: true, sources: [lucide] });
      await Promise.resolve();
      await Promise.resolve();
    });
    await settle();

    expect(document.querySelector("[data-yunari-skeleton-grid]")).toBeNull();
    expect(tab("icon").getAttribute("aria-selected")).toBe("true");
  });

  it("draws the grid skeleton for a search with no prior answer", async () => {
    const pending = deferred<AssetSearchAnswer>();
    searchAssets.mockReturnValueOnce(pending.promise);
    await render([lucide]);
    await settle();

    expect(
      document.querySelector("[data-yunari-skeleton-grid]"),
    ).not.toBeNull();
    expect(document.querySelector("[data-yunari-asset-grid]")).toBeNull();

    await act(async () => {
      void pending.resolve({
        pages: [page("lucide", [result("lucide:house")])],
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelector("[data-yunari-skeleton-grid]")).toBeNull();
    expect(rowIds()).toEqual(["lucide:house"]);
  });

  it("keeps the results on screen and marks the grid busy while another page loads", async () => {
    searchAssets.mockResolvedValue({
      pages: [page("lucide", [result("lucide:house")], { totalPages: 2 })],
    });
    await render([lucide]);
    await settle();
    expect(rowIds()).toEqual(["lucide:house"]);

    const pending = deferred<AssetSearchAnswer>();
    searchAssets.mockReturnValueOnce(pending.promise);
    await act(async () => pageButton(2).click());

    // The page's own rows stay: pagination is a slice of an answer, not a
    // first load, so only the region says it is busy.
    expect(rowIds()).toEqual(["lucide:house"]);
    expect(
      document
        .querySelector("[data-yunari-asset-grid]")
        ?.getAttribute("aria-busy"),
    ).toBe("true");
    expect(document.querySelector("[data-yunari-skeleton-grid]")).toBeNull();

    // Let the debounce fire, so the page's request is the pending one.
    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 1);
      await Promise.resolve();
    });

    await act(async () => {
      void pending.resolve({
        pages: [page("lucide", [result("lucide:star")], { totalPages: 2 })],
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rowIds()).toEqual(["lucide:star"]);
    expect(
      document
        .querySelector("[data-yunari-asset-grid]")
        ?.getAttribute("aria-busy"),
    ).toBeNull();
  });

  it("draws an icon as the theme's own ink and a photo as a picture", async () => {
    await render([lucide, unsplash]);
    searchAssets.mockResolvedValue({
      pages: [
        page("lucide", [
          {
            ...result("lucide:house"),
            preview: "data:image/svg+xml;base64,PHN2Zy8+",
          },
        ]),
      ],
    });
    await settle();

    expect(
      document.querySelector(
        '[data-yunari-asset-row="lucide:house"] [data-yunari-asset-preview="icon"]',
      ),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-yunari-asset-row="lucide:house"] img'),
    ).toBeNull();

    // The Images tab's own answer: a photo is a picture, never a mask.
    searchAssets.mockResolvedValue({
      pages: [
        page("unsplash", [
          {
            ...result("unsplash:photo"),
            kind: "image",
            preview: "https://images.unsplash.com/photo-small",
          },
        ]),
      ],
    });
    await act(async () => tab("image").click());
    await settle();

    expect(
      document.querySelector('[data-yunari-asset-row="unsplash:photo"] img'),
    ).not.toBeNull();
  });
});
