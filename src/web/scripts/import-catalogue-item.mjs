/**
 * Imports the one item the GitHub catalogue already ships into the store
 * Worker, as its owner, through the same author flow an editor uses.
 *
 * The Worker computes the version and the facets from the envelope and the
 * bytes it receives; this script never touches D1 or R2, and never prints the
 * session token. It refuses two silent rewrites: a package whose id is not the
 * item's, and an old version that is not `1.0.0` (a first submission computes
 * `1.0.0`, so anything else would publish a version the catalogue never had).
 *
 * Run it through `tsx` (`npx tsx scripts/import-catalogue-item.mjs`, the usage
 * line): it imports the workspace's TypeScript packages, which plain `node`
 * cannot resolve.
 */

import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { isCatalogueId } from "@yunari/renderer-core";
import { readThemePackage } from "@yunari/theme-package";

/**
 * The host's settings directory, where `store-session.json` lives.
 *
 * The host owns this path (`packages/host/src/cli/args.ts`,
 * `DEFAULT_SETTINGS_DIR`), but that module is TypeScript importing TypeScript,
 * which this `.mjs` cannot load under plain `node`. The copy is pinned to the
 * owner by a test (`defaultSettingsDir` equals the host's constant) rather than
 * left to drift, and `--settings` overrides it for anyone whose host was
 * launched with `--app-dir`.
 */
export const defaultSettingsDir = path.join(
  os.homedir(),
  ".yunari",
  "settings",
);

const FILE = {
  item: "item.json",
  thumbnail: "thumbnail.png",
};

const USAGE =
  "Usage: npx tsx scripts/import-catalogue-item.mjs --source <catalogue item dir> " +
  "--origin <worker origin> [--settings <dir>] [--token-file <path>]";

const FLAGS = {
  "--source": "source",
  "--origin": "origin",
  "--settings": "settings",
  "--token-file": "tokenFile",
};

/** The old item's version, which a first submission must reproduce exactly. */
const IMPORTED_VERSION = "1.0.0";

/**
 * The envelope out of a package, read by the same reader the library uses —
 * its zip policy, its size bounds and its envelope validation all apply.
 */
export function envelopeOfPackage(bytes) {
  const read = readThemePackage(bytes);
  if (!read.ok)
    throw new Error(`That package cannot be imported: ${read.message}`);
  return read.envelope;
}

/**
 * Validates the old item and its package, then returns the one upload plan.
 * Pure: no fetch, no filesystem — the CLI reads the files.
 */
export function importPlan({
  itemJson,
  packageBytes,
  thumbnailBytes,
  session,
}) {
  const item = parseItem(itemJson);

  if (typeof session?.token !== "string" || session.token === "")
    throw new Error("A session token is required to import.");
  const origin = httpOrigin(session?.origin);

  if (!(packageBytes instanceof Uint8Array) || packageBytes.byteLength === 0)
    throw new Error("The catalogue item has no package bytes.");
  if (
    !(thumbnailBytes instanceof Uint8Array) ||
    thumbnailBytes.byteLength === 0
  )
    throw new Error(`The catalogue item has no ${FILE.thumbnail}.`);

  const envelope = envelopeOfPackage(packageBytes);
  if (envelope.id !== item.id)
    throw new Error(
      `The package's envelope id is "${envelope.id}" but item.json's id is "${item.id}"; importing would publish one item's theme as another's.`,
    );

  return {
    origin,
    envelope,
    name: item.name,
    packageBytes,
    thumbnail: Buffer.from(thumbnailBytes).toString("base64"),
  };
}

/** The four fields the import reads, from a file that carries many more. */
function parseItem(itemJson) {
  let value;
  try {
    value = JSON.parse(itemJson);
  } catch {
    throw new Error(`${FILE.item} is not JSON.`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${FILE.item} is not an object.`);

  const id = value.id;
  if (typeof id !== "string" || !isCatalogueId(id))
    throw new Error(
      `${FILE.item}'s id must be a catalogue UUID; got ${JSON.stringify(id)}.`,
    );

  const name = value.name;
  if (typeof name !== "string" || name.trim() === "")
    throw new Error(`${FILE.item}'s name must be a non-empty string.`);

  const version = value.version;
  if (version !== IMPORTED_VERSION)
    throw new Error(
      `${FILE.item}'s version is ${JSON.stringify(version)}; this import only writes ${IMPORTED_VERSION}, and any other version would silently rewrite the item's history.`,
    );

  return { id, name, version };
}

function httpOrigin(origin) {
  if (typeof origin !== "string" || origin === "")
    throw new Error("The Worker origin is required.");
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw new Error(
      `The Worker origin ${JSON.stringify(origin)} is not a URL.`,
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error(
      `The Worker origin must be http or https; got ${url.protocol}`,
    );
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** `--flag value` pairs; anything missing or unknown is the usage sentence. */
export function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = FLAGS[argv[index]];
    const value = argv[index + 1];
    if (key === undefined || value === undefined || value === "")
      return { kind: "usage" };
    parsed[key] = value;
  }
  if (parsed.source === undefined || parsed.origin === undefined)
    return { kind: "usage" };
  return { kind: "import", ...parsed };
}

/**
 * The author flow, in the order the Worker expects: request a version (it
 * computes one), PUT the bytes to the signed URL it answered with, finalize
 * with the thumbnail, then approve when the account is not yet verified. The
 * token rides the Worker calls only; the signed URL is its own authority.
 */
export async function driveImport({ plan, token, fetch }) {
  if (typeof token !== "string" || token === "")
    throw new Error("A session token is required to import.");
  const origin = plan.origin;
  const id = plan.envelope.id;
  const authorized = { authorization: `Bearer ${token}` };

  const requested = await requestJson(
    fetch,
    `${origin}/api/me/items/${id}/versions`,
    {
      method: "POST",
      headers: { ...authorized, "content-type": "application/json" },
      body: JSON.stringify({ envelope: plan.envelope, name: plan.name }),
    },
    "The version request",
  );

  const version = requested?.version;
  if (typeof version !== "string" || version === "")
    throw new Error(
      "The Worker did not answer the version request with a version.",
    );
  if (version !== IMPORTED_VERSION)
    throw new Error(
      `The Worker computed version "${version}", not ${IMPORTED_VERSION}: the item already exists at another version, and importing would rewrite its history.`,
    );

  const uploadUrl = requested?.uploadUrl;
  if (typeof uploadUrl !== "string" || uploadUrl === "")
    throw new Error(
      "The Worker did not answer the version request with an upload URL.",
    );

  let uploaded;
  try {
    uploaded = await fetch(uploadUrl, {
      method: "PUT",
      body: plan.packageBytes,
    });
  } catch {
    // A `fetch` rejection names the URL it could not reach, and this URL
    // carries the upload signature in its query. Only the redacted form is
    // reported.
    throw new Error(`The package upload to ${redact(uploadUrl)} failed.`);
  }
  if (!uploaded.ok)
    throw new Error(
      `The package upload to ${redact(uploadUrl)} was refused (${uploaded.status}).`,
    );

  const finalized = await requestJson(
    fetch,
    `${origin}/api/me/items/${id}/versions/${encodeURIComponent(version)}/finalize`,
    {
      method: "POST",
      headers: { ...authorized, "content-type": "application/json" },
      body: JSON.stringify({ thumbnail: plan.thumbnail }),
    },
    "The finalize request",
  );

  let status = finalized?.status;
  // The CLI prints this status and exits 0 on it, so an answer without one is
  // not "probably fine" — it is a shape this flow does not understand.
  if (typeof status !== "string" || status === "")
    throw new Error("The finalize request did not answer with a status.");
  if (status === "pending") {
    const approved = await fetch(`${origin}/api/admin/items/${id}/approve`, {
      method: "POST",
      headers: authorized,
    });
    // The admin surface answers a signed-in non-owner exactly like a missing
    // path, so 404 here means the session is not the owner — not a bug to retry.
    if (approved.status === 404)
      throw new Error(
        `This session is not an owner of item "${id}", so it stays pending; the owner must approve it.`,
      );
    if (!approved.ok)
      throw new Error(
        `The approve request was refused (${approved.status})${await detail(approved)}`,
      );
    const answer = await jsonOf(approved, "The approve request");
    // Never invent a status: the caller reports what the Worker said, and a
    // missing one means the answer is not the shape this flow understands.
    if (typeof answer?.status !== "string" || answer.status === "")
      throw new Error("The approve request did not answer with a status.");
    status = answer.status;
  }

  return { id, version, status };
}

async function requestJson(fetch, url, init, what) {
  const response = await fetch(url, init);
  if (!response.ok)
    throw new Error(
      `${what} was refused (${response.status})${await detail(response)}`,
    );
  return jsonOf(response, what);
}

async function jsonOf(response, what) {
  try {
    return await response.json();
  } catch {
    throw new Error(`${what} did not answer with JSON.`);
  }
}

async function detail(response) {
  try {
    const text = (await response.text()).trim();
    return text === "" ? "." : `: ${text}`;
  } catch {
    return ".";
  }
}

/** A signed URL's query is its authority; it is never echoed back. */
function redact(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "the upload URL";
  }
}

/** One file of the source directory, or a sentence naming what is missing. */
async function readOr(file, what, source) {
  try {
    return await readFile(file);
  } catch {
    throw new Error(`No readable ${what} in ${source}.`);
  }
}

/**
 * The session the operator's host already holds, or the `--token-file`
 * alternative. Only the token is read: this script acts, it does not attribute.
 */
async function readToken({ settings, tokenFile }) {
  const file =
    tokenFile ??
    path.join(settings ?? defaultSettingsDir, "store-session.json");
  let value;
  try {
    value = JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new Error(`No readable session at ${file}.`);
  }
  const token = value?.token;
  // The path, never the value: an error may be pasted into an issue.
  if (typeof token !== "string" || token === "")
    throw new Error(`No usable session token in ${file}.`);
  return token;
}

/** Reads the catalogue item's three files and uploads them. */
async function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.kind === "usage") {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }

  try {
    const itemJson = (
      await readOr(
        path.join(parsed.source, FILE.item),
        FILE.item,
        parsed.source,
      )
    ).toString("utf8");
    // Read before the version ZIP is named, so a path cannot be built from a
    // value the import would refuse.
    const id = parseItem(itemJson).id;
    const packageBytes = new Uint8Array(
      await readOr(
        path.join(parsed.source, `${id}.zip`),
        `${id}.zip`,
        parsed.source,
      ),
    );
    const thumbnailBytes = new Uint8Array(
      await readOr(
        path.join(parsed.source, FILE.thumbnail),
        FILE.thumbnail,
        parsed.source,
      ),
    );
    const token = await readToken(parsed);

    const plan = importPlan({
      itemJson,
      packageBytes,
      thumbnailBytes,
      session: { token, origin: parsed.origin },
    });
    const result = await driveImport({ plan, token, fetch: globalThis.fetch });

    process.stdout.write(`${result.id} ${result.version} ${result.status}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  process.exitCode = await main(process.argv.slice(2));
}
