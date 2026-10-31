/**
 * Where a stored library theme came from, as the host records it and the editor
 * reads it back over `/api/themes`.
 *
 * "Installed" is a fact about this machine's copy, not about the catalogue
 * item: the item is the same for everyone, while this record exists only where
 * someone installed it. The host owns the record and the editor owns no host
 * dependency, so the shape lives here — one declaration both sides import
 * rather than two that a rename can drive apart while both typecheck.
 */
export interface ThemeOrigin {
  /** The catalogue's own id for the item, not the library id. */
  readonly catalogueId: string;
  /** The catalogue version this copy was installed from. */
  readonly version: string;
  /** An ISO instant. */
  readonly installedAt: string;
}
