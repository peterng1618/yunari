// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { uiCopy } from "../ui-copy.js";
import type { FinderAction } from "./finder-controls.js";
import { type FinderPreview, FinderPreviewModal } from "./preview-modal.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const preview: FinderPreview = {
  id: "unsplash:1",
  name: "A quiet lake",
  meta: "Photo · 2400×1600",
  licence: "Unsplash License",
  sourceUrl: "https://unsplash.com/photos/1",
  imageUrl: "https://images.example/1.jpg",
  posterOnly: false,
};

function action(id: string, label: string): FinderAction {
  return {
    id,
    label,
    busyLabel: "Setting…",
    tone: "plain",
    disabled: false,
    run: async () => ({ ok: true }),
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

function render(props: Parameters<typeof FinderPreviewModal>[0]): void {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(<FinderPreviewModal {...props} />);
  });
}

it("shows the picture, the facts and the same actions", () => {
  const onRun = vi.fn();
  const setBackground = action("apply", "Set as background");
  render({
    preview,
    actions: [setBackground],
    busyActionId: undefined,
    message: undefined,
    onRun,
    onClose: () => {},
  });

  const modal = document.querySelector("[data-yunari-asset-preview-modal]");
  expect(modal).not.toBeNull();
  expect(modal?.querySelector("img")?.getAttribute("src")).toBe(
    "https://images.example/1.jpg",
  );
  expect(modal?.textContent).toContain("Unsplash License");
  expect(modal?.textContent).toContain("https://unsplash.com/photos/1");

  const button = modal?.querySelector<HTMLButtonElement>(
    '[data-yunari-asset-preview-action="apply"]',
  );
  expect(button?.textContent).toBe("Set as background");
  act(() => button?.click());
  expect(onRun).toHaveBeenCalledWith(setBackground);
});

it("draws a video's poster with the sentence that it is only a poster", () => {
  render({
    preview: {
      ...preview,
      name: "Rain loop",
      imageUrl: "https://videos.example/poster.jpg",
      posterOnly: true,
    },
    actions: [],
    busyActionId: undefined,
    message: undefined,
    onRun: () => {},
    onClose: () => {},
  });

  const modal = document.querySelector("[data-yunari-asset-preview-modal]");
  expect(modal?.querySelector("video")).toBeNull();
  expect(modal?.textContent).toContain(uiCopy.assets.previewModal.posterOnly);
});

it("draws no picture when the source served none", () => {
  render({
    preview: { ...preview, imageUrl: undefined },
    actions: [],
    busyActionId: undefined,
    message: undefined,
    onRun: () => {},
    onClose: () => {},
  });

  expect(
    document.querySelector(
      "[data-yunari-asset-preview-modal] [data-yunari-asset-preview-image]",
    ),
  ).toBeNull();
});

it("shows the running action and the outcome sentence", () => {
  render({
    preview,
    actions: [action("apply", "Set as background")],
    busyActionId: "apply",
    message: { text: "That image is unreachable.", tone: "failed" },
    onRun: () => {},
    onClose: () => {},
  });

  const button = document.querySelector<HTMLButtonElement>(
    '[data-yunari-asset-preview-action="apply"]',
  );
  expect(button?.textContent).toContain("Setting…");
  expect(button?.disabled).toBe(true);
  expect(document.body.textContent).toContain("That image is unreachable");
});

it("closes on Escape", () => {
  const onClose = vi.fn();
  render({
    preview,
    actions: [],
    busyActionId: undefined,
    message: undefined,
    onRun: () => {},
    onClose,
  });

  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });

  expect(onClose).toHaveBeenCalledOnce();
});
