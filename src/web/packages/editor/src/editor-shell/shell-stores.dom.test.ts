// @vitest-environment jsdom

/**
 * The shell's external stores — today the token selection's two-way
 * exclusivity with the canvas.
 *
 * The fake bridge is the one `bridge.dom.test.ts` builds (`selectLayers` is a
 * recording mock), reduced to the three members `SelectionStore` reads. Its
 * `selectLayers([])` really empties the snapshot and notifies, so the clear a
 * token selection causes arrives back through the same subscription the real
 * canvas uses — which is the edge these cases exist for.
 */
import { describe, expect, it, vi } from "vitest";
import type { ActiveKind, EditorShellBridge } from "./bridge.js";
import { SelectionStore, TokenSelectionStore } from "./shell-stores.js";

function canvas(initial: {
  readonly selectedCount: number;
  readonly activeKind: ActiveKind;
}) {
  let snapshot = {
    objectCount: 1,
    tokenCount: 1,
    selectedCount: initial.selectedCount,
    locked: false,
    activeKind: initial.activeKind,
    documentName: "Theme",
    selectionPresetId: undefined as string | undefined,
  };
  const listeners = new Set<() => void>();
  const selectLayers = vi.fn((ids: readonly string[]) => {
    if (ids.length !== 0) return;
    snapshot = { ...snapshot, selectedCount: 0, activeKind: "none" };
    for (const listener of listeners) listener();
  });
  const bridge = {
    snapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    selectLayers,
  } as unknown as EditorShellBridge;
  return {
    bridge,
    selectLayers,
    /** A selection made on the canvas, as the bridge reports one. */
    selectOnCanvas(activeKind: ActiveKind, selectedCount: number): void {
      snapshot = { ...snapshot, activeKind, selectedCount };
      for (const listener of listeners) listener();
    },
  };
}

function selected(initial?: {
  readonly selectedCount: number;
  readonly activeKind: ActiveKind;
}) {
  const surface = canvas(initial ?? { selectedCount: 0, activeKind: "none" });
  const selection = new SelectionStore();
  selection.set(surface.bridge);
  return { ...surface, selection, tokens: new TokenSelectionStore(selection) };
}

describe("TokenSelectionStore", () => {
  it("clears the token selection when the canvas selection becomes non-empty", () => {
    const shell = selected();

    shell.tokens.set({ kind: "preset", id: "body" });
    shell.selectOnCanvas("object", 1);

    expect(shell.tokens.get()).toBeUndefined();
  });

  it("treats the background as a selection, though it reports no object", () => {
    // `activeKind` is what carries it: the background is a layer with no
    // selected object, so `selectedCount` alone would miss it.
    const shell = selected();

    shell.tokens.set({ kind: "preset", id: "body" });
    shell.selectOnCanvas("background", 0);

    expect(shell.tokens.get()).toBeUndefined();
  });

  it("does not clear the token selection when the canvas clear it caused arrives back", () => {
    // The edge the ordering exists for: `set` clears the canvas first, and that
    // clear notifies with an empty selection. If it could clear the token, the
    // gesture would unselect what it was setting.
    const shell = selected({ selectedCount: 1, activeKind: "object" });

    shell.tokens.set({ kind: "preset", id: "body" });

    expect(shell.selectLayers).toHaveBeenCalledWith([]);
    expect(shell.selection.get().selectedCount).toBe(0);
    expect(shell.tokens.get()).toEqual({ kind: "preset", id: "body" });
  });
});
