// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { EditorShellBridge, EditorShellSnapshot } from "./bridge.js";
import { SelectionStore } from "./shell-stores.js";
import { StatusReadout } from "./status-readout.js";

/** Only what the readout reads. The bridge owns the count; a second counter
 *  here would be a second implementation of it. */
function stubBridge(snapshot: EditorShellSnapshot): EditorShellBridge {
  return {
    snapshot: () => snapshot,
    subscribe: () => () => undefined,
  } as unknown as EditorShellBridge;
}

function snapshotWith(objectCount: number, selectedCount: number) {
  return {
    objectCount,
    tokenCount: 0,
    selectedCount,
    locked: false,
    activeKind: "none",
    documentName: undefined,
    selectionPresetId: undefined,
  } satisfies EditorShellSnapshot;
}

describe("the status bar's counts", () => {
  let host: HTMLDivElement | undefined;

  afterEach(() => {
    host?.remove();
    host = undefined;
  });

  function mount(store: SelectionStore): HTMLDivElement {
    host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(<StatusReadout store={store} />));
    return host;
  }

  it("reads the scene's object total and the selection's size", () => {
    const store = new SelectionStore();
    store.set(stubBridge(snapshotWith(52, 0)));
    const host = mount(store);

    expect(
      host.querySelector("[data-yunari-status-objects]")?.textContent,
    ).toBe("52 objects");
    expect(
      host.querySelector("[data-yunari-status-selected]")?.textContent,
    ).toBe("0 selected");
  });

  it("draws nothing where there is no scene to count", () => {
    // The fabrication this refuses: `0 objects` over a canvas that has not
    // mounted its document is a reading the product does not have.
    // The shell hands the readout its no-scene snapshot before a bridge is
    // set, so that state is this component's own case.
    const store = new SelectionStore();
    store.set(undefined);
    const host = mount(store);

    expect(host.textContent).toBe("");
    expect(host.querySelector("[data-yunari-status-objects]")).toBeNull();
  });

  it("reads a blank document as zero objects, which is an answer", () => {
    // A blank theme is the starter's composition taken out, so nothing on the
    // canvas is what the document really holds — not the absence of a scene.
    const store = new SelectionStore();
    store.set(stubBridge(snapshotWith(0, 0)));
    const host = mount(store);

    expect(
      host.querySelector("[data-yunari-status-objects]")?.textContent,
    ).toBe("0 objects");
  });

  it("follows the scene as it changes", () => {
    const store = new SelectionStore();
    let current = snapshotWith(1, 0);
    let announce: (() => void) | undefined;
    store.set({
      snapshot: () => current,
      subscribe: (listener: () => void) => {
        announce = listener;
        return () => undefined;
      },
    } as unknown as EditorShellBridge);
    const host = mount(store);
    expect(
      host.querySelector("[data-yunari-status-objects]")?.textContent,
    ).toBe("1 object");

    current = snapshotWith(2, 1);
    act(() => announce?.());
    expect(
      host.querySelector("[data-yunari-status-objects]")?.textContent,
    ).toBe("2 objects");
    expect(
      host.querySelector("[data-yunari-status-selected]")?.textContent,
    ).toBe("1 selected");
  });
});
