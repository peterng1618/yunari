/**
 * The largest asset byte answer an extension surface may deliver or receive: a
 * declarative source's artwork fetch, a code source's `asset.bytes` reply and
 * the worker's `network.fetchBytes`. One ceiling, so no surface can hand the
 * host — or ask it for — more than another. It is deliberately distinct from
 * the theme store's 80 MiB `MAX_ASSET_BYTES`, which bounds one scene asset.
 */
export const MAX_EXTENSION_ASSET_BYTES = 32 * 1024 * 1024;
