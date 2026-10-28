import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import type * as React from "react";
import { ControlIconButton } from "../components/ui/control-icon-button.js";
import { ACTION_BUTTON } from "../components/ui/dialog.js";
import { BUSY_GLYPH, CONNECTIONS_GLYPH, Glyph } from "../editor-shell/icons.js";
import { uiCopy } from "../ui-copy.js";
import type { ActionOutcome } from "./modal.js";

/** One command in the footer, in the states every tab shares. */
export interface FinderAction {
  readonly id: string;
  readonly label: string;
  readonly busyLabel: string;
  readonly tone: "plain" | "accent";
  readonly disabled: boolean;
  readonly run: () => Promise<ActionOutcome> | ActionOutcome;
}

/** The finder's one search field: first in the toolbar, the same width in
 *  every tab that searches. */
export function FinderSearch(props: {
  readonly value: string;
  readonly placeholder: string;
  readonly onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <input
      type="search"
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
      placeholder={props.placeholder}
      aria-label={props.placeholder}
      data-yunari-asset-search=""
      className="h-7 w-64 max-w-full rounded-[var(--radius-md)] border border-edge bg-[var(--bg)] px-[var(--space-10)] text-sm"
    />
  );
}

/** A small set of mutually exclusive choices — the Colours tab's kind filter
 *  today, any tab's view switch tomorrow. */
export function FinderSegmented<T extends string>(props: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly {
    readonly id: T;
    readonly label: string;
    readonly data?: Readonly<Record<`data-${string}`, string>>;
  }[];
  readonly onChange: (id: T) => void;
}): React.JSX.Element {
  return (
    <ToggleGroup
      value={[props.value]}
      aria-label={props.label}
      onValueChange={(next) => {
        const chosen = next[0];
        if (chosen !== undefined) props.onChange(chosen as T);
      }}
      className="flex h-7 items-center gap-1 rounded-[var(--radius-md)] border border-edge bg-panel-2 p-1"
    >
      {props.options.map((option) => (
        <Toggle
          {...option.data}
          key={option.id}
          value={option.id}
          className="rounded-[var(--radius-sm)] px-[var(--space-8)] text-xs text-muted hover:text-text data-[pressed]:bg-[var(--stage)] data-[pressed]:text-text"
        >
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

/** One source, on or off. A source whose key is missing or failing says so
 *  with a mark rather than a second sentence. */
export function FinderChip(props: {
  readonly label: string;
  readonly pressed: boolean;
  readonly failed: boolean;
  readonly disabled: boolean;
  readonly onToggle: () => void;
  readonly data?: Readonly<Record<`data-${string}`, string>>;
}): React.JSX.Element {
  return (
    <button
      {...props.data}
      type="button"
      aria-pressed={props.pressed}
      disabled={props.disabled}
      onClick={props.onToggle}
      className={`inline-flex h-7 items-center gap-[var(--space-6)] rounded-[var(--radius-md)] border px-[var(--space-10)] text-xs disabled:text-faint ${
        props.pressed
          ? "border-accent text-accent"
          : "border-edge text-muted hover:border-muted hover:text-text"
      }`}
    >
      {props.label}
      {props.failed ? (
        <span
          data-yunari-asset-chip-failed=""
          className="size-1 rounded-full bg-[var(--hot)]"
        />
      ) : null}
    </button>
  );
}

/** One footer command. Busy keeps the same width — the busy word replaces the
 *  label — so the row does not jump while the write is out. */
export function FinderActionButton(props: {
  readonly action: FinderAction;
  readonly busy: boolean;
  readonly onRun: () => void;
  readonly data?: Readonly<Record<`data-${string}`, string>>;
}): React.JSX.Element {
  const { action, busy } = props;
  return (
    <button
      {...props.data}
      type="button"
      disabled={action.disabled || busy}
      onClick={props.onRun}
      data-yunari-asset-action-busy={busy ? "" : undefined}
      className={`${ACTION_BUTTON} inline-flex items-center gap-[var(--space-6)] ${
        action.tone === "accent" ? "border-accent text-accent" : ""
      }`}
    >
      {busy ? (
        <>
          <span className="inline-flex animate-spin motion-reduce:animate-none">
            <Glyph icon={BUSY_GLYPH} size={12} />
          </span>
          {action.busyLabel}
        </>
      ) : (
        action.label
      )}
    </button>
  );
}

/** The way to fix a key, drawn only while a keyed source is in trouble: a
 *  button that cannot help is not an availability. */
export function ConnectionsButton(props: {
  readonly needs: boolean;
  readonly onOpen: () => void;
}): React.JSX.Element | null {
  if (!props.needs) return null;
  return (
    <span className="flex w-7 flex-none items-center justify-center">
      <ControlIconButton
        label={uiCopy.assets.connections}
        data={{ "data-yunari-asset-connections": "" }}
        onClick={props.onOpen}
      >
        <Glyph icon={CONNECTIONS_GLYPH} size={14} />
      </ControlIconButton>
    </span>
  );
}
