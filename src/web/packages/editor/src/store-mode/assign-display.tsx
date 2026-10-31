import type * as React from "react";
import { useEffect, useState } from "react";
import {
  type ControlOption,
  ControlSelect,
} from "../components/ui/control-select.js";
import { Dialog } from "../components/ui/dialog.js";
import {
  DEFAULT_DISPLAY_KEY,
  type ThemedDisplay,
  type ThemeLibraryClient,
} from "../theme-library-client.js";
import { uiCopy } from "../ui-copy.js";
import type { StoreItem } from "./local-source.js";

/** What the host answers about the displays: the list, and the theme a display
 *  holding none of its own falls to. Both are kept, because they are two things
 *  the answer says and the second is what tells "nothing holds this theme" apart
 *  from "this theme is the default". */
type DisplayRead = {
  readonly default: string | null;
  readonly displays: readonly ThemedDisplay[];
};

/** A message a person can act on: the host's own words where it sent any. */
function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The display choice itself: the select, its refusal and its confirmation.
 *
 * **The list is the host's answer, read when the choice opens and kept
 * nowhere.** A list this surface held would be a second source of truth about
 * which displays exist, and it would go stale the moment one paired or left —
 * so every mount reads `listDisplays` again, and a display the host does not
 * answer is not offered at all: an assignment to a display that does not exist
 * is a 404 the person would read as a bug in the gallery.
 *
 * **A failed read is not an empty list.** They look identical on screen and
 * mean opposite things, so the two are different states here: the choice is
 * drawn only from a read that arrived, and a read that did not is the host's
 * own refusal, printed where the choice would have been.
 *
 * **The value is where the theme already is**: the display whose own choice is
 * this theme, or the host's `default` when it names this theme — the theme every
 * display with no choice of its own gets, which the host's own answer says. `""`
 * is the third state rather than the second: no display holds it and it is not
 * the default, which is where every theme nothing has been assigned to opens.
 * Reading `""` for the default too would be a real answer rendered as absence,
 * and the two states would collapse into one rendering.
 *
 * **A landed assignment confirms beside the choice.** The dialog form closes on
 * success, so it never needs the confirmation; the theme's own page keeps the
 * choice open and shows which display the theme went to.
 *
 * **Nothing warns about the cost here.** The user narrowed the cost warning to
 * the host's own pages on 2026-10-18, so the per-display plan's own surface
 * raises it and this one says nothing.
 */
export function AssignChoice(props: {
  readonly item: StoreItem;
  readonly client: ThemeLibraryClient;
  /** What a landed assignment does next. A dialog closes; the theme's page
   *  leaves the choice where it is and reads the confirmation instead. */
  readonly onAssigned: () => void;
}): React.JSX.Element {
  const { item, client, onAssigned } = props;

  /** What the host answered, or `undefined` until an answer arrives. The choice
   *  draws no select before then rather than an empty one. */
  const [answered, setAnswered] = useState<DisplayRead | undefined>(undefined);
  /** The last refusal, in the host's own words: a read that failed or an
   *  assignment the host would not take. The two are one slot because they are
   *  one thing to the person reading it — what the host said — and they cannot
   *  both be on screen: without an answer there is no choice to assign from. */
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  /** What the last landed assignment said, where the choice stays open. */
  const [confirmation, setConfirmation] = useState<string | undefined>(
    undefined,
  );
  /** The display the person just chose. Kept because the answered list cannot
   *  say where the theme went until the next read, and the choice must not fall
   *  back to the display that held it before. */
  const [chosen, setChosen] = useState<string | undefined>(undefined);

  useEffect(() => {
    let live = true;
    client.listDisplays().then(
      (read) => {
        if (live) setAnswered(read);
      },
      (error: unknown) => {
        if (live) setRefusal(reason(error));
      },
    );
    return () => {
      live = false;
    };
  }, [client]);

  const displays = answered?.displays ?? [];
  const options: readonly ControlOption[] = [
    // The default leads, as the host's own page draws it: it is what every
    // display with no choice of its own already gets, so it is the one meant
    // until another is chosen.
    { id: DEFAULT_DISPLAY_KEY, name: uiCopy.store.assign.default },
    ...displays.map((display) => ({ id: display.id, name: display.label })),
  ];
  // A display that holds this theme of its own is the answer; the host's
  // `default` naming it is the next, because that is what a display with no
  // choice of its own is served. `""` is left for neither.
  const heldBy =
    chosen ??
    displays.find((display) => display.theme === item.id)?.id ??
    (answered?.default === item.id ? DEFAULT_DISPLAY_KEY : "");

  /** Choosing a display is the assignment. A refusal leaves the choice where it
   *  is, with the host's reason beside it, so another display can be tried. */
  const choose = (display: string): void => {
    setChosen(display);
    setRefusal(undefined);
    setConfirmation(undefined);
    void client.assign(display, item.id).then(
      () => {
        const where =
          options.find((option) => option.id === display)?.name ?? display;
        setConfirmation(uiCopy.store.assign.assigned(where));
        onAssigned();
      },
      (error: unknown) => {
        setRefusal(reason(error));
      },
    );
  };

  return (
    <>
      {answered === undefined ? null : (
        <ControlSelect
          label={uiCopy.store.assign.display}
          data={{ "data-yunari-store-assign-display": "" }}
          value={heldBy}
          options={options}
          onChange={choose}
        />
      )}
      {/* **Mounted whether or not it says anything**, as the library chooser's
          status is: a live region added together with its own text is the less
          reliably announced pattern. */}
      <p
        className="editor-shell-dialog-status"
        role="status"
        data-yunari-store-assign-status=""
        hidden={refusal === undefined}
      >
        {refusal}
      </p>
      <p
        className="editor-shell-dialog-status"
        role="status"
        data-yunari-store-assign-confirmed=""
        hidden={confirmation === undefined}
      >
        {confirmation}
      </p>
    </>
  );
}

/**
 * The display choice a cell's **Assign to display** opens: the dialog around
 * the choice the theme's own page draws inline.
 *
 * **The dialog closes on a landed assignment** because the assign was the whole
 * errand; a page that was being read stays open instead and reads the
 * confirmation, which is why `AssignChoice` reports the landing rather than
 * closing anything itself.
 */
export function AssignDisplay(props: {
  readonly item: StoreItem;
  readonly client: ThemeLibraryClient;
  readonly onClose: () => void;
}): React.JSX.Element {
  const { item, client, onClose } = props;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      label={uiCopy.store.cell.actions.assign}
      closeLabel={uiCopy.store.assign.close}
    >
      {/* The dialog's own name, printed: the action a person pressed, so the
          surface says which of the four they are in. */}
      <p className="editor-shell-dialog-lead">
        {uiCopy.store.cell.actions.assign}
      </p>
      <AssignChoice item={item} client={client} onAssigned={onClose} />
    </Dialog>
  );
}
