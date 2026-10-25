import type { FabricGlobals, TypePreset } from "@yunari/renderer-core";
import type * as React from "react";
import { useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { ControlNumber } from "../../components/ui/control-number.js";
import { ControlSelect } from "../../components/ui/control-select.js";
import { ControlText } from "../../components/ui/control-text.js";
import { plainButtonClasses } from "../../components/ui/control-well.js";
import type { TokenRef } from "../../editor-shell/shell-stores.js";
import { FONT_ROLES, type FontTrioRole } from "../../type-preset-apply.js";
import type { TypePresets } from "../../type-preset-manager/panel.js";
import { uiCopy } from "../../ui-copy.js";

/**
 * The selected token's own properties, in the right column — the half of the
 * inspector's "exactly one column" the object column gives way to while a token
 * is selected.
 *
 * **The panel is a sibling section of the object inspector's host.** Both are
 * appended to `panelHosts.selection`; `selection-inspector` hides itself while a
 * token is set and this section draws nothing when none is, so the two never
 * claim the column at once.
 *
 * **The specimen never loads bytes.** `Aa` is set in the preset's own family;
 * packaged faces are already in `document.fonts`, and a remote face was
 * `font-preview.ts`'s job, which is gone (ruling 5).
 *
 * **Usage is not here yet.** The spec lists a preset's usage, but no counter
 * exists and the reference walk is Task 17's — this file does not invent one.
 */
export interface TokenInspectorPanel {
  readonly root: HTMLElement;
  render(
    ref: TokenRef | undefined,
    presets: TypePresets,
    globals: FabricGlobals | undefined,
  ): void;
  /** Unmounts the React tree, then removes the section. A React root
   *  subscribes; removing its container unsubscribes nothing, so the tree would
   *  outlive the pane (`react-root-disposal.dom.test.ts`). */
  destroy(): void;
}

export interface TokenInspectorActions {
  readonly onChange: (presets: TypePresets) => void;
  readonly onDelete: (id: string, replacement: string) => void;
  readonly setRole: (id: string, role: FontTrioRole | null) => void;
  readonly unbindFace: (id: string) => void;
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
    presets: TypePresets,
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
  readonly presets: TypePresets;
  readonly actions: TokenInspectorActions;
}): React.JSX.Element | null {
  const { tokenRef, presets, actions } = props;
  // The paint rows are Task 15b's. A paint ref draws nothing here rather than
  // borrowing the preset fields for a token that has none of them.
  if (tokenRef === undefined || tokenRef.kind !== "preset") return null;
  const entry = presets[tokenRef.id];
  if (entry === undefined) return null;
  return (
    /* Keyed by the preset: every field edits this one record, so switching
       tokens rebuilds the field set rather than reconciling the next preset
       onto the previous one's half-typed draft. */
    <PresetFields
      key={tokenRef.id}
      id={tokenRef.id}
      entry={entry}
      presets={presets}
      actions={actions}
    />
  );
}

function PresetFields(props: {
  readonly id: string;
  readonly entry: { readonly name: string; readonly value: TypePreset };
  readonly presets: TypePresets;
  readonly actions: TokenInspectorActions;
}): React.JSX.Element {
  const { id, entry, presets, actions } = props;
  const value = entry.value;
  const put = (next: TypePreset, name = entry.name): void => {
    actions.onChange({ ...presets, [id]: { name, value: next } });
  };

  return (
    <div
      data-yunari-token-fields=""
      className="flex flex-col gap-[var(--space-8)]"
    >
      <h2 className="text-xs font-semibold tracking-[0.11em] text-muted uppercase">
        {uiCopy.panels.typePreset}
      </h2>
      <span
        data-yunari-token-specimen=""
        aria-hidden="true"
        className="text-2xl text-text"
        style={{ fontFamily: value.family }}
      >
        Aa
      </span>
      <ControlText
        label={uiCopy.panels.name}
        data={{ "data-yunari-token-name": "" }}
        value={entry.name}
        onCommit={(next) => {
          const trimmed = next.trim();
          if (trimmed === "") return;
          put(value, trimmed);
        }}
      />
      <ControlSelect
        label={uiCopy.assets.fontPreview.roleLabel}
        data={{ "data-yunari-token-role": "" }}
        value={value.trioRole ?? ""}
        options={[
          { id: "", name: uiCopy.panels.none },
          ...FONT_ROLES.map((role) => ({
            id: role,
            name: uiCopy.assets.fontPreview.role[role],
          })),
        ]}
        onChange={(next) =>
          actions.setRole(id, next === "" ? null : (next as FontTrioRole))
        }
      />
      {value.face === undefined ? (
        <>
          <ControlText
            label={uiCopy.panels.family}
            data={{ "data-yunari-token-family": "" }}
            value={value.family}
            onCommit={(next) => {
              const trimmed = next.trim();
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
          <ReadOnlyPair
            label={uiCopy.panels.weight}
            value={String(value.weight ?? "")}
          />
          <button
            type="button"
            data-yunari-token-unbind=""
            onClick={() => actions.unbindFace(id)}
            className={plainButtonClasses}
          >
            {uiCopy.panels.unbindFont}
          </button>
        </div>
      )}
      <ControlNumber
        label={uiCopy.panels.size}
        data={{ "data-yunari-token-size": "" }}
        value={value.size}
        onCommit={(size) => {
          // A preset's size cannot be zero or negative; `ControlNumber` refuses
          // a non-number, and this refuses the number it lets through.
          if (!Number.isFinite(size) || size <= 0) return;
          put({ ...value, size });
        }}
      />
      <ControlNumber
        label={uiCopy.panels.lineHeight}
        data={{ "data-yunari-token-line-height": "" }}
        value={value.lineHeight}
        onClear={() => {
          const { lineHeight: _lineHeight, ...rest } = value;
          put(rest);
        }}
        onCommit={(lineHeight) => {
          if (!Number.isFinite(lineHeight) || lineHeight <= 0) return;
          put({ ...value, lineHeight });
        }}
      />
      <ControlNumber
        label={uiCopy.panels.letterSpacing}
        data={{ "data-yunari-token-letter-spacing": "" }}
        value={value.letterSpacing}
        onClear={() => {
          const { letterSpacing: _letterSpacing, ...rest } = value;
          put(rest);
        }}
        onCommit={(letterSpacing) => {
          if (!Number.isFinite(letterSpacing)) return;
          put({ ...value, letterSpacing });
        }}
      />
      <Deletion id={id} presets={presets} actions={actions} />
    </div>
  );
}

function ReadOnlyPair(props: {
  readonly label: string;
  readonly value: string;
}): React.JSX.Element {
  return (
    <div className="flex items-baseline gap-[var(--space-8)]">
      <span className="text-xs text-muted">{props.label}</span>
      <span className="ml-auto font-mono text-xs text-text">{props.value}</span>
    </div>
  );
}

/**
 * The reassignment-on-delete row: the preset this one's references move to, and
 * the deletion itself. The delete is refused when there is nothing to move them
 * to, because deleting the last preset would strand every reference to it.
 * Ported from `preset-list.tsx`'s `DeletionControls` (`7fd5d9b7`), which Task 14
 * removed with the field set.
 */
function Deletion(props: {
  readonly id: string;
  readonly presets: TypePresets;
  readonly actions: TokenInspectorActions;
}): React.JSX.Element {
  const { id, presets, actions } = props;
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const options = Object.entries(presets)
    .filter(([candidate]) => candidate !== id)
    .map(([candidate, entry]) => ({ id: candidate, name: entry.name }));
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
