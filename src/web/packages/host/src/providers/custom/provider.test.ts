import type { SampleEntry } from "@yunari/renderer-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CredentialStore } from "../../settings/credentials.js";
import type {
  CustomField,
  CustomSource,
  SourceFile,
  SourceIssue,
  SourceStore,
} from "../../settings/sources.js";
import { CustomSourceProvider, customFieldKey } from "./provider.js";

/** The minimum interval `sources.ts` permits, so a fake clock can move a whole
 *  interval without the test deciding what a plausible cadence is. */
const INTERVAL_MS = 10_000;

function fieldOf(
  patch: Partial<CustomField> & { readonly id: string },
): CustomField {
  return {
    label: patch.id,
    pointer: `/${patch.id}`,
    type: "number",
    ...patch,
  };
}

function sourceOf(
  patch: Partial<CustomSource> & { readonly id: string },
): CustomSource {
  return {
    name: patch.id,
    url: `http://127.0.0.1:9/${patch.id}`,
    intervalMs: INTERVAL_MS,
    timeoutMs: 5_000,
    fields: [],
    ...patch,
  };
}

function storeOf(
  file: SourceFile = { sources: [], issues: [] },
): SourceStore & { set(next: SourceFile): void } {
  let current = file;

  return {
    read: async () => current,
    write: async () => current,
    set: (next) => {
      current = next;
    },
  };
}

function credentialsOf(
  values: Readonly<Record<string, string>> = {},
): CredentialStore & { set(id: string, value: string | undefined): void } {
  const held = new Map(Object.entries(values));

  return {
    read: async () => ({}),
    valueOf: async (id) => held.get(id),
    write: async (id, value) => {
      held.set(id, value);
    },
    clear: async (id) => {
      held.delete(id);
    },
    set: (id, value) => {
      if (value === undefined) held.delete(id);
      else held.set(id, value);
    },
  };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

interface Call {
  readonly url: string;
  readonly headers: Headers;
}

function fetcherOf(responder: (url: string) => Response | Promise<Response>): {
  fetcher: typeof fetch;
  calls: readonly Call[];
} {
  const calls: Call[] = [];

  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    calls.push({ url, headers: new Headers(init?.headers) });
    return responder(url);
  }) as unknown as typeof fetch;

  return { fetcher, calls };
}

function providerOf(
  store: SourceStore,
  credentials: CredentialStore = credentialsOf(),
  fetcher: typeof fetch = fetcherOf(() => json({})).fetcher,
): CustomSourceProvider {
  return new CustomSourceProvider({ sources: store, credentials, fetcher });
}

function byKey(
  entries: readonly SampleEntry[],
): Map<string, SampleEntry["sample"]> {
  return new Map(entries.map((entry) => [entry.semanticKey, entry.sample]));
}

/** Lets the fetch a `sample` kicked off settle without moving the clock. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe("CustomSourceProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("describes every field of every valid source", async () => {
    const store = storeOf({
      sources: [
        sourceOf({
          id: "bench",
          fields: [
            fieldOf({
              id: "temp",
              label: "Bench temperature",
              unit: "°C",
              unitKind: "temperature",
              family: "system",
              expectedTier: "baseline",
            }),
            fieldOf({ id: "mood", type: "text", label: "Mood" }),
          ],
        }),
        sourceOf({
          id: "rack",
          fields: [fieldOf({ id: "door", type: "boolean" })],
        }),
      ],
      issues: [],
    });
    const provider = providerOf(store);
    await provider.reload();

    const descriptors = await provider.describe();

    expect(descriptors.map((entry) => entry.semanticKey)).toEqual([
      "custom.bench.temp",
      "custom.bench.mood",
      "custom.rack.door",
    ]);
    expect(customFieldKey("bench", "temp")).toBe("custom.bench.temp");

    const by = new Map(
      descriptors.map((entry) => [entry.semanticKey, entry] as const),
    );

    expect(by.get("custom.bench.temp")).toMatchObject({
      sensorId: "custom:bench:temp",
      label: "Bench temperature",
      family: "system",
      unit: "°C",
      unitKind: "temperature",
      valueKind: "number",
      tier: "baseline",
    });
    expect(by.get("custom.bench.mood")).toMatchObject({
      family: "custom",
      valueKind: "text",
      tier: "extended",
    });
    expect(by.get("custom.rack.door")).toMatchObject({
      family: "custom",
      valueKind: "boolean",
      tier: "extended",
    });
  });

  it("reads a number, text and boolean into the matching Sample field", async () => {
    const store = storeOf({
      sources: [
        sourceOf({
          id: "one",
          fields: [
            fieldOf({ id: "n", unit: "°C" }),
            fieldOf({ id: "t", type: "text" }),
            fieldOf({ id: "b", type: "boolean" }),
          ],
        }),
      ],
      issues: [],
    });
    const { fetcher } = fetcherOf(() => json({ n: 21.5, t: "hello", b: true }));
    const provider = providerOf(store, credentialsOf(), fetcher);
    await provider.reload();

    const keys = ["custom.one.n", "custom.one.t", "custom.one.b"];
    await provider.sample(keys, Date.now());
    await settle();

    const by = byKey(await provider.sample(keys, Date.now()));

    expect(by.get("custom.one.n")).toMatchObject({
      status: "ok",
      value: 21.5,
      unit: "°C",
    });
    expect(by.get("custom.one.t")).toMatchObject({
      status: "ok",
      textValue: "hello",
    });
    expect(by.get("custom.one.b")).toMatchObject({
      status: "ok",
      booleanValue: true,
    });
  });

  it("names a missing pointer and never coerces a type mismatch", async () => {
    const store = storeOf({
      sources: [
        sourceOf({
          id: "one",
          fields: [
            fieldOf({ id: "gone", pointer: "/absent/nope" }),
            fieldOf({ id: "n" }),
            fieldOf({ id: "t", type: "text" }),
            fieldOf({ id: "b", type: "boolean" }),
          ],
        }),
      ],
      issues: [],
    });
    const { fetcher } = fetcherOf(() => json({ n: "12", t: 5, b: "true" }));
    const provider = providerOf(store, credentialsOf(), fetcher);
    await provider.reload();

    const keys = [
      "custom.one.gone",
      "custom.one.n",
      "custom.one.t",
      "custom.one.b",
    ];
    await provider.sample(keys, Date.now());
    await settle();

    const by = byKey(await provider.sample(keys, Date.now()));

    expect(by.get("custom.one.gone")).toMatchObject({ status: "missing" });
    expect(by.get("custom.one.gone")?.message).toContain("/absent/nope");

    for (const [key, expected] of [
      ["custom.one.n", "expected a number"],
      ["custom.one.t", "expected text"],
      ["custom.one.b", "expected a boolean"],
    ] as const) {
      const sample = by.get(key);
      expect(sample, key).toMatchObject({ status: "error" });
      expect(sample?.message, key).toContain(expected);
      expect(sample?.value, key).toBeUndefined();
      expect(sample?.textValue, key).toBeUndefined();
      expect(sample?.booleanValue, key).toBeUndefined();
    }
  });

  it("goes stale after three missed intervals and returns to ok on success", async () => {
    const store = storeOf({
      sources: [sourceOf({ id: "one", fields: [fieldOf({ id: "x" })] })],
      issues: [],
    });
    let healthy = true;
    const { fetcher, calls } = fetcherOf(() => {
      if (!healthy) return new Response("no", { status: 500 });
      return json({ x: 5 });
    });
    const provider = providerOf(store, credentialsOf(), fetcher);
    await provider.reload();

    const key = "custom.one.x";
    await provider.sample([key], Date.now());
    await settle();
    expect(
      byKey(await provider.sample([key], Date.now())).get(key),
    ).toMatchObject({ status: "ok", value: 5 });

    healthy = false;
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(
      byKey(await provider.sample([key], Date.now())).get(key),
    ).toMatchObject({ status: "ok", value: 5 });

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(
      byKey(await provider.sample([key], Date.now())).get(key),
    ).toMatchObject({ status: "stale" });
    expect(calls.length).toBe(4);

    healthy = true;
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(
      byKey(await provider.sample([key], Date.now())).get(key),
    ).toMatchObject({ status: "ok", value: 5 });
  });

  it("keeps a failing source out of another source's samples", async () => {
    const store = storeOf({
      sources: [
        sourceOf({ id: "a", fields: [fieldOf({ id: "x" })] }),
        sourceOf({ id: "b", fields: [fieldOf({ id: "x" })] }),
      ],
      issues: [],
    });
    const { fetcher } = fetcherOf((url) => {
      if (url.endsWith("/a")) {
        throw new Error("boom at http://10.1.2.3:8080/secret");
      }
      return json({ x: 7 });
    });
    const provider = providerOf(store, credentialsOf(), fetcher);
    await provider.reload();

    const keys = ["custom.a.x", "custom.b.x"];
    await provider.sample(keys, Date.now());
    await settle();

    let by = byKey(await provider.sample(keys, Date.now()));
    expect(by.get("custom.a.x")).toMatchObject({ status: "error" });
    expect(by.get("custom.a.x")?.message).toContain(
      "boom at its configured address",
    );
    expect(by.get("custom.a.x")?.message).not.toContain("10.1.2.3");
    expect(by.get("custom.b.x")).toMatchObject({ status: "ok", value: 7 });

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    by = byKey(await provider.sample(keys, Date.now()));
    expect(by.get("custom.a.x")).toMatchObject({ status: "error" });
    expect(by.get("custom.b.x")).toMatchObject({ status: "ok", value: 7 });

    const health = provider.health();
    expect(health.available).toBe(true);
    expect(health.message).toBe("boom at its configured address");
  });

  it("fetches nothing until a key is demanded, then starts its timer", async () => {
    const store = storeOf({
      sources: [sourceOf({ id: "one", fields: [fieldOf({ id: "x" })] })],
      issues: [],
    });
    const { fetcher, calls } = fetcherOf(() => json({ x: 1 }));
    const provider = providerOf(store, credentialsOf(), fetcher);
    await provider.reload();

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 5);
    expect(calls.length).toBe(0);

    const unrelated = await provider.sample(["clock.time"], Date.now());
    expect(unrelated).toEqual([]);
    expect(calls.length).toBe(0);

    await provider.sample(["custom.one.x"], Date.now());
    await settle();
    expect(calls.length).toBe(1);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(calls.length).toBe(2);
  });

  it("replaces descriptors and timers on reload without doubling them", async () => {
    const store = storeOf({
      sources: [
        sourceOf({
          id: "one",
          fields: [fieldOf({ id: "x", label: "Before" })],
        }),
      ],
      issues: [],
    });
    const { fetcher, calls } = fetcherOf(() => json({ x: 1 }));
    const provider = providerOf(store, credentialsOf(), fetcher);

    const key = "custom.one.x";

    await provider.reload();
    await provider.sample([key], Date.now());
    await settle();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(calls.length).toBe(2);

    store.set({
      sources: [
        sourceOf({
          id: "one",
          fields: [fieldOf({ id: "x", label: "After" })],
        }),
      ],
      issues: [],
    });
    await provider.reload();

    expect((await provider.describe())[0]?.label).toBe("After");

    await provider.sample([key], Date.now());
    await settle();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    // One immediate fetch per demand, then exactly one per interval: an old
    // timer left running would make this five or more.
    expect(calls.length).toBe(5);
  });

  it("never fetches when the credential it needs is missing", async () => {
    const store = storeOf({
      sources: [
        sourceOf({
          id: "one",
          auth: { kind: "bearer", credentialId: "token" },
          fields: [fieldOf({ id: "x" })],
        }),
      ],
      issues: [],
    });
    const credentials = credentialsOf();
    const { fetcher, calls } = fetcherOf(() => json({ x: 3 }));
    const provider = providerOf(store, credentials, fetcher);
    await provider.reload();

    const key = "custom.one.x";
    await provider.sample([key], Date.now());
    await settle();

    expect(calls.length).toBe(0);
    expect(
      byKey(await provider.sample([key], Date.now())).get(key),
    ).toMatchObject({ status: "error", message: "credential is missing" });

    credentials.set("token", "s3cret");
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    const by = byKey(await provider.sample([key], Date.now()));
    expect(by.get(key)).toMatchObject({ status: "ok", value: 3 });
    expect(calls.length).toBe(1);
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer s3cret");
    expect(JSON.stringify([...by.values()])).not.toContain("s3cret");
  });

  it("applies scale and offset once, at acquisition", async () => {
    const store = storeOf({
      sources: [
        sourceOf({
          id: "one",
          fields: [fieldOf({ id: "x", scale: 2, offset: 1 })],
        }),
      ],
      issues: [],
    });
    const { fetcher } = fetcherOf(() => json({ x: 10 }));
    const provider = providerOf(store, credentialsOf(), fetcher);
    await provider.reload();

    const key = "custom.one.x";
    await provider.sample([key], Date.now());
    await settle();

    expect(
      byKey(await provider.sample([key], Date.now())).get(key),
    ).toMatchObject({ value: 21 });
    expect(
      byKey(await provider.sample([key], Date.now())).get(key),
    ).toMatchObject({ value: 21 });
  });

  it("follows the store for availability and exposes issues without their address", async () => {
    const empty = providerOf(storeOf());
    await empty.reload();
    expect(empty.health()).toEqual({
      available: false,
      message: "No custom sources are configured.",
    });

    const issue: SourceIssue = {
      sourceId: "one",
      reason: "source is not reachable at http://10.0.0.5:8080/data",
    };
    const rejected = providerOf(storeOf({ sources: [], issues: [issue] }));
    await rejected.reload();
    expect(rejected.health()).toMatchObject({ available: false });
    expect(rejected.health().message).toContain("its configured address");
    expect(rejected.health().message).not.toContain("10.0.0.5");

    const partial = providerOf(
      storeOf({
        sources: [sourceOf({ id: "one", fields: [] })],
        issues: [issue],
      }),
    );
    await partial.reload();
    expect(partial.health()).toMatchObject({
      available: true,
      message: "1 issue in sources.json; see that file in the settings folder.",
    });

    const healthy = providerOf(
      storeOf({
        sources: [sourceOf({ id: "one", fields: [] })],
        issues: [],
      }),
    );
    await healthy.reload();
    expect(healthy.health()).toEqual({ available: true });
  });

  it("clears its timers on stop", async () => {
    const store = storeOf({
      sources: [sourceOf({ id: "one", fields: [fieldOf({ id: "x" })] })],
      issues: [],
    });
    const { fetcher, calls } = fetcherOf(() => json({ x: 1 }));
    const provider = providerOf(store, credentialsOf(), fetcher);
    await provider.reload();

    await provider.sample(["custom.one.x"], Date.now());
    await settle();
    expect(calls.length).toBe(1);

    provider.stop();

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 5);
    expect(calls.length).toBe(1);
  });
});
