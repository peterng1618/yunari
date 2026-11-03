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
 * How the tray opens the installer in a terminal of its own. On Windows
 * `cmd /c start` allocates a console; the tray process itself has none, and a
 * child with ignored stdio is not a TTY and would print usage and exit.
 */
export function mcpConsoleLaunch(
  bin: string,
  platform: NodeJS.Platform = process.platform,
): { readonly command: string; readonly args: readonly string[] } {
  return platform === "win32"
    ? {
        command: "cmd.exe",
        args: ["/c", "start", "", process.execPath, bin],
      }
    : { command: process.execPath, args: [bin] };
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
