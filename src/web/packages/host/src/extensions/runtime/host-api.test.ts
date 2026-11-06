import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  Capability,
  ConsentRecord,
  InstalledPlugin,
} from "@yunari/extension-api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostLookup } from "../../providers/custom/fetch-source.js";
import { createHostApiDispatcher, type HostApiDispatcher } from "./host-api.js";

const pinned = vi.hoisted(() => {
  const fetchImpl = vi.fn<typeof fetch>();
  return { fetchImpl, createPinnedFetch: vi.fn(() => fetchImpl) };
});

vi.mock("../../providers/custom/pinned-fetch.js", () => ({
  createPinnedFetch: pinned.createPinnedFetch,
}));

const consent: ConsentRecord = {
  pluginKey: "acme/test-plugin",
  version: "1.0.0",
  fingerprint: "yc1-abc",
  grantedAt: "2026-11-06T00:00:00.000Z",
};

function plugin(
  patch: {
    readonly capabilities?: readonly Capability[];
    readonly contentHash?: string;
    readonly key?: string;
    readonly publisher?: string;
  } = {},
): InstalledPlugin {
  return {
    key: patch.key ?? "acme/test-plugin",
    publisher: patch.publisher ?? "acme",
    directory: "/plugins/acme/test-plugin/1.0.0",
    contentHash: patch.contentHash ?? "a".repeat(64),
    manifest: {
      manifestVersion: 1,
      id: "test-plugin",
      name: "Test Plugin",
      version: "1.0.0",
      description: "fixture",
      engines: { yunari: ">=0.1.0" },
      pluginApi: 1,
      execution: "trusted-worker",
      capabilities: patch.capabilities ?? [],
      contributes: {},
      networkHosts: ["api.acme.test"],
    },
  };
}

const PUBLIC = [{ address: "93.184.216.34", family: 4 }] as const;

function publicResolve(): HostLookup & { readonly calls: string[] } {
  const calls: string[] = [];
  const resolve = async (host: string) => {
    calls.push(host);
    return PUBLIC;
  };
  return Object.assign(resolve, { calls });
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function dispatcherOf(options: {
  readonly settingsDir: string;
  readonly fetchImpl?: typeof fetch;
  readonly resolve?: HostLookup;
}): HostApiDispatcher {
  return createHostApiDispatcher(options);
}

describe("host API dispatcher", () => {
  let settingsDir: string;

  beforeEach(async () => {
    settingsDir = await mkdtemp(path.join(os.tmpdir(), "yunari-host-api-"));
  });

  afterEach(async () => {
    await rm(settingsDir, { recursive: true, force: true });
  });

  it("denies a call the consent does not grant, logging no params", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const api = dispatcherOf({ settingsDir });

    const answer = await api.call({
      plugin: plugin(),
      consent,
      method: "network.fetch",
      params: { url: "https://api.acme.test/x", secret: "do-not-log" },
    });

    expect(answer).toEqual({ ok: false, reason: "missing-capability" });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.join(" ")).not.toContain("do-not-log");
    warn.mockRestore();
  });

  it("refuses a host-facing method that passed the gate", async () => {
    const api = dispatcherOf({ settingsDir });

    const answer = await api.call({
      plugin: plugin({ capabilities: ["sensor:provide"] }),
      consent,
      method: "describe",
      params: {},
    });

    expect(answer).toEqual({ ok: false, reason: "not-supported" });
  });

  it("refuses an undeclared host before resolving or dialling", async () => {
    const resolve = publicResolve();
    const fetchImpl = vi.fn<typeof fetch>();
    const api = dispatcherOf({ settingsDir, fetchImpl, resolve });

    const answer = await api.call({
      plugin: plugin({ capabilities: ["network:fetch"] }),
      consent,
      method: "network.fetch",
      params: { url: "https://evil.test/x" },
    });

    expect(answer).toMatchObject({
      ok: false,
      reason: expect.stringContaining("not declared"),
    });
    expect(resolve.calls).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requires an https URL without userinfo", async () => {
    const api = dispatcherOf({ settingsDir });

    expect(
      await api.call({
        plugin: plugin({ capabilities: ["network:fetch"] }),
        consent,
        method: "network.fetch",
        params: { url: "http://api.acme.test/x" },
      }),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/https/i) });

    expect(
      await api.call({
        plugin: plugin({ capabilities: ["network:fetch"] }),
        consent,
        method: "network.fetch",
        params: { url: "https://user:pass@api.acme.test/x" },
      }),
    ).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/credentials/i),
    });
  });

  it("fetches a declared host with the caller's own headers only", async () => {
    const calls: RequestInit[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      calls.push(init ?? {});
      return json({ value: 1 });
    };
    const api = dispatcherOf({
      settingsDir,
      fetchImpl,
      resolve: publicResolve(),
    });

    const answer = await api.call({
      plugin: plugin({ capabilities: ["network:fetch"] }),
      consent,
      method: "network.fetch",
      params: {
        url: "https://api.acme.test/data",
        method: "POST",
        headers: { "x-api-key": "mine" },
        body: "a=1",
      },
    });

    expect(answer).toMatchObject({ ok: true, body: { value: 1 } });
    const init = calls[0];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe("a=1");
    expect(new Headers(init?.headers).get("authorization")).toBeNull();
  });

  it("defaults a network call to the pinned fetch", async () => {
    pinned.fetchImpl.mockReset();
    pinned.createPinnedFetch.mockClear();
    pinned.fetchImpl.mockResolvedValue(json({ value: 1 }));
    const resolve = publicResolve();
    const api = dispatcherOf({ settingsDir, resolve });

    const answer = await api.call({
      plugin: plugin({ capabilities: ["network:fetch"] }),
      consent,
      method: "network.fetch",
      params: { url: "https://api.acme.test/data" },
    });

    expect(answer).toMatchObject({ ok: true, body: { value: 1 } });
    expect(pinned.createPinnedFetch).toHaveBeenCalledWith({ lookup: resolve });
    expect(pinned.fetchImpl).toHaveBeenCalledOnce();
  });

  it("answers invalid-params when a handler throws on bad params", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const api = dispatcherOf({
      settingsDir,
      fetchImpl,
      resolve: publicResolve(),
    });

    const answer = await api.call({
      plugin: plugin({ capabilities: ["network:fetch"] }),
      consent,
      method: "network.fetch",
      params: {
        url: "https://api.acme.test/x",
        headers: { "bad name": "x" },
      },
    });

    expect(answer).toEqual({ ok: false, reason: "invalid-params" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses unknown params", async () => {
    const api = dispatcherOf({ settingsDir });

    expect(
      await api.call({
        plugin: plugin({ capabilities: ["network:fetch"] }),
        consent,
        method: "network.fetch",
        params: { url: "https://api.acme.test/x", extra: true },
      }),
    ).toEqual({ ok: false, reason: "invalid-params" });
  });

  it("keeps storage under the plugin's qualified key and across an update", async () => {
    const api = dispatcherOf({ settingsDir });
    const first = plugin({ capabilities: ["storage:own"] });
    const updated = plugin({
      capabilities: ["storage:own"],
      contentHash: "b".repeat(64),
    });
    const other = plugin({
      capabilities: ["storage:own"],
      publisher: "other",
      key: "other/test-plugin",
    });

    expect(
      await api.call({
        plugin: first,
        consent,
        method: "storage.set",
        params: { key: "a", value: "one" },
      }),
    ).toBeNull();
    expect(
      await api.call({
        plugin: first,
        consent,
        method: "storage.get",
        params: { key: "a" },
      }),
    ).toBe("one");
    expect(
      await api.call({
        plugin: first,
        consent,
        method: "storage.get",
        params: { key: "absent" },
      }),
    ).toBeNull();
    // The same plugin at a new content hash gets a fresh store object over the
    // same publisher/id tree, so its data survives the update.
    expect(
      await api.call({
        plugin: updated,
        consent,
        method: "storage.get",
        params: { key: "a" },
      }),
    ).toBe("one");
    expect(
      await api.call({
        plugin: other,
        consent,
        method: "storage.get",
        params: { key: "a" },
      }),
    ).toBeNull();
  });

  it("reads and replaces the settings object", async () => {
    const api = dispatcherOf({ settingsDir });
    const owner = plugin({ capabilities: ["settings:own"] });

    expect(
      await api.call({
        plugin: owner,
        consent,
        method: "settings.get",
        params: {},
      }),
    ).toEqual({});
    expect(
      await api.call({
        plugin: owner,
        consent,
        method: "settings.set",
        params: { value: { theme: "dark" } },
      }),
    ).toBeNull();
    expect(
      await api.call({
        plugin: owner,
        consent,
        method: "settings.get",
        params: {},
      }),
    ).toEqual({ theme: "dark" });
  });

  it("returns null for an absent secret and refuses a bad key", async () => {
    const api = dispatcherOf({ settingsDir });
    const owner = plugin({ capabilities: ["secrets:own"] });

    expect(
      await api.call({
        plugin: owner,
        consent,
        method: "secrets.get",
        params: { key: "absent" },
      }),
    ).toBeNull();
    expect(
      await api.call({
        plugin: owner,
        consent,
        method: "secrets.set",
        params: { key: "../x", value: "v" },
      }),
    ).toEqual({ ok: false, reason: "invalid-params" });
  });

  it("logs the message only and bounds it", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const api = dispatcherOf({ settingsDir });

    expect(
      await api.call({
        plugin: plugin(),
        consent,
        method: "log",
        params: { level: "info", message: "hello", params: "hidden" },
      }),
    ).toEqual({ ok: false, reason: "invalid-params" });

    expect(
      await api.call({
        plugin: plugin(),
        consent,
        method: "log",
        params: { level: "info", message: "hello" },
      }),
    ).toBeNull();

    await api.call({
      plugin: plugin(),
      consent,
      method: "log",
      params: { level: "info", message: "a".repeat(10_000) },
    });

    expect(info.mock.calls[0]?.[0]).toBe("hello");
    expect(String(info.mock.calls[1]?.[0]).length).toBeLessThanOrEqual(2_048);
    info.mockRestore();
  });
});
