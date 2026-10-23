import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatalogueIndexCommand } from "./catalogue/build-index.js";
import { DEFAULT_HOST, isLoopbackHost, parseArgs } from "./cli/args.js";
import { createHostBinding, type HostBinding } from "./cli/hosting.js";
import {
  lanAddress,
  listenWithFallback,
  localNames,
  openBrowser,
  waitUntilReachable,
} from "./cli/net.js";
import { ClockSensorProvider } from "./providers/clock.js";
import { LhmSensorProvider } from "./providers/lhm.js";
import { launchLhm, registerLhmTask } from "./providers/lhm-launcher.js";
import { LibrarySensorProvider } from "./providers/library.js";
import { ProviderRegistry } from "./providers/registry.js";
import {
  createDisplayLauncher,
  type Launcher,
  registerHostAutostart,
} from "./serve/display-launcher.js";
import { CA_CERTIFICATE_PATH, createHostServer } from "./server.js";
import { createPairingCodeStore } from "./session/pairing-code.js";
import { createActiveThemeStore } from "./settings/active-theme.js";
import { createCredentialStore } from "./settings/credentials.js";
import { createDeviceSettingsStore } from "./settings/devices.js";
import { createDisplaySettingsStore } from "./settings/display.js";
import { createDisplayStore } from "./settings/displays.js";
import { createFontFavoritesStore } from "./settings/font-favorites.js";
import { acquireHostLock } from "./settings/host-lock.js";
import { readOrMintHostRecord } from "./settings/host-record.js";
import { createHostingSettingsStore } from "./settings/hosting.js";
import { createStoreSessionStore } from "./settings/store-session.js";
import { createThemeOriginsStore } from "./settings/theme-origins.js";
import { createThemeSettingsStore } from "./settings/theme-settings.js";
import { normalizeVideoCommand } from "./themes/normalize-video.js";
import { createThemeStore } from "./themes/store.js";
import { createThumbnailStore } from "./themes/thumbnails.js";
import { createSecureOrigin, type SecureOrigin } from "./tls/authority.js";
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

const VERSION = productVersion();

/** The product's version, read from the workspace manifest — the one place a
 *  release writes it (`vg-279`). The editor bundle reads the same field through
 *  Vite's `define`, so neither reader carries a copy of the number. */
function productVersion(): string {
  const manifest = path.join(here, "..", "..", "..", "package.json");
  return (JSON.parse(readFileSync(manifest, "utf8")) as { version: string })
    .version;
}

/** The staged LibreHardwareMonitor, for setup commands that need a default. */
function defaultLhmExecutable(): string {
  return path.join(here, "..", "vendor", "lhm", "LibreHardwareMonitor.exe");
}

/**
 * The command that starts this host again, for the sign-in task: this
 * interpreter, the shim it was started through, and the flags this run was
 * given, so the host that comes back is the same host with the same app folder.
 *
 * `-n` because a host that starts at sign-in is bringing back the displays; a
 * dashboard tab in the default browser at every login is not part of that.
 */
function hostCommand(argv: readonly string[]): string {
  return [
    process.execPath,
    path.join(here, "..", "bin", "yunari.js"),
    ...argv,
    "-n",
  ]
    .map((part) => `"${part}"`)
    .join(" ");
}

export async function run(argv: readonly string[]): Promise<number> {
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
    themesDir,
    settingsDir,
    lhmUrl,
    lhmExecutable,
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

  // One app folder is one host (§ "Two hosts on one network"), and the lock is
  // taken before anything reads the folder: a second host against a held folder
  // would answer the same display ids and the same active theme as the first,
  // and the port fallback would let it start looking like a second machine.
  const held = await acquireHostLock(settingsDir, wanted);

  if (!held.ok) {
    console.error(held.reason);
    return 1;
  }

  // Launching LHM is opt-in via `--lhm-exe`, never automatic: its manifest
  // requires administrator rights, so starting it unattended would raise a UAC
  // prompt on every host start. The provider reads whichever server answers,
  // whether Yunari launched it or the owner already runs it.
  const lhm =
    lhmExecutable === undefined
      ? { started: false, stop: (): void => undefined }
      : await launchLhm({
          executable: lhmExecutable,
          baseUrl: lhmUrl,
          timeoutMs: 20_000,
        });

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
  const registry = new ProviderRegistry([
    clockProvider,
    lhmProvider,
    libraryProvider,
  ]);
  const here = path.dirname(fileURLToPath(import.meta.url));
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
  // folder, so a theme folder is only ever a theme (ADR-0017).
  const deviceSettings = createDeviceSettingsStore(settingsDir);
  // The consumer's display preferences, read by the provider that acquires the
  // readings they apply to.
  const displaySettings = createDisplaySettingsStore(settingsDir);
  // Which theme this host displays; consumer state beside the device choices.
  const activeTheme = createActiveThemeStore(settingsDir);
  // Which curated font trios this author reaches for. Author preference about
  // this PC, so it sits with the other settings and never in a theme folder.
  const fontFavorites = createFontFavoritesStore(settingsDir);
  // Provider keys, in the same directory and with the same rules: the browser
  // may write one and never read it back.
  const credentials = createCredentialStore(settingsDir);
  // The store session the author signed in to, beside the other records this
  // machine keeps. The browser never reads it; the host uses it to submit.
  // Which store it belongs to is a build-time address, passed at the server
  // below rather than stored here.
  const storeSession = createStoreSessionStore(settingsDir);
  // Which host this app folder is, read or minted after the lock so a second
  // host cannot answer with the same identity: `GET /api/host` gives it to
  // anyone who asks, and it is what a display stores to re-find this host after
  // its address changes (§ "Finding the host after its address changes").
  const hostRecord = await readOrMintHostRecord(settingsDir);

  // The certificate is not optional, and the reason is the origin rather than
  // any route: a phone at `http://<lan-ip>:<port>` is not a secure context, so
  // it can neither hold a screen wake lock nor register the service worker an
  // installable app needs (`vg-580`, `docs/decisions/0070`). Serving plain http
  // would fail on the display and pass on this PC, which is the trap the row
  // exists to remove — so a host that cannot produce a certificate refuses to
  // start and says which directory it could not write, rather than starting
  // into an origin that is known to be wrong.
  let origin: SecureOrigin;
  try {
    origin = await createSecureOrigin(
      path.join(settingsDir, "tls"),
      localNames(),
    );
  } catch (error) {
    console.error(
      `Could not prepare a certificate in ${path.join(settingsDir, "tls")}: ` +
        `${error instanceof Error ? error.message : String(error)}\n` +
        "  The host serves https so a display can hold the screen awake and " +
        "install as an app; without one it will not start.",
    );
    await held.lock.release();
    return 1;
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

  const hosted = createHostServer({
    registry,
    // The leaf, signed by the root a display installs once. In memory only:
    // a leaf is disposable, which is what makes a moved address free.
    tls: { key: origin.key, cert: origin.chain },
    // And the root itself, for the device that has to trust it before it can
    // read anything else.
    caCertificate: origin.certificate,
    // Who this host is, so a display that has lost its address can ask.
    host: hostRecord,
    // The host's own windows on its local monitors (§ "The host's own monitors").
    get launcher() {
      return launcher;
    },
    // One entry at sign-in covers every local monitor, including one added
    // later. Registering needs an elevated shell, so this only ever asks; a
    // refusal is answered with the registrar's own message.
    registerAutostart: () => registerHostAutostart(hostCommand(argv)),
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
    themeStore: createThemeStore(themesDir),
    // The Steam library on this PC, read on demand: the install is located per
    // listing, because a library can appear while the editor is open.
    wallpaperEngine: createWallpaperEngineSource(),
    // A thumbnail is this machine's rendering of a theme, so it lives in that
    // theme's own folder rather than in a directory of its own. The editor
    // writes it after the save that replaced the folder, which is why the
    // library always has a picture for what was just saved.
    thumbnails: createThumbnailStore(themesDir),
    themeSettings: createThemeSettingsStore(settingsDir),
    // Beside the answers and from the same directory: where a copy came from is
    // this machine's own record about a theme, like what a consumer answered
    // for it — not part of the author's folder.
    themeOrigins: createThemeOriginsStore(settingsDir),
    storeSession,
    displays,
    pairingCodes,
    devices: deviceSettings,
    display: displaySettings,
    fontFavorites,
    credentials,
    assets: { credentials },
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

  const displayHost =
    initialHost === "0.0.0.0" || initialHost === "::"
      ? "localhost"
      : initialHost;
  /** https first, http beside it: a display is a secure context only at the
   *  https origin, and the plain address is what a device that has not
   *  installed the root certificate can still open (`docs/decisions/0076`). */
  const localSecure = `https://${displayHost}:${bound}`;
  const localPlain = `http://${displayHost}:${bound}`;
  /** The address a display would use, whether or not the LAN is open — the
   *  certificate covers it either way, and the console names it. */
  const lan = await lanAddress();

  console.log(`\nYunari v${VERSION}`);

  if (bound !== wanted) {
    console.log(
      style("33", `Port ${wanted} was busy, so this is on ${bound}.`),
    );
  }

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
      `  Certificate  ${origin.certificatePath}` +
        `\n  This host serves https on the same port, and a display holds the` +
        `\n  screen awake and installs as an app only there. Install this root` +
        `\n  once per device, this PC included:` +
        `\n    Fetch the root over http, so no warning is in the way:` +
        `\n      http://${lan ?? displayHost}:${bound}${CA_CERTIFICATE_PATH}` +
        `\n    Then open the display at:` +
        `\n      https://${lan ?? displayHost}:${bound}` +
        "\n  A device without it shows a certificate warning, not a broken display.",
    ),
  );

  // Say what the extended sensors will do, rather than leaving the display to
  // show gaps without explanation.
  if (lhm.started) {
    console.log(style("2", `  LibreHardwareMonitor started for ${lhmUrl}`));
  } else if (lhm.reason !== undefined) {
    console.log(
      style(
        "33",
        `  Extended sensors unavailable: ${lhm.reason}` +
          "\n  Baseline sensors still work; temperature and fan keys will be gaps.",
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
    const networkSecure = `https://${hostPart}:${bound}`;
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
    const code = pairingCodes.mint();
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

  // Process lifetime belongs to the terminal until a tray host exists.
  await new Promise<void>((resolve) => {
    let stopping = false;
    const stop = (): void => {
      if (stopping) {
        return;
      }

      stopping = true;
      console.log("\nStopping.");
      // Stop only the LHM this run started; one the owner already ran is theirs.
      lhm.stop();
      // The windows close with the host: one left behind is one the next run
      // cannot see, and it would put a second window on that monitor.
      launcher?.stop();
      void hosted.close().then(resolve, resolve);
    };

    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });

  await held.lock.release();
  return 0;
}
