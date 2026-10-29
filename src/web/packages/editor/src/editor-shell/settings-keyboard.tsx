import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { ControlIconButton } from "../components/ui/control-icon-button.js";
import {
  type BindingRefusal,
  bindingRefusal,
  clearShortcutOverride,
  clearShortcutOverrides,
  type ShortcutOverrides,
  useActiveShortcuts,
  withoutShortcutOverride,
  writeShortcutOverride,
} from "../shortcut-manager/bindings.js";
import type {
  ProductShortcutId,
  ShortcutBinding,
} from "../shortcut-manager/index.js";
import {
  SHORTCUT_LABELS,
  shortcutReferenceGroups,
} from "../shortcut-manager/reference.js";
import { uiCopy } from "../ui-copy.js";
import { Glyph, KEYBOARD_GLYPH, PENCIL_GLYPH } from "./icons.js";

/** The refusal as §9 requires it: the reason, in words, rendered in the row of
 *  the binding it did not make. The words are `uiCopy`'s — this chooses which
 *  of them, and names the action a taken chord belongs to. */
function refusalWords(
  refusal: BindingRefusal,
  action: ProductShortcutId,
): string {
  switch (refusal.kind) {
    case "taken":
      return uiCopy.settings.keyboardTaken(SHORTCUT_LABELS[refusal.action]);
    case "reserved":
      return uiCopy.settings.keyboardReserved(refusal.chord);
    case "modifier-only":
      return uiCopy.settings.keyboardModifierOnly;
    case "cannot-defer":
      return uiCopy.settings.keyboardCannotDefer(SHORTCUT_LABELS[action]);
    case "unprintable":
      return uiCopy.settings.keyboardUnprintable;
    case "unbindable":
      return uiCopy.settings.keyboardUnbindable;
  }
}

/** The chord a key event would become. `shift` is written exactly rather than
 *  left off, so a captured `Ctrl+P` never also answers to `Ctrl+Shift+P` — the
 *  defaults may be shift-agnostic, a recorded press may not. Alt never reaches
 *  here: the shape has no field for it, and the capture refuses an Alt-qualified
 *  press rather than storing its bare key. */
function chordFrom(
  event: KeyboardEvent<HTMLElement>,
): Pick<ShortcutBinding, "key" | "modifier" | "shift"> {
  return {
    key: event.key.toLowerCase(),
    modifier: event.ctrlKey || event.metaKey,
    shift: event.shiftKey,
  };
}

/**
 * §7's Keyboard tab: the reference the `?` sheet renders, with each row's chord
 * editable.
 *
 * The rows are `shortcutReferenceGroups()` — the same projection the sheet and
 * the tooltips read — so the tab cannot list an action the product does not
 * have, and every row carries the action's own id rather than matching on its
 * words.
 *
 * The capture reads `keydown` **on the row while it is armed** and stops the
 * event there: the manager is a `window` listener, so a chord recorded here
 * would otherwise also run the action it was being recorded for. Escape and Tab
 * are let through instead — Escape is the modal's own dismissal and closes it,
 * which is the one way out an armed row may never take away, and Tab moves
 * focus on; neither binds anything.
 */
export function SettingsKeyboard(props: {
  /** `undefined` where the browser refuses local storage; a new chord then
   *  holds for the session, and the tab says so rather than implying it was
   *  saved. */
  readonly storage: Storage | undefined;
  readonly overrides: ShortcutOverrides;
  readonly armed: ProductShortcutId | undefined;
  readonly onArmed: (next: ProductShortcutId | undefined) => void;
  readonly onOverrides: (next: ShortcutOverrides) => void;
}): React.JSX.Element {
  // Subscribed, so a rebind redraws the chords this tab prints, and read on
  // every render rather than held: a render-time copy is the defect Review
  // Focus 3 names.
  useActiveShortcuts();
  const { storage, overrides, armed, onArmed, onOverrides } = props;
  const [reason, setReason] = useState<string | undefined>(undefined);
  const rows = useRef(new Map<ProductShortcutId, HTMLDivElement>());

  // The armed row takes focus, so the next keystroke — including the Escape
  // that cancels — lands where the capture is listening.
  useEffect(() => {
    if (armed === undefined) return;
    rows.current.get(armed)?.focus();
  }, [armed]);

  const disarm = (): void => {
    onArmed(undefined);
    setReason(undefined);
  };

  const capture =
    (action: ProductShortcutId) =>
    (event: KeyboardEvent<HTMLDivElement>): void => {
      if (armed !== action) return;
      // The two presses the capture must not consume. Tab moves focus on — an
      // armed row that swallowed it would be a keyboard trap — and Escape is the
      // modal's own dismissal (`settings.tsx` passes it straight through), so
      // neither is a chord. Both disarm and travel on; every other key is the
      // capture's and nothing else's, because the manager listens on `window`
      // and would otherwise run the chord being recorded.
      if (event.key === "Tab" || event.key === "Escape") {
        disarm();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      // Neither a key held down nor a keystroke inside an IME composition is a
      // chord the author pressed.
      if (event.repeat || event.nativeEvent.isComposing) return;
      // Alt is a fourth modifier the binding table has no field for, and the
      // press would fall through as its bare key — the author presses one chord
      // and the row stores another. Refused in words rather than modelled:
      // `ShortcutBinding.modifier` is Ctrl/Cmd, and a chord no product action
      // needs Alt for would be a field nothing reads.
      if (event.altKey) {
        setReason(uiCopy.settings.keyboardAltQualified);
        return;
      }

      const binding: ShortcutBinding = { ...chordFrom(event), action };
      const refusal = bindingRefusal(action, binding, overrides);
      if (refusal !== undefined) {
        setReason(refusalWords(refusal, action));
        return;
      }
      if (storage !== undefined)
        writeShortcutOverride(storage, action, binding);
      onOverrides({ ...overrides, [action]: binding });
      disarm();
    };

  return (
    <div className="editor-shell-keyboard" data-yunari-keyboard="">
      {/* The panel's header: the glyph, the name, and "Reset all" at the
          trailing edge. **The action moved here from the tab's foot**,
          which put the one act that is about every row after the twentieth row,
          so an author had to scroll past the whole table to reach it. */}
      <div className="editor-shell-keyboard-header">
        <Glyph icon={KEYBOARD_GLYPH} size={14} />
        <span>{uiCopy.settings.keyboard}</span>
        <button
          type="button"
          className="editor-shell-keyboard-action"
          data-yunari-shortcut-reset-all=""
          onClick={() => {
            if (storage !== undefined) clearShortcutOverrides(storage);
            onOverrides({});
            disarm();
          }}
        >
          {uiCopy.settings.keyboardResetAll}
        </button>
      </div>
      {shortcutReferenceGroups().map((group) => (
        <section key={group.label}>
          <h3>{group.label}</h3>
          <dl>
            {group.rows.map((row) => (
              <div
                key={row.action}
                data-yunari-shortcut-row={row.action}
                data-armed={armed === row.action ? "" : undefined}
                // Focusable, so the capture has somewhere to listen that is not
                // the whole document: the modal's guard covers the page behind
                // it, and this covers the press being recorded. **Named**, and
                // named by a role that can carry a name: the row takes focus
                // when it arms, and a focused `div` with no role announces
                // nothing — the author recording a chord would hear silence at
                // exactly the moment the row is asking them to press one.
                role="group"
                aria-label={row.label}
                tabIndex={-1}
                ref={(element) => {
                  if (element === null) rows.current.delete(row.action);
                  else rows.current.set(row.action, element);
                }}
                onKeyDown={capture(row.action)}
                onBlur={(event) => {
                  // Losing focus cancels: a capture that outlived its row would
                  // swallow the Escape meant to close the modal. Only the
                  // *armed* row's own blur counts — arming a second row focuses
                  // it, and that moves focus out of the first one, which is not
                  // the capture being abandoned.
                  if (armed !== row.action) return;
                  if (
                    !event.currentTarget.contains(event.relatedTarget as Node)
                  ) {
                    disarm();
                  }
                }}
              >
                <dt>{row.label}</dt>
                <dd>
                  <kbd
                    data-yunari-shortcut-chord={row.action}
                    aria-label={armed === row.action ? undefined : row.spoken}
                  >
                    {armed === row.action
                      ? uiCopy.settings.keyboardPrompt
                      : row.chord}
                  </kbd>
                  <ControlIconButton
                    label={uiCopy.settings.keyboardRebind}
                    data={{ "data-yunari-shortcut-arm": row.action }}
                    shortcut={{ printed: row.chord, spoken: row.spoken }}
                    onClick={() =>
                      armed === row.action ? disarm() : onArmed(row.action)
                    }
                  >
                    <Glyph icon={PENCIL_GLYPH} size={15} />
                  </ControlIconButton>
                  <button
                    type="button"
                    className="editor-shell-keyboard-action"
                    data-yunari-shortcut-reset={row.action}
                    onClick={() => {
                      if (storage !== undefined)
                        clearShortcutOverride(storage, row.action);
                      onOverrides(
                        withoutShortcutOverride(overrides, row.action),
                      );
                      disarm();
                    }}
                  >
                    {uiCopy.settings.keyboardReset}
                  </button>
                </dd>
                {/* §9's refusal, **in the armed row**. It used to be one node at
                    the tab's foot, which on a table this long sits twenty
                    scrollable rows away from the very row the author is on: a
                    refusal they cannot see is a refusal not stated. The row is
                    the one that armed, has focus and is on screen, so the
                    sentence lands where §9 says it does. Only the armed row
                    carries it — a refusal exists only while a row is listening
                    — and the node is present while armed even when empty, so a
                    screen reader hears the alert when it fills. */}
                {armed === row.action ? (
                  <p
                    className="editor-shell-keyboard-reason"
                    data-yunari-shortcut-reason=""
                    role="alert"
                  >
                    {reason}
                  </p>
                ) : null}
              </div>
            ))}
          </dl>
        </section>
      ))}
      {storage === undefined ? (
        <p className="editor-shell-keyboard-notice">
          {uiCopy.settings.keyboardSessionOnly}
        </p>
      ) : null}
    </div>
  );
}
