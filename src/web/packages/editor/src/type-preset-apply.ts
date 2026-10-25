import type { FontTrioInfo, TypePreset } from "@yunari/renderer-core";
import type { TypePresets } from "./type-preset-manager/index.js";

type Role = "heading" | "body" | "mono";

const ROLES: readonly Role[] = ["heading", "body", "mono"];

/** The starter scale's size for a role a theme has no preset for yet. */
const ROLE_SIZES: Readonly<Record<Role, number>> = {
  heading: 46,
  body: 24,
  mono: 14,
};

const ROLE_NAMES: Readonly<Record<Role, string>> = {
  heading: "Heading",
  body: "Body",
  mono: "Mono",
};

type PresetEntry = { readonly name: string; readonly value: TypePreset };

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
  const entries: [string, PresetEntry][] = [];
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
              face: { assetId: cut.id },
            },
          },
    ]);
  }
  const rewritten = Object.fromEntries(entries);

  const present = new Set(
    Object.values(rewritten).map((preset) => preset.value.trioRole),
  );
  const created: Record<string, PresetEntry> = {};
  for (const role of ROLES) {
    const cut = trio.roles[role];
    if (cut === undefined || present.has(role)) continue;
    created[freeId(role, rewritten, created)] = {
      name: `${ROLE_NAMES[role]} — ${cut.family}`,
      value: {
        family: cut.family,
        size: ROLE_SIZES[role],
        weight: cut.weight,
        face: { assetId: cut.id },
        trioRole: role,
      },
    };
  }

  return { ...rewritten, ...created };
}

/** A role id, suffixed when a preset already holds it — an untagged preset at
 *  `mono` is authored content, and creating the role must not overwrite it. */
function freeId(
  role: Role,
  ...taken: readonly Record<string, unknown>[]
): string {
  for (let index = 1; ; index += 1) {
    const id = index === 1 ? role : `${role}-${index}`;
    if (taken.every((record) => record[id] === undefined)) return id;
  }
}
