import type {
  FabricGlobals,
  FabricPalette,
  TypeToken,
} from "@yunari/renderer-core";
import { isTypeTokenRole } from "@yunari/renderer-core";
import type * as React from "react";
import { useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import {
  type ControlOption,
  ControlSelect,
} from "../../components/ui/control-select.js";
import { ControlText } from "../../components/ui/control-text.js";
import { plainButtonClasses } from "../../components/ui/control-well.js";
import type { TokenRef } from "../../editor-shell/shell-stores.js";
import type { PaletteTokenUse } from "../../palette-manager/panel.js";
import type { TypeTokens } from "../../type-preset-manager/panel.js";
import { orderedTokens, tokenName } from "../../type-token-manager/name.js";
import { uiCopy } from "../../ui-copy.js";
import { PaintFields } from "./paint-fields.js";

/**
 * The selected token's own properties, in the right column — the half of the
 * inspector's "exactly one column" the object column gives way to while a token
 * is selected.
 *
 * **One inspector, two sections.** A `kind: "preset"` ref draws `PresetFields`
 * and a `kind: "paint"` ref draws `PaintFields`; the section is chosen from the
 * ref, never from a property, so a paint id cannot show a preset's fields.
 *
 * **The panel is a sibling section of the object inspector's host.** Both are
 * appended to `panelHosts.selection`; `selection-inspector` hides itself while a
 * token is set and this section draws nothing when none is, so the two never
 * claim the column at once.
 *
 * **The specimen never loads bytes.** `Aa` is set in the token's own family;
 * packaged faces are already in `document.fonts`, and a remote face was
 * `font-preview.ts`'s job, which is gone (ruling 5).
 *
 * **A role token is not removable.** Its id is the role, and the validator
 * requires all three in every theme, so the reassignment-and-delete row is
 * drawn only for an unroled token. The name is computed and read-only; the
 * editable name, role select and the old size/leading/tracking fields are gone
 * with the stored fields (ruling 0124).
 *
 * **Usage is not here yet.** The spec lists a preset's usage, but no counter
 * exists and the reference walk is Task 17's — this file does not invent one.
 * A paint's users list already has its walk, through the paint port's `usage`.
 */
export interface TokenInspectorPanel {
  readonly root: HTMLElement;
  render(
    ref: TokenRef | undefined,
    presets: TypeTokens,
    globals: FabricGlobals | undefined,
  ): void;
  /** Unmounts the React tree, then removes the section. A React root
   *  subscribes; removing its container unsubscribes nothing, so the tree would
   *  outlive the pane (`react-root-disposal.dom.test.ts`). */
  destroy(): void;
}

/** One declared face of a family: what a bound preset's weight list offers. */
export interface FaceChoice {
  readonly assetId: string;
  readonly weight: string | number;
  readonly style: string;
}

/** Sentinel ids in the family list. A declared family equal to one is filtered
 *  out rather than allowed to masquerade as an action. */
const IMPORT_LOCAL_FONT_ID = "@yunari:import-local-font";
const FONT_FINDER_ID = "@yunari:font-finder";

/** The family list's trailing rows, each drawn only where its port exists. */
function fontActionOptions(
  actions: TokenInspectorActions,
): readonly ControlOption[] {
  return [
    ...(actions.importLocalFont === undefined
      ? []
      : [{ id: IMPORT_LOCAL_FONT_ID, name: uiCopy.panels.importLocalFont }]),
    ...(actions.openFontFinder === undefined
      ? []
      : [{ id: FONT_FINDER_ID, name: uiCopy.panels.fontFinder }]),
  ];
}

/** Runs an action row. Answers false for a family, which the caller writes. */
function runFontAction(id: string, actions: TokenInspectorActions): boolean {
  if (id === IMPORT_LOCAL_FONT_ID) {
    actions.importLocalFont?.();
    return true;
  }
  if (id === FONT_FINDER_ID) {
    actions.openFontFinder?.();
    return true;
  }
  return false;
}

export interface TokenInspectorActions {
  readonly onChange: (presets: TypeTokens) => void;
  readonly onDelete: (id: string, replacement: string) => void;
  readonly unbindFace: (id: string) => void;
  /** Every declared face of a family, so a bound preset's weight is a list of
   *  the weights the package actually holds rather than free text that would
   *  fall back to the browser font. */
  readonly facesOf?: (family: string) => readonly FaceChoice[];
  /** The package's declared families, in the order the list offers them. */
  readonly familiesOf?: () => readonly string[];
  /** Declares a picked file as a token's family. Drawn only when supplied. */
  readonly importLocalFont?: () => void;
  /** Opens the font finder. Drawn only when supplied, like the picker above. */
  readonly openFontFinder?: () => void;
  /** The paint half: the palette the ref names, its document writes and its
   *  users walk. Absent when the mount has no palette behind it. */
  readonly paints:
    | {
        readonly palette: () => FabricPalette;
        readonly onChange: (palette: FabricPalette) => void;
        readonly onSettled?: () => void;
        readonly onDelete:
          | ((id: string, replacement: string) => void)
          | undefined;
        /** The objects each token is linked to; re-read per draw, as today. */
        readonly usage:
          | (() => Readonly<Record<string, readonly PaletteTokenUse[]>>)
          | undefined;
      }
    | undefined;
}

export function createTokenInspectorPanel(
  host: HTMLElement,
  actions: TokenInspectorActions,
): TokenInspectorPanel {
  const root = document.createElement("section");
  root.dataset["yunariTokenInspector"] = "";
  host.append(root);

  const reactRoot: Root = createRoot(root);
  const draw = (
    ref: TokenRef | undefined,
    presets: TypeTokens,
    _globals: FabricGlobals | undefined,
  ): void => {
    flushSync(() => {
      reactRoot.render(
        <TokenInspector tokenRef={ref} presets={presets} actions={actions} />,
      );
    });
  };
  draw(undefined, {}, undefined);

  return {
    root,
    render: draw,
    destroy() {
      reactRoot.unmount();
      root.remove();
    },
  };
}

function TokenInspector(props: {
  readonly tokenRef: TokenRef | undefined;
  readonly presets: TypeTokens;
  readonly actions: TokenInspectorActions;
}): React.JSX.Element | null {
  const { tokenRef, presets, actions } = props;
  if (tokenRef === undefined) return null;
  if (tokenRef.kind === "paint") {
    const paints = actions.paints;
    if (paints === undefined) return null;
    const palette = paints.palette();
    const entry = palette[tokenRef.id];
    if (entry === undefined) return null;
    return (
      /* Keyed by the token **and the paint kind**, as the pane's field set was:
         a colour change re-renders in place and the picker keeps its trigger; a
         kind switch changes the shape of the fields, and a token switch must
         remount so `ColourPicker` does not seed the previous token's draft. */
      <PaintFields
        key={`${tokenRef.id}|${entry.value.kind}`}
        id={tokenRef.id}
        entry={entry}
        palette={palette}
        usage={paints.usage}
        onChange={paints.onChange}
        onSettled={paints.onSettled}
        onDelete={paints.onDelete}
      />
    );
  }
  const entry = presets[tokenRef.id];
  if (entry === undefined) return null;
  return (
    /* Keyed by the preset: every field edits this one record, so switching
       tokens rebuilds the field set rather than reconciling the next preset
       onto the previous one's half-typed draft. */
    <TokenFields
      key={tokenRef.id}
      id={tokenRef.id}
      entry={entry}
      presets={presets}
      actions={actions}
    />
  );
}

function TokenFields(props: {
  readonly id: string;
  readonly entry: TypeToken;
  readonly presets: TypeTokens;
  readonly actions: TokenInspectorActions;
}): React.JSX.Element {
  const { id, entry, presets, actions } = props;
  const value = entry;
  const put = (next: TypeToken): void => {
    actions.onChange({ ...presets, [id]: next });
  };
  // The producer owns the order: `facesOf` answers one entry per weight and
  // style, lightest first. Re-sorting here would put `italic` before `normal`
  // at the same weight and discard that.
  const faces =
    value.face === undefined ? [] : (actions.facesOf?.(value.family) ?? []);
  const selectedFaceId =
    faces.find((face) => face.assetId === value.face?.assetId)?.assetId ??
    faces[0]?.assetId ??
    "";

  return (
    <div
      data-yunari-token-fields=""
      className="flex flex-col gap-[var(--space-8)]"
    >
      <h2 className="text-xs font-semibold tracking-[0.11em] text-muted uppercase">
        {uiCopy.panels.typeToken}
      </h2>
      {/* Computed, never stored: a role reads `[Heading] Segoe UI 600`, an
          unroled token `Manrope 600`. The field is a reading, not a well. */}
      <ReadOnlyPair
        label={uiCopy.inspectorFields.name}
        value={tokenName(id, value)}
        valueData={{ "data-yunari-token-name": "" }}
      />
      <span
        data-yunari-token-specimen=""
        aria-hidden="true"
        className="text-2xl text-text"
        style={{ fontFamily: value.family }}
      >
        Aa
      </span>
      {value.face === undefined ? (
        <>
          <ControlSelect
            label={uiCopy.panels.family}
            data={{ "data-yunari-token-family": "" }}
            value={value.family}
            options={familyOptions(value.family, actions)}
            onChange={(id) => {
              if (runFontAction(id, actions)) return;
              const trimmed = id.trim();
              if (trimmed === "") return;
              put({ ...value, family: trimmed });
            }}
          />
          <ControlText
            label={uiCopy.panels.weight}
            data={{ "data-yunari-token-weight": "" }}
            value={String(value.weight ?? "")}
            onCommit={(next) => {
              // An emptied optional field removes its key: an empty string is a
              // weight the renderer cannot use.
              const { weight: _weight, ...rest } = value;
              const trimmed = next.trim();
              put(trimmed === "" ? rest : { ...rest, weight: trimmed });
            }}
          />
        </>
      ) : (
        <div
          data-yunari-token-face-bound=""
          className="flex flex-col gap-[var(--space-6)]"
        >
          <p className="m-0 text-xs text-muted">{uiCopy.panels.fontBound}</p>
          <ReadOnlyPair label={uiCopy.panels.family} value={value.family} />
          {/* The face owns the family, but not the weight: the package may hold
              several, and a weight it does not hold would draw in the browser
              fallback. Absent a declared face list, the bound weight stays
              read-only rather than inventing one. */}
          {faces.length === 0 ? (
            <ReadOnlyPair
              label={uiCopy.panels.weight}
              value={String(value.weight ?? "")}
            />
          ) : (
            <ControlSelect
              label={uiCopy.panels.weight}
              data={{ "data-yunari-token-weight": "" }}
              value={selectedFaceId}
              options={faces.map((face) => ({
                id: face.assetId,
                name: `${face.weight}${face.style === "italic" ? " italic" : ""}`,
              }))}
              onChange={(assetId) => {
                const face = faces.find(
                  (candidate) => candidate.assetId === assetId,
                );
                if (face === undefined) return;
                put({
                  ...value,
                  weight: face.weight,
                  face: { assetId: face.assetId },
                });
              }}
            />
          )}
          <button
            type="button"
            data-yunari-token-unbind=""
            onClick={() => actions.unbindFace(id)}
            className={plainButtonClasses}
          >
            {uiCopy.panels.unbindFont}
          </button>
          {/* The face owns the family, so there is no family list to hold these
              rows; they stay the same two actions, as buttons. */}
          <FontActionRows actions={actions} />
        </div>
      )}
      {isTypeTokenRole(id) ? null : (
        <Deletion id={id} presets={presets} actions={actions} />
      )}
    </div>
  );
}

/**
 * The family list: the package's declared families in the producer's order, the
 * token's own family appended as a reading when the package does not declare it,
 * then the action rows.
 *
 * The current family is `disabled` rather than omitted, so it still prints as
 * the trigger's value while staying out of the keyboard model. The comparison is
 * case-insensitive because the producer deduplicates that way: `inter` and
 * `Inter` are one family, and appending both would put the same family twice in
 * the list. A family literally equal to a sentinel id is appended as neither a
 * choice nor a reading — that id belongs to an action row.
 */
function familyOptions(
  family: string,
  actions: TokenInspectorActions,
): readonly ControlOption[] {
  const declared = (actions.familiesOf?.() ?? []).filter((candidate) => {
    const name = candidate.trim();
    return name !== IMPORT_LOCAL_FONT_ID && name !== FONT_FINDER_ID;
  });
  const trimmed = family.trim();
  const wanted = trimmed.toLowerCase();
  const isActionId =
    trimmed === IMPORT_LOCAL_FONT_ID || trimmed === FONT_FINDER_ID;
  const held = declared.some(
    (candidate) => candidate.trim().toLowerCase() === wanted,
  );
  return [
    ...declared.map((candidate) => ({ id: candidate, name: candidate })),
    ...(held || isActionId
      ? []
      : [
          {
            id: family,
            name: `${family} ${uiCopy.panels.notInPackage}`,
            disabled: true,
          },
        ]),
    ...fontActionOptions(actions),
  ];
}

/** The two action rows where no family list exists to carry them. */
function FontActionRows(props: {
  readonly actions: TokenInspectorActions;
}): React.JSX.Element | null {
  const options = fontActionOptions(props.actions);
  if (options.length === 0) return null;
  return (
    <>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          data-yunari-token-action={option.id}
          onClick={() => {
            runFontAction(option.id, props.actions);
          }}
          className={plainButtonClasses}
        >
          {option.name}
        </button>
      ))}
    </>
  );
}

function ReadOnlyPair(props: {
  readonly label: string;
  readonly value: string;
  /** A hook for the reading itself, where a surface names it. */
  readonly valueData?: Readonly<Record<`data-${string}`, string>>;
}): React.JSX.Element {
  return (
    <div className="flex items-baseline gap-[var(--space-8)]">
      <span className="text-xs text-muted">{props.label}</span>
      <span
        {...props.valueData}
        className="ml-auto font-mono text-xs text-text"
      >
        {props.value}
      </span>
    </div>
  );
}

/**
 * The reassignment-on-delete row: the token this one's references move to, and
 * the deletion itself. The delete is refused when there is nothing to move them
 * to, because deleting the last unroled token would strand every reference to
 * it. Drawn for an unroled token only: a role id is required by the validator.
 */
function Deletion(props: {
  readonly id: string;
  readonly presets: TypeTokens;
  readonly actions: TokenInspectorActions;
}): React.JSX.Element {
  const { id, presets, actions } = props;
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const options = orderedTokens({ typeTokens: presets })
    .filter((candidate) => candidate.id !== id)
    .map(({ id: candidate, token }) => ({
      id: candidate,
      name: tokenName(candidate, token),
    }));
  const replacement =
    picked !== undefined && picked !== id && presets[picked] !== undefined
      ? picked
      : options[0]?.id;
  return (
    <>
      <ControlSelect
        label={uiCopy.panels.reassign}
        data={{ "data-yunari-token-replacement": "" }}
        value={replacement ?? ""}
        options={options}
        onChange={setPicked}
      />
      <button
        type="button"
        data-yunari-token-delete=""
        disabled={replacement === undefined}
        onClick={() => {
          if (replacement !== undefined) actions.onDelete(id, replacement);
        }}
        className={`${plainButtonClasses} text-hot disabled:text-faint`}
      >
        {uiCopy.panels.deleteType}
      </button>
    </>
  );
}
