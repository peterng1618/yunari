// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  resolveShortcuts,
  setActiveShortcuts,
} from "../shortcut-manager/bindings.js";
import {
  shortcutLabel,
  shortcutSpokenLabel,
} from "../shortcut-manager/display.js";
import {
  PRODUCT_SHORTCUTS,
  type ShortcutBinding,
} from "../shortcut-manager/index.js";
import { uiCopy } from "../ui-copy.js";
import { HostingStore } from "./hosting-store.js";
import { PublishControl } from "./publish-control.js";
import type { EditorActionFacade } from "./session-facade.js";
import { PublishSurfaceStore } from "./shell-stores.js";

const CODE = "ABC234";
const EXPIRES = "2026-10-08T00:00:00.000Z";
const ADDRESS = "192.168.1.42";
const PORT = 5227;
/** The URL the symbol carries: the page a phone opens, with the code in it.
 *  https, because that is the origin the display is a secure context at. */
const PAIR_URL = `https://${ADDRESS}:${PORT}/pair?code=${CODE}`;

// Base UI's popover needs two browser APIs jsdom has none of: floating-ui
// observes its anchor, and the popup waits for its own open transition before
// reporting itself open. Without them the press below never settles.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as never;
Element.prototype.getAnimations ??= (): never[] => [];

// jsdom's selector engine cannot answer `:modal`/`:popover-open`, and
// floating-ui asks for both on every position. Each unanswerable call costs
// ~0.5s of selector parsing, which turns one open into tens of seconds. Real
// browsers answer both.
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

/** What a display would be shown for a stored document, in the envelope shape
 *  `publishableDocument()` answers. */
function publishableOf(document: {
  readonly id: string;
  readonly name: string;
}): {
  readonly id: string;
  readonly envelope: {
    readonly id: string;
    readonly artboard: { readonly width: number; readonly height: number };
    readonly metadata: { readonly name: string };
  };
} {
  return {
    id: document.id,
    envelope: {
      id: document.id,
      artboard: { width: 1920, height: 1080 },
      metadata: { name: document.name },
    },
  };
}

/** A session that answers only what the surface asks it. The two methods are
 *  the whole of this control's conversation with the document; the other
 *  twenty are the shell's and are not reachable from here. */
function sessionShowing(
  document: { readonly id: string; readonly name: string } | undefined,
): EditorActionFacade {
  return {
    publishableDocument: () =>
      document === undefined ? undefined : publishableOf(document),
    subscribeDocumentChange: () => () => undefined,
  } as unknown as EditorActionFacade;
}

/** A session whose document changes on demand, and a counter of how often the
 *  control asked what would be published — the whole cost this task removes. */
function watchedSession(initial: {
  readonly id: string;
  readonly name: string;
}) {
  let document = initial;
  const listeners = new Set<() => void>();
  const read = vi.fn(() => publishableOf(document));
  const session = {
    publishableDocument: read,
    subscribeDocumentChange: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  } as unknown as EditorActionFacade;
  return {
    session,
    read,
    /** An edit landed: the document moved, and every subscriber is told. */
    change(next: { readonly id: string; readonly name: string }): void {
      document = next;
      for (const listener of listeners) listener();
    },
  };
}

/** The publication transport the header hands in. The control starts and stops
 *  it; neither is this control's subject here. */
const publishStub = {
  start: (): void => undefined,
  stop: async (): Promise<void> => undefined,
};

/**
 * A host whose state actually **moves**.
 *
 * The stub this replaced answered every `/api/hosting` request — the PUT
 * included — with the same body, so the host never changed and no test could
 * tell "opened the surface" from "moved the host". That is exactly the
 * difference the trigger is not allowed to blur, so the PUT here rebinds and
 * every read after it reports where the host landed.
 */
function hostServing(options: {
  readonly lan: boolean;
  readonly address?: string;
  /** The stable name the host offers, or none — which is what a host on a
   *  platform with no mDNS name answers. */
  readonly name?: string;
  readonly port?: number;
  /** Refuse the PUT itself, in the host's own words. */
  readonly refuse?: string;
  /** Accept the PUT and move nothing, leaving the refusal to arrive on the read
   *  that follows — the shape `vg-173` gives a host that cannot rebind while
   *  its answer is still on the socket. */
  readonly refusalAfterPut?: string;
}): { readonly putCalls: () => number } {
  const where = options.address ?? ADDRESS;
  const named = options.name ?? null;
  const at = options.port ?? PORT;
  let lan = options.lan;
  let refusal: string | null = null;
  let puts = 0;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      // The code is read, never minted: the editor has no mint left, and the
      // host is the only thing that owns the window.
      if (url.startsWith("/api/pairing/code")) {
        return new Response(
          JSON.stringify({ code: CODE, expiresAt: EXPIRES }),
          {
            status: 200,
          },
        );
      }

      if (init?.method === "PUT") {
        puts += 1;
        if (options.refuse !== undefined) {
          return new Response(options.refuse, { status: 409 });
        }
        if (options.refusalAfterPut === undefined) {
          lan = (JSON.parse(String(init.body)) as { lan: boolean }).lan;
        } else {
          refusal = options.refusalAfterPut;
        }
      }

      return new Response(
        JSON.stringify({
          lan,
          address: lan ? where : null,
          name: named,
          port: lan ? at : null,
          refusal,
          sessions: [],
        }),
        { status: 200 },
      );
    }),
  );

  return { putCalls: () => puts };
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;
/** The open flag the header's chord writes. Held here so a case can drive the
 *  popover the way `createShellLayout().showPublishing()` does. */
let surface: PublishSurfaceStore | undefined;

/** Base UI portals the popover to `body`, outside the mount point, so this is
 *  what removes the surface a test just read. */
function teardown(): void {
  if (root !== undefined) act(() => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  for (const stray of document.querySelectorAll(".editor-shell-positioner")) {
    stray.remove();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  teardown();
  // The live binding table is module state: a case that rebinds puts it back.
  setActiveShortcuts(PRODUCT_SHORTCUTS);
});

/** The control as the header mounts it. `createRoot` rather than
 *  `@testing-library/react`, which this workspace does not depend on. The store
 *  asks the host on construction, so the fetch stub is already in place. The
 *  transport is a stub unless a case is about its absence. */
async function mount(
  session?: EditorActionFacade,
  withTransport = true,
): Promise<HTMLDivElement> {
  const mounted = document.createElement("div");
  host = mounted;
  document.body.append(mounted);
  const created = createRoot(mounted);
  root = created;
  const hosting = new HostingStore();
  const opened = new PublishSurfaceStore();
  surface = opened;
  await act(async () =>
    created.render(
      <PublishControl
        session={session}
        publish={withTransport ? publishStub : undefined}
        hosting={hosting}
        surface={opened}
      />,
    ),
  );
  await vi.waitFor(() =>
    expect(mounted.querySelector("[data-yunari-publish]")).not.toBeNull(),
  );
  return mounted;
}

/** The same control mounted afresh, which is what a reloaded editor does. The
 *  surface reads the host once when it is built, so a *new* answer is read by a
 *  *new* store behind a *new* control. */
async function remount(): Promise<HTMLDivElement> {
  teardown();
  return mount();
}

/** The bar's own control. Everything else on this surface is behind it. */
function headerControl(container: HTMLElement): HTMLElement | null {
  return container.querySelector("[data-yunari-publish]");
}

/** The host switch, which is the popover's and never the bar's. */
function hostSwitch(): HTMLElement | null {
  return document.querySelector("[data-yunari-host-switch]");
}

/** The press that opens the surface. */
async function openSurface(container: HTMLElement): Promise<void> {
  await act(async () => headerControl(container)?.click());
  await vi.waitFor(() => expect(popupOpen()).toBe(true));
}

/** The popover's own text. It is portalled to `body`, so the mount point's own
 *  `textContent` holds none of it. */
function popupText(): string {
  return (
    document.querySelector(".editor-shell-publish-popup")?.textContent ?? ""
  );
}

/** Whether the popover is showing. The popup is not in the DOM at all until it
 *  is asked for, so its presence and its `data-open` are the same answer. */
function popupOpen(): boolean {
  return (
    document.querySelector(".editor-shell-publish-popup[data-open]") !== null
  );
}

it("prints the publish chord on the header control, from the live table", async () => {
  // §7.1's mark, and plan 2 left it off because there was nothing to run. It is
  // printed here and only here because this is the commit that binds
  // `publish.surface` to the act the control itself performs — a printed chord
  // that runs nothing is the state that was deliberately not shipped.
  hostServing({ lan: true });
  const container = await mount();

  const chip = container.querySelector("[data-yunari-publish-chord]");
  expect(chip?.textContent).toBe(shortcutLabel("publish.surface"));
  // The mark is a picture of a key, so what a screen reader is told is what the
  // caps are *called*, not the glyphs they print.
  expect(chip?.getAttribute("aria-label")).toBe(
    shortcutSpokenLabel("publish.surface"),
  );

  // And a rebind reaches it: the header re-reads the live table rather than
  // holding the chord it rendered with, which is Review Focus 3 on this surface.
  const moved: ShortcutBinding = {
    key: "j",
    modifier: true,
    shift: false,
    action: "publish.surface",
  };
  await act(async () => {
    setActiveShortcuts(resolveShortcuts({ "publish.surface": moved }));
  });
  expect(
    container.querySelector("[data-yunari-publish-chord]")?.textContent,
  ).toBe("Ctrl+J");
});

it("opens the surface without moving the host, and keeps every fact behind the press", async () => {
  const fake = hostServing({ lan: true });
  const container = await mount();

  // The bar is the control and nothing else: no code, no code symbol sat beside
  // it, and nothing open. The whole surface is behind the press. The word is
  // the control's name and the chord chip rides beside it (plan 5's Task 3).
  expect(popupOpen()).toBe(false);
  expect(container.querySelector("code")).toBeNull();
  expect(container.querySelector("[data-yunari-qr]")).toBeNull();
  expect(headerControl(container)?.textContent).toContain(uiCopy.publish.start);
  expect(hostSwitch()).toBeNull();

  // **The press is free of side effects.** This is the whole of F1: an author
  // presenting a theme presses to read the phone address, and a control that
  // stopped the session to show it would have lost the fact it was asked for.
  await openSurface(container);
  expect(fake.putCalls()).toBe(0);

  expect(hostSwitch()?.getAttribute("aria-pressed")).toBe("true");
  expect(popupText()).toContain(`https://${ADDRESS}:${PORT}`);
  // And the plain address beside it, because a device that has not installed
  // the root certificate cannot open the https one (`docs/decisions/0076`).
  expect(popupText()).toContain(`http://${ADDRESS}:${PORT}`);
  // The code in type beside the address, because a device with no camera has
  // nowhere else to read it, and the symbol carries the same one.
  expect(document.querySelector("[data-yunari-pair-code]")?.textContent).toBe(
    CODE,
  );
  expect(popupText()).toContain(uiCopy.publish.reserveAddress);
  const qr = document.querySelector("[data-yunari-qr]");
  expect(qr?.getAttribute("aria-label")).toBe(`QR code: ${PAIR_URL}`);
  // A camera needs modules, not a thumbnail.
  expect(Number(qr?.getAttribute("width"))).toBeGreaterThanOrEqual(120);
});

it("opens the surface from the header's chord, and moves no host state", async () => {
  // The regression the branch review asked for. This store is the whole of what
  // `createShellLayout().showPublishing()` touches, and that method is what the
  // session's `publish.surface` handler calls. Revert it to `hosting.toggle()`
  // and the flag is never written: the surface below never appears. Leave it as
  // it is and write the host too — a second effect the PUT count catches.
  const fake = hostServing({ lan: true });
  await mount();
  expect(popupOpen()).toBe(false);

  await act(async () => surface?.set(true));

  await vi.waitFor(() => expect(popupOpen()).toBe(true));
  expect(fake.putCalls()).toBe(0);
  // The switch inside says the host is still serving, so the chord showed a
  // state rather than changing one.
  expect(hostSwitch()?.getAttribute("aria-pressed")).toBe("true");
});

it("closes the surface under jsdom, on a second press and on Escape", async () => {
  // vg-215 recorded that the close half of a popover contract is browser-only,
  // because re-adding a close assertion threw inside Base UI's own path. That
  // does not reproduce, so the assertion is written here rather than left to the
  // browser spec: a close no dom test asserts is the gap the row named.
  const fake = hostServing({ lan: true });
  const container = await mount();

  await openSurface(container);
  await act(async () => headerControl(container)?.click());
  await vi.waitFor(() => expect(popupOpen()).toBe(false));

  await openSurface(container);
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  await vi.waitFor(() => expect(popupOpen()).toBe(false));
  // Closing is not publishing: the press that hid the surface moved no host.
  expect(fake.putCalls()).toBe(0);
});

it("turns the host on from inside the surface, and shows what it is serving", async () => {
  const fake = hostServing({ lan: false });
  const container = await mount();
  await openSurface(container);

  // A loopback host has nothing to pair with, so the switch is the only thing
  // offered and the facts are absent rather than empty.
  expect(hostSwitch()?.textContent).toBe(uiCopy.publish.start);
  expect(hostSwitch()?.getAttribute("aria-pressed")).toBe("false");
  expect(popupText()).not.toContain("http://");

  await act(async () => hostSwitch()?.click());

  await vi.waitFor(() =>
    expect(hostSwitch()?.getAttribute("aria-pressed")).toBe("true"),
  );
  expect(fake.putCalls()).toBe(1);
  // The move does not shut the surface: the facts appear where the choice was
  // made, rather than behind a second press. The address is one of them, as text
  // and as the symbol beside it.
  expect(popupOpen()).toBe(true);
  expect(popupText()).toContain(`https://${ADDRESS}:${PORT}`);
  expect(
    document.querySelector("[data-yunari-qr]")?.getAttribute("aria-label"),
  ).toBe(`QR code: ${PAIR_URL}`);
});

it("binds the §145 warning to the control that makes the choice", async () => {
  hostServing({ lan: false });
  const container = await mount();
  await openSurface(container);

  // The switch offers to publish, which says nothing about what that costs.
  // Without this the warning is on the surface for a sighted reader only. The
  // attribute is asserted before it is used as a selector, so dropping it fails
  // here rather than as `'' is not a valid selector` from the query below.
  const describedBy = hostSwitch()?.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  expect(document.getElementById(describedBy ?? "")?.textContent).toBe(
    uiCopy.publish.warning,
  );
  // And the opener is not the control it describes: opening costs nothing, so
  // it carries no warning.
  expect(headerControl(container)?.getAttribute("aria-describedby")).toBeNull();
});

it("shows the host's own reason when it refuses the interface", async () => {
  hostServing({
    lan: false,
    refuse: "Port 5227 is not free on 0.0.0.0: EADDRINUSE",
  });
  const container = await mount();
  await openSurface(container);

  // `act` because the click starts a state update; without it React has not
  // re-rendered by the time the assertion runs.
  await act(async () => hostSwitch()?.click());

  await vi.waitFor(() => expect(popupText()).toContain("EADDRINUSE"));
  // The state it asked for never arrived, so the switch still offers to start.
  expect(hostSwitch()?.textContent).toBe(uiCopy.publish.start);
  expect(hostSwitch()?.getAttribute("aria-pressed")).toBe("false");
});

it("shows the host's refusal when the move it accepted did not happen", async () => {
  // A PUT answers 200 with the state the host had *before* it moved — it has
  // to, because it cannot rebind while that answer is still on its socket
  // (vg-173). So a refusal arrives on the read that follows, in the host's own
  // words, and the switch ends up showing them rather than the state it asked
  // for.
  hostServing({
    lan: false,
    refusalAfterPut: "Port 5227 is not free on 0.0.0.0: EADDRINUSE",
  });
  const container = await mount();
  await openSurface(container);

  await act(async () => hostSwitch()?.click());

  await vi.waitFor(() => expect(popupText()).toContain("EADDRINUSE"));
  // The refusal is shown inside the surface that is already open, so nothing
  // has to be pressed again to read it.
  expect(popupOpen()).toBe(true);
  expect(hostSwitch()?.textContent).toBe(uiCopy.publish.start);
});

it("shows the address the host named, with a code for it", async () => {
  hostServing({ lan: true });
  const container = await mount();
  await openSurface(container);

  await vi.waitFor(() =>
    expect(popupText()).toContain(`https://${ADDRESS}:${PORT}`),
  );
  // **The symbol carries the code, not a credential**: it opens the page a
  // camera-less display would have typed at, and the code is printed beside it
  // for the device that has to type it. Both are the same mint.
  expect(
    document.querySelector("[data-yunari-qr]")?.getAttribute("aria-label"),
  ).toBe(`QR code: ${PAIR_URL}`);
  expect(popupText()).toContain(CODE);
  expect(popupText()).toContain(uiCopy.publish.warning);
});

it("takes the address apart again when the host answers with a new one", async () => {
  hostServing({ lan: true });
  const container = await mount();
  await openSurface(container);
  await vi.waitFor(() =>
    expect(popupText()).toContain(`https://${ADDRESS}:${PORT}`),
  );

  hostServing({ lan: true, address: "192.168.1.99" });
  const reloaded = await remount();
  await openSurface(reloaded);

  await vi.waitFor(() =>
    expect(popupText()).toContain("https://192.168.1.99:5227"),
  );
  expect(popupText()).not.toContain(`https://${ADDRESS}:${PORT}`);
  expect(popupText()).not.toContain(`http://${ADDRESS}:${PORT}`);
});

it("dials the host's stable name, and prints the address beside it", async () => {
  hostServing({ lan: true, name: "study-pc.local" });
  const container = await mount();
  await openSurface(container);

  await vi.waitFor(() =>
    expect(popupText()).toContain(`https://study-pc.local:${PORT}`),
  );
  // **Both, because they are two different facts.** The symbol and the line above
  // it carry the origin a display pairs on — the name, because a display's cookie
  // and storage are scoped to the origin and the address is the half DHCP moves
  // (`docs/decisions/0132`). The address survives as what a device that cannot
  // resolve the name types: Android 11 and earlier, and any device on Private
  // DNS, fail on `.local` and need it.
  expect(popupText()).toContain(`http://${ADDRESS}:${PORT}`);
  expect(
    document.querySelector("[data-yunari-qr]")?.getAttribute("aria-label"),
  ).toBe(`QR code: https://study-pc.local:${PORT}/pair?code=${CODE}`);
});

it("falls back to the address when the host has no name to offer", async () => {
  // Not a hypothetical: `stableName()` answers null on a platform with no
  // hostname, and a card that printed `https://null:5227` would be worse than
  // the address it replaced.
  hostServing({ lan: true });
  const container = await mount();
  await openSurface(container);

  await vi.waitFor(() =>
    expect(popupText()).toContain(`https://${ADDRESS}:${PORT}`),
  );
  expect(popupText()).not.toContain("null");
});

it("names the document a display is showing, because a live overlay is invisible", async () => {
  hostServing({ lan: true });
  const container = await mount(
    sessionShowing({ id: "living-room", name: "Living room" }),
  );
  await openSurface(container);

  await vi.waitFor(() =>
    expect(popupText()).toContain(uiCopy.publish.live("Living room")),
  );
});

it("names a document the theme never named by its id, as the chip and the status line do", async () => {
  // The reading is `documentNameOf`'s, the one the identity chip and the status
  // line take. Spelled here as `metadata?.name ?? id` it kept an empty stored
  // name — the schema refuses one and the loader supplies the id (`vg-221`),
  // but this reads whatever the document holds — so this line read "Showing "
  // where the chip beside it read the id (vg-218).
  hostServing({ lan: true });
  const container = await mount(
    sessionShowing({ id: "living-room", name: "" }),
  );
  await openSurface(container);

  await vi.waitFor(() =>
    expect(popupText()).toContain(uiCopy.publish.live("living-room")),
  );
});

it("reads no document at all while the LAN is off", async () => {
  // A paste storm while nothing is publishing used to serialise the whole
  // publishable document once per flushed batch, to name a display that is not
  // being served. The opt-in is the LAN: with it off there is nothing to read.
  hostServing({ lan: false });
  const watched = watchedSession({ id: "living-room", name: "Living room" });
  await mount(watched.session);

  await act(async () => watched.change({ id: "den", name: "Den" }));

  expect(watched.read).not.toHaveBeenCalled();
});

it("reads one document per change while publishing, and names it", async () => {
  hostServing({ lan: true });
  const watched = watchedSession({ id: "living-room", name: "Living room" });
  const container = await mount(watched.session);
  await openSurface(container);
  await vi.waitFor(() =>
    expect(popupText()).toContain(uiCopy.publish.live("Living room")),
  );

  const before = watched.read.mock.calls.length;
  await act(async () => watched.change({ id: "den", name: "Den" }));

  // Coalesced by Task 5.1, a flushed batch is one notification, so it is one
  // read — not one per object that moved in it.
  expect(watched.read.mock.calls.length).toBe(before + 1);
  await vi.waitFor(() =>
    expect(popupText()).toContain(uiCopy.publish.live("Den")),
  );
});

it("reads the current document when publishing turns on after edits", async () => {
  hostServing({ lan: false });
  const watched = watchedSession({ id: "living-room", name: "Living room" });
  const container = await mount(watched.session);
  await act(async () => watched.change({ id: "den", name: "Den" }));
  expect(watched.read).not.toHaveBeenCalled();

  await openSurface(container);
  await act(async () => hostSwitch()?.click());
  await vi.waitFor(() =>
    expect(hostSwitch()?.getAttribute("aria-pressed")).toBe("true"),
  );

  // Turning on names what the display now shows, rather than the state the
  // document had when the surface mounted.
  expect(watched.read).toHaveBeenCalledTimes(1);
  await vi.waitFor(() =>
    expect(popupText()).toContain(uiCopy.publish.live("Den")),
  );
});

it("prints no live name without a transport, even while the host is serving", async () => {
  // The read gate is the honest one: with no `publish` handle nothing is being
  // followed, and the name a display would show is nothing. A span gated on
  // `open` alone would print a name for a document nobody is publishing.
  hostServing({ lan: true });
  const container = await mount(
    sessionShowing({ id: "living-room", name: "Living room" }),
    false,
  );
  await openSurface(container);

  expect(popupText()).not.toContain(uiCopy.publish.live("Living room"));
  expect(popupText()).not.toContain(uiCopy.publish.unsaved);
});

it("says what is left to do for a theme the library does not hold", async () => {
  hostServing({ lan: true });
  const container = await mount(sessionShowing(undefined));
  await openSurface(container);

  // Publishing carries the document's assets from its own folder, so a theme
  // that was never saved has nothing to publish — and the surface says so
  // rather than offering a display a theme with holes in it.
  await vi.waitFor(() => expect(popupText()).toContain(uiCopy.publish.unsaved));
});
