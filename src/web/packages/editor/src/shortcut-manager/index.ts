import { activeShortcuts } from "./bindings.js";

export type ShortcutHandler = (event: KeyboardEvent) => void;
export type ProductShortcutId =
  | "file.new"
  | "file.open"
  | "file.save"
  | "file.findAssets"
  | "edit.undo"
  | "edit.redo"
  | "edit.delete"
  | "edit.copy"
  | "edit.cut"
  | "edit.duplicate"
  | "edit.group"
  | "edit.ungroup"
  | "canvas.nudge-left"
  | "canvas.nudge-right"
  | "canvas.nudge-up"
  | "canvas.nudge-down"
  | "canvas.select-all"
  | "canvas.front"
  | "canvas.back"
  | "view.exit-group"
  // `surface`, not `toggle`: the chord opens the publish surface and nothing
  // else, which is what the control it is printed beside does. A name that said
  // `toggle` would promise to move the host, and the host's own switch is the
  // only control allowed to do that.
  | "publish.surface"
  | "help.shortcuts";

export interface ShortcutBinding {
  readonly key: string;
  /** A binding with no modifier always defers to a focused text field. */
  readonly modifier: boolean;
  readonly shift?: boolean;
  readonly action: ProductShortcutId;
}

export const PRODUCT_SHORTCUTS: readonly ShortcutBinding[] = [
  { key: "n", modifier: true, action: "file.new" },
  { key: "o", modifier: true, action: "file.open" },
  { key: "s", modifier: true, action: "file.save" },
  // Not Ctrl+Shift+A: Chromium keeps that for tab search, so the page never
  // sees the press. Ctrl+Shift+F is unclaimed by Chromium and Firefox.
  { key: "f", modifier: true, shift: true, action: "file.findAssets" },
  // Shift-qualified first, or `edit.undo`'s shift-agnostic binding below would
  // take Ctrl+Shift+Z and turn the standard redo chord into an undo. `edit.undo`
  // stays shift-agnostic because Cmd/Ctrl+Z is the only undo there is.
  { key: "z", modifier: true, shift: true, action: "edit.redo" },
  { key: "z", modifier: true, action: "edit.undo" },
  // Kept alongside the standard chord rather than replaced by it: Ctrl+Y is
  // Figma's redo too, and removing it would break anyone who learned it here.
  { key: "y", modifier: true, action: "edit.redo" },
  { key: "c", modifier: true, action: "edit.copy" },
  { key: "x", modifier: true, action: "edit.cut" },
  { key: "d", modifier: true, action: "edit.duplicate" },
  { key: "g", modifier: true, shift: true, action: "edit.ungroup" },
  { key: "g", modifier: true, action: "edit.group" },
  { key: "a", modifier: true, action: "canvas.select-all" },
  // A browser reports the *shifted* character under Shift, so Ctrl+Shift+] and
  // Ctrl+Shift+[ arrive as `}` and `{`. The bare chords stay bound: they are
  // learnable here, and dropping them would remove a working key.
  { key: "}", modifier: true, shift: true, action: "canvas.front" },
  { key: "{", modifier: true, shift: true, action: "canvas.back" },
  { key: "]", modifier: true, action: "canvas.front" },
  { key: "[", modifier: true, action: "canvas.back" },
  { key: "delete", modifier: false, action: "edit.delete" },
  { key: "backspace", modifier: false, action: "edit.delete" },
  // No `shift` field: `bindingFor` matches when `binding.shift === undefined`, so
  // one binding covers both the plain and the Shift-qualified press. The handler
  // reads `event.shiftKey` and picks the step.
  { key: "arrowleft", modifier: false, action: "canvas.nudge-left" },
  { key: "arrowright", modifier: false, action: "canvas.nudge-right" },
  { key: "arrowup", modifier: false, action: "canvas.nudge-up" },
  { key: "arrowdown", modifier: false, action: "canvas.nudge-down" },
  // Before `help.shortcuts`, because that one is last for being the only action
  // about the sheet itself. `publish.surface` is the header's own chord: the
  // publish control prints it, and pressing it opens the surface that control
  // opens. Shift-qualified so it is not the browser's own Ctrl+P.
  { key: "p", modifier: true, shift: true, action: "publish.surface" },
  // Last, because it is the only action about the sheet itself. Unmodified, so
  // it already defers to a focused text field: a `?` typed into a rename field
  // is the field's character and not a keypress. `ponytail:` a layout that does
  // not report `?` for Shift+/ opens nothing, and the upgrade path is a
  // layout-aware match behind `bindingFor`.
  { key: "?", modifier: false, action: "help.shortcuts" },
];

/** Context-only bindings: dispatched here but never displayed by a menu or
 * tooltip, so they stay off `PRODUCT_SHORTCUTS`. */
const CONTEXT_SHORTCUTS: readonly ShortcutBinding[] = [
  { key: "escape", modifier: false, action: "view.exit-group" },
];

/** The one comparison `bindingFor` matches by, exported because a capture's
 *  conflict check has to mean the same thing the dispatcher means: a rebind
 *  refused for a chord it would actually have matched is a refusal about
 *  nothing, and one accepted for a chord the dispatcher resolves elsewhere is a
 *  mark that runs a different action. */
export function bindingMatches(
  binding: ShortcutBinding,
  key: string,
  modifier: boolean,
  shift: boolean,
): boolean {
  return (
    binding.key === key &&
    binding.modifier === modifier &&
    (binding.shift === undefined || binding.shift === shift)
  );
}

/** The effective table first, the context-only bindings after it, so a rebind
 *  cannot lose to `Escape` and an author's chord cannot be shadowed by it
 *  either. Shift-qualified bindings precede their plain form, so first match
 *  wins. */
export function bindingFor(event: KeyboardEvent): ShortcutBinding | undefined {
  const key = event.key.toLowerCase();
  const modifier = event.ctrlKey || event.metaKey;
  return [...activeShortcuts(), ...CONTEXT_SHORTCUTS].find((binding) =>
    bindingMatches(binding, key, modifier, event.shiftKey),
  );
}

/** The action ids a *modifier* binding must be in to defer to a focused text
 * field's own key handling. Unmodified bindings defer unconditionally, so they
 * need no entry here. `canvas.select-all` is in this set because Ctrl+A inside a
 * rename field is the field's own select-all, not the canvas's. */
const MODIFIED_KEY_DEFERRED_ACTION_IDS: ReadonlySet<ProductShortcutId> =
  new Set([
    "file.new",
    "file.findAssets",
    "edit.undo",
    "edit.redo",
    "canvas.select-all",
  ]);

/** Whether an action's bindings already defer to a focused text field: every
 *  unmodified binding does (`bindingFor`'s deferral rule reads `!modifier`), and
 *  the four above defer on their modified chords too.
 *
 *  A capture asks this, because a modifier-less letter bound to an action that
 *  does *not* defer would make that action stop reaching the author while they
 *  type — the opposite of what the action promises, and a missing-reading rule behaviour change
 *  dressed as a preference. */
export function defersToTextEntry(action: ProductShortcutId): boolean {
  if (MODIFIED_KEY_DEFERRED_ACTION_IDS.has(action)) return true;
  return PRODUCT_SHORTCUTS.some(
    (binding) => binding.action === action && !binding.modifier,
  );
}

/** True while a modal dialog is on screen.
 *
 * A modal makes the page behind it inert to the pointer and to focus, and it
 * does not touch a `window`-level listener — which is what this manager is. So
 * `Ctrl+Z`, `Delete` and the arrow nudge would all still edit the document the
 * author is reading about, and `Escape` would close the dialog *and* leave the
 * group in the same keypress.
 *
 * Both shapes, because the editor has both: the three native modals
 * (`new-document-chooser.ts`, `persistence-manager`, `theme-library-dialog`)
 * and the library `Dialog` on Base UI.
 *
 * **`[role='dialog']` alone, with no `aria-modal` clause.** `@base-ui/react`
 * 1.8.0's dialog sets `role: 'dialog'` on the popup and hides the content's
 * siblings instead, so `aria-modal` appears nowhere in the package — which is
 * why the library `Dialog` is Base UI's. A selector requiring
 * `aria-modal='true'` therefore matches no dialog
 * this app can render: the guard would not defer while the sheet is open, and
 * `Ctrl+Z` would edit the document the author is reading about. `dialog[open]`
 * and `[role='dialog']` between them cover every modal in the tree — this editor
 * draws no non-modal `role="dialog"`.
 */
function isModalOpen(): boolean {
  return document.querySelector("dialog[open], [role='dialog']") !== null;
}

/** The sole window-level dispatcher for Yunari product actions above the canvas's own key handling. */
export class ShortcutManager {
  readonly #handlers = new Map<ProductShortcutId, ShortcutHandler>();
  /** Whether a modal was open when the current key event *started*, sampled by
   * `#sampleModalState` in the window capture phase. */
  #modalOpenAtDispatchStart = false;
  readonly #sampleModalState = (): void => {
    this.#modalOpenAtDispatchStart = isModalOpen();
  };
  readonly #onKeyDown = (event: KeyboardEvent): void => {
    const binding = bindingFor(event);
    const handler =
      binding === undefined ? undefined : this.#handlers.get(binding.action);

    const deferred =
      binding !== undefined &&
      (!binding.modifier ||
        MODIFIED_KEY_DEFERRED_ACTION_IDS.has(binding.action)) &&
      consumesKey(event.target, event);

    if (handler === undefined || deferred || this.#modalOpenAtDispatchStart) {
      return;
    }

    event.preventDefault();
    handler(event);
  };

  constructor() {
    // Two listeners on one owner, split by phase: the modal state is *sampled*
    // at `window` capture and *consulted* at `window` bubble. **The split is
    // what makes the guard independent of *when* the library unmounts**, which
    // is a library's business and has already changed once. Radix's dismissable
    // layer bound `keydown` on `document` with `{ capture: true }` and its
    // `Presence` unmounted from a layout effect the moment
    // `getComputedStyle(node).animationName === "none"` — synchronously, inside
    // the same dispatch, which is `vg-187`. Base UI binds the same document
    // capture (`floating-ui-react/hooks/useDismiss`) but keeps its popup in the
    // DOM behind a `hidden` attribute until the close settles, so the hazard is
    // not necessarily reachable now. **Window capture precedes document capture,
    // so the sample is the state at the start of the dispatch either way**, and
    // the browser proof `tests/e2e/keyboard.spec.ts` asserts covers both.
    //
    // The dispatch itself stays in the bubble phase: the layer panel defers
    // arrow keys with `stopPropagation()` in a React handler, so an earlier
    // manager would nudge the selection and navigate the list in one press.
    window.addEventListener("keydown", this.#sampleModalState, {
      capture: true,
    });
    window.addEventListener("keydown", this.#onKeyDown);
  }

  register(action: ProductShortcutId, handler: ShortcutHandler): void {
    this.#handlers.set(action, handler);
  }

  destroy(): void {
    window.removeEventListener("keydown", this.#sampleModalState, {
      capture: true,
    });
    window.removeEventListener("keydown", this.#onKeyDown);
    this.#handlers.clear();
  }
}

/** The coarse question the camera's bare-key listeners ask: does this target own
 * the characters they take? A range is counted here too, which is over-broad but
 * conservative — none of the camera's own keys (Space, `+`, `-`, `!`, `1`) is
 * one a slider has any use for.
 *
 * Save/Open deliberately override text-entry defaults; New does not. **The
 * dispatcher's deferral does not read this**: it asks `consumesKey`, because a
 * range owns its own arrows and no modifier chord. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  )
    return true;
  return (
    target instanceof HTMLInputElement &&
    !new Set([
      "button",
      "checkbox",
      "color",
      "file",
      "image",
      "radio",
      "reset",
      "submit",
    ]).has(target.type.toLowerCase())
  );
}

/** The keys a focused `range` handles itself. It is the one control in the set
 * whose own key handling the table has to step around, and every other key it
 * sees is the browser's rather than the slider's. */
const RANGE_CONSUMED_KEYS: ReadonlySet<string> = new Set([
  "arrowdown",
  "arrowleft",
  "arrowright",
  "arrowup",
  "end",
  "home",
  "pagedown",
  "pageup",
]);

/**
 * Whether the target handles this key itself, so the manager must leave it
 * alone.
 *
 * **The question is per key, not per target.** A text field owns every key the
 * table binds — printable characters are its own, and Delete, the arrows and
 * Escape are its editing keys — while a range owns only the keys it moves on.
 * Asking the coarse question instead is what swallowed `Ctrl+Z` over a focused
 * slider (`vg-252`): a range is not a text field, and a modifier chord is not a
 * key it has any use for.
 */
function consumesKey(
  target: EventTarget | null,
  event: KeyboardEvent,
): boolean {
  if (
    target instanceof HTMLInputElement &&
    target.type.toLowerCase() === "range"
  ) {
    // A modifier chord is never the slider's, whatever the key: `Ctrl+ArrowLeft`
    // is the browser's word-jump, not a step.
    return (
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      RANGE_CONSUMED_KEYS.has(event.key.toLowerCase())
    );
  }
  return isTextEntryTarget(target);
}

/**
 * The distinct actions the table binds, in the table's own order.
 *
 * The reference is a list of *actions*, so the four actions bound twice
 * (`edit.redo`, `edit.delete`, `canvas.front`, `canvas.back`) appear once — the
 * second chord is a property of the action, not a second row. The order is the
 * table's rather than sorted, because the table is grouped by where the action
 * lives and that grouping is what the sheet's headings follow.
 */
export function productShortcutIds(): readonly ProductShortcutId[] {
  const seen = new Set<ProductShortcutId>();
  for (const binding of PRODUCT_SHORTCUTS) seen.add(binding.action);
  return [...seen];
}
