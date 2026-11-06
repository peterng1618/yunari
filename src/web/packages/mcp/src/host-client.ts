import type {
  ActiveThemeMap,
  AssetSearchAnswer,
  AssetSearchRequest,
  AssetSourceListing,
  HostClient,
  HostStatus,
  SaveResult,
  SaveThemeInput,
  SensorListing,
  ThemeContent,
  ThemeSummary,
  VideoTrim,
  WallpaperListing,
  WidgetPackSummary,
} from "./types.js";

/** The ports a host started without an explicit URL is probed on, in order. */
export const PROBE_PORTS: readonly number[] = Object.freeze(
  Array.from({ length: 10 }, (_unused, index) => 5227 + index),
);

/** The host's own sentence, or a safe stand-in when it sent none. */
async function refusalText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.trim();
  } catch {
    return "";
  }
}

/** A refusal body that is a JSON object, or `undefined` for prose/empty. */
function refusalJson(
  text: string,
): Readonly<Record<string, unknown>> | undefined {
  if (text === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Readonly<Record<string, unknown>>)
      : undefined;
  } catch {
    return undefined;
  }
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A host refusal whose body carried structured validator issues.
 *
 * A single sentence cannot be acted on: the host's issue objects carry the JSON
 * path and code a tool's caller needs. `errorResult` turns this class into a
 * structured failure block, while a plain-text refusal stays one sentence.
 */
export class HostRefusalError extends Error {
  constructor(
    readonly status: number,
    readonly issues: readonly unknown[],
    readonly body: Readonly<Record<string, unknown>>,
    message?: string,
  ) {
    super(
      message ?? `The Yunari host answered ${status} with validator issues.`,
    );
    this.name = "HostRefusalError";
  }
}

/**
 * A loopback HTTP client for the same routes the editor uses.
 *
 * The MCP server binds nothing: every call is a fetch to a host URL the user
 * named, and a refusal keeps the host's own words so a tool can relay them.
 * Credentials live in the host; this client never reads or logs one.
 */
export class HttpHostClient implements HostClient {
  readonly url: string;

  constructor(url: string) {
    this.url = url.replace(/\/+$/u, "");
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    let response: Response;

    try {
      response = await fetch(`${this.url}${path}`, init);
    } catch (error) {
      const probes = PROBE_PORTS.map((port) => `http://127.0.0.1:${port}`).join(
        ", ",
      );
      throw new Error(
        `Could not reach the Yunari host at ${this.url}: ${reasonOf(error)}. ` +
          `Probed ${probes}. Start the host, set YUNARI_URL, or pass --url <url>.`,
      );
    }

    if (!response.ok) {
      const text = await refusalText(response);
      const body = refusalJson(text);
      const issues = body?.["issues"];
      if (body !== undefined && Array.isArray(issues)) {
        throw new HostRefusalError(response.status, issues, body);
      }
      throw new Error(
        `The Yunari host answered ${response.status}${
          text === "" ? "" : `: ${text}`
        }`,
      );
    }

    return response;
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.request(path, init);
    try {
      return (await response.json()) as T;
    } catch (error) {
      throw new Error(
        `The Yunari host did not answer JSON for ${path}: ${reasonOf(error)}`,
      );
    }
  }

  async status(): Promise<HostStatus> {
    // A reachable host may keep no active theme or no asset sources; one
    // section failing must not report the whole host as down.
    const [themes, active, sensors, sources] = await Promise.allSettled([
      this.listThemes(),
      this.activeThemes(),
      this.sensors(false),
      this.listAssetSources(),
    ]);
    const unavailable: { section: string; reason: string }[] = [];
    const valueOf = <T>(
      result: PromiseSettledResult<T>,
      section: string,
    ): T | undefined => {
      if (result.status === "fulfilled") return result.value;
      unavailable.push({ section, reason: reasonOf(result.reason) });
      return undefined;
    };
    const themeList = valueOf(themes, "themes");
    const displays = valueOf(active, "displays");
    const sensorList = valueOf(sensors, "sensors");
    const sourceList = valueOf(sources, "asset sources");

    return {
      url: this.url,
      // Every section failing is not a partial answer: no route answered, so
      // the host is down however the individual errors read.
      reachable: unavailable.length < 4,
      themeCount: themeList === undefined ? null : themeList.length,
      displays: displays === undefined ? null : displays.displays.length,
      sensorCount: sensorList === undefined ? null : sensorList.sensors.length,
      assetSources:
        sourceList === undefined ? null : sourceList.map((source) => source.id),
      unavailable,
    };
  }

  async listThemes(): Promise<readonly ThemeSummary[]> {
    const body = await this.json<{
      readonly themes?: readonly (ThemeSummary & {
        readonly facets?: {
          readonly width?: number;
          readonly height?: number;
        };
      })[];
    }>("/api/themes");

    return (body.themes ?? []).map((theme) => {
      const width = theme.facets?.width;
      const height = theme.facets?.height;
      return {
        id: theme.id,
        name: theme.name,
        ...(theme.author === undefined ? {} : { author: theme.author }),
        ...(theme.updatedAt === undefined
          ? {}
          : { updatedAt: theme.updatedAt }),
        ...(theme.origin === undefined ? {} : { origin: theme.origin }),
        ...(theme.thumbnail === undefined
          ? {}
          : { thumbnail: theme.thumbnail }),
        ...(width === undefined || height === undefined
          ? {}
          : { artboard: { width, height } }),
        ...(theme.description === undefined
          ? {}
          : { description: theme.description }),
      };
    });
  }

  async getTheme(id: string): Promise<ThemeContent> {
    const body = await this.json<{
      readonly envelope: ThemeContent["envelope"];
      readonly assets?: Readonly<Record<string, string>>;
      readonly credits?: ThemeContent["credits"];
      readonly base?: string;
    }>(`/api/themes/${encodeURIComponent(id)}`);

    const assets: Record<string, Uint8Array> = {};
    for (const [path, encoded] of Object.entries(body.assets ?? {})) {
      assets[path] = new Uint8Array(Buffer.from(encoded, "base64"));
    }

    return {
      envelope: body.envelope,
      assets,
      ...(body.credits === undefined ? {} : { credits: body.credits }),
      ...(body.base === undefined ? {} : { base: body.base }),
    };
  }

  async saveTheme(id: string, input: SaveThemeInput): Promise<SaveResult> {
    const assets = Object.fromEntries(
      Object.entries(input.assets).map(([path, bytes]) => [
        path,
        Buffer.from(bytes).toString("base64"),
      ]),
    );

    return await this.json<SaveResult>(
      `/api/themes/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          envelope: input.envelope,
          assets,
          ...(input.credits === undefined ? {} : { credits: input.credits }),
          ...(input.base === undefined ? {} : { base: input.base }),
          ...(input.overwrite === undefined
            ? {}
            : { overwrite: input.overwrite }),
        }),
      },
    );
  }

  async captureThumbnail(
    id: string,
  ): Promise<{ readonly captured: boolean; readonly reason?: string }> {
    const body = await this.json<{
      readonly captured?: boolean;
      readonly reason?: string;
    }>(`/api/themes/${encodeURIComponent(id)}/thumbnail/capture`, {
      method: "POST",
    });

    return {
      captured: body.captured === true,
      ...(body.reason === undefined ? {} : { reason: body.reason }),
    };
  }

  async sensors(measured: boolean): Promise<SensorListing> {
    const body = await this.json<{
      readonly sensors?: readonly SensorListing["sensors"][number][];
      readonly measured?: readonly string[];
    }>(measured ? "/api/sensors?measured=1" : "/api/sensors");

    return {
      sensors: body.sensors ?? [],
      measured: body.measured ?? [],
    };
  }

  async activeThemes(): Promise<ActiveThemeMap> {
    return await this.json<ActiveThemeMap>("/api/themes/active");
  }

  async assignTheme(display: string, id: string): Promise<void> {
    await this.request("/api/themes/active", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ display, id }),
    });
  }

  async listAssetSources(): Promise<readonly AssetSourceListing[]> {
    const body = await this.json<{
      readonly sources?: readonly AssetSourceListing[];
    }>("/api/assets/sources");
    return body.sources ?? [];
  }

  async searchAssets(request: AssetSearchRequest): Promise<AssetSearchAnswer> {
    return await this.json<AssetSearchAnswer>("/api/assets/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
  }

  async assetBytes(
    source: string,
    id: string,
  ): Promise<{ readonly bytes: Uint8Array; readonly filename: string }> {
    const query = new URLSearchParams({ source, id });
    const response = await this.request(`/api/assets/bytes?${query}`);

    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      filename: response.headers.get("x-yunari-filename") ?? "",
    };
  }

  async listWallpapers(): Promise<WallpaperListing> {
    return await this.json<WallpaperListing>("/api/wallpaper-engine");
  }

  async wallpaperBytes(
    id: string,
    part: "preview" | "asset",
  ): Promise<{
    readonly bytes: Uint8Array;
    readonly filename: string;
    readonly contentType: string;
  }> {
    const response = await this.request(
      `/api/wallpaper-engine/item/${encodeURIComponent(id)}/${part}`,
    );
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      filename: response.headers.get("x-yunari-filename") ?? "",
      contentType: response.headers.get("content-type") ?? "",
    };
  }

  async normalizeVideo(
    bytes: Uint8Array,
    trim?: VideoTrim,
  ): Promise<Uint8Array> {
    const query = new URLSearchParams();
    if (trim !== undefined) {
      query.set("startMs", String(trim.startMs));
      query.set("endMs", String(trim.endMs));
    }
    const suffix = query.size === 0 ? "" : `?${query}`;

    const body = await this.json<{
      readonly ok?: boolean;
      readonly bytesBase64?: string;
      readonly message?: string;
    }>("/api/themes/normalize-video" + suffix, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: bytes as Uint8Array<ArrayBuffer>,
    });

    if (body.ok !== true || body.bytesBase64 === undefined) {
      throw new Error(body.message ?? "The host refused that video.");
    }

    return new Uint8Array(Buffer.from(body.bytesBase64, "base64"));
  }

  async panelPreview(
    id: string,
    display: string,
    clip: boolean,
  ): Promise<Uint8Array> {
    const query = new URLSearchParams({ display });
    if (clip) query.set("clip", "1");
    const response = await this.request(
      `/api/themes/${encodeURIComponent(id)}/panel-preview?${query}`,
    );
    return new Uint8Array(await response.arrayBuffer());
  }

  async listWidgetPacks(): Promise<readonly WidgetPackSummary[]> {
    const body = await this.json<{
      readonly packs?: readonly WidgetPackSummary[];
    }>("/api/widget-packs");
    return body.packs ?? [];
  }

  async readWidgetPack(id: string): Promise<Uint8Array> {
    const response = await this.request(
      `/api/widget-packs/${encodeURIComponent(id)}`,
    );
    return new Uint8Array(await response.arrayBuffer());
  }
}

/**
 * A client that finds the host on its first call instead of before serving.
 *
 * `serve` must start even when the host is down: an MCP client keeps the stdio
 * connection up, so a host started later has to be reachable without
 * restarting this process. A failed resolution is not cached — the next tool
 * call probes again — while a successful one is reused for the process's life.
 */
export class LazyHostClient implements HostClient {
  private resolved: HttpHostClient | undefined;
  private resolving: Promise<HttpHostClient> | undefined;

  constructor(private readonly resolveUrl: () => Promise<string>) {}

  get url(): string {
    if (this.resolved === undefined) {
      throw new Error(
        "The host URL is not resolved yet; this client resolves it on the first host call.",
      );
    }
    return this.resolved.url;
  }

  private async client(): Promise<HttpHostClient> {
    if (this.resolved !== undefined) return this.resolved;
    this.resolving ??= this.resolveUrl().then(
      (url) => {
        this.resolved = new HttpHostClient(url);
        this.resolving = undefined;
        return this.resolved;
      },
      (error: unknown) => {
        this.resolving = undefined;
        throw error;
      },
    );
    return await this.resolving;
  }

  async status(): Promise<HostStatus> {
    return await (await this.client()).status();
  }

  async listThemes(): Promise<readonly ThemeSummary[]> {
    return await (await this.client()).listThemes();
  }

  async getTheme(id: string): Promise<ThemeContent> {
    return await (await this.client()).getTheme(id);
  }

  async saveTheme(id: string, input: SaveThemeInput): Promise<SaveResult> {
    return await (await this.client()).saveTheme(id, input);
  }

  async captureThumbnail(
    id: string,
  ): Promise<{ readonly captured: boolean; readonly reason?: string }> {
    return await (await this.client()).captureThumbnail(id);
  }

  async sensors(measured: boolean): Promise<SensorListing> {
    return await (await this.client()).sensors(measured);
  }

  async activeThemes(): Promise<ActiveThemeMap> {
    return await (await this.client()).activeThemes();
  }

  async assignTheme(display: string, id: string): Promise<void> {
    await (await this.client()).assignTheme(display, id);
  }

  async listAssetSources(): Promise<readonly AssetSourceListing[]> {
    return await (await this.client()).listAssetSources();
  }

  async searchAssets(request: AssetSearchRequest): Promise<AssetSearchAnswer> {
    return await (await this.client()).searchAssets(request);
  }

  async assetBytes(
    source: string,
    id: string,
  ): Promise<{ readonly bytes: Uint8Array; readonly filename: string }> {
    return await (await this.client()).assetBytes(source, id);
  }

  async listWallpapers(): Promise<WallpaperListing> {
    return await (await this.client()).listWallpapers();
  }

  async wallpaperBytes(
    id: string,
    part: "preview" | "asset",
  ): Promise<{
    readonly bytes: Uint8Array;
    readonly filename: string;
    readonly contentType: string;
  }> {
    return await (await this.client()).wallpaperBytes(id, part);
  }

  async normalizeVideo(
    bytes: Uint8Array,
    trim?: VideoTrim,
  ): Promise<Uint8Array> {
    return await (await this.client()).normalizeVideo(bytes, trim);
  }

  async panelPreview(
    id: string,
    display: string,
    clip: boolean,
  ): Promise<Uint8Array> {
    return await (await this.client()).panelPreview(id, display, clip);
  }

  async listWidgetPacks(): Promise<readonly WidgetPackSummary[]> {
    return await (await this.client()).listWidgetPacks();
  }

  async readWidgetPack(id: string): Promise<Uint8Array> {
    return await (await this.client()).readWidgetPack(id);
  }
}
