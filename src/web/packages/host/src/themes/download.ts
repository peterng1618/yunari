import { CATALOGUE_ORIGIN } from "@yunari/renderer-core";
import { MAX_ARCHIVE_BYTES } from "@yunari/theme-package";

/**
 * Fetches one catalogue package. The address is data from a remote document,
 * so this is where the trust boundary is held: https only, the store's own
 * host, no redirect, and the reader's own cap enforced while the body streams.
 * The bytes then go to the owners that already exist (`importThemePackage`,
 * `ThemeStore`, `ThemeOriginsStore`); this module writes nothing.
 */

export interface DownloadOptions {
  /** Injected so a unit test drives this without a network. */
  readonly fetch?: typeof fetch;
  /** Aborts the read when the store's own patience runs out. */
  readonly timeoutMs?: number;
}

export type DownloadResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | {
      readonly ok: false;
      readonly message: string;
      /** `address` is the caller's data (a scheme or host no catalogue can
       *  produce) and belongs to a 400; `download` is the remote end failing. */
      readonly stage: "address" | "download";
    };

/** The one host the store serves packages from, derived from the same origin
 *  every URL builder reads. */
const ALLOWED_HOST = new URL(CATALOGUE_ORIGIN).hostname.toLowerCase();

/**
 * Two minutes: the reader's 64 MiB cap at a slow line is a legitimate package,
 * not a stuck one. A 25 MiB item on a 3 Mbps link takes about 67 s, so a 60 s
 * default would refuse a download that was still arriving.
 */
export const DEFAULT_TIMEOUT_MS = 120_000;

/** The Worker serves a package directly, so any redirect is a hop this module
 *  did not ask for and refuses below. */

export async function downloadPackage(
  url: string,
  options?: DownloadOptions,
): Promise<DownloadResult> {
  const target = parseUrl(url);
  if (target === undefined)
    return refuseAddress("That is not a URL a catalogue can produce.");
  if (target.protocol !== "https:")
    return refuseAddress("A catalogue package must be downloaded over https.");
  if (!isCatalogueHost(target))
    return refuseAddress("That host cannot serve a catalogue package.");

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    return refuseDownload(
      "A download timeout must be a positive number of milliseconds.",
    );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // The signal aborts the network; this races the *reading* too, so a body that
  // stops arriving cannot leave the caller waiting on a reader that will never
  // settle.
  const timedOut = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener(
      "abort",
      () => reject(new Error("The download did not finish in time.")),
      { once: true },
    );
  });

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const running = read(
    target,
    options?.fetch ?? fetch,
    controller.signal,
    (opened) => {
      reader = opened;
    },
  );
  // If the timeout wins the race, this rejection has no other handler.
  running.catch(() => undefined);

  try {
    return await Promise.race([running, timedOut]);
  } catch (error) {
    if (controller.signal.aborted)
      return refuseDownload("The download did not finish in time.");
    return refuseDownload(
      error instanceof Error ? error.message : "The download failed.",
    );
  } finally {
    clearTimeout(timer);
    // Releasing a read that lost the race is also what makes the cap a cap on
    // traffic rather than on the array we eventually build. Awaited so the
    // caller's refusal is not answered while the origin is still sending.
    await reader?.cancel().catch(() => undefined);
  }
}

async function read(
  target: URL,
  fetcher: typeof fetch,
  signal: AbortSignal,
  opened: (reader: ReadableStreamDefaultReader<Uint8Array>) => void,
): Promise<DownloadResult> {
  const response = await fetcher(target.href, { redirect: "manual", signal });

  if (response.status >= 300 && response.status < 400)
    return refuseAndClose(
      response,
      "The catalogue redirected a package the store serves directly.",
    );

  if (!response.ok)
    return refuseAndClose(
      response,
      `The download was refused (HTTP ${response.status}).`,
    );

  // A hint, not enforcement: an origin may omit it or lie, and the counter
  // below is the rule. Checking it first only saves reading a body we already
  // know is too big.
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (Number.isFinite(size) && size > MAX_ARCHIVE_BYTES)
      return refuseAndClose(response, "That package is too large to download.");
  }

  if (response.body === null)
    return refuseDownload("The download answered no package.");

  const reader = response.body.getReader();
  opened(reader);
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_ARCHIVE_BYTES)
      return refuseDownload("That package is too large to download.");
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

/** A parsed URL, or nothing. Kept separate from the allowlist so a bad scheme
 *  and a bad host get different sentences. */
function parseUrl(raw: string): URL | undefined {
  try {
    return new URL(raw);
  } catch {
    return undefined;
  }
}

/** The hostname is compared after parsing, so `yunari-store.workers.dev.evil.example`
 *  and a userinfo prefix both fail. */
function isCatalogueHost(url: URL): boolean {
  return (
    url.protocol === "https:" && url.hostname.toLowerCase() === ALLOWED_HOST
  );
}

function refuseDownload(message: string): DownloadResult {
  return { ok: false, stage: "download", message };
}

function refuseAddress(message: string): DownloadResult {
  return { ok: false, stage: "address", message };
}

/** A refusal before the reader exists: closing here is the only thing that
 *  releases the connection, because the caller's `finally` has no reader to
 *  cancel and the timer is already cleared. */
async function refuseAndClose(
  response: Response,
  message: string,
): Promise<DownloadResult> {
  await response.body?.cancel().catch(() => undefined);
  return refuseDownload(message);
}
