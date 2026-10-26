import {
  type FabricGlobals,
  isTypeTokenRole,
  TYPE_TOKEN_ROLES,
  type TypeToken,
} from "@yunari/renderer-core";
import { uiCopy } from "../ui-copy.js";

/**
 * A token's display name is computed, never stored: `[Heading] Segoe UI 600`
 * for a role id and `Manrope 600` for an unroled one. A role is the token's id,
 * so the two spellings cannot drift from the map key.
 */
export function tokenName(id: string, token: TypeToken): string {
  const face = faceName(token);
  return isTypeTokenRole(id)
    ? `[${uiCopy.assets.fontPreview.role[id]}] ${face}`
    : face;
}

/** The family and weight an author reads, with an absent weight omitted. */
function faceName(token: TypeToken): string {
  return [token.family, token.weight]
    .filter((part) => part !== undefined && String(part).trim() !== "")
    .join(" ");
}

/** One token, under the id a reference is written against. */
export interface NamedTypeToken {
  readonly id: string;
  readonly token: TypeToken;
}

/**
 * The order every token dropdown offers: the three roles first, in
 * heading/body/mono order, then the unroled tokens by computed name. An
 * unroled token whose name is also a role's still sorts under its own name —
 * the role ids are what sort first, not a name that happens to match one.
 */
export function orderedTokens(
  globals: FabricGlobals | undefined,
): readonly NamedTypeToken[] {
  const tokens = globals?.typeTokens ?? {};
  const roles: NamedTypeToken[] = [];
  for (const role of TYPE_TOKEN_ROLES) {
    const token = tokens[role];
    if (token !== undefined) roles.push({ id: role, token });
  }
  const rest = Object.entries(tokens)
    .filter(([id]) => !isTypeTokenRole(id))
    .map(([id, token]) => ({ id, token }))
    .sort((left, right) =>
      tokenName(left.id, left.token).localeCompare(
        tokenName(right.id, right.token),
      ),
    );
  return [...roles, ...rest];
}

/**
 * The id of the token already carrying a face, if any. Two tokens with the
 * same family and weight would compute the same name, so an add points at the
 * existing one rather than minting a second. Weight is compared as its printed
 * form, because the model stores it as a string or a number and a package may
 * carry either.
 */
export function tokenIdOfFace(
  tokens: Readonly<Record<string, TypeToken>>,
  family: string,
  weight: string | number | undefined,
): string | undefined {
  const wanted = `${family.trim()}|${normalisedWeight(weight)}`;
  return Object.entries(tokens).find(
    ([, token]) =>
      `${token.family.trim()}|${normalisedWeight(token.weight)}` === wanted,
  )?.[0];
}

function normalisedWeight(weight: string | number | undefined): string {
  return weight === undefined ? "" : String(weight).trim();
}
