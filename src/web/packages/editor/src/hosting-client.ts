/**
 * What this host offers a phone, asked from the editor.
 *
 * Everything here answers `undefined` rather than throwing: the editor is
 * routinely served by a build with no host behind it, and a header that cannot
 * say where the phone should go must render nothing — not an error the author
 * cannot act on, and never an address the editor invented.
 *
 * **Nothing here subscribes to the host.** Every call below is one `fetch`
 * request and one answer — `readHosting`, `readPairingCode`, `setLan` — so a
 * hosting change made outside the editor is invisible until something asks
 * again, and the store that owns the answer says what that costs (`vg-214`,
 * `HostingStore`). The host's only stream *to* the editor is the sample stream
 * at `/ws`, which carries telemetry batches and is open only in live mode — so a
 * hosting announcement would ride it where it is open rather than a channel this
 * layer opens, and the editor never polls.
 */

export interface HostingAnswer {
  readonly lan: boolean;
  readonly address: string | null;
  /** The host's mDNS name, which is what a pairing symbol dials: it survives a
   *  DHCP lease where the address does not (`docs/decisions/0132`). `null` when
   *  the host has no name to offer, and then `address` is all there is. */
  readonly name: string | null;
  readonly port: number | null;
  /** The last move the host refused, in its own words, or null. A refusal
   *  cannot come back in the answer to the PUT that asked for the move — the
   *  host cannot rebind while that answer is on its socket — so this is where
   *  one is read from, on the read that follows. */
  readonly refusal: string | null;
}

const isString = (value: unknown): value is string => typeof value === "string";

export async function readHosting(
  fetcher: typeof fetch = fetch,
): Promise<HostingAnswer | undefined> {
  try {
    const response = await fetcher("/api/hosting");
    if (!response.ok) return undefined;

    const body = (await response.json()) as Record<string, unknown>;
    if (typeof body["lan"] !== "boolean") return undefined;
    if (body["address"] !== null && !isString(body["address"]))
      return undefined;
    if (body["port"] !== null && typeof body["port"] !== "number")
      return undefined;

    return {
      lan: body["lan"],
      address: body["address"] === null ? null : (body["address"] as string),
      // A host from before this field answered none, and the reader falls back
      // to the address rather than showing a name nobody published.
      name: isString(body["name"]) ? body["name"] : null,
      port: body["port"] === null ? null : (body["port"] as number),
      // A host that says nothing about a refusal has not refused anything this
      // reader can act on, so it reads as none rather than as unreadable.
      refusal: isString(body["refusal"]) ? body["refusal"] : null,
    };
  } catch {
    return undefined;
  }
}

/** How long the read that follows a move keeps trying. The port is closed and
 *  reopened across a move, so a read that lands in that window is refused by
 *  the operating system rather than answered by the host — measured at 4 ms for
 *  the rebind, with this a wide margin. **Bounded on purpose: an unbounded
 *  retry is a hang**, and a host that is genuinely gone should say so. */
const SETTLE_ATTEMPTS = 10;
const SETTLE_PAUSE_MS = 40;

async function readSettled(
  fetcher: typeof fetch,
): Promise<HostingAnswer | undefined> {
  for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt += 1) {
    const answer = await readHosting(fetcher);
    if (answer !== undefined) return answer;

    if (attempt < SETTLE_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, SETTLE_PAUSE_MS));
    }
  }

  return undefined;
}

/** The one-time code a display types at `/pair`, and when it stops being the
 *  answer. Read and never minted: the window is the host's, and its expiry is
 *  the host's to decide. */
export interface PairingCode {
  readonly code: string;
  readonly expiresAt: string;
}

/** Reads the code the host is showing.
 *
 *  A **read and not a mint**: the host makes a code only when it has none live,
 *  so reading the same window twice answers the same six characters — which is
 *  what a card that redraws, or a second reader asking after the first, needs.
 *  The route is loopback-only, which is where the editor is. */
export async function readPairingCode(
  fetcher: typeof fetch = fetch,
): Promise<PairingCode | undefined> {
  try {
    const response = await fetcher("/api/pairing/code");
    if (!response.ok) return undefined;

    const body = (await response.json()) as {
      code?: unknown;
      expiresAt?: unknown;
    };
    if (!isString(body.code) || !isString(body.expiresAt)) return undefined;

    return { code: body.code, expiresAt: body.expiresAt };
  } catch {
    return undefined;
  }
}

/** Asks the host to serve the LAN, or to stop. The host owns the binding, so a
 *  refusal comes back in its words — the editor has no way to know which
 *  interface refused or why, and a message composed here would be a guess.
 *
 *  **A 200 means the host accepted the request, not that it moved.** It answers
 *  first and moves afterwards, because it cannot rebind while its answer is
 *  still on the socket. So where it landed — and a refusal, if it made one — is
 *  read from the host after the move has settled. */
export async function setLan(
  on: boolean,
  fetcher: typeof fetch = fetch,
): Promise<
  { ok: true; answer: HostingAnswer } | { ok: false; reason: string }
> {
  try {
    const response = await fetcher("/api/hosting", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lan: on }),
    });

    if (!response.ok) {
      // The host's own words: it is the only thing that knows why a socket
      // refused, and a message composed here would be a guess shown as a fact.
      return { ok: false, reason: (await response.text()).trim() };
    }

    const answer = await readSettled(fetcher);
    return answer === undefined
      ? { ok: false, reason: "The host answered with something unreadable." }
      : { ok: true, answer };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** The URL the QR carries: the page a display with no camera opens, with the
 *  code it would otherwise have to type already in it. A code and not a
 *  credential, so the URL is worth reading over a shoulder exactly once.
 *
 *  **`host` is the stable name when the host has one**, and that choice is what
 *  makes a pairing survive a DHCP lease: the credential and the storage a
 *  display keeps are scoped to this origin, so dialling a dotted quad is what
 *  turns a moved address into a phone that must pair again
 *  (`docs/decisions/0132`). The caller decides the host, because it also prints
 *  the address beside this symbol for a device that cannot resolve the name.
 *
 *  **https, because a display is a secure context only there** — that is what
 *  the wake lock and arbitrary-element fullscreen are gated on, and the host
 *  serves it on this same port from its own root (`docs/decisions/0076`). A
 *  device that has not installed the root is warned and carries on; the plain
 *  address is printed beside this one for it. */
export function displayUrl(host: string, port: number, code: string): string {
  return `https://${host}:${port}/pair?code=${encodeURIComponent(code)}`;
}
