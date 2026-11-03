import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { registerAssetTools } from "./tools/assets.js";
import { registerComposeTools } from "./tools/compose-tools.js";
import {
  getTheme,
  listAssetSources,
  listDisplays,
  listSensors,
  listThemes,
  yunariStatus,
} from "./tools/discovery.js";
import { registerDraftTools } from "./tools/draft.js";
import { registerVerifyTools } from "./tools/verify.js";
import type { ToolContext } from "./types.js";

const SERVER_NAME = "yunari-theme-designer";
const SERVER_VERSION = "0.1.0";

/**
 * The MCP server for one host connection. Tool handlers answer with text JSON
 * and turn every refusal into a tool error, so the stdio connection stays up
 * for a later call after a host goes away.
 */
export function buildServer(context: ToolContext): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  server.registerTool(
    "yunari_status",
    {
      description:
        "Report the connected Yunari host: URL, reachability, theme count, displays, asset sources and sensor count.",
    },
    async () => await yunariStatus(context),
  );

  server.registerTool(
    "list_displays",
    {
      description:
        "List every display on the host with the theme it holds, its shape and rotation, and a panel's status, commands and geometry.",
    },
    async () => await listDisplays(context),
  );

  server.registerTool(
    "list_sensors",
    {
      description:
        "List the sensor keys this host can read, with family, label, unit and whether the host currently answers each key. Never invents a reading.",
      inputSchema: z.object({
        measured: z
          .boolean()
          .optional()
          .describe(
            "Poll the host for readings. Defaults to true; pass false to list the catalogue without asking the host what it measures.",
          ),
      }),
    },
    async ({ measured }) => await listSensors(context, measured),
  );

  server.registerTool(
    "list_themes",
    {
      description:
        "List the themes stored in the host's library with id, name, artboard and metadata.",
    },
    async () => await listThemes(context),
  );

  server.registerTool(
    "get_theme",
    {
      description:
        "Read one stored theme's envelope, its declared asset paths and its credits. Asset bytes are never returned.",
      inputSchema: z.object({
        themeId: z.string().min(1).describe("The stored theme id."),
      }),
    },
    async ({ themeId }) => await getTheme(context, themeId),
  );

  server.registerTool(
    "list_asset_sources",
    {
      description:
        "List the asset sources this host can search, with each source's label, category and credential requirement.",
    },
    async () => await listAssetSources(context),
  );

  registerAssetTools(server, context);
  registerDraftTools(server, context);
  registerComposeTools(server, context);
  registerVerifyTools(server, context);

  return server;
}
