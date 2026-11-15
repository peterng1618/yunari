import { DASHBOARD_THEME_KIND, type MemberRecord } from "./catalogue-index.js";
import {
  type PluginMemberContributions,
  pluginMemberRecords,
} from "./plugin-members.js";

/**
 * One listing kind's browseable members, derived from the plain rows both
 * halves of the store already hold.
 *
 * The store derives a catalogue entry's members when it finalizes the version,
 * and the editor derives the installed copy's members from the host's listing
 * rows. Both read the same rule here, so a member's id and name cannot differ
 * between the catalogue and the copy that was installed from it — the
 * editor-theme member id, in particular, is the document's validated name,
 * because an editor theme's document carries no id.
 *
 * Pure and argument-driven: no reader, no host row and no package type crosses
 * this boundary, so `renderer-core` stays free of Fabric, the DOM and every
 * consumer's storage shape.
 */

/**
 * The listing kinds whose members are the listing's own named units, and the
 * member kind each derives. `settingsPages` and `assetCategories` are absent
 * because they are settings or picker data, not things a person browses.
 */
const NAMED_MEMBER_KIND = {
  "widget-pack": "widget",
  "path-preset-pack": "shape",
} as const;

/** What a caller already holds for one listing, whichever half it read from. */
export interface ListingMemberInput {
  /** The dashboard theme's document id and the listing's name. */
  readonly theme?: { readonly id: string; readonly name: string };
  /** An editor theme's validated document name; the document carries no id, so
   *  the name is also the member's id. */
  readonly editorThemeName?: unknown;
  /** A widget pack's units or a path preset pack's presets: `{ id, label }`
   *  records, validated here rather than by each caller. */
  readonly named?: unknown;
  /** A plugin's contribution groups. */
  readonly contributions?: PluginMemberContributions;
}

/**
 * The members one listing kind carries.
 *
 * A collection carries none: its included listings are the entry's `includes`,
 * not parts of its own package. A kind this build does not derive answers none
 * rather than inventing a member record for it.
 */
export function listingMemberRecords(
  kind: string,
  input: ListingMemberInput,
): readonly MemberRecord[] {
  if (kind === DASHBOARD_THEME_KIND) {
    const theme = input.theme;
    return theme === undefined
      ? []
      : [{ id: theme.id, kind: DASHBOARD_THEME_KIND, name: theme.name }];
  }
  if (kind === "collection") return [];
  if (kind === "editor-theme") {
    // The document declares no id, so its validated name is the only stable
    // identity the store holds.
    const name = textOf(input.editorThemeName);
    return name === undefined ? [] : [{ id: name, kind, name }];
  }

  const namedKind = memberKindOf(kind);
  if (namedKind !== undefined) return namedRecords(input.named, namedKind);
  if (kind === "plugin") {
    return pluginMemberRecords(input.contributions ?? {});
  }
  return [];
}

function memberKindOf(kind: string): string | undefined {
  return Object.hasOwn(NAMED_MEMBER_KIND, kind)
    ? NAMED_MEMBER_KIND[kind as keyof typeof NAMED_MEMBER_KIND]
    : undefined;
}

/** A widget unit or path preset: `{ id, label }`, with an entry that has no
 *  readable id left out rather than listed under a name nothing declared. */
function namedRecords(value: unknown, kind: string): readonly MemberRecord[] {
  if (!Array.isArray(value)) return [];

  const records: MemberRecord[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Readonly<Record<string, unknown>>;
    const id = textOf(field(record, "id"));
    if (id === undefined) continue;
    records.push({ id, kind, name: textOf(field(record, "label")) ?? id });
  }
  return records;
}

/** A field's own value, never an inherited one: a `__proto__` key in a
 *  package's JSON is data, the habit `catalogue-index.ts` follows. */
function field(
  record: Readonly<Record<string, unknown>>,
  key: string,
): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
