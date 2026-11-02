import { uiCopy } from "../../ui-copy.js";

/** What the meter needs from the document: one owner's measure. */
export interface AssetSizeSummary {
  readonly themeBytes: number;
  readonly unusedBytes: number;
  readonly limitBytes: number;
}

/** The theme's size against its bound, and the bytes only unused files hold.
 *
 *  **The percentage is the reading; the colour is the urgency.** `--ok` under
 *  90%, `--warn` from 90% to 100%, `--error` past the bound — so the meter says
 *  the same thing to an author who cannot tell the three hues apart. Unused
 *  bytes are reported apart because no output carries them; a theme over its
 *  bound cannot be saved by removing one.
 */
export function AssetSizeMeter({
  summary,
}: {
  readonly summary: AssetSizeSummary;
}): React.JSX.Element {
  const percent = Math.round((summary.themeBytes / summary.limitBytes) * 100);
  const tone =
    percent > 100 ? "text-error" : percent >= 90 ? "text-warn" : "text-ok";
  return (
    <div className="mb-[var(--space-8)] flex flex-wrap items-baseline gap-x-[var(--space-8)] font-mono text-[10px]">
      <span data-yunari-theme-size="" className={tone}>
        {uiCopy.panels.assetSizes.theme(
          percent,
          uiCopy.panels.assetCard.size(summary.limitBytes),
        )}
      </span>
      <span data-yunari-unused-size="" className="text-muted">
        {uiCopy.panels.assetSizes.unused(
          uiCopy.panels.assetCard.size(summary.unusedBytes),
        )}
      </span>
    </div>
  );
}
