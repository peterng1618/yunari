import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  Capability,
  ConsentRecord,
  InstalledPlugin,
} from "@yunari/extension-api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostLookup } from "../../providers/custom/fetch-source.js";
import {
  createDeviceBroker,
  type DeviceBackend,
  type DeviceBroker,
  type DeviceHandle,
} from "./device-broker.js";
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
  readonly broker?: DeviceBroker;
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

  it("fetches binary bytes from a declared host through the guarded path", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    const api = dispatcherOf({
      settingsDir,
      fetchImpl,
      resolve: publicResolve(),
    });

    const answer = (await api.call({
      plugin: plugin({ capabilities: ["network:fetch"] }),
      consent,
      method: "network.fetchBytes",
      params: { url: "https://api.acme.test/art.png" },
    })) as { readonly ok: true; readonly bytes: Uint8Array };

    expect(answer.ok).toBe(true);
    expect(answer.bytes).toBeInstanceOf(Uint8Array);
    expect([...answer.bytes]).toEqual([1, 2, 3]);
  });

  it("applies the declared-host policy to a byte fetch", async () => {
    const resolve = publicResolve();
    const fetchImpl = vi.fn<typeof fetch>();
    const api = dispatcherOf({ settingsDir, fetchImpl, resolve });

    const undeclared = await api.call({
      plugin: plugin({ capabilities: ["network:fetch"] }),
      consent,
      method: "network.fetchBytes",
      params: { url: "https://evil.test/art.png" },
    });
    expect(undeclared).toMatchObject({
      ok: false,
      reason: expect.stringContaining("not declared"),
    });

    const plain = await api.call({
      plugin: plugin({ capabilities: ["network:fetch"] }),
      consent,
      method: "network.fetchBytes",
      params: { url: "http://api.acme.test/art.png" },
    });
    expect(plain).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/https/i),
    });

    const extra = await api.call({
      plugin: plugin({ capabilities: ["network:fetch"] }),
      consent,
      method: "network.fetchBytes",
      params: { url: "https://api.acme.test/art.png", body: "x" },
    });
    expect(extra).toEqual({ ok: false, reason: "invalid-params" });

    expect(resolve.calls).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
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

  it("answers host-error and logs when a store fails", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const api = dispatcherOf({ settingsDir });
    const owner = plugin({ capabilities: ["storage:own"] });
    // A directory where the stored value file belongs makes `readFile` fail
    // with a host error rather than a malformed param.
    await mkdir(
      path.join(
        settingsDir,
        "extensions",
        "data",
        "acme",
        "test-plugin",
        Buffer.from("a").toString("base64url"),
      ),
      { recursive: true },
    );

    const answer = await api.call({
      plugin: owner,
      consent,
      method: "storage.get",
      params: { key: "a" },
    });

    expect(answer).toEqual({ ok: false, reason: "host-error" });
    expect(error).toHaveBeenCalledOnce();
    const logged = error.mock.calls[0]?.join(" ") ?? "";
    expect(logged).toContain("storage.get");
    expect(logged).not.toContain("value");
    error.mockRestore();
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

function fakeHandle(overrides: Partial<DeviceHandle> = {}): DeviceHandle {
  return {
    open: vi.fn(async () => undefined),
    bulkTransferOut: vi.fn(async () => undefined),
    controlTransferOut: vi.fn(async () => undefined),
    interruptTransferIn: vi.fn(async () => new Uint8Array()),
    hidWrite: vi.fn(async () => undefined),
    hidRead: vi.fn(async () => new Uint8Array()),
    serialWrite: vi.fn(async () => undefined),
    serialRead: vi.fn(async () => new Uint8Array()),
    serialDrain: vi.fn(async () => new Uint8Array()),
    close: vi.fn(async () => undefined),
    ...overrides,
  };
}

function fakeBroker(overrides: Partial<DeviceBroker> = {}): DeviceBroker {
  return {
    list: vi.fn(async () => []),
    open: vi.fn(async () => "token"),
    call: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    closeAll: vi.fn(async () => undefined),
    closeScope: vi.fn(async () => undefined),
    ...overrides,
  };
}

/** A real broker over a fake backend, declaring one USB device. */
function declaredBroker(): {
  readonly broker: DeviceBroker;
  readonly backend: DeviceBackend;
  readonly handle: DeviceHandle;
} {
  const handle = fakeHandle();
  const backend: DeviceBackend = {
    list: vi.fn(async () => [
      {
        transport: "usb" as const,
        vendorId: 0x1234,
        productId: 0x5678,
        path: "/dev/panel",
        serial: "s",
        product: "Acme",
      },
    ]),
    open: vi.fn(async () => handle),
  };
  const broker = createDeviceBroker({
    allowlists: () => [
      { transport: "usb", vendorId: 0x1234, productId: 0x5678 },
    ],
    backend,
  });
  return { broker, backend, handle };
}

describe("device methods", () => {
  let settingsDir: string;

  beforeEach(async () => {
    settingsDir = await mkdtemp(path.join(os.tmpdir(), "yunari-device-api-"));
  });

  afterEach(async () => {
    await rm(settingsDir, { recursive: true, force: true });
  });

  it("refuses an undeclared device without opening the backend", async () => {
    const { broker, backend } = declaredBroker();
    const api = dispatcherOf({ settingsDir, broker });

    const answer = await api.call({
      plugin: plugin({ capabilities: ["usb:device"] }),
      consent,
      method: "usb.open",
      params: { transport: "usb", vendorId: 0x9999, productId: 0x0001 },
    });

    expect(answer).toMatchObject({
      ok: false,
      reason: expect.stringContaining("not declared"),
    });
    expect(backend.open).not.toHaveBeenCalled();
  });

  it("opens a declared device and returns the broker's token", async () => {
    const { broker, backend } = declaredBroker();
    const api = dispatcherOf({ settingsDir, broker });

    const answer = await api.call({
      plugin: plugin({ capabilities: ["usb:device"] }),
      consent,
      method: "usb.open",
      params: { transport: "usb", vendorId: 0x1234, productId: 0x5678 },
    });

    expect(answer).toEqual(expect.any(String));
    expect(backend.open).toHaveBeenCalledOnce();
  });

  it("refuses usb methods without the usb:device capability", async () => {
    const api = dispatcherOf({ settingsDir, broker: fakeBroker() });

    expect(
      await api.call({
        plugin: plugin(),
        consent,
        method: "usb.open",
        params: { transport: "usb", vendorId: 1, productId: 2 },
      }),
    ).toEqual({
      ok: false,
      reason: "missing-capability",
    });
  });

  it("refuses serial methods without the serial:device capability", async () => {
    const api = dispatcherOf({ settingsDir, broker: fakeBroker() });

    expect(
      await api.call({
        plugin: plugin({ capabilities: ["usb:device"] }),
        consent,
        method: "serial.read",
        params: { token: "tok", timeoutMs: 100 },
      }),
    ).toEqual({
      ok: false,
      reason: "missing-capability",
    });
  });

  it("lets a serial-only plugin open and close its host handle", async () => {
    const broker = fakeBroker();
    const api = dispatcherOf({ settingsDir, broker });
    const serialPlugin = plugin({ capabilities: ["serial:device"] });

    expect(
      await api.call({
        plugin: serialPlugin,
        consent,
        method: "usb.open",
        params: {
          transport: "serial",
          vendorId: 1,
          productId: 2,
          path: "COM3",
        },
      }),
    ).toEqual("token");
    expect(
      await api.call({
        plugin: serialPlugin,
        consent,
        method: "usb.close",
        params: { token: "token" },
      }),
    ).toBeNull();
    expect(broker.open).toHaveBeenCalledOnce();
    expect(broker.close).toHaveBeenCalledWith("acme/test-plugin", "token");
  });

  it("answers not-supported when no broker is configured", async () => {
    const api = dispatcherOf({ settingsDir });

    expect(
      await api.call({
        plugin: plugin({ capabilities: ["usb:device"] }),
        consent,
        method: "usb.open",
        params: { transport: "usb", vendorId: 1, productId: 2 },
      }),
    ).toEqual({ ok: false, reason: "not-supported" });
  });

  it.each([
    ["a non-Uint8Array payload", { token: "tok", endpoint: 1, bytes: [1] }],
    ["a missing token", { endpoint: 1, bytes: new Uint8Array([1]) }],
    [
      "an unknown key",
      { token: "tok", endpoint: 1, bytes: new Uint8Array([1]), extra: true },
    ],
  ])("refuses %s as invalid params", async (_label, params) => {
    const broker = fakeBroker();
    const api = dispatcherOf({ settingsDir, broker });

    expect(
      await api.call({
        plugin: plugin({ capabilities: ["usb:device"] }),
        consent,
        method: "usb.bulkTransfer",
        params,
      }),
    ).toEqual({ ok: false, reason: "invalid-params" });
    expect(broker.call).not.toHaveBeenCalled();
  });

  it("forwards a transfer under the same method name", async () => {
    const broker = fakeBroker({ call: vi.fn(async () => undefined) });
    const api = dispatcherOf({ settingsDir, broker });
    const bytes = new Uint8Array([7, 8]);

    const answer = await api.call({
      plugin: plugin({ capabilities: ["usb:device"] }),
      consent,
      method: "usb.bulkTransfer",
      params: { token: "tok", endpoint: 2, bytes },
    });

    expect(answer).toBeUndefined();
    expect(broker.call).toHaveBeenCalledWith(
      "acme/test-plugin",
      "tok",
      "usb.bulkTransfer",
      { token: "tok", endpoint: 2, bytes },
    );
  });
});

describe("device runner scope", () => {
  let settingsDir: string;

  beforeEach(async () => {
    settingsDir = await mkdtemp(path.join(os.tmpdir(), "yunari-device-scope-"));
  });

  afterEach(async () => {
    await rm(settingsDir, { recursive: true, force: true });
  });

  it("carries the display runner's scope to the broker", async () => {
    const broker = fakeBroker();
    const api = dispatcherOf({ settingsDir, broker });

    await api.call({
      plugin: plugin({ capabilities: ["usb:device"] }),
      consent,
      method: "usb.open",
      params: { transport: "usb", vendorId: 1, productId: 2 },
      scope: "display-1",
    });

    expect(broker.open).toHaveBeenCalledWith(
      "acme/test-plugin",
      expect.objectContaining({ transport: "usb", vendorId: 1, productId: 2 }),
      "display-1",
    );
  });
});
