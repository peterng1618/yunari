// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { BackgroundPlayback } from "./background-playback.js";
import type { EditorShellBridge } from "./bridge.js";
import { SelectionStore } from "./shell-stores.js";

/** Only the three facts and the one command this control reads. */
function storeWith(playing: boolean, video = true): SelectionStore {
  const setBackgroundPlaying = vi.fn();
  const store = new SelectionStore();
  store.set({
    snapshot: () => ({
      objectCount: 0,
      tokenCount: 0,
      selectedCount: 0,
      locked: false,
      activeKind: "none",
      documentName: "Theme",
      selectionPresetId: undefined,
    }),
    subscribe: () => () => undefined,
    backgroundVideo: () => video,
    backgroundPlaying: () => playing,
    setBackgroundPlaying,
  } as unknown as EditorShellBridge);
  return store;
}

it("draws no playback control without a video background", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const store = storeWith(false, false);
  await act(async () => root.render(<BackgroundPlayback store={store} />));
  expect(host.querySelector("[data-yunari-background-playback]")).toBeNull();
});

it("states the command rather than the state the video is in", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const playing = storeWith(true);
  await act(async () => root.render(<BackgroundPlayback store={playing} />));
  expect(
    host.querySelector<HTMLButtonElement>(
      'button[aria-label="Pause background video"]',
    ),
  ).not.toBeNull();

  const paused = storeWith(false);
  await act(async () => root.render(<BackgroundPlayback store={paused} />));
  expect(
    host.querySelector<HTMLButtonElement>(
      'button[aria-label="Play background video"]',
    ),
  ).not.toBeNull();
});
