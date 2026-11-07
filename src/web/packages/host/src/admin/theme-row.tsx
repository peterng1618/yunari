import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import type { ChooserTheme } from "./client.js";

/** Reserved space with nothing in it, for a row with no picture to draw. */
function Placeholder(): React.JSX.Element {
  return <div className="theme-shot" data-placeholder="" />;
}

/** The name beside the picture, and anything said under it. */
function RowText({
  name,
  sub,
}: {
  readonly name: string;
  readonly sub: string | undefined;
}): React.JSX.Element {
  return (
    <span className="theme-text">
      {name}
      {sub === undefined ? null : <span className="by">{sub}</span>}
    </span>
  );
}

/**
 * One sentence per cost, naming the cost rather than the word "performance":
 * a warning a reader cannot act on is a warning nobody reads.
 */
const COST_WARNINGS: Record<string, string> = {
  "glass-over-video":
    "Glass over a video background repaints the whole screen for every video " +
    "frame, on any display.",
  "video-background":
    "A video background never lets a host monitor idle, so this PC stays out " +
    "of its low-power states.",
};

/**
 * What this theme will cost the display it is being given to, or nothing when
 * it costs nothing worth saying.
 *
 * The kind decides half of it. Glass over a video repaints on any display; a
 * video alone costs only a host monitor, so a remote one is told nothing — a
 * phone showing video is doing what a phone does, and warning there is how a
 * warning stops being read. A row with no kind is the default, which any
 * display may fall to, and is therefore told about both.
 */
export function costWarning(
  kind: string,
  costs: readonly string[],
): string | undefined {
  for (const cost of costs) {
    if (cost === "video-background" && kind === "paired") continue;
    const sentence = COST_WARNINGS[cost];
    if (sentence !== undefined) return sentence;
  }
  return undefined;
}

const DELETE_LEAD = "Move this theme to the recycle bin?";

/** Asks before a removal, the way the editor's own dialog does: a `<dialog>`,
 *  so it traps focus while it is open and gives it back to the Delete that
 *  opened it when it closes, with no key handler of its own to maintain. */
function ConfirmRemoval({
  name,
  id,
  busy,
  onCancel,
  onConfirm,
}: {
  readonly name: string;
  readonly id: string;
  /** The removal is out: both answers wait for it, so neither can ride it. */
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const ask =
    `${DELETE_LEAD}\n\n${name} (${id}) will be moved to the recycle bin, ` +
    "where you can get it back.";

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    // jsdom has no modal dialog; the attribute still opens the element so a
    // test can drive the buttons, and a real browser never takes this branch.
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }, []);

  return (
    <dialog
      ref={ref}
      className="theme-confirm"
      aria-label={ask}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <p className="theme-confirm-lead">{ask}</p>
      <div className="theme-confirm-actions">
        <button
          type="button"
          data-theme-delete-no=""
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
        {/* The one state this page shares with the editor: the attribute is
            DESIGN.md's control-state contract, and `admin.css` paints it. */}
        <button
          type="button"
          data-theme-delete-yes=""
          data-yunari-control-state={busy ? "busy" : undefined}
          aria-busy={busy ? "true" : undefined}
          disabled={busy}
          onClick={onConfirm}
        >
          Delete
        </button>
      </div>
    </dialog>
  );
}

/**
 * One saved theme's row: the picture, the choice, the link that edits it and the
 * removal that clears it away.
 *
 * **The owner of the row.** The host serves the chooser to a display, so the
 * picture, the hatched stand-in for a theme saved before pictures existed, and
 * the id that tells two same-named themes apart are drawn here and nowhere
 * else. The chooser's rows are a React surface now; the old DOM renderer is
 * deleted rather than kept beside it.
 */
export function ThemeRow({
  theme,
  showing,
  kind,
  shared,
  onChoose,
  onRemove,
}: {
  readonly theme: ChooserTheme;
  /** The theme this display shows, which may be another row's. */
  readonly showing: string | null;
  /** The display the rows are being chosen for, so a cost note describes the
   *  pair a press would commit. */
  readonly kind: string;
  /** Two themes share a display name, so the id is what tells them apart. */
  readonly shared: boolean;
  readonly onChoose: () => void;
  readonly onRemove: () => Promise<void>;
}): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);

  const named = theme.name ?? theme.id;
  const label = shared ? `${named} (${theme.id})` : named;
  const cost = costWarning(kind, theme.costs ?? []);
  const current = theme.id === showing;

  const remove = async (): Promise<void> => {
    if (removing) return;
    setRemoving(true);
    try {
      await onRemove();
    } catch (error) {
      // Nothing was lost, so the row stays and the host's own reason is on
      // screen: on a PC with no trash command this text is the only way the
      // author learns why a silent failure happened.
      setNote(error instanceof Error ? error.message : String(error));
      setRemoving(false);
      setConfirming(false);
    }
  };

  return (
    <div className="theme-row">
      <button
        type="button"
        className="theme-option"
        data-theme={theme.id}
        aria-pressed={current}
        onClick={onChoose}
      >
        {/* The listing says whether a picture exists, so a theme without one
            draws the fallback directly: requesting an image that is not there
            would log a 404 per theme on every clean load. */}
        {theme.thumbnail === true ? (
          <img
            className="theme-shot"
            alt=""
            src={`/api/themes/${encodeURIComponent(theme.id)}/thumbnail`}
          />
        ) : (
          <Placeholder />
        )}
        <RowText name={label} sub={theme.author} />
        {/* The chosen theme is stated in words too, so the state does not rest
            on a border weight alone. */}
        {current ? <span className="current">Showing</span> : null}
      </button>

      {/* Showing a theme and changing it are different acts, so they are
          different controls: the button above is the consumer choosing, and
          this is the author editing. */}
      <a
        className="theme-edit"
        href={`/editor/?theme=${encodeURIComponent(theme.id)}`}
        aria-label={`Edit ${named} in the editor`}
      >
        Edit
      </a>

      <p className="theme-cost-note" role="status" hidden={cost === undefined}>
        {cost ?? ""}
      </p>

      {/* The same shared state contract. A failed removal keeps the row and
          paints this button's failure ink; a successful one removes the row,
          so there is no success state left to draw here. */}
      <button
        type="button"
        className="theme-delete"
        aria-label={`Delete ${named} — moved to the recycle bin`}
        data-yunari-control-state={
          removing ? "busy" : note === undefined ? undefined : "failure"
        }
        aria-busy={removing ? "true" : undefined}
        disabled={removing}
        onClick={() => setConfirming(true)}
      >
        Delete
      </button>

      <p
        className="theme-delete-note"
        role="status"
        hidden={note === undefined}
      >
        {note ?? ""}
      </p>

      {confirming ? (
        <ConfirmRemoval
          name={named}
          id={theme.id}
          busy={removing}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void remove()}
        />
      ) : null}
    </div>
  );
}
