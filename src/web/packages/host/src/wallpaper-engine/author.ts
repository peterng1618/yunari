/**
 * A Steam persona name, read from the profile's public XML.
 *
 * The host fetches rather than the browser because Steam sends no CORS header
 * for this document, and the answer is a credit the editor writes beside a
 * Wallpaper Engine item. Every failure — a refusal, a timeout, a body this code
 * cannot read — answers `undefined`: a missing credit must never fail an import.
 */

/** A Steam id is a 64-bit account number and nothing else. Validated before any
 *  request, so a caller cannot turn this into a fetch for an arbitrary path. */
const STEAM_ID = /^\d{17}$/;

/** The public XML profile, which is what carries `<steamID>` without a key. */
const profileUrl = (steamId: string): string =>
  `https://steamcommunity.com/profiles/${steamId}/?xml=1`;

const STEAM_ID_TAG = /<steamID>([^<]*)<\/steamID>/;

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** One pass, so `&amp;lt;` is the text `&lt;` rather than a second decode. */
function decodeEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => {
    return ENTITIES[name] ?? _;
  });
}

export async function fetchAuthorName(
  steamId: string,
  deps: { readonly fetchImpl?: typeof fetch; readonly timeoutMs?: number } = {},
): Promise<string | undefined> {
  if (!STEAM_ID.test(steamId)) {
    return undefined;
  }

  const fetchImpl = deps.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(profileUrl(steamId), {
      signal: AbortSignal.timeout(deps.timeoutMs ?? 5000),
    });
    if (!response.ok) {
      return undefined;
    }

    const match = STEAM_ID_TAG.exec(await response.text());
    if (match === null) {
      return undefined;
    }

    const name = decodeEntities(match[1] ?? "").trim();
    return name === "" ? undefined : name;
  } catch {
    // A refusal, a timeout or an unreadable body is the absence of a credit.
    return undefined;
  }
}
