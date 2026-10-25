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
 */
export function fontAssetId(cut: FontCut): string {
  const full = `${cut.source}-${cut.id}`.replace(/[^A-Za-z0-9_-]/g, "-");
  // `stableId` caps at 64 characters; the tail carries the cut's weight and
  // style, which is what tells two cuts of one family apart.
  return full.length <= 64 ? full : `${full.slice(0, 55)}-${full.slice(-8)}`;
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
      weight: cut.weight,
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
              weight: cut.weight,
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
