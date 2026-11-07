import {
  type CSSProperties,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import type { IndicatorKind, IndicatorStore } from "./store.js";

/**
 * The rotation-angle and object-size readouts beside the cursor.
 *
 * React owns both elements: the batches, the hooks and the disposal are the
 * tree's. The store is written by the Fabric handlers that already know a
 * rotate or a scale is happening, and the placement is a `transform` written
 * through the element's ref rather than a render per pointer move.
 */

/** The face of a readout: the old overlay's inline table, kept because the
 *  readouts are chrome over the canvas and carry no shell class of their own. */
const READING_STYLES: CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  background: "#2B2D33",
  color: "#fff",
  padding: "4px 8px",
  borderRadius: 4,
  fontSize: 12,
  fontWeight: 500,
  fontFamily: "system-ui, -apple-system, sans-serif",
  zIndex: 1000,
  // A readout is a reading, not a control: it must never take a pointer event
  // from the gesture it describes.
  pointerEvents: "none",
  whiteSpace: "nowrap",
  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2)",
};

/** One readout. Both are always mounted and laid out — a hidden one is
 *  `visibility: hidden`, not `display: none` — so a clamp measures a real box
 *  rather than a collapsed one. Text is state, so a new reading reaches the
 *  layout on React's next commit: a clamp on the move that first shows a
 *  longer label uses the previous width for that one write. */
function Reading({
  store,
  kind,
  className,
}: {
  readonly store: IndicatorStore;
  readonly kind: IndicatorKind;
  readonly className: string;
}): React.JSX.Element {
  const reading = useSyncExternalStore(store.subscribe, store.get)[kind];
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    store.bind(kind, ref.current);
    return () => store.bind(kind, null);
  }, [store, kind]);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        ...READING_STYLES,
        visibility: reading.visible ? "visible" : "hidden",
      }}
    >
      {reading.text}
    </div>
  );
}

/** Both readouts, in the canvas stage. Mounted once by the shell and driven by
 *  whichever session is open; a session with no transform running publishes
 *  nothing and both stay hidden. */
export function IndicatorOverlay({
  store,
}: {
  readonly store: IndicatorStore;
}): React.JSX.Element {
  return (
    <>
      <Reading store={store} kind="angle" className="yunari-angle-indicator" />
      <Reading store={store} kind="size" className="yunari-size-indicator" />
    </>
  );
}
