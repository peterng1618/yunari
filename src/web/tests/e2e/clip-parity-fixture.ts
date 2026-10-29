/**
 * The document the clip-parity spec authors: its palette, the paint each entry
 * resolves to, and the quadrants asset it clips.
 *
 * A document's colours are its author's, not the shell's, so they are fixture
 * data rather than styling — the same reason `glass-fixture.ts` holds its own.
 * The resolved `fill` a scene object carries and the `palette` entry behind it
 * are one authored fact in Fabric's two representations, so both
 * read their value from here rather than each spelling it.
 */

/** Four solid quadrants, so a clip that moved shows up as a colour. */
export const QUADRANTS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">
  <rect x="0" y="0" width="120" height="120" fill="#e01020"/>
  <rect x="120" y="0" width="120" height="120" fill="#10c030"/>
  <rect x="0" y="120" width="120" height="120" fill="#1040e0"/>
  <rect x="120" y="120" width="120" height="120" fill="#e8d010"/>
</svg>
`;

export const CLIP_PLATE = "#101318";
export const CLIP_FIELD = "#1d3557";
export const CLIP_INK = "#f0f4f8";

/** Every v2 palette carries `none`; the validator refuses a document without. */
export const CLIP_PALETTE = {
  none: {
    name: "None",
    value: { kind: "solid" as const, color: "transparent" },
  },
  plate: {
    name: "Plate",
    value: { kind: "solid" as const, color: CLIP_PLATE },
  },
  field: {
    name: "Field",
    value: { kind: "solid" as const, color: CLIP_FIELD },
  },
  ink: { name: "Ink", value: { kind: "solid" as const, color: CLIP_INK } },
  bar: { name: "Bar", value: { kind: "solid" as const, color: CLIP_PLATE } },
};
