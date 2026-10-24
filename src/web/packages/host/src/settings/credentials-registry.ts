import type { CredentialRow } from "@yunari/renderer-core";
import { verifyUnsplash } from "../assets/images/unsplash.js";
import { verifyOpenWeatherMap } from "../providers/weather/openweathermap.js";
import { verifyWeatherApi } from "../providers/weather/weatherapi.js";
import type { CustomSource, SourceIssue } from "./sources.js";

/**
 * The credentials this host knows how to store.
 *
 * A key for an id this table does not name is refused, so a request cannot
 * fill `credentials.json` with arbitrary entries.
 */
export type CredentialKind = "bearer" | "cookie" | "query";

export interface KnownCredential {
  readonly id: string;
  readonly label: string;
  readonly kind: CredentialKind;
  /** Absent when nothing can be checked without spending a real request. */
  readonly verify?: (
    value: string,
    fetchImpl: typeof fetch,
  ) => Promise<
    { readonly ok: true } | { readonly ok: false; readonly message: string }
  >;
  /** How a person gets a key: one sentence, and the page that issues one. */
  readonly help?: { readonly text: string; readonly url: string };
}

/** What `GET /api/credentials` answers. Never carries the value. */
export type { CredentialRow };

export const KNOWN_CREDENTIALS: readonly KnownCredential[] = [
  {
    id: "unsplash",
    label: "Unsplash",
    kind: "bearer",
    verify: verifyUnsplash,
    help: {
      text: "Create an app on your Unsplash developer page and copy its access key.",
      url: "https://unsplash.com/oauth/applications",
    },
  },
  {
    id: "weatherapi",
    label: "WeatherAPI",
    kind: "query",
    verify: verifyWeatherApi,
    help: {
      text: "Create a free WeatherAPI account and copy the API key from your dashboard.",
      url: "https://www.weatherapi.com/my/",
    },
  },
  {
    id: "openweathermap",
    label: "OpenWeatherMap",
    kind: "query",
    verify: verifyOpenWeatherMap,
    help: {
      text: "Create a free OpenWeatherMap account and copy a key from your API keys page.",
      url: "https://home.openweathermap.org/api_keys",
    },
  },
];

/**
 * The table a credential write is checked against: the built-ins plus one entry
 * per credential id a valid custom source references.
 *
 * `sourceIssues` is accepted for the caller's convenience but is not used to
 * skip an id: an entry the store refused never reaches `sources` — that is the
 * validated projection — and keying a skip by id also refused the *valid* entry
 * when a duplicate id was the refused one. Built-ins win a shared id, and an
 * id referenced twice is listed once.
 */
export function sourcesInUse(
  _sourceIssues: readonly SourceIssue[],
  sources: readonly CustomSource[],
  known: readonly KnownCredential[] = KNOWN_CREDENTIALS,
): readonly KnownCredential[] {
  const admitted = new Set(known.map((entry) => entry.id));
  const table: KnownCredential[] = [...known];

  for (const source of sources) {
    const credentialId = source.auth?.credentialId;
    if (credentialId === undefined || admitted.has(credentialId)) continue;

    admitted.add(credentialId);
    table.push({
      id: credentialId,
      label: `Custom source credential "${credentialId}"`,
      // The value is a single string; the source's own auth block decides how
      // it is attached, so the table's kind only has to be writable.
      kind: "bearer",
    });
  }

  return table;
}
