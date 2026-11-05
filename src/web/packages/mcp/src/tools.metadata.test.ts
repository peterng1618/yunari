import { afterEach, describe, expect, it } from "vitest";
import {
  closeHosts,
  context,
  hostHandler,
  payload,
  refusalTextOf,
  startHost,
} from "./testing/tool-fixtures.js";
import { createTheme, setThemeMetadata } from "./tools/draft.js";

afterEach(closeHosts);

describe("the theme-metadata tool", () => {
  it("drops emptied fields rather than storing them as values", async () => {
    const host = await startHost(hostHandler());
    const ctx = context(host);
    await createTheme(ctx, { name: "Mine", width: 800, height: 480 });
    await setThemeMetadata(ctx, { author: "Me", description: "Mine" });

    const cleared = payload(
      await setThemeMetadata(ctx, {
        author: "",
        description: "",
        tags: [],
      }),
    );

    expect(cleared.metadata).not.toHaveProperty("author");
    expect(cleared.metadata).not.toHaveProperty("description");
    expect(cleared.metadata).not.toHaveProperty("tags");
  });

  it("refuses a tag the format does not take", async () => {
    const host = await startHost(hostHandler());
    const ctx = context(host);
    await createTheme(ctx, { name: "Mine", width: 800, height: 480 });
    const before = structuredClone(ctx.drafts.current().envelope.metadata);

    const result = await setThemeMetadata(ctx, { tags: ["Not A Tag"] });

    expect(result.isError).toBe(true);
    expect(refusalTextOf(result)).toMatch(/tag/i);
    expect(ctx.drafts.current().envelope.metadata).toEqual(before);
  });
});
