// @vitest-environment jsdom
import { RadioGroup } from "@base-ui/react/radio-group";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { ControlChoiceRow } from "./control-choice-row.js";

// jsdom has never had a `PointerEvent`, and Base UI re-dispatches a click
// through one to carry modifier state — the shim `control.dom.test.tsx` supplies
// for the same reason.
window.PointerEvent ??= MouseEvent as never;

// React only flushes work scheduled inside `act` when it has been told it is in
// a test; without this, `act` warns and the update lands after the assertion.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const CHOICES = ["editorial", "graphite"] as const;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

/** The same shape the Appearance tab mounts: one controlled group, one choice
 *  row per member. The group is the owner of which one is checked, which is the
 *  property these cases are about. */
function Harness({
  refused,
}: {
  readonly refused?: string;
}): React.JSX.Element {
  const [value, setValue] = useState<string>("editorial");
  return (
    <RadioGroup
      value={value}
      onValueChange={setValue}
      aria-label="Shell palette"
    >
      {CHOICES.map((entry) => (
        <ControlChoiceRow
          key={entry}
          label={entry}
          value={entry}
          swatch={<span data-swatch="" />}
          {...(refused === undefined ? {} : { refused })}
        />
      ))}
    </RadioGroup>
  );
}

async function mount(refused?: string): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      refused === undefined ? <Harness /> : <Harness refused={refused} />,
    );
  });
}

function row(name: string): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(
    `[aria-label="${name}"]`,
  );
  if (found === null) throw new Error(`no "${name}" row`);
  return found;
}

function group(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[role="radiogroup"]');
  if (found === null) throw new Error("no radiogroup");
  return found;
}

/** What every row says it is, in the group's order. */
function checked(): readonly string[] {
  return Array.from(
    group().querySelectorAll<HTMLElement>('[role="radio"]'),
  ).map(
    (radio) =>
      `${radio.getAttribute("aria-label")}:${radio.getAttribute("aria-checked")}`,
  );
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  document.body.replaceChildren();
});

it("marks exactly the one row the group holds, and one of them takes the Tab stop", async () => {
  await mount();

  expect(checked()).toEqual(["editorial:true", "graphite:false"]);
  // One Tab stop for the group rather than one per row: the composite gives the
  // checked row the tabindex and the arrows move within it, which is what the control set
  // means by "the installed primitive's keyboard model".
  const stops = Array.from(
    group().querySelectorAll<HTMLElement>('[role="radio"]'),
  ).filter((radio) => radio.getAttribute("tabindex") === "0");
  expect(stops.map((radio) => radio.getAttribute("aria-label"))).toEqual([
    "editorial",
  ]);
});

it("moves the selection with the arrow keys", async () => {
  await mount();
  const first = row("editorial");
  await act(async () => first.focus());

  await act(async () => {
    first.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
  });

  expect(checked()).toEqual(["editorial:false", "graphite:true"]);
});

it("a refused row keeps its place and its reason, and cannot be chosen", async () => {
  const reason = "not offered for this theme";
  await mount(reason);

  expect(document.body.textContent).toContain(reason);
  const refused = row("editorial");
  expect(refused.getAttribute("aria-disabled")).toBe("true");
  // Reachable, which the refusal rule requires: a natively disabled radio leaves the tab
  // order, and the reason would then reach nobody not holding a pointer.
  expect(refused.hasAttribute("disabled")).toBe(false);
  expect(refused.getAttribute("aria-describedby")).not.toBeNull();

  await act(async () => refused.click());

  expect(checked(), "a refused row was selected anyway").toEqual([
    "editorial:true",
    "graphite:false",
  ]);
});
