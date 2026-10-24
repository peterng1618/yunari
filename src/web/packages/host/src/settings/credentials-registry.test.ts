import { describe, expect, it, vi } from "vitest";
import { KNOWN_CREDENTIALS, sourcesInUse } from "./credentials-registry.js";
import type { CustomSource } from "./sources.js";

const unsplash = KNOWN_CREDENTIALS.find((entry) => entry.id === "unsplash");
const weatherapi = KNOWN_CREDENTIALS.find((entry) => entry.id === "weatherapi");
const openweathermap = KNOWN_CREDENTIALS.find(
  (entry) => entry.id === "openweathermap",
);

/** One response for one call, and a record of the URL it was asked. */
function fetcherOf(
  status: number,
  calls: URL[] = [],
  body = "{}",
): typeof fetch {
  return (async (input: string | URL | Request) => {
    calls.push(new URL(String(input)));
    return new Response(body, { status });
  }) as unknown as typeof fetch;
}

describe("KNOWN_CREDENTIALS", () => {
  it("lists Unsplash as a bearer credential with a check", () => {
    expect(unsplash).toMatchObject({
      id: "unsplash",
      label: "Unsplash",
      kind: "bearer",
    });
    expect(typeof unsplash?.verify).toBe("function");
  });

  it("names where a person creates the key", () => {
    expect(unsplash?.help?.url).toBe("https://unsplash.com/oauth/applications");
    expect(unsplash?.help?.text).not.toBe("");
  });

  it("checks the key against the search endpoint and says ok on 200", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    expect(await unsplash?.verify?.("key-1234", fetcher)).toEqual({ ok: true });

    expect(calls[0]?.url).toContain("api.unsplash.com/search/photos");
    expect(calls[0]?.init?.headers).toEqual({
      Authorization: "Client-ID key-1234",
    });
  });

  it("names the status when the key is rejected, without echoing it", async () => {
    const fetcher = vi.fn(
      async () => new Response("unauthorized", { status: 401 }),
    ) as unknown as typeof fetch;

    const result = await unsplash?.verify?.("key-1234", fetcher);

    expect(result?.ok).toBe(false);
    const message = result?.ok === false ? result.message : "";
    expect(message).toContain("401");
    expect(message).not.toContain("key-1234");
  });
});

describe("the weather credentials", () => {
  it("lists both as query credentials with their issuing page", () => {
    expect(weatherapi).toMatchObject({
      id: "weatherapi",
      label: "WeatherAPI",
      kind: "query",
      help: { url: "https://www.weatherapi.com/my/" },
    });
    expect(openweathermap).toMatchObject({
      id: "openweathermap",
      label: "OpenWeatherMap",
      kind: "query",
      help: { url: "https://home.openweathermap.org/api_keys" },
    });
    expect(typeof weatherapi?.verify).toBe("function");
    expect(typeof openweathermap?.verify).toBe("function");
  });

  it("checks WeatherAPI with one London request and says ok on 200", async () => {
    const calls: URL[] = [];

    expect(
      await weatherapi?.verify?.("key-1234", fetcherOf(200, calls)),
    ).toEqual({ ok: true });

    expect(calls).toHaveLength(1);
    const asked = calls[0];
    expect(asked === undefined ? "" : asked.origin + asked.pathname).toBe(
      "https://api.weatherapi.com/v1/forecast.json",
    );
    expect(asked?.searchParams.get("q")).toBe("London");
  });

  it("refuses a rejected WeatherAPI key without echoing it", async () => {
    const result = await weatherapi?.verify?.(
      "key-1234",
      // The body carries the key, so a reason that quoted the answer would
      // show it here.
      fetcherOf(401, [], "denied for key-1234"),
    );

    expect(result?.ok).toBe(false);
    const message = result?.ok === false ? result.message : "";
    expect(message).toContain("401");
    expect(message).not.toContain("key-1234");
  });

  it("checks OpenWeatherMap with one London request and says ok on 200", async () => {
    const calls: URL[] = [];

    expect(
      await openweathermap?.verify?.("key-1234", fetcherOf(200, calls)),
    ).toEqual({ ok: true });

    expect(calls).toHaveLength(1);
    const asked = calls[0];
    expect(asked === undefined ? "" : asked.origin + asked.pathname).toBe(
      "https://api.openweathermap.org/data/2.5/weather",
    );
    expect(asked?.searchParams.get("q")).toBe("London");
  });

  it("refuses a rejected OpenWeatherMap key without echoing it", async () => {
    const result = await openweathermap?.verify?.(
      "key-1234",
      fetcherOf(401, [], "denied for key-1234"),
    );

    expect(result?.ok).toBe(false);
    const message = result?.ok === false ? result.message : "";
    expect(message).toContain("401");
    expect(message).not.toContain("key-1234");
  });
});

describe("sourcesInUse", () => {
  function sourceOf(id: string, credentialId?: string): CustomSource {
    return {
      id,
      name: id,
      url: "https://example.test/read",
      intervalMs: 60_000,
      timeoutMs: 5_000,
      ...(credentialId === undefined
        ? {}
        : { auth: { kind: "bearer" as const, credentialId } }),
      fields: [],
    };
  }

  it("keeps the built-ins and appends a source-referenced id once", () => {
    const table = sourcesInUse([
      sourceOf("first", "srckey"),
      sourceOf("second", "srckey"),
    ]);

    expect(table.map((entry) => entry.id)).toEqual([
      "unsplash",
      "weatherapi",
      "openweathermap",
      "srckey",
    ]);
    expect(table.at(-1)).toMatchObject({
      id: "srckey",
      kind: "bearer",
    });
  });

  it("keeps a built-in's own entry when a source reuses its id", () => {
    const table = sourcesInUse([sourceOf("first", "unsplash")]);

    expect(table.filter((entry) => entry.id === "unsplash")).toHaveLength(1);
    expect(table.find((entry) => entry.id === "unsplash")?.label).toBe(
      "Unsplash",
    );
  });

  it("admits the valid source's id when a duplicate id was refused", () => {
    // The store keeps the first valid entry and reports the duplicate, so only
    // the valid projection reaches this function and its credential survives.
    const table = sourcesInUse([sourceOf("first", "srckey")]);

    expect(table.map((entry) => entry.id)).toContain("srckey");
  });

  it("ignores a source that names no credential", () => {
    expect(sourcesInUse([sourceOf("first")])).toEqual(KNOWN_CREDENTIALS);
  });
});
