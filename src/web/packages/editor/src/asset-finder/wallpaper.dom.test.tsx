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
import {
  type WallpaperActions,
  WallpaperTools,
  wallpaperActionsOf,
  wallpaperCards,
} from "./wallpaper.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const words = uiCopy.assets.wallpaperEngine;

const scene: WallpaperEngineItem = {
  workshopId: "201",
  title: "Still lake",
  kind: "scene",
  previewUrl: "/api/wallpaper-engine/item/201/preview",
  filesize: 8_388_608,
  tags: [],
  stillAtRest: true,
  hasText: false,
  attribution: undefined,
};

const video: WallpaperEngineItem = {
  workshopId: "202",
  title: "Neon city",
  kind: "video",
  previewUrl: undefined,
  filesize: 12_582_912,
  tags: [],
  stillAtRest: undefined,
  hasText: undefined,
  attribution: undefined,
};

function actions(): WallpaperActions {
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
  };
}

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

async function render(element: React.ReactElement): Promise<HTMLDivElement> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(element);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return host;
}

it("maps an item to a previewable card with its kind and size", () => {
  const [card] = wallpaperCards([scene]);

  expect(card?.id).toBe("201");
  expect(card?.name).toBe("Still lake");
  expect(card?.sourceId).toBe("wallpaper-engine");
  expect(card?.previewable).toBe(true);
  expect(card?.meta).toBe(
    `${words.kind.scene} · ${words.size(scene.filesize)}`,
  );
});

it("draws no preview for an item the host served none for", () => {
  const [card] = wallpaperCards([video]);

  expect(card?.preview).toBeNull();
});

it("labels a video's action as the background and a scene's as the project", () => {
  const wired = actions();

  expect(
    wallpaperActionsOf(video, wired).map((action) => action.label),
  ).toEqual([words.action.video.idle]);
  expect(
    wallpaperActionsOf(scene, wired).map((action) => action.label),
  ).toEqual([words.action.scene.idle]);
});

it("runs the video's background write and reports it", async () => {
  const wired = actions();
  const [action] = wallpaperActionsOf(video, wired);

  const outcome = await action?.run();

  expect(wired.onSetBackground).toHaveBeenCalledWith(video);
  expect(outcome).toEqual({
    ok: true,
    message: words.backgroundSet("Neon city"),
  });
});

it("keeps a refused background's own sentence", async () => {
  const wired: WallpaperActions = {
    ...actions(),
    onSetBackground: vi.fn(
      async (): Promise<ImportOutcome> => ({
        ok: false,
        message: "Over the cap.",
      }),
    ),
  };
  const [action] = wallpaperActionsOf(video, wired);

  expect(await action?.run()).toEqual({ ok: false, message: "Over the cap." });
});

it("converts a scene and names the project", async () => {
  const wired = actions();
  const [action] = wallpaperActionsOf(scene, wired);

  expect(await action?.run()).toEqual({
    ok: true,
    message: words.projectReady("201"),
  });
  expect(wired.onConvert).toHaveBeenCalledWith(scene);
});

it("names a refused conversion's reason", async () => {
  const wired: WallpaperActions = {
    ...actions(),
    onConvert: vi.fn(
      async (): Promise<StartProjectAnswer> => ({
        ok: false,
        reason: "no-install",
      }),
    ),
  };
  const [action] = wallpaperActionsOf(scene, wired);

  expect(await action?.run()).toEqual({
    ok: false,
    message: words.projectFailed("no-install"),
  });
});

it("offers nothing without a selected item or without the session's writes", () => {
  expect(wallpaperActionsOf(undefined, actions())).toEqual([]);
  expect(wallpaperActionsOf(video, undefined)).toEqual([]);
});

it("draws the guide and the .mpkg import as the pane's tools", async () => {
  const rendered = await render(
    <WallpaperTools
      onImportPackage={actions().onImportPackage}
      onStatus={() => {}}
    />,
  );

  expect(
    rendered
      .querySelector("[data-yunari-wallpaper-engine-guide]")
      ?.getAttribute("aria-label"),
  ).toBe(words.guide);
  expect(
    rendered
      .querySelector("[data-yunari-wallpaper-engine-import-package]")
      ?.getAttribute("aria-label"),
  ).toBe(words.importPackage);
});

it("hides the package import when the session wires no write for it", async () => {
  const rendered = await render(
    <WallpaperTools onImportPackage={undefined} onStatus={() => {}} />,
  );

  expect(
    rendered.querySelector("[data-yunari-wallpaper-engine-import-package]"),
  ).toBeNull();
  expect(
    rendered.querySelector("[data-yunari-wallpaper-engine-guide]"),
  ).not.toBeNull();
});

it("opens the guide with the convert use case and the export steps", async () => {
  const rendered = await render(
    <WallpaperTools
      onImportPackage={actions().onImportPackage}
      onStatus={() => {}}
    />,
  );

  await act(async () => {
    rendered
      .querySelector<HTMLButtonElement>("[data-yunari-wallpaper-engine-guide]")
      ?.click();
    await Promise.resolve();
  });

  const dialog = document.querySelector(
    "[data-yunari-wallpaper-engine-guide-dialog]",
  );
  expect(dialog?.textContent).toContain(words.guideSections.convert.heading);
  expect(dialog?.textContent).toContain("Send to Mobile Device");
});

it("opens the video modal on a picked .mpkg and reports the outcome once", async () => {
  const onStatus = vi.fn();
  const onImportPackage = vi.fn(() => new Promise<ImportOutcome>(() => {}));
  const rendered = await render(
    <WallpaperTools onImportPackage={onImportPackage} onStatus={onStatus} />,
  );

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

  const modal = document.querySelector("[data-yunari-import-video-modal]");
  expect(modal).not.toBeNull();
  expect(onImportPackage).toHaveBeenCalledWith(file, expect.any(Function));
  expect(onStatus).not.toHaveBeenCalled();
});

it("reports a successful package import and keeps one modal mounted", async () => {
  const onStatus = vi.fn();
  let settle!: (outcome: ImportOutcome) => void;
  const run = new Promise<ImportOutcome>((resolve) => {
    settle = resolve;
  });
  const onImportPackage = vi.fn(() => run);
  const rendered = await render(
    <WallpaperTools onImportPackage={onImportPackage} onStatus={onStatus} />,
  );

  const input = rendered.querySelector<HTMLInputElement>(
    "[data-yunari-wallpaper-engine-package-input]",
  );
  const file = new File([new Uint8Array([1])], "night.mpkg");
  await act(async () => {
    Object.defineProperty(input, "files", {
      value: [file],
      configurable: true,
    });
    input?.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
  const modal = document.querySelector("[data-yunari-import-video-modal]");

  // The pane's parent may redraw — a listing landing, a selection changing —
  // and the tools stay the same instance, so the one import is not re-run.
  await act(async () => {
    root?.render(
      <WallpaperTools onImportPackage={onImportPackage} onStatus={onStatus} />,
    );
    await Promise.resolve();
  });
  expect(onImportPackage).toHaveBeenCalledTimes(1);
  expect(document.querySelector("[data-yunari-import-video-modal]")).toBe(
    modal,
  );

  await act(async () => {
    settle({ ok: true });
    await run;
  });
  expect(onStatus).toHaveBeenCalledWith(words.packageImported);
  expect(onImportPackage).toHaveBeenCalledTimes(1);
});
