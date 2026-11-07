import { Popover } from "@base-ui/react/popover";
import type {
  FabricPalette,
  FabricPaletteEntry,
  TypeToken,
} from "@yunari/renderer-core";
import type { ReactNode } from "react";
import { ColourPickerPanel } from "../components/ui/colour-picker.js";
import { controlIconButtonClass } from "../components/ui/control-icon-button.js";
import { ControlTooltip } from "../editor-shell/controls/tooltip.js";
import { Glyph, PENCIL_GLYPH } from "../editor-shell/icons.js";
import type { TokenRef } from "../editor-shell/shell-stores.js";
import {
  GradientFields,
  PaintKindField,
  paintCommitter,
} from "../panes/tokens/paint-fields.js";
import {
  TokenFaceFields,
  type TokenInspectorActions,
} from "../panes/tokens/token-inspector.js";
import type { TypeTokens } from "../type-preset-manager/panel.js";
import { tokenName } from "../type-token-manager/name.js";
import { uiCopy } from "../ui-copy.js";

/** The token dropdown's last entry: create, apply, and reveal a token. */
export const ADD_NEW_TOKEN_ID = "@yunari:add-new-token";

/**
 * The design-token editor the run rows reach.
 *
 * The reads are getters because the document is the one owner of its globals: a
 * copy taken when the inspector was built would go stale on the first write.
 * `actions` is the *same* object the design token inspector receives, so a
 * family, weight or paint written here takes the one mutation path and the one
 * history entry. `reveal` is the shell's own request, so this surface never
 * reaches a pane it does not own.
 */
export interface DesignTokenPort {
  readonly actions: TokenInspectorActions;
  readonly typeTokens: () => TypeTokens;
  readonly palette: () => FabricPalette;
  /** Creates a token through the pane's own rule and runs `apply` inside the
   *  same suspended history gesture, so the creation and the run's new
   *  reference are one undo entry. Returns the new ref only when `apply`
   *  accepted it; a refused run write leaves nothing to reveal. */
  readonly create: (
    kind: TokenRef["kind"],
    apply: (ref: TokenRef) => boolean,
  ) => TokenRef | undefined;
  /** Shows the Tokens pane and selects the token's inspector. */
  readonly reveal: (ref: TokenRef) => void;
}

/**
 * The row's right-aligned edit action: an icon button that is its popover's
 * anchor, so the editor opens where the reference is read.
 *
 * The name and the tooltip are one string, `ControlTooltip`'s rule: the action
 * edits a token the row already names, so the accessible name repeats that
 * token rather than saying "Edit" twice in one run.
 */
function EditAction(props: {
  readonly label: string;
  readonly title: string;
  readonly hook: string;
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <Popover.Root>
      <ControlTooltip label={props.label}>
        <Popover.Trigger
          type="button"
          aria-label={props.label}
          {...{ [props.hook]: "" }}
          className={`${controlIconButtonClass} text-muted`}
        >
          <Glyph icon={PENCIL_GLYPH} size={14} />
        </Popover.Trigger>
      </ControlTooltip>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="end" className="z-50">
          <Popover.Popup
            aria-label={props.title}
            data-yunari-token-edit-popover=""
            className="max-h-[var(--available-height)] w-72 space-y-2 overflow-y-auto rounded-md border border-edge bg-[var(--shell-popover)] p-3 text-sm text-text shadow-[var(--elev-2)]"
          >
            {props.children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** A type token's family and weight, edited where the run names it. */
export function TypeTokenEditAction(props: {
  readonly id: string;
  readonly presets: TypeTokens;
  readonly actions: TokenInspectorActions;
}): React.JSX.Element | null {
  const { id, presets, actions } = props;
  const value: TypeToken | undefined = presets[id];
  if (value === undefined) return null;
  return (
    <EditAction
      label={uiCopy.inspectorFields.editToken(tokenName(id, value))}
      title={tokenName(id, value)}
      hook="data-yunari-run-token-edit"
    >
      <TokenFaceFields
        id={id}
        value={value}
        presets={presets}
        actions={actions}
      />
    </EditAction>
  );
}

/**
 * A paint token's kind and paint, edited where the run names it. The picker's
 * body is rendered directly rather than through `ColourPicker`'s own trigger:
 * this surface is already the anchored popover.
 */
export function PaintTokenEditAction(props: {
  readonly id: string;
  readonly palette: FabricPalette;
  readonly actions: TokenInspectorActions;
}): React.JSX.Element | null {
  const { id, palette, actions } = props;
  const entry: FabricPaletteEntry | undefined = palette[id];
  const paints = actions.paints;
  if (entry === undefined || paints === undefined) return null;

  const commit = paintCommitter(palette, id, paints.onChange);

  return (
    <EditAction
      label={uiCopy.inspectorFields.editToken(entry.name)}
      title={entry.name}
      hook="data-yunari-run-colour-edit"
    >
      <PaintKindField
        entry={entry}
        commit={commit}
        onSettled={paints.onSettled}
      />
      {entry.value.kind === "solid" ? (
        <ColourPickerPanel
          value={entry.value.color}
          onValueChange={(color) =>
            commit({ ...entry, value: { kind: "solid", color } })
          }
          onValueCommit={(color) => {
            commit({ ...entry, value: { kind: "solid", color } });
            paints.onSettled?.();
          }}
        />
      ) : (
        <GradientFields
          entry={entry}
          value={entry.value}
          commit={commit}
          onSettled={paints.onSettled}
        />
      )}
    </EditAction>
  );
}
