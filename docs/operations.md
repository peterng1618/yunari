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

## Extensions

Everything an extension owns lives under the app folder's `settings/extensions/`,
and the executable profiles' grants live in `settings/extension-consent.json`:

- `local/<id>/<version>/` is one installed package tree; `installed.json` is the
  live index.
- `data/<publisher>/<id>/` is the plugin's keyed data, `secrets/<publisher>/<id>/`
  its secret store (wrapped by the same OS key protector as the TLS root) and
  `settings/<publisher>/<id>.json` its settings document.
- `provider-order.json` is the plugin provider precedence the host serves at
  `/api/extensions/provider-order`.

Installing, granting consent and removing are host API calls on loopback:
`POST /api/extensions/install`, `POST /api/extensions/<publisher>/<id>/consent`
and `DELETE /api/extensions/<publisher>/<id>`. No editor control ships for them
yet. The delete removes the install tree and its grant, but leaves the plugin's
`data/`, `secrets/` and `settings/` scopes in place; delete those directories
under `settings/extensions/` when the data should go too.

A plugin that cannot start or crashes is reported once on the host console as
`Plugin worker <publisher>/<id>: <reason>`. A start failure contributes no
readings or asset rows; a crashed plugin keeps its rows and reports failures.
Every other provider and source keeps answering; the failed plugin's keys
appear as gaps with a reason, never as zero. Restarting the host retries the
worker.

A trusted-worker plugin is ordinary Node code with this account's privileges:
the fork is not an OS sandbox, and the host mediates only what the plugin does
through the host API. Through that API a plugin never receives a host
credential. `network.fetch` reaches only the HTTPS hosts its manifest declares,
through the host's guarded fetch, and the plugin keeps any credential it needs
in its own secret scope. Extension routes stay loopback-only and origin-checked;
the LAN and admin rules above are unchanged.

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
  The key is wrapped by the OS key protector (DPAPI on Windows, the Secret
  Service on Linux). A machine with neither — a headless Linux box with no
  keyring — starts the host http-only and says so: there is nowhere to keep the
  root's key, and a LAN display then loses its wake lock and PWA install while
  every loopback surface still works.
- A pairing code is short and low-entropy by design: one live code, a bounded
  wrong-guess delay, and constant-time comparison. A successful claim consumes
  it; a wrong guess does not.

## Release process

- `release-please` runs on `main` and updates `src/web/package.json`, the
  manifest and the changelog. That package is the only place the product version
  is written.
- `publish.yml` is tag-driven. It gates, builds, stages two packages from the one
  build — `yunari`, which carries the host, player, editor, schema and the MCP
  server plus skill, and the standalone `yunari-mcp` — packs both, installs each
  tarball in its own clean directory, boots the host and checks `/api/health`,
  `/editor`, `/`, a weather icon, and that both MCP bins answer `--help`. Both
  tarballs publish at the same dist-tag.
- A manual dispatch is a **dry run unless `dry_run: false` is passed
  explicitly**. A real manual run requires the GitHub Release for the tag and a
  `vX.Y.Z` ref.
- **The first npm publish is manual and owner-run.** Trusted publishing cannot
  be configured before the package exists, and that applies to `yunari-mcp`
  separately. After that, the repository/workflow binding applies from the
  second publish. Prereleases use the `next` dist-tag; stable releases use
  `latest`.
- Reinstalling is the update path for the MCP server and the skill: neither has
  a version of its own, and `yunari mcp status` reports whether the installed
  copy still matches the packaged one.
- Release assets are the `.tgz` and a staged-tree `.zip` attached to the GitHub
  Release.
- **Licence closure ships with each release.** Before publishing, enumerate the
  complete runtime and transitive dependency closure from the lockfile, not just
  the direct dependencies, and ship every licence and NOTICE text that closure
  requires. `THIRD-PARTY-NOTICES.md` is the direct inventory the CI check
  compares against; it is not the closure.
- winget is not supported until a packaged Windows executable exists.

## CI

`.github/workflows/ci.yml` runs on `main`/`develop` pushes, PRs to `main`, and a
nightly schedule:

- **frontend** — install, `npm run gate`, typecheck, build player/editor/host,
  enforce the player size budget, install Chromium, run the
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
