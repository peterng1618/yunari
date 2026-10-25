import {
  type ChildProcess,
  type SpawnOptions,
  spawn,
} from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net, { type AddressInfo, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  CATALOGUE_ORIGIN,
  cataloguePackageUrl,
  createAssetResolver,
  DASHBOARD_THEME_KIND,
  decodeBatch,
  type FabricThemeEnvelope,
  formatSseEvent,
  SAMPLE_STREAM_PATH,
  type SampleEntry,
} from "@yunari/renderer-core";
import { writeThemePackage } from "@yunari/theme-package";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHostBinding, type HostBinding } from "./cli/hosting.js";
import { type ListenableServer, listenWithFallback } from "./cli/net.js";
import { CustomSourceProvider } from "./providers/custom/provider.js";
import { MAX_BOX_ART_BYTES } from "./providers/game/box-art.js";
import type { DeviceAssignment } from "./providers/lhm-mapping.js";
import { createArtworkCache } from "./providers/media/artwork.js";
import type { SampleContext, SensorProvider } from "./providers/provider.js";
import { ProviderRegistry } from "./providers/registry.js";
import { OPEN_METEO_BERLIN_CAPTURE } from "./providers/weather/open-meteo.fixture.js";
import { WeatherProvider } from "./providers/weather/provider.js";
import { createDisplayLauncher } from "./serve/display-launcher.js";
import {
  CA_CERTIFICATE_PATH,
  createHostServer,
  createPortListener,
  displayKeyFor,
  type HostingState,
  type HostServerOptions,
  MAX_STREAM_CONNECTIONS,
  MAX_STREAM_CONNECTIONS_PER_DISPLAY,
  MAX_STREAM_KEY_BYTES,
  MAX_STREAM_KEYS,
  MAX_THEME_UPLOAD_BYTES,
  resolveStoreOrigin,
  type SourceRouteOptions,
} from "./server.js";
import { newToken } from "./session/pairing.js";
import { createPairingCodeStore } from "./session/pairing-code.js";
import { createActiveThemeStore } from "./settings/active-theme.js";
import { createCredentialStore } from "./settings/credentials.js";
import {
  KNOWN_CREDENTIALS,
  type KnownCredential,
} from "./settings/credentials-registry.js";
import {
  ASSIGNABLE_GROUPS,
  createDeviceSettingsStore,
  type DeviceSettingsStore,
} from "./settings/devices.js";
import { createDisplaySettingsStore } from "./settings/display.js";
import {
  createDisplayStore,
  DEFAULT_DISPLAY,
  type DisplayRecord,
  type DisplayStore,
  hashToken,
  LOCAL_DISPLAY_ID,
} from "./settings/displays.js";
import { createFontFavoritesStore } from "./settings/font-favorites.js";
import type { HostRecord } from "./settings/host-record.js";
import type { Monitor } from "./settings/monitors.js";
import { createSourceStore, type SourceStore } from "./settings/sources.js";
import { createStoreSessionStore } from "./settings/store-session.js";
import { createThemeOriginsStore } from "./settings/theme-origins.js";
import { createThemeSettingsStore } from "./settings/theme-settings.js";
import {
  createWeatherSettingsStore,
  DEFAULT_WEATHER_SETTINGS,
  normalizeWeatherSettings,
  type WeatherSettingsStore,
} from "./settings/weather.js";
import {
  createThemeStore,
  type ThemeContent,
  ThemeTooLargeError,
} from "./themes/store.js";
import { createThumbnailStore } from "./themes/thumbnails.js";
import { TrashRefusal } from "./themes/trash.js";
import { encodeThemeContent } from "./themes/wire.js";
import { createSecureOrigin } from "./tls/authority.js";
import type { WallpaperEngineSource } from "./wallpaper-engine/source.js";

/**
 * A partial mock, so one batch's formatting is countable without a
 * production-only seam: every other export is the real one, and the formatter
 * still produces the bytes the connection tests expect.
 */
vi.mock("@yunari/renderer-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@yunari/renderer-core")>();
  return {
    ...actual,
    formatSseEvent: vi.fn(actual.formatSseEvent),
  };
});

/** The library is a folder, so a save is the document and its bytes (ADR-0017),
 *  plus what the client says the save is based on. */
function themeBody(
  content: ThemeContent,
  save?: { readonly base?: string; readonly overwrite?: boolean },
): string {
  return JSON.stringify({ ...encodeThemeContent(content), ...save });
}

function createValidPackage(
  id = "living-room",
  name = "Living Room",
  semanticKey?: string,
): ThemeContent {
  const envelope: FabricThemeEnvelope = {
    schemaVersion: "2.0.0",
    fabricVersion: "7.4.0",
    id,
    artboard: { width: 1920, height: 1080 },
    metadata: { name, themeLanguage: "en" },
    ...(semanticKey === undefined
      ? {}
      : {
          globals: {
            palette: {
              none: {
                name: "None",
                value: { kind: "solid" as const, color: "transparent" },
              },
              ink: {
                name: "Ink",
                value: { kind: "solid" as const, color: "#e8ecf3" },
              },
            },
            typePresets: {
              "11-400": {
                name: "Caption",
                value: {
                  family: "system-ui, sans-serif",
                  size: 22,
                  weight: "400",
                },
              },
            },
          },
        }),
    scene: {
      version: "7.4.0",
      objects:
        semanticKey === undefined
          ? []
          : [
              {
                type: "Textbox",
                version: "7.4.0",
                left: 40,
                top: 40,
                width: 200,
                height: 40,
                text: "--",
                id: "readout",
                yunariPaint: { fill: "palette.ink" },
                yunariText: {
                  runs: [
                    {
                      kind: "value" as const,
                      bindingId: "readout-value",
                      typePreset: "typePresets.11-400" as const,
                      style: { color: { ref: "palette.ink" as const } },
                    },
                  ],
                },
              },
            ],
    },
    // Which device slots a theme needs is derived from what it binds, so a
    // fixture can only ask for a slot by binding a key in that family.
    ...(semanticKey === undefined
      ? {}
      : { bindings: { readout: [{ id: "readout-value", semanticKey }] } }),
  };
  const result = writeThemePackage({ envelope, assets: {} });
  if (!result.ok) throw new Error(result.message);
  return { envelope, assets: {} };
}

/** The bytes an author hands the picker, written by the format's own writer. */
function packageBytes(
  content: ThemeContent,
  thumbnail?: Uint8Array,
): Uint8Array {
  const written = writeThemePackage({
    envelope: content.envelope,
    assets: content.assets,
    ...(thumbnail === undefined ? {} : { thumbnail }),
  });
  if (!written.ok) throw new Error(written.message);
  return written.bytes;
}

function createPackageWithAsset(
  path: string,
  bytes: readonly number[],
): ThemeContent {
  const envelope: FabricThemeEnvelope = {
    schemaVersion: "2.0.0",
    fabricVersion: "7.4.0",
    id: "living-room",
    artboard: { width: 1920, height: 1080 },
    metadata: { themeLanguage: "en" },
    scene: { version: "7.4.0", objects: [] },
    assets: [
      {
        id: "inter-400",
        kind: "font",
        path,
        family: "Inter",
        weight: 400,
        style: "normal",
        format: "woff2",
        sourceUrl: "https://example.test/inter.woff2",
        license: {
          name: "SIL Open Font License 1.1",
          url: "https://openfontlicense.org/",
        },
      } as never,
    ],
  };
  const assets = { [path]: new Uint8Array(bytes) };
  const result = writeThemePackage({ envelope, assets });
  if (!result.ok) throw new Error(result.message);
  return { envelope, assets };
}

function request(
  server: ListenableServer,
  method: string,
  urlPath: string,
  body?: Uint8Array | string,
  options?: { remoteAddress?: string; headers?: Record<string, string> },
): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  json: () => unknown;
  text: () => string;
}> {
  return new Promise((resolve) => {
    const req = new Readable({
      read() {
        if (body !== undefined) {
          this.push(
            typeof body === "string" ? Buffer.from(body) : Buffer.from(body),
          );
        }
        this.push(null);
      },
    }) as unknown as http.IncomingMessage;

    req.method = method;
    req.url = urlPath;
    // A real client always sends `Host`; the fake socket has none, so the loopback
    // default is the harness's, not a claim about the product.
    req.headers = { host: "127.0.0.1:5173", ...(options?.headers ?? {}) };
    if (body !== undefined) {
      req.headers["content-length"] = String(
        typeof body === "string" ? Buffer.byteLength(body) : body.byteLength,
      );
    }
    (req as { socket: { remoteAddress: string } }).socket = {
      remoteAddress: options?.remoteAddress ?? "127.0.0.1",
    };

    const chunks: Buffer[] = [];
    let statusCode = 200;
    const responseHeaders: Record<string, string | string[] | undefined> = {};

    const res = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    }) as unknown as http.ServerResponse;

    res.writeHead = ((
      status: number,
      headers?: http.OutgoingHttpHeaders | http.OutgoingHttpHeader[],
    ) => {
      statusCode = status;
      if (headers && !Array.isArray(headers)) {
        for (const [k, v] of Object.entries(headers)) {
          if (v !== undefined) responseHeaders[k.toLowerCase()] = v as string;
        }
      }
      return res;
    }) as unknown as typeof res.writeHead;

    res.setHeader = (
      name: string,
      value: number | string | readonly string[],
    ) => {
      responseHeaders[name.toLowerCase()] = value as string;
      return res;
    };

    res.end = ((data?: unknown) => {
      if (data) {
        chunks.push(Buffer.from(data as string | Uint8Array));
      }
      const buffer = Buffer.concat(chunks);
      resolve({
        status: statusCode,
        headers: responseHeaders,
        body: buffer,
        json: () => JSON.parse(buffer.toString("utf8")),
        text: () => buffer.toString("utf8"),
      });
      // A real response emits `finish` once its bytes are with the OS, and the
      // hosting route starts a binding move only then (vg-173). Without this
      // the fake response is one the route never moves after.
      res.emit("finish");
      return res;
    }) as unknown as typeof res.end;

    server.emit("request", req, res);
  });
}

/**
 * A request whose body has begun but not finished, so the route reading it is
 * still in flight. `started` resolves once the body has been asked for, which is
 * after the route has claimed whatever gate it reads through.
 */
function pendingRequest(
  server: ListenableServer,
  method: string,
  urlPath: string,
): {
  readonly started: Promise<void>;
  readonly answered: Promise<{ status: number; text: string }>;
  release(): void;
} {
  let begun: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    begun = resolve;
  });
  let pushed = false;
  let end: () => void = () => undefined;

  const req = new Readable({
    read() {
      // One chunk, then silence: another push on every `_read` would feed the
      // route an endless body and never hold anything still.
      if (!pushed) {
        pushed = true;
        end = () => this.push(null);
        this.push(Buffer.from([0]));
        begun();
      }
    },
  }) as unknown as http.IncomingMessage;

  req.method = method;
  req.url = urlPath;
  req.headers = { host: "127.0.0.1:5173" };
  (req as { socket: { remoteAddress: string } }).socket = {
    remoteAddress: "127.0.0.1",
  };

  const chunks: Buffer[] = [];
  let statusCode = 200;
  let finish: (value: { status: number; text: string }) => void = () =>
    undefined;
  const answered = new Promise<{ status: number; text: string }>((resolve) => {
    finish = resolve;
  });

  const res = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  }) as unknown as http.ServerResponse;

  res.writeHead = ((status: number) => {
    statusCode = status;
    return res;
  }) as unknown as typeof res.writeHead;

  res.end = ((data?: unknown) => {
    if (data) chunks.push(Buffer.from(data as string | Uint8Array));
    finish({
      status: statusCode,
      text: Buffer.concat(chunks).toString("utf8"),
    });
    res.emit("finish");
    return res;
  }) as unknown as typeof res.end;

  server.emit("request", req, res);

  return {
    started,
    answered,
    release: () => end(),
  };
}

/** Resolves as soon as headers are written, for a stream that stays open. */
function streamStatus(
  server: ListenableServer,
  urlPath: string,
  remoteAddress = "192.168.1.50",
): Promise<{ status: number; headers: Record<string, unknown> }> {
  return new Promise((resolve) => {
    const req = new Readable({
      read() {
        this.push(null);
      },
    }) as unknown as http.IncomingMessage;
    req.method = "GET";
    req.url = urlPath;
    req.headers = {};
    (req as { socket: { remoteAddress: string } }).socket = { remoteAddress };

    const res = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }) as unknown as http.ServerResponse;

    res.writeHead = ((status: number, headers?: http.OutgoingHttpHeaders) => {
      resolve({ status, headers: (headers ?? {}) as Record<string, unknown> });
      return res;
    }) as unknown as typeof res.writeHead;

    server.emit("request", req, res);
  });
}

/**
 * A provider that answers `gpu.temp` with the card it was told to read, so a
 * case can read the assignment a display was served off the frame it got.
 */
function assignmentEcho(): SensorProvider & {
  readonly assignments: DeviceAssignment[];
  readonly contexts: SampleContext[];
} {
  const assignments: DeviceAssignment[] = [];
  const contexts: SampleContext[] = [];

  return {
    id: "echo",
    label: "echo",
    assignments,
    contexts,
    describe: () =>
      Promise.resolve([
        {
          sensorId: "echo:gpu.temp",
          semanticKey: "gpu.temp",
          label: "GPU",
          tier: "baseline" as const,
        },
      ]),
    sample(semanticKeys, nowMs, context = {}) {
      const assignment = context.assignment ?? {};
      assignments.push(assignment);
      contexts.push(context);

      return Promise.resolve(
        semanticKeys
          .filter((key) => key === "gpu.temp")
          .map((semanticKey) => ({
            semanticKey,
            sample: {
              sensorId: "echo:gpu.temp",
              timestamp: new Date(nowMs).toISOString(),
              status: "ok" as const,
              textValue: assignment.gpu ?? "no card assigned",
            },
          })),
      );
    },
    health: () => ({ available: true }),
  };
}

/** A display's stream, holding every frame the host has written to it so far. */
function sampleStream(
  server: ListenableServer,
  urlPath: string,
  remoteAddress = "127.0.0.1",
  /** Called as each write lands, which is the moment a tick reached this stream. */
  onFrame: () => void = () => undefined,
): {
  readonly frames: () => string;
  /** Whether the host has ended this stream. */
  readonly ended: () => boolean;
  /** The client going away, as the socket would report it. */
  readonly leave: () => void;
} {
  const chunks: string[] = [];
  const req = new Readable({
    read() {
      this.push(null);
    },
  }) as unknown as http.IncomingMessage;
  req.method = "GET";
  req.url = urlPath;
  req.headers = {};
  (req as { socket: { remoteAddress: string } }).socket = { remoteAddress };

  const res = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      onFrame();
      callback();
    },
  }) as unknown as http.ServerResponse;

  res.writeHead = (() => res) as unknown as typeof res.writeHead;
  server.emit("request", req, res);

  return {
    frames: () => chunks.join(""),
    ended: () => res.writableEnded,
    leave: () => req.emit("close"),
  };
}

/** The newest frame's payload, or "" before the first tick reached it. */
function lastFrame(frames: string): string {
  const data = frames.split("\n").filter((line) => line.startsWith("data: "));

  return data.at(-1)?.slice("data: ".length) ?? "";
}

/** The card a display's own frame names, once a tick has offered one. */
async function servedCard(stream: {
  frames: () => string;
}): Promise<string | undefined> {
  await vi.waitFor(() => expect(lastFrame(stream.frames())).not.toBe(""));

  const decoded = decodeBatch(lastFrame(stream.frames()));

  if (!decoded.ok) {
    throw new Error(decoded.reason);
  }

  return decoded.batch.samples.find((entry) => entry.semanticKey === "gpu.temp")
    ?.sample.textValue;
}

describe("The store origin a host will talk to", () => {
  it("accepts the compiled catalogue origin and nothing else on the internet", () => {
    expect(resolveStoreOrigin(CATALOGUE_ORIGIN)).toBe(CATALOGUE_ORIGIN);
    expect(resolveStoreOrigin("http://evil.example")).toBeUndefined();
    expect(resolveStoreOrigin("https://evil.example")).toBeUndefined();
    expect(
      resolveStoreOrigin("http://yunari-store.workers.dev"),
    ).toBeUndefined();
  });

  it("accepts a loopback address as a test origin", () => {
    expect(resolveStoreOrigin("http://127.0.0.1:8787")).toBe(
      "http://127.0.0.1:8787",
    );
    expect(resolveStoreOrigin("http://localhost:8787")).toBe(
      "http://localhost:8787",
    );
    expect(resolveStoreOrigin("http://192.168.1.10:8787")).toBeUndefined();
  });

  it("keeps an absent value absent", () => {
    expect(resolveStoreOrigin(undefined)).toBeUndefined();
    expect(resolveStoreOrigin("")).toBeUndefined();
    expect(resolveStoreOrigin("not a url")).toBeUndefined();
  });
});

describe("Host theme routes", () => {
  let tmpDir: string;
  let hosted: ReturnType<typeof createHostServer>;
  let validEmptyAssetTheme: ThemeContent;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "yunari-host-theme-test-"),
    );
    validEmptyAssetTheme = createValidPackage("living-room", "Living Room");
    const store = createThemeStore(tmpDir);
    hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: tmpDir, editor: tmpDir },
      themeStore: store,
      // The picture's owner, so an import's thumbnail half is reachable here
      // rather than only in the store's own suite.
      thumbnails: createThumbnailStore(tmpDir),
    });
  });

  afterEach(async () => {
    await hosted.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("handles theme save, list, document fetch, and package fetch", async () => {
    const putRes = await request(
      hosted.server,
      "PUT",
      "/api/themes/living-room",
      themeBody(validEmptyAssetTheme),
    );
    expect(putRes.status).toBe(200);

    const listRes = await request(hosted.server, "GET", "/api/themes");
    expect(listRes.status).toBe(200);
    const listData = listRes.json() as {
      themes: readonly { id: string; name: string }[];
    };
    expect(listData.themes).toEqual([
      {
        id: "living-room",
        name: "Living Room",
        updatedAt: expect.any(String),
        // What the theme costs a display, read from the document the listing
        // already parsed: this one carries no video background and no glass.
        costs: [],
        // And what it *is*, derived from the same document — which is the whole
        // claim of the task: the route already answers `themeStore.list()`, so
        // the record travels with no change to `server.ts`.
        facets: {
          author: undefined,
          colourMode: "unclassified",
          sensors: [],
          tags: [],
          orientation: "landscape",
          aspect: "16:9",
          width: 1920,
          height: 1080,
        },
      },
    ]);

    const docRes = await request(
      hosted.server,
      "GET",
      "/api/themes/living-room/document",
    );
    expect(docRes.status).toBe(200);
    expect(docRes.headers["content-type"]).toContain("application/json");
    const docData = docRes.json() as FabricThemeEnvelope;
    expect(docData.id).toBe("living-room");
    expect(docData.schemaVersion).toBe("2.0.0");

    // What a save put in the folder, an open takes out again.
    const openRes = await request(
      hosted.server,
      "GET",
      "/api/themes/living-room",
    );
    expect(openRes.status).toBe(200);
    // An open answers with what is stored plus the base that names it, so the
    // next save can say which version it was built from.
    const { base, ...content } = openRes.json() as { base: string };
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(content).toEqual(encodeThemeContent(validEmptyAssetTheme));
  });

  it("answers a stored theme that does not validate with 422, and an absent one with 404", async () => {
    // vg-110: the store answered the same `undefined` for a theme that is not
    // there and one that is there and does not validate, so both were a 404 and
    // the author was told a theme they can see on disk does not exist. The two
    // facts are different answers now — 422 carrying the validator's issues,
    // 404 for the id that is not there (ADR-0043).
    await fs.mkdir(path.join(tmpDir, "broken"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "broken", "theme.json"),
      JSON.stringify({ id: "broken" }),
    );

    const broken = await request(hosted.server, "GET", "/api/themes/broken");
    expect(broken.status).toBe(422);
    const body = broken.json() as { issues: readonly { path: string }[] };
    expect(body.issues[0]?.path).toBe("/schemaVersion");

    expect(
      (await request(hosted.server, "GET", "/api/themes/absent")).status,
    ).toBe(404);

    // A display's document route treats it as absent, not as a server fault —
    // a corrupt theme must not turn a page into a 500.
    expect(
      (await request(hosted.server, "GET", "/api/themes/broken/document"))
        .status,
    ).toBe(404);

    // And it is not a library line.
    const list = (
      await request(hosted.server, "GET", "/api/themes")
    ).json() as {
      themes: readonly { id: string }[];
    };
    expect(list.themes.map((entry) => entry.id)).not.toContain("broken");
  });

  it("answers a stored theme past the size bound with 413, and keeps 404 for an absent one", async () => {
    // vg-409: an over-large `theme.json` was answered as absence, so the author
    // was told a theme they can see on disk does not exist and the editor
    // reported success over it. The size refusal is its own answer now — 413,
    // the status every other themes route gives an over-large thing — while
    // every reader that can serve neither still sees the absence (0043, 0084).
    const document = JSON.stringify(validEmptyAssetTheme.envelope);
    await fs.mkdir(path.join(tmpDir, "oversized"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "oversized", "theme.json"),
      document + " ".repeat(33 * 1024 * 1024 - document.length),
    );

    const oversized = await request(
      hosted.server,
      "GET",
      "/api/themes/oversized",
    );
    expect(oversized.status).toBe(413);
    // The refusal names the bound the author has to get under, which is the
    // half a bare status would not carry.
    expect(oversized.text()).toContain("33,554,432 bytes");

    // A display's document route treats it as absent, like a corrupt theme: it
    // can serve neither, and neither may turn a page into a 500.
    expect(
      (await request(hosted.server, "GET", "/api/themes/oversized/document"))
        .status,
    ).toBe(404);

    // And it is not a library line.
    const list = (
      await request(hosted.server, "GET", "/api/themes")
    ).json() as {
      themes: readonly { id: string }[];
    };
    expect(list.themes.map((entry) => entry.id)).not.toContain("oversized");
  });

  it("answers a save past the size bound with 413, not a blamed request", async () => {
    // The write cap is new, so this refusal is reachable from a save for the
    // first time: the document is well-formed and the author has to make it
    // smaller, which is the same 413 the GET of such a stored theme answers.
    // A stub store rejects exactly the error the cap raises, so the route's
    // mapping is what is under test rather than the store producing a 32 MB
    // document per run.
    const refusing = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: tmpDir, editor: tmpDir },
      themeStore: {
        ...createThemeStore(path.join(tmpDir, "stub")),
        write: () => Promise.reject(new ThemeTooLargeError("living-room")),
      },
    });

    try {
      const refused = await request(
        refusing.server,
        "PUT",
        "/api/themes/living-room",
        themeBody(validEmptyAssetTheme),
      );

      expect(refused.status).toBe(413);
      // The author is told the bound, which is the half a bare status lacks.
      expect(refused.text()).toContain("33,554,432 bytes");
    } finally {
      await refusing.close();
    }
  });

  it("refuses a save built from a document the stored theme has moved past", async () => {
    // Two tabs open the same theme; the first one saves an edit.
    const opened = await request(
      hosted.server,
      "PUT",
      "/api/themes/living-room",
      themeBody(validEmptyAssetTheme),
    );
    const { base } = opened.json() as { base: string };
    const edited = createValidPackage("living-room", "Living Room, edited");
    expect(
      (
        await request(
          hosted.server,
          "PUT",
          "/api/themes/living-room",
          themeBody(edited, { base }),
        )
      ).status,
    ).toBe(200);

    // The second tab saves the document it opened. 409, not 400: nothing was
    // wrong with the theme, the author is just behind, and the answer has to
    // say which it was.
    const stale = await request(
      hosted.server,
      "PUT",
      "/api/themes/living-room",
      themeBody(validEmptyAssetTheme, { base }),
    );
    expect(stale.status).toBe(409);
    expect(stale.text()).toContain("changed by someone else");

    const stored = (
      await request(hosted.server, "GET", "/api/themes/living-room")
    ).json() as {
      envelope: { metadata?: { name?: string } };
    };
    expect(stored.envelope.metadata?.name).toBe("Living Room, edited");

    // Overwriting is the author's decision, and it is a second, separate save.
    const forced = await request(
      hosted.server,
      "PUT",
      "/api/themes/living-room",
      themeBody(validEmptyAssetTheme, { base, overwrite: true }),
    );
    expect(forced.status).toBe(200);
    expect(
      (await request(hosted.server, "GET", "/api/themes/living-room")).json(),
    ).toMatchObject({ envelope: { metadata: { name: "Living Room" } } });
  });

  it("refuses a stale partial save, and a partial save that stands the guard down", async () => {
    // A save may leave an asset out and name only the base it was built from —
    // so the pair is the whole claim, and both halves of it are what has to be
    // checked over the wire, not only in the store.
    const bytes = new TextEncoder().encode("<svg/>");
    const content: ThemeContent = {
      envelope: {
        ...validEmptyAssetTheme.envelope,
        assets: [
          {
            id: "badge",
            kind: "svg",
            path: "assets/badge.svg",
            sha256: createHash("sha256").update(bytes).digest("hex"),
          } as never,
        ],
      },
      assets: { "assets/badge.svg": bytes },
    };
    const opened = await request(
      hosted.server,
      "PUT",
      "/api/themes/living-room",
      themeBody(content),
    );
    const { base } = opened.json() as { base: string };

    // A second tab saves over it, and the badge with it.
    const theirs = await request(
      hosted.server,
      "PUT",
      "/api/themes/living-room",
      themeBody(
        {
          ...content,
          envelope: {
            ...content.envelope,
            metadata: { name: "Edited elsewhere", themeLanguage: "en" },
          },
        },
        { base },
      ),
    );
    expect(theirs.status).toBe(200);

    // The stale tab sends no bytes at all for the badge it believes the folder
    // holds. 409, exactly as it would have been with them: a short payload is
    // not a way past the guard, it is only a way to have said less.
    const stale = await request(
      hosted.server,
      "PUT",
      "/api/themes/living-room",
      themeBody({ envelope: content.envelope, assets: {} }, { base }),
    );
    expect(stale.status).toBe(409);
    expect(stale.text()).toContain("changed by someone else");
    // Nothing was written, so the other author's theme is still the one stored.
    expect(
      (
        (
          await request(hosted.server, "GET", "/api/themes/living-room")
        ).json() as { envelope: { metadata?: { name?: string } } }
      ).envelope.metadata?.name,
    ).toBe("Edited elsewhere");

    // The other road past the guard is not a road a short payload may take:
    // what is on disk is no longer the document that save came from.
    const forced = await request(
      hosted.server,
      "PUT",
      "/api/themes/living-room",
      themeBody(
        { envelope: content.envelope, assets: {} },
        {
          base,
          overwrite: true,
        },
      ),
    );
    expect(forced.status).toBe(400);
    expect(forced.text()).toContain("exactly match");

    // And on the base the save *is* built from, that same empty payload is a
    // whole theme: the asset comes from the folder, not from the wire.
    const fresh = await request(
      hosted.server,
      "PUT",
      "/api/themes/living-room",
      themeBody(
        { envelope: content.envelope, assets: {} },
        { base: (theirs.json() as { base: string }).base },
      ),
    );
    expect(fresh.status).toBe(200);
    expect(
      (await request(hosted.server, "GET", "/api/themes/living-room")).json(),
    ).toMatchObject({ assets: { "assets/badge.svg": btoa("<svg/>") } });
  });

  it("refuses a malformed base rather than saving without one", async () => {
    await request(
      hosted.server,
      "PUT",
      "/api/themes/living-room",
      themeBody(validEmptyAssetTheme),
    );
    // Dropping a base that is not a string would turn the client's bug into
    // exactly the ungated write the base is here to prevent.
    const res = await request(
      hosted.server,
      "PUT",
      "/api/themes/living-room",
      JSON.stringify({
        ...encodeThemeContent(validEmptyAssetTheme),
        base: 42,
      }),
    );
    expect(res.status).toBe(400);
    expect(res.text()).toContain("base is not a string");
  });

  it("answers a theme it will not store with the same 413 it already used, and the reason", async () => {
    await request(
      hosted.server,
      "PUT",
      "/api/themes/living-room",
      themeBody(validEmptyAssetTheme),
    );
    const document = validEmptyAssetTheme.envelope;

    // 413 is what this route already answers an oversized body with, so the
    // refusal is a shape the client has seen: a well-formed theme the store
    // will not hold, not a malformed request and not a conflict.
    const tooMany = await request(
      hosted.server,
      "PUT",
      "/api/themes/living-room",
      themeBody({
        envelope: {
          ...document,
          assets: Array.from({ length: 129 }, (_unused, index) => ({
            id: `asset-${index}`,
            kind: "image",
            path: `assets/a${index}.png`,
          })),
        },
        assets: Object.fromEntries(
          Array.from({ length: 129 }, (_unused, index) => [
            `assets/a${index}.png`,
            new Uint8Array(1),
          ]),
        ),
      }),
    );
    expect(tooMany.status).toBe(413);
    expect(tooMany.text()).toContain("at most 128");

    // Nothing was stored, so the theme that was there is still openable.
    expect(
      (await request(hosted.server, "GET", "/api/themes/living-room")).status,
    ).toBe(200);
  });

  it("serves the URL a display's asset resolver builds for a declared path", async () => {
    await request(
      hosted.server,
      "PUT",
      "/api/themes/living-room",
      themeBody(createPackageWithAsset("assets/inter-400.woff2", [1, 2])),
    );

    // The seam, exercised from both ends: the declarations the host publishes
    // go through the resolver the player uses, and the URL it produces is the
    // one the host has to answer. A route and a resolver that spell the
    // request differently cannot both satisfy this.
    const doc = (
      await request(hosted.server, "GET", "/api/themes/living-room/document")
    ).json() as FabricThemeEnvelope;
    const resolve = createAssetResolver(doc.assets, {
      baseUrl: "/api/themes/living-room/",
    });
    const url = resolve("inter-400");
    expect(url).toBe("/api/themes/living-room/assets/inter-400.woff2");

    const asset = await request(hosted.server, "GET", url ?? "");
    expect(asset.status).toBe(200);
    expect([...asset.body]).toEqual([1, 2]);
    // A browser decodes an image only if the response says it is one.
    expect(asset.headers["content-type"]).toBe("font/woff2");
    // Nothing this route answers is a document: the declared kind decided the
    // media type, so the browser must not redecide it by sniffing.
    expect(asset.headers["x-content-type-options"]).toBe("nosniff");
    expect(asset.headers["content-security-policy"]).toBe(
      "sandbox; default-src 'none'",
    );
  });

  it("serves one declared asset by reading that asset alone", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-asset-read-"));
    const store = createThemeStore(dir);
    await store.write(
      "living-room",
      createPackageWithAsset("assets/inter-400.woff2", [1, 2]),
    );
    const readAsset = vi.fn((id: string, assetPath: string) =>
      store.readAsset(id, assetPath),
    );
    const readEnvelope = vi.fn((id: string) => store.readEnvelope(id));
    const read = vi.fn((id: string) => store.read(id));
    const hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: dir, editor: dir },
      themeStore: { ...store, readAsset, readEnvelope, read },
    });

    try {
      const asset = await request(
        hosted.server,
        "GET",
        "/api/themes/living-room/assets/inter-400.woff2",
      );
      expect(asset.status).toBe(200);
      expect([...asset.body]).toEqual([1, 2]);
      expect(asset.headers["content-type"]).toBe("font/woff2");
      // Exactly one file, named exactly as the document declares it — not the
      // whole theme read back to pick one asset out of it.
      expect(readAsset).toHaveBeenCalledTimes(1);
      expect(readAsset).toHaveBeenCalledWith(
        "living-room",
        "assets/inter-400.woff2",
      );
      // The route never reads the envelope at this level: the declared path and
      // kind come back from `readAsset` itself.
      expect(readEnvelope).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
    } finally {
      await hosted.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("serves the theme document without reading a single asset", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-doc-read-"));
    const store = createThemeStore(dir);
    await store.write(
      "living-room",
      createPackageWithAsset("assets/inter-400.woff2", [1, 2]),
    );
    const readEnvelope = vi.fn((id: string) => store.readEnvelope(id));
    const readAsset = vi.fn((id: string, assetPath: string) =>
      store.readAsset(id, assetPath),
    );
    const read = vi.fn((id: string) => store.read(id));
    const hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: dir, editor: dir },
      themeStore: { ...store, readEnvelope, readAsset, read },
    });

    try {
      const doc = await request(
        hosted.server,
        "GET",
        "/api/themes/living-room/document",
      );
      expect(doc.status).toBe(200);
      expect((doc.json() as FabricThemeEnvelope).id).toBe("living-room");
      expect(readEnvelope).toHaveBeenCalledTimes(1);
      expect(readEnvelope).toHaveBeenCalledWith("living-room");
      expect(readAsset).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
    } finally {
      await hosted.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses undeclared and traversal-like asset paths", async () => {
    await request(
      hosted.server,
      "PUT",
      "/api/themes/living-room",
      themeBody(createPackageWithAsset("assets/inter-400.woff2", [1, 2])),
    );

    const status = (path: string): Promise<number> =>
      request(hosted.server, "GET", path).then((res) => res.status);

    // A well-formed package path the theme never declared.
    await expect(
      status("/api/themes/living-room/assets/assets/missing.woff2"),
    ).resolves.toBe(404);
    // A path under a theme the library does not hold is the same 404.
    await expect(
      status("/api/themes/absent/assets/assets/missing.woff2"),
    ).resolves.toBe(404);
    // `..` cannot walk out of the package: the lookup is by declared path, so a
    // traversal decodes to something the theme does not declare.
    await expect(
      status("/api/themes/living-room/assets/assets/..%2F..%2Fsecret"),
    ).resolves.toBe(404);
    await expect(
      status("/api/themes/living-room/assets/assets/..%2Fsecret"),
    ).resolves.toBe(404);
    // A `.` segment is refused the same way.
    await expect(
      status("/api/themes/living-room/assets/assets/.%2Fsecret"),
    ).resolves.toBe(404);
  });

  it("refuses an asset whose declared kind contradicts its extension", async () => {
    // Import refuses this package, so the route is reached the only way a
    // library written before that refusal can reach it: a stored record whose
    // declaration the current validator would reject. Validation is not
    // weakened to make this a round trip.
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), "yunari-host-mime-test-"),
    );
    const store = createThemeStore(dir);
    await store.write(
      "living-room",
      createPackageWithAsset("assets/inter-400.woff2", [1, 2]),
    );

    let declaredPath = "";
    const themeStore = {
      ...store,
      // The route takes the MIME from the kind this read answers, so a lying
      // declaration is expressed here rather than in the folder — where the
      // current validator would have refused it.
      readAsset: async (_id: string, assetPath: string) =>
        assetPath === declaredPath
          ? { bytes: new Uint8Array([1]), kind: "image" as const }
          : undefined,
    };
    const lying = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: dir, editor: dir },
      themeStore,
    });

    try {
      for (const assetPath of ["assets/x.html", "assets/x.js"]) {
        declaredPath = assetPath;
        const res = await request(
          lying.server,
          "GET",
          `/api/themes/living-room/${assetPath}`,
        );
        // 415, not 200 with a media type the kind never declared.
        expect(res.status).toBe(415);
        expect(res.headers["content-type"]).toBe("text/plain; charset=utf-8");
        expect(res.text()).toBe("That asset's kind and path disagree.");
      }
    } finally {
      await lying.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("forbids PUT from non-loopback addresses (§7)", async () => {
    const res = await request(
      hosted.server,
      "PUT",
      "/api/themes/living-room",
      themeBody(validEmptyAssetTheme),
      {
        remoteAddress: "10.0.0.2",
      },
    );
    expect(res.status).toBe(403);
  });

  it("moves a theme to the trash on DELETE, and takes it out of the listing", async () => {
    const trashed: string[] = [];
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), "yunari-host-delete-test-"),
    );
    // The real trash is a child process and a real recycle bin; what is under
    // test here is the route and the store's decision, so the platform is
    // replaced with a rename into a scratch folder beside the library.
    const store = createThemeStore(dir, {
      trash: async (folder: string) => {
        trashed.push(folder);
        await fs.mkdir(path.join(dir, ".trashed"), { recursive: true });
        await fs.rename(
          folder,
          path.join(dir, ".trashed", path.basename(folder)),
        );
      },
    });
    const deleting = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: dir, editor: dir },
      themeStore: store,
    });

    try {
      await request(
        deleting.server,
        "PUT",
        "/api/themes/living-room",
        themeBody(validEmptyAssetTheme),
      );
      const res = await request(
        deleting.server,
        "DELETE",
        "/api/themes/living-room",
      );

      expect(res.status).toBe(200);
      // The route hands the folder to the trash and does nothing else itself,
      // which is the whole recovery claim (docs/decisions/0021).
      expect(trashed).toEqual([path.join(dir, "living-room")]);
      const list = await request(deleting.server, "GET", "/api/themes");
      expect(
        (list.json() as { themes: readonly { id: string }[] }).themes,
      ).toEqual([]);
    } finally {
      await deleting.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("forbids DELETE from non-loopback, and 404s a theme it will not remove", async () => {
    await request(
      hosted.server,
      "PUT",
      "/api/themes/living-room",
      themeBody(validEmptyAssetTheme),
    );

    // Removing authored work is this PC's business, like saving it.
    expect(
      (
        await request(
          hosted.server,
          "DELETE",
          "/api/themes/living-room",
          undefined,
          {
            remoteAddress: "10.0.0.2",
          },
        )
      ).status,
    ).toBe(403);
    // A folder the listing would never have shown is a 404, not a removal.
    expect(
      (await request(hosted.server, "DELETE", "/api/themes/never-existed"))
        .status,
    ).toBe(404);
    expect(
      (await request(hosted.server, "DELETE", "/api/themes/..%2Fescape"))
        .status,
    ).toBe(400);
    // Still there: the refusals above cost nothing.
    expect(
      (await request(hosted.server, "GET", "/api/themes/living-room")).status,
    ).toBe(200);
  });

  describe("The listing carries an origin, and a deleted theme takes its own with it", () => {
    let originsDir: string;
    let libraryDir: string;
    let origins: ReturnType<typeof createThemeOriginsStore>;
    let listing: ReturnType<typeof createHostServer>;

    // Two directories, because the two facts live apart: the theme is the
    // author's work, and where the copy came from is this machine's own record.
    beforeEach(async () => {
      originsDir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-origins-"));
      libraryDir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-library-"));
      origins = createThemeOriginsStore(originsDir);
      listing = createHostServer({
        registry: new ProviderRegistry([]),
        bundles: { player: libraryDir, editor: libraryDir },
        // The real trash is a child process and a real recycle bin; the route
        // and the sweep are what is under test, so it is a rename aside.
        themeStore: createThemeStore(libraryDir, {
          trash: async (folder: string) => {
            await fs.mkdir(path.join(libraryDir, ".trashed"), {
              recursive: true,
            });
            await fs.rename(
              folder,
              path.join(libraryDir, ".trashed", path.basename(folder)),
            );
          },
        }),
        themeOrigins: origins,
      });
    });

    afterEach(async () => {
      await listing.close();
      await fs.rm(originsDir, { recursive: true, force: true });
      await fs.rm(libraryDir, { recursive: true, force: true });
    });

    /** One entry of the listing, by id. */
    async function listedEntry(id: string): Promise<Record<string, unknown>> {
      const body = (
        await request(listing.server, "GET", "/api/themes")
      ).json() as { themes: readonly Record<string, unknown>[] };
      const entry = body.themes.find((theme) => theme.id === id);

      if (entry === undefined) throw new Error(`No "${id}" in the listing.`);

      return entry;
    }

    /** The origin a case installs, so the assertions compare one value. */
    const origin = {
      catalogueId: "aurora",
      version: "1.2.0",
      installedAt: "2026-10-21T09:00:00.000Z",
    };

    async function saveTheme(): Promise<void> {
      await request(
        listing.server,
        "PUT",
        "/api/themes/living-room",
        themeBody(validEmptyAssetTheme),
      );
    }

    /** A theme whose id names a member of `Object.prototype`, which is legal. */
    async function savePrototypeTheme(): Promise<void> {
      await request(
        listing.server,
        "PUT",
        "/api/themes/__proto__",
        themeBody(createValidPackage("__proto__", "Prototype")),
      );
    }

    it("joins an origin onto the theme it names", async () => {
      await saveTheme();
      await origins.write("living-room", origin);

      expect((await listedEntry("living-room")).origin).toEqual(origin);
    });

    it("leaves a theme with no origin with no origin key, not an empty one", async () => {
      await saveTheme();

      // What this guards is the shape, not the absence: the listing goes over
      // the wire through `JSON.stringify`, which drops an `undefined`-valued
      // key, so a `null` or `{}` origin is what would reach a reader here.
      expect(Object.hasOwn(await listedEntry("living-room"), "origin")).toBe(
        false,
      );
    });

    it("carries no origin for a theme id that names a prototype member", async () => {
      // `__proto__` is a legal theme id, and reading a map by key reaches the
      // prototype chain: an id that happens to name a member of
      // `Object.prototype` must not be answered with that member as its origin,
      // which is what `{"id":"__proto__","origin":{}}` on the wire would be.
      await savePrototypeTheme();

      expect(Object.hasOwn(await listedEntry("__proto__"), "origin")).toBe(
        false,
      );
    });

    it("carries the origin for a theme id that names a prototype member", async () => {
      // The other direction, and the reason the rule is an own-property check
      // rather than a refusal of the id: this theme *has* an origin, and a
      // lookup that answered only for ids no prototype names would drop it.
      await savePrototypeTheme();
      await origins.write("__proto__", origin);

      expect((await listedEntry("__proto__")).origin).toEqual(origin);
    });

    it("does not fail the listing when an origin names a theme that is gone", async () => {
      await saveTheme();
      await origins.write("ghost", origin);

      const res = await request(listing.server, "GET", "/api/themes");

      expect(res.status).toBe(200);
      expect(
        (res.json() as { themes: readonly { id: string }[] }).themes.map(
          (theme) => theme.id,
        ),
      ).toEqual(["living-room"]);
      // The join runs from the listing, so an entry for a theme that is gone
      // reaches no response — it is not pruned out of one.
      expect(Object.hasOwn(await listedEntry("living-room"), "origin")).toBe(
        false,
      );
    });

    it("removes a theme's origin with the theme", async () => {
      await saveTheme();
      await origins.write("living-room", origin);

      expect(
        (await request(listing.server, "DELETE", "/api/themes/living-room"))
          .status,
      ).toBe(200);
      expect(await origins.read()).toEqual({});
    });

    it("keeps the origin when the removal failed", async () => {
      await origins.write("living-room", origin);

      expect(
        (await request(listing.server, "DELETE", "/api/themes/living-room"))
          .status,
      ).toBe(404);
      // Nothing was removed, so nothing was swept: the origin is a fact about a
      // copy that is still on disk.
      expect(await origins.read()).toEqual({ "living-room": origin });
    });
  });

  it("imports a package into the library, and never over a theme already there", async () => {
    await request(
      hosted.server,
      "PUT",
      "/api/themes/living-room",
      themeBody(createValidPackage("living-room", "Living Room, mine")),
    );
    const mineBefore = await fs.readFile(
      path.join(tmpDir, "living-room", "theme.json"),
    );

    const imported = await request(
      hosted.server,
      "POST",
      "/api/themes/import",
      packageBytes(validEmptyAssetTheme),
    );

    expect(imported.status).toBe(200);
    // The id it landed under, and not the taken one: an import is additive, so
    // the second entry is visible where a replace would be silent.
    expect(imported.json()).toEqual({ ok: true, id: "living-room-2" });
    // The author's theme is the same bytes, not merely a document that parses.
    expect(
      await fs.readFile(path.join(tmpDir, "living-room", "theme.json")),
    ).toEqual(mineBefore);

    // And a package whose id is free lands under its own.
    const fresh = await request(
      hosted.server,
      "POST",
      "/api/themes/import",
      packageBytes(createValidPackage("family-room", "Family Room")),
    );
    expect(fresh.json()).toEqual({ ok: true, id: "family-room" });
    const list = (
      await request(hosted.server, "GET", "/api/themes")
    ).json() as {
      themes: readonly { id: string }[];
    };
    expect(list.themes.map((entry) => entry.id)).toEqual([
      "family-room",
      "living-room",
      "living-room-2",
    ]);
  });

  it("refuses a second theme import while one is still arriving", async () => {
    const first = pendingRequest(hosted.server, "POST", "/api/themes/import");
    await first.started;

    // The first body is still being read, so the one slot for a theme-sized
    // body is held: the second caller is refused rather than queued behind it.
    const second = await request(
      hosted.server,
      "POST",
      "/api/themes/import",
      packageBytes(validEmptyAssetTheme),
    );
    expect(second.status).toBe(429);
    expect(second.text()).toBe("Another large upload is still in progress.");

    // The unreadable one-byte body the first sent is its own refusal, not a 429.
    first.release();
    expect((await first.answered).status).toBe(400);

    // The slot came back: the next import lands rather than inheriting a busy
    // gate from a request that failed.
    const third = await request(
      hosted.server,
      "POST",
      "/api/themes/import",
      packageBytes(validEmptyAssetTheme),
    );
    expect(third.status).toBe(200);
    expect(third.json()).toEqual({ ok: true, id: "living-room" });
  });

  it("imports a package's picture, and refuses one the reader will not read", async () => {
    // A real 1×1 PNG: the thumbnail store bounds the size its header declares.
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0xfc, 0xcf, 0xc0, 0x50,
      0x0f, 0x00, 0x04, 0x85, 0x01, 0x80, 0x84, 0xa9, 0x8c, 0x21, 0x00, 0x00,
      0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    const withPicture = await request(
      hosted.server,
      "POST",
      "/api/themes/import",
      packageBytes(createValidPackage("family-room", "Family Room"), png),
    );
    expect(withPicture.json()).toEqual({ ok: true, id: "family-room" });
    expect(
      (await request(hosted.server, "GET", "/api/themes/family-room/thumbnail"))
        .status,
    ).toBe(200);

    // §141's refusal, carried out as its own words: nothing was written for it.
    const refused = await request(
      hosted.server,
      "POST",
      "/api/themes/import",
      new Uint8Array([1, 2, 3]),
    );
    expect(refused.status).toBe(400);
    expect(refused.text()).toBe("That file is not a readable theme package.");
    const list = (
      await request(hosted.server, "GET", "/api/themes")
    ).json() as {
      themes: readonly { id: string }[];
    };
    expect(list.themes.map((entry) => entry.id)).toEqual(["family-room"]);

    // `import` is a route of its own, not a theme id the open route reads.
    expect(
      (await request(hosted.server, "GET", "/api/themes/import")).status,
    ).toBe(405);
    // Importing adds to the library, so it is this PC's business like a save.
    expect(
      (
        await request(
          hosted.server,
          "POST",
          "/api/themes/import",
          packageBytes(createValidPackage("other", "Other")),
          { remoteAddress: "10.0.0.2" },
        )
      ).status,
    ).toBe(403);
  });

  describe("The install route", () => {
    const PACKAGE_URL = cataloguePackageUrl("aurora", "1.2.0");
    let library: string;
    let settings: string;
    let installing: ReturnType<typeof createHostServer>;
    let answer: () => Response;

    beforeEach(async () => {
      library = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-install-ui-"));
      settings = await fs.mkdtemp(
        path.join(os.tmpdir(), "yunari-install-origins-ui-"),
      );
      const bytes = packageBytes(
        createValidPackage("family-room", "Family Room"),
      );
      answer = () => new Response(new Uint8Array(bytes));
      installing = createHostServer({
        registry: new ProviderRegistry([]),
        bundles: { player: library, editor: library },
        themeStore: createThemeStore(library),
        themeOrigins: createThemeOriginsStore(settings),
        // No network: the route's download is driven by this answer.
        fetch: async () => answer(),
      });
    });

    afterEach(async () => {
      await installing.close();
      await fs.rm(library, { recursive: true, force: true });
      await fs.rm(settings, { recursive: true, force: true });
    });

    function installBody(kind = DASHBOARD_THEME_KIND): string {
      return JSON.stringify({
        packageUrl: PACKAGE_URL,
        catalogueId: "aurora",
        version: "1.2.0",
        kind,
      });
    }

    it("installs a loopback POST and records its origin", async () => {
      const res = await request(
        installing.server,
        "POST",
        "/api/themes/install",
        installBody(),
      );

      expect(res.status).toBe(200);
      expect(res.json()).toEqual({ ok: true, id: "family-room" });

      const listing = (
        await request(installing.server, "GET", "/api/themes")
      ).json() as { themes: readonly Record<string, unknown>[] };
      expect(listing.themes).toHaveLength(1);
      expect(listing.themes[0]?.id).toBe("family-room");
      expect(listing.themes[0]?.origin).toEqual({
        catalogueId: "aurora",
        version: "1.2.0",
        installedAt: expect.any(String),
      });
    });

    it("refuses a non-loopback POST, and installs nothing", async () => {
      const res = await request(
        installing.server,
        "POST",
        "/api/themes/install",
        installBody(),
        { remoteAddress: "10.0.0.2" },
      );

      expect(res.status).toBe(403);
      const listing = (
        await request(installing.server, "GET", "/api/themes")
      ).json() as { themes: readonly unknown[] };
      expect(listing.themes).toEqual([]);
    });

    it("answers 405 to another method", async () => {
      expect(
        (await request(installing.server, "GET", "/api/themes/install")).status,
      ).toBe(405);
    });

    it("refuses a cross-origin POST before it downloads anything", async () => {
      let downloads = 0;
      const bytes = packageBytes(
        createValidPackage("family-room", "Family Room"),
      );
      answer = () => {
        downloads += 1;
        return new Response(new Uint8Array(bytes));
      };

      const res = await request(
        installing.server,
        "POST",
        "/api/themes/install",
        installBody(),
        {
          headers: {
            origin: "https://evil.example",
            host: "127.0.0.1:5173",
          },
        },
      );

      expect(res.status).toBe(403);
      expect(downloads, "a cross-origin request reached the download").toBe(0);
      const listing = (
        await request(installing.server, "GET", "/api/themes")
      ).json() as { themes: readonly unknown[] };
      expect(listing.themes).toEqual([]);
    });

    it("refuses a name that only resolves to this machine", async () => {
      // DNS rebinding: the page and the request both name the attacker's host,
      // so Origin and Host agree and only the name itself gives it away.
      let downloads = 0;
      answer = () => {
        downloads += 1;
        return new Response(
          new Uint8Array(
            packageBytes(createValidPackage("family-room", "Family Room")),
          ),
        );
      };

      const res = await request(
        installing.server,
        "POST",
        "/api/themes/install",
        installBody(),
        {
          headers: {
            origin: "http://evil.example:5173",
            host: "evil.example:5173",
          },
        },
      );

      expect(res.status).toBe(403);
      expect(downloads, "a rebound name reached the download").toBe(0);
    });

    it("refuses a request that states no host at all", async () => {
      const res = await request(
        installing.server,
        "POST",
        "/api/themes/install",
        installBody(),
        {
          headers: { host: "" },
        },
      );

      expect(res.status).toBe(403);
    });

    it("accepts a POST whose origin is the request's own host", async () => {
      const res = await request(
        installing.server,
        "POST",
        "/api/themes/install",
        installBody(),
        {
          headers: {
            origin: "http://127.0.0.1:5173",
            host: "127.0.0.1:5173",
          },
        },
      );

      expect(res.status).toBe(200);
    });

    it("answers 500 when the origin could not be recorded", async () => {
      const bytes = packageBytes(
        createValidPackage("family-room", "Family Room"),
      );
      const failing = createHostServer({
        registry: new ProviderRegistry([]),
        bundles: { player: library, editor: library },
        themeStore: createThemeStore(library),
        themeOrigins: {
          ...createThemeOriginsStore(settings),
          write: async () => {
            throw new Error("the settings directory is read-only");
          },
        },
        fetch: async () => new Response(new Uint8Array(bytes)),
      });

      try {
        const res = await request(
          failing.server,
          "POST",
          "/api/themes/install",
          installBody(),
        );

        expect(res.status).toBe(500);
        expect(res.text()).toContain("could not record");
      } finally {
        await failing.close();
      }
    });

    it("answers 400 to a body that is not the four strings", async () => {
      const res = await request(
        installing.server,
        "POST",
        "/api/themes/install",
        JSON.stringify({
          packageUrl: PACKAGE_URL,
          catalogueId: "aurora",
          version: "1.2.0",
        }),
      );

      expect(res.status).toBe(400);
    });

    it("answers 400 for an address no catalogue can produce", async () => {
      // Nothing pre-checks the URL in the route: the downloader owns the
      // allowlist and its `address` stage is what maps to 400.
      const res = await request(
        installing.server,
        "POST",
        "/api/themes/install",
        JSON.stringify({
          packageUrl: "http://github.com/x/y.zip",
          catalogueId: "aurora",
          version: "1.2.0",
          kind: DASHBOARD_THEME_KIND,
        }),
      );

      expect(res.status).toBe(400);
      expect(res.text()).toContain("https");
    });

    it("answers 413 for an install body over the limit", async () => {
      const res = await request(
        installing.server,
        "POST",
        "/api/themes/install",
        "x".repeat(65 * 1024),
      );

      expect(res.status).toBe(413);
    });

    it("answers 502 when the download failed", async () => {
      answer = () => new Response("no", { status: 404 });

      const res = await request(
        installing.server,
        "POST",
        "/api/themes/install",
        installBody(),
      );

      expect(res.status).toBe(502);
      expect(res.text()).toContain("404");
    });
  });

  describe("The normalize-video route", () => {
    let library: string;
    let normalizing: ReturnType<typeof createHostServer>;

    beforeEach(async () => {
      library = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-normalize-"));
      normalizing = createHostServer({
        registry: new ProviderRegistry([]),
        bundles: { player: library, editor: library },
        themeStore: createThemeStore(library),
      });
    });

    afterEach(async () => {
      await normalizing.close();
      await fs.rm(library, { recursive: true, force: true });
    });

    it("refuses a cross-origin POST", async () => {
      const res = await request(
        normalizing.server,
        "POST",
        "/api/themes/normalize-video",
        JSON.stringify({ bytesBase64: "" }),
        {
          headers: {
            origin: "https://evil.example",
            host: "127.0.0.1:5173",
          },
        },
      );

      expect(res.status).toBe(403);
    });

    it("answers 413 to a body over the upload cap", async () => {
      // One byte past the cap the import route uses; the body is refused
      // before it is parsed or decoded.
      const res = await request(
        normalizing.server,
        "POST",
        "/api/themes/normalize-video",
        new Uint8Array(MAX_THEME_UPLOAD_BYTES + 1),
      );

      expect(res.status).toBe(413);
    });

    it("answers with the same bytes for a video that already conforms", async () => {
      // The real route, the real parser, and a committed fixture: no encoder
      // is spawned for a conforming file, so this also pins `fit`/`aspect`
      // parsing and the `bytesBase64` answer shape.
      const bytes = await fs.readFile(
        fileURLToPath(
          new URL(
            "../../theme-package/test-fixtures/conforming.mp4",
            import.meta.url,
          ),
        ),
      );
      const res = await request(
        normalizing.server,
        "POST",
        "/api/themes/normalize-video",
        JSON.stringify({
          bytesBase64: bytes.toString("base64"),
          fit: "cover",
          aspect: { width: 16, height: 9 },
        }),
      );

      expect(res.status).toBe(200);
      const answer = JSON.parse(res.text()) as {
        ok: boolean;
        reencoded: boolean;
        bytesBase64: string;
      };
      expect(answer.ok).toBe(true);
      expect(answer.reencoded).toBe(false);
      expect(Buffer.from(answer.bytesBase64, "base64")).toEqual(bytes);
    });
  });

  describe("The store session routes", () => {
    // A loopback test origin: the only non-catalogue address `resolveStoreOrigin`
    // admits, and the fake Worker below intercepts every call anyway.
    const ORIGIN = "http://127.0.0.1:8787";
    // A slash is URL-encoded on the wire, so every case that redeems this token
    // also exercises the decode.
    const SESSION_TOKEN = "session/token.value";
    const EMAIL = "author@example.com";

    let settings: string;
    let store: ReturnType<typeof createStoreSessionStore>;
    let hosting: ReturnType<typeof createHostServer>;
    let calls: { url: string; method: string; authorization: string | null }[];
    /** What the Worker's one-time-token exchange answers. Replaced per case. */
    let verify: () => Response;
    /** What the Worker's `/api/me` answers. Replaced per case. */
    let me: (authorization: string | null) => Response;

    function json(body: unknown, headers?: Record<string, string>): Response {
      return new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json", ...headers },
      });
    }

    function host(options?: {
      readonly storeOrigin?: string | undefined;
      readonly storeSession?: boolean;
    }): ReturnType<typeof createHostServer> {
      return createHostServer({
        registry: new ProviderRegistry([]),
        bundles: { player: settings, editor: settings },
        themeStore: createThemeStore(settings),
        ...(options?.storeOrigin === undefined
          ? {}
          : { storeOrigin: options.storeOrigin }),
        ...(options?.storeSession === false ? {} : { storeSession: store }),
        // No network: every Worker call is recorded, so a case can show what
        // the host sent and what it did not.
        fetch: async (input, init) => {
          const url = String(input);
          const authorization =
            new Headers(init?.headers).get("authorization") ?? null;
          calls.push({ url, method: init?.method ?? "GET", authorization });
          if (url === `${ORIGIN}/api/auth/one-time-token/verify`)
            return verify();
          if (url === `${ORIGIN}/api/me`) return me(authorization);
          return new Response("unknown", { status: 404 });
        },
      });
    }

    /** Signs in through the two routes a browser drives, and answers the
     *  state the start route minted. */
    async function signIn(): Promise<string> {
      const res = await request(
        hosting.server,
        "POST",
        "/api/store/auth/start",
      );
      const url = new URL((res.json() as { url: string }).url);
      return url.searchParams.get("state") ?? "";
    }

    beforeEach(async () => {
      settings = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-store-ui-"));
      store = createStoreSessionStore(settings);
      calls = [];
      verify = () =>
        json({}, { "set-auth-token": encodeURIComponent(SESSION_TOKEN) });
      me = (authorization) =>
        authorization === `Bearer ${SESSION_TOKEN}`
          ? json({ userId: "user-1", email: EMAIL })
          : new Response("Unauthorized", { status: 401 });
      hosting = host({ storeOrigin: ORIGIN });
    });

    afterEach(async () => {
      await hosting.close();
      await fs.rm(settings, { recursive: true, force: true });
    });

    it("reports only whether a store session exists, never the token", async () => {
      const answer = await request(hosting.server, "GET", "/api/store/session");

      expect(answer.json()).toEqual({ signedIn: false });
      expect(answer.text()).not.toContain("token");
    });

    it("starts the sign-in at the Worker with this host's loopback origin", async () => {
      const res = await request(
        hosting.server,
        "POST",
        "/api/store/auth/start",
      );

      expect(res.status).toBe(200);
      const url = new URL((res.json() as { url: string }).url);
      expect(url.origin).toBe(ORIGIN);
      expect(url.pathname).toBe("/auth/start");
      expect(url.searchParams.get("provider")).toBe("github");
      expect(url.searchParams.get("host")).toBe("http://127.0.0.1:5173");
      expect(url.searchParams.get("state")).not.toBe("");
    });

    it("normalises an IPv6 loopback host to the address the Worker accepts", async () => {
      const res = await request(
        hosting.server,
        "POST",
        "/api/store/auth/start",
        undefined,
        { headers: { host: "[::1]:5173" } },
      );

      expect(res.status).toBe(200);
      const url = new URL((res.json() as { url: string }).url);
      expect(url.searchParams.get("host")).toBe("http://127.0.0.1:5173");
    });

    it("exchanges the one-time token for a stored session and closes the page", async () => {
      const state = await signIn();

      const res = await request(
        hosting.server,
        "GET",
        `/api/store/auth/return?token=one-time&state=${state}`,
      );

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.text()).toContain("close this window");
      // The session token and the account are the host's to keep, not the
      // page's to show.
      expect(res.text()).not.toContain(SESSION_TOKEN);
      expect(res.text()).not.toContain(EMAIL);

      expect(await store.read()).toMatchObject({
        token: SESSION_TOKEN,
        userId: "user-1",
        email: EMAIL,
      });
      expect(
        calls.find((call) => call.url === `${ORIGIN}/api/me`)?.authorization,
      ).toBe(`Bearer ${SESSION_TOKEN}`);

      const after = await request(hosting.server, "GET", "/api/store/session");
      expect(after.json()).toEqual({ signedIn: true, email: EMAIL });
    });

    it("reads the session token from the cookie when no header carries it", async () => {
      verify = () =>
        new Response("{}", {
          headers: {
            "set-cookie": `better-auth.session_token=${encodeURIComponent(
              SESSION_TOKEN,
            )}; Path=/; HttpOnly`,
          },
        });
      const state = await signIn();

      const res = await request(
        hosting.server,
        "GET",
        `/api/store/auth/return?token=one-time&state=${state}`,
      );

      expect(res.status).toBe(200);
      expect(await store.read()).toMatchObject({ token: SESSION_TOKEN });
    });

    it("accepts the `__Secure-` cookie name the Worker uses over https", async () => {
      verify = () =>
        new Response("{}", {
          headers: {
            "set-cookie": `__Secure-better-auth.session_token=${encodeURIComponent(
              SESSION_TOKEN,
            )}; Path=/; HttpOnly; Secure`,
          },
        });
      const state = await signIn();

      const res = await request(
        hosting.server,
        "GET",
        `/api/store/auth/return?token=one-time&state=${state}`,
      );

      expect(res.status).toBe(200);
      expect(await store.read()).toMatchObject({ token: SESSION_TOKEN });
    });

    it("refuses a state it has already spent", async () => {
      const state = await signIn();
      const first = await request(
        hosting.server,
        "GET",
        `/api/store/auth/return?token=one-time&state=${state}`,
      );
      expect(first.status).toBe(200);
      await store.clear();

      const second = await request(
        hosting.server,
        "GET",
        `/api/store/auth/return?token=one-time&state=${state}`,
      );

      expect(second.status).toBe(400);
      expect(await store.read()).toBeUndefined();
    });

    it("refuses a return the sign-in was not started for", async () => {
      const state = await signIn();

      const res = await request(
        hosting.server,
        "GET",
        `/api/store/auth/return?token=one-time&state=${state}`,
        undefined,
        {
          headers: { host: "localhost:5173", origin: "http://localhost:5173" },
        },
      );

      expect(res.status).toBe(400);
      expect(await store.read()).toBeUndefined();
    });

    it("does not redeem a state another host instance started", async () => {
      const state = await signIn();
      const other = host({ storeOrigin: ORIGIN });

      try {
        const res = await request(
          other.server,
          "GET",
          `/api/store/auth/return?token=one-time&state=${state}`,
        );

        expect(res.status).toBe(400);
        expect(await store.read()).toBeUndefined();
      } finally {
        await other.close();
      }
    });

    it("refuses a state older than ten minutes, without calling the Worker", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(new Date("2026-10-23T10:00:00.000Z"));
        const state = await signIn();

        vi.setSystemTime(new Date("2026-10-23T10:11:00.000Z"));
        calls = [];
        const res = await request(
          hosting.server,
          "GET",
          `/api/store/auth/return?token=one-time&state=${state}`,
        );

        expect(res.status).toBe(400);
        expect(calls).toHaveLength(0);
        expect(await store.read()).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps 64 started sign-ins and drops the oldest", async () => {
      const states: string[] = [];
      for (let index = 0; index < 65; index += 1) states.push(await signIn());
      const [oldestState] = states;
      const newestState = states[64];

      const oldest = await request(
        hosting.server,
        "GET",
        `/api/store/auth/return?token=one-time&state=${oldestState}`,
      );
      expect(oldest.status).toBe(400);
      expect(calls).toHaveLength(0);

      const newest = await request(
        hosting.server,
        "GET",
        `/api/store/auth/return?token=one-time&state=${newestState}`,
      );
      expect(newest.status).toBe(200);
    });

    it("answers 401 and keeps nothing when the Worker refuses the token", async () => {
      verify = () => new Response("no", { status: 401 });
      const state = await signIn();

      const res = await request(
        hosting.server,
        "GET",
        `/api/store/auth/return?token=one-time&state=${state}`,
      );

      expect(res.status).toBe(401);
      expect(await store.read()).toBeUndefined();
    });

    it("answers 401 when the exchange carries no session token", async () => {
      verify = () => json({});
      const state = await signIn();

      const res = await request(
        hosting.server,
        "GET",
        `/api/store/auth/return?token=one-time&state=${state}`,
      );

      expect(res.status).toBe(401);
      expect(await store.read()).toBeUndefined();
    });

    it("answers 401 and keeps nothing when the Worker's /api/me refuses the session", async () => {
      me = () => new Response("Unauthorized", { status: 401 });
      const state = await signIn();

      const res = await request(
        hosting.server,
        "GET",
        `/api/store/auth/return?token=one-time&state=${state}`,
      );

      expect(res.status).toBe(401);
      expect(await store.read()).toBeUndefined();
    });

    it("answers 401 and keeps nothing when /api/me names no account", async () => {
      me = () => json({ userId: "user-1" });
      const state = await signIn();

      const res = await request(
        hosting.server,
        "GET",
        `/api/store/auth/return?token=one-time&state=${state}`,
      );

      expect(res.status).toBe(401);
      expect(await store.read()).toBeUndefined();
    });

    it("signs out by clearing the stored session", async () => {
      const state = await signIn();
      await request(
        hosting.server,
        "GET",
        `/api/store/auth/return?token=one-time&state=${state}`,
      );
      expect(await store.read()).toBeDefined();

      const res = await request(
        hosting.server,
        "POST",
        "/api/store/auth/sign-out",
      );

      expect(res.status).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(await store.read()).toBeUndefined();
    });

    it("refuses every store route from another origin", async () => {
      const routes = [
        ["GET", "/api/store/session"],
        ["POST", "/api/store/auth/start"],
        ["GET", "/api/store/auth/return?token=t&state=s"],
        ["POST", "/api/store/auth/sign-out"],
      ] as const;

      for (const [method, urlPath] of routes) {
        const res = await request(hosting.server, method, urlPath, undefined, {
          headers: { origin: "https://evil.example", host: "127.0.0.1:5173" },
        });
        expect(res.status, `${method} ${urlPath}`).toBe(403);
      }
    });

    it("refuses every store route from off loopback", async () => {
      const routes = [
        ["GET", "/api/store/session"],
        ["POST", "/api/store/auth/start"],
        ["GET", "/api/store/auth/return?token=t&state=s"],
        ["POST", "/api/store/auth/sign-out"],
      ] as const;

      for (const [method, urlPath] of routes) {
        const res = await request(hosting.server, method, urlPath, undefined, {
          remoteAddress: "10.0.0.2",
        });
        expect(res.status, `${method} ${urlPath}`).toBe(403);
      }
    });

    it("answers 503 when the host has no store address or session store", async () => {
      const unconfigured = host({
        storeOrigin: undefined,
        storeSession: false,
      });

      try {
        expect(
          (await request(unconfigured.server, "POST", "/api/store/auth/start"))
            .status,
        ).toBe(503);
        expect(
          (await request(unconfigured.server, "GET", "/api/store/session"))
            .status,
        ).toBe(503);
      } finally {
        await unconfigured.close();
      }
    });

    it("rejects the wrong method on each route", async () => {
      const routes = [
        ["GET", "/api/store/auth/start"],
        ["POST", "/api/store/auth/return?token=t&state=s"],
        ["GET", "/api/store/auth/sign-out"],
        ["POST", "/api/store/session"],
      ] as const;

      for (const [method, urlPath] of routes) {
        const res = await request(hosting.server, method, urlPath);
        expect(res.status, `${method} ${urlPath}`).toBe(405);
      }
    });
  });

  describe("The submit route", () => {
    const ORIGIN = "http://127.0.0.1:8787";
    // A slash is URL-encoded on the wire, so the token path is exercised too.
    const SESSION_TOKEN = "session/token.value";
    // New documents get UUID ids; these fixtures mirror that.
    const THEME_ID = "3f2a1c9e-8b7d-4c6a-9e0f-1a2b3c4d5e6f";
    const BARE_ID = "0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";
    const UPLOAD_URL = `${ORIGIN}/api/me/uploads/5c2e9a10-3b4d-4e6f-8a90-1b2c3d4e5f60`;
    // The store's own check: a picture is a PNG, and a submission refuses a
    // theme without one. The header's declared size has to be within bounds.
    const PNG = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0xfc, 0xcf, 0xc0, 0x50,
      0x0f, 0x00, 0x04, 0x85, 0x01, 0x80, 0x84, 0xa9, 0x8c, 0x21, 0x00, 0x00,
      0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);

    let library: string;
    let settings: string;
    let submitting: ReturnType<typeof createHostServer>;
    let session: ReturnType<typeof createStoreSessionStore>;
    let calls: { url: string; method: string; authorization: string | null }[];
    /** The Worker's baseline answer; absent is a first publication. */
    let storedBaseline: FabricThemeEnvelope | undefined;
    let storedVersion: string;
    let plan: { version: string; status: string; uploadUrl: string };
    let finalStatus: string;

    function json(body: unknown, status = 200): Response {
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }

    beforeEach(async () => {
      library = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-submit-ui-"));
      settings = await fs.mkdtemp(
        path.join(os.tmpdir(), "yunari-submit-settings-ui-"),
      );
      session = createStoreSessionStore(settings);
      calls = [];
      storedBaseline = undefined;
      storedVersion = "1.0.0";
      plan = { version: "1.0.0", status: "pending", uploadUrl: UPLOAD_URL };
      finalStatus = "pending";

      const store = createThemeStore(library);
      await store.write(THEME_ID, createValidPackage(THEME_ID, "Aurora"));
      await createThumbnailStore(library).write(THEME_ID, PNG);
      // A theme the library holds with no picture: the package step refuses it.
      await store.write(BARE_ID, createValidPackage(BARE_ID, "Bare"));

      submitting = createHostServer({
        registry: new ProviderRegistry([]),
        bundles: { player: library, editor: library },
        themeStore: store,
        thumbnails: createThumbnailStore(library),
        storeOrigin: ORIGIN,
        storeSession: session,
        // No network: the Worker's four calls are answered in order, and every
        // call is recorded so a case can show what the host sent.
        fetch: async (input, init) => {
          const url = String(input);
          const method = init?.method ?? "GET";
          calls.push({
            url,
            method,
            authorization: new Headers(init?.headers).get("authorization"),
          });

          if (url === `${ORIGIN}/api/me/items/${THEME_ID}/baseline`) {
            if (storedBaseline === undefined) {
              return new Response("Not found", { status: 404 });
            }
            return json({
              version: storedVersion,
              createdAt: "2026-10-01T00:00:00.000Z",
              envelope: storedBaseline,
              status: "published",
            });
          }
          if (url === `${ORIGIN}/api/me/items/${THEME_ID}/versions`) {
            return json(plan);
          }
          if (url === UPLOAD_URL) return new Response(null, { status: 200 });
          if (
            url ===
            `${ORIGIN}/api/me/items/${THEME_ID}/versions/${plan.version}/finalize`
          ) {
            return json({
              ok: true,
              status: finalStatus,
              version: plan.version,
            });
          }
          return new Response("unknown", { status: 404 });
        },
      });
    });

    afterEach(async () => {
      await submitting.close();
      await fs.rm(library, { recursive: true, force: true });
      await fs.rm(settings, { recursive: true, force: true });
    });

    function submitBody(id = THEME_ID): string {
      return JSON.stringify({ id });
    }

    async function signedIn(): Promise<void> {
      await session.write({
        token: SESSION_TOKEN,
        userId: "user-1",
        email: "author@example.com",
        obtainedAt: "2026-10-22T00:00:00.000Z",
      });
    }

    it("submits the package to the Worker and answers its status", async () => {
      await signedIn();

      const res = await request(
        submitting.server,
        "POST",
        "/api/themes/submit",
        submitBody(),
      );

      expect(res.status).toBe(200);
      // A first publication mints `1.0.0` and names no `from`: the wire says
      // `null`, because an absent key would be a different answer.
      expect(res.json()).toEqual({
        ok: true,
        status: "pending",
        version: { from: null, to: "1.0.0", level: "initial" },
      });

      // The four calls, in the order the store's own protocol requires: the
      // baseline, the version request, the proxied upload, the finalize.
      expect(calls.map((call) => [call.method, call.url])).toEqual([
        ["GET", `${ORIGIN}/api/me/items/${THEME_ID}/baseline`],
        ["POST", `${ORIGIN}/api/me/items/${THEME_ID}/versions`],
        ["PUT", UPLOAD_URL],
        ["POST", `${ORIGIN}/api/me/items/${THEME_ID}/versions/1.0.0/finalize`],
      ]);
      // The session token travels on all four: the upload is the Worker's own
      // authenticated route, not a presigned R2 address.
      expect(calls.map((call) => call.authorization)).toEqual([
        `Bearer ${SESSION_TOKEN}`,
        `Bearer ${SESSION_TOKEN}`,
        `Bearer ${SESSION_TOKEN}`,
        `Bearer ${SESSION_TOKEN}`,
      ]);
      expect(res.text()).not.toContain(SESSION_TOKEN);
    });

    it("answers the status and version the Worker computed for a bump", async () => {
      await signedIn();
      // The store already holds `1.4.0` with a tag this library's copy lacks: a
      // tag leaving the set is a minor change, so the ladder answers `1.5.0`.
      storedVersion = "1.4.0";
      storedBaseline = {
        ...createValidPackage(THEME_ID, "Aurora").envelope,
        metadata: {
          ...createValidPackage(THEME_ID, "Aurora").envelope.metadata,
          tags: ["warm"],
        },
      };
      plan = { version: "1.5.0", status: "published", uploadUrl: UPLOAD_URL };
      finalStatus = "published";

      const res = await request(
        submitting.server,
        "POST",
        "/api/themes/submit",
        submitBody(),
      );

      expect(res.status).toBe(200);
      expect(res.json()).toEqual({
        ok: true,
        status: "published",
        version: { from: "1.4.0", to: "1.5.0", level: "minor" },
      });
    });

    it("answers 401 asking the author to sign in when no session is held", async () => {
      const res = await request(
        submitting.server,
        "POST",
        "/api/themes/submit",
        submitBody(),
      );

      expect(res.status).toBe(401);
      expect(res.json()).toEqual({
        ok: false,
        message: "Sign in to the store before submitting.",
      });
      expect(calls, "an unsigned submission reached the store").toEqual([]);
    });

    it("forgets the stored session when the Worker answers 401", async () => {
      await signedIn();
      const expired = createHostServer({
        registry: new ProviderRegistry([]),
        bundles: { player: library, editor: library },
        themeStore: createThemeStore(library),
        thumbnails: createThumbnailStore(library),
        storeOrigin: ORIGIN,
        storeSession: session,
        fetch: async () => new Response("Session expired", { status: 401 }),
      });

      try {
        const res = await request(
          expired.server,
          "POST",
          "/api/themes/submit",
          submitBody(),
        );

        expect(res.status).toBe(401);
        expect(res.json()).toEqual({
          ok: false,
          message: "Session expired",
        });
        // The token is spent: the next press asks for a sign-in.
        expect(await session.read()).toBeUndefined();
      } finally {
        await expired.close();
      }
    });

    it("spends the session when the upload route answers 401", async () => {
      await signedIn();
      const refused = createHostServer({
        registry: new ProviderRegistry([]),
        bundles: { player: library, editor: library },
        themeStore: createThemeStore(library),
        thumbnails: createThumbnailStore(library),
        storeOrigin: ORIGIN,
        storeSession: session,
        fetch: async (input) => {
          const url = String(input);
          if (url === `${ORIGIN}/api/me/items/${THEME_ID}/baseline`)
            return new Response("Not found", { status: 404 });
          if (url === `${ORIGIN}/api/me/items/${THEME_ID}/versions`)
            return json(plan);
          if (url === UPLOAD_URL)
            return new Response("Unauthorized", { status: 401 });
          return new Response("unknown", { status: 404 });
        },
      });

      try {
        const res = await request(
          refused.server,
          "POST",
          "/api/themes/submit",
          submitBody(),
        );

        expect(res.status).toBe(401);
        // The upload route authenticates with the session, so its 401 is the
        // session's refusal: the next press asks for a sign-in.
        expect(await session.read()).toBeUndefined();
      } finally {
        await refused.close();
      }
    });

    it("refuses a non-loopback POST", async () => {
      await signedIn();

      const res = await request(
        submitting.server,
        "POST",
        "/api/themes/submit",
        submitBody(),
        { remoteAddress: "10.0.0.2" },
      );

      expect(res.status).toBe(403);
      expect(calls).toEqual([]);
    });

    it("refuses a cross-origin POST", async () => {
      await signedIn();

      const res = await request(
        submitting.server,
        "POST",
        "/api/themes/submit",
        submitBody(),
        {
          headers: {
            origin: "https://evil.example",
            host: "127.0.0.1:5173",
          },
        },
      );

      expect(res.status).toBe(403);
      expect(calls).toEqual([]);
    });

    it("refuses a name that only resolves to this machine", async () => {
      // DNS rebinding: Origin and Host agree with each other, and only the name
      // itself says the request was not addressed to this host.
      await signedIn();

      const res = await request(
        submitting.server,
        "POST",
        "/api/themes/submit",
        submitBody(),
        {
          headers: {
            origin: "http://evil.example:5173",
            host: "evil.example:5173",
          },
        },
      );

      expect(res.status).toBe(403);
      expect(calls).toEqual([]);
    });

    it("answers 400 with the local refusal for a theme with no picture", async () => {
      await signedIn();

      const res = await request(
        submitting.server,
        "POST",
        "/api/themes/submit",
        submitBody(BARE_ID),
      );

      expect(res.status).toBe(400);
      expect(res.json()).toEqual({
        ok: false,
        message: expect.stringContaining("picture"),
      });
      expect(calls, "a theme with no picture reached the store").toEqual([]);
    });

    it("answers 400 with the Worker's own sentence when it refuses", async () => {
      await signedIn();
      const refusing = createHostServer({
        registry: new ProviderRegistry([]),
        bundles: { player: library, editor: library },
        themeStore: createThemeStore(library),
        thumbnails: createThumbnailStore(library),
        storeOrigin: ORIGIN,
        storeSession: session,
        fetch: async () =>
          new Response("This theme has not changed.", {
            status: 400,
          }),
      });

      try {
        const res = await request(
          refusing.server,
          "POST",
          "/api/themes/submit",
          submitBody(),
        );

        expect(res.status).toBe(400);
        expect(res.json()).toEqual({
          ok: false,
          message: "This theme has not changed.",
        });
      } finally {
        await refusing.close();
      }
    });

    it("answers 401 when the Worker refuses the stored session", async () => {
      await signedIn();
      const stale = createHostServer({
        registry: new ProviderRegistry([]),
        bundles: { player: library, editor: library },
        themeStore: createThemeStore(library),
        thumbnails: createThumbnailStore(library),
        storeOrigin: ORIGIN,
        storeSession: session,
        fetch: async () => new Response("Unauthorized", { status: 401 }),
      });

      try {
        const res = await request(
          stale.server,
          "POST",
          "/api/themes/submit",
          submitBody(),
        );

        expect(res.status).toBe(401);
        expect(res.json()).toEqual({ ok: false, message: "Unauthorized" });
      } finally {
        await stale.close();
      }
    });

    it("answers 502 when the store cannot be reached", async () => {
      await signedIn();
      const unreachable = createHostServer({
        registry: new ProviderRegistry([]),
        bundles: { player: library, editor: library },
        themeStore: createThemeStore(library),
        thumbnails: createThumbnailStore(library),
        storeOrigin: ORIGIN,
        storeSession: session,
        fetch: async () => {
          throw new Error("offline");
        },
      });

      try {
        const res = await request(
          unreachable.server,
          "POST",
          "/api/themes/submit",
          submitBody(),
        );

        expect(res.status).toBe(502);
        expect(res.json()).toEqual({
          ok: false,
          message: "The store could not be reached.",
        });
      } finally {
        await unreachable.close();
      }
    });

    it("answers 503 when the host has no usable store address", async () => {
      await signedIn();
      const saved = process.env.YUNARI_STORE_ORIGIN;
      delete process.env.YUNARI_STORE_ORIGIN;
      const unaddressed = createHostServer({
        registry: new ProviderRegistry([]),
        bundles: { player: library, editor: library },
        themeStore: createThemeStore(library),
        thumbnails: createThumbnailStore(library),
        storeSession: session,
      });
      // A refused address reaches no request: the routes answer as if unset.
      const refused = createHostServer({
        registry: new ProviderRegistry([]),
        bundles: { player: library, editor: library },
        themeStore: createThemeStore(library),
        thumbnails: createThumbnailStore(library),
        storeOrigin: "https://evil.example",
        storeSession: session,
        fetch: async () => {
          throw new Error("a refused origin must not be contacted");
        },
      });

      try {
        for (const host of [unaddressed, refused]) {
          const res = await request(
            host.server,
            "POST",
            "/api/themes/submit",
            submitBody(),
          );
          expect(res.status).toBe(503);
        }
      } finally {
        await unaddressed.close();
        await refused.close();
        if (saved !== undefined) process.env.YUNARI_STORE_ORIGIN = saved;
      }
    });
  });

  it("reports requested keys no provider answered through /api/health", async () => {
    const health = await request(hosted.server, "GET", "/api/health");
    const body = health.json() as { unmapped: readonly string[] };

    // Nothing has polled yet, so nothing is unmapped; the field exists so a
    // display can tell "no data yet" from "this sensor has no provider".
    expect(body.unmapped).toEqual([]);
  });

  describe("LAN displays authenticate with their own credential (§145)", () => {
    let displays: ReturnType<typeof createDisplayStore>;
    let paired: ReturnType<typeof createHostServer>;
    let lanDir: string;

    /** Pairs a display and answers the credential it holds, which is the one
     *  thing a paired phone has and the host only ever sees hashed. */
    async function pair(label = "phone"): Promise<string> {
      const token = newToken();
      await displays.create(label, token);
      return token;
    }

    beforeEach(async () => {
      lanDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "yunari-host-lan-test-"),
      );
      displays = createDisplayStore(lanDir);
      paired = createHostServer({
        registry: new ProviderRegistry([]),
        bundles: { player: lanDir, editor: lanDir },
        themeStore: createThemeStore(lanDir),
        display: createDisplaySettingsStore(lanDir),
        fontFavorites: createFontFavoritesStore(lanDir),
        displays,
      });
      await request(
        paired.server,
        "PUT",
        "/api/themes/living-room",
        themeBody(validEmptyAssetTheme),
      );
    });

    afterEach(async () => {
      await paired.close();
      await fs.rm(lanDir, { recursive: true, force: true });
    });

    it("refuses LAN display reads without a credential", async () => {
      const lan = { remoteAddress: "192.168.1.50" };

      expect(
        (await request(paired.server, "GET", "/api/themes", undefined, lan))
          .status,
      ).toBe(403);
      expect(
        (
          await request(
            paired.server,
            "GET",
            "/api/themes/living-room/document",
            undefined,
            lan,
          )
        ).status,
      ).toBe(403);
    });

    it("accepts a LAN display holding a live credential, by header or query", async () => {
      const token = await pair();
      const lan = { remoteAddress: "192.168.1.50" };

      expect(
        (
          await request(paired.server, "GET", "/api/themes", undefined, {
            ...lan,
            headers: { "x-yunari-session": token },
          })
        ).status,
      ).toBe(200);

      // The stream is gated by the same check, so a query credential is accepted
      // (EventSource cannot set headers) and a missing one is refused. The
      // accepted stream is never awaited: it stays open by design.
      expect(
        (
          await streamStatus(
            paired.server,
            `/ws?keys=cpu.load&session=${encodeURIComponent(token)}`,
          )
        ).status,
      ).toBe(200);
      expect(
        (await streamStatus(paired.server, "/ws?keys=cpu.load")).status,
      ).toBe(403);
    });

    it("lets a paired display read this PC's preferences, not change them", async () => {
      const token = await pair();
      const lan = { remoteAddress: "192.168.1.50" };
      const pairedPhone = {
        ...lan,
        headers: { "x-yunari-session": token },
      };

      // A display obeys the units and the zone, so it must be able to read
      // them: a phone that cannot learn the preference cannot honour it.
      expect(
        (
          await request(
            paired.server,
            "GET",
            "/api/display",
            undefined,
            pairedPhone,
          )
        ).status,
      ).toBe(200);
      expect(
        (await request(paired.server, "GET", "/api/display", undefined, lan))
          .status,
      ).toBe(403);

      // Changing one stays this PC's business.
      expect(
        (
          await request(
            paired.server,
            "PUT",
            "/api/display",
            json({ timeZone: "Asia/Tokyo" }),
            pairedPhone,
          )
        ).status,
      ).toBe(403);
    });

    it("keeps unit preferences when a page that does not draw them saves a zone", async () => {
      // The served `/settings` page sends only the fields it draws. The route
      // replaces the whole object, so an omitted bag must not erase what the
      // editor's Host mode stored: a zone save is not a request to clear units.
      expect(
        (
          await request(
            paired.server,
            "PUT",
            "/api/display",
            JSON.stringify({ units: { clock: "ghz" } }),
          )
        ).status,
      ).toBe(200);

      expect(
        (
          await request(
            paired.server,
            "PUT",
            "/api/display",
            JSON.stringify({ timeZone: "Asia/Tokyo", measurement: "metric" }),
          )
        ).status,
      ).toBe(200);

      const read = await request(paired.server, "GET", "/api/display");
      expect(read.status).toBe(200);
      expect((read.json() as { settings: unknown }).settings).toEqual({
        timeZone: "Asia/Tokyo",
        measurement: "metric",
        units: { clock: "ghz" },
      });
    });

    it("lets a paired display read this PC's favourites, not change them", async () => {
      const token = await pair();
      const lan = { remoteAddress: "192.168.1.50" };
      const pairedPhone = {
        ...lan,
        headers: { "x-yunari-session": token },
      };

      // Same asymmetry as `/api/display`, for the same reason: a paired reader
      // is this PC's own reader and may see what it holds.
      expect(
        (
          await request(
            paired.server,
            "GET",
            "/api/font-favorites",
            undefined,
            pairedPhone,
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await request(
            paired.server,
            "GET",
            "/api/font-favorites",
            undefined,
            lan,
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await request(
            paired.server,
            "PUT",
            "/api/font-favorites",
            json({ favorites: ["saas"] }),
            pairedPhone,
          )
        ).status,
      ).toBe(403);
    });

    it("refuses a credential the host has removed", async () => {
      const token = await pair();
      // Ruling 12 collapses revoking into removing, so the act is the display's
      // removal and the credential goes with the record (the case that used to
      // drive `DELETE /api/pairing/sessions/:token`, retired with the session
      // store).
      const held = await displays.authenticate(token);
      const removed = await request(
        paired.server,
        "DELETE",
        `/api/displays/${held?.id ?? ""}`,
      );
      expect(removed.status).toBe(200);

      expect(
        (
          await request(paired.server, "GET", "/api/themes", undefined, {
            remoteAddress: "192.168.1.50",
            headers: { "x-yunari-session": token },
          })
        ).status,
      ).toBe(403);
    });

    it("keeps pairing itself loopback-only", async () => {
      expect(
        (
          await request(
            paired.server,
            "POST",
            "/api/pairing/sessions",
            undefined,
            {
              remoteAddress: "192.168.1.50",
            },
          )
        ).status,
      ).toBe(403);

      const minted = await request(
        paired.server,
        "POST",
        "/api/pairing/sessions",
      );
      expect(minted.status).toBe(201);
      const body = minted.json() as {
        display: { id: string };
        token: string;
      };
      expect(body.display.id).toBe("display");
      expect(body.token).toBeTruthy();
      // The one moment the credential exists in the clear. The list below never
      // carries it, because the record only ever holds its hash.
      expect((await displays.authenticate(body.token))?.id).toBe(
        body.display.id,
      );
    });

    it("still treats loopback as trusted admin, with no credential", async () => {
      expect((await request(paired.server, "GET", "/api/themes")).status).toBe(
        200,
      );
    });

    it("reports pairing availability through /api/health", async () => {
      const health = await request(paired.server, "GET", "/api/health");
      expect((health.json() as { pairing: boolean }).pairing).toBe(true);
    });
  });

  /**
   * The one route an unpaired client may read, and the reason a display that has
   * lost its host's address can find it again (R23–R25). What these cases hold is
   * the promise that makes the exemption safe: the body is the identity and the
   * port, and nothing else this host holds.
   */
  describe("The host route `/api/host` answers who this host is, and nothing else", () => {
    let hostDir: string;
    let hosted: ReturnType<typeof createHostServer>;
    let displays: ReturnType<typeof createDisplayStore>;
    let occupier: net.Server | undefined;

    /** The identity a display would have stored for this host. */
    const record: HostRecord = { id: "3f9a1c0b7d2e4a68", name: "Study PC" };

    beforeEach(async () => {
      hostDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "yunari-host-identity-test-"),
      );
      displays = createDisplayStore(hostDir);
    });

    afterEach(async () => {
      if (occupier !== undefined) {
        await new Promise<void>((resolve) => {
          occupier?.close(() => resolve());
        });
        occupier = undefined;
      }
      // `fetch` leaves a keep-alive socket and `close()` waits for connections,
      // so a teardown that only closed the server would hang on its own client.
      hosted.server.closeAllConnections();
      await hosted.close();
      await fs.rm(hostDir, { recursive: true, force: true });
    });

    /** The route reads no theme, so the bundles are only a temp directory. */
    function build(
      options: Omit<
        HostServerOptions,
        "registry" | "bundles" | "themeStore"
      > = {},
    ): void {
      hosted = createHostServer({
        registry: new ProviderRegistry([]),
        bundles: { player: hostDir, editor: hostDir },
        themeStore: createThemeStore(hostDir),
        ...options,
      });
    }

    it("answers an unpaired caller with the identity and nothing else", async () => {
      build({ host: record });

      const answered = await request(
        hosted.server,
        "GET",
        "/api/host",
        undefined,
        { remoteAddress: "192.168.1.50" },
      );

      expect(answered.status).toBe(200);
      expect(answered.json()).toEqual({
        id: record.id,
        name: record.name,
        // Not listening in this harness, which is the honest answer rather than
        // a port invented for the field.
        port: null,
      });
      // Exactly these three, so a field added for another route's sake cannot
      // ride along unseen: the exemption is for this body and no wider.
      expect(
        Object.keys(answered.json() as Record<string, unknown>).sort(),
      ).toEqual(["id", "name", "port"]);
    });

    it("is readable cross-origin, because a re-find sweep is cross-origin", async () => {
      build({ host: record });

      const answered = await request(
        hosted.server,
        "GET",
        "/api/host",
        undefined,
        { remoteAddress: "192.168.1.50" },
      );

      expect(answered.headers["access-control-allow-origin"]).toBe("*");
      // A wildcard origin with credentials is refused by a browser, and a sweep
      // sends none: this header would only invite a later reader to send the
      // token cross-origin.
      expect(answered.headers).not.toHaveProperty(
        "access-control-allow-credentials",
      );
    });

    it("does not leak the credential or the display list", async () => {
      build({ host: record, displays });

      const tokens = [newToken(), newToken()];
      await displays.create("Kitchen phone", tokens[0] ?? "");
      await displays.create("Hallway phone", tokens[1] ?? "");

      const answered = await request(
        hosted.server,
        "GET",
        "/api/host",
        undefined,
        { remoteAddress: "192.168.1.50" },
      );
      const bytes = answered.text();

      expect(
        Object.keys(answered.json() as Record<string, unknown>).sort(),
      ).toEqual(["id", "name", "port"]);

      // Neither the credential nor the hash it is stored as: the route answers
      // about who this host is, not about who is paired with it.
      for (const token of tokens) {
        expect(bytes).not.toContain(token);
        expect(bytes).not.toContain(hashToken(token));
      }
    });

    it("answers the port it is actually listening on, not one it was given", async () => {
      // Two sources could be mistaken for the port — the binding's state and the
      // port the host was asked to take — so both are made to differ from the
      // socket: the binding reports 1, and the port asked for is held by another
      // listener, so the host falls back to the next one.
      build({
        host: record,
        hosting: {
          state: async () => ({
            lan: false,
            address: null,
            port: 1,
            refusal: null,
          }),
          isLan: () => false,
          setLan: async () => ({ ok: true }),
          idle: async () => {},
        },
      });

      occupier = net.createServer();
      const held = await new Promise<number>((resolve, reject) => {
        occupier?.once("error", reject);
        occupier?.listen(0, "127.0.0.1", () => {
          const address = occupier?.address();
          resolve(
            typeof address === "object" && address !== null ? address.port : 0,
          );
        });
      });

      const bound = await listenWithFallback(hosted.server, held, "127.0.0.1");
      expect(bound).not.toBe(held);

      const answered = await request(hosted.server, "GET", "/api/host");

      // The port in the answer is the one in the URL a display would dial, which
      // is what a re-find needs: the fallback port, not the one asked for.
      expect(answered.json()).toMatchObject({ port: bound });

      // And over a real socket, where the header's precedence is Node's rather
      // than the harness's: `writeHead` keeps a name it does not set, so what
      // was set before `sendJson` is on the wire.
      const real = await fetch(`http://127.0.0.1:${bound}/api/host`);
      expect(real.headers.get("access-control-allow-origin")).toBe("*");
      await expect(real.json()).resolves.toMatchObject({ port: bound });
    });

    it("answers 404 like any unknown path when this host has no identity", async () => {
      // No `host` option: the route is not registered at all. An id minted to
      // fill the answer would be an identity no display could have stored, and a
      // host with nothing to say should not be found by a sweep.
      build({});

      const answered = await request(hosted.server, "GET", "/api/host");

      expect(answered.status).toBe(404);
    });

    it("is read before the display guard, by a caller refused beside it", async () => {
      build({ host: record, displays });
      const lan = { remoteAddress: "192.168.1.50" };

      // Unpaired and off-loopback, which is exactly the caller a re-find sweep
      // is: the route answers it, while the same caller is refused on the
      // guarded route beside it. A route registered after that guard would
      // answer 403 here rather than the identity.
      expect(
        (await request(hosted.server, "GET", "/api/host", undefined, lan))
          .status,
      ).toBe(200);
      expect(
        (await request(hosted.server, "GET", "/api/themes", undefined, lan))
          .status,
      ).toBe(403);
    });
  });

  it("refuses LAN display reads when the host has no display store", async () => {
    await request(
      hosted.server,
      "PUT",
      "/api/themes/living-room",
      themeBody(validEmptyAssetTheme),
    );

    // Without a display store this host is loopback-only by construction, so a
    // LAN caller is refused rather than trusted. Loopback still reads freely.
    expect(
      (
        await request(
          hosted.server,
          "GET",
          "/api/themes/living-room/document",
          undefined,
          { remoteAddress: "192.168.1.50" },
        )
      ).status,
    ).toBe(403);

    expect(
      (await request(hosted.server, "GET", "/api/themes/living-room/document"))
        .status,
    ).toBe(200);
  });

  it("rejects malformed PUT packages and preserves existing package", async () => {
    await request(
      hosted.server,
      "PUT",
      "/api/themes/living-room",
      themeBody(validEmptyAssetTheme),
    );

    const badRes = await request(
      hosted.server,
      "PUT",
      "/api/themes/living-room",
      new Uint8Array([0, 1, 2, 3]),
    );
    expect(badRes.status).toBe(400);

    const docRes = await request(
      hosted.server,
      "GET",
      "/api/themes/living-room/document",
    );
    expect(docRes.status).toBe(200);
    expect((docRes.json() as FabricThemeEnvelope).metadata?.name).toBe(
      "Living Room",
    );
  });

  it("rejects invalid or traversal theme IDs", async () => {
    const putRes = await request(
      hosted.server,
      "PUT",
      "/api/themes/..%2Fescape",
      themeBody(validEmptyAssetTheme),
    );
    expect(putRes.status).toBe(400);

    const getRes = await request(
      hosted.server,
      "GET",
      "/api/themes/..%2Fescape/document",
    );
    expect(getRes.status).toBe(400);
  });

  it("returns 404 for missing themes", async () => {
    const res = await request(
      hosted.server,
      "GET",
      "/api/themes/not-found/document",
    );
    expect(res.status).toBe(404);
  });

  it("redirects the root to the first stored theme with live data", async () => {
    await request(
      hosted.server,
      "PUT",
      "/api/themes/living-room",
      themeBody(validEmptyAssetTheme),
    );

    const res = await request(hosted.server, "GET", "/");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(
      "/?theme=living-room&data=live&theme-source=map",
    );
  });

  it("leads a first-run consumer to the editor instead of dead-ending", async () => {
    const res = await request(hosted.server, "GET", "/");

    // An empty library is a first run, not an error: the page must offer the
    // way forward rather than a sentence the consumer cannot act on.
    expect(res.status).toBe(200);
    expect(res.text()).toContain("Open the editor");
    expect(res.text()).toContain('href="/editor/"');
  });

  it("names the template on the first-run page, which is where it matters most", async () => {
    const text = (await request(hosted.server, "GET", "/")).text();

    // With nothing saved, the chooser never renders — this page is what a new
    // PC sees, and "build one" is the wrong instruction for a product that
    // ships a finished dashboard. The name comes from the same catalogue the
    // chooser reads, so the two cannot disagree about what it is called.
    expect(text).toContain("Starter — System dashboard");
    expect(text).not.toContain("Open the editor to build one");
  });
});

/**
 * Ruling 12: a pairing lasts until the host removes the client, so the credential
 * is the display record's and a restart is not a re-pairing. These cases build a
 * **second** server over the same settings directory, which is the only way to
 * tell a durable credential from a session that happened to still be live.
 */
describe("A display's credential outlives the host that minted it", () => {
  let settingsDir: string;
  let running: ReturnType<typeof createHostServer> | undefined;

  beforeEach(async () => {
    settingsDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "yunari-display-credential-"),
    );
  });

  afterEach(async () => {
    await running?.close();
    await fs.rm(settingsDir, { recursive: true, force: true });
  });

  /** A launch over `settingsDir`, with one theme to read back. */
  async function launch(): Promise<ReturnType<typeof createHostServer>> {
    const hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: settingsDir, editor: settingsDir },
      themeStore: createThemeStore(settingsDir),
      displays: createDisplayStore(settingsDir),
    });

    await request(
      hosted.server,
      "PUT",
      "/api/themes/living-room",
      themeBody(createValidPackage()),
    );

    running = hosted;
    return hosted;
  }

  const LAN = { remoteAddress: "192.168.1.50" };

  it("keeps a display paired across a restart, with no code retyped", async () => {
    const first = await launch();
    const minted = await request(
      first.server,
      "POST",
      "/api/pairing/sessions?label=Kitchen+tablet",
    );
    expect(minted.status).toBe(201);
    const { display, token } = minted.json() as {
      display: { id: string };
      token: string;
    };
    expect(display.id).toBe("kitchen-tablet");

    await first.close();

    // A second host, over the same settings directory and nothing else: the
    // credential is the whole of what the phone has.
    const second = await launch();
    const withToken = await request(
      second.server,
      "GET",
      "/api/themes",
      undefined,
      { ...LAN, headers: { "x-yunari-session": token } },
    );
    expect(withToken.status).toBe(200);
    expect(
      (withToken.json() as { themes: readonly { id: string }[] }).themes.map(
        (theme) => theme.id,
      ),
    ).toEqual(["living-room"]);
  });

  it("refuses a token that no display holds", async () => {
    const hosted = await launch();

    // A 403 and not a 200: an unknown credential is the same refusal a missing
    // one gets, so there is no second refusal path to get wrong.
    expect(
      (
        await request(
          hosted.server,
          "GET",
          `/api/themes?session=${"z".repeat(43)}`,
          undefined,
          LAN,
        )
      ).status,
    ).toBe(403);
  });

  it("does not accept an expired-looking or absent credential", async () => {
    const hosted = await launch();

    // Nothing expires on its own any more, so there is no such thing as a stale
    // credential the host still holds: an absent one, an empty one and one that
    // was never issued are all refused off loopback.
    for (const path of ["/api/themes", "/api/themes?session="]) {
      expect(
        (await request(hosted.server, "GET", path, undefined, LAN)).status,
        path,
      ).toBe(403);
    }

    // Loopback is trusted admin and never paired: it needs no credential, and
    // `this-pc` has no record for one to have come from.
    expect((await request(hosted.server, "GET", "/api/themes")).status).toBe(
      200,
    );
  });

  it("answers a label the store would refuse, and keeps serving", async () => {
    const hosted = await launch();

    // Every one of these makes `displays.create` throw, and a thrown handler is
    // an uncaught exception in Node: the host would be gone, not refusing. The
    // route asks the store's own rules first, so each is a 400 with the reason.
    const refused: readonly (readonly [string, RegExp])[] = [
      ["", /label/],
      ["x".repeat(65), /label/],
      ["!!!", /usable id/],
      ["this pc", /reserved/],
      ["default", /reserved/],
    ];

    for (const [label, reason] of refused) {
      const answer = await request(
        hosted.server,
        "POST",
        `/api/pairing/sessions?label=${encodeURIComponent(label)}`,
      );

      expect(answer.status, `label ${JSON.stringify(label)}`).toBe(400);
      expect(answer.text(), `label ${JSON.stringify(label)}`).toMatch(reason);
    }

    // Still serving, and nothing was minted on the way through.
    expect((await request(hosted.server, "GET", "/api/health")).status).toBe(
      200,
    );
    expect(
      (await request(hosted.server, "GET", "/api/pairing/sessions")).json(),
    ).toEqual({ displays: [] });
  });

  it("answers 500 rather than dying when a store refuses mid-request", async () => {
    const store = createDisplayStore(settingsDir);
    const hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: settingsDir, editor: settingsDir },
      themeStore: createThemeStore(settingsDir),
      displays: {
        ...store,
        // A file the store cannot read: every mutator refuses, and `list` is
        // made to refuse here so the rejection lands inside `handle`.
        list: () =>
          Promise.reject(new Error(`${settingsDir} could not be read`)),
      },
    });
    running = hosted;

    const answer = await request(hosted.server, "GET", "/api/pairing/sessions");
    expect(answer.status).toBe(500);
    // The reason names this machine's own file, and this route answers LAN
    // callers too, so it stays out of the body.
    expect(answer.text()).not.toContain(settingsDir);

    // The listener is still there to answer the next request.
    expect((await request(hosted.server, "GET", "/api/health")).status).toBe(
      200,
    );
  });
});

/**
 * Ruling 12: pairing mints a *display*, and the credential is that record's own.
 * These cases drive the routes that manage one — mint, rotate, rename, remove —
 * against a real store on disk, because the id a label mints is the store's rule
 * and a route keeping its own copy of it would be a second thing to keep true.
 */
describe("The pairing routes mint, rotate, rename and remove displays (ruling 12)", () => {
  let dir: string;
  let displays: ReturnType<typeof createDisplayStore>;
  let hosted: ReturnType<typeof createHostServer>;

  const LAN = { remoteAddress: "192.168.1.50" };

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-display-routes-"));
    displays = createDisplayStore(dir);
    hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: dir, editor: dir },
      themeStore: createThemeStore(dir),
      displays,
    });
  });

  afterEach(async () => {
    await hosted.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  /** The display list as a surface reads it, which is the redacted shape. */
  async function listed(): Promise<readonly Record<string, unknown>[]> {
    const answer = await request(hosted.server, "GET", "/api/pairing/sessions");
    return (answer.json() as { displays: readonly Record<string, unknown>[] })
      .displays;
  }

  /** Pairs a new display through the route, answering what it minted. */
  async function mint(label: string): Promise<{ id: string; token: string }> {
    const answer = await request(
      hosted.server,
      "POST",
      `/api/pairing/sessions?label=${encodeURIComponent(label)}`,
    );
    const body = answer.json() as {
      display: { id: string };
      token: string;
    };
    return { id: body.display.id, token: body.token };
  }

  it("mints a display and a credential for it", async () => {
    const answer = await request(
      hosted.server,
      "POST",
      "/api/pairing/sessions?label=Kitchen+tablet",
    );
    expect(answer.status).toBe(201);

    const body = answer.json() as {
      display: { id: string };
      token: string;
    };
    expect(body.display.id).toBe("kitchen-tablet");

    // The credential is the record's, so the store is what answers for it.
    expect((await displays.authenticate(body.token))?.id).toBe(
      "kitchen-tablet",
    );
    expect((await listed()).map((row) => row["id"])).toEqual([
      "kitchen-tablet",
    ]);
  });

  it("rotates an existing display's credential rather than minting a second display", async () => {
    const first = await mint("Kitchen tablet");
    const rotated = await request(
      hosted.server,
      "POST",
      "/api/pairing/sessions?displayId=kitchen-tablet",
    );
    expect(rotated.status).toBe(201);

    const body = rotated.json() as {
      display: { id: string };
      token: string;
    };
    expect(body.display.id).toBe("kitchen-tablet");
    expect(body.token).not.toBe(first.token);

    // Rotation replaces what proves the display is itself, not the display: the
    // old credential is refused and the new one is the phone's way in.
    expect(await displays.authenticate(first.token)).toBeUndefined();
    expect((await displays.authenticate(body.token))?.id).toBe(
      "kitchen-tablet",
    );
    expect(
      (
        await request(hosted.server, "GET", "/api/themes", undefined, {
          ...LAN,
          headers: { "x-yunari-session": first.token },
        })
      ).status,
    ).toBe(403);
    expect(await listed()).toHaveLength(1);
  });

  it("removes a client and its credential", async () => {
    const { id, token } = await mint("Kitchen tablet");

    expect(
      (await request(hosted.server, "DELETE", `/api/displays/${id}`)).status,
    ).toBe(200);

    expect(await displays.authenticate(token)).toBeUndefined();
    expect(await listed()).toEqual([]);
    expect(
      (
        await request(hosted.server, "GET", "/api/themes", undefined, {
          ...LAN,
          headers: { "x-yunari-session": token },
        })
      ).status,
    ).toBe(403);
  });

  it("renames a display without moving it", async () => {
    const { id } = await mint("Office TV");
    expect(id).toBe("office-tv");
    const before = await displays.find("office-tv");

    const renamed = await request(
      hosted.server,
      "PATCH",
      `/api/displays/${id}`,
      json({ label: "Kitchen" }),
    );
    expect(renamed.status).toBe(200);

    const body = renamed.json() as {
      id: string;
      label: string;
      createdAt: string;
    };
    expect(body.id).toBe("office-tv");
    expect(body.label).toBe("Kitchen");
    // Everything else is keyed by the id, so a rename that moved it would orphan
    // them: the id and the creation time are the identity it does not touch.
    expect(body.createdAt).toBe(before?.createdAt);
    expect(await listed()).toEqual([
      expect.objectContaining({ id: "office-tv", label: "Kitchen" }),
    ]);
  });

  it("refuses a chart rate the player cannot run, and leaves the stored one alone", async () => {
    await mint("Office TV");
    expect(
      (
        await request(
          hosted.server,
          "PATCH",
          "/api/displays/office-tv",
          json({ chartFps: 1 }),
        )
      ).status,
    ).toBe(200);

    const refused = await request(
      hosted.server,
      "PATCH",
      "/api/displays/office-tv",
      json({ chartFps: 5 }),
    );
    // The caller's typo and not a host fault: the wrapper's 500 would tell them
    // "the host could not answer that request", which is not what happened.
    expect(refused.status).toBe(400);
    // The store's own words, so a caller reads their own mistake rather than
    // the wrapper's "the host could not answer that request".
    expect(refused.text()).toBe('A chart rate must be 1 or 30, not "5".');
    expect((await displays.find("office-tv"))?.chartFps).toBe(1);
  });

  it("sets a chart rate the player can run, and answers the redacted record", async () => {
    const { token } = await mint("Office TV");

    const answered = await request(
      hosted.server,
      "PATCH",
      "/api/displays/office-tv",
      json({ chartFps: 30 }),
    );
    expect(answered.status).toBe(200);

    const body = answered.json() as { id: string; chartFps: number };
    expect(body.id).toBe("office-tv");
    expect(body.chartFps).toBe(30);
    expect((await displays.find("office-tv"))?.chartFps).toBe(30);

    // The answer is a record a surface repaints from, so it goes through the
    // same redaction every other route that could echo a record does.
    expect(answered.text()).not.toContain(hashToken(token));
    expect(body).not.toHaveProperty("tokenHash");
  });

  it("refuses an empty label rather than storing it", async () => {
    await mint("Office TV");

    const refused = await request(
      hosted.server,
      "PATCH",
      "/api/displays/office-tv",
      json({ label: "   " }),
    );
    expect(refused.status).toBe(400);
    expect(refused.text()).toMatch(/label/);
    expect(await listed()).toEqual([
      expect.objectContaining({ label: "Office TV" }),
    ]);
  });

  it("refuses a rename from off loopback", async () => {
    await mint("Office TV");

    const refused = await request(
      hosted.server,
      "PATCH",
      "/api/displays/office-tv",
      json({ label: "Kitchen" }),
      LAN,
    );
    expect(refused.status).toBe(403);
    // The displays' own guard, not the generic one every unknown path falls
    // through: a 403 from a route that does not exist is not a refusal.
    expect(refused.text()).toBe("Displays are available on this PC only.");
    expect(await listed()).toEqual([
      expect.objectContaining({ label: "Office TV" }),
    ]);
  });

  it("answers 404 for a displayId it does not know, on both routes", async () => {
    expect(
      (
        await request(
          hosted.server,
          "POST",
          "/api/pairing/sessions?displayId=nobody",
        )
      ).status,
    ).toBe(404);
    expect(
      (await request(hosted.server, "DELETE", "/api/displays/nobody")).status,
    ).toBe(404);
    expect(
      (
        await request(
          hosted.server,
          "PATCH",
          "/api/displays/nobody",
          json({ label: "Kitchen" }),
        )
      ).status,
    ).toBe(404);

    // A refused rotation minted nothing: no display, and no credential.
    expect(await listed()).toEqual([]);
  });

  it("refuses a displayId from off loopback before reading it", async () => {
    await mint("Kitchen tablet");

    // The guard precedes the parameter read, and a store that records its calls
    // is how that is checkable: a route reading the id first leaves a mark.
    const calls: string[] = [];
    const watching = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: dir, editor: dir },
      themeStore: createThemeStore(dir),
      displays: {
        ...displays,
        find: (id) => {
          calls.push(`find:${id}`);
          return Promise.resolve(undefined);
        },
        rotate: (id) => {
          calls.push(`rotate:${id}`);
          return Promise.resolve(undefined);
        },
      },
    });

    try {
      const refused = await request(
        watching.server,
        "POST",
        "/api/pairing/sessions?displayId=kitchen-tablet",
        undefined,
        LAN,
      );
      expect(refused.status).toBe(403);
      expect(refused.text()).toBe("Pairing is available on this PC only.");
      expect(calls).toEqual([]);
    } finally {
      await watching.close();
    }

    expect(await listed()).toEqual([
      expect.objectContaining({ id: "kitchen-tablet" }),
    ]);
  });

  it("refuses to remove the reserved local display", async () => {
    const refused = await request(
      hosted.server,
      "DELETE",
      `/api/displays/${LOCAL_DISPLAY_ID}`,
    );
    expect(refused.status).toBe(409);
    expect(refused.text()).toMatch(/This PC/);
  });

  it("never echoes a stored hash, and carries a token only where it mints one", async () => {
    const { token } = await mint("Kitchen tablet");
    const rotated = await request(
      hosted.server,
      "POST",
      "/api/pairing/sessions?displayId=kitchen-tablet",
    );
    expect(rotated.status).toBe(201);
    const fresh = (rotated.json() as { token: string }).token;
    expect(fresh).not.toBe(token);

    // Rotation is the one moment a credential is in the clear. The list a
    // surface repaints from carries neither the token nor the hash it is stored
    // as: echoing the hash would undo the reason it is hashed.
    const list = await request(hosted.server, "GET", "/api/pairing/sessions");
    expect(list.text()).not.toContain(fresh);
    expect(list.text()).not.toContain(hashToken(fresh));
    expect((await listed())[0]).not.toHaveProperty("tokenHash");
  });
});

/**
 * Spec § "The host's own monitors": a second kind of display, *specified* rather
 * than paired. It is the host's own screen, so it carries no credential, and the
 * list it is chosen from is a probe of this PC rather than anything stored.
 */
describe("A local monitor is specified rather than paired", () => {
  let dir: string;
  let displays: ReturnType<typeof createDisplayStore>;
  let hosted: ReturnType<typeof createHostServer>;

  const LAN = { remoteAddress: "192.168.1.50" };
  const ATTACHED: readonly Monitor[] = [
    {
      deviceName: "\\\\.\\DISPLAY1",
      serial: "4790810010513",
      main: true,
      positionX: 0,
      positionY: 0,
      currentResX: 2560,
      currentResY: 1440,
    },
    {
      deviceName: "\\\\.\\DISPLAY2",
      main: false,
      positionX: 2560,
      positionY: 0,
      currentResX: 1920,
      currentResY: 1080,
    },
  ];

  function host(
    overrides: Partial<HostServerOptions> = {},
  ): ReturnType<typeof createHostServer> {
    return createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: dir, editor: dir },
      themeStore: createThemeStore(dir),
      displays,
      monitors: () => Promise.resolve(ATTACHED),
      ...overrides,
    });
  }

  /** A launcher that opens nothing: what these cases need is whether a window
   *  was opened and closed, and the launcher's own suite covers its command
   *  line. */
  function windowsOver(
    opened: { readonly kill: ReturnType<typeof vi.fn> }[],
    from: ReturnType<typeof createDisplayStore> = displays,
  ): ReturnType<typeof createDisplayLauncher> {
    return createDisplayLauncher({
      displays: from,
      port: 5227,
      browser: "/fake/chrome.exe",
      spawn: ((
        _file: string,
        _args: readonly string[],
        _options: SpawnOptions,
      ) => {
        const kill = vi.fn();
        opened.push({ kill });

        return {
          killed: false,
          kill,
          once: (): void => undefined,
        } as unknown as ChildProcess;
      }) as unknown as typeof spawn,
      monitors: () => Promise.resolve(ATTACHED),
    });
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-local-monitor-"));
    displays = createDisplayStore(dir);
    hosted = host();
  });

  afterEach(async () => {
    await hosted.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  /** The display list as a surface reads it, which is the redacted shape. */
  async function listed(
    from: ReturnType<typeof createHostServer> = hosted,
  ): Promise<readonly Record<string, unknown>[]> {
    const answer = await request(from.server, "GET", "/api/pairing/sessions");
    return (answer.json() as { displays: readonly Record<string, unknown>[] })
      .displays;
  }

  it("adds a local monitor with no credential", async () => {
    const answer = await request(
      hosted.server,
      "POST",
      "/api/displays",
      json({
        label: "Left screen",
        monitor: { deviceName: "\\\\.\\DISPLAY2" },
      }),
    );
    expect(answer.status).toBe(201);

    const body = answer.json() as {
      display: { id: string; kind: string; monitor: unknown };
    };
    expect(body.display.id).toBe("left-screen");
    expect(body.display.kind).toBe("local");
    expect(body.display.monitor).toEqual({ deviceName: "\\\\.\\DISPLAY2" });
    // Nothing to hand out: this display proves itself by being on this PC.
    expect(Object.keys(body)).toEqual(["display"]);
    expect(body.display).not.toHaveProperty("tokenHash");
    expect(await listed()).toEqual([
      expect.objectContaining({ id: "left-screen", kind: "local" }),
    ]);
  });

  it("refuses a body the file's own reader would drop", async () => {
    const refused = await request(
      hosted.server,
      "POST",
      "/api/displays",
      json({ label: "Left screen", monitor: { serial: "4790810010513" } }),
    );
    expect(refused.status).toBe(400);
    expect(refused.text()).toMatch(/monitor/);
    // Written only if the next read would find it: a record the file drops is a
    // display that disappears, which is `vg-616`'s class of bug.
    expect(await listed()).toEqual([]);
  });

  it("answers a display-store failure with a fixed sentence and no path", async () => {
    const failing = host({
      displays: {
        ...displays,
        createLocal: () =>
          Promise.reject(
            new Error(
              `EACCES: permission denied, open '${dir}\\displays.json'`,
            ),
          ),
      },
    });
    const logged = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      const refused = await request(
        failing.server,
        "POST",
        "/api/displays",
        json({
          label: "Left screen",
          monitor: { deviceName: "\\\\.\\DISPLAY2" },
        }),
      );

      expect(refused.status).toBe(500);
      expect(refused.text()).toBe("The host could not add that display.");
      // The reason named this machine's file; only the console keeps it.
      expect(refused.text()).not.toContain(dir);
      expect(logged).toHaveBeenCalled();

      // The listener is still there for the next request.
      expect((await request(failing.server, "GET", "/api/health")).status).toBe(
        200,
      );
    } finally {
      logged.mockRestore();
      await failing.close();
    }
  });

  it("answers what is attached, for the owner to pick from", async () => {
    const answer = await request(
      hosted.server,
      "GET",
      "/api/displays/monitors",
    );
    expect(answer.status).toBe(200);
    expect((answer.json() as { monitors: unknown }).monitors).toEqual(ATTACHED);
  });

  it("refuses a local display from off loopback, on every route", async () => {
    const refused = await request(
      hosted.server,
      "POST",
      "/api/displays",
      json({
        label: "Left screen",
        monitor: { deviceName: "\\\\.\\DISPLAY2" },
      }),
      LAN,
    );
    expect(refused.status).toBe(403);
    expect(refused.text()).toBe("Displays are available on this PC only.");
    expect(
      (
        await request(
          hosted.server,
          "GET",
          "/api/displays/monitors",
          undefined,
          LAN,
        )
      ).status,
    ).toBe(403);
    expect(await listed()).toEqual([]);
  });

  it("refuses an off-loopback request before reading its body", async () => {
    const calls: string[] = [];
    const watching = host({
      displays: {
        ...displays,
        createLocal: (label, monitor) => {
          calls.push(`createLocal:${label}`);
          return displays.createLocal(label, monitor);
        },
      },
      monitors: () => {
        calls.push("monitors");
        return Promise.resolve(ATTACHED);
      },
    });

    try {
      // A body that is not JSON: a guard that ran after the read would answer
      // the parse's 400 rather than its own 403.
      const refused = await request(
        watching.server,
        "POST",
        "/api/displays",
        "{ not json",
        LAN,
      );
      expect(refused.status).toBe(403);
      expect(refused.text()).toBe("Displays are available on this PC only.");
      expect(
        (
          await request(
            watching.server,
            "GET",
            "/api/displays/monitors",
            undefined,
            LAN,
          )
        ).status,
      ).toBe(403);
      expect(calls).toEqual([]);
    } finally {
      await watching.close();
    }
  });

  it("keeps a display whose monitor is no longer attached", async () => {
    await request(
      hosted.server,
      "POST",
      "/api/displays",
      json({
        label: "Left screen",
        monitor: { deviceName: "\\\\.\\DISPLAY2", serial: "4790810010513" },
      }),
    );

    // The cable is out: the probe no longer reports that monitor.
    const unplugged = host({ monitors: () => Promise.resolve([ATTACHED[0]!]) });

    try {
      const answer = await request(
        unplugged.server,
        "GET",
        "/api/displays/monitors",
      );
      expect(
        (answer.json() as { monitors: readonly unknown[] }).monitors,
      ).toEqual([ATTACHED[0]]);

      // The record stays, with its hint: deleting it would throw away the
      // person's configuration to report a fact about the furniture.
      expect(await listed(unplugged)).toEqual([
        expect.objectContaining({
          id: "left-screen",
          monitor: { deviceName: "\\\\.\\DISPLAY2", serial: "4790810010513" },
        }),
      ]);
    } finally {
      await unplugged.close();
    }
  });

  it("answers an empty list for a probe that found nothing, and 500 for one that failed", async () => {
    const empty = host({ monitors: () => Promise.resolve([]) });
    const failed = host({
      monitors: () => Promise.reject(new Error("graphics() failed")),
    });

    try {
      const nothing = await request(
        empty.server,
        "GET",
        "/api/displays/monitors",
      );
      expect(nothing.status).toBe(200);
      expect(nothing.json()).toEqual({ monitors: [] });

      // Not `[]`: an empty list would tell the owner nothing is attached when
      // the truth is that the host could not find out.
      const refused = await request(
        failed.server,
        "GET",
        "/api/displays/monitors",
      );
      expect(refused.status).toBe(500);
      expect(refused.text()).toBe("The host could not answer that request.");
    } finally {
      await empty.close();
      await failed.close();
    }
  });

  it("names the methods the path it answered actually supports", async () => {
    // A caller told GET is supported on the collection path, or PATCH on the
    // monitors path, has been told nothing true.
    const collection = await request(hosted.server, "GET", "/api/displays");
    expect(collection.status).toBe(405);
    expect(collection.text()).toBe("This path supports POST.");

    const monitors = await request(
      hosted.server,
      "POST",
      "/api/displays/monitors",
    );
    expect(monitors.status).toBe(405);
    expect(monitors.text()).toBe("This path supports GET.");

    const record = await request(
      hosted.server,
      "POST",
      "/api/displays/left-screen",
    );
    expect(record.status).toBe(405);
    expect(record.text()).toBe("This path supports PATCH and DELETE.");

    const autostart = await request(
      hosted.server,
      "GET",
      "/api/displays/autostart",
    );
    expect(autostart.status).toBe(405);
    expect(autostart.text()).toBe("This path supports POST.");
  });

  it("refuses a second local display for a monitor one already holds", async () => {
    const first = await request(
      hosted.server,
      "POST",
      "/api/displays",
      json({
        label: "Left screen",
        monitor: { deviceName: "\\\\.\\DISPLAY2" },
      }),
    );
    expect(first.status).toBe(201);

    // A conflict with what this host holds, not a body the store would not
    // read: two records for one screen would put two windows on it.
    const second = await request(
      hosted.server,
      "POST",
      "/api/displays",
      json({
        label: "Left screen again",
        monitor: { deviceName: "\\\\.\\DISPLAY2" },
      }),
    );
    expect(second.status).toBe(409);
    expect(second.text()).toMatch(/already holds/);
    expect(await listed()).toHaveLength(1);
  });

  it("launches a local display when it is added", async () => {
    const opened: { readonly kill: ReturnType<typeof vi.fn> }[] = [];
    const hosting = host({ launcher: windowsOver(opened) });

    try {
      const answer = await request(
        hosting.server,
        "POST",
        "/api/displays",
        json({
          label: "Left screen",
          monitor: { deviceName: "\\\\.\\DISPLAY2" },
        }),
      );
      expect(answer.status).toBe(201);

      // The record the POST wrote has never been seen, so the sighting is not
      // evidence of a window: the host opens one now, on that monitor.
      expect(opened).toHaveLength(1);
    } finally {
      await hosting.close();
    }
  });

  it("counts a local display's own poll as a sighting", async () => {
    // A record stamped in the past, so the poll's own stamp is a value this
    // case can tell apart rather than one a fast box may collide with.
    const past = Date.parse("2026-10-18T12:00:00.000Z");
    const store = createDisplayStore(dir, { now: () => past });
    const opened: { readonly kill: ReturnType<typeof vi.fn> }[] = [];
    const hosting = host({
      displays: store,
      launcher: windowsOver(opened, store),
    });

    try {
      const created = await request(
        hosting.server,
        "POST",
        "/api/displays",
        json({
          label: "Left screen",
          monitor: { deviceName: "\\\\.\\DISPLAY2" },
        }),
      );
      expect(created.status).toBe(201);
      // The record has never been seen, so the sighting is not evidence of a
      // window: the host opens one now.
      expect(opened).toHaveLength(1);

      // The poll a local display's page makes, naming itself the way its URL
      // does. It is the only repeating request such a display has, and so the
      // only sighting it can make.
      const poll = await request(
        hosting.server,
        "GET",
        "/api/published?display=left-screen",
      );
      expect(poll.status).toBe(200);
      expect((poll.json() as { display: unknown }).display).toEqual({
        id: "left-screen",
        theme: null,
        // A local display, so the poll also carries the rate its charts repaint
        // at: this monitor is in front of the person using it.
        chartFps: 1,
      });

      const seen = await store.find("left-screen");
      expect(seen?.lastSeenAt).not.toBe(seen?.createdAt);

      // A host restarted after being killed has no memory of the window it
      // left behind, so the sighting is the only thing that says one is up —
      // without it this second window lands on a monitor that already has one.
      const restarted = windowsOver(opened, store);
      await restarted.reconcile();
      restarted.stop();

      expect(opened).toHaveLength(1);
    } finally {
      await hosting.close();
    }
  });

  it("closes the window when the display is removed", async () => {
    const opened: { readonly kill: ReturnType<typeof vi.fn> }[] = [];
    const hosting = host({ launcher: windowsOver(opened) });

    try {
      await request(
        hosting.server,
        "POST",
        "/api/displays",
        json({
          label: "Left screen",
          monitor: { deviceName: "\\\\.\\DISPLAY2" },
        }),
      );

      const answer = await request(
        hosting.server,
        "DELETE",
        "/api/displays/left-screen",
      );
      expect(answer.status).toBe(200);
      expect(opened[0]?.kill).toHaveBeenCalled();
      expect(await listed(hosting)).toEqual([]);
    } finally {
      await hosting.close();
    }
  });

  it("registers the host at sign-in, once", async () => {
    const message =
      "Registered. Windows starts Yunari at sign-in, so every local monitor " +
      "comes back with it.";
    const register = vi.fn(async () => ({ ok: true, message }));
    const hosting = host({ registerAutostart: register });

    try {
      const answer = await request(
        hosting.server,
        "POST",
        "/api/displays/autostart",
      );
      expect(answer.status).toBe(200);
      // The registrar's own message is the answer: it is what the surface shows.
      expect(answer.json()).toEqual({ ok: true, message });
      expect(register).toHaveBeenCalledTimes(1);
    } finally {
      await hosting.close();
    }
  });

  it("says so when this host cannot register itself", async () => {
    const answer = await request(
      hosted.server,
      "POST",
      "/api/displays/autostart",
    );

    expect(answer.status).toBe(404);
    expect(answer.text()).toMatch(/start at sign-in/);
  });

  it("answers a path that is no route the way it answers any unknown path", async () => {
    // Neither path matches a route of its own nor the id path, so a method set
    // would be a claim about a path that needs an id segment it does not carry:
    // the answer is whatever this server answers any path it does not know.
    for (const method of ["POST", "GET"]) {
      const unknown = await request(hosted.server, method, "/no-such-path");
      expect(unknown.status).toBeGreaterThanOrEqual(400);

      for (const pathname of ["/api/displays/", "/api/displays/a/b"]) {
        const answer = await request(hosted.server, method, pathname);
        expect(answer.status).toBe(unknown.status);
        expect(answer.text()).toBe(unknown.text());
      }
    }
  });

  it("answers the monitor list even when a display is named Monitors", async () => {
    // `monitors` is not reserved, so a display may legitimately mint it
    // (`mintedDisplayId`); the route is a path of its own rather than an id.
    await request(
      hosted.server,
      "POST",
      "/api/displays",
      json({ label: "Monitors", monitor: { deviceName: "\\\\.\\DISPLAY2" } }),
    );
    expect((await listed())[0]).toMatchObject({ id: "monitors" });

    const answer = await request(
      hosted.server,
      "GET",
      "/api/displays/monitors",
    );
    expect(answer.status).toBe(200);
    expect((answer.json() as { monitors: unknown }).monitors).toEqual(ATTACHED);
  });
});

/**
 * The other route reachable unpaired (spec § "Pairing a display that has no
 * camera"): a device with no camera types the one-time code the host is showing
 * and gets a durable credential back.
 *
 * The code is the only short-lived secret in the exchange, so what these cases
 * pin is the window — one code at a time, a mismatch that never burns it, a
 * penalty that is a delay rather than a lockout, and one refusal for every way a
 * code can fail.
 */
describe("A display with no camera pairs by typing the one-time code", () => {
  let dir: string;
  let displays: ReturnType<typeof createDisplayStore>;
  let codes: ReturnType<typeof createPairingCodeStore>;
  let hosted: ReturnType<typeof createHostServer>;

  const LAN = { remoteAddress: "192.168.1.50" };

  function host(
    overrides: Partial<HostServerOptions> = {},
  ): ReturnType<typeof createHostServer> {
    return createHostServer({
      registry: new ProviderRegistry([]),
      // The pairing page is served from the admin root, so this is the one
      // describe that needs it: `/pair` is a phone's first request.
      bundles: { player: dir, editor: dir, admin: ADMIN_DIR },
      themeStore: createThemeStore(dir),
      displays,
      pairingCodes: codes,
      ...overrides,
    });
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-pairing-code-"));
    displays = createDisplayStore(dir);
    // The penalty is a real delay in production and no wait at all here: the
    // cases assert what it asks for, and waiting it out would only be slower.
    codes = createPairingCodeStore({ wait: async () => {} });
    hosted = host();
  });

  afterEach(async () => {
    await hosted.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  /** The code the card is showing, read the way the card reads it. */
  async function shown(
    server: ListenableServer = hosted.server,
  ): Promise<string> {
    const answer = await request(server, "GET", "/api/pairing/code");
    expect(answer.status).toBe(200);
    return (answer.json() as { code: string }).code;
  }

  /** A claim from off loopback, which is every display that has not paired. */
  function claim(
    body: unknown,
    server: ListenableServer = hosted.server,
  ): ReturnType<typeof request> {
    return request(
      server,
      "POST",
      "/api/pairing/claim",
      JSON.stringify(body),
      LAN,
    );
  }

  it("pairs a display from the code alone, with no credential and off loopback", async () => {
    const code = await shown();

    const answer = await claim({ code, label: "Kitchen tablet" });
    expect(answer.status).toBe(200);

    const body = answer.json() as { displayId: string; token: string };
    expect(body.displayId).toBe("kitchen-tablet");
    // The credential is the record's and it is durable (ruling 12): the code is
    // spent by the exchange and what it bought outlives it.
    expect((await displays.authenticate(body.token))?.id).toBe(
      "kitchen-tablet",
    );
    expect(codes.current()).toBeUndefined();

    // And the display is a row the owner can see and remove by name.
    const listed = await request(hosted.server, "GET", "/api/pairing/sessions");
    expect(
      (listed.json() as { displays: readonly { id: string }[] }).displays.map(
        (row) => row.id,
      ),
    ).toEqual(["kitchen-tablet"]);
  });

  it("answers one refusal for every way a code can fail", async () => {
    const code = await shown();
    const unknown = await claim({ code: "ZZZZZZ", label: "Kitchen tablet" });
    expect(unknown.status).toBe(404);

    // Spent.
    expect((await claim({ code, label: "Kitchen tablet" })).status).toBe(200);
    const spent = await claim({ code, label: "Office TV" });
    expect(spent.status).toBe(404);
    expect(spent.text()).toBe(unknown.text());

    // Expired, on a host whose window has already closed.
    const expired = host({
      pairingCodes: createPairingCodeStore({ ttlMs: 0, wait: async () => {} }),
    });
    try {
      const stale = await shown(expired.server);
      const answer = await claim(
        { code: stale, label: "Office TV" },
        expired.server,
      );
      expect(answer.status).toBe(404);
      expect(answer.text()).toBe(unknown.text());
    } finally {
      await expired.close();
    }

    // A refusal mints nothing, whatever it was that failed.
    expect((await displays.list()).map((row) => row.id)).toEqual([
      "kitchen-tablet",
    ]);
  });

  it("does not let a wrong guess close the window", async () => {
    const code = await shown();

    for (let guess = 0; guess < 5; guess += 1) {
      expect(
        (await claim({ code: "ZZZZZZ", label: "Kitchen tablet" })).status,
      ).toBe(404);
    }

    // Five wrong guesses, and the person typing the sixth still pairs: one live
    // code has nothing a mismatch could have named, so nothing was spent.
    expect((await claim({ code, label: "Kitchen tablet" })).status).toBe(200);
    expect((await displays.list()).map((row) => row.id)).toEqual([
      "kitchen-tablet",
    ]);
  });

  it("answers a guesser with a growing delay, and never with a lockout", async () => {
    const waited: number[] = [];
    const guarded = host({
      pairingCodes: createPairingCodeStore({
        wait: async (ms) => {
          waited.push(ms);
        },
      }),
    });

    try {
      const code = await shown(guarded.server);

      for (let guess = 0; guess < 5; guess += 1) {
        const refused = await claim(
          { code: "ZZZZZZ", label: "Kitchen tablet" },
          guarded.server,
        );
        // The same answer however long the wait: a distinct one would say
        // whether a code exists, which is the thing this route must not say.
        expect(refused.status).toBe(404);
      }

      expect(waited).toEqual([250, 500, 1000, 2000]);

      // And the right code still succeeds, which is the whole difference
      // between a penalty and a lockout.
      expect(
        (await claim({ code, label: "Kitchen tablet" }, guarded.server)).status,
      ).toBe(200);
    } finally {
      await guarded.close();
    }
  });

  it("refuses a name that would mint a reserved id, and does not spend the code", async () => {
    const code = await shown();

    for (const label of ["this-pc", "default"]) {
      const refused = await claim({ code, label });
      expect(refused.status, label).toBe(400);
      expect(refused.text()).toMatch(/reserved display id/);
    }

    // The window is untouched: a name the store refuses is the caller's to fix,
    // and spending the code would take it from the person typing it.
    expect(codes.current()?.code).toBe(code);
    expect((await claim({ code, label: "Kitchen tablet" })).status).toBe(200);
  });

  it("reads the live code and does not rotate it", async () => {
    const first = await shown();

    // A second read of a live window must not move the code out from under
    // whoever is typing it: the same window answers the same code.
    expect(await shown()).toBe(first);
    expect((await claim({ code: first, label: "Kitchen tablet" })).status).toBe(
      200,
    );

    // And once it is spent, the next read is a new window rather than the spent
    // code again.
    expect(await shown()).not.toBe(first);
  });

  it("keeps the code on this PC, and refuses off loopback before minting one", async () => {
    const minted: string[] = [];
    const watching = host({
      pairingCodes: {
        ...codes,
        mint: () => {
          minted.push("mint");
          return codes.mint();
        },
      },
    });

    try {
      const refused = await request(
        watching.server,
        "GET",
        "/api/pairing/code",
        undefined,
        LAN,
      );
      expect(refused.status).toBe(403);
      expect(refused.text()).toBe("Pairing is available on this PC only.");
      // The guard precedes the mint, and a store that records its calls is how
      // that is checkable: a route that minted first would leave a mark here.
      expect(minted).toEqual([]);
    } finally {
      await watching.close();
    }
  });

  it("serves the page a phone with no credential opens", async () => {
    const answer = await request(
      hosted.server,
      "GET",
      "/pair?code=ABC234",
      undefined,
      LAN,
    );
    expect(answer.status).toBe(200);
    expect(answer.headers["content-type"]).toContain("text/html");
    // The page is the exchange's only client: nothing else it does reads the
    // host, so it is the one document an unpaired device may have.
    expect(answer.text()).toContain("/api/pairing/claim");
  });
});

describe("A loopback admin request must prove it is same-origin (§0116)", () => {
  let dir: string;
  let hosted: ReturnType<typeof createHostServer>;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-loopback-origin-"));
    hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: dir, editor: dir },
      themeStore: createThemeStore(dir),
      displays: createDisplayStore(dir),
      pairingCodes: createPairingCodeStore({ wait: async () => {} }),
      host: { id: "3f9a1c0b7d2e4a68", name: "Study PC" },
    });
  });

  afterEach(async () => {
    await hosted.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("refuses a rebound Host on a loopback admin route", async () => {
    const answer = await request(
      hosted.server,
      "GET",
      "/api/pairing/code",
      undefined,
      {
        remoteAddress: "127.0.0.1",
        headers: { host: "evil.example:5227" },
      },
    );
    expect(answer.status).toBe(403);
    expect(answer.text()).toBe("That request is from another origin.");
  });

  it("refuses another page's Origin even when the Host says localhost", async () => {
    const answer = await request(
      hosted.server,
      "GET",
      "/api/pairing/code",
      undefined,
      {
        remoteAddress: "127.0.0.1",
        headers: { host: "localhost:5227", origin: "https://evil.example" },
      },
    );
    expect(answer.status).toBe(403);
    expect(answer.text()).toBe("That request is from another origin.");
  });

  it("still serves localhost, 127.0.0.1 and [::1]", async () => {
    for (const host of ["localhost:5227", "127.0.0.1:5227", "[::1]:5227"]) {
      expect(
        (
          await request(hosted.server, "GET", "/api/pairing/code", undefined, {
            remoteAddress: "127.0.0.1",
            headers: { host },
          })
        ).status,
        host,
      ).toBe(200);
    }
  });

  it("leaves the cross-origin /api/host discovery route alone", async () => {
    expect(
      (
        await request(hosted.server, "GET", "/api/host", undefined, {
          remoteAddress: "127.0.0.1",
          headers: { host: "evil.example:5227" },
        })
      ).status,
    ).toBe(200);
  });

  it("does not apply to a non-loopback peer", async () => {
    const shown = await request(hosted.server, "GET", "/api/pairing/code");
    const { code } = shown.json() as { code: string };

    const claimed = await request(
      hosted.server,
      "POST",
      "/api/pairing/claim",
      JSON.stringify({ code, label: "Kitchen tablet" }),
      {
        remoteAddress: "192.168.1.50",
        headers: { host: "192.168.1.50:5227" },
      },
    );

    // `isForeignOrigin` is true here, because the Host is not a loopback name;
    // the 200 is the loopback-peer condition doing its work, not the route
    // answering anyway.
    expect(claimed.status).toBe(200);
  });
});

describe("Import and health keep their detail on this PC", () => {
  let dir: string;
  let hosted: ReturnType<typeof createHostServer>;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-loopback-surface-"));
    hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: dir, editor: dir },
      themeStore: createThemeStore(dir),
    });
  });

  afterEach(async () => {
    await hosted.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("refuses theme import from another origin even on loopback", async () => {
    // The central guard answers this one; the branch check is defence in depth.
    const answer = await request(
      hosted.server,
      "POST",
      "/api/themes/import",
      undefined,
      {
        headers: { host: "127.0.0.1:5173", origin: "https://evil.example" },
      },
    );
    expect(answer.status).toBe(403);
  });

  it("refuses pairing from another origin even on loopback", async () => {
    // Already the central guard's case, pinned so a refactor cannot lose it.
    const answer = await request(
      hosted.server,
      "POST",
      "/api/pairing/sessions",
      undefined,
      {
        headers: { host: "127.0.0.1:5173", origin: "https://evil.example" },
      },
    );
    expect(answer.status).toBe(403);
  });

  it("answers a LAN peer's health with only ok", async () => {
    const answer = await request(
      hosted.server,
      "GET",
      "/api/health",
      undefined,
      {
        remoteAddress: "192.168.1.50",
        headers: { host: "192.168.1.50:5173" },
      },
    );
    expect(answer.status).toBe(200);
    expect(answer.json()).toEqual({ ok: true });
  });

  it("keeps the health detail for a loopback peer", async () => {
    const answer = await request(hosted.server, "GET", "/api/health");
    expect(answer.json()).toMatchObject({ displays: 0, polling: [] });
  });
});

/** A template the product ships, and the list the host's pages read it from. */
describe("The templates the host serves", () => {
  let tmpDir: string;
  let hosted: ReturnType<typeof createHostServer>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-templates-"));
    const store = createThemeStore(tmpDir);
    await store.write(
      "living-room",
      createValidPackage("living-room", "Living Room"),
    );
    await store.write("studio", createValidPackage("studio", "Studio"));
    hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: tmpDir, editor: tmpDir, admin: ADMIN_DIR },
      themeStore: store,
      activeTheme: createActiveThemeStore(tmpDir),
    });
  });

  afterEach(async () => {
    await hosted.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("names the template beside the saved themes, from the chooser's own route", async () => {
    const res = await request(hosted.server, "GET", "/api/themes/active");
    const body = res.json() as {
      templates: readonly { id: string; name: string }[];
      themes: readonly { id: string }[];
    };

    // The chooser draws both kinds of row from this one response, so a host
    // that serves templates nowhere but the editor's own library shows an
    // empty list of what the product offers.
    expect(body.templates).toEqual([
      { id: "yunari-starter-template", name: "Starter — System dashboard" },
    ]);
    // A template is not a stored theme, so it stays out of the author's own.
    expect(body.themes.map((theme) => theme.id)).toEqual([
      "living-room",
      "studio",
    ]);
  });

  it("serves the same list to the library route, so the editor could read it", async () => {
    const res = await request(hosted.server, "GET", "/api/themes");
    const body = res.json() as { templates: readonly { id: string }[] };

    expect(body.templates.map((template) => template.id)).toEqual([
      "yunari-starter-template",
    ]);
  });

  it("cannot be chosen as the active theme, because it is not stored", async () => {
    const res = await request(
      hosted.server,
      "PUT",
      "/api/themes/active",
      // The display the write is for is named now that the route writes one
      // entry of a map rather than an implicit default.
      json({ display: "default", id: "yunari-starter-template" }),
    );

    // Only a theme with a file can be displayed. Accepting the id here would
    // point every display at a package that does not exist.
    expect(res.status).toBe(404);
  });
});

/**
 * The display map: which theme each display holds, and the default a display
 * with no entry of its own falls to.
 *
 * One route reads the map and writes one entry of it, and the write's authority
 * is derived from the caller rather than claimed in the body (spec § "A display
 * may change its own theme").
 */
describe("The display map", () => {
  let dir: string;
  let displays: ReturnType<typeof createDisplayStore>;
  let activeTheme: ReturnType<typeof createActiveThemeStore>;
  let hosted: ReturnType<typeof createHostServer>;

  const LAN = { remoteAddress: "192.168.1.50" };

  /** A display off this PC, paired, holding the credential that identifies it. */
  async function paired(label: string): Promise<string> {
    const token = newToken();
    await displays.create(label, token);
    return token;
  }

  /** A request off the LAN carrying a display's own credential. */
  function as(token: string): {
    remoteAddress: string;
    headers: Record<string, string>;
  } {
    return { ...LAN, headers: { "x-yunari-session": token } };
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-theme-map-"));
    const store = createThemeStore(dir);
    await store.write(
      "living-room",
      createValidPackage("living-room", "Living Room"),
    );
    await store.write(
      "kitchen-strip",
      createValidPackage("kitchen-strip", "Kitchen Strip"),
    );
    await store.write(
      "attic-wall",
      createValidPackage("attic-wall", "Attic Wall"),
    );
    displays = createDisplayStore(dir);
    activeTheme = createActiveThemeStore(dir);
    hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: dir, editor: dir },
      themeStore: store,
      displays,
      activeTheme,
    });
  });

  afterEach(async () => {
    await hosted.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("lists every display with the theme it holds", async () => {
    await displays.create("Kitchen tablet", newToken());
    await activeTheme.write("kitchen-tablet", "kitchen-strip");

    const res = await request(hosted.server, "GET", "/api/themes/active");
    const body = res.json() as {
      default: string | null;
      displays: readonly {
        id: string;
        label: string;
        kind: string;
        theme: string | null;
      }[];
    };

    // An entry with no theme is `theme: null` rather than absent, so the page
    // can tell "no theme" from "no display". This PC is always present and is
    // never asked of the store: it has no record to take a label from.
    expect(res.status).toBe(200);
    expect(body.displays).toEqual([
      { id: "this-pc", label: "This PC", kind: "local", theme: null },
      {
        id: "kitchen-tablet",
        label: "Kitchen tablet",
        kind: "paired",
        theme: "kitchen-strip",
      },
    ]);
    expect(body.default).toBeNull();
  });

  it("writes one display and leaves the others alone", async () => {
    await displays.create("Kitchen tablet", newToken());
    await displays.create("Hall TV", newToken());

    const res = await request(
      hosted.server,
      "PUT",
      "/api/themes/active",
      json({ display: "kitchen-tablet", id: "kitchen-strip" }),
    );
    const body = res.json() as {
      ok: boolean;
      default: string | null;
      displays: readonly {
        id: string;
        label: string;
        kind: string;
        theme: string | null;
      }[];
    };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.displays).toContainEqual({
      id: "kitchen-tablet",
      label: "Kitchen tablet",
      kind: "paired",
      theme: "kitchen-strip",
    });
    expect(await activeTheme.read("kitchen-tablet", async () => true)).toBe(
      "kitchen-strip",
    );
    expect(await activeTheme.read("hall-tv", async () => true)).toBeUndefined();
    expect(
      await activeTheme.read(DEFAULT_DISPLAY, async () => true),
    ).toBeUndefined();
  });

  it("writes the default through the same route", async () => {
    const res = await request(
      hosted.server,
      "PUT",
      "/api/themes/active",
      json({ display: "default", id: "living-room" }),
    );

    expect(res.status).toBe(200);
    expect(await activeTheme.read(DEFAULT_DISPLAY, async () => true)).toBe(
      "living-room",
    );
    // The default is a key of the map rather than a second setting, so the
    // answer says which one it now holds.
    expect((res.json() as { default: string | null }).default).toBe(
      "living-room",
    );
  });

  it("refuses a display it does not know, and a theme it does not have", async () => {
    const unknownDisplay = await request(
      hosted.server,
      "PUT",
      "/api/themes/active",
      json({ display: "nobody", id: "living-room" }),
    );
    expect(unknownDisplay.status).toBe(404);

    const unknownTheme = await request(
      hosted.server,
      "PUT",
      "/api/themes/active",
      json({ display: LOCAL_DISPLAY_ID, id: "nope" }),
    );
    expect(unknownTheme.status).toBe(404);

    // Neither refusal wrote anything: a display the host does not hold is not a
    // key to invent, and a theme with no file cannot be displayed.
    expect(await activeTheme.readAll(async () => true)).toEqual({});
  });

  it("stays loopback only for the admin read", async () => {
    const session = as(await paired("Kitchen tablet"));

    const read = await request(
      hosted.server,
      "GET",
      "/api/themes/active",
      undefined,
      session,
    );
    expect(read.status).toBe(403);
    expect(read.text()).toBe("Settings are available on this PC only.");

    // The write is the one thing a paired display reaches here, and the
    // difference is the point: reading every display's theme is this PC's.
    const write = await request(
      hosted.server,
      "PUT",
      "/api/themes/active",
      json({ id: "kitchen-strip" }),
      session,
    );
    expect(write.status).toBe(200);
  });

  it("lets a paired session set its own entry, and only its own", async () => {
    const session = as(await paired("Kitchen tablet"));
    await paired("Hall TV");

    const res = await request(
      hosted.server,
      "PUT",
      "/api/themes/active",
      json({ id: "kitchen-strip" }),
      session,
    );

    expect(res.status).toBe(200);
    expect(await activeTheme.read("kitchen-tablet", async () => true)).toBe(
      "kitchen-strip",
    );
    expect(await activeTheme.read("hall-tv", async () => true)).toBeUndefined();
    expect(
      await activeTheme.read(DEFAULT_DISPLAY, async () => true),
    ).toBeUndefined();
  });

  it("ignores a display named in the body by a session", async () => {
    const session = as(await paired("Kitchen tablet"));

    const res = await request(
      hosted.server,
      "PUT",
      "/api/themes/active",
      json({ display: LOCAL_DISPLAY_ID, id: "attic-wall" }),
      session,
    );

    // Ignored rather than refused, so a client that sends both gets the safe
    // answer instead of a distinction it could probe.
    expect(res.status).toBe(200);
    expect(await activeTheme.read("kitchen-tablet", async () => true)).toBe(
      "attic-wall",
    );
    expect(
      await activeTheme.read(LOCAL_DISPLAY_ID, async () => true),
    ).toBeUndefined();
    expect(
      await activeTheme.read(DEFAULT_DISPLAY, async () => true),
    ).toBeUndefined();
  });

  it("refuses a token that matches no display", async () => {
    const res = await request(
      hosted.server,
      "PUT",
      "/api/themes/active",
      json({ id: "kitchen-strip" }),
      as("z".repeat(43)),
    );

    // Nothing expires (R48): the credential is a hash on the display record and
    // `authenticate` is a lookup, so a token that matches nothing is the same
    // refusal a missing one gets, and no entry changes.
    expect(res.status).toBe(403);
    expect(res.text()).toBe("This display is not paired with the host.");
    expect(await activeTheme.readAll(async () => true)).toEqual({});
  });
});

/** The host's own pages, served from source with no build step. */
const ADMIN_DIR = fileURLToPath(new URL("../public", import.meta.url));

/** The text of every link to the editor, which is also its accessible name. */
function editorLinkText(html: string): string[] {
  return [
    ...html.matchAll(/<a\b[^>]*href="\/editor\/"[^>]*>([^<]*)<\/a>/g),
  ].map((match) => match[1] ?? "");
}

describe("The pages a consumer lands on", () => {
  let tmpDir: string;
  let hosted: ReturnType<typeof createHostServer>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-chooser-test-"));
    const store = createThemeStore(tmpDir);
    await store.write(
      "living-room",
      createValidPackage("living-room", "Living Room"),
    );
    await store.write("studio", createValidPackage("studio", "Studio"));
    hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: tmpDir, editor: tmpDir, admin: ADMIN_DIR },
      themeStore: store,
    });
  });

  afterEach(async () => {
    await hosted.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("lists the chooser's themes through the owner that already draws them", async () => {
    const res = await request(hosted.server, "GET", "/");
    const html = res.text();

    expect(res.status).toBe(200);
    // `/settings` renders a theme with its thumbnail and a hatched stand-in;
    // a chooser that draws its own rows ships the same list twice, and the
    // copy that arrives second is the one without the picture.
    expect(html).toContain("theme-list.js");
    expect(html).not.toContain("data-theme=");
  });

  it("reaches the editor from the chooser, in a name a screen reader reads", async () => {
    const html = (await request(hosted.server, "GET", "/")).text();
    const labels = editorLinkText(html);

    expect(labels.length).toBeGreaterThan(0);
    // An anchor is focusable and follows, so the link needs no extra wiring;
    // an icon-only one would be reachable and still nameless.
    expect(labels.every((label) => label.trim().length > 0)).toBe(true);
  });

  it("reaches the editor from the settings page too", async () => {
    const html = (await request(hosted.server, "GET", "/settings")).text();
    const labels = editorLinkText(html);

    expect(html).not.toBe("Settings are available on this PC only.");
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((label) => label.trim().length > 0)).toBe(true);
  });

  it("names the automatic device choice as a rule, not as a graphics card", async () => {
    const html = (await request(hosted.server, "GET", "/settings")).text();

    // The empty answer is "nothing was chosen", and what the host then does is
    // take the first card the machine names. A control showing that as a
    // product name beside real model numbers misreports what is in use.
    expect(html).not.toContain("First card found (default)");
    expect(html).toContain("Automatic (the first card this PC reports)");
  });
});

/** A JSON request body, which the routes parse the same way a browser sends one. */
function json(value: unknown): string {
  return JSON.stringify(value);
}

describe("Display settings routes", () => {
  let tmpDir: string;
  let hosted: ReturnType<typeof createHostServer>;
  const changes: ({ readonly timeZone?: string } | undefined)[] = [];

  beforeEach(async () => {
    changes.length = 0;
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-display-"));
    hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: tmpDir, editor: tmpDir },
      display: createDisplaySettingsStore(tmpDir),
      onDisplayChange: (settings) => changes.push(settings),
    });
  });

  afterEach(async () => {
    await hosted.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("offers the zones a consumer may choose, and this PC as the default", async () => {
    const res = await request(hosted.server, "GET", "/api/display");
    const body = res.json() as {
      settings: { timeZone?: string };
      zones: readonly string[];
    };

    // The page is dependency-free source, so the zone names travel with it.
    expect(body.settings).toEqual({});
    expect(body.zones).toContain("Asia/Tokyo");
    expect(body.zones).toContain("Europe/Lisbon");
  });

  it("stores a zone and tells the providers to read it", async () => {
    const res = await request(
      hosted.server,
      "PUT",
      "/api/display",
      json({
        timeZone: "Asia/Tokyo",
      }),
    );

    expect(res.status).toBe(200);
    expect(changes).toEqual([{ timeZone: "Asia/Tokyo" }]);
    expect(
      (await request(hosted.server, "GET", "/api/display")).json(),
    ).toMatchObject({ settings: { timeZone: "Asia/Tokyo" } });
  });

  it("refuses a zone no display could read", async () => {
    const res = await request(
      hosted.server,
      "PUT",
      "/api/display",
      json({
        timeZone: "Mars/Olympus",
      }),
    );

    expect(res.status).toBe(400);
    // Refused, not stored-but-ignored: a setting that does nothing is worse
    // than one that says why.
    expect(changes).toEqual([]);
    expect(
      (await request(hosted.server, "GET", "/api/display")).json(),
    ).toMatchObject({ settings: {} });
  });

  it("keeps a machine setting on this PC", async () => {
    const lan = { remoteAddress: "192.168.1.50" };

    expect(
      (await request(hosted.server, "GET", "/api/display", undefined, lan))
        .status,
    ).toBe(403);
    expect(
      (
        await request(
          hosted.server,
          "PUT",
          "/api/display",
          json({ timeZone: "Asia/Tokyo" }),
          lan,
        )
      ).status,
    ).toBe(403);
  });
});

describe("Font favourite routes", () => {
  let tmpDir: string;
  let hosted: ReturnType<typeof createHostServer>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-favorites-"));
    hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: tmpDir, editor: tmpDir },
      fontFavorites: createFontFavoritesStore(tmpDir),
    });
  });

  afterEach(async () => {
    await hosted.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("starts with no favourites", async () => {
    expect(
      (await request(hosted.server, "GET", "/api/font-favorites")).json(),
    ).toEqual({ favorites: [] });
  });

  it("stores the ids and reads them back", async () => {
    const res = await request(
      hosted.server,
      "PUT",
      "/api/font-favorites",
      json({ favorites: ["exo-2-alegreya-sans", "saas"] }),
    );

    expect(res.status).toBe(200);
    // The answer is what the editor repaints from, so it must be the stored
    // list rather than an echo of the request.
    expect(res.json()).toEqual({
      favorites: ["exo-2-alegreya-sans", "saas"],
    });
    expect(
      (await request(hosted.server, "GET", "/api/font-favorites")).json(),
    ).toEqual({ favorites: ["exo-2-alegreya-sans", "saas"] });
  });

  it("answers with what it stored, not what it was sent", async () => {
    // A dropped entry must not come back as though the star was kept.
    const res = await request(
      hosted.server,
      "PUT",
      "/api/font-favorites",
      json({ favorites: ["a", "a", "../../escape", 1, "b"] }),
    );

    expect(res.json()).toEqual({ favorites: ["a", "b"] });
    expect(
      (await request(hosted.server, "GET", "/api/font-favorites")).json(),
    ).toEqual({ favorites: ["a", "b"] });
  });

  it("refuses a body that is not JSON", async () => {
    const res = await request(
      hosted.server,
      "PUT",
      "/api/font-favorites",
      "{ not json",
    );

    expect(res.status).toBe(400);
    expect(
      (await request(hosted.server, "GET", "/api/font-favorites")).json(),
    ).toEqual({ favorites: [] });
  });

  it("keeps a favourite on this PC", async () => {
    const lan = { remoteAddress: "192.168.1.50" };

    expect(
      (
        await request(
          hosted.server,
          "GET",
          "/api/font-favorites",
          undefined,
          lan,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          hosted.server,
          "PUT",
          "/api/font-favorites",
          json({ favorites: ["saas"] }),
          lan,
        )
      ).status,
    ).toBe(403);
    // Refused, not stored: a 403 that still wrote would be a silent success.
    expect(
      (await request(hosted.server, "GET", "/api/font-favorites")).json(),
    ).toEqual({ favorites: [] });
  });

  it("supports only GET and PUT", async () => {
    // A DELETE that fell through to the static fallback would also answer 405,
    // so the store is what is asked: a second star in the list proves the route
    // answered rather than some later handler.
    await request(
      hosted.server,
      "PUT",
      "/api/font-favorites",
      json({ favorites: ["saas"] }),
    );
    const res = await request(hosted.server, "DELETE", "/api/font-favorites");

    expect(res.status).toBe(405);
    // Refused, not acted on: a 405 that still cleared the list would be a lie.
    expect(
      (await request(hosted.server, "GET", "/api/font-favorites")).json(),
    ).toEqual({ favorites: ["saas"] });
  });

  it("reports a host that keeps no favourites", async () => {
    const bare = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: tmpDir, editor: tmpDir },
    });
    try {
      const res = await request(bare.server, "GET", "/api/font-favorites");

      expect(res.status).toBe(404);
      // An unknown path also 404s here, from the static fallback, so the status
      // alone cannot tell this route's own "not enabled" from "no such route".
      expect(res.text()).toContain("not enabled");
    } finally {
      await bare.close();
    }
  });
});

describe("Credential routes", () => {
  const bearer: KnownCredential = {
    id: "demo",
    label: "Demo source",
    kind: "bearer",
  };
  const cookie: KnownCredential = {
    id: "session",
    label: "Session source",
    kind: "cookie",
  };

  let tmpDir: string;
  let hosted: ReturnType<typeof createHostServer>;

  const start = (
    known: readonly KnownCredential[] = [bearer, cookie],
    extra: Partial<HostServerOptions> = {},
  ): ReturnType<typeof createHostServer> =>
    createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: tmpDir, editor: tmpDir },
      credentials: createCredentialStore(tmpDir),
      knownCredentials: known,
      ...extra,
    });

  const rows = async () =>
    (await request(hosted.server, "GET", "/api/credentials")).json();

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-credentials-"));
    hosted = start();
  });

  afterEach(async () => {
    await hosted.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("answers set and hint, and no value, for every known credential", async () => {
    const res = await request(hosted.server, "GET", "/api/credentials");

    expect(res.status).toBe(200);
    expect(res.json()).toEqual([
      {
        id: "demo",
        label: "Demo source",
        set: false,
        hint: "",
        verify: false,
        helpText: null,
        helpUrl: null,
      },
      {
        id: "session",
        label: "Session source",
        set: false,
        hint: "",
        verify: false,
        helpText: null,
        helpUrl: null,
      },
    ]);
    expect(res.text()).not.toMatch(/"value"/);
  });

  it("refuses a request another page made, and stores nothing", async () => {
    const put = await request(
      hosted.server,
      "PUT",
      "/api/credentials/demo",
      json({ value: "sk-live-9f2c" }),
      {
        headers: { origin: "https://evil.example", host: "127.0.0.1:5173" },
      },
    );

    expect(put.status).toBe(403);
    // The same-origin guard ahead of dispatch answers first (ADR-0116); the
    // route keeps its own refusal behind it.
    expect(put.text()).toBe("That request is from another origin.");
    const read = await rows();
    expect(read).toEqual([
      expect.objectContaining({ id: "demo", set: false }),
      expect.objectContaining({ id: "session", set: false }),
    ]);
  });

  it("carries the guide a credential names, and nulls when it names none", async () => {
    hosted = start([
      {
        ...bearer,
        help: {
          text: "Create an app and copy its access key.",
          url: "https://example.test/keys",
        },
      },
      cookie,
    ]);

    const [guided, plain] = (await rows()) as unknown as {
      helpText: string | null;
      helpUrl: string | null;
    }[];

    expect(guided).toMatchObject({
      helpText: "Create an app and copy its access key.",
      helpUrl: "https://example.test/keys",
    });
    expect(plain).toMatchObject({ helpText: null, helpUrl: null });
  });

  it("stores a value and answers only its four-character hint", async () => {
    const put = await request(
      hosted.server,
      "PUT",
      "/api/credentials/demo",
      json({ value: "sk-live-9f2c" }),
    );

    expect(put.status).toBe(200);
    expect(put.json()).toEqual({ ok: true });

    const read = await request(hosted.server, "GET", "/api/credentials");
    expect(read.json()).toEqual([
      {
        id: "demo",
        label: "Demo source",
        set: true,
        hint: "9f2c",
        verify: false,
        helpText: null,
        helpUrl: null,
      },
      {
        id: "session",
        label: "Session source",
        set: false,
        hint: "",
        verify: false,
        helpText: null,
        helpUrl: null,
      },
    ]);
    // The whole point of the route: the value it stored never comes back.
    expect(read.text()).not.toContain("sk-live-9f2c");
    expect(read.text()).not.toMatch(/"value"/);
  });

  it("clears a stored value", async () => {
    await request(
      hosted.server,
      "PUT",
      "/api/credentials/demo",
      json({ value: "sk-live-9f2c" }),
    );

    const cleared = await request(
      hosted.server,
      "DELETE",
      "/api/credentials/demo",
    );

    expect(cleared.status).toBe(200);
    expect(await rows()).toEqual([
      {
        id: "demo",
        label: "Demo source",
        set: false,
        hint: "",
        verify: false,
        helpText: null,
        helpUrl: null,
      },
      {
        id: "session",
        label: "Session source",
        set: false,
        hint: "",
        verify: false,
        helpText: null,
        helpUrl: null,
      },
    ]);
  });

  it("refuses a credential id the table does not know", async () => {
    const res = await request(
      hosted.server,
      "PUT",
      "/api/credentials/unknown",
      json({ value: "value" }),
    );

    expect(res.status).toBe(400);
  });

  it("refuses a cookie credential, naming R10", async () => {
    const res = await request(
      hosted.server,
      "PUT",
      "/api/credentials/session",
      json({ value: "session-cookie" }),
    );

    expect(res.status).toBe(400);
    expect(res.text()).toContain("R10");
  });

  it("lists the shipped weather rows and accepts a query credential", async () => {
    hosted = start(KNOWN_CREDENTIALS);

    const listed = (await rows()) as unknown as {
      id: string;
      verify: boolean;
      helpUrl: string | null;
    }[];

    expect(listed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "weatherapi",
          label: "WeatherAPI",
          set: false,
          verify: true,
          helpUrl: "https://www.weatherapi.com/my/",
        }),
        expect.objectContaining({
          id: "openweathermap",
          label: "OpenWeatherMap",
          set: false,
          verify: true,
          helpUrl: "https://home.openweathermap.org/api_keys",
        }),
      ]),
    );

    // Query keys ride in the URL by these APIs' design, so a PUT stores one;
    // only a cookie stays refused.
    const put = await request(
      hosted.server,
      "PUT",
      "/api/credentials/weatherapi",
      json({ value: "sk-live-9f2c" }),
    );
    expect(put.status).toBe(200);

    // The read still carries only the hint, never the value.
    const after = await request(hosted.server, "GET", "/api/credentials");
    expect(after.text()).not.toContain("sk-live-9f2c");
    expect(after.text()).toContain("9f2c");
  });

  it("refuses an empty value", async () => {
    const res = await request(
      hosted.server,
      "PUT",
      "/api/credentials/demo",
      json({ value: "" }),
    );

    expect(res.status).toBe(400);
  });

  it("refuses verify when the credential has no verifier", async () => {
    const res = await request(
      hosted.server,
      "POST",
      "/api/credentials/demo/verify",
    );

    expect(res.status).toBe(400);
  });

  it("verifies through the injected fetch with the stored value", async () => {
    const calls: { value: string; fetchImpl: typeof fetch }[] = [];
    const stubFetch = vi.fn() as unknown as typeof fetch;
    const verifiable: KnownCredential = {
      id: "verifiable",
      label: "Verifiable source",
      kind: "bearer",
      verify: async (value, fetchImpl) => {
        calls.push({ value, fetchImpl });
        return { ok: true };
      },
    };
    hosted = start([verifiable], { fetch: stubFetch });
    await request(
      hosted.server,
      "PUT",
      "/api/credentials/verifiable",
      json({ value: "sk-live-9f2c" }),
    );

    const res = await request(
      hosted.server,
      "POST",
      "/api/credentials/verifiable/verify",
    );

    expect(res.status).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(calls).toEqual([{ value: "sk-live-9f2c", fetchImpl: stubFetch }]);
  });

  it("keeps every credential route on this PC", async () => {
    const lan = { remoteAddress: "192.168.1.50" };

    expect(
      (await request(hosted.server, "GET", "/api/credentials", undefined, lan))
        .status,
    ).toBe(403);
    expect(
      (
        await request(
          hosted.server,
          "PUT",
          "/api/credentials/demo",
          json({ value: "sk-live-9f2c" }),
          lan,
        )
      ).status,
    ).toBe(403);
    // Refused, not stored.
    expect(await rows()).toEqual([
      {
        id: "demo",
        label: "Demo source",
        set: false,
        hint: "",
        verify: false,
        helpText: null,
        helpUrl: null,
      },
      {
        id: "session",
        label: "Session source",
        set: false,
        hint: "",
        verify: false,
        helpText: null,
        helpUrl: null,
      },
    ]);
  });

  it("reports a host that keeps no credential store", async () => {
    const bare = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: tmpDir, editor: tmpDir },
    });
    try {
      const res = await request(bare.server, "GET", "/api/credentials");

      expect(res.status).toBe(503);
      expect(res.text()).toContain("not enabled");
    } finally {
      await bare.close();
    }
  });

  it("supports only the methods each path names", async () => {
    expect(
      (await request(hosted.server, "POST", "/api/credentials")).status,
    ).toBe(405);
    expect(
      (await request(hosted.server, "GET", "/api/credentials/demo")).status,
    ).toBe(405);
  });
});

describe("Asset finder routes", () => {
  it("mounts the finder's sources route", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-assets-"));
    const hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: tmpDir, editor: tmpDir },
      assets: {},
    });
    try {
      const res = await request(hosted.server, "GET", "/api/assets/sources");

      expect(res.status).toBe(200);
      expect(
        (
          res.json() as {
            sources: readonly Record<string, unknown>[];
          }
        ).sources,
      ).toContainEqual(expect.objectContaining({ id: "lucide" }));
    } finally {
      await hosted.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("says so when this host serves no sources", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-assets-"));
    const bare = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: tmpDir, editor: tmpDir },
    });
    try {
      const res = await request(bare.server, "GET", "/api/assets/sources");

      expect(res.status).toBe(503);
      expect(res.text()).toContain("not enabled");
    } finally {
      await bare.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

/** The published key a group's choice rides under — `system-disk` →
 *  `systemDisk`, the `DeviceAssignment` convention the rest of the host reads. */
const assignmentKey = (group: string): string =>
  group.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

describe("A theme's own device answers", () => {
  let tmpDir: string;
  let hosted: ReturnType<typeof createHostServer>;
  let activeTheme: ReturnType<typeof createActiveThemeStore>;
  let themeSettings: ReturnType<typeof createThemeSettingsStore>;
  let displays: ReturnType<typeof createDisplayStore>;
  let echo: ReturnType<typeof assignmentEcho>;

  /** Writes one theme into the store the host reads. */
  async function seed(id: string, semanticKey?: string): Promise<void> {
    await request(
      hosted.server,
      "PUT",
      `/api/themes/${id}`,
      themeBody(createValidPackage(id, id, semanticKey)),
    );
  }

  /** Waits for a tick to serve this PC the assignment the case expects. */
  async function serves(expected: DeviceAssignment): Promise<void> {
    await vi.waitFor(() => expect(echo.assignments.at(-1)).toEqual(expected));
  }

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-answers-"));
    activeTheme = createActiveThemeStore(tmpDir);
    themeSettings = createThemeSettingsStore(tmpDir);
    displays = createDisplayStore(tmpDir);
    echo = assignmentEcho();
    hosted = createHostServer({
      registry: new ProviderRegistry([echo]),
      bundles: { player: tmpDir, editor: tmpDir },
      devices: createDeviceSettingsStore(tmpDir),
      displays,
      activeTheme,
      themeSettings,
      // The tick a display is served on, rather than the settled cadence: a
      // case reads the assignment one poll was made with.
      sampleIntervalMs: 10,
    });

    // One display asking, so every tick has something to resolve for.
    sampleStream(hosted.server, `${SAMPLE_STREAM_PATH}?keys=gpu.temp`);

    await seed("disk-only", "disk.total");
    await seed("disk-spare", "disk.total");
    await seed("cpu-only", "cpu.load");
  });

  afterEach(async () => {
    await hosted.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("asks only for the slots a theme reads", async () => {
    const disk = (
      await request(hosted.server, "GET", "/api/themes/disk-only/answers")
    ).json() as { answers: unknown; required: readonly string[] };
    const cpu = (
      await request(hosted.server, "GET", "/api/themes/cpu-only/answers")
    ).json() as { answers: unknown; required: readonly string[] };

    expect(disk.required).toEqual(["system-disk"]);
    expect(disk.answers).toEqual({});
    // A theme that reads no assignable hardware asks nothing at all.
    expect(cpu.required).toEqual([]);
  });

  it("keeps a theme's answer to this PC", async () => {
    const lan = { remoteAddress: "192.168.1.50" };

    expect(
      (
        await request(
          hosted.server,
          "GET",
          "/api/themes/disk-only/answers",
          undefined,
          lan,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          hosted.server,
          "PUT",
          "/api/themes/disk-only/answers",
          json({ "system-disk": "disk-c" }),
          lan,
        )
      ).status,
    ).toBe(403);
  });

  it("stores an answer, and drops a group no device can fill", async () => {
    const res = await request(
      hosted.server,
      "PUT",
      "/api/themes/disk-only/answers",
      json({ "system-disk": "disk-d", nonsense: "disk-c" }),
    );

    expect(res.status).toBe(200);
    expect((res.json() as { answers: unknown }).answers).toEqual({
      "system-disk": "disk-d",
    });
  });

  it("keys what it stores by the display an unpaired client is served as", async () => {
    await request(
      hosted.server,
      "PUT",
      "/api/themes/disk-only/answers",
      json({ "system-disk": "disk-d" }),
    );

    // An unnamed read is the display a client with no identity is served as —
    // the same default the theme map falls back to.
    expect(
      await createThemeSettingsStore(tmpDir).read(DEFAULT_DISPLAY, "disk-only"),
    ).toEqual({ "system-disk": "disk-d" });
  });

  it("reads and writes the answers of the display the page names", async () => {
    // A paired display, because that is the one a display's own request cannot
    // name from a query — `displayKeyFor` honours `?display=` for a local
    // record alone, since the parameter is the one thing that could impersonate
    // a credential-less monitor. The host's own page has to reach it all the
    // same, so this route validates the name against the store instead.
    await displays.create("Kitchen tablet", newToken());

    const read = (
      await request(
        hosted.server,
        "GET",
        "/api/themes/disk-only/answers?display=kitchen-tablet",
      )
    ).json() as { answers: unknown };
    expect(read.answers).toEqual({});

    expect(
      (
        await request(
          hosted.server,
          "PUT",
          "/api/themes/disk-only/answers?display=kitchen-tablet",
          json({ "system-disk": "disk-d" }),
        )
      ).status,
    ).toBe(200);

    // The named display's entry, and the default's untouched: a page that named
    // this PC used to have its answers stored under the default.
    expect(
      await createThemeSettingsStore(tmpDir).read(
        "kitchen-tablet",
        "disk-only",
      ),
    ).toEqual({ "system-disk": "disk-d" });
    expect(
      await createThemeSettingsStore(tmpDir).read(DEFAULT_DISPLAY, "disk-only"),
    ).toEqual({});
  });

  it("refuses a display it does not know, and keeps the default for none", async () => {
    expect(
      (
        await request(
          hosted.server,
          "GET",
          "/api/themes/disk-only/answers?display=nobody",
        )
      ).status,
    ).toBe(404);

    // A refused name writes nothing at all — not the default's entry, which is
    // what answering it as the default would have done.
    expect(
      (
        await request(
          hosted.server,
          "PUT",
          "/api/themes/disk-only/answers?display=nobody",
          json({ "system-disk": "disk-d" }),
        )
      ).status,
    ).toBe(404);

    await request(
      hosted.server,
      "PUT",
      "/api/themes/disk-only/answers",
      json({ "system-disk": "disk-c" }),
    );
    expect(
      await createThemeSettingsStore(tmpDir).read(DEFAULT_DISPLAY, "disk-only"),
    ).toEqual({ "system-disk": "disk-c" });
  });

  it("serves a theme's own answer only while that theme is the chosen one", async () => {
    // The global answer describes this PC; a theme's answer describes the
    // device that theme reads, and it applies only while the theme is chosen.
    await request(
      hosted.server,
      "PUT",
      "/api/devices",
      json({ assigned: { gpu: "gpu-1", "system-disk": "disk-c" } }),
    );
    await themeSettings.write(LOCAL_DISPLAY_ID, "disk-only", {
      "system-disk": "disk-d",
    });

    // Written but not chosen: the machine's own answer is the one served.
    await serves({ gpu: "gpu-1", systemDisk: "disk-c", names: {} });

    await activeTheme.write(LOCAL_DISPLAY_ID, "disk-only");
    await serves({ gpu: "gpu-1", systemDisk: "disk-d", names: {} });

    // Another theme reads the machine's own answer, not this theme's.
    await activeTheme.write(LOCAL_DISPLAY_ID, "disk-spare");
    await serves({ gpu: "gpu-1", systemDisk: "disk-c", names: {} });
  });

  it("serves the consumer's chosen name, so a caption reaches the display", async () => {
    // The other half of the choice: which device answers, and what it is
    // called. A name the settings page accepted has to arrive with the
    // assignment, or a caption can only ever print the machine's own string.
    await request(
      hosted.server,
      "PUT",
      "/api/devices",
      json({
        assigned: { "system-disk": "lexar-500gb-ssd" },
        names: { "lexar-500gb-ssd": "System drive" },
      }),
    );

    await serves({
      systemDisk: "lexar-500gb-ssd",
      names: { "lexar-500gb-ssd": "System drive" },
    });
  });

  it("serves every group the settings module declares it can assign", async () => {
    // The host derives its assignable groups from `ASSIGNABLE_GROUPS` rather
    // than re-spelling the union, so a group added to the owner must reach the
    // providers without this server changing. Driving the owner's own list is
    // what catches the drift a second copy of the union could not: a group the
    // host stopped picking leaves its chosen id out of the assignment (vg-189).
    //
    // Read at each group's **own key** (`system-disk` → `systemDisk`, the
    // payload's `DeviceAssignment` convention) rather than across every string
    // value, so an assignment that later carries another string field cannot
    // fail this spuriously.
    const assigned = Object.fromEntries(
      ASSIGNABLE_GROUPS.map((group) => [group, `id-${group}`]),
    );
    await request(hosted.server, "PUT", "/api/devices", json({ assigned }));

    await vi.waitFor(() => {
      const served = echo.assignments.at(-1) as
        | Readonly<Record<string, unknown>>
        | undefined;

      for (const group of ASSIGNABLE_GROUPS) {
        expect(
          served?.[assignmentKey(group)],
          `${group} reaches its own key`,
        ).toBe(`id-${group}`);
      }
    });
  });
});

/**
 * The devices a display is served reach it through the sample its own
 * connection is offered: the host resolves the assignment for the display that
 * asked and hands it to the provider, so two screens of one machine can read
 * two different cards (ruling 43).
 */
describe("The assignment a display is served", () => {
  let dir: string;
  let displays: ReturnType<typeof createDisplayStore>;
  let themeSettings: ReturnType<typeof createThemeSettingsStore>;
  let activeTheme: ReturnType<typeof createActiveThemeStore>;
  let devices: ReturnType<typeof createDeviceSettingsStore>;
  let hosted: ReturnType<typeof createHostServer>;
  let echo: ReturnType<typeof assignmentEcho>;

  const LAN = { remoteAddress: "192.168.1.50" };
  const THEME = "gpu-readout";

  /** A display off this PC, paired and holding the credential that identifies it. */
  async function paired(): Promise<string> {
    const token = newToken();
    await displays.create("Kitchen tablet", token);
    return token;
  }

  /** This PC's own stream, and the kitchen tablet's. */
  function streams(token: string): {
    readonly here: { frames: () => string };
    readonly there: { frames: () => string };
  } {
    return {
      here: sampleStream(hosted.server, `${SAMPLE_STREAM_PATH}?keys=gpu.temp`),
      there: sampleStream(
        hosted.server,
        `${SAMPLE_STREAM_PATH}?keys=gpu.temp&session=${encodeURIComponent(token)}`,
        LAN.remoteAddress,
      ),
    };
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-assignment-"));
    displays = createDisplayStore(dir);
    themeSettings = createThemeSettingsStore(dir);
    activeTheme = createActiveThemeStore(dir);
    devices = createDeviceSettingsStore(dir);
    echo = assignmentEcho();
    hosted = createHostServer({
      registry: new ProviderRegistry([echo]),
      bundles: { player: dir, editor: dir },
      displays,
      devices,
      themeSettings,
      activeTheme,
      // The tick a display is served on, rather than the settled one-second
      // cadence: a case reads one frame, not a stream's rhythm.
      sampleIntervalMs: 10,
    });
  });

  afterEach(async () => {
    await hosted.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("reads the answering display's override, not another display's", async () => {
    // Both displays hold the same theme; only the answers differ, which is the
    // whole reason they are keyed by display as well as by theme.
    await themeSettings.write(LOCAL_DISPLAY_ID, THEME, { gpu: "gpu-0" });
    await themeSettings.write("kitchen-tablet", THEME, { gpu: "gpu-1" });
    await activeTheme.write(LOCAL_DISPLAY_ID, THEME);
    await activeTheme.write("kitchen-tablet", THEME);

    const { here, there } = streams(await paired());

    expect(await servedCard(here)).toBe("gpu-0");
    expect(await servedCard(there)).toBe("gpu-1");
  });

  it("falls back to the global device settings where a display answered nothing", async () => {
    await devices.write({ assigned: { gpu: "gpu-9" } });

    const { here, there } = streams(await paired());

    expect(await servedCard(here)).toBe("gpu-9");
    expect(await servedCard(there)).toBe("gpu-9");
  });

  it("does not leak a deleted display's answers to another display", async () => {
    await themeSettings.write(LOCAL_DISPLAY_ID, THEME, { gpu: "gpu-0" });
    await themeSettings.write("kitchen-tablet", THEME, { gpu: "gpu-1" });
    await activeTheme.write(LOCAL_DISPLAY_ID, THEME);
    await activeTheme.write("kitchen-tablet", THEME);

    const { here } = streams(await paired());

    expect(
      (await request(hosted.server, "DELETE", "/api/displays/kitchen-tablet"))
        .status,
    ).toBe(200);

    // The answers and the theme of a display that is gone go with it: the next
    // display called "Kitchen tablet" mints the same id, and must not be handed
    // the card its predecessor chose, or the theme it was showing.
    await paired();
    expect(await themeSettings.read("kitchen-tablet", THEME)).toEqual({});
    expect(
      await activeTheme.read("kitchen-tablet", async () => true),
    ).toBeUndefined();
    // And the display still here is served exactly what it was.
    expect(await servedCard(here)).toBe("gpu-0");
  });

  it("serves the answer the default display holds for the theme being shown", async () => {
    // The host page still writes a theme's answers under `default` (ruling 38),
    // and a display showing that theme has to be served them: the fallback is
    // what makes a per-theme answer set on this PC reach the screen showing it.
    await themeSettings.write(DEFAULT_DISPLAY, THEME, { gpu: "gpu-7" });
    await activeTheme.write(DEFAULT_DISPLAY, THEME);

    const { here, there } = streams(await paired());

    expect(await servedCard(here)).toBe("gpu-7");
    expect(await servedCard(there)).toBe("gpu-7");
  });

  it("samples once per distinct assignment, not once per connection", async () => {
    // Three connections on two displays, two of them on this PC: the machine is
    // polled twice per tick, not three times — a poll is its work, and the
    // devices are what it reads, not the screens.
    await themeSettings.write(LOCAL_DISPLAY_ID, THEME, { gpu: "gpu-0" });
    await themeSettings.write("kitchen-tablet", THEME, { gpu: "gpu-1" });
    await activeTheme.write(LOCAL_DISPLAY_ID, THEME);
    await activeTheme.write("kitchen-tablet", THEME);

    const token = await paired();
    // Frames land one per tick per connection, so the polls between two frames
    // of one stream are one tick's.
    const polls: number[] = [];
    const notePoll = (): void => {
      polls.push(echo.assignments.length);
    };
    const one = sampleStream(
      hosted.server,
      `${SAMPLE_STREAM_PATH}?keys=gpu.temp`,
      "127.0.0.1",
      notePoll,
    );
    const two = sampleStream(
      hosted.server,
      `${SAMPLE_STREAM_PATH}?keys=gpu.temp`,
    );
    const three = sampleStream(
      hosted.server,
      `${SAMPLE_STREAM_PATH}?keys=gpu.temp&session=${encodeURIComponent(token)}`,
      LAN.remoteAddress,
    );

    // Every display served before any gap is read: a tick that has not yet seen
    // the third connection polls one group instead of two, and its gap is the
    // ramp-up rather than the property. Counting starts once all three are in.
    await vi.waitFor(() => {
      expect(one.frames().length).toBeGreaterThan(0);
      expect(two.frames().length).toBeGreaterThan(0);
      expect(three.frames().length).toBeGreaterThan(0);
    });
    polls.length = 0;
    await vi.waitFor(() => expect(polls.length).toBeGreaterThanOrEqual(6));
    const perTick = polls
      .slice(1)
      .map((count, index) => count - (polls[index] ?? count));

    // Two polls a tick, whatever the connection count. A poll per connection
    // makes the gaps 1 and 2 alternating where the payload is still offered per
    // display, and 3 where it is offered per connection — never three 2s.
    expect(perTick.slice(-3)).toEqual([2, 2, 2]);

    // And each connection is offered the payload its own assignment produced.
    expect(await servedCard(one)).toBe("gpu-0");
    expect(await servedCard(two)).toBe("gpu-0");
    expect(await servedCard(three)).toBe("gpu-1");
  });

  it("passes a connection's declared language into that display's ask", async () => {
    sampleStream(
      hosted.server,
      `${SAMPLE_STREAM_PATH}?keys=gpu.temp&lang=de-DE`,
    );

    await vi.waitFor(() =>
      expect(echo.contexts.at(-1)).toMatchObject({ language: "de-DE" }),
    );
  });

  it("lets the newest connection's language speak for the display", async () => {
    sampleStream(hosted.server, `${SAMPLE_STREAM_PATH}?keys=gpu.temp&lang=en`);
    await vi.waitFor(() =>
      expect(echo.contexts.at(-1)).toMatchObject({ language: "en" }),
    );

    sampleStream(
      hosted.server,
      `${SAMPLE_STREAM_PATH}?keys=gpu.temp&lang=de-DE`,
    );

    await vi.waitFor(() =>
      expect(echo.contexts.at(-1)).toMatchObject({ language: "de-DE" }),
    );
  });

  it("accepts a tag as long as the published schema allows", async () => {
    // The envelope validator caps `metadata.themeLanguage` at 64 characters, so
    // the host must not drop a tag its own schema published.
    const tag =
      "de-Latn-DE-1996-x-yunari-display-abcdefg-abcdefg-abcdefg-abcdefg";

    expect(tag).toHaveLength(64);

    sampleStream(
      hosted.server,
      `${SAMPLE_STREAM_PATH}?keys=gpu.temp&lang=${tag}`,
    );

    await vi.waitFor(() =>
      expect(echo.contexts.at(-1)).toMatchObject({ language: tag }),
    );
  });

  it("opens the stream when lang is unusable, and asks without a language", async () => {
    // A malformed tag and a syntactically valid one past the length ceiling:
    // both are dropped, and neither refusal closes the stream.
    for (const lang of [
      "de_DE",
      "de-Latn-DE-1996-x-yunari-display-abcdefg-abcdefg-abcdefg-abcdefg-abcdefg",
    ]) {
      const answer = await streamStatus(
        hosted.server,
        `${SAMPLE_STREAM_PATH}?keys=gpu.temp&lang=${lang}`,
        "127.0.0.1",
      );

      expect(answer.status).toBe(200);
    }

    await vi.waitFor(() => expect(echo.contexts.length).toBeGreaterThan(0));
    expect(echo.contexts.at(-1)).not.toHaveProperty("language");
  });
});

/**
 * The served payload, not the provider's own return value: two displays that
 * resolved the same devices but declared different languages must get one
 * reading in two words.
 */
describe("A display's language in the served payload", () => {
  let tmpDir: string;
  let hosted: ReturnType<typeof createHostServer>;
  let desk: DisplayRecord;
  let wall: DisplayRecord;

  /** Berlin, so the fixture's OVC reading maps to both tables. */
  function berlinStore(): WeatherSettingsStore {
    const settings = normalizeWeatherSettings({
      provider: "open-meteo",
      label: "Berlin, Berlin, DE",
      latitude: 52.52,
      longitude: 13.41,
      useWindowsLocation: false,
      pollIntervalMs: 600_000,
    });

    return {
      read: async () => settings,
      write: async () => settings,
      problem: () => undefined,
    };
  }

  function servedSample(
    stream: { readonly frames: () => string },
    semanticKey: string,
  ): { readonly textValue?: string; readonly value?: number } | undefined {
    const decoded = decodeBatch(lastFrame(stream.frames()));

    return decoded.ok
      ? decoded.batch.samples.find((entry) => entry.semanticKey === semanticKey)
          ?.sample
      : undefined;
  }

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-lang-payload-"));
    const displays = createDisplayStore(tmpDir);
    desk = await displays.createLocal("Desk monitor", {
      deviceName: "DELL U2722D",
    });
    wall = await displays.createLocal("Wall monitor", {
      deviceName: "LG C2",
    });
    hosted = createHostServer({
      registry: new ProviderRegistry([
        new WeatherProvider({
          settings: berlinStore(),
          fetcher: (async () =>
            new Response(JSON.stringify(OPEN_METEO_BERLIN_CAPTURE), {
              status: 200,
            })) as unknown as typeof fetch,
        }),
      ]),
      bundles: { player: tmpDir, editor: tmpDir },
      displays,
      sampleIntervalMs: 10,
    });
  });

  afterEach(async () => {
    await hosted.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("serves one reading in German and English for two displays on one assignment", async () => {
    const keys = "weather.temp,weather.condition";
    const german = sampleStream(
      hosted.server,
      `${SAMPLE_STREAM_PATH}?keys=${keys}&display=${desk.id}&lang=de`,
    );
    const english = sampleStream(
      hosted.server,
      `${SAMPLE_STREAM_PATH}?keys=${keys}&display=${wall.id}&lang=en`,
    );

    await vi.waitFor(() => {
      expect(servedSample(german, "weather.condition")?.textValue).toBe(
        "Bedeckt",
      );
      expect(servedSample(english, "weather.condition")?.textValue).toBe(
        "Overcast",
      );
    });

    // The words differ; the measurement does not.
    expect(servedSample(german, "weather.temp")?.value).toBe(11.3);
    expect(servedSample(english, "weather.temp")?.value).toBe(11.3);
  });
});

/**
 * A provider whose every `sample` stays open until the case settles it, so a
 * tick can be held in flight across the interval that would start the next.
 */
function gatedProvider(): {
  readonly provider: SensorProvider;
  readonly samples: () => number;
  readonly release: () => void;
  readonly fail: (reason: Error) => void;
} {
  let calls = 0;
  const held: Array<{
    readonly resolve: (entries: readonly SampleEntry[]) => void;
    readonly reject: (reason: Error) => void;
  }> = [];

  return {
    provider: {
      id: "gated",
      label: "gated",
      describe: () =>
        Promise.resolve([
          {
            sensorId: "gated:gpu.temp",
            semanticKey: "gpu.temp",
            label: "GPU",
            tier: "baseline" as const,
          },
        ]),
      sample(): Promise<readonly SampleEntry[]> {
        calls += 1;

        return new Promise((resolve, reject) => {
          held.push({ resolve, reject });
        });
      },
      health: () => ({ available: true }),
    },
    samples: () => calls,
    release: () => {
      for (const one of held.splice(0)) one.resolve([]);
    },
    fail: (reason) => {
      for (const one of held.splice(0)) one.reject(reason);
    },
  };
}

/**
 * A tick is this PC's work, not the connections': a slow one must not let the
 * next interval pile a second batch on top, and the device settings it resolves
 * are the same for every display, so a tick reads them once.
 */
describe("One tick at a time", () => {
  let dir: string;
  let hosted: ReturnType<typeof createHostServer> | undefined;

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  /** A device store that counts every read a tick makes. */
  function countingDevices(): {
    readonly store: DeviceSettingsStore;
    readonly reads: () => number;
  } {
    const store = createDeviceSettingsStore(dir);
    let read = 0;

    return {
      store: {
        ...store,
        async read() {
          read += 1;
          return store.read();
        },
      },
      reads: () => read,
    };
  }

  function start(
    gated: ReturnType<typeof gatedProvider>,
    options: {
      readonly devices?: DeviceSettingsStore;
      readonly displays?: DisplayStore;
      /** Real cadence, unless a case drives the clock itself. */
      readonly intervalMs?: number;
    } = {},
  ): ReturnType<typeof createHostServer> {
    hosted = createHostServer({
      registry: new ProviderRegistry([gated.provider]),
      bundles: { player: dir, editor: dir },
      ...(options.devices === undefined ? {} : { devices: options.devices }),
      ...(options.displays === undefined ? {} : { displays: options.displays }),
      sampleIntervalMs: options.intervalMs ?? 10,
    });

    return hosted;
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-single-tick-"));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await hosted?.close();
    hosted = undefined;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("drops the fires that land while one tick is in flight, rather than queueing them", async () => {
    vi.useFakeTimers();
    const gated = gatedProvider();
    const host = start(gated, { intervalMs: 200 });

    sampleStream(host.server, `${SAMPLE_STREAM_PATH}?keys=gpu.temp`);
    // Let the stream's connection be added before the clock moves.
    await vi.advanceTimersByTimeAsync(0);

    // The first fire starts the tick, which the provider holds open.
    await vi.advanceTimersByTimeAsync(200);
    expect(gated.samples()).toBe(1);

    // Three more fires with the tick still in flight: each is dropped.
    await vi.advanceTimersByTimeAsync(600);
    expect(gated.samples()).toBe(1);

    // Settling the held tick must not replay the dropped fires. A queue would
    // start the next sample in this same microtask chain; a drop waits for the
    // next fire, which the clock has not reached yet.
    gated.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(gated.samples()).toBe(1);

    // One interval later there is a fire, and it samples once more.
    await vi.advanceTimersByTimeAsync(200);
    expect(gated.samples()).toBe(2);
    gated.release();
  });

  it("samples again on the interval after the stalled tick settles", async () => {
    vi.useFakeTimers();
    const gated = gatedProvider();
    const host = start(gated, { intervalMs: 200 });

    sampleStream(host.server, `${SAMPLE_STREAM_PATH}?keys=gpu.temp`);
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(200);
    expect(gated.samples()).toBe(1);

    gated.release();
    await vi.advanceTimersByTimeAsync(200);

    expect(gated.samples()).toBe(2);
    gated.release();
  });

  it("formats one frame per batch, however many connections share it", async () => {
    vi.useFakeTimers();
    const gated = gatedProvider();
    const host = start(gated, { intervalMs: 200 });

    // Both connections are the local display asking the same keys, so a tick
    // builds one batch for the two of them.
    const first = sampleStream(
      host.server,
      `${SAMPLE_STREAM_PATH}?keys=gpu.temp`,
    );
    const second = sampleStream(
      host.server,
      `${SAMPLE_STREAM_PATH}?keys=gpu.temp`,
    );
    await vi.advanceTimersByTimeAsync(0);

    const format = vi.mocked(formatSseEvent);
    format.mockClear();

    await vi.advanceTimersByTimeAsync(200);
    gated.release();
    await vi.advanceTimersByTimeAsync(0);

    expect(format).toHaveBeenCalledTimes(1);
    // The same frame text reached both, byte for byte.
    expect(first.frames()).toContain("event: samples");
    expect(second.frames()).toBe(first.frames());

    // The next tick is a new batch, and formats again.
    await vi.advanceTimersByTimeAsync(200);
    gated.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(format).toHaveBeenCalledTimes(2);
  });

  it("reads devices once per tick however many displays ask", async () => {
    const counted = countingDevices();
    const gated = gatedProvider();
    const displays = createDisplayStore(dir);
    const tokens: string[] = [];

    for (const name of ["Kitchen", "Hall", "Attic"]) {
      const token = newToken();
      await displays.create(name, token);
      tokens.push(token);
    }

    const host = start(gated, { devices: counted.store, displays });

    sampleStream(host.server, `${SAMPLE_STREAM_PATH}?keys=gpu.temp`);
    for (const token of tokens) {
      sampleStream(
        host.server,
        `${SAMPLE_STREAM_PATH}?keys=gpu.temp&session=${encodeURIComponent(token)}`,
        "192.168.1.50",
      );
    }

    // The tick has resolved all four displays by the time it samples.
    await vi.waitFor(() => expect(gated.samples()).toBeGreaterThanOrEqual(1));

    expect(counted.reads()).toBe(1);
    gated.release();
  });

  it("reads devices zero times when no display is connected", async () => {
    const counted = countingDevices();
    start(gatedProvider(), { devices: counted.store });

    await sleep(50);

    expect(counted.reads()).toBe(0);
  });

  it("releases the guard when a tick's sample rejects", async () => {
    const gated = gatedProvider();
    const host = start(gated);

    sampleStream(host.server, `${SAMPLE_STREAM_PATH}?keys=gpu.temp`);

    await vi.waitFor(() => expect(gated.samples()).toBe(1));
    gated.fail(new Error("provider stalled"));

    // The rejection ended that tick; the next interval must sample again
    // rather than leave the loop wedged behind a flag nothing cleared.
    await vi.waitFor(() => expect(gated.samples()).toBeGreaterThanOrEqual(2));
    gated.release();
  });

  it("samples no more once closed", async () => {
    const gated = gatedProvider();
    const host = start(gated);

    sampleStream(host.server, `${SAMPLE_STREAM_PATH}?keys=gpu.temp`);
    await vi.waitFor(() => expect(gated.samples()).toBe(1));

    gated.release();
    await host.close();
    hosted = undefined;

    const before = gated.samples();
    await sleep(50);

    expect(gated.samples()).toBe(before);
  });
});

it("keeps the assignable-device vocabulary in the one module that owns it", async () => {
  // vg-189: the groups are `ASSIGNABLE_GROUPS`'s (`settings/devices.ts`), so
  // server.ts must not spell the union a second time — a copy is a second owner,
  // and a group added to the real owner would silently never reach it. The
  // runtime is identical whether the union is derived or copied, so the source is
  // the only place this can be seen.
  //
  // Resolving `pick`'s parameter **annotation** to the owner's own type, rather
  // than matching a member list, is what catches a re-spelling of a different
  // member set or order, or a local alias: only `AssignableGroup` passes.
  const source = await fs.readFile(
    new URL("./server.ts", import.meta.url),
    "utf8",
  );
  const annotation = source.match(
    /const pick = \(group\s*:\s*([A-Za-z][\w.]*)\)/,
  )?.[1];
  expect(annotation).toBe("AssignableGroup");
});

it("does not keep a connection whose client left while its display was resolved", async () => {
  // Resolving the display reads the store, so a client can be gone before
  // there is a connection to remove — and the `close` that would have removed
  // it has already fired by then. A connection kept anyway is offered a frame
  // on every later tick, against a socket that is gone.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-stream-drop-"));
  const store = createDisplayStore(dir);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reached!: () => void;
  const atFind = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const hosted = createHostServer({
    registry: new ProviderRegistry([]),
    bundles: { player: dir, editor: dir },
    displays: {
      ...store,
      async find(id) {
        reached();
        await held;
        return store.find(id);
      },
    },
  });

  try {
    const stream = sampleStream(
      hosted.server,
      `${SAMPLE_STREAM_PATH}?keys=cpu.load&display=desk`,
    );

    // Leaving only once the resolution is in flight: before that there is no
    // listener to hear it, which is the case this does not test.
    await atFind;
    stream.leave();
    release();

    // Ended is what proves the guard ran — nothing else closes a connection
    // that was never added.
    await vi.waitFor(() => expect(stream.ended()).toBe(true));
    expect(hosted.connectionCount).toBe(0);
  } finally {
    await hosted.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("The sample stream is bounded", () => {
  let dir: string;
  let displays: ReturnType<typeof createDisplayStore>;
  let hosted: ReturnType<typeof createHostServer>;

  /** Pairs a display and answers the credential its stream has to carry. */
  async function pair(label: string): Promise<string> {
    const token = newToken();
    await displays.create(label, token);
    return token;
  }

  const streamFor = (token: string): string =>
    `${SAMPLE_STREAM_PATH}?keys=cpu.load&session=${encodeURIComponent(token)}`;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-stream-cap-"));
    displays = createDisplayStore(dir);
    hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: dir, editor: dir },
      displays,
    });
  });

  afterEach(async () => {
    await hosted.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("refuses a request that asks for more keys than a stream may carry", async () => {
    const keys = Array.from(
      { length: MAX_STREAM_KEYS + 1 },
      (_, index) => `k${index}`,
    ).join(",");

    const answer = await request(
      hosted.server,
      "GET",
      `${SAMPLE_STREAM_PATH}?keys=${keys}`,
    );

    expect(answer.status).toBe(400);
    // Refused before a connection existed, which is the point: a stream held
    // by a request that has already been told no is a stream nobody closes.
    expect(hosted.connectionCount).toBe(0);
  });

  it("refuses a key longer than a stream key may be", async () => {
    const key = "k".repeat(MAX_STREAM_KEY_BYTES + 1);

    const answer = await request(
      hosted.server,
      "GET",
      `${SAMPLE_STREAM_PATH}?keys=${key}`,
    );

    expect(answer.status).toBe(400);
    expect(hosted.connectionCount).toBe(0);
  });

  it("refuses the connection past the total it will stream to", async () => {
    // Every display but the last is filled to its own cap, so the refusal can
    // only be the total: the sixty-fifth names a display holding none.
    const tokens: string[] = [];
    for (
      let display = 0;
      display < MAX_STREAM_CONNECTIONS / MAX_STREAM_CONNECTIONS_PER_DISPLAY;
      display += 1
    ) {
      tokens.push(await pair(`display-${display}`));
    }
    const ninth = await pair("display-9");

    for (const [index, token] of tokens.entries()) {
      for (
        let connection = 0;
        connection < MAX_STREAM_CONNECTIONS_PER_DISPLAY;
        connection += 1
      ) {
        // Each display is a LAN client, so its credential is what resolves it;
        // a loopback stream would resolve to this PC and share one slot count.
        sampleStream(hosted.server, streamFor(token), "192.168.1.50");
      }
      // Sixty-four sockets open against a loaded box; the 1 s default expires
      // a few connects short and reports a cap failure that is not one.
      await vi.waitFor(
        () =>
          expect(hosted.connectionCount).toBe(
            (index + 1) * MAX_STREAM_CONNECTIONS_PER_DISPLAY,
          ),
        { timeout: 15_000 },
      );
    }

    expect(hosted.connectionCount).toBe(MAX_STREAM_CONNECTIONS);
    expect((await streamStatus(hosted.server, streamFor(ninth))).status).toBe(
      429,
    );
  });

  it("refuses one display's ninth stream while another display may still open one", async () => {
    const busy = await pair("busy");
    const other = await pair("other");

    for (
      let connection = 0;
      connection < MAX_STREAM_CONNECTIONS_PER_DISPLAY;
      connection += 1
    ) {
      // A LAN client, so the credential resolves the display these are counted
      // against rather than resolving every one to this PC.
      sampleStream(hosted.server, streamFor(busy), "192.168.1.50");
    }
    await vi.waitFor(
      () =>
        expect(hosted.connectionCount).toBe(MAX_STREAM_CONNECTIONS_PER_DISPLAY),
      { timeout: 15_000 },
    );

    expect((await streamStatus(hosted.server, streamFor(busy))).status).toBe(
      429,
    );

    // The per-display cap is separate from the total: one display cannot take
    // every slot, and refusing it must not refuse anyone else.
    expect((await streamStatus(hosted.server, streamFor(other))).status).toBe(
      200,
    );
    expect(hosted.connectionCount).toBe(MAX_STREAM_CONNECTIONS_PER_DISPLAY + 1);
  });
});

describe("A bundle 404 names the cause it can prove", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  async function server(
    built: boolean,
  ): Promise<ReturnType<typeof createHostServer>> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-404-"));
    dirs.push(dir);
    if (built) {
      await fs.writeFile(path.join(dir, "index.html"), "<!doctype html>");
    }
    return createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: dir, editor: dir },
    });
  }

  it("does not tell a reader to rebuild a bundle that is built", async () => {
    const hosted = await server(true);
    try {
      const res = await request(hosted.server, "GET", "/assets/missing.js");
      expect(res.status).toBe(404);
      // The build hint is right exactly when there is no build. Sending it here
      // is the loop ADR-0018 describes: rebuild, ask again, same answer.
      expect(res.text()).not.toContain("is not built");
    } finally {
      await hosted.close();
    }
  });

  it("still says which build to run when the bundle really is unbuilt", async () => {
    const hosted = await server(false);
    try {
      const res = await request(
        hosted.server,
        "GET",
        "/editor/assets/missing.js",
      );
      expect(res.status).toBe(404);
      expect(res.text()).toContain("packages/editor");
    } finally {
      await hosted.close();
    }
  });
});

describe("A path the player does not declare is not the player", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  it("404s a mistyped display URL instead of serving a working dashboard", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-player-"));
    dirs.push(dir);
    await fs.writeFile(
      path.join(dir, "index.html"),
      "<!doctype html><title>player</title>",
    );
    await fs.writeFile(
      path.join(dir, "favicon.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" />',
    );
    const hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: dir, editor: dir },
    });
    try {
      const status = (path: string): Promise<number> =>
        request(hosted.server, "GET", path).then((res) => res.status);

      // `?data=live` skips the theme resolution above and goes straight to the
      // bundle, which is the path under test. A bare `/` would answer with
      // whatever the theme store holds, which is not what this is about.
      await expect(status("/?data=live")).resolves.toBe(200);
      await expect(status("/favicon.svg")).resolves.toBe(200);
      // The two names an operator plausibly mistypes for a display URL.
      await expect(status("/play")).resolves.toBe(404);
      await expect(status("/display")).resolves.toBe(404);
      // Both answers are the honest 404, not a build hint that is not true.
      const miss = await request(hosted.server, "GET", "/play");
      expect(miss.text()).toBe("Not found.");
    } finally {
      await hosted.close();
    }
  });
});

describe("A bundle is build output: no links, and cacheable files", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  async function bundle(): Promise<{
    readonly dir: string;
    readonly hosted: ReturnType<typeof createHostServer>;
  }> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-static-"));
    dirs.push(dir);
    await fs.mkdir(path.join(dir, "assets"));
    await fs.writeFile(
      path.join(dir, "assets", "app.js"),
      "export const answer = 42;",
    );
    await fs.writeFile(path.join(dir, "index.html"), "<!doctype html><title>x");

    return {
      dir,
      hosted: createHostServer({
        registry: new ProviderRegistry([]),
        bundles: { player: dir, editor: dir },
      }),
    };
  }

  it("serves a regular file and refuses a link, even one pointing inside", async () => {
    const { dir, hosted } = await bundle();

    try {
      expect(
        (await request(hosted.server, "GET", "/assets/app.js")).status,
      ).toBe(200);

      // A build writes files, not links: the target is inside the root and the
      // link is still refused, because the realpath cannot be trusted to say
      // what a later swap would point at.
      await fs.symlink(
        path.join(dir, "assets", "app.js"),
        path.join(dir, "assets", "linked.js"),
      );
      expect(
        (await request(hosted.server, "GET", "/assets/linked.js")).status,
      ).toBe(404);
    } finally {
      await hosted.close();
    }
  });

  it("refuses a dotfile instead of falling back to the document", async () => {
    const { dir, hosted } = await bundle();
    await fs.writeFile(path.join(dir, ".env"), "SECRET=1");

    try {
      // `/.env` has no extension, which is the fallback's shape; the dotfile
      // rule has to win, or the entry document would answer it.
      expect((await request(hosted.server, "GET", "/.env")).status).toBe(404);
    } finally {
      await hosted.close();
    }
  });

  it("answers an etag, and 304 with no body for a matching If-None-Match", async () => {
    const { hosted } = await bundle();

    try {
      const first = await request(hosted.server, "GET", "/assets/app.js");
      expect(first.status).toBe(200);
      const etag = first.headers.etag;
      expect(typeof etag).toBe("string");
      expect(first.text()).toContain("answer = 42");

      const again = await request(
        hosted.server,
        "GET",
        "/assets/app.js",
        undefined,
        { headers: { "if-none-match": String(etag) } },
      );

      expect(again.status).toBe(304);
      expect(again.body).toHaveLength(0);
      // The type stays, because the browser reuses the stored representation.
      expect(again.headers["content-type"]).toBe(
        "text/javascript; charset=utf-8",
      );
    } finally {
      await hosted.close();
    }
  });
});

describe("An admin write keeps the platform's words off the wire", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  /** A write the filesystem refused: the one shape whose message carries an
   *  absolute path this machine owns and the browser must not read. */
  function refusedWrite(): () => Promise<never> {
    return () => {
      const refused = new Error(
        "EPERM: operation not permitted, open 'C:\\secret\\theme'",
      ) as NodeJS.ErrnoException;
      // What `fs` sets and what tells a platform failure from a store's rule.
      refused.code = "EPERM";
      return Promise.reject(refused);
    };
  }

  async function host(
    overrides: Partial<HostServerOptions>,
  ): Promise<ReturnType<typeof createHostServer>> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-admin-write-"));
    dirs.push(dir);

    return createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: dir, editor: dir },
      themeStore: createThemeStore(dir),
      thumbnails: createThumbnailStore(dir),
      themeSettings: createThemeSettingsStore(dir),
      ...overrides,
    });
  }

  /** The answer body, with the detail asserted to have gone to the console. */
  async function refusedBody(
    answer: { readonly status: number; text(): string },
    sentence: string,
  ): Promise<void> {
    expect(answer.status).toBe(500);
    expect(answer.text()).toBe(sentence);
    expect(answer.text()).not.toContain("C:\\secret");
    expect(console.error).toHaveBeenCalled();
  }

  it("answers a fixed sentence for a failed theme-settings write", async () => {
    const logged = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const hosted = await host({
      themeSettings: {
        ...createThemeSettingsStore(os.tmpdir()),
        write: refusedWrite(),
      },
    });

    try {
      const answer = await request(
        hosted.server,
        "PUT",
        "/api/themes/living-room/answers",
        "{}",
      );
      await refusedBody(answer, "The theme's answers could not be saved.");
      expect(logged).toHaveBeenCalled();
    } finally {
      await hosted.close();
    }
  });

  it("answers a fixed sentence for a failed thumbnail write", async () => {
    const logged = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const hosted = await host({
      thumbnails: {
        ...createThumbnailStore(os.tmpdir()),
        write: refusedWrite(),
      },
    });

    try {
      const answer = await request(
        hosted.server,
        "PUT",
        "/api/themes/living-room/thumbnail",
        new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      );
      await refusedBody(answer, "That thumbnail could not be saved.");
      expect(logged).toHaveBeenCalled();
    } finally {
      await hosted.close();
    }
  });

  it("answers a fixed sentence for a failed theme save, and keeps a decode refusal at 400", async () => {
    const logged = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const hosted = await host({
      themeStore: {
        ...createThemeStore(os.tmpdir()),
        write: refusedWrite(),
      },
    });

    try {
      const answer = await request(
        hosted.server,
        "PUT",
        "/api/themes/living-room",
        themeBody(createValidPackage("living-room")),
      );
      await refusedBody(answer, "That theme could not be saved.");
      expect(logged).toHaveBeenCalled();

      // A body the decoder refuses is the caller's, and stays a 400.
      const malformed = await request(
        hosted.server,
        "PUT",
        "/api/themes/living-room",
        "not json",
      );
      expect(malformed.status).toBe(400);
    } finally {
      await hosted.close();
    }
  });

  it("answers a fixed sentence for a failed theme removal", async () => {
    const logged = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const hosted = await host({
      themeStore: {
        ...createThemeStore(os.tmpdir()),
        remove: refusedWrite(),
      },
    });

    try {
      const answer = await request(
        hosted.server,
        "DELETE",
        "/api/themes/living-room",
      );
      await refusedBody(answer, "That theme could not be removed.");
      expect(logged).toHaveBeenCalled();
    } finally {
      await hosted.close();
    }
  });

  it("reports a completed removal as success when the origins sweep fails", async () => {
    const logged = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const hosted = await host({
      themeStore: {
        ...createThemeStore(os.tmpdir()),
        remove: () => Promise.resolve(true),
      },
      themeOrigins: {
        ...createThemeOriginsStore(os.tmpdir()),
        removeTheme: refusedWrite(),
      },
    });

    try {
      const answer = await request(
        hosted.server,
        "DELETE",
        "/api/themes/living-room",
      );

      // The folder is already in the trash: a sweep that failed afterwards
      // cannot turn a removal that happened into one that did not.
      expect(answer.status).toBe(200);
      expect(answer.json()).toEqual({ ok: true });
      expect(logged).toHaveBeenCalled();
    } finally {
      await hosted.close();
    }
  });

  it("answers a fixed sentence when the trash refuses with a path-bearing message", async () => {
    const logged = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const hosted = await host({
      themeStore: {
        ...createThemeStore(os.tmpdir()),
        // What `moveToTrash` really raises: a plain message from the child
        // process, no errno code, and the folder inside it.
        remove: () =>
          Promise.reject(
            new TrashRefusal(
              "Command failed: powershell.exe -NoProfile 'C:\\secret\\theme'",
            ),
          ),
      },
    });

    try {
      const answer = await request(
        hosted.server,
        "DELETE",
        "/api/themes/living-room",
      );

      await refusedBody(answer, "That theme could not be removed.");
      expect(logged).toHaveBeenCalled();
    } finally {
      await hosted.close();
    }
  });

  it("keeps the store's own retry sentence when a removal is refused as busy", async () => {
    const hosted = await host({
      themeStore: {
        ...createThemeStore(os.tmpdir()),
        // The store's refusal while a save owns the folder: plain text, no
        // errno code and no path, so it is the caller's to act on.
        remove: () =>
          Promise.reject(
            new Error(
              '"living-room" is being saved right now; try again in a moment.',
            ),
          ),
      },
    });

    try {
      const answer = await request(
        hosted.server,
        "DELETE",
        "/api/themes/living-room",
      );

      expect(answer.status).toBe(500);
      expect(answer.text()).toBe(
        '"living-room" is being saved right now; try again in a moment.',
      );
    } finally {
      await hosted.close();
    }
  });
});

describe("a pairing guard protects dashboard content, not the bundle", () => {
  /** A bundle file is served to anything that asks; content is not. */
  it("serves the bundle to an unpaired device and refuses everything else", async () => {
    const bundle = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-bundle-"));
    const themes = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-themes-"));
    // Where a bundle actually keeps them: under its own `assets/`.
    await fs.mkdir(path.join(bundle, "assets"), { recursive: true });
    await fs.writeFile(
      path.join(bundle, "assets", "index-abc123.js"),
      "export const x = 1;",
    );
    await fs.writeFile(path.join(bundle, "favicon.svg"), "<svg/>");
    const hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: bundle, editor: bundle },
      themeStore: createThemeStore(themes),
      displays: createDisplayStore(themes),
    });
    const lan = { remoteAddress: "192.168.2.56" };
    try {
      // A session token rides in the query string, because `fetch` and
      // `EventSource` carry one and `<script src>` cannot — so a paired phone
      // was served the document and then refused its own scripts.
      expect(
        (
          await request(
            hosted.server,
            "GET",
            "/assets/index-abc123.js",
            undefined,
            lan,
          )
        ).status,
      ).toBe(200);
      expect(
        (await request(hosted.server, "GET", "/favicon.svg", undefined, lan))
          .status,
      ).toBe(200);
      // Everything the guard exists for stays behind it.
      // `/api/display` is absent here — this server has no display store — and
      // a 404 for a route that does not exist is not the guard refusing, so the
      // paths below are the ones this harness can actually ask about.
      for (const path of ["/api/themes", "/editor/"]) {
        expect(
          (await request(hosted.server, "GET", path, undefined, lan)).status,
          path,
        ).toBe(403);
      }
    } finally {
      await hosted.close();
      await fs.rm(bundle, { recursive: true, force: true });
      await fs.rm(themes, { recursive: true, force: true });
    }
  });
});

describe("The hosting route answers where a phone should point (§145)", () => {
  let hostingDir: string;
  let hosted: ReturnType<typeof createHostServer>;

  beforeEach(async () => {
    hostingDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "yunari-host-hosting-test-"),
    );
  });

  /** `/api/hosting` reads no theme, so the bundles are only a temp directory. */
  function build(
    options: Omit<HostServerOptions, "registry" | "bundles" | "themeStore">,
  ): void {
    hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: hostingDir, editor: hostingDir },
      themeStore: createThemeStore(hostingDir),
      ...options,
    });
  }

  /** A binding that reports one state and moves nothing. The route's own shape
   *  is what these cases are about; the socket that actually moves is
   *  `cli/hosting.test.ts`'s and the real-socket case below. */
  function stillBinding(
    state: HostingState,
    setLan: HostBinding["setLan"] = async () => ({ ok: true }),
  ): HostBinding {
    return {
      state: async () => state,
      isLan: () => state.lan,
      setLan,
      idle: async () => {},
    };
  }

  afterEach(async () => {
    await hosted.close();
    await fs.rm(hostingDir, { recursive: true, force: true });
  });

  it("answers where a phone should go, and nothing else", async () => {
    const token = "t".repeat(43);
    const displays = createDisplayStore(hostingDir);
    build({
      hosting: stillBinding({
        lan: true,
        address: "192.168.1.42",
        port: 5227,
        refusal: null,
      }),
      displays,
    });

    const answered = await request(hosted.server, "GET", "/api/hosting");
    expect(answered.status).toBe(200);
    expect(answered.json()).toEqual({
      lan: true,
      address: "192.168.1.42",
      port: 5227,
      refusal: null,
      sessions: [],
    });

    // A `DisplayRecord` carries `tokenHash`, so a route that forwards `list()`
    // unchanged hands back the one thing the hash exists to keep out of a
    // reader's hands. An assertion over an empty list passes for that
    // implementation and for a redacting one alike, which is why this pairs:
    // without a display present, the test cannot tell them apart.
    await displays.create("Kitchen phone", token);
    const withOne = await request(hosted.server, "GET", "/api/hosting");
    const peers = (
      withOne.json() as { sessions: readonly Record<string, unknown>[] }
    ).sessions;
    expect(peers).toHaveLength(1);
    expect(peers[0]).not.toHaveProperty("tokenHash");
    expect(JSON.stringify(peers)).not.toContain(hashToken(token));
  });

  it("keeps hosting settings on this PC", async () => {
    build({
      hosting: stillBinding({
        lan: true,
        address: "192.168.1.42",
        port: 5227,
        refusal: null,
      }),
    });

    const answered = await request(
      hosted.server,
      "GET",
      "/api/hosting",
      undefined,
      { remoteAddress: "192.168.1.50" },
    );
    expect(answered.status).toBe(403);
  });

  it("answers loopback with nothing hosted when it was told nothing", async () => {
    build({});

    const answered = await request(hosted.server, "GET", "/api/hosting");
    expect(answered.json()).toEqual({
      lan: false,
      address: null,
      port: null,
      refusal: null,
      sessions: [],
    });
  });

  it("answers with the state it has now, and moves the binding only after", async () => {
    let lan = false;
    let remembered: boolean | undefined;
    build({
      hosting: {
        state: async () => ({
          lan,
          address: lan ? "192.168.1.42" : null,
          port: 5227,
          refusal: null,
        }),
        isLan: () => lan,
        setLan: async (on) => {
          lan = on;
          return { ok: true };
        },
        idle: async () => {},
      },
      rememberLan: async (on) => {
        remembered = on;
      },
    });

    const answered = await request(
      hosted.server,
      "PUT",
      "/api/hosting",
      JSON.stringify({ lan: true }),
    );

    // The answer is where the host is *now*, because it cannot be rebound while
    // this response is still on its socket — so it carries no verdict on the
    // move. The client reads where it landed from the GET that follows.
    expect(answered.status).toBe(200);
    expect(answered.json()).toEqual({
      lan: false,
      address: null,
      port: 5227,
      refusal: null,
      sessions: [],
    });

    // And the move does happen, once that answer has finished.
    await vi.waitFor(() => expect(remembered).toBe(true));
    expect(lan).toBe(true);
  });

  it("refuses to move the binding for anything but this PC", async () => {
    let moved = false;
    build({
      hosting: stillBinding(
        { lan: false, address: null, port: 5227, refusal: null },
        async () => {
          moved = true;
          return { ok: true };
        },
      ),
    });

    const answered = await request(
      hosted.server,
      "PUT",
      "/api/hosting",
      JSON.stringify({ lan: true }),
      { remoteAddress: "10.0.0.2" },
    );

    expect(answered.status).toBe(403);
    expect(moved).toBe(false);
  });

  it("reports a refused move through the read that follows it, and remembers nothing", async () => {
    let refusal: string | null = null;
    let remembered = false;
    build({
      hosting: {
        state: async () => ({ lan: false, address: null, port: 5227, refusal }),
        isLan: () => false,
        setLan: async () => {
          refusal = "Port 5227 is not free on 0.0.0.0: EADDRINUSE";
          return { ok: false, reason: refusal };
        },
        idle: async () => {},
      },
      rememberLan: async () => {
        remembered = true;
      },
    });

    const answered = await request(
      hosted.server,
      "PUT",
      "/api/hosting",
      JSON.stringify({ lan: true }),
    );

    // The answer predates the move and carries no verdict on it, which is the
    // whole of vg-173: the host's own words about a socket it would not take
    // cannot be in the response that asked it to take one.
    expect(answered.status).toBe(200);
    expect(answered.json()).toMatchObject({ lan: false, refusal: null });

    await vi.waitFor(() => expect(refusal).not.toBeNull());
    const after = await request(hosted.server, "GET", "/api/hosting");

    // Read from the route that follows, which is where the editor shows it.
    expect(after.json()).toMatchObject({
      lan: false,
      refusal: "Port 5227 is not free on 0.0.0.0: EADDRINUSE",
    });
    expect(remembered).toBe(false);
  });

  it("waits for a move in flight before it says where the host is", async () => {
    let answered = false;
    let settle: (() => void) | undefined;
    const inFlight = new Promise<void>((resolve) => {
      settle = resolve;
    });
    build({
      hosting: {
        state: async () => ({
          lan: true,
          address: "192.168.1.42",
          port: 5227,
          refusal: null,
        }),
        isLan: () => true,
        setLan: async () => ({ ok: true }),
        idle: async () => inFlight,
      },
    });

    const reading = request(hosted.server, "GET", "/api/hosting").then(() => {
      answered = true;
    });

    // A reader that follows a move must see where the host landed, not where it
    // started — and mid-move it is not bound at all, so answering here would
    // report the binding that is on its way out.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(answered).toBe(false);

    settle?.();
    await reading;
    expect(answered).toBe(true);
  });
});

/**
 * `vg-173`. The defect is a real socket: the response is owed on the connection
 * the move destroys, and none of that reproduces against the fake
 * request/response the rest of this file drives the handler with — an emitted
 * `request` event has no connection to lose. So this is a listening server and
 * a real `createHostBinding`, reached with `fetch`.
 */
describe("A LAN move answers before the socket it moves (vg-173)", () => {
  let moveDir: string;
  let hosted: ReturnType<typeof createHostServer>;

  beforeEach(async () => {
    moveDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "yunari-host-move-test-"),
    );
  });

  afterEach(async () => {
    // `fetch` leaves a keep-alive socket, and `close()` waits for connections,
    // so a teardown that only closed the server would hang on its own client.
    hosted.server.closeAllConnections();
    await hosted.close();
    await fs.rm(moveDir, { recursive: true, force: true });
  });

  /** A host on a real port, with a binding that can actually move it. The
   *  binding needs the port, and the port needs the server, so the binding is
   *  handed over once both exist. */
  async function listeningHost(): Promise<number> {
    const held: { binding?: HostBinding } = {};
    hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: moveDir, editor: moveDir },
      themeStore: createThemeStore(moveDir),
      get hosting() {
        return held.binding;
      },
    });

    const port = await new Promise<number>((resolve, reject) => {
      hosted.server.once("error", reject);
      hosted.server.listen(0, "127.0.0.1", () => {
        const address = hosted.server.address();
        resolve(
          typeof address === "object" && address !== null ? address.port : 0,
        );
      });
    });

    held.binding = createHostBinding(hosted.server, {
      port,
      host: "127.0.0.1",
    });
    return port;
  }

  it("answers a PUT that moves the binding", async () => {
    const port = await listeningHost();

    // The response is owed on the connection the move destroys, so a host that
    // tears down first answers nothing at all: `fetch` rejects with an empty
    // reply rather than returning a status. This is vg-173.
    const answered = await fetch(`http://127.0.0.1:${port}/api/hosting`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lan: true }),
    });

    expect(answered.status).toBe(200);
    await expect(answered.json()).resolves.toMatchObject({
      lan: expect.any(Boolean),
    });

    // And the move itself still happened, read back through the route that
    // waits for it: a 200 that moved nothing would pass the assertion above.
    const after = await (
      await fetch(`http://127.0.0.1:${port}/api/hosting`)
    ).json();
    expect(after).toMatchObject({ lan: true, refusal: null });
  });

  it("does not leave a request parked on a socket it spared (vg-174)", async () => {
    const port = await listeningHost();

    // The row's own mechanism, which has to be constructed because one client
    // cannot reach it. This socket is mid-request when the move starts — its
    // headers are read and the body it promised has not arrived — so the move
    // spares it rather than closing it, and it goes idle-and-alive the moment
    // that body arrives. A **second** request on it then runs its handler after
    // `moving` is assigned, so it parks on `idle()` for a move that is parked
    // on this very connection: a deadlock, not a slow answer.
    //
    // `Expect: 100-continue` is how the test knows the host has the request
    // rather than sleeping and hoping: Node answers it in the same run that
    // emits `request`, so waiting for that line is proof the host has it.
    const held = net.connect(port, "127.0.0.1");
    // The move destroys this socket, so its failure is the point of the case.
    held.on("error", () => {});
    const seen: string[] = [];
    let controlAnswered = false;
    let continueSeen: (() => void) | undefined;
    const arrived = new Promise<void>((resolve) => {
      continueSeen = resolve;
    });

    held.on("data", (chunk: Buffer) => {
      seen.push(chunk.toString("latin1"));
      const text = seen.join("");

      if (text.includes("100 Continue")) continueSeen?.();

      // The continue, the held request's own answer, and anything after them:
      // a third status line is the socket still being dispatched on.
      if (text.split("HTTP/1.1").length > 3) controlAnswered = true;
    });

    const ended = new Promise<boolean>((resolve) => {
      held.once("close", () => resolve(true));
      setTimeout(() => resolve(false), 2_000).unref();
    });

    await new Promise<void>((resolve) => held.once("connect", resolve));
    held.write(
      [
        "PUT /api/hosting HTTP/1.1",
        `Host: 127.0.0.1:${port}`,
        "Content-Type: application/json",
        "Expect: 100-continue",
        // `{"lan":0}` exactly: one byte short and the parser answers the 400
        // itself, with `Connection: close`, and the socket this case is about
        // is gone before the move ever runs.
        "Content-Length: 9",
        "",
        "",
      ].join("\r\n"),
    );
    await arrived;

    // The move runs while that request is still in flight. Its own answer is
    // owed on a connection the move takes with it — that trade is `vg-173`,
    // measured and green.
    //
    // **This 200 is not the discriminating assertion**: the move starts on
    // `finish`, so these bytes are already with the operating system before any
    // socket is destroyed, and it passes with the fix absent too. What tells
    // the two apart is the socket assertion below.
    const answered = await fetch(`http://127.0.0.1:${port}/api/hosting`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lan: true }),
    });
    expect(answered.status).toBe(200);

    // The held body frees the socket, and the two reads that follow are the
    // shape the row describes. Asserted as an object rather than a boolean so a
    // red run says which half it saw: with the fix absent this socket is still
    // alive and still dispatching — the health read beside it answers — while
    // the hosting read never does.
    held.write('{"lan":0}');
    held.write("GET /api/health HTTP/1.1\r\nHost: h\r\n\r\n");
    held.write("GET /api/hosting HTTP/1.1\r\nHost: h\r\n\r\n");

    expect({ ended: await ended, controlAnswered }).toMatchObject({
      ended: true,
    });

    // And the move settled, so the host is listening again and answers where it
    // landed. A GET waits for a move in flight, so a 200 here is the move
    // having finished rather than a reading taken around it.
    const after = await (
      await fetch(`http://127.0.0.1:${port}/api/hosting`)
    ).json();
    expect(after).toMatchObject({ lan: true, refusal: null });
  });
});

describe("The publish route", () => {
  it("publishes a theme this library has, and says no to everything else", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-publish-"));
    const hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: dir, editor: dir },
      themeStore: createThemeStore(dir),
    });

    try {
      // The assets a display fetches come from the theme's own folder, so there
      // has to be a folder before anything can be published against it.
      await request(
        hosted.server,
        "PUT",
        "/api/themes/living-room",
        themeBody(createValidPackage()),
      );
      const body = themeBody(createValidPackage());

      // No id at all is the caller's mistake, and it says so.
      const missing = await request(hosted.server, "PUT", "/api/publish", body);
      expect(missing.status).toBe(400);

      // A well-formed id this library does not have is a different answer.
      const unknown = await request(
        hosted.server,
        "PUT",
        "/api/publish?id=kitchen",
        body,
      );
      expect(unknown.status).toBe(404);

      // A document whose own id disagrees with the id it would be served under
      // is refused, exactly as a save refuses it — publishing bypasses `write`,
      // so this is the only place that check can live.
      const mismatched = await request(
        hosted.server,
        "PUT",
        "/api/publish?id=living-room",
        themeBody(createValidPackage("kitchen")),
      );
      expect(mismatched.status).toBe(400);

      const published = await request(
        hosted.server,
        "PUT",
        "/api/publish?id=living-room",
        body,
      );
      expect(published.status).toBe(200);
      expect(published.json()).toMatchObject({ ok: true, id: "living-room" });

      // The LAN is refused the whole surface, not just the body.
      const fromTheLan = await request(
        hosted.server,
        "PUT",
        "/api/publish?id=living-room",
        body,
        { remoteAddress: "10.0.0.2" },
      );
      expect(fromTheLan.status).toBe(403);

      const stop = await request(hosted.server, "DELETE", "/api/publish");
      expect(stop.json()).toMatchObject({ ok: true, id: null });
      expect(
        (await request(hosted.server, "GET", "/api/publish")).json(),
      ).toMatchObject({ id: null });
    } finally {
      await hosted.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses to publish a theme whose declared asset is missing", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-publish-"));
    const activeTheme = createActiveThemeStore(dir);
    const hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: dir, editor: dir },
      themeStore: createThemeStore(dir),
      activeTheme,
    });

    try {
      const content = createPackageWithAsset("assets/inter-400.woff2", [1, 2]);
      await request(
        hosted.server,
        "PUT",
        "/api/themes/living-room",
        themeBody(content),
      );
      // The document is still there and still validates; the declared file is
      // the half that is gone.
      await fs.rm(path.join(dir, "living-room", "assets", "inter-400.woff2"));

      const refused = await request(
        hosted.server,
        "PUT",
        "/api/publish?id=living-room",
        themeBody(content),
      );
      // The same answer an absent theme gets: a display would fetch the missing
      // file, and publishing is an admin act, so the whole theme is verified.
      expect(refused.status).toBe(404);
      expect(refused.text()).toBe(
        'No theme "living-room" in this library to publish.',
      );

      // The poll asks `exists`, which reads the document alone by ruling: the
      // assignment is still reported even though the theme cannot be published.
      await activeTheme.write(LOCAL_DISPLAY_ID, "living-room");
      const polled = await request(hosted.server, "GET", "/api/published");
      expect(polled.status).toBe(200);
      expect((polled.json() as { display: unknown }).display).toEqual({
        id: LOCAL_DISPLAY_ID,
        theme: "living-room",
        chartFps: 1,
      });
    } finally {
      await hosted.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses a document it cannot validate", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-publish-"));
    const hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: dir, editor: dir },
      themeStore: createThemeStore(dir),
    });

    try {
      await request(
        hosted.server,
        "PUT",
        "/api/themes/living-room",
        themeBody(createValidPackage()),
      );

      // `decodeThemeSave` accepts this — it checks that the envelope is an
      // object and nothing more — so it is the overlay's own validator that
      // must refuse it. That is the point of the case.
      //
      // **The envelope keeps the id it is published under, and that is
      // load-bearing.** The body here used to be `{ schemaVersion: 99 }`, with
      // no id at all, and that is refused by the id-agreement check a few lines
      // above — so the case proved the *id* guard worked and said nothing about
      // the validator. Deleting the validator branch outright still left it
      // green. Matching ids leave the validator as the only thing that can
      // refuse this, and the message is asserted for the same reason: the two
      // guards answer 400 with different words.
      const wire = JSON.parse(themeBody(createValidPackage())) as {
        envelope: Record<string, unknown>;
        assets: unknown;
      };
      wire.envelope["schemaVersion"] = "99.0.0";

      const bad = await request(
        hosted.server,
        "PUT",
        "/api/publish?id=living-room",
        JSON.stringify(wire),
      );
      expect(bad.status).toBe(400);
      expect(bad.text()).toContain("schema 99");
    } finally {
      await hosted.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("publishes a document from the previous schema major as the current one", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-publish-"));
    const hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: dir, editor: dir },
      themeStore: createThemeStore(dir),
    });

    try {
      await request(
        hosted.server,
        "PUT",
        "/api/themes/living-room",
        themeBody(createValidPackage()),
      );

      const wire = JSON.parse(themeBody(createValidPackage())) as {
        envelope: Record<string, unknown>;
        assets: unknown;
      };
      wire.envelope["schemaVersion"] = 2;

      const published = await request(
        hosted.server,
        "PUT",
        "/api/publish?id=living-room",
        JSON.stringify(wire),
      );
      expect(published.status).toBe(200);

      // What a display is served is the migrated envelope, not the bytes that
      // were posted: the raw integer is a shape no other reader accepts.
      const served = await request(
        hosted.server,
        "GET",
        "/api/themes/living-room/document",
      );
      expect(served.json()).toMatchObject({
        id: "living-room",
        schemaVersion: "2.0.0",
      });
    } finally {
      await hosted.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses a document from a schema major it cannot migrate", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-publish-"));
    const hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: dir, editor: dir },
      themeStore: createThemeStore(dir),
    });

    try {
      await request(
        hosted.server,
        "PUT",
        "/api/themes/living-room",
        themeBody(createValidPackage()),
      );

      const wire = JSON.parse(themeBody(createValidPackage())) as {
        envelope: Record<string, unknown>;
        assets: unknown;
      };
      wire.envelope["schemaVersion"] = "1.0.0";

      const bad = await request(
        hosted.server,
        "PUT",
        "/api/publish?id=living-room",
        JSON.stringify(wire),
      );
      expect(bad.status).toBe(400);
      expect(bad.text()).toContain(
        "Schema version 1.0.0 is not supported by this build (expected 2.0.0).",
      );
    } finally {
      await hosted.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses a paired display, so a phone cannot cause a publish", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-publish-"));
    const displays = createDisplayStore(dir);
    const hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: dir, editor: dir },
      themeStore: createThemeStore(dir),
      displays,
    });

    try {
      // A paired display is the caller that matters here: it is the one the
      // display guard *lets through*, so this route's own loopback check is the
      // only thing left between a phone and the publish surface. An unpaired
      // LAN request never reaches it — that one is refused a few hundred lines
      // earlier by `This display is not paired with the host.`, which is why a
      // test using a bare remoteAddress cannot tell the two guards apart.
      //
      // No theme is seeded on purpose: the refusal comes before the body is
      // decoded, so a 404 here would mean the guard had been passed.
      const token = newToken();
      await displays.create("phone", token);
      const fromThePhone = await request(
        hosted.server,
        "PUT",
        "/api/publish?id=living-room",
        themeBody(createValidPackage()),
        {
          remoteAddress: "192.168.1.50",
          headers: { "x-yunari-session": token },
        },
      );

      expect(fromThePhone.status).toBe(403);
      expect(fromThePhone.text()).toContain("this PC only");
    } finally {
      await hosted.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("The published overlay", () => {
  it("serves the published document to a display that asks for that theme", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-published-"));
    const hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: dir, editor: dir },
      themeStore: createThemeStore(dir),
    });

    try {
      // **The library starts empty**, so a document to publish *over* has to
      // exist first: without this the read below is a 404 and the assertion
      // after it compares `undefined` to an artboard.
      await request(
        hosted.server,
        "PUT",
        "/api/themes/living-room",
        themeBody(createValidPackage()),
      );

      const stored = await request(
        hosted.server,
        "GET",
        "/api/themes/living-room/document",
      );
      expect(stored.status).toBe(200);

      const publishedBody = JSON.stringify({
        envelope: {
          ...(stored.json() as object),
          artboard: { width: 320, height: 240 },
        },
        assets: {},
      });

      const published = await request(
        hosted.server,
        "PUT",
        "/api/publish?id=living-room",
        publishedBody,
      );
      expect(published.status).toBe(200);

      const shown = await request(
        hosted.server,
        "GET",
        "/api/themes/living-room/document",
      );
      expect((shown.json() as { artboard: unknown }).artboard).toEqual({
        width: 320,
        height: 240,
      });

      // The stored document is untouched: publishing is not saving.
      await request(hosted.server, "DELETE", "/api/publish");
      const again = await request(
        hosted.server,
        "GET",
        "/api/themes/living-room/document",
      );
      expect((again.json() as { artboard: unknown }).artboard).not.toEqual({
        width: 320,
        height: 240,
      });
    } finally {
      await hosted.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("hides the revision from an unpaired display", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-published-"));
    const hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: dir, editor: dir },
      themeStore: createThemeStore(dir),
      displays: createDisplayStore(dir),
    });

    try {
      const refused = await request(
        hosted.server,
        "GET",
        "/api/published",
        undefined,
        { remoteAddress: "192.168.1.50" },
      );
      expect(refused.status).toBe(403);

      // Loopback reads the same route, so the 403 above is the guard rather
      // than a route that refuses everybody. Nothing is published on a fresh
      // host, and the revision is still a number a display can poll.
      const here = await request(hosted.server, "GET", "/api/published");
      expect(here.status).toBe(200);
      expect(here.json()).toEqual({
        id: null,
        revision: 0,
        // `this-pc` is this machine's own monitor, so it repaints at the rate a
        // local display defaults to rather than the paired 30.
        display: { id: LOCAL_DISPLAY_ID, theme: null, chartFps: 1 },
      });
    } finally {
      await hosted.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("answers the display its own theme on /api/published", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-published-"));
    const store = createThemeStore(dir);
    const activeTheme = createActiveThemeStore(dir);
    const displays = createDisplayStore(dir);
    const hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: dir, editor: dir },
      themeStore: store,
      activeTheme,
      displays,
    });

    try {
      await store.write("living-room", createValidPackage());
      await store.write("studio", createValidPackage("studio", "Studio"));
      await activeTheme.write(DEFAULT_DISPLAY, "living-room");

      const token = newToken();
      await displays.create("Kitchen tablet", token);
      await activeTheme.write("kitchen-tablet", "studio");

      const own = await request(
        hosted.server,
        "GET",
        "/api/published",
        undefined,
        {
          remoteAddress: "192.168.1.50",
          headers: { "x-yunari-session": token },
        },
      );
      expect(own.status).toBe(200);
      expect((own.json() as { display: unknown }).display).toEqual({
        id: "kitchen-tablet",
        theme: "studio",
        chartFps: 30,
      });

      // A display nobody assigned a theme of its own is an unpaired client, and
      // the default is what such a client should be showing.
      const other = newToken();
      await displays.create("Hallway phone", other);

      const fallback = await request(
        hosted.server,
        "GET",
        "/api/published",
        undefined,
        {
          remoteAddress: "192.168.1.50",
          headers: { "x-yunari-session": other },
        },
      );
      expect((fallback.json() as { display: unknown }).display).toEqual({
        id: "hallway-phone",
        theme: "living-room",
        chartFps: 30,
      });
    } finally {
      await hosted.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("carries the display's own rate on the poll the player already makes", async () => {
    // The rate the player runs its refresh loop at, answered on the poll it
    // already makes rather than on a route of its own. A local display is in
    // front of the person using it and repaints every second; the record's own
    // rate wins once a person sets one.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-published-"));
    const displays = createDisplayStore(dir);
    const hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: dir, editor: dir },
      themeStore: createThemeStore(dir),
      displays,
    });

    try {
      const local = await displays.createLocal("Desk monitor", {
        deviceName: "DELL U2720Q",
      });
      const publishedFor = async (
        id: string,
      ): Promise<{ display: { chartFps: unknown } }> =>
        (
          await request(hosted.server, "GET", `/api/published?display=${id}`)
        ).json() as { display: { chartFps: unknown } };

      const before = await publishedFor(local.id);
      expect(before.display.chartFps).toBe(1);

      await displays.update(local.id, { chartFps: 30 });
      const after = await publishedFor(local.id);
      expect(after.display.chartFps).toBe(30);
    } finally {
      await hosted.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("answers null for a display on an explicit ?theme= link", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-published-"));
    const store = createThemeStore(dir);
    const activeTheme = createActiveThemeStore(dir);
    const displays = createDisplayStore(dir);
    const hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: dir, editor: dir },
      themeStore: store,
      activeTheme,
      displays,
    });

    try {
      await store.write("living-room", createValidPackage());
      await store.write("studio", createValidPackage("studio", "Studio"));
      await activeTheme.write(LOCAL_DISPLAY_ID, "living-room");

      const token = newToken();
      await displays.create("Kitchen tablet", token);
      await activeTheme.write("kitchen-tablet", "studio");

      // The link is the person's own instruction for that page, so an
      // assignment must not move it — and the host says so by answering none.
      const linked = await request(
        hosted.server,
        "GET",
        "/api/published?theme=other",
        undefined,
        {
          remoteAddress: "192.168.1.50",
          headers: { "x-yunari-session": token },
        },
      );
      expect(linked.status).toBe(200);
      expect((linked.json() as { display: unknown }).display).toEqual({
        id: "kitchen-tablet",
        theme: null,
        chartFps: 30,
      });

      // The same display without one is answered its assignment, so the null
      // above is the link rather than a route that answers nothing.
      const assigned = await request(
        hosted.server,
        "GET",
        "/api/published",
        undefined,
        {
          remoteAddress: "192.168.1.50",
          headers: { "x-yunari-session": token },
        },
      );
      expect((assigned.json() as { display: unknown }).display).toEqual({
        id: "kitchen-tablet",
        theme: "studio",
        chartFps: 30,
      });
    } finally {
      await hosted.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("asks the library about the assigned id alone, and never lists it", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-published-"));
    const store = createThemeStore(dir);
    const exists = vi.fn((id: string) => store.exists(id));
    const list = vi.fn(() => store.list());
    const read = vi.fn((id: string) => store.read(id));
    const activeTheme = createActiveThemeStore(dir);
    const displays = createDisplayStore(dir);
    const hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: dir, editor: dir },
      themeStore: { ...store, exists, list, read },
      activeTheme,
      displays,
    });

    try {
      await store.write("living-room", createValidPackage());
      await store.write("studio", createValidPackage("studio", "Studio"));
      const token = newToken();
      await displays.create("Kitchen tablet", token);
      await activeTheme.write("kitchen-tablet", "studio");

      const answer = await request(
        hosted.server,
        "GET",
        "/api/published",
        undefined,
        {
          remoteAddress: "192.168.1.50",
          headers: { "x-yunari-session": token },
        },
      );
      expect(answer.status).toBe(200);
      expect((answer.json() as { display: unknown }).display).toEqual({
        id: "kitchen-tablet",
        theme: "studio",
        chartFps: 30,
      });
      // One `theme.json` for the id the display is assigned — not a directory
      // read plus one document per theme, on a poll that runs every two seconds.
      expect(exists).toHaveBeenCalledWith("studio");
      expect(list).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
    } finally {
      await hosted.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("does not list or probe the library for a poll that named a theme", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-published-"));
    const store = createThemeStore(dir);
    const list = vi.fn(() => store.list());
    const exists = vi.fn((id: string) => store.exists(id));
    const activeTheme = createActiveThemeStore(dir);
    const displays = createDisplayStore(dir);
    const hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: dir, editor: dir },
      themeStore: { ...store, list, exists },
      activeTheme,
      displays,
    });

    try {
      const token = newToken();
      await displays.create("Kitchen tablet", token);
      await activeTheme.write("kitchen-tablet", "living-room");
      const asked = {
        remoteAddress: "192.168.1.50",
        headers: { "x-yunari-session": token },
      };

      const linked = await request(
        hosted.server,
        "GET",
        "/api/published?theme=other",
        undefined,
        asked,
      );
      expect(linked.status).toBe(200);

      // A link is answered none: a directory read, one `theme.json` per theme,
      // or even one existence probe, on every poll of every link page, is a
      // cost with nothing in it.
      expect(list).not.toHaveBeenCalled();
      expect(exists).not.toHaveBeenCalled();

      // The same display without one is answered its assignment, so the skip
      // above is the link rather than a route that never resolves.
      const assigned = await request(
        hosted.server,
        "GET",
        "/api/published",
        undefined,
        asked,
      );
      expect(assigned.status).toBe(200);
      expect(list).not.toHaveBeenCalled();
      expect(exists).toHaveBeenCalledTimes(1);
    } finally {
      await hosted.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("resolves the root through the published theme first, then the stored choice", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-published-"));
    const store = createThemeStore(dir);
    const activeTheme = createActiveThemeStore(dir);
    const hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: dir, editor: dir },
      themeStore: store,
      activeTheme,
    });

    try {
      await store.write("living-room", createValidPackage());
      await store.write("studio", createValidPackage("studio", "Studio"));
      // The consumer chose `studio`, so a `/` with nothing else to go on shows
      // that — and the published document taking precedence over the choice is
      // the whole point of the overlay.
      await activeTheme.write(DEFAULT_DISPLAY, "studio");

      const before = await request(hosted.server, "GET", "/");
      expect(before.headers.location).toBe(
        "/?theme=studio&data=live&theme-source=map",
      );

      await request(
        hosted.server,
        "PUT",
        "/api/publish?id=living-room",
        themeBody(createValidPackage()),
      );

      const after = await request(hosted.server, "GET", "/");
      expect(after.headers.location).toBe(
        "/?theme=living-room&data=live&theme-source=published",
      );
    } finally {
      await hosted.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Every display holds its own theme, so `/` has to answer the display that
 * asked rather than this PC (spec § "One map"). `?display=` names a local
 * monitor, and that is the one caller loopback is trusted for.
 */
describe("The root page resolves the display that asked", () => {
  let dir: string;
  let store: ReturnType<typeof createThemeStore>;
  let activeTheme: ReturnType<typeof createActiveThemeStore>;
  let displays: ReturnType<typeof createDisplayStore>;
  let hosted: ReturnType<typeof createHostServer>;

  const LAN = { remoteAddress: "192.168.1.50" };

  /** Two themes, so a resolution that finds nothing lands on the chooser
   *  rather than on the only theme there is. */
  async function library(): Promise<void> {
    await store.write("living-room", createValidPackage());
    await store.write("studio", createValidPackage("studio", "Studio"));
  }

  /** Pairs a display and answers the credential it holds. */
  async function pair(label = "Kitchen tablet"): Promise<string> {
    const token = newToken();
    await displays.create(label, token);
    return token;
  }

  /** The theme `GET /` resolved to, read off the redirect it answers with. The
   *  caller's own parameters ride along, so the theme is picked out of them. */
  async function root(
    urlPath = "/",
    options?: { remoteAddress?: string },
  ): Promise<string | undefined> {
    const answer = await request(
      hosted.server,
      "GET",
      urlPath,
      undefined,
      options,
    );
    expect(answer.status).toBe(302);
    const location = answer.headers.location as string | undefined;

    return location === undefined
      ? undefined
      : (new URL(location, "http://host").searchParams.get("theme") ??
          undefined);
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-root-display-"));
    store = createThemeStore(dir);
    activeTheme = createActiveThemeStore(dir);
    displays = createDisplayStore(dir);
    hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: dir, editor: dir },
      themeStore: store,
      activeTheme,
      displays,
    });
  });

  afterEach(async () => {
    await hosted.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("gives each display its own theme at the root", async () => {
    await library();
    await activeTheme.write(LOCAL_DISPLAY_ID, "living-room");

    const token = await pair();
    await activeTheme.write("kitchen-tablet", "studio");

    expect(await root()).toBe("living-room");
    expect(await root(`/?session=${encodeURIComponent(token)}`, LAN)).toBe(
      "studio",
    );
  });

  it("falls back to the default for a display with no entry", async () => {
    await library();
    await activeTheme.write(DEFAULT_DISPLAY, "living-room");

    // Paired, so it is served; never assigned a theme of its own.
    const token = await pair();

    expect(await root(`/?session=${encodeURIComponent(token)}`, LAN)).toBe(
      "living-room",
    );
  });

  it("falls back to the default when the assigned theme was deleted", async () => {
    await library();
    await activeTheme.write(DEFAULT_DISPLAY, "living-room");
    await activeTheme.write("kitchen-tablet", "gone");

    const token = await pair();

    expect(await root(`/?session=${encodeURIComponent(token)}`, LAN)).toBe(
      "living-room",
    );
  });

  it("lets an explicit ?theme= outrank the assignment", async () => {
    await library();
    await activeTheme.write(LOCAL_DISPLAY_ID, "living-room");

    expect(await root("/?theme=studio")).toBe("studio");
  });

  /** Where the theme `GET /` resolved came from, read off the redirect it
   *  answers with. */
  async function source(urlPath = "/"): Promise<string | undefined> {
    const answer = await request(hosted.server, "GET", urlPath);
    expect(answer.status).toBe(302);
    const location = answer.headers.location as string | undefined;

    return location === undefined
      ? undefined
      : (new URL(location, "http://host").searchParams.get("theme-source") ??
          undefined);
  }

  it("says where the theme it resolved came from", async () => {
    await library();
    await activeTheme.write(LOCAL_DISPLAY_ID, "living-room");

    // The display's own entry, which is what an assignment moves.
    expect(await source()).toBe("map");
    // The person's own instruction for that page.
    expect(await source("/?theme=studio")).toBe("link");

    // The publish outranks both. A page showing it must not be moved by an
    // assignment: reloading there would re-resolve to the published theme and
    // see the map's entry again on the next poll — a reload loop.
    await request(
      hosted.server,
      "PUT",
      "/api/publish?id=studio",
      themeBody(createValidPackage("studio", "Studio")),
    );

    expect(await source()).toBe("published");
  });

  it("resolves a local monitor from loopback", async () => {
    await library();
    await displays.createLocal("Left screen", {
      deviceName: "\\\\.\\DISPLAY2",
    });
    await activeTheme.write("left-screen", "studio");

    expect(await root("/?display=left-screen")).toBe("studio");
  });

  it("refuses to resolve a local monitor from off this PC", async () => {
    await library();
    await displays.createLocal("Left screen", {
      deviceName: "\\\\.\\DISPLAY2",
    });
    await activeTheme.write("left-screen", "studio");

    // Naming a display is not a way to become one: an unpaired caller from the
    // LAN never reaches the resolution at all.
    const refused = await request(
      hosted.server,
      "GET",
      "/?display=left-screen",
      undefined,
      LAN,
    );
    expect(refused.status).toBe(403);

    // And a paired one that names it is still served as itself.
    const token = await pair();
    await activeTheme.write("kitchen-tablet", "living-room");

    expect(
      await root(
        `/?display=left-screen&session=${encodeURIComponent(token)}`,
        LAN,
      ),
    ).toBe("living-room");
  });

  it("refuses to resolve a *paired* display from loopback by naming it", async () => {
    await library();
    await pair();
    await activeTheme.write(LOCAL_DISPLAY_ID, "living-room");
    await activeTheme.write("kitchen-tablet", "studio");

    // `?display=` names local displays only, so a paired display is reached by
    // its credential and by nothing else.
    expect(await root("/?display=kitchen-tablet")).toBe("living-room");
  });

  it("answers displayKeyFor for the four kinds of caller", async () => {
    const token = await pair();
    await displays.createLocal("Left screen", {
      deviceName: "\\\\.\\DISPLAY2",
    });

    const message = (remoteAddress: string): http.IncomingMessage =>
      ({ socket: { remoteAddress }, headers: {} }) as http.IncomingMessage;

    expect(
      await displayKeyFor(
        message("127.0.0.1"),
        new URL("http://host/"),
        displays,
      ),
    ).toBe(LOCAL_DISPLAY_ID);

    expect(
      await displayKeyFor(
        message("::ffff:127.0.0.1"),
        new URL("http://host/?display=left-screen"),
        displays,
      ),
    ).toBe("left-screen");

    expect(
      await displayKeyFor(
        message("192.168.1.50"),
        new URL(`http://host/?session=${encodeURIComponent(token)}`),
        displays,
      ),
    ).toBe("kitchen-tablet");

    expect(
      await displayKeyFor(
        message("192.168.1.50"),
        new URL("http://host/"),
        displays,
      ),
    ).toBe(DEFAULT_DISPLAY);

    // The parameter and the off-PC caller together: the local display is in the
    // store, so a reader that took `?display=` from anywhere would answer it.
    expect(
      await displayKeyFor(
        message("192.168.1.50"),
        new URL("http://host/?display=left-screen"),
        displays,
      ),
    ).toBe(DEFAULT_DISPLAY);
  });
});

/**
 * The origin, which is the whole of Task 25.8b: a display that cannot hold a
 * wake lock or register a service worker is a display at a plain-http origin,
 * and no route decides that.
 */
describe("The host's secure origin", () => {
  let tmpDir: string;
  let origin: Awaited<ReturnType<typeof createSecureOrigin>>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-origin-"));
    origin = await createSecureOrigin(tmpDir, ["localhost", "127.0.0.1"]);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  /** The host as the launcher builds it: a certificate, and the root to hand
   *  out. Both protocols on one port, read over a real socket. */
  function host({ withRoot = true }: { readonly withRoot?: boolean } = {}) {
    return createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: tmpDir, editor: tmpDir },
      tls: { key: origin.key, cert: origin.chain },
      ...(withRoot ? { caCertificate: origin.certificate } : {}),
    });
  }

  /**
   * The same host without a certificate, so the in-process `request` helper can
   * reach the router.
   *
   * A route answers identically on both protocols — one handler, two servers —
   * and the helper is the only way to *be* a non-loopback reader, which is the
   * state the root route exists for. The transport is proven over a real socket
   * in the cases above rather than pretended at here.
   */
  function plainHost({
    withRoot = true,
  }: {
    readonly withRoot?: boolean;
  } = {}) {
    return createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: tmpDir, editor: tmpDir },
      ...(withRoot ? { caCertificate: origin.certificate } : {}),
    });
  }

  /** A real TLS handshake against a real socket, trusting the root this host
   *  just made — not `rejectUnauthorized: false`, which would accept any
   *  certificate and prove nothing about the one under test. */
  function get(
    port: number,
    urlPath: string,
  ): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const call = https.request(
        // The address rather than a hostname: this is the client a phone is,
        // and an IP has to be covered by a SAN rather than by a CN.
        { host: "127.0.0.1", port, path: urlPath, ca: origin.certificate },
        (answer) => {
          const chunks: Buffer[] = [];
          answer.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
          answer.on("end", () =>
            resolve({
              status: answer.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8"),
            }),
          );
        },
      );
      call.on("error", reject);
      call.end();
    });
  }

  /** An https request answered as far as its headers, so the caller keeps the
   *  connection and can ask afterwards what became of it. */
  function openOverTls(
    port: number,
    urlPath: string,
    agent?: https.Agent,
  ): Promise<{ status: number; socket: Socket; answer: http.IncomingMessage }> {
    return new Promise((resolve, reject) => {
      const call = https.request(
        {
          host: "127.0.0.1",
          port,
          path: urlPath,
          ca: origin.certificate,
          ...(agent === undefined ? {} : { agent }),
        },
        (answer) =>
          resolve({
            status: answer.statusCode ?? 0,
            socket: answer.socket,
            answer,
          }),
      );
      call.on("error", reject);
      call.end();
    });
  }

  /** Whether a client's socket is closed within `ms`. Raced rather than read
   *  once: a destroy on the server takes a round trip to show up on this side,
   *  and reading `destroyed` straight after the call would be reading before
   *  the answer arrived. */
  function closedWithin(socket: Socket, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), ms);
      socket.once("close", () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  it("answers over https, on a chain the client accepts", async () => {
    const hosted = host();
    await new Promise<void>((resolve) =>
      hosted.server.listen(0, "127.0.0.1", resolve),
    );

    try {
      const port = (hosted.server.address() as AddressInfo).port;
      const answer = await get(port, "/api/health");

      expect(answer.status).toBe(200);
      // The route's own body, read off the wire rather than assumed: a client
      // that accepted the chain is a client that reached the router.
      expect(JSON.parse(answer.body)).toMatchObject({ displays: 0 });
    } finally {
      await hosted.close();
    }
  });

  it("still answers plain http on the same port, so the pairing link keeps working", async () => {
    // **The case that fails if the listener is made https-only.** The host
    // prints its display addresses https-first, with the plain address beside
    // each one as the fallback a device that has not installed the root
    // certificate opens (`docs/decisions/0076`) — so a port that stopped
    // answering http would leave that device with no way in at all, the pairing
    // link and the certificate fetch both being http until the root is on it.
    // Both protocols on one port is what makes the fallback true, and nothing
    // else does.
    const hosted = host();
    await new Promise<void>((resolve) =>
      hosted.server.listen(0, "127.0.0.1", resolve),
    );

    try {
      const port = (hosted.server.address() as AddressInfo).port;
      const answer = await fetch(`http://127.0.0.1:${port}/api/health`);

      expect(answer.status).toBe(200);
      expect(await answer.json()).toMatchObject({ displays: 0 });
    } finally {
      await hosted.close();
    }
  });

  it("prunes a kept connection the inner servers cannot see, so a move can land", async () => {
    // **The case that fails when this port stops pruning for itself.** The
    // binding closes idle sockets before it rebinds (`vg-173`), and a server
    // handed sockets by `emit("connection")` never builds the connection
    // registry its own `closeIdleConnections()` reads. So a browser's kept
    // connection is invisible to both inner servers, `close()` waits on it for
    // ever, and the editor's host switch stays off — the failure this case was
    // written from, at the LAN address and over the editor.
    const hosted = host();
    await new Promise<void>((resolve) =>
      hosted.server.listen(0, "127.0.0.1", resolve),
    );

    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });

    try {
      const port = (hosted.server.address() as AddressInfo).port;
      await new Promise<void>((resolve, reject) => {
        const call = http.request(
          { host: "127.0.0.1", port, path: "/api/health", agent },
          (answer) => {
            answer.resume();
            answer.on("end", () => resolve());
          },
        );
        call.on("error", reject);
        call.end();
      });
      // A connection really is being kept, which is what makes the assertion
      // below about the port rather than about a client that hung up.
      expect(Object.values(agent.freeSockets).flat()).toHaveLength(1);

      hosted.server.closeIdleConnections();

      const closed = await Promise.race([
        hosted.close().then(() => "closed" as const),
        new Promise<"timed out">((resolve) => {
          setTimeout(() => resolve("timed out"), 5_000);
        }),
      ]);

      // Only reachable on a failure, and a test that failed has already said so
      // — this is what keeps the open handle from holding the worker up.
      hosted.server.closeAllConnections();
      expect(closed).toBe("closed");
    } finally {
      agent.destroy();
    }
  });

  it("prunes an idle TLS socket and leaves a TLS response in flight alone", async () => {
    // **The TLS half of the pruning case, and the half that was missing.** An
    // https server reports its `request` event's socket as a `tls.TLSSocket`
    // wrapping the one this port accepted, so a guard keyed on object identity
    // never matches over TLS, and this port destroys a response in flight —
    // which is what the LAN toggle would do to a display mid-fetch. The plain
    // http case above cannot see it, because there the two objects are one.
    const hosted = host();
    await new Promise<void>((resolve) =>
      hosted.server.listen(0, "127.0.0.1", resolve),
    );

    const agent = new https.Agent({ keepAlive: true, maxSockets: 1 });

    try {
      const port = (hosted.server.address() as AddressInfo).port;

      // Idle: a response that finished, on a connection the agent keeps.
      const idle = await openOverTls(port, "/api/health", agent);
      await new Promise<void>((resolve) => {
        idle.answer.on("end", () => resolve());
        idle.answer.resume();
      });
      expect(idle.socket.destroyed).toBe(false);

      // Not finished: the sample stream stays open until its client goes away,
      // so it is mid-response while the prune runs.
      const stream = await openOverTls(port, SAMPLE_STREAM_PATH);
      expect(stream.status).toBe(200);
      expect(stream.socket.destroyed).toBe(false);

      // A destroy here can reach the client as a reset, and an unhandled one
      // would take the worker down rather than fail this case.
      for (const socket of [idle.socket, stream.socket]) {
        socket.on("error", () => {});
      }

      const streamClosed = closedWithin(stream.socket, 1_000);
      const idleClosed = closedWithin(idle.socket, 1_000);
      hosted.server.closeIdleConnections();

      expect(await streamClosed).toBe(false);
      expect(await idleClosed).toBe(true);

      stream.answer.destroy();
    } finally {
      agent.destroy();
      hosted.server.closeAllConnections();
      await hosted.close();
    }
  });

  it("destroys a socket that is slow to say what it is", () => {
    // **The case that fails without the pre-handshake timeout.** A socket this
    // port accepted has sent nothing, so neither inner server has seen it and
    // neither one's timeout applies: a client that connects and stays silent
    // holds its slot until the process ends. Scripted rather than dialled, so
    // the first byte is the case's to decide and the five seconds are read back
    // rather than waited out.
    const plain = new EventEmitter() as unknown as http.Server;
    const secure = new EventEmitter() as unknown as https.Server;
    const listener = createPortListener(plain, secure);

    function accepted(first: Buffer | null): {
      readonly waits: number[];
      readonly fireTimeout: () => void;
      readonly say: () => void;
      readonly destroyed: () => boolean;
    } {
      const waits: number[] = [];
      let timedOut: (() => void) | undefined;
      let readable: () => void = () => undefined;
      let destroyed = false;

      const socket = {
        remoteAddress: "10.0.0.9",
        remotePort: 40_001,
        localAddress: "10.0.0.1",
        localPort: 5227,
        on: () => socket,
        once: (event: string, listener: () => void) => {
          if (event === "readable") readable = listener;
          return socket;
        },
        setTimeout: (ms: number, fire: () => void) => {
          waits.push(ms);
          timedOut = fire;
          return socket;
        },
        read: () => first,
        unshift: () => undefined,
        destroy: () => {
          destroyed = true;
          return socket;
        },
      } as unknown as Socket;

      listener.emit("connection", socket);

      return {
        waits,
        fireTimeout: () => timedOut?.(),
        say: () => readable(),
        destroyed: () => destroyed,
      };
    }

    expect(listener.maxConnections).toBe(256);

    const silent = accepted(null);
    expect(silent.waits).toEqual([5_000]);
    expect(silent.destroyed()).toBe(false);
    silent.fireTimeout();
    expect(silent.destroyed()).toBe(true);

    // And the wait ends at the first byte: a stream that is quiet between
    // batches is not a stream this port destroys.
    const talking = accepted(Buffer.from("GET / HTTP/1.1\r\n", "utf8"));
    talking.say();
    expect(talking.waits).toEqual([5_000, 0]);
    expect(talking.destroyed()).toBe(false);
  });

  it("is plain http when the caller brings no certificate, which is why the launcher always does", async () => {
    // The case that fails when the change is disabled: the same client, the
    // same route, no certificate — and the handshake does not complete. It is
    // about the transport rather than a number, so it cannot pass on a machine
    // where the answer happens to be different.
    const hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: tmpDir, editor: tmpDir },
    });
    await new Promise<void>((resolve) =>
      hosted.server.listen(0, "127.0.0.1", resolve),
    );

    try {
      const port = (hosted.server.address() as AddressInfo).port;
      await expect(get(port, "/api/health")).rejects.toThrow();
    } finally {
      await hosted.close();
    }
  });

  it("offers the root to a device that has no session and has not paired", async () => {
    const hosted = plainHost();

    try {
      // A non-loopback reader with no token: exactly the state a phone is in
      // while it is looking at the warning this route exists to remove.
      const answer = await request(
        hosted.server,
        "GET",
        CA_CERTIFICATE_PATH,
        undefined,
        { remoteAddress: "192.168.1.50" },
      );

      expect(answer.status).toBe(200);
      expect(answer.headers["content-type"]).toBe("application/x-x509-ca-cert");
      expect(answer.text()).toBe(origin.certificate);
    } finally {
      await hosted.close();
    }
  });

  it("says it has none rather than answering with nothing", async () => {
    const hosted = plainHost({ withRoot: false });

    try {
      const answer = await request(hosted.server, "GET", CA_CERTIFICATE_PATH);
      expect(answer.status).toBe(404);
      expect(answer.text()).toContain("no certificate");
    } finally {
      await hosted.close();
    }
  });
});

describe("Host Wallpaper Engine routes", () => {
  let tmpDir: string;

  const listingAnswer = {
    available: true as const,
    install: "C:\Games\Steam\steamapps\common\wallpaper_engine",
    skipped: 2,
    items: [
      {
        workshopId: "201",
        title: "Still Scene",
        kind: "scene" as const,
        previewUrl: "/api/wallpaper-engine/item/201/preview",
        filesize: 10,
        tags: [],
        properties: undefined,
        stillAtRest: true,
        hasText: true,
      },
    ],
  };

  const encoder = new TextEncoder();

  const unpacked = {
    ok: true as const,
    name: "201",
    reused: false,
    launched: true,
  };

  function fakeSource(): WallpaperEngineSource {
    return {
      listing: () => Promise.resolve(listingAnswer),
      bytesOf: (workshopId, part) => {
        if (workshopId !== "201") {
          return Promise.resolve(undefined);
        }
        return Promise.resolve(
          part === "preview"
            ? { bytes: encoder.encode("jpeg"), contentType: "image/jpeg" }
            : { bytes: encoder.encode("mp4"), contentType: "video/mp4" },
        );
      },
      project: (workshopId) =>
        Promise.resolve(
          workshopId === "201"
            ? unpacked
            : { ok: false as const, reason: "refused" as const },
        ),
      exportsSince: (since) =>
        Promise.resolve([
          {
            name: `shot-${since}.png`,
            format: "png" as const,
            modified: since + 1,
            size: 9,
          },
        ]),
      exportBytes: (name) =>
        Promise.resolve(
          name === "shot.png"
            ? { bytes: encoder.encode("png"), contentType: "image/png" }
            : undefined,
        ),
    };
  }

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-host-we-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function host(source?: WallpaperEngineSource) {
    return createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: tmpDir, editor: tmpDir },
      themeStore: createThemeStore(tmpDir),
      ...(source === undefined ? {} : { wallpaperEngine: source }),
    });
  }

  it("answers the injected listing verbatim", async () => {
    const hosted = host(fakeSource());

    try {
      const answer = await request(
        hosted.server,
        "GET",
        "/api/wallpaper-engine",
      );
      expect(answer.status).toBe(200);
      expect(answer.json()).toEqual(listingAnswer);
    } finally {
      await hosted.close();
    }
  });

  it("refuses every read from a paired LAN display", async () => {
    // A paired display passes the dashboard guard, so only these routes
    // themselves can keep this PC's Wallpaper Engine library off the LAN.
    const displays = createDisplayStore(tmpDir);
    const token = newToken();
    await displays.create("phone", token);
    const hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: tmpDir, editor: tmpDir },
      themeStore: createThemeStore(tmpDir),
      displays,
      wallpaperEngine: fakeSource(),
    });

    try {
      for (const route of [
        "/api/wallpaper-engine",
        "/api/wallpaper-engine/item/201/preview",
        "/api/wallpaper-engine/item/201/asset",
        "/api/wallpaper-engine/exports?since=1700000000000",
        "/api/wallpaper-engine/export?name=shot.png",
      ]) {
        const answer = await request(hosted.server, "GET", route, undefined, {
          remoteAddress: "192.168.1.50",
          headers: {
            host: "192.168.1.50:5173",
            "x-yunari-session": token,
          },
        });
        expect(answer.status, route).toBe(403);
      }
    } finally {
      await hosted.close();
    }
  });

  it("serves preview and payload bytes, and 404 for an unknown id", async () => {
    const hosted = host(fakeSource());

    try {
      const preview = await request(
        hosted.server,
        "GET",
        "/api/wallpaper-engine/item/201/preview",
      );
      expect(preview.status).toBe(200);
      expect(preview.headers["content-type"]).toBe("image/jpeg");
      expect(preview.headers["cache-control"]).toBe("no-store");
      expect(preview.body.toString()).toBe("jpeg");

      const asset = await request(
        hosted.server,
        "GET",
        "/api/wallpaper-engine/item/201/asset",
      );
      expect(asset.status).toBe(200);
      expect(asset.headers["content-type"]).toBe("video/mp4");
      expect(asset.body.toString()).toBe("mp4");

      expect(
        (
          await request(
            hosted.server,
            "GET",
            "/api/wallpaper-engine/item/999/asset",
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await request(
            hosted.server,
            "GET",
            "/api/wallpaper-engine/item/999/preview",
          )
        ).status,
      ).toBe(404);
      // Malformed percent-encoding names no item either, and is not a fault.
      expect(
        (
          await request(
            hosted.server,
            "GET",
            "/api/wallpaper-engine/item/%ZZ/asset",
          )
        ).status,
      ).toBe(404);
    } finally {
      await hosted.close();
    }
  });

  it("answers not-installed when the host has no source", async () => {
    const hosted = host();

    try {
      const answer = await request(
        hosted.server,
        "GET",
        "/api/wallpaper-engine",
      );
      expect(answer.status).toBe(200);
      expect(answer.json()).toEqual({
        available: false,
        reason: "not-installed",
      });
    } finally {
      await hosted.close();
    }
  });

  it("unpacks on POST /project and refuses that path on GET", async () => {
    const hosted = host(fakeSource());

    try {
      const answer = await request(
        hosted.server,
        "POST",
        "/api/wallpaper-engine/item/201/project",
      );
      expect(answer.status).toBe(200);
      expect(answer.json()).toEqual(unpacked);

      // The POST-only route answers the method it does not serve rather than
      // the 404 an unknown path gets.
      const refused = await request(
        hosted.server,
        "GET",
        "/api/wallpaper-engine/item/201/project",
      );
      expect(refused.status).toBe(405);

      const unknown = await request(
        hosted.server,
        "POST",
        "/api/wallpaper-engine/item/999/project",
      );
      expect(unknown.json()).toEqual({ ok: false, reason: "refused" });
    } finally {
      await hosted.close();
    }
  });

  it("answers no-install on POST /project when the host has no source", async () => {
    const hosted = host();

    try {
      const answer = await request(
        hosted.server,
        "POST",
        "/api/wallpaper-engine/item/201/project",
      );
      expect(answer.json()).toEqual({ ok: false, reason: "no-install" });
    } finally {
      await hosted.close();
    }
  });

  it("requires an integer since on the exports listing", async () => {
    const hosted = host(fakeSource());

    try {
      const answer = await request(
        hosted.server,
        "GET",
        "/api/wallpaper-engine/exports?since=1700000000000",
      );
      expect(answer.status).toBe(200);
      expect(answer.json()).toEqual({
        files: [
          {
            name: "shot-1700000000000.png",
            format: "png",
            modified: 1700000000001,
            size: 9,
          },
        ],
      });

      // A missing since would offer every old file on the machine, so absence
      // is a refusal rather than a default epoch.
      for (const query of [
        "",
        "?since=",
        "?since=abc",
        "?since=1.5",
        "?since=-1",
        "?since=1e3",
      ]) {
        const refused = await request(
          hosted.server,
          "GET",
          `/api/wallpaper-engine/exports${query}`,
        );
        expect(refused.status, query).toBe(400);
      }
    } finally {
      await hosted.close();
    }
  });

  it("serves an export by name and 404s every other name", async () => {
    const hosted = host(fakeSource());

    try {
      const answer = await request(
        hosted.server,
        "GET",
        "/api/wallpaper-engine/export?name=shot.png",
      );
      expect(answer.status).toBe(200);
      expect(answer.headers["content-type"]).toBe("image/png");
      expect(answer.headers["cache-control"]).toBe("no-store");
      expect(answer.body.toString()).toBe("png");

      // The query is decoded first, so `x%2e%2e/y.png` is the traversal the
      // source has to refuse, not one it never sees.
      for (const query of [
        "",
        "?name=",
        "?name=../project.json",
        "?name=a%2Fb.png",
        "?name=x%2e%2e%2Fy.png",
        "?name=x.jpg",
      ]) {
        const refused = await request(
          hosted.server,
          "GET",
          `/api/wallpaper-engine/export${query}`,
        );
        expect(refused.status, query).toBe(404);
      }
    } finally {
      await hosted.close();
    }
  });
});

describe("Weather settings routes", () => {
  let settingsDir: string;
  let hosted: ReturnType<typeof createHostServer> | undefined;

  beforeEach(async () => {
    settingsDir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-weather-"));
  });

  afterEach(async () => {
    await hosted?.close();
    hosted = undefined;
    await fs.rm(settingsDir, { recursive: true, force: true });
  });

  /** A host holding this directory's weather store, and the store itself so a
   *  case can read what a route wrote. */
  async function launch(
    options: { readonly fetch?: typeof fetch } = {},
  ): Promise<{
    readonly server: ListenableServer;
    readonly weather: ReturnType<typeof createWeatherSettingsStore>;
  }> {
    const weather = createWeatherSettingsStore(settingsDir);
    const running = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: settingsDir, editor: settingsDir },
      weather,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
    hosted = running;
    return { server: running.server, weather };
  }

  const BERLIN = {
    provider: "open-meteo",
    label: "Berlin, Berlin, DE",
    latitude: 52.52,
    longitude: 13.41,
    useWindowsLocation: false,
    pollIntervalMs: 600000,
  } as const;

  it("answers this PC's stored weather settings, and refuses the network", async () => {
    const { server } = await launch();

    const local = await request(server, "GET", "/api/weather/settings");
    expect(local.status).toBe(200);
    expect((local.json() as { settings: unknown }).settings).toEqual(
      DEFAULT_WEATHER_SETTINGS,
    );

    // A place and a polling cadence are this PC's own facts, like the display
    // preferences beside them.
    expect(
      (
        await request(server, "GET", "/api/weather/settings", undefined, {
          remoteAddress: "192.168.1.50",
        })
      ).status,
    ).toBe(403);
  });

  it("stores what a PUT normalizes, and answers the stored reading", async () => {
    const { server, weather } = await launch();

    const saved = await request(
      server,
      "PUT",
      "/api/weather/settings",
      JSON.stringify({ ...BERLIN, label: "  Berlin, Berlin, DE  " }),
    );
    expect(saved.status).toBe(200);
    expect((saved.json() as { settings: unknown }).settings).toEqual(BERLIN);
    expect(await weather.read()).toEqual(BERLIN);

    const read = await request(server, "GET", "/api/weather/settings");
    expect((read.json() as { settings: unknown }).settings).toEqual(BERLIN);

    // A write is an admin action too.
    expect(
      (
        await request(
          server,
          "PUT",
          "/api/weather/settings",
          JSON.stringify(BERLIN),
          { remoteAddress: "192.168.1.50" },
        )
      ).status,
    ).toBe(403);
  });

  it("answers the selected backend's attribution with its settings", async () => {
    const { server } = await launch();

    const openMeteo = await request(server, "GET", "/api/weather/settings");
    expect(openMeteo.status).toBe(200);
    expect((openMeteo.json() as { attribution: unknown }).attribution).toEqual({
      text: "Weather data by Open-Meteo.com",
      url: "https://open-meteo.com/en/licence",
    });

    const saved = await request(
      server,
      "PUT",
      "/api/weather/settings",
      JSON.stringify({ ...BERLIN, provider: "weatherapi" }),
    );
    expect((saved.json() as { attribution: unknown }).attribution).toEqual({
      text: "Powered by WeatherAPI.com",
      url: "https://www.weatherapi.com/",
    });

    const byok = await request(server, "GET", "/api/weather/settings");
    expect((byok.json() as { attribution: unknown }).attribution).toEqual({
      text: "Powered by WeatherAPI.com",
      url: "https://www.weatherapi.com/",
    });
  });

  it("refuses invalid input with the normalizer's message and keeps the file", async () => {
    const { server, weather } = await launch();
    await weather.write(BERLIN);

    const refused = await request(
      server,
      "PUT",
      "/api/weather/settings",
      JSON.stringify({ ...BERLIN, latitude: 91 }),
    );
    expect(refused.status).toBe(400);
    expect(refused.text()).toMatch(/latitude/);

    expect(await weather.read()).toEqual(BERLIN);
  });

  it("answers the places an injected geocoder finds, without the network", async () => {
    const asked: string[] = [];
    const { server } = await launch({
      fetch: async (input) => {
        asked.push(String(input));
        return new Response(
          JSON.stringify({
            results: [
              {
                name: "Berlin",
                admin1: "Berlin",
                country_code: "DE",
                latitude: 52.52,
                longitude: 13.41,
              },
              {
                name: "Berlin",
                admin1: "",
                country_code: "US",
                latitude: 44.47,
                longitude: -71.18,
              },
            ],
          }),
        );
      },
    });

    const found = await request(server, "GET", "/api/weather/places?q=Berlin");
    expect(found.status).toBe(200);
    expect((found.json() as { places: unknown }).places).toEqual([
      { label: "Berlin, Berlin, DE", latitude: 52.52, longitude: 13.41 },
      // An empty part is skipped rather than printed as a gap in the label.
      { label: "Berlin, US", latitude: 44.47, longitude: -71.18 },
    ]);

    const endpoint = new URL(asked[0] ?? "");
    expect(endpoint.origin).toBe("https://geocoding-api.open-meteo.com");
    expect(endpoint.pathname).toBe("/v1/search");
    expect(endpoint.searchParams.get("name")).toBe("Berlin");
    expect(endpoint.searchParams.get("count")).toBe("5");
    expect(endpoint.searchParams.get("language")).toBe("en");
    expect(endpoint.searchParams.get("format")).toBe("json");

    // The search is a this-PC action, like the settings read above it.
    expect(
      (
        await request(
          server,
          "GET",
          "/api/weather/places?q=Berlin",
          undefined,
          {
            remoteAddress: "192.168.1.50",
          },
        )
      ).status,
    ).toBe(403);
  });

  it("refuses an empty search without reaching the geocoder", async () => {
    let called = false;
    const { server } = await launch({
      fetch: async () => {
        called = true;
        return new Response("{}");
      },
    });

    for (const query of ["", "?q=", "?q=%20%20"]) {
      const refused = await request(
        server,
        "GET",
        `/api/weather/places${query}`,
      );
      expect(refused.status, query).toBe(400);
    }
    expect(called).toBe(false);
  });

  it("answers 502 when the geocoder fails or overruns the body cap", async () => {
    for (const fetchImpl of [
      (async (): Promise<Response> => {
        throw new Error("connect ECONNREFUSED 127.0.0.1");
      }) as typeof fetch,
      (async (): Promise<Response> =>
        new Response(new Uint8Array(64 * 1024 + 1))) as typeof fetch,
      (async (): Promise<Response> =>
        new Response("{}", { status: 500 })) as typeof fetch,
    ]) {
      const { server } = await launch({ fetch: fetchImpl });
      const failed = await request(
        server,
        "GET",
        "/api/weather/places?q=Berlin",
      );
      expect(failed.status).toBe(502);
      // Its own sentence, so nothing undici or Open-Meteo wrote reaches a
      // browser — geocoding needs no key, but it does not echo its transport.
      expect(failed.text()).not.toContain("ECONNREFUSED");
    }
  });

  it("redacts a read error's path from the network-visible health answer", async () => {
    const weather = createWeatherSettingsStore(settingsDir);
    const leaking = {
      ...weather,
      problem: () =>
        "EACCES: permission denied, open 'C:\\Users\\peter\\secret\\weather.json'",
    };
    const running = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: settingsDir, editor: settingsDir },
      weather: leaking,
    });
    hosted = running;

    const answer = await request(running.server, "GET", "/api/health");
    const reason = String(
      (answer.json() as { readonly weather?: unknown }).weather,
    );

    // `/api/health` has no pairing guard, so an OS error's own path — the
    // person's home directory — must not travel over the network.
    expect(reason).not.toContain("peter");
    expect(reason).not.toContain(String.raw`C:\Users`);
    expect(reason).toContain("its configured address");
  });

  it("refuses a geocoder body over the cap, however it arrives", async () => {
    const { server } = await launch({
      // No `content-length`, three chunks: the cap has to be counted while
      // reading, and a cap checked only from the declared length sees nothing.
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (let chunk = 0; chunk < 3; chunk += 1) {
                controller.enqueue(new Uint8Array(32 * 1024).fill(0x20));
              }
              controller.close();
            },
          }),
        ),
    });

    const failed = await request(server, "GET", "/api/weather/places?q=Berlin");

    expect(failed.status).toBe(502);
    // The specific sentence: an implementation that read the whole body and
    // rejected its JSON would answer "something unexpected" instead.
    expect(failed.text()).toMatch(/more than it should/);
  });

  it("refuses a long search term and a foreign page before the geocoder", async () => {
    let called = false;
    const { server } = await launch({
      fetch: async () => {
        called = true;
        return new Response("{}");
      },
    });

    const long = await request(
      server,
      "GET",
      `/api/weather/places?q=${"a".repeat(201)}`,
    );
    expect(long.status).toBe(400);
    expect(long.text()).toMatch(/200 characters/);

    // A foreign page must not spend this PC's outbound request.
    const foreign = await request(
      server,
      "GET",
      "/api/weather/places?q=Berlin",
      undefined,
      { headers: { origin: "https://evil.example" } },
    );
    expect(foreign.status).toBe(403);
    expect(called).toBe(false);
  });

  it("answers 413, not 400, for a body over the limit", async () => {
    const { server } = await launch();

    const refused = await request(
      server,
      "PUT",
      "/api/weather/settings",
      JSON.stringify({ label: "a".repeat(64 * 1024) }),
    );

    expect(refused.status).toBe(413);
    expect(refused.text()).toMatch(/too large/);
  });

  it("redacts a failing geocoder body's own words", async () => {
    const { server } = await launch({
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(
                new Error(
                  "EACCES: permission denied, open 'C:\\Users\\peter\\secret\\weather.json'",
                ),
              );
            },
          }),
        ),
    });

    const failed = await request(server, "GET", "/api/weather/places?q=Berlin");

    expect(failed.status).toBe(502);
    expect(failed.text()).not.toContain("peter");
    expect(failed.text()).not.toContain("C:\\\\");
  });

  it("reports an invalid weather.json through /api/health and clears it", async () => {
    const { server } = await launch();
    await fs.writeFile(
      path.join(settingsDir, "weather.json"),
      JSON.stringify({ ...BERLIN, latitude: 91 }),
      "utf8",
    );

    const unhealthy = await request(server, "GET", "/api/health");
    expect((unhealthy.json() as { weather?: unknown }).weather).toMatch(
      /latitude/,
    );

    await request(
      server,
      "PUT",
      "/api/weather/settings",
      JSON.stringify(BERLIN),
    );
    const healthy = await request(server, "GET", "/api/health");
    expect(
      "weather" in (healthy.json() as Record<string, unknown>),
      "a valid file still reports a problem",
    ).toBe(false);
  });

  it("serves a vendored weather icon and 404s every other name", async () => {
    const { server } = await launch();

    const icon = await request(
      server,
      "GET",
      "/api/weather/icon/clear-day.svg",
    );
    expect(icon.status).toBe(200);
    expect(icon.headers["content-type"]).toBe("image/svg+xml");
    expect(icon.headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(icon.headers["x-content-type-options"]).toBe("nosniff");
    expect(icon.body.toString()).toContain("<svg");

    for (const name of [
      "nope.svg",
      "clear-day",
      "CLEAR-DAY.svg",
      "..%2Fpackage.json.svg",
      "clear-day.svg.svg",
      "clear-day.svg/extra",
    ]) {
      expect(
        (await request(server, "GET", `/api/weather/icon/${name}`)).status,
        name,
      ).toBe(404);
    }

    expect(
      (await request(server, "POST", "/api/weather/icon/clear-day.svg")).status,
    ).toBe(405);
  });

  it("lets a paired display read an icon and refuses an unpaired remote", async () => {
    const displays = createDisplayStore(settingsDir);
    const token = newToken();
    await displays.create("phone", token);

    const running = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: settingsDir, editor: settingsDir },
      weather: createWeatherSettingsStore(settingsDir),
      displays,
    });
    hosted = running;

    const lan = { remoteAddress: "192.168.1.50" };
    expect(
      (
        await request(
          running.server,
          "GET",
          "/api/weather/icon/clear-day.svg",
          undefined,
          lan,
        )
      ).status,
    ).toBe(403);

    expect(
      (
        await request(
          running.server,
          "GET",
          "/api/weather/icon/clear-day.svg",
          undefined,
          { ...lan, headers: { "x-yunari-session": "not-a-live-token" } },
        )
      ).status,
    ).toBe(403);

    expect(
      (
        await request(
          running.server,
          "GET",
          "/api/weather/icon/clear-day.svg",
          undefined,
          { ...lan, headers: { "x-yunari-session": token } },
        )
      ).status,
    ).toBe(200);
  });
});

describe("The media artwork route", () => {
  const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9, 9, 9]);
  const SHA = createHash("sha256").update(BYTES).digest("hex");
  const NAME = `${SHA}.png`;

  let directory: string;
  let hosted: ReturnType<typeof createHostServer> | undefined;

  beforeEach(async () => {
    directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "yunari-artwork-route-"),
    );
  });

  afterEach(async () => {
    await hosted?.close();
    hosted = undefined;
    await fs.rm(directory, { recursive: true, force: true });
  });

  function launch(options: Partial<HostServerOptions> = {}) {
    const running = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: directory, editor: directory },
      ...options,
    });
    hosted = running;
    return running;
  }

  async function storedCache() {
    const cache = createArtworkCache(directory);
    await cache.put(BYTES, "png");
    return cache;
  }

  it("serves a cached image with an immutable header", async () => {
    const running = launch({ artwork: await storedCache() });

    const answer = await request(
      running.server,
      "GET",
      `/api/media/artwork/${NAME}`,
    );

    expect(answer.status).toBe(200);
    expect(answer.headers["content-type"]).toBe("image/png");
    expect(answer.headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(answer.headers["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.compare(answer.body, Buffer.from(BYTES))).toBe(0);
  });

  it("404s a malformed name, an unknown digest and every non-GET", async () => {
    const running = launch({ artwork: await storedCache() });

    for (const name of [
      "a.png",
      NAME.toUpperCase(),
      `${NAME}.png`,
      `${SHA}.gif`,
      `${SHA}.png/extra`,
      "..%2Fpackage.json.png",
      `${"b".repeat(64)}.png`,
    ]) {
      expect(
        (await request(running.server, "GET", `/api/media/artwork/${name}`))
          .status,
        name,
      ).toBe(404);
    }

    expect(
      (await request(running.server, "POST", `/api/media/artwork/${NAME}`, "x"))
        .status,
    ).toBe(405);
  });

  it("refuses a malformed name before the cache is asked", async () => {
    // The cache also refuses these, so this case uses one that answers any
    // name: the refusal has to be the route's own, before any read.
    let reads = 0;
    const running = launch({
      artwork: {
        put: async () => "",
        read: async () => {
          reads += 1;
          return { bytes: BYTES, ext: "png" };
        },
      },
    });

    for (const name of ["a.png", NAME.toUpperCase(), `${NAME}/extra`]) {
      expect(
        (await request(running.server, "GET", `/api/media/artwork/${name}`))
          .status,
        name,
      ).toBe(404);
    }

    expect(reads).toBe(0);
  });

  it("lets a paired display read it and refuses an unpaired remote", async () => {
    const displays = createDisplayStore(directory);
    const token = newToken();
    await displays.create("phone", token);
    const running = launch({ displays, artwork: await storedCache() });

    const lan = { remoteAddress: "192.168.1.50" };
    const url = `/api/media/artwork/${NAME}`;

    // Loopback is this PC and needs no credential.
    expect((await request(running.server, "GET", url)).status).toBe(200);

    expect(
      (await request(running.server, "GET", url, undefined, lan)).status,
    ).toBe(403);

    expect(
      (
        await request(running.server, "GET", url, undefined, {
          ...lan,
          headers: { "x-yunari-session": "not-a-live-token" },
        })
      ).status,
    ).toBe(403);

    expect(
      (
        await request(running.server, "GET", url, undefined, {
          ...lan,
          headers: { "x-yunari-session": token },
        })
      ).status,
    ).toBe(200);
  });
});

describe("The game box art route", () => {
  const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const REMOTE_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xdb]);
  const PNG_BYTES = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01,
  ]);

  let directory: string;
  let cache: string;
  let hosted: ReturnType<typeof createHostServer> | undefined;

  beforeEach(async () => {
    directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "yunari-game-art-route-"),
    );
    cache = path.join(directory, "game-metadata");
    await fs.mkdir(cache, { recursive: true });
  });

  afterEach(async () => {
    await hosted?.close();
    hosted = undefined;
    await fs.rm(directory, { recursive: true, force: true });
  });

  function launch(options: Partial<HostServerOptions> = {}) {
    const running = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: directory, editor: directory },
      ...options,
    });
    hosted = running;
    return running;
  }

  function source(ids: readonly string[]) {
    return {
      read: async (appId: string) => (ids.includes(appId) ? BYTES : undefined),
    };
  }

  it("serves box art with a bounded, non-immutable cache header", async () => {
    const running = launch({ gameArtwork: source(["10"]) });

    const answer = await request(
      running.server,
      "GET",
      "/api/game/artwork/10.jpg",
    );

    expect(answer.status).toBe(200);
    expect(answer.headers["content-type"]).toBe("image/jpeg");
    expect(answer.headers["cache-control"]).toBe("private, max-age=3600");
    expect(answer.headers["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.compare(answer.body, Buffer.from(BYTES))).toBe(0);
  });

  it("404s a malformed name before the source is asked", async () => {
    let reads = 0;
    const running = launch({
      gameArtwork: {
        read: async () => {
          reads += 1;
          return BYTES;
        },
      },
    });

    for (const name of [
      "10",
      "10.gif",
      "10.jpg.png",
      "10.jpg/extra",
      "abc.jpg",
      "12345678901.jpg",
      "10.JPG",
      "..%2F10.jpg",
    ]) {
      expect(
        (await request(running.server, "GET", `/api/game/artwork/${name}`))
          .status,
        name,
      ).toBe(404);
    }

    expect(reads).toBe(0);
  });

  it("404s an app id the host does not know", async () => {
    const running = launch({ gameArtwork: source(["10"]) });

    expect(
      (await request(running.server, "GET", "/api/game/artwork/999.jpg"))
        .status,
    ).toBe(404);
  });

  it("serves a non-installed app's cached remote JPEG cover", async () => {
    await fs.writeFile(path.join(cache, "1201270.jpg"), BYTES);
    const running = launch({ gameCoverCacheDir: cache });

    const answer = await request(
      running.server,
      "GET",
      "/api/game/artwork/1201270.jpg",
    );

    expect(answer.status).toBe(200);
    expect(answer.headers["content-type"]).toBe("image/jpeg");
    expect(Number(answer.headers["content-length"])).toBe(BYTES.byteLength);
    expect(answer.headers["cache-control"]).toBe("private, max-age=3600");
    expect(answer.headers["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.compare(answer.body, Buffer.from(BYTES))).toBe(0);
  });

  it("serves a cached remote PNG cover as image/png", async () => {
    await fs.writeFile(path.join(cache, "1201270.png"), PNG_BYTES);
    const running = launch({ gameCoverCacheDir: cache });

    const answer = await request(
      running.server,
      "GET",
      "/api/game/artwork/1201270.png",
    );

    expect(answer.status).toBe(200);
    expect(answer.headers["content-type"]).toBe("image/png");
    expect(Number(answer.headers["content-length"])).toBe(PNG_BYTES.byteLength);
    expect(answer.headers["cache-control"]).toBe("private, max-age=3600");
    expect(answer.headers["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.compare(answer.body, Buffer.from(PNG_BYTES))).toBe(0);
  });

  it("serves installed local art ahead of a cached remote cover", async () => {
    await fs.writeFile(path.join(cache, "10.jpg"), REMOTE_BYTES);
    const running = launch({
      gameArtwork: source(["10"]),
      gameCoverCacheDir: cache,
    });

    const answer = await request(
      running.server,
      "GET",
      "/api/game/artwork/10.jpg",
    );

    expect(answer.status).toBe(200);
    expect(Buffer.compare(answer.body, Buffer.from(BYTES))).toBe(0);
  });

  it("404s when neither installed art nor a cached cover exists", async () => {
    const running = launch({ gameCoverCacheDir: cache });

    expect(
      (await request(running.server, "GET", "/api/game/artwork/999.jpg"))
        .status,
    ).toBe(404);
    expect(
      (await request(running.server, "GET", "/api/game/artwork/999.png"))
        .status,
    ).toBe(404);
  });

  it("404s a cached cover when the cache directory is missing", async () => {
    const running = launch({
      gameCoverCacheDir: path.join(directory, "absent"),
    });

    for (const extension of ["jpg", "png"]) {
      expect(
        (
          await request(
            running.server,
            "GET",
            `/api/game/artwork/1201270.${extension}`,
          )
        ).status,
        extension,
      ).toBe(404);
    }
  });

  it("404s a cached cover whose bytes do not match its extension", async () => {
    await fs.writeFile(path.join(cache, "1201270.jpg"), PNG_BYTES);
    const running = launch({ gameCoverCacheDir: cache });

    expect(
      (await request(running.server, "GET", "/api/game/artwork/1201270.jpg"))
        .status,
    ).toBe(404);
  });

  it("404s a cached cover that links outside the cache directory", async () => {
    const outside = path.join(directory, "outside.jpg");
    await fs.writeFile(outside, BYTES);
    await fs.symlink(outside, path.join(cache, "1201270.jpg"), "file");
    const running = launch({ gameCoverCacheDir: cache });

    expect(
      (await request(running.server, "GET", "/api/game/artwork/1201270.jpg"))
        .status,
    ).toBe(404);
  });

  it("404s an oversized cached cover", async () => {
    await fs.writeFile(
      path.join(cache, "1201270.jpg"),
      new Uint8Array(MAX_BOX_ART_BYTES + 1),
    );
    const running = launch({ gameCoverCacheDir: cache });

    expect(
      (await request(running.server, "GET", "/api/game/artwork/1201270.jpg"))
        .status,
    ).toBe(404);
  });

  it("lets a paired display read it and refuses an unpaired remote", async () => {
    const displays = createDisplayStore(directory);
    const token = newToken();
    await displays.create("phone", token);
    const running = launch({ displays, gameArtwork: source(["10"]) });

    const lan = { remoteAddress: "192.168.1.50" };
    const url = "/api/game/artwork/10.jpg";

    expect((await request(running.server, "GET", url)).status).toBe(200);

    expect(
      (await request(running.server, "GET", url, undefined, lan)).status,
    ).toBe(403);

    expect(
      (
        await request(running.server, "GET", url, undefined, {
          ...lan,
          headers: { "x-yunari-session": token },
        })
      ).status,
    ).toBe(200);
  });

  it("guards a cached cover exactly like installed art", async () => {
    await fs.writeFile(path.join(cache, "1201270.jpg"), BYTES);
    const displays = createDisplayStore(directory);
    const token = newToken();
    await displays.create("phone", token);
    const running = launch({ displays, gameCoverCacheDir: cache });

    const lan = { remoteAddress: "192.168.1.50" };
    const url = "/api/game/artwork/1201270.jpg";

    expect(
      (await request(running.server, "GET", url, undefined, lan)).status,
    ).toBe(403);

    expect(
      (
        await request(running.server, "GET", url, undefined, {
          ...lan,
          headers: { "x-yunari-session": token },
        })
      ).status,
    ).toBe(200);
  });

  it("405s every non-GET", async () => {
    const running = launch({ gameArtwork: source(["10"]) });

    for (const method of ["POST", "PUT", "DELETE"]) {
      expect(
        (await request(running.server, method, "/api/game/artwork/10.jpg", "x"))
          .status,
        method,
      ).toBe(405);
    }
  });
});

describe("Custom source routes", () => {
  let tmpDir: string;
  let credentials: ReturnType<typeof createCredentialStore>;
  let sources: SourceStore;
  let hosted: ReturnType<typeof createHostServer>;

  const LAN = { remoteAddress: "192.168.1.50" };
  const FOREIGN = {
    headers: { origin: "https://evil.example", host: "127.0.0.1:5173" },
  };

  const sourceFile = () => path.join(tmpDir, "sources.json");

  function fixtureSource(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      id: "fixture",
      name: "Fixture",
      // A loopback IP literal: the fetch client refuses nothing, and the
      // stubbed fetcher answers without a DNS lookup.
      url: "http://127.0.0.1:8787/read",
      intervalMs: 60_000,
      timeoutMs: 5_000,
      fields: [
        {
          id: "load",
          label: "CPU load",
          pointer: "/cpu/load",
          type: "number",
        },
      ],
      ...overrides,
    };
  }

  function jsonFetch(
    body: unknown,
    status = 200,
    calls: URL[] = [],
  ): typeof fetch {
    return (async (input: string | URL | Request) => {
      calls.push(new URL(String(input)));
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
  }

  async function start(
    options: {
      readonly fetch?: typeof fetch;
      readonly provider?: SourceRouteOptions["provider"];
    } = {},
  ): Promise<void> {
    credentials = createCredentialStore(tmpDir);
    sources = createSourceStore(tmpDir);

    const provider = new CustomSourceProvider({
      sources,
      credentials,
      ...(options.fetch === undefined ? {} : { fetcher: options.fetch }),
    });
    await provider.reload();

    hosted = createHostServer({
      registry: new ProviderRegistry([]),
      bundles: { player: tmpDir, editor: tmpDir },
      credentials,
      sources: { store: sources, provider: options.provider ?? provider },
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
  }

  const rows = async () =>
    (await request(hosted.server, "GET", "/api/credentials")).json() as {
      id: string;
      label: string;
      set: boolean;
      hint: string;
    }[];

  const list = async () =>
    (await request(hosted.server, "GET", "/api/sources")).json() as {
      sources: Record<string, unknown>[];
      issues: { sourceId: string; reason: string }[];
    };

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-sources-"));
  });

  afterEach(async () => {
    await hosted.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("keeps every source route on this PC and refuses another page", async () => {
    await start({ fetch: jsonFetch({ cpu: { load: 1 } }) });

    for (const [method, url] of [
      ["GET", "/api/sources"],
      ["PUT", "/api/sources/fixture"],
      ["DELETE", "/api/sources/fixture"],
      ["POST", "/api/sources/fixture/test"],
    ] as const) {
      const body = method === "PUT" ? json(fixtureSource()) : undefined;
      expect(
        (await request(hosted.server, method, url, body, LAN)).status,
      ).toBe(403);
      expect(
        (await request(hosted.server, method, url, body, FOREIGN)).status,
      ).toBe(403);
    }

    // Refused, so nothing was written: no file, not even an empty envelope.
    await expect(fs.readFile(sourceFile(), "utf8")).rejects.toThrow();
  });

  it("refuses an id the store's pattern does not admit, before any lookup", async () => {
    await start({ fetch: jsonFetch({}) });

    expect(
      (
        await request(
          hosted.server,
          "PUT",
          "/api/sources/Bad",
          json(fixtureSource()),
        )
      ).status,
    ).toBe(400);
    expect(
      (await request(hosted.server, "DELETE", "/api/sources/Bad")).status,
    ).toBe(400);
    expect(
      (await request(hosted.server, "POST", "/api/sources/Bad/test")).status,
    ).toBe(400);
    expect(
      (await request(hosted.server, "DELETE", `/api/sources/${"a".repeat(33)}`))
        .status,
    ).toBe(400);
  });

  it("upserts a source and lists it with field count and health, never a credential value", async () => {
    await start({ fetch: jsonFetch({}) });

    const put = await request(
      hosted.server,
      "PUT",
      "/api/sources/fixture",
      json(fixtureSource({ auth: { kind: "bearer", credentialId: "srckey" } })),
    );
    expect(put.status).toBe(200);

    // The write refreshed the table: the referenced id is writable now.
    const credential = await request(
      hosted.server,
      "PUT",
      "/api/credentials/srckey",
      json({ value: "sk-live-9f2c" }),
    );
    expect(credential.status).toBe(200);

    const res = await request(hosted.server, "GET", "/api/sources");
    expect(res.status).toBe(200);
    expect(res.json()).toEqual({
      sources: [
        expect.objectContaining({
          id: "fixture",
          name: "Fixture",
          fieldCount: 1,
          health: "waiting",
          lastError: null,
          lastSuccessAt: null,
          auth: { kind: "bearer", credentialId: "srckey" },
        }),
      ],
      issues: [],
    });
    // The reference is all the route carries: no value and no hint.
    expect(res.text()).not.toContain("sk-live-9f2c");
    expect(res.text()).not.toContain("9f2c");
  });

  it("refuses an invalid upsert and leaves the file byte-identical", async () => {
    await start({ fetch: jsonFetch({}) });
    await request(
      hosted.server,
      "PUT",
      "/api/sources/fixture",
      json(fixtureSource()),
    );

    const before = await fs.readFile(sourceFile());
    const refused = await request(
      hosted.server,
      "PUT",
      "/api/sources/fixture",
      json(
        fixtureSource({
          fields: [
            {
              id: "load",
              label: "CPU load",
              pointer: "/cpu/load",
              type: "date",
            },
          ],
        }),
      ),
    );

    expect(refused.status).toBe(400);
    expect(refused.json()).toMatchObject({ ok: false, field: "fixture" });
    expect((refused.json() as { reason: string }).reason).toContain(
      "type must be number|text|boolean",
    );
    expect((await fs.readFile(sourceFile())).equals(before)).toBe(true);
  });

  it("reports the provider's last error redacted and its last success time", async () => {
    const stub: SourceRouteOptions["provider"] = {
      reload: async () => undefined,
      status: () => [
        {
          sourceId: "fixture",
          lastError: "could not reach https://192.168.1.9:8080/read",
          lastSuccessMs: 1_700_000_000_000,
        },
      ],
      test: async () => ({ ok: false, elapsedMs: 0, values: [] }),
    };

    await start({ provider: stub, fetch: jsonFetch({}) });
    await sources.write({ sources: [fixtureSource()] });

    const [row] = (await list()).sources;

    expect(row).toMatchObject({
      id: "fixture",
      fieldCount: 1,
      health: "error",
      lastError: "could not reach its configured address",
      lastSuccessAt: new Date(1_700_000_000_000).toISOString(),
    });
    expect(JSON.stringify(row)).not.toContain("192.168.1.9");
  });

  it("tests one fetch with the real credential, bounded, and writes nothing", async () => {
    const calls: URL[] = [];
    await start({
      fetch: jsonFetch(
        {
          cpu: { load: 42.5 },
          v0: 0,
          v1: 1,
          v2: 2,
          v3: 3,
          v4: 4,
          v5: 5,
          v6: 6,
          v7: 7,
          v8: 8,
          v9: 9,
        },
        200,
        calls,
      ),
    });

    const fields = [
      { id: "load", label: "CPU load", pointer: "/cpu/load", type: "number" },
      ...Array.from({ length: 9 }, (_, index) => ({
        id: `v${index}`,
        label: `Value ${index}`,
        pointer: `/v${index}`,
        type: "number",
      })),
      { id: "extra", label: "Extra", pointer: "/v0", type: "number" },
    ];

    await request(
      hosted.server,
      "PUT",
      "/api/sources/fixture",
      json(
        fixtureSource({
          auth: { kind: "bearer", credentialId: "srckey" },
          fields,
        }),
      ),
    );
    await request(
      hosted.server,
      "PUT",
      "/api/credentials/srckey",
      json({ value: "sk-live-9f2c" }),
    );

    const before = await fs.readFile(sourceFile());
    const beforeStat = await fs.stat(sourceFile());
    const beforeDir = (await fs.readdir(tmpDir)).sort();

    const res = await request(
      hosted.server,
      "POST",
      "/api/sources/fixture/test",
    );

    expect(res.status).toBe(200);
    const tested = res.json() as {
      ok: boolean;
      elapsedMs: number;
      values: { id: string; value: unknown }[];
    };
    expect(tested.ok).toBe(true);
    expect(typeof tested.elapsedMs).toBe("number");
    expect(tested.values[0]).toEqual({ id: "load", value: 42.5 });
    // Bounded: eleven mapped fields, ten answered.
    expect(tested.values).toHaveLength(10);
    expect(calls).toHaveLength(1);
    expect(String(calls[0])).toBe("http://127.0.0.1:8787/read");

    // A test stores neither the fetched body nor a reading: file bytes, the
    // file's mtime and the directory's contents are unchanged, and the list
    // still says no fetch has succeeded.
    expect((await fs.readFile(sourceFile())).equals(before)).toBe(true);
    expect((await fs.stat(sourceFile())).mtimeMs).toBe(beforeStat.mtimeMs);
    expect((await fs.readdir(tmpDir)).sort()).toEqual(beforeDir);
    expect((await list()).sources[0]).toMatchObject({
      lastSuccessAt: null,
      health: "waiting",
    });
  });

  it("redacts a test result's reason before it leaves the host", async () => {
    const stub: SourceRouteOptions["provider"] = {
      reload: async () => undefined,
      status: () => [],
      test: async () => ({
        ok: false,
        elapsedMs: 1,
        values: [],
        reason: "could not reach https://192.168.1.9:8080/read",
      }),
    };

    await start({ provider: stub, fetch: jsonFetch({}) });
    await sources.write({ sources: [fixtureSource()] });

    const res = await request(
      hosted.server,
      "POST",
      "/api/sources/fixture/test",
    );

    expect(res.status).toBe(200);
    expect(res.text()).toContain("its configured address");
    expect(res.text()).not.toContain("192.168.1.9");
  });

  it("answers a failed test with the status and a redacted reason", async () => {
    await start({
      fetch: jsonFetch({ error: "denied" }, 500),
    });
    await request(
      hosted.server,
      "PUT",
      "/api/sources/fixture",
      json(fixtureSource()),
    );

    const res = await request(
      hosted.server,
      "POST",
      "/api/sources/fixture/test",
    );

    expect(res.status).toBe(200);
    expect(res.json()).toEqual({
      ok: false,
      status: 500,
      elapsedMs: expect.any(Number),
      values: [],
      reason: "the source answered HTTP 500",
    });
  });

  it("names a missing credential and makes no request", async () => {
    const calls: URL[] = [];
    await start({ fetch: jsonFetch({}, 200, calls) });
    await request(
      hosted.server,
      "PUT",
      "/api/sources/fixture",
      json(
        fixtureSource({
          auth: { kind: "bearer", credentialId: "absentkey" },
        }),
      ),
    );

    const res = await request(
      hosted.server,
      "POST",
      "/api/sources/fixture/test",
    );

    expect(res.json()).toMatchObject({
      ok: false,
      values: [],
      reason: "credential is missing",
    });
    expect(calls).toHaveLength(0);
  });

  it("accepts a source-referenced credential id and still refuses an unknown one", async () => {
    await start({ fetch: jsonFetch({}) });
    await request(
      hosted.server,
      "PUT",
      "/api/sources/fixture",
      json(fixtureSource({ auth: { kind: "bearer", credentialId: "srckey" } })),
    );

    expect(
      (
        await request(
          hosted.server,
          "PUT",
          "/api/credentials/srckey",
          json({ value: "sk-live-9f2c" }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          hosted.server,
          "PUT",
          "/api/credentials/arbitrary",
          json({ value: "sk-live-9f2c" }),
        )
      ).status,
    ).toBe(400);
  });

  it("does not admit the credential id of a source the store refused", async () => {
    await start({ fetch: jsonFetch({}) });

    // Written by hand, as a malformed file would be: one valid source and one
    // the store rejects. Only the valid one's credential is admitted.
    await fs.writeFile(
      sourceFile(),
      JSON.stringify({
        sources: [
          fixtureSource({
            id: "valid",
            auth: { kind: "bearer", credentialId: "goodkey" },
          }),
          fixtureSource({
            id: "broken",
            auth: { kind: "bearer", credentialId: "evilkey" },
            fields: [
              {
                id: "load",
                label: "CPU load",
                pointer: "/cpu/load",
                type: "date",
              },
            ],
          }),
        ],
      }),
    );

    const listed = await rows();
    expect(listed.map((row) => row.id)).toContain("goodkey");
    expect(listed.map((row) => row.id)).not.toContain("evilkey");

    expect(
      (
        await request(
          hosted.server,
          "PUT",
          "/api/credentials/evilkey",
          json({ value: "sk-live-9f2c" }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          hosted.server,
          "PUT",
          "/api/credentials/goodkey",
          json({ value: "sk-live-9f2c" }),
        )
      ).status,
    ).toBe(200);

    const response = await list();
    expect(response.issues).toHaveLength(1);
    expect(response.issues[0]?.sourceId).toBe("broken");
  });

  it("deletes a source without deleting its credential, and says it is unreferenced", async () => {
    await start({ fetch: jsonFetch({}) });
    await request(
      hosted.server,
      "PUT",
      "/api/sources/fixture",
      json(fixtureSource({ auth: { kind: "bearer", credentialId: "srckey" } })),
    );
    await request(
      hosted.server,
      "PUT",
      "/api/credentials/srckey",
      json({ value: "sk-live-9f2c" }),
    );

    const removed = await request(
      hosted.server,
      "DELETE",
      "/api/sources/fixture",
    );

    expect(removed.status).toBe(200);
    expect(removed.json()).toEqual({
      ok: true,
      unreferencedCredential: "srckey",
    });

    // The secret is still on disk and still listed as an orphan, so it can be
    // cleared rather than stranded.
    expect(
      await fs.readFile(path.join(tmpDir, "credentials.json"), "utf8"),
    ).toContain("sk-live-9f2c");
    expect(await rows()).toContainEqual(
      expect.objectContaining({
        id: "srckey",
        label: "Unreferenced credential",
        set: true,
        hint: "9f2c",
      }),
    );

    expect(
      (await request(hosted.server, "DELETE", "/api/credentials/srckey"))
        .status,
    ).toBe(200);
    expect(
      await fs.readFile(path.join(tmpDir, "credentials.json"), "utf8"),
    ).not.toContain("srckey");
  });

  it("reports no unreferenced credential while a sibling still names it", async () => {
    await start({ fetch: jsonFetch({}) });
    await request(
      hosted.server,
      "PUT",
      "/api/sources/first",
      json(
        fixtureSource({
          id: "first",
          auth: { kind: "bearer", credentialId: "srckey" },
        }),
      ),
    );
    await request(
      hosted.server,
      "PUT",
      "/api/sources/second",
      json(
        fixtureSource({
          id: "second",
          auth: { kind: "bearer", credentialId: "srckey" },
        }),
      ),
    );

    const removed = await request(
      hosted.server,
      "DELETE",
      "/api/sources/first",
    );

    expect(removed.json()).toEqual({
      ok: true,
      unreferencedCredential: null,
    });
  });

  it("keeps an entry the store refused when another entry is written", async () => {
    await start({ fetch: jsonFetch({}) });
    await fs.writeFile(
      sourceFile(),
      JSON.stringify({
        sources: [
          fixtureSource(),
          fixtureSource({
            id: "broken",
            fields: [
              {
                id: "load",
                label: "CPU load",
                pointer: "/cpu/load",
                type: "date",
              },
            ],
          }),
        ],
      }),
    );

    const put = await request(
      hosted.server,
      "PUT",
      "/api/sources/fixture",
      json(fixtureSource({ name: "Renamed" })),
    );

    expect(put.status).toBe(200);
    const raw = JSON.parse(await fs.readFile(sourceFile(), "utf8")) as {
      sources: { id: string }[];
    };
    // The write targeted one entry; the neighbour it cannot parse survives.
    expect(raw.sources.map((entry) => entry.id)).toEqual(["fixture", "broken"]);
    expect((await list()).issues[0]?.sourceId).toBe("broken");
  });

  it("refuses a write the whole-file merge would make invalid, writing nothing", async () => {
    await start({ fetch: jsonFetch({}) });
    // The candidate is valid on its own; only the 32-source limit, which is a
    // property of the merged file, refuses it.
    const full = Array.from({ length: 32 }, (_, index) =>
      fixtureSource({ id: `s${index}` }),
    );
    await fs.writeFile(sourceFile(), JSON.stringify({ sources: full }));
    const before = await fs.readFile(sourceFile());

    const put = await request(
      hosted.server,
      "PUT",
      "/api/sources/extra",
      json(fixtureSource({ id: "extra" })),
    );

    expect(put.status).toBe(400);
    expect(put.json()).toMatchObject({ ok: false, field: "extra" });
    expect((put.json() as { reason: string }).reason).toContain("exceeds");
    expect((await fs.readFile(sourceFile())).equals(before)).toBe(true);
  });

  it("lands two simultaneous writes to different ids", async () => {
    await start({ fetch: jsonFetch({}) });

    const [left, right] = await Promise.all([
      request(
        hosted.server,
        "PUT",
        "/api/sources/left",
        json(fixtureSource({ id: "left" })),
      ),
      request(
        hosted.server,
        "PUT",
        "/api/sources/right",
        json(fixtureSource({ id: "right" })),
      ),
    ]);

    expect([left.status, right.status]).toEqual([200, 200]);
    expect((await list()).sources.map((source) => source.id).sort()).toEqual([
      "left",
      "right",
    ]);
  });

  it("admits a valid source's credential when a duplicate id was refused", async () => {
    await start({ fetch: jsonFetch({}) });
    await fs.writeFile(
      sourceFile(),
      JSON.stringify({
        sources: [
          fixtureSource({
            id: "duplicate",
            auth: { kind: "bearer", credentialId: "dupkey" },
          }),
          fixtureSource({
            id: "duplicate",
            auth: { kind: "bearer", credentialId: "dupkey" },
            fields: [
              {
                id: "load",
                label: "CPU load",
                pointer: "/cpu/load",
                type: "date",
              },
            ],
          }),
        ],
      }),
    );

    expect((await rows()).map((row) => row.id)).toContain("dupkey");
    expect(
      (
        await request(
          hosted.server,
          "PUT",
          "/api/credentials/dupkey",
          json({ value: "sk-live-9f2c" }),
        )
      ).status,
    ).toBe(200);
  });

  it("answers an oversized write with 413, as the weather route does", async () => {
    await start({ fetch: jsonFetch({}) });
    const oversized = json(fixtureSource({ name: "x".repeat(70_000) }));

    const res = await request(
      hosted.server,
      "PUT",
      "/api/sources/fixture",
      oversized,
    );

    expect(res.status).toBe(413);
    // Refused before parsing, so nothing was written.
    await expect(fs.readFile(sourceFile(), "utf8")).rejects.toThrow();
  });

  it("does not answer a test whose source was reloaded away mid-fetch", async () => {
    let release: (value: Response) => void = () => undefined;
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    let called = false;
    const fetchStub = (async () => {
      called = true;
      return gate;
    }) as unknown as typeof fetch;

    await start({ fetch: fetchStub });
    await request(
      hosted.server,
      "PUT",
      "/api/sources/fixture",
      json(fixtureSource()),
    );

    const testing = request(hosted.server, "POST", "/api/sources/fixture/test");
    await vi.waitFor(() => expect(called).toBe(true));

    // A write reloads the provider, which retires the runtime the test is
    // still holding; its answer belongs to a source that has been replaced.
    await request(
      hosted.server,
      "PUT",
      "/api/sources/fixture",
      json(fixtureSource({ name: "Renamed" })),
    );

    release(
      new Response(JSON.stringify({ cpu: { load: 1 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    expect((await testing).status).toBe(404);
  });
});
