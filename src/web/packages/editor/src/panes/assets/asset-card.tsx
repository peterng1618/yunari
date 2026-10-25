import type * as React from "react";
import type { LocalAssetReference } from "../../asset-manager/index.js";
import { uiCopy } from "../../ui-copy.js";

/**
 * One declared file's card: its mark, name, metadata and In use/Unused badge,
 * plus whatever actions the pane hands it.
 *
 * The card owns no state and calls no owner. Choosing it is the pane's business
 * through `onChoose`, and the actions are a node the pane builds, so the one
 * place that knows how to remove or replace a declaration is the pane and not a
 * row repeated once per file.
 */
export interface AssetCardProps {
  readonly asset: LocalAssetReference;
  readonly chosen: boolean;
  /** In use through either route — an object's reference or the envelope's. */
  readonly referenced: boolean;
  /** The manager's own blob URL, where the kind has one to draw. */
  readonly previewUrl?: string;
  readonly onChoose: () => void;
  readonly actions?: React.ReactNode;
}

export function AssetCard({
  asset,
  chosen,
  referenced,
  previewUrl,
  onChoose,
  actions,
}: AssetCardProps): React.JSX.Element {
  return (
    <div
      className={`flex flex-col rounded-[var(--radius-md)] border ${
        chosen ? "border-accent" : "border-edge-2"
      } bg-panel`}
    >
      <button
        type="button"
        data-yunari-asset-select=""
        aria-pressed={chosen}
        onClick={onChoose}
        className="flex min-h-[26px] items-center gap-[var(--space-8)] p-[var(--space-6)] text-left"
      >
        <AssetMark
          asset={asset}
          {...(previewUrl === undefined ? {} : { previewUrl })}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-[var(--space-4)]">
          <span className="truncate text-xs text-text">
            {assetFileName(asset)}
          </span>
          <span className="truncate font-mono text-[10px] text-muted">
            {metadataOf(asset)}
          </span>
        </span>
        <span
          data-yunari-asset-badge=""
          className={`flex-none rounded-[var(--radius-sm)] border px-[var(--space-4)] py-[var(--space-4)] text-[9px] ${
            referenced ? "border-accent text-accent" : "border-edge text-faint"
          }`}
        >
          {referenced
            ? uiCopy.panels.assetCard.inUse
            : uiCopy.panels.assetCard.unused}
        </span>
      </button>
      {actions === undefined ? null : (
        <div className="flex items-center justify-end gap-[var(--space-4)] px-[var(--space-6)] pb-[var(--space-6)]">
          {actions}
        </div>
      )}
    </div>
  );
}

/** The card's mark: the manager's own preview for a picture, `Aa` for a face,
 *  and an empty well for a video, which no declared preview can show. */
function AssetMark({
  asset,
  previewUrl,
}: {
  readonly asset: LocalAssetReference;
  readonly previewUrl?: string;
}): React.JSX.Element {
  if (
    previewUrl !== undefined &&
    (asset.kind === "image" || asset.kind === "svg")
  ) {
    return (
      <img
        src={previewUrl}
        alt=""
        data-yunari-asset-preview=""
        className="size-[38px] flex-none rounded-[var(--radius-sm)] border border-edge-2 bg-panel-2 object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex size-[38px] flex-none items-center justify-center rounded-[var(--radius-sm)] border border-edge-2 bg-panel-2 text-base text-text"
    >
      {asset.kind === "font" ? "Aa" : null}
    </span>
  );
}

/** The manager's own kind word, then the face's format and cut. */
function metadataOf(asset: LocalAssetReference): string {
  const kind = uiCopy.panels.assetCard.kind[asset.kind];
  // `LocalAssetReference`'s union does not narrow on `kind` alone — the plain
  // `AssetReference` arm admits `"font"` too — so the face's fields are asked
  // for by presence.
  return "format" in asset
    ? `${kind} · ${asset.format} · ${asset.weight} ${asset.style}`
    : kind;
}

/** The file an author chose, not the id the package keys it by. */
export function assetFileName(asset: LocalAssetReference): string {
  const separator = asset.path.lastIndexOf("/");
  return separator < 0 ? asset.path : asset.path.slice(separator + 1);
}
