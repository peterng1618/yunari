// @vitest-environment jsdom

/**
 * The recovery prompt, driven the way the boot path drives it.
 *
 * Two claims, and both are the ruling's: it **names what was lost** — the theme
 * and the moment the copy was written, not the mechanism that kept it — and its
 * answers are the two the author has, with the one that loses work drawn last.
 * A dismissal is read here too, because the floor of a prompt on the way to
 * losing work is that closing it is never the answer that loses it.
 */

import { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  confirmDraftRecovery,
  type DraftRecoveryAnswer,
} from "./draft-recovery-prompt.js";
import type { Draft } from "./draft-store.js";
import { uiCopy } from "./ui-copy.js";

// Base UI's dialog needs the three browser APIs jsdom has none of — the same
// three `theme-library-dialog.dom.test.ts` supplies, for the same reason.
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

const SAVED_AT = "2026-10-14T09:31:00.000Z";

/** The draft the boot path holds. The prompt reads its name and its `savedAt`;
 *  the envelope is the store's to keep. */
const DRAFT: Draft = {
  name: "Ops board",
  savedAt: SAVED_AT,
  content: {
    schemaVersion: "2.0.0",
    fabricVersion: "7.4.0",
    id: "ops-board",
    artboard: { width: 1920, height: 1080 },
    metadata: { name: "Ops board", themeLanguage: "en" },
    scene: { version: "7.4.0", objects: [] },
  },
};

function open(): Promise<DraftRecoveryAnswer> {
  let pending: Promise<DraftRecoveryAnswer> | undefined;
  act(() => {
    pending = confirmDraftRecovery(DRAFT);
  });
  if (pending === undefined) {
    throw new Error("confirmDraftRecovery returned nothing");
  }
  return pending;
}

/** The prompt's dialog, or a failure saying it did not open. */
function opened(): HTMLElement {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  if (dialog === null) throw new Error("the recovery prompt did not open");
  return dialog;
}

function answerNamed(word: string): HTMLButtonElement {
  const button = [...opened().querySelectorAll("button")].find(
    (candidate) => candidate.textContent === word,
  );
  if (button === undefined) {
    throw new Error(`the prompt offers no "${word}"`);
  }
  return button as HTMLButtonElement;
}

async function press(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
    );
  });
}

describe("the draft recovery prompt", () => {
  it("names the theme and the moment the copy was written", () => {
    void open();

    const lead = opened().querySelector(".editor-shell-dialog-lead");
    expect(lead?.textContent).toBe(
      uiCopy.draftRecovery.lead(
        DRAFT.name,
        new Date(SAVED_AT).toLocaleString(),
      ),
    );
    // The visible lead is the dialog's own name, so a reader that announces the
    // surface says what the author is looking at rather than "dialog".
    expect(opened().getAttribute("aria-label")).toBe(lead?.textContent);
  });

  it("offers Restore first and Discard last, and restores when Restore is pressed", async () => {
    const pending = open();

    const words = [...opened().querySelectorAll("button")].map(
      (button) => button.textContent,
    );
    expect(words).toEqual([
      uiCopy.draftRecovery.restore,
      uiCopy.draftRecovery.discard,
    ]);

    await press(answerNamed(uiCopy.draftRecovery.restore));
    expect(await pending).toBe("restore");
    // The surface is gone with the answer: a modal left standing over the
    // document it just decided is the next thing the author would see.
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("discards when Discard is pressed", async () => {
    const pending = open();

    await press(answerNamed(uiCopy.draftRecovery.discard));
    expect(await pending).toBe("discard");
  });

  it("reads a dismissal as restoring rather than discarding", async () => {
    const pending = open();
    const dialog = opened();

    await act(async () => {
      dialog.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(await pending).toBe("restore");
  });

  it("draws its answers in the dialog family's one button treatment", () => {
    void open();

    // Read off the rendered button rather than compared with the token, so a
    // dialog that stopped importing the treatment and wrote the string again is
    // caught. The four dialogs each had their own copy and one had already
    // drifted, which is the divergence this reads for.
    const button = answerNamed(uiCopy.draftRecovery.restore);
    expect(button.className).toContain("px-[var(--space-12)]");
    expect(button.className).toContain("enabled:hover:border-accent");
  });
});
