import type http from "node:http";
import { redactForBrowser } from "../providers/provider.js";
import { type CredentialStore, hintOf } from "../settings/credentials.js";
import {
  type CredentialRow,
  type KnownCredential,
  sourcesInUse,
} from "../settings/credentials-registry.js";
import {
  normalizeSources,
  type SourceIssue,
  SourceUpdateRefused,
  sourceEntryCredentialId,
  withoutSourceEntry,
  withSourceEntry,
} from "../settings/sources.js";
import { readBody, sendJson, sendText } from "./http.js";
import { isForeignOrigin, isLoopbackRemote } from "./identity.js";
import type { SourceRouteOptions } from "./options.js";

/** The store's source-id pattern, repeated for the path so a malformed id is a
 *  400 rather than a lookup. `settings/sources.ts` owns what a write accepts. */
const SOURCE_ID = /^[a-z0-9_-]{1,32}$/;

/** An issue's identity when comparing the file before and after a merge: the
 *  reason alone is not unique across sources. */
function issueKey(issue: SourceIssue): string {
  return `${issue.sourceId}\u0000${issue.reason}`;
}

export interface SecretRouteDeps {
  readonly sourceRoutes: SourceRouteOptions | undefined;
  readonly credentials: CredentialStore | undefined;
  readonly baseCredentials: readonly KnownCredential[];
  readonly fetcher: typeof fetch | undefined;
  readonly now: () => number;
}

/**
 * Custom HTTP sources and provider credentials. Both are admin on this PC, so
 * the guard order is loopback, then a foreign page, then the store.
 */
export function createSecretRoutes(
  deps: SecretRouteDeps,
): (
  request: http.IncomingMessage,
  response: http.ServerResponse,
  url: URL,
) => Promise<boolean> {
  const { sourceRoutes, credentials, baseCredentials, fetcher, now } = deps;
  /** The fixed half of the credential table; the dynamic half is the custom
   *  sources' referenced ids, refreshed after every source write. */
  let knownCredentials = baseCredentials;

  /**
   * Re-derives the credential ids a source may name. Called before a credential
   * route answers and after a source write, so a newly referenced id is
   * writable without a restart and a removed one stops being admitted.
   */
  async function refreshCredentialTable(): Promise<void> {
    if (sourceRoutes === undefined) return;
    const file = await sourceRoutes.store.read();
    knownCredentials = sourcesInUse(file.sources, baseCredentials);
  }

  return async function handleSecretRoutes(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    url: URL,
  ): Promise<boolean> {
    // Custom HTTP sources. Every route is admin on this PC, so the guard order
    // is the credential routes': loopback, then a foreign page, then the store.
    if (
      url.pathname === "/api/sources" ||
      url.pathname.startsWith("/api/sources/")
    ) {
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(response, 403, "Sources are available on this PC only.");
        return true;
      }

      if (isForeignOrigin(request)) {
        sendText(response, 403, "Sources are not available to another page.");
        return true;
      }

      if (sourceRoutes === undefined) {
        sendText(response, 503, "Custom sources are not enabled on this host.");
        return true;
      }

      if (url.pathname === "/api/sources") {
        if (request.method !== "GET") {
          sendText(response, 405, "Only GET is supported.");
          return true;
        }

        const file = await sourceRoutes.store.read();
        const statuses = new Map(
          sourceRoutes.provider
            .status()
            .map((entry) => [entry.sourceId, entry]),
        );

        sendJson(response, 200, {
          sources: file.sources.map((source) => {
            const status = statuses.get(source.id);
            const lastError =
              status?.lastError === undefined
                ? null
                : redactForBrowser(status.lastError);
            const lastSuccessMs = status?.lastSuccessMs;

            return {
              ...source,
              fieldCount: source.fields.length,
              health:
                lastError !== null
                  ? "error"
                  : lastSuccessMs === undefined
                    ? "waiting"
                    : "ok",
              lastError,
              lastSuccessAt:
                lastSuccessMs === undefined
                  ? null
                  : new Date(lastSuccessMs).toISOString(),
            };
          }),
          issues: file.issues.map((issue) => ({
            sourceId: issue.sourceId,
            reason: redactForBrowser(issue.reason),
          })),
        });
        return true;
      }

      const parts = url.pathname.slice("/api/sources/".length).split("/");
      const id = parts[0] ?? "";

      if (!SOURCE_ID.test(id)) {
        sendText(response, 400, "That source id is not valid.");
        return true;
      }

      if (parts.length === 2 && parts[1] === "test") {
        if (request.method !== "POST") {
          sendText(response, 405, "Only POST is supported.");
          return true;
        }

        const result = await sourceRoutes.provider.test(id);
        if (result === undefined) {
          sendText(response, 404, "No such source.");
          return true;
        }

        sendJson(response, 200, {
          ...result,
          ...(result.reason === undefined
            ? {}
            : { reason: redactForBrowser(result.reason) }),
        });
        return true;
      }

      if (parts.length !== 1) {
        sendText(response, 404, "No such source route.");
        return true;
      }

      if (request.method === "PUT") {
        let raw: string;

        try {
          raw = await readBody(request);
        } catch (error: unknown) {
          // The body's size is its own refusal: a body this host will not read
          // is not a malformed one it read and rejected.
          sendText(
            response,
            413,
            error instanceof Error ? error.message : String(error),
          );
          return true;
        }

        let body: unknown;
        try {
          body = JSON.parse(raw) as unknown;
        } catch {
          sendText(response, 400, "That request body is not JSON.");
          return true;
        }

        if (typeof body !== "object" || body === null || Array.isArray(body)) {
          sendText(response, 400, "A source must be an object.");
          return true;
        }

        const givenId = (body as { id?: unknown }).id;
        if (givenId !== undefined && givenId !== id) {
          sendText(response, 400, 'The source "id" must match the path.');
          return true;
        }

        const candidate = { ...body, id };
        // The store persists the file as authored, so a neighbour it cannot
        // parse survives this write; only the candidate has to be valid. The
        // source-count limit is whole-file, so the merge checks what it adds.
        const ownIssue = normalizeSources({ sources: [candidate] }).issues[0];

        if (ownIssue !== undefined) {
          sendJson(response, 400, {
            ok: false,
            field: ownIssue.sourceId,
            reason: redactForBrowser(ownIssue.reason),
          });
          return true;
        }

        try {
          await sourceRoutes.store.update((current) => {
            const next = withSourceEntry(current, candidate);
            const before = new Set(
              normalizeSources(current).issues.map(issueKey),
            );
            const introduced = normalizeSources(next).issues.find(
              (issue) => !before.has(issueKey(issue)),
            );

            if (introduced !== undefined) {
              throw new SourceUpdateRefused(introduced);
            }

            return next;
          });
        } catch (error: unknown) {
          if (error instanceof SourceUpdateRefused) {
            sendJson(response, 400, {
              ok: false,
              field: error.issue.sourceId,
              reason: redactForBrowser(error.issue.reason),
            });
            return true;
          }
          throw error;
        }

        await sourceRoutes.provider.reload();
        await refreshCredentialTable();
        sendJson(response, 200, { ok: true });
        return true;
      }

      if (request.method === "DELETE") {
        // Raw, so an entry the store refused is still removable and every
        // other entry survives. The credential is never touched here: an entry
        // the source no longer references is the owner's to clear.
        let removed: unknown = undefined;

        const written = await sourceRoutes.store.update((raw) => {
          const result = withoutSourceEntry(raw, id);
          removed = result.removed;
          return result.raw;
        });

        if (removed === undefined) {
          sendText(response, 404, "No such source.");
          return true;
        }

        await sourceRoutes.provider.reload();
        await refreshCredentialTable();

        const credentialId = sourceEntryCredentialId(removed);
        const unreferenced =
          credentialId !== undefined &&
          !written.sources.some(
            (source) => source.auth?.credentialId === credentialId,
          )
            ? credentialId
            : null;

        sendJson(response, 200, {
          ok: true,
          unreferencedCredential: unreferenced,
        });
        return true;
      }

      sendText(response, 405, "Only PUT and DELETE are supported.");
      return true;
    }

    // Provider credentials. The value is write-only from the browser: the read
    // answers `set` and a four-character hint, never the value, and every method
    // stays on this PC because this file is the one secret the host holds.
    if (
      url.pathname === "/api/credentials" ||
      url.pathname.startsWith("/api/credentials/")
    ) {
      if (!isLoopbackRemote(request.socket.remoteAddress)) {
        sendText(response, 403, "Credentials are available on this PC only.");
        return true;
      }

      if (isForeignOrigin(request)) {
        sendText(
          response,
          403,
          "Credentials are not available to another page.",
        );
        return true;
      }

      if (credentials === undefined) {
        sendText(response, 503, "Credentials are not enabled on this host.");
        return true;
      }

      // A source written a moment ago makes its credential id writable here
      // without a restart; the store stays the only record of sources.
      await refreshCredentialTable();

      if (url.pathname === "/api/credentials") {
        if (request.method !== "GET") {
          sendText(response, 405, "Only GET is supported.");
          return true;
        }

        const rows: CredentialRow[] = [];
        for (const known of knownCredentials) {
          const value = await credentials.valueOf(known.id);
          rows.push({
            id: known.id,
            label: known.label,
            set: value !== undefined,
            hint: value === undefined ? "" : hintOf(value),
            verify: known.verify !== undefined,
            helpText: known.help?.text ?? null,
            helpUrl: known.help?.url ?? null,
          });
        }

        // A credential whose source was deleted stays visible and clearable,
        // rather than becoming a secret the owner can see no way to remove.
        for (const [id, entry] of Object.entries(await credentials.read())) {
          if (knownCredentials.some((known) => known.id === id)) continue;
          rows.push({
            id,
            label: "Unreferenced credential",
            set: true,
            hint: hintOf(entry.value),
            verify: false,
            helpText: null,
            helpUrl: null,
          });
        }

        sendJson(response, 200, rows);
        return true;
      }

      const parts = url.pathname.slice("/api/credentials/".length).split("/");
      const credentialId = parts[0] ?? "";
      const known = knownCredentials.find((entry) => entry.id === credentialId);
      const orphan =
        known === undefined &&
        Object.hasOwn(await credentials.read(), credentialId);

      if (known === undefined && !orphan) {
        sendText(response, 400, "That credential is not one this host knows.");
        return true;
      }

      if (parts.length === 2 && parts[1] === "verify") {
        if (request.method !== "POST") {
          sendText(response, 405, "Only POST is supported.");
          return true;
        }

        if (known === undefined) {
          sendText(
            response,
            400,
            "That credential is not one this host knows.",
          );
          return true;
        }

        if (known.verify === undefined) {
          sendText(
            response,
            400,
            `The ${known.label} credential has no check.`,
          );
          return true;
        }

        const value = await credentials.valueOf(known.id);
        if (value === undefined) {
          sendJson(response, 200, {
            ok: false,
            message: `${known.label} is not set.`,
          });
          return true;
        }

        sendJson(response, 200, await known.verify(value, fetcher ?? fetch));
        return true;
      }

      if (parts.length !== 1) {
        sendText(response, 404, "No such credential route.");
        return true;
      }

      if (request.method === "PUT") {
        if (known === undefined) {
          sendText(
            response,
            400,
            "That credential is not one this host knows.",
          );
          return true;
        }

        if (known.kind === "cookie") {
          sendText(
            response,
            400,
            "Only bearer credentials are supported (R10).",
          );
          return true;
        }

        let value: unknown;
        try {
          value = (JSON.parse(await readBody(request)) as { value?: unknown })
            .value;
        } catch {
          sendText(response, 400, "That request body is not JSON.");
          return true;
        }

        if (typeof value !== "string" || value === "") {
          sendText(response, 400, "A credential value is required.");
          return true;
        }

        await credentials.write(known.id, value, new Date(now()));
        sendJson(response, 200, { ok: true });
        return true;
      }

      if (request.method === "DELETE") {
        // An unreferenced id is still clearable: deleting a source must not
        // strand a secret with no route that can remove it.
        await credentials.clear(credentialId);
        sendJson(response, 200, { ok: true });
        return true;
      }

      sendText(response, 405, "Only PUT and DELETE are supported.");
      return true;
    }

    return false;
  };
}
