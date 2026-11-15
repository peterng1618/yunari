/**
 * The one client reader of the host's origin register.
 *
 * **The card's partial state and the later update diff read one answer.** A
 * collection's installed count needs the origin of each included listing, which
 * the collections page's own rows never carry, so the host answers the whole
 * register once and this reader is the only place the editor parses it. A
 * malformed answer is refused rather than read as an empty register: "nothing
 * is installed" and "the host answered garbage" are different facts.
 */
import { expect, it, vi } from "vitest";
import { readOrigins } from "./origins.js";

const ORIGIN = {
  kind: "dashboard-theme",
  catalogueId: "11111111-1111-4111-8111-111111111111",
  version: "1.0.0",
  installedAt: "2026-10-01T00:00:00.000Z",
} as const;

function fetcher(value: unknown, status = 200): typeof fetch {
  return vi.fn(
    async () => new Response(JSON.stringify(value), { status }),
  ) as unknown as typeof fetch;
}

it("reads the register's records from the one route", async () => {
  const mocked = fetcher({ origins: [ORIGIN] });

  await expect(readOrigins({ fetch: mocked })).resolves.toEqual([ORIGIN]);
  expect(mocked).toHaveBeenCalledWith("/api/store/origins");
});

it("keeps the collections a member arrived through", async () => {
  const named = {
    ...ORIGIN,
    collections: ["11111111-1111-4111-8111-111111111111"],
  };

  await expect(
    readOrigins({ fetch: fetcher({ origins: [named] }) }),
  ).resolves.toEqual([named]);
});

it("refuses a body that is not an origin register", async () => {
  await expect(
    readOrigins({ fetch: fetcher({ origins: "none" }) }),
  ).rejects.toThrow();
  await expect(
    readOrigins({ fetch: fetcher({ installed: [] }) }),
  ).rejects.toThrow();
});

it("refuses an entry that is not a usable origin", async () => {
  await expect(
    readOrigins({
      fetch: fetcher({
        origins: [{ ...ORIGIN, kind: "not-a-listing-kind" }],
      }),
    }),
  ).rejects.toThrow();
  await expect(
    readOrigins({
      fetch: fetcher({ origins: [{ ...ORIGIN, catalogueId: "" }] }),
    }),
  ).rejects.toThrow();
});

it("refuses an answer the host did not make", async () => {
  await expect(
    readOrigins({ fetch: fetcher({ origins: [] }, 500) }),
  ).rejects.toThrow("The host answered 500.");
});
