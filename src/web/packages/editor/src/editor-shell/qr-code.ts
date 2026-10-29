import encodeQR from "qr";

/**
 * The QR symbol for one URL, as rows of booleans.
 *
 * Data, never markup: the header draws `<rect>` elements from this, so a
 * library-authored SVG string never has to be trusted through
 * `dangerouslySetInnerHTML`, and the ink and paper stay the header's decision
 * rather than the encoder's.
 *
 * The encoder is a dependency for a reason:
 * every way a hand-written encoder can be wrong — Reed–Solomon, mask penalty
 * scoring, BCH format information — produces a matrix that looks right and
 * never scans, and the only instrument that would catch it is a camera this
 * project cannot put in CI.
 */
export const QUIET_ZONE_MODULES = 4;

/** Error correction M: ~15 % of the symbol recoverable, which is the level the
 *  standard's own guidance starts from for a code read off a screen. */
const ERROR_CORRECTION = "medium" as const;

export function qrMatrix(text: string): readonly (readonly boolean[])[] {
  return encodeQR(text, "raw", {
    ecc: ERROR_CORRECTION,
    border: QUIET_ZONE_MODULES,
  });
}
