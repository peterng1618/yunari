import fs from "node:fs/promises";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  type AssetSourceListing,
  parseAssetSearchRequest,
} from "@yunari/renderer-core";
import type { CredentialStore } from "../settings/credentials.js";
import { MAX_ASSET_BYTES, MAX_TRASH_UPLOAD_BYTES } from "../themes/store.js";
import { moveFilesToTrash } from "../themes/trash.js";
import { searchSources } from "./search.js";
import type { AssetSource, SourceContext } from "./source.js";
import { ASSET_SOURCES } from "./sources.js";

/** What the host serves at `/api/assets`, or nothing when it serves none. */
export interface AssetRouteOptions {
  readonly credentials?: CredentialStore;
  readonly sources?: readonly AssetSource[];
  /** Supplied so a test can search without a network. */
  readonly fetch?: typeof fetch;
  /** Where a trash request stages its copies. Defaults to `os.tmpdir()`; the
   *  theme library's own directory is not a staging area. */
  readonly stagingRoot?: string;
  /** The platform trash. Defaults to the real one; supplied so a route test
   *  never moves a copy in its own machine's trash. */
  readonly trash?: (paths: readonly string[]) => Promise<void>;
}

export interface AssetRouteInput {
  readonly request: http.IncomingMessage;
  readonly response: http.ServerResponse;
  readonly url: URL;
  readonly loopback: boolean;
  /** Whether the request states another page's origin; a search spends a key. */
  readonly foreignOrigin: boolean;
  readonly assets: AssetRouteOptions | undefined;
  readonly fetch: typeof fetch;
  readonly readBody: (
    request: http.IncomingMessage,
    limit?: number,
  ) => Promise<string>;
}

function json(
  response: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function text(
  response: http.ServerResponse,
  status: number,
  message: string,
): void {
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(message);
}

const TRASH_PATH = "/api/assets/trash";
/** The only form a file's `bytes` may take. */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const NOT_A_TRASH_REQUEST = "That request body is not a trash request.";

interface StagedFile {
  readonly name: string;
  readonly bytes: Uint8Array;
}

type TrashFiles =
  | { readonly ok: true; readonly files: readonly StagedFile[] }
  | {
      readonly ok: false;
      readonly status: 400 | 413;
      readonly message: string;
    };

/**
 * The files a trash request asked for, decoded and measured, or the refusal to
 * answer.
 *
 * Every name is reduced to a basename: it is the staged copy's own name, never
 * a path, so an absolute name or one climbing out cannot write anywhere this
 * host did not make. Both caps are checked here, before the caller writes
 * anything, so a refused body leaves no staged bytes behind.
 */
function trashFiles(body: unknown): TrashFiles {
  const refuse = (status: 400 | 413, message: string): TrashFiles => ({
    ok: false,
    status,
    message,
  });

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return refuse(400, NOT_A_TRASH_REQUEST);
  }

  const files = (body as { files?: unknown }).files;
  if (!Array.isArray(files)) {
    return refuse(400, NOT_A_TRASH_REQUEST);
  }

  const staged: StagedFile[] = [];
  const names = new Set<string>();

  for (const entry of files) {
    if (typeof entry !== "object" || entry === null) {
      return refuse(400, NOT_A_TRASH_REQUEST);
    }

    const { name, bytes } = entry as { name?: unknown; bytes?: unknown };
    if (typeof name !== "string" || typeof bytes !== "string") {
      return refuse(400, NOT_A_TRASH_REQUEST);
    }

    const fileName = path.basename(name);
    if (
      fileName === "" ||
      fileName === "." ||
      fileName === ".." ||
      fileName.includes("\0")
    ) {
      return refuse(400, `"${name}" is not a file name.`);
    }

    // Two copies sharing one staged name would overwrite each other, and the
    // second would be trashed as the first's bytes. The key is the name the
    // filesystem would make, not the raw string.
    const key = stagedNameKey(fileName);
    if (names.has(key)) {
      return refuse(400, `Two files are both named "${fileName}".`);
    }

    if (!BASE64.test(bytes) || bytes.length % 4 !== 0) {
      return refuse(400, `"${fileName}" is not base64.`);
    }

    const decoded = Buffer.from(bytes, "base64");
    if (decoded.byteLength > MAX_ASSET_BYTES) {
      return refuse(
        413,
        `"${fileName}" is larger than this host will move to the trash.`,
      );
    }

    names.add(key);
    staged.push({ name: fileName, bytes: decoded });
  }

  return { ok: true, files: staged };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Whether a failed write is the caller's name rather than this host's fault.
 *
 * `EINVAL` and `ENAMETOOLONG` name a string past what the filesystem accepts.
 * Windows reports an over-long or unrepresentable path as `ENOENT`, so that
 * code is a name refusal there; on POSIX the same code from a write inside a
 * directory this request just made means the directory vanished, which is this
 * host's fault. `EPERM` is never a name: an ACL or an immutable directory is
 * this host's refusal, and blaming the body would hide it.
 */
export function isNameRefusal(
  code: string | undefined,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return (
    code === "EINVAL" ||
    code === "ENAMETOOLONG" ||
    (code === "ENOENT" && platform === "win32")
  );
}

function stageRefusal(
  name: string,
  error: unknown,
): { readonly status: 400 | 500; readonly message: string } {
  return isNameRefusal((error as NodeJS.ErrnoException).code)
    ? {
        status: 400,
        message: `"${name}" cannot be stored on this PC: ${messageOf(error)}`,
      }
    : { status: 500, message: messageOf(error) };
}

/** What the host's filesystem treats as one staged name: Windows ignores
 *  trailing dots and spaces and compares case-insensitively. macOS is left
 *  alone — APFS is usually case-insensitive, but a case-sensitive volume accepts
 *  two genuinely distinct names and refusing one would be wrong. */
function stagedNameKey(fileName: string): string {
  return process.platform === "win32"
    ? fileName.replace(/[. ]+$/, "").toLowerCase()
    : fileName;
}

/**
 * `POST /api/assets/trash`: the author asked for these copies to go to the
 * platform's trash.
 *
 * A refusal is the platform's own sentence and a 500, because a refused trash
 * is a refusal: nothing here falls back to a permanent delete. The staging
 * directory is swept either way — a successful trash has already moved the
 * copies out of it. The whole list goes to one trash invocation: fewer
 * processes and one refusal sentence, not atomicity. A partial move is
 * reported as a failure, the caller prunes nothing, and the editor still holds
 * the bytes.
 */
async function moveStagedFiles(
  input: AssetRouteInput,
  assets: AssetRouteOptions | undefined,
): Promise<void> {
  const { request, response } = input;

  if (request.method !== "POST") {
    text(response, 405, "Only POST is supported.");
    return;
  }

  let raw: string;
  try {
    raw = await input.readBody(request, MAX_TRASH_UPLOAD_BYTES);
  } catch (error: unknown) {
    // The body's size is its own refusal: a body this host will not read is not
    // a malformed one it read and rejected.
    text(response, 413, messageOf(error));
    return;
  }

  let body: unknown;
  try {
    body = JSON.parse(raw) as unknown;
  } catch {
    text(response, 400, "That request body is not JSON.");
    return;
  }

  const parsed = trashFiles(body);
  if (!parsed.ok) {
    text(response, parsed.status, parsed.message);
    return;
  }

  const root = assets?.stagingRoot ?? os.tmpdir();
  const trash = assets?.trash ?? moveFilesToTrash;
  let directory: string | undefined;
  let failure:
    | { readonly status: 400 | 500; readonly message: string }
    | undefined;

  try {
    directory = await fs.mkdtemp(path.join(root, "yunari-trash-"));
    const paths: string[] = [];

    for (const file of parsed.files) {
      const target = path.join(directory, file.name);
      try {
        await fs.writeFile(target, file.bytes);
      } catch (error: unknown) {
        failure = stageRefusal(file.name, error);
        break;
      }
      paths.push(target);
    }

    if (failure === undefined) {
      try {
        await trash(paths);
      } catch (error: unknown) {
        failure = { status: 500, message: messageOf(error) };
      }
    }
  } catch (error: unknown) {
    // `mkdtemp` itself: the staging root is this host's own directory.
    failure = { status: 500, message: messageOf(error) };
  } finally {
    if (directory !== undefined) {
      await fs
        .rm(directory, { recursive: true, force: true })
        .catch(() => undefined);
    }
  }

  // Answered only once the staging directory is swept: a caller that prunes
  // declarations after a success must not race a cleanup still running.
  if (failure === undefined) {
    json(response, 200, { ok: true });
    return;
  }

  text(response, failure.status, failure.message);
}

function listingOf(source: AssetSource): AssetSourceListing {
  return {
    id: source.id,
    label: source.label,
    category: source.category,
    body: source.body,
    // `null` rather than an omitted key: a reader distinguishes "needs no
    // credential" from a field the answer forgot to carry.
    requires: source.requires ?? null,
    configurable: source.configurable,
    presetKind: source.presetKind ?? null,
    host: source.host ?? null,
  };
}

/** The credentials a source asked for, read once per request. */
async function credentialReader(
  assets: AssetRouteOptions,
): Promise<(id: string) => string | undefined> {
  const values = new Map<string, string>();
  const store = assets.credentials;

  if (store !== undefined) {
    const wanted = new Set(
      (assets.sources ?? ASSET_SOURCES)
        .map((source) => source.requires)
        .filter((id): id is string => id !== undefined),
    );
    for (const id of wanted) {
      const value = await store.valueOf(id);
      if (value !== undefined) values.set(id, value);
    }
  }

  return (id) => values.get(id);
}

/**
 * The asset finder's four routes.
 *
 * Mounted for every `/api/assets` path, whether or not this host serves
 * sources, so a build without them says so rather than falling through to the
 * static handler's 404. No body or credential is logged.
 */
export async function handleAssetRoutes(
  input: AssetRouteInput,
): Promise<boolean> {
  const { request, response, url, assets } = input;

  const sourcesPath = "/api/assets/sources";
  const searchPath = "/api/assets/search";
  const bytesPath = "/api/assets/bytes";

  if (
    url.pathname !== sourcesPath &&
    url.pathname !== searchPath &&
    url.pathname !== bytesPath &&
    url.pathname !== TRASH_PATH
  ) {
    return false;
  }

  // A paired display has no finder, and a search is an outbound request it did
  // not ask for, so every one of these routes is this PC's.
  if (!input.loopback) {
    text(response, 403, "Asset sources are available on this PC only.");
    return true;
  }

  if (input.foreignOrigin) {
    text(response, 403, "Asset sources are not available to another page.");
    return true;
  }

  // Before the sources check: a host that serves no finder sources can still
  // move bytes to the trash. Its only dependencies are a staging root and the
  // platform's trash.
  if (url.pathname === TRASH_PATH) {
    await moveStagedFiles(input, assets);
    return true;
  }

  if (assets === undefined) {
    text(response, 503, "Asset sources are not enabled on this host.");
    return true;
  }

  const sources = assets.sources ?? ASSET_SOURCES;

  if (url.pathname === sourcesPath) {
    if (request.method !== "GET") {
      text(response, 405, "Only GET is supported.");
      return true;
    }

    json(response, 200, { sources: sources.map(listingOf) });
    return true;
  }

  if (url.pathname === searchPath) {
    if (request.method !== "POST") {
      text(response, 405, "Only POST is supported.");
      return true;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await input.readBody(request)) as unknown;
    } catch {
      text(response, 400, "That request body is not JSON.");
      return true;
    }

    const search = parseAssetSearchRequest(
      parsed,
      sources.map((source) => source.id),
    );
    if (search === undefined) {
      text(response, 400, "That search request is not one this host reads.");
      return true;
    }

    const controller = new AbortController();
    const abort = (): void =>
      controller.abort(new Error("The search was cancelled."));
    request.once("aborted", abort);

    try {
      const ctx: SourceContext = {
        credential: await credentialReader(assets),
        signal: controller.signal,
        fetch: assets.fetch ?? input.fetch,
      };
      json(response, 200, await searchSources(search, ctx, sources));
    } catch (error: unknown) {
      text(
        response,
        500,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      request.off("aborted", abort);
    }
    return true;
  }

  // Bytes.
  if (request.method !== "GET") {
    text(response, 405, "Only GET is supported.");
    return true;
  }

  const sourceId = url.searchParams.get("source");
  const resultId = url.searchParams.get("id");
  if (sourceId === null || resultId === null) {
    text(response, 400, "A source and an asset id are required.");
    return true;
  }

  const source = sources.find((entry) => entry.id === sourceId);
  if (source === undefined) {
    text(response, 404, "No such asset source.");
    return true;
  }

  const ctx: SourceContext = {
    credential: await credentialReader(assets),
    signal: new AbortController().signal,
    fetch: assets.fetch ?? input.fetch,
  };

  // A grid row's id is the search's namespaced `<source>:<entry>`; the source
  // names its own assets unprefixed, so the prefix is removed once, here.
  const entryId = resultId.startsWith(`${source.id}:`)
    ? resultId.slice(source.id.length + 1)
    : resultId;
  const bytes = await source.bytesOf(entryId, ctx);
  if (bytes === undefined) {
    text(response, 404, "That source does not have this asset.");
    return true;
  }

  response.writeHead(200, {
    "content-type": bytes.contentType,
    "content-length": bytes.bytes.byteLength,
    "cache-control": "no-store",
    "x-yunari-filename": bytes.filename,
  });
  response.end(Buffer.from(bytes.bytes));
  return true;
}
