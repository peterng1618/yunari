/**
 * A theme's display name as a library id.
 *
 * The host's own rule, moved out of its import path so the editor's **Save as**
 * derives the same id an imported package of that name would land under. The
 * name is lowercased, runs of anything else collapse to one hyphen and the ends
 * are trimmed — the shape `STABLE_ID_PATTERN` accepts. The length stops short of
 * that pattern's 64 so a caller can suffix a taken id and stay in shape.
 *
 * An empty answer is a name this shape has no letters for; the caller owns the
 * fallback, because an import and a save-as need not choose the same one.
 */
const MAX_SLUG = 56;

export function themeIdFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/-+$/, "");
}
