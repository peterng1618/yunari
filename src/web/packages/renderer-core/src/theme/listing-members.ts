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
 * The members one listing kind carries, with the refusal arm its input needs.
 *
 * An empty list alone cannot say whether a listing carries no members or the
 * input could not be read, so `unreadable` marks the second fact. A collection,
 * and a kind this build does not derive, carries none: both answer an empty
 * list with `unreadable: false` rather than inventing a member record.
 */
export interface ListingMembers extends ReadonlyArray<MemberRecord> {
  /** True when a present input could not be read: the caller held something
   *  that names members, not a listing that carries none. The list is empty,
   *  because a partly readable package is refused rather than half-listed. */
  readonly unreadable: boolean;
}

/** A member list tagged with the read's outcome. */
function members(
  records: readonly MemberRecord[],
  unreadable = false,
): ListingMembers {
  return Object.assign([...records], { unreadable });
}

export function listingMemberRecords(
  kind: string,
  input: ListingMemberInput,
): ListingMembers {
  if (kind === DASHBOARD_THEME_KIND) {
    const theme = input.theme;
    return theme === undefined
      ? members([], true)
      : members([
          { id: theme.id, kind: DASHBOARD_THEME_KIND, name: theme.name },
        ]);
  }
  if (kind === "collection") return members([]);
  if (kind === "editor-theme") {
    // The document declares no id, so its validated name is the only stable
    // identity the store holds.
    const name = textOf(input.editorThemeName);
    return name === undefined
      ? members([], true)
      : members([{ id: name, kind, name }]);
  }

  const namedKind = memberKindOf(kind);
  if (namedKind !== undefined) return namedRecords(input.named, namedKind);
  if (kind === "plugin") {
    return members(pluginMemberRecords(input.contributions ?? {}));
  }
  return members([]);
}

function memberKindOf(kind: string): string | undefined {
  return Object.hasOwn(NAMED_MEMBER_KIND, kind)
    ? NAMED_MEMBER_KIND[kind as keyof typeof NAMED_MEMBER_KIND]
    : undefined;
}

/** A widget unit or path preset: `{ id, label }`. Input that is not a list, or
 *  any entry without a non-empty id, is unreadable rather than a shorter list:
 *  dropping a record would list a package as carrying members it declared and
 *  the reader could not name. */
function namedRecords(value: unknown, kind: string): ListingMembers {
  if (!Array.isArray(value)) return members([], true);

  const records: MemberRecord[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) return members([], true);
    const record = entry as Readonly<Record<string, unknown>>;
    const id = textOf(field(record, "id"));
    if (id === undefined) return members([], true);
    records.push({ id, kind, name: textOf(field(record, "label")) ?? id });
  }
  return members(records);
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
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}
