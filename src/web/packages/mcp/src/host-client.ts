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
} from "./types.js";

/** The host's own sentence, or a safe stand-in when it sent none. */
async function refusalText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.trim();
  } catch {
    return "";
  }
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
      throw new Error(
        `Could not reach the Yunari host at ${this.url}: ${reasonOf(error)}`,
      );
    }

    if (!response.ok) {
      const text = await refusalText(response);
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
    const [themes, active, sensors, sources] = await Promise.all([
      this.listThemes(),
      this.activeThemes(),
      this.sensors(false),
      this.listAssetSources(),
    ]);

    return {
      url: this.url,
      reachable: true,
      themeCount: themes.length,
      displays: active.displays.length,
      sensorCount: sensors.sensors.length,
      assetSources: sources.map((source) => source.id),
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
        headers: { "content-type": "application/json" },
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
}
