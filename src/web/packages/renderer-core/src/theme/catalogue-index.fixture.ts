/** The catalogue wire's fixtures, shared by the parser tests beside this file:
 *  one well-formed entry and the parts a case varies. */

/** The kinds this build ships; a `widget-preset` is a kind the catalogue may
    hold and this client cannot read. */
export const KNOWN = ["dashboard-theme"];

/** A catalogue id: the UUID every `includes` value must be. */
export const INCLUDED_ID = "3f2a1c9e-8b7d-4c6a-9e0f-1a2b3c4d5e6f";
export const OTHER_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

/** `count` distinct include records, for the bound's edge. */
export function includeIds(
  count: number,
): { readonly id: string; readonly optional: boolean }[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    optional: false,
  }));
}

/** One include record; the flag defaults to required, as the wire requires it. */
export function include(
  id: string,
  optional = false,
): { readonly id: string; readonly optional: boolean } {
  return { id, optional };
}

/** The record the Action derives: every field a reader touches, which is the
    shallow check the parser makes and nothing more. */
export function facets(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    author: "ada",
    colourMode: "dark",
    sensors: [],
    tags: ["ops"],
    orientation: "landscape",
    aspect: "16:9",
    width: 1920,
    height: 1080,
    ...overrides,
  };
}

/** One wire entry, every field well-formed; a case states only the part it is
    about. */
export function entry(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "acme-ops",
    kind: "dashboard-theme",
    name: "Acme Ops",
    version: "1.0.0",
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-02T00:00:00Z",
    downloads: 12,
    favorites: 3,
    packageUrl: "https://example.test/acme-ops.json",
    thumbnail: "themes/acme-ops.png",
    facets: facets(),
    members: [],
    ...overrides,
  };
}

/** One well-formed credit; a case states only the part it is about. */
export function remixOf(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    catalogueId: "3f2a1c9e-8b7d-4c6a-9e0f-1a2b3c4d5e6f",
    name: "Aurora",
    version: "1.2.0",
    ...overrides,
  };
}

/** The entry `entry()` builds with a field actually absent, not present-and-empty. */
export function without(
  field: string,
  overrides: Record<string, unknown> = {},
) {
  const value = entry(overrides);
  delete value[field];
  return value;
}

/** The brief's "one entry missing `name`": it declares no `kind` either, which is
    why its refusal names nothing. An entry that is the wrong shape *and* declares
    a kind is named by that kind — the case below. */
export function unreadable(id: string): Record<string, unknown> {
  const value = entry({ id });
  delete value.kind;
  delete value.name;
  return value;
}

/** The fields `asEntry` holds for presence: each omitted-field case must fail
    when its own check is removed. */
export const REQUIRED_ENTRY_FIELDS = [
  "members",
  "version",
  "createdAt",
  "updatedAt",
  "packageUrl",
  "thumbnail",
  "favorites",
] as const;

export function document(entries: readonly unknown[]): Record<string, unknown> {
  return { generatedAt: "2026-10-21T00:00:00Z", entries: [...entries] };
}
