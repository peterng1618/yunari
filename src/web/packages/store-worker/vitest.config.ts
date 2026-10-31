import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// `cloudflareTest` is the Vite plugin this suite runs on; it was renamed from
// `@cloudflare/vitest-pool-workers` (vg-728). The plugin reads the same
// wrangler config and Miniflare bindings, and peers on the workspace's vitest 5.
export default defineConfig(async () => {
  // Resolve from this file, not process.cwd(): the config is also loaded from
  // the workspace root.
  const migrations = await readD1Migrations(
    fileURLToPath(new URL("./migrations", import.meta.url)),
  );
  return {
    plugins: [
      cloudflareTest({
        wrangler: {
          configPath: fileURLToPath(
            new URL("./wrangler.toml", import.meta.url),
          ),
        },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            TEST_MODE: "1",
            BETTER_AUTH_URL: "https://store.test",
            MIGRATE_TOKEN: "test-migrate",
            BETTER_AUTH_SECRET: "test-secret",
            GITHUB_CLIENT_ID: "test-github-id",
            GITHUB_CLIENT_SECRET: "test-github-secret",
            GOOGLE_CLIENT_ID: "test-google-id",
            GOOGLE_CLIENT_SECRET: "test-google-secret",
            OWNER_EMAILS: "owner@example.com",
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./tests/apply-migrations.ts"],
    },
  };
});
