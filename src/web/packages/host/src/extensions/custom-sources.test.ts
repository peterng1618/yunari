import type { ConsentState, InstalledExtension } from "@yunari/extension-api";
import { describe, expect, it } from "vitest";
import { pluginSourceRows } from "./custom-sources.js";
import type { ExtensionService } from "./service.js";

function extensionOf(options: {
  readonly key: string;
  readonly customSources?: readonly Readonly<Record<string, unknown>>[];
  readonly consent?: ConsentState;
}): InstalledExtension {
  return {
    key: options.key,
    name: options.key,
    publisher: "local",
    version: "1.0.0",
    execution: "declarative",
    capabilities: [],
    contributions: { customSources: options.customSources ?? [] },
    devices: [],
    consent: options.consent ?? "not-required",
    fingerprint: "fingerprint",
  };
}

function serviceOf(
  extensions: readonly InstalledExtension[],
  mayLoad: (key: string) => Promise<boolean> = async () => true,
): Pick<ExtensionService, "list" | "mayLoad"> {
  return { list: async () => extensions, mayLoad };
}

function row(
  id: string,
  patch: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    id,
    name: id,
    url: `https://${id}.example/data`,
    intervalMs: 60_000,
    timeoutMs: 5_000,
    fields: [{ id: "x", label: "X", pointer: "/x", type: "number" }],
    ...patch,
  };
}

describe("pluginSourceRows", () => {
  it("accepts a row with no auth or with auth kind none", async () => {
    const rows = await pluginSourceRows(
      serviceOf([
        extensionOf({
          key: "acme/data",
          customSources: [row("open"), row("none", { auth: { kind: "none" } })],
        }),
      ]),
    );

    expect(rows.map((source) => source.id)).toEqual(["open", "none"]);
  });

  it("refuses a row that would attach a host credential", async () => {
    for (const kind of ["bearer", "basic", "header", "query"] as const) {
      const rows = await pluginSourceRows(
        serviceOf([
          extensionOf({
            key: "acme/data",
            customSources: [
              row("secret", {
                auth: { kind, credentialId: "user_token" },
                ...(kind === "header" ? { headerName: "x-api-key" } : {}),
                ...(kind === "query" ? { queryName: "api_key" } : {}),
              }),
            ],
          }),
        ]),
      );

      expect(rows, kind).toEqual([]);
    }
  });

  it("skips a row from an extension whose consent is missing", async () => {
    const rows = await pluginSourceRows(
      serviceOf([
        extensionOf({
          key: "acme/data",
          consent: "missing",
          customSources: [row("gated")],
        }),
      ]),
    );

    expect(rows).toEqual([]);
  });

  it("skips a row from an extension the service will not load", async () => {
    const rows = await pluginSourceRows(
      serviceOf(
        [
          extensionOf({
            key: "acme/data",
            customSources: [row("gated")],
          }),
        ],
        async () => false,
      ),
    );

    expect(rows).toEqual([]);
  });

  it("skips a malformed row and keeps the valid one", async () => {
    const rows = await pluginSourceRows(
      serviceOf([
        extensionOf({
          key: "acme/data",
          customSources: [row("valid"), { id: "broken", url: "ftp://nope" }],
        }),
      ]),
    );

    expect(rows.map((source) => source.id)).toEqual(["valid"]);
  });
});
