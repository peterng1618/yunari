// @vitest-environment jsdom
/**
 * The controls a display's panel accepts: the section's own contract, mounted
 * without the region.
 *
 * **What this file owns.** That the status and the reconnect are drawn for a
 * panel whose device is not attached; that the controls answer presses only
 * while connected; that brightness travels as a whole percent and the panel's
 * answer is shown; that a level outside the range is refused here, before the
 * host is asked; that a restart costs two presses; and that a firmware the
 * driver has not met is warned about, with both versions readable.
 *
 * **The harness is the region's**: this workspace does not depend on
 * `@testing-library/react`, so the tree is mounted with `createRoot` and the
 * interactions are real DOM events. Base UI's popup needs the same two browser
 * APIs jsdom lacks.
 */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import type { PanelConnectionStatus } from "../theme-library-client.js";
import type { EditorPanelCommand, PanelHint } from "./client.js";
import { PanelControlsSection } from "./panel-controls-section.js";

const CONTROLLABLE: PanelHint = {
  vendorId: 0x1d6b,
  productId: 0x0106,
  serial: "S1",
  label: 'TURZX 5" Panel',
  held: true,
  heldId: "panel-1",
  commands: ["brightness", "screen", "restart", "status", "hello"],
  model: "chs_5inch",
  firmware: "1.88",
  support: {
    maker: "TURZX",
    hardwareRevision: "Rev C",
    supportedFirmware: ["1.88"],
    updatedAt: "2026-10-29",
  },
};

const ALL_COMMANDS = [
  "brightness",
  "screen",
  "panel-settings",
  "restart",
  "status",
  "hello",
];

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

// jsdom's selector engine cannot answer `:modal`/`:popover-open`, and floating-ui
// asks for both on every position — each unanswerable call costs about 0.5s of
// selector parsing, which is what turns one popup into a timeout.
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

let root: Root | undefined;
let host: HTMLDivElement | undefined;

async function unmount(): Promise<void> {
  const mounted = root;
  root = undefined;
  host?.remove();
  host = undefined;
  if (mounted !== undefined) await act(async () => mounted.unmount());
}

afterEach(async () => {
  await unmount();
});

async function mount(element: ReactElement): Promise<HTMLDivElement> {
  await unmount();
  const container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  host = container;
  await act(async () => {
    mounted.render(element);
  });
  return container;
}

/** A second render at the same element position, which is what selecting
 *  another display does before the region's own `key` replaces it. */
async function rerender(element: ReactElement): Promise<void> {
  const mounted = root;
  if (mounted === undefined) throw new Error("nothing mounted to rerender");
  await act(async () => {
    mounted.render(element);
  });
}

/** The section with the host's answer filled in, so each test states only the
 *  part it is about. */
function section(options: {
  readonly panel: PanelHint | undefined;
  readonly onCommand: (command: EditorPanelCommand) => Promise<string>;
  readonly status?: PanelConnectionStatus;
  readonly commands?: readonly string[];
  readonly onReconnect?: () => Promise<void>;
  readonly displayId?: string;
}): ReactElement {
  return (
    <PanelControlsSection
      displayId={options.displayId ?? "panel-1"}
      panel={options.panel}
      connection={{
        status: options.status ?? "connected",
        commands: options.commands ?? ALL_COMMANDS,
      }}
      onReconnect={options.onReconnect ?? (async () => undefined)}
      onCommand={options.onCommand}
    />
  );
}

/** A missing control is a defect this file names, rather than a `null` a later
 *  assertion reports as a wrong value. */
function must<T extends Element>(found: T | null, what: string): T {
  if (found === null) throw new Error(`the section rendered no ${what}`);
  return found;
}

/** The button whose visible words match, and none of the dialog's other
 *  buttons: a role query by accessible name, done against the text a person
 *  reads. */
function buttonNamed(pattern: RegExp): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((button) =>
    pattern.test((button.textContent ?? "").trim()),
  );
  return must(found ?? null, `button matching ${String(pattern)}`);
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click();
  });
}

/** Types into a controlled input the way a person does: the native setter
 *  bypasses React's value tracker, so the input event reads as a change. */
async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Picks an option the way the browser does: a value and a change event. */
async function selectInto(
  select: HTMLSelectElement,
  value: string,
): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function brightnessField(): HTMLInputElement {
  return must(
    document.querySelector<HTMLInputElement>("#yunari-panel-brightness"),
    "brightness field",
  );
}

function replyText(): string | null {
  return (
    document.querySelector("[data-yunari-panel-reply]")?.textContent ?? null
  );
}

function statusText(): string | null {
  return (
    document.querySelector("[data-yunari-panel-status] .sr-only")
      ?.textContent ??
    document.querySelector("[data-yunari-panel-status]")?.textContent ??
    null
  );
}

/** A promise the test settles by hand, so a command can be held in flight. */
function deferred<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("draws the disconnect state and the reconnect without an attached device", async () => {
  const onReconnect = vi.fn(async () => undefined);
  const container = await mount(
    section({
      panel: undefined,
      status: "disconnected",
      commands: [],
      onCommand: async () => "ok",
      onReconnect,
    }),
  );
  expect(statusText()).toContain("Disconnected");
  expect(container.textContent).toContain(
    "The host tries this panel again every 15 seconds.",
  );
  // No device is open, so there is no door whose commands could not work.
  expect(document.querySelector("[data-yunari-panel-controls]")).toBeNull();
  await click(buttonNamed(/^reconnect$/i));
  expect(onReconnect).toHaveBeenCalledTimes(1);
});

it("disables the reconnect while the host is already connecting", async () => {
  await mount(
    section({
      panel: undefined,
      status: "connecting",
      commands: [],
      onCommand: async () => "ok",
    }),
  );
  expect(statusText()).toContain("Connecting");
  expect(buttonNamed(/^reconnecting/i).disabled).toBe(true);
});

it("shows a reconnect failure beside the status it is about", async () => {
  const container = await mount(
    section({
      panel: undefined,
      status: "disconnected",
      commands: [],
      onCommand: async () => "ok",
      onReconnect: async () => {
        throw new Error("No such display.");
      },
    }),
  );
  await click(buttonNamed(/^reconnect$/i));
  const alert = must(container.querySelector('[role="alert"]'), "alert");
  expect(alert.textContent).toContain("No such display.");
});

it("sends brightness as a whole percent and shows the reply", async () => {
  const onCommand = vi.fn(async () => "ok");
  await mount(section({ panel: CONTROLLABLE, onCommand }));
  await click(buttonNamed(/controls/i));
  await typeInto(brightnessField(), "50");
  await click(buttonNamed(/apply/i));
  expect(onCommand).toHaveBeenCalledWith({ kind: "brightness", level: 50 });
  expect(replyText()).toBe("ok");
  // The label is what distinguishes device words from the host's own.
  expect(document.body.textContent).toContain("Panel reply");
});

it("sends the panel's stored settings as one command", async () => {
  const onCommand = vi.fn(async () => "");
  await mount(section({ panel: CONTROLLABLE, onCommand }));
  await click(buttonNamed(/controls/i));
  await selectInto(
    must(
      document.querySelector<HTMLSelectElement>("#yunari-panel-start-mode"),
      "start mode",
    ),
    "2",
  );
  await selectInto(
    must(
      document.querySelector<HTMLSelectElement>("#yunari-panel-sleep-delay"),
      "sleep delay",
    ),
    "3",
  );
  const flip = must(
    document.querySelector<HTMLInputElement>("#yunari-panel-flip"),
    "flip",
  );
  await act(async () => {
    flip.click();
  });
  await click(buttonNamed(/^apply settings$/i));

  // One packet carries all three; the brightness byte is the adapter's.
  expect(onCommand).toHaveBeenCalledWith({
    kind: "panel-settings",
    startMode: 2,
    flip: true,
    sleepDelay: 3,
  });
});

it("shows a host confirmation, not a reply, for a write-only command", async () => {
  // A write-only command (brightness) has no device answer. The empty reply is
  // the host confirming the command went, so the live region must not present
  // it as the panel's words.
  const onCommand = vi.fn(async () => "");
  await mount(section({ panel: CONTROLLABLE, onCommand }));
  await click(buttonNamed(/controls/i));
  await typeInto(brightnessField(), "50");
  await click(buttonNamed(/apply/i));
  expect(onCommand).toHaveBeenCalledWith({ kind: "brightness", level: 50 });
  expect(replyText()).toBe("Sent");
  expect(document.body.textContent).toContain("Last command");
});

it("blocks a level above 100 without calling the host", async () => {
  const onCommand = vi.fn(async () => "ok");
  await mount(section({ panel: CONTROLLABLE, onCommand }));
  await click(buttonNamed(/controls/i));
  await typeInto(brightnessField(), "101");
  await click(buttonNamed(/apply/i));
  expect(onCommand).not.toHaveBeenCalled();
  const alert = must(document.querySelector('[role="alert"]'), "alert");
  expect(alert.textContent).toMatch(/0 to 100/);
  // The refusal is the field's, so the field carries it: a screen reader
  // reaches the sentence through the input rather than as loose text below.
  const field = brightnessField();
  expect(field.getAttribute("aria-invalid")).toBe("true");
  expect(field.getAttribute("aria-describedby")).toBe(
    "yunari-panel-brightness-error",
  );
  expect(alert.getAttribute("id")).toBe("yunari-panel-brightness-error");
});

it("asks before restarting", async () => {
  const onCommand = vi.fn(
    async () =>
      "The panel is restarting; it will be unavailable for about 15 seconds.",
  );
  await mount(section({ panel: CONTROLLABLE, onCommand }));
  await click(buttonNamed(/controls/i));
  await click(buttonNamed(/^restart$/i));
  expect(onCommand).not.toHaveBeenCalled();
  await click(buttonNamed(/^confirm restart$/i));
  expect(onCommand).toHaveBeenCalledWith({ kind: "restart" });
});

it("shows nothing from a previous panel after the dialog is closed", async () => {
  const onCommand = vi.fn(async () => "ok");
  await mount(section({ panel: CONTROLLABLE, onCommand }));
  await click(buttonNamed(/controls/i));
  await click(buttonNamed(/query status/i));
  expect(replyText()).toBe("ok");
  await click(buttonNamed(/^close$/i));

  // The region keys the section by display, so selecting another one replaces
  // this tree; this renders the same position with a new panel to prove the
  // reopened dialog is clean either way.
  const second: PanelHint = {
    ...CONTROLLABLE,
    serial: "S2",
    label: "Second panel",
    heldId: "panel-2",
  };
  await rerender(section({ displayId: "panel-2", panel: second, onCommand }));
  await click(buttonNamed(/controls/i));
  expect(replyText()).toBe("");
  expect(brightnessField().value).toBe("");
});

it("ignores a second press while a command is in flight", async () => {
  const pending = deferred<string>();
  const onCommand = vi.fn(() => pending.promise);
  await mount(section({ panel: CONTROLLABLE, onCommand }));
  await click(buttonNamed(/controls/i));
  await typeInto(brightnessField(), "50");
  const apply = buttonNamed(/apply/i);
  await click(apply);
  await click(apply);
  expect(onCommand).toHaveBeenCalledTimes(1);
  await act(async () => {
    pending.resolve("ok");
  });
  expect(replyText()).toBe("ok");
});

it("drops a reply to a command the closed dialog abandoned", async () => {
  const pending = deferred<string>();
  const onCommand = vi.fn(() => pending.promise);
  await mount(section({ panel: CONTROLLABLE, onCommand }));
  await click(buttonNamed(/controls/i));
  await typeInto(brightnessField(), "50");
  await click(buttonNamed(/apply/i));
  await click(buttonNamed(/^close$/i));
  await click(buttonNamed(/controls/i));
  await act(async () => {
    pending.resolve("late answer");
  });
  expect(replyText()).toBe("");
});

it("shows the host's refusal in the dialog, in its words", async () => {
  const onCommand = vi.fn(async () => {
    throw new Error("Panel display strip is not running.");
  });
  await mount(section({ panel: CONTROLLABLE, onCommand }));
  await click(buttonNamed(/controls/i));
  await typeInto(brightnessField(), "50");
  await click(buttonNamed(/apply/i));
  const alert = must(document.querySelector('[role="alert"]'), "alert");
  expect(alert.textContent).toContain("Panel display strip is not running.");
});

it("returns focus to its trigger when the dialog closes", async () => {
  await mount(section({ panel: CONTROLLABLE, onCommand: async () => "ok" }));
  const trigger = buttonNamed(/controls/i);
  // jsdom's `click()` does not focus the button the way a browser's does, so
  // the trigger is focused first: the dialog's contract is to return focus to
  // whatever had it, and this is the element a person pressed.
  trigger.focus();
  await click(trigger);
  await click(buttonNamed(/^close$/i));
  // Base UI hands focus back after the popup is gone, on a timer rather than
  // in the click: a single tick is enough on an idle machine and not enough
  // under the full gate's load, so this waits for the focus to arrive with a
  // deadline rather than guessing the number of frames.
  await act(async () => {
    const deadline = Date.now() + 2000;
    while (document.activeElement !== trigger && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  });
  expect(document.activeElement).toBe(trigger);
});

it("warns when the firmware is outside the supported set", async () => {
  const container = await mount(
    section({
      panel: { ...CONTROLLABLE, firmware: "1.90" },
      onCommand: async () => "ok",
    }),
  );
  expect(container.textContent).toMatch(/1\.90/);
  expect(container.textContent).toMatch(/1\.88/);
  expect(
    must(
      container.querySelector("[data-yunari-panel-mismatch]"),
      "firmware warning",
    ).textContent,
  ).toMatch(/not one this panel is known to take/);
});
