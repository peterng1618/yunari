import type { Auth, BetterAuthOptions } from "better-auth";
import { betterAuth } from "better-auth";
import { bearer, oneTimeToken, testUtils } from "better-auth/plugins";
import type { Env } from "./env.js";

/**
 * Better Auth's configuration, built fresh per call: the instance is options
 * plus lazy adapters, and the brief rules out a session cache.
 *
 * The options are widened to `BetterAuthOptions` because the inferred return
 * type otherwise names a zod helper better-auth does not export.
 *
 * `testUtils` is only constructed when the harness sets TEST_MODE on a test
 * origin, so no production binding can turn it on.
 */
export function createAuth(env: Env): Auth {
  const options: BetterAuthOptions = {
    database: env.DB,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
      },
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    plugins:
      env.TEST_MODE === "1" && isTestOrigin(env.BETTER_AUTH_URL)
        ? [bearer(), oneTimeToken(), testUtils()]
        : [bearer(), oneTimeToken()],
  };
  return betterAuth(options);
}

/**
 * Loopback or a reserved `.test` host is a test origin. The harness's own
 * `https://store.test` keeps the plugins; a production-shaped URL with
 * `TEST_MODE=1` gets the production list instead. A URL that will not parse is
 * not a test origin.
 */
export function isTestOrigin(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === "https:" && url.hostname.endsWith(".test")) return true;
  return (
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost")
  );
}
