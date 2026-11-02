import { useState, useSyncExternalStore } from "react";
import { ControlIconButton } from "../../components/ui/control-icon-button.js";
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
import { uiCopy } from "../../ui-copy.js";
import { Page } from "../page.js";
import { Group } from "../section-group.js";

/** The author-managed catalogue the display menu lists. */
export function PreviewsPage(props: {
  readonly storage: Storage | undefined;
}): React.JSX.Element {
  return (
    <Page page="previews">
      <Group
        testId="previews"
        name={uiCopy.settings.previewRatiosHeading}
        hint={uiCopy.settings.previewRatiosHint}
      >
        <PreviewsSection storage={props.storage} />
      </Group>
    </Page>
  );
}

/**
 * One row per stored token, showing the lens ids that token derives — a row of
 * `16:9` offers `16:9` and `9:16`, and Remove removes the token, not one of the
 * two. Two refusals, both worded: an exact token already listed is a duplicate,
 * and a rect of the same shape as one listed (`7:3` beside `21:9`) is refused
 * naming both.
 */
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
    <div className="flex flex-col gap-[var(--space-8)]" data-yunari-previews="">
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
            placeholder="16:9"
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
        <p className="text-sm" data-yunari-preview-ratio-reason="" role="alert">
          {reason}
        </p>
      )}
      {props.storage === undefined || persisted === false ? (
        <p className="text-sm text-muted">
          {uiCopy.settings.previewRatiosSessionOnly}
        </p>
      ) : null}
    </div>
  );
}
