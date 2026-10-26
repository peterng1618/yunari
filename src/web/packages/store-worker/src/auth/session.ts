import { createAuth } from "../auth.js";
import type { Env } from "../env.js";

export interface Session {
  readonly userId: string;
  readonly email: string;
  /** Better Auth's `"user".emailVerified`; owner checks require it. */
  readonly emailVerified: boolean;
}

/**
 * Reads the session from the request's headers unchanged: the `bearer` plugin
 * turns `authorization` into a session, and a cookie works too.
 */
export async function sessionOf(
  request: Request,
  env: Env,
): Promise<Session | undefined> {
  const found = await createAuth(env).api.getSession({
    headers: request.headers,
  });
  if (found === null) return undefined;
  return {
    userId: found.user.id,
    email: found.user.email,
    emailVerified: found.user.emailVerified === true,
  };
}
