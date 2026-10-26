// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { uiCopy } from "../ui-copy.js";
import type {
  StartProjectAnswer,
  WallpaperEngineItem,
} from "../wallpaper-engine/client.js";
import type { ImportOutcome } from "./actions.js";
import { WallpaperEngineBody } from "./wallpaper-engine-body.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const items: readonly WallpaperEngineItem[] = [
  {
    workshopId: "201",
    title: "Still lake",
    kind: "scene",
    previewUrl: "/api/wallpaper-engine/item/201/preview",
    filesize: 8_388_608,
    tags: [],
    stillAtRest: true,
    hasText: false,
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
    kind: "scene",
    previewUrl: undefined,
    filesize: 4_096,
    tags: [],
    stillAtRest: true,
    hasText: true,
    attribution: undefined,
  },
  {
    workshopId: "204",
    title: "Rain glass",
    kind: "video",
    previewUrl: undefined,
    filesize: 2_097_152,
    tags: [],
    stillAtRest: undefined,
    hasText: undefined,
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
  document.body.replaceChildren();
});

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function idle(): Parameters<typeof WallpaperEngineBody>[0] {
  return {
    onSetBackground: vi.fn(async (): Promise<ImportOutcome> => ({ ok: true })),
    onConvert: vi.fn(
      async (item: WallpaperEngineItem): Promise<StartProjectAnswer> => ({
        ok: true,
        name: item.workshopId,
        reused: false,
      }),
    ),
    onImportPackage: vi.fn(async (): Promise<ImportOutcome> => ({ ok: true })),
    client: { fetch: listingFetcher(available) },
  };
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

function cards(rendered: HTMLElement): readonly HTMLElement[] {
  return [
    ...rendered.querySelectorAll<HTMLElement>(
      "[data-yunari-wallpaper-engine-card]",
    ),
  ];
}

function cardIds(rendered: HTMLElement): readonly (string | undefined)[] {
  return cards(rendered).map((card) => card.dataset.yunariWallpaperEngineCard);
}

function actionOf(rendered: HTMLElement, id: string): HTMLButtonElement | null {
  return rendered.querySelector<HTMLButtonElement>(
    `[data-yunari-wallpaper-engine-card='${id}'] [data-yunari-wallpaper-engine-action]`,
  );
}

it("renders the host's absence reason, not an empty grid, and keeps the guide and package import reachable", async () => {
  const rendered = await render({
    ...idle(),
    client: {
      fetch: listingFetcher({ available: false, reason: "no-library" }),
    },
  });

  expect(rendered.textContent).toContain(
    uiCopy.assets.wallpaperEngine.reason["no-library"],
  );
  expect(cards(rendered)).toHaveLength(0);

  // A `.mpkg` exported on another machine is what an author without a library
  // needs, so both controls survive the absence branch.
  expect(
    rendered.querySelector("[data-yunari-wallpaper-engine-guide]"),
  ).not.toBeNull();
  expect(
    rendered.querySelector("[data-yunari-wallpaper-engine-import-package]"),
  ).not.toBeNull();
  expect(
    rendered.querySelector("[data-yunari-wallpaper-engine-package-input]"),
  ).not.toBeNull();
});

it("draws a card per item inside the finder's asset grid", async () => {
  const rendered = await render(idle());

  expect(cardIds(rendered)).toEqual(["201", "202", "203", "204"]);
  expect(
    rendered
      .querySelector("[data-yunari-asset-grid]")
      ?.contains(cards(rendered)[0] ?? null),
  ).toBe(true);

  const first = cards(rendered)[0]?.textContent ?? "";
  expect(first).toContain("Still lake");
  expect(first).toContain(uiCopy.assets.wallpaperEngine.kind.scene);
  expect(first).toContain(
    uiCopy.assets.wallpaperEngine.size(items[0]?.filesize ?? 0),
  );
  expect(cards(rendered)[1]?.textContent).toContain(
    uiCopy.assets.wallpaperEngine.kind.video,
  );
});

it("offers exactly all, video and scene as kind filters", async () => {
  const rendered = await render(idle());

  const filters = [
    ...rendered.querySelectorAll<HTMLElement>(
      "[data-yunari-wallpaper-engine-kind-filter]",
    ),
  ].map((button) => button.dataset.yunariWallpaperEngineKindFilter);
  expect(filters).toEqual(["all", "video", "scene"]);
});

it("sets a video as the background and reports it on the status line", async () => {
  const pending = deferred<ImportOutcome>();
  const onSetBackground = vi.fn(() => pending.promise);
  const rendered = await render({ ...idle(), onSetBackground });

  const action = actionOf(rendered, "202");
  expect(action?.getAttribute("aria-label")).toBe(
    uiCopy.assets.wallpaperEngine.action.video.idle,
  );

  await act(async () => {
    action?.click();
  });
  expect(actionOf(rendered, "202")?.getAttribute("aria-label")).toBe(
    uiCopy.assets.wallpaperEngine.action.video.running,
  );

  await act(async () => {
    pending.resolve({ ok: true });
    await pending.promise;
  });
  expect(actionOf(rendered, "202")?.getAttribute("aria-label")).toBe(
    uiCopy.assets.wallpaperEngine.action.video.done,
  );
  // Done is final for the modal session: a second press would declare a
  // duplicate asset and spend another credit slot.
  expect(actionOf(rendered, "202")?.disabled).toBe(true);
  expect(onSetBackground).toHaveBeenCalledWith(items[1]);
  expect(
    rendered.querySelector("[data-yunari-wallpaper-engine-status]")
      ?.textContent,
  ).toContain(uiCopy.assets.wallpaperEngine.backgroundSet("Neon city"));
});

it("holds a refused video background on the card and says it on the status line", async () => {
  const message = "That video is over the cap.";
  const rendered = await render({
    ...idle(),
    onSetBackground: vi.fn(
      async (): Promise<ImportOutcome> => ({
        ok: false,
        message,
      }),
    ),
  });

  await act(async () => {
    actionOf(rendered, "202")?.click();
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });

  expect(actionOf(rendered, "202")?.getAttribute("aria-label")).toBe(message);
  expect(actionOf(rendered, "202")?.disabled).toBe(false);
  expect(
    rendered.querySelector("[data-yunari-wallpaper-engine-status]")
      ?.textContent,
  ).toContain(message);
});

it("converts a scene and reports the project on the status line", async () => {
  const pending = deferred<StartProjectAnswer>();
  const onConvert = vi.fn(() => pending.promise);
  const rendered = await render({ ...idle(), onConvert });

  const action = actionOf(rendered, "201");
  expect(action?.getAttribute("aria-label")).toBe(
    uiCopy.assets.wallpaperEngine.action.scene.idle,
  );

  await act(async () => {
    action?.click();
  });
  expect(actionOf(rendered, "201")?.getAttribute("aria-label")).toBe(
    uiCopy.assets.wallpaperEngine.action.scene.running,
  );

  await act(async () => {
    pending.resolve({ ok: true, name: "201", reused: false });
    await pending.promise;
  });
  expect(actionOf(rendered, "201")?.getAttribute("aria-label")).toBe(
    uiCopy.assets.wallpaperEngine.action.scene.done,
  );
  expect(
    rendered.querySelector("[data-yunari-wallpaper-engine-status]")
      ?.textContent,
  ).toContain(uiCopy.assets.wallpaperEngine.projectReady("201"));
});

it("holds a failed convert on the card, keeps it pressable, and says the reason", async () => {
  const onConvert = vi.fn(
    async (): Promise<StartProjectAnswer> => ({
      ok: false,
      reason: "no-install",
    }),
  );
  const rendered = await render({ ...idle(), onConvert });
  const failure = uiCopy.assets.wallpaperEngine.projectFailed("no-install");

  await act(async () => {
    actionOf(rendered, "201")?.click();
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });

  expect(actionOf(rendered, "201")?.getAttribute("aria-label")).toBe(failure);
  const status = rendered.querySelector(
    "[data-yunari-wallpaper-engine-status]",
  )?.textContent;
  expect(status).toContain(failure);

  // The failure state stays pressable: a retry runs the same action again.
  await act(async () => {
    actionOf(rendered, "201")?.click();
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(onConvert).toHaveBeenCalledTimes(2);
});

it("opens the guide with the convert use case and the export steps", async () => {
  const rendered = await render(idle());

  const guide = rendered.querySelector<HTMLButtonElement>(
    "[data-yunari-wallpaper-engine-guide]",
  );
  expect(guide?.textContent).toBe(uiCopy.assets.wallpaperEngine.guide);

  await act(async () => {
    guide?.click();
    await Promise.resolve();
  });

  const dialog = document.querySelector(
    "[data-yunari-wallpaper-engine-guide-dialog]",
  );
  expect(dialog).not.toBeNull();
  expect(dialog?.textContent).toContain(
    uiCopy.assets.wallpaperEngine.guideSections.convert.heading,
  );
  expect(dialog?.textContent).toContain("Send to Mobile Device");
  expect(dialog?.textContent).toContain("Export .mpkg");
  expect(dialog?.textContent).toContain("Keep original aspect ratio");
});

it("opens the video modal on a picked .mpkg", async () => {
  const onImportPackage = vi.fn(() => new Promise<ImportOutcome>(() => {}));
  const rendered = await render({ ...idle(), onImportPackage });

  const button = rendered.querySelector<HTMLButtonElement>(
    "[data-yunari-wallpaper-engine-import-package]",
  );
  expect(button?.textContent).toBe(uiCopy.assets.wallpaperEngine.importPackage);

  const input = rendered.querySelector<HTMLInputElement>(
    "[data-yunari-wallpaper-engine-package-input]",
  );
  expect(input?.accept).toBe(".mpkg");

  const file = new File([new Uint8Array([1])], "night.mpkg");
  await act(async () => {
    Object.defineProperty(input, "files", {
      value: [file],
      configurable: true,
    });
    input?.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });

  expect(
    document.querySelector("[data-yunari-import-video-modal]"),
  ).not.toBeNull();
  expect(onImportPackage).toHaveBeenCalledWith(file, expect.any(Function));
});

it("exposes one status line at the bottom of the body", async () => {
  const rendered = await render(idle());

  const statuses = rendered.querySelectorAll("[role='status']");
  expect(statuses).toHaveLength(1);
  expect(statuses[0]?.parentElement?.lastElementChild).toBe(statuses[0]);
});

function rowIds(rendered: HTMLElement): readonly (string | undefined)[] {
  return cardIds(rendered);
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

it("narrows the cards to the titles the search term reaches, and back", async () => {
  const rendered = await render(idle());

  await typeSearch(rendered, "NEON");
  expect(rowIds(rendered)).toEqual(["202"]);

  await typeSearch(rendered, "");
  expect(rowIds(rendered)).toEqual(["201", "202", "203", "204"]);
});

it("narrows the cards to the chosen kind, and back to All", async () => {
  const rendered = await render(idle());

  await act(async () => {
    rendered
      .querySelector<HTMLButtonElement>(
        "[data-yunari-wallpaper-engine-kind-filter='scene']",
      )
      ?.click();
    await Promise.resolve();
  });
  expect(rowIds(rendered)).toEqual(["201", "203"]);

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

it("says so when the filters hide every card", async () => {
  const rendered = await render(idle());

  await typeSearch(rendered, "no such wallpaper");

  expect(rowIds(rendered)).toEqual([]);
  expect(rendered.textContent).toContain(
    uiCopy.assets.wallpaperEngine.noMatches,
  );
});
