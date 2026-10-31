import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type * as React from "react";
import {
  CLOSE_GLYPH,
  Glyph,
  type LucideIcon,
} from "../../editor-shell/icons.js";
import { destructiveMarker } from "../../object-actions.js";

/** The one control treatment a dialog's own buttons share, in tokens.
 *
 * Here rather than in a module of its own because every dialog that renders an
 * action button already imports this primitive — four copies of this string had
 * drifted apart before it moved. A dialog button is chrome around an answer
 * rather than a `Control` component, so it carries the well's surface and edge
 * and stays outside the closed control vocabulary.
 *
 * The string is the drifted copy's, because it is the superset: `enabled:hover:`
 * is `hover:` on a button that is never disabled, and `disabled:text-faint` is
 * the variant the library chooser's delete actually needs.
 */
export const ACTION_BUTTON =
  "rounded-md border border-edge bg-[var(--yunari-control-bg)] px-[var(--space-12)] py-[var(--space-6)] text-sm text-text enabled:hover:border-muted disabled:text-faint";

/**
 * One command in a viewer's panel foot: a bordered box holding a 12px glyph and
 * one word.
 *
 * The store's item panel and the asset preview draw the same foot, so they draw
 * this one control rather than two copies that drift. `tone` is the only
 * difference they allow: `accent` for the preview's primary command. A
 * destructive command carries the mark, which the shell paints `--hot` and
 * refuses to paint on a disabled control. **No tone fills the box** — a filled
 * one would make a single command the act, and the palette rations the accent.
 */
export function ActionBox(props: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly data?: Readonly<Record<`data-${string}`, string>>;
  readonly id?: string;
  readonly tone?: "plain" | "accent";
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly describedById?: string;
  readonly onClick: () => void;
}): React.JSX.Element {
  const {
    icon,
    label,
    data,
    id,
    tone = "plain",
    destructive,
    disabled,
  } = props;
  return (
    <button
      {...data}
      type="button"
      {...(id === undefined ? {} : { id })}
      {...(destructive === true
        ? destructiveMarker({ destructive: true })
        : {})}
      disabled={disabled}
      {...(props.describedById === undefined
        ? {}
        : { "aria-describedby": props.describedById })}
      onClick={props.onClick}
      className={`flex min-w-0 items-center justify-center gap-[var(--space-6)] rounded-[var(--radius-md)] border bg-panel-2 px-[var(--space-8)] py-[var(--space-6)] text-xs disabled:text-faint ${
        tone === "accent"
          ? "border-accent text-accent"
          : "border-edge text-text"
      }`}
    >
      <Glyph icon={icon} size={12} />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

/** shadcn's Dialog, hand-owned and reduced to what the one sheet needs.
 *
 * Base UI is the editor's one primitive library, and this sheet is a Dialog
 * rather than a Tooltip. The scrim
 * and the popup are portalled to `body` and styled by the shell's own classes,
 * and `applyShellPalette` writes `data-shell-palette` on `documentElement`
 * precisely so a surface portalled there still recolours (`palette.ts:35-49`)
 * — do not add an element parameter there.
 *
 * **No `Dialog.Title`.** The sheet labels itself by `aria-label`, and Base UI
 * leaves `aria-labelledby` off when no title is rendered, so the caller's label
 * stays the announced name; adding a title would silently replace it.
 *
 * **`closeLabel` renders the one way out that needs no Escape key.** Base UI's
 * own contract for a modal is a `Dialog.Close` inside the popup so a touch
 * screen reader can leave it; a caller that wants that control passes the word
 * for it, and a caller that draws its own (the sheet below) omits it. A caller
 * whose window has no title bar to put the word in passes `closeIcon` and gets
 * the same control as an ×.
 */
export function Dialog({
  open,
  onOpenChange,
  label,
  closeLabel,
  closeIcon = false,
  className,
  children,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly label: string;
  readonly closeLabel?: string;
  /** Draw the way out as a mark rather than a word, for a window with no title
   *  bar: the finder is nearly the whole editor and has no footer either. */
  readonly closeIcon?: boolean;
  /** An extra class on the popup, for a dialog that sizes itself. */
  readonly className?: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <DialogPrimitive.Root
      open={open}
      // Base UI passes its own event details as a second argument; the wrapper
      // declares one, so it drops them rather than leaking the library's shape.
      onOpenChange={(next) => {
        onOpenChange(next);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="editor-shell-dialog-overlay" />
        <DialogPrimitive.Popup
          className={
            className === undefined
              ? "editor-shell-dialog"
              : `editor-shell-dialog ${className}`
          }
          aria-label={label}
        >
          {children}
          {closeLabel === undefined ? null : (
            <DialogPrimitive.Close
              className="editor-shell-dialog-close"
              aria-label={closeLabel}
            >
              {closeIcon ? <Glyph icon={CLOSE_GLYPH} size={16} /> : closeLabel}
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
