import {
  createElement,
  type KeyboardEvent,
  useState,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { useDraftCommit } from "../components/ui/control-well.js";
import { Glyph, KIND_GLYPHS } from "../editor-shell/icons.js";
import { uiCopy } from "../ui-copy.js";
import type { SelectionEdits, SelectionView } from "./view.js";

/**
 * The column's React root and the store the projection is published to.
 *
 * `index.ts` projects a `SelectionView` from Fabric on demand and publishes it
 * here; React subscribes and re-renders. Nothing but the serializable view and
 * the imperative edit port crosses this line — no Fabric object, no DOM node
 * (ADR-0039).
 */

interface PublishedSelection {
  readonly view: SelectionView;
  readonly edits: SelectionEdits;
}

interface InspectorStore {
  subscribe(listener: () => void): () => void;
  snapshot(): PublishedSelection | undefined;
  publish(next: PublishedSelection): void;
}

function createStore(): InspectorStore {
  let current: PublishedSelection | undefined;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: () => current,
    publish(next) {
      current = next;
      for (const listener of listeners) listener();
    },
  };
}

/**
 * The subject block and the empty state — the two things the column says before
 * it says anything about fields. The kind's glyph leads the name at `--text-md`,
 * in the chrome's one icon vocabulary, and the line under them carries the key a
 * binding reads at `--text-xs` in `--muted`. The block is closed by a hairline
 * edge rather than a chrome label (DESIGN.md §7.4), and that edge is the column's
 * *one* boundary below the header: the first section draws none of its own
 * (`vg-466`).
 */
function Inspector({
  store,
}: {
  readonly store: InspectorStore;
}): React.JSX.Element | null {
  const published = useSyncExternalStore(store.subscribe, store.snapshot);
  // The revision the edit belongs to: a selection change while the field is
  // open is a different subject, so its draft is no longer an edit of this one.
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const [draft, setDraftState] = useState("");
  const view = published?.view;
  const subject = view?.subject;
  // The heading is the name control: a single, unlocked object's name is typed
  // where it is read, so the column does not spend a whole section row on it.
  // A multi-selection names no single object, so it offers none.
  const open =
    openedAt !== null &&
    openedAt === view?.targetRevision &&
    subject !== undefined &&
    subject.kind !== "activeSelection" &&
    subject.kind !== "background" &&
    view?.locked !== true;
  const authoredName = subject?.authoredName ?? "";
  const begin = (): void => {
    setDraftState(authoredName);
    setOpenedAt(view?.targetRevision ?? null);
  };
  const commit = (): void => {
    if (!open || published === undefined) return;
    // Nothing typed, or an edit cancelled with Escape: close without writing,
    // so a look at the name never becomes a history entry.
    if (draft === authoredName) {
      setOpenedAt(null);
      return;
    }
    // A refused value keeps the field open showing what the object carries, the
    // same way the Name field did before it moved into the heading.
    const accepted = published.edits.commit(
      published.view.targetRevision,
      "name",
      draft,
    );
    if (accepted) setOpenedAt(null);
    else setDraftState(authoredName);
  };
  // The same keyboard contract every input takes (DESIGN.md §5): Enter commits,
  // Escape drops the draft and leaves the authored value showing, and an IME's
  // Enter is not mistaken for a commit.
  const keys = useDraftCommit({
    draft: open ? draft : null,
    setDraft: (value) => setDraftState(value ?? authoredName),
    commit,
  });
  if (published === undefined) return null;
  if (subject === undefined) {
    return (
      <p className="m-0 text-sm text-muted" data-yunari-nothing-selected="">
        {uiCopy.inspectorFields.nothingSelected}
      </p>
    );
  }

  const renameable =
    subject.kind !== "activeSelection" &&
    subject.kind !== "background" &&
    !published.view.locked;

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-[var(--space-4)] border-b border-edge pb-[var(--space-8)]">
        {/* The mark and the name on one line, as the pane title draws its own
            (`pane.tsx`): the glyph inherits `--muted` from the row and the name
            takes `--text` for itself. A kind with no layer kind — a
            multi-selection — draws no mark rather than a second table's guess
            at one. */}
        <div className="flex items-center gap-[var(--space-8)] text-muted">
          {subject.kind === "activeSelection" ? null : (
            <Glyph icon={KIND_GLYPHS[subject.kind]} size={14} />
          )}
          {!open ? (
            <span
              className="text-md font-semibold text-text"
              data-yunari-subject-name=""
              {...(renameable
                ? {
                    // The visible name is data; the concept is the table's. A
                    // span named by its content reads as nothing, so the label
                    // says what the gesture does and the name stays announced.
                    "aria-label": `${uiCopy.panels.rename} ${subject.name}`,
                    role: "button",
                    tabIndex: 0,
                    onDoubleClick: begin,
                    onKeyDown: (event: KeyboardEvent) => {
                      if (event.key !== "Enter" && event.key !== "F2") return;
                      event.preventDefault();
                      begin();
                    },
                  }
                : {})}
            >
              {subject.name}
            </span>
          ) : (
            <input
              // The same hook the Name field carried, so an author's rename is
              // still observed at one control whatever the column calls it.
              data-yunari-name=""
              aria-label={uiCopy.inspectorFields.name}
              className="min-w-0 flex-1 bg-transparent text-md font-semibold text-text outline-none"
              value={draft}
              autoFocus
              onChange={(event) => setDraftState(event.target.value)}
              onBlur={commit}
              {...keys}
            />
          )}
        </div>
        {subject.key === undefined ? null : (
          <span className="text-xs text-muted">{subject.key}</span>
        )}
      </div>
      {published.view.locked ? (
        <p
          className="m-0 mt-[var(--space-12)] text-sm text-muted"
          data-yunari-locked=""
        >
          {uiCopy.inspectorFields.locked}
        </p>
      ) : null}
    </div>
  );
}

export function createInspectorRoot(host: HTMLElement): {
  readonly publish: (view: SelectionView, edits: SelectionEdits) => void;
  readonly destroy: () => void;
} {
  const store = createStore();
  const root: Root = createRoot(host);
  // Mounted through `flushSync` as well as published through it: a caller that
  // reads the column straight after building it must see the store's first
  // value, not the empty frame before React's first commit lands.
  flushSync(() => {
    root.render(createElement(Inspector, { store }));
  });

  return {
    publish(view, edits) {
      // Flushed synchronously: a caller that reads the column straight after a
      // selection change sees it, exactly as the imperative surface did before
      // the projection existed.
      flushSync(() => store.publish({ view, edits }));
    },
    destroy() {
      root.unmount();
    },
  };
}
