import type { FrameInit, FrameRequest } from "@yunari/extension-api";
import type {
  AssetPage,
  AssetResult,
  AssetSourceListing,
} from "@yunari/renderer-core";
import type * as React from "react";
import { useCallback, useRef } from "react";
import { PluginFrame } from "../plugin-frame/plugin-frame.js";
import { base64Of } from "../video-normalizer.js";
import { assetBytes, searchAssets } from "./client.js";

export interface PluginAssetBodyProps {
  readonly source: AssetSourceListing;
  readonly page: AssetPage | undefined;
  readonly query: string;
  readonly onQuery: (query: string) => void;
  readonly onPage: (page: number) => void;
  readonly onPick: (result: AssetResult) => void;
  /** The page the frame's last search answered, so the caller can show it. */
  readonly onResults?: (page: AssetPage) => void;
}

/** The sentence a source with an unknown body gets when its build cannot draw
 *  plugin UI. */
export const PLUGIN_BODY_REFUSAL =
  "This source needs a plugin UI this build cannot show.";

const EMPTY_THEME: FrameInit["theme"] = { palette: {}, typeTokens: {} };
const NEEDS_CREDENTIAL = "This source needs a credential before it can search.";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSearch(
  value: unknown,
): { readonly query: string; readonly page: number } | undefined {
  if (!isRecord(value)) return undefined;
  const query = value["query"];
  const page = value["page"];
  if (typeof query !== "string") return undefined;
  if (typeof page !== "number" || !Number.isInteger(page) || page < 1) {
    return undefined;
  }
  return { query, page };
}

function readId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const id = value["id"];
  return typeof id === "string" && id !== "" ? id : undefined;
}

function failureMessage(page: AssetPage): string {
  return page.failure?.reason === "needs-credential"
    ? NEEDS_CREDENTIAL
    : (page.failure?.message ?? "The host did not answer this source.");
}

/**
 * A source whose body is the plugin's own frame.
 *
 * The frame asks for a search and for bytes; both requests are answered through
 * the host's existing asset routes, so the plugin never receives a host
 * credential and its bytes never pass through the browser unvalidated. A frame
 * that asks for bytes has chosen that result, which is what `onPick` imports
 * through the finder's normal action.
 */
export function PluginBody(props: PluginAssetBodyProps): React.JSX.Element {
  const { source } = props;
  const lastResults = useRef<ReadonlyMap<string, AssetResult>>(new Map());
  const latest = useRef(props);
  latest.current = props;

  const onRequest = useCallback(
    async (request: FrameRequest): Promise<unknown> => {
      if (request.method === "asset.search") {
        const read = readSearch(request.params);
        if (read === undefined) {
          throw new Error("The plugin sent an unreadable asset search.");
        }

        const answer = await searchAssets({
          query: read.query,
          enabled: [source.id],
          pages: { [source.id]: read.page },
        });
        const page = answer.pages.find((entry) => entry.source === source.id);
        if (page === undefined) {
          throw new Error("The host did not answer this source.");
        }
        if (page.failure !== undefined) throw new Error(failureMessage(page));

        lastResults.current = new Map(
          page.results.map((result) => [result.id, result]),
        );
        latest.current.onQuery(read.query);
        latest.current.onPage(read.page);
        latest.current.onResults?.(page);
        return { results: page.results, totalPages: page.totalPages ?? null };
      }

      if (request.method === "asset.bytes") {
        const id = readId(request.params);
        if (id === undefined) {
          throw new Error("The plugin sent an unreadable asset id.");
        }

        const bytes = await assetBytes(source.id, id);
        if (bytes === undefined) {
          throw new Error("The host does not have this asset.");
        }

        const result =
          lastResults.current.get(id) ??
          latest.current.page?.results.find((entry) => entry.id === id);
        if (result !== undefined) latest.current.onPick(result);
        return { bytes: base64Of(bytes.bytes), filename: bytes.filename };
      }

      if (request.method === "ui.resize") return null;

      throw new Error(
        `The plugin frame may not call ${request.method} from an asset body.`,
      );
    },
    [source.id],
  );

  const plugin = source.plugin;
  if (plugin === undefined || plugin === null) {
    return (
      <p className="m-0 p-[var(--space-16)] text-sm text-muted">
        {PLUGIN_BODY_REFUSAL}
      </p>
    );
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-yunari-plugin-asset-body={source.id}
      data-yunari-plugin-asset-query={props.query}
    >
      <PluginFrame
        pluginKey={plugin.key}
        entry={plugin.ui}
        title={source.label}
        settings={{}}
        theme={EMPTY_THEME}
        onRequest={onRequest}
      />
    </div>
  );
}
