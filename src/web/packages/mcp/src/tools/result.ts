import type { CallToolResult } from "@modelcontextprotocol/server";

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
 */
export function errorResult(error: unknown): CallToolResult {
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
