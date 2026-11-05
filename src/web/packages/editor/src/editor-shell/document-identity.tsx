import { useCallback, useState, useSyncExternalStore } from "react";
import { useDraftCommit } from "../components/ui/control-well.js";
import { uiCopy } from "../ui-copy.js";
import type { SelectionStore } from "./shell-stores.js";

/**
 * The stage's top-left corner: what the author is editing, and whether it is
 * saved.
 *
 * The name reaches it through the shell's snapshot — the bridge's own
 * projection — so a late-set bridge arrives here the same way it arrives at
 * the inspector and the menus. The edited state is read from the session's
 * `isDirty()`, the one fact the status bar's `SaveState` already reads: the dot
 * is this surface's reading of that fact, never a second copy of it that could
 * disagree. The word is the status bar's alone — it was the chip's fixed part
 * and the one thing that could not shrink with the name, so at a squeezed width
 * it overflowed the chip and was clipped mid-word.
 *
 * Nothing renders while no document is open — `documentName` is `undefined`
 * then — because a chip invented for a document that is not there is a claim
 * the product does not have.
 */
export function DocumentIdentity({
  store,
}: {
  readonly store: SelectionStore;
}): React.JSX.Element | null {
  const { documentName } = useSyncExternalStore(
    store.subscribe,
    store.get,
    store.get,
  );
  const session = store.bridge?.session;
  const subscribe = useCallback(
    (listener: () => void) =>
      session?.subscribeDocumentChange(listener) ?? (() => {}),
    [session],
  );
  const dirty = useSyncExternalStore(
    subscribe,
    () => session?.isDirty() ?? false,
  );
  /** The name being typed, or `null` while the chip only reads. Nullable
   *  because that is the shape the control set's commit hook cancels on. */
  const [draft, setDraft] = useState<string | null>(null);
  const finish = (value: string): void => {
    setDraft(null);
    // An emptied name is a cancelled rename, not a document called "": the
    // schema refuses that and the chip would fall back to the id.
    const next = value.trim();
    if (next !== "" && next !== documentName) session?.renameTheme?.(next);
  };
  // Enter, Escape and the IME composing guard come from the one hook every
  // input in the editor takes them from; blur is this field's own commit.
  const keys = useDraftCommit({
    draft,
    setDraft,
    commit: () => finish(draft ?? ""),
  });
  if (documentName === undefined) return null;

  return (
    <p
      className="editor-shell-identity"
      data-dirty={dirty}
      onDoubleClick={() => {
        if (session?.renameTheme === undefined) return;
        setDraft(documentName);
      }}
    >
      {/* The record dot (the filled glyph): warn while the document differs
          from what was saved, faint when it does not. */}
      <span className="editor-shell-identity-dot" aria-hidden="true" />
      {draft === null ? (
        /* The whole name is the reading a text-overflow clip would hide, so the
           title carries it back for a name the chip is too narrow to print. */
        <span className="editor-shell-identity-name" title={documentName}>
          {documentName}
        </span>
      ) : (
        <input
          className="editor-shell-identity-input"
          aria-label={uiCopy.panels.name}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => finish(event.currentTarget.value)}
          {...keys}
        />
      )}
    </p>
  );
}
