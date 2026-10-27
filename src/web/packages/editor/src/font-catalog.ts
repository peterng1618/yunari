import { isTypeTokenRole, type TypeToken } from "@yunari/renderer-core";
import { GENERATED_FACES, GENERATED_TRIOS } from "./font-trios.generated.js";

export type FontTrioRole = "heading" | "body" | "mono";

export interface CuratedFontFace {
  readonly id: string;
  /** Which role the pairing asked this face for — not a property of the face.
   * A standalone face in `GENERATED_FACES` carries whichever pairing reached it
   * first, so grouping `catalogFaces()` by this files every clamped face under
   * Heading: all 24 clamped entries are first-touch `role: "heading"`. Read the
   * role off a trio's face, where position is the role. */
  readonly role: FontTrioRole;
  readonly family: string;
  readonly weight: number;
  readonly style: "normal" | "italic";
  readonly format: "woff2";
  readonly subset: string;
  readonly sourceUrl: string;
  /** A provider cut names its licence only; the URL is the catalogue's own. */
  readonly license: { readonly name: string; readonly url?: string };
  /** True when the weight is the nearest the family ships, not the family's own
   * cut. A pairing's request, so read it off a trio's face: a standalone face in
   * `GENERATED_FACES` carries whichever pairing reached it first. */
  readonly clamped?: boolean;
}

export interface FontTrio {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly categories: readonly string[];
  readonly mood: readonly string[];
  readonly useCase: readonly string[];
  readonly superfamily: string;
  readonly faces: readonly CuratedFontFace[];
}

const TRIOS: readonly FontTrio[] = GENERATED_TRIOS;
const BY_ID = new Map(TRIOS.map((trio) => [trio.id, trio]));

export function fontTrio(id: string): FontTrio | undefined {
  return BY_ID.get(id);
}

export function fontTrios(): readonly FontTrio[] {
  return TRIOS;
}

/** Every distinct curated face, for the picker. Deduplicated by the generator:
 * 261 of them, because a heading is clamped to the pairing's own recommendation
 * rather than to a uniform 700, which is what the design doc's measured 238
 * counted. `role` and `clamped` say which pairing reached the face first. */
export function catalogFaces(): readonly CuratedFontFace[] {
  return GENERATED_FACES;
}

/** The face this trio uses for `role`, nearest to `weight`. Every preset
 * holding that role is rewritten with whatever this returns, so dropping the
 * role filter does not merely degrade one role — it hands each preset the face
 * of whichever trio face happens to sit nearest, and the role that owns that
 * weight is the one that survives. Which role that is depends on the trio: on
 * `yaldevi-libre-franklin`, where body and mono are both 400, body is returned
 * for every role and the heading and mono presets take the body's face. */
export function faceForRole(
  trio: FontTrio,
  role: FontTrioRole,
  weight: number,
): CuratedFontFace | undefined {
  return trio.faces
    .filter((face) => face.role === role)
    .sort(
      (left, right) =>
        Math.abs(left.weight - weight) - Math.abs(right.weight - weight),
    )[0];
}

/** Replaces only the face treatment of tokens whose id is a trio role. */
export function applyFontTrio<T extends Readonly<Record<string, TypeToken>>>(
  presets: T,
  trio: FontTrio,
): T {
  return Object.fromEntries(
    Object.entries(presets).map(([id, preset]) => {
      const role = isTypeTokenRole(id) ? id : undefined;
      if (role === undefined) return [id, preset];
      const face = faceForRole(trio, role, Number(preset.weight ?? 400));
      if (face === undefined) return [id, preset];
      return [
        id,
        {
          ...preset,
          family: face.family,
          weight: face.weight,
          face: { assetId: face.id },
        },
      ];
    }),
  ) as T;
}
