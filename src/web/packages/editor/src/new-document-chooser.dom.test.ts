// @vitest-environment jsdom
// No colour literal appears in this file: every fixture is a value the chooser
// prints, so the design ratchet has nothing here to hold to a token.

/**
 * The new-theme chooser, measured against the enumeration taken from the
 * imperative dialog before a line of it was rewritten.
 *
 * **The size is the only question.** The preview lens is read off the artboard
 * the answer creates, so no display control exists here; the ratio,
 * orientation, resolution and free size are the one answer to how the document
 * is measured. **No native `select` survives**: every control is a
 * `ControlSelect` or `ControlPair`, whose list is a Base UI popup rather than
 * the platform's.
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

  it("asks for a size, and never for a preview lens", () => {
    // #461: the lens is read off the artboard the answer creates, so the
    // chooser offers no display question at all.
    void open();

    expect(control("display")).toBeNull();
    expect(control("ratio")).not.toBeNull();
    expect(control("orientation")).not.toBeNull();
    expect(control("resolution")).not.toBeNull();
  });

  it("opens a theme with no document on 16:9, at 1920 × 1080", async () => {
    // A product decision rather than an accident: `DEFAULT_ARTBOARD_PRESET` is
    // 16:9 landscape, and the camera derives the 16:9 lens from that artboard.
    const pending = open();

    expect(size()).toContain("1920 × 1080");

    create();
    await expect(pending).resolves.toEqual({
      size: { width: 1920, height: 1080 },
      shape: "rect",
    });
  });

  it("opens on the size of the document it would replace", async () => {
    const pending = open({ width: 1080, height: 2340 });

    expect(size()).toContain("1080 × 2340");
    expect(size()).not.toContain("1920 × 1080");

    create();
    await expect(pending).resolves.toEqual({
      size: { width: 1080, height: 2340 },
      shape: "rect",
    });
  });

  it("opens a 4:3 document on its own preset", async () => {
    const pending = open({ width: 1280, height: 960 });

    expect(read("ratio")).toBe("4:3");
    expect(read("orientation")).toBe("landscape");

    create();
    // The nearest preset the shape has, at the resolution it always opened at.
    await expect(pending).resolves.toEqual({
      size: { width: 1440, height: 1080 },
      shape: "rect",
    });
  });

  it("reads the shape the document it would replace is at", () => {
    // Shape is document data, not a preview: a round theme opens on Circle and
    // a square rectangular one on Rectangle.
    void open({ width: 1080, height: 1080, shape: "circle" });
    expect(read("shape")).toBe("circle");

    document.body.replaceChildren();
    void open({ width: 1080, height: 1080 });
    expect(read("shape")).toBe("rect");
  });

  it("creates a circle theme as a square at the current resolution", async () => {
    const pending = open();

    await chooseIn("shape", "circle");
    expect(size()).toContain("1080 × 1080");

    create();
    await expect(pending).resolves.toEqual({
      size: { width: 1080, height: 1080 },
      shape: "circle",
    });
  });

  it("a circle size stays square when one edge is typed", async () => {
    const pending = open();

    await chooseIn("shape", "circle");
    await type("width", "1200");

    // A disc is drawn on a square, so the edge the author did not type follows
    // the one they did. A pair that wrote only itself would answer a circle
    // with two sizes, which the validator refuses — the document would open and
    // throw on its first save.
    expect(size(), "the readout is square").toContain("1200 × 1200");
    expect(
      document.querySelector<HTMLInputElement>(
        "[data-yunari-new-document-height]",
      )?.value,
      "the height field shows the square's edge",
    ).toBe("1200");

    create();
    await expect(pending).resolves.toEqual({
      size: { width: 1200, height: 1200 },
      shape: "circle",
    });
  });

  it("hides Ratio and Orientation for a circle, and keeps Resolution", async () => {
    void open();

    await chooseIn("shape", "circle");

    // A disc is square whichever way up it is asked, so the two controls that
    // would say otherwise are not offered at all.
    expect(control("ratio")).toBeNull();
    expect(control("orientation")).toBeNull();
    expect(control("resolution")).not.toBeNull();
  });

  it("shows both selects again, keeping the square size, for a rectangle", async () => {
    const pending = open();

    await chooseIn("shape", "circle");
    await chooseIn("shape", "rect");

    expect(control("ratio")).not.toBeNull();
    expect(control("orientation")).not.toBeNull();
    expect(
      size(),
      "the circle's square size survives the switch back",
    ).toContain("1080 × 1080");

    create();
    await expect(pending).resolves.toEqual({
      size: { width: 1080, height: 1080 },
      shape: "rect",
    });
  });

  it("offers every size the dropdowns could express before", async () => {
    const pending = open();

    // The Custom reading is carried on each, disabled — asserted separately, so
    // here only the *choices* are listed.
    expect((await optionIds("ratio")).filter((value) => value !== "")).toEqual([
      "16:9",
      "19.5:9",
      "4:3",
      "1:1",
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
      shape: "rect",
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
      shape: "rect",
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
      shape: "rect",
      // 24:25 is no stored lens, so the chooser's offer travels with the answer:
      // adding it is what makes the camera frame this board exactly.
      savePreviewRatio: "24:25",
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

    // The controls stop claiming a preset the document is not at — except
    // orientation, which the numbers always name: a square reads landscape.
    expect({
      ratio: read("ratio"),
      orientation: read("orientation"),
      resolution: read("resolution"),
    }).toEqual({ ratio: "", orientation: "landscape", resolution: "" });

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
      shape: "rect",
    });
  });

  it("offers the Custom reading unselectably, the way the panel does", async () => {
    // A reading of the document, not a size an author can ask for: selectable,
    // it would either do nothing or strand them on a value that derives nothing.
    void open();

    for (const marker of ["ratio", "resolution"]) {
      expect(await optionDisabled(marker, ""), `${marker}'s Custom`).toBe(true);
    }
    // Orientation has no unnamed reading to offer: it is read off the numbers,
    // so every size has one of the two.
    expect(await optionIds("orientation")).toEqual(["landscape", "portrait"]);
  });

  it("reads the orientation off the typed numbers, and turns the board", async () => {
    void open();
    await type("width", "2000");
    await type("height", "3000");

    expect(read("orientation"), "a portrait size does not read portrait").toBe(
      "portrait",
    );

    // The other orientation is a turn, not a refusal: the board keeps its
    // numbers and swaps the edges.
    await chooseIn("orientation", "landscape");
    expect(size()).toContain("3000 × 2000");
    expect(read("orientation")).toBe("landscape");
  });

  it("names the stored lens that frames the size, and offers to add one that does not exist", async () => {
    const first = open();
    // 16:9 is in the default catalogue, so the theme will be framed through it
    // and there is nothing to add.
    expect(
      document.querySelector("[data-yunari-new-document-preview-ratio]")
        ?.textContent,
    ).toContain("16:9");
    expect(
      document.querySelector("[data-yunari-new-document-save-ratio]"),
    ).toBeNull();

    create();
    await expect(first).resolves.toEqual({
      size: { width: 1920, height: 1080 },
      shape: "rect",
    });
    await act(async () => {
      document.body.replaceChildren();
    });

    // 1920 × 2000 reduces to 24:25, which no default lens frames.
    const second = open();
    await type("width", "1920");
    await type("height", "2000");
    const offer = document.querySelector<HTMLElement>(
      "[data-yunari-new-document-save-ratio]",
    );
    expect(
      offer?.getAttribute("aria-checked"),
      "the offer does not start accepted",
    ).toBe("true");
    expect(
      document.querySelector(`label[for="${offer?.id ?? ""}"]`)?.textContent,
    ).toContain("24:25");

    // Declining it leaves the catalogue alone: the answer carries no ratio the
    // author did not ask for.
    await act(async () => {
      offer?.click();
    });
    expect(offer?.getAttribute("aria-checked")).toBe("false");
    create();
    await expect(second).resolves.toEqual({
      size: { width: 1920, height: 2000 },
      shape: "rect",
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
    expect(button.className).toContain("enabled:hover:border-muted");
  });
});

/** The chooser, opened the way the session opens it. */
function open(current?: {
  width: number;
  height: number;
  shape?: "rect" | "circle";
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

/** The control itself, or nothing when the chooser does not render it. */
function control(marker: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-yunari-new-document-${marker}]`,
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
