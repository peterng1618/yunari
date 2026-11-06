/**
 * Which stream a panel display's device is fed.
 *
 * A panel owns the wire format, so this is a choice between two streams the
 * same hardware accepts: `mode-a` is the full-colour frame the driver has
 * always sent, and `mode-b` is the paletted frame its vendor app streams, which
 * is a quarter of the bytes and so can go out faster. The display record
 * carries the choice because it is the owner's, and a reader that finds none
 * plays `mode-a` — the stream every panel family accepts.
 */
export type DisplayRenderMode = "mode-a" | "mode-b";

/** The stored field's one reading: an unknown value is `mode-a`, never a
 *  refusal, so a record written by a newer host still plays. */
export function readRenderMode(value: unknown): DisplayRenderMode {
  return value === "mode-b" ? "mode-b" : "mode-a";
}
