# yunari-store — owner deployment runbook

The Worker, D1 database, R2 bucket and secrets in this file are created by the
**owner**. Nothing here has been run by the agent; the open issues carry what
stays unverified. The code is the authority for every binding named below
(`src/env.ts`, `src/auth.ts`, `src/index.ts`, `wrangler.toml`).

Run every command in this README from `src/web/packages/store-worker`
(`wrangler.toml` lives there), except steps 9–10, which state their directory.
Node 22 or newer (`engines` in `package.json`).
Wrangler is this package's devDependency (4.156.0).

## 1. Prerequisites

```bash
npx wrangler login
```

## 2. Create the resources

```bash
npx wrangler d1 create yunari-store
npx wrangler r2 bucket create yunari-store-packages
```

`d1 create` prints a `database_id`. Paste it into `[[d1_databases]]` in
`wrangler.toml`, replacing the `00000000-…` placeholder. Never invent an id: a
wrong one deploys against the wrong or a missing database. The bucket stays
private (its default); the Worker reaches it through the `BUCKET` binding, and
packages are uploaded through the Worker's own `/api/me/uploads/:id` route, so
no R2 credential is needed outside the binding.

## 3. Bindings the code reads

| Name | Kind | Source | Code symbol |
| --- | --- | --- | --- |
| `DB` | D1 binding | `yunari-store`, id from step 2 | `env.DB` |
| `BUCKET` | R2 binding | `yunari-store-packages` | `env.BUCKET` |
| `BETTER_AUTH_URL` | `[vars]` in `wrangler.toml` | the deployed origin, step 5 | `env.BETTER_AUTH_URL` |
| `BETTER_AUTH_SECRET` | secret | random 32+ byte string | `env.BETTER_AUTH_SECRET` |
| `GITHUB_CLIENT_ID` | secret | GitHub OAuth app | `env.GITHUB_CLIENT_ID` |
| `GITHUB_CLIENT_SECRET` | secret | GitHub OAuth app | `env.GITHUB_CLIENT_SECRET` |
| `GOOGLE_CLIENT_ID` | secret | Google OAuth client | `env.GOOGLE_CLIENT_ID` |
| `GOOGLE_CLIENT_SECRET` | secret | Google OAuth client | `env.GOOGLE_CLIENT_SECRET` |
| `OWNER_EMAILS` | secret | comma-separated owner emails | `env.OWNER_EMAILS` |
| `MIGRATE_TOKEN` | secret | random string | `env.MIGRATE_TOKEN` |

The upload is proxied: the Worker streams the body to `BUCKET` itself, so the
only R2 access it needs is the binding above.
`OWNER_EMAILS` is split on commas and compared case-insensitively
(`isOwner` in `src/auth/owner.ts`).

## 4. Set the secrets

One command per name; each prompts for the value.

```bash
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put OWNER_EMAILS
npx wrangler secret put MIGRATE_TOKEN
```

Where each value comes from:

- `BETTER_AUTH_SECRET` — any long random string (for example
  `openssl rand -base64 32`); Better Auth signs sessions with it.
- `GITHUB_CLIENT_*` — Settings → Developer settings → OAuth Apps → your app.
- `GOOGLE_CLIENT_*` — Google Cloud console → APIs & Services → Credentials →
  OAuth 2.0 Client.
- `OWNER_EMAILS` — the account(s) allowed to approve and unpublish, comma-separated.
- `MIGRATE_TOKEN` — any random string; you send the same value in step 6.

Setting secrets before the first deploy is fine: `wrangler secret put` offers to
create a draft Worker with that name.

## 5. Deploy and record the origin

```bash
npx wrangler deploy
```

It prints `https://yunari-store.<account-subdomain>.workers.dev`. That URL is
the origin everywhere below. `BETTER_AUTH_URL` in `wrangler.toml`'s `[vars]`
still holds a placeholder; replace it with the printed origin and deploy again.
Better Auth uses it as its `baseURL`, so a wrong value breaks sign-in and the
callback registration in step 7.

## 6. Create the D1 tables

The catalogue schema is `migrations/0001_catalogue.sql` (Wrangler's default
`migrations_dir` is `./migrations`). The Worker's `/migrate` route creates only
Better Auth's tables, so apply both:

```bash
npx wrangler d1 migrations apply yunari-store --remote
curl -X POST https://<worker>/migrate -H "x-migrate-token: <MIGRATE_TOKEN>"
```

`/migrate` answers `{"ok":true}`; a missing `x-migrate-token` header answers
404, a wrong value 403 (`migrate` in `src/index.ts`). Re-running either is safe.

## 7. Register the OAuth callback URLs

Register these exact URLs with GitHub and Google:

```text
https://<worker>/api/auth/callback/github
https://<worker>/api/auth/callback/google
```

They are Better Auth's own routes: base path `/api/auth`, provider ids from
`src/auth.ts`'s `socialProviders`. The Worker's `/auth/start` is the host's
entry point into the flow, not a callback — do not register it.

## 8. Health

```bash
curl https://<worker>/api/health
```

Expected: `{"ok":true}` (`fetch` in `src/index.ts`).

## 9. Point the clients at the Worker

Edit `src/web/packages/renderer-core/src/theme/catalogue-location.ts`:
`CATALOGUE_ORIGIN` becomes the origin from step 5. Then, from `src/web`:

```bash
npm run build
```

The host's download allow-list reads the same constant.

## 10. Import the existing catalogue item

Prerequisites:

- Sign in through the editor's store panel against the deployed Worker. The
  host writes the session to `~/.yunari/settings/store-session.json`.
- The signed-in email is in `OWNER_EMAILS` (otherwise the item stays `pending`
  and the import exits 1).
- Open the editor at `localhost`, `127.x` or `[::1]`: sign-in only returns to a
  loopback address.

Put the old item's `item.json`, `thumbnail.png` and `<id>.zip` in one directory
(the zip's envelope id must equal `item.json`'s, and the old version must be
`1.0.0`). From `src/web`:

```bash
npx tsx scripts/import-catalogue-item.mjs --source <item dir> --origin https://<worker> --settings <settings dir>
```

`--settings` defaults to `~/.yunari/settings`; use `--token-file <path>` for a
plain token file instead. It prints `<id> <version> <status>`; a good import
reads `1.0.0 published`.

## 11. Measure CPU against the Free-plan limit

Cloudflare dashboard → Workers & Pages → `yunari-store` → Metrics → the **CPU
Time per execution** chart (`wrangler tail` streams request logs, not CPU).
Exercise `GET /index.json` and complete one OAuth sign-in, then read the chart.

The Workers Free plan allows **10 ms CPU per invocation**. If either action
exceeds it, adopt Workers Paid before calling the cutover done.

## 12. Rotate a leaked secret

```bash
npx wrangler secret put <NAME>
```

Enter the new value; the secret takes effect for subsequent requests. For an
OAuth client secret, also rotate it at the provider (GitHub or Google) — the
Worker does not do that half.
