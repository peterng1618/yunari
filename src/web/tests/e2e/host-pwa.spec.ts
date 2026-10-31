import { type ChildProcess, spawn } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { HOST_THEME_ID, HOST_THEMES_DIR, hostClient } from "./host-theme.js";
import { requiredLanAddress } from "./lan-address.js";

/**
 * The reading `vg-577` was filed for: the player installs as an app, and its
 * shell survives the network going away.
 *
 * **At the LAN address, never loopback.** A worker needs a secure context, and
 * `localhost` is one whatever the host does — the trap Task 25.8's own row
 * exists to remove. So this file starts its own host bound to `0.0.0.0` and
 * launches its own browser, the way `host-secure-origin.spec.ts` does, and
 * allowlists the root the host issues rather than installing it.
 *
 * **The reading is Chromium's own.** `Page.getInstallabilityErrors` is the
 * browser saying whether it would install this, and it is the only instrument
 * that distinguishes a manifest that is merely served from one that is
 * accepted. It needs a *persistent* profile: Playwright's default context
 * reports `in-incognito`, where Chrome short-circuits the check and every
 * manifest looks installable.
 *
 * **No phone was available.** Everything here is Chromium on Windows through
 * Playwright, and anything this file says about iOS or Android is written down
 * rather than measured.
 */

/** Its own port and its own app folder: the shared host on 4175 is bound to
 *  loopback, and this reading cannot be taken there. 4233 belongs to the
 *  secure-origin proof. */
const PORT = 4235;
const APP_DIR = path.join(process.cwd(), ".e2e-host-app-pwa");
const CA_FILE = path.join(APP_DIR, "settings", "tls", "ca.crt");
const PLAYER_BUNDLE = path.join(process.cwd(), "packages", "player", "dist");

/** Chrome takes base64 SHA-256 of a certificate's SubjectPublicKeyInfo. */
function spkiHash(pem: string): string {
  const der = new X509Certificate(pem).publicKey.export({
    type: "spki",
    format: "der",
  });
  return createHash("sha256").update(der).digest("base64");
}

/** A paired display's URL: the session it was given, the theme it shows, and
 *  the live data the host serves rather than the standalone fixture. */
function displayUrl(origin: string, token: string): string {
  const query = new URLSearchParams({
    session: token,
    theme: HOST_THEME_ID,
    data: "live",
  });
  return `${origin}/?${query.toString()}`;
}

test.describe("the player as an installed app", () => {
  let host: ChildProcess | undefined;
  let origin = "";
  let token = "";
  let authority = "";
  let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>>;
  let profileDir = "";
  /** Named in every reading, because a manifest's verdict is the client's. */
  let clientVersion = "";

  test.beforeAll(async () => {
    if (!existsSync(path.join(PLAYER_BUNDLE, "sw.js"))) {
      throw new Error(
        "The player bundle is not built. Run: npx vite build packages/player",
      );
    }

    rmSync(APP_DIR, { recursive: true, force: true });
    mkdirSync(APP_DIR, { recursive: true });
    // The host reads its library at startup, and the shared fixture is what
    // globalSetup already seeded — copied rather than rebuilt so a display here
    // is the same display the other host specs drive.
    cpSync(HOST_THEMES_DIR, path.join(APP_DIR, "themes"), { recursive: true });

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
    let ready = false;
    for (let attempt = 0; attempt < 120 && !ready; attempt += 1) {
      try {
        ready = (await probe.get("/api/health")).ok();
      } catch {
        /* not up yet */
      }
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 250));
    }

    if (!ready) {
      await probe.dispose();
      host.kill();
      throw new Error(`the host never answered on ${PORT}`);
    }

    // Pairing is an admin action and is loopback-only, so the credential a
    // display carries is minted from here rather than from the phone. The route
    // answers it once, beside the display it belongs to: the record holds only
    // its hash, so nothing can hand it back a second time.
    const paired = await probe.post("/api/pairing/sessions?label=pwa");
    token = ((await paired.json()) as { token: string }).token;
    await probe.dispose();

    authority = await readFile(CA_FILE, "utf8");
    origin = `https://${requiredLanAddress()}:${PORT}`;

    profileDir = path.join(os.tmpdir(), `yunari-pwa-profile-${PORT}`);
    rmSync(profileDir, { recursive: true, force: true });
    browser = await chromium.launchPersistentContext(profileDir, {
      // Headed: the installability check is Chrome's own and this is the
      // client a phone is being stood in for. The certificate is allowlisted
      // rather than bypassed — a bypassed chain is refused for
      // `serviceWorker.register` with `SecurityError`.
      headless: false,
      args: [
        `--ignore-certificate-errors-spki-list=${spkiHash(authority)}`,
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });
    clientVersion = browser.browser()?.version() ?? "unknown";
  });

  test.afterAll(async () => {
    await browser?.close();
    if (profileDir !== "") rmSync(profileDir, { recursive: true, force: true });
    host?.kill();
    rmSync(APP_DIR, { recursive: true, force: true });
  });

  test("serves a manifest the browser accepts and a worker that controls the document", async () => {
    const page = await browser.newPage();
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(error.message));

    await page.goto(displayUrl(origin, token), {
      waitUntil: "domcontentloaded",
    });
    // The registration happens on load; `ready` waits for an active worker,
    // and the controller arrives when its `activate` claims this client.
    // `!= null` and not `!== null`: where the API is absent the optional chain
    // is `undefined`, and `undefined !== null` is true — a wait that never waits.
    await page.waitForFunction(
      () => navigator.serviceWorker?.controller != null,
      undefined,
      { timeout: 30_000 },
    );

    const reading = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      const response = await fetch("/manifest.webmanifest");
      const manifest = (await response.json()) as Record<string, unknown>;
      return {
        origin: location.origin,
        isSecureContext: window.isSecureContext,
        scope: registration.scope,
        controller: navigator.serviceWorker.controller?.scriptURL ?? null,
        manifestContentType: response.headers.get("content-type"),
        display: manifest["display"],
        startUrl: manifest["start_url"],
        manifestScope: manifest["scope"],
        icons: manifest["icons"],
      };
    });

    const session = await page.context().newCDPSession(page);
    const appManifest = await session.send("Page.getAppManifest");
    const installability = await session.send("Page.getInstallabilityErrors");

    // The reading is the evidence, and a green run otherwise keeps none.
    await test.info().attach("pwa-install-reading.json", {
      body: JSON.stringify(
        {
          client: `Chromium ${clientVersion}`,
          reading,
          appManifestErrors: appManifest.errors,
          installabilityErrors: installability.installabilityErrors,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });

    expect(reading.isSecureContext).toBe(true);
    expect(reading.origin).toBe(origin);
    // The scope is the whole origin, which is what lets the worker serve the
    // player's own document: a worker under `/assets/` could not.
    expect(reading.scope).toBe(`${origin}/`);
    expect(reading.controller).toBe(`${origin}/sw.js`);
    expect(reading.manifestContentType).toBe("application/manifest+json");
    // `standalone` is the point of the row, not a detail: it is what draws
    // without browser chrome on a client that has no fullscreen API.
    expect(reading.display).toBe("standalone");
    expect(reading.startUrl).toBe("/");
    expect(reading.manifestScope).toBe("/");
    expect(appManifest.errors).toEqual([]);
    // Chrome's own verdict, which is the only instrument that tells a manifest
    // that is served from one that is accepted.
    expect(installability.installabilityErrors).toEqual([]);
    expect(failures).toEqual([]);

    await page.close();
  });

  test("shows the shell and no reading when the network is gone", async () => {
    const page = await browser.newPage();

    await page.goto(displayUrl(origin, token), {
      waitUntil: "domcontentloaded",
    });
    // `!= null` and not `!== null`: where the API is absent the optional chain
    // is `undefined`, and `undefined !== null` is true — a wait that never waits.
    await page.waitForFunction(
      () => navigator.serviceWorker?.controller != null,
      undefined,
      { timeout: 30_000 },
    );
    // One navigation the worker controls: the first load is not controlled
    // until `activate` claims it, so this is the one that fills the cache.
    await page.reload({ waitUntil: "load" });
    await expect(page.locator("[data-yunari-load-failure]")).toHaveCount(0);

    const context = page.context();
    await context.setOffline(true);
    await page.reload({ waitUntil: "load" });

    // The shell is the cached document, so the player's own page renders at
    // all; the theme it names is behind `/api/**`, which is never cached, so
    // what a reader gets is the failure page rather than yesterday's numbers.
    const offline = await page.evaluate(async () => {
      const cached: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) cached.push(request.url);
      }

      const telemetry = await fetch(
        `/api/themes/${"e2e-hosted"}/document`,
      ).then(
        () => "served",
        () => "refused",
      );

      return {
        origin: location.origin,
        title: document.title,
        controller: navigator.serviceWorker.controller?.scriptURL ?? null,
        failurePage: document.querySelector("[data-yunari-load-failure]")
          ? "shown"
          : "absent",
        reason:
          document.querySelector("[data-yunari-load-failure-reason]")
            ?.textContent ?? null,
        cached,
        telemetry,
      };
    });

    await test.info().attach("pwa-offline-reading.json", {
      body: JSON.stringify(
        { client: `Chromium ${clientVersion}`, offline },
        null,
        2,
      ),
      contentType: "application/json",
    });

    expect(offline.origin).toBe(origin);
    expect(offline.controller).toBe(`${origin}/sw.js`);
    // The document came from the cache — the browser's own offline page has
    // neither of these.
    expect(offline.failurePage).toBe("shown");
    expect(offline.title).toContain("Yunari");
    // Nothing under `/api/**` is in any cache, so no reading can be served
    // from one. Asserted on the cache's own contents rather than on a count.
    expect(offline.cached.length).toBeGreaterThan(0);
    expect(
      offline.cached.filter((url) => new URL(url).pathname.startsWith("/api/")),
    ).toEqual([]);
    expect(offline.telemetry).toBe("refused");

    await context.setOffline(false);
    await page.close();
  });

  test("keeps the display's session out of the cache it writes", async () => {
    const page = await browser.newPage();

    await page.goto(displayUrl(origin, token), {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(
      () => navigator.serviceWorker?.controller != null,
      undefined,
      { timeout: 30_000 },
    );
    // The navigation that writes the entry is one the worker controls.
    await page.reload({ waitUntil: "load" });

    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) urls.push(request.url);
      }
      return urls;
    });

    await test.info().attach("pwa-cache-keys.json", {
      body: JSON.stringify(
        { client: `Chromium ${clientVersion}`, token, cached },
        null,
        2,
      ),
      contentType: "application/json",
    });

    // **The credential, not the entry count, and asserted first** so that the
    // case fails on the token rather than on the shape of the key. The
    // display's URL carries its session, so keying the entry by that URL
    // writes the token to a store that outlives clearing history and that the
    // host cannot reach to clear on revoke. Every key in every cache.
    expect(cached.filter((url) => url.includes(token))).toEqual([]);
    // And the document *is* cached — otherwise "no credential in the cache"
    // would pass on a cache that holds nothing.
    expect(cached).toContain(`${origin}/`);

    await page.close();
  });
});
