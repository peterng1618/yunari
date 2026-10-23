import type { AssetResult } from "@yunari/renderer-core";
import { cssArtboardPaint } from "@yunari/scene-fabric";
import type * as React from "react";
import { SourceMark } from "./source-mark.js";

/** A preset's picture: a palette's colours or the sweep a gradient stores, in
 *  the one CSS form the theme itself renders. */
function presetPreview(
  preset: NonNullable<AssetResult["preset"]>,
): React.JSX.Element {
  if (preset.kind === "palette") {
    return (
      <span
        aria-hidden="true"
        data-yunari-asset-preview="palette"
        className="grid h-full w-full grid-cols-2"
      >
        {/* Four keeps the 2×2 preview identical for every palette: a third or
            fifth colour would leave a gap or spill out of the grid. Adding the
            preset still stores every colour. */}
        {preset.colours.slice(0, 4).map((colour, at) => (
          <span
            // Two swatches may carry the same colour; the position is what
            // makes the key unique.
            key={`${at}-${colour}`}
            data-yunari-swatch=""
            style={{ background: colour }}
          />
        ))}
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      data-yunari-asset-preview="gradient"
      className="h-full w-full"
      style={{ backgroundImage: cssArtboardPaint(preset) }}
    />
  );
}

/** One asset in the grid: its picture, its name, and the source that supplied
 *  it, marked by its own logo so a mixed grid says where each row came from. */
export function AssetRow({
  result,
  sourceId,
  sourceLabel,
  selected,
  onSelect,
}: {
  readonly result: AssetResult;
  readonly sourceId: string;
  readonly sourceLabel: string;
  readonly selected: boolean;
  readonly onSelect: () => void;
}): React.JSX.Element {
  // An image's mark rides beside its photographer — the author names the row
  // — while an icon's rides beside its name, which is all an icon has.
  const markWithAuthor =
    result.kind === "image" && result.subtitle !== undefined;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-yunari-asset-row={result.id}
      data-selected={selected ? "" : undefined}
      // The selected row is the author's answer to "which one am I importing":
      // an accent edge and a tint, not only the pressed state a pointer cannot
      // see. Written as a branch rather than an `aria-pressed:` variant so the
      // test can read the choice off the element.
      className={`flex min-w-0 flex-col gap-[var(--space-4)] rounded-[var(--radius-md)] border bg-[var(--panel-2)] p-[var(--space-8)] text-left ${
        selected
          ? "border-accent bg-accent/10 ring-1 ring-accent"
          : "border-edge"
      }`}
    >
      <span className="flex h-24 items-center justify-center overflow-hidden rounded-[var(--radius-sm)] bg-[var(--bg)]">
        {result.preset !== undefined ? (
          presetPreview(result.preset)
        ) : result.preview === "" ? null : result.kind === "image" ? (
          <img
            src={result.preview}
            alt=""
            loading="lazy"
            className="h-full w-full object-contain"
          />
        ) : (
          // A monochrome icon is drawn as a mask, never as an `<img>`: the
          // picture is the shape's alpha and the colour is the row's own text
          // colour, so a black-on-black set reads on a dark theme and a fixed
          // box gives every source the same apparent size.
          <span
            aria-hidden="true"
            data-yunari-asset-preview={result.kind}
            className="h-14 w-14 bg-current text-text"
            style={{
              maskImage: `url("${result.preview}")`,
              maskSize: "contain",
              maskRepeat: "no-repeat",
              maskPosition: "center",
            }}
          />
        )}
      </span>
      <span className="flex min-w-0 items-center gap-[var(--space-6)]">
        <span className="truncate text-sm">{result.name}</span>
        {markWithAuthor ? null : (
          <span className="ml-auto flex-none">
            <SourceMark id={sourceId} label={sourceLabel} />
          </span>
        )}
      </span>
      {/* The source's own second word: an icon style, or a photographer. */}
      {result.subtitle === undefined ? null : (
        <span className="flex min-w-0 items-center gap-[var(--space-6)]">
          <span className="truncate text-xs text-faint">{result.subtitle}</span>
          {markWithAuthor ? (
            <span className="ml-auto flex-none">
              <SourceMark id={sourceId} label={sourceLabel} />
            </span>
          ) : null}
        </span>
      )}
    </button>
  );
}
