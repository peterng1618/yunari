/**
 * Where a rectangle's rule lands an angle, for the pairing page.
 *
 * `renderer-core`'s `snapRotation` is the owner of the rule; this page is
 * served with no build step, so it carries the browser copy and
 * `rotation.test.ts` pins the two together for a table of angles. The host
 * serves this file to unpaired devices beside `pair.html`, which is the one
 * page that has no credential.
 */
export function snapQuarterTurn(degrees) {
  return ((Math.round(degrees / 90) * 90) % 360 + 360) % 360;
}
