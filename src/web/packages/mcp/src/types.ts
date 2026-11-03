import type {
  AssetSearchAnswer,
  AssetSearchRequest,
  AssetSourceListing,
  DisplayShape,
  FabricThemeEnvelope,
  ThemeMetadata,
} from "@yunari/renderer-core";
import type { ThemeCredits } from "@yunari/theme-package";

export type {
  AssetSearchAnswer,
  AssetSearchRequest,
  AssetSourceListing,
  FabricThemeEnvelope,
  ThemeCredits,
  ThemeMetadata,
};

/** The display kinds the host's active-theme map answers. */
export type DisplayKind = "paired" | "local" | "panel";

/** What a host-driven panel reports about its own device. */
export interface PanelState {
  readonly status: "connected" | "connecting" | "disconnected";
  readonly commands: readonly string[];
  /** The raster size the family declares, absent when no driver claims it. */
  readonly geometry?: { readonly width: number; readonly height: number };
}

/** One row of the host's display map. */
export interface DisplaySummary {
  readonly id: string;
  readonly label: string;
  readonly kind: DisplayKind;
  readonly theme: string | null;
  readonly shape: DisplayShape;
  readonly rotation: number;
  readonly panel?: PanelState;
}

/** `GET /api/themes/active` — which theme each display holds. */
export interface ActiveThemeMap {
  readonly default: string | null;
  readonly displays: readonly DisplaySummary[];
  readonly displayFileUnreadable?: boolean;
}

/** One row of `GET /api/themes`, reduced to what discovery needs. */
export interface ThemeSummary {
  readonly id: string;
  readonly name: string;
  readonly author?: string;
  readonly updatedAt?: string;
  readonly origin?: string;
  readonly thumbnail?: boolean;
  /** Derived from the listing's facets on the host side. */
  readonly artboard?: {
    readonly width: number;
    readonly height: number;
    readonly shape?: DisplayShape;
  };
  readonly description?: string;
}

/** One row of a sensor catalogue: what this PC can read, never a reading. */
export interface SensorInfo {
  readonly semanticKey: string;
  readonly label: string;
  readonly family?: string;
  readonly unit?: string;
  readonly unitKind?: string;
  readonly valueKind?: string;
  readonly displayUnits?: readonly string[];
  readonly mediaKind?: "image";
  readonly tier?: string;
  readonly providerId?: string;
}

/** `GET /api/sensors`, plus the keys this host answered with an `ok` reading. */
export interface SensorListing {
  readonly sensors: readonly SensorInfo[];
  readonly measured: readonly string[];
}

/** What `GET /api/themes/:id` answers, with the assets decoded. */
export interface ThemeContent {
  readonly envelope: FabricThemeEnvelope;
  readonly assets: Readonly<Record<string, Uint8Array>>;
  readonly credits?: ThemeCredits;
  readonly base?: string;
}

/** What a save sends: the same pair the editor posts, plus its base claim. */
export interface SaveThemeInput {
  readonly envelope: FabricThemeEnvelope;
  readonly assets: Readonly<Record<string, Uint8Array>>;
  readonly credits?: ThemeCredits;
  readonly base?: string;
  readonly overwrite?: boolean;
}

/** What a save answers: the new base, and the stored listing line. */
export interface SaveResult {
  readonly ok: boolean;
  readonly id: string;
  readonly base?: string;
  readonly name?: string;
  readonly updatedAt?: string;
}

/** A video trim in milliseconds, as the host's normalize route reads it. */
export interface VideoTrim {
  readonly startMs: number;
  readonly endMs: number;
}

/** What `yunari_status` reports about the host. */
export interface HostStatus {
  readonly url: string;
  /** False when no section answered, which is what an unreachable host looks
   *  like once every request has already failed. */
  readonly reachable: boolean;
  /** Null when the host answered, but this section could not be read. */
  readonly themeCount: number | null;
  readonly displays: number | null;
  readonly sensorCount: number | null;
  readonly assetSources: readonly string[] | null;
  readonly unavailable: readonly {
    readonly section: string;
    readonly reason: string;
  }[];
}

/** One row of the host's Wallpaper Engine library. */
export interface WallpaperItem {
  readonly workshopId: string;
  readonly title: string;
  /** Only `video` items are usable as a theme backdrop. */
  readonly kind: string;
  readonly previewUrl: string;
  readonly filesize: number;
  readonly attribution?: {
    readonly steamId?: string;
    readonly workshopUrl?: string;
  };
}

/** `GET /api/wallpaper-engine` — an unavailable library states its reason. */
export interface WallpaperListing {
  readonly available: boolean;
  readonly reason?: string;
  readonly items?: readonly WallpaperItem[];
}

/** Every loopback route the server needs, one method per route. */
export interface HostClient {
  readonly url: string;
  status(): Promise<HostStatus>;
  listThemes(): Promise<readonly ThemeSummary[]>;
  getTheme(id: string): Promise<ThemeContent>;
  saveTheme(id: string, input: SaveThemeInput): Promise<SaveResult>;
  /** Asks the host to photograph the theme for the library. `captured` is false
   *  when a picture already existed and the host left it alone. */
  captureThumbnail(
    id: string,
  ): Promise<{ readonly captured: boolean; readonly reason?: string }>;
  sensors(measured: boolean): Promise<SensorListing>;
  activeThemes(): Promise<ActiveThemeMap>;
  assignTheme(display: string, id: string): Promise<void>;
  listAssetSources(): Promise<readonly AssetSourceListing[]>;
  searchAssets(request: AssetSearchRequest): Promise<AssetSearchAnswer>;
  assetBytes(
    source: string,
    id: string,
  ): Promise<{ readonly bytes: Uint8Array; readonly filename: string }>;
  listWallpapers(): Promise<WallpaperListing>;
  wallpaperBytes(
    id: string,
    part: "preview" | "asset",
  ): Promise<{
    readonly bytes: Uint8Array;
    readonly filename: string;
    readonly contentType: string;
  }>;
  normalizeVideo(bytes: Uint8Array, trim?: VideoTrim): Promise<Uint8Array>;
  panelPreview(id: string, display: string, clip: boolean): Promise<Uint8Array>;
}

/** A theme being authored in this process. Never persisted by a draft call. */
export interface Draft {
  readonly id: string;
  envelope: FabricThemeEnvelope;
  assets: Record<string, Uint8Array>;
  credits?: ThemeCredits;
  /** The document version the last save was based on; absent before a save. */
  base?: string;
  readonly origin: "new" | "opened";
  /** True once this process has written the draft to the host's library. */
  saved?: boolean;
}

export interface CreateDraftInput {
  readonly id: string;
  readonly envelope: FabricThemeEnvelope;
  readonly assets?: Readonly<Record<string, Uint8Array>>;
  readonly credits?: ThemeCredits;
}

/** What `open_theme` copies out of the host before the host leaves the loop. */
export interface OpenedThemeContent {
  readonly envelope: FabricThemeEnvelope;
  readonly assets: Readonly<Record<string, Uint8Array>>;
  readonly credits?: ThemeCredits;
  readonly base?: string;
}

/** The in-memory draft map a tool context mutates. */
export interface DraftStore {
  create(input: CreateDraftInput): Draft;
  open(id: string, content: OpenedThemeContent): Draft;
  read(id: string): Draft;
  /** The only open draft; refuses when none or several are open. */
  current(): Draft;
  discard(id: string): boolean;
  setMetadata(id: string, metadata: ThemeMetadata): Draft;
  setAsset(id: string, path: string, bytes: Uint8Array): Draft;
  /** Drops bytes the draft no longer declares. */
  deleteAsset(id: string, path: string): Draft;
  setCredits(id: string, credits: ThemeCredits | undefined): Draft;
  /** Records the base a save produced, and that this draft is now stored. */
  markSaved(id: string, base?: string): Draft;
}

/** What every tool registration receives. */
export interface ToolContext {
  readonly host: HostClient;
  readonly drafts: DraftStore;
}
