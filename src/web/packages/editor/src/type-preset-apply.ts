import {
  type FontCut,
  type FontTrioInfo,
  isTypeTokenRole,
  type TypeToken,
} from "@yunari/renderer-core";
import type { TypeTokens } from "./type-preset-manager/index.js";

export type FontTrioRole = "heading" | "body" | "mono";

/** The trio's roles, in the order a theme reads them. */
export const FONT_ROLES: readonly FontTrioRole[] = ["heading", "body", "mono"];

export const ROLE_NAMES: Readonly<Record<FontTrioRole, string>> = {
  heading: "Heading",
  body: "Body",
  mono: "Mono",
};

/**
 * The packaged asset id for a provider cut. A cut id is the provider's byte
 * address (`cut:inter@5.2.5/latin-400-normal`), which is neither a stable id
 * nor a legal package path tail; the theme carries this instead. Deterministic,
 * so re-applying a trio replaces its own declaration rather than growing the
 * package.
 *
 * The hash covers the raw `<source>:<id>`: sanitising every separator to `-`
 * would make `a/b` and `a@b` mint one id, and `adoptFont` splices by id, so one
 * cut's bytes would silently replace the other's.
 */
export function fontAssetId(cut: FontCut): string {
  const raw = `${cut.source}:${cut.id}`;
  const slug = raw.replace(/[^A-Za-z0-9_-]/g, "-");
  // `stableId` caps at 64 characters; 55 + "-" + 8 is the longest legal form.
  return `${slug.slice(0, 55)}-${shortHash(raw)}`;
}

/** FNV-1a, 32 bits: a small sync hash for an id, not a security primitive. */
function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** The numeric weight a provider cut names. A provider may send it as a
 *  string, and the packaged asset and the preset must agree on one number. */
export function fontWeight(cut: FontCut): number {
  const weight = Number(cut.weight);
  if (!Number.isFinite(weight) || weight <= 0)
    throw new Error(`"${cut.family}" has no usable font weight.`);
  return weight;
}

/** The token a role is created at: the family and weight the caller names.
 *  The role is the token's own id. */
export function presetForRole(family: string, weight: number): TypeToken {
  return { family, weight };
}

/** The token a provider cut is adopted at, bound to the packaged face. */
export function rolePreset(cut: FontCut): TypeToken {
  return {
    ...presetForRole(cut.family, fontWeight(cut)),
    face: { assetId: fontAssetId(cut) },
  };
}

/**
 * Replaces only the face treatment of tokens whose id is a role, and creates a
 * token for any role the theme has none of. Size, line-height and tracking are
 * authored on the run, so nothing here reads them.
 */
export function applyFontTrio(
  presets: TypeTokens,
  trio: FontTrioInfo,
): TypeTokens {
  // `fromEntries`, not assignment: `__proto__` is a legal, schema-valid token
  // id, and `rewritten["__proto__"] = preset` would reach the prototype setter
  // and lose the token.
  const entries: [string, TypeToken][] = [];
  for (const [id, token] of Object.entries(presets)) {
    const role = isTypeTokenRole(id) ? id : undefined;
    const cut = role === undefined ? undefined : trio.roles[role];
    entries.push([
      id,
      cut === undefined
        ? token
        : {
            ...token,
            family: cut.family,
            weight: fontWeight(cut),
            face: { assetId: fontAssetId(cut) },
          },
    ]);
  }
  const rewritten = Object.fromEntries(entries);

  const present = new Set(Object.keys(rewritten).filter(isTypeTokenRole));
  const created: Record<string, TypeToken> = {};
  for (const role of FONT_ROLES) {
    const cut = trio.roles[role];
    if (cut === undefined || present.has(role)) continue;
    // The role is the id, and `present` has just shown it is free: a suffixed
    // id would be an unroled token whose computed name reads as a role.
    created[role] = rolePreset(cut);
  }

  return { ...rewritten, ...created };
}

/**
 * The first free id an unroled token takes: `type`, `type-2`, …
 *
 * A role id is never minted here. A role is the token's id, so `heading-2`
 * would be an unroled token whose computed name reads as a second heading;
 * callers adding a role use the role id itself, and a caller adding an unroled
 * token always goes through this.
 */
export function freePresetId(
  ...taken: readonly Record<string, unknown>[]
): string {
  for (let index = 1; ; index += 1) {
    const id = index === 1 ? "type" : `type-${index}`;
    if (taken.every((record) => record[id] === undefined)) return id;
  }
}
