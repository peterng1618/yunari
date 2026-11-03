import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * The bundled MCP entry, or undefined when this package has no MCP files.
 * A source run without a staged MCP build hides the command and the tray row
 * rather than offering a launcher that fails.
 */
export function mcpBinPath(packageRoot: string): string | undefined {
  const bin = path.join(packageRoot, "packages", "mcp", "bin", "yunari-mcp.js");
  return existsSync(bin) ? bin : undefined;
}

/**
 * Runs `yunari mcp <args>` through this Node and the bundled bin. The bin is a
 * separate process so the host bundle imports no MCP module and the installer's
 * readline owns the terminal.
 */
export function runMcpCommand(
  argv: readonly string[],
  packageRoot: string,
  spawn: typeof spawnSync = spawnSync,
): number {
  const bin = mcpBinPath(packageRoot);
  if (bin === undefined) {
    console.error("The MCP tools are not installed in this package.");
    return 1;
  }
  const result = spawn(process.execPath, [bin, ...argv], {
    stdio: "inherit",
  });
  return result.status ?? 1;
}
