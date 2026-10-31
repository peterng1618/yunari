import { networkInterfaces } from "node:os";

/**
 * The first non-internal IPv4 address this machine answers on.
 *
 * The host's own ranking is `rankLanAddresses` in `packages/host/src/cli/net.ts`;
 * the e2e suite sits outside every package, so it cannot import it with types.
 * This is the copy the browser specs share, and the note is here so the ranking
 * has one place to change when the host's rule does.
 */
export function lanAddress(): string | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal)
        return address.address;
    }
  }
  return undefined;
}

/** The same address for a spec that cannot run without one. */
export function requiredLanAddress(): string {
  const address = lanAddress();
  if (address === undefined) throw new Error("no LAN address on this machine");
  return address;
}
