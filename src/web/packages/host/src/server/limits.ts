import { MAX_ASSET_BYTES, MAX_THEME_WIRE_BYTES } from "../themes/store.js";

/** Where a display downloads the root it has to trust.
 *
 *  **Deliberately outside every check the router makes below**: the device
 *  fetching this has not been paired yet, and is looking at a browser
 *  certificate warning while it does — a session and a trusted certificate are
 *  precisely what it cannot present. The root is public by construction; its
 *  key is never served and never leaves this machine. */
export const CA_CERTIFICATE_PATH = "/yunari-ca.crt";

export const DEFAULT_SAMPLE_INTERVAL_MS = 1000;

/** What one stream request may ask for, and how many streams may be open: the
 *  ceiling a request can reach rather than a budget the player works within. */
export const MAX_STREAM_KEYS = 64;
export const MAX_STREAM_KEY_BYTES = 128;
export const MAX_STREAM_CONNECTIONS = 64;
export const MAX_STREAM_CONNECTIONS_PER_DISPLAY = 8;

/** The whole-theme upload ceiling, derived by the store from every decoded
 *  bound it enforces: a save is JSON with base64 assets, so the wire is a third
 *  larger than the assets plus the document and credits caps. A theme the store
 *  can persist is therefore never refused by the transport first. */
export const MAX_THEME_UPLOAD_BYTES = MAX_THEME_WIRE_BYTES;
/** A source video or `.mpkg` is normalized after it arrives, so the author may
 *  bring a file larger than the theme it becomes. This is the source ceiling;
 *  the normalized output must fit the store's `MAX_ASSET_BYTES` instead. */
export const MAX_VIDEO_SOURCE_BYTES = 512 * 1024 * 1024;
/** The one sentence both video import routes answer over the store's per-asset
 *  bound. The save route's body ceiling is derived from that same bound. */
export const VIDEO_OVER_ASSET_BOUND = `That video is larger than the ${
  MAX_ASSET_BYTES / (1024 * 1024)
} MB one theme asset may carry; re-encode it and try again.`;
/** A dashboard screenshot; the store enforces the same bound. */
export const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
/** A widget package is a zip posted whole; the reader only sees bytes that are
 *  already in memory, so the transport refuses one over this first. */
export const MAX_WIDGET_PACK_BYTES = 64 * 1024 * 1024;
