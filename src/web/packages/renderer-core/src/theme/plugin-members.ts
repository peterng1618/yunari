import type { MemberRecord } from "./catalogue-index.js";

/**
 * The plugin contribution groups that are browseable members, and the member
 * kind each one is.
 *
 * `settingsPages` and `assetCategories` are settings or picker data, not things
 * a person browses in the Library, so they are deliberately absent. The group
 * list lives here rather than in the store's finalize path because the editor
 * reads the same members off the installed extension listing: one mapping, two
 * readers of one package's contributions.
 */
const PLUGIN_MEMBER_GROUPS = [
  ["sensorProviders", "sensor-provider", "label"],
  ["customSources", "data-source", "name"],
  ["assetSources", "asset-source", "label"],
  ["panelFamilies", "panel-driver", "label"],
] as const;

/** One contribution group as a package manifest and the installed listing both
 *  carry it: records whose `id` and name field are read, never trusted. */
type ContributionGroup = readonly Readonly<Record<string, unknown>>[];

/** The four groups `pluginMemberRecords` reads. A manifest's `contributes` and
 *  an installed listing's typed contributions both satisfy it. */
export interface PluginMemberContributions {
  readonly sensorProviders?: ContributionGroup;
  readonly customSources?: ContributionGroup;
  readonly assetSources?: ContributionGroup;
  readonly panelFamilies?: ContributionGroup;
}

/**
 * The browseable members a plugin's contributions declare, in the order the
 * entry lists them. A contribution with no readable id is not a member: an id is
 * what a card is opened and installed by, so one that names nothing cannot be
 * shown.
 */
export function pluginMemberRecords(
  contributions: PluginMemberContributions,
): readonly MemberRecord[] {
  return PLUGIN_MEMBER_GROUPS.flatMap(([group, kind, nameKey]) =>
    recordsOf(contributions[group], kind, nameKey),
  );
}

function recordsOf(
  value: ContributionGroup | undefined,
  kind: string,
  nameKey: "label" | "name",
): readonly MemberRecord[] {
  if (!Array.isArray(value)) return [];

  const records: MemberRecord[] = [];
  for (const entry of value) {
    // A field's own value, never an inherited one: a `__proto__` key in a
    // package's JSON is data, the habit `catalogue-index.ts` follows.
    if (typeof entry !== "object" || entry === null) continue;
    const id = textOf(entry, "id");
    if (id === undefined) continue;
    records.push({
      id,
      kind,
      name: textOf(entry, nameKey) ?? id,
    });
  }
  return records;
}

function textOf(
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = Object.hasOwn(record, key) ? record[key] : undefined;
  return typeof value === "string" && value !== "" ? value : undefined;
}
