import { afterEach, expect, it, vi } from "vitest";
import { createPublisher } from "./publish-client.js";

afterEach(() => vi.unstubAllGlobals());

const document = {
  id: "living-room",
  envelope: { schemaVersion: "2.0.0" } as never,
};

it("sends the latest document once, not every edit", async () => {
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true, revision: 1 })),
  );
  vi.stubGlobal("fetch", fetch);

  const publisher = createPublisher({ debounceMs: 5 });
  publisher.offer(document);
  publisher.offer({ ...document, id: "kitchen" });
  publisher.offer({ ...document, id: "study" });

  await new Promise((resolve) => setTimeout(resolve, 30));
  await publisher.stop();

  const published = fetch.mock.calls.filter(([url]) =>
    String(url).startsWith("/api/publish?"),
  );
  expect(published).toHaveLength(1);
  // The latest offer wins: a burst sends what the author is looking at now, not
  // what they were looking at when the burst started. Three offers of the same
  // document cannot tell those two apart.
  expect(String(published[0]?.[0])).toContain("id=study");
});

it("stops by telling the host, so the display goes back to the stored theme", async () => {
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true })),
  );
  vi.stubGlobal("fetch", fetch);

  const publisher = createPublisher({ debounceMs: 5 });
  publisher.offer(document);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await publisher.stop();

  expect(fetch.mock.calls.at(-1)?.[1]).toMatchObject({ method: "DELETE" });
});
