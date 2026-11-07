import type { ThemeRemix } from "@yunari/renderer-core";
import { createElement, useState } from "react";
import {
  type ControlOption,
  ControlSelect,
} from "./components/ui/control-select.js";
import { controlStateAttributes } from "./components/ui/control-state.js";
import { ControlText } from "./components/ui/control-text.js";
import { ACTION_BUTTON, Dialog } from "./components/ui/dialog.js";
import type { ModalSettle } from "./components/ui/modal-host.js";
import { openModal } from "./components/ui/modal-host.js";
import { STARTER_TEMPLATE } from "./new-fabric-theme.js";
import {
  createThemeLibraryClient,
  type ThemeLibraryClient,
  type ThemeLibraryEntry,
} from "./theme-library-client.js";
import { uiCopy } from "./ui-copy.js";

/** What the author picked, and which kind of thing it is. A template and a
 *  saved theme are opened by different routes — one is built here, the other
 *  fetched over the library API — so the choice has to carry which it was. */
export type ThemeLibraryChoice =
  | { readonly kind: "template"; readonly id: string }
  | { readonly kind: "theme"; readonly id: string }
  /** A copy of an installed theme, carrying the parent it must credit. The
   *  chooser reads that parent off the host's origin record, because a document
   *  cannot describe where it came from without the catalogue. */
  | {
      readonly kind: "remix";
      readonly id: string;
      readonly remixOf: ThemeRemix;
    }
  /** A copy of a theme the host holds no catalogue origin for, so there is no
   *  parent to credit: the copy keeps its name and carries no `remixOf`. */
  | { readonly kind: "duplicate"; readonly id: string };

/** The confirmation's sentence is `uiCopy.library.confirmRemoval`'s: the dialog
 *  says it twice — as its accessible name and as its visible lead — so one
 *  table entry keeps a screen reader and a sighted reader told the same thing. */

/** The control's own word, from the action table: the same Delete the selection
 *  net owns, rather than a second literal that happens to match it. */
const DELETE_LABEL = uiCopy.actions.delete;

/** The control's own word, from the copy table: the surfaces walk reads every
 *  rendered word and refuses a literal it cannot find in `uiCopy`. */
const REMIX_LABEL = uiCopy.library.remix;

/** The other copy: available where there is no catalogue parent to name, so it
 *  takes its word from the action table rather than the library's. */
const DUPLICATE_LABEL = uiCopy.actions.duplicate;

/** The client a removal goes through, or undefined when there is none — in
 *  which case the chooser offers no deletion rather than failing when the
 *  author presses a button it drew. */
function remover(
  client: ThemeLibraryClient | undefined,
): ((id: string) => Promise<void>) | undefined {
  if (client?.remove !== undefined) {
    return (id: string) => client.remove?.(id) ?? Promise.resolve();
  }
  // The chooser is opened by the editor, which serves from the same host as
  // the library, so its own client is the right one when none was handed in.
  const own = createThemeLibraryClient();
  return own.remove === undefined ? undefined : own.remove.bind(own);
}

/**
 * What the chooser reads off a template: the id it is opened by and the label
 * it is shown under.
 *
 * Not a `ThemeLibraryEntry`: a template has no document in the host's library,
 * so it has no derived record and no modified time, and the chooser reads
 * neither. The two lists meet on this rather than on the whole entry.
 */
export interface TemplateEntry {
  readonly id: string;
  readonly name: string;
}

/** The id of the first option the list offers, which is the one a native
 *  `<select>` would have selected. */
function firstId(
  templates: readonly TemplateEntry[],
  themes: readonly ThemeLibraryEntry[],
): string {
  return templates[0]?.id ?? themes[0]?.id ?? "";
}

/**
 * Asks which theme to open: the product's templates, or the author's own.
 *
 * The two are listed separately because they are different in kind, and the
 * difference is the whole point of making the starter a template rather than
 * what `New` means. A template is something the product offers; a saved theme
 * is something the author made and can delete. Flattened into one list, the
 * starter would read as the author's own work — which is the claim the product
 * is withdrawing.
 *
 * A `Dialog` rather than a `<dialog>`, so it is dismissible by Escape and
 * reachable by keyboard through Base UI's own modal behaviour, and a
 * `ControlSelect` for the list so the surface joins the plan-1 control set.
 */
export function ThemeLibraryChooser({
  themes,
  templates,
  client,
  onRemoved,
  settle,
}: {
  readonly themes: readonly ThemeLibraryEntry[];
  readonly templates: readonly TemplateEntry[];
  readonly client?: ThemeLibraryClient | undefined;
  /** A theme the host accepted a removal for. The library manager listens so
   *  the open document stops claiming a folder that no longer exists. */
  readonly onRemoved?: ((id: string) => void) | undefined;
  readonly settle: ModalSettle<ThemeLibraryChoice>;
}): React.JSX.Element {
  /** What the author has selected, and their own themes, which a removal
   *  shortens. The templates are the product's and never change here. */
  const [selected, setSelected] = useState(() => firstId(templates, themes));
  const [own, setOwn] = useState(themes);
  /** The theme a confirmation is open for, if any. Held here rather than in a
   *  second imperative `<dialog>` so one unmount clears both. */
  const [confirming, setConfirming] = useState<string | undefined>(undefined);
  /** Why the last removal did not happen, read by the author, not swallowed. */
  const [status, setStatus] = useState<string | undefined>(undefined);
  /** Whether a removal is out. The confirmation stays mounted until it lands,
   *  so without this the same Delete could be pressed twice. */
  const [removing, setRemoving] = useState(false);

  // Read once: a per-render client would be a new one every time, and the
  // removal would reach a host the session never talked to.
  const [canRemove] = useState(() => remover(client));

  const kind = (id: string): "template" | "theme" | undefined => {
    if (templates.some((entry) => entry.id === id)) return "template";
    if (own.some((entry) => entry.id === id)) return "theme";
    return undefined;
  };
  const selectedKind = kind(selected);
  /** The origin record, which only an installed theme has. Read from `own`
   *  rather than by kind, so an origin-less theme has none — and a template
   *  sharing a theme's id still reads the theme's record, which is why the
   *  remix control asks both. */
  const selectedEntry = own.find((entry) => entry.id === selected);
  const origin = selectedEntry?.origin;

  /** A remix settles the choice here rather than opening anything: the caller
   *  fetches the theme, and the parent has to travel with the answer because
   *  the fetched document does not know what it was installed from. */
  const remix = (): void => {
    if (selectedEntry === undefined || origin === undefined) return;
    settle.close({
      kind: "remix",
      id: selectedEntry.id,
      remixOf: {
        catalogueId: origin.catalogueId,
        name: selectedEntry.name,
        version: origin.version,
      },
    });
  };

  /** The origin-less copy settles the same way a remix does: the caller reads
   *  the theme, but there is no parent to carry with the answer. */
  const duplicate = (): void => {
    if (selectedKind !== "theme" || selectedEntry === undefined) return;
    if (origin !== undefined) return;
    settle.close({ kind: "duplicate", id: selectedEntry.id });
  };

  const open = (): void => {
    const chosen = selectedKind;
    if (chosen === undefined) {
      // Nothing is selected — an empty list — so Open answers nothing, which is
      // what the native `<select>` did with no option to read.
      settle.dismiss();
      return;
    }
    settle.close({ kind: chosen, id: selected });
  };

  /** The confirmation's own answer. Accepting shortens the list rather than
   *  closing the chooser, so the author carries on with the themes that are
   *  still theirs; a failure keeps the row and puts the reason on screen. */
  const remove = async (id: string): Promise<void> => {
    if (canRemove === undefined || removing) return;
    setRemoving(true);
    try {
      await canRemove(id);
      onRemoved?.(id);
      setOwn((current) => current.filter((entry) => entry.id !== id));
      setStatus(undefined);
      // The removed row was the selection: the list moves to its first option
      // the way a `<select>` does, rather than holding an id that is gone.
      setSelected((current) =>
        current === id
          ? firstId(
              templates,
              own.filter((entry) => entry.id !== id),
            )
          : current,
      );
    } catch (error: unknown) {
      // Nothing was lost, so the row stays and the reason is on screen: a
      // silent failure here is indistinguishable from a successful delete.
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setRemoving(false);
      setConfirming(undefined);
    }
  };

  const confirmEntry = own.find((entry) => entry.id === confirming);

  return (
    <>
      <Dialog
        open
        onOpenChange={(next) => {
          if (!next) settle.dismiss();
        }}
        label={uiCopy.library.choose}
      >
        <p className="editor-shell-dialog-lead">{uiCopy.library.choose}</p>
        <div className="flex flex-col gap-[var(--space-8)]">
          {/* Its own words, not the dialog's: the lead line already says "Open a
              theme", and a label repeating it printed twice over the control. */}
          <ControlSelect
            label={uiCopy.library.themeField}
            data={{ "data-yunari-library-theme": "" }}
            value={selected}
            options={libraryOptions(templates, own)}
            onChange={setSelected}
          />
          <div className="yunari-dialog-actions">
            <button
              type="button"
              className={ACTION_BUTTON}
              data-yunari-library-remix=""
              // Disabled rather than absent, as the delete is: a template has
              // no catalogue parent, and neither has a theme made here, so
              // there is nothing to credit. The kind is read as well as the
              // origin, because a template and a theme can share an id.
              disabled={selectedKind !== "theme" || origin === undefined}
              onClick={remix}
            >
              {REMIX_LABEL}
            </button>
            <button
              type="button"
              className={ACTION_BUTTON}
              data-yunari-library-duplicate=""
              // The mirror of the remix: a theme the host records no catalogue
              // origin for can still be copied, but the copy has no parent to
              // name. A template has no document at all, so neither applies.
              disabled={selectedKind !== "theme" || origin !== undefined}
              onClick={duplicate}
            >
              {DUPLICATE_LABEL}
            </button>
            {canRemove === undefined ? null : (
              <button
                type="button"
                className={ACTION_BUTTON}
                data-yunari-library-delete=""
                // Disabled rather than absent for a template: the control is one
                // that exists and says what it would do, instead of appearing
                // and vanishing as the selection moves.
                disabled={selectedKind !== "theme"}
                onClick={() => setConfirming(selected)}
              >
                {DELETE_LABEL}
              </button>
            )}
            <button
              type="button"
              className={ACTION_BUTTON}
              data-yunari-library-cancel=""
              onClick={settle.dismiss}
            >
              {uiCopy.library.cancel}
            </button>
            <button
              type="button"
              className={ACTION_BUTTON}
              data-yunari-library-open=""
              onClick={open}
            >
              {uiCopy.library.open}
            </button>
          </div>
          {/* **Mounted whether or not it says anything.** A live region added
              together with its own text is the less reliably announced pattern,
              so the node is always here, empty and `hidden`, and only its text
              moves — the shape the imperative dialog had.

              It carries the dialog's status rule, **not** the lead's: a status
              is not the dialog's name, and on the lead rule it read as a second
              title (a failed removal printed its message at the title's 15px). */}
          <p
            className="editor-shell-dialog-status"
            role="status"
            data-yunari-library-status=""
            hidden={status === undefined}
          >
            {status}
          </p>
        </div>
      </Dialog>
      {confirming === undefined ? null : (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) setConfirming(undefined);
          }}
          label={uiCopy.library.confirmRemoval(confirming, confirmEntry?.name)}
        >
          <p className="editor-shell-dialog-lead">
            {uiCopy.library.confirmRemoval(confirming, confirmEntry?.name)}
          </p>
          <div className="yunari-dialog-actions">
            {/* A removal is one write; the status line is where its refusal is
                read, so these controls carry busy and keep no outcome. */}
            <button
              type="button"
              className={ACTION_BUTTON}
              data-yunari-library-cancel=""
              disabled={removing}
              onClick={() => setConfirming(undefined)}
            >
              {uiCopy.library.cancel}
            </button>
            <button
              type="button"
              className={ACTION_BUTTON}
              data-yunari-library-delete-confirm=""
              disabled={removing}
              {...controlStateAttributes(removing ? "busy" : undefined)}
              onClick={() => void remove(confirming)}
            >
              {DELETE_LABEL}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

/** The templates and the author's themes, each under its own heading. A saved
 *  theme carries its id because two themes can share a display name; a template
 *  has one, so the id is noise there. */
function libraryOptions(
  templates: readonly TemplateEntry[],
  themes: readonly ThemeLibraryEntry[],
): readonly ControlOption[] {
  return [
    ...templates.map((entry) => ({
      id: entry.id,
      name: entry.name,
      group: uiCopy.library.templates,
    })),
    ...themes.map((entry) => ({
      id: entry.id,
      name: `${entry.name} (${entry.id})`,
      group: uiCopy.library.yourThemes,
    })),
  ];
}

/** What an author can do about a save the host refused. */
export type ThemeConflictChoice = "reload" | "overwrite";

/**
 * Asks what to do about a save that was refused because the stored theme moved
 * on. Two answers and a way out, because a refusal must not cost the author
 * their document and must not be a dead end: reload discards their unsaved
 * edits in favour of the stored version, overwrite discards the stored version
 * in favour of their edits, and cancelling keeps both.
 */
export function ThemeConflict({
  settle,
}: {
  readonly settle: ModalSettle<ThemeConflictChoice>;
}): React.JSX.Element {
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) settle.dismiss();
      }}
      label={uiCopy.library.conflict.lead}
    >
      <p className="editor-shell-dialog-lead">{uiCopy.library.conflict.lead}</p>
      <div className="yunari-dialog-actions">
        {(
          [
            ["reload", uiCopy.library.conflict.reload],
            ["overwrite", uiCopy.library.conflict.overwrite],
          ] as const
        ).map(([choice, label]) => (
          <button
            key={choice}
            type="button"
            className={ACTION_BUTTON}
            {...{ [`data-yunari-library-${choice}`]: "" }}
            onClick={() => settle.close(choice)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className={ACTION_BUTTON}
          data-yunari-library-cancel=""
          onClick={settle.dismiss}
        >
          {uiCopy.library.conflict.cancel}
        </button>
      </div>
    </Dialog>
  );
}

/**
 * Asks for the name a **Save as** writes the open document under.
 *
 * A real dialog rather than the browser's `prompt`, because the name is a
 * document fact the editor can read and show while it is being changed, and
 * because the answer is a string the caller can cancel — an empty name is not
 * an answer, so the action stays disabled until the field holds one.
 */
export function ThemeSaveAsDialog({
  initialName,
  settle,
}: {
  readonly initialName: string;
  readonly settle: ModalSettle<string>;
}): React.JSX.Element {
  const [name, setName] = useState(initialName);
  const trimmed = name.trim();
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) settle.dismiss();
      }}
      label={uiCopy.library.saveAs.title}
    >
      <p className="editor-shell-dialog-lead">{uiCopy.library.saveAs.lead}</p>
      <div className="flex flex-col gap-[var(--space-8)]">
        <ControlText
          label={uiCopy.library.saveAs.name}
          data={{ "data-yunari-save-as-name": "" }}
          value={name}
          onCommit={setName}
        />
        <div className="yunari-dialog-actions">
          <button
            type="button"
            className={ACTION_BUTTON}
            data-yunari-save-as-cancel=""
            onClick={settle.dismiss}
          >
            {uiCopy.library.cancel}
          </button>
          <button
            type="button"
            className={ACTION_BUTTON}
            data-yunari-save-as-confirm=""
            disabled={trimmed.length === 0}
            onClick={() => settle.close(trimmed)}
          >
            {uiCopy.library.saveAs.action}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Asks which theme to open: the product's templates, or the author's own.
 *
 * A dismissal — Cancel, Escape, a host closing it — resolves `undefined`, which
 * is what an empty return value already meant.
 */
export function promptThemeSelection(
  themes: readonly ThemeLibraryEntry[],
  templates: readonly TemplateEntry[] = [STARTER_TEMPLATE],
  options?: {
    readonly client?: ThemeLibraryClient;
    /** Told when the chooser's own delete succeeds. */
    readonly onRemoved?: (id: string) => void;
  },
): Promise<ThemeLibraryChoice | undefined> {
  return openModal((settle) =>
    createElement(ThemeLibraryChooser, {
      themes,
      templates,
      client: options?.client,
      onRemoved: options?.onRemoved,
      settle,
    }),
  );
}

export function promptThemeConflict(): Promise<
  ThemeConflictChoice | undefined
> {
  return openModal((settle) => createElement(ThemeConflict, { settle }));
}

export function promptThemeSaveAs(
  initialName: string,
): Promise<string | undefined> {
  return openModal((settle) =>
    createElement(ThemeSaveAsDialog, { initialName, settle }),
  );
}
