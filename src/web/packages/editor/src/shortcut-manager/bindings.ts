/**
 * The one owner of the **effective** binding table: `index.ts`'s defaults plus
 * the author's overrides, resolved into the list the dispatcher matches and
 * every surface prints. The defaults stay `index.ts`'s — this re-spells no
 * binding, it only adds the ones an author chose.
 *
 * The live table is module-level state, written once by the shell and read by
 * everyone. That is deliberate and is the shape `applyShellPalette` already has
 * (one writer, everyone reads): the consumers are four components in three
 * subtrees — the menubar, the dock's tooltips, the `?` sheet and the settings
 * modal — plus a window-level dispatcher, and none of them is an ancestor of
 * the others, so a table passed by props would have to be threaded through
 * every one of them and would still miss the dispatcher.
 */
import { useSyncExternalStore } from "react";
import { bindingLabel, printableChord } from "./display.js";
import {
  bindingMatches,
  defersToTextEntry,
  PRODUCT_SHORTCUTS,
  type ProductShortcutId,
  productShortcutIds,
  type ShortcutBinding,
} from "./index.js";

/** The author's choices, by action. Absent means "use the defaults". */
export type ShortcutOverrides = Readonly<
  Partial<Record<ProductShortcutId, ShortcutBinding>>
>;

/** Why the editor cannot honour a captured chord.
 *
 *  Structured rather than worded: every word in the product is `uiCopy`'s, and
 *  a reason carrying its own sentence would be a second copy table — the one
 *  thing the refusal rule cannot survive. `taken` names the action so the
 *  sentence can say *whose* chord it is, and `reserved` carries the chord as
 *  `display.ts` prints it — the whole chord, `Ctrl+R`, and not the bare key: it
 *  is the chord the browser keeps, and naming `R` alone would say the browser
 *  reserves a letter that types into every field on the page. */
export type BindingRefusal =
  | { readonly kind: "taken"; readonly action: ProductShortcutId }
  | { readonly kind: "reserved"; readonly chord: string }
  | { readonly kind: "modifier-only" }
  | { readonly kind: "cannot-defer" }
  | { readonly kind: "unprintable" }
  | { readonly kind: "unbindable" };

const storageKey = "yunari.editor.shortcut-overrides";

/** What a key event reports when only a modifier is down. None of these can be
 *  a chord: a modifier qualifies a key, it is not one. */
const MODIFIER_KEYS: ReadonlySet<string> = new Set([
  "alt",
  "altgraph",
  "capslock",
  "control",
  "fn",
  "hyper",
  "meta",
  "os",
  "shift",
  "super",
  "symbol",
  "symbollock",
]);

/** Chords the browser or the OS keeps for itself, so a page listener never sees
 *  them. A letter is refused only with a modifier — bare letters are ordinary
 *  typing — and the function keys are refused either way.
 *
 *  `ponytail:` a JavaScript listener cannot promise capture of every OS chord;
 *  this is the set known to be unreachable, and the refusal says where the
 *  limit is rather than binding a chord that will never fire. The upgrade path
 *  is a longer list, or a key-capture API if one ever arrives. */
const RESERVED_LETTERS: ReadonlySet<string> = new Set([
  "l",
  "n",
  "p",
  "q",
  "r",
  "t",
  "w",
]);
const RESERVED_KEYS: ReadonlySet<string> = new Set(["f5", "f11", "f12"]);

/** The letters whose **Shift** variant the browser keeps as well, so
 *  `Ctrl+Shift+R` is exactly as unreachable as `Ctrl+R`.
 *
 *  The blanket `shift !== true` exclusion these replace was never a measurement:
 *  it assumed Shift made a chord safe, and three of the four chords most likely
 *  to be tried are the Shift variants a browser keeps. **Chromium and Firefox
 *  both keep these four** — new private window / undo close window, reload
 *  ignoring cache, reopen the closed tab, close the window — checked 2026-10-16
 *  against Chrome's shortcut list and Firefox's own `browser-sets.inc` key
 *  definitions. `p` is deliberately absent: Firefox's private window is
 *  `Ctrl+Shift+P` and Chromium leaves that chord free, so refusing it would
 *  reject a chord that works in the browser most authors open. */
const SHIFT_RESERVED_LETTERS: ReadonlySet<string> = new Set([
  // Chromium's tab search.
  "a",
  "n",
  "r",
  "t",
  "w",
]);

/** The key a stored entry may carry: one character `bindingFor` can match — it
 *  lowercases `event.key`, so a stored `P` is a binding that never fires — or
 *  one of the named keys the product itself binds. */
const KEY_SHAPE =
  /^(?:[a-z0-9?{}[\]-]|arrowleft|arrowright|arrowup|arrowdown|delete|backspace)$/;

/** Whether a stored entry can carry this key at all — the one rule the reader
 *  (`storedBinding`) and the capture (`bindingRefusal`) both ask, so a chord the
 *  capture accepts is a chord the store keeps. `printableChord` is not this
 *  test: it accepts any single character, so `.` prints and would be accepted
 *  for the session, only to be dropped by the reader on the next reload. */
function storableKey(key: string): boolean {
  return KEY_SHAPE.test(key);
}

let active: readonly ShortcutBinding[] | undefined;
const listeners = new Set<() => void>();

/** The live table. The **same array reference** between changes, because
 *  `useSyncExternalStore` compares snapshots and a fresh array every read would
 *  re-render on every pass. */
export function activeShortcuts(): readonly ShortcutBinding[] {
  return active ?? PRODUCT_SHORTCUTS;
}

/** Written by the shell — once on mount, and on every capture. */
export function setActiveShortcuts(bindings: readonly ShortcutBinding[]): void {
  active = bindings;
  for (const listener of listeners) listener();
}

export function subscribeShortcuts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * How a React surface reads the live table: subscribing, not sampling.
 *
 * It lives beside the table rather than in each of the four components that
 * render a chord, because "read the table and re-render when it changes" is one
 * rule — and a component that held a render-time copy is exactly the defect
 * Review Focus 3 names, a mark printed that runs something else.
 */
export function useActiveShortcuts(): readonly ShortcutBinding[] {
  return useSyncExternalStore(
    subscribeShortcuts,
    activeShortcuts,
    activeShortcuts,
  );
}

/**
 * Whether a captured chord would take, or be taken by, another action's mark.
 *
 * **Any** overlap counts, in either direction: a chord and a binding that share
 * a press have no order between them yet, so one of the two would go dead —
 * either the new chord never fires, or an action the author never touched
 * stops answering. That is the whole of what a capture must refuse.
 *
 * The defaults are deliberately not tested against each other. `edit.undo` is
 * shift-agnostic and therefore also matches `Ctrl+Shift+Z`, which `edit.redo`
 * holds; the table orders the qualified binding first and that precedence rule
 * is `index.ts`'s, not a conflict. A predicate calling it one would refuse
 * every capture anywhere near the undo pair.
 */
function conflicts(a: ShortcutBinding, b: ShortcutBinding): boolean {
  if (a.action === b.action) return false;
  return overlaps(a, b) || overlaps(b, a);
}

/** Whether `x` would match `y`'s own chord. A binding with no `shift` field
 *  matches both presses, which is why this is the asymmetric half. */
function overlaps(x: ShortcutBinding, y: ShortcutBinding): boolean {
  return bindingMatches(x, y.key, y.modifier, y.shift ?? false);
}

/**
 * The defaults plus the overrides, in the table's own order.
 *
 * Every default alias of an overridden action is replaced by the one chord the
 * author chose — an action bound twice keeps one binding once it is rebound,
 * which is what "I pressed this" means — and the replacement stands where the
 * action's first default stood, so an untouched action's aliases and the
 * table's match order are preserved.
 */
export function resolveShortcuts(
  overrides: ShortcutOverrides,
): readonly ShortcutBinding[] {
  const resolved: ShortcutBinding[] = [];
  const placed = new Set<ProductShortcutId>();
  for (const binding of PRODUCT_SHORTCUTS) {
    const override = overrides[binding.action];
    if (override === undefined) {
      resolved.push(binding);
      continue;
    }
    if (placed.has(binding.action)) continue;
    placed.add(binding.action);
    resolved.push(override);
  }
  return resolved;
}

/**
 * What the author chose, or nothing where they have chosen nothing.
 *
 * Stored JSON is untrusted input: it is a browser-local preference a previous
 * version, a hand-edit or another page can have written. Every entry is checked
 * — a known action, this action's own id, a key the product can bind — and a
 * collision with another action's binding is dropped, because a damaged
 * preference must not make the keyboard ambiguous. Anything refused is dropped
 * silently here and the defaults stand: half a table is worse than none.
 *
 * Entries are checked against the **effective** table the entries accepted so
 * far resolve to, not against the defaults. The two differ whenever an override
 * frees a chord a default held, and the refusal check reads the effective table
 * (`bindingRefusal` resolves `overrides` the same way) — so reading against the
 * defaults would drop a binding the capture accepted, silently, on the next
 * reload, which is the asymmetry this reader exists to not have.
 */
export function readShortcutOverrides(storage: Storage): ShortcutOverrides {
  const parsed = parseStored(storage);
  const accepted: Record<string, ShortcutBinding> = {};
  for (const [action, value] of Object.entries(parsed)) {
    if (!productShortcutIds().includes(action as ProductShortcutId)) continue;
    const binding = storedBinding(value);
    if (binding === undefined || binding.action !== action) continue;
    const others = resolveShortcuts(accepted);
    if (others.some((other) => conflicts(other, binding))) continue;
    accepted[action] = binding;
  }
  return accepted;
}

export function writeShortcutOverride(
  storage: Storage,
  action: ProductShortcutId,
  binding: ShortcutBinding,
): void {
  storage.setItem(
    storageKey,
    JSON.stringify({ ...readShortcutOverrides(storage), [action]: binding }),
  );
}

export function clearShortcutOverride(
  storage: Storage,
  action: ProductShortcutId,
): void {
  const remaining = withoutShortcutOverride(
    readShortcutOverrides(storage),
    action,
  );
  if (Object.keys(remaining).length === 0) {
    storage.removeItem(storageKey);
    return;
  }
  storage.setItem(storageKey, JSON.stringify(remaining));
}

/** Removing the key is "no overrides"; it is the Reset all affordance. */
export function clearShortcutOverrides(storage: Storage): void {
  storage.removeItem(storageKey);
}

/** The overrides without one action's entry — the per-row return to default. */
export function withoutShortcutOverride(
  overrides: ShortcutOverrides,
  action: ProductShortcutId,
): ShortcutOverrides {
  const next: Record<string, ShortcutBinding> = {};
  for (const [id, binding] of Object.entries(overrides)) {
    if (id !== action && binding !== undefined) next[id] = binding;
  }
  return next;
}

/**
 * Why this chord cannot be bound to this action, or `undefined` when it can.
 *
 * The rules are the editor's own, read from the owners that already decide
 * them: `defersToTextEntry` is `bindingFor`'s deferral rule, `conflicts` is its
 * match rule, and `printable` is `display.ts`'s — a chord the product cannot
 * print is a chord the reference cannot show, which is exactly the "a printed
 * chord must run something" constraint read the other way round.
 */
export function bindingRefusal(
  action: ProductShortcutId,
  binding: ShortcutBinding,
  overrides: ShortcutOverrides,
): BindingRefusal | undefined {
  if (MODIFIER_KEYS.has(binding.key)) return { kind: "modifier-only" };
  if (!printableChord(binding)) return { kind: "unprintable" };
  if (reserved(binding))
    return { kind: "reserved", chord: bindingLabel(binding) };
  // After `reserved`, so a function key the browser keeps reads as reserved
  // rather than as a key the store cannot carry. Every other key this rejects is
  // one `printableChord` printed and `storedBinding` would drop.
  if (!storableKey(binding.key)) return { kind: "unbindable" };
  if (!binding.modifier && !defersToTextEntry(action)) {
    return { kind: "cannot-defer" };
  }
  const taken = resolveShortcuts(overrides).find((other) =>
    conflicts(other, binding),
  );
  return taken === undefined
    ? undefined
    : { kind: "taken", action: taken.action };
}

/** Two chords, two sets: a plain-modifier letter and its Shift variant are
 *  different chords and a browser may keep one and not the other (`Ctrl+P` is
 *  free where `Ctrl+Shift+P` is Firefox's private window). */
function reserved(binding: ShortcutBinding): boolean {
  if (RESERVED_KEYS.has(binding.key)) return true;
  if (!binding.modifier) return false;
  return binding.shift === true
    ? SHIFT_RESERVED_LETTERS.has(binding.key)
    : RESERVED_LETTERS.has(binding.key);
}

/** The stored object, or nothing where it is not one. A `Storage` read throws
 *  where the browser refuses the store, and a preference that cannot be read is
 *  not an error to report: it is the defaults. */
function parseStored(storage: Storage): Readonly<Record<string, unknown>> {
  let raw: string | null;
  try {
    raw = storage.getItem(storageKey);
  } catch {
    return {};
  }
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {};
    }
    return parsed as Readonly<Record<string, unknown>>;
  } catch {
    return {};
  }
}

/** One stored entry, or `undefined` where it is not a binding the product can
 *  carry. `key` is lowercased because that is the form `bindingFor` matches
 *  against, so a stored `Z` would be a binding that never fires. */
function storedBinding(value: unknown): ShortcutBinding | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const entry = value as Record<string, unknown>;
  const { key, modifier, shift, action } = entry;
  if (typeof key !== "string" || !storableKey(key)) return undefined;
  if (typeof modifier !== "boolean") return undefined;
  if (shift !== undefined && typeof shift !== "boolean") return undefined;
  if (typeof action !== "string") return undefined;
  return shift === undefined
    ? { key, modifier, action: action as ProductShortcutId }
    : { key, modifier, shift, action: action as ProductShortcutId };
}
