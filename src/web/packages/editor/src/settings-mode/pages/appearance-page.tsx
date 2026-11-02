import { RadioGroup } from "@base-ui/react/radio-group";
import { useState, useSyncExternalStore } from "react";
import { ControlChoiceRow } from "../../components/ui/control-choice-row.js";
import { ControlIconButton } from "../../components/ui/control-icon-button.js";
import { ControlToggle } from "../../components/ui/control-toggle.js";
import { ControlWell } from "../../components/ui/control-well.js";
import { ACTION_BUTTON } from "../../components/ui/dialog.js";
import {
  activePreviewRatioTokens,
  clearPreviewRatioTokens,
  DEFAULT_PREVIEW_RATIO_TOKENS,
  type PreviewRatio,
  parsePreviewRatio,
  previewCatalogueKey,
  previewLenses,
  previewRatioKey,
  setActivePreviewRatios,
  sortPreviewTokens,
  subscribeLenses,
  writePreviewRatioTokens,
} from "../../display-lens.js";
import { Glyph, MINUS_GLYPH } from "../../editor-shell/icons.js";
import {
  applyShellPalette,
  clearShellChoice,
  prefersDarkAppearance,
  type ShellPalette,
  shellPalettes,
  systemShellPalette,
  writeShellChoice,
} from "../../editor-shell/palette.js";
import { uiCopy } from "../../ui-copy.js";
import { Page } from "../page.js";
import { Group } from "../section-group.js";

/** The id the palette group is named by, kept out of the shell's other ids. */
const PALETTE_GROUP_ID = "yunari-settings-palette";

/**
 * The Appearance page: the shell palette and the preview ratios, side by side.
 * Both are editor preferences rather than document state, so neither reads the
 * open theme; the palette applies to every shell surface at once.
 */
export function AppearancePage(props: {
  /** `undefined` where the browser refuses local storage; a choice then holds
   *  for the session rather than refusing to be made. */
  readonly storage: Storage | undefined;
  readonly palette: ShellPalette;
  readonly following: boolean;
  readonly onPalette: (next: ShellPalette) => void;
  readonly onFollowing: (next: boolean) => void;
}): React.JSX.Element {
  return (
    <Page page="appearance">
      <div className="grid gap-[var(--space-24)] xl:grid-cols-[minmax(0,1.2fr)_minmax(var(--dialog-min-width),0.8fr)]">
        <PaletteSection
          storage={props.storage}
          palette={props.palette}
          following={props.following}
          onPalette={props.onPalette}
          onFollowing={props.onFollowing}
        />
        <PreviewsSection storage={props.storage} />
      </div>
    </Page>
  );
}

/** The six shell palettes and follow-the-system.
 *
 *  The six are **cards in one radio group** rather than a `Segmented`, which
 *  the design sizes at 2–4 labels: six lifted segments is a control the design
 *  does not draw. The group takes the grid (`repeat(3,1fr)` of `--radius-lg`
 *  cards), so the columns follow it; the group's own keyboard model still walks
 *  the six in reading order, and a narrower page changing the columns would not
 *  change the arrow keys. */
function PaletteSection(props: {
  readonly storage: Storage | undefined;
  readonly palette: ShellPalette;
  readonly following: boolean;
  readonly onPalette: (next: ShellPalette) => void;
  readonly onFollowing: (next: boolean) => void;
}): React.JSX.Element {
  const { storage, palette, following, onPalette, onFollowing } = props;

  /** The three steps the choice has always taken, in a fixed order: storage
   *  first (it is what stops the OS having a vote), then the attribute every
   *  palette block and every portalled surface reads, then the shell's live
   *  state. */
  const choose = (next: ShellPalette): void => {
    if (storage !== undefined) writeShellChoice(storage, next);
    applyShellPalette(next);
    onPalette(next);
    onFollowing(false);
  };

  /** Turning following on deletes the stored choice — that key's absence is
   *  what "no choice" means to `readShellChoice` — and resolves the OS at once.
   *  Turning it off pins what is already resolved. */
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
    <Group
      testId="palette"
      headingId={PALETTE_GROUP_ID}
      name={uiCopy.settings.palette}
    >
      <RadioGroup
        value={palette}
        onValueChange={choose}
        aria-labelledby={PALETTE_GROUP_ID}
        className="grid grid-cols-3 gap-[var(--space-8)]"
      >
        {shellPalettes.map((entry) => (
          <ControlChoiceRow
            key={entry}
            shape="card"
            label={entry}
            value={entry}
            data={{ "data-yunari-palette-choice": entry }}
            swatch={
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
    </Group>
  );
}

/** The author-managed catalogue the display menu lists.
 *
 *  One row per stored token, showing the lens ids that token derives — a row
 *  of `16:9` offers `16:9` and `9:16`, and Remove removes the token, not one of
 *  the two. Two refusals, both worded: an exact token already listed is a
 *  duplicate, and a rect of the same shape as one listed (`7:3` beside `21:9`)
 *  is refused naming both. */
function PreviewsSection(props: {
  readonly storage: Storage | undefined;
}): React.JSX.Element {
  // The catalogue's revision, so a change from anywhere re-renders the list
  // from the one module state.
  useSyncExternalStore(subscribeLenses, previewCatalogueKey);
  const tokens = sortPreviewTokens(activePreviewRatioTokens());
  const [draft, setDraft] = useState("");
  const [reason, setReason] = useState<string | undefined>(undefined);
  const [persisted, setPersisted] = useState<boolean | undefined>(undefined);

  /** Storage first, then the live list, as the palette writes: a write that
   *  failed still leaves the session's list changed. */
  const commit = (next: readonly string[]): void => {
    setPersisted(writePreviewRatioTokens(props.storage, next));
    setActivePreviewRatios(next);
  };

  const add = (): void => {
    let ratio: PreviewRatio;
    try {
      ratio = parsePreviewRatio(draft);
    } catch (error) {
      // The parser's only refusal is a `RangeError`; anything else is a defect
      // and belongs in the console rather than in the row.
      if (!(error instanceof RangeError)) throw error;
      setReason(uiCopy.settings.previewRatioInvalid);
      return;
    }
    if (tokens.some((token) => parsePreviewRatio(token).id === ratio.id)) {
      setReason(uiCopy.settings.previewRatioDuplicate);
      return;
    }
    const equivalent =
      ratio.shape === "rect"
        ? tokens.find((token) => {
            const existing = parsePreviewRatio(token);
            return (
              existing.shape === "rect" &&
              previewRatioKey(existing) === previewRatioKey(ratio)
            );
          })
        : undefined;
    if (equivalent !== undefined) {
      setReason(uiCopy.settings.previewRatioEquivalent(ratio.id, equivalent));
      return;
    }
    setReason(undefined);
    setDraft("");
    commit(sortPreviewTokens([...tokens, ratio.id]));
  };

  const removeRatio = (id: string): void => {
    setReason(undefined);
    commit(tokens.filter((token) => parsePreviewRatio(token).id !== id));
  };

  const reset = (): void => {
    // Removing the key is what returns the list to the defaults; the live list
    // is set explicitly because the module never re-reads storage.
    setPersisted(clearPreviewRatioTokens(props.storage));
    setReason(undefined);
    setActivePreviewRatios(DEFAULT_PREVIEW_RATIO_TOKENS);
  };

  const stored = activePreviewRatioTokens();
  const atDefaults =
    stored.length === DEFAULT_PREVIEW_RATIO_TOKENS.length &&
    stored.every(
      (token, index) => token === DEFAULT_PREVIEW_RATIO_TOKENS[index],
    );

  return (
    <Group
      testId="previews"
      name={uiCopy.settings.previewRatiosHeading}
      hint={uiCopy.settings.previewRatiosHint}
    >
      <div
        className="flex flex-col gap-[var(--space-8)]"
        data-yunari-previews=""
      >
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
        <div className="flex flex-wrap items-center gap-[var(--space-8)]">
          <ControlWell density="dialog" widthClassName="min-w-[6rem] flex-1">
            <input
              type="text"
              aria-label={uiCopy.settings.previewRatioField}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setReason(undefined);
              }}
              data-yunari-preview-ratio-input=""
              className="h-full w-full min-w-0 bg-transparent font-mono text-sm text-text outline-none"
            />
          </ControlWell>
          <button
            type="button"
            onClick={add}
            data-yunari-preview-ratio-add=""
            className={ACTION_BUTTON}
          >
            {uiCopy.settings.previewRatioAdd}
          </button>
          <button
            type="button"
            disabled={atDefaults}
            onClick={reset}
            data-yunari-preview-ratio-reset=""
            className={ACTION_BUTTON}
          >
            {uiCopy.settings.previewRatioReset}
          </button>
        </div>
        {reason === undefined ? null : (
          <p
            className="text-sm"
            data-yunari-preview-ratio-reason=""
            role="alert"
          >
            {reason}
          </p>
        )}
        {props.storage === undefined || persisted === false ? (
          <p className="text-sm text-muted">
            {uiCopy.settings.previewRatiosSessionOnly}
          </p>
        ) : null}
      </div>
    </Group>
  );
}
