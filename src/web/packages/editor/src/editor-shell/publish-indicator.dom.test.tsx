// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { uiCopy } from "../ui-copy.js";
import type { HostingSnapshot, HostingStore } from "./hosting-store.js";
import { PublishIndicator } from "./publish-indicator.js";

/** A store fixed at one snapshot. The real `HostingStore` reads the host on
 *  construction, which a unit test has no host for, so only the two members the
 *  indicator reads are here — a fuller stub would be a second implementation. */
function stubStore(snapshot: HostingSnapshot): HostingStore {
  return {
    subscribe: () => () => {},
    get: () => snapshot,
  } as unknown as HostingStore;
}

/** The host's answer with the LAN on, which is the one fact the mark reads. */
const live: HostingSnapshot = {
  kind: "known",
  answer: {
    lan: true,
    address: "192.168.1.5",
    name: null,
    port: 4174,
    refusal: null,
  },
  pairing: undefined,
  reason: undefined,
  pending: undefined,
};

/** The host's answer with the LAN off: a *reported* state, and not live. */
const off: HostingSnapshot = {
  kind: "known",
  answer: { lan: false, address: null, name: null, port: null, refusal: null },
  pairing: undefined,
  reason: undefined,
  pending: undefined,
};

describe("the live mark", () => {
  let host: HTMLDivElement | undefined;

  afterEach(() => {
    host?.remove();
    host = undefined;
  });

  function mount(store: HostingStore): HTMLDivElement {
    host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(<PublishIndicator store={store} />));
    return host;
  }

  it("shows no live mark when the host's state is unknown", () => {
    // The failure the design forbids: an unread host rendered as a
    // claim. Red if the mark is drawn without asking the store first.
    const mounted = mount(stubStore({ kind: "unknown" }));
    expect(mounted.querySelector(".editor-shell-live")).toBeNull();
  });

  it("shows no live mark when the host reports the LAN off", () => {
    // "Off" is a *reported* state, not an unread one, so it takes its own case:
    // a guard weakened to `state.kind !== "known"` would draw "live" for a host
    // that answered off, and only this case catches it.
    const mounted = mount(stubStore(off));
    expect(mounted.querySelector(".editor-shell-live")).toBeNull();
  });

  it("shows the live mark when the host reports the LAN on", () => {
    const mounted = mount(stubStore(live));
    const mark = mounted.querySelector(".editor-shell-live");
    expect(mark).not.toBeNull();
    // The literal the brief fixes, pinned so a different word cannot pass by
    // changing `uiCopy` with it, and the constant read from the one owner.
    expect(mark?.textContent).toBe("live");
    expect(uiCopy.statusBar.live).toBe("live");
  });
});
