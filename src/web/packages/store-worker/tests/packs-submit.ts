import { env, SELF } from "cloudflare:test";
import { strToU8, zipSync } from "fflate";
import { writeWidgetPackage } from "@yunari/theme-package";
import { expect } from "vitest";
import { BASE, USER_ID } from "./helpers";
import { ITEM_ID } from "./seed";

/** The upload route, whose path segment is the reservation id. */
export const UPLOAD_PREFIX = "/api/me/uploads/";
/** Signature only: the route checks the PNG magic, not the pixels. */
const THUMBNAIL = btoa(
  String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
);

export function widgetPack(name = "Starter Cards"): Uint8Array {
  const written = writeWidgetPackage({
    document: {
      schemaVersion: "2.0.0",
      fabricVersion: "7.4.0",
      id: "starter",
      metadata: { themeLanguage: "en", name, version: "1.0.0" },
      globals: {},
      scene: { version: "7.4.0", objects: [] },
    },
    assets: {},
  });
  if (!written.ok) throw new Error(written.message);
  return written.bytes;
}

export function pluginPackage(
  overrides: Readonly<Record<string, unknown>> = {},
): Uint8Array {
  return zipSync(
    {
      "yunari-plugin.json": strToU8(
        JSON.stringify({
          manifestVersion: 1,
          id: "plugin-one",
          name: "Plugin One",
          version: "1.0.0",
          description: "A declarative plugin.",
          engines: { yunari: ">=0.1.0" },
          pluginApi: 1,
          execution: "declarative",
          capabilities: [],
          contributes: {},
          ...overrides,
        }),
      ),
    },
    { level: 0 },
  );
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as unknown as BufferSource,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export interface SubmitOptions {
  readonly name?: string;
  readonly version?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly declaredSha256?: string;
  readonly declaredBytes?: number;
}

/** One non-theme version request plus its upload; answers the version. */
export async function submit(
  headers: Record<string, string>,
  bytes: Uint8Array,
  kind: string,
  options: SubmitOptions = {},
): Promise<{ readonly version: string; readonly uploadUrl: string }> {
  const response = await SELF.fetch(`${BASE}/api/me/items/${ITEM_ID}/versions`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      kind,
      name: options.name ?? "Pack One",
      version: options.version ?? "1.0.0",
      metadata: options.metadata ?? {},
      sha256: options.declaredSha256 ?? (await sha256Hex(bytes)),
      bytes: options.declaredBytes ?? bytes.byteLength,
    }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const { version, uploadUrl } = (await response.json()) as {
    version: string;
    uploadUrl: string;
  };
  const uploadId = new URL(uploadUrl).pathname.slice(UPLOAD_PREFIX.length);
  expect(uploadId.length).toBeGreaterThan(0);

  const put = await SELF.fetch(uploadUrl, {
    method: "PUT",
    headers: { ...headers, "content-length": String(bytes.byteLength) },
    body: bytes as unknown as BodyInit,
  });
  expect(put.status).toBe(201);
  return { version, uploadUrl };
}

export function finalize(
  headers: Record<string, string>,
  version: string,
): Promise<Response> {
  return SELF.fetch(
    `${BASE}/api/me/items/${ITEM_ID}/versions/${version}/finalize`,
    {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ thumbnail: THUMBNAIL }),
    },
  );
}

/** Clears this fixed id and account between cases in one file. */
export async function reset(): Promise<void> {
  const uploads = await env.DB.prepare(
    "SELECT key FROM upload WHERE user_id = ?",
  )
    .bind(USER_ID)
    .all<{ readonly key: string }>();
  if (uploads.results.length > 0)
    await env.BUCKET.delete(uploads.results.map((row) => row.key));
  await env.DB.prepare("DELETE FROM upload WHERE user_id = ?")
    .bind(USER_ID)
    .run();
  await env.DB.prepare("DELETE FROM presign_event WHERE user_id = ?")
    .bind(USER_ID)
    .run();
  await env.DB.prepare("DELETE FROM item_version WHERE item_id = ?")
    .bind(ITEM_ID)
    .run();
  await env.DB.prepare("DELETE FROM item WHERE id = ?").bind(ITEM_ID).run();
  await env.DB.prepare("DELETE FROM author_profile WHERE user_id = ?")
    .bind(USER_ID)
    .run();
}

export async function verifyAuthor(
  displayName: string | null,
  verified = 1,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO author_profile (user_id, verified, display_name) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET verified = excluded.verified,
       display_name = excluded.display_name`,
  )
    .bind(USER_ID, verified, displayName)
    .run();
}

export async function itemRow(): Promise<{
  readonly status: string;
  readonly publisher: string;
  readonly kind: string;
  readonly review_state: string;
}> {
  const row = await env.DB.prepare(
    "SELECT status, publisher, kind, review_state FROM item WHERE id = ?",
  )
    .bind(ITEM_ID)
    .first<{
      status: string;
      publisher: string;
      kind: string;
      review_state: string;
    }>();
  if (row === null) throw new Error("The item row is missing.");
  return row;
}

export async function versionReviewState(
  version: string,
): Promise<string | undefined> {
  const row = await env.DB.prepare(
    "SELECT review_state FROM item_version WHERE item_id = ? AND version = ?",
  )
    .bind(ITEM_ID, version)
    .first<{ readonly review_state: string }>();
  return row?.review_state;
}
