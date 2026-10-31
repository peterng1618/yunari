import {
  type AssetPreset,
  type AssetResult,
  cssArtboardPaint,
  type FontCut,
} from "@yunari/renderer-core";
import type * as React from "react";
import { useMemo } from "react";
import {
  ACTION_FAILED_GLYPH,
  BUSY_GLYPH,
  CHECK_GLYPH,
  Glyph,
} from "../editor-shell/icons.js";
import {
  faceStyle,
  leadCutOf,
  ROLES,
  useSpecimens,
} from "./font-preview-panel.js";
import { SourceMark } from "./source-mark.js";

/** Everything a card draws, decided from the wire result alone, so every tab
 *  renders the same shape from the same model. */
export interface FinderCardModel {
  readonly id: string;
  readonly name: string;
  readonly meta: string;
  readonly licence: string | undefined;
  readonly sourceId: string;
  readonly sourceLabel: string;
  readonly preview: React.ReactNode;
  readonly previewable: boolean;
}

function sourceIdOf(id: string): string {
  const at = id.indexOf(":");
  return at === -1 ? id : id.slice(0, at);
}

/** A result with a larger form: a picture, or a preset drawn from its own
 *  colours. The card's double-click, the footer's button and the modal's
 *  preview all ask this one question. */
export function previewableOf(result: AssetResult): boolean {
  return result.kind === "image" || result.preset !== undefined;
}

export function cardModelOf(
  result: AssetResult,
  sourceLabel: string,
): FinderCardModel {
  return {
    id: result.id,
    name: result.name,
    meta: result.subtitle ?? "",
    // An icon library states one licence for its whole catalogue, so it stays
    // on the source; a photo, font or preset carries per-item terms.
    licence:
      result.kind === "image" ||
      result.kind === "font" ||
      result.preset !== undefined
        ? result.licence
        : undefined,
    sourceId: sourceIdOf(result.id),
    sourceLabel,
    preview: <CardPreview result={result} />,
    previewable: previewableOf(result),
  };
}

/** The trio's ordered cuts, or the family's lead cut when the result names no
 *  trio — the same faces the preview panel draws. */
function specimenCutsOf(result: AssetResult): readonly FontCut[] {
  const font = result.font;
  if (font === undefined) return [];
  const trio = font.trio;
  if (trio === undefined) {
    const lead = leadCutOf({ id: result.id, font });
    return lead === undefined ? [] : [lead];
  }
  return ROLES.flatMap((role) => {
    const cut = trio.roles[role];
    return cut === undefined ? [] : [cut];
  });
}

function FontCardPreview({
  result,
}: {
  readonly result: AssetResult;
}): React.JSX.Element {
  const cuts = useMemo(() => specimenCutsOf(result), [result]);
  useSpecimens(cuts);
  const trio = result.font?.trio;
  if (trio === undefined) {
    return (
      <span
        data-yunari-asset-preview="font"
        className="flex h-full w-full items-center justify-center overflow-hidden px-[var(--space-8)]"
      >
        <span style={faceStyle(cuts[0])} className="truncate text-base">
          {result.name}
        </span>
      </span>
    );
  }
  return (
    <span
      data-yunari-asset-preview="font"
      className="flex h-full w-full flex-col justify-center gap-[var(--space-6)] overflow-hidden px-[var(--space-8)]"
    >
      {ROLES.map((role) => (
        <span
          key={role}
          style={faceStyle(trio.roles[role])}
          className={`truncate text-center ${
            role === "heading"
              ? "text-xl leading-[1.1]"
              : role === "body"
                ? "text-sm leading-[1.2] text-muted"
                : "font-mono text-xs leading-[1.2]"
          }`}
        >
          {trio.roles[role]?.family ?? result.name}
        </span>
      ))}
    </span>
  );
}

/** The picture in the card's well. A palette is a row of vertical bars rather
 *  than a block grid: the bars are the colours at the size they are used. One
 *  owner for the shape, so the card and the enlarged preview cannot drift. */
export function PresetPreview({
  preset,
}: {
  readonly preset: AssetPreset;
}): React.JSX.Element {
  if (preset.kind === "palette") {
    return (
      <span
        aria-hidden="true"
        data-yunari-asset-preview="palette"
        className="flex h-full w-full"
      >
        {preset.colours.slice(0, 6).map((colour, at) => (
          <span
            key={`${at}-${colour}`}
            data-yunari-swatch=""
            className="min-w-0 flex-1"
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

function CardPreview({
  result,
}: {
  readonly result: AssetResult;
}): React.JSX.Element | null {
  const preset = result.preset;
  if (preset !== undefined) return <PresetPreview preset={preset} />;
  if (result.font !== undefined) return <FontCardPreview result={result} />;
  if (result.preview === "") return null;
  if (result.kind === "image") {
    return (
      <img
        src={result.preview}
        alt=""
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover"
      />
    );
  }
  // A monochrome icon is a mask, never an `<img>`: the shape is the alpha and
  // the colour is the card's own ink, so a black-on-black set reads.
  return (
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
  );
}

/** One result, in one shape, whichever tab drew it. */
export function FinderCard(props: {
  readonly model: FinderCardModel;
  readonly selected: boolean;
  readonly busy: boolean;
  readonly failed: boolean;
  readonly done: boolean;
  readonly tabStop: boolean;
  readonly focus: (node: HTMLButtonElement | null) => void;
  readonly onSelect: () => void;
  readonly onPreview?: () => void;
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
}): React.JSX.Element {
  const { model, selected, busy, failed, done } = props;
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      tabIndex={props.tabStop ? 0 : -1}
      ref={props.focus}
      onClick={props.onSelect}
      onDoubleClick={() => {
        if (model.previewable) props.onPreview?.();
      }}
      onKeyDown={props.onKeyDown}
      data-yunari-finder-card={model.id}
      className={`group flex min-w-0 flex-col gap-[var(--space-4)] rounded-[var(--radius-md)] border bg-[var(--panel-2)] p-[var(--space-8)] text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 ${
        selected
          ? "border-accent bg-accent/10 ring-1 ring-accent"
          : "border-edge hover:border-muted"
      }`}
    >
      <span className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-[var(--radius-sm)] bg-[var(--bg)]">
        <span className={busy ? "flex h-full w-full opacity-50" : "contents"}>
          {model.preview}
        </span>
        {busy ? (
          <span
            data-yunari-finder-card-busy=""
            className="absolute inset-0 flex items-center justify-center"
          >
            <Glyph icon={BUSY_GLYPH} size={20} />
          </span>
        ) : null}
        {failed ? (
          <span
            data-yunari-finder-card-failed=""
            className="absolute left-[var(--space-4)] top-[var(--space-4)] text-hot"
          >
            <Glyph icon={ACTION_FAILED_GLYPH} size={14} />
          </span>
        ) : null}
        {selected ? (
          <span
            data-yunari-finder-card-check=""
            className="absolute right-[var(--space-4)] top-[var(--space-4)] flex size-4 items-center justify-center rounded-full bg-accent text-[var(--bg)]"
          >
            <Glyph icon={CHECK_GLYPH} size={12} />
          </span>
        ) : null}
      </span>
      <span className="flex min-w-0 items-center gap-[var(--space-6)]">
        <span className="truncate text-sm">{model.name}</span>
        {done ? (
          <span
            data-yunari-finder-card-done=""
            className="flex-none text-accent"
          >
            <Glyph icon={CHECK_GLYPH} size={12} />
          </span>
        ) : null}
        <span className="ml-auto flex-none">
          <SourceMark id={model.sourceId} label={model.sourceLabel} />
        </span>
      </span>
      {model.meta === "" && model.licence === undefined ? null : (
        <span className="truncate text-xs text-faint">
          {model.meta}
          {model.meta !== "" && model.licence !== undefined ? " · " : null}
          {model.licence === undefined ? null : (
            <span className="text-muted" data-yunari-asset-licence="">
              {model.licence}
            </span>
          )}
        </span>
      )}
    </button>
  );
}
