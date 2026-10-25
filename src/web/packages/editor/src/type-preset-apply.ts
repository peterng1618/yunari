import type { FontCut, FontTrioInfo, TypePreset } from "@yunari/renderer-core";
import type { TypePresets } from "./type-preset-manager/index.js";

export type FontTrioRole = "heading" | "body" | "mono";

/** The trio's roles, in the order a theme reads them. */
export const FONT_ROLES: readonly FontTrioRole[] = ["heading", "body", "mono"];

/** The starter scale's size for a role a theme has no preset for yet. */
export const ROLE_SIZES: Readonly<Record<FontTrioRole, number>> = {
  heading: 46,
  body: 24,
  mono: 14,
};

export const ROLE_NAMES: Readonly<Record<FontTrioRole, string>> = {
  heading: "Heading",
  body: "Body",
  mono: "Mono",
};

export type TypePresetEntry = {
  readonly name: string;
  readonly value: TypePreset;
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

/** The preset a role is created at: a role-first name, the role's starter size,
 *  and the role tagged unless the author asked for none. */
export function rolePreset(
  role: FontTrioRole | null,
  cut: FontCut,
): TypePresetEntry {
  const named = role ?? "body";
  return {
    name: `${ROLE_NAMES[named]} — ${cut.family}`,
    value: {
      family: cut.family,
      size: ROLE_SIZES[named],
      weight: fontWeight(cut),
      face: { assetId: fontAssetId(cut) },
      ...(role === null ? {} : { trioRole: role }),
    },
  };
}

/**
 * Replaces only the face treatment of presets assigned to a trio role, and
 * creates a preset for any role the theme has none of. Size, line-height and
 * tracking are authored values, so the spread keeps them.
 */
export function applyFontTrio(
  presets: TypePresets,
  trio: FontTrioInfo,
): TypePresets {
  // `fromEntries`, not assignment: `__proto__` is a legal, schema-valid preset
  // id, and `rewritten["__proto__"] = preset` would reach the prototype setter
  // and lose the preset.
  const entries: [string, TypePresetEntry][] = [];
  for (const [id, preset] of Object.entries(presets)) {
    const role = preset.value.trioRole;
    const cut = role === undefined ? undefined : trio.roles[role];
    entries.push([
      id,
      cut === undefined
        ? preset
        : {
            ...preset,
            value: {
              ...preset.value,
              family: cut.family,
              weight: fontWeight(cut),
              face: { assetId: fontAssetId(cut) },
            },
          },
    ]);
  }
  const rewritten = Object.fromEntries(entries);

  const present = new Set(
    Object.values(rewritten).map((preset) => preset.value.trioRole),
  );
  const created: Record<string, TypePresetEntry> = {};
  for (const role of FONT_ROLES) {
    const cut = trio.roles[role];
    if (cut === undefined || present.has(role)) continue;
    created[freePresetId(role, rewritten, created)] = rolePreset(role, cut);
  }

  return { ...rewritten, ...created };
}

/** A role id, suffixed when a preset already holds it — an untagged preset at
 *  `mono` is authored content, and creating the role must not overwrite it. */
export function freePresetId(
  role: FontTrioRole,
  ...taken: readonly Record<string, unknown>[]
): string {
  for (let index = 1; ; index += 1) {
    const id = index === 1 ? role : `${role}-${index}`;
    if (taken.every((record) => record[id] === undefined)) return id;
  }
}
