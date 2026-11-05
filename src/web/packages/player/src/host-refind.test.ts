import { describe, expect, it } from "vitest";
import {
  type PairedHost,
  readStoredPairing,
  refindHost,
  refindTarget,
  storePairing,
  sweepAddresses,
} from "./host-refind.js";

const pairing: PairedHost = {
  hostId: "h1",
  hostName: "study-pc",
  port: 5227,
  token: "abc",
  lastAddress: "192.168.1.10",
};

describe("refindHost", () => {
  it("answers the last-known address without sweeping when it still matches", async () => {
    const seen: string[] = [];
    const origin = await refindHost(
      pairing,
      async (o) => {
        seen.push(o);
        return { id: pairing.hostId, name: "study-pc" };
      },
      { scheme: "http" },
    );

    expect(origin).toBe("http://192.168.1.10:5227");
    expect(seen).toEqual(["http://192.168.1.10:5227"]); // no sweep happened
  });

  it("probes the page's own scheme, so an https display re-finds over https", async () => {
    // `originFor` builds every rung at the page's own scheme, so from a page
    // served over https each probe is https and not mixed content. Hard-code
    // the scheme back to `http` and this is the case that reddens.
    const seen: string[] = [];
    const found = await refindHost(
      pairing,
      async (origin) => {
        seen.push(origin);
        return origin === "https://192.168.1.44:5227"
          ? { id: pairing.hostId, name: "study-pc" }
          : undefined;
      },
      { scheme: "https" },
    );

    expect(found).toBe("https://192.168.1.44:5227");
    // Every rung carries it, not only the one that matched: the last-known
    // address, then the host's own name, then the sweep.
    expect(seen.slice(0, 2)).toEqual([
      "https://192.168.1.10:5227",
      "https://study-pc.local:5227",
    ]);
    expect(seen.length).toBeGreaterThan(2);
    expect(seen.every((origin) => origin.startsWith("https://"))).toBe(true);
  });

  it("falls through to the sweep and finds the host at its new address", async () => {
    const probe = async (o: string) =>
      o === "http://192.168.1.44:5227"
        ? { id: pairing.hostId, name: "study-pc" }
        : undefined;

    expect(await refindHost(pairing, probe, { scheme: "http" })).toBe(
      "http://192.168.1.44:5227",
    );
  });

  it("never attaches to a different host", async () => {
    // Every address answers a *different* id -> undefined, not the first
    // responder. This is the whole reason an id was stored rather than an
    // address: two hosts on one network must not tangle.
    expect(
      await refindHost(
        pairing,
        async () => ({
          id: "somebody-else",
          name: "other-pc",
        }),
        { scheme: "http" },
      ),
    ).toBeUndefined();
  });

  it("answers nothing when no host answers at all", async () => {
    expect(
      await refindHost(pairing, async () => undefined, { scheme: "http" }),
    ).toBeUndefined();
  });

  it("answers nothing when every probe rejects, as an untrusted origin does", async () => {
    // Review Focus 17: a display whose host moved and whose certificate it does
    // not trust. A fetch to that origin rejects rather than answering, so every
    // rung of the ladder fails that way — and the ladder answers nothing rather
    // than throwing, which leaves the one-time code as the way back.
    const untrusted = async (): Promise<
      { readonly id: string; readonly name: string } | undefined
    > => {
      throw new Error("the certificate is not trusted");
    };

    await expect(
      refindHost(pairing, untrusted, { scheme: "http" }),
    ).resolves.toBeUndefined();
  });

  it("sweeps its own /24 and not the address it already tried", () => {
    const addresses = sweepAddresses("192.168.1.10");
    // 254 usable hosts, less the one the ladder already tried. `.0` and `.255`
    // are asserted absent because they are why it is 253 and not 255.
    expect(addresses).toHaveLength(253);
    expect(addresses).not.toContain("192.168.1.10");
    expect(addresses).not.toContain("192.168.1.0");
    expect(addresses).not.toContain("192.168.1.255");
    expect(addresses).toContain("192.168.1.1");
    expect(addresses).toContain("192.168.1.254");
  });

  it("sweeps nothing for an address that is not a dotted quad", () => {
    // A display served under a name has no /24 to sweep, and guessing one from
    // `study-pc.local` would probe a range nobody asked for.
    expect(sweepAddresses("study-pc.local")).toEqual([]);
    expect(sweepAddresses("192.168.1")).toEqual([]);
  });

  it("keeps a bound on how many probes are in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const probe = async () => {
      peak = Math.max(peak, (inFlight += 1));
      await Promise.resolve();
      inFlight -= 1;
      return undefined;
    };

    await refindHost(pairing, probe, { scheme: "http", concurrency: 8 });

    expect(peak).toBeLessThanOrEqual(8);
    // A sweep that never ran would also pass the bound above, so the case has
    // to see the sweep itself.
    expect(peak).toBeGreaterThan(1);
  });

  it("hands the probe a bare origin, with nothing appended to it", async () => {
    // The probe is the only thing that fetches, so a credential can reach a
    // swept address in exactly one way: if the sweep is routed through
    // `session.withToken`/`session.fetch`, the origin arrives carrying
    // `?session=`. `/api/host` needs none, and a swept address has no business
    // seeing one.
    const seen: string[] = [];

    await refindHost(
      pairing,
      async (origin) => {
        seen.push(origin);
        return undefined;
      },
      { scheme: "http", concurrency: 4 },
    );

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((o) => !o.includes("session"))).toBe(true);
  });
});

describe("refindTarget", () => {
  it("builds the URL to move to, and carries nothing the host will resolve itself", () => {
    expect(refindTarget("http://192.168.1.44:5227", "abc")).toBe(
      "http://192.168.1.44:5227/?session=abc",
    );
    // A loopback display has no credential, so the query is omitted entirely.
    expect(refindTarget("http://127.0.0.1:5227", undefined)).toBe(
      "http://127.0.0.1:5227/",
    );
  });
});

describe("the stored pairing", () => {
  /** The browser's own `Storage`, without a browser: what matters here is the
   *  record's shape, not the store behind it. */
  function memoryStorage(): Storage {
    const entries = new Map<string, string>();

    return {
      get length() {
        return entries.size;
      },
      clear: () => entries.clear(),
      getItem: (key) => entries.get(key) ?? null,
      key: (index) => [...entries.keys()][index] ?? null,
      removeItem: (key) => void entries.delete(key),
      setItem: (key, value) => void entries.set(key, value),
    };
  }

  it("keeps what it was given, and answers nothing for what it was not", () => {
    const storage = memoryStorage();

    expect(readStoredPairing(storage)).toBeUndefined();
    storePairing(storage, pairing);
    expect(readStoredPairing(storage)).toEqual(pairing);

    // A record from another build, or half a write: not a pairing, and never a
    // throw at boot.
    storage.setItem("yunari.display.pairing", "{not json");
    expect(readStoredPairing(storage)).toBeUndefined();
    storage.setItem("yunari.display.pairing", JSON.stringify({ hostId: "h1" }));
    expect(readStoredPairing(storage)).toBeUndefined();
    // And a record with every field but no identity: nothing answers a blank
    // `hostId`, so it is not a pairing and must not read as one (R72).
    storage.setItem(
      "yunari.display.pairing",
      JSON.stringify({ ...pairing, hostId: "" }),
    );
    expect(readStoredPairing(storage)).toBeUndefined();
  });

  it("answers nothing when the storage itself refuses", () => {
    const refusing: Storage = {
      length: 0,
      clear: () => undefined,
      getItem: () => {
        throw new Error("denied");
      },
      key: () => null,
      removeItem: () => undefined,
      setItem: () => {
        throw new Error("denied");
      },
    };

    expect(readStoredPairing(refusing)).toBeUndefined();
    expect(() => storePairing(refusing, pairing)).not.toThrow();
  });
});
