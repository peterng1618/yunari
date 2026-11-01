/**
 * The templates the product ships, as the host's pages see them.
 *
 * A template is not a saved theme: it has no file in the themes directory, so
 * there is nothing to delete, nothing to count among the author's own, and
 * nothing for the player to fetch. The editor holds the composition behind each
 * id and opens it from its own library; the host holds the *catalogue*, because
 * the host is what a consumer's browser asks and the editor's bundle is not
 * loadable from Node.
 *
 * That is a second place the id and name are written, and it is deliberate:
 * importing the editor here would drag React and Fabric into a Node process
 * whose one rule is that it adds no runtime dependency. The two lists must
 * agree, and nothing enforces that across packages yet — a template added to
 * the editor's library without a line here is invisible to the chooser, which
 * is the defect this list exists to close.
 *
 * **`ponytail:` what actually makes this safe today, measured 2026-09-29, and
 * what would end it.** The id crosses the boundary in the chooser's link
 * (`/editor/?template=<id>`) but the editor does not resolve it: the boot asks
 * whether a template was requested, not which one, and starts the bundled
 * starter. So a rename here cannot break the editor — it can only leave a label
 * the two surfaces spell differently, which is a copy defect and not a broken
 * link. That is the whole margin, and it is what the second entry spends: a
 * catalogue is a list precisely because it is meant to grow, and the first thing
 * a second template needs is for the id to *mean* something — a boot that can
 * only ever open the one starter has no way to say which. Close it then, and the
 * owner is not a new package: this id is product content, `renderer-core`
 * already carries product content both sides depend on (`MEASUREMENT_SYSTEMS`),
 * and moving one line there adds no edge. Until a second entry exists, closing
 * it buys a package for a label.
 */
interface TemplateEntry {
  readonly id: string;
  readonly name: string;
}

export const SHIPPED_TEMPLATES: readonly TemplateEntry[] = [
  { id: "yunari-starter-template", name: "Starter — System dashboard" },
];
