import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  contentTypeFor,
  needsTrailingSlash,
  realStaticPath,
  resolveStaticPath,
} from "./static-path.js";

describe("needsTrailingSlash", () => {
  it("redirects the bare mount, whose relative assets would resolve one level up", () => {
    expect(needsTrailingSlash("/editor", "/editor")).toBe(true);
  });

  it("leaves the slashed form alone, so the redirect cannot loop", () => {
    expect(needsTrailingSlash("/editor/", "/editor")).toBe(false);
  });

  it("leaves assets inside the mount alone", () => {
    expect(needsTrailingSlash("/editor/assets/index-abc.js", "/editor")).toBe(
      false,
    );
    expect(needsTrailingSlash("/editor/index.html", "/editor")).toBe(false);
  });

  it("ignores a query string, which does not change which directory the document is in", () => {
    expect(needsTrailingSlash("/editor?theme=showcase", "/editor")).toBe(true);
  });

  it("does not match a sibling whose name merely begins with the mount", () => {
    expect(needsTrailingSlash("/editorial", "/editor")).toBe(false);
  });
});

const ROOT = path.resolve("/srv/player");

describe("resolveStaticPath", () => {
  it("resolves a plain file", () => {
    expect(resolveStaticPath(ROOT, "/assets/main.js")).toBe(
      path.join(ROOT, "assets", "main.js"),
    );
  });

  it("resolves the root itself", () => {
    expect(resolveStaticPath(ROOT, "/")).toBe(ROOT);
  });

  it("ignores a query string", () => {
    expect(resolveStaticPath(ROOT, "/main.js?v=2")).toBe(
      path.join(ROOT, "main.js"),
    );
  });

  describe("refusing to escape the root (§141)", () => {
    it.each([
      ["a plain parent traversal", "/../secrets.txt"],
      ["a nested traversal", "/assets/../../secrets.txt"],
      ["a deep traversal", "/../../../../../../etc/passwd"],
      ["a percent-encoded traversal", "/%2e%2e/secrets.txt"],
      ["a double-encoded separator", "/..%2fsecrets.txt"],
    ])("refuses %s", (_label, urlPath) => {
      expect(resolveStaticPath(ROOT, urlPath)).toBeUndefined();
    });

    it("refuses a sibling directory that merely shares the root prefix", () => {
      // The bug a bare startsWith(root) check would let through: a root of
      // /srv/player must not also admit /srv/player-secrets.
      expect(
        resolveStaticPath(ROOT, "/../player-secrets/key.pem"),
      ).toBeUndefined();
    });

    it("refuses a NUL byte, which can truncate the path inside a syscall", () => {
      expect(resolveStaticPath(ROOT, "/main.js\0.png")).toBeUndefined();
    });

    it("refuses a malformed percent escape rather than guessing", () => {
      expect(resolveStaticPath(ROOT, "/%zz")).toBeUndefined();
    });

    it("checks where the path LANDS, not whether the URL looked suspicious", () => {
      // `a/../b.js` contains `..` and is perfectly legitimate: it lands inside
      // the root. Pattern-matching the URL would refuse it, and would still
      // miss encodings it had not thought of.
      expect(resolveStaticPath(ROOT, "/assets/../main.js")).toBe(
        path.join(ROOT, "main.js"),
      );
    });
  });

  it("treats leading slashes as root-relative rather than absolute", () => {
    const resolved = resolveStaticPath(ROOT, "///main.js");

    // Without stripping them, path.resolve would read this as an absolute
    // path and leave the root behind entirely.
    expect(resolved).toBe(path.join(ROOT, "main.js"));
  });
});

describe("realStaticPath", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  async function root(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-real-static-"));
    dirs.push(dir);
    await fs.mkdir(path.join(dir, "assets"));
    await fs.writeFile(path.join(dir, "assets", "app.js"), "export {};");
    return dir;
  }

  it("answers the real path of a file a build wrote", async () => {
    const dir = await root();

    expect(await realStaticPath(dir, "/assets/app.js")).toBe(
      await fs.realpath(path.join(dir, "assets", "app.js")),
    );
  });

  it("refuses a link even when it points inside the root", async () => {
    const dir = await root();
    await fs.symlink(
      path.join(dir, "assets", "app.js"),
      path.join(dir, "assets", "linked.js"),
    );

    expect(await realStaticPath(dir, "/assets/linked.js")).toBeUndefined();
  });

  it("refuses a path that names a dotfile", async () => {
    const dir = await root();
    await fs.writeFile(path.join(dir, ".env"), "SECRET=1");

    expect(await realStaticPath(dir, "/.env")).toBeUndefined();
  });

  it("refuses a file that is not there, and a path that escapes", async () => {
    const dir = await root();

    expect(await realStaticPath(dir, "/assets/missing.js")).toBeUndefined();
    expect(await realStaticPath(dir, "/../secrets.txt")).toBeUndefined();
  });
});

describe("contentTypeFor", () => {
  it.each([
    ["index.html", "text/html; charset=utf-8"],
    ["main.js", "text/javascript; charset=utf-8"],
    ["style.css", "text/css; charset=utf-8"],
    ["theme.json", "application/json; charset=utf-8"],
    ["manifest.webmanifest", "application/manifest+json"],
    ["icon.svg", "image/svg+xml"],
    ["font.woff2", "font/woff2"],
  ])("types %s correctly", (file, expected) => {
    expect(contentTypeFor(file)).toBe(expected);
  });

  it("is case-insensitive about the extension", () => {
    expect(contentTypeFor("IMAGE.PNG")).toBe("image/png");
  });

  it("falls back to a type browsers download rather than execute", () => {
    // The safe direction for something we do not recognise.
    expect(contentTypeFor("mystery.xyz")).toBe("application/octet-stream");
    expect(contentTypeFor("no-extension")).toBe("application/octet-stream");
  });
});
