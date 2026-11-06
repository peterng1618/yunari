/**
 * Pure, Node-safe theme authoring.
 *
 * The editor and the MCP server both import this barrel. Nothing here reaches
 * for React, the DOM, a Fabric class or an editor manager: the scene it builds
 * is the plain JSON the envelope persists.
 */

export * from "./artboard.js";
export * from "./assets.js";
export * from "./authoring.js";
export * from "./card-library.js";
export * from "./card-token-mapping.js";
export * from "./document.js";
export * from "./globals.js";
export * from "./icons.js";
export * from "./objects.js";
export * from "./palette-role.js";
export * from "./starter.js";
export * from "./widget-assets.js";
export * from "./widget-unit.js";
