import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createHostBinding } from "./hosting.js";

const open: http.Server[] = [];

function listening(
  host: string,
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_request, response) =>
      response.end("ok"),
    );
    open.push(server);
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      resolve({
        server,
        port:
          typeof address === "object" && address !== null ? address.port : 0,
      });
    });
  });
}

/** Whether the host is still answering on that port, rather than only *saying*
 *  it is. The distinction is the whole of the "keeps the port" case: `state()`
 *  reads the variables `setLan` writes, so it reports the old binding whether or
 *  not the socket was ever restored, and a test that stops at `state()` passes
 *  with the restore line deleted. */
function reachable(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port }, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () => resolve(body));
      })
      .on("error", reject);
  });
}

afterEach(async () => {
  await Promise.all(
    open
      .splice(0)
      .map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

describe("createHostBinding", () => {
  it("says where a phone should go once it serves the LAN", async () => {
    const { server, port } = await listening("127.0.0.1");
    const binding = createHostBinding(server, { port, host: "127.0.0.1" });

    expect((await binding.state()).lan).toBe(false);

    const turned = await binding.setLan(true);
    expect(turned.ok).toBe(true);
    expect((await binding.state()).lan).toBe(true);
    expect((await binding.state()).port).toBe(port);

    await binding.setLan(false);
    expect((await binding.state()).lan).toBe(false);
    expect((await binding.state()).port).toBe(port);
  });

  // Loopback and wildcard coexist on Windows, which is what lets a squatter
  // hold `0.0.0.0:<port>` beside the host's `127.0.0.1:<port>`. Linux refuses
  // the wildcard bind while a specific address holds the port, so the squatter
  // cannot be placed there and the case has nothing to measure.
  it.skipIf(process.platform !== "win32")(
    "keeps the port when the interface will not take it, and says so",
    async () => {
      const { server, port } = await listening("127.0.0.1");
      // The squatter **answers**, and that is not decoration. It is bound to
      // `0.0.0.0:port`, so if the host's own socket is ever lost this one accepts
      // the connection instead — with no request listener the probe hangs until
      // the 20 s timeout, which reads as a slow suite rather than a wrong answer.
      const squatter = http.createServer((_request, response) =>
        response.end("squatter"),
      );
      open.push(squatter);
      // `error` is handled because this bind is the one that can legitimately
      // fail: loopback and wildcard coexist on this platform, but that is a
      // platform behaviour rather than a guarantee, and an unhandled 'error' here
      // leaves the promise unsettled and the suite hanging instead of red.
      await new Promise<void>((resolve, reject) => {
        squatter.once("error", reject);
        squatter.listen(port, "0.0.0.0", () => resolve());
      });

      const binding = createHostBinding(server, { port, host: "127.0.0.1" });
      const turned = await binding.setLan(true);

      expect(turned.ok).toBe(false);
      // The host is still answering where it was, which is the whole point of
      // refusing rather than falling back to another port — and the only
      // assertion here that can tell a restored socket from a closed one. With
      // the restore line gone this resolves "squatter", not "ok": the failure is
      // a wrong answer rather than a hang.
      expect(await reachable(port)).toBe("ok");
      expect((await binding.state()).lan).toBe(false);
      expect((await binding.state()).port).toBe(port);
    },
  );
});
