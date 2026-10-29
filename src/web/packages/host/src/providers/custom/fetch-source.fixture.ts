import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import type { CustomSource } from "../../settings/sources.js";

/** Shared seams for the source-fetch suite. Kept out of both test files so the
 *  redirect and address cases can use them without duplicating or importing a
 *  file that registers tests. */

/** 1 MiB: the cap, not a tuning knob. */
export const MiB = 1024 * 1024;

export interface SourcePatch {
  readonly id?: string;
  readonly url?: string;
  readonly timeoutMs?: number;
  readonly query?: Readonly<Record<string, string>>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly auth?: NonNullable<CustomSource["auth"]>;
}

export function sourceOf(patch: SourcePatch = {}): CustomSource {
  return {
    id: patch.id ?? "src",
    name: "Source",
    url: patch.url ?? "http://127.0.0.1:8080/data",
    intervalMs: 60_000,
    timeoutMs: patch.timeoutMs ?? 5_000,
    ...(patch.query === undefined ? {} : { query: patch.query }),
    ...(patch.headers === undefined ? {} : { headers: patch.headers }),
    ...(patch.auth === undefined ? {} : { auth: patch.auth }),
    fields: [],
  };
}

export function json(value: unknown, type = "application/json"): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": type },
  });
}

export function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

export interface Call {
  readonly url: URL;
  readonly headers: Headers;
  readonly init: RequestInit;
}

/** A `fetch` seam that records what the client asked for. */
export function serve(handler: (call: Call) => Response | Promise<Response>): {
  fetchImpl: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    const call: Call = {
      url,
      headers: new Headers(init?.headers),
      init: init ?? {},
    };
    calls.push(call);
    return handler(call);
  };

  return { fetchImpl, calls };
}

/** A first-in-first-out socket the test closes by hand. */
export function listen(
  handler: RequestListener,
  host = "127.0.0.1",
): Promise<{
  origin: string;
  close: () => Promise<void>;
}> {
  const server = createServer(handler);
  return new Promise((resolve) =>
    server.listen(0, host, () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        origin: `http://${host}:${port}`,
        close: () => {
          server.closeAllConnections();
          return new Promise<void>((done, reject) => {
            server.close((error) =>
              error === undefined ? done() : reject(error),
            );
          });
        },
      });
    }),
  );
}

/** A JSON body delivered in chunks, so the cap is crossed mid-stream. */
export function streamed(
  text: string,
  chunkSize: number,
  onCancel?: () => void,
): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, bytes.length);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
    cancel() {
      onCancel?.();
    },
  });
}

/** An endless JSON-ish stream, so a stream that closes itself cannot be
 *  mistaken for the client's own abort. */
export function endlessChunk(
  chunkSize: number,
  onCancel: () => void,
): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(chunkSize).fill(0x61);

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(chunk);
    },
    cancel() {
      onCancel();
    },
  });
}
