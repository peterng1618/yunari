import type { AssetRouteOptions } from "../assets/routes.js";
import type { HostBinding } from "../cli/hosting.js";
import type { ListenableServer } from "../cli/net.js";
import type { ExtensionService } from "../extensions/service.js";
import type { PluginSettingsStore } from "../extensions/settings.js";
import type { WidgetPackStore } from "../packs/widget-packs.js";
import type { PanelHint } from "../panels/panel-device.js";
import type { PanelFamilyRegistry } from "../panels/panel-families.js";
import type { PanelManager } from "../panels/panel-manager.js";
import type { PathPresetStore } from "../presets/path-presets.js";
import type {
  CustomSourceStatus,
  SourceTestResult,
} from "../providers/custom/provider.js";
import type { GameArtworkSource } from "../providers/game/box-art.js";
import type { ArtworkCache } from "../providers/media/artwork.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { Launcher } from "../serve/display-launcher.js";
import type { PublishedStore } from "../serve/published.js";
import type { PairingCodeStore } from "../session/pairing-code.js";
import type { ActiveThemeStore } from "../settings/active-theme.js";
import type { CredentialStore } from "../settings/credentials.js";
import type { KnownCredential } from "../settings/credentials-registry.js";
import type { DeviceSettingsStore } from "../settings/devices.js";
import type {
  DisplaySettings,
  DisplaySettingsStore,
} from "../settings/display.js";
import type { DisplayRecord, DisplayStore } from "../settings/displays.js";
import type { FontFavoritesStore } from "../settings/font-favorites.js";
import type { HostRecord } from "../settings/host-record.js";
import type { Monitor } from "../settings/monitors.js";
import type { SourceStore } from "../settings/sources.js";
import type { StoreSessionStore } from "../settings/store-session.js";
import type { ThemeOriginsStore } from "../settings/theme-origins.js";
import type { ThemeSettingsStore } from "../settings/theme-settings.js";
import type { WeatherSettingsStore } from "../settings/weather.js";
import type { ThemeStore } from "../themes/store.js";
import type { ThemeMedia } from "../themes/theme-media.js";
import type { ThumbnailStore } from "../themes/thumbnails.js";
import type { RootPem } from "../tls/authority.js";
import type { WallpaperEngineSource } from "../wallpaper-engine/source.js";

export interface BundleRoots {
  readonly player: string;
  readonly editor: string;
  /** Admin pages served from source with no build step: the pairing page, the
   *  chooser document and the fallback rule the server imports. */
  readonly admin?: string;
  /** The built React admin entry (`vite.admin.config.ts` → `dist/admin`),
   *  served from `/admin/`. Optional so a test that never opens the chooser
   *  needs no build. */
  readonly adminUi?: string;
}

/**
 * Custom HTTP sources, as the settings routes see them.
 *
 * The store is the only writer of `sources.json`; the provider is the only
 * reader that fetches, so a write reloads it and a Test goes through it rather
 * than a second fetch path.
 */
export interface SourceRouteOptions {
  readonly store: SourceStore;
  readonly provider: {
    reload(): Promise<void>;
    status(): readonly CustomSourceStatus[];
    test(sourceId: string): Promise<SourceTestResult | undefined>;
  };
}

export interface HostServerOptions {
  readonly registry: ProviderRegistry;
  readonly bundles: BundleRoots;
  readonly themeStore?: ThemeStore;
  /** Chosen baseline cadence; not a measured performance budget. */
  readonly sampleIntervalMs?: number;
  readonly now?: () => number;
  /** The displays this host knows, and the credentials that prove one is itself.
   *  Omit to disable pairing entirely: a loopback-only server needs none, and a
   *  non-loopback display is then refused rather than trusted. */
  readonly displays?: DisplayStore;
  /** The one-time code a display with no camera types, and the window it is
   *  valid in. Supplied so the launcher can print a link carrying the same code
   *  the claim route accepts; a caller with no launcher gets a store of its
   *  own, which is what the unit suite wants. */
  readonly pairingCodes?: PairingCodeStore;
  /** Installed plugins and their grants. Omitted when this host manages none:
   *  the extension routes then say so rather than serving an empty list. */
  readonly extensions?: ExtensionService;
  /** Declarative plugin settings. Omitted when this host keeps none: the
   *  settings routes then say so rather than accepting a value nowhere keeps. */
  readonly pluginSettings?: PluginSettingsStore;
  /** Device assignments (§145). Omit to keep defaults with no configuration. */
  readonly devices?: DeviceSettingsStore;
  /** Per-theme answers. Omitted when the host stores none. */
  readonly themeSettings?: ThemeSettingsStore;
  /** Where each library theme came from. Omitted when the host records none,
   *  which is what a caller that only serves its own themes wants. */
  readonly themeOrigins?: ThemeOriginsStore;
  /** Theme thumbnails. Omitted when the host stores none. */
  readonly thumbnails?: ThumbnailStore;
  /** The theme video's derived panel media: a still frame and device-sized
   *  clips. Omitted when the host keeps no cache. */
  readonly themeMedia?: ThemeMedia;
  /** The fetcher the install route uses. Omitted uses the global; supplied so a
   *  route test can install without a network. */
  readonly fetch?: typeof fetch;
  /** The Worker's origin, as the store session routes reach it. Omitted falls
   *  back to `YUNARI_STORE_ORIGIN`; without either, those routes say the host
   *  has no store rather than inventing an address. */
  readonly storeOrigin?: string;
  /** The store session this host holds. Omitted when it keeps none. */
  readonly storeSession?: StoreSessionStore;
  /** Which theme this host displays. Omitted when the host keeps no choice. */
  readonly activeTheme?: ActiveThemeStore;
  /** The consumer's display preferences. Omit when the host stores none. */
  readonly display?: DisplaySettingsStore;
  /** The weather backend, place and cadence. Omitted when the host stores
   *  none — the routes then say so rather than serving an empty reading. */
  readonly weather?: WeatherSettingsStore;
  /** Which curated font trios this author favours. Omit when the host stores
   *  none — the route then reports that rather than serving an empty list. */
  readonly fontFavorites?: FontFavoritesStore;
  /** Provider credentials. Omit when the host stores none — the routes then
   *  say so rather than accepting a key that is dropped. */
  readonly credentials?: CredentialStore;
  /** The credential ids this host knows. Omitted uses the shipped table, which
   *  is empty in v1; supplied so a route test can hold a cookie fixture. */
  readonly knownCredentials?: readonly KnownCredential[];
  /** Custom HTTP sources. Omitted when this host serves none — the routes then
   *  say so rather than falling through to the static 404. */
  readonly sources?: SourceRouteOptions;
  /** The asset finder's sources. Omitted when this host serves none; the
   *  routes then say so rather than falling through to the static 404. */
  readonly assets?: AssetRouteOptions;
  /** The media provider's artwork files. Omitted when this host reads no
   *  media; the route then answers 404 rather than inventing a picture. */
  readonly artwork?: ArtworkCache;
  /** The running Steam game's local box art. Omitted when this host reads no
   *  Steam library; the route then answers 404 rather than inventing a picture. */
  readonly gameArtwork?: GameArtworkSource;
  /** Where the store provider caches covers it looked up for a non-Steam game.
   *  The route only reads it; the provider owns every download,
   *  so a request never starts a fetch. Omitted keeps the route local-art only. */
  readonly gameCoverCacheDir?: string;
  /** The Wallpaper Engine library on this PC. Omitted when this host serves
   *  none, and the listing then says it is not installed. */
  readonly wallpaperEngine?: WallpaperEngineSource;
  /** Called after a display change so providers read readings the new way. */
  readonly onDisplayChange?: (settings: DisplaySettings) => void;
  /** Devices a consumer may choose between. Omitted when none are known. */
  readonly describeDevices?: () => Promise<{
    readonly gpus: readonly { readonly id: string; readonly name: string }[];
    readonly disks: readonly { readonly id: string; readonly name: string }[];
  }>;
  /** What is attached to this PC right now, for
   *  the owner to point a local display at. Omitted uses the real `graphics()`
   *  probe; supplied so a case can hold a fixture rather than this machine's
   *  screens, and so a host that enumerates its own way can say so. */
  readonly monitors?: () => Promise<readonly Monitor[]>;
  /** The host's own windows on its local monitors, so a display that is added
   *  gets one and one that is removed loses it. Omitted when this host opens no
   *  windows; the records are then managed without any. **Included as
   *  `undefined` explicitly** because the launcher needs the port the socket
   *  actually took, so `main` hands over a getter read per request — the same
   *  reason `hosting` is one. */
  readonly launcher?: Launcher | undefined;
  /** The USB panels this host drives. Omitted when this host drives none: the
   *  `panels` routes are then 404, and a panel record is written without a
   *  runner rather than with one nothing owns. **Included as `undefined`
   *  explicitly** for the reason `launcher` is: the panel's page is the port
   *  its own socket took, so `main` hands over a manager built per request. */
  readonly panels?: PanelManager | undefined;
  /** The panels attached right now, for the owner to pick from. Omitted uses
   *  the real USB enumeration; supplied so a case can hold a fixture rather
   *  than this machine's hardware. */
  readonly attachedPanels?: () => Promise<readonly PanelHint[]>;
  /** The driver rows this host serves. Omitted uses the built-ins; supplied so
   *  the host that drives panels can hand over the same registry it opens from,
   *  plugin rows included. */
  readonly panelFamilies?: PanelFamilyRegistry;
  /** The host's own start-at-sign-in entry: whether the OS holds one now, and
   *  the write that turns it on or off. Omitted when this host cannot manage
   *  it: the routes then say so rather than reporting a change that did not
   *  happen. */
  readonly autostart?: {
    readonly state: () => boolean;
    readonly set: (enabled: boolean) => Promise<{
      readonly ok: boolean;
      readonly message: string;
      readonly enabled: boolean;
    }>;
  };
  /** Where a phone should point, whether it can reach this host at all, and how
   *  to move it there. Supplied rather than introspected: `server.address()` is
   *  null for a server that is not listening, which is every test, and the
   *  thing that binds the socket is the thing that knows.
   *
   *  Omitted when this host cannot move its binding; the route then refuses
   *  rather than pretending it moved. **Included as `undefined` explicitly**
   *  because the binding needs the port and the port needs the server, so the
   *  host hands over a getter that is read per request. */
  readonly hosting?: HostBinding | undefined;
  /** Persist the choice so the next run obeys it. Omitted when the host
   *  remembers nothing; the binding still moves for this run. */
  readonly rememberLan?: (on: boolean) => Promise<void>;
  /** The document an author is publishing, held in memory. Omitted when the
   *  host keeps none; every display then shows the stored theme. */
  readonly published?: PublishedStore;
  /** The leaf and its key. Omitted only by the unit suite: the launcher always
   *  brings one, because a display that cannot hold a wake lock or register a
   *  service worker cannot stay awake or install as an app, and it is the
   *  origin rather than any route that decides it. */
  readonly tls?: { readonly key: string; readonly cert: string };
  /** The root a display installs, served at `CA_CERTIFICATE_PATH`. Omitted when
   *  the host has none to offer, and the route then says so. Only the PEM is
   *  taken: the header's fingerprint is computed from these bytes, so the pair
   *  a caller cannot get wrong is the pair it never supplies. `RootPem` rather
   *  than a string, so a chain or a leaf is a compile error here. */
  readonly caCertificate?: RootPem;
  /** Which host this app folder is, answered by `GET /api/host`. Omitted when
   *  this host has no identity: the route is then not registered at all,
   *  because an id minted to fill the answer is one no display could have
   *  stored. */
  readonly host?: HostRecord;
  /** Installed widget packs, one directory each under the settings folder.
   *  Omitted when this host serves none; the routes then say so rather than
   *  falling through to the static 404. */
  readonly widgetPacks?: WidgetPackStore;
  /** The author's path presets, one settings file. Omitted when this host
   *  serves none; the routes then say so rather than falling through to the
   *  static 404. */
  readonly pathPresets?: PathPresetStore;
  /** Where an installed editor theme package is kept, and served back from.
   *  Omitted, the store route refuses editor themes. */
  readonly editorThemesDirectory?: string;
}

export interface HostingState {
  /** True when this host is reachable beyond loopback right now. */
  readonly lan: boolean;
  /** The address a phone should use, or null when there is none. */
  readonly address: string | null;
  /** The mDNS name a phone should dial, or null when the platform gives no
   *  hostname. **Beside the address, not instead of it**: a device that cannot
   *  resolve `.local` still has a dotted quad to type, and an owner has one to
   *  read aloud. The name is what survives a DHCP lease, which is why the
   *  pairing symbol dials it. */
  readonly name: string | null;
  /** The port this host is bound to, or null when it is not bound. */
  readonly port: number | null;
  /** The last move the host refused, in its own words, or null. A refusal can
   *  never ride the answer that asked for the move — the asker reads it here
   *  on the next GET. Cleared by the next move that lands. */
  readonly refusal: string | null;
}

/** A paired display as a surface may see it: the record **minus its credential
 *  hash**. The hash exists so the file is a list of displays rather than a set
 *  of credentials, and echoing it would undo exactly that. */
export type HostingPeer = Omit<DisplayRecord, "tokenHash">;

export interface HostServer {
  readonly server: ListenableServer;
  readonly connectionCount: number;
  close(): Promise<void>;
}
