# 0122 — The ffmpeg binary is verified against a recorded digest before it is spawned

- **Date:** 2026-10-26
- **Status:** accepted
- **Paths:** `scripts/verify-ffmpeg.mjs`

## The problem

`ffmpeg-static@5.3.0` runs an install script that downloads a platform binary
from a GitHub release and writes it into `node_modules/ffmpeg-static/`. The host
then executes that file to re-encode theme video. npm's tarball integrity covers
the package's JavaScript, not the binary the install script fetches later, so a
compromised asset, a redirected download or a tampered cache directory executes
unverified bytes. Only the SHA-256 of the bytes that actually landed on disk
answers that, and it has to be recorded somewhere the install cannot rewrite.

## Rung 1 — Yunari

Searched: `ffmpeg-static` and `normalizeVideo` across `src/web`; the host's
`themes/`, `package.json` and the lockfile; `scripts/reuse-gate.mjs`'s
watchlist; the script/unit-test convention (`check-third-party.mjs`,
`check-workflows.mjs`, `tests/scripts/*.test.ts`, `gates:self-test`).

Found:
- `packages/host/src/themes/normalize-video.ts` resolves `ffmpegStatic`, spawns
  it through `execFile`, and has `options.run`/`options.ffmpegPath` seams for
  tests. Nothing hashes the executable.
- The repo already verifies supply-chain artefacts: `check-third-party.mjs`
  compares notices to manifests, `check-workflows.mjs` pins actions. Both keep
  their cases in `src/web/tests/scripts/<name>.test.ts`; the gate comment
  records that a script with a vitest case file is covered by the unit suite
  rather than `gates:self-test`.
- The host bundle is built with Vite SSR and staged without the repository, so
  any verifier and its hash data must be inside the bundle; a runtime read of a
  repo-root file would not exist in an installed package.

## Rung 2 — dependencies

Searched: the installed `ffmpeg-static` package (`package.json`, `index.js`,
`install.js`, `README.md`); its release metadata via the npm registry and the
GitHub API; `@ffmpeg-installer/ffmpeg`; npm search for ffmpeg checksum helpers.

Found:
- `install.js` downloads `ffmpeg-<platform>-<arch>.gz`, gunzips it straight to
  the binary path, and never compares a digest. `package.json` has no checksum
  field; the npm tarball integrity (`sha512-…`) covers only the JS.
- The GitHub release API for tag `b6.1.1` publishes a `digest` (`sha256:…`) for
  every asset, including the decompressed `ffmpeg-*` files. That is an
  independent source for the recorded hashes, but it is metadata the installer
  never consults.
- The only upstream issue matching checksum/sha256/integrity is #48 ("store
  platform & arch information next to installed binary"), not integrity
  verification.
- `@ffmpeg-installer/ffmpeg` is a parallel binary-downloading package with no
  digest verification either.
- No npm package verifies a downloaded ffmpeg against a recorded digest; the
  generic checksum packages (`crc32-stream`, AWS SDK checksums) solve unrelated
  problems.

## Rung 3 — platform

Searched: `node:crypto`, `node:fs`, `node:module`, `process.platform`,
`process.arch`; GitHub's asset digest field.

Found:
- `createHash("sha256").update(readFileSync(path)).digest("hex")` is the whole
  mechanism; `zlib` is not needed because the *decompressed* file is what the
  host spawns.
- `createRequire(import.meta.url)("ffmpeg-static/package.json").version` reads
  the installed version from the package the binary belongs to, so a version
  bump cannot pass silently.
- A platform/arch pair absent from the map has no digest to compare, so it is a
  refusal rather than a warning.

## Rung 4 — ecosystem

Searched: ffmpeg-static's README and release assets; GitHub search across its
issues; equivalent installer packages.

Found:
- Nobody in this family verifies the binary. The release API's digest field is
  the closest thing to an upstream checksum, and the installer ignores it.
- The common alternative (`@ffmpeg-installer/ffmpeg`) has the same hole.
- Byte-for-byte pinning in a checked-in map is therefore the available shape,
  not a home-grown substitute for an existing library.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Recorded SHA-256 map, checked before spawn | Uses `node:crypto`; refuses rather than warns; works in the staged bundle | A version bump must update the map | A missed platform refuses video re-encoding (visible, not silent) | Chosen |
| Trust npm tarball integrity | No new code | Covers only the JS installer, not the fetched binary | The executed bytes stay unverified | Rejected |
| Fetch the digest from the GitHub API at run time | No checked-in data | Network at run time; trusts the same host that served the asset | An offline or compromised API still runs | Rejected |
| Verify once at install via a postinstall wrapper | Catches the download | Bypassed by a cached or manually placed binary; no run-time guarantee | The spawn path is still open | Rejected |
| `@ffmpeg-installer/ffmpeg` instead | Alternative package | Same unverified download, plus a migration | No integrity gain | Rejected |
| Shell out to `sha256sum` | No code | Platform differences; Windows lacks it | Worse than `node:crypto` | Rejected |

## Rung 6 — probe

Measured 2026-10-26, before implementation:
- `node_modules/ffmpeg-static/ffmpeg.exe` is 82 797 568 bytes; SHA-256
  `04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00`.
- The `b6.1.1` release asset `ffmpeg-win32-x64.gz`, downloaded and gunzipped,
  has the same size and digest, and the GitHub API's asset `digest` for the
  decompressed `ffmpeg-win32-x64` is the same value.
- The other four supported assets (`linux-x64`, `linux-arm64`, `darwin-x64`,
  `darwin-arm64`) reproduce identically from the downloaded bytes and the API
  digest. `win32-arm64` returns 404 and is not in `ffmpeg-static`'s own
  platform table, so it gets no entry and stays a refusal.

## Rung 7 — build

One pure module, `packages/host/src/themes/ffmpeg-hash.mjs`, shared by the host
bundle (imported from `normalize-video.ts`) and the CLI wrapper
`scripts/verify-ffmpeg.mjs`. It is `.mjs`, not `.ts`, because the root script
runs under plain `node` on every supported engine and cannot import TypeScript;
the host's `allowJs` picks it up. The hash map is the repository-root
`ffmpeg-static-hashes.json`, imported by the host (bundled into `dist`) and read
by the CLI, so there is one copy. No dependency is added.

## Decision

Record the decompressed SHA-256 for each platform the host runs on in
`ffmpeg-static-hashes.json`, keyed by `ffmpeg-static` version. Before spawning,
the host hashes the resolved executable once per path per process and refuses
with one user-facing sentence on a version mismatch, an unlisted platform or a
digest mismatch. `node scripts/verify-ffmpeg.mjs` performs the same check from
the command line and names the expected and actual digest for an operator. An
unlisted platform is refused, never waved through.
