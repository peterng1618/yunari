import {
  ASSIGNABLE_GROUPS,
  type AssignableGroup,
  describeSemanticKey,
  type FabricThemeEnvelope,
} from "@yunari/renderer-core";

/**
 * Which device slots a theme actually needs answered.
 *
 * Derived from the theme's own bindings, never authored: a theme binding
 * `disk.data.total` needs a data disk, and one binding only `cpu.load` needs
 * nothing. Asking a consumer about hardware their theme never reads is noise,
 * and the derivation is what keeps the two in step automatically (§145).
 */

/** The semantic families that map onto an assignable device slot. */
const GROUP_FAMILIES: Readonly<Record<AssignableGroup, readonly string[]>> = {
  gpu: ["gpu", "vram"],
  "system-disk": ["disk"],
  "data-disk": ["disk"],
};

/** Which slot a semantic key belongs to, if any. */
function groupFor(semanticKey: string): AssignableGroup | undefined {
  const family = describeSemanticKey(semanticKey)?.family;
  if (family === undefined) return undefined;

  for (const group of ASSIGNABLE_GROUPS) {
    if (GROUP_FAMILIES[group].includes(family)) return group;
  }

  return undefined;
}

/**
 * The slots this theme needs. A key's family decides its slot, with one
 * exception: the data-disk slot is a *second* disk, so only the `disk.data.*`
 * keys ask for it while every other disk key asks for the system disk.
 */
export function requiredDeviceGroups(
  envelope: FabricThemeEnvelope | undefined,
): readonly AssignableGroup[] {
  if (envelope === undefined) {
    return [];
  }

  const needed = new Set<AssignableGroup>();

  for (const bindings of Object.values(envelope.bindings ?? {})) {
    for (const binding of bindings) {
      if (binding.semanticKey.startsWith("disk.data.")) {
        needed.add("data-disk");
        continue;
      }

      const group = groupFor(binding.semanticKey);
      if (group !== undefined && group !== "data-disk") {
        needed.add(group);
      }
    }
  }

  return ASSIGNABLE_GROUPS.filter((group) => needed.has(group));
}
