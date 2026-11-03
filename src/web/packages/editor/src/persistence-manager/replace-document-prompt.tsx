import { ACTION_BUTTON, Dialog } from "../components/ui/dialog.js";
import type { ModalSettle } from "../components/ui/modal-host.js";
import { uiCopy } from "../ui-copy.js";

/** What the prompt can answer. `cancel` is the whole vocabulary's floor: a
 *  dismissal is one, so the session that awaits this can never read a closed
 *  dialog as consent to lose the work. */
export type ReplacementAnswer = "save" | "discard" | "cancel";

/** The three answers, in the order they are drawn. Discard last, with Cancel
 *  beside it, because it is the one that loses work: a slip toward the edge of
 *  the row lands on the answer that keeps the document. */
const ANSWERS = [
  ["save", uiCopy.replaceDocument.save],
  ["cancel", uiCopy.replaceDocument.cancel],
  ["discard", uiCopy.replaceDocument.discard],
] as const;

/**
 * Asks before the open document is replaced by another.
 *
 * The question an author reads on the way to losing their work, so it says what
 * is about to happen rather than naming the button, and it is a `Dialog` rather
 * than a `<dialog>` so Escape reaches it, Base UI keeps the canvas behind it
 * inert, and focus goes back to the control that asked. The answers, their order
 * and their words are the imperative dialog's own.
 *
 * **The question is the caller's**, because the copy is the only thing that
 * makes this prompt a *replacement*. A mode switch does not ask: the editor's
 * body is hidden, never unmounted, so it loses no unsaved work.
 */
export function ReplaceDocumentPrompt({
  question,
  settle,
}: {
  readonly question: string;
  readonly settle: ModalSettle<ReplacementAnswer>;
}): React.JSX.Element {
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) settle.dismiss();
      }}
      label={question}
    >
      <p className="editor-shell-dialog-lead">{question}</p>
      <div className="yunari-dialog-actions">
        {ANSWERS.map(([value, word]) => (
          <button
            key={value}
            type="button"
            className={ACTION_BUTTON}
            onClick={() => settle.close(value)}
          >
            {word}
          </button>
        ))}
      </div>
    </Dialog>
  );
}
