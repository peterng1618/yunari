import type { CardDiagram } from "../../card-library.js";
import { glyphStrokeWidth } from "../../editor-shell/icons.js";

/**
 * The diagram a card unit's tile draws, one per name `card-library.ts` declares.
 *
 * **Total on purpose.** The record is keyed by `CardDiagram`, so a ninth card —
 * or a renamed diagram — fails to compile here until it is drawn, which is what
 * makes "the library is a fixed set of eight" a fact rather than a promise.
 *
 * The surface lives here rather than in `card-library.ts` because that module
 * is data (a card's parts, its readings, how a copy is minted) and this is a
 * React surface. **The library owns the name; the pane owns the drawing.**
 *
 * Stroke paths at the design's weight on the 24px grid, taken from the reference's
 * own tile artwork, so no icon family and no dependency arrives with them. That
 * is exactly its own escape from the library — a card unit tile may carry a
 * diagram of what it builds because the library is a fixed set of eight — while
 * the weight still comes from the one chrome vocabulary (`icons.ts`), so these
 * sit inside the band with every chrome glyph.
 * `time`, `ram`, `cpu`, `trends`, `storage` and `network` are the reference's
 * paths; `gpu` and `vram` are drawn here, because the reference drew one glyph
 * for each pair and **a diagram that two units share identifies neither**.
 * `storage` is the reference's drive outline without its half-filled bar: a
 * partial fill is a reading, and a diagram that shows a reading is exactly the
 * fabricated telemetry the control set forbids.
 */

interface CardDiagramProps {
  readonly size?: number;
}

type CardDiagramGlyph = (props: CardDiagramProps) => React.JSX.Element;

/** The tile's own surface: one viewBox, one weight, one hook for a test. Named
 *  apart from the vocabulary's `Glyph` because it draws a path of its own rather
 *  than a library component — `add-pane`'s `ShapeGlyph` is its twin. */
function DiagramGlyph({
  size,
  children,
}: {
  readonly size: number;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <svg
      data-yunari-card-diagram=""
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={glyphStrokeWidth(size)}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** One unit's diagram, at the tile's own default size. */
function diagramOf(draw: () => React.ReactNode): CardDiagramGlyph {
  return ({ size = 22 }) => <DiagramGlyph size={size}>{draw()}</DiagramGlyph>;
}

export const CARD_DIAGRAMS: Readonly<Record<CardDiagram, CardDiagramGlyph>> = {
  time: diagramOf(() => <path d="M5 8h9M5 12h6M5 16h11" />),
  cpu: diagramOf(() => (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M6 8h6M6 12h4" />
    </>
  )),
  gpu: diagramOf(() => (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M6 8h6M6 12h4" />
      <circle cx="17" cy="12" r="2" />
    </>
  )),
  ram: diagramOf(() => (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 5a7 7 0 0 1 0 14" />
    </>
  )),
  vram: diagramOf(() => (
    <>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="3" />
    </>
  )),
  trends: diagramOf(() => <path d="M3 16l4-4 3 3 5-7 3 4 3-3" />),
  storage: diagramOf(() => (
    <>
      <rect x="3" y="11" width="18" height="4" rx="2" />
      <path d="M3 11h9" />
    </>
  )),
  network: diagramOf(() => <path d="M3 15l4-3 3 2 4-5 3 3 4-4" />),
};
