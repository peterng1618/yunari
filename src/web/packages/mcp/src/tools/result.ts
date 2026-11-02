import type { CallToolResult } from "@modelcontextprotocol/server";
import { HostRefusalError } from "../host-client.js";

/** A successful tool answer: text JSON, never a binary payload. */
export function textResult(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

/** A refusal that carries structured detail, such as validator issues. */
export function failureResult(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    isError: true,
  };
}

/** Image content for an agent to look at, with its JSON summary beside it. */
export function imageResult(
  bytes: Uint8Array,
  mimeType: string,
  summary: unknown,
): CallToolResult {
  return {
    content: [
      { type: "text", text: JSON.stringify(summary, null, 2) },
      {
        type: "image",
        data: Buffer.from(bytes).toString("base64"),
        mimeType,
      },
    ],
  };
}

/**
 * A failed tool answer. The MCP server keeps the connection open for a later
 * call, so a host refusal is relayed as a tool error rather than thrown.
 *
 * A refusal that carried structured issues is answered as a JSON failure block
 * so its paths survive; a plain-text refusal stays the host's own sentence.
 */
export function errorResult(error: unknown): CallToolResult {
  if (error instanceof HostRefusalError) {
    return failureResult({
      ok: false,
      status: error.status,
      message: error.message,
      issues: error.issues,
    });
  }
  return {
    content: [
      {
        type: "text",
        text: error instanceof Error ? error.message : String(error),
      },
    ],
    isError: true,
  };
}

/**
 * Names the theme a host refusal was about.
 *
 * The host answers an unknown theme with a bare "Theme not found", which does
 * not tell an agent which id it asked for. A structured refusal keeps its
 * issues and gains the same note.
 */
export function withRequestedTheme(error: unknown, themeId: string): Error {
  const note = ` The requested theme id is "${themeId}".`;
  if (error instanceof HostRefusalError) {
    return new HostRefusalError(
      error.status,
      error.issues,
      error.body,
      `${error.message}${note}`,
    );
  }
  const reason = error instanceof Error ? error.message : String(error);
  return new Error(`${reason}${note}`);
}

/** Runs a JSON-producing tool body and turns any refusal into a tool error. */
export async function jsonAttempt(
  work: () => Promise<unknown> | unknown,
): Promise<CallToolResult> {
  try {
    return textResult(await work());
  } catch (error) {
    return errorResult(error);
  }
}
