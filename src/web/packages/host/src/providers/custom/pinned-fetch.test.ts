import { describe, expect, it } from "vitest";
import { listen, sourceOf } from "./fetch-source.fixture.js";
import {
  fetchSource,
  type HostLookup,
  type ResolvedAddress,
} from "./fetch-source.js";
import { createPinnedFetch } from "./pinned-fetch.js";

/**
 * The connection must reach the address the policy checked. A hostname that
 * answers once for the check and again for the socket is the rebinding window;
 * every case here counts resolutions so a second one cannot pass silently.
 */

function lookupOf(answers: readonly (readonly ResolvedAddress[])[]): {
  lookup: HostLookup;
  hosts: string[];
} {
  const hosts: string[] = [];
  const lookup: HostLookup = async (host) => {
    hosts.push(host);
    return answers[Math.min(hosts.length - 1, answers.length - 1)] ?? [];
  };
  return { lookup, hosts };
}

async function jsonServer(): Promise<{
  origin: string;
  close: () => Promise<void>;
}> {
  return listen((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true }));
  });
}

describe("createPinnedFetch", () => {
  it("connects to the address the policy checked, not a second answer", async () => {
    const server = await jsonServer();
    try {
      const port = new URL(server.origin).port;
      // The second answer is a different loopback host: if the connection
      // resolves again, nothing is listening there and the fetch fails.
      const { lookup, hosts } = lookupOf([
        [{ address: "127.0.0.1", family: 4 }],
        [{ address: "127.0.0.2", family: 4 }],
      ]);

      const outcome = await fetchSource(
        sourceOf({ url: `http://rebind.example:${port}/data` }),
        undefined,
        createPinnedFetch({ lookup }),
        () => 0,
        lookup,
      );

      expect(outcome).toEqual({ ok: true, body: { ok: true }, elapsedMs: 0 });
      expect(hosts).toEqual(["rebind.example"]);
    } finally {
      await server.close();
    }
  });

  it("connects to an IP literal without resolving", async () => {
    const server = await jsonServer();
    try {
      const lookup: HostLookup = async () => {
        throw new Error("a literal must not resolve");
      };

      const outcome = await fetchSource(
        sourceOf({ url: `${server.origin}/data` }),
        undefined,
        createPinnedFetch({ lookup }),
        () => 0,
        lookup,
      );

      expect(outcome.ok).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("resolves once when the policy recorded no answer", async () => {
    const server = await jsonServer();
    try {
      const port = new URL(server.origin).port;
      const { lookup, hosts } = lookupOf([
        [{ address: "127.0.0.1", family: 4 }],
      ]);

      const response = await createPinnedFetch({ lookup })(
        `http://unpinned.example:${port}/data`,
      );

      expect(response.status).toBe(200);
      await response.body?.cancel();
      expect(hosts).toEqual(["unpinned.example"]);
    } finally {
      await server.close();
    }
  });

  it("refuses a fallback answer naming a metadata address", async () => {
    const { lookup, hosts } = lookupOf([
      [{ address: "169.254.169.254", family: 4 }],
    ]);

    await expect(
      createPinnedFetch({ lookup })("http://metadata.example/latest"),
    ).rejects.toThrow();
    expect(hosts).toEqual(["metadata.example"]);
  });
});
