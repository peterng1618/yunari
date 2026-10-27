// @vitest-environment jsdom

/**
 * The token inspector's import dialog: the same form the Assets pane draws,
 * without its role select, and the two commits it reports.
 */

import { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fontMetadataFromFilename } from "../panes/assets/font-metadata-form.js";
import { uiCopy } from "../ui-copy.js";
import {
  FontImportDialog,
  type FontImportOutcome,
} from "./font-import-dialog.js";
import { openModal } from "./ui/modal-host.js";

// Base UI's dialog needs the three browser APIs jsdom has none of — the same
// three `save-cleanup-dialog.dom.test.tsx` supplies, for the same reason.
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

const FILENAME = "Manrope-Bold.woff2";
const initial = fontMetadataFromFilename(FILENAME);

function opened(): HTMLElement {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  if (dialog === null) throw new Error("the import dialog did not open");
  return dialog;
}

function button(selector: string): HTMLButtonElement {
  const found = opened().querySelector<HTMLButtonElement>(selector);
  if (found === null) throw new Error(`the dialog draws no ${selector}`);
  return found;
}

async function press(selector: string): Promise<void> {
  await act(async () => {
    button(selector).dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
    );
  });
}

/** A field edit as React sees one: the value goes through the prototype's
 *  setter, and blur is what commits a plan-1 field. */
async function edit(selector: string, value: string): Promise<void> {
  const input = opened().querySelector<HTMLInputElement>(selector);
  if (input === null) throw new Error(`the form draws no ${selector}`);
  await act(async () => {
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input) as HTMLInputElement,
      "value",
    )?.set;
    if (setter === undefined) input.value = value;
    else setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input.blur();
  });
}

const ok: FontImportOutcome = { ok: true, message: "Font declared." };

/** Opens the dialog and answers the promise it settles. */
function open(
  input: {
    readonly onCommit?: () => Promise<FontImportOutcome>;
    readonly onCancel?: () => Promise<FontImportOutcome>;
    readonly onCommitted?: (tokenId: string) => void;
  } = {},
): Promise<unknown> {
  let pending: Promise<unknown> | undefined;
  act(() => {
    pending = openModal<void>((settle) => (
      <FontImportDialog
        filename={FILENAME}
        initial={initial}
        onCommit={input.onCommit ?? (async () => ok)}
        onCancel={input.onCancel ?? (async () => ok)}
        {...(input.onCommitted === undefined
          ? {}
          : { onCommitted: input.onCommitted })}
        settle={settle}
      />
    ));
  });
  if (pending === undefined) throw new Error("openModal returned nothing");
  return pending;
}

describe("the font import dialog", () => {
  it("draws the form without the role select", () => {
    void open();

    expect(opened().textContent).toContain(uiCopy.panels.importLocalFont);
    // A role's id is the role, so an import from here may never rewrite one; the
    // field that could is not drawn at all.
    expect(opened().querySelector("[data-yunari-font-role]")).toBeNull();
    expect(opened().querySelector("[data-yunari-font-family]")).not.toBeNull();
  });

  it("commits the form's metadata and closes", async () => {
    const onCommit = vi.fn(async () => ok);
    const pending = open({ onCommit });

    await press("[data-yunari-font-create]");
    await pending;

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({
      family: "Manrope",
      weight: 700,
      style: "normal",
      licence: "unknown",
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps the dialog open with a refused commit's words", async () => {
    const onCommit = vi
      .fn<() => Promise<FontImportOutcome>>()
      .mockResolvedValueOnce({ ok: false, message: "Credits are full." })
      .mockResolvedValueOnce(ok);
    const pending = open({ onCommit });

    await press("[data-yunari-font-create]");

    expect(opened().querySelector('[role="alert"]')?.textContent).toBe(
      "Credits are full.",
    );
    // An edit means the refused values are gone, so the refusal is too.
    await edit("[data-yunari-font-family]", "Manrope Sans");
    expect(opened().querySelector('[role="alert"]')).toBeNull();
    // The form stays, so the answer can be retried rather than lost.
    await press("[data-yunari-font-create]");
    await pending;
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("re-enables the form with the reason when a commit rejects", async () => {
    const onCommit = vi.fn(async () => {
      throw new Error("The host refused the file.");
    });
    void open({ onCommit });

    await press("[data-yunari-font-create]");
    // The rejection arrives on the microtask queue after the press.
    await act(async () => {});

    expect(opened().querySelector('[role="alert"]')?.textContent).toBe(
      "The host refused the file.",
    );
    // Busy is released, so the author can try again rather than facing a
    // disabled form over an answer that never arrived.
    expect(button("[data-yunari-font-create]").disabled).toBe(false);
  });

  it("cancels through the form's own Cancel", async () => {
    const onCancel = vi.fn(async () => ok);
    const pending = open({ onCancel });

    await press("[data-yunari-font-cancel]");
    await pending;

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("names the token a commit produced, and nothing on a cancel or a refusal", async () => {
    const onCommitted = vi.fn();
    const committed = open({
      onCommitted,
      onCommit: async () => ({
        ok: true,
        message: "",
        tokenId: "caption",
      }),
    });

    await press("[data-yunari-font-create]");
    await committed;
    expect(onCommitted).toHaveBeenCalledWith("caption");

    // Cancel declares the file and creates no token, so nothing is named.
    const cancelled = vi.fn();
    const cancelPending = open({
      onCommitted: cancelled,
      onCancel: async () => ok,
    });
    await press("[data-yunari-font-cancel]");
    await cancelPending;
    expect(cancelled).not.toHaveBeenCalled();

    // A refused commit produced nothing either, and its form stays open.
    const refused = vi.fn();
    const refusedPending = open({
      onCommitted: refused,
      onCommit: async () => ({ ok: false, message: "Credits are full." }),
    });
    await press("[data-yunari-font-create]");
    // The refusal lands on the microtask queue after the press.
    await act(async () => {});
    expect(refused).not.toHaveBeenCalled();
    void refusedPending;
  });

  it("dismisses without committing when the dialog is escaped", async () => {
    const onCommit = vi.fn(async () => ok);
    const onCancel = vi.fn(async () => ok);
    const pending = open({ onCommit, onCancel });

    await act(async () => {
      opened().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await pending;

    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
