import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeThemePackage } from "@yunari/theme-package";
import { expect, it } from "vitest";
import { DEFAULT_SETTINGS_DIR } from "../../packages/host/src/cli/args.js";
import {
  defaultSettingsDir,
  driveImport,
  envelopeOfPackage,
  importPlan,
  parseArgs,
} from "../../scripts/import-catalogue-item.mjs";

/**
 * The import script's own proof. The old catalogue item is a directory of
 * files on another branch; everything here is a fixture built with the same
 * writer the editor uses, so a case fails for the script's rule rather than
 * for a hand-rolled archive the reader was never meant to open.
 *
 * The Worker cannot be reached from a unit test, so the flow is driven against
 * a fake `fetch` that answers in order and records what it was handed: the
 * calls, their methods, and which of them carry the session.
 */

const ITEM_ID = "6041df49-9c61-4d51-a184-716890560bdb";

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** A picture the store accepts, so a case asserts the slot, not the PNG. */
const PNG = (() => {
  const bytes = new Uint8Array(32).fill(7);
  bytes.set(PNG_HEAD);
  return bytes;
})();

const envelopeOf = (id: string) => ({
  schemaVersion: "2.0.0" as const,
  fabricVersion: "7.4.0",
  id,
  artboard: { width: 400, height: 300 },
  metadata: { themeLanguage: "en" },
  globals: {
    typeTokens: {
      heading: { family: "system-ui, sans-serif", weight: "600" },
      body: { family: "system-ui, sans-serif", weight: "400" },
      mono: { family: "monospace", weight: "400" },
    },
  },
  scene: { version: "7.4.0", objects: [] },
});

/** The package the old catalogue item ships, as the editor would have written it. */
const packageOf = (id = ITEM_ID): Uint8Array => {
  const written = writeThemePackage({
    envelope: envelopeOf(id),
    assets: {},
    thumbnail: PNG,
  });
  if (!written.ok) throw new Error(written.message);
  return written.bytes;
};

/** The old `item.json`: the catalogue's own file, not the new wire shape. */
const oldItem = (overrides: Record<string, unknown> = {}) => ({
  id: ITEM_ID,
  kind: "dashboard-theme",
  name: "Aurora",
  version: "1.0.0",
  createdAt: "2026-01-02T03:04:05.000Z",
  updatedAt: "2026-01-02T03:04:05.000Z",
  downloads: 12,
  favorites: 3,
  packageUrl: `https://example.test/releases/${ITEM_ID}.zip`,
  thumbnail: `catalogue/${ITEM_ID}/thumbnail.png`,
  facets: { kinds: [], tags: [] },
  ...overrides,
});

const session = { token: "session-token", origin: "https://store.test" };

const planOf = (overrides: { itemJson?: string } = {}) =>
  importPlan({
    itemJson: overrides.itemJson ?? JSON.stringify(oldItem()),
    packageBytes: packageOf(),
    thumbnailBytes: PNG,
    session,
  });

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

const JSON_ANSWER = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** A Worker that answers each request with the next scripted response. */
function fakeWorker(answers: readonly Response[]) {
  const calls: Call[] = [];
  const queue = [...answers];
  const fetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    const next = queue.shift();
    if (next === undefined) throw new Error("fake Worker ran out of answers");
    return Promise.resolve(next);
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

const authOf = (call: Call) =>
  new Headers(call.init.headers).get("authorization");

const UPLOAD = "https://r2.example.test/package.zip?X-Amz-Signature=secret";

it("reads the envelope out of the old package and plans one version upload", () => {
  const plan = planOf();

  expect(plan.envelope).toMatchObject({ id: ITEM_ID });
  expect(plan.name).toBe("Aurora");
  expect(plan.origin).toBe("https://store.test");
  expect(plan.thumbnail).toBe(Buffer.from(PNG).toString("base64"));
  expect(plan.packageBytes).toBeInstanceOf(Uint8Array);
  expect(Object.keys(plan).sort()).toEqual([
    "envelope",
    "name",
    "origin",
    "packageBytes",
    "thumbnail",
  ]);
});

it("refuses bytes that are not a readable theme package", () => {
  expect(() => envelopeOfPackage(new Uint8Array([1, 2, 3, 4]))).toThrow();
});

it("refuses a package whose envelope is another item's, naming both", () => {
  const other = "3f2a1c9e-8b7d-4c6a-9e0f-1a2b3c4d5e6f";
  expect(() =>
    importPlan({
      itemJson: JSON.stringify(oldItem()),
      packageBytes: packageOf(other),
      thumbnailBytes: PNG,
      session,
    }),
  ).toThrow(new RegExp(`${ITEM_ID}.*${other}|${other}.*${ITEM_ID}`));
});

it("refuses an old version that is not exactly 1.0.0", () => {
  expect(() =>
    importPlan({
      itemJson: JSON.stringify(oldItem({ version: "1.0.1" })),
      packageBytes: packageOf(),
      thumbnailBytes: PNG,
      session,
    }),
  ).toThrow(/1\.0\.1/);
});

it("refuses an item id that is not a catalogue UUID, and an empty name", () => {
  expect(() =>
    importPlan({
      itemJson: JSON.stringify(oldItem({ id: "aurora" })),
      packageBytes: packageOf(),
      thumbnailBytes: PNG,
      session,
    }),
  ).toThrow(/id/);
  expect(() =>
    importPlan({
      itemJson: JSON.stringify(oldItem({ name: " " })),
      packageBytes: packageOf(),
      thumbnailBytes: PNG,
      session,
    }),
  ).toThrow(/name/);
});

it("refuses a session with no token", () => {
  expect(() =>
    importPlan({
      itemJson: JSON.stringify(oldItem()),
      packageBytes: packageOf(),
      thumbnailBytes: PNG,
      session: { token: "", origin: "https://store.test" },
    }),
  ).toThrow(/token/);
});

it("drives the author flow in order: request, upload, finalize, approve", async () => {
  const plan = planOf();
  const worker = fakeWorker([
    JSON_ANSWER({
      version: "1.0.0",
      status: "pending",
      uploadUrl: UPLOAD,
    }),
    new Response(null, { status: 200 }),
    JSON_ANSWER({ ok: true, status: "pending", version: "1.0.0" }),
    JSON_ANSWER({ ok: true, status: "published" }),
  ]);

  const result = await driveImport({
    plan,
    token: session.token,
    fetch: worker.fetch,
  });

  expect(worker.calls.map((call) => call.init.method)).toEqual([
    "POST",
    "PUT",
    "POST",
    "POST",
  ]);
  expect(worker.calls.map((call) => call.url)).toEqual([
    `https://store.test/api/me/items/${ITEM_ID}/versions`,
    UPLOAD,
    `https://store.test/api/me/items/${ITEM_ID}/versions/1.0.0/finalize`,
    `https://store.test/api/admin/items/${ITEM_ID}/approve`,
  ]);

  // The owner's token goes to the Worker and never to the signed upload URL,
  // whose own signature is the authorisation.
  expect(worker.calls.map(authOf)).toEqual([
    `Bearer ${session.token}`,
    null,
    `Bearer ${session.token}`,
    `Bearer ${session.token}`,
  ]);

  const [request, upload, finalize] = worker.calls;
  expect(JSON.parse(String(request?.init.body))).toEqual({
    envelope: plan.envelope,
    name: "Aurora",
  });
  expect(upload?.init.body).toBe(plan.packageBytes);
  expect(JSON.parse(String(finalize?.init.body))).toEqual({
    thumbnail: plan.thumbnail,
  });

  expect(result).toEqual({
    id: ITEM_ID,
    version: "1.0.0",
    status: "published",
  });
});

it("does not approve an item the Worker already published", async () => {
  const worker = fakeWorker([
    JSON_ANSWER({ version: "1.0.0", status: "published", uploadUrl: UPLOAD }),
    new Response(null, { status: 200 }),
    JSON_ANSWER({ ok: true, status: "published", version: "1.0.0" }),
  ]);

  const result = await driveImport({
    plan: planOf(),
    token: session.token,
    fetch: worker.fetch,
  });

  expect(worker.calls).toHaveLength(3);
  expect(result).toEqual({
    id: ITEM_ID,
    version: "1.0.0",
    status: "published",
  });
});

it("refuses to import when the Worker computes another version", async () => {
  const worker = fakeWorker([
    JSON_ANSWER({ version: "1.0.1", status: "pending", uploadUrl: UPLOAD }),
  ]);

  await expect(
    driveImport({ plan: planOf(), token: session.token, fetch: worker.fetch }),
  ).rejects.toThrow(/1\.0\.1/);
  expect(worker.calls).toHaveLength(1);
});

it("says the session is not an owner on a 404 from approve, and never prints the token", async () => {
  const worker = fakeWorker([
    JSON_ANSWER({ version: "1.0.0", status: "pending", uploadUrl: UPLOAD }),
    new Response(null, { status: 200 }),
    JSON_ANSWER({ ok: true, status: "pending", version: "1.0.0" }),
    new Response("not found", { status: 404 }),
  ]);

  const failure = await driveImport({
    plan: planOf(),
    token: session.token,
    fetch: worker.fetch,
  }).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toMatch(/owner/);
  expect((failure as Error).message).not.toContain(session.token);
});

it("reports a refused request without echoing the session token", async () => {
  const worker = fakeWorker([new Response("bad request", { status: 400 })]);

  const failure = await driveImport({
    plan: planOf(),
    token: session.token,
    fetch: worker.fetch,
  }).catch((error: unknown) => error);

  expect((failure as Error).message).toContain("400");
  expect((failure as Error).message).not.toContain(session.token);
});

it("refuses an empty package or thumbnail, and item.json that is not JSON", () => {
  const base = {
    itemJson: JSON.stringify(oldItem()),
    packageBytes: packageOf(),
    thumbnailBytes: PNG,
    session,
  };

  expect(() => importPlan({ ...base, packageBytes: new Uint8Array() })).toThrow(
    /package/,
  );
  expect(() =>
    importPlan({ ...base, thumbnailBytes: new Uint8Array() }),
  ).toThrow(/thumbnail/);
  expect(() => importPlan({ ...base, itemJson: "{" })).toThrow(/JSON/);
  expect(() => importPlan({ ...base, itemJson: "[]" })).toThrow(/object/);
});

it("redacts the signed upload URL when the PUT itself rejects", async () => {
  let calls = 0;
  const fetch = (input: RequestInfo | URL) => {
    calls += 1;
    if (calls === 1)
      return Promise.resolve(
        JSON_ANSWER({
          version: "1.0.0",
          status: "pending",
          uploadUrl: UPLOAD,
        }),
      );
    // What a refused connection reports: the URL, signature and all.
    return Promise.reject(new TypeError(`fetch failed for ${String(input)}`));
  };

  const failure = await driveImport({
    plan: planOf(),
    token: session.token,
    fetch: fetch as typeof globalThis.fetch,
  }).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toContain("upload");
  expect((failure as Error).message).toContain(
    "https://r2.example.test/package.zip",
  );
  expect((failure as Error).message).not.toContain("X-Amz-Signature");
  expect((failure as Error).message).not.toContain("secret");
});

it("refuses a finalize answer with no status", async () => {
  const worker = fakeWorker([
    JSON_ANSWER({ version: "1.0.0", status: "pending", uploadUrl: UPLOAD }),
    new Response(null, { status: 200 }),
    JSON_ANSWER({ ok: true, version: "1.0.0" }),
  ]);

  await expect(
    driveImport({ plan: planOf(), token: session.token, fetch: worker.fetch }),
  ).rejects.toThrow(/finalize request did not answer with a status/);
});

it("refuses an approve answer with no status rather than inventing one", async () => {
  const worker = fakeWorker([
    JSON_ANSWER({ version: "1.0.0", status: "pending", uploadUrl: UPLOAD }),
    new Response(null, { status: 200 }),
    JSON_ANSWER({ ok: true, status: "pending", version: "1.0.0" }),
    JSON_ANSWER({ ok: true }),
  ]);

  await expect(
    driveImport({ plan: planOf(), token: session.token, fetch: worker.fetch }),
  ).rejects.toThrow(/status/);
});

it("asks for the two arguments it cannot default", () => {
  expect(parseArgs([])).toEqual({ kind: "usage" });
  expect(parseArgs(["--source", "catalogue/x"])).toEqual({ kind: "usage" });
});

it("keeps the host's own settings directory as the default", () => {
  expect(defaultSettingsDir).toBe(DEFAULT_SETTINGS_DIR);
});

const here = path.dirname(fileURLToPath(import.meta.url));
/** `src/web`, which is both the cwd a run would use and where tsx is installed. */
const WEB_ROOT = path.resolve(here, "..", "..");
/** tsx's own CLI, spawned directly: no `npx` resolution and no network. */
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");

/** The executable contract, run the way the usage line runs it. */
function runScript(argv: readonly string[]) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          TSX_CLI,
          path.join(WEB_ROOT, "scripts", "import-catalogue-item.mjs"),
          ...argv,
        ],
        { cwd: WEB_ROOT },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    },
  );
}

it("prints its usage and exits 2 when run with no arguments", async () => {
  const run = await runScript([]);

  expect(run.code).toBe(2);
  expect(run.stdout).toBe("");
  expect(run.stderr).toContain("Usage:");
  expect(run.stderr).toContain("--source");
});

it("says what is missing in a source directory and exits 1", async () => {
  const source = await mkdtemp(path.join(os.tmpdir(), "yunari-import-"));
  try {
    const run = await runScript([
      "--source",
      source,
      "--origin",
      "https://store.test",
    ]);

    expect(run.code).toBe(1);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain(`No readable item.json in ${source}.`);
    expect(run.stderr).not.toContain("Bearer");
  } finally {
    await rm(source, { recursive: true, force: true });
  }
});
