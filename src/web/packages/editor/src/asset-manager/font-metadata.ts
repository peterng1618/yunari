/**
 * The facts a font file cannot be trusted to answer on its own.
 *
 * It lives beside the manager rather than in the form: `importFont` and
 * `amendFont` are its consumers, and a `.ts` owner keeps the type readable from
 * a program that has no JSX configured.
 */
export interface FontMetadata {
  readonly family: string;
  readonly weight: number;
  readonly style: "normal" | "italic";
  readonly licence: string;
  readonly sourceUrl?: string;
}

/** The weight range a declared face accepts, shared by the form and the
 *  manager so neither can widen it alone. */
export const FONT_WEIGHT_MIN = 120;
export const FONT_WEIGHT_MAX = 900;
