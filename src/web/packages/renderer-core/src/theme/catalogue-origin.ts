import type { StoreItemKind } from "./catalogue-index.js";

/**
 * Where one installed catalogue item came from, as the host records it beside
 * the library it installed into, and as the editor reads it back over its
 * listings.
 *
 * "Installed" is a fact about this machine's copy, not about the catalogue
 * item: the item is the same for everyone, while this record exists only where
 * someone installed it. The host writes it and the editor reads it, so the shape
 * lives in the layer both import rather than in two declarations a rename can
 * drive apart while both typecheck.
 */
export interface CatalogueOrigin {
  /** The listing kind this copy is: a theme, a pack, a plugin or a collection
   *  member's own kind. */
  readonly kind: StoreItemKind;
  /** The catalogue's own id for the item, not the library id. */
  readonly catalogueId: string;
  /** The catalogue version this copy was installed from. */
  readonly version: string;
  /** An ISO instant. */
  readonly installedAt: string;
  /** The collections an install through one recorded, kept so a collection
   *  diff can name what this copy arrived with. */
  readonly collections?: readonly string[];
}
