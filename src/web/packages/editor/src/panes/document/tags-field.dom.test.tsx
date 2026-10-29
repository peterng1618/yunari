// @vitest-environment jsdom
/**
 * The pick-or-propose field, measured on the rule that gives it its name:
 * **picking is the primary affordance and a proposal is the exception.**
 *
 * The cases below are the field's whole contract. It offers the vocabulary as
 * choices, commits what is picked, and refuses — visibly, and without committing
 * — the three ways a value can be wrong: a word the format does not take, a word
 * the theme already carries, and a sixth tag. Two cases are what the ordering
 * exists for: the committed order is the author's rather than the vocabulary's,
 * and a proposed word is drawn as one. The last two are the draft's keyboard
 * contract, which is `useDraftCommit`'s rather than this field's.
 */
import {
  MAX_TAGS,
  TAG_PATTERN,
  type ThemeMetadata,
} from "@yunari/renderer-core";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { hitTargetClasses } from "../../components/ui/control-well.js";
import { THEME_TAG_SEED } from "../../theme-tag-seed.js";
import { uiCopy } from "../../ui-copy.js";
import { MetadataFields } from "./metadata-fields.js";
import { TagsField } from "./tags-field.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** The vocabulary these cases pick from: the seed's own seven, so the case that
 *  refuses a sixth tag has an offered word left to press once the list is full
 *  — a fixture shorter than `MAX_TAGS` could not fill it. */
const VOCABULARY = THEME_TAG_SEED;

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let commits: (readonly string[])[] = [];

/** The field as the pane mounts it: controlled, so a commit flows back into the
 *  value the pills are drawn from rather than only being recorded. */
function Harness({
  initial,
}: {
  readonly initial: readonly string[];
}): React.JSX.Element {
  const [value, setValue] = useState<readonly string[]>(initial);
  return (
    <TagsField
      value={value}
      vocabulary={VOCABULARY}
      onCommit={(next) => {
        commits.push(next);
        setValue(next);
      }}
    />
  );
}

async function mount(initial: readonly string[] = []): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<Harness initial={initial} />));
}

beforeEach(() => {
  commits = [];
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  document.body.replaceChildren();
});

/** Every pill, in the order the field draws them. */
function pills(): HTMLButtonElement[] {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>("button[data-yunari-tag]"),
  );
}

/** The pill for one tag, which is the only handle a person has on it. */
function pill(tag: string): HTMLButtonElement {
  const found = pills().find(
    (candidate) => candidate.getAttribute("data-yunari-tag") === tag,
  );
  if (found === undefined) throw new Error(`no "${tag}" pill`);
  return found;
}

/** The propose field: the one input this control renders. */
function proposal(): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>(
    "[data-yunari-tag-proposal]",
  );
  if (found === null) throw new Error("the field renders no proposal input");
  return found;
}

function addButton(): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === uiCopy.panels.tagAdd,
  );
  if (found === undefined) throw new Error("the field renders no add button");
  return found;
}

/** What the field says beside itself, which is where a refusal is read. */
function shownRefusal(): string {
  return (
    document.querySelector<HTMLElement>('[id$="-invalid"]')?.textContent ?? ""
  );
}

/** A real edit, as React sees one. The value goes through the prototype's
 *  setter because React replaces `value` on the node with a tracker that would
 *  suppress a plain assignment. */
async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input) as HTMLInputElement,
      "value",
    )?.set;
    if (setter === undefined) input.value = value;
    else setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(target: Element): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
}

async function press(
  target: Element,
  key: string,
  init: KeyboardEventInit = {},
): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });
}

/** An IME boundary, as the browser reports one. */
async function composition(target: Element, phase: "start" | "end") {
  await act(async () => {
    target.dispatchEvent(
      new CompositionEvent(`composition${phase}`, { bubbles: true }),
    );
  });
}

/** Propose `tag` the way an author does: type it, then press Add. */
async function propose(tag: string): Promise<void> {
  await type(proposal(), tag);
  await click(addButton());
}

it("offers the vocabulary as choices", async () => {
  await mount();

  expect(pills().map((entry) => entry.getAttribute("data-yunari-tag"))).toEqual(
    [...VOCABULARY],
  );
  // None is held, so none is pressed: the list is the offer, not the value.
  expect(pills().map((entry) => entry.getAttribute("aria-pressed"))).toEqual(
    VOCABULARY.map(() => "false"),
  );
});

it("gives a pill the target §5 asks of a button, from the set's own owner", async () => {
  await mount();

  // The pill's own box is 22px, below §5's 24×24. A pill is a button rather
  // than a replaced element, so it takes the shared `::before` target — the
  // same token `control-segmented.tsx` uses at identical padding — instead of a
  // taller box the drawing does not give it.
  expect(pill("retro").className).toContain(hitTargetClasses);
});

it("commits a picked tag", async () => {
  await mount();

  await click(pill("retro"));

  expect(commits).toEqual([["retro"]]);
  expect(pill("retro").getAttribute("aria-pressed")).toBe("true");
});

it("refuses a sixth tag, and says why", async () => {
  // The fixture is as full as the format allows, read from `MAX_TAGS` rather
  // than from a second copy of the bound, and one offered word is left over.
  const full = THEME_TAG_SEED.slice(0, MAX_TAGS);
  const sixth = THEME_TAG_SEED[MAX_TAGS];
  expect(full, "the fixture is not a full list").toHaveLength(MAX_TAGS);
  expect(sixth, "the seed has no sixth word to press").toBeDefined();
  if (sixth === undefined) return;
  await mount(full);

  await click(pill(sixth));

  expect(commits, "a sixth tag was committed").toEqual([]);
  expect(shownRefusal()).toContain(uiCopy.panels.tagRefusedFull(MAX_TAGS));
});

it("refuses an uppercase proposal, and says why", async () => {
  await mount();

  await propose("Retro");

  expect(commits, "an invalid tag was committed").toEqual([]);
  expect(shownRefusal()).toBe(
    uiCopy.panels.tagRefusedShape("Retro", TAG_PATTERN.source),
  );
});

it("words the shape refusal from the pattern's own bounds", async () => {
  // The sentence is the table's, but its `1–24` is not: the bound is read off
  // the pattern it is handed, so a pattern that moves and a sentence that does
  // not cannot disagree. Fed a different pattern, the sentence says *its*
  // bounds — which a hardcoded `1–24` could not do.
  expect(uiCopy.panels.tagRefusedShape("Retro", "^[a-z]{2,9}$")).toContain(
    "2–9",
  );
  const bounds = /\{(\d+),(\d+)\}/.exec(TAG_PATTERN.source);
  expect(
    bounds,
    "TAG_PATTERN carries no bounds to word the refusal from",
  ).not.toBeNull();
  expect(uiCopy.panels.tagRefusedShape("Retro", TAG_PATTERN.source)).toContain(
    `${bounds?.[1]}–${bounds?.[2]}`,
  );
});

it("refuses a proposal already in the list rather than adding it twice", async () => {
  await mount(["retro"]);

  await propose("retro");

  expect(commits, "the tag was added a second time").toEqual([]);
  expect(shownRefusal()).toBe(uiCopy.panels.tagRefusedDuplicate("retro"));
});

it("removes a picked tag", async () => {
  await mount(["retro", "modern"]);

  await click(pill("retro"));

  expect(commits).toEqual([["modern"]]);
  expect(pill("retro").getAttribute("aria-pressed")).toBe("false");
});

it("keeps the committed order the author's, not the vocabulary's", async () => {
  await mount(["cityscape", "modern"]);

  // The value's own order first — `cityscape` is in no vocabulary this field was
  // given — and the vocabulary's remaining entries after it, in its own order.
  expect(pills().map((entry) => entry.getAttribute("data-yunari-tag"))).toEqual(
    [
      "cityscape",
      "modern",
      "futuristic",
      "retro",
      "elegant",
      "classic",
      "nature",
    ],
  );
});

it("draws a proposed tag as a proposal rather than as a picked one", async () => {
  await mount(["retro-diner"]);

  // The drawn reading: a dashed pill saying so, so a reader knows the word is
  // new rather than that the facet failed to match.
  const drawn = pill("retro-diner");
  expect(drawn.textContent).toBe(uiCopy.panels.tagsProposed("retro-diner"));
  expect(drawn.className).toContain("border-dashed");
  expect(pill("retro").className).not.toContain("border-dashed");
});

it("holds only tags the format accepts", () => {
  // The seed is the offline vocabulary rather than a schema, so what keeps it
  // honest is that every word in it is one the validator would take.
  expect(THEME_TAG_SEED.filter((tag) => !TAG_PATTERN.test(tag))).toEqual([]);
  expect(THEME_TAG_SEED).toHaveLength(7);
});

/**
 * The draft's keyboard contract, which is `useDraftCommit`'s (`vg-203`). Both
 * cases fail against a field that handles its own `onKeyDown`: the first
 * measured defect was Escape doing nothing, and the second was a half-typed IME
 * word being committed by the Enter that ends the composition.
 */
it("restores the empty box on Escape, and commits nothing for the draft", async () => {
  await mount();
  const box = proposal();
  box.focus();
  await type(box, "retro-diner");
  // A refusal the draft earned goes with the draft: the words beside the field
  // are about a value that is no longer there.
  await propose("Retro");
  await type(box, "retro-diner");

  await press(box, "Escape");

  expect(box.value, "Escape left the draft open").toBe("");
  expect(shownRefusal(), "Escape left a refusal standing").toBe("");
  expect(commits, "Escape committed the draft").toEqual([]);
});

it("does not commit on the Enter of a composition", async () => {
  await mount();
  const box = proposal();
  box.focus();
  await type(box, "retro-diner");
  await composition(box, "start");

  await press(box, "Enter");
  expect(commits, "a half-typed IME word was committed").toEqual([]);

  await composition(box, "end");
  await press(box, "Enter", { isComposing: true });
  expect(commits, "an Enter still carrying the composition committed").toEqual(
    [],
  );

  await press(box, "Enter");
  expect(commits, "the finished word did not commit").toEqual([
    ["retro-diner"],
  ]);
  expect(box.value, "the box kept a word it already committed").toBe("");
});

/**
 * The panel's half of the contract: the field is mounted where the brief puts
 * it, and an emptied list leaves the metadata **without** a `tags` key rather
 * than as `[]` — the shape a theme that declares no tags has, and the one the
 * validator and the facet both read.
 */
it("drops the key rather than writing an empty list", async () => {
  const committed: ThemeMetadata[] = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <MetadataFields
        metadata={{ themeLanguage: "en", tags: ["retro"] }}
        onCommit={(next) => committed.push(next)}
      />,
    ),
  );

  await click(pill("retro"));

  expect(committed).toHaveLength(1);
  const next = committed[0];
  if (next === undefined) throw new Error("the field committed nothing");
  expect(Object.hasOwn(next, "tags"), "an empty list was written").toBe(false);
  expect(next.themeLanguage).toBe("en");
});
