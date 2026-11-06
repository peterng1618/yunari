import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deviceAllowlistOf,
  type InstalledExtension,
  PANEL_COMMAND_KINDS,
  type PanelCommand,
} from "@yunari/extension-api";
import { BUILTIN_PATH_PRESETS } from "@yunari/theme-package";
import { ASSET_SOURCES, createAssetSources } from "./assets/sources.js";
import { buildCatalogueIndexCommand } from "./catalogue/build-index.js";
import { DEFAULT_HOST, isLoopbackHost, parseArgs } from "./cli/args.js";
import { createHostBinding, type HostBinding } from "./cli/hosting.js";
import { mcpBinPath, mcpConsoleLaunch, runMcpCommand } from "./cli/mcp.js";
import {
  lanAddress,
  listenWithFallback,
  localNames,
  openBrowser,
  stableName,
  waitUntilReachable,
} from "./cli/net.js";
import { createPluginAssetSources } from "./extensions/asset-sources.js";
import { createConsentStore } from "./extensions/consent-store.js";
import { pluginSourceRows } from "./extensions/custom-sources.js";
import { declarativeAssetSources } from "./extensions/declarative-contributions.js";
import { DeclarativeAssetSourceAdapter } from "./extensions/declarative-sources.js";
import { createPluginInstaller } from "./extensions/install.js";
import { createKillListStore } from "./extensions/kill-list.js";
import {
  createProviderOrderStore,
  orderProviders,
} from "./extensions/provider-order.js";
import {
  createPluginProviders,
  type PluginSupervisors,
  startPluginSupervisors,
} from "./extensions/providers.js";
import { createDeviceBroker } from "./extensions/runtime/device-broker.js";
import { createHostApiDispatcher } from "./extensions/runtime/host-api.js";
import type { PluginSupervisor } from "./extensions/runtime/supervisor.js";
import { createNativeDeviceBackend } from "./extensions/runtime/usb-backend.js";
import { createExtensionService } from "./extensions/service.js";
import { createPluginSettingsStore } from "./extensions/settings.js";
import { defaultWidgetPackBytes } from "./packs/bundled-default-pack.js";
import { createWidgetPackStore } from "./packs/widget-packs.js";
import type { PanelFamily } from "./panels/panel-device.js";
import {
  createPanelFamilyRegistry,
  type PanelFamilyContribution,
} from "./panels/panel-families.js";
import {
  createPanelManager,
  type PanelManager,
} from "./panels/panel-manager.js";
import { panelPageUrl, themePageUrl } from "./panels/panel-page.js";
import { pluginPanelFamily } from "./panels/plugin-panel-family.js";
import { createPathPresetStore } from "./presets/path-presets.js";
import { ClockSensorProvider } from "./providers/clock.js";
import { CustomSourceProvider } from "./providers/custom/provider.js";
import { presentMonAdapter } from "./providers/frame/presentmon.js";
import { FrameProvider } from "./providers/frame/provider.js";
import { RtssAdapter } from "./providers/frame/rtss.js";
import { createGameArtwork } from "./providers/game/box-art.js";
import { readInstalledGames } from "./providers/game/catalogue/catalogue.js";
import { defaultCatalogueSeams } from "./providers/game/catalogue/seams.js";
import { GameProvider } from "./providers/game/provider.js";
import { createSteamStore } from "./providers/game/store-metadata.js";
import { LhmSensorProvider } from "./providers/lhm.js";
import { registerLhmTask } from "./providers/lhm-launcher.js";
import { LibrarySensorProvider } from "./providers/library.js";
import { createArtworkCache } from "./providers/media/artwork.js";
import { MediaProvider } from "./providers/media/provider.js";
import { ProviderRegistry } from "./providers/registry.js";
import { WeatherProvider } from "./providers/weather/provider.js";
import {
  createDisplayLauncher,
  type Launcher,
} from "./serve/display-launcher.js";
import { createHostAutostart, hostEntry } from "./serve/host-autostart.js";
import { resolveStoreOrigin } from "./server/identity.js";
import { CA_CERTIFICATE_PATH, createHostServer } from "./server.js";
import { createPairingCodeStore } from "./session/pairing-code.js";
import {
  assignedThemeFor,
  createActiveThemeStore,
} from "./settings/active-theme.js";
import { createCredentialStore } from "./settings/credentials.js";
import { createDeviceSettingsStore } from "./settings/devices.js";
import { createDisplaySettingsStore } from "./settings/display.js";
import { createDisplayStore } from "./settings/displays.js";
import { createFontFavoritesStore } from "./settings/font-favorites.js";
import { acquireHostLock } from "./settings/host-lock.js";
import { readOrMintHostRecord } from "./settings/host-record.js";
import { createHostingSettingsStore } from "./settings/hosting.js";
import {
  createSecretStore,
  KeyProtectorUnavailable,
} from "./settings/secret-store.js";
import { type CustomSource, createSourceStore } from "./settings/sources.js";
import { createStoreSessionStore } from "./settings/store-session.js";
import { createThemeOriginsStore } from "./settings/theme-origins.js";
import { createThemeSettingsStore } from "./settings/theme-settings.js";
import { createWeatherSettingsStore } from "./settings/weather.js";
import { normalizeVideoCommand } from "./themes/normalize-video.js";
import { createThemeStore } from "./themes/store.js";
import { createThemeMedia, panelVideoPlacement } from "./themes/theme-media.js";
import { createThumbnailStore } from "./themes/thumbnails.js";
import { createSecureOrigin, type SecureOrigin } from "./tls/authority.js";
import { openTrayAction } from "./tray/actions.js";
import { type TrayController } from "./tray/controller.js";
import { createExternalApps } from "./tray/external-apps.js";
import { startTray } from "./tray/index.js";
import { createWallpaperEngineSource } from "./wallpaper-engine/source.js";

/** Launcher: bind, verify reachability, then print/open URLs. */

/** ANSI styling only for TTY output. */
function style(code: string, text: string): string {
  return process.stdout.isTTY ? `\u001b[${code}m${text}\u001b[0m` : text;
}

/** This module's own directory: `dist/` in the built host, `src/` under test.
 *  Both sit at the same depth below the workspace root, which is why the two
 *  paths below resolve the same way from either. */
const here = path.dirname(fileURLToPath(import.meta.url));

/** The directory holding `packages/host` and, in a release, `packages/mcp`. */
function packageRoot(): string {
  return path.join(here, "..", "..");
}

const VERSION = productVersion();

/** The product's version, read from the workspace manifest — the one place a
 *  release writes it. The editor bundle reads the same field through Vite's
 *  `define`, so neither reader carries a copy of the number. */
function productVersion(): string {
  const manifest = path.join(here, "..", "..", "..", "package.json");
  return (JSON.parse(readFileSync(manifest, "utf8")) as { version: string })
    .version;
}

/** The staged LibreHardwareMonitor, for setup commands that need a default. */
function defaultLhmExecutable(): string {
  return path.join(here, "..", "vendor", "lhm", "LibreHardwareMonitor.exe");
}

export async function run(argv: readonly string[]): Promise<number> {
  // The bundled MCP CLI owns its flags, so it is routed before this parser
  // sees `--yes`, `--agent` or `--json`.
  if (argv[0] === "mcp") {
    return runMcpCommand(argv.slice(1), packageRoot());
  }

  const normalized = await normalizeVideoCommand(argv);
  if (normalized !== undefined) return normalized;

  const catalogue = await buildCatalogueIndexCommand(argv);
  if (catalogue !== undefined) return catalogue;

  const parsed = parseArgs(argv, VERSION);

  if (parsed.kind === "message") {
    console.log(parsed.text);
    return 0;
  }

  if (parsed.kind === "error") {
    console.error(`${parsed.message}`);
    return 1;
  }

  const {
    port: wanted,
    host,
    hostGiven,
    openBrowser: shouldOpen,
    tray: trayMode,
    themesDir,
    settingsDir,
    lhmUrl,
    lhmExecutable,
    rtssExecutable,
    registerLhmTask: shouldRegisterTask,
  } = parsed.options;

  // One-time setup, then exit: registering needs an elevated shell with a
  // visible consent prompt, so it must not run inside the server.
  if (shouldRegisterTask === true) {
    const outcome = await registerLhmTask(
      lhmExecutable ?? defaultLhmExecutable(),
    );
    console.log(outcome.message);
    return outcome.ok ? 0 : 1;
  }

  // One app folder is one host, and the lock is taken before anything reads the
  // folder: a second host against a held folder
  // would answer the same display ids and the same active theme as the first,
  // and the port fallback would let it start looking like a second machine.
  const held = await acquireHostLock(settingsDir, wanted);

  if (!held.ok) {
    console.error(held.reason);
    return 1;
  }

  // Launching LHM is opt-in, never automatic: its manifest requires
  // administrator rights, so starting it unattended would raise a UAC prompt on
  // every host start. The provider reads whichever server answers, whether
  // Yunari launched it or the owner already runs it. The same owner serves the
  // tray's LHM and RTSS rows; in tray mode it starts LHM in the background once
  // the server is reachable, and stopOwnedLhm releases only what this run started.
  const externalApps = createExternalApps({
    platform: process.platform,
    lhmUrl,
    ...(lhmExecutable === undefined ? {} : { lhmExecutable }),
    lhmDefaultExecutable: defaultLhmExecutable(),
    ...(rtssExecutable === undefined ? {} : { rtssExecutable }),
  });

  let lhmStart: Awaited<ReturnType<typeof externalApps.startLhm>> | undefined;
  if (!trayMode && lhmExecutable !== undefined) {
    lhmStart = await externalApps.startLhm();
  }

  // Provider order defines ownership priority. LibreHardwareMonitor answers the
  // extended sensors (CPU temperature, fans, GPU detail) when the machine owner
  // runs it; the systeminformation-backed provider answers everything else, and
  // covers any key LHM could not read. Both are optional sources, never a
  // collector Yunari maintains (§97).
  const lhmProvider = new LhmSensorProvider({ baseUrl: lhmUrl });
  const libraryProvider = new LibrarySensorProvider();
  // Time is a reading from this PC, so displays agree and a wrong device clock
  // cannot mislead.
  const clockProvider = new ClockSensorProvider();
  // Provider keys, in the same settings directory and with the same rules: the
  // browser may write one and never read it back. Created before the weather
  // provider because a BYOK backend reads its key from here.
  const credentials = createCredentialStore(settingsDir);
  // Custom sources sit beside the credentials they reference. The settings page
  // reads and writes them through the host's loopback routes, which report a
  // malformed entry rather than starting the host silently.
  const customSources = createSourceStore(settingsDir);
  // Plugins may declare custom sources, and an install, grant or remove can
  // change the rows the provider should hold.
  const pluginInstaller = createPluginInstaller(
    path.join(settingsDir, "extensions"),
  );
  // Declarative plugin settings stay beside the plugins they belong to. A
  // secret field lands in the plugin's encrypted store, never in this JSON.
  const pluginSettings = createPluginSettingsStore({
    installer: pluginInstaller,
    directory: path.join(settingsDir, "extensions", "settings"),
    secrets: createSecretStore(path.join(settingsDir, "extensions", "secrets")),
  });
  // Which plugin provider answers a shared key first, kept beside the plugins.
  const providerOrder = createProviderOrderStore(
    path.join(settingsDir, "extensions", "provider-order.json"),
  );
  let extensions: ReturnType<typeof createExtensionService>;
  /** The running workers, once they start; an install rechecks this map. */
  let pluginSupervisors: PluginSupervisors | undefined;
  /** Assigned once the device broker exists; the service's onChange calls it. */
  let recheckPluginSupervisors = async (): Promise<void> => undefined;
  let pluginSources: readonly CustomSource[] = [];
  const refreshPluginSources = async (): Promise<void> => {
    try {
      pluginSources = await pluginSourceRows(extensions);
    } catch {
      pluginSources = [];
    }
  };
  const customProvider = new CustomSourceProvider({
    sources: customSources,
    credentials,
    extraSources: () => pluginSources,
  });
  const killList = createKillListStore({
    directory: path.join(settingsDir, "extensions"),
    origin: resolveStoreOrigin(process.env.YUNARI_STORE_ORIGIN),
    fetch,
    now: () => new Date().toISOString(),
  });
  // Fetched once at startup, then again whenever a package lands. A store that
  // cannot answer leaves the cached list in force.
  await killList.refresh();
  extensions = createExtensionService({
    installer: pluginInstaller,
    consent: createConsentStore(settingsDir),
    killList,
    now: () => new Date().toISOString(),
    providerOrder,
    onChange: async () => {
      await refreshPluginSources();
      await customProvider.reload();
      // An install can change what a plugin asks for. A worker whose plugin no
      // longer may load is stopped and its devices closed; the panel-family
      // row it backed is rebuilt on the next host start, never mutated here.
      await recheckPluginSupervisors();
    },
  });
  await refreshPluginSources();
  await customProvider.reload();

  // The devices every installed plugin declares, in one map the broker reads.
  const installedPlugins = await pluginInstaller.list();
  const deviceAllowlists = new Map(
    installedPlugins.map((plugin) => [
      plugin.key,
      deviceAllowlistOf(plugin.manifest),
    ]),
  );
  const deviceBroker = createDeviceBroker({
    allowlists: (key) => deviceAllowlists.get(key) ?? [],
    backend: createNativeDeviceBackend(),
  });

  // Plugin rows tagged with the key that owns them, so a revoked plugin's
  // families can be removed without touching the built-in rows.
  const pluginPanelFamilies: {
    readonly pluginKey: string;
    readonly family: PanelFamily;
  }[] = [];

  recheckPluginSupervisors = async () => {
    const running = pluginSupervisors;
    if (running === undefined) return;

    for (const [key, supervisor] of running.supervisors) {
      let loadable = false;
      try {
        loadable = await extensions.mayLoad(key);
      } catch {
        loadable = false;
      }
      if (loadable) continue;

      try {
        await supervisor.stop();
      } catch {
        // One worker that will not stop must not strand the others.
      }
      (running.supervisors as Map<string, PluginSupervisor>).delete(key);
      // A revoked plugin's devices and panel rows go with its worker: a
      // surface must not offer a panel the host will refuse to drive.
      deviceAllowlists.delete(key);

      const remaining = pluginPanelFamilies.filter(
        (row) => row.pluginKey !== key,
      );
      if (remaining.length !== pluginPanelFamilies.length) {
        pluginPanelFamilies.splice(0, pluginPanelFamilies.length, ...remaining);
        panelFamilies.setPlugins(pluginPanelFamilies.map((row) => row.family));
      }

      await deviceBroker.closeAll(key);
    }
  };

  // One forked worker per loadable plugin that needs code. A plugin that will
  // not start is reported and left out; the machine's own providers still
  // answer, and a plugin contributing both providers and asset sources is one
  // process. The supervisors are started once and shared by both adapters.
  const pluginHostApi = createHostApiDispatcher({
    settingsDir,
    broker: deviceBroker,
  });
  const onPluginFailure = (pluginKey: string, reason: string): void => {
    console.error(`Plugin worker ${pluginKey}: ${reason}`);
  };
  const runningSupervisors = await startPluginSupervisors({
    installer: pluginInstaller,
    extensions,
    hostApi: pluginHostApi,
    onFailure: onPluginFailure,
    // A crashed worker cannot close the handles it opened; the host closes
    // them here rather than waiting for a later call or shutdown.
    onCrash: (pluginKey) => {
      void deviceBroker.closeAll(pluginKey);
    },
  });
  pluginSupervisors = runningSupervisors;

  // One panel family per manifest entry whose plugin got a worker. A command
  // this build does not know is dropped with a line, not guessed at.
  for (const plugin of installedPlugins) {
    const supervisor = runningSupervisors.supervisors.get(plugin.key);
    if (supervisor === undefined) continue;

    for (const entry of plugin.manifest.contributes.panelFamilies ?? []) {
      const commands: PanelCommand["kind"][] = [];
      for (const command of entry.commands) {
        if (PANEL_COMMAND_KINDS.has(command as PanelCommand["kind"])) {
          commands.push(command as PanelCommand["kind"]);
        } else {
          console.error(
            `Panel family ${entry.id} in ${plugin.key}: this host does not know the command "${command}".`,
          );
        }
      }

      const contribution: PanelFamilyContribution = {
        id: entry.id,
        label: entry.label,
        vendorId: entry.vendorId,
        productId: entry.productId,
        geometry: entry.geometry,
        support: entry.support,
        commands,
        ...(entry.renderModes === undefined
          ? {}
          : { renderModes: entry.renderModes }),
      };

      pluginPanelFamilies.push({
        pluginKey: plugin.key,
        family: pluginPanelFamily({
          plugin,
          contribution,
          supervisor,
          broker: deviceBroker,
        }),
      });
    }
  }

  const pluginRuntime = await createPluginProviders({
    installer: pluginInstaller,
    extensions,
    hostApi: pluginHostApi,
    supervisors: runningSupervisors.supervisors,
    onFailure: onPluginFailure,
  });
  const pluginAssetSources = await createPluginAssetSources({
    installer: pluginInstaller,
    supervisors: runningSupervisors.supervisors,
    taken: ASSET_SOURCES.map((source) => source.id),
    onFailure: onPluginFailure,
  });
  // A declarative source needs no worker: its manifest says where to search
  // and how to read the answer. A row that collides with a built-in or a code
  // source is refused here rather than reaching `createAssetSources`, whose
  // duplicate check throws and would take the host down at startup.
  const installedExtensions = await extensions.list();
  const declaredAssetSources = declarativeAssetSources(installedExtensions);
  const declarativeOwners = new Map<string, InstalledExtension>();
  for (const extension of installedExtensions) {
    for (const row of extension.contributions.assetSources ?? []) {
      const id = row["id"];
      if (typeof id === "string") declarativeOwners.set(id, extension);
    }
  }
  const assetSourceIds = new Set([
    ...ASSET_SOURCES.map((source) => source.id),
    ...pluginAssetSources.map((source) => source.id),
  ]);
  const declarativeAssetAdapters: DeclarativeAssetSourceAdapter[] = [];
  for (const contribution of declaredAssetSources) {
    const owner = declarativeOwners.get(contribution.id);
    if (owner === undefined) continue;
    if (assetSourceIds.has(contribution.id)) {
      console.warn(
        `Declarative asset source ${owner.key}: "${contribution.id}" is already an asset source.`,
      );
      continue;
    }
    assetSourceIds.add(contribution.id);
    declarativeAssetAdapters.push(
      new DeclarativeAssetSourceAdapter({ plugin: owner, contribution }),
    );
  }
  // Weather's place, backend and cadence are this PC's own settings, and the
  // provider owns its timer: it is built here with the providers, not by the
  // registry's cycle.
  const weatherSettings = createWeatherSettingsStore(settingsDir);
  const weatherProvider = new WeatherProvider({
    settings: weatherSettings,
    credentials,
  });
  // Artwork is a cache, not a setting: the bytes live under the app folder's
  // cache directory, and the server serves them through the display gate.
  const mediaArtwork = createArtworkCache(
    path.join(path.dirname(settingsDir), "cache", "media-artwork"),
  );
  const mediaProvider = new MediaProvider({ cache: mediaArtwork });
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Frame statistics have no settings of their own; the provider starts one
  // helper at a time only while a display binds frame.*. RTSS is the source;
  // the vendored PresentMon is the fallback when RTSS is not running.
  const frameProvider = new FrameProvider({
    adapters: [
      new RtssAdapter(),
      presentMonAdapter({
        executable: path.join(
          here,
          "..",
          "vendor",
          "presentmon",
          "PresentMon.exe",
        ),
      }),
    ],
  });
  // The foreground process, with Steam's local files for a game name: one
  // helper only while a display binds game.*. A named root lets a portable
  // install — or a test fixture — point at its own library; absent, the
  // registry's SteamPath is the answer. A game outside Steam is named by the
  // store's cached lookup, kept beside the other caches.
  const namedSteamRoot = process.env.YUNARI_STEAM_ROOT;
  const steamRoot =
    namedSteamRoot === undefined || namedSteamRoot === ""
      ? undefined
      : () => Promise.resolve(namedSteamRoot);
  const gameMetadataCacheDir = path.join(
    path.dirname(settingsDir),
    "cache",
    "game-metadata",
  );
  // Two test seams, each honoured only when non-empty: a store fixture for the
  // searched metadata, and a fixed foreground so a browser proof needs no
  // running game. Unset changes nothing.
  const storeBaseUrl = process.env.YUNARI_STEAM_STORE;
  const fixedForeground = process.env.YUNARI_FOREGROUND_EXE;
  const gameStore = createSteamStore({
    fetchImpl: (input, init) => fetch(input, init),
    cacheDir: gameMetadataCacheDir,
    ...(storeBaseUrl === undefined || storeBaseUrl === ""
      ? {}
      : { baseUrl: storeBaseUrl }),
  });
  // One catalogue read serves both the provider's matching and the artwork
  // route's lookup, so a launcher's entry is the same fact in both places.
  const catalogueSeams = defaultCatalogueSeams(
    steamRoot === undefined ? {} : { resolveSteamRoot: steamRoot },
  );
  const installedGames = () => readInstalledGames(catalogueSeams);
  const gameProvider = new GameProvider({
    ...(steamRoot === undefined ? {} : { steamRoot }),
    catalogue: installedGames,
    store: gameStore,
    ...(fixedForeground === undefined || fixedForeground === ""
      ? {}
      : {
          foregroundPath: fixedForeground,
          // The seam's file stem is its name; a version-info read would be a
          // spawn the proof cannot control.
          productName: () => Promise.resolve(undefined),
        }),
  });
  const registry = new ProviderRegistry(
    orderProviders(
      [
        clockProvider,
        lhmProvider,
        libraryProvider,
        weatherProvider,
        mediaProvider,
        frameProvider,
        gameProvider,
        customProvider,
      ],
      pluginRuntime.providers,
      await extensions.readProviderOrder(),
    ),
  );
  const packagesDir = path.resolve(here, "..", "..");

  // Displays and their credentials exist whether or not the LAN is on, because
  // the control can turn it on after launch; the binding decides whether anything
  // but loopback can reach them at all (§145).
  const displays = createDisplayStore(settingsDir);
  // The one-time code, made here rather than inside the server so the link this
  // run prints carries the code the claim route will accept. A code is
  // regenerable and leaves no record, which is the property a printed link
  // needs — a durable credential can only be answered once.
  const pairingCodes = createPairingCodeStore();
  const hosting = createHostingSettingsStore(settingsDir);
  const storedHosting = await hosting.read();
  // Everything the host knows about *this* machine lives in one settings
  // folder, so a theme folder is only ever a theme.
  const deviceSettings = createDeviceSettingsStore(settingsDir);
  // The consumer's display preferences, read by the provider that acquires the
  // readings they apply to.
  const displaySettings = createDisplaySettingsStore(settingsDir);
  // Which theme this host displays; consumer state beside the device choices.
  const activeTheme = createActiveThemeStore(settingsDir);
  // Which curated font trios this author reaches for. Author preference about
  // this PC, so it sits with the other settings and never in a theme folder.
  const fontFavorites = createFontFavoritesStore(settingsDir);
  // The store session the author signed in to, beside the other records this
  // machine keeps. The browser never reads it; the host uses it to submit.
  // Which store it belongs to is a build-time address, passed at the server
  // below rather than stored here.
  const storeSession = createStoreSessionStore(settingsDir);
  // Which host this app folder is, read or minted after the lock so a second
  // host cannot answer with the same identity: `GET /api/host` gives it to
  // anyone who asks, and it is what a display stores to re-find this host after
  // its address changes.
  const hostRecord = await readOrMintHostRecord(settingsDir);

  // Installed widget packs, one folder each under the settings directory. The
  // app's own eight cards travel as a bundled package, read from the build and
  // never written: they are the product's, not this machine's files.
  const widgetPacks = createWidgetPackStore(
    path.join(settingsDir, "widget-packs"),
    { bundled: [defaultWidgetPackBytes()] },
  );

  // The author's path presets, one file beside the other settings. The
  // built-ins are passed from the package's catalogue, so the host and the
  // Add pane list the same shipped shapes.
  const pathPresets = createPathPresetStore(settingsDir, BUILTIN_PATH_PRESETS);

  // The certificate is the whole reason the host serves https: a phone at
  // `http://<lan-ip>:<port>` is not a secure context, so it can neither hold a
  // screen wake lock nor register the service worker an installable app needs.
  // A machine with no OS key protector has nowhere to keep the
  // root's private key, and there https is not a choice the host can make at
  // all — it starts http-only and says what the display loses. Any other
  // failure to prepare the certificate is a directory the host could not write,
  // which is worth refusing over rather than starting into an origin that is
  // known to be wrong.
  let origin: SecureOrigin | undefined;
  try {
    origin = await createSecureOrigin(
      path.join(settingsDir, "tls"),
      localNames(),
    );
  } catch (error) {
    if (!(error instanceof KeyProtectorUnavailable)) {
      console.error(
        `Could not prepare a certificate in ${path.join(settingsDir, "tls")}: ` +
          `${error instanceof Error ? error.message : String(error)}\n` +
          "  The host serves https so a display can hold the screen awake and " +
          "install as an app; without one it will not start.",
      );
      await held.lock.release();
      return 1;
    }
  }

  // The server needs the binding, and the binding needs the port the socket
  // actually took — which is not known until the socket is listening. So the
  // option is a getter over this variable rather than a reader captured at
  // construction: it is read per request, and a request that arrives before the
  // binding exists reads `undefined`, which the route already answers.
  let lanBinding: HostBinding | undefined;

  // The launcher needs the port the socket actually took, and the server needs
  // the launcher, so this is a getter over the variable below — the same reason
  // `hosting` is one.
  let launcher: Launcher | undefined;

  // The USB panels this host drives. The page a panel renders is this host's
  // player at the port the socket actually took, so this is a getter for the
  // same reason `launcher` is.
  let panels: PanelManager | undefined;

  // A thumbnail is this machine's rendering of a theme, so it lives in that
  // theme's own folder rather than in a directory of its own. The editor
  // writes it after the save that replaced the folder, which is why the
  // library always has a picture for what was just saved.
  const thumbnails = createThumbnailStore(themesDir);

  // One store for the routes and the panels: a panel's clip is the same theme
  // the player would show, read from the library the host serves. The colour
  // mode reads the stored picture's mean luminance, because a picture or video
  // behind the board is what a viewer sees there rather than the paint token.
  const themeStore = createThemeStore(themesDir, {
    thumbnailLuminance: (id) => thumbnails.luminance(id),
  });

  // The tray, once it exists. The stop path closes it first, so a click on Exit
  // does not leave an icon behind; undefined until the server is reachable.
  let tray: TrayController | undefined;

  // One entry at sign-in covers every local monitor, including one added
  // later. The tray's "Auto start" toggle drives the same owner (Task 9).
  const autostart = createHostAutostart();
  const entry = hostEntry(argv, here);

  // The one registry the server and the panel manager share: a family the
  // routes offer a record for is the same row the manager opens, plugin rows
  // included.
  const panelFamilies = createPanelFamilyRegistry(
    pluginPanelFamilies.map((row) => row.family),
  );

  const hosted = createHostServer({
    registry,
    // The leaf, signed by the root a display installs once. In memory only:
    // a leaf is disposable, which is what makes a moved address free. Absent
    // when there is no protector to keep the root's key, and the server then
    // answers http alone.
    ...(origin === undefined
      ? {}
      : {
          tls: { key: origin.key, cert: origin.chain },
          // And the root itself, for the device that has to trust it before it
          // can read anything else; the fingerprint is computed from these
          // bytes where each is used.
          caCertificate: origin.certificate,
        }),
    // Who this host is, so a display that has lost its address can ask.
    host: hostRecord,
    // The installed widget packs the insert surface offers. The store is built
    // here so the settings folder's subtree is the one place they live.
    widgetPacks,
    pathPresets,
    // Where the store's editor themes land; the settings import control reads
    // them back through the route of the same name.
    editorThemesDirectory: path.join(settingsDir, "editor-themes"),
    // The host's own windows on its local monitors.
    get launcher() {
      return launcher;
    },
    // The USB panels, for the same reason: a panel's page names the port.
    get panels() {
      return panels;
    },
    // One entry at sign-in covers every local monitor, including one added
    // later. Registering writes the hidden entry, so this only ever asks; a
    // refusal is answered with the registrar's own message.
    autostart: {
      state: () => autostart.state(),
      set: (enabled) =>
        enabled ? autostart.enable(entry) : autostart.disable(),
    },
    // Where a phone should point, whether one can reach this host at all, and
    // how to move it there.
    get hosting() {
      return lanBinding;
    },
    rememberLan: async (on) => {
      await hosting.write({ lan: on });
    },
    bundles: {
      player: path.join(packagesDir, "player", "dist"),
      editor: path.join(packagesDir, "editor", "dist"),
      // Served from source: the settings page has no build step.
      admin: path.join(packagesDir, "host", "public"),
    },
    themeStore,
    // Local plugin trees live beside the settings that admit them; the consent
    // file records the grants, and the browser only ever sees the listed shape.
    extensions,
    // Declarative plugin settings: non-secret values in one host file, secret
    // fields in the encrypted store beside it.
    pluginSettings,
    // The Steam library on this PC, read on demand: the install is located per
    // listing, because a library can appear while the editor is open. The scan
    // is cached beside the other disposable host data so a rebuild does not
    // reread every scene package.
    wallpaperEngine: createWallpaperEngineSource({
      cacheDir: path.join(
        path.dirname(settingsDir),
        "cache",
        "wallpaper-engine",
      ),
    }),
    // A thumbnail is this machine's rendering of a theme, so it lives in that
    // theme's own folder rather than in a directory of its own. The editor
    // writes it after the save that replaced the folder, which is why the
    // library always has a picture for what was just saved.
    thumbnails,
    // The derived pictures a panel's page loads instead of the theme video.
    // Disposable, named by their inputs, and regenerated when the name is
    // missing — a theme save only clears the entries it invalidated.
    themeMedia: createThemeMedia({
      directory: path.join(path.dirname(settingsDir), "cache", "theme-media"),
      readAsset: (id, assetPath) => themeStore.readAsset(id, assetPath),
    }),
    themeSettings: createThemeSettingsStore(settingsDir),
    // Beside the answers and from the same directory: where a copy came from is
    // this machine's own record about a theme, like what a consumer answered
    // for it — not part of the author's folder.
    themeOrigins: createThemeOriginsStore(settingsDir),
    storeSession,
    displays,
    pairingCodes,
    panelFamilies,
    devices: deviceSettings,
    display: displaySettings,
    weather: weatherSettings,
    fontFavorites,
    credentials,
    sources: { store: customSources, provider: customProvider },
    assets: {
      credentials,
      sources: createAssetSources(ASSET_SOURCES, [
        ...pluginAssetSources,
        ...declarativeAssetAdapters,
      ]),
    },
    artwork: mediaArtwork,
    gameArtwork: createGameArtwork({
      ...(steamRoot === undefined ? {} : { steamRoot }),
      catalogue: installedGames,
    }),
    gameCoverCacheDir: gameMetadataCacheDir,
    onDisplayChange: (settings) => clockProvider.setTimeZone(settings.timeZone),
    activeTheme,
    // Both providers know the machine's devices; LHM's list is richer, so its
    // entries come first and the library fills in what LHM does not report
    // (a machine without LHM still gets a usable device list).
    describeDevices: async () => {
      const [fromLhm, fromLibrary] = await Promise.all([
        lhmProvider.describeDevices(),
        libraryProvider.describeDevices(),
      ]);
      // Not a union: both providers name a drive by its model now, so LHM's
      // list already covers the drives the library can reach, and concatenating
      // them would list one physical drive twice under two different slugs.
      // The list must describe what the provider that answers readings can
      // actually serve, so LHM's list wins whenever it has one and the
      // library's fills in only when it does not.
      const prefer = <T extends { readonly id: string }>(
        first: readonly T[],
        second: readonly T[],
      ): readonly T[] => (first.length > 0 ? first : second);

      return {
        gpus: prefer(fromLhm.gpus, fromLibrary.gpus),
        disks: prefer(fromLhm.disks, fromLibrary.disks),
      };
    },
  });

  // Apply the settled display choice before the first poll, so the first frame
  // already shows the time the consumer asked for.
  const storedDisplay = await displaySettings.read();
  clockProvider.setTimeZone(storedDisplay.timeZone);

  // `--host` wins for the run; a run without it obeys what this PC remembers.
  const initialHost = hostGiven
    ? host
    : storedHosting.lan
      ? "0.0.0.0"
      : DEFAULT_HOST;

  let bound: number;

  try {
    bound = await listenWithFallback(hosted.server, wanted, initialHost);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    await held.lock.release();
    return 1;
  }

  lanBinding = createHostBinding(hosted.server, {
    port: bound,
    host: initialHost,
  });

  const reachable = await waitUntilReachable(bound, initialHost);

  if (!reachable) {
    console.error(
      `The server bound port ${bound} but never answered. Giving up.`,
    );
    await hosted.close();
    await held.lock.release();
    return 1;
  }

  // After the server answers, so a window that opens on a local monitor has
  // something to load. Every attached local display gets its window back, on the
  // monitor it is on; one that is already up is seen as running and left alone,
  // which is the whole of the restart behaviour.
  launcher = createDisplayLauncher({ displays, port: bound });
  await launcher.reconcile();

  // After the server answers for the same reason, and per panel: the page a
  // panel renders is this host's own player, so there is nothing to show until
  // the socket is listening. A panel that cannot be opened — L-Connect holding
  // it is the usual one — is reported and left out rather than taking the host
  // down with it.
  panels = createPanelManager({
    displays,
    families: panelFamilies,
    pageFor: (displayId, clip, themeId) =>
      panelPageUrl(bound, displayId, clip, themeId),
    // A thumbnail's page belongs to no display: it is the theme alone, in the
    // player's own panel mode, photographed at the library's size.
    pageForTheme: (themeId) => themePageUrl(bound, themeId),
    // A panel's encoded clip is disposable host data, kept beside the other
    // caches so a restart reuses the transcode instead of paying for it again.
    videoCacheDir: path.join(path.dirname(settingsDir), "cache", "panel-video"),
    // A panel that goes away — a restart, a power cut, a vendor app holding
    // the port — is opened again on this cadence, the same one the launcher
    // uses for local monitors.
    reconcileIntervalMs: 15_000,
    // The clip a panel plays itself, resolved the way the player resolves its
    // theme: the display's own choice, else the default's. Anything that cannot
    // be resolved — no theme, no media, an image rather than a video, a missing
    // asset — is a still panel, so this answers undefined rather than throwing.
    videoFor: async (displayId) => {
      const themeId = await assignedThemeFor(activeTheme, displayId, (id) =>
        themeStore.exists(id),
      );
      if (themeId === undefined) return undefined;

      const envelope = await themeStore.readEnvelope(themeId);
      const media = envelope?.background?.media;
      if (envelope === undefined || media === undefined) return undefined;

      const declared = (envelope.assets ?? []).find(
        (asset) => asset.id === media.assetId,
      );
      if (declared === undefined || declared.kind !== "video") return undefined;

      const asset = await themeStore.readAsset(themeId, declared.path);
      if (asset === undefined) return undefined;

      // The device decodes the clip itself, so the record's mounting angle has
      // to travel with the bytes: the page's own turn never reaches it.
      const display = await displays.find(displayId);

      return {
        bytes: asset.bytes,
        placement: {
          ...panelVideoPlacement(envelope),
          ...(display === undefined ? {} : { shape: display.shape }),
        },
        rotation: display?.rotation ?? 0,
      };
    },
    onError: (displayId, message) => {
      console.error(`Panel ${displayId}: ${message}`);
    },
    onBrowserError: (message) => {
      console.error(`Raster browser: ${message}`);
    },
  });
  await panels.reconcile();

  const displayHost =
    initialHost === "0.0.0.0" || initialHost === "::"
      ? "localhost"
      : initialHost;
  /** https first, http beside it: a display is a secure context only at the
   *  https origin, and the plain address is what a device that has not
   * installed the root certificate can still open. */
  const localSecure = `https://${displayHost}:${bound}`;
  const localPlain = `http://${displayHost}:${bound}`;
  /** The address a display would use, whether or not the LAN is open — the
   *  certificate covers it either way, and the console names it. */
  const lan = await lanAddress();
  /** And the name it dials instead where the platform answers one: it survives
   * a DHCP lease where the address does not. */
  const name = stableName();

  console.log(`\nYunari v${VERSION}`);

  if (bound !== wanted) {
    console.log(
      style("33", `Port ${wanted} was busy, so this is on ${bound}.`),
    );
  }

  if (origin === undefined) {
    console.log(`  Dashboard  ${localPlain}`);
    console.log(`  Editor     ${localPlain}/editor`);
    console.log(
      style(
        "33",
        "  No OS key protector on this machine, so there is nowhere to keep a\n" +
          "  certificate's private key: this host serves http only, and a\n" +
          "  display on the LAN cannot hold the screen awake or install as an\n" +
          "  app. A local display window is unaffected — loopback is a secure\n" +
          "  context without a certificate.",
      ),
    );
  } else {
    console.log(`  Dashboard  ${localSecure}`);
    console.log(`  Editor     ${localSecure}/editor`);
    console.log(
      style(
        "2",
        `  Same two over plain http, which needs no certificate installed:` +
          `\n  ${localPlain}`,
      ),
    );

    // The step that has to come before any of it, printed on every run rather
    // than once: adding a second display is the common case and it is the same
    // step. The path is named as well as the URL because a browser on this PC
    // would meet the warning it is being asked to remove, while an installer can
    // read the file directly.
    //
    // **Two addresses, because they are two different steps and one of them is a
    // trap.** The root is fetched over plain http: the route answers before every
    // gate and on both protocols on this same port, so the owner never has to
    // bypass the certificate warning in order to install the certificate that
    // removes it. `https://` is the origin to reload afterwards, and both lines
    // say which is which.
    console.log(
      style(
        "2",
        [
          `  Certificate  ${origin.certificatePath}`,
          // Built by the authority from the PEM the route hands out, and printed
          // here with no certificate to choose: the printed fingerprint and the
          // served header are one reading of the same bytes.
          ...origin.certificateLines,
          `  This host serves https on the same port, and a display holds the`,
          `  screen awake and installs as an app only there. Install this root`,
          `  once per device, this PC included:`,
          `    Fetch the root over http, so no warning is in the way:`,
          `      http://${lan ?? displayHost}:${bound}${CA_CERTIFICATE_PATH}`,
          `    Then open the display at:`,
          `      https://${lan ?? displayHost}:${bound}`,
          "  A device without it shows a certificate warning, not a broken display.",
        ].join("\n"),
      ),
    );
  }

  // Say what the extended sensors will do, rather than leaving the display to
  // show gaps without explanation.
  if (lhmStart?.started === true) {
    console.log(style("2", `  LibreHardwareMonitor started for ${lhmUrl}`));
  } else if (lhmStart?.reason !== undefined) {
    console.log(
      style(
        "33",
        `  Extended sensors unavailable: ${lhmStart.reason}` +
          "\n  Baseline sensors still work; temperature and fan keys will be gaps.",
      ),
    );
  } else if (trayMode) {
    // The tray starts LHM once the server answers; its LHM row reports a
    // missing or unreadable install, so the banner does not advise a flag the
    // owner did not pass.
    console.log(
      style(
        "2",
        "  LibreHardwareMonitor starts in the background when it is installed.",
      ),
    );
  } else {
    console.log(
      style(
        "2",
        `  Extended sensors (CPU temperature, fans, power) need ` +
          `LibreHardwareMonitor running at ${lhmUrl}.` +
          "\n  Start it yourself with its web server enabled, or pass --lhm-exe.",
      ),
    );
  }

  if (!isLoopbackHost(initialHost)) {
    const hostPart = lan === undefined ? displayHost : lan;
    // **The name where there is one**, because this is the link a display
    // pairs on and the origin its cookie and storage are then scoped to: a
    // dotted quad there is a phone that must pair again the moment DHCP moves
    // the host. The address is printed beside it, for a
    // device that cannot resolve the name and for the one without the root.
    const dial = name ?? hostPart;
    const networkSecure = `https://${dial}:${bound}`;
    const networkPlain = `http://${hostPart}:${bound}`;

    console.log(
      style(
        "33",
        `\n  LAN serving is ON (bound ${initialHost}).` +
          (lan === undefined
            ? ""
            : ` Phones on this Wi-Fi: ${networkSecure} (fallback ${networkPlain})`),
      ),
    );
    console.log(
      style("33", "  Plain HTTP — trusted networks only, never the internet."),
    );
    console.log(style("2", "  The editor stays restricted to this PC."));

    // The link carries a **code**, not a credential. A stored hash cannot be
    // printed again and minting a display per run leaves a record for a link
    // nobody used, so what this prints is the one secret that can be made again
    // — and it pairs nothing until somebody claims it (R9).
    //
    // **`current()` first.** This line runs after the server already answers, so
    // a page that read `/api/pairing/code` in between minted its own; minting
    // here would replace it and refuse the claim that follows (R16: a read never
    // moves the live code).
    const code = pairingCodes.currentOrMint();
    console.log(style("2", "\n  This host is reachable on this network at:"));
    console.log(`  ${networkSecure}/`);
    console.log(
      style(
        "2",
        `  ${networkPlain}/   (a device without the root certificate)`,
      ),
    );
    console.log(style("2", "  Pair a display that has no camera at:"));
    console.log(`  ${networkSecure}/pair?code=${code.code}`);
    console.log(style("2", `  ${networkPlain}/pair?code=${code.code}`));
  } else {
    console.log(
      style("2", "\n  Local only. Pass --host 0.0.0.0 to let phones connect."),
    );
  }

  console.log(style("2", "\n  Ctrl+C to stop.\n"));

  if (shouldOpen) {
    // The plain address on purpose: this is `localhost`, which is a secure
    // context either way, so the owner meets the editor rather than a
    // certificate warning on the machine that issues the certificate.
    openBrowser(`${localPlain}/editor`);
  }

  // One stop path, for Exit, a lost tray and both signals. Created before the
  // tray starts because its callbacks and the failure path below both use it.
  // In tray mode the tray owns the process lifetime; in foreground mode the
  // terminal does, and the same function serves both.
  let stopHost: (() => void) | undefined;
  let stopping = false;
  const stopped = new Promise<void>((resolve) => {
    const stop = (): void => {
      if (stopping) {
        return;
      }

      stopping = true;
      console.log("\nStopping.");
      // The tray first: an icon left behind is one the owner cannot dismiss. A
      // throwing view must not skip the server close below.
      try {
        tray?.stop();
      } catch (error) {
        console.error(
          `The tray could not close: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      try {
        // Stop only the LHM this run started; one the owner already ran is theirs.
        externalApps.stopOwnedLhm();
        // The media helper is a child process this run started; leaving it
        // polling after the host exits would orphan it.
        mediaProvider.stop();
        // Same for the RTSS helper: a PowerShell left polling outlives the host.
        frameProvider.stop();
        // The game helper is the same shape: a PowerShell left polling would
        // outlive the host.
        gameProvider.stop();
        // Every per-source timer goes with it, and an in-flight fetch is cut.
        customProvider.stop();
        // The windows close with the host: one left behind is one the next run
        // cannot see, and it would put a second window on that monitor.
        launcher?.stop();
      } finally {
        // A throwing stop must not leave the server listening with no tray.
        void (async () => {
          // Plugin workers stop before the panels: a child left polling would
          // outlive the host that owned it. The supervisors are shared by the
          // provider and asset-source adapters, so they are stopped once here.
          try {
            await runningSupervisors.stop();
          } catch (error) {
            console.error(
              `The plugin workers could not stop: ${error instanceof Error ? error.message : String(error)}`,
            );
          }

          // Every device handle a plugin still holds goes with its worker.
          for (const plugin of installedPlugins) {
            await deviceBroker.closeAll(plugin.key);
          }

          // The panels before the server: a runner still opening has to be
          // awaited, or its device and STOP_VIDEO outlive the host that owned
          // them. A refusal is logged and the close continues.
          try {
            await panels?.stopAll();
          } catch (error) {
            console.error(
              `The panels could not close: ${error instanceof Error ? error.message : String(error)}`,
            );
          }

          await hosted.close().then(resolve, resolve);
        })();
      }
    };

    stopHost = stop;
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });

  if (trayMode) {
    // After the server answers: LHM's launch is a probe plus a spawn, and a
    // tray host that failed to start must not leave it running.
    void externalApps.startLhm().then((result) => {
      if (!result.ok && result.reason !== undefined) {
        console.error(`LibreHardwareMonitor: ${result.reason}`);
      }
    });

    try {
      tray = await startTray({
        linuxBinary: path.join(
          here,
          "..",
          "vendor",
          "tray",
          "tray_linux_release",
        ),
        readSnapshot: async () => {
          const [lhm, rtss] = await Promise.all([
            externalApps.lhmState(),
            externalApps.rtssState(),
          ]);
          return {
            port: bound,
            // `isLan` alone: the menu never shows the address, and `state()`
            // would query the OS route table on every 5 s poll.
            lan: lanBinding?.isLan() ?? false,
            autostart: autostart.state(),
            mcp: mcpBinPath(packageRoot()) !== undefined,
            lhm,
            rtss,
          };
        },
        act: async (action) => {
          switch (action) {
            case "autostart":
              return autostart.toggle(entry);
            case "pair":
            case "editor":
            case "themes":
            case "settings":
            case "folder":
              return openTrayAction(action, { localPlain, settingsDir });
            case "mcp": {
              const bin = mcpBinPath(packageRoot());
              if (bin === undefined) {
                return {
                  ok: false,
                  message: "The MCP tools are not installed in this package.",
                };
              }
              // A console window is the menu's only surface: the editor and
              // settings pages are in-process, but the installer is a CLI.
              const launch = mcpConsoleLaunch(bin);
              const child = spawn(launch.command, launch.args, {
                detached: true,
                stdio: "ignore",
                windowsHide: true,
              });
              child.unref();
              return { ok: true, message: "Opened the agent tools." };
            }
            case "lhm":
              return externalApps.startLhm();
            case "rtss":
              return externalApps.startRtss();
            case "exit":
              stopHost?.();
              return { ok: true, message: "Stopping." };
          }
        },
        onLost: (reason) => {
          console.error(`The tray stopped: ${reason}`);
          stopHost?.();
        },
        // The controller closes its own view on Exit and never dispatches the
        // action to `act`, so this is what stops the host behind it.
        onExit: () => stopHost?.(),
      });

      // The view can be live while `tray` is still undefined, so a stop that
      // arrived during the await missed it; close the tray that just appeared.
      if (stopping) tray.stop();
    } catch (error) {
      // A host that cannot show a tray would run invisibly: report it, unwind
      // what this run already started, and exit the way the other early
      // failures do.
      console.error(error instanceof Error ? error.message : String(error));
      stopHost?.();
      await stopped;
      await held.lock.release();
      return 1;
    }
  }

  await stopped;
  await held.lock.release();
  return 0;
}
