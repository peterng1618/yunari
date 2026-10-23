// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { uiCopy } from "../ui-copy.js";
import type { WallpaperEngineItem } from "../wallpaper-engine/client.js";
import { WallpaperEngineBody } from "./wallpaper-engine-body.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const items: readonly WallpaperEngineItem[] = [
  {
    workshopId: "201",
    title: "Rain on glass",
    kind: "image",
    previewUrl: "/api/wallpaper-engine/item/201/preview",
    filesize: 2_097_152,
    tags: [],
    stillAtRest: undefined,
    hasText: undefined,
    attribution: undefined,
  },
  {
    workshopId: "202",
    title: "Neon city",
    kind: "video",
    previewUrl: undefined,
    filesize: 12_582_912,
    tags: [],
    stillAtRest: undefined,
    hasText: undefined,
    attribution: undefined,
  },
  {
    workshopId: "203",
    title: "Clock page",
    kind: "web",
    previewUrl: undefined,
    filesize: 1_024,
    tags: [],
    stillAtRest: undefined,
    hasText: undefined,
    attribution: undefined,
  },
  {
    workshopId: "204",
    title: "Still lake",
    kind: "scene",
    previewUrl: undefined,
    filesize: 8_388_608,
    tags: [],
    stillAtRest: true,
    hasText: false,
    attribution: undefined,
  },
];

function listingFetcher(answer: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(answer), { status })) as typeof fetch;
}

const available = {
  available: true,
  install: "D:/Steam/wallpaper_engine",
  items,
  skipped: 0,
};

let host: HTMLDivElement | undefined;
let root: Root | undefined;

afterEach(async () => {
  const mounted = root;
  root = undefined;
  await act(async () => {
    mounted?.unmount();
  });
  host?.remove();
  host = undefined;
});

function importExport() {
  return vi.fn(async () => ({ ok: true as const, assetId: "a1" }));
}

async function render(
  props: Parameters<typeof WallpaperEngineBody>[0],
): Promise<HTMLDivElement> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<WallpaperEngineBody {...props} />);
  });
  // One microtask below the fetch's own settle, so the listing is rendered.
  await act(async () => {
    await Promise.resolve();
  });
  return host;
}

it("renders the host's absence reason, not an empty grid", async () => {
  const rendered = await render({
    onImport: vi.fn(async () => ({ ok: true as const })),
    onImportExport: importExport(),
    client: {
      fetch: listingFetcher({ available: false, reason: "no-library" }),
    },
  });

  expect(rendered.textContent).toContain(
    uiCopy.assets.wallpaperEngine.reason["no-library"],
  );
  expect(
    rendered.querySelectorAll("[data-yunari-wallpaper-engine-item]"),
  ).toHaveLength(0);
});

it("draws one row per item with its kind and size", async () => {
  const rendered = await render({
    onImport: vi.fn(async () => ({ ok: true as const })),
    onImportExport: importExport(),
    client: { fetch: listingFetcher(available) },
  });

  const rows = rendered.querySelectorAll<HTMLElement>(
    "[data-yunari-wallpaper-engine-item]",
  );
  expect(rows).toHaveLength(4);
  expect([...rows].map((row) => row.dataset.yunariWallpaperEngineItem)).toEqual(
    ["201", "202", "203", "204"],
  );

  const first = rows[0]?.textContent ?? "";
  expect(first).toContain("Rain on glass");
  expect(first).toContain(uiCopy.assets.wallpaperEngine.kind.image);
  expect(first).toContain(
    uiCopy.assets.wallpaperEngine.size(items[0]?.filesize ?? 0),
  );
  expect(rows[1]?.textContent).toContain(
    uiCopy.assets.wallpaperEngine.kind.video,
  );
});

it("imports an image item through the injected action", async () => {
  const onImport = vi.fn(async () => ({ ok: true as const }));
  const rendered = await render({
    onImport,
    onImportExport: importExport(),
    client: { fetch: listingFetcher(available) },
  });

  const button = rendered.querySelector<HTMLButtonElement>(
    "[data-yunari-wallpaper-engine-item='201'] [data-yunari-wallpaper-engine-import]",
  );
  expect(button).not.toBeNull();

  await act(async () => {
    button?.click();
    await Promise.resolve();
  });

  expect(onImport).toHaveBeenCalledWith(items[0]);
});

it("renders a refusal beside the row it refused", async () => {
  const rendered = await render({
    onImport: vi.fn(async () => ({
      ok: false as const,
      message: "That video is over the cap.",
    })),
    onImportExport: importExport(),
    client: { fetch: listingFetcher(available) },
  });

  const button = rendered.querySelector<HTMLButtonElement>(
    "[data-yunari-wallpaper-engine-item='202'] [data-yunari-wallpaper-engine-import]",
  );
  await act(async () => {
    button?.click();
    // One macrotask: the click's import settles through two awaits, and a
    // microtask boundary is not enough for the refusal to be rendered.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(rendered.textContent).toContain("That video is over the cap.");
});

it("offers no import for a web item, only its reason", async () => {
  const rendered = await render({
    onImport: vi.fn(async () => ({ ok: true as const })),
    onImportExport: importExport(),
    client: { fetch: listingFetcher(available) },
  });

  const row = rendered.querySelector<HTMLElement>(
    "[data-yunari-wallpaper-engine-item='203']",
  );
  expect(row?.textContent).toContain(
    uiCopy.assets.wallpaperEngine.webUnsupported,
  );
  expect(
    row?.querySelector("[data-yunari-wallpaper-engine-import]"),
  ).toBeNull();
});

it("opens a scene's export sheet in place of the list, and closes it back", async () => {
  const rendered = await render({
    onImport: vi.fn(async () => ({ ok: true as const })),
    onImportExport: importExport(),
    client: { fetch: listingFetcher(available) },
  });

  const row = rendered.querySelector<HTMLElement>(
    "[data-yunari-wallpaper-engine-item='204']",
  );
  const open = row?.querySelector<HTMLButtonElement>(
    "[data-yunari-wallpaper-engine-open]",
  );
  expect(open?.textContent).toBe(uiCopy.assets.wallpaperEngine.openScene);
  expect(
    row?.querySelector("[data-yunari-wallpaper-engine-import]"),
  ).toBeNull();

  await act(async () => {
    open?.click();
    await Promise.resolve();
  });

  expect(rendered.querySelector("[data-yunari-export-sheet]")).not.toBeNull();
  expect(
    rendered.querySelectorAll("[data-yunari-wallpaper-engine-item]"),
  ).toHaveLength(0);

  await act(async () => {
    rendered
      .querySelector<HTMLButtonElement>("[data-yunari-export-done]")
      ?.click();
    await Promise.resolve();
  });

  expect(rendered.querySelector("[data-yunari-export-sheet]")).toBeNull();
  expect(
    rendered.querySelectorAll("[data-yunari-wallpaper-engine-item]"),
  ).toHaveLength(4);
});

function rowIds(rendered: HTMLElement): readonly (string | undefined)[] {
  return [
    ...rendered.querySelectorAll<HTMLElement>(
      "[data-yunari-wallpaper-engine-item]",
    ),
  ].map((row) => row.dataset.yunariWallpaperEngineItem);
}

async function typeSearch(rendered: HTMLElement, text: string): Promise<void> {
  const search = rendered.querySelector<HTMLInputElement>(
    "[data-yunari-wallpaper-engine-search]",
  );
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(search, text);
    search?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("narrows the rows to the titles the search term reaches, and back", async () => {
  const rendered = await render({
    onImport: vi.fn(async () => ({ ok: true as const })),
    onImportExport: importExport(),
    client: { fetch: listingFetcher(available) },
  });

  await typeSearch(rendered, "NEON");
  expect(rowIds(rendered)).toEqual(["202"]);

  await typeSearch(rendered, "");
  expect(rowIds(rendered)).toEqual(["201", "202", "203", "204"]);
});

it("narrows the rows to the chosen kind, and back to All", async () => {
  const rendered = await render({
    onImport: vi.fn(async () => ({ ok: true as const })),
    onImportExport: importExport(),
    client: { fetch: listingFetcher(available) },
  });

  await act(async () => {
    rendered
      .querySelector<HTMLButtonElement>(
        "[data-yunari-wallpaper-engine-kind-filter='scene']",
      )
      ?.click();
    await Promise.resolve();
  });
  expect(rowIds(rendered)).toEqual(["204"]);

  await act(async () => {
    rendered
      .querySelector<HTMLButtonElement>(
        "[data-yunari-wallpaper-engine-kind-filter='all']",
      )
      ?.click();
    await Promise.resolve();
  });
  expect(rowIds(rendered)).toEqual(["201", "202", "203", "204"]);
});

it("says so when the filters hide every row", async () => {
  const rendered = await render({
    onImport: vi.fn(async () => ({ ok: true as const })),
    onImportExport: importExport(),
    client: { fetch: listingFetcher(available) },
  });

  await typeSearch(rendered, "no such wallpaper");

  expect(rowIds(rendered)).toEqual([]);
  expect(rendered.textContent).toContain(
    uiCopy.assets.wallpaperEngine.noMatches,
  );
});

it("says the clock warning once after a successful image import", async () => {
  const rendered = await render({
    onImport: vi.fn(async () => ({ ok: true as const })),
    onImportExport: importExport(),
    client: { fetch: listingFetcher(available) },
  });

  expect(
    rendered.querySelector("[data-yunari-wallpaper-engine-image-notice]"),
  ).toBeNull();

  await act(async () => {
    rendered
      .querySelector<HTMLButtonElement>(
        "[data-yunari-wallpaper-engine-item='201'] [data-yunari-wallpaper-engine-import]",
      )
      ?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const notices = rendered.querySelectorAll(
    "[data-yunari-wallpaper-engine-image-notice]",
  );
  expect(notices).toHaveLength(1);
  expect(notices[0]?.textContent).toBe(
    uiCopy.assets.wallpaperEngine.imageNotice,
  );
});

it("does not say the clock warning after a refused import", async () => {
  const rendered = await render({
    onImport: vi.fn(async () => ({
      ok: false as const,
      message: "That video is over the cap.",
    })),
    onImportExport: importExport(),
    client: { fetch: listingFetcher(available) },
  });

  await act(async () => {
    rendered
      .querySelector<HTMLButtonElement>(
        "[data-yunari-wallpaper-engine-item='202'] [data-yunari-wallpaper-engine-import]",
      )
      ?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(
    rendered.querySelector("[data-yunari-wallpaper-engine-image-notice]"),
  ).toBeNull();
});
