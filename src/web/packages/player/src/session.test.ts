import { describe, expect, it, vi } from "vitest";
import { PAIRING_STORAGE_KEY, storePairing } from "./host-refind.js";
import { displaySession } from "./session.js";

/** The browser's own `Storage`, without a browser. */
function memoryStorage(): Storage {
  const entries = new Map<string, string>();

  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => void entries.delete(key),
    setItem: (key, value) => void entries.set(key, value),
  };
}

describe("display session token", () => {
  it("keeps the page it was built from, so a poll can read it", () => {
    // The follower builds its own poll out of the page a display is on — which
    // display it is and where its theme came from — and it is handed the token,
    // not the URL, so the URL has to ride along.
    const pageUrl =
      "http://127.0.0.1:5227/?display=left-screen&theme=studio&data=live";

    expect(displaySession(pageUrl, fetch).pageUrl).toBe(pageUrl);
  });

  it("carries no token for a loopback display", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("ok"));
    const session = displaySession("http://127.0.0.1:5227/", fetcher);

    expect(session.token).toBeUndefined();
    await session.fetch("/api/themes");
    expect(fetcher).toHaveBeenCalledWith("/api/themes", undefined);
    expect(
      session.streamUrl("/ws", new URLSearchParams({ keys: "cpu.load" })),
    ).toBe("/ws?keys=cpu.load");
  });

  it("sends the paired token as a header on fetches", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("ok"));
    const session = displaySession(
      "http://192.168.1.10:5227/?session=abc123",
      fetcher,
    );

    expect(session.token).toBe("abc123");
    await session.fetch("/api/themes", { method: "GET" });

    const [, init] = fetcher.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).get("x-yunari-session")).toBe("abc123");
    expect(init?.method).toBe("GET");
  });

  it("carries no session parameter on a stream URL: the cookie is sent anyway", () => {
    const session = displaySession(
      "http://192.168.1.10:5227/?session=abc123",
      fetch,
    );

    const url = session.streamUrl(
      "/ws",
      new URLSearchParams({ keys: "cpu.load,ram.used" }),
    );

    expect(url).toBe("/ws?keys=cpu.load%2Cram.used");
    expect(url).not.toContain("session=");
  });

  it("returns a loader's URL unchanged, token or not", () => {
    const paired = displaySession(
      "http://192.168.1.10:5227/?session=abc123",
      fetch,
    );
    const loopback = displaySession("http://127.0.0.1:5227/", fetch);

    expect(paired.withToken("/api/themes/living-room/")).toBe(
      "/api/themes/living-room/",
    );
    expect(paired.withToken("/api/themes/x/assets/a.png?v=1")).toBe(
      "/api/themes/x/assets/a.png?v=1",
    );
    expect(loopback.withToken("/api/themes/living-room/")).toBe(
      "/api/themes/living-room/",
    );
  });
});

describe("what a load reads, and what it writes", () => {
  it("resolves the credential from the URL, and from storage when the URL carries none", () => {
    const storage = memoryStorage();
    const first = displaySession(
      "http://192.168.1.10:5227/?session=abc",
      fetch,
      storage,
    );

    expect(first.token).toBe("abc");

    // The record `rememberPairing` writes, and the only thing that makes the
    // second half of this case meaningful: a fresh pairing arrives with no
    // token in its URL once the host has exchanged it for a cookie.
    storePairing(storage, {
      hostId: "h1",
      hostName: "study-pc",
      port: 5227,
      token: "abc",
      lastAddress: "192.168.1.10",
    });

    const later = displaySession("http://192.168.1.10:5227/", fetch, storage);

    expect(later.token).toBe("abc");
  });

  it("writes no pairing of its own", () => {
    // The identity comes from `GET /api/host` and nowhere else: `pair.html`
    // exchanges its claimed token for a cookie and navigates to `/`, and
    // nothing in the repo emits `host=`, `name=` or `port=` (R72). A second
    // writer here could only produce a record with an empty `hostId`, which
    // would overwrite a good one on any load where `/api/host` failed.
    //
    // Asserted on the **raw key**, not through `readStoredPairing`: that reads
    // through `isPairedHost`, which refuses a blank `hostId`, so a reintroduced
    // writer would satisfy the case by being rejected later (R76). The case is
    // about whether a write happened, and only the key can answer that.
    const storage = memoryStorage();

    displaySession("http://192.168.1.10:5227/?session=abc", fetch, storage);

    expect(storage.getItem(PAIRING_STORAGE_KEY)).toBeNull();
  });

  it("lets a fresh pairing link replace a stored credential", () => {
    // Otherwise a display re-paired to a second host keeps the first one's
    // token, and answers a host that never issued it.
    const storage = memoryStorage();

    storePairing(storage, {
      hostId: "h1",
      hostName: "a",
      port: 5227,
      token: "first",
      lastAddress: "192.168.1.10",
    });

    const fresh = displaySession(
      "http://192.168.1.10:5227/?session=second",
      fetch,
      storage,
    );

    expect(fresh.token).toBe("second");
  });
});
