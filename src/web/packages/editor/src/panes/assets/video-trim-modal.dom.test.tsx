// @vitest-environment jsdom

import type { VideoTrimRange } from "@yunari/theme-package";
/**
 * The trim surface: the author's span, or the whole file when it fits.
 *
 * jsdom decodes no video, so the element's duration is written on it and
 * `loadedmetadata` dispatched: that is exactly the event the surface reads.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { VideoTrimModal } from "./video-trim-modal.js";

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as never;
Element.prototype.getAnimations ??= (): never[] => [];
window.PointerEvent ??= MouseEvent as never;
HTMLMediaElement.prototype.pause = () => undefined;

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

afterEach(async () => {
  if (root !== undefined) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function flush(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function mount(
  onConfirm: (trim: VideoTrimRange | undefined) => void,
  durationSeconds: number,
): Promise<void> {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <VideoTrimModal
        src="blob:clip"
        name="clip.mp4"
        onConfirm={onConfirm}
        onClose={() => undefined}
      />,
    );
  });
  await flush();
  const video = document.querySelector<HTMLVideoElement>(
    "[data-yunari-video-trim-player]",
  );
  if (video === null) throw new Error("no player");
  Object.defineProperty(video, "duration", {
    configurable: true,
    value: durationSeconds,
  });
  await act(async () => {
    video.dispatchEvent(new Event("loadedmetadata", { bubbles: false }));
  });
  await flush();
}

function query(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`missing ${selector}`);
  return element;
}

async function drag(selector: string, value: number): Promise<void> {
  const input = query(selector) as HTMLInputElement;
  await act(async () => {
    // React's tracker reads the prototype's setter, so a plain assignment
    // would look unchanged and the listener would never run.
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(selector: string): Promise<void> {
  await act(async () => {
    query(selector).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

it("passes the dragged span to the import", async () => {
  const onConfirm = vi.fn();
  await mount(onConfirm, 30);

  await drag("[data-yunari-video-trim-start]", 2_000);
  await drag("[data-yunari-video-trim-end]", 12_000);
  await press("[data-yunari-video-trim-confirm]");

  expect(onConfirm).toHaveBeenCalledWith({ startMs: 2_000, endMs: 12_000 });
});

it("answers the whole file when the handles are left at the ends", async () => {
  const onConfirm = vi.fn();
  await mount(onConfirm, 30);

  await press("[data-yunari-video-trim-confirm]");

  expect(onConfirm).toHaveBeenCalledWith(undefined);
});

it("keeps the whole-file shortcut for a video under the cap", async () => {
  const onConfirm = vi.fn();
  await mount(onConfirm, 30);

  const whole = query("[data-yunari-video-trim-whole]") as HTMLButtonElement;
  expect(whole.disabled).toBe(false);
  await press("[data-yunari-video-trim-whole]");

  expect(onConfirm).toHaveBeenCalledWith(undefined);
});

it("closes the whole-file shortcut for a video over the cap", async () => {
  await mount(() => undefined, 61.5);

  const whole = query("[data-yunari-video-trim-whole]") as HTMLButtonElement;
  expect(whole.disabled).toBe(true);
  expect(document.body.textContent).toContain(
    "This video is longer than 1:00.0. Choose a span to import.",
  );
});

it("keeps the blend's minimum span between the handles", async () => {
  const onConfirm = vi.fn();
  await mount(onConfirm, 30);

  await drag("[data-yunari-video-trim-end]", 5_000);
  await drag("[data-yunari-video-trim-start]", 4_900);

  const start = query("[data-yunari-video-trim-start]") as HTMLInputElement;
  expect(Number(start.value)).toBe(3_000);
  await press("[data-yunari-video-trim-confirm]");
  expect(onConfirm).toHaveBeenCalledWith({ startMs: 3_000, endMs: 5_000 });
});
