/**
 * The two actions above the asset list are one control in two words: same
 * height, accent boundary and centred glyph-and-label pair, so neither can sit
 * a pixel off the other.
 */
export const ASSET_HEADER_BUTTON =
  "inline-flex h-[26px] min-w-0 flex-1 items-center justify-center gap-[var(--space-4)] overflow-hidden rounded-[var(--radius-md)] border border-accent px-[var(--space-10)] text-sm text-accent hover:border-muted hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent active:bg-[var(--panel-2)] [&>svg]:shrink-0";
