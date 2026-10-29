# Operations

## Running the host

```bash
node packages/host/bin/yunari.js            # opens a browser
node packages/host/bin/yunari.js --no-browser
node packages/host/bin/yunari.js --host 0.0.0.0   # opt in to LAN
```

Defaults:

- Port `5227`, bound to `127.0.0.1`.
- App folder `%USERPROFILE%\.yunari` (`~/.yunari` elsewhere), with `themes/`,
  `settings/` and `cache/` beside them.
- HTTP and HTTPS on the same port. HTTPS uses a locally issued root and a leaf
  for the machine's current addresses.
- If the port is taken, binding walks upward for at most ten ports and reports
  the one it took.
- A host lock in `settings/` prevents two processes serving one app folder.

`--app-dir` moves the library and settings together; `--themes-dir` moves only
the library. `--lhm-url`, `--lhm-exe`, `--rtss-exe` and `--register-lhm-task`
control optional helper integrations. `--help` is the authoritative CLI
reference.

## Display onboarding

1. Start the host with `--host 0.0.0.0` and note the printed LAN address.
2. On the display, fetch `http://<lan-ip>:<port>/yunari-ca.crt` and trust the
   root. That route answers before every gate.
3. Open `https://<lan-ip>:<port>/`. Only a secure origin can hold the screen
   awake and register the service worker that makes the player installable.
4. Install it as an app from the browser menu.
5. Open the printed `/pair?code=…` link, or `/pair` and type the six-character
   code. Codes live ten minutes; one code is live at a time.

Pairing issues a durable display credential. Remove the display on the host to
revoke it.

## Security posture

- LAN serving is off by default. `--host 0.0.0.0` exposes hardware telemetry to
  the local network; plain HTTP there has no confidentiality. Never expose the
  host to the internet.
- The editor, settings page and pairing admin API are loopback-only even when
  the LAN is open.
- Provider credentials and the store session stay under `settings/` and are
  never sent to a browser.
- The TLS root's private key is stored encrypted in `settings/tls/`; only the
  certificate is in the clear. The leaf is reissued at startup and never stored.
- A pairing code is short and low-entropy by design: one live code, a bounded
  wrong-guess delay, and constant-time comparison. A successful claim consumes
  it; a wrong guess does not.

## Release process

- `release-please` runs on `main` and updates `src/web/package.json`, the
  manifest and the changelog. That package is the only place the product version
  is written.
- `publish.yml` is tag-driven. It gates, builds, stages a standalone package,
  packs it, installs the tarball in a clean directory, boots the host and checks
  `/api/health`, `/editor`, `/` and a weather icon before publishing.
- A manual dispatch is a **dry run unless `dry_run: false` is passed
  explicitly**. A real manual run requires the GitHub Release for the tag and a
  `vX.Y.Z` ref.
- **The first npm publish is manual and owner-run.** Trusted publishing cannot
  be configured before the package exists. After that, the repository/workflow
  binding applies from the second publish. Prereleases use the `next` dist-tag;
  stable releases use `latest`.
- Release assets are the `.tgz` and a staged-tree `.zip` attached to the GitHub
  Release.
- winget is not supported until a packaged Windows executable exists.

## CI

`.github/workflows/ci.yml` runs on `main`/`develop` pushes, PRs to `main`, and a
nightly schedule:

- **frontend** — install, `npm run gate`, typecheck, build player/editor/host and
  the control fixture, enforce the player size budget, install Chromium, run the
  Playwright suite under `xvfb-run`.
- **licences** — derive every non-workspace dependency from the manifests and
  require a mention in `THIRD-PARTY-NOTICES.md`. It fails if it derives no names
  at all.
- **audit** — run the dependency audit policy against the live registry and
  check the installed tree for missing packages.
- **nightly** — the slow display and rebuild suites, not the per-push steps.

Other workflows: `publish.yml` (release), `release.yml` (release-please) and
`visual-evidence.yml` (manual PNG capture). Actions are pinned by commit SHA;
`npm run workflows:check` enforces the pinning and the publish privilege split.

## Supply chain checks

`npm run gate` includes:

- `third-party:check` — every installed dependency against
  `THIRD-PARTY-NOTICES.md`.
- `ffmpeg:check` — the `ffmpeg-static` binary digest against
  `ffmpeg-static-hashes.json`.
- `workflows:check` — immutable action pins and publish job permissions.
- `docs:check` — every `plans/…md` reference resolves to a real file.
- `scratch:check` — no scratch residue outside sanctioned locations.

`npm run audit:check` is separate because it reads the registry; the gate keeps
its offline self-test.

## Store Worker deployment

The full runbook is
[`src/web/packages/store-worker/README.md`](../src/web/packages/store-worker/README.md).
The short path, from `src/web/packages/store-worker`:

```bash
npx wrangler login
npx wrangler d1 create yunari-store
npx wrangler r2 bucket create yunari-store-packages
# paste the printed database_id into wrangler.toml
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put OWNER_EMAILS
npx wrangler secret put MIGRATE_TOKEN
npx wrangler deploy
# replace BETTER_AUTH_URL with the printed origin, then deploy again
npx wrangler d1 migrations apply yunari-store --remote
curl -X POST https://<worker>/migrate -H "x-migrate-token: <MIGRATE_TOKEN>"
```

Register the OAuth callbacks
`https://<worker>/api/auth/callback/github` and
`https://<worker>/api/auth/callback/google`. Point
`CATALOGUE_ORIGIN` in `src/web/packages/renderer-core/src/theme/catalogue-location.ts`
at the deployed origin, then rebuild.

`wrangler.toml` ships placeholders for the D1 id and `BETTER_AUTH_URL`; both must
be replaced before the store works. Secrets are set with `wrangler secret put`,
never committed. The cron `*/15 * * * *` cleans abandoned uploads. The Worker's
`/migrate` route creates better-auth tables; the D1 SQL migrations create the
catalogue tables. Both are safe to re-run.

The Free plan allows 10 ms CPU per invocation; the runbook's step 11 describes
the measurement and the Paid-plan threshold.
