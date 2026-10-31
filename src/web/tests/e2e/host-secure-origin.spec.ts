import { type ChildProcess, spawn } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { hostClient } from "./host-theme.js";
import { requiredLanAddress } from "./lan-address.js";

/**
 * The reading `vg-580` was filed for, taken where it matters.
 *
 * **At the LAN address, never loopback.** `localhost` is a secure context
 * whatever the host does, so a run against it reports `isSecureContext: true`,
 * a granted wake lock and a registered service worker on a host that serves
 * plain http — the trap the row exists to remove, and the reason Task 25.8's
 * measurement is taken rather than re-derived here.
 *
 * **The browser is launched by this file, with the host's root allowlisted**,
 * rather than taken from the runner. `ignoreHTTPSErrors` is not enough and the
 * difference is the whole task: a bypassed certificate still earns the secure
 * context and still grants the wake lock, and it is *refused* for
 * `serviceWorker.register` with `SecurityError` — measured, Task 25.8. Chrome
 * only treats the origin as trustworthy when the chain actually validates,
 * which is what `--ignore-certificate-errors-spki-list` arranged in that
 * measurement and what this file arranges for the root the host now issues.
 *
 * **No phone was available.** Everything below is Chromium 153 on Windows 11
 * through Playwright 1.63, and anything this file says about iOS or Android is
 * written down rather than measured.
 */

/** Its own port and its own app folder: the shared host on 4175 is bound to
 *  loopback, and this reading cannot be taken there. */
const PORT = 4233;
const APP_DIR = path.join(process.cwd(), ".e2e-host-app-secure");
const CA_FILE = path.join(APP_DIR, "settings", "tls", "ca.crt");

/**
 * The script the page registers. Written into the served bundle's `assets/`
 * directory for the length of the run: registering a service worker needs a
 * same-origin script, and the host has none to offer — `vg-577`'s PWA is Task
 * 25.6, which follows this one. What this file proves is that the *origin*
 * admits a registration, not that a worker does anything yet.
 *
 * **`assets/` and not the root, because the host refuses an unpaired display
 * the root.** A script at `/e2e-sw-probe.js` is neither a bundle asset nor
 * `/favicon.svg`, so it meets `server.ts`'s pairing guard and the registration
 * fails with `A bad HTTP response code (403) was received when fetching the
 * script` — measured, and not a fact about the origin. The bundle-asset
 * allowlist is the one path an unpaired display may fetch, and a real service
 * worker has to be on it. That is Task 25.6's problem and it is reported rather
 * than solved here.
 */
const PROBE = "e2e-sw-probe.js";
const PROBE_FILE = path.join("assets", PROBE);
const PROBE_URL = `/assets/${PROBE}`;
const PROBE_SOURCE =
  "self.addEventListener('install', () => self.skipWaiting());\n";
const PLAYER_BUNDLE = path.join(process.cwd(), "packages", "player", "dist");

/** Chrome takes base64 SHA-256 of a certificate's SubjectPublicKeyInfo. */
function spkiHash(pem: string): string {
  const der = new X509Certificate(pem).publicKey.export({
    type: "spki",
    format: "der",
  });
  return createHash("sha256").update(der).digest("base64");
}

test.describe("the host's secure origin", () => {
  let host: ChildProcess | undefined;
  let bundleCreated = false;

  test.beforeAll(async () => {
    rmSync(APP_DIR, { recursive: true, force: true });
    bundleCreated = !existsSync(PLAYER_BUNDLE);
    mkdirSync(path.dirname(path.join(PLAYER_BUNDLE, PROBE_FILE)), {
      recursive: true,
    });
    writeFileSync(path.join(PLAYER_BUNDLE, PROBE_FILE), PROBE_SOURCE);

    host = spawn(
      "node",
      [
        "packages/host/bin/yunari.js",
        "--no-browser",
        "--port",
        String(PORT),
        // `0.0.0.0` is the point: a host bound to loopback has no LAN origin
        // to read, and a case that ran anyway would be reading the trap.
        "--host",
        "0.0.0.0",
        "--app-dir",
        APP_DIR,
      ],
      { cwd: process.cwd(), stdio: "ignore" },
    );

    // The host mints its root before it binds, so a host that answers has a
    // certificate on disk. Polled over a client that ignores the certificate:
    // the readiness of the socket is not the claim, and this is not the reading.
    const probe = await hostClient(`https://127.0.0.1:${PORT}`);
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        if ((await probe.get("/api/health")).ok()) {
          await probe.dispose();
          return;
        }
      } catch {
        /* not up yet */
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    await probe.dispose();
    host.kill();
    throw new Error(`the host never answered on ${PORT}`);
  });

  test.afterAll(() => {
    host?.kill();
    rmSync(path.join(PLAYER_BUNDLE, PROBE_FILE), { force: true });
    if (bundleCreated) rmSync(PLAYER_BUNDLE, { recursive: true, force: true });
    rmSync(APP_DIR, { recursive: true, force: true });
  });

  test("grants a wake lock and registers a service worker at the LAN address", async () => {
    // The root the host issued, which is the certificate a phone installs —
    // allowlisting *it* rather than the leaf is the model of a device that has
    // done that step, and the leaf is re-issued at every start.
    const authority = await readFile(CA_FILE, "utf8");
    const address = requiredLanAddress();
    const origin = `https://${address}:${PORT}`;

    // **Headed, because headless refuses the wake lock on any origin.**
    // Measured twice: Task 25.8's own measurement, and this file's first run,
    // which read `NotAllowedError: Wake Lock permission request denied` on a
    // secure origin whose chain the same browser had just validated. A headless
    // reading of the wake lock is therefore not a reading of the origin at all.
    const browser = await chromium.launch({
      headless: false,
      args: [`--ignore-certificate-errors-spki-list=${spkiHash(authority)}`],
    });

    try {
      const page = await browser.newPage();
      const failed: string[] = [];
      page.on("pageerror", (error) => failed.push(error.message));

      await page.goto(origin, { waitUntil: "domcontentloaded" });

      const reading = await page.evaluate(async (script) => {
        const report: Record<string, unknown> = {
          origin: location.origin,
          isSecureContext: window.isSecureContext,
          hasWakeLock: "wakeLock" in navigator,
          hasServiceWorker: "serviceWorker" in navigator,
        };

        try {
          const sentinel = await navigator.wakeLock.request("screen");
          report["wakeLockGranted"] = true;
          report["wakeLockState"] = sentinel.type;
          await sentinel.release();
        } catch (error) {
          report["wakeLockGranted"] = false;
          report["wakeLockError"] = String(error);
        }

        try {
          const registration = await navigator.serviceWorker.register(script);
          report["serviceWorker"] = "registered";
          report["serviceWorkerScope"] = registration.scope;
        } catch (error) {
          report["serviceWorker"] = `refused: ${String(error)}`;
        }

        return report;
      }, PROBE_URL);

      // The three APIs the row names, each named in the reading rather than
      // summarised, so a failure says which one and why.
      expect(reading, JSON.stringify(reading)).toMatchObject({
        origin,
        isSecureContext: true,
        hasWakeLock: true,
        wakeLockGranted: true,
        hasServiceWorker: true,
        serviceWorker: "registered",
      });
      expect(failed).toEqual([]);

      // The reading is the evidence, and a green run otherwise keeps none: the
      // assertion message that carries it is only printed when it fails.
      await test.info().attach("secure-origin-reading.json", {
        body: JSON.stringify(
          { client: `Chromium ${browser.version()}`, reading },
          null,
          2,
        ),
        contentType: "application/json",
      });
    } finally {
      await browser.close();
    }
  });
});
