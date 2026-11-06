import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import type { InstalledPlugin } from "@yunari/extension-api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtensionService } from "../extensions/service";
import {
  EXTENSION_UI_CSP,
  handleExtensionUiRoutes,
} from "./extension-ui-routes";

interface Answered {
  readonly status: number;
  readonly headers: http.OutgoingHttpHeaders;
  readonly body: Buffer;
}

function get(
  urlPath: string,
  options: {
    readonly service?: ExtensionService | undefined;
    readonly remoteAddress?: string;
    readonly method?: string;
  } = {},
): Promise<Answered> {
  return new Promise((resolve) => {
    const request = {
      method: options.method ?? "GET",
      url: urlPath,
      headers: { host: "127.0.0.1:5173" },
      socket: { remoteAddress: options.remoteAddress ?? "127.0.0.1" },
    } as unknown as http.IncomingMessage;

    const chunks: Buffer[] = [];
    let statusCode = 200;
    let headers: http.OutgoingHttpHeaders = {};
    const response = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    }) as unknown as http.ServerResponse;
    response.writeHead = ((status: number, next?: http.OutgoingHttpHeaders) => {
      statusCode = status;
      headers = next ?? {};
      return response;
    }) as unknown as typeof response.writeHead;
    response.end = ((data?: unknown) => {
      if (data) chunks.push(Buffer.from(data as string | Uint8Array));
      resolve({ status: statusCode, headers, body: Buffer.concat(chunks) });
      return response;
    }) as unknown as typeof response.end;

    const service =
      options.service ??
      serviceFor(plugin({ directory: String(process.cwd()) }));
    void handleExtensionUiRoutes(
      request,
      response,
      new URL(urlPath, "http://host.invalid"),
      { service },
    );
  });
}

function plugin(overrides: { directory: string }): InstalledPlugin {
  return {
    key: "local/acme",
    publisher: "local",
    manifest: {
      manifestVersion: 1,
      id: "acme",
      name: "Acme",
      version: "1.0.0",
      description: "Acme",
      engines: { yunari: ">=0.1.0" },
      pluginApi: 1,
      execution: "sandboxed-ui",
      capabilities: ["ui:frame"],
      contributes: {},
      ui: "index.html",
    },
    contentHash: "a".repeat(64),
    directory: overrides.directory,
  };
}

function serviceFor(record: InstalledPlugin): ExtensionService {
  return {
    installedPlugin: async (key: string) =>
      key === record.key ? record : undefined,
  } as unknown as ExtensionService;
}

describe("the extension UI route", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "yunari-ui-"));
    await mkdir(path.join(root, "nested"));
    await writeFile(
      path.join(root, "index.html"),
      "<!doctype html><title>Acme",
    );
    await writeFile(path.join(root, "nested", "panel.js"), "export {};");
    await writeFile(path.join(root, "secret.js"), "host secret");
    await writeFile(path.join(root, "blob.bin"), Buffer.from([1, 2, 3]));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("serves the entry with CSP and a no-store cache", async () => {
    const response = await get("/api/extensions/local/acme/ui/index.html", {
      service: serviceFor(plugin({ directory: root })),
    });
    expect(response.status).toBe(200);
    expect(response.body.toString("utf8")).toContain("<title>Acme");
    expect(response.headers["content-security-policy"]).toBe(EXTENSION_UI_CSP);
    expect(response.headers["content-security-policy"]).toContain(
      "default-src 'none'",
    );
    expect(response.headers["content-security-policy"]).toContain(
      "frame-ancestors 'self'",
    );
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
  });

  it("serves a nested file with its own MIME type", async () => {
    const response = await get(
      "/api/extensions/local/acme/ui/nested/panel.js",
      { service: serviceFor(plugin({ directory: root })) },
    );
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe(
      "text/javascript; charset=utf-8",
    );
  });

  it("downloads an unknown extension rather than guessing it", async () => {
    const response = await get("/api/extensions/local/acme/ui/blob.bin", {
      service: serviceFor(plugin({ directory: root })),
    });
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/octet-stream");
    expect(response.headers["content-disposition"]).toContain("attachment");
  });

  it.each([
    ["an encoded separator", "/api/extensions/local/acme/ui/..%2fsecret.js"],
    [
      "an encoded absolute path",
      "/api/extensions/local/acme/ui/%2fetc%2fpasswd",
    ],
    ["a backslash segment", "/api/extensions/local/acme/ui/..%5csecret.js"],
    ["a null byte", "/api/extensions/local/acme/ui/index%00.html"],
  ])("refuses %s", async (_name, url) => {
    const response = await get(url, {
      service: serviceFor(plugin({ directory: root })),
    });
    expect(response.status).toBe(404);
    expect(response.body.toString("utf8")).not.toContain("host secret");
  });

  it("refuses a symlink that points outside the install tree", async (ctx) => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "yunari-outside-"));
    try {
      await writeFile(path.join(outside, "secret.js"), "outside secret");
      try {
        await symlink(
          path.join(outside, "secret.js"),
          path.join(root, "link.js"),
        );
      } catch {
        ctx.skip();
        return;
      }
      const response = await get("/api/extensions/local/acme/ui/link.js", {
        service: serviceFor(plugin({ directory: root })),
      });
      expect(response.status).toBe(404);
      expect(response.body.toString("utf8")).not.toContain("outside secret");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("refuses a directory", async () => {
    const response = await get("/api/extensions/local/acme/ui/nested", {
      service: serviceFor(plugin({ directory: root })),
    });
    expect(response.status).toBe(404);
  });

  it("answers 404 for a plugin this host does not hold", async () => {
    const response = await get("/api/extensions/local/other/ui/index.html", {
      service: serviceFor(plugin({ directory: root })),
    });
    expect(response.status).toBe(404);
  });

  it("refuses a non-loopback caller before reading the plugin", async () => {
    const response = await get("/api/extensions/local/acme/ui/index.html", {
      service: serviceFor(plugin({ directory: root })),
      remoteAddress: "192.168.1.20",
    });
    expect(response.status).toBe(403);
  });

  it("answers 405 for a write method", async () => {
    const response = await get("/api/extensions/local/acme/ui/index.html", {
      service: serviceFor(plugin({ directory: root })),
      method: "POST",
    });
    expect(response.status).toBe(405);
  });
});
