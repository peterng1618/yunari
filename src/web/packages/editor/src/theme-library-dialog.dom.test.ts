// @vitest-environment jsdom

/**
 * The library chooser, re-pointed from the imperative dialog to the React one.
 *
 * Every journey it had is still here — the two groups, the delete that is
 * offered only for a theme, the confirmation that names what it will remove, and
 * the failure that keeps the row and says why — driven through the plan-1
 * controls rather than a native `<select>`.
 */

import type { FacetRecord } from "@yunari/renderer-core";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { STARTER_TEMPLATE } from "./new-fabric-theme.js";
import type {
  ThemeLibraryClient,
  ThemeLibraryEntry,
  ThemeOrigin,
} from "./theme-library-client.js";
import {
  promptThemeConflict,
  promptThemeSelection,
} from "./theme-library-dialog.js";
import { uiCopy } from "./ui-copy.js";

// Base UI's popups need three browser APIs jsdom has none of — the same three
// `artboard-fields.dom.test.tsx` supplies, for the same reason.
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

/** The record the host derives for every listed theme; no case here reads it. */
const FACETS: FacetRecord = {
  author: undefined,
  colourMode: "unclassified",
  sensors: [],
  tags: [],
  orientation: "landscape",
  aspect: "16:9",
  width: 1920,
  height: 1080,
};

/** A stored theme as these cases hand one to the chooser. */
function listedTheme(id: string, name: string): ThemeLibraryEntry {
  return { id, name, updatedAt: "", facets: FACETS };
}

/** A theme the host records a catalogue origin for — an installed one. */
const ORIGIN: ThemeOrigin = {
  catalogueId: "5f0c4f30-0f8c-4e4f-9c1f-1f0f0f0f0f0f",
  version: "1.2.0",
  installedAt: "2026-10-01T00:00:00.000Z",
};

function installedTheme(
  id: string,
  name: string,
  origin: ThemeOrigin = ORIGIN,
): ThemeLibraryEntry {
  return { ...listedTheme(id, name), origin };
}

/** Opens the chooser the way the session opens it. */
function open(
  themes: readonly ThemeLibraryEntry[],
  client?: ThemeLibraryClient,
): Promise<unknown> {
  let pending: Promise<unknown> | undefined;
  act(() => {
    pending = promptThemeSelection(
      themes,
      [STARTER_TEMPLATE],
      client === undefined ? undefined : { client },
    );
  });
  if (pending === undefined)
    throw new Error("promptThemeSelection returned nothing");
  return pending;
}

/** Opens the chooser, picks an option and presses Open — one journey. */
async function choose(
  value: string,
  themes: readonly ThemeLibraryEntry[] = [],
): Promise<unknown> {
  const pending = open(themes);
  await chooseIn("theme", value);
  await pressButton("[data-yunari-library-open]");
  return pending;
}

/** The confirmation, which is the topmost dialog once it opens. */
function topDialog(): HTMLElement {
  const dialogs = [
    ...document.querySelectorAll<HTMLElement>('[role="dialog"]'),
  ];
  const dialog = dialogs.at(-1);
  if (dialog === undefined) throw new Error("no dialog opened");
  return dialog;
}

describe("the library chooser", () => {
  it("lists the starter as a template and the author's themes as theirs", async () => {
    const pending = open([listedTheme("mine", "My theme")]);
    await openControl("theme");

    // A template is something the product offers; a saved theme is something the
    // author made. One undifferentiated list says neither.
    expect(groups().map((group) => group.label)).toEqual([
      uiCopy.library.templates,
      uiCopy.library.yourThemes,
    ]);
    expect(idsIn(uiCopy.library.templates)).toEqual([STARTER_TEMPLATE.id]);
    expect(idsIn(uiCopy.library.yourThemes)).toEqual(["mine"]);

    await pressButton("[data-yunari-library-cancel]");
    await expect(pending).resolves.toBeUndefined();
  });

  it("says which kind of thing was chosen, so the caller can tell them apart", async () => {
    await expect(choose(STARTER_TEMPLATE.id)).resolves.toEqual({
      kind: "template",
      id: STARTER_TEMPLATE.id,
    });
    await expect(
      choose("mine", [listedTheme("mine", "My theme")]),
    ).resolves.toEqual({
      kind: "theme",
      id: "mine",
    });
  });

  it("offers the template even when the author has saved nothing", async () => {
    const pending = open([]);
    await openControl("theme");
    expect(allOptionIds()).toEqual([STARTER_TEMPLATE.id]);
    await pressButton("[data-yunari-library-cancel]");
    await expect(pending).resolves.toBeUndefined();
  });

  it("offers a delete only for a theme, and never for a template", async () => {
    const removed: string[] = [];
    const pending = open([listedTheme("mine", "My theme")], {
      remove: async (id: string) => {
        removed.push(id);
      },
    } as unknown as ThemeLibraryClient);
    const del = deleteButton();

    // A template is not a stored theme: the host has no folder for it, so a
    // delete beside one would offer to remove something that was never there.
    expect(del.disabled).toBe(true);

    await chooseIn("theme", "mine");
    expect(del.disabled).toBe(false);

    // Pressing it opens the confirmation and removes nothing yet.
    await pressButton("[data-yunari-library-delete]");
    expect(removed).toEqual([]);
    await pressButtonIn(topDialog(), "[data-yunari-library-cancel]");

    await pressButton("[data-yunari-library-cancel]");
    await expect(pending).resolves.toBeUndefined();
  });

  it("offers a remix only for a theme the host knows a catalogue parent for", async () => {
    const pending = open([
      installedTheme("from-store", "Store theme"),
      listedTheme("mine", "My theme"),
    ]);
    const remix = remixButton();

    // A template has no catalogue parent, and neither has a theme the author
    // made here: a remix control beside either would invent provenance.
    expect(remix.disabled).toBe(true);

    await chooseIn("theme", "mine");
    expect(remix.disabled).toBe(true);

    await chooseIn("theme", "from-store");
    expect(remix.disabled).toBe(false);

    await pressButton("[data-yunari-library-cancel]");
    await expect(pending).resolves.toBeUndefined();
  });

  it("remixes the chosen theme from the parent its origin names", async () => {
    const pending = open([installedTheme("from-store", "Store theme")]);
    await chooseIn("theme", "from-store");
    await pressButton("[data-yunari-library-remix]");

    // The parent is the catalogue item the copy was installed from, and its
    // version is the one this copy holds — not a version the theme declares.
    await expect(pending).resolves.toEqual({
      kind: "remix",
      id: "from-store",
      remixOf: {
        catalogueId: ORIGIN.catalogueId,
        name: "Store theme",
        version: ORIGIN.version,
      },
    });
  });

  it("offers a duplicate only for a theme the host records no catalogue parent for", async () => {
    const pending = open([
      installedTheme("from-store", "Store theme"),
      listedTheme("mine", "My theme"),
    ]);
    const duplicate = duplicateButton();

    // A template is not a stored theme, and a theme with an origin gains Remix
    // instead: a duplicate beside either would offer a copy with no reason.
    expect(duplicate.disabled).toBe(true);

    await chooseIn("theme", "mine");
    expect(duplicate.disabled).toBe(false);

    await chooseIn("theme", "from-store");
    expect(duplicate.disabled).toBe(true);

    await pressButton("[data-yunari-library-cancel]");
    await expect(pending).resolves.toBeUndefined();
  });

  it("duplicates the chosen theme without inventing a parent", async () => {
    const pending = open([listedTheme("mine", "My theme")]);
    await chooseIn("theme", "mine");
    await pressButton("[data-yunari-library-duplicate]");

    // There is no catalogue item to name, so the answer carries only the id the
    // caller reads the theme by — no `remixOf`.
    await expect(pending).resolves.toEqual({ kind: "duplicate", id: "mine" });
  });

  it("confirms by name before removing, and the row goes afterwards", async () => {
    const removed: string[] = [];
    const pending = open([listedTheme("mine", "My theme")], {
      remove: async (id: string) => {
        removed.push(id);
      },
    } as unknown as ThemeLibraryClient);
    await chooseIn("theme", "mine");
    await pressButton("[data-yunari-library-delete]");

    // The confirm names the theme, because a destructive act the author cannot
    // see the target of is the thing they have to be stopped from.
    const confirm = topDialog();
    expect(confirm.textContent).toContain("My theme");
    // And says where it goes, which is the whole reason this is allowed.
    expect(confirm.textContent).toMatch(/recycle bin|trash/i);

    await pressButton("[data-yunari-library-delete-confirm]");
    await flush();

    expect(removed).toEqual(["mine"]);
    // The row is gone, so the author cannot open what is no longer there.
    await openControl("theme");
    expect(allOptionIds()).toEqual([STARTER_TEMPLATE.id]);

    // The chooser itself is still open: the author carries on with what is
    // theirs rather than being dropped out of the library.
    await pressButton("[data-yunari-library-cancel]");
    await expect(pending).resolves.toBeUndefined();
  });

  it("keeps the theme when the author backs out of the confirmation", async () => {
    const removed: string[] = [];
    const pending = open([listedTheme("mine", "My theme")], {
      remove: async (id: string) => {
        removed.push(id);
      },
    } as unknown as ThemeLibraryClient);
    await chooseIn("theme", "mine");
    await pressButton("[data-yunari-library-delete]");

    const confirm = topDialog();
    await pressButtonIn(confirm, "[data-yunari-library-cancel]");

    expect(removed).toEqual([]);
    await openControl("theme");
    expect(allOptionIds()).toContain("mine");

    await pressButton("[data-yunari-library-cancel]");
    await expect(pending).resolves.toBeUndefined();
  });

  it("dismisses only the confirmation on Escape, and leaves the chooser's promise open", async () => {
    const removed: string[] = [];
    const pending = open([listedTheme("mine", "My theme")], {
      remove: async (id: string) => {
        removed.push(id);
      },
    } as unknown as ThemeLibraryClient);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    await chooseIn("theme", "mine");
    // **Focused first, because a real click focuses a button and a dispatched
    // one does not.** Base UI restores the element its trap started on, so
    // without this the precondition the browser supplies is missing and the
    // assertion below would be measuring the harness rather than the dialog.
    deleteButton().focus();
    await pressButton("[data-yunari-library-delete]");
    const confirm = topDialog();

    // **The two roots are siblings** (`theme-library-dialog.tsx:159`, `:221`),
    // not nested, so this is a real question rather than a formality: Escape has
    // to take the confirmation and not the dialog underneath it. Losing the
    // chooser here would drop the author out of the library mid-decision, and
    // losing nothing would leave a confirmation on screen that answers nothing.
    await act(async () => {
      confirm.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await flush();

    expect(
      document.querySelector("[data-yunari-library-delete-confirm]"),
    ).toBeNull();
    // **Focus is back on the control that asked**, not on `body`: the
    // confirmation is a second `Dialog.Root` and Base UI restores the element
    // its own trap started on, so the author is one keystroke from the button
    // they pressed rather than at the top of the shell. Asserted on the
    // element, because a reading of `activeElement === body` is what an
    // unhandled dismissal looks like.
    expect(document.activeElement).toBe(deleteButton());
    // The chooser is still there, still holding the author's selection.
    await openControl("theme");
    expect(allOptionIds()).toContain("mine");
    expect(settled).toBe(false);
    expect(removed).toEqual([]);

    await pressButton("[data-yunari-library-cancel]");
    await expect(pending).resolves.toBeUndefined();
  });

  it("says why a removal failed, and keeps the theme listed", async () => {
    const pending = open([listedTheme("mine", "My theme")], {
      remove: async () => {
        throw new Error("This PC has no trash command (gio, trash-put)");
      },
    } as unknown as ThemeLibraryClient);

    // **Read as a live region, not as text.** The region is in the tree before
    // it has anything to say and says it by becoming visible; `textContent` on
    // the dialog cannot tell that from a node added along with its words,
    // because hidden text still counts. So this asserts the three states in
    // order — present, hidden and empty, then visible with the reason.
    expect(libraryStatus().isConnected).toBe(true);
    expect(libraryStatus().hidden).toBe(true);
    expect(libraryStatus().textContent).toBe("");

    await chooseIn("theme", "mine");
    await pressButton("[data-yunari-library-delete]");
    await pressButton("[data-yunari-library-delete-confirm]");
    await flush();

    // Nothing was lost, so the row stays and the reason is on screen: a silent
    // failure here would look exactly like a successful delete.
    await openControl("theme");
    expect(allOptionIds()).toContain("mine");
    expect(libraryStatus().hidden).toBe(false);
    expect(libraryStatus().textContent).toContain("no trash command");

    await pressButton("[data-yunari-library-cancel]");
    await expect(pending).resolves.toBeUndefined();
  });

  it("names itself, and names its control", async () => {
    const pending = open([]);
    const dialog = topDialog();

    expect(dialog.getAttribute("aria-label")).toBeTruthy();
    const trigger = dialog.querySelector("[data-yunari-library-theme]");
    if (trigger === null) throw new Error("no theme control");
    expect(
      trigger.getAttribute("aria-label") !== null ||
        dialog.querySelector(`label[for="${trigger.id}"]`) !== null,
    ).toBe(true);

    await pressButton("[data-yunari-library-cancel]");
    await expect(pending).resolves.toBeUndefined();
  });

  it("draws its answers in the dialog family's one button treatment", async () => {
    const pending = open([]);

    // Read off the rendered button rather than compared with the token, so a
    // dialog that stopped importing the treatment and wrote the string again is
    // caught. The four dialogs each had their own copy and this one had drifted:
    // its delete is the only one that is ever disabled, so its `disabled:` mark
    // is the variant the shared treatment had to keep.
    const button = document.querySelector<HTMLButtonElement>(
      "[data-yunari-library-open]",
    );
    if (button === null) throw new Error("no open button");
    expect(button.className).toContain("px-[var(--space-12)]");
    expect(button.className).toContain("enabled:hover:border-muted");
    expect(button.className).toContain("disabled:text-faint");

    await pressButton("[data-yunari-library-cancel]");
    await expect(pending).resolves.toBeUndefined();
  });
});

/**
 * A refused save has to be answered, not merely announced. The three ways out
 * matter separately: the two that act and the one that does not, because the
 * last is what keeps the author's document theirs while they decide.
 */
describe("promptThemeConflict", () => {
  function openConflict(): Promise<unknown> {
    let pending: Promise<unknown> | undefined;
    act(() => {
      pending = promptThemeConflict();
    });
    if (pending === undefined)
      throw new Error("promptThemeConflict returned nothing");
    return pending;
  }

  it.each(["reload", "overwrite"] as const)(
    "answers %s when the author picks it",
    async (choice) => {
      const pending = openConflict();
      const button = document.querySelector<HTMLButtonElement>(
        `[data-yunari-library-${choice}]`,
      );
      if (button === null) throw new Error(`no ${choice} button`);
      expect(button.textContent).toBeTruthy();

      await pressButton(`[data-yunari-library-${choice}]`);
      await expect(pending).resolves.toBe(choice);
    },
  );

  it("keeps both versions when the author says neither", async () => {
    const pending = openConflict();
    await pressButton("[data-yunari-library-cancel]");
    await expect(pending).resolves.toBeUndefined();
  });

  it("says the work is still there, and can be reached by keyboard", async () => {
    const pending = openConflict();
    const dialog = topDialog();

    // The refusal has to name what happened and what the author still holds.
    expect(dialog.textContent).toContain("still here");
    expect(dialog.getAttribute("aria-label")).toBeTruthy();
    for (const button of dialog.querySelectorAll("button")) {
      expect(button.type).toBe("button");
      expect(button.textContent).toBeTruthy();
    }

    await act(async () => {
      dialog.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await expect(pending).resolves.toBeUndefined();
  });
});

/** React and floating-ui schedule outside `act`, so a popup is flushed with
 *  macrotasks rather than one. */
async function flush(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function click(target: Element, detail = 0): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail }),
    );
  });
}

async function pointerDown(target: Element): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerType: "mouse",
        button: 0,
      }),
    );
  });
}

async function pressButton(selector: string): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>(selector);
  if (button === null) throw new Error(`no button matches ${selector}`);
  await click(button);
  await flush();
}

async function pressButtonIn(
  within: HTMLElement,
  selector: string,
): Promise<void> {
  const button = within.querySelector<HTMLButtonElement>(selector);
  if (button === null) throw new Error(`no button matches ${selector}`);
  await click(button);
  await flush();
}

/** A select's trigger, opened, and the options of its own popup. */
async function openControl(marker: string): Promise<readonly Element[]> {
  const trigger = document.querySelector<HTMLElement>(
    `[data-yunari-library-${marker}]`,
  );
  if (trigger === null) throw new Error(`no ${marker} control`);
  await click(trigger);
  await flush();
  if (trigger.getAttribute("aria-controls") === null) {
    await click(trigger);
    await flush();
  }
  const owned = document.getElementById(
    trigger.getAttribute("aria-controls") ?? "",
  );
  return Array.from((owned ?? document).querySelectorAll('[role="option"]'));
}

async function chooseIn(marker: string, id: string): Promise<void> {
  const options = await openControl(marker);
  const option = options.find(
    (candidate) => candidate.getAttribute("data-yunari-option") === id,
  );
  if (option === undefined) throw new Error(`no option ${id} in ${marker}`);
  await pointerDown(option);
  await click(option, 1);
  await flush();
}

function allOptionIds(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')].map(
    (option) => option.getAttribute("data-yunari-option") ?? "",
  );
}

/** The groups the open list is drawn in, each with the ids it holds. */
function groups(): { readonly label: string; readonly ids: string[] }[] {
  return [...document.querySelectorAll<HTMLElement>('[role="group"]')].map(
    (group) => ({
      label:
        document.getElementById(group.getAttribute("aria-labelledby") ?? "")
          ?.textContent ?? "",
      ids: [...group.querySelectorAll<HTMLElement>('[role="option"]')].map(
        (option) => option.getAttribute("data-yunari-option") ?? "",
      ),
    }),
  );
}

function idsIn(label: string): string[] {
  return groups().find((group) => group.label === label)?.ids ?? [];
}

function deleteButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(
    "[data-yunari-library-delete]",
  );
  if (button === null) throw new Error("no delete control");
  return button;
}

function remixButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(
    "[data-yunari-library-remix]",
  );
  if (button === null) throw new Error("no remix control");
  return button;
}

function duplicateButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(
    "[data-yunari-library-duplicate]",
  );
  if (button === null) throw new Error("no duplicate control");
  return button;
}

/** The chooser's own status region. Absent is a failure rather than a `null`:
 *  the finding it is here for is a region that is *only* mounted once it has
 *  something to say. */
function libraryStatus(): HTMLElement {
  const node = document.querySelector<HTMLElement>(
    "[data-yunari-library-status]",
  );
  if (node === null) throw new Error("no library status region");
  return node;
}
