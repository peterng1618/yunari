import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveHostUrl, run } from "./main.js";
import { type FakeHost, startFakeHost } from "./testing/fake-host.js";

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

describe("resolveHostUrl", () => {
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
