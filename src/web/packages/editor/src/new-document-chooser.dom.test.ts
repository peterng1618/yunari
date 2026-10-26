// @vitest-environment jsdom
// No colour literal appears in this file: every fixture is a value the chooser
// prints, so the design ratchet has nothing here to hold to a token.

/**
 * The new-theme chooser, measured against the enumeration taken from the
 * imperative dialog before a line of it was rewritten.
 *
 * **The preview and the size are independent answers now.** The first control
 * lists Fit and the active catalogue, and picking one changes only the preview;
 * the ratio, orientation, resolution and free size stay on screen and stay the
 * one answer to how the document is measured. **No native `select` survives**:
 * every control is a `ControlSelect` or `ControlPair`, whose list is a Base UI
 * popup rather than the platform's.
 *
 * The chooser is opened the way the session opens it — `chooseArtboardSize`,
 * which resolves with the answer or nothing for a dismissal — so an answer
 * asserted here is one `editor-session.ts` really receives.
 */

import { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PREVIEW_RATIO_TOKENS,
  setActivePreviewRatios,
} from "./display-lens.js";
import {
  chooseArtboardSize,
  type NewDocumentAnswer,
} from "./new-document-chooser.js";

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
  setActivePreviewRatios(DEFAULT_PREVIEW_RATIO_TOKENS);
});

describe("the new-document chooser", () => {
  it("names itself, and every control it holds is labelled", () => {
    void open();
    const dialog = opened();

    // A dialog with no accessible name is announced as "dialog" and nothing
    // else, which is the one thing an author pressing New needs to hear.
    expect(dialog.getAttribute("aria-label")).toBeTruthy();
    // Base UI renders a value carrier behind each select — `aria-hidden`, out of
    // the accessibility tree by construction — so the audit is over the controls
    // a person can reach.
    for (const control of dialog.querySelectorAll("button, input")) {
      if (control.getAttribute("aria-hidden") === "true") continue;
      const labelled =
        control.getAttribute("aria-label") !== null ||
        (control.id !== "" &&
          document.querySelector(`label[for="${control.id}"]`) !== null) ||
        (control.textContent ?? "").trim() !== "";
      expect(labelled, control.outerHTML).toBe(true);
    }
  });

  it("asks what the theme is for first, and offers Fit beside the catalogue", async () => {
    // The first control is the question, and every display the catalogue holds
    // is on it — every ratio, each way up — with Fit first because a theme may
    // be made for no particular screen.
    void open();

    expect(await optionIds("display")).toEqual([
      "",
      "16:9",
      "19.5:9",
      "4:3",
      "1:1",
      "Circle",
      "9:16",
      "9:19.5",
      "3:4",
    ]);
    expect(await optionName("display", ""), "Fit is the empty id").toBe("Fit");
    // The size no longer hides behind a Custom *entry*: the technical controls
    // are always on screen, so there is no second way to reach them.
    expect(await optionName("display", "16:9")).toBe("16:9");
  });

  /** The headings the six previews are grouped under, in the order offered.
   *
   *  A select cannot draw headings of its own, so a group is the only grouping
   *  it can have — and without one, six bare ratios read as one undifferentiated
   *  list. The order is the artboard's own orientation, read through the one
   *  predicate, so a portrait document is not handed the landscape half first. */
  it.each([
    [
      { width: 1920, height: 1080 },
      ["Landscape", "Portrait"],
      ["16:9", "9:16"],
    ],
    [
      { width: 1080, height: 2340 },
      ["Portrait", "Landscape"],
      ["9:16", "16:9"],
    ],
    // A square is not taller than wide, so it takes landscape.
    [
      { width: 1000, height: 1000 },
      ["Landscape", "Portrait"],
      ["16:9", "9:16"],
    ],
  ] as const)(
    "groups the displays by orientation for a %o artboard",
    async (current, labels, leading) => {
      void open(current);
      await openControl("display");

      expect(displayGroups(), "the two groups, in order").toEqual(labels);
      expect(leadingPerGroup()).toEqual(leading);
    },
  );

  it("opens a theme with no document on 16:9, at 1920 × 1080", async () => {
    // A product decision rather than an accident: `DEFAULT_ARTBOARD_PRESET` is
    // 16:9 landscape, and it lands on the 16:9 lens. That is the honest frame
    // because the starter theme is also 16:9.
    const pending = open();

    expect(read("display")).toBe("16:9");
    expect(size()).toContain("1920 × 1080");

    create();
    await expect(pending).resolves.toEqual({
      size: { width: 1920, height: 1080 },
      display: "16:9",
    });
  });

  it("opens on the display the document it would replace is at", async () => {
    // 9:19.5 is 19.5:9 stood upright, so it is offered back rather than reset.
    const pending = open({ width: 1080, height: 2340 });

    expect(read("display")).toBe("9:19.5");
    // And the size it would actually produce, so the carry-over is visible
    // rather than something the author has to infer from a dropdown.
    expect(size()).toContain("1080 × 2340");
    expect(size()).not.toContain("1920 × 1080");

    create();
    await expect(pending).resolves.toEqual({
      size: { width: 1080, height: 2340 },
      display: "9:19.5",
    });
  });

  it("opens a 4:3 document on the 4:3 preview, because there is one now", async () => {
    const pending = open({ width: 1280, height: 960 });

    expect(read("display")).toBe("4:3");
    expect(read("ratio")).toBe("4:3");
    expect(read("orientation")).toBe("landscape");

    create();
    // The nearest preset the shape has, at the resolution it always opened at,
    // seen through the lens of that shape.
    await expect(pending).resolves.toEqual({
      size: { width: 1440, height: 1080 },
      display: "4:3",
    });
  });

  it.each([
    ["19.5:9", { width: 1920, height: 1080 }],
    ["9:19.5", { width: 1920, height: 1080 }],
    ["4:3", { width: 1920, height: 1080 }],
    ["9:16", { width: 1920, height: 1080 }],
    ["3:4", { width: 1920, height: 1080 }],
    ["Circle", { width: 1920, height: 1080 }],
  ] as const)(
    "picking %s changes the preview and leaves the size alone",
    async (lens, expected) => {
      const pending = open();

      await chooseIn("display", lens);
      create();

      await expect(pending).resolves.toEqual({ size: expected, display: lens });
    },
  );

  it("keeps the technical question on screen, whichever preview is picked", async () => {
    void open();

    // A display answers what the theme is *for*; the ratio, orientation and
    // resolution answer how it is measured. The second is not a corner of the
    // first any more — both are always there.
    expect(customQuestion().hidden).toBe(false);

    await chooseIn("display", "");
    expect(customQuestion().hidden).toBe(false);
    expect(read("display"), "the control took Fit").toBe("");
  });

  it("leaves the technical controls naming the size, not the preview", async () => {
    // The preview and the size are independent answers: picking a lens must not
    // rewrite the size the author already has on screen.
    void open();

    await chooseIn("display", "9:19.5");
    expect({
      ratio: read("ratio"),
      orientation: read("orientation"),
      resolution: read("resolution"),
    }).toEqual({
      ratio: "16:9",
      orientation: "landscape",
      resolution: "1080p",
    });
    expect(size()).toContain("1920 × 1080");
  });

  it("offers every size the dropdowns could express before", async () => {
    const pending = open();

    // The Custom reading is carried on each, disabled — asserted separately, so
    // here only the *choices* are listed.
    expect((await optionIds("ratio")).filter((value) => value !== "")).toEqual([
      "16:9",
      "19.5:9",
      "4:3",
    ]);
    expect(
      (await optionIds("orientation")).filter((value) => value !== ""),
    ).toEqual(["landscape", "portrait"]);
    expect(
      (await optionIds("resolution")).filter((value) => value !== ""),
    ).toEqual(["1080p", "2k", "4k"]);

    // The three still combine into a size on screen, so no preset became a
    // guess an author has to commit to before seeing the number.
    await chooseIn("ratio", "19.5:9");
    expect(size()).toContain("2340 × 1080");
    await chooseIn("orientation", "portrait");
    expect(size()).toContain("1080 × 2340");
    await chooseIn("resolution", "4k");
    expect(size()).toContain("2160 × 4680");

    create();
    await expect(pending).resolves.toEqual({
      size: { width: 2160, height: 4680 },
      display: "16:9",
    });
  });

  it("accepts a size no preset names", async () => {
    // The chooser has never been able to do this — the three dropdowns only
    // name presets. A 4000 × 4000 theme has to be authorable from the question,
    // not only from the panel afterwards.
    const pending = open();

    await type("width", "4000");
    await type("height", "4000");

    // And the number on screen is the one being created, live. A confirmed
    // size that disagrees with the readout is the whole class of defect this
    // dialog exists to remove.
    expect(size()).toContain("4000 × 4000");

    create();
    await expect(pending).resolves.toEqual({
      size: { width: 4000, height: 4000 },
      display: "16:9",
    });
  });

  it("refuses a size that is not a dimension, rather than creating one", async () => {
    const pending = open();
    await type("height", "2000");

    // `Number("")` is 0 and `Number("1600.5")` is 1600.5: a field that coerced
    // either would open a document nobody sized. The field keeps the rejected
    // draft and refuses it in words; what the chooser confirms is the width the
    // field last accepted, not the one typed.
    await type("width", "");
    await type("width", "1600.5");

    create();
    await expect(pending).resolves.toEqual({
      size: { width: 1920, height: 2000 },
      display: "16:9",
    });
  });

  it("keeps a typed size when an unrelated control changes", async () => {
    // The finding: the old chooser never wrote the three dropdowns, so they kept
    // reading whichever preset was last chosen. Type 3000 × 3000, touch
    // resolution, and the old code ran `derive("16:9", …, "4k")` — 3840 × 2160,
    // silently, from a ratio the author never chose.
    const chooserErrors: string[] = [];
    window.addEventListener("error", (event) =>
      chooserErrors.push(String(event.message)),
    );
    const pending = open();
    await type("width", "3000");
    await type("height", "3000");

    // The controls stop claiming a preset the document is not at.
    expect({
      ratio: read("ratio"),
      orientation: read("orientation"),
      resolution: read("resolution"),
    }).toEqual({ ratio: "", orientation: "", resolution: "" });

    await chooseIn("resolution", "4k");
    expect(size(), "the author's own size is still on screen").toContain(
      "3000 × 3000",
    );
    // **The refusal is a refusal, not a crash.** The control is put back to its
    // reading, so the refusal is visible as one rather than the derive simply
    // not having run.
    expect(
      read("resolution"),
      "the control is put back, so the refusal is visible as one",
    ).toBe("");
    expect(chooserErrors).toEqual([]);

    create();
    await expect(pending).resolves.toEqual({
      size: { width: 3000, height: 3000 },
      display: "16:9",
    });
  });

  it("offers the Custom reading unselectably, the way the panel does", async () => {
    // A reading of the document, not a size an author can ask for: selectable,
    // it would either do nothing or strand them on a value that derives nothing.
    void open();

    for (const marker of ["ratio", "orientation", "resolution"]) {
      expect(await optionDisabled(marker, ""), `${marker}'s Custom`).toBe(true);
    }
  });

  it("lists the active catalogue, and no Custom entry beside it", async () => {
    setActivePreviewRatios(["1:1", "Circle"]);

    void open();
    expect(await optionIds("display")).toEqual(["", "1:1", "Circle"]);
    expect(
      await optionName("display", ""),
      "Fit is the empty id rather than a Custom size",
    ).toBe("Fit");
    for (const id of await optionIds("display")) {
      expect(await optionName("display", id)).not.toBe("Custom size");
    }
  });

  it("opens on Fit when the catalogue holds no lens for the shape", async () => {
    // A user-managed list cannot guarantee every artboard shape a preview, so
    // the opening lens is optional rather than a throw.
    setActivePreviewRatios(["1:1"]);
    const pending = open({ width: 1280, height: 960 });

    expect(read("display")).toBe("");
    create();
    await expect(pending).resolves.toEqual({
      size: { width: 1440, height: 1080 },
      display: undefined,
    });
  });

  it("cancels to no choice and closes, so a New pressed by accident changes nothing", async () => {
    const pending = open();
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>("[data-yunari-new-document-cancel]")
        ?.click();
    });

    await expect(pending).resolves.toBeUndefined();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("dismisses on Escape, one dialog at a time", async () => {
    const pending = open();
    const dialog = opened();
    await act(async () => {
      dialog.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    await expect(pending).resolves.toBeUndefined();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("draws its answers in the dialog family's one button treatment", () => {
    void open();

    // Read off the rendered button rather than compared with the token, so a
    // dialog that stopped importing the treatment and wrote the string again is
    // caught. The four dialogs each had their own copy and one had already
    // drifted, which is the divergence this reads for.
    const button = document.querySelector<HTMLButtonElement>(
      "[data-yunari-new-document-create]",
    );
    if (button === null) throw new Error("no create button");
    expect(button.className).toContain("px-[var(--space-12)]");
    expect(button.className).toContain("enabled:hover:border-accent");
  });
});

/** The chooser, opened the way the session opens it. */
function open(current?: {
  width: number;
  height: number;
}): Promise<NewDocumentAnswer | undefined> {
  let pending: Promise<NewDocumentAnswer | undefined> | undefined;
  act(() => {
    pending = chooseArtboardSize(current);
  });
  if (pending === undefined) {
    throw new Error("chooseArtboardSize returned nothing");
  }
  return pending;
}

/** The chooser dialog, or a failure saying it did not open. */
function opened(): HTMLElement {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  if (dialog === null) throw new Error("the chooser did not open");
  return dialog;
}

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

/** Base UI commits a list item only when the press that precedes the click
 *  started on it, so the press is part of the interaction. */
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

/** A select's trigger, opened, and the options of *its* popup: Base UI renders
 *  none until the control is open, and a second popup left standing would
 *  otherwise lend its options to whatever is read next. */
async function openControl(marker: string): Promise<readonly Element[]> {
  const trigger = document.querySelector<HTMLElement>(
    `[data-yunari-new-document-${marker}]`,
  );
  if (trigger === null) throw new Error(`no ${marker} control`);
  await click(trigger);
  await flush();
  // A list left standing from an earlier read is dismissed by the press that
  // was meant to open this one, so the press is repeated until this control is
  // the open one.
  if (trigger.getAttribute("aria-controls") === null) {
    await click(trigger);
    await flush();
  }
  const owned = document.getElementById(
    trigger.getAttribute("aria-controls") ?? "",
  );
  return Array.from((owned ?? document).querySelectorAll('[role="option"]'));
}

/** Picks the option whose value is `id` — the id the control commits, never the
 *  label it prints. */
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

/** Opens a control and reports its option ids, in the order offered. */
async function optionIds(marker: string): Promise<string[]> {
  return (await openControl(marker)).map(
    (option) => option.getAttribute("data-yunari-option") ?? "",
  );
}

async function optionName(
  marker: string,
  id: string,
): Promise<string | undefined> {
  const options = await openControl(marker);
  return options
    .find((option) => option.getAttribute("data-yunari-option") === id)
    ?.textContent?.trim();
}

async function optionDisabled(marker: string, id: string): Promise<boolean> {
  const options = await openControl(marker);
  const option = options.find(
    (candidate) => candidate.getAttribute("data-yunari-option") === id,
  );
  return (
    option?.getAttribute("aria-disabled") === "true" ||
    option?.hasAttribute("data-disabled") === true
  );
}

/** Each group's own label, read through the id the group is named by — Base UI
 *  marks the label `aria-hidden` and points the group's `aria-labelledby` at
 *  it, so its `textContent` is the heading and not the options beneath it. */
function displayGroups(): string[] {
  return groupLabels().map((element) => element.textContent?.trim() ?? "");
}

function groupLabels(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="group"]')].flatMap(
    (group) => {
      const id = group.getAttribute("aria-labelledby") ?? "";
      const label = document.getElementById(id);
      return label === null ? [] : [label];
    },
  );
}

function leadingPerGroup(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[role="group"]')].map(
    (group) =>
      group
        .querySelector<HTMLElement>('[role="option"]')
        ?.getAttribute("data-yunari-option") ?? "",
  );
}

/** The value a control commits, read off the element that prints it. */
function read(marker: string): string {
  const trigger = document.querySelector<HTMLElement>(
    `[data-yunari-new-document-${marker}]`,
  );
  return (
    trigger
      ?.querySelector("[data-yunari-value]")
      ?.getAttribute("data-yunari-value") ?? ""
  );
}

function customQuestion(): HTMLElement {
  const custom = document.querySelector<HTMLElement>(
    "[data-yunari-new-document-custom]",
  );
  if (custom === null) throw new Error("the chooser has no Custom question");
  return custom;
}

/** What the readout says. */
function size(): string {
  return (
    document.querySelector("[data-yunari-new-document-size]")?.textContent ?? ""
  );
}

function create(): void {
  document
    .querySelector<HTMLButtonElement>("[data-yunari-new-document-create]")
    ?.click();
}

/** A real edit, as React sees one: focus, the value through the prototype's
 *  setter — React's tracker records every assignment — and an `input` event,
 *  then a blur, which is what commits the draft. */
async function type(marker: string, text: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>(
    `[data-yunari-new-document-${marker}]`,
  );
  if (input === null) throw new Error(`no ${marker} field`);
  await act(async () => {
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input.blur();
  });
}
