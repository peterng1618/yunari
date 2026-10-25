import type { LookupFunction } from "node:net";
import {
  Agent,
  type RequestInit as UndiciRequestInit,
  fetch as undiciFetch,
} from "undici";
import {
  checkedAddressesFor,
  dnsLookup,
  type HostLookup,
  isBlockedAddress,
  type ResolvedAddress,
} from "./fetch-source.js";

/**
 * A fetch whose socket reaches the address the policy already checked. Without
 * it the policy resolves once and the connection resolves again, and a second
 * DNS answer is the rebinding window (decision 0116).
 */

export interface PinnedFetchOptions {
  /** Resolution for a hostname the policy never checked. Tests inject it. */
  readonly lookup?: HostLookup;
}

function connectLookup(resolve: HostLookup): LookupFunction {
  const answer = (
    entries: readonly ResolvedAddress[],
    all: boolean,
    callback: Parameters<LookupFunction>[2],
  ): void => {
    const allowed = entries.filter((entry) => !isBlockedAddress(entry.address));
    if (allowed.length === 0) {
      callback(
        new Error("the source resolves to a link-local or metadata address"),
        "",
        0,
      );
      return;
    }

    if (all) {
      callback(null, [...allowed]);
      return;
    }
    const first = allowed[0];
    if (first === undefined) {
      callback(new Error("the source host has no address"), "", 0);
      return;
    }
    callback(null, first.address, first.family);
  };

  return (hostname, options, callback) => {
    const recorded = checkedAddressesFor(hostname);
    if (recorded !== undefined) {
      answer(recorded, options.all === true, callback);
      return;
    }
    // Nothing was checked for this host: resolve once, and still refuse the
    // ranges no source may ever reach.
    resolve(hostname).then(
      (entries) => answer(entries, options.all === true, callback),
      (error: unknown) => {
        callback(
          error instanceof Error
            ? error
            : new Error("the source host could not be resolved"),
          "",
          0,
        );
      },
    );
  };
}

export function createPinnedFetch(
  options: PinnedFetchOptions = {},
): typeof fetch {
  const dispatcher = new Agent({
    connect: { lookup: connectLookup(options.lookup ?? dnsLookup) },
  });

  const pinned = (
    input: string | URL,
    init?: UndiciRequestInit,
  ): Promise<Response> =>
    undiciFetch(input, { ...init, dispatcher }) as unknown as Promise<Response>;

  return pinned as unknown as typeof fetch;
}
