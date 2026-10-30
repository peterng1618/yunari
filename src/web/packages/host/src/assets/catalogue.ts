/**
 * What every catalogue adapter shares: one page size, and the one spelling of
 * an opaque hex colour. A source that paged differently would page the finder
 * differently, and a source with its own predicate could accept a colour the
 * renderer refuses.
 */
export const CATALOGUE_PAGE_SIZE = 40;

export const HEX_COLOUR = /^#[0-9a-f]{6}$/i;
