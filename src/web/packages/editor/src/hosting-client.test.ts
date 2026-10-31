import { describe, expect, it, vi } from "vitest";
import {
  displayUrl,
  mintPairingCode,
  readHosting,
  readPairingCode,
} from "./hosting-client.js";

const answer = (
  url: string,
  body: unknown,
  init?: ResponseInit,
): typeof fetch =>
  vi.fn(
    async () => new Response(JSON.stringify(body), init),
  ) as unknown as typeof fetch;

describe("readHosting", () => {
  it("reads this machine's address and port", async () => {
    const read = await readHosting(
      answer("/api/hosting", {
        lan: true,
        address: "192.168.1.42",
        port: 5227,
        displays: [],
      }),
    );
    expect(read).toEqual({
      lan: true,
      address: "192.168.1.42",
      name: null,
      port: 5227,
      refusal: null,
    });
  });

  it("reads the name the host offers, and has one when it does", async () => {
    const read = await readHosting(
      answer("/api/hosting", {
        lan: true,
        address: "192.168.1.42",
        name: "study-pc.local",
        port: 5227,
        displays: [],
      }),
    );
    expect(read?.name).toBe("study-pc.local");
  });

  it("reads a refusal the host recorded against its last move", async () => {
    // A refused move cannot come back in the answer to the PUT that asked for
    // it — the host answers first and moves afterwards (vg-173) — so the
    // refusal is state the next read carries, in the host's own words.
    const read = await readHosting(
      answer("/api/hosting", {
        lan: false,
        address: null,
        port: 5227,
        refusal: "Port 5227 is not free on 0.0.0.0: EADDRINUSE",
        displays: [],
      }),
    );
    expect(read?.refusal).toBe("Port 5227 is not free on 0.0.0.0: EADDRINUSE");
  });

  it("answers nothing when no host is behind the editor", async () => {
    const missing = vi.fn(
      async () => new Response("", { status: 404 }),
    ) as unknown as typeof fetch;
    expect(await readHosting(missing)).toBeUndefined();
  });

  it("answers nothing for a body it cannot read", async () => {
    expect(
      await readHosting(answer("/api/hosting", { lan: "yes" })),
    ).toBeUndefined();
  });
});

describe("readPairingCode", () => {
  it("reads the code the host is showing, and mints nothing", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            code: "ABC234",
            expiresAt: "2026-10-18T10:10:00.000Z",
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;

    expect(await readPairingCode(fetcher)).toEqual({
      code: "ABC234",
      expiresAt: "2026-10-18T10:10:00.000Z",
    });
    // A GET, because a read that minted would answer a different code than the
    // window it just read — the same six characters a second reader has already
    // been shown would change under it.
    const call = (
      fetcher as unknown as {
        mock: { calls: [string, RequestInit | undefined][] };
      }
    ).mock.calls[0];
    expect(call?.[0]).toBe("/api/pairing/code");
    expect(call?.[1]).toBeUndefined();
  });

  it("answers nothing when the host has no code to show", async () => {
    const missing = vi.fn(
      async () => new Response("", { status: 404 }),
    ) as unknown as typeof fetch;
    expect(await readPairingCode(missing)).toBeUndefined();

    // A body with no code in it is the same absence: a card that printed a
    // blank would be showing a code that is not one.
    expect(
      await readPairingCode(answer("/api/pairing/code", { code: null })),
    ).toBeUndefined();
  });
});

describe("mintPairingCode", () => {
  it("is the POST that replaces the window, and reads the new code", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            code: "XYZ789",
            expiresAt: "2026-10-18T10:20:00.000Z",
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;

    expect(await mintPairingCode(fetcher)).toEqual({
      code: "XYZ789",
      expiresAt: "2026-10-18T10:20:00.000Z",
    });
    const call = (
      fetcher as unknown as {
        mock: { calls: [string, RequestInit | undefined][] };
      }
    ).mock.calls[0];
    expect(call?.[0]).toBe("/api/pairing/code");
    // The method is the whole difference from the read: only this rotates.
    expect(call?.[1]).toEqual({ method: "POST" });
  });

  it("answers nothing when the host refuses the mint", async () => {
    const refused = vi.fn(
      async () => new Response("", { status: 403 }),
    ) as unknown as typeof fetch;
    expect(await mintPairingCode(refused)).toBeUndefined();
  });
});

describe("displayUrl", () => {
  it("opens the page a camera-less display would have typed at, code and all", () => {
    // https, which is the origin the display is a secure context at — the wake
    // lock and fullscreen are gated on it.
    expect(displayUrl("192.168.1.42", 5227, "ABC234")).toBe(
      "https://192.168.1.42:5227/pair?code=ABC234",
    );
  });

  it("dials the stable name when the host named one, because an address moves", () => {
    // The credential and the storage a display keeps are scoped to the origin it
    // paired on, so a symbol that carried a dotted quad would make every DHCP
    // lease a re-pair. The host decides which host is
    // dialled; this only refuses to put the address back.
    expect(displayUrl("study-pc.local", 5227, "ABC234")).toBe(
      "https://study-pc.local:5227/pair?code=ABC234",
    );
  });
});
