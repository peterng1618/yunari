// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { uiCopy } from "../ui-copy.js";
import type { EditorShellBridge } from "./bridge.js";
import { DocumentIdentity } from "./document-identity.js";
import { SaveState } from "./save-state.js";
import type { EditorActionFacade } from "./session-facade.js";
import { SelectionStore } from "./shell-stores.js";

/** Only what the marks read. The session owns both answers; a stub here would
 *  be a second implementation of them. */
function stubSession(dirty: () => boolean): {
  readonly facade: EditorActionFacade;
  announce(): void;
} {
  const listeners = new Set<() => void>();
  return {
    facade: {
      isDirty: dirty,
      subscribeDocumentChange: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    } as unknown as EditorActionFacade,
    announce: () => {
      for (const listener of listeners) listener();
    },
  };
}

/** A bridge whose snapshot is re-read on demand, the way the shell's own store
 *  reads it: `rename` moves the name and is the bridge telling its subscribers,
 *  which is what a real one does when the session reports a document change. */
function stubBridge(
  session: EditorActionFacade,
  initialName: string,
): { readonly bridge: EditorShellBridge; rename(next: string): void } {
  let name = initialName;
  const listeners = new Set<() => void>();
  return {
    bridge: {
      snapshot: () => ({
        selectedCount: 0,
        locked: false,
        activeKind: "none" as const,
        documentName: name,
      }),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      session,
    } as unknown as EditorShellBridge,
    rename: (next: string) => {
      name = next;
      for (const listener of listeners) listener();
    },
  };
}

describe("the document's identity", () => {
  let host: HTMLDivElement | undefined;

  afterEach(() => {
    host?.remove();
    host = undefined;
  });

  function mount(node: ReactNode): HTMLDivElement {
    host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(node));
    return host;
  }

  it("renders nothing rather than a placeholder when no document is open", () => {
    // The failure the refusal rule forbids: a chip for a document that is not there. Red if
    // the cluster draws its frame before it has a name to put in it.
    const store = new SelectionStore();
    const mounted = mount(<DocumentIdentity store={store} />);
    expect(mounted.querySelector(".editor-shell-identity")).toBeNull();
  });

  it("follows a bridge set after the shell mounted", () => {
    // The store's own idiom: the bridge can arrive after React has rendered the
    // stage, so the cluster reads the snapshot through the subscription rather
    // than a prop captured at mount — and it has to keep reading it, because a
    // rename moves no object for any canvas event to catch.
    const store = new SelectionStore();
    const session = stubSession(() => false);
    const { bridge, rename } = stubBridge(session.facade, "System dashboard");
    const mounted = mount(<DocumentIdentity store={store} />);
    const name = (): string | undefined =>
      mounted.querySelector(".editor-shell-identity-name")?.textContent ??
      undefined;

    expect(name()).toBeUndefined();

    act(() => {
      store.set(bridge);
    });
    expect(name()).toBe("System dashboard");

    act(() => {
      rename("Kitchen");
    });
    expect(name()).toBe("Kitchen");
  });

  it("reads the edited state from the same fact the status bar reads", () => {
    // One fact, two readings: the cluster's dot and `SaveState` in the status
    // bar are both `isDirty()`. Rendering both against one session is what says
    // so — a second source would show one dirty and one clean. The chip's word
    // was a third reading, and the one part that could not shrink with the name,
    // so `vg-223` removed it: the marker is asserted absent at both states,
    // which is what reddens if it is ever put back.
    let saved = true;
    const session = stubSession(() => !saved);
    const store = new SelectionStore();
    const { bridge } = stubBridge(session.facade, "System dashboard");
    act(() => {
      store.set(bridge);
    });
    const mounted = mount(
      <>
        <DocumentIdentity store={store} />
        <SaveState session={session.facade} />
      </>,
    );
    const chip = (): Element | null =>
      mounted.querySelector(".editor-shell-identity");
    const dot = (): Element | null =>
      mounted.querySelector(".editor-shell-identity-dot");
    const edited = (): Element | null =>
      mounted.querySelector(".editor-shell-identity-edited");
    const saveState = (): string =>
      mounted.querySelector(".editor-shell-save-state")?.textContent ?? "";

    expect(chip()?.getAttribute("data-dirty")).toBe("false");
    expect(dot()).not.toBeNull();
    expect(edited()).toBeNull();
    expect(saveState()).toBe("");

    saved = false;
    act(() => session.announce());

    expect(chip()?.getAttribute("data-dirty")).toBe("true");
    expect(dot()).not.toBeNull();
    expect(edited()).toBeNull();
    expect(saveState()).toBe(uiCopy.saveState.unsaved);
  });
});
