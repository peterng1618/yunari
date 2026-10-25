import type { ListingCategory } from "@yunari/renderer-core";
import { useCallback, useSyncExternalStore } from "react";
import type { EditorShellBridge, EditorShellSnapshot } from "./bridge.js";

/** The shell snapshot as external mutable state — the selection, which Fabric
 * owns, and the document's identity, which the session does — so every reader
 * shares one subscription and a late-set bridge still propagates. */
export interface SelectionSnapshot extends EditorShellSnapshot {
  /** The Assets pane's list count. The manager is the session's, not the
   *  shell's, so the session reports it; `undefined` means no document, which
   *  must not read as "0 files". */
  readonly assetCount: number | undefined;
}

export class SelectionStore {
  #bridge: EditorShellBridge | undefined;
  readonly #listeners = new Set<() => void>();
  #assetCount: number | undefined;
  #snapshot: SelectionSnapshot = {
    objectCount: undefined,
    tokenCount: undefined,
    selectedCount: 0,
    locked: false,
    activeKind: "none",
    documentName: undefined,
    selectionPresetId: undefined,
    assetCount: undefined,
  };
  #unsubscribe: (() => void) | undefined;

  set(bridge: EditorShellBridge | undefined): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#bridge = bridge;
    if (bridge !== undefined) {
      this.#snapshot = { ...bridge.snapshot(), assetCount: this.#assetCount };
      this.#unsubscribe = bridge.subscribe(() => {
        this.#snapshot = { ...bridge.snapshot(), assetCount: this.#assetCount };
        for (const listener of this.#listeners) listener();
      });
    } else {
      // No scene to count, so the strip's count readout has nothing to draw —
      // never `0`, which is a blank document's own answer. The Tokens pane's
      // count is absent for the same reason: no document is no palette. The
      // Assets pane's count is the session's and goes with the document too.
      this.#assetCount = undefined;
      this.#snapshot = {
        objectCount: undefined,
        tokenCount: undefined,
        selectedCount: 0,
        locked: false,
        activeKind: "none",
        documentName: undefined,
        selectionPresetId: undefined,
        assetCount: undefined,
      };
    }
    for (const listener of this.#listeners) listener();
  }

  /** The Assets pane's count, reported by the session after every declaration
   *  change — the manager has no event to subscribe to. */
  setAssetCount(count: number): void {
    if (this.#assetCount === count) return;
    this.#assetCount = count;
    this.#snapshot = { ...this.#snapshot, assetCount: count };
    for (const listener of this.#listeners) listener();
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly get = (): SelectionSnapshot => this.#snapshot;

  get bridge(): EditorShellBridge | undefined {
    return this.#bridge;
  }
}

export function useSelection(store: SelectionStore): SelectionSnapshot {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** The token the Tokens pane has selected for the inspector: one of the
 *  document's presets or paints. */
export type TokenRef = {
  readonly kind: "preset" | "paint";
  readonly id: string;
};

/**
 * Which token the inspector is editing, as external state.
 *
 * A canvas selection and a token selection are exclusive, and each direction
 * has one clear gesture: `set` clears the canvas through the bridge's empty-list
 * gesture — never `discardActiveObject`, because `bridge.ts` owns the Fabric
 * boundary — and a canvas selection clears the token here.
 *
 * The canvas is answered only when a selection becomes **non-empty**. The clear
 * `set` just performed arrives back as a selection change too, and acting on it
 * would unselect the token it was setting; that guard is what makes the
 * gesture one-way rather than a loop. The background counts as a selection
 * although it reports no selected object, which is why `activeKind` is read
 * beside `selectedCount`.
 *
 * It lives as long as the shell and is never disposed, like the store it
 * follows.
 */
export class TokenSelectionStore {
  readonly #source: SelectionStore;
  #selected: TokenRef | undefined;
  readonly #listeners = new Set<() => void>();

  constructor(selection: SelectionStore) {
    this.#source = selection;
    selection.subscribe(() => {
      const snapshot = selection.get();
      if (snapshot.selectedCount > 0 || snapshot.activeKind !== "none") {
        this.clear();
      }
    });
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly get = (): TokenRef | undefined => this.#selected;

  /** Ordered before the ref is stored, so the clear's own notification cannot
   *  unselect the token being set. */
  set(next: TokenRef): void {
    this.#source.bridge?.selectLayers([]);
    if (this.#selected?.kind === next.kind && this.#selected.id === next.id) {
      return;
    }
    this.#selected = next;
    this.#notify();
  }

  clear(): void {
    if (this.#selected === undefined) return;
    this.#selected = undefined;
    this.#notify();
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}

export function useTokenSelection(
  store: TokenSelectionStore | undefined,
): TokenRef | undefined {
  return useSyncExternalStore(
    useCallback(
      (listener: () => void) => store?.subscribe(listener) ?? (() => undefined),
      [store],
    ),
    useCallback(() => store?.get(), [store]),
    useCallback(() => store?.get(), [store]),
  );
}

/** Whether the `?` sheet is open, as external state.
 *
 * The dispatcher lives in `EditorSession`, which never sees React, so the
 * gesture has to reach the chrome through a subscription rather than a prop —
 * the same shape `SelectionStore` has, for the same reason.
 */
export class SheetStore {
  #open = false;
  readonly #listeners = new Set<() => void>();
  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  readonly get = (): boolean => this.#open;
  set(open: boolean): void {
    if (this.#open === open) return;
    this.#open = open;
    for (const listener of this.#listeners) listener();
  }
}

export function useSheet(store: SheetStore): boolean {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** Whether the asset finder is open, and the category a caller asked it to
 * show — the font field opens it on Fonts.
 *
 * Same shape and same reason as `SheetStore`: the finder's chord is dispatched
 * by `EditorSession`, the modal is the shell's, and the two never share a
 * component tree.
 */
export interface FinderState {
  readonly open: boolean;
  readonly category: ListingCategory | undefined;
}

export class FinderStore {
  #state: FinderState = { open: false, category: undefined };
  readonly #listeners = new Set<() => void>();
  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  readonly get = (): FinderState => this.#state;
  /** The category is kept only while open: a later open that names none starts
   *  from the listing's own order rather than from the last caller's ask. */
  set(open: boolean, category?: ListingCategory): void {
    const next: FinderState = { open, category: open ? category : undefined };
    if (
      this.#state.open === next.open &&
      this.#state.category === next.category
    ) {
      return;
    }
    this.#state = next;
    for (const listener of this.#listeners) listener();
  }
}

export function useFinder(store: FinderStore): FinderState {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** Whether the publish surface is open, as external state.
 *
 * The header's chord is dispatched by `EditorSession`, which never sees React,
 * so it reaches the popover the same way `?` reaches the sheet: a store the
 * component subscribes to. It holds the popover's open flag, so the chord and
 * the control's own press drive one surface rather than two.
 */
export class PublishSurfaceStore {
  #open = false;
  readonly #listeners = new Set<() => void>();
  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  readonly get = (): boolean => this.#open;
  set(open: boolean): void {
    if (this.#open === open) return;
    this.#open = open;
    for (const listener of this.#listeners) listener();
  }
}
