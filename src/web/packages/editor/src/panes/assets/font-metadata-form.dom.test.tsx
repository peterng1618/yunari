// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { uiCopy } from "../../ui-copy.js";
import {
  type FontMetadata,
  FontMetadataForm,
  fontMetadataFromFilename,
} from "./font-metadata-form.js";

// Base UI's popups need three browser APIs jsdom has none of — the same three
// `token-inspector.dom.test.tsx` supplies, for the same reason.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as never;
Element.prototype.getAnimations ??= (): never[] => [];
window.PointerEvent ??= MouseEvent as never;
// jsdom throws on the popover selector Base UI probes, and an exception there
// leaves the popup retrying forever rather than failing the case.
const matches = Element.prototype.matches;
Element.prototype.matches = Object.assign(function (
  this: Element,
  selector: string,
): boolean {
  if (selector === ":modal" || selector === ":popover-open") return false;
  return matches.call(this, selector);
}, matches);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLElement | undefined;

async function mount(element: React.ReactNode): Promise<void> {
  if (root !== undefined) await act(async () => root?.unmount());
  host?.remove();
  host = document.createElement("div");
  document.body.append(host);
  const mounted = createRoot(host);
  root = mounted;
  await act(async () => {
    mounted.render(element);
  });
}

afterEach(async () => {
  if (root !== undefined) await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
});

const field = (selector: string): HTMLInputElement =>
  host!.querySelector<HTMLInputElement>(selector)!;

/** A draft, as React sees one: the prototype setter, because React replaces
 *  `value` with a tracker that would suppress a plain assignment. */
async function draft(input: HTMLInputElement, value: string): Promise<void> {
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

/** Off the field, which commits a draft. Focus is taken in the same turn
 *  because jsdom fires `blur` only for an element that holds it. */
async function blur(input: HTMLInputElement): Promise<void> {
  await act(async () => {
    input.focus();
    input.blur();
  });
}

/** React and floating-ui schedule outside `act`, so a popup is flushed with
 *  macrotasks rather than one. */
async function flush(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function click(target: Element): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
  await flush();
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

/** Picks the option whose value is `id` — the id the control commits. */
async function chooseIn(control: string, id: string): Promise<void> {
  const trigger = host!.querySelector<HTMLElement>(control);
  if (trigger === null) throw new Error(`no control matches ${control}`);
  await click(trigger);
  const option = document.querySelector<HTMLElement>(
    `[role="option"][data-yunari-option="${id}"]`,
  );
  if (option === null) throw new Error(`no option ${id} in ${control}`);
  await pointerDown(option);
  await click(option);
}

const INITIAL: FontMetadata = fontMetadataFromFilename("Inter-Bold.ttf");

async function renderForm(
  onCommit = vi.fn(),
  onCancel = vi.fn(),
): Promise<{ readonly onCommit: ReturnType<typeof vi.fn> }> {
  await mount(
    <FontMetadataForm
      filename="Inter-Bold.ttf"
      initial={INITIAL}
      busy={false}
      onCommit={onCommit}
      onCancel={onCancel}
    />,
  );
  return { onCommit };
}

describe("fontMetadataFromFilename", () => {
  it("peels the cut's words and leaves the family", () => {
    expect(fontMetadataFromFilename("Inter-Bold.ttf")).toMatchObject({
      family: "Inter",
      weight: 700,
      style: "normal",
      licence: "unknown",
    });
    expect(fontMetadataFromFilename("Inter-Italic.ttf")).toMatchObject({
      family: "Inter",
      weight: 400,
      style: "italic",
    });
    expect(fontMetadataFromFilename("Manrope-Variable.woff2")).toMatchObject({
      family: "Manrope",
      weight: 400,
      style: "normal",
    });
  });
});

describe("the font metadata form", () => {
  it("prefills the family from Inter-Bold.ttf and sets weight 700", async () => {
    await renderForm();

    expect(field("[data-yunari-font-family]").value).toBe("Inter");
    expect(field("[data-yunari-font-weight]").value).toBe("700");
    expect(
      host!
        .querySelector("[data-yunari-font-style] [data-yunari-value]")
        ?.getAttribute("data-yunari-value"),
    ).toBe("normal");
  });

  it("prefills a thin cut at 100 and accepts it", async () => {
    // The parser maps `thin`/`100` to 100, so a floor above it pre-fills a
    // weight the form then refuses.
    const thin = fontMetadataFromFilename("Inter-Thin.woff2");
    expect(thin.weight).toBe(100);
    const onCommit = vi.fn();
    await mount(
      <FontMetadataForm
        filename="Inter-Thin.woff2"
        initial={thin}
        busy={false}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );

    expect(field("[data-yunari-font-weight]").value).toBe("100");
    await click(host!.querySelector("[data-yunari-font-create]")!);

    expect(onCommit).toHaveBeenCalledWith(
      { family: "Inter", weight: 100, style: "normal", licence: "unknown" },
      null,
    );
  });

  it("refuses an empty family and a weight outside 100–900", async () => {
    const { onCommit } = await renderForm();

    await draft(field("[data-yunari-font-family]"), "");
    await blur(field("[data-yunari-font-family]"));
    await click(host!.querySelector("[data-yunari-font-create]")!);

    expect(onCommit).not.toHaveBeenCalled();
    expect(host!.textContent).toContain(uiCopy.controls.valueRequired);

    await draft(field("[data-yunari-font-family]"), "Inter");
    await blur(field("[data-yunari-font-family]"));
    await draft(field("[data-yunari-font-weight]"), "1000");
    await blur(field("[data-yunari-font-weight]"));
    await click(host!.querySelector("[data-yunari-font-create]")!);

    expect(onCommit).not.toHaveBeenCalled();
    expect(host!.textContent).toContain(uiCopy.panels.invalidNumber);

    // A value inside the range commits: the refusal was about the value, not
    // about the press.
    await draft(field("[data-yunari-font-weight]"), "650");
    await blur(field("[data-yunari-font-weight]"));
    await click(host!.querySelector("[data-yunari-font-create]")!);

    expect(onCommit).toHaveBeenCalledWith(
      { family: "Inter", weight: 650, style: "normal", licence: "unknown" },
      null,
    );
  });

  it("commits the typed metadata and the chosen role", async () => {
    const { onCommit } = await renderForm();

    await chooseIn("[data-yunari-font-role]", "heading");
    await click(host!.querySelector("[data-yunari-font-create]")!);

    expect(onCommit).toHaveBeenCalledWith(
      { family: "Inter", weight: 700, style: "normal", licence: "unknown" },
      "heading",
    );
  });
});
