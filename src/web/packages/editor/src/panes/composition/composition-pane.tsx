import {
  type CSSProperties,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useControlTooltip } from "../../components/ui/control-icon-button.js";
import type { EditorShellBridge } from "../../editor-shell/bridge.js";
import {
  ENTER_GLYPH,
  Glyph,
  LEAVE_GLYPH,
  TWISTY_GLYPHS,
} from "../../editor-shell/icons.js";
import type { LayerRole, LayerRow } from "../../editor-shell/layer-tree.js";
import { uiCopy } from "../../ui-copy.js";
import { KindMark } from "./kind-mark.js";
import { RowAffordances } from "./row-affordances.js";

/** The row's role in words, from the facts the projection reports.
 *
 * One arm per `LayerRole`, so a kind added to the union is a compile error here
 * rather than a row that names nothing — and the words come from `uiCopy` rather
 * than from this file, so the vocabulary keeps its one owner.
 */
function roleText(role: LayerRole): string {
  switch (role.kind) {
    case "text":
      return uiCopy.panels.layerRoles.text();
    case "shape":
      return uiCopy.panels.layerRoles.shape();
    case "image":
      return uiCopy.panels.layerRoles.image();
    case "background":
      return uiCopy.panels.layerRoles.background();
    case "group":
      return uiCopy.panels.layerRoles.group(role.unit);
    case "chart":
      return uiCopy.panels.layerRoles.chart(role.family, role.series);
  }
}

/**
 * One of the row's own icon-only controls: the twisty that opens a group and
 * the button that goes into one.
 *
 * Both carry the row's name beside the verb — three buttons reading "Expand"
 * in one tree tell a reader nothing about which group each one opens — and that
 * one string is both the accessible name and the tooltip, mounted from the
 * control set's one owner of the pairing (`useControlTooltip`, §6), so the two
 * cannot disagree.
 *
 * It renders a bare `<button>` and no wrapper on purpose: `.yunari-layer-state`
 * asks its own children how much room beside the key they need
 * (`:has(... button:nth-child(n))`), and a wrapper would put every button at
 * position one of its own parent.
 */
function RowIconButton({
  label,
  expanded,
  data,
  onClick,
  children,
}: {
  readonly label: string;
  readonly expanded?: boolean;
  readonly data?: Readonly<Record<`data-${string}`, string>>;
  readonly onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const ref = useRef<HTMLButtonElement>(null);
  useControlTooltip(ref, label);
  return (
    <button
      {...data}
      ref={ref}
      type="button"
      aria-label={label}
      aria-expanded={expanded}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Selection is external mutable state and Fabric owns it, so the projection is
 * cached rather than rebuilt per `getSnapshot`: React compares snapshots with
 * `Object.is`, and a fresh array each call re-renders forever. */
class LayerStore {
  #bridge: EditorShellBridge | undefined;
  readonly #listeners = new Set<() => void>();
  #rows: readonly LayerRow[] = [];
  #unsubscribe: (() => void) | undefined;

  set(bridge: EditorShellBridge | undefined): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#bridge = bridge;
    if (bridge !== undefined) {
      this.#rows = bridge.layers();
      this.#unsubscribe = bridge.subscribe(() => {
        this.#rows = bridge.layers();
        this.#publish();
      });
    } else {
      this.#rows = [];
    }
    this.#publish();
  }

  /** Run a bridge command and re-read the projection it changed. The bridge also
   * notifies, but a command that ever stopped notifying would otherwise leave
   * the panel showing state it had just changed. */
  mutate(action: () => void): void {
    action();
    if (this.#bridge !== undefined) this.#rows = this.#bridge.layers();
    this.#publish();
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly get = (): readonly LayerRow[] => this.#rows;

  #publish(): void {
    for (const listener of this.#listeners) listener();
  }
}

/** Paired with `.yunari-layer-row`'s height in `editor-shell.css`: the row is
 * the control set's 26px panel rhythm (§3) because the row's own controls are
 * 26px squares (§5), and a 26px control in a shorter row is a control the row
 * clips.
 *
 * Exported with the indent pair below because the drop line's placement is this
 * arithmetic, and the test that pins it reads the constants rather than a second
 * copy of the numbers. */
export const ROW_HEIGHT = 26;

/** The row's indentation: `LAYER_ROW_INDENT` at the root and
 *  `LAYER_ROW_INDENT_STEP` per level, matched by `.yunari-layer-row`'s
 *  `calc(6px + var(--layer-depth, 0) * 13px)` and by the drop line's
 *  `--layer-dropline-left`, which promises the slot the row it crosses would
 *  take. */
export const LAYER_ROW_INDENT = 6;
export const LAYER_ROW_INDENT_STEP = 13;

/** The entered group and everything under it. The projection emits a parent
 * before its children, so one forward pass reaches any depth — and a row whose
 * group is not in the tree (a collapsed ancestor) is simply not marked. */
function contextRows(
  rows: readonly LayerRow[],
  entered: readonly string[],
): ReadonlySet<string> {
  const context = new Set(entered);
  for (const row of rows)
    if (row.parentId !== undefined && context.has(row.parentId))
      context.add(row.id);
  return context;
}

/**
 * The keys a tree is defined by, on the row that declares the tree.
 *
 * The row said `role="treeitem"`, and a treeitem whose arrow keys do nothing is
 * a promise the panel does not keep — a screen reader announces a tree and then
 * none of it responds. The nudge handler owns the arrow keys on the canvas, but
 * it defers only for a TEXT ENTRY, and a row is a `div`, so an unmodified arrow
 * key reached the nudge and moved the selected object instead. Taking the keys
 * here and stopping propagation is what lets the list be a list: navigation
 * while focus is inside it, nudging while it is not.
 */
function moveFocus(
  event: React.KeyboardEvent<HTMLDivElement>,
  row: LayerRow,
  bridge: EditorShellBridge | undefined,
): boolean {
  const rows = [
    ...(event.currentTarget
      .closest('[role="tree"]')
      ?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []),
  ];
  const at = rows.indexOf(event.currentTarget);
  if (at < 0) return false;
  const focus = (index: number): void => {
    const next = rows[index];
    if (next !== undefined) next.focus();
  };
  const expandable = row.hasChildren;

  switch (event.key) {
    case "ArrowDown":
      focus(at + 1);
      return true;
    case "ArrowUp":
      focus(at - 1);
      return true;
    case "Home":
      focus(0);
      return true;
    case "End":
      focus(rows.length - 1);
      return true;
    case "ArrowRight":
      // Expand a collapsed group, or step into an expanded one's first child.
      if (expandable && row.collapsed === true) {
        bridge?.setCollapsed(row.id, false);
        return true;
      }
      if (expandable && at + 1 < rows.length) focus(at + 1);
      return true;
    case "ArrowLeft": {
      if (expandable && row.collapsed === false) {
        bridge?.setCollapsed(row.id, true);
        return true;
      }
      // Otherwise step out to the parent, the level the row names.
      for (let i = at - 1; i >= 0; i -= 1) {
        const parent = rows[i];
        if (Number(parent?.getAttribute("aria-level") ?? 1) < row.depth + 1) {
          parent?.focus();
          return true;
        }
      }
      return true;
    }
    default:
      return false;
  }
}

/** One dense row per layer: type icon, name, and the two state icons. */
export function CompositionPane({
  bridge,
}: {
  readonly bridge: EditorShellBridge | undefined;
}): React.JSX.Element {
  const ref = useRef<LayerStore | null>(null);
  if (ref.current === null) ref.current = new LayerStore();
  const store = ref.current;
  const rows = useSyncExternalStore(store.subscribe, store.get, store.get);
  useEffect(() => store.set(bridge), [store, bridge]);
  // Read at render, not mirrored into state: the store re-reads the projection
  // and publishes on every selection change, so entering a group re-renders
  // here with the context the manager has already recorded.
  const entered = bridge?.groupContext() ?? [];
  const context = contextRows(rows, entered);

  const [editing, setEditing] = useState<string | undefined>(undefined);
  const cancelled = useRef(false);
  // Which row the pointer is over and which holds the keyboard, so the two
  // state icons can appear for a row the author is about to act on. Ids rather
  // than booleans: attention is one property the author has, so one field per
  // kind holds it, and the answer is an identity comparison per row rather than
  // a scan of a set that grew with the row count.
  //
  // **No row is memoized, so this does not re-render anything less.** Either
  // state change re-renders the panel and all its rows. What the id form buys
  // is only the size and lookup of the state — a `Set` of attended ids would
  // answer the same rows in the same pass.
  const [hovered, setHovered] = useState<string | undefined>(undefined);
  const [focused, setFocused] = useState<string | undefined>(undefined);

  // The drag's own state, not React's: a ref set mid-gesture lands without a
  // re-render, so a drop that follows within the same frame cannot see the
  // stale value a state update would leave behind.
  const drag = useRef<
    | {
        from: string;
        /** The row the drop would be anchored on: the container when the row is
         *  an empty group, its sibling slot otherwise. The bridge decides which,
         *  so the same value is what `moveLayer` is handed. */
        anchor: string | undefined;
        marked: HTMLElement | undefined;
        source: HTMLElement | undefined;
      }
    | undefined
  >(undefined);
  // One line for the whole tree: the browser applies it to whatever element is
  // under the cursor, which is exactly the slot that would take the drop.
  const indicator = useRef<HTMLDivElement | null>(null);
  // The tree itself, so the stylesheet can tell "a drag is in flight" from
  // "this row is a target" — the two answer different questions.
  const tree = useRef<HTMLDivElement | null>(null);
  // Where a shift-click's range starts: the last row the author *chose* — a
  // plain or ctrl click, or the Space key, which is this list's plain select
  // from the keyboard — and never a shift-click. A ref rather than state,
  // because it changes nothing the panel renders.
  const anchor = useRef<string | undefined>(undefined);

  /** The one row carrying `data-drop`, and the only one that may: two marked
   * rows would claim two slots, and the second would be a lie. Written to the
   * DOM for the same reason the drag state is a ref — a drop can follow the
   * last `dragover` inside one frame. */
  const mark = (
    row: HTMLElement | undefined,
    state: "slot" | "refused" | undefined,
  ): void => {
    const active = drag.current;
    if (active === undefined) return;
    active.marked?.removeAttribute("data-drop");
    active.marked = undefined;
    if (row !== undefined && state !== undefined) {
      row.setAttribute("data-drop", state);
      active.marked = row;
    }
  };

  /** Take the gesture's marks off the tree with the gesture, so nothing outlives
   * the drag that put it there. */
  const unmark = (): void => {
    mark(undefined, undefined);
    drag.current?.source?.removeAttribute("data-drag-source");
    drag.current = undefined;
    tree.current?.removeAttribute("data-dragging");
    if (indicator.current !== null) indicator.current.hidden = true;
  };

  const commit = (id: string, name: string): void => {
    setEditing(undefined);
    store.mutate(() => bridge?.renameLayer(id, name));
  };

  /**
   * What a row click selects, given the gesture.
   *
   * `shift` takes the range from the anchor to this row **over the rows as
   * rendered** — the projection's flat list is the order the author sees, and a
   * shut group has no rows to range over. `ctrl`/`cmd` adds or removes one. A
   * plain click replaces, which is what it has always done. The bridge takes the
   * ids; this decides which ones, because "extend" is a fact about this list.
   *
   * The three forms are the ruling's own (`vg-056`): shift extends a range and
   * ctrl toggles, rather than one idiom or the other.
   */
  const clickRow = (event: React.MouseEvent, id: string): void => {
    const ids = rows.map((row) => row.id);
    const from =
      anchor.current === undefined ? -1 : ids.indexOf(anchor.current);
    if (event.shiftKey && from >= 0) {
      const to = ids.indexOf(id);
      if (to >= 0) {
        // A shift-click leaves the anchor where it is: it changes the range,
        // not where the range starts.
        store.mutate(() =>
          bridge?.selectLayers(
            ids.slice(Math.min(from, to), Math.max(from, to) + 1),
          ),
        );
        return;
      }
    }
    anchor.current = id;
    if (event.ctrlKey || event.metaKey) {
      // Read from the projection rather than kept here: it is the same answer
      // the rows are painted from, so a toggle cannot disagree with the tree.
      const chosen = rows.filter((row) => row.selected).map((row) => row.id);
      // Removing the last one sends `[]`, which clears rather than leaving a
      // stale object active.
      store.mutate(() =>
        bridge?.selectLayers(
          chosen.includes(id)
            ? chosen.filter((chosenId) => chosenId !== id)
            : [...chosen, id],
        ),
      );
      return;
    }
    store.mutate(() => bridge?.selectLayer(id));
  };

  return (
    <>
      {/* The pane's own chrome — its title bar, its section frame and its
       * footer toolbar — belongs to `Pane`, which names the section
       * `[data-yunari-panel="layers"]`. What is left here is the tree. */}
      <div ref={tree} role="tree" aria-label={uiCopy.panels.layers}>
        {rows.map((row, index) => {
          const Twisty =
            TWISTY_GLYPHS[row.collapsed ? "collapsed" : "expanded"];
          const twisty = row.collapsed
            ? uiCopy.panels.expand
            : uiCopy.panels.collapse;
          // The two state icons appear only where they say something: a pointer
          // or the keyboard is on the row, the row is selected, or the state
          // itself is not the default. 104 icons reading "visible, unlocked"
          // was noise that grew with the row count, which is exactly the case a
          // card-heavy panel hides. Two flags that are both true carry no
          // information, so a default row carries neither.
          const attended = hovered === row.id || focused === row.id;
          // The twisty's own gate, read once so the control below cannot ask a
          // second, slightly different question about the same fact.
          const expandable = row.hasChildren;
          // Entry is not a toggle: the entered group carries the way *out*, so
          // the row the author is inside draws this one without being attended.
          const isEntered = entered.includes(row.id);
          // The background is not a scene object: it has no name, no children
          // and no authored state, so the row drops every gesture and control
          // that would write one. Selecting is all it offers.
          const isBackground = row.kind === "background";
          const showEnter =
            !isBackground &&
            expandable &&
            (attended || row.selected || isEntered);
          const entry = isEntered ? uiCopy.panels.leave : uiCopy.panels.enter;
          return (
            <div
              // The row's own id is not unique once an object moves: a stale
              // projection can hold one id twice, and a duplicate key makes
              // React reuse the wrong row. Slot identity is what re-renders.
              key={`${row.id}#${index}`}
              className="yunari-layer-row"
              data-yunari-layer={row.id}
              data-selected={row.selected}
              // A hidden layer is hidden on the canvas too, and the row said
              // so only in its tooltip — one measurable difference between a
              // row you hid and a row you never touched.
              data-hidden={!row.visible}
              // The entered group and its descendants are what a tree click can
              // reach on its own; everything else is dimmed to say so. With no
              // group entered there is no context to be outside of, so the
              // attribute is omitted rather than written false: React renders a
              // boolean `data-*` as the string "false", which is the value the
              // stylesheet rule dims on, and a tree greyed out on open would
              // claim every selectable top-level layer is unreachable.
              // The background sits outside every group, so entering one must
              // not dim it: it stays reachable.
              data-context={
                isBackground
                  ? undefined
                  : context.size > 0
                    ? context.has(row.id)
                    : undefined
              }
              // A group is a container, and a bold name says so without a mark
              // repeating it. The stylesheet dims on this rather than on a
              // class, so the state survives the row's own class list changing.
              data-kind={row.kind}
              role="treeitem"
              aria-selected={row.selected}
              aria-level={row.depth + 1}
              // Roving tabindex would be the roving-focus ideal, but every row
              // here is cheap and the shell has no global key handler to own
              // the roving state, so all rows stay tabbable.
              tabIndex={0}
              // What the row says, not the key behind it: a tooltip that
              // printed a raw uuid told the author nothing the row did not.
              title={row.name}
              onMouseEnter={() => setHovered(row.id)}
              // `mouseleave` rather than `mouseout`: it fires once on leaving
              // the row, not again for every descendant the pointer crosses on
              // the way to the row's own buttons.
              onMouseLeave={() => setHovered(undefined)}
              // Focus counts as attention for the same reason hover does — a
              // keyboard author must reach the same controls a pointer reaches.
              // React's focus/blur bubble, so this also covers the buttons the
              // row renders once it has focus.
              onFocus={() => setFocused(row.id)}
              onBlur={(event) => {
                // Moving focus to one of the row's own controls is not leaving
                // it; only focus that leaves the row entirely stands down.
                if (
                  event.currentTarget.contains(
                    event.relatedTarget as Node | null,
                  )
                )
                  return;
                setFocused(undefined);
              }}
              // A row being renamed is a text field: its own drag gesture is
              // selecting text, not restacking the layer. The background has no
              // position to restack and is never a drop anchor.
              draggable={!isBackground && editing !== row.id}
              onDragStart={(event) => {
                if (isBackground) return;
                // Chrome will not start a drag without payload, and one of our
                // own rows is the only thing that may start one.
                event.dataTransfer.setData(
                  "application/x-yunari-layer",
                  row.id,
                );
                drag.current = {
                  from: row.id,
                  anchor: undefined,
                  marked: undefined,
                  source: event.currentTarget,
                };
                // The whole tree knows a gesture is in flight, so the stylesheet
                // can hold the slot apart from everything it is not.
                tree.current?.setAttribute("data-dragging", row.id);
                // What the author picked up, so the list shows the gesture is
                // holding a specific row rather than the whole tree.
                event.currentTarget.setAttribute("data-drag-source", "");
              }}
              // The row is the drop slot's height, so the browser pointing its
              // drop indicator at this row is the same thing as a pointer aimed
              // between this row and the one above it.
              onDragOver={(event) => {
                if (isBackground) return;
                const active = drag.current;
                if (active === undefined) return;
                if (active.anchor === row.id) return;
                // Not above ourselves: that is where the layer already is, which
                // is a third answer and neither a slot nor a refusal.
                const moved = row.id !== active.from;
                // Every anchor a row can name can land, including one across a
                // group boundary: the anchor's own parent is the container the
                // drop enters, which is what makes dragging a row into a group
                // and back out to the root the same gesture as restacking one
                // (`vg-461`). Two things are refused instead — a cycle, a group
                // dropped inside itself, and an anchor that does not resolve —
                // and the bridge answers both in the tree's own terms, so the
                // panel cannot promise a drop Fabric would log and drop.
                const drop = moved
                  ? bridge?.layerDrop(active.from, row.id)
                  : undefined;
                active.anchor = drop === undefined ? undefined : row.id;

                if (drop !== undefined) {
                  // A permanent marker reads as state, not as a target.
                  event.preventDefault();
                  mark(event.currentTarget, "slot");
                } else {
                  // vg-099: the refusal used to be swallowed whole — cancelled
                  // or not made no difference to anything an author could see.
                  // Not cancelling is deliberate: the browser then shows its own
                  // no-drop cursor here, which is one more surface saying no
                  // rather than the panel saying it alone.
                  mark(moved ? event.currentTarget : undefined, "refused");
                }

                // The line follows the row's answer rather than the other way
                // round: it is the panel's promise of a landing slot, so it has
                // to be taken away wherever there is no slot. Carried over from
                // the pointer's previous row, it would offer the drop the row
                // under the cursor has just refused.
                const line = indicator.current;
                if (line === null) return;
                // An empty group is a container rather than a gap between two
                // rows: the object lands *inside* it, so the row's own mark is
                // the whole of the promise and a line between rows would name a
                // position no drop would take.
                if (drop === undefined || drop.kind === "into") {
                  line.hidden = true;
                  return;
                }
                line.hidden = false;
                // The `px` is load-bearing and was missing: `top: 48` is an
                // invalid length, so the declaration is dropped and the line
                // falls back to `auto`, which sizes it to zero. Measured on
                // canvas — the line had never drawn at all, on any drop, and
                // the only thing marking a valid slot was the row itself.
                line.style.setProperty(
                  "--layer-dropline-top",
                  `${index * ROW_HEIGHT}px`,
                );
                line.style.setProperty(
                  "--layer-dropline-left",
                  `${LAYER_ROW_INDENT + row.depth * LAYER_ROW_INDENT_STEP}px`,
                );
              }}
              onDrop={(event) => {
                if (isBackground) return;
                const active = drag.current;
                const anchor = active?.anchor;
                unmark();
                if (active === undefined || anchor === undefined) return;
                event.preventDefault();
                store.mutate(() => bridge?.moveLayer(active.from, anchor));
              }}
              onDragEnd={isBackground ? undefined : unmark}
              style={
                {
                  "--layer-depth": String(row.depth),
                  paddingLeft: `calc(${LAYER_ROW_INDENT}px + var(--layer-depth) * ${LAYER_ROW_INDENT_STEP}px)`,
                } as CSSProperties
              }
              onClick={(event) => clickRow(event, row.id)}
              onDoubleClick={() => {
                if (isBackground) return;
                cancelled.current = false;
                setEditing(row.id);
              }}
              onKeyDown={(event) => {
                // Keys raised inside the row's own controls are theirs, not the
                // row's: without this the rename input's Enter would commit and
                // then reopen the field as the event bubbles out.
                if (event.target !== event.currentTarget) return;
                // No arrow-key focus movement: the window-level nudge handler
                // owns the arrow keys, and two owners for one key would nudge an
                // object and move focus on the same press.
                if (
                  !isBackground &&
                  (event.key === "F2" || event.key === "Enter")
                ) {
                  event.preventDefault();
                  cancelled.current = false;
                  setEditing(row.id);
                  return;
                }
                // Selecting is the other half of the keys vg-067 added, and a
                // treeitem you can walk to but not pick is half a tree. Enter
                // is already rename's, so selection takes the key a list has
                // always used for it.
                if (event.key === " " || event.key === "Spacebar") {
                  event.preventDefault();
                  // Space is this row's plain select from the keyboard, so it
                  // moves the anchor the way the plain click does: a keyboard
                  // select that left a stale anchor would be the same gesture
                  // behaving two ways.
                  anchor.current = row.id;
                  store.mutate(() => bridge?.selectLayer(row.id));
                  return;
                }
                if (moveFocus(event, row, bridge)) {
                  // The nudge handler defers only for a text entry, and a row is
                  // a `div`, so without this an arrow key navigates the list
                  // AND nudges the selection.
                  event.stopPropagation();
                  event.preventDefault();
                  return;
                }
              }}
            >
              {expandable ? (
                <RowIconButton
                  label={`${twisty} ${row.name}`}
                  expanded={!row.collapsed}
                  onClick={(event) => {
                    event.stopPropagation();
                    store.mutate(() =>
                      bridge?.setCollapsed(row.id, !row.collapsed),
                    );
                  }}
                >
                  <Glyph icon={Twisty} size={13} />
                </RowIconButton>
              ) : (
                <span aria-hidden className="yunari-layer-twisty" />
              )}
              <KindMark mark={row.mark} />
              {editing === row.id ? (
                <input
                  // Intended autofocus: the field only exists because the author double-clicked the row.
                  autoFocus
                  className="yunari-layer-rename"
                  aria-label={`${uiCopy.panels.rename} ${row.name}`}
                  defaultValue={row.name}
                  onClick={(event) => event.stopPropagation()}
                  onBlur={(event) => {
                    if (cancelled.current) {
                      cancelled.current = false;
                      return;
                    }
                    commit(row.id, event.currentTarget.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter")
                      commit(row.id, event.currentTarget.value);
                    else if (event.key === "Escape") {
                      cancelled.current = true;
                      setEditing(undefined);
                    }
                  }}
                />
              ) : (
                <span className="yunari-layer-name">{row.name}</span>
              )}
              {/* What the row *is*, in the document's own words — and on four
                  rows in five the only thing a screen reader hears about it: a
                  chart's icon, a shape's swatch and an image's thumbnail are
                  `aria-hidden`, and a group's stack glyph carries no word — so
                  this is the row's whole statement of its kind. It is therefore
                  rendered on every row, and never made conditional the way the
                  bound column below is — a missing key is the fact "this reads
                  nothing", while a missing role is a row that is not identified
                  at all.

                  One element, never repeated: no `title` (a tooltip reaches no
                  keyboard author), nothing inside `.yunari-layer-mark` (whose
                  `flex-basis` would clip it), and never hidden, because a
                  treeitem's name is the concatenation of its own columns. */}
              <span
                className="yunari-layer-role"
                data-yunari-layer-role={row.role.kind}
              >
                {roleText(row.role)}
              </span>
              {/* What the row reads, taken from the document's own binding — and
                  nothing at all where it reads nothing.

                  That absence is the plain statement. A word repeated down this
                  column on every row that has nothing to say carries no
                  information, and it is paid for out of the layer *name*, which
                  is the one thing a layer list has to keep readable — which is
                  the density §173 asks for. A row that reads nothing says so by
                  carrying nothing, and never by claiming a key it does not have.

                  This is also the only place a row states a key. A treeitem's
                  accessible name is the concatenation of its own columns, so the
                  `@key` the specimen used to carry as well said every binding in
                  the panel twice over — which is why the projection no longer
                  prints one where this column will. */}
              {row.bound.length === 0 ? null : (
                <span
                  className="yunari-layer-bound"
                  title={row.bound.join(uiCopy.panels.boundSeparator)}
                >
                  {row.bound.join(uiCopy.panels.boundSeparator)}
                </span>
              )}
              {/* The controls. The slot itself is always present so the icons
                  land in the same place on every row; the room they need
                  beside the key is held open by the stylesheet only on rows
                  that actually draw them, because holding it open everywhere
                  cost the *name* 50px on all sixty rows.

                  Entry is the control that is not a state toggle and not the
                  row's own: it appears on a group the author can go into, under
                  the attention rule the two beside it keep — and the row the
                  author is *inside* draws it unattended, so the way out is
                  never the one thing a quiet row withholds. The eye and the
                  lock are `RowAffordances`' own, and the pane hands it the
                  attention it computed rather than letting it ask again.

                  There is no rename control: the name the pen acted on is this
                  row's own, so the field opens from the row itself — a
                  double-click on it, or F2/Enter from the keyboard
                  (`vg-462`). */}
              <span className="yunari-layer-state">
                {showEnter ? (
                  <RowIconButton
                    label={`${entry} ${row.name}`}
                    data={{
                      "data-yunari-layer-entry": isEntered ? "leave" : "enter",
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      // Entering and expanding are two acts: this is the only
                      // control that changes the context, and the twisty above
                      // is the only one that changes what is open.
                      store.mutate(() => {
                        if (isEntered) bridge?.exitGroup();
                        else bridge?.enterGroup(row.id);
                      });
                    }}
                  >
                    {isEntered ? (
                      <Glyph icon={LEAVE_GLYPH} size={13} />
                    ) : (
                      <Glyph icon={ENTER_GLYPH} size={13} />
                    )}
                  </RowIconButton>
                ) : null}
                {isBackground ? null : (
                  <RowAffordances
                    row={row}
                    attended={attended}
                    onToggleVisible={() =>
                      store.mutate(() =>
                        bridge?.setLayerVisible(row.id, !row.visible),
                      )
                    }
                    onToggleLocked={() =>
                      store.mutate(() =>
                        bridge?.setLayerLocked(row.id, !row.locked),
                      )
                    }
                  />
                )}
              </span>
            </div>
          );
        })}
        <div
          ref={indicator}
          hidden
          aria-hidden
          data-yunari-layer-dropline=""
          className="yunari-layer-dropline"
        />
      </div>
    </>
  );
}
