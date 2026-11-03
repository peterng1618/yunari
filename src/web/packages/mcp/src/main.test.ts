import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryDraftStore } from "./drafts.js";
import { LazyHostClient, PROBE_PORTS } from "./host-client.js";
import { isEntryPoint, resolveHostUrl, run } from "./main.js";
import { buildServer } from "./server.js";
import { type FakeHost, startFakeHost } from "./testing/fake-host.js";
import { yunariStatus } from "./tools/discovery.js";

const hosts: FakeHost[] = [];

async function fakeHost(
  handler: Parameters<typeof startFakeHost>[0],
): Promise<FakeHost> {
  const host = await startFakeHost(handler);
  hosts.push(host);
  return host;
}

function portOf(url: string): number {
  return Number(new URL(url).port);
}

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

describe("isEntryPoint", () => {
  it("runs when the bin file imports the built server", async () => {
    const dir = await mkdtemp(join(tmpdir(), "yunari-entry-"));
    const main = join(dir, "dist", "main.js");
    const bin = join(dir, "bin", "yunari-mcp.js");
    try {
      await mkdir(join(dir, "dist"));
      await mkdir(join(dir, "bin"));
      await writeFile(main, "");
      await writeFile(bin, "");

      expect(
        isEntryPoint([process.execPath, main], pathToFileURL(main).href),
      ).toBe(true);
      expect(
        isEntryPoint([process.execPath, bin], pathToFileURL(main).href),
      ).toBe(true);
      expect(
        isEntryPoint(
          [process.execPath, join(dir, "other.js")],
          pathToFileURL(main).href,
        ),
      ).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});

describe("resolveHostUrl", () => {
  it("probes 5227 through 5236 by default", () => {
    expect(PROBE_PORTS).toEqual([
      5227, 5228, 5229, 5230, 5231, 5232, 5233, 5234, 5235, 5236,
    ]);
  });

  it("takes the URL the user named", async () => {
    await expect(
      resolveHostUrl({ url: "http://127.0.0.1:9000/" }),
    ).resolves.toBe("http://127.0.0.1:9000");
  });

  it("falls back to YUNARI_URL", async () => {
    await expect(
      resolveHostUrl({
        env: { YUNARI_URL: "http://192.0.2.1:5230" },
      }),
    ).resolves.toBe("http://192.0.2.1:5230");
  });

  it("refuses a URL that is not HTTP", async () => {
    await expect(
      resolveHostUrl({ url: "file:///tmp/host.json" }),
    ).rejects.toThrow(/not an HTTP URL/u);
  });

  it("stops at the first probed port that identifies as Yunari", async () => {
    const closed = await fakeHost(() => undefined);
    const closedPort = portOf(closed.url);
    await closed.close();
    hosts.splice(hosts.indexOf(closed), 1);

    const host = await fakeHost((_request, url) =>
      url.pathname === "/api/themes" ? { body: { themes: [] } } : undefined,
    );

    await expect(
      resolveHostUrl({ ports: [closedPort, portOf(host.url)] }),
    ).resolves.toBe(host.url);
  });

  it("ignores a local answer that is not a Yunari host", async () => {
    const closed = await fakeHost(() => undefined);
    const closedPort = portOf(closed.url);
    await closed.close();
    hosts.splice(hosts.indexOf(closed), 1);

    const other = await fakeHost((_request, url) =>
      url.pathname === "/api/themes"
        ? { body: "<html>another service</html>" }
        : undefined,
    );

    await expect(
      resolveHostUrl({
        ports: [portOf(other.url), closedPort],
      }),
    ).rejects.toThrow(/No Yunari host answered/u);
  });

  it("names every probed port and YUNARI_URL when nothing answers", async () => {
    const closed = await fakeHost(() => undefined);
    const closedPort = portOf(closed.url);
    await closed.close();
    hosts.splice(hosts.indexOf(closed), 1);

    const error = await resolveHostUrl({ ports: [closedPort] }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    const message = error instanceof Error ? error.message : "";
    expect(message).toContain(`http://127.0.0.1:${closedPort}`);
    expect(message).toContain("YUNARI_URL");
  });
});

describe("serve without a host", () => {
  it("builds the server with no host and reports the connection error on a tool call", async () => {
    const closed = await fakeHost(() => undefined);
    const closedPort = portOf(closed.url);
    await closed.close();
    hosts.splice(hosts.indexOf(closed), 1);

    const context = {
      host: new LazyHostClient(() => resolveHostUrl({ ports: [closedPort] })),
      drafts: new InMemoryDraftStore(),
    };

    // Construction must not reach for the host: the stdio connection comes up
    // first, and a host started later is what the next call finds.
    expect(buildServer(context)).toBeDefined();

    const status = await yunariStatus(context);

    expect(status.isError).toBe(true);
    const block = status.content[0];
    if (block?.type !== "text") throw new Error("Expected a text block.");
    expect(block.text).toContain("No Yunari host answered");
    expect(block.text).toContain(`http://127.0.0.1:${closedPort}`);
    expect(block.text).toContain("YUNARI_URL");
  });

  it("reaches a host started after the first failed call", async () => {
    let live: string | undefined;
    const client = new LazyHostClient(() =>
      live === undefined
        ? Promise.reject(new Error("No Yunari host answered."))
        : Promise.resolve(live),
    );

    await expect(client.listThemes()).rejects.toThrow(/No Yunari host/u);

    const host = await fakeHost((_request, url) =>
      url.pathname === "/api/themes" ? { body: { themes: [] } } : undefined,
    );
    live = host.url;

    await expect(client.listThemes()).resolves.toEqual([]);
  });
});

describe("run", () => {
  it("prints usage and exits non-zero without a command", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(run([])).resolves.toBe(1);
      expect(error).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
    } finally {
      error.mockRestore();
      log.mockRestore();
    }
  });

  it("prints usage and exits non-zero for an unknown command", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(run(["compose"])).resolves.toBe(1);
      expect(error).toHaveBeenCalledWith('Unknown command "compose".');
    } finally {
      error.mockRestore();
    }
  });

  it("names the URL when a named host is unreachable", async () => {
    const closed = await fakeHost(() => undefined);
    const url = closed.url;
    await closed.close();
    hosts.splice(hosts.indexOf(closed), 1);

    const home = await mkdtemp(join(tmpdir(), "yunari-status-"));
    const previous = {
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
    };
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(run(["status", "--url", url])).resolves.toBe(0);
      expect(log.mock.calls.flat().join("\n")).toContain(
        `host: unreachable at ${url}`,
      );
    } finally {
      log.mockRestore();
      process.env.HOME = previous.HOME;
      process.env.USERPROFILE = previous.USERPROFILE;
      await rm(home, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it("refuses --url without a value", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(run(["serve", "--url"])).resolves.toBe(1);
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("--url needs a value."),
      );
    } finally {
      error.mockRestore();
    }
  });

  it("names install, uninstall and status in the usage line", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(run(["--help"])).resolves.toBe(0);
      const printed = log.mock.calls.flat().join("\n");
      expect(printed).toContain("yunari-mcp install");
      expect(printed).toContain("yunari-mcp uninstall");
      expect(printed).toContain("yunari-mcp status");
    } finally {
      log.mockRestore();
    }
  });
});
