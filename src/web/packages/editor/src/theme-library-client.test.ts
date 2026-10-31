import type { FabricThemeEnvelope, FacetRecord } from "@yunari/renderer-core";
import { describe, expect, it, vi } from "vitest";
import {
  createThemeLibraryClient,
  ThemeConflictError,
  type ThemeLibraryClient,
  ThemeTooLargeError,
  ThemeValidationError,
} from "./theme-library-client.js";

const envelope: FabricThemeEnvelope = {
  schemaVersion: "2.0.0",
  fabricVersion: "7.4.0",
  id: "living-room",
  artboard: { width: 1920, height: 1080 },
  metadata: { name: "Living Room", themeLanguage: "en" },
  scene: { version: "7.4.0", objects: [] },
};

/** What the host derives for a listed theme, carried through unchanged. */
const FACETS: FacetRecord = {
  author: "Ada",
  colourMode: "dark",
  sensors: [],
  tags: [],
  orientation: "landscape",
  aspect: "16:9",
  width: 1920,
  height: 1080,
};

/** What a request body costs on the wire, which is the only size that matters. */
const bytes = (body: string): number => new TextEncoder().encode(body).length;

/** `remove` is optional on the interface, so a test that exercises it says it
 *  is here rather than reaching through `?.` at every call. */
function removing(client: ThemeLibraryClient): (id: string) => Promise<void> {
  const remove = client.remove;
  if (remove === undefined) throw new Error("this client cannot remove");
  return remove.bind(client);
}

describe("ThemeLibraryClient", () => {
  it("saves and opens a theme's content, not an archive", async () => {
    const content = {
      envelope,
      assets: { "assets/badge.svg": new TextEncoder().encode("<svg/>") },
    };
    const mockFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "PUT" && url === "/api/themes/living-room") {
          return new Response(
            JSON.stringify({ ok: true, base: "base-after-save" }),
            { status: 200 },
          );
        }
        if (url === "/api/themes/living-room") {
          return new Response(
            JSON.stringify({
              envelope,
              assets: {
                "assets/badge.svg": btoa("<svg/>"),
              },
              base: "base-as-stored",
            }),
            { status: 200 },
          );
        }
        return new Response("Not found", { status: 404 });
      },
    );

    const client = createThemeLibraryClient({
      fetch: mockFetch as unknown as typeof fetch,
    });

    await expect(client.save("living-room", content)).resolves.toBe(
      "base-after-save",
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/themes/living-room",
      expect.objectContaining({ method: "PUT" }),
    );
    // The seam the store depends on: the document rides as JSON and the
    // declared bytes as base64, keyed by the path the document declares.
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      envelope,
      assets: { "assets/badge.svg": btoa("<svg/>") },
      overwrite: false,
    });

    // What an open reports as stored is what the next save is based on, so
    // the two are the same value travelling back the way it came.
    await expect(client.open("living-room")).resolves.toEqual({
      ...content,
      base: "base-as-stored",
    });
  });

  it("carries the credits member both ways", async () => {
    const credits = {
      format: "yunari-theme-credits" as const,
      version: 1 as const,
      entries: [
        {
          kind: "icon",
          title: "Badge",
          license: "ISC v2",
          changes: "Imported unchanged",
        },
      ],
    };
    const mockFetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PUT") {
          return new Response(JSON.stringify({ base: "next" }), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({ envelope, assets: {}, credits }), {
          status: 200,
        });
      },
    );
    const client = createThemeLibraryClient({
      fetch: mockFetch as unknown as typeof fetch,
    });

    await client.save("living-room", { envelope, assets: {}, credits });
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ credits });

    await expect(client.open("living-room")).resolves.toMatchObject({
      credits,
    });
  });

  it("puts nothing on the wire for an asset the payload leaves out", async () => {
    // The last link in the chain, and the one that can be measured rather than
    // inferred: a save that carries no bytes for a declared asset produces a
    // body with no base64 in it, however large that asset was in the editor.
    const backdrop = new Uint8Array(448 * 1024).fill(7);
    const mockFetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ ok: true, base: "base-after-save" }), {
          status: 200,
        }),
    );
    const client = createThemeLibraryClient({
      fetch: mockFetch as unknown as typeof fetch,
    });

    const full = await (async () => {
      await client.save("living-room", {
        envelope: {
          ...envelope,
          metadata: { ...envelope.metadata, name: "1" },
        },
        assets: { "assets/backdrop.png": backdrop },
        base: "base-as-stored",
      });
      return String(mockFetch.mock.calls.at(-1)?.[1]?.body);
    })();

    const partial = await (async () => {
      await client.save("living-room", {
        envelope: {
          ...envelope,
          metadata: { ...envelope.metadata, name: "2" },
        },
        assets: {},
        base: "base-as-stored",
      });
      return String(mockFetch.mock.calls.at(-1)?.[1]?.body);
    })();

    // The document still declares the backdrop in both, and the base travels
    // in both — so the host is being told what it already has, not asked to
    // forget it. The 438 KB is simply not there the second time.
    const decoded = JSON.parse(partial) as {
      assets: Record<string, string>;
      base: string;
    };
    expect(Object.keys(decoded.assets)).toEqual([]);
    expect(decoded.base).toBe("base-as-stored");
    expect(bytes(partial)).toBeLessThan(bytes(full) / 100);
    expect(bytes(full)).toBeGreaterThan(448 * 1024);
  });

  it("lists themes with their metadata, their record and their picture", async () => {
    // The route's own shape: the author and the derived record travel with the
    // line, and the picture's address is built here because the client is what
    // knows the host's base URL.
    const mockFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          themes: [
            {
              id: "living-room",
              name: "Living Room",
              author: "Ada",
              updatedAt: "2026-09-19T00:00:00.000Z",
              facets: FACETS,
            },
          ],
        }),
        { status: 200 },
      );
    });

    const client = createThemeLibraryClient({
      baseUrl: "/host",
      fetch: mockFetch as unknown as typeof fetch,
    });
    const list = await client.list();
    expect(list).toEqual([
      {
        id: "living-room",
        name: "Living Room",
        author: "Ada",
        updatedAt: "2026-09-19T00:00:00.000Z",
        facets: FACETS,
        thumbnailUrl: "/host/api/themes/living-room/thumbnail",
      },
    ]);
  });

  it("throws descriptive error on save failure", async () => {
    const mockFetch = vi.fn(
      async () => new Response("Invalid package", { status: 400 }),
    );
    const client = createThemeLibraryClient({
      fetch: mockFetch as unknown as typeof fetch,
    });

    await expect(
      client.save("living-room", { envelope, assets: {} }),
    ).rejects.toThrow('Could not save theme "living-room" (400)');
  });

  it("reports a refused save as a conflict, not a failed one", async () => {
    const mockFetch = vi.fn(
      async () =>
        new Response('"living-room" was changed by someone else.', {
          status: 409,
        }),
    );
    const client = createThemeLibraryClient({
      fetch: mockFetch as unknown as typeof fetch,
    });

    // Its own error, because this is the one save failure the caller can act
    // on rather than retry: it is what lets the session offer reload or
    // overwrite instead of reporting an ordinary failure and giving up.
    const refusal = client.save("living-room", {
      envelope,
      assets: {},
      base: "the-base-it-opened",
    });
    await expect(refusal).rejects.toThrow(ThemeConflictError);
    await expect(refusal).rejects.toThrow("changed by someone else");

    // The base travels out, and an overwrite is an explicit, separate ask.
    const sentBody = (call: unknown): Record<string, unknown> => {
      const [, init] = call as [string, RequestInit];
      return JSON.parse(String(init?.body)) as Record<string, unknown>;
    };
    expect(sentBody(mockFetch.mock.calls[0])).toMatchObject({
      base: "the-base-it-opened",
      overwrite: false,
    });
    await client
      .save("living-room", { envelope, assets: {} }, { overwrite: true })
      .catch(() => undefined);
    expect(sentBody(mockFetch.mock.calls[1]).overwrite).toBe(true);
  });

  it("removes a theme with DELETE, and says why when it cannot", async () => {
    let deletes = 0;
    const mockFetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method !== "DELETE") {
          return new Response("Not found", { status: 404 });
        }
        deletes += 1;
        // The first delete lands; the second finds it already gone, which is a
        // different answer from "the host is unreachable" and needs its own word.
        return deletes === 1
          ? new Response(JSON.stringify({ ok: true }), { status: 200 })
          : new Response('No theme "living-room" in this library.', {
              status: 404,
            });
      },
    );
    const client = createThemeLibraryClient({
      fetch: mockFetch as unknown as typeof fetch,
    });

    const remove = removing(client);
    await remove("living-room");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/themes/living-room",
      expect.objectContaining({ method: "DELETE" }),
    );

    await expect(remove("living-room")).rejects.toThrow(
      'No theme "living-room"',
    );

    await expect(remove("../escape")).rejects.toThrow("Invalid theme id");
  });

  it("passes the host's own reason through when the trash refused", async () => {
    // Nothing was removed, so the message must not read like a lost document.
    // The platform's reason is the one the author can act on.
    const mockFetch = vi.fn(
      async () =>
        new Response(
          "This PC has no trash command (gio, trash-put), so the theme was left alone.",
          { status: 500 },
        ),
    );
    const client = createThemeLibraryClient({
      fetch: mockFetch as unknown as typeof fetch,
    });

    await expect(removing(client)("living-room")).rejects.toThrow(
      "no trash command",
    );
  });

  it("throws descriptive error on open failure", async () => {
    const mockFetch = vi.fn(
      async () => new Response("Not Found", { status: 404 }),
    );
    const client = createThemeLibraryClient({
      fetch: mockFetch as unknown as typeof fetch,
    });

    await expect(client.open("not-found")).rejects.toThrow(
      'Could not open theme "not-found" (404)',
    );
  });

  it("carries a stored theme that does not validate as its own error, with the issues", async () => {
    // vg-110: the host answers 422 for a theme that is there and does not
    // validate, where the 404 stays for one that is not — and the client has to
    // keep the two apart, because `openQuietly` cannot tell a document worth
    // reporting from a dead bookmark otherwise.
    const mockFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: '"broken" is stored but does not validate.',
            issues: [
              {
                code: "missing-field",
                path: "/schemaVersion",
                message:
                  "schemaVersion is required and must be major.minor.patch.",
              },
            ],
          }),
          { status: 422 },
        ),
    );
    const client = createThemeLibraryClient({
      fetch: mockFetch as unknown as typeof fetch,
    });

    const refusal = client.open("broken");
    await expect(refusal).rejects.toThrow(ThemeValidationError);
    await expect(refusal).rejects.toThrow("does not validate");
    const error = await refusal.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ThemeValidationError);
    expect((error as ThemeValidationError).issues[0]?.path).toBe(
      "/schemaVersion",
    );

    // The 404 is a different answer, and not this error.
    const notFound = createThemeLibraryClient({
      fetch: vi.fn(
        async () => new Response("Not Found", { status: 404 }),
      ) as unknown as typeof fetch,
    });
    await expect(notFound.open("gone")).rejects.not.toThrow(
      ThemeValidationError,
    );
  });

  it("carries a stored theme past the size bound as its own error, not a validation failure", async () => {
    // vg-409: the host answers 413 for a theme that is there and too large to
    // read, where the 404 stays for one that is not. Its own error rather than
    // the validation one above, because nothing about the document is invalid —
    // the validator never sees it.
    const mockFetch = vi.fn(
      async () =>
        new Response('"huge" is stored but larger than 32 MB.', {
          status: 413,
        }),
    );
    const client = createThemeLibraryClient({
      fetch: mockFetch as unknown as typeof fetch,
    });

    const refusal = client.open("huge");
    await expect(refusal).rejects.toThrow(ThemeTooLargeError);
    const error = await refusal.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ThemeTooLargeError);
    expect(error).not.toBeInstanceOf(ThemeValidationError);

    // The 404 is a different answer again, and neither of the two above.
    const notFound = createThemeLibraryClient({
      fetch: vi.fn(
        async () => new Response("Not Found", { status: 404 }),
      ) as unknown as typeof fetch,
    });
    await expect(notFound.open("gone")).rejects.not.toThrow(ThemeTooLargeError);
  });

  it("assigns to the display it was given, and to no other", async () => {
    const mockFetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({ ok: true, default: null, displays: [] }),
          { status: 200 },
        ),
    );
    const client = createThemeLibraryClient({
      fetch: mockFetch as unknown as typeof fetch,
    });

    await client.assign("kitchen-tablet", "kitchen-strip");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/themes/active",
      expect.objectContaining({ method: "PUT" }),
    );
    // Both keys, always: the route names the display from the body on loopback
    // and answers 400 "A display is required." without one, so a request that
    // left it out is refused rather than reaching this PC.
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      display: "kitchen-tablet",
      id: "kitchen-strip",
    });

    // `default` is a display key in its own right — what a display with no
    // choice of its own falls to — so it travels the same road.
    await client.assign("default", "kitchen-strip");
    const [, second] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(second.body))).toEqual({
      display: "default",
      id: "kitchen-strip",
    });
  });

  it("reports a refusal as the host's own message", async () => {
    const mockFetch = vi.fn(
      async () => new Response("No such display.", { status: 404 }),
    );
    const client = createThemeLibraryClient({
      fetch: mockFetch as unknown as typeof fetch,
    });

    // A bare status would leave the author guessing which of the two 404s this
    // is — an unknown display or an unknown theme.
    await expect(client.assign("ghost", "living-room")).rejects.toThrow(
      "No such display.",
    );
  });

  it("lists every display with the theme it holds, and the default beside them", async () => {
    const mockFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            default: "living-room",
            displays: [
              { id: "this-pc", label: "This PC", kind: "local", theme: null },
              {
                id: "kitchen-tablet",
                label: "Kitchen Tablet",
                kind: "paired",
                theme: "kitchen-strip",
              },
            ],
            themes: [],
            templates: [],
          }),
          { status: 200 },
        ),
    );
    const client = createThemeLibraryClient({
      fetch: mockFetch as unknown as typeof fetch,
    });

    // The route's own shape, unchanged: this PC first, a display holding nothing
    // of its own reading as `null`, and the default as its own field rather than
    // as a row — "what an unassigned display shows" is a theme id, not a display.
    // An answer with no shape reads as a rectangular, upright screen, which is
    // the store's own default for a record that cannot hold one.
    await expect(client.listDisplays()).resolves.toEqual({
      default: "living-room",
      displays: [
        {
          id: "this-pc",
          label: "This PC",
          kind: "local",
          theme: null,
          shape: "rect",
          rotation: 0,
        },
        {
          id: "kitchen-tablet",
          label: "Kitchen Tablet",
          kind: "paired",
          theme: "kitchen-strip",
          shape: "rect",
          rotation: 0,
        },
      ],
    });
    expect(mockFetch).toHaveBeenCalledWith("/api/themes/active");
  });

  it("reads a panel display's connection and its command kinds", async () => {
    const mockFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            default: null,
            displays: [
              {
                id: "panel-1",
                label: "TURZX 5",
                kind: "panel",
                theme: null,
                shape: "rect",
                rotation: 0,
                panel: {
                  status: "disconnected",
                  commands: ["brightness", "restart", 7],
                },
              },
            ],
          }),
          { status: 200 },
        ),
    );
    const client = createThemeLibraryClient({
      fetch: mockFetch as unknown as typeof fetch,
    });

    await expect(client.listDisplays()).resolves.toEqual({
      default: null,
      displays: [
        {
          id: "panel-1",
          label: "TURZX 5",
          kind: "panel",
          theme: null,
          shape: "rect",
          rotation: 0,
          panel: {
            status: "disconnected",
            commands: ["brightness", "restart"],
          },
        },
      ],
    });
  });

  it("leaves an unreadable panel state absent rather than inventing one", async () => {
    // A status this build does not know tells the owner nothing about the
    // device, so the row has no panel key at all instead of a guessed state.
    const mockFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            default: null,
            displays: [
              {
                id: "panel-1",
                label: "TURZX 5",
                kind: "panel",
                theme: null,
                shape: "rect",
                rotation: 0,
                panel: { status: "busy", commands: ["restart"] },
              },
            ],
          }),
          { status: 200 },
        ),
    );
    const client = createThemeLibraryClient({
      fetch: mockFetch as unknown as typeof fetch,
    });

    const { displays } = await client.listDisplays();
    expect(displays[0]).not.toHaveProperty("panel");
  });

  it("answers an empty map when the host names neither field", async () => {
    // A body with no display map is not a crash: the caller hears "nothing is
    // chosen and nothing is paired", which is what an absent field means.
    const mockFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ themes: [], templates: [] }), {
          status: 200,
        }),
    );
    const client = createThemeLibraryClient({
      fetch: mockFetch as unknown as typeof fetch,
    });

    await expect(client.listDisplays()).resolves.toEqual({
      default: null,
      displays: [],
    });
  });

  it("refuses a display map whose fields are the wrong type", async () => {
    // Present but wrong is not the same as absent: a `default` that is not a
    // theme id and a `displays` that is not a list are refused rather than
    // coerced, which is what a `??` would quietly stop doing.
    const mockFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ default: 5, displays: "nope" }), {
          status: 200,
        }),
    );
    const client = createThemeLibraryClient({
      fetch: mockFetch as unknown as typeof fetch,
    });

    await expect(client.listDisplays()).resolves.toEqual({
      default: null,
      displays: [],
    });
  });

  it("reports the host's own answer when the display map cannot be read", async () => {
    const mockFetch = vi.fn(
      async () =>
        new Response("This host keeps no active theme.", { status: 404 }),
    );
    const client = createThemeLibraryClient({
      fetch: mockFetch as unknown as typeof fetch,
    });

    // A host that keeps no active theme answers this, and it is not a list: the
    // caller has to hear it rather than be handed an empty map that reads as
    // "no displays are paired".
    await expect(client.listDisplays()).rejects.toThrow(
      "This host keeps no active theme.",
    );
  });

  it("refuses invalid theme IDs without fetching", async () => {
    const mockFetch = vi.fn();
    const client = createThemeLibraryClient({
      fetch: mockFetch as unknown as typeof fetch,
    });

    await expect(
      client.save("../escape", { envelope, assets: {} }),
    ).rejects.toThrow("Invalid theme id");
    await expect(client.open("../escape")).rejects.toThrow("Invalid theme id");
    await expect(client.assign("this-pc", "../escape")).rejects.toThrow(
      "Invalid theme id",
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
