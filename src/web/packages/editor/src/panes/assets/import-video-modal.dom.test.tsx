// @vitest-environment jsdom

/**
 * The import modal: one surface for an `.mpkg` and a video file.
 *
 * **It runs on mount, not on a press.** A pick is the author's answer already,
 * so the surface opens running and reports the step it is on. A success closes
 * it; a refusal is the host's own sentence, kept on screen where the author can
 * read it rather than replaced by a generic one.
 */
import { act, type JSX, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, type Mock, vi } from "vitest";
import type { ImportOutcome } from "../../asset-finder/actions.js";
import { uiCopy } from "../../ui-copy.js";
import {
  ImportVideoModal,
  type VideoImportStep,
} from "./import-video-modal.js";

// Base UI's dialog needs the three browser APIs jsdom has none of — the same
// shims `assets-pane.dom.test.tsx` supplies, for the same reason.
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

const PACKAGE_FILE = new File([new Uint8Array([1, 2, 3])], "night.mpkg", {
  type: "application/octet-stream",
});
const VIDEO_FILE = new File([new Uint8Array([4, 5, 6])], "clip.mp4", {
  type: "video/mp4",
});

let root: Root | undefined;

afterEach(async () => {
  if (root !== undefined) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

/** React and Base UI schedule outside `act`, so a popup is flushed with
 *  macrotasks rather than one. */
async function flush(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** Mounts the modal the way the pane does: its own state closes it, so a
 *  success can be proved by the surface leaving the document. */
async function mount(options: {
  readonly package: boolean;
  readonly onRun: (
    onStep: (step: VideoImportStep) => void,
  ) => Promise<ImportOutcome>;
}): Promise<{ readonly onClose: Mock }> {
  const host = document.createElement("div");
  document.body.append(host);
  const onClose = vi.fn();

  function Harness(): JSX.Element | null {
    const [open, setOpen] = useState(true);
    if (!open) return null;
    return (
      <ImportVideoModal
        file={options.package ? PACKAGE_FILE : VIDEO_FILE}
        package={options.package}
        onRun={options.onRun}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
      />
    );
  }

  const mounted = createRoot(host);
  root = mounted;
  await act(async () => {
    mounted.render(<Harness />);
    await flush();
  });
  return { onClose };
}

/** A run the case finishes itself, so the running state is observable. */
function deferredRun(): {
  readonly onRun: Mock;
  readonly step: (step: VideoImportStep) => void;
  readonly finish: (outcome: ImportOutcome) => void;
} {
  let step: (next: VideoImportStep) => void = () => {};
  let finish: (outcome: ImportOutcome) => void = () => {};
  const onRun = vi.fn(
    (onStep: (next: VideoImportStep) => void): Promise<ImportOutcome> => {
      step = onStep;
      onStep("preparing");
      return new Promise<ImportOutcome>((resolve) => {
        finish = resolve;
      });
    },
  );
  return {
    onRun,
    step: (next) => step(next),
    finish: (outcome) => finish(outcome),
  };
}

const modalOf = (): HTMLElement | null =>
  document.querySelector<HTMLElement>("[data-yunari-import-video-modal]");

it("draws the package's preparing sentence until the run moves on", async () => {
  const run = deferredRun();
  const { onClose } = await mount({ package: true, onRun: run.onRun });

  const modal = modalOf();
  if (modal === null) throw new Error("the modal drew no surface");
  expect(
    modal.querySelector("[data-yunari-import-video-progress]"),
  ).not.toBeNull();
  expect(modal.textContent).toContain(
    uiCopy.panels.importVideo.preparingPackage,
  );
  expect(onClose).not.toHaveBeenCalled();

  await act(async () => {
    run.step("importing");
    await flush();
  });
  expect(modalOf()?.textContent).toContain(uiCopy.panels.importVideo.importing);

  await act(async () => {
    run.finish({ ok: true });
    await flush();
  });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(modalOf()).toBeNull();
});

it("says the video sentence for a video, not the package's", async () => {
  const run = deferredRun();
  await mount({ package: false, onRun: run.onRun });

  const modal = modalOf();
  if (modal === null) throw new Error("the modal drew no surface");
  expect(modal.textContent).toContain(uiCopy.panels.importVideo.preparingVideo);
  expect(uiCopy.panels.importVideo.preparingVideo).not.toBe(
    uiCopy.panels.importVideo.preparingPackage,
  );
});

it("stays open with the host's sentence when the import fails", async () => {
  const sentence = "No video in this package.";
  const { onClose } = await mount({
    package: true,
    onRun: async () => ({ ok: false, message: sentence }),
  });

  const modal = modalOf();
  if (modal === null) throw new Error("the failed modal closed itself");
  expect(modal.textContent).toContain(sentence);
  expect(modal.querySelector("[data-yunari-import-video-progress]")).toBeNull();
  // The run settled, so no step line survives to contradict the refusal with a
  // "preparing" sentence the run already left.
  expect(modal.querySelector("[data-yunari-import-video-step]")).toBeNull();
  expect(modal.textContent).not.toContain(
    uiCopy.panels.importVideo.preparingPackage,
  );
  expect(onClose).not.toHaveBeenCalled();
});

it("warns that baked-in dynamic text loops as-is, for a package and a video", async () => {
  await mount({ package: true, onRun: deferredRun().onRun });
  expect(modalOf()?.textContent).toContain(
    uiCopy.panels.importVideo.dynamicText,
  );
  expect(uiCopy.panels.importVideo.dynamicText).toContain("clock");

  const first = root;
  root = undefined;
  await act(async () => first?.unmount());
  document.body.replaceChildren();

  await mount({ package: false, onRun: deferredRun().onRun });
  expect(modalOf()?.textContent).toContain(
    uiCopy.panels.importVideo.dynamicText,
  );
});

it("refuses every dismissal while the run is live", async () => {
  const run = deferredRun();
  const { onClose } = await mount({ package: true, onRun: run.onRun });

  // No close affordance is drawn at all while the host and the encoder run.
  expect(document.querySelector(".editor-shell-dialog-close")).toBeNull();

  await act(async () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await flush();
  });

  expect(onClose).not.toHaveBeenCalled();
  expect(modalOf()).not.toBeNull();
  expect(run.onRun).toHaveBeenCalledTimes(1);
});

it("dismisses once the run has settled, and closes only once", async () => {
  const run = deferredRun();
  const { onClose } = await mount({ package: true, onRun: run.onRun });

  await act(async () => {
    run.finish({ ok: false, message: "No video in this package." });
    await flush();
  });

  const close = document.querySelector<HTMLButtonElement>(
    ".editor-shell-dialog-close",
  );
  if (close === null) throw new Error("the settled modal drew no way out");
  await act(async () => {
    close.click();
    await flush();
  });

  expect(onClose).toHaveBeenCalledTimes(1);
  // A run that landed before the dismissal cannot close a second time.
  await act(async () => {
    run.finish({ ok: false, message: "late" });
    await flush();
  });
  expect(onClose).toHaveBeenCalledTimes(1);
});
