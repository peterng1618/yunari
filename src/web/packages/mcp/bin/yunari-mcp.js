#!/usr/bin/env node

/**
 * The `yunari-mcp` entry point.
 *
 * A shim rather than the server itself: the server is TypeScript built to
 * `dist/main.js`. A missing build is the most likely way this fails for
 * someone working in the repository, and an unresolved-import stack trace
 * explains none of it.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const entry = new URL("../dist/main.js", import.meta.url);

if (!existsSync(fileURLToPath(entry))) {
  console.error(
    "The MCP server is not built.\n" +
      "  From src/web/, run:  npm run build -w @yunari/mcp",
  );
  process.exit(1);
}

await import(entry);
