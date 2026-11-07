/**
 * The two transform readouts beside the cursor, as external state.
 *
 * `editor-session` creates the Fabric handlers that know when a rotate or a
 * scale is happening, and the handlers never see React; the overlay that draws
 * the readings is React's. This store is the seam between them — the same shape
 * `SelectionStore` and `SheetStore` have, for the same reason.
 *
 * **Position is not state.** A pointer move publishes the text at most, and the
 * place a reading sits is written straight onto the element's `transform`
 * through the ref it bound. A render per frame would be the cost the old DOM
 * overlay existed to avoid, and it stays avoided.
 */
export type IndicatorKind = "angle" | "size";

export interface IndicatorReading {
  readonly visible: boolean;
  /** What the readout says. Kept while hidden, so the element is laid out at
   *  its real width and a later clamp measures the text it will draw. */
  readonly text: string;
}

export interface IndicatorSnapshot {
  readonly angle: IndicatorReading;
  readonly size: IndicatorReading;
}

const BLANK: IndicatorReading = { visible: false, text: "" };

/** Beside the pointer, as the old overlay had it: down and to the right, and
 *  up and to the left only where that would leave the viewport. */
const OFFSET = 16;

export class IndicatorStore {
  #snapshot: IndicatorSnapshot = { angle: BLANK, size: BLANK };
  readonly #elements = new Map<IndicatorKind, HTMLElement>();
  readonly #listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly get = (): IndicatorSnapshot => this.#snapshot;

  /** The element the placement writes to. The component binds on mount and
   *  unbinds on unmount; a store with no element still publishes the reading. */
  bind(kind: IndicatorKind, element: HTMLElement | null): void {
    if (element === null) this.#elements.delete(kind);
    else this.#elements.set(kind, element);
  }

  /** One reading, or none. A value nobody measured is not shown as zero: the
   *  absence is the hide. */
  publish(kind: IndicatorKind, text: string | undefined): void {
    const next = text === undefined ? BLANK : { visible: true, text };
    const current = this.#snapshot[kind];
    if (current.visible === next.visible && current.text === next.text) return;
    this.#snapshot = { ...this.#snapshot, [kind]: next };
    for (const listener of this.#listeners) listener();
  }

  /** Hides both readouts, as a closed gesture or a released session leaves
   *  them: text that stays visible after the pointer is up is a claim about a
   *  transform that is not happening. */
  reset(): void {
    this.publish("angle", undefined);
    this.publish("size", undefined);
  }

  /** Places one readout at the pointer, measured and clamped to the stage it
   *  overlays — the box the old wrapper clamp used.
   *
   *  The element keeps its layout while hidden, so this measures a real box
   *  rather than a collapsed one. **A text change lands on React's next
   *  commit, one write later than this call**: the first show of a longer
   *  label clamps against the previous reading's width for that one move. The
   *  alternative is a render per pointer move, which is the cost the store
   *  exists to avoid. */
  place(kind: IndicatorKind, point: { x: number; y: number }): void {
    const element = this.#elements.get(kind);
    if (element === undefined) return;
    const box = element.getBoundingClientRect();
    // The stage is the overlay's parent. jsdom lays nothing out and reports a
    // zero box, so an empty boundary falls back to the viewport.
    const stage = element.parentElement?.getBoundingClientRect();
    const bounded =
      stage !== undefined && (stage.width > 0 || stage.height > 0);
    const leftEdge = bounded ? stage.left : 0;
    const topEdge = bounded ? stage.top : 0;
    const rightEdge = bounded ? stage.right : window.innerWidth;
    const bottomEdge = bounded ? stage.bottom : window.innerHeight;
    let left = point.x + OFFSET;
    let top = point.y + OFFSET;
    if (left + box.width > rightEdge) left = point.x - box.width - OFFSET;
    if (top + box.height > bottomEdge) top = point.y - box.height - OFFSET;
    const maxLeft = Math.max(leftEdge, rightEdge - box.width);
    const maxTop = Math.max(topEdge, bottomEdge - box.height);
    element.style.transform = `translate(${Math.round(
      Math.min(Math.max(leftEdge, left), maxLeft),
    )}px, ${Math.round(Math.min(Math.max(topEdge, top), maxTop))}px)`;
  }
}
