import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { listen, sourceOf } from "./fetch-source.fixture.js";
import {
  fetchSource,
  type HostLookup,
  PINNED_ADDRESSES,
  type PinnedRequestInit,
  type ResolvedAddress,
} from "./fetch-source.js";
import { createPinnedFetch } from "./pinned-fetch.js";

/**
 * The connection must reach the address the policy checked for that request.
 * A hostname that answers once for the check and again for the socket is the
 * rebinding window; every case here counts resolutions so a second one cannot
 * pass silently.
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

function listenAt(
  address: string,
  handler: RequestListener,
): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, address, () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        origin: `http://${address}:${port}`,
        close: () => {
          server.closeAllConnections();
          return new Promise<void>((done, fail) => {
            server.close((error) =>
              error === undefined ? done() : fail(error),
            );
          });
        },
      });
    });
  });
}

function jsonAt(body: unknown): RequestListener {
  return (_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(body));
  };
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

  it("dials the answer carried by the request, not the resolver's", async () => {
    const server = await jsonServer();
    try {
      const port = new URL(server.origin).port;
      const { lookup, hosts } = lookupOf([
        [{ address: "127.0.0.2", family: 4 }],
      ]);
      const init: PinnedRequestInit = {
        [PINNED_ADDRESSES]: [{ address: "127.0.0.1", family: 4 }],
      };

      const response = await createPinnedFetch({ lookup })(
        `http://pinned.example:${port}/data`,
        init,
      );

      expect(response.status).toBe(200);
      await response.body?.cancel();
      expect(hosts).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("gives two concurrent requests their own pinned answer", async (ctx) => {
    const first = await listenAt("127.0.0.1", jsonAt({ who: "a" }));
    let second: Awaited<ReturnType<typeof listenAt>>;
    try {
      second = await listenAt("127.0.0.2", jsonAt({ who: "b" }));
    } catch (error) {
      await first.close();
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EADDRNOTAVAIL" || code === "EACCES") {
        // A platform without the rest of 127.0.0.0/8 cannot prove the property.
        ctx.skip();
        return;
      }
      throw error;
    }

    try {
      const portA = new URL(first.origin).port;
      const portB = new URL(second.origin).port;

      // Both checks finish before either connection starts, which is the order
      // a shared pin would be overwritten in.
      let arrived = 0;
      let release: () => void = () => undefined;
      const bothChecked = new Promise<void>((resolve) => {
        release = resolve;
      });
      let firstChecked: () => void = () => undefined;
      const firstArrival = new Promise<void>((resolve) => {
        firstChecked = resolve;
      });
      const hosts: string[] = [];

      const lookup: HostLookup = async (host) => {
        hosts.push(host);
        arrived += 1;
        const index = arrived;
        if (index === 1) firstChecked();
        if (index === 2) release();
        await bothChecked;
        return index === 1
          ? [{ address: "127.0.0.1", family: 4 }]
          : [{ address: "127.0.0.2", family: 4 }];
      };

      const a = fetchSource(
        sourceOf({ id: "a", url: `http://split.example:${portA}/data` }),
        undefined,
        createPinnedFetch({ lookup }),
        () => 0,
        lookup,
      );
      await firstArrival;
      const b = fetchSource(
        sourceOf({ id: "b", url: `http://split.example:${portB}/data` }),
        undefined,
        createPinnedFetch({ lookup }),
        () => 0,
        lookup,
      );

      const [outcomeA, outcomeB] = await Promise.all([a, b]);

      expect(outcomeA).toEqual({ ok: true, body: { who: "a" }, elapsedMs: 0 });
      expect(outcomeB).toEqual({ ok: true, body: { who: "b" }, elapsedMs: 0 });
      expect(hosts).toEqual(["split.example", "split.example"]);
    } finally {
      await first.close();
      await second.close();
    }
  });

  it("pins each redirect hop to the address its own policy checked", async () => {
    const target = await listenAt("127.0.0.1", jsonAt({ hop: 2 }));
    const targetPort = new URL(target.origin).port;
    const start = await listenAt("127.0.0.1", (_request, response) => {
      response.writeHead(302, {
        location: `http://second.example:${targetPort}/data`,
      });
      response.end();
    });

    try {
      const startPort = new URL(start.origin).port;
      const hosts: string[] = [];
      const lookup: HostLookup = async (host) => {
        hosts.push(host);
        if (host === "first.example") {
          return [{ address: "127.0.0.1", family: 4 }];
        }
        const seen = hosts.filter((entry) => entry === host).length;
        return seen === 1
          ? [{ address: "127.0.0.1", family: 4 }]
          : [{ address: "127.0.0.2", family: 4 }];
      };

      const outcome = await fetchSource(
        sourceOf({ url: `http://first.example:${startPort}/start` }),
        undefined,
        createPinnedFetch({ lookup }),
        () => 0,
        lookup,
      );

      expect(outcome).toEqual({ ok: true, body: { hop: 2 }, elapsedMs: 0 });
      expect(hosts.filter((host) => host === "second.example")).toHaveLength(1);
    } finally {
      await start.close();
      await target.close();
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

  it("resolves once when the request carries no answer", async () => {
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
