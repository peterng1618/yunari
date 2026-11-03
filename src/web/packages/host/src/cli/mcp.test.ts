import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { mcpConsoleLaunch, runMcpCommand } from "./mcp.js";

const roots: string[] = [];

function packageRoot(withBin: boolean): string {
  const root = mkdtempSync(path.join(tmpdir(), "yunari-host-mcp-"));
  roots.push(root);
  if (withBin) {
    const bin = path.join(root, "packages", "mcp", "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, "yunari-mcp.js"), "");
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

it("routes mcp to the bundled bin with the same arguments", () => {
  const calls: unknown[] = [];
  const code = runMcpCommand(["install", "--yes"], packageRoot(true), ((
    ...args: unknown[]
  ) => {
    calls.push(args);
    return { status: 7 };
  }) as never);

  expect(code).toBe(7);
  expect(calls[0]).toEqual([
    process.execPath,
    [
      path.join(roots[0] as string, "packages", "mcp", "bin", "yunari-mcp.js"),
      "install",
      "--yes",
    ],
    { stdio: "inherit" },
  ]);
});

it("fails plainly when this package has no MCP files", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(runMcpCommand(["install"], packageRoot(false))).toBe(1);
    expect(error.mock.calls.flat().join("\n")).toContain(
      "not installed in this package",
    );
  } finally {
    error.mockRestore();
  }
});

it("opens a console for the tray on Windows", () => {
  const launch = mcpConsoleLaunch("C:/pkg/yunari-mcp.js", "win32");
  expect(launch.command).toBe("cmd.exe");
  expect(launch.args).toEqual([
    "/c",
    "start",
    "",
    process.execPath,
    "C:/pkg/yunari-mcp.js",
  ]);
  expect(mcpConsoleLaunch("/pkg/yunari-mcp.js", "linux")).toEqual({
    command: process.execPath,
    args: ["/pkg/yunari-mcp.js"],
  });
});
