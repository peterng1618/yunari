// @vitest-environment jsdom

/**
 * The save cleanup sheet: what it lists, and what its controls answer.
 *
 * The flows that open it — the package save and the library save — are their
 * owners' tests; this one drives the sheet itself, because the answers are the
 * only vocabulary a caller branches on.
 */

import { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { uiCopy } from "../ui-copy.js";
import {
  confirmSaveCleanup,
  type SaveCleanupAnswer,
  type SaveCleanupFile,
} from "./save-cleanup-dialog.js";

// Base UI's dialog needs the three browser APIs jsdom has none of — the same
// three `draft-recovery-prompt.dom.test.tsx` supplies, for the same reason.
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

beforeAll(() => {
  const matches = Element.prototype.matches;
  Element.prototype.matches = Object.assign(function (
    this: Element,
    selector: string,
  ): boolean {
    if (selector === ":modal" || selector === ":popover-open") return false;
    return matches.call(this, selector);
  }, matches);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const TITLE = uiCopy.file.saveLibrary;
const KB = 1024;

const FILES: readonly SaveCleanupFile[] = [
  {
    name: "Manrope-Variable.woff2",
    kind: "font",
    sizeBytes: 34 * KB,
    reason: uiCopy.saveCleanup.reason.font,
  },
  {
    name: "studio.png",
    kind: "image",
    sizeBytes: 840 * KB,
    reason: uiCopy.saveCleanup.reason.image,
    previewUrl: "blob:studio",
  },
  {
    name: "loop-alt.webm",
    kind: "video",
    sizeBytes: 2.5 * 1024 * KB,
    reason: uiCopy.saveCleanup.reason.video,
  },
];

function open(
  input: {
    readonly title?: string;
    readonly documentName?: string;
    readonly files?: readonly SaveCleanupFile[];
    readonly themeBytes?: number;
  } = {},
): Promise<SaveCleanupAnswer> {
  let pending: Promise<SaveCleanupAnswer> | undefined;
  act(() => {
    pending = confirmSaveCleanup({
      title: input.title ?? TITLE,
      ...(input.documentName === undefined
        ? {}
        : { documentName: input.documentName }),
      files: input.files ?? FILES,
      themeBytes: input.themeBytes ?? 2.1 * 1024 * KB,
    });
  });
  if (pending === undefined)
    throw new Error("confirmSaveCleanup returned nothing");
  return pending;
}

function opened(): HTMLElement {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  if (dialog === null) throw new Error("the cleanup sheet did not open");
  return dialog;
}

function buttonNamed(word: string): HTMLButtonElement {
  const button = [...opened().querySelectorAll("button")].find(
    (candidate) => candidate.textContent === word,
  );
  if (button === undefined) throw new Error(`the sheet offers no "${word}"`);
  return button as HTMLButtonElement;
}

function checkbox(): HTMLInputElement {
  const input = opened().querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  if (input === null) throw new Error("the sheet draws no checkbox");
  return input;
}

async function press(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
    );
  });
}

describe("the save cleanup sheet", () => {
  it("names the save's title and each file's kind, size and reason", () => {
    void open({ documentName: "System dashboard" });

    expect(opened().getAttribute("aria-label")).toBe(TITLE);
    expect(
      opened().querySelector(".editor-shell-dialog-lead")?.textContent,
    ).toBe(TITLE);
    // The document's own name under the save that was pressed; the sheet has
    // no name of its own to invent.
    expect(opened().textContent).toContain(`System dashboard · ${TITLE}`);

    const rows = [...opened().querySelectorAll("li")].map(
      (row) => row.textContent,
    );
    expect(rows).toHaveLength(FILES.length);
    expect(rows[0]).toContain("Manrope-Variable.woff2");
    expect(rows[0]).toContain("Font · 34 KB · no type preset refers to it");
    expect(rows[1]).toContain("studio.png");
    expect(rows[1]).toContain("Image · 840 KB · not on the canvas");
    expect(rows[2]).toContain("loop-alt.webm");
    expect(rows[2]).toContain("Video · 2.5 MB · not the background");
    expect(opened().textContent).toContain("3 files · 3.4 MB");
    expect(opened().textContent).toContain("2.1 MB theme · 3.4 MB unused");
  });

  it("draws an image's own thumbnail and a video's play mark", () => {
    void open();

    const rows = [...opened().querySelectorAll("li")];
    // The same mark the Assets pane draws for the same file.
    expect(rows[1]?.querySelector("img")?.getAttribute("src")).toBe(
      "blob:studio",
    );
    expect(rows[2]?.querySelector("svg")).not.toBeNull();
    // No name was given, so no subtitle line is drawn for one: a rendered
    // `undefined · <title>` would contain the separator and fail here.
    expect(opened().textContent).not.toContain(` · ${TITLE}`);
  });

  it("defaults the checkbox off", () => {
    void open();

    expect(checkbox().checked).toBe(false);
    expect(checkbox().getAttribute("data-yunari-save-cleanup-remove")).toBe("");
    expect(opened().textContent).toContain(
      uiCopy.saveCleanup.removeAfterSave(FILES.length),
    );
    expect(opened().textContent).toContain(uiCopy.saveCleanup.warning);
  });

  it("answers keep when the save is pressed unchecked", async () => {
    const pending = open();

    await press(buttonNamed(TITLE));
    expect(await pending).toBe("keep");
  });

  it("answers remove only when the checkbox was checked", async () => {
    const pending = open();

    await act(async () => checkbox().click());
    expect(checkbox().checked).toBe(true);
    await press(buttonNamed(TITLE));
    expect(await pending).toBe("remove");
  });

  it("answers cancel from its own button", async () => {
    const pending = open();

    await press(buttonNamed(uiCopy.saveCleanup.cancel));
    expect(await pending).toBe("cancel");
  });

  it("reads Escape as cancel, never as keeping the files", async () => {
    const pending = open();

    await act(async () => {
      opened().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(await pending).toBe("cancel");
  });

  it("draws both answers in the dialog family's one button treatment", () => {
    void open();

    for (const word of [uiCopy.saveCleanup.cancel, TITLE]) {
      const button = buttonNamed(word);
      expect(button.className).toContain("px-[var(--space-12)]");
      expect(button.className).toContain("enabled:hover:border-accent");
    }
  });
});
