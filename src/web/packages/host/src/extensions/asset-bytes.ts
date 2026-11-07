/**
 * The largest asset byte answer a plugin surface may deliver or receive: a
 * declarative source's artwork fetch, a code source's `asset.bytes` reply and
 * the worker's `network.fetchBytes`. One ceiling, so no surface can hand the
 * host — or ask it for — more than another.
 */
export const MAX_ASSET_BYTES = 32 * 1024 * 1024;
