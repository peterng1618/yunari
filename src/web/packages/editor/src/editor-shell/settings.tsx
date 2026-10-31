import { RadioGroup } from "@base-ui/react/radio-group";
import { Tabs } from "@base-ui/react/tabs";
import { SUPPORTED_SCHEMA_VERSION } from "@yunari/renderer-core";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  type CredentialResult,
  type CredentialRow,
  clearCredential,
  listCredentials,
  saveCredential,
  verifyCredential,
} from "../asset-finder/credentials-client.js";
import { ControlChoiceRow } from "../components/ui/control-choice-row.js";
import { ControlIconButton } from "../components/ui/control-icon-button.js";
import { ControlSegmented } from "../components/ui/control-segmented.js";
import { ControlToggle } from "../components/ui/control-toggle.js";
import { Dialog } from "../components/ui/dialog.js";
import {
  activePreviewRatioTokens,
  clearPreviewRatioTokens,
  DEFAULT_PREVIEW_RATIO_TOKENS,
  type PreviewRatio,
  type PreviewShape,
  parsePreviewRatio,
  previewCatalogueKey,
  previewLenses,
  setActivePreviewRatios,
  subscribeLenses,
  writePreviewRatioTokens,
} from "../display-lens.js";
import type { ShortcutOverrides } from "../shortcut-manager/bindings.js";
import type { ProductShortcutId } from "../shortcut-manager/index.js";
import { uiCopy } from "../ui-copy.js";
import {
  CONNECTIONS_GLYPH,
  FIT_GLYPH,
  Glyph,
  INFO_GLYPH,
  KEYBOARD_GLYPH,
  type LucideIcon,
  MINUS_GLYPH,
  PALETTE_GLYPH,
} from "./icons.js";
import {
  applyShellPalette,
  clearShellChoice,
  prefersDarkAppearance,
  type ShellPalette,
  shellPalettes,
  systemShellPalette,
  writeShellChoice,
} from "./palette.js";
import { SETTINGS_TRIGGER_ID } from "./rail.js";
import { SettingsKeyboard } from "./settings-keyboard.js";

/** The settings tabs, in the order the column draws them. One owner of "which
 *  tabs there are": the column and the panels both read it, so a tab cannot
 *  appear with a body and no word, or the reverse. */
export type SettingsTab =
  | "appearance"
  | "previews"
  | "keyboard"
  | "connections"
  | "about";

const SETTINGS_TABS: readonly SettingsTab[] = [
  "appearance",
  "previews",
  "keyboard",
  "connections",
  "about",
];

/** Each tab's glyph, from the one icon family the shell already draws with
 *  (stroke-based, `currentColor`, on a 24px grid). The
 *  navigation column carries a glyph per row; its three are a palette, a
 *  keyboard and an info mark, all of which the installed set has, so no glyph
 *  is invented and the icon set needs no addition. The
 *  word stays beside the glyph, so the tab's accessible name is the label. */
const SETTINGS_TAB_GLYPHS: Readonly<Record<SettingsTab, LucideIcon>> = {
  appearance: PALETTE_GLYPH,
  // The display menu's own frame mark: the tab manages what that menu offers.
  previews: FIT_GLYPH,
  keyboard: KEYBOARD_GLYPH,
  connections: CONNECTIONS_GLYPH,
  about: INFO_GLYPH,
};

/** The id the palette group is named by, kept out of the shell's other ids. */
const PALETTE_GROUP_ID = "yunari-settings-palette";

/** One fact the About tab renders, identified by the id it renders it under so
 *  a test reads the row by what it is rather than by its position. */
interface VersionFact {
  readonly id: "product-version" | "schema-version" | "release-version";
  /** The fact's own value. All three are strings; the tab renders them as
   *  they are. */
  readonly value: string;
}

/** Each fact's label, by the id it renders under. One owner of "what this row
 *  is called": the release row keeps the Document pane's own word for that fact
 *  (`panels.releaseVersion`), reused rather than respelled so one fact keeps one
 *  word. */
const VERSION_FACT_LABELS: Readonly<Record<VersionFact["id"], string>> = {
  "product-version": uiCopy.settings.aboutProductVersion,
  "schema-version": uiCopy.settings.aboutSchemaVersion,
  "release-version": uiCopy.panels.releaseVersion,
};

/** The version facts this build can honestly read, in the order they render.
 *
 *  **Every value is traceable to an owner**, which is what keeps the tab from
 *  inventing one: the product version is the workspace manifest's `version`,
 *  substituted here by Vite's `define` (the host reads the same field, so one
 *  number has one home); the schema version is `SUPPORTED_SCHEMA_VERSION`, the
 *  fact a reader supporting an old package needs; and the release version is the
 *  open document's own `metadata.version` — the same fact the Document pane's
 *  `releaseVersion` row reads, and never the product's. A document that carries
 *  no release version (a new or unsaved theme, or one whose stored version is
 *  empty) contributes no row: the design's missing reading is a gap stated by
 *  absence, never a placeholder that could read as data. */
export function versionFacts(
  releaseVersion: string | undefined,
): readonly VersionFact[] {
  const facts: VersionFact[] = [
    { id: "product-version", value: __YUNARI_VERSION__ },
    { id: "schema-version", value: SUPPORTED_SCHEMA_VERSION },
  ];
  if (releaseVersion !== undefined && releaseVersion !== "") {
    facts.push({ id: "release-version", value: releaseVersion });
  }
  return facts;
}

/** The Appearance tab: the six shell palettes, and follow-the-system.
 *
 *  The six are **cards in one radio group** rather than a `Segmented`, which
 *  the design sizes at 2–4 labels: six lifted segments is a control the design
 *  does not draw. The group takes the grid (`repeat(3,1fr)` of
 *  `--radius-lg` cards), so the columns follow it; the group's own keyboard
 *  model still walks the six in reading order, and a narrower dialog changing
 *  the columns would not change the arrow keys.
 *
 *  The preview is the shell's, not the control set's: each bar carries the
 *  `data-shell-palette` of the palette it NAMES, which is what makes a bar paint
 *  its own palette rather than inherit the one in force.
 *  `ControlChoiceRow` takes it as a node for exactly that reason.
 *
 *  The write is here, in the tab, exactly where the header menu that this
 *  replaces made it: `palette.ts` is the mechanism's owner and the shell owns
 *  the OS subscription, but "this click is a choice" is the surface's, and a
 *  shell that had to hold a second copy of it could drift from this one. */
function AppearanceTab({
  storage,
  palette,
  following,
  onPalette,
  onFollowing,
}: {
  /** `undefined` where the browser refuses local storage; the choice then holds
   *  for the session rather than refusing to be made. */
  readonly storage: Storage | undefined;
  readonly palette: ShellPalette;
  readonly following: boolean;
  readonly onPalette: (next: ShellPalette) => void;
  readonly onFollowing: (next: boolean) => void;
}): React.JSX.Element {
  /** The three steps the choice has always taken, in a fixed order:
   *  storage first (it is what stops the OS having a vote), then the attribute
   *  every palette block and every portalled surface reads, then the shell's
   *  live state. `applyShellPalette` is deliberately not optional — a palette
   *  applied to React state alone leaves a portalled popup painting the old one,
   *  which is the defect this ordering prevents. */
  const choose = (next: ShellPalette): void => {
    if (storage !== undefined) writeShellChoice(storage, next);
    applyShellPalette(next);
    onPalette(next);
    onFollowing(false);
  };

  /** Both directions. Turning following on deletes the stored choice — that
   *  key's absence is what "no choice" means to `readShellChoice` — and
   *  resolves the OS at once, so nothing waits for a media query to change.
   *  Turning it off pins what is already resolved: the author keeps the palette
   *  they were looking at rather than the shell jumping to the default. */
  const follow = (next: boolean): void => {
    onFollowing(next);
    if (next) {
      if (storage !== undefined) clearShellChoice(storage);
      const resolved = systemShellPalette(prefersDarkAppearance());
      applyShellPalette(resolved);
      onPalette(resolved);
      return;
    }
    if (storage !== undefined) writeShellChoice(storage, palette);
  };

  return (
    <>
      <h3 id={PALETTE_GROUP_ID}>{uiCopy.settings.palette}</h3>
      {/* `value`/`onValueChange` rather than a `checked` per row: the group is
          the one owner of which palette is in force, so the six rows cannot
          disagree with each other or with the shell's own state. */}
      <RadioGroup
        value={palette}
        onValueChange={choose}
        aria-labelledby={PALETTE_GROUP_ID}
        className="mt-[var(--space-8)] grid grid-cols-3 gap-[var(--space-8)]"
      >
        {shellPalettes.map((entry) => (
          <ControlChoiceRow
            key={entry}
            shape="card"
            label={entry}
            value={entry}
            data={{ "data-yunari-palette-choice": entry }}
            swatch={
              // Two bars, each resolving a role **of the palette this card
              // names** rather than of the one in force: the ground
              // (the `--bg`, "the window behind everything") and the accent.
              // The attribute is on each bar and not on the wrapper — a bar
              // that inherited it would be repainted by the baseline
              // declaration `.editor-shell-palette-swatch` carries, which is
              // the defect `shell-appearance.spec.ts` exists for.
              <span className="flex gap-[var(--space-4)]" aria-hidden>
                <span
                  className="editor-shell-palette-swatch"
                  data-shell-palette={entry}
                />
                <span
                  className="editor-shell-palette-swatch-accent"
                  data-shell-palette={entry}
                />
              </span>
            }
          />
        ))}
      </RadioGroup>
      {/* This row is a box rather than a labelled field row: the label sits at
          `flex:1` inside a `--panel-2` panel at `--radius-lg`, with no label
          column, so the switch's label fills the row and stays on one line. */}
      <div className="mt-[var(--space-14)]">
        <ControlToggle
          shape="boxed"
          label={uiCopy.settings.followSystem}
          checked={following}
          hint={
            storage === undefined
              ? uiCopy.settings.followSystemSessionOnly
              : uiCopy.settings.followSystemHint
          }
          data={{ "data-yunari-follow-system": "" }}
          onChange={follow}
        />
      </div>
    </>
  );
}

/** The Previews tab: the author-managed catalogue the display menu lists.
 *
 *  **One row per stored token**, showing the lens ids that token derives — a
 *  row of `16:9` offers `16:9` and `9:16`, and Remove removes the token, not
 *  one of the two. The duplicate check is the same rule from the other side: it
 *  compares the derived lens count, so a typed `9:16` is refused where `16:9`
 *  already carries it. Deriving the twin rule here instead would be a second
 *  owner of it, and would drift from `previewLenses`.
 *
 *  The tab writes storage and the module's live list together, exactly like the
 *  Appearance tab: the display menu and the viewport read the module state, and
 *  a tab that wrote only storage would print a list nothing else had. */
function PreviewsTab({
  storage,
}: {
  /** `undefined` where the browser refuses local storage; the list then holds
   *  for the session rather than refusing to be edited. */
  readonly storage: Storage | undefined;
}): React.JSX.Element {
  // The catalogue's revision, so a change from anywhere — this tab, another
  // window, a later surface — re-renders the list from the one module state.
  useSyncExternalStore(subscribeLenses, previewCatalogueKey);
  const tokens = activePreviewRatioTokens();
  const [shape, setShape] = useState<PreviewShape>("rect");
  const [draft, setDraft] = useState("");
  /** Why the last Add did nothing, as the refusal rule words it. `undefined` is "no refusal"
   *  and renders nothing — never an empty line standing in for one. */
  const [reason, setReason] = useState<string | undefined>(undefined);
  /** Whether the last write will survive a reload. `undefined` until one has
   *  been attempted; a store that exists but refuses the write reads the same
   *  as a browser that has none, which is what the note below says. */
  const [persisted, setPersisted] = useState<boolean | undefined>(undefined);

  /** Storage first, then the live list, as the Appearance tab writes its
   *  choice: a write that failed still leaves the session's list changed. */
  const commit = (next: readonly string[]): void => {
    setPersisted(writePreviewRatioTokens(storage, next));
    setActivePreviewRatios(next);
  };

  const add = (): void => {
    let ratio: PreviewRatio;
    try {
      // A circle is 1:1 by construction, so its token is the word itself and
      // the field is not rendered for it.
      ratio = parsePreviewRatio(shape === "circle" ? "Circle" : draft);
    } catch (error) {
      // The parser's only refusal is a `RangeError`; anything else is a defect
      // and belongs in the console rather than in the row.
      if (!(error instanceof RangeError)) throw error;
      setReason(uiCopy.settings.previewRatioInvalid);
      return;
    }
    // The shape control is the only way to choose a disc: `Circle` typed into
    // the Rect field would store a token the author did not choose there.
    if (ratio.shape === "circle" && shape === "rect") {
      setReason(uiCopy.settings.previewRatioInvalid);
      return;
    }
    if (
      previewLenses([...tokens, ratio.id]).length ===
      previewLenses(tokens).length
    ) {
      setReason(uiCopy.settings.previewRatioDuplicate);
      return;
    }
    setReason(undefined);
    setDraft("");
    commit([...tokens, ratio.id]);
  };

  const removeRatio = (id: string): void => {
    setReason(undefined);
    commit(tokens.filter((token) => parsePreviewRatio(token).id !== id));
  };

  const reset = (): void => {
    // Removing the key is what returns the list to the defaults; the live list
    // is set explicitly because the module never re-reads storage.
    setPersisted(clearPreviewRatioTokens(storage));
    setReason(undefined);
    setActivePreviewRatios(DEFAULT_PREVIEW_RATIO_TOKENS);
  };

  const atDefaults =
    tokens.length === DEFAULT_PREVIEW_RATIO_TOKENS.length &&
    tokens.every(
      (token, index) => token === DEFAULT_PREVIEW_RATIO_TOKENS[index],
    );

  return (
    <div className="flex flex-col gap-[var(--space-8)]" data-yunari-previews="">
      <h3>{uiCopy.settings.previewRatiosHeading}</h3>
      <p className="text-sm text-muted">{uiCopy.settings.previewRatiosHint}</p>
      {tokens.length === 0 ? (
        <p className="text-sm text-muted">
          {uiCopy.settings.previewRatiosEmpty}
        </p>
      ) : (
        <div className="flex flex-col gap-[var(--space-4)]">
          {tokens.map((token) => {
            const ratio = parsePreviewRatio(token);
            const ids = previewLenses([token]).map((lens) => lens.id);
            return (
              <div
                key={token}
                className="flex items-center gap-[var(--space-8)] rounded-[var(--radius-sm)] border border-edge bg-[var(--panel-2)] px-[var(--space-10)] py-[var(--space-4)]"
                data-yunari-preview-ratio={token}
              >
                <span className="flex-1 font-mono text-sm">
                  {ids.join(" ")}
                </span>
                {/* The tab composes a control's own name the way the
                    Connections rows do: the shared word plus the row's ids,
                    so two Remove buttons are not the same accessible name. */}
                <ControlIconButton
                  label={`${uiCopy.settings.previewRatioRemove} ${ids.join(" ")}`}
                  data={{ "data-yunari-preview-ratio-remove": token }}
                  onClick={() => removeRatio(ratio.id)}
                >
                  <Glyph icon={MINUS_GLYPH} size={14} />
                </ControlIconButton>
              </div>
            );
          })}
        </div>
      )}
      <ControlSegmented
        label={uiCopy.settings.previewRatioShape}
        value={shape}
        options={[
          { id: "rect", name: uiCopy.settings.previewRatioRect },
          { id: "circle", name: uiCopy.settings.previewRatioCircle },
        ]}
        data={{ "data-yunari-preview-ratio-shape": "" }}
        onChange={(next) => {
          setShape(next);
          setReason(undefined);
        }}
      />
      <div className="flex items-center gap-[var(--space-8)]">
        {shape === "circle" ? null : (
          <input
            type="text"
            aria-label={uiCopy.settings.previewRatioField}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setReason(undefined);
            }}
            data-yunari-preview-ratio-input=""
            className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-edge bg-[var(--bg)] px-[var(--space-8)] py-[var(--space-6)] font-mono text-sm"
          />
        )}
        <button
          type="button"
          onClick={add}
          data-yunari-preview-ratio-add=""
          className="rounded-[var(--radius-sm)] border border-edge px-[var(--space-10)] py-[var(--space-4)] text-sm"
        >
          {uiCopy.settings.previewRatioAdd}
        </button>
        <button
          type="button"
          disabled={atDefaults}
          onClick={reset}
          data-yunari-preview-ratio-reset=""
          className="rounded-[var(--radius-sm)] border border-edge px-[var(--space-10)] py-[var(--space-4)] text-sm"
        >
          {uiCopy.settings.previewRatioReset}
        </button>
      </div>
      {reason === undefined ? null : (
        // The refusal, announced the way the Keyboard tab's is: the node is
        // an alert, so the sentence reaches a screen reader when Add refuses.
        <p className="text-sm" data-yunari-preview-ratio-reason="" role="alert">
          {reason}
        </p>
      )}
      {storage === undefined || persisted === false ? (
        <p className="text-sm text-muted">
          {uiCopy.settings.previewRatiosSessionOnly}
        </p>
      ) : null}
    </div>
  );
}

/** The About tab: what this editor is, and the version facts this build can
 *  honestly read.
 *
 *  It renders `versionFacts` and nothing else, so the one rule it could break —
 *  printing a version no owner has — is broken by `versionFacts` or not at all.
 *  The release version arrives as a prop because the fact is the shell's
 *  (`ThemeMetadata.version`), read once there and handed down: the tab reads no
 *  document, no store and no panel. Where a fact is absent the row is absent
 *  too — no `panels.notSet`, no dash that could read as a version. */
function AboutTab({
  releaseVersion,
}: {
  readonly releaseVersion: string | undefined;
}): React.JSX.Element {
  return (
    <div
      className="editor-shell-about flex flex-col gap-[var(--space-8)]"
      data-yunari-about=""
    >
      <p className="text-sm text-muted">{uiCopy.settings.aboutProvenance}</p>
      <dl>
        {versionFacts(releaseVersion).map((fact) => (
          <div key={fact.id}>
            <dt>{VERSION_FACT_LABELS[fact.id]}</dt>
            <dd
              className="font-mono text-text"
              data-yunari-about-fact={fact.id}
            >
              {String(fact.value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The Connections tab: every provider key this host knows, and the one place
 *  a key is entered.
 *
 *  A stored value is never rendered again — the row shows the host's hint, and
 *  the input only ever carries what this tab is about to send. Save's answer is
 *  the host's; the row is refreshed from the host rather than from the draft, so
 *  a refused write cannot leave the page saying a key was stored. */
function ConnectionsTab(): React.JSX.Element {
  const [rows, setRows] = useState<readonly CredentialRow[]>([]);
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [messages, setMessages] = useState<Readonly<Record<string, string>>>(
    {},
  );
  const [busy, setBusy] = useState<string | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void listCredentials().then((next) => {
      if (live) setRows(next);
    });
    return () => {
      live = false;
    };
  }, []);

  const run = async (
    id: string,
    work: () => Promise<CredentialResult>,
  ): Promise<void> => {
    setBusy(id);
    const result = await work();
    setMessages((current) => {
      const next = { ...current };
      if (result.ok) delete next[id];
      else next[id] = result.message;
      return next;
    });
    setRows(await listCredentials());
    setBusy(undefined);
  };

  const save = (id: string): void => {
    void run(id, async () => {
      const result = await saveCredential(id, drafts[id] ?? "");
      if (result.ok) setDrafts((current) => ({ ...current, [id]: "" }));
      return result;
    });
  };

  return (
    <div
      className="flex flex-col gap-[var(--space-8)]"
      data-yunari-connections=""
    >
      <h3>{uiCopy.settings.connectionsHeading}</h3>
      <p className="text-sm text-muted">{uiCopy.settings.connectionsIntro}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{uiCopy.settings.connectionsEmpty}</p>
      ) : (
        rows.map((row) => (
          <div
            key={row.id}
            className="flex flex-col gap-[var(--space-8)] rounded-[var(--radius-lg)] border border-edge bg-[var(--panel-2)] p-[var(--space-10)]"
            data-yunari-credential-row={row.id}
          >
            <div className="flex items-center gap-[var(--space-8)]">
              <span className="flex-1 font-medium">{row.label}</span>
              <span className="text-sm text-muted">
                {row.set
                  ? uiCopy.settings.connectionsSaved(row.hint)
                  : uiCopy.settings.connectionsNotSet}
              </span>
            </div>
            <div className="flex items-center gap-[var(--space-8)]">
              <input
                type="password"
                aria-label={`${row.label} ${uiCopy.settings.connectionsPlaceholder}`}
                placeholder={uiCopy.settings.connectionsPlaceholder}
                value={drafts[row.id] ?? ""}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [row.id]: event.target.value,
                  }))
                }
                data-yunari-credential-input={row.id}
                className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-edge bg-[var(--bg)] px-[var(--space-8)] py-[var(--space-6)] font-mono text-sm"
              />
              <button
                type="button"
                disabled={busy === row.id || (drafts[row.id] ?? "") === ""}
                onClick={() => save(row.id)}
                data-yunari-credential-save={row.id}
                className="rounded-[var(--radius-sm)] border border-edge px-[var(--space-10)] py-[var(--space-4)] text-sm"
              >
                {uiCopy.settings.connectionsSave}
              </button>
              <button
                type="button"
                disabled={!row.set || busy === row.id}
                onClick={() => void run(row.id, () => clearCredential(row.id))}
                data-yunari-credential-clear={row.id}
                className="rounded-[var(--radius-sm)] border border-edge px-[var(--space-10)] py-[var(--space-4)] text-sm"
              >
                {uiCopy.settings.connectionsClear}
              </button>
              <button
                type="button"
                disabled={!row.set || !row.verify || busy === row.id}
                onClick={() => void run(row.id, () => verifyCredential(row.id))}
                data-yunari-credential-verify={row.id}
                className="rounded-[var(--radius-sm)] border border-edge px-[var(--space-10)] py-[var(--space-4)] text-sm"
              >
                {uiCopy.settings.connectionsVerify}
              </button>
            </div>
            {row.helpText === null || row.helpUrl === null ? null : (
              <p
                className="text-sm text-muted"
                data-yunari-credential-help={row.id}
              >
                {row.helpText}{" "}
                <a
                  href={row.helpUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  {uiCopy.settings.connectionsWhereToGetKey}
                </a>
              </p>
            )}
            {messages[row.id] === undefined ? null : (
              <p className="text-sm">{messages[row.id]}</p>
            )}
          </div>
        ))
      )}
      <p className="text-sm text-muted">{uiCopy.settings.connectionsFooter}</p>
    </div>
  );
}

/** The settings modal the rail's gear opens.
 *
 *  Base UI's `Dialog` is modal by default, so focus is trapped and the page
 *  behind is inert; `Esc` closes it through `onOpenChange`. The one thing the
 *  library does not do for a dialog opened from outside its own tree is return
 *  focus to the gear — there is no `Dialog.Trigger` to register — so the close
 *  restores it from the gear's id. The tabs are `@base-ui/react/tabs` rather
 *  than a hand-rolled `role="tablist"`, because the arrow-key navigation and
 *  the `aria-selected`/`aria-controls` wiring are the primitive's job.
 *
 *  Appearance, Keyboard and About are each filled here. The
 *  palette is the shell's own state rather than the tab's, because the shell
 *  holds the `watchSystemAppearance` subscription the choice has to reach: the
 *  tab renders the choice and owns none of it. The bindings are the shell's for
 *  the same reason — the dispatcher and the effective table live outside
 *  React — and which row is armed is the tab's state held here only so the
 *  close clears it; Escape closes the modal whatever the row is doing. */
export function Settings(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Passed straight through to the tabs, which own nothing of their own. */
  readonly storage: Storage | undefined;
  readonly palette: ShellPalette;
  readonly following: boolean;
  readonly onPalette: (next: ShellPalette) => void;
  readonly onFollowing: (next: boolean) => void;
  /** The author's bindings, held by the shell because the effective table and
   *  the dispatcher live outside React. The tab reads them and asks for a new
   *  set; it writes storage itself, as the Appearance tab does. */
  readonly overrides: ShortcutOverrides;
  readonly onOverrides: (next: ShortcutOverrides) => void;
  /** The open document's release version, read by the shell from the same
   *  `ThemeMetadata.version` the Document pane's `releaseVersion` row reads, or
   *  `undefined` where the document carries none. The About tab renders it and
   *  invents nothing in its place. */
  readonly releaseVersion: string | undefined;
  /** The tab a caller opens the modal on; the last chosen tab otherwise. */
  readonly initialTab?: SettingsTab | undefined;
}): React.JSX.Element {
  const {
    open,
    onOpenChange,
    storage,
    palette,
    following,
    onPalette,
    onFollowing,
    overrides,
    onOverrides,
    releaseVersion,
    initialTab,
  } = props;
  /** The row whose capture is listening. Held here rather than in the tab so
   *  closing the modal clears it from one place — the `open` effect below — and
   *  no armed row can outlive the surface it belongs to. */
  const [armed, setArmed] = useState<ProductShortcutId | undefined>(undefined);
  /** The open tab. Held here because a caller (the finder's needs-key state)
   *  opens the modal on Connections, and the tab must follow that ask. */
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? "appearance");
  // Whether the modal has been open at all, so closing the *initial* closed
  // state does not fire a focus restore on mount.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      if (initialTab !== undefined) setTab(initialTab);
      wasOpen.current = true;
      return;
    }
    setArmed(undefined);
    if (!wasOpen.current) return;
    wasOpen.current = false;
    document.getElementById(SETTINGS_TRIGGER_ID)?.focus();
  }, [open, initialTab]);

  /** Whether a capture is armed is the row's state, and it never stands between
   *  the author and the way out.
   *
   *  An earlier cut declined Base UI's dismissal for every `false` while armed,
   *  so a capture's Escape would cancel the row and leave the modal up. That
   *  bought one nicety — the tab staying where it was — at the price of the
   *  modal being unclosable whenever `armed` outlived its row: the arm's
   *  `focus()` failing is enough, and a pointer dismissal was declined with the
   *  Escape path because the library reports both as the same `false`. The
   *  dismissal is passed straight through now: Escape closes the modal, the
   *  `open` effect below clears `armed` with it, and the row's own Escape
   *  handler disarms in the same press for the case where it still has focus. */
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      label={uiCopy.settings.title}
      closeLabel={uiCopy.settings.close}
    >
      <h2 className="editor-shell-dialog-lead">{uiCopy.settings.title}</h2>
      {/* A **vertical** tablist: settings navigation is a column beside the
          panel, not a row of words above it. The control set
          opens the control vocabulary — "The vocabulary is closed. A control is
          one of these, or it is not a control." — and no *tab* is in it, so the
          written rules leave the axis open. The column is this surface's own
          rule: it keeps the three rows beside the panel instead of adding a
          second strip above it. The
          primitive stays Base UI's and only its orientation and treatment
          change; `orientation` is what points the arrow keys up and down the
          three rows rather than across. */}
      <Tabs.Root
        value={tab}
        onValueChange={(value) => setTab(value as SettingsTab)}
        orientation="vertical"
        className="editor-shell-settings"
      >
        <Tabs.List className="editor-shell-settings-tabs">
          {SETTINGS_TABS.map((tab) => (
            <Tabs.Tab
              key={tab}
              value={tab}
              className="editor-shell-settings-tab"
            >
              <Glyph icon={SETTINGS_TAB_GLYPHS[tab]} size={14} />
              {uiCopy.settings[tab]}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {SETTINGS_TABS.map((tab) => (
          <Tabs.Panel
            key={tab}
            value={tab}
            className="editor-shell-settings-panel"
          >
            {tab === "appearance" ? (
              <AppearanceTab
                storage={storage}
                palette={palette}
                following={following}
                onPalette={onPalette}
                onFollowing={onFollowing}
              />
            ) : null}
            {tab === "previews" ? <PreviewsTab storage={storage} /> : null}
            {tab === "keyboard" ? (
              <SettingsKeyboard
                storage={storage}
                overrides={overrides}
                armed={armed}
                onArmed={setArmed}
                onOverrides={onOverrides}
              />
            ) : null}
            {tab === "connections" ? <ConnectionsTab /> : null}
            {tab === "about" ? (
              <AboutTab releaseVersion={releaseVersion} />
            ) : null}
          </Tabs.Panel>
        ))}
      </Tabs.Root>
    </Dialog>
  );
}
