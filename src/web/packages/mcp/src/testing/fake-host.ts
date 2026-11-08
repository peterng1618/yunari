import http from "node:http";
import type { AddressInfo } from "node:net";
import type { FabricThemeEnvelope } from "../types.js";

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: Buffer;
}

export interface FakeAnswer {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  /** A string/Buffer is sent verbatim; an object is sent as JSON. */
  readonly body?: string | Buffer | unknown;
}

export type FakeHandler = (
  request: RecordedRequest,
  url: URL,
) => FakeAnswer | undefined | Promise<FakeAnswer | undefined>;

export interface FakeHost {
  readonly url: string;
  readonly requests: readonly RecordedRequest[];
  close(): Promise<void>;
}

/**
 * A loopback stand-in for the Yunari host. Tests drive every success and
 * refusal path through it; nothing reaches a real host or the network.
 */
export async function startFakeHost(handler: FakeHandler): Promise<FakeHost> {
  const requests: RecordedRequest[] = [];

  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const recorded: RecordedRequest = {
      method: request.method ?? "GET",
      path: request.url ?? "/",
      headers: request.headers,
      body: Buffer.concat(chunks),
    };
    requests.push(recorded);

    const url = new URL(recorded.path, "http://127.0.0.1");
    const answer = (await handler(recorded, url)) ?? {
      status: 404,
      body: "Not found.",
    };
    const body = answer.body;
    const headers = { ...answer.headers };
    let payload: string | Buffer;

    if (body === undefined) {
      payload = "";
    } else if (typeof body === "string" || Buffer.isBuffer(body)) {
      payload = body;
    } else {
      payload = JSON.stringify(body);
      headers["content-type"] ??= "application/json";
    }

    response.writeHead(answer.status ?? 200, headers);
    response.end(payload);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        );
      }),
  };
}

/** A complete envelope, so a draft test uses the persisted model rather than a cast. */
export function testEnvelope(
  id = "test-theme",
  name = "Test theme",
): FabricThemeEnvelope {
  return {
    schemaVersion: "3.0.0",
    fabricVersion: "7.4.0",
    id,
    artboard: { width: 800, height: 480 },
    metadata: { name, themeLanguage: "en" },
    scene: { version: "7.4.0", objects: [] },
    assets: [],
    bindings: {},
  };
}
