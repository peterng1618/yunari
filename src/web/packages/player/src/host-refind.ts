/**
 * Finding the host again after its address changes.
 *
 * A home LAN is DHCP, so a host's address moves and the URL a display saved
 * dies with it; the port never does (`cli/hosting.ts`). The display kept an
 * identity rather than an address, so the re-find is a match and not a guess:
 * the last-known address, then the host's own name, then the last address's
 * /24. The first match wins, and a host that answers a different id is not a
 * match — two hosts on one network is the case a first-responder rule tangles.
 *
 * **It runs from a page that is already loaded, and nothing else.** A display
 * that reloads while the host is elsewhere is served the browser's error page,
 * so no routine of ours is there to run: that case needs an app shell, and a
 * paired display over plain http cannot have one. A display whose host moved
 * while it was closed is back to the one-time code.
 */

export interface PairedHost {
  readonly hostId: string;
  readonly hostName: string;
  readonly port: number;
  readonly token: string;
  readonly lastAddress: string;
}

/** What a probe answers: the identity at an address, or nothing. */
export type HostProbe = (
  origin: string,
) => Promise<{ readonly id: string; readonly name: string } | undefined>;

/** Beside the editor's own browser-local keys, and browser-local for the same
 *  reason: which host this display belongs to is this origin's memory.
 *
 *  Exported because a case about **whether a write happened** has to read the
 *  key itself: `readStoredPairing` reads through `isPairedHost`, which refuses a
 *  blank `hostId`, so a writer that reintroduced the blank record would satisfy
 *  such a case by being rejected later (R76). */
export const PAIRING_STORAGE_KEY = "yunari.display.pairing";

/** A probe that never answers is an address with no host on it, and this is what
 *  bounds the ladder: 253 addresses at a browser's own connect timeout is not a
 *  sweep anyone would wait for. */
export const PROBE_TIMEOUT_MS = 1_500;

/** 254 sockets at once is how a display becomes a problem for its own network. */
const DEFAULT_CONCURRENCY = 8;

/** A record without an id is not a pairing: nothing answers a blank `hostId`,
 *  so the ladder could never match it, and reading it as valid is how a blank
 *  record would take the place of a good one (R72). */
function isPairedHost(value: unknown): value is PairedHost {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record["hostId"] === "string" &&
    record["hostId"].length > 0 &&
    typeof record["hostName"] === "string" &&
    typeof record["port"] === "number" &&
    typeof record["token"] === "string" &&
    typeof record["lastAddress"] === "string"
  );
}

/** The pairing this origin holds, or nothing. A record that cannot be parsed,
 *  or that is not the shape this build writes, is a pairing that is not there —
 *  never a throw at boot, where the display has no surface to fix it from. */
export function readStoredPairing(storage: Storage): PairedHost | undefined {
  let raw: string | null;

  try {
    raw = storage.getItem(PAIRING_STORAGE_KEY);
  } catch {
    return undefined;
  }

  if (raw === null) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return isPairedHost(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Writing is best-effort. A storage that refuses leaves the display unpaired,
 *  which is what it was before it paired at all. */
export function storePairing(storage: Storage, pairing: PairedHost): void {
  try {
    storage.setItem(PAIRING_STORAGE_KEY, JSON.stringify(pairing));
  } catch {
    // Quota, or a private window. A display that cannot remember its host is
    // still a display; it is back to the one-time code if the host moves.
  }
}

/** The scheme a display was served over. Both are real: the host serves https
 *  beside http on the same port, and the http address is what a device that has
 * not installed the root certificate opens. */
export type PageScheme = "http" | "https";

/**
 * One probe's origin, at the **page's own** scheme.
 *
 * The scheme is the caller's, from `location.protocol`, and it is not optional:
 * a probe built as `http://` from a page served over https is mixed content the
 * browser blocks, so every rung of the ladder fails and a display can never
 * re-find its host (`vg-623`). A default here would reintroduce exactly that.
 */
export function originFor(
  address: string,
  port: number,
  scheme: PageScheme,
): string {
  return `${scheme}://${address}:${port}`;
}

/**
 * Where the page moves to once a host is found: the origin, at `/`, carrying
 * this display's own credential and nothing the host resolves itself.
 *
 * No `theme` and no `theme-source`: the host's root route resolves for the
 * asking display and answers `theme-source=map` itself. The token goes only to
 * an origin that answered the stored id, and the ladder's refusal of a first
 * responder is what makes that safe. A loopback display has no credential, so
 * the query is omitted entirely.
 */
export function refindTarget(
  origin: string,
  token: string | undefined,
): string {
  return token === undefined
    ? `${origin}/`
    : `${origin}/?session=${encodeURIComponent(token)}`;
}

/**
 * The /24 the address sits on, minus the address itself.
 *
 * Usable hosts only: `.0` and `.255` are the network and the broadcast, which
 * is *why* this is 253 entries and not 255. The address is left out because the
 * ladder already tried it.
 */
export function sweepAddresses(address: string): readonly string[] {
  const octets = address.split(".");
  const [first, second, third] = octets;

  if (
    octets.length !== 4 ||
    first === undefined ||
    second === undefined ||
    third === undefined ||
    !octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  ) {
    return [];
  }

  const addresses: string[] = [];

  for (let host = 1; host <= 254; host += 1) {
    const candidate = `${first}.${second}.${third}.${host}`;

    if (candidate !== address) {
      addresses.push(candidate);
    }
  }

  return addresses;
}

/** One probe, with the ladder's own bound on it. The race is what keeps a
 *  probe that never settles from holding a worker forever; a caller that also
 *  aborts its fetch is what closes the socket. */
async function askHost(
  probe: HostProbe,
  origin: string,
): Promise<{ readonly id: string; readonly name: string } | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      probe(origin),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), PROBE_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // An address that does not answer is an address with no host on it.
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function hostAnswers(
  origin: string,
  hostId: string,
  probe: HostProbe,
): Promise<boolean> {
  return (await askHost(probe, origin))?.id === hostId;
}

/**
 * The ladder: the last address, then the name, then the last address's /24.
 *
 * A probe that answers a different id is not a match and does not end the
 * search — that refusal is the whole point of having stored an id.
 *
 * `scheme` is the page's own (`PageScheme`), and every rung carries it: a
 * display served over https re-finds over https, and one served over http keeps
 * working unchanged.
 */
export async function refindHost(
  pairing: PairedHost,
  probe: HostProbe,
  options: { readonly scheme: PageScheme; readonly concurrency?: number },
): Promise<string | undefined> {
  const scheme = options.scheme;
  const known = [originFor(pairing.lastAddress, pairing.port, scheme)];

  // An empty name is a pairing that never learned one, and `.local` alone is
  // not a name any host answers to.
  if (pairing.hostName.length > 0) {
    known.push(originFor(`${pairing.hostName}.local`, pairing.port, scheme));
  }

  for (const origin of known) {
    if (await hostAnswers(origin, pairing.hostId, probe)) {
      return origin;
    }
  }

  const swept = sweepAddresses(pairing.lastAddress).map((address) =>
    originFor(address, pairing.port, scheme),
  );
  const workers = Math.max(
    1,
    Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, swept.length),
  );
  let next = 0;
  let found: string | undefined;

  const sweep = async (): Promise<void> => {
    while (found === undefined) {
      const origin = swept[next];
      next += 1;

      if (origin === undefined) {
        return;
      }

      if (await hostAnswers(origin, pairing.hostId, probe)) {
        found = origin;
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: workers }, sweep));

  return found;
}
