import type { LookupFunction } from "node:net";
import {
  Agent,
  type RequestInit as UndiciRequestInit,
  fetch as undiciFetch,
} from "undici";
import {
  BLOCKED_ADDRESS_REASON,
  dnsLookup,
  type HostLookup,
  isBlockedAddress,
  PINNED_ADDRESSES,
  type PinnedRequestInit,
  type ResolvedAddress,
} from "./fetch-source.js";

/**
 * A fetch whose socket reaches the address the policy checked for that one
 * request. Pinning is per call: a shared agent or a hostname-keyed map would
 * let one request's answer decide another request's connection.
 */

export interface PinnedFetchOptions {
  /** Resolution for a request carrying no pinned answer. Tests inject it. */
  readonly lookup?: HostLookup;
}

function connectLookup(
  resolve: HostLookup,
  pinned: readonly ResolvedAddress[] | undefined,
): LookupFunction {
  const answer = (
    entries: readonly ResolvedAddress[],
    all: boolean,
    callback: Parameters<LookupFunction>[2],
  ): void => {
    const allowed = entries.filter((entry) => !isBlockedAddress(entry.address));
    if (allowed.length === 0) {
      callback(new Error(BLOCKED_ADDRESS_REASON), "", 0);
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
    if (pinned !== undefined) {
      answer(pinned, options.all === true, callback);
      return;
    }
    // Nothing was checked for this request: resolve once, and still refuse the
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
  const resolve = options.lookup ?? dnsLookup;

  // Narrower than `RequestInfo`: the request builders only pass `string | URL`.
  const pinned = async (
    input: string | URL,
    init?: PinnedRequestInit,
  ): Promise<Response> => {
    const { [PINNED_ADDRESSES]: addresses, ...rest } = init ?? {};
    const dispatcher = new Agent({
      connect: { lookup: connectLookup(resolve, addresses) },
    });
    try {
      return (await undiciFetch(input, {
        ...rest,
        dispatcher,
      } as UndiciRequestInit)) as unknown as Response;
    } finally {
      // Lets an in-flight response finish; only new connections are refused.
      void dispatcher.close();
    }
  };

  return pinned as unknown as typeof fetch;
}
