import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import type { ToolContext } from "../types.js";
import {
  addBinding,
  addCard,
  addChart,
  addIcon,
  addImage,
  addShape,
  addText,
  groupObjects,
  listObjects,
  removeObject,
  ungroupObjects,
  updateObject,
} from "./compose.js";

const boxSchema = z.object({
  left: z.number(),
  top: z.number(),
  width: z.number(),
  height: z.number(),
});

const bindingSchema = z.object({
  id: z.string().min(1),
  semanticKey: z.string().min(1),
  precision: z.number().optional(),
  unitDisplay: z.enum(["none", "short", "long"]).optional(),
  scale: z.number().optional(),
  offset: z.number().optional(),
  unit: z.string().optional(),
  autoScale: z.boolean().optional(),
  format: z.string().optional(),
  timeZone: z.string().optional(),
});

const themeIdSchema = z.string().min(1).optional();

/** Registers the scene-composition tools on the server. */
export function registerComposeTools(server: McpServer, context: ToolContext) {
  server.registerTool(
    "add_card",
    {
      description:
        "Insert a card-library unit into the draft at artboard coordinates. Returns the created ids and any kit issues.",
      inputSchema: z.object({
        unit: z.string().min(1),
        left: z.number(),
        top: z.number(),
        scale: z.number().positive().optional(),
        themeId: themeIdSchema,
      }),
    },
    async (input) => await addCard(context, input),
  );

  server.registerTool(
    "add_text",
    {
      description:
        "Add a text object with literal and value runs. A value run names a binding supplied in bindings. A run may name a type token (heading, body or mono); its size is the fallback role.",
      inputSchema: z.object({
        box: boxSchema,
        runs: z
          .array(
            z.object({
              kind: z.enum(["literal", "value"]).optional(),
              bindingId: z.string().min(1).optional(),
              text: z.string().optional(),
              token: z.string().min(1).optional(),
              size: z.number().positive(),
              typeToken: z.enum(["heading", "body", "mono"]).optional(),
              precision: z.number().int().optional(),
              unitDisplay: z.enum(["none", "short", "long"]).optional(),
            }),
          )
          .min(1),
        align: z.enum(["left", "center", "right"]).optional(),
        verticalAlign: z.enum(["top", "middle", "bottom"]).optional(),
        overflow: z.enum(["clip", "ellipsis", "visible"]).optional(),
        bindings: z.array(bindingSchema).optional(),
        themeId: themeIdSchema,
      }),
    },
    async (input) => await addText(context, input),
  );

  server.registerTool(
    "add_shape",
    {
      description:
        "Add a rect, ellipse or path shape with a palette token. A path supplies its own commands and stroke width; a rect takes a radius. Path points are artboard units relative to the box's top-left, and the stroke width is in artboard units. Other combinations are refused.",
      inputSchema: z.object({
        kind: z.enum(["rect", "ellipse", "path"]),
        box: boxSchema,
        token: z.string().min(1).optional(),
        radius: z.number().optional(),
        points: z.array(z.array(z.union([z.string(), z.number()]))).optional(),
        strokeWidth: z.number().positive().optional(),
        themeId: themeIdSchema,
      }),
    },
    async (input) => await addShape(context, input),
  );

  server.registerTool(
    "add_image",
    {
      description:
        "Place a declared asset in the draft. The image fills its authored box.",
      inputSchema: z.object({
        assetId: z.string().min(1),
        box: boxSchema,
        fit: z.enum(["cover", "contain"]).optional(),
        themeId: themeIdSchema,
      }),
    },
    async (input) => await addImage(context, input),
  );

  server.registerTool(
    "add_icon",
    {
      description: "Place a glyph from the shared icon set.",
      inputSchema: z.object({
        icon: z.string().min(1),
        box: boxSchema,
        token: z.string().min(1).optional(),
        themeId: themeIdSchema,
      }),
    },
    async (input) => await addIcon(context, input),
  );

  server.registerTool(
    "add_chart",
    {
      description:
        "Add a line, bar or gauge chart reading one or more bindings. The box is its top-left, like every other compose tool; omitted settings use the theme's palette.",
      inputSchema: z.object({
        family: z.enum(["line", "bar", "gauge"]),
        box: boxSchema,
        binding: bindingSchema.optional(),
        bindings: z.array(bindingSchema).optional(),
        settings: z.unknown().optional(),
        themeId: themeIdSchema,
      }),
    },
    async (input) => await addChart(context, input),
  );

  server.registerTool(
    "add_binding",
    {
      description:
        "Replace one object's semantic bindings. Binding ids must be unique across the envelope.",
      inputSchema: z.object({
        objectId: z.string().min(1),
        bindings: z.array(bindingSchema),
        themeId: themeIdSchema,
      }),
    },
    async ({ objectId, bindings, themeId }) =>
      await addBinding(context, objectId, bindings, themeId),
  );

  server.registerTool(
    "list_objects",
    {
      description:
        "List the draft's scene objects, bindings and declared assets.",
      inputSchema: z.object({ themeId: themeIdSchema }),
    },
    async ({ themeId }) => await listObjects(context, themeId),
  );

  server.registerTool(
    "update_object",
    {
      description:
        "Shallow-merge a validated JSON patch into one scene object.",
      inputSchema: z.object({
        objectId: z.string().min(1),
        patch: z.record(z.string(), z.unknown()),
        themeId: themeIdSchema,
      }),
    },
    async ({ objectId, patch, themeId }) =>
      await updateObject(context, objectId, patch, themeId),
  );

  server.registerTool(
    "remove_object",
    {
      description: "Remove one scene object and every binding it carried.",
      inputSchema: z.object({
        objectId: z.string().min(1),
        themeId: themeIdSchema,
      }),
    },
    async ({ objectId, themeId }) =>
      await removeObject(context, objectId, themeId),
  );

  server.registerTool(
    "group_objects",
    {
      description:
        "Wrap root scene objects in a Fabric group, minting fresh ids for the group and its children.",
      inputSchema: z.object({
        objectIds: z.array(z.string().min(1)).min(1),
        themeId: themeIdSchema,
      }),
    },
    async ({ objectIds, themeId }) =>
      await groupObjects(context, objectIds, themeId),
  );

  server.registerTool(
    "ungroup_objects",
    {
      description:
        "Lift a root group's children back into the scene and remove the group.",
      inputSchema: z.object({
        groupId: z.string().min(1),
        themeId: themeIdSchema,
      }),
    },
    async ({ groupId, themeId }) =>
      await ungroupObjects(context, groupId, themeId),
  );
}
